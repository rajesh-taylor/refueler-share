#!/usr/bin/env node
// bin/verify-live.mjs — does share.refueler.io serve exactly the release published on GitHub?
// Share-Release-1b · 17 Oct 2026 · refueler-share-private plan Share-Release-1 v1 §5 (P5, P6).
// Node 22+, no dependencies beyond this repository. One check, three users: the public watchdog
// (.github/workflows/watchdog.yml, every six hours), anyone from a copy of the repo (/verify/),
// and Rajesh after a ship.
//
//   node bin/verify-live.mjs [--host https://share.refueler.io]
//
// 1  fetch the live page (cache-busted) → the release it loads, from /v/<sha>/share-early.js
// 2  fetch that release's SHA256SUMS + manifest.json from GitHub's public download URLs; none
//    published yet → wait 10 min and try once more (a ship publishes a few minutes after its
//    deploy), then red. The two files must agree with each other.
// 3  fetch every listed path from the host (URL as bin/ship-app.sh url_for), hash, compare
// 4  headers on /, one asset and an unknown path: CSP = the manifest's default_csp, HSTS, no
//    Report-Only, no X-Robots-Tag, no Link, no-transform, not browser-cacheable, a real 404
// 5  the live release is GitHub's latest published release
// Exit 0 = everything matches. Exit 1 = anything else; failed fetches (network, 5xx) are listed
// apart from mismatches, since a re-run usually clears them. Exit 2 = bad arguments.
// The hashes always come from GitHub, never from the host being checked (P5): /release.json on
// the host is checked like any other file, never trusted.
//
// Testing only: --github, --api (stand-in base URLs), --retry-wait <s>, --backoff-ms <ms>.

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSums } from './lib/release-manifest.mjs';

export const DEFAULTS = {
  host: 'https://share.refueler.io',
  repo: 'rajesh-taylor/refueler-share',
  github: 'https://github.com',
  api: 'https://api.github.com',
  retryWait: 600,      // seconds before the one retry when the live release isn't published
  attempts: 3,         // per URL, for network errors and 5xx
  backoffMs: 3000,
  concurrency: 8,
  timeoutMs: 30000,
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const b64urlToHex = (s) => Buffer.from(s, 'base64url').toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Named, so the host's logs and any bot rules can tell this check apart from a browser.
const UA = 'refueler-share-verify-live/1 (+https://github.com/rajesh-taylor/refueler-share/blob/main/bin/verify-live.mjs)';
const bust = () => `v=${Date.now()}${Math.floor(Math.random() * 1e6)}`;

// URL path for a SHA256SUMS path (no leading slash), as Pages serves it — bin/ship-app.sh url_for.
export function urlFor(p) {
  if (p === 'index.html') return '/';
  if (p.endsWith('/index.html')) return `/${p.slice(0, -'index.html'.length)}`;
  if (p.endsWith('.html')) return `/${p.slice(0, -'.html'.length)}`;
  return `/${p}`;
}

// GET with retries on network errors and 5xx. → { status, headers, body } or { error }.
async function get(url, o, init = {}) {
  let last = '';
  for (let i = 1; i <= o.attempts; i++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow', signal: AbortSignal.timeout(o.timeoutMs), ...init,
        headers: { 'user-agent': UA, ...(init.headers || {}) },
      });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.status < 500) return { status: res.status, headers: res.headers, body };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.cause?.code || e.name || String(e);
    }
    if (i < o.attempts) await sleep(o.backoffMs * i);
  }
  return { error: `${last} after ${o.attempts} tries` };
}

// "HTTP 403" plus, when Cloudflare stopped the request, its challenge marker and ray id.
function why(r) {
  const cf = r.headers.get('cf-mitigated'), ray = r.headers.get('cf-ray');
  return `HTTP ${r.status}${cf ? ` (Cloudflare ${cf}: the host challenged this request — a host setting, not a file problem)` : ''}${ray ? ` ray ${ray}` : ''}`;
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i]); }
  }));
}

// The release a Share page's HTML loads (its /v/<sha>/share-early.js), or null. Also used by
// dev/speed/speed.mjs to name the release it measured.
export function releaseFromPage(html) {
  return /src="\/v\/([0-9a-f]{4,40})\/share-early\.js"/.exec(html)?.[1] ?? null;
}

// The release the live page loads, or { error } / { none }.
async function liveRelease(o) {
  const r = await get(`${o.host}/?${bust()}`, o, { cache: 'no-store' });
  if (r.error) return { error: `${o.host}/: ${r.error}` };
  if (r.status !== 200) return { error: `${o.host}/: ${why(r)}` };
  const sha = releaseFromPage(r.body.toString('utf8'));
  return sha ? { sha } : { none: true };
}

