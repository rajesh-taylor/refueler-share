#!/usr/bin/env node
// bin/lib/release-manifest.mjs — the release files for one deploy of share.refueler.io.
// Share-Release-1a · 17 Oct 2026 · refueler-share-private plan Share-Release-1 v1 §3. Node, no dependencies.
//
//   generate  --dist DIR --out DIR --commit SHA40 [--prev SHA10] --csp FILE --satoshi-sha HEX
//             --nvmrc VALUE --eleventy VERSION [--standin]
//     Writes into DIST (served):   release.json        WEBCAT manifest, unsigned
//                                  release-extra.json  sidecar (commit, previous release, pins, reserved slots)
//     Writes into OUT (the GitHub release's assets):
//                                  manifest.json       = DIST/release.json, byte for byte
//                                  release-extra.json  = DIST/release-extra.json
//                                  SHA256SUMS          every served file, hex, `shasum -a 256 -c` format
//   compare   --expected SHA256SUMS --got SHA256SUMS --satoshi-sha HEX
//     The CI rebuild's check: same paths, same hashes; the expected Satoshi lines equal the pin.
//
// Manifest format: WEBCAT spec manifest.md at freedomofpress/webcat-spec@03118ef (14 Oct 2026),
// laid out as webcat-cli 0.1.2 `manifest generate` writes it unsigned: {"manifest": {app, version,
// default_csp, files, default_index, default_fallback, wasm, extra_csp}}, 2-space JSON, no
// trailing newline; paths "/…"; SHA-256 base64url without padding; .wasm only in `wasm`;
// default_index without its slash. One difference: paths are sorted by byte, not localeCompare
// (locale/ICU-dependent, and different on our file names). Signing canonicalises the JSON, so
// order never matters to WEBCAT; byte order keeps the file the same on every machine.
//
// What is listed: every file Pages serves from DIST. Not listed: _headers (Pages reads it, never
// serves it). release.json can't list itself; it does list release-extra.json. SHA256SUMS (not
// served) lists both. Satoshi (licence: self-host, never redistribute) is always written with the
// pinned hash: the real file must match it; with --standin an empty stand-in (CI) is accepted.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBCAT_SPEC = '03118ef94e149bf30a6edd7dccdffe70ce581177';
export const WEBCAT_CLI = '0.1.2';
export const APP_URL = 'https://github.com/rajesh-taylor/refueler-share';
export const MANIFEST_PATH = '/release.json';
export const EXTRA_PATH = '/release-extra.json';
const NOT_SERVED = new Set(['/_headers']);
const LITTER = new Set(['.DS_Store']);
const SATOSHI_RE = /^\/v\/[0-9a-f]{4,40}\/fonts\/Satoshi-Variable\.woff2$/;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // ASCII paths: code units = bytes
export const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
export const hexToB64url = (hex) => Buffer.from(hex, 'hex').toString('base64url');
export const isSatoshi = (p) => SATOSHI_RE.test(p);
export const cspOf = (text) => text.replace(/\r?\n/g, '');

// Every file under DIR as "/rel/path", byte-sorted; Finder litter and AppleDouble files skipped.
export function listFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (LITTER.has(e.name) || e.name.startsWith('._')) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort(byteOrder);
}

// path → hex for every served file except the two release files themselves.
export function hashServed(dist, { satoshiSha, standin = false }) {
  if (!/^[0-9a-f]{64}$/.test(satoshiSha || '')) throw new Error('satoshi-sha must be 64 hex characters');
  const hashes = new Map();
  for (const p of listFiles(dist)) {
    if (NOT_SERVED.has(p) || p === MANIFEST_PATH || p === EXTRA_PATH) continue;
    const hex = sha256hex(readFileSync(join(dist, p)));
    if (isSatoshi(p)) {
      if (hex !== satoshiSha && !(standin && hex === EMPTY_SHA256)) {
        throw new Error(`${p} is not the official Satoshi file (sha256 ${hex}); the licence forbids modified copies`);
      }
      hashes.set(p, satoshiSha);
    } else {
      hashes.set(p, hex);
    }
  }
  return hashes;
}

export function buildExtra({ commit, prev, nvmrc, eleventy, satoshiSha, paths }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('commit must be a full 40-hex sha');
  if (prev && !/^[0-9a-f]{10}$/.test(prev)) throw new Error('prev must be a 10-hex release name');
  return {
    schema: 'refueler.share.release-extra.v1',
    release: commit.slice(0, 10),
    commit,
    previous_release: prev || null,
    webcat_spec: WEBCAT_SPEC,
    webcat_cli: WEBCAT_CLI,
    build: { nvmrc: String(nvmrc).trim(), eleventy: String(eleventy).trim() },
    not_rebuilt_by_ci: paths.filter(isSatoshi).map((path) => ({
      path,
      sha256: satoshiSha,
      why: 'Licence forbids redistribution; official Fontshare file, unmodified',
    })),
    third_party_code: ['https://challenges.cloudflare.com (Cloudflare Turnstile) — not ours, not covered'],
    cashu_keysets: [],
    nostr_relays: [],
    apk: null,
  };
}

export const serializeExtra = (extra) => JSON.stringify(extra, null, 2) + '\n';

