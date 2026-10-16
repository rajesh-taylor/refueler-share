// bin/test/release-manifest.test.mjs — known-answer tests for bin/lib/release-manifest.mjs.
// Share-Release-1a · 17 Oct 2026. Run: node --test bin/test/*.test.mjs
// Every expected hash below was computed outside this code (shasum -a 256, openssl dgst -sha256
// -binary | base64url) over the fixture bytes and the expected file texts written out by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  generate, compareSums, hexToB64url, cspOf, byteOrder, listFiles, hashServed,
} from '../lib/release-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'lib', 'release-manifest.mjs');
const SATOSHI = 'e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f';
const COMMIT = 'abcdef0123444444444444444444444444444444';
const CSP = "default-src 'none'; script-src 'self'\n";

function fixture({ satoshi = Buffer.alloc(0) } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'rm-test-'));
  const put = (p, data) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), data); };
  put('index.html', '<p>index</p>\n');
  put('404.html', '<p>404</p>\n');
  put('_headers', '/*\n');
  put('v/abcdef0123/share.js', 'export {};\n');
  put('v/abcdef0123/Z.css', 'a{}\n');
  put('v/abcdef0123/blake3/x.wasm', Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  put('v/abcdef0123/fonts/Satoshi-Variable.woff2', satoshi);
  put('v/abcdef0123/.DS_Store', 'litter');
  return d;
}
const run = (dist, extra = {}) => generate({
  dist, commit: COMMIT, prev: '0123456789', csp: CSP, satoshiSha: SATOSHI,
  nvmrc: '22\n', eleventy: '3.1.6', standin: true, ...extra,
});

const EXPECTED_EXTRA = `{
  "schema": "refueler.share.release-extra.v1",
  "release": "abcdef0123",
  "commit": "abcdef0123444444444444444444444444444444",
  "previous_release": "0123456789",
  "webcat_spec": "03118ef94e149bf30a6edd7dccdffe70ce581177",
  "webcat_cli": "0.1.2",
  "build": {
    "nvmrc": "22",
    "eleventy": "3.1.6"
  },
  "not_rebuilt_by_ci": [
    {
      "path": "/v/abcdef0123/fonts/Satoshi-Variable.woff2",
      "sha256": "e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f",
      "why": "Licence forbids redistribution; official Fontshare file, unmodified"
    }
  ],
  "third_party_code": [
    "https://challenges.cloudflare.com (Cloudflare Turnstile) — not ours, not covered"
  ],
  "cashu_keysets": [],
  "nostr_relays": [],
  "apk": null
}
`;

const EXPECTED_MANIFEST = `{
  "manifest": {
    "app": "https://github.com/rajesh-taylor/refueler-share",
    "version": "app-abcdef0123",
    "default_csp": "default-src 'none'; script-src 'self'",
    "files": {
      "/404.html": "85QPn1wgTtun-NsRNp9C3jB2d9Gbi6hQVbqvrJIMPN4",
      "/index.html": "dJflnpLvZ5W4bfv_fL5_YJPNuiR9-MGS41tDCueBPv0",
      "/release-extra.json": "e48y89PVjub4ewoR0IE2_2pkOaRJx98Mk4FPau39epU",
      "/v/abcdef0123/Z.css": "u0Jj2e1i7IBkNDEHdGEj6YSZteK6W-q1Sv-Vn8x343I",
      "/v/abcdef0123/fonts/Satoshi-Variable.woff2": "5zmv-bTQLCZDQdbUhy7c2ijnk3Ou2pNvZZVmoc0-tH8",
      "/v/abcdef0123/share.js": "jmCbtxwguFjHfw6fkLsTGduEd7E_n5ZfGh4YUkv1CIE"
    },
    "default_index": "index.html",
    "default_fallback": "/404.html",
    "wasm": [
      "k6RLu5bHUSGOTADUeeTBQ1gSKjiazKFiBbHk0NxflHY"
    ],
    "extra_csp": {}
  }
}`;

