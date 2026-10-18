// bin/test/verify-live.test.mjs — bin/verify-live.mjs against a local Pages-style server and a
// stand-in for GitHub's release downloads + API. Share-Release-1b · 17 Oct 2026.
// Run: node --test bin/test/*.test.mjs

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../lib/release-manifest.mjs';
import { verifyLive, urlFor, crossCheck } from '../verify-live.mjs';
import { pagesHandler, startServer } from './static-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'verify-live.mjs');
const REPO = 'acme/share';
const SATOSHI = 'e739aff9b4d02c264341d6d4872edcda28e79373aeda936f659566a1cd3eb47f';
const CSP = "default-src 'none'; script-src 'self'";
const A = 'aaaaaaaaaa', B = 'bbbbbbbbbb';
const tmp = [], servers = [];
// Servers close here too, so a failed assertion never leaves the test process hanging.
after(async () => {
  for (const s of servers) await s.close();
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

function headers(csp = CSP) {
  return `/*\n  Content-Security-Policy: ${csp}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n  Strict-Transport-Security: max-age=31536000; includeSubDomains\n  Cross-Origin-Resource-Policy: same-origin\n  ! Link\n  X-Content-Type-Options: nosniff\n`;
}

// A deploy of release `sha` + its three release files (as bin/lib/release-manifest.mjs writes them).
function site(sha) {
  const d = mkdtempSync(join(tmpdir(), 'vl-site-'));
  tmp.push(d);
  const put = (p, data) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), data); };
  put('index.html', `<script src="/v/${sha}/share-early.js"></script>\n`);
  put('404.html', '<p>Not found</p>\n');
  put('error.html', '<p>Error</p>\n');
  put('verify/index.html', `<p>release app-${sha}</p>\n`);
  put(`v/${sha}/share-early.js`, '/* early */\n');
  put(`v/${sha}/share.js`, 'export const x = 1;\n');
  put(`v/${sha}/blake3/x.wasm`, Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  put('_headers', headers());
  const r = generate({ dist: d, commit: sha.repeat(4), prev: '', csp: CSP, satoshiSha: SATOSHI, nvmrc: '22', eleventy: '3.1.6' });
  put('release.json', r.manifestText);
  put('release-extra.json', r.extraText);
  return { dist: d, files: { SHA256SUMS: r.sumsText, 'manifest.json': r.manifestText } };
}

// GitHub stand-in: releases[tag] = { name: text }; latest = tag; counts SHA256SUMS requests.
function github(state) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x').pathname;
    let m = /^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(u);
    if (m && m[1] === REPO) {
      if (m[3] === 'SHA256SUMS') state.sumsHits = (state.sumsHits || 0) + 1;
      const body = state.releases[m[2]]?.[m[3]];
      if (body !== undefined) { res.writeHead(200); res.end(body); return; }
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/releases\/latest$/.exec(u);
    if (m && m[1] === REPO) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ tag_name: state.latest })); return; }
    res.writeHead(404); res.end('Not Found');
  };
}

async function setup({ sha = A, tamper, handler } = {}) {
  const s = site(sha);
  tamper?.(s.dist);
  const state = { releases: { [`app-${sha}`]: s.files }, latest: `app-${sha}` };
  const host = await startServer(handler ? handler(pagesHandler(s.dist)) : pagesHandler(s.dist));
  const gh = await startServer(github(state));
  servers.push(host, gh);
  const run = (extra = {}) => verifyLive({ host: host.url, repo: REPO, github: gh.url, api: gh.url, retryWait: 0, backoffMs: 1, ...extra });
  return { s, state, host, gh, run };
}

test('urlFor maps SHA256SUMS paths the way ship-app.sh url_for does', () => {
  assert.equal(urlFor('index.html'), '/');
  assert.equal(urlFor('signin/index.html'), '/signin/');
  assert.equal(urlFor('404.html'), '/404');
  assert.equal(urlFor('release.json'), '/release.json');
  assert.equal(urlFor(`v/${A}/share.js`), `/v/${A}/share.js`);
});

test('everything matches → ok', async () => {
  const t = await setup();
  const r = await t.run();
  assert.deepEqual(r.found, { mismatch: [], missing: [], fetch: [], headers: [], release: [] });
  assert.equal(r.ok, true);
  assert.equal(r.live, A);
  assert.equal(r.files, 9);
  assert.equal(r.same, 9);
});

test('one changed byte → red, naming the file and both hashes', async () => {
  const t = await setup({ tamper: (d) => writeFileSync(join(d, `v/${A}/share.js`), 'export const x = 2;\n') });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.equal(r.found.mismatch.length, 1);
  assert.match(r.found.mismatch[0], new RegExp(`^v/${A}/share\\.js: published [0-9a-f]{64}, served [0-9a-f]{64}$`));
  assert.deepEqual(r.found.fetch, []);
});

test('a listed file not served → red as missing, not as a fetch failure', async () => {
  const t = await setup({ tamper: (d) => rmSync(join(d, 'error.html')) });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.deepEqual(r.found.missing.map((l) => l.split(':')[0]), ['error.html']);
  assert.deepEqual(r.found.fetch, []);
});

test('CSP differs from default_csp → red on every checked URL', async () => {
  const t = await setup({ tamper: (d) => writeFileSync(join(d, '_headers'), headers(`${CSP}; img-src *`)) });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.equal(r.found.headers.filter((l) => l.includes('CSP differs')).length, 3);
  assert.deepEqual(r.found.mismatch, []);
});

