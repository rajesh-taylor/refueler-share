// dev/speed/speed.mjs — page speed of share.refueler.io, measured from this Mac (X5-1a · 14 Oct 2026;
// recorder Share-Release-1c · 17 Oct 2026, plan Share-Release-1 v1 §6).
// No user telemetry: the site carries no measuring script. This opens real browser engines
// (Chromium, WebKit = Safari's engine, Firefox, and the installed Brave app) headless, loads each page several times as a
// fresh visitor, and reads the timings the browser itself records. Pages only: it never
// uploads, so it creates no transfers and stores nothing.
//
//   node dev/speed/speed.mjs --weekly --place=L1         # the weekly routine: VPN off, then asks for
//                                                        #   Mullvad on, VPN on, --summarise, Finder
//   node dev/speed/speed.mjs --weekly --with-others --place=L1   # monthly: + the other sites each time
//   node dev/speed/speed.mjs --place=L1                  # one run, Mullvad as it is now
//   node dev/speed/speed.mjs --place=L1 --note="backup running"
//   node dev/speed/speed.mjs --summarise                 # rebuild summary.json for Navy Office's Speed view
//   node dev/speed/speed.mjs --targets=<list.json>       # one-off: other sites' public landing pages
//   node dev/speed/speed.mjs --engines=chromium --base=http://localhost:8094 --no-network
//   node dev/speed/speed.mjs --slow                      # Chromium only: throttled "fast 3G"-ish link
//
// Routine (Rajesh): weekly (Tuesday), at every app release, and ad hoc — run from Terminal.app
// (Firefox won't launch in Claude's shell), Mullvad OFF, then again with Mullvad ON (multihop + DAITA).
// --place is a site code (^[A-Z][0-9]{1,2}$, e.g. L1); the code → place map lives only in
// refueler-share-private/speed/places.md, which this script never reads.
// The label (vpn-off / vpn-on-daita) is set from Mullvad's own state; a --label that disagrees
// with it is refused before any page loads (two runs were mislabelled by hand, 14–15 Oct).
// Conditions are recorded automatically, allowlisted fields only (conditions.mjs): never an IP,
// Wi-Fi name, hardware address or provider name.
//
// All speed data is private (plan D4): results go to ../refueler-share-private/speed/runs/ (or
// speed/competitors/ for --targets); the script refuses to write anywhere inside this public repo.
// The 12 older results in dev/speed/results/ stay as they are.
// After a run it flags a > 20 % rise in "ready" or "bytes" against the previous comparable run
// (same page, engine, label, place). Limits: WebKit on a Mac is not Safari on an iPhone, and
// throttling is simulated — keep the real-device checks at each gate.

