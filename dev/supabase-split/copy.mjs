#!/usr/bin/env node
// dev/supabase-split/copy.mjs — Supabase-Split-1 · 3 Nov 2026.
//
// Moves Share's rows from the shared project to Share's own. Reads the shared
// project and never writes it. Prints table names, counts, match or no match, HTTP
// status and Postgres error code: never a row, a key, or PostgREST's message and
// details (a duplicate-key message quotes the row, and subscribers holds emails).
//
// Keys come from hidden prompts, in the environment for one command only:
//   read -s "OLD_KEY?Shared project key: " && echo
//   read -s "NEW_KEY?New project key: " && echo
//   OLD_KEY="$OLD_KEY" NEW_KEY="$NEW_KEY" node <this file> <mode> --new=<ref>
//   unset OLD_KEY NEW_KEY
//
// Modes:
//   held      is the live Worker refusing Supabase calls? (no keys, no ref)
//   rehearse  counts on the shared project (OLD_KEY only, no ref)
//   headers   which header form each project's key works with
//   copy      refuses unless held; copies each table in one request, then verifies
//   verify    every table matches on both sides
//   refusal   a spent serial from the shared project is refused on the new one
//
// A table copied earlier and still matching is skipped, so `copy` can be re-run.
// The new project's ref is an argument, not a constant: it stays out of this public repo.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const OLD_REF = 'tihgvdokeofnjxjkenmm';
const SANDBOX_REF = 'xlwwfafhxqusqyhjgyra';
const SESSION_PROBE = 'https://api.share.refueler.io/chambers/session';
const DUMMY_SESSION = 'A'.repeat(43);   // well formed, matches no session
const PAGE = 1000;

// Parents before children (the two foreign keys). `omit`: identity columns the API
// can't set or that nothing refers to; rows keep their order, ids may differ.
export const TABLES = [
  { name: 'subscribers',           order: 'stripe_customer_id' },
  { name: 'spent_tokens',          order: 'serial' },
  { name: 'double_spend_attempts', order: 'id', omit: 'id' },
  { name: 'api_keys',              order: 'key_hash' },
  { name: 'api_credit_pools',      order: 'org_account_id' },
  { name: 'quota_accounts',        order: 'quota_ref' },
  { name: 'quota_reservations',    order: 'session_hash' },
  { name: 'chartered_orgs',        order: 'org_account_id' },
  { name: 'auth_tokens',           order: 'token_hash' },
  { name: 'auth_sessions',         order: 'session_hash' },
  { name: 'report_counters',       order: 'prefix.asc,year' },
  { name: 'report_register',       order: 'case_ref' },
  { name: 'report_events',         order: 'id', omit: 'id' },
];

export class Stop extends Error {}

const urlFor = (ref) => `https://${ref}.supabase.co`;

function strip(row, omit) {
  if (!omit) return row;
  const { [omit]: _gone, ...rest } = row;
  return rest;
}

/** Order-independent digest of a table's rows, compared and never printed. */
export function digest(rows, omit) {
  const lines = rows.map((row) => {
    const r = strip(row, omit);
    return JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
  }).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function errorCode(res) {
  try { return String((await res.json())?.code ?? 'no code'); } catch { return 'no code'; }
}

/** One project's connection: which headers its key takes (legacy needs Bearer). */
export async function connect(ref, key, label) {
  if (!key) throw new Stop(`${label}: key not set — run the hidden read -s prompt first`);
  const forms = {
    'apikey + Bearer': { apikey: key, Authorization: `Bearer ${key}` },
    'apikey only':     { apikey: key },
  };
  const tried = [];
  for (const [form, headers] of Object.entries(forms)) {
    const res = await fetch(`${urlFor(ref)}/rest/v1/rpc/quota_now`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
    });
    await res.text();
    tried.push(`${form}: ${res.status}`);
    if (res.ok) return { ref, headers, form, tried };
  }
  throw new Stop(`${label}: the key works with neither header form (${tried.join(', ')})`);
}

/** All rows, or { denied: true } where the key has no table access. */
export async function readAll(db, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${urlFor(db.ref)}/rest/v1/${table.name}?select=*&order=${table.order}.asc&limit=${PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: db.headers });
    if (res.status === 401 || res.status === 403) {
      const code = await errorCode(res);
      if (code === '42501') return { denied: true };
      throw new Stop(`${table.name}: read answered ${res.status} (${code})`);
    }
    if (!res.ok) throw new Stop(`${table.name}: read answered ${res.status} (${await errorCode(res)})`);
    const page = await res.json();
    rows.push(...page);
    if (page.length === 0) return { rows };
  }
}