test('a Link header or a cacheable response → red', async () => {
  const t = await setup({
    handler: (inner) => (req, res) => { res.setHeader('Link', '</x.js>; rel=preload'); inner(req, res); },
    tamper: (d) => writeFileSync(join(d, '_headers'), headers().replace('max-age=0, must-revalidate, ', 'max-age=3600, ')),
  });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.equal(r.found.headers.filter((l) => l.includes('Link header present')).length, 3);
  assert.ok(r.found.headers.some((l) => l.includes('browser-cacheable')));
});

test('HSTS missing → red on every checked URL', async () => {
  const t = await setup({ tamper: (d) => writeFileSync(join(d, '_headers'), headers().replace(/  Strict-Transport-Security:.*\n/, '')) });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.equal(r.found.headers.filter((l) => l.includes('HSTS')).length, 3);
});

test('CORP missing, or interest-cohort present → red on every checked URL', async () => {
  const t = await setup({ tamper: (d) => writeFileSync(join(d, '_headers'), headers().replace(/  Cross-Origin-Resource-Policy:.*\n/, '  Permissions-Policy: interest-cohort=()\n')) });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.equal(r.found.headers.filter((l) => l.includes('Cross-Origin-Resource-Policy')).length, 3);
  assert.equal(r.found.headers.filter((l) => l.includes('interest-cohort')).length, 3);
});

test('live is behind the latest published release → red', async () => {
  const t = await setup();
  t.state.releases[`app-${B}`] = site(B).files;
  t.state.latest = `app-${B}`;
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.deepEqual(r.found.release, [`live is app-${A} but the latest published release is app-${B} (rollback, or a failed deploy?)`]);
  assert.equal(r.found.mismatch.length + r.found.missing.length + r.found.headers.length, 0);
});

test('no published release for the live sha → one retry, then red', async () => {
  const t = await setup();
  const files = t.state.releases[`app-${A}`];
  delete t.state.releases[`app-${A}`];
  const lines = [];
  const r = await t.run({ log: (s) => lines.push(s) });
  assert.equal(r.ok, false);
  assert.equal(t.state.sumsHits, 2);
  assert.match(r.found.release[0], /no published release app-aaaaaaaaaa on GitHub \(checked twice/);
  assert.ok(lines.some((l) => l.includes('not published on GitHub yet')));

  // published between the two tries (the few minutes between deploy and publish) → green
  t.state.sumsHits = 0;
  const r2 = await t.run({ retryWait: 0.2, log: () => setTimeout(() => { t.state.releases[`app-${A}`] = files; }, 50) });
  assert.equal(r2.ok, true);
  assert.equal(t.state.sumsHits, 2);
});

test('a 503 on one file → reported as a fetch failure, apart from mismatches', async () => {
  const t = await setup({
    handler: (inner) => (req, res) => {
      if (req.url.startsWith(`/v/${A}/blake3/`)) { res.writeHead(503); res.end(); return; }
      inner(req, res);
    },
  });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.deepEqual(r.found.fetch, [`v/${A}/blake3/x.wasm: HTTP 503 after 3 tries`]);
  assert.deepEqual(r.found.mismatch, []);
});

test('SHA256SUMS and manifest.json disagree → red', () => {
  const { files } = site(A);
  const sums = new Map(files.SHA256SUMS.trim().split('\n').map((l) => [`/${l.slice(66)}`, l.slice(0, 64)]));
  const manifest = JSON.parse(files['manifest.json']).manifest;
  assert.deepEqual(crossCheck(A, sums, manifest), []);
  sums.set(`/v/${A}/share.js`, '0'.repeat(64));
  assert.deepEqual(crossCheck(A, sums, manifest), [`/v/${A}/share.js: SHA256SUMS and manifest.json disagree`]);
  assert.deepEqual(crossCheck(B, new Map(), manifest).slice(0, 1), [`manifest.json is version app-${A}, not app-${B}`]);
});

test('a host that is not a Share release page → red', async () => {
  const t = await setup({ tamper: (d) => writeFileSync(join(d, 'index.html'), '<p>hello</p>\n') });
  const r = await t.run();
  assert.equal(r.ok, false);
  assert.match(r.found.release[0], /not a Share release page/);
});

test('CLI: exit 0 on a match, 1 on a changed byte, 2 on a bad argument', async () => {
  const cli = (args) => new Promise((resolve) => execFile(process.execPath, [SCRIPT, ...args], (err, stdout, stderr) =>
    resolve({ code: err ? err.code : 0, stdout, stderr })));
  const t = await setup();
  const args = ['--host', t.host.url, '--repo', REPO, '--github', t.gh.url, '--api', t.gh.url, '--retry-wait', '0', '--backoff-ms', '1'];
  const ok = await cli(args);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /all 9 files match its published SHA256SUMS/);
  writeFileSync(join(t.s.dist, `v/${A}/share-early.js`), '/* changed */\n');
  const red = await cli(args);
  assert.equal(red.code, 1);
  assert.match(red.stderr, /Served file differs from the release:\n {2}✗ v\/aaaaaaaaaa\/share-early\.js: published/);
  assert.match(red.stderr, /✗ RED — .* \(release app-aaaaaaaaaa\): 1 mismatch\(es\), 0 fetch failure\(s\)/);
  assert.equal((await cli(['--host', 'not a url'])).code, 2);
});
