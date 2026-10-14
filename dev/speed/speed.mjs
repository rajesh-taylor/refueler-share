// dev/speed/speed.mjs — page speed of share.refueler.io, measured from this Mac (X5-1a · 14 Oct 2026).
// No user telemetry: the site carries no measuring script. This opens real browser engines
// (Chromium, WebKit = Safari's engine, Firefox) headless, loads each page several times as a
// fresh visitor, and reads the timings the browser itself records. Pages only: it never
// uploads, so it creates no transfers and stores nothing.
//
//   node dev/speed/speed.mjs                         # all installed engines, default pages
//   node dev/speed/speed.mjs --engines=chromium --runs=5 --base=http://localhost:8094
//   node dev/speed/speed.mjs --slow                  # Chromium only: throttled "fast 3G"-ish link
//
// Writes dev/speed/results/<date>-<release>.json and prints a table. Compare releases by eye;
// a jump of more than ~20 % in "ready" or "bytes" is worth a look before shipping.
// Limits: WebKit on a Mac is not Safari on an iPhone, and throttling is simulated — keep the
// real-device checks at each gate.

import { chromium, webkit, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (name, dflt) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : dflt;
};
const BASE    = arg('base', 'https://share.refueler.io');
const RUNS    = Number(arg('runs', '3'));
const PAGES   = arg('pages', '/,/signin/').split(',');
const SLOW    = process.argv.includes('--slow');
const ENGINES = { chromium, webkit, firefox };
const wanted  = arg('engines', 'chromium,webkit,firefox').split(',');

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

const results = { base: BASE, when: new Date().toISOString(), runs: RUNS, slow: SLOW, release: null, engines: {} };

for (const name of wanted) {
  const engine = ENGINES[name];
  if (!engine) continue;
  let browser;
  try { browser = await engine.launch(); }
  catch { console.log(`· ${name}: not installed (npx playwright install ${name}) — skipped`); continue; }
  results.engines[name] = {};
  for (const path of PAGES) {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext();            // fresh visitor: empty cache, no storage
      const page = await ctx.newPage();
      if (SLOW && name === 'chromium') {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      }
      await page.goto(`${BASE}${path}?speed=${Date.now()}`, { waitUntil: 'load', timeout: 60000 });
      if (!results.release) {
        results.release = await page.evaluate(() => (document.querySelector('script[src^="/v/"]')?.getAttribute('src') || '').split('/')[2] || null);
      }
      samples.push(await page.evaluate(COLLECT));
      await ctx.close();
    }
    const m = {};
    for (const k of ['ttfb', 'fcp', 'lcp', 'dcl', 'ready', 'requests', 'bytes']) m[k] = median(samples.map(s => s[k]));
    results.engines[name][path] = { median: m, samples };
  }
  await browser.close();
}

console.log(`\nshare speed · ${BASE} · release ${results.release ?? '?'} · ${RUNS} cold loads each${SLOW ? ' · Chromium throttled' : ''} (medians)\n`);
console.log('engine    page        first byte  first paint  largest paint  ready      requests  bytes');
for (const [name, pages] of Object.entries(results.engines)) {
  for (const [path, { median: m }] of Object.entries(pages)) {
    console.log(`${name.padEnd(9)} ${path.padEnd(11)} ${ms(m.ttfb).padEnd(11)} ${ms(m.fcp).padEnd(12)} ${ms(m.lcp).padEnd(14)} ${ms(m.ready).padEnd(10)} ${String(m.requests ?? '—').padEnd(9)} ${kb(m.bytes)}`);
  }
}

const dir = new URL('./results/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const file = `${dir}${results.when.slice(0, 10)}-${results.release ?? 'unknown'}${SLOW ? '-slow' : ''}.json`;
writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
console.log(`\nsaved ${file.replace(process.cwd() + '/', '')}`);