import { chromium, webkit, firefox } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collect, version } from './conditions.mjs';
import {
  checkOut, cleanNote, buildSummary, rowsFromRun, flags, writeAtomic, PLACE, RUNS_DIR, COMPETITORS_DIR, CACHE_AB_DIR, SUMMARY, SHARE,
} from './summary.mjs';
import { weekly } from './weekly.mjs';
import { releaseFromPage } from '../../bin/verify-live.mjs';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.findIndex((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (i < 0) return dflt;
  return argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);
const die = (msg) => { console.error(`✗ ${msg}`); process.exit(2); };
const safeOut = (p) => { try { return checkOut(p); } catch (e) { return die(e.message); } };

const readRuns = (dir) => (existsSync(dir) ? readdirSync(dir) : [])
  .filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
  .filter(Boolean);
const pct = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} %`;

// A run saves whole or not at all (writeAtomic); Ctrl-C waits for a save in progress, then stops.
process.on('SIGINT', () => { console.log('\n· stopped — runs already saved are whole; nothing half-written'); process.exit(130); });

// ── --weekly: VPN off, then on, then --summarise (weekly.mjs; never toggles Mullvad itself) ──
if (flag('weekly')) {
  const place = arg('place', null);
  if (!PLACE.test(place || '')) die('--weekly needs --place=<code>, e.g. --place=L1');
  process.exit(await weekly({ place, note: cleanNote(arg('note', null)), withOthers: flag('with-others') }));
}

// ── --summarise ────────────────────────────────────────────────────────────────────────────
if (flag('summarise') || flag('summarize')) {
  const runsDir = safeOut(arg('runs-dir', RUNS_DIR));
  const out = safeOut(arg('summary', SUMMARY));
  const runFiles = readRuns(runsDir);
  const s = buildSummary(runFiles, { competitors: readRuns(safeOut(arg('competitors-dir', COMPETITORS_DIR))), cacheAb: readRuns(safeOut(arg('cache-ab-dir', CACHE_AB_DIR))) });
  writeAtomic(out, JSON.stringify(s, null, 2) + '\n');
  const f = flags(runFiles.flatMap(rowsFromRun));
  console.log(`summary: ${s.runs.length} runs, ${s.competitors.length} other-site runs, ${s.cache_ab.length} cache A/B → ${out}`);
  for (const x of f) console.log(`  ⚑ ${x.row.when.slice(0, 16)} ${x.row.engine} ${x.row.page} ${x.row.label ?? ''} ${x.row.place ?? ''}: ${x.metric} ${pct(x.rise)}`);
  console.log('Open it in Navy Office → Speed (admin.share.refueler.io).');
  process.exit(0);
}

// ── options ────────────────────────────────────────────────────────────────────────────────
const TARGETS = arg('targets', null);
const BASE    = String(arg('base', SHARE)).replace(/\/+$/, '');
const RUNS    = Number(arg('runs', '5'));
const PAGES   = String(arg('pages', '/,/signin/')).split(',');
const SLOW    = flag('slow');
const PLACE_  = arg('place', null);
const NOTE    = cleanNote(arg('note', null));
const KIND    = arg('kind', null) === 'weekly' ? 'weekly' : null;   // set by --weekly
let   LABEL   = arg('label', '');
LABEL = LABEL ? String(LABEL).replace(/[^a-z0-9-]/gi, '').slice(0, 24) : '';
if (!(RUNS >= 1 && RUNS <= 50)) die('--runs must be 1–50');
if (PLACE_ != null && !PLACE.test(PLACE_)) die('--place is a site code: a capital letter and one or two digits, e.g. L1');
const ROUTINE = !TARGETS && BASE === SHARE && !SLOW;
if (ROUTINE && !PLACE_) die('--place=<code> is required for a share.refueler.io run (e.g. --place=L1)');
const OUT = safeOut(arg('out', TARGETS ? COMPETITORS_DIR : RUNS_DIR));

// Brave (X5-2, Rajesh 15 Oct): the installed Brave app, driven through Playwright's Chromium
// driver. Brave Shields stay at their defaults, as a Brave user would have them.
const BRAVE_APP = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const brave = { launch: () => existsSync(BRAVE_APP) ? chromium.launch({ executablePath: BRAVE_APP }) : Promise.reject(new Error('no Brave')) };
const ENGINES = { chromium, webkit, firefox, brave };
const wanted  = String(arg('engines', 'chromium,webkit,firefox,brave')).split(',');

// ── conditions first (networkQuality ~20 s), before any page loads ─────────────────────────
console.log(flag('no-network') ? '· conditions (network test skipped)…' : '· conditions: network test (~20 s)…');
const conditions = await collect({ network: !flag('no-network') });
const vpn = conditions.vpn;
const vpnLabel = vpn.connected === true ? (vpn.multihop && vpn.daita ? 'vpn-on-daita' : 'vpn-on') : vpn.connected === false || vpn.installed === false ? 'vpn-off' : null;
if (ROUTINE) {
  if (LABEL && vpnLabel && LABEL !== vpnLabel) die(`--label=${LABEL} but Mullvad says ${vpnLabel} — switch Mullvad or drop --label (it is set from Mullvad's state)`);
  LABEL = LABEL || vpnLabel || '';
  if (!LABEL) die('Mullvad state unknown (is the daemon running?) — pass --label=vpn-off or --label=vpn-on-daita');
}

const require_ = createRequire(import.meta.url);
const versions = { node: version(process.versions.node), playwright: version(require_('@playwright/test/package.json').version), engines: {} };

// The release a Share page loads (same read as bin/verify-live.mjs); null for any other site.
async function releaseOf(base) {
  try {
    const r = await fetch(`${base}/?speed=${Date.now()}`, { cache: 'no-store' });
    return releaseFromPage(await r.text());
  } catch { return null; }
}

// Collected inside the page after load: navigation timing, paints, LCP where supported, bytes.
const COLLECT = () => new Promise((resolve) => {
  const out = { lcp: null };
  try {
    new PerformanceObserver((l) => { const e = l.getEntries(); out.lcp = e[e.length - 1].startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* engine without LCP */ }
  setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
    const res = performance.getEntriesByType('resource');
    const bytes = res.reduce((n, r) => n + (r.transferSize || r.encodedBodySize || 0), 0) + (nav.transferSize || nav.encodedBodySize || 0);
    resolve({
      ttfb: nav.responseStart ?? null,
      fcp: paint['first-contentful-paint'] ?? null,
      lcp: out.lcp,
      dcl: nav.domContentLoadedEventEnd ?? null,
      ready: nav.loadEventEnd ?? null,
      requests: res.length + 1,
      bytes,
    });
  }, 1500);   // let late paints and module loads settle
});

