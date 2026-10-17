// node --test dev/speed/test/*.test.mjs — the speed recorder's conditions collector and summary
// (Share-Release-1c). Fixtures are recorded command outputs with documentation-range addresses
// (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32) standing in for real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseNetworkQuality, parseMullvad, parsePmset, parseNwi, parseHardwarePorts, linkType,
  parseSwVers, macModel, version, noAddresses, assemble,
} from '../conditions.mjs';
import { checkOut, cleanNote, rowsFromRun, flags, buildSummary, SHARE } from '../summary.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const ADDR = /\b(?:\d{1,3}\.){3}\d{1,3}\b|2001:db8|02:00:00/i;
const raw = () => ({
  networkQuality: fx('networkquality.json'), nwi: fx('scutil-nwi.txt'), ports: fx('hardwareports.txt'),
  pmset: fx('pmset-battery.txt'), hwModel: fx('hw-model.txt'), swVers: fx('sw_vers.txt'), mullvad: fx('mullvad-connected.json'),
});

test('mullvad: connected, multihop, DAITA, exit city — and no IP, hostname or coordinates', () => {
  const m = parseMullvad(fx('mullvad-connected.json'));
  assert.deepEqual(m, { connected: true, multihop: true, daita: true, exit_city: 'London' });
  const s = JSON.stringify(m);
  assert.doesNotMatch(s, ADDR);
  assert.doesNotMatch(s, /gb-lon|se-sto|Stockholm|51\.5|0\.09/);
});

test('mullvad: a city field holding an IP is dropped, not recorded', () => {
  const m = parseMullvad(fx('mullvad-city-is-ip.json'));
  assert.equal(m.exit_city, null);
  assert.doesNotMatch(JSON.stringify(m), ADDR);
});

test('mullvad: disconnected → no flags, no city (the visible location is the real one)', () => {
  assert.deepEqual(parseMullvad(fx('mullvad-disconnected.json')), { connected: false, multihop: false, daita: false, exit_city: null });
});

test('mullvad: garbage → null', () => {
  assert.equal(parseMullvad('Connected to 192.0.2.1'), null);
});

test('networkQuality: Mbps, RPM, idle RTT only — endpoint, interface and peer address dropped', () => {
  const n = parseNetworkQuality(fx('networkquality.json'));
  assert.deepEqual(n, { down_mbps: 287.6, up_mbps: 18, rpm: 99, idle_rtt_ms: 84.1 });
  assert.doesNotMatch(JSON.stringify(n), /aaplimg|utun|203\.0/);
});

test('pmset: battery with %, AC', () => {
  assert.deepEqual(parsePmset(fx('pmset-battery.txt')), { source: 'battery', battery_pct: 62 });
  assert.equal(parsePmset(fx('pmset-ac.txt')).source, 'ac');
  assert.equal(parsePmset('nothing'), null);
});

test('link: VPN tunnel skipped, Wi-Fi found by hardware port; MAC addresses never read', () => {
  assert.equal(parseNwi(fx('scutil-nwi.txt')), 'en0');
  const ports = parseHardwarePorts(fx('hardwareports.txt'));
  assert.equal(ports.get('en0'), 'Wi-Fi');
  assert.doesNotMatch(JSON.stringify([...ports]), ADDR);
  assert.equal(linkType('Wi-Fi'), 'wifi');
  assert.equal(linkType('Ethernet Adapter (en4)'), 'ethernet');
  assert.equal(linkType('iPhone USB'), 'iphone');
  assert.equal(linkType('Bluetooth PAN'), 'other');
});

test('mac: model + macOS; anything else refused', () => {
  assert.equal(macModel(fx('hw-model.txt')), 'Mac15,6');
  assert.equal(macModel('C02XYZ123ABC serial'), null);
  assert.deepEqual(parseSwVers(fx('sw_vers.txt')), { macos: '27.0.1', build: '26A434' });
  assert.equal(version('141.0.7390.37'), '141.0.7390.37');
  assert.equal(version('Chrome/141 (Macintosh)'), null);
});

test('assemble: the whole record from recorded outputs holds no address of any kind', () => {
  const c = assemble(raw());
  assert.deepEqual(c, {
    schema: 1,
    network: { down_mbps: 287.6, up_mbps: 18, rpm: 99, idle_rtt_ms: 84.1 },
    link: 'wifi',
    power: { source: 'battery', battery_pct: 62 },
    mac: { model: 'Mac15,6', macos: '27.0.1', build: '26A434' },
    vpn: { installed: true, connected: true, multihop: true, daita: true, exit_city: 'London' },
  });
  assert.doesNotMatch(JSON.stringify(c), ADDR);
});

