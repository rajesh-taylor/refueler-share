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
    "Cloudflare Turnstile (challenges.cloudflare.com): runs only in the gate page, gate.share.refueler.io, never in Share's own page; its script is Cloudflare's, not ours, not covered. The gate page itself is in this release (gate/ in SHA256SUMS)."
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
      "/release-extra.json": "tbFzFm4DXg5yX0DvUbDnZroFDYAMhBhbGzJU9dy8BeI",
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
b5b173166e035e0e725f40ef51b0e766ba050d800c84185b1b3254f5dcbc05e2  release-extra.json
05d98f708e1cd5fef1eda4a6491b52ecb3e829d373d1e4917f1506e9ffb5c20d  release.json
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

// ── Turnstile-Gate-1: the gate's files in the same release ───────────────────
// Expected hashes computed with shasum -a 256 and openssl dgst -sha256 -binary | base64url over
// the fixture bytes and the hand-written gate manifest below (6 Nov 2026).
const GATE_CSP = "default-src 'none'; frame-ancestors https://share.refueler.io\n";
function gateFixture() {
  const d = mkdtempSync(join(tmpdir(), 'rm-gate-'));
  const put = (p, data) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), data); };
  put('index.html', '<p>gate</p>\n');
  put('404.html', '<p>no</p>\n');
  put('robots.txt', 'User-agent: *\nDisallow: /\n');
  put('_headers', '/*\n');
  put('v/abcdef0123/gate.js', 'export {};\n');
  put('v/abcdef0123/gate.css', 'html{}\n');
  return d;
}
const EXPECTED_GATE_MANIFEST = `{
  "manifest": {
    "app": "https://github.com/rajesh-taylor/refueler-share",
    "version": "app-abcdef0123",
    "default_csp": "default-src 'none'; frame-ancestors https://share.refueler.io",
    "files": {
      "/404.html": "oQewyh9qk04Rd4Z_CCOOs-R-2aW-Nh6umBdw8V3gt_g",
      "/index.html": "ffsX2NB8NHR4LwCn7DEdNBA9XeN4hg_UAEhGBHLVTe8",
      "/robots.txt": "Mx6pCQ2wyfb1l72YQP1bFxgw9uCzuhyyTfqR8Mla7cE",
      "/v/abcdef0123/gate.css": "MjtVaMRZHihDpjGrzJk0YfFD-5Q1O4Ci0wKx6chCh6Y",
      "/v/abcdef0123/gate.js": "jmCbtxwguFjHfw6fkLsTGduEd7E_n5ZfGh4YUkv1CIE"
    },
    "default_index": "index.html",
    "default_fallback": "/404.html",
    "wasm": [],
    "extra_csp": {}
  }
}`;
const EXPECTED_GATE_SUMS = `a107b0ca1f6a934e1177867f08238eb3e47ed9a5be361eae981770f15de0b7f8  gate/404.html
7dfb17d8d07c3474782f00a7ec311d34103d5de378860fd40048460472d54def  gate/index.html
ebf07b7db9d37cfc083981cfcf7e1c9c1a47ea78e340c41ef9b4c981dad3557f  gate/release.json
331ea9090db0c9f6f597bd9840fd5b171830f6e0b3ba1cb24dfa91f0c95aedc1  gate/robots.txt
323b5568c4591e2843a631abcc993461f143fb94353b80a2d302b1e9c84287a6  gate/v/abcdef0123/gate.css
8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881  gate/v/abcdef0123/gate.js
`;

test('known answer: the gate manifest and its gate/ lines in SHA256SUMS', () => {
  const d = fixture(), g = gateFixture();
  try {
    const plain = run(d);
    const r = run(d, { gateDist: g, gateCsp: GATE_CSP });
    assert.equal(r.gateManifestText, EXPECTED_GATE_MANIFEST);
    // The app's own lines are unchanged; the gate's are added with the gate/ prefix.
    const lines = r.sumsText.split('\n').filter(Boolean);
    assert.deepEqual(lines.filter((l) => l.includes('  gate/')), EXPECTED_GATE_SUMS.split('\n').filter(Boolean));
    assert.deepEqual(lines.filter((l) => !l.includes('  gate/')), plain.sumsText.split('\n').filter(Boolean));
    assert.equal(r.manifestText, plain.manifestText, 'the app manifest never lists gate files');
    assert.equal(r.extraText, plain.extraText);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(g, { recursive: true, force: true }); }
});

test('gate: a Satoshi or release-extra file in the gate refuses; --gate-dist without --gate-csp refuses', () => {
  const d = fixture(), g = gateFixture();
  try {
    assert.throws(() => run(d, { gateDist: g }), /gate-csp/);
    writeFileSync(join(g, 'release-extra.json'), '{}');
    assert.throws(() => run(d, { gateDist: g, gateCsp: GATE_CSP }), /release-extra/);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(g, { recursive: true, force: true }); }
});

test('CLI: --gate-dist writes the gate release.json, and SHA256SUMS lists gate/release.json with its hash', () => {
  const d = fixture(), g = gateFixture(), out = mkdtempSync(join(tmpdir(), 'rm-out-'));
  try {
    const csp = join(out, 'app.txt'), gcsp = join(out, 'gate.txt');
    writeFileSync(csp, CSP); writeFileSync(gcsp, GATE_CSP);
    execFileSync('node', [SCRIPT, 'generate', '--dist', d, '--out', join(out, 'rel'), '--commit', COMMIT, '--prev', '0123456789',
      '--csp', csp, '--satoshi-sha', SATOSHI, '--nvmrc', '22', '--eleventy', '3.1.6', '--standin', '--gate-dist', g, '--gate-csp', gcsp]);
    assert.equal(readFileSync(join(g, 'release.json'), 'utf8'), EXPECTED_GATE_MANIFEST);
    assert.match(readFileSync(join(out, 'rel', 'SHA256SUMS'), 'utf8'), /^ebf07b7db9d37cfc083981cfcf7e1c9c1a47ea78e340c41ef9b4c981dad3557f {2}gate\/release\.json$/m);
  } finally { for (const x of [d, g, out]) rmSync(x, { recursive: true, force: true }); }
});