// SHA256SUMS + manifest.json for app-<sha>: { sums, manifest } | { missing } | { error }.
async function releaseFiles(o, sha) {
  const base = `${o.github}/${o.repo}/releases/download/app-${sha}`;
  const out = {};
  for (const name of ['SHA256SUMS', 'manifest.json']) {
    const r = await get(`${base}/${name}`, o);
    if (r.error) return { error: `${base}/${name}: ${r.error}` };
    if (r.status === 404) return { missing: true };
    if (r.status !== 200) return { error: `${base}/${name}: HTTP ${r.status}` };
    out[name] = r.body.toString('utf8');
  }
  try {
    return { sums: parseSums(out.SHA256SUMS), manifest: JSON.parse(out['manifest.json']).manifest };
  } catch (e) {
    return { bad: `app-${sha}'s release files can't be read: ${e.message}` };
  }
}

// SHA256SUMS and manifest.json must say the same thing (the manifest omits only itself).
export function crossCheck(sha, sums, manifest) {
  const problems = [];
  if (!manifest || typeof manifest.files !== 'object') return ['manifest.json has no files'];
  if (manifest.version !== `app-${sha}`) problems.push(`manifest.json is version ${manifest.version}, not app-${sha}`);
  if (typeof manifest.default_csp !== 'string' || !manifest.default_csp) problems.push('manifest.json has no default_csp');
  const wasm = new Set((manifest.wasm || []).map(b64urlToHex));
  for (const [p, hex] of sums) {
    if (p === '/release.json') continue;
    const listed = p.toLowerCase().endsWith('.wasm') ? wasm.has(hex) : manifest.files[p] && b64urlToHex(manifest.files[p]) === hex;
    if (!listed) problems.push(`${p}: SHA256SUMS and manifest.json disagree`);
  }
  for (const p of Object.keys(manifest.files)) if (!sums.has(p)) problems.push(`${p}: in manifest.json, not in SHA256SUMS`);
  return problems;
}

function headerProblems(url, r, csp, { notFound }) {
  const p = [];
  const h = (n) => r.headers.get(n);
  if (notFound && r.status !== 404) p.push(`${url}: HTTP ${r.status} for an unknown path (want a real 404)`);
  if (!notFound && r.status !== 200) p.push(`${url}: HTTP ${r.status}`);
  if (h('content-security-policy') !== csp) p.push(`${url}: CSP differs from the release's default_csp (served: ${h('content-security-policy') ?? 'none'})`);
  if (h('content-security-policy-report-only') !== null) p.push(`${url}: a Report-Only CSP is present`);
  if (h('x-robots-tag') !== null) p.push(`${url}: X-Robots-Tag present`);
  if (!/^max-age=31536000\b/.test(h('strict-transport-security') || '')) p.push(`${url}: HSTS (max-age=31536000) missing`);
  if (h('link') !== null) p.push(`${url}: Link header present: ${h('link')}`);
  const cc = (h('cache-control') || '').toLowerCase();
  // Pages answers a 404 with its own "no-store", ignoring _headers (ship-app.sh prove()).
  if (!(notFound && cc === 'no-store') && !cc.includes('no-transform')) p.push(`${url}: no-transform missing (${cc || 'no Cache-Control'})`);
  if (!/max-age=0|no-store|no-cache/.test(cc)) p.push(`${url}: browser-cacheable (${cc || 'no Cache-Control'})`);
  return p;
}

