// dev/speed/summary.mjs — where speed results may be written, and the summary Navy Office opens
// (Share-Release-1c · 17 Oct 2026; plan Share-Release-1 v1 §6, D4: all speed data private).
// Schema 2 (Speed-View-Opus · 17 Oct 2026): { runs, competitors, cache_ab } — conditions once per
// run, other sites without byte counts. Pure functions, tested in test/*.test.mjs.

import { existsSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noAddresses } from './conditions.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PRIVATE = resolve(REPO, '../refueler-share-private');
export const RUNS_DIR = resolve(PRIVATE, 'speed/runs');
export const COMPETITORS_DIR = resolve(PRIVATE, 'speed/competitors');
export const SUMMARY = resolve(PRIVATE, 'speed/summary.json');
export const CACHE_AB_DIR = resolve(PRIVATE, 'speed/cache-ab');
export const TARGETS_LIST = resolve(COMPETITORS_DIR, 'list.json');
export const SHARE = 'https://share.refueler.io';
export const PLACE = /^[A-Z][0-9]{1,2}$/;
export const RISE = 0.2;   // flag a > 20 % rise in ready or bytes against the previous comparable run

const nearestExisting = (p) => { while (!existsSync(p)) p = dirname(p); return p; };

// Refuses any output path inside the public repo (symlinks resolved), or under a missing private repo.
export function checkOut(out, { repo = REPO, privateRoot = PRIVATE } = {}) {
  const abs = resolve(out);
  const real = realpathSync(nearestExisting(abs));
  const repoReal = realpathSync(repo);
  if (real === repoReal || real.startsWith(repoReal + sep) || abs === repoReal || abs.startsWith(repoReal + sep)) {
    throw new Error(`refusing to write speed data inside the public repo (${abs}) — speed data is private`);
  }
  if (abs.startsWith(resolve(privateRoot) + sep) && !existsSync(privateRoot)) {
    throw new Error(`private repo not found at ${privateRoot} — nothing written`);
  }
  return abs;
}

// A note typed by Rajesh: one line, at most 140 characters, never an address.
export function cleanNote(s) {
  if (s == null || s === '') return null;
  const n = String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  noAddresses({ n }, '--note');
  return n || null;
}

// A short conditions digest for the summary.
export function digest(c) {
  if (!c) return null;
  const v = c.vpn || {};
  return {
    down_mbps: c.network?.down_mbps ?? null,
    up_mbps: c.network?.up_mbps ?? null,
    rpm: c.network?.rpm ?? null,
    link: c.link ?? null,
    power: c.power?.source ?? null,
    vpn: v.connected == null ? null : v.connected ? [v.multihop && 'multihop', v.daita && 'daita'].filter(Boolean).join('+') || 'on' : 'off',
    exit_city: v.exit_city ?? null,
  };
}

const KEYS = ['ttfb', 'fcp', 'lcp', 'dcl', 'ready', 'requests', 'bytes'];
const r0 = (x) => (typeof x === 'number' ? Math.round(x) : null);

// One run file → one row per engine × page. Only routine share.refueler.io runs count.
export function rowsFromRun(run) {
  if (!run || run.base !== SHARE || run.slow) return [];
  const rows = [];
  for (const [engine, pages] of Object.entries(run.engines || {})) {
    for (const [page, r] of Object.entries(pages)) {
      if (!r?.median) continue;
      rows.push({
        when: run.when, release: run.release ?? null, label: run.label ?? null,
        place: PLACE.test(run.place || '') ? run.place : null, note: run.note ?? null,
        engine, engine_version: run.versions?.engines?.[engine] ?? null, page, runs: run.runs,
        median: Object.fromEntries(KEYS.map((k) => [k, r0(r.median[k])])),
        cond: digest(run.conditions),
      });
    }
  }
  return rows;
}

export const comparable = (r) => [r.page, r.engine, r.label ?? '', r.place ?? ''].join('|');