const median = (xs) => {
  const v = xs.filter(x => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const ms = (x) => x == null ? '—' : `${Math.round(x)} ms`;
const kb = (x) => x == null ? '—' : `${Math.round(x / 1024)} KB`;

// One base URL, all wanted engines × pages. Our own host gets a cache-busting query; other
// sites are loaded exactly as a visitor would (fresh context = empty cache either way).
async function measure(base, pages, bust) {
  const engines = {};
  for (const name of wanted) {
    const engine = ENGINES[name];
    if (!engine) continue;
    let browser;
    try { browser = await engine.launch(); }
    catch { console.log(`· ${name}: not installed (${name === 'brave' ? 'no Brave app in /Applications' : `npx playwright install ${name}`}) — skipped`); continue; }
    versions.engines[name] = version(browser.version());
    engines[name] = {};
    for (const path of pages) {
      const samples = [];
      for (let i = 0; i < RUNS; i++) {
        const ctx = await browser.newContext();            // fresh visitor: empty cache, no storage
        const page = await ctx.newPage();
        if (SLOW && name === 'chromium') {
          const cdp = await ctx.newCDPSession(page);
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        }
        try {
          await page.goto(`${base}${path}${bust ? `?speed=${Date.now()}` : ''}`, { waitUntil: 'load', timeout: 60000 });
          samples.push(await page.evaluate(COLLECT));
        } catch (e) { samples.push({ error: String(e.message || e).split('\n')[0].slice(0, 120) }); }
        await ctx.close();
      }
      const m = {};
      for (const k of ['ttfb', 'fcp', 'lcp', 'dcl', 'ready', 'requests', 'bytes']) m[k] = median(samples.map(s => s[k]));
      engines[name][path] = { median: m, samples };
    }
    await browser.close();
  }
  return engines;
}

function table(title, engines) {
  console.log(`\n${title}\n`);
  console.log('engine    page        first byte  first paint  largest paint  ready      requests  bytes');
  for (const [name, pages] of Object.entries(engines)) {
    for (const [path, { median: m, samples }] of Object.entries(pages)) {
      const errs = samples.filter((s) => s.error).length;
      console.log(`${name.padEnd(9)} ${path.padEnd(11)} ${ms(m.ttfb).padEnd(11)} ${ms(m.fcp).padEnd(12)} ${ms(m.lcp).padEnd(14)} ${ms(m.ready).padEnd(10)} ${String(m.requests ?? '—').padEnd(9)} ${kb(m.bytes)}${errs ? `  (${errs} failed)` : ''}`);
    }
  }
}

const stamp = (when) => when.slice(0, 16).replace(/[:T]/g, '-');
mkdirSync(OUT, { recursive: true });

// ── --targets: the competitor one-off ──────────────────────────────────────────────────────
if (TARGETS) {
  const list = JSON.parse(readFileSync(TARGETS, 'utf8'));
  for (const t of list) {
    const u = new URL(t.url);
    const when = new Date().toISOString();
    const engines = await measure(u.origin, [u.pathname + u.search], false);
    const results = { schema: 2, kind: 'competitor', name: t.name, base: u.origin, page: u.pathname, when, place: PLACE_, note: NOTE, label: vpnLabel, runs: RUNS, versions, conditions, engines };
    table(`${t.name} · ${t.url} · ${RUNS} cold loads each · ${vpnLabel ?? ''} (medians)`, engines);
    const slug = String(t.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const file = join(OUT, `${stamp(when)}-${slug}${vpnLabel ? `-${vpnLabel}` : ''}.json`);
    writeAtomic(file, JSON.stringify(results, null, 2) + '\n');
    console.log(`saved ${file}`);
  }
  process.exit(0);
}

// ── a run against one base (routine, harness or slow) ──────────────────────────────────────
const when = new Date().toISOString();
const release = await releaseOf(BASE);
const engines = await measure(BASE, PAGES, true);
const results = { schema: 2, base: BASE, when, label: LABEL || null, place: PLACE_, note: NOTE, kind: KIND, runs: RUNS, slow: SLOW, release, versions, conditions, engines };

const c = conditions;
table(`share speed · ${BASE} · release ${release ?? '?'} · ${RUNS} cold loads each${SLOW ? ' · Chromium throttled' : ''}${LABEL ? ` · ${LABEL}` : ''}${PLACE_ ? ` · ${PLACE_}` : ''} (medians)`, engines);
console.log(`\nconditions: ${c.network ? `${c.network.down_mbps} ↓ / ${c.network.up_mbps} ↑ Mbps, ${c.network.rpm} RPM` : 'network not measured'} · ${c.link ?? 'link ?'} · ${c.power?.source ?? 'power ?'}${c.power?.source === 'battery' ? ` ${c.power.battery_pct}%` : ''} · ${vpn.connected ? `Mullvad ${[vpn.multihop && 'multihop', vpn.daita && 'DAITA'].filter(Boolean).join(' + ') || 'on'}${vpn.exit_city ? `, exit ${vpn.exit_city}` : ''}` : 'no VPN'}`);

const file = join(OUT, `${stamp(when)}-${release ?? 'unknown'}${SLOW ? '-slow' : ''}${LABEL ? `-${LABEL}` : ''}${PLACE_ ? `-${PLACE_}` : ''}.json`);
writeAtomic(file, JSON.stringify(results, null, 2) + '\n');
console.log(`saved ${file}`);

if (ROUTINE) {
  const f = flags(readRuns(OUT).flatMap(rowsFromRun)).filter((x) => x.row.when === when);
  if (f.length) for (const x of f) console.log(`⚑ ${x.row.engine} ${x.row.page}: ${x.metric} ${pct(x.rise)} vs ${x.prev.when.slice(0, 10)} (release ${x.prev.release}) — worth a look`);
  else console.log('no rise over 20 % against the previous comparable run');
  if (!KIND) console.log('then: node dev/speed/speed.mjs --summarise');
}