// hashes: path → hex for every file the manifest lists (release-extra.json included).
export function buildManifest({ release, csp, hashes }) {
  const files = {};
  const wasm = new Set();
  for (const p of [...hashes.keys()].sort(byteOrder)) {
    if (p === MANIFEST_PATH || NOT_SERVED.has(p)) continue;
    if (p.toLowerCase().endsWith('.wasm')) wasm.add(hexToB64url(hashes.get(p)));
    else files[p] = hexToB64url(hashes.get(p));
  }
  if (!files['/index.html']) throw new Error('no /index.html to be default_index');
  if (!files['/404.html']) throw new Error('no /404.html to be default_fallback');
  return {
    manifest: {
      app: APP_URL,
      version: `app-${release}`,
      default_csp: cspOf(csp),
      files,
      default_index: 'index.html',
      default_fallback: '/404.html',
      wasm: [...wasm].sort(byteOrder),
      extra_csp: {},
    },
  };
}

export const serializeManifest = (doc) => JSON.stringify(doc, null, 2);

export function buildSums(hashes) {
  return [...hashes.keys()].sort(byteOrder).map((p) => `${hashes.get(p)}  ${p.slice(1)}\n`).join('');
}

export function parseSums(text) {
  const m = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const hit = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (!hit) throw new Error(`not a SHA256SUMS line: ${line}`);
    m.set(`/${hit[2]}`, hit[1]);
  }
  return m;
}

// Returns a list of problems; empty = the rebuild matches the release.
export function compareSums(expectedText, gotText, satoshiSha) {
  const exp = parseSums(expectedText), got = parseSums(gotText), problems = [];
  for (const [p, h] of exp) {
    if (isSatoshi(p) && h !== satoshiSha) problems.push(`${p}: release lists ${h}, not the pinned Satoshi hash ${satoshiSha}`);
    if (!got.has(p)) problems.push(`${p}: in the release, not in the rebuild`);
    else if (got.get(p) !== h) problems.push(`${p}: release ${h}, rebuild ${got.get(p)}`);
  }
  for (const p of got.keys()) if (!exp.has(p)) problems.push(`${p}: in the rebuild, not in the release`);
  return problems;
}

// Everything generate writes, as strings (the tests call this; the CLI writes it out).
export function generate({ dist, commit, prev, csp, satoshiSha, nvmrc, eleventy, standin }) {
  const hashes = hashServed(dist, { satoshiSha, standin });
  const extraText = serializeExtra(buildExtra({ commit, prev, nvmrc, eleventy, satoshiSha, paths: [...hashes.keys()] }));
  hashes.set(EXTRA_PATH, sha256hex(extraText));
  const manifestText = serializeManifest(buildManifest({ release: commit.slice(0, 10), csp, hashes }));
  hashes.set(MANIFEST_PATH, sha256hex(manifestText));
  return { manifestText, extraText, sumsText: buildSums(hashes) };
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    if (a === '--standin') o.standin = true;
    else o[a.slice(2)] = argv[++i] ?? '';
  }
  return o;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const o = args(rest);
  if (cmd === 'generate') {
    for (const k of ['dist', 'out', 'commit', 'csp', 'satoshi-sha', 'nvmrc', 'eleventy']) {
      if (!o[k]) throw new Error(`--${k} is required`);
    }
    for (const p of [MANIFEST_PATH, EXTRA_PATH]) rmSync(join(o.dist, p), { force: true });
    const r = generate({
      dist: o.dist, commit: o.commit, prev: o.prev || '', csp: readFileSync(o.csp, 'utf8'),
      satoshiSha: o['satoshi-sha'], nvmrc: o.nvmrc, eleventy: o.eleventy, standin: !!o.standin,
    });
    writeFileSync(join(o.dist, MANIFEST_PATH), r.manifestText);
    writeFileSync(join(o.dist, EXTRA_PATH), r.extraText);
    mkdirSync(o.out, { recursive: true });
    writeFileSync(join(o.out, 'manifest.json'), r.manifestText);
    writeFileSync(join(o.out, 'release-extra.json'), r.extraText);
    writeFileSync(join(o.out, 'SHA256SUMS'), r.sumsText);
    console.log(`  ✓ release files: ${r.sumsText.split('\n').length - 1} served files listed (manifest.json, release-extra.json, SHA256SUMS)`);
    return 0;
  }
  if (cmd === 'compare') {
    for (const k of ['expected', 'got', 'satoshi-sha']) if (!o[k]) throw new Error(`--${k} is required`);
    if (!existsSync(o.expected)) throw new Error(`no such file: ${o.expected}`);
    const problems = compareSums(readFileSync(o.expected, 'utf8'), readFileSync(o.got, 'utf8'), o['satoshi-sha']);
    if (problems.length) {
      for (const p of problems) console.error(`  ✗ ${p}`);
      console.error(`✗ rebuild differs from the release: ${problems.length} problem(s)`);
      return 1;
    }
    console.log(`✓ rebuild matches the release: ${parseSums(readFileSync(o.got, 'utf8')).size} files (Satoshi lines = pinned hash)`);
    return 0;
  }
  console.error('usage: release-manifest.mjs generate … | compare … (see the header)');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`✗ release-manifest: ${e.message}`); process.exitCode = 2; }
}