export async function verifyLive(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  o.host = o.host.replace(/\/+$/, '');
  const log = o.log || (() => {});
  const found = { mismatch: [], missing: [], fetch: [], headers: [], release: [] };
  const done = (extra = {}) => ({ ok: Object.values(found).every((a) => a.length === 0), found, ...extra });

  // 1 + 2: the live release and its published files, with one late retry.
  let live, rel;
  for (let attempt = 1; ; attempt++) {
    live = await liveRelease(o);
    if (live.error) { found.fetch.push(live.error); return done(); }
    if (live.none) { found.release.push(`${o.host}/ loads no /v/<sha>/share-early.js — not a Share release page`); return done(); }
    rel = await releaseFiles(o, live.sha);
    if (rel.error) { found.fetch.push(rel.error); return done({ live: live.sha }); }
    if (rel.bad) { found.release.push(rel.bad); return done({ live: live.sha }); }
    if (!rel.missing) break;
    if (attempt === 2) {
      found.release.push(`live release ${live.sha} has no published release app-${live.sha} on GitHub (checked twice, ${o.retryWait}s apart)`);
      return done({ live: live.sha });
    }
    log(`… app-${live.sha} is not published on GitHub yet; trying again in ${o.retryWait}s (a ship publishes after its deploy)`);
    await sleep(o.retryWait * 1000);
  }
  const { sha } = live;
  log(`▶ ${o.host} loads release app-${sha}; ${rel.sums.size} files listed in its SHA256SUMS on GitHub`);
  found.release.push(...crossCheck(sha, rel.sums, rel.manifest));

  // 3: every listed file.
  let same = 0;
  await pool([...rel.sums.keys()], o.concurrency, async (p) => {
    const url = `${o.host}${urlFor(p.slice(1))}`;
    const r = await get(`${url}?${bust()}`, o, { cache: 'no-store' });
    if (r.error) found.fetch.push(`${p.slice(1)}: ${r.error}`);
    else if (r.status === 404) found.missing.push(`${p.slice(1)}: not served (404 at ${url})`);
    else if (r.status !== 200) found.fetch.push(`${p.slice(1)}: ${why(r)} at ${url}`);
    else {
      const got = sha256(r.body), want = rel.sums.get(p);
      if (got === want) same++;
      else found.mismatch.push(`${p.slice(1)}: published ${want}, served ${got}`);
    }
  });
  log(`  ${same} of ${rel.sums.size} files are the same as the release`);

  // 4: headers.
  const csp = rel.manifest?.default_csp;
  for (const [url, notFound] of [[`${o.host}/`, false], [`${o.host}/v/${sha}/share.js`, false],
    [`${o.host}/no-such-page-${Math.floor(Math.random() * 1e9)}`, true]]) {
    const r = await get(`${url}${notFound ? '' : `?${bust()}`}`, o, { cache: 'no-store' });
    if (r.error) found.fetch.push(`${url}: ${r.error}`);
    else found.headers.push(...headerProblems(url, r, csp, { notFound }));
  }

  // 5: the live release is the latest one published.
  const auth = process.env.GITHUB_TOKEN && o.api === DEFAULTS.api ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const lr = await get(`${o.api}/repos/${o.repo}/releases/latest`, o, { headers: { accept: 'application/vnd.github+json', ...auth } });
  let latest = null;
  if (lr.error) found.fetch.push(`latest release: ${lr.error}`);
  else if (lr.status !== 200) found.fetch.push(`latest release: HTTP ${lr.status} from the GitHub API`);
  else {
    latest = JSON.parse(lr.body.toString('utf8')).tag_name;
    if (latest !== `app-${sha}`) found.release.push(`live is app-${sha} but the latest published release is ${latest} (rollback, or a failed deploy?)`);
  }
  return done({ live: sha, latest, files: rel.sums.size, same });
}

function report(r, host) {
  const sections = [
    ['mismatch', 'Served file differs from the release'],
    ['missing', 'Listed in the release, not served'],
    ['release', 'Release'],
    ['headers', 'Headers'],
    ['fetch', 'Could not fetch (network or server error, not a mismatch — run again once)'],
  ];
  for (const [k, title] of sections) {
    if (!r.found[k].length) continue;
    console.error(`\n${title}:`);
    for (const line of r.found[k].sort()) console.error(`  ✗ ${line}`);
  }
  if (r.ok) {
    console.log(`\n✓ ${host} serves release app-${r.live}: all ${r.files} files match its published SHA256SUMS; headers as expected; it is the latest release`);
    return 0;
  }
  const n = (k) => r.found[k].length;
  const mismatches = n('mismatch') + n('missing') + n('release') + n('headers');
  console.error(`\n✗ RED — ${host}${r.live ? ` (release app-${r.live})` : ''}: ${mismatches} mismatch(es), ${n('fetch')} fetch failure(s)`);
  return 1;
}

function parseArgs(argv) {
  const o = {};
  const keys = { '--host': 'host', '--repo': 'repo', '--github': 'github', '--api': 'api', '--retry-wait': 'retryWait', '--backoff-ms': 'backoffMs' };
  for (let i = 0; i < argv.length; i++) {
    const k = keys[argv[i]];
    if (!k || argv[i + 1] === undefined) throw new Error(`unknown or incomplete argument: ${argv[i]}`);
    o[k] = argv[++i];
  }
  for (const k of ['retryWait', 'backoffMs']) {
    if (k in o) { o[k] = Number(o[k]); if (!(o[k] >= 0)) throw new Error(`--${k} must be a number`); }
  }
  for (const k of ['host', 'github', 'api']) {
    if (k in o && !/^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(o[k])) throw new Error(`--${k} must be a URL`);
  }
  if ('repo' in o && !/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new Error('--repo must be owner/name');
  return o;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`✗ ${e.message}\nusage: node bin/verify-live.mjs [--host https://share.refueler.io]`); process.exit(2); }
  const r = await verifyLive({ ...o, log: (s) => console.log(s) });
  process.exitCode = report(r, (o.host || DEFAULTS.host).replace(/\/+$/, ''));
}
