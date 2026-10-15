#!/usr/bin/env node
// bin/route-inventory.mjs — Vuln-Watch-1 · 15 Oct 2026.
//
// Lists every route the Worker answers (method + path) by reading the router source,
// and checks docs/ROUTES.md has exactly one row for each, with a known gate.
// CI fails on: a route with no row, a row with no route, an unknown gate, an /admin
// path not gated by the admin key, or a path check in the router this script can't read
// (a new route shape — teach it here rather than let a route slip past).
//
//   node bin/route-inventory.mjs           print the routes found
//   node bin/route-inventory.mjs --check   compare with docs/ROUTES.md (CI)
//
// Reads: worker/src/index.js (the fetch() router only) + worker/src/handlers/auth.js (routeAuth).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC  = join(ROOT, 'docs/ROUTES.md');
const BEGIN = '<!-- routes:begin -->';
const END   = '<!-- routes:end -->';

// Gate vocabulary — explained in docs/ROUTES.md. Add a gate here and there together.
const GATES = new Set([
  'public', 'turnstile', 'credential', 'upload-session', 'link', 'password', 'link-or-owner',
  'hmac', 'hmac-sandbox', 'admin', 'magic-link', 'session', 'stripe-sig', 'gone', 'cf-challenge',
]);
const ADMIN_PATH = /^\/(api\/v1\/)?admin\//;

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// Readable path from a router regex: ^\/upload\/([0-9a-f-]{36})\/initiate$ → /upload/{uuid}/initiate
function readable(re) {
  return re.replace(/^\^/, '').replace(/\$$/, '')
    .replace(/\(\[0-9a-f-\]\{36\}\)/g, '{uuid}')
    .replace(/\(\\d\{4\}\)/g, '{part}')
    .replace(/\(\[A-Za-z0-9_-\]\+\)/g, '{id}')
    .replace(/\(([a-z]+(?:\|[a-z]+)+)\)/g, '{$1}')
    .replace(/\\\//g, '/');
}

function routes() {
  const found = [];
  const add = (method, path, where) => found.push({ method, path, where });

  // ── index.js fetch() router ────────────────────────────────────────────
  const idx = readFileSync(join(ROOT, 'worker/src/index.js'), 'utf8').split('\n');
  const a = idx.findIndex((l) => /^\s*async fetch\(request, env, ctx\)/.test(l));
  const b = idx.findIndex((l) => /^\s*async scheduled\(/.test(l));
  if (a < 0 || b < a) die('index.js: cannot find the fetch() router (async fetch … async scheduled)');
  const matchVars = new Map();   // xMatch → readable path

  for (let i = a; i < b; i++) {
    const line = idx[i].replace(/\/\/.*$/, (c) => (c.includes("'") ? c : '')); // drop plain comments
    const at = `index.js:${i + 1}`;
    let used = 0;

    // const fooMatch = path.match(/…/);
    for (const m of line.matchAll(/const (\w+)\s*=\s*path\.match\(\/(.+)\/i?\);/g)) {
      matchVars.set(m[1], readable(m[2])); used++;
    }
    // request.method === 'GET' && fooMatch
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*(\w+Match)\b/g)) {
      if (!matchVars.has(m[2])) die(`${at}: ${m[2]} used before its path.match`);
      add(m[1], matchVars.get(m[2]), at);
    }
    // request.method === 'GET' && path === '/x'   (several per line allowed)
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*path\s*===\s*'([^']+)'/g)) {
      add(m[1], m[2], at); used++;
    }
    // path === '/x' && ['POST', 'GET'].includes(request.method)
    for (const m of line.matchAll(/path\s*===\s*'([^']+)'\s*&&\s*\[([^\]]+)\]\.includes\(request\.method\)/g)) {
      for (const meth of m[2].match(/'(\w+)'/g)) add(meth.slice(1, -1), m[1], at);
      used++;
    }
    // path === '/x' && (request.method === 'GET' || request.method === 'POST')
    for (const m of line.matchAll(/path\s*===\s*'([^']+)'\s*&&\s*\(((?:\s*request\.method\s*===\s*'\w+'\s*\|*)+)\)/g)) {
      for (const meth of m[2].match(/'(\w+)'/g)) add(meth.slice(1, -1), m[1], at);
      used++;
    }
    // request.method === 'GET' && path.startsWith('/prefix/')
    for (const m of line.matchAll(/request\.method\s*===\s*'(\w+)'\s*&&\s*path\.startsWith\('([^']+)'\)/g)) {
      add(m[1], `${m[2]}*`, at); used++;
    }

    // Safety net: every path test in the router must have been read above.
    const tests = (line.match(/path\s*===|path\.match\(|path\.startsWith\(|path\.endsWith\(|path\.includes\(/g) ?? []).length;
    if (tests > used) die(`${at}: path check this script can't read — add its shape to bin/route-inventory.mjs\n    ${idx[i].trim()}`);
  }

  // ── handlers/auth.js routeAuth() ───────────────────────────────────────
  const auth = readFileSync(join(ROOT, 'worker/src/handlers/auth.js'), 'utf8');
  const r0 = auth.indexOf('export async function routeAuth(');
  if (r0 < 0) die('auth.js: cannot find routeAuth');
  const body = auth.slice(r0, auth.indexOf('\n}', r0));
  for (const m of body.matchAll(/m\s*===\s*'(\w+)'\s*&&\s*pathname\s*===\s*'([^']+)'/g)) add(m[1], m[2], 'auth.js routeAuth');
  const authTests = (body.match(/pathname\s*===|pathname\.match|pathname\.startsWith/g) ?? []).length;
  const authRead  = [...body.matchAll(/m\s*===\s*'(\w+)'\s*&&\s*pathname\s*===/g)].length;
  if (authTests > authRead) die('auth.js routeAuth: path check this script can\'t read');

  const keys = new Set();
  for (const r of found) {
    const k = `${r.method} ${r.path}`;
    if (keys.has(k)) die(`duplicate route ${k} (${r.where})`);
    keys.add(k);
  }
  return found;
}

function docRows() {
  const text = readFileSync(DOC, 'utf8');
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < a) die(`${DOC}: missing ${BEGIN} / ${END}`);
  const rows = new Map();
  for (const line of text.slice(a + BEGIN.length, b).split('\n')) {
    if (!line.startsWith('|') || /^\|\s*-/.test(line) || /^\|\s*Method\s*\|/.test(line)) continue;
    // split on unescaped pipes; a path's own `|` is written \| in Markdown
    const c = line.split(/(?<!\\)\|/).slice(1, -1).map((s) => s.trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|'));
    if (c.length < 3) die(`ROUTES.md row too short: ${line}`);
    const [method, path, gate] = c;
    const k = `${method} ${path}`;
    if (rows.has(k)) die(`ROUTES.md lists ${k} twice`);
    rows.set(k, { method, path, gate });
  }
  return rows;
}

const list = routes();
if (!process.argv.includes('--check')) {
  for (const r of list) console.log(`${r.method.padEnd(7)} ${r.path.padEnd(48)} ${r.where}`);
  console.log(`${list.length} routes`);
  process.exit(0);
}

const rows = docRows();
const problems = [];
for (const r of list) {
  const row = rows.get(`${r.method} ${r.path}`);
  if (!row) { problems.push(`route with no row in docs/ROUTES.md: ${r.method} ${r.path}  (${r.where})`); continue; }
  if (!GATES.has(row.gate)) problems.push(`unknown gate "${row.gate}" for ${r.method} ${r.path}`);
  if (ADMIN_PATH.test(r.path) && row.gate !== 'admin') problems.push(`${r.method} ${r.path} is an admin path but its gate is "${row.gate}"`);
}
const live = new Set(list.map((r) => `${r.method} ${r.path}`));
for (const k of rows.keys()) if (!live.has(k)) problems.push(`row with no route (stale?): ${k}`);

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  die(`${problems.length} route inventory problem(s) — update docs/ROUTES.md`);
}
console.log(`✓ route inventory: ${list.length} routes, each with one row and a known gate`);
