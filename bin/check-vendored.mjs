#!/usr/bin/env node
// bin/check-vendored.mjs — Vuln-Watch-1 · 15 Oct 2026.
//
// Vendored code (bytes copied into the repo, not installed from a lockfile) is invisible
// to npm audit and Dependabot. frontend/VENDORED.md lists each piece; this script:
//   1. checks every row's SHA-256 still matches the bytes in git (file, or tree hash for a dir)
//   2. asks OSV (api.osv.dev) about each row's package + version, plus every non-dev package
//      in the row's lockfile; fails on HIGH / CRITICAL, or on an advisory with no severity
//      (read it, then decide — fail closed)
//
//   node bin/check-vendored.mjs               full check (CI)
//   node bin/check-vendored.mjs --offline     hashes only
//   node bin/check-vendored.mjs --update P    rewrite row P's SHA-256 (bin/vendor-cashu.sh)
//
// Tree hash for a directory row = what this prints, run from inside the directory:
//   git ls-files | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256
// Tracked files only, so a stray .DS_Store never changes it.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC  = join(ROOT, 'frontend/VENDORED.md');
const BEGIN = '<!-- vendored:begin -->';
const END   = '<!-- vendored:end -->';
const BLOCKING = new Set(['HIGH', 'CRITICAL']);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

function readRows() {
  const text = readFileSync(DOC, 'utf8');
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) die(`${DOC}: missing ${BEGIN} / ${END}`);
  const rows = [];
  for (const line of text.slice(a + BEGIN.length, b).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || /^\|\s*Path\s*\|/.test(line)) continue;
    const c = line.split('|').slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, ''));
    if (c.length !== 8) die(`VENDORED.md row has ${c.length} columns, expected 8: ${line}`);
    const [path, kind, pkg, eco, version, hash, lock] = c;
    rows.push({ path, kind, pkg, eco, version, hash, lock: lock === '—' ? null : lock, line });
  }
  if (!rows.length) die('VENDORED.md lists no rows');
  return { text, rows };
}

function hashOf(row) {
  const abs = join(ROOT, row.path);
  if (row.kind === 'file') return sha256(readFileSync(abs));
  if (row.kind !== 'dir') die(`${row.path}: kind must be file or dir, not "${row.kind}"`);
  const files = execFileSync('git', ['ls-files'], { cwd: abs, encoding: 'utf8' })
    .split('\n').filter(Boolean).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  if (!files.length) die(`${row.path}: no tracked files`);
  return sha256(files.map((f) => `${sha256(readFileSync(join(abs, f)))}  ${f}\n`).join(''));
}

function checkHashes(rows) {
  let bad = 0;
  for (const r of rows) {
    const got = hashOf(r);
    if (got === r.hash) console.log(`  ✓ ${r.path}  ${r.pkg} ${r.version}`);
    else { bad++; console.error(`  ✗ ${r.path}: sha256 ${got}, VENDORED.md says ${r.hash}`); }
  }
  if (bad) die(`${bad} vendored file(s) changed without a VENDORED.md update — rebuild from source, then update the row`);
}

function queries(rows) {
  const seen = new Map();
  const add = (eco, name, version, from) => {
    const k = `${eco}:${name}@${version}`;
    if (!seen.has(k)) seen.set(k, { package: { ecosystem: eco, name }, version, from });
  };
  for (const r of rows) {
    add(r.eco, r.pkg, r.version, r.path);
    if (!r.lock) continue;
    if (r.lock.endsWith('package-lock.json')) {
      const pk = JSON.parse(readFileSync(join(ROOT, r.lock), 'utf8')).packages;
      for (const [k, v] of Object.entries(pk)) {
        if (k && !v.dev) add('npm', k.replace(/.*node_modules\//, ''), v.version, r.lock);
      }
    } else if (r.lock.endsWith('Cargo.lock')) {
      const lock = readFileSync(join(ROOT, r.lock), 'utf8');
      for (const m of lock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"\nsource = "registry/g)) {
        add('crates.io', m[1], m[2], r.lock);
      }
    } else die(`${r.path}: unknown lockfile type ${r.lock}`);
  }
  return [...seen.values()];
}

async function osv(qs) {
  const res = await fetch('https://api.osv.dev/v1/querybatch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: qs.map(({ package: p, version }) => ({ package: p, version })) }),
  });
  if (!res.ok) die(`OSV querybatch HTTP ${res.status} — cannot confirm vendored code is clean`);
  const { results } = await res.json();
  let blocking = 0;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], ids = (results[i]?.vulns ?? []).map((v) => v.id);
    const label = `${q.package.ecosystem}:${q.package.name}@${q.version}`;
    if (!ids.length) { console.log(`  ✓ ${label}`); continue; }
    for (const id of ids) {
      const v = await (await fetch(`https://api.osv.dev/v1/vulns/${id}`)).json();
      if (v.withdrawn) continue;
      const sev = String(v.database_specific?.severity ?? 'UNKNOWN').toUpperCase();
      const block = BLOCKING.has(sev) || sev === 'UNKNOWN';
      if (block) blocking++;
      console[block ? 'error' : 'log'](`  ${block ? '✗' : '!'} ${label}  ${id} ${sev}  ${(v.summary ?? '').slice(0, 90)}  (from ${q.from})`);
    }
  }
  if (blocking) die(`${blocking} high/critical (or unrated) advisory(ies) in vendored code — record in refueler-share-private, then fix`);
}

const args = process.argv.slice(2);
const { text, rows } = readRows();

if (args[0] === '--update') {
  const r = rows.find((x) => x.path === args[1]);
  if (!r) die(`no VENDORED.md row for ${args[1]}`);
  const h = hashOf(r);
  writeFileSync(DOC, text.replace(r.line, r.line.replace(r.hash, h)));
  console.log(`  ✓ VENDORED.md ${r.path} sha256 → ${h}`);
  process.exit(0);
}

console.log('Vendored code — hashes');
checkHashes(rows);
if (args.includes('--offline')) process.exit(0);
console.log('Vendored code — OSV advisories');
await osv(queries(rows));
console.log('✓ vendored code: hashes match, no high/critical advisories');
