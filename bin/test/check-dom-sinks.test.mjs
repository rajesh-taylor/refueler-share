// bin/test/check-dom-sinks.test.mjs — H8 Trusted-Types-1 · 7 Nov 2026.
// bin/check-dom-sinks.mjs refuses a DOM sink in a release file and passes DOM building and the
// share-dom policy's own lines. Run: node --test bin/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-dom-sinks.mjs');

function run(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dom-sinks-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return spawnSync(process.execPath, [SCRIPT, '--only', dir], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the real sources pass', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('refuses each sink', () => {
  for (const bad of [
    'el.innerHTML = `<b>${name}</b>`;',
    'el.innerHTML += x;',
    'el.outerHTML = s;',
    "el.insertAdjacentHTML('beforeend', s);",
    'document.write(s);',
    'frame.srcdoc = s;',
    'range.createContextualFragment(s);',
    'el.setHTMLUnsafe(s);',
    'new DOMParser().parseFromString(s, "text/html");',
    'eval(s);',
    'const f = new Function("a", s);',
    "setTimeout('go()', 10);",
    'script.src = url;',
    'script.text = code;',
    "el.setAttribute('onclick', s);",
    "el.setAttribute('src', u);",
    'importScripts(u);',
    'new Worker(u);',
    'navigator.serviceWorker.register("/sw.js");',
    "trustedTypes.createPolicy('mine', {});",
  ]) {
    const r = run({ 'a.js': bad });
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /a\.js:1/, bad);
  }
});

test('an exemption is tied to its file', () => {
  // share.js's policy line is allowed in share.js only.
  assert.equal(run({ 'share.js': "s.src = lateScriptURL('qr-creator.min.js');" }).status, 0);
  assert.equal(run({ 'upload.js': "s.src = lateScriptURL('qr-creator.min.js');" }).status, 1);
  assert.equal(run({ 'share.js': 's.src = other;' }).status, 1);
});

test('passes DOM building, reads and comments', () => {
  const r = run({
    'ok.js': [
      "const d = document.createElement('div'); d.textContent = name; box.replaceChildren(d);",
      'if (el.innerHTML === "") {}',
      'const s = img.src;',
      'setTimeout(() => go(), 10);',
      '// el.innerHTML = s;',
      '/* document.write(s) */',
    ].join('\n'),
  });
  assert.equal(r.status, 0, r.stderr);
});
