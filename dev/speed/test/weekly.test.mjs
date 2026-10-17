// node --test dev/speed/test/*.test.mjs — the --weekly routine's decisions (Speed-View-Opus · 17 Oct 2026),
// on recorded `mullvad status --json` outputs. It never toggles Mullvad; these are the only gates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tunnelState, startCheck, waitStep, plan } from '../weekly.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const on = fx('mullvad-connected.json');
const off = fx('mullvad-disconnected.json');
const variant = (fn) => { const j = JSON.parse(on); fn(j); return JSON.stringify(j); };
const noDaita = variant((j) => { j.details.feature_indicators = j.details.feature_indicators.filter((f) => f !== 'Daita'); if (j.details.endpoint) j.details.endpoint.daita = false; });
const noMultihop = variant((j) => { j.details.feature_indicators = j.details.feature_indicators.filter((f) => f !== 'Multihop'); });
const connecting = variant((j) => { j.state = 'connecting'; });

test('tunnelState: known states only', () => {
  assert.equal(tunnelState(on), 'connected');
  assert.equal(tunnelState(off), 'disconnected');
  assert.equal(tunnelState('{"state":"weird"}'), null);
  assert.equal(tunnelState('not json'), null);
});

test('startCheck: starts only with Mullvad plainly off', () => {
  assert.equal(startCheck(off).ok, true);
  for (const t of [on, connecting, noDaita, null, 'garbage']) assert.equal(startCheck(t).ok, false);
  assert.match(startCheck(on).msg, /Switch it off/);
  assert.match(startCheck(null).msg, /isn’t answering/);
});

test('waitStep: done only when connected with multihop AND DAITA', () => {
  assert.equal(waitStep(on).done, true);
  assert.match(waitStep(on).msg, /exit London/);
  assert.deepEqual([noDaita, noMultihop, connecting, off, null].map((t) => waitStep(t).done), [false, false, false, false, false]);
  assert.match(waitStep(noDaita).msg, /without DAITA/);
  assert.match(waitStep(noMultihop).msg, /without multihop/);
  assert.match(waitStep(connecting).msg, /connecting/);
});

test('waitStep messages never carry an address from Mullvad’s output', () => {
  for (const t of [on, noDaita, connecting, off]) assert.doesNotMatch(waitStep(t).msg, /\b(?:\d{1,3}\.){3}\d{1,3}\b|2001:db8|gb-lon|se-sto/);
});

test('plan: VPN off first, the other sites only with --with-others, summary last; labels pinned', () => {
  const p = plan({ place: 'L1', targets: '/x/list.json' });
  assert.deepEqual(p.off.map((s) => s.args), [['--place=L1', '--kind=weekly', '--label=vpn-off']]);
  assert.deepEqual(p.on.map((s) => s.args), [['--place=L1', '--kind=weekly', '--label=vpn-on-daita']]);
  assert.deepEqual(p.after.map((s) => s.args), [['--summarise']]);
  const m = plan({ place: 'L2', note: 'backup running', withOthers: true, targets: '/x/list.json' });
  assert.deepEqual(m.off.map((s) => s.args), [['--place=L2', '--kind=weekly', '--label=vpn-off', '--note=backup running'], ['--targets=/x/list.json', '--place=L2']]);
  assert.equal(m.on.length, 2);
});
