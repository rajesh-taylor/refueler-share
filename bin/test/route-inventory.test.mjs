// bin/test/route-inventory.test.mjs — H6a · Admin-Access-1a · 30 Oct 2026.
// bin/lib/route-inventory-lib.mjs: the Host column rules, the gate rules beside them,
// and the real docs/ROUTES.md passing. Run: node --test bin/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoutes, readDocRows, inventoryProblems, ADMIN_PATH } from '../lib/route-inventory-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const doc = (rows) => [
  '<!-- routes:begin -->',
  '| Method | Path | Gate | Host | Rate limit | Handler |',
  '|---|---|---|---|---|---|',
  ...rows.map(([m, p, g, h]) => `| ${m} | \`${p}\` | ${g} | ${h} | — | \`x\` |`),
  '<!-- routes:end -->',
].join('\n');
const problems = (rows) => inventoryProblems(rows.map(([method, path]) => ({ method, path, where: 't' })), readDocRows(doc(rows)));

test('the real docs/ROUTES.md passes, every admin path on host admin', () => {
  const list = readRoutes(read('worker/src/index.js'), read('worker/src/handlers/auth.js'));
  const rows = readDocRows(read('docs/ROUTES.md'));
  assert.deepEqual(inventoryProblems(list, rows), []);
  for (const r of rows.values()) assert.equal(r.host === 'admin', ADMIN_PATH.test(r.path), `${r.method} ${r.path}`);
});

test('good rows → no problems', () => {
  assert.deepEqual(problems([
    ['GET', '/status', 'public', 'api'],
    ['GET', '/admin/status', 'admin', 'admin'],
    ['POST', '/api/v1/admin/sandbox/reset', 'admin', 'admin'],
    ['GET', '/admin/reports/whoami', 'staff', 'admin'],
    ['DELETE', '/transfer', 'link-or-owner', 'api'],
  ]), []);
});

test('an admin or staff gate off host admin → refused', () => {
  assert.match(problems([['POST', '/api/v1/sandbox/activate', 'admin', 'api']]).join('\n'), /gate "admin" must be on host "admin"/);
  assert.match(problems([['GET', '/admin/reports/whoami', 'staff', 'api']]).join('\n'), /gate "staff" must be on host "admin"/);
});

test('host admin on a path outside /admin → refused', () => {
  assert.match(problems([['GET', '/status', 'public', 'admin']]).join('\n'), /host "admin" is only for \/admin/);
  assert.match(problems([['POST', '/api/v1/sandbox/activate', 'admin', 'admin']]).join('\n'), /host "admin" is only for \/admin/);
});

test('an admin path on host api → refused, including bare /admin', () => {
  assert.match(problems([['GET', '/admin/metrics', 'admin', 'api']]).join('\n'), /admin path but its host is "api"/);
  assert.match(problems([['GET', '/admin', 'admin', 'api']]).join('\n'), /admin path but its host is "api"/);
  assert.match(problems([['GET', '/api/v1/admin', 'admin', 'api']]).join('\n'), /admin path but its host is "api"/);
});

test('a host cell that is not api or admin → refused', () => {
  for (const h of ['Admin', 'API', 'both', '-', 'admin.share.refueler.io']) {
    assert.match(problems([['GET', '/status', 'public', h]]).join('\n'), /unknown host/, h);
  }
});

test('a row without a Host cell → parse error', () => {
  const short = ['<!-- routes:begin -->', '| GET | `/status` | public |', '<!-- routes:end -->'].join('\n');
  assert.throws(() => readDocRows(short), /row too short/);
});

test('ADMIN_PATH: /admin and /api/v1/admin with or without a tail; nothing that only starts alike', () => {
  for (const p of ['/admin', '/admin/', '/admin/x', '/api/v1/admin', '/api/v1/admin/sandbox/reset']) assert.ok(ADMIN_PATH.test(p), p);
  for (const p of ['/administrator', '/adminx/y', '/api/v1/administer', '/x/admin/y', '/status', '/api/v1/sandbox/reset']) assert.ok(!ADMIN_PATH.test(p), p);
});
