// dev/speed/summary.mjs — where speed results may be written, and the summary Navy Office opens
// (Share-Release-1c · 17 Oct 2026; plan Share-Release-1 v1 §6, D4: all speed data private).
// Pure functions, tested in test/summary.test.mjs.

import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noAddresses } from './conditions.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PRIVATE = resolve(REPO, '../refueler-share-private');
export const RUNS_DIR = resolve(PRIVATE, 'speed/runs');
export const COMPETITORS_DIR = resolve(PRIVATE, 'speed/competitors');
export const SUMMARY = resolve(PRIVATE, 'speed/summary.json');
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

export function buildSummary(runs, generated = new Date().toISOString()) {
  const rows = runs.flatMap(rowsFromRun).sort((a, b) => a.when.localeCompare(b.when) || comparable(a).localeCompare(comparable(b)));
  // The guard reads the free-text parts only: timestamps look like IPv6 to it (12:30:40).
  for (const r of rows) noAddresses({ note: r.note, cond: r.cond }, `summary row ${r.when}`);
  return { schema: 1, generated, rise: RISE, rows };
}
