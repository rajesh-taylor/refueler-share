// bin/test/check-no-uuid-path.test.mjs — UUID-Out-Of-Path-1 · 21 Oct 2026.
// bin/check-no-uuid-path.mjs refuses a transfer UUID in an API path and passes the
// header form. Run: node --test bin/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-no-uuid-path.mjs');

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'uuid-path-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [SCRIPT, '--only', dir], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('refuses each way of putting a UUID in a path', () => {
  for (const bad of [
    'fetch(`${WORKER_URL}/meta/${uuid}`);',
    'fetch(`${B}/download/${uuid}/${part}`);',
    'fetch(`${B}/upload/${job.uuid}/finalise`, {});',
    "fetch('https://api.share.refueler.io/meta/' + q[1]);",
    'signed("GET", `/api/v1/receipt/${uuid}/acceptance`, c);',
    "const u = '/transfer/0f8fad5b-d9cb-469f-a165-70867728950e';",
  ]) {
    const r = run({ 'a.js': bad });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /a\.js:1/);
  }
  assert.equal(run({ 's.sh': "curl \"$WORKER/meta/$FAKE_UUID\"\n" }).status, 1);
});

test('passes the header form, comments and GitHub release URLs', () => {
  const r = run({
    'ok.js': [
      "fetch(`${WORKER_URL}/meta`, { headers: { 'X-Transfer-UUID': uuid } });",
      "fetch(`${WORKER_URL}/download`, { headers: { 'X-Transfer-UUID': uuid, 'X-Part': padded } });",
      '// was: GET /meta/${uuid}',
      '/* POST /upload/${uuid}/initiate */',
      'const sums = `${gh}/releases/download/app-${sha}/SHA256SUMS`;',
      'const key = `${uuid}/manifest.json`;',
    ].join('\n'),
  });
  assert.equal(r.status, 0, r.stderr);
});
