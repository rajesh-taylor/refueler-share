// dev/speed/cache-ab.mjs — what would `Cache-Control: immutable` on /v/<sha>/ save a returning
// visitor? Share-Release-1c · 17 Oct 2026 · plan Share-Release-1 v1 §6 + D2 (held until Block B:
// this only measures; no header change ships).
//
// Serves the built dist/ (run `bin/ship-app.sh --check` first) twice, the way Pages does (the
// "/*" headers from dist/_headers, an ETag on every file, 304 on If-None-Match):
//   today      as live: max-age=0, must-revalidate — every file is rechecked on every visit
//   immutable  the same, except /v/* gets "public, max-age=31536000, immutable, no-transform"
// Each engine: one cold load, then --warm (default 5) returning visits — a new tab in the same
// browser profile, as a visitor coming back later would. The servers count what reaches them
// (200 = full file, 304 = rechecked, unchanged); the page reports its own timings.
//
//   node dev/speed/cache-ab.mjs                 # localhost: zero network, the control
//   node dev/speed/cache-ab.mjs --tunnel        # + both variants behind Cloudflare quick tunnels,
//                                               #   so the browser's leg crosses Mullvad when it's on
//   node dev/speed/cache-ab.mjs --live          # + share.refueler.io itself (today's headers, real Pages edge)
//   --engines=chromium,webkit,firefox,brave  --warm=5  --out=<dir> (private; default speed/cache-ab/)
//
// Read with care: through a tunnel a recheck travels browser → Cloudflare → this Mac, longer than
// Pages answering from its edge, so tunnel "today" overstates the live cost; --live gives the real
// today figure. Over plain http the CSP's upgrade-insecure-requests is dropped (it would send the
// page's own files to https://127.0.0.1). Run from Terminal.app, Mullvad off, then on (multihop + DAITA).

import { chromium, webkit, firefox } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize, resolve, sep } from 'node:path';
import { readHeaders } from '../../bin/test/static-site.mjs';
import { collect } from './conditions.mjs';
import { checkOut, PRIVATE, REPO, SHARE } from './summary.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const flag = (n) => argv.includes(`--${n}`);
const die = (m) => { console.error(`✗ ${m}`); process.exit(2); };

const DIST = resolve(REPO, 'dist');
if (!existsSync(join(DIST, 'v'))) die('no dist/ — run bin/ship-app.sh --check first');
const WARM = Number(arg('warm', '5'));
let OUT;
try { OUT = checkOut(arg('out', join(PRIVATE, 'speed/cache-ab'))); } catch (e) { die(e.message); }
const IMMUTABLE = 'public, max-age=31536000, immutable, no-transform';
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', woff2: 'font/woff2', png: 'image/png', svg: 'image/svg+xml', txt: 'text/plain', webmanifest: 'application/manifest+json' };

function fileFor(path) {
  const ok = (rel) => { const abs = normalize(join(DIST, rel)); return abs.startsWith(DIST + sep) && existsSync(abs) && statSync(abs).isFile() ? abs : null; };
  if (path === '/_headers') return null;
  if (path.endsWith('/')) return ok(`${path}index.html`);
  return ok(path) || (!path.endsWith('.html') && ok(`${path}.html`)) || null;
}

// One Pages-like server. count = what reached it since the last reset.
function server(mode) {
  const headers = readHeaders(DIST).map(([k, v]) => [k, k === 'Content-Security-Policy' ? v.replace(/;\s*upgrade-insecure-requests/, '') : v]);
  const count = { full: 0, rechecked: 0, bytes: 0 };
  const srv = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = fileFor(path), status = 200;
    if (!file) { file = fileFor('/404.html'); status = 404; }
    for (const [k, v] of headers) res.setHeader(k, v);
    if (mode === 'immutable' && path.startsWith('/v/') && status === 200) res.setHeader('Cache-Control', IMMUTABLE);
    if (!file) { res.writeHead(404); return res.end(); }
    const body = readFileSync(file);
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Content-Type', TYPES[file.split('.').pop()] || 'application/octet-stream');
    if (status === 200 && req.headers['if-none-match'] === etag) { count.rechecked++; res.writeHead(304); return res.end(); }
    count.full++; count.bytes += body.length;
    res.writeHead(status); res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({
    url: `http://127.0.0.1:${srv.address().port}`, port: srv.address().port, count,
    reset: () => Object.assign(count, { full: 0, rechecked: 0, bytes: 0 }),
    close: () => { srv.closeAllConnections(); srv.close(); },
  })));
}

// A Cloudflare quick tunnel to a local port (cloudflared is split-tunnelled out of Mullvad).
// Resolves once the URL is printed AND a connection is registered; asking for the name before its
// DNS record exists gets "not found" cached by macOS for minutes, so ready() waits before asking.
const tunnels = [];
process.on('exit', () => { for (const p of tunnels) p.kill(); });
function tunnel(port) {
  return new Promise((res, rej) => {
    const p = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    tunnels.push(p);
    let url = null, registered = false;
    const t = setTimeout(() => rej(new Error('quick tunnel: not up in 60 s')), 60000);
    const seen = (d) => {
      url ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(d))?.[0] ?? null;
      registered ||= /Registered tunnel connection/.test(String(d));
      if (url && registered) { clearTimeout(t); res({ url, close: () => p.kill() }); }
    };
    p.stdout.on('data', seen); p.stderr.on('data', seen);
    p.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}
async function ready(url) {
  await new Promise((r) => setTimeout(r, 10000));
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${url}/`, { cache: 'no-store' })).status === 200) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${url} never answered 200`);
}

