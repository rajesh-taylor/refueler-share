// node --test dev/speed/test/*.test.mjs — summary.json schema 2 and atomic writes (Speed-View-Opus · 17 Oct 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../conditions.mjs';
import { buildSummary, runEntry, competitorEntry, cacheAbEntry, writeAtomic, SHARE } from '../summary.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const cond = () => assemble({ networkQuality: fx('networkquality.json'), nwi: fx('scutil-nwi.txt'), ports: fx('hardwareports.txt'), pmset: fx('pmset-battery.txt'), hwModel: fx('hw-model.txt'), swVers: fx('sw_vers.txt'), mullvad: fx('mullvad-connected.json') });
const m = (ready) => ({ median: { ttfb: 200.4, fcp: 600.6, lcp: 600.6, dcl: 650, ready, requests: 37, bytes: 386000 } });
const shareRun = (when, extra = {}) => ({
  schema: 2, base: SHARE, when, release: 'f2536dafb5', label: 'vpn-off', place: 'L1', note: null, runs: 5, slow: false,
  versions: { engines: { webkit: '26.6' } }, conditions: cond(), engines: { webkit: { '/': m(722.4), '/signin/': m(605) } }, ...extra,
});
const otherRun = (name, when) => ({
  schema: 2, kind: 'competitor', name, base: 'https://example.org', page: '/', when, place: 'L1', label: 'vpn-off', runs: 5, conditions: cond(),
  engines: { webkit: { '/': m(1100) } },
});

test('schema 2: runs once each with conditions once; kind kept only as weekly', () => {
  const s = buildSummary([shareRun('2026-10-20T18:00:00Z', { kind: 'weekly' }), shareRun('2026-10-17T13:04:00Z', { kind: 'bogus' })], {}, 'G');
  assert.equal(s.schema, 2);
  assert.deepEqual(s.runs.map((r) => [r.when.slice(5, 10), r.kind]), [['10-17', null], ['10-20', 'weekly']]);
  assert.equal(s.runs[0].results.webkit['/'].ready, 722);
  assert.equal(s.runs[0].cond.vpn, 'multihop+daita');
  assert.deepEqual(Object.keys(s.runs[0].results.webkit), ['/', '/signin/']);
});

test('schema 2: other sites keep paints, ready and requests — never bytes', () => {
  const c = competitorEntry(otherRun('Wormhole', '2026-10-17T13:15:00Z'));
  assert.deepEqual(Object.keys(c.results.webkit), ['ttfb', 'fcp', 'lcp', 'ready', 'requests']);
  assert.doesNotMatch(JSON.stringify(c), /bytes|386000/);
  assert.equal(competitorEntry({ name: 'x', when: 'y' }), null, 'list.json-like or unmarked files are skipped');
  assert.equal(competitorEntry([{ name: 'WeTransfer', url: 'https://wetransfer.com/' }]), null);
});

test('schema 2: Share runs only — other sites, slow and harness runs never land in runs', () => {
  assert.equal(runEntry({ ...shareRun('2026-10-17T13:04:00Z'), base: 'http://localhost:8094' }), null);
  assert.equal(runEntry({ ...shareRun('2026-10-17T13:04:00Z'), slow: true }), null);
  assert.equal(runEntry(otherRun('Smash', '2026-10-17T13:13:00Z')), null);
});

test('schema 2: cache A/B → cold, median return visit, rechecks (server count, else what the engine reports)', () => {
  const w = (ready, server, rt) => ({ ready, server, rt });
  const a = cacheAbEntry({
    when: '2026-10-17T13:06:56Z', label: 'vpn-off', release: 'app-4298abd19b', warm: 3, conditions: cond(),
    targets: {
      'tunnel-today': { chromium: { cold: { ready: 465.2 }, warm: [w(270, { rechecked: 33 }), w(267, { rechecked: 33 }), w(250, { rechecked: 33 })] } },
      'live-today': { webkit: { cold: { ready: 625 }, warm: [w(469, null, { rechecked: 0 }), w(470, null, { rechecked: 0 }), w(480, null, { rechecked: 0 })] } },
    },
  });
  assert.deepEqual(a.targets['tunnel-today'].chromium, { cold_ready: 465, warm_ready: 267, rechecked: 33 });
  assert.equal(a.targets['live-today'].webkit.rechecked, null, 'WebKit does not report rechecks: unknown, not zero');
});

test('schema 2: a note with an address refuses the whole summary', () => {
  assert.throws(() => buildSummary([shareRun('2026-10-17T13:04:00Z', { note: 'from 192.0.2.7' })]), /IP or hardware address/);
});

test('writeAtomic: the file appears whole; no temp file is left behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'speed-'));
  const f = join(dir, 'summary.json');
  writeAtomic(f, '{"schema":2}\n');
  writeAtomic(f, '{"schema":2,"runs":[]}\n');
  assert.equal(readFileSync(f, 'utf8'), '{"schema":2,"runs":[]}\n');
  assert.deepEqual(readdirSync(dir), ['summary.json']);
});