const EXPECTED_SUMS = `f3940f9f5c204edba7f8db11369f42de307677d19b8ba85055baafac920c3cde  404.html
7497e59e92ef6795b86dfbff7cbe7f6093cdba247df8c192e35b430ae7813efd  index.html
7b8f32f3d3d58ee6f87b0a11d08136ff6a6439a449c7df0c93814f6aedfd7a95  release-extra.json
071a03a596e4f576ad70a4f36dd09305bb78c23d375a9bf2e7671df3460890d0  release.json
bb4263d9ed62ec8064343107746123e98499b5e2ba5beab54aff959fcc77e372  v/abcdef0123/Z.css
93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476  v/abcdef0123/blake3/x.wasm
e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f  v/abcdef0123/fonts/Satoshi-Variable.woff2
8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881  v/abcdef0123/share.js
`;

test('known answer: release-extra.json, manifest.json and SHA256SUMS bytes', () => {
  const d = fixture();
  try {
    const r = run(d);
    assert.equal(r.extraText, EXPECTED_EXTRA);
    assert.equal(r.manifestText, EXPECTED_MANIFEST);
    assert.equal(r.sumsText, EXPECTED_SUMS);
  } finally { rmSync(d, { recursive: true }); }
});

test('base64url and hex name the same digest; no padding', () => {
  const hex = 'e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f';
  const b = hexToB64url(hex);
  assert.equal(b, '5zmv-bTQLCZDQdbUhy7c2ijnk3Ou2pNvZZVmoc0-tH8');
  assert.equal(Buffer.from(b, 'base64url').toString('hex'), hex);
  assert.ok(!b.includes('=') && !b.includes('+') && !b.includes('/'));
});

test('the manifest never lists itself or _headers; .wasm only in wasm; SHA256SUMS lists both JSON files', () => {
  const d = fixture();
  try {
    const r = run(d);
    const files = Object.keys(JSON.parse(r.manifestText).manifest.files);
    assert.ok(!files.includes('/release.json'));
    assert.ok(!files.includes('/_headers'));
    assert.ok(files.includes('/release-extra.json'));
    assert.ok(!files.some((p) => p.endsWith('.wasm')));
    assert.match(r.sumsText, /  release\.json\n/);
    assert.match(r.sumsText, /  release-extra\.json\n/);
    assert.doesNotMatch(r.sumsText, /_headers|\.DS_Store/);
  } finally { rmSync(d, { recursive: true }); }
});

test('stale release files in dist/ are not hashed into the next listing', () => {
  const d = fixture();
  try {
    writeFileSync(join(d, 'release.json'), 'stale');
    writeFileSync(join(d, 'release-extra.json'), 'stale');
    const r = run(d);
    assert.equal(r.sumsText, EXPECTED_SUMS);
  } finally { rmSync(d, { recursive: true }); }
});

test('Satoshi: the real file is listed with the pin; a modified file throws; an empty stand-in needs --standin', () => {
  const official = fixture();
  try {
    // A file whose hash isn't the pin must never be listed, stand-in or not.
    const bad = fixture({ satoshi: Buffer.from('not the font') });
    try {
      assert.throws(() => run(bad), /not the official Satoshi file/);
      assert.throws(() => run(bad, { standin: false }), /not the official Satoshi file/);
    } finally { rmSync(bad, { recursive: true }); }
    assert.throws(() => run(official, { standin: false }), /not the official Satoshi file/);
    const h = hashServed(official, { satoshiSha: SATOSHI, standin: true });
    assert.equal(h.get('/v/abcdef0123/fonts/Satoshi-Variable.woff2'), SATOSHI);
  } finally { rmSync(official, { recursive: true }); }
});

test('default_csp is app-csp.txt with newlines removed, byte-equal to what ship-app.sh writes to _headers', () => {
  const text = readFileSync(join(ROOT, 'bin', 'lib', 'app-csp.txt'), 'utf8');
  const shell = execFileSync('/bin/sh', ['-c', `tr -d '\\n' < "${join(ROOT, 'bin', 'lib', 'app-csp.txt')}"`], { encoding: 'utf8' });
  assert.equal(cspOf(text), shell);
  const d = fixture();
  try {
    assert.equal(JSON.parse(run(d, { csp: text }).manifestText).manifest.default_csp, shell);
  } finally { rmSync(d, { recursive: true }); }
});