async function insertAll(db, table, rows) {
  const res = await fetch(`${urlFor(db.ref)}/rest/v1/${table.name}`, {
    method: 'POST',
    headers: { ...db.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(rows.map((r) => strip(r, table.omit))),
  });
  if (!res.ok) throw new Stop(`${table.name}: insert answered ${res.status} (${await errorCode(res)})`);
}

/** The live Worker: 503 = its Supabase calls fail (held), 401 = they work. */
export async function heldState() {
  const res = await fetch(SESSION_PROBE, { headers: { Cookie: `__Host-rfs_session=${DUMMY_SESSION}` } });
  await res.text();
  return { status: res.status, held: res.status === 503, live: res.status === 401 };
}

function compare(table, source, target) {
  const n = source.rows.length;
  if (target.denied) {
    if (n > 0) throw new Stop(`${table.name}: ${n} rows here, but the new project gives this key no table access`);
    return { old: 0, new: 'no table access', match: 'empty, RPCs only' };
  }
  const match = digest(source.rows, table.omit) === digest(target.rows, table.omit);
  return { old: n, new: target.rows.length, match: match ? 'yes' : 'NO' };
}

export async function copy(oldDb, newDb) {
  const state = await heldState();
  if (!state.held) throw new Stop(`the live Worker is not held (answered ${state.status}) — nothing copied`);
  const report = [];
  for (const table of TABLES) {
    const source = await readAll(oldDb, table);
    if (source.denied) throw new Stop(`${table.name}: the shared project's key has no table access`);
    let target = await readAll(newDb, table);
    if (!target.denied && target.rows.length === 0 && source.rows.length > 0) {
      await insertAll(newDb, table, source.rows);
      target = await readAll(newDb, table);
    }
    const line = { table: table.name, ...compare(table, source, target) };
    report.push(line);
    if (line.match === 'NO') {
      printReport(report);
      throw new Stop(`${table.name}: the two sides differ — stopped here`);
    }
  }
  return report;
}

export async function verify(oldDb, newDb) {
  const report = [];
  for (const table of TABLES) {
    const source = await readAll(oldDb, table);
    if (source.denied) throw new Stop(`${table.name}: the shared project's key has no table access`);
    report.push({ table: table.name, ...compare(table, source, await readAll(newDb, table)) });
  }
  return report;
}

/** Sends the Worker's own spend INSERT for a serial already spent; must answer 409. */
export async function refusal(oldDb, newDb) {
  const url = `${urlFor(oldDb.ref)}/rest/v1/spent_tokens?select=serial&order=melted_at.asc&limit=1`;
  const res = await fetch(url, { headers: oldDb.headers });
  if (!res.ok) throw new Stop(`spent_tokens: read answered ${res.status}`);
  const [row] = await res.json();
  if (!row) throw new Stop('spent_tokens: no serial to test with');
  const attempt = await fetch(`${urlFor(newDb.ref)}/rest/v1/spent_tokens`, {
    method: 'POST',
    headers: { ...newDb.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ serial: row.serial }),
  });
  await attempt.text();
  return attempt.status;
}

function printReport(report) {
  for (const r of report) console.log(`${r.table.padEnd(24)} old ${String(r.old).padStart(5)}  new ${String(r.new).padStart(5)}  match: ${r.match}`);
}

async function main() {
  const mode = process.argv[2];
  const newRef = process.argv.find((a) => a.startsWith('--new='))?.slice(6);
  const needNew = () => {
    if (!/^[a-z0-9]{20}$/.test(newRef ?? '')) throw new Stop('give the new project as --new=<20-character ref>');
    if (newRef === OLD_REF || newRef === SANDBOX_REF) throw new Stop('--new must be Share\'s new project, not the shared project or the sandbox');
    return newRef;
  };
  if (['headers', 'copy', 'verify', 'refusal'].includes(mode)) needNew();
  const oldDb = () => connect(OLD_REF, process.env.OLD_KEY, 'shared project');
  const newDb = () => connect(needNew(), process.env.NEW_KEY, 'new project');

  if (mode === 'held') {
    const s = await heldState();
    console.log(`live Worker answered ${s.status}: ${s.held ? 'HELD, Supabase calls fail' : s.live ? 'LIVE, Supabase calls work' : 'unexpected'}`);
  } else if (mode === 'rehearse') {
    const db = await oldDb();
    let total = 0;
    for (const table of TABLES) {
      const r = await readAll(db, table);
      if (r.denied) throw new Stop(`${table.name}: the key has no table access`);
      total += r.rows.length;
      console.log(`${table.name.padEnd(24)} ${String(r.rows.length).padStart(5)}`);
    }
    console.log(`${'total'.padEnd(24)} ${String(total).padStart(5)}`);
  } else if (mode === 'headers') {
    for (const db of [await oldDb(), await newDb()]) {
      console.log(`${db.ref === OLD_REF ? 'shared project' : 'new project'}: ${db.tried.join(', ')} → uses ${db.form}`);
    }
  } else if (mode === 'copy' || mode === 'verify') {
    const [o, n] = [await oldDb(), await newDb()];
    const report = mode === 'copy' ? await copy(o, n) : await verify(o, n);
    printReport(report);
    const bad = report.filter((r) => r.match === 'NO');
    if (bad.length) throw new Stop(`${bad.length} table(s) differ`);
    console.log('every table matches');
  } else if (mode === 'refusal') {
    const status = await refusal(await oldDb(), await newDb());
    if (status !== 409) throw new Stop(`a spent serial answered ${status}, not 409 — tell Claude before reopening`);
    console.log('a serial spent on the shared project answered 409 on the new one: refused');
  } else {
    throw new Stop('modes: held, rehearse, headers, copy, verify, refusal');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e instanceof Stop ? `STOP: ${e.message}` : `STOP: ${e?.name ?? 'error'}, no details printed`);
    process.exit(1);
  });
}
