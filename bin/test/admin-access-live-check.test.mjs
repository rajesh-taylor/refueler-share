// bin/admin-access-live-check.mjs — its reading of docs/ROUTES.md (Admin-Access-1b · 31 Oct 2026).
// S-1 must ask about every admin route on the public host, each as a path that can be sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminRequests, concrete, ADMIN_PATH } from '../admin-access-live-check.mjs';
import { readDocRows } from '../lib/route-inventory-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = readFileSync(join(ROOT, 'docs/ROUTES.md'), 'utf8');

test('S-1 covers every Host admin row, once each', () => {
  const rows = [...readDocRows(doc).values()].filter((r) => r.host === 'admin');
  const reqs = adminRequests(doc);
  assert.equal(reqs.length, rows.length);
  assert.ok(reqs.length >= 40);
  assert.equal(new Set(reqs.map(([m, p]) => `${m} ${p}`)).size, reqs.length);
});

test('every S-1 path is concrete and an admin path; methods are real', () => {
  for (const [method, path] of adminRequests(doc)) {
    assert.ok(!/[{}*|]/.test(path), path);
    assert.match(path, ADMIN_PATH, path);
    assert.ok(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method), `${method} ${path}`);
  }
});

test('no Host api row is asked about', () => {
  const sent = new Set(adminRequests(doc).map(([m, p]) => `${m} ${p}`));
  for (const r of readDocRows(doc).values()) if (r.host === 'api') assert.ok(!sent.has(`${r.method} ${concrete(r.path)}`), r.path);
});

test('concrete(): placeholders become sendable segments', () => {
  assert.equal(concrete('/admin/news-events/{id}'), '/admin/news-events/x');
  assert.equal(concrete('/admin/{a|b}/x'), '/admin/a/x');
  assert.equal(concrete('/admin/files/*'), '/admin/files/x');
});

test('the script never prints or writes the key or token', () => {
  const src = readFileSync(join(ROOT, 'bin/admin-access-live-check.mjs'), 'utf8');
  for (const line of src.split('\n').filter((l) => /say\(|check\(|console\.log|writeFileSync/.test(l))) {
    assert.ok(!/\$\{(KEY|token)\}/.test(line) && !/[(,]\s*(KEY|token)\s*[,)]/.test(line), line.trim());
  }
});