test('key order is fixed (webcat-cli layout) and paths sort by byte, not by locale', () => {
  const d = fixture();
  try {
    const m = JSON.parse(run(d).manifestText).manifest;
    assert.deepEqual(Object.keys(m), ['app', 'version', 'default_csp', 'files', 'default_index', 'default_fallback', 'wasm', 'extra_csp']);
    const paths = Object.keys(m.files);
    assert.deepEqual(paths, [...paths].sort(byteOrder));
    assert.ok(paths.indexOf('/v/abcdef0123/Z.css') < paths.indexOf('/v/abcdef0123/share.js'));
    assert.deepEqual(listFiles(d).slice(0, 2), ['/404.html', '/_headers']);
  } finally { rmSync(d, { recursive: true }); }
});

test('generate is deterministic: two runs give identical bytes', () => {
  const d = fixture();
  try { assert.deepEqual(run(d), run(d)); } finally { rmSync(d, { recursive: true }); }
});

test('missing index.html or 404.html refuses; bad commit refuses', () => {
  const d = fixture();
  try {
    assert.throws(() => run(d, { commit: 'abc' }), /40-hex/);
    rmSync(join(d, '404.html'));
    assert.throws(() => run(d), /404\.html/);
  } finally { rmSync(d, { recursive: true }); }
});

test('compare: identical passes; one changed byte, a missing and an extra file, a wrong Satoshi pin each fail', () => {
  assert.deepEqual(compareSums(EXPECTED_SUMS, EXPECTED_SUMS, SATOSHI), []);
  const changed = EXPECTED_SUMS.replace('8e609bb7', '8e609bb8');
  assert.match(compareSums(EXPECTED_SUMS, changed, SATOSHI).join('\n'), /share\.js: release 8e609bb7.*rebuild 8e609bb8/);
  const missing = EXPECTED_SUMS.split('\n').filter((l) => !l.endsWith('Z.css')).join('\n');
  assert.match(compareSums(EXPECTED_SUMS, missing, SATOSHI).join('\n'), /Z\.css: in the release, not in the rebuild/);
  assert.match(compareSums(missing, EXPECTED_SUMS, SATOSHI).join('\n'), /Z\.css: in the rebuild, not in the release/);
  const wrongPin = EXPECTED_SUMS.replace(SATOSHI, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.match(compareSums(wrongPin, wrongPin, SATOSHI).join('\n'), /not the pinned Satoshi hash/);
});

test('CLI: generate writes dist + release files that match; compare exits 0 and 1', () => {
  const d = fixture();
  const out = mkdtempSync(join(tmpdir(), 'rm-out-'));
  const csp = join(out, 'csp.txt');
  writeFileSync(csp, CSP);
  try {
    execFileSync(process.execPath, [SCRIPT, 'generate', '--dist', d, '--out', out, '--commit', COMMIT, '--prev', '0123456789',
      '--csp', csp, '--satoshi-sha', SATOSHI, '--nvmrc', '22', '--eleventy', '3.1.6', '--standin'], { stdio: 'pipe' });
    assert.equal(readFileSync(join(out, 'manifest.json'), 'utf8'), EXPECTED_MANIFEST);
    assert.equal(readFileSync(join(d, 'release.json'), 'utf8'), EXPECTED_MANIFEST);
    assert.equal(readFileSync(join(out, 'release-extra.json'), 'utf8'), EXPECTED_EXTRA);
    assert.equal(readFileSync(join(d, 'release-extra.json'), 'utf8'), EXPECTED_EXTRA);
    assert.equal(readFileSync(join(out, 'SHA256SUMS'), 'utf8'), EXPECTED_SUMS);
    const sums = join(out, 'SHA256SUMS');
    execFileSync(process.execPath, [SCRIPT, 'compare', '--expected', sums, '--got', sums, '--satoshi-sha', SATOSHI], { stdio: 'pipe' });
    const other = join(out, 'OTHER');
    writeFileSync(other, EXPECTED_SUMS.replace('8e609bb7', '8e609bb8'));
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, 'compare', '--expected', sums, '--got', other, '--satoshi-sha', SATOSHI], { stdio: 'pipe' }),
      (e) => e.status === 1);
  } finally { rmSync(d, { recursive: true }); rmSync(out, { recursive: true }); }
});
