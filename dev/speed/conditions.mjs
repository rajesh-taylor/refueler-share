// dev/speed/conditions.mjs — the conditions a speed run was taken under (Share-Release-1c · 17 Oct 2026).
// Plan: refueler-share-private Share-Release-1 v1 §6. Allowlisted fields only: every value below is
// picked out one by one and checked against its own pattern; raw command output is never copied.
//
//   network  macOS networkQuality -c -M 20: down / up Mbps, responsiveness (RPM), idle round trip
//   link     the primary interface's hardware port → wifi / ethernet / iphone / other
//   power    AC or battery (+ %)
//   mac      model identifier (hw.model, e.g. Mac15,6) and macOS version + build
//   vpn      Mullvad: connected, multihop, DAITA, exit city
//
// Never recorded: IP addresses, Wi-Fi network names (SSID / BSSID), hardware (MAC) addresses, the
// provider's name, relay hostnames, coordinates, serial numbers. noAddresses() is the last guard:
// anything shaped like an IP or MAC address in the result makes the run refuse to save.
// The parsers are pure (tested on recorded outputs in test/fixtures/); collect() runs the commands.

import { execFile } from 'node:child_process';

const num = (x, lo, hi) => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// networkQuality -c (JSON). Throughputs are bits per second.
export function parseNetworkQuality(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const mbps = (b) => { const v = num(b, 0, 1e12); return v == null ? null : round1(v / 1e6); };
  const out = {
    down_mbps: mbps(j.dl_throughput),
    up_mbps: mbps(j.ul_throughput),
    rpm: (() => { const v = num(j.responsiveness, 0, 1e6); return v == null ? null : Math.round(v); })(),
    idle_rtt_ms: round1(num(j.base_rtt, 0, 1e5)),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// mullvad status --json. Only the tunnel state, two feature flags and the exit city survive.
const CITY = /^[\p{L}][\p{L} .'-]{0,39}$/u;
export function parseMullvad(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j.state !== 'string') return null;
  const connected = j.state === 'connected';
  const features = Array.isArray(j.details?.feature_indicators) ? j.details.feature_indicators : [];
  const city = j.details?.location?.city;
  return {
    connected,
    multihop: connected && features.includes('Multihop'),
    daita: connected && (features.includes('Daita') || j.details?.endpoint?.daita === true),
    exit_city: connected && typeof city === 'string' && CITY.test(city) ? city : null,
  };
}

// pmset -g batt → { source: 'ac' | 'battery', battery_pct }.
export function parsePmset(text) {
  const src = /drawing from '([^']+)'/.exec(text)?.[1] || '';
  const source = /AC/i.test(src) ? 'ac' : /Battery/i.test(src) ? 'battery' : null;
  if (!source) return null;
  const pct = /\t(\d{1,3})%;/.exec(text)?.[1];
  return { source, battery_pct: pct == null ? null : num(Number(pct), 0, 100) };
}

// scutil --nwi → the first real interface in "Network interfaces:" (VPN tunnels skipped).
export function parseNwi(text) {
  const line = /^Network interfaces:\s*(.*)$/m.exec(text)?.[1] || '';
  return line.split(/\s+/).find((d) => /^[a-z]+[0-9]+$/.test(d) && !/^(utun|ipsec|ppp|gif|stf|llw|awdl|bridge)/.test(d)) || null;
}

// networksetup -listallhardwareports → device → port name. Reads only the two name lines.
export function parseHardwarePorts(text) {
  const ports = new Map();
  let port = null;
  for (const line of text.split('\n')) {
    const p = /^Hardware Port: (.+)$/.exec(line);
    if (p) { port = p[1].trim(); continue; }
    const d = /^Device: ([a-z]+[0-9]+)$/.exec(line.trim());
    if (d && port) { ports.set(d[1], port); port = null; }
  }
  return ports;
}

export function linkType(portName) {
  if (!portName) return null;
  if (/^Wi-?Fi$|AirPort/i.test(portName)) return 'wifi';
  if (/iPhone|iPad/i.test(portName)) return 'iphone';
  if (/Ethernet|LAN|Thunderbolt|USB.*(10|100|Gigabit)/i.test(portName)) return 'ethernet';
  return 'other';
}

export function parseSwVers(text) {
  const version = /ProductVersion:\s*([0-9.]{1,12})\s*$/m.exec(text)?.[1] || null;
  const build = /BuildVersion:\s*([0-9A-Za-z]{1,12})\s*$/m.exec(text)?.[1] || null;
  return version ? { macos: version, build } : null;
}

export const macModel = (text) => (/^[A-Za-z]+[0-9]{1,3},[0-9]{1,3}$/.test(text.trim()) ? text.trim() : null);

// A browser / tool version: digits and dots only.
export const version = (v) => (typeof v === 'string' && /^[0-9][0-9.]{0,23}$/.test(v.trim()) ? v.trim() : null);

// Last guard. Throws if anything shaped like an IPv4, IPv6 or hardware address is in the object.
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b|::[0-9a-f]{1,4}\b/i;
export function noAddresses(obj, what = 'conditions') {
  const s = JSON.stringify(obj);
  if (IPV4.test(s) || IPV6.test(s)) throw new Error(`${what}: something shaped like an IP or hardware address got through — refusing to save`);
  return obj;
}

// Assemble from raw outputs (each a string, or null when the command failed / isn't installed).
export function assemble(raw) {
  const ports = raw.ports ? parseHardwarePorts(raw.ports) : new Map();
  const dev = raw.nwi ? parseNwi(raw.nwi) : null;
  const sw = raw.swVers ? parseSwVers(raw.swVers) : null;
  return noAddresses({
    schema: 1,
    network: raw.networkQuality ? parseNetworkQuality(raw.networkQuality) : null,
    link: dev ? linkType(ports.get(dev)) : null,
    power: raw.pmset ? parsePmset(raw.pmset) : null,
    mac: { model: raw.hwModel ? macModel(raw.hwModel) : null, macos: sw?.macos ?? null, build: sw?.build ?? null },
    vpn: raw.mullvad == null ? { installed: false } : { installed: true, ...(parseMullvad(raw.mullvad) || { connected: null }) },
  });
}

const run = (cmd, args, timeout) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (err, stdout) => resolve(err ? null : String(stdout)));
});

// Runs the commands. networkQuality is capped at 20 s (uncapped it moved 1.5 GB in 45 s on
// 17 Oct); skip it with { network: false } on a metered link.
export async function collect({ network = true } = {}) {
  const [networkQuality, nwi, ports, pmset, hwModel, swVers, mullvad] = await Promise.all([
    network ? run('/usr/bin/networkQuality', ['-c', '-M', '20'], 60000) : null,
    run('/usr/sbin/scutil', ['--nwi'], 5000),
    run('/usr/sbin/networksetup', ['-listallhardwareports'], 5000),
    run('/usr/bin/pmset', ['-g', 'batt'], 5000),
    run('/usr/sbin/sysctl', ['-n', 'hw.model'], 5000),
    run('/usr/bin/sw_vers', [], 5000),
    run('mullvad', ['status', '--json'], 10000),
  ]);
  return assemble({ networkQuality, nwi, ports, pmset, hwModel, swVers, mullvad });
}
