// dev/speed/weekly.mjs — `speed.mjs --weekly --place=L1` (Speed-View-Opus · 17 Oct 2026).
// The weekly routine in one command, run from Terminal.app:
//   1. refuses to start unless Mullvad is off (the first run is the VPN-off one);
//   2. VPN-off run (+ the other sites with --with-others);
//   3. asks Rajesh to switch Mullvad on with multihop + DAITA and press Enter, then waits until
//      `mullvad status --json` says so — it never switches Mullvad itself;
//   4. VPN-on run (+ the other sites), 5. --summarise, 6. shows summary.json in Finder.
// Each run is its own speed.mjs process, saving whole or not at all; Ctrl-C at any point keeps
// the runs already saved and leaves nothing half-written. The decisions below are pure functions,
// tested on recorded `mullvad status --json` outputs (test/weekly.test.mjs).

import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseMullvad } from './conditions.mjs';
import { SUMMARY, TARGETS_LIST } from './summary.mjs';

const STATES = new Set(['connected', 'connecting', 'disconnected', 'disconnecting', 'error']);

// Mullvad's tunnel state from `mullvad status --json`, or null if it can't be read.
export function tunnelState(text) {
  try { const j = JSON.parse(text); return STATES.has(j?.state) ? j.state : null; } catch { return null; }
}

// May the weekly routine start? Only with Mullvad plainly off (or not installed: then there is no
// VPN-on half, and it says so).
export function startCheck(text) {
  if (text == null) return { ok: false, msg: 'Mullvad isn’t answering (`mullvad status`). Open the Mullvad app, switch it off, and start again.' };
  const s = tunnelState(text);
  if (s === 'disconnected') return { ok: true };
  if (s == null) return { ok: false, msg: 'Couldn’t read Mullvad’s state. Open the Mullvad app, switch it off, and start again.' };
  return { ok: false, msg: 'Mullvad is on. Switch it off and start again: the weekly run measures VPN off first.' };
}

// While waiting for "VPN on": done only when connected with multihop AND DAITA ("VPN on" in Navy
// Office always means both). msg is printed when it changes.
export function waitStep(text) {
  const s = text == null ? null : tunnelState(text);
  if (s === 'connected') {
    const m = parseMullvad(text);
    if (m?.multihop && m?.daita) return { done: true, msg: `Mullvad on · multihop + DAITA${m.exit_city ? ` · exit ${m.exit_city}` : ''}` };
    const missing = [!m?.multihop && 'multihop', !m?.daita && 'DAITA'].filter(Boolean).join(' and ');
    return { done: false, msg: `Mullvad is on, but without ${missing}. Switch ${missing} on in Mullvad’s settings…` };
  }
  if (s === 'connecting') return { done: false, msg: 'Mullvad is connecting…' };
  if (s == null) return { done: false, msg: 'Can’t read Mullvad’s state yet…' };
  return { done: false, msg: 'Waiting for Mullvad to connect…' };
}

// The child runs, in order. Pure, so the order is tested.
export function plan({ place, note = null, withOthers = false, targets = TARGETS_LIST }) {
  const noteArg = note ? [`--note=${note}`] : [];
  const share = (label) => ({ what: `Share · ${label === 'vpn-off' ? 'VPN off' : 'VPN on'}`, args: [`--place=${place}`, '--kind=weekly', `--label=${label}`, ...noteArg] });
  const others = (label) => ({ what: `the other sites · ${label === 'vpn-off' ? 'VPN off' : 'VPN on'}`, args: [`--targets=${targets}`, `--place=${place}`] });
  return {
    off: [share('vpn-off'), ...(withOthers ? [others('vpn-off')] : [])],
    on: [share('vpn-on-daita'), ...(withOthers ? [others('vpn-on-daita')] : [])],
    after: [{ what: 'summary', args: ['--summarise'] }],
  };
}

// ── the runner (not unit-tested: it drives processes and the terminal) ─────────────────────
const SPEED = fileURLToPath(new URL('./speed.mjs', import.meta.url));
const mullvad = () => new Promise((resolve) => execFile('mullvad', ['status', '--json'], { timeout: 10000 }, (err, out) => resolve(err ? null : String(out))));
const child = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [SPEED, ...args], { stdio: 'inherit' });
  p.on('exit', (code, signal) => resolve(signal ? 130 : code ?? 1));
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const enter = (prompt) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => { rl.close(); process.emit('SIGINT'); });   // Ctrl-C at the prompt stops, as anywhere else
  rl.question(prompt, () => { rl.close(); resolve(); });
});

export async function weekly({ place, note, withOthers }) {
  const steps = plan({ place, note, withOthers });
  const start = startCheck(await mullvad());
  if (!start.ok) { console.error(`✗ ${start.msg}`); return 2; }
  console.log(`\nWeekly speed run at ${place}${withOthers ? ', with the other sites' : ''}. Part 1 of 2: VPN off.\n`);
  for (const s of steps.off) { console.log(`· ${s.what}`); const c = await child(s.args); if (c) return c; }

  console.log('\nPart 1 saved. Now switch Mullvad on, with multihop and DAITA, then come back here.');
  await enter('Press Enter when it’s on… ');
  let last = '';
  for (;;) {
    const w = waitStep(await mullvad());
    if (w.msg !== last) { console.log(`· ${w.msg}`); last = w.msg; }
    if (w.done) break;
    await pause(2000);
  }
  console.log('· settling for 5 s');
  await pause(5000);

  console.log('\nPart 2 of 2: VPN on.\n');
  for (const s of steps.on) { console.log(`· ${s.what}`); const c = await child(s.args); if (c) return c; }
  for (const s of steps.after) { const c = await child(s.args); if (c) return c; }
  execFile('open', ['-R', SUMMARY]);
  console.log('\n✓ Done. summary.json is selected in Finder: drag it onto Navy Office → Speed (with places.md if you like). You can switch Mullvad back as you prefer.');
  return 0;
}