// Rows whose ready or bytes rose more than RISE against the previous row with the same key.
export function flags(rows) {
  const last = new Map(), out = [];
  for (const r of [...rows].sort((a, b) => a.when.localeCompare(b.when))) {
    const prev = last.get(comparable(r));
    if (prev) {
      for (const k of ['ready', 'bytes']) {
        const a = prev.median[k], b = r.median[k];
        if (a > 0 && b != null && (b - a) / a > RISE) out.push({ row: r, prev, metric: k, rise: (b - a) / a });
      }
    }
    last.set(comparable(r), r);
  }
  return out;
}

// Writes whole or not at all: a temp file beside the target, then a rename (atomic on one volume).
// Ctrl-C mid-write leaves at most the temp file, never a half-written result; its name doesn't end
// in .json, so --summarise never reads it.
export function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); }
  catch (e) { rmSync(tmp, { force: true }); throw e; }
}

const pick = (m, keys) => Object.fromEntries(keys.map((k) => [k, r0(m?.[k])]));
const OTHER_KEYS = ['ttfb', 'fcp', 'lcp', 'ready', 'requests'];   // no bytes: other sites' sizes undercount

// One routine share.refueler.io run file → one schema-2 run (null for competitor / slow / harness runs).
export function runEntry(run) {
  if (!run || run.base !== SHARE || run.slow || typeof run.when !== 'string') return null;
  const results = {};
  for (const [engine, pages] of Object.entries(run.engines || {})) {
    for (const [page, r] of Object.entries(pages || {})) if (r?.median) (results[engine] ??= {})[page] = pick(r.median, KEYS);
  }
  return {
    when: run.when, release: run.release ?? null, label: run.label ?? null,
    place: PLACE.test(run.place || '') ? run.place : null, note: run.note ?? null,
    kind: run.kind === 'weekly' ? 'weekly' : null, loads: run.runs ?? null,
    cond: digest(run.conditions), engines: run.versions?.engines ?? {}, results,
  };
}

// One --targets file → one competitor entry, byte counts dropped.
export function competitorEntry(c) {
  if (!c || c.kind !== 'competitor' || typeof c.name !== 'string' || typeof c.when !== 'string') return null;
  const results = {};
  for (const [engine, pages] of Object.entries(c.engines || {})) {
    const r = Object.values(pages || {})[0];
    if (r?.median) results[engine] = pick(r.median, OTHER_KEYS);
  }
  return {
    name: c.name.slice(0, 40), page: c.page ?? '/', when: c.when, place: PLACE.test(c.place || '') ? c.place : null,
    label: c.label ?? null, loads: c.runs ?? null, cond: digest(c.conditions), results,
  };
}

const median = (xs) => { const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

// One cache-ab.mjs file → per target × engine: cold ready, median return-visit ready, rechecks per visit
// (counted by our server; on the live site only where the engine reports it — WebKit and Firefox don't).
export function cacheAbEntry(a) {
  if (!a || typeof a.when !== 'string' || !a.targets) return null;
  const targets = {};
  for (const [t, engs] of Object.entries(a.targets)) {
    for (const [e, d] of Object.entries(engs || {})) {
      if (!Array.isArray(d?.warm)) continue;
      const rech = d.warm.map((w) => (w.server ? w.server.rechecked : (w.rt?.rechecked || null)));
      (targets[t] ??= {})[e] = { cold_ready: r0(d.cold?.ready), warm_ready: r0(median(d.warm.map((w) => w.ready))), rechecked: median(rech) };
    }
  }
  return { when: a.when, label: a.label ?? null, release: a.release ?? null, warm: a.warm ?? null, cond: digest(a.conditions), targets };
}

export function buildSummary(runFiles, { competitors = [], cacheAb = [] } = {}, generated = new Date().toISOString()) {
  const byWhen = (a, b) => a.when.localeCompare(b.when);
  const out = {
    schema: 2, generated, rise: RISE,
    runs: runFiles.map(runEntry).filter(Boolean).sort(byWhen),
    competitors: competitors.map(competitorEntry).filter(Boolean).sort(byWhen),
    cache_ab: cacheAb.map(cacheAbEntry).filter(Boolean).sort(byWhen),
  };
  // The guard reads the free-text parts only: timestamps look like IPv6 to it (12:30:40).
  for (const r of [...out.runs, ...out.competitors, ...out.cache_ab]) noAddresses({ note: r.note ?? null, cond: r.cond }, `summary entry ${r.when}`);
  return out;
}
