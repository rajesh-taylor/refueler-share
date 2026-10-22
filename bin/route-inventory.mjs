#!/usr/bin/env node
// bin/route-inventory.mjs — Vuln-Watch-1 · 15 Oct 2026.
//
// Lists every route the Worker answers (method + path) by reading the router source,
// and checks docs/ROUTES.md has exactly one row for each, with a known gate.
// CI fails on: a route with no row, a row with no route, an unknown gate, an /admin
// path not gated by the admin key (or `staff` on /admin/reports/*, OSA-Tools-1),
// a {uuid} in a route path (UUID-Out-Of-Path-1), or a path check in the router this
// script can't read (a new route shape — teach it rather than let a route slip past).
//
//   node bin/route-inventory.mjs           print the routes found
//   node bin/route-inventory.mjs --check   compare with docs/ROUTES.md (CI)
//
// Reads: worker/src/index.js (the fetch() router only) + worker/src/handlers/auth.js (routeAuth).
// The parser lives in bin/lib/route-inventory-lib.mjs (shared with worker/test/osa_tools_1.test.js).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoutes, readDocRows, inventoryProblems } from './lib/route-inventory-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

let list, rows;
try {
  list = readRoutes(read('worker/src/index.js'), read('worker/src/handlers/auth.js'));
  if (process.argv.includes('--check')) rows = readDocRows(read('docs/ROUTES.md'));
} catch (e) {
  die(e.message);
}

if (!rows) {
  for (const r of list) console.log(`${r.method.padEnd(7)} ${r.path.padEnd(48)} ${r.where}`);
  console.log(`${list.length} routes`);
  process.exit(0);
}

const problems = inventoryProblems(list, rows);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  die(`${problems.length} route inventory problem(s) — update docs/ROUTES.md`);
}
console.log(`✓ route inventory: ${list.length} routes, each with one row and a known gate`);