test('assemble: commands missing → nulls, Mullvad not installed', () => {
  const c = assemble({});
  assert.deepEqual(c.vpn, { installed: false });
  assert.equal(c.network, null);
  assert.equal(c.link, null);
});

test('noAddresses: IPv4, IPv6 and MAC shapes refused', () => {
  assert.throws(() => noAddresses({ a: 'x 203.0.113.45 y' }), /refusing/);
  assert.throws(() => noAddresses({ a: '2001:db8::1' }), /refusing/);
  assert.throws(() => noAddresses({ a: 'fe80::1' }), /refusing/);
  assert.throws(() => noAddresses({ a: '02:00:00:aa:bb:03' }), /refusing/);
  assert.deepEqual(noAddresses({ a: 'Mac15,6', b: 287.6, c: '27.0.1' }), { a: 'Mac15,6', b: 287.6, c: '27.0.1' });
});

test('cleanNote: one line, 140 characters, never an address', () => {
  assert.equal(cleanNote('  backup\nrunning '), 'backup running');
  assert.equal(cleanNote('x'.repeat(200)).length, 140);
  assert.equal(cleanNote(''), null);
  assert.throws(() => cleanNote('on 192.0.2.4'), /refusing/);
});

test('checkOut: refuses the public repo (also through a symlink); allows a private path', () => {
  const root = mkdtempSync(join(tmpdir(), 'speed-'));
  const repo = join(root, 'refueler-share'), priv = join(root, 'refueler-share-private');
  mkdirSync(join(repo, 'dev/speed/results'), { recursive: true });
  mkdirSync(priv);
  symlinkSync(join(repo, 'dev'), join(priv, 'sneaky'));
  assert.throws(() => checkOut(join(repo, 'dev/speed/results'), { repo, privateRoot: priv }), /public repo/);
  assert.throws(() => checkOut(join(repo, 'new/dir'), { repo, privateRoot: priv }), /public repo/);
  assert.throws(() => checkOut(join(priv, 'sneaky/speed'), { repo, privateRoot: priv }), /public repo/);
  assert.equal(checkOut(join(priv, 'speed/runs'), { repo, privateRoot: priv }), join(priv, 'speed/runs'));
  assert.throws(() => checkOut(join(root, 'gone/speed/runs'), { repo, privateRoot: join(root, 'gone') }), /private repo not found/);
});

const run = (when, ready, bytes, extra = {}) => ({
  base: SHARE, when, release: 'aa760e9fe4', label: 'vpn-off', place: 'L1', runs: 5,
  conditions: assemble(raw()), versions: { engines: { webkit: '26.0' } },
  engines: { webkit: { '/': { median: { ttfb: 200.4, fcp: 800, lcp: 800, dcl: 700, ready, requests: 37, bytes } } } },
  ...extra,
});

test('summary rows (for the flags): per engine × page, digest only, competitor/slow runs left out', () => {
  const rows = [
    run('2026-10-17T10:00:00.000Z', 900, 386000),
    { ...run('2026-10-17T11:00:00.000Z', 1, 1), base: 'https://wetransfer.com' },
    run('2026-10-17T12:00:00.000Z', 1, 1, { slow: true }),
  ].flatMap(rowsFromRun);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].cond, { down_mbps: 287.6, up_mbps: 18, rpm: 99, link: 'wifi', power: 'battery', vpn: 'multihop+daita', exit_city: 'London' });
  assert.equal(rows[0].median.ttfb, 200);
  assert.equal(rows[0].engine_version, '26.0');
});

test('summary: old runs without place or conditions still summarise', () => {
  const old = run('2026-10-16T23:49:00.000Z', 900, 386000);
  delete old.place; delete old.conditions; delete old.versions;
  const [r] = buildSummary([old]).runs;
  assert.equal(r.place, null);
  assert.equal(r.cond, null);
});

test('flags: > 20 % rise in ready or bytes against the previous comparable run only', () => {
  const rows = [
    run('2026-10-10T10:00:00.000Z', 1000, 400000),
    run('2026-10-11T10:00:00.000Z', 1250, 400000),                     // ready +25 % → flag
    run('2026-10-12T10:00:00.000Z', 1400, 460000),                     // ready +12 %, bytes +15 % → none
    run('2026-10-13T10:00:00.000Z', 9000, 460000, { place: 'C2' }),    // other place: not comparable
    run('2026-10-14T10:00:00.000Z', 1400, 600000),                     // bytes +30 % vs 12 Oct → flag
  ].flatMap(rowsFromRun);
  const f = flags(rows);
  assert.deepEqual(f.map((x) => [x.row.when.slice(5, 10), x.metric]), [['10-11', 'ready'], ['10-14', 'bytes']]);
});