// In the page: timings + what its own files came from (resource timing; WebKit may report 0s).
const COLLECT = () => new Promise((resolve) => setTimeout(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null;
  const rt = { cache: 0, rechecked: 0, full: 0 };
  for (const r of performance.getEntriesByType('resource')) {
    if (!r.name.startsWith(location.origin)) continue;
    if (r.transferSize === 0 && r.decodedBodySize > 0) rt.cache++;
    else if (r.transferSize > 0 && r.transferSize < r.encodedBodySize) rt.rechecked++;
    else rt.full++;
  }
  resolve({ fcp, ready: nav.loadEventEnd ?? null, rt });
}, 1500));

const median = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const BRAVE_APP = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
// A real on-disk profile per engine × target (Playwright's throwaway contexts give WebKit no cache
// between tabs, so a returning visit there would look like a first one).
const ENGINES = { chromium, webkit, firefox, brave: chromium };
const profile = (name, dir) => ENGINES[name].launchPersistentContext(dir, name === 'brave' ? { executablePath: BRAVE_APP } : {});
const wanted = arg('engines', 'chromium,webkit,firefox,brave').split(',');

async function visit(ctx, url, srv) {
  srv?.reset();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const m = await page.evaluate(COLLECT);
  await page.close();
  return { ...m, server: srv ? { ...srv.count } : null };
}

console.log('· conditions: network test (~20 s)…');
const conditions = await collect({ network: !flag('no-network') });
const today = await server('today'), immut = await server('immutable');
const targets = [
  { name: 'local-today', url: today.url, srv: today },
  { name: 'local-immutable', url: immut.url, srv: immut },
];
const closers = [today.close, immut.close];
const results = { schema: 1, when: new Date().toISOString(), warm: WARM, release: readFileSync(join(DIST, 'release.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? null, conditions, targets: {} };
try {
  if (flag('tunnel')) {
    const [t1, t2] = await Promise.all([tunnel(today.port), tunnel(immut.port)]);
    closers.push(t1.close, t2.close);
    await Promise.all([ready(t1.url), ready(t2.url)]);
    targets.push({ name: 'tunnel-today', url: t1.url, srv: today }, { name: 'tunnel-immutable', url: t2.url, srv: immut });
  }
  if (flag('live')) targets.push({ name: 'live-today', url: SHARE, srv: null });
  for (const name of wanted) {
    if (!ENGINES[name] || (name === 'brave' && !existsSync(BRAVE_APP))) continue;
    for (const t of targets) {
      const dir = mkdtempSync(join(tmpdir(), `cache-ab-${name}-`));
      let ctx;                                                // one profile: cold, then returning visits
      try { ctx = await profile(name, dir); } catch { console.log(`· ${name}: not installed — skipped`); rmSync(dir, { recursive: true, force: true }); break; }
      const cold = await visit(ctx, `${t.url}/`, t.srv);
      const warm = [];
      for (let i = 0; i < WARM; i++) warm.push(await visit(ctx, `${t.url}/`, t.srv));
      await ctx.close();
      rmSync(dir, { recursive: true, force: true });
      const med = (f) => median(warm.map(f));
      (results.targets[t.name] ??= {})[name] = {
        cold, warm,
        median: { fcp: med((w) => w.fcp), ready: med((w) => w.ready), full: med((w) => w.server?.full), rechecked: med((w) => w.server?.rechecked), bytes: med((w) => w.server?.bytes), rt_cache: med((w) => w.rt.cache), rt_rechecked: med((w) => w.rt.rechecked) },
      };
    }
  }
} finally { for (const c of closers) c(); }

const ms = (x) => (x == null ? '—' : `${Math.round(x)} ms`);
console.log(`\ncache A/B · dist ${results.release ?? '?'} · 1 cold + ${WARM} returning visits per engine (warm = median)\n`);
console.log('target            engine    cold ready  warm ready  warm fcp   to server (full / rechecked)  bytes   page says (cache / rechecked; WebKit reports 0s)');
for (const [t, engines] of Object.entries(results.targets)) {
  for (const [e, r] of Object.entries(engines)) {
    const m = r.median;
    const srv = m.full == null ? '—' : `${m.full} / ${m.rechecked}`;
    console.log(`${t.padEnd(17)} ${e.padEnd(9)} ${ms(r.cold.ready).padEnd(11)} ${ms(m.ready).padEnd(11)} ${ms(m.fcp).padEnd(10)} ${srv.padEnd(29)} ${m.bytes == null ? '—' : `${Math.round(m.bytes / 1024)} KB`}`.padEnd(118) + `${m.rt_cache} / ${m.rt_rechecked}`);
  }
}
const v = conditions.vpn;
const label = v.connected ? (v.multihop && v.daita ? 'vpn-on-daita' : 'vpn-on') : 'vpn-off';
mkdirSync(OUT, { recursive: true });
const file = join(OUT, `${results.when.slice(0, 16).replace(/[:T]/g, '-')}-cache-ab-${label}.json`);
writeFileSync(file, JSON.stringify({ ...results, label }, null, 2) + '\n');
console.log(`\n${label} · saved ${file}`);
process.exit(0);
