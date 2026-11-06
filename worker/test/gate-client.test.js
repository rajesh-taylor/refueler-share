// Turnstile-Gate-1: the app's message checks for the gate (frontend/gate-client.js, plan §4.2).
import { describe, it, expect } from 'vitest';
import { gateMessageOk, newRequestId } from '../../frontend/gate-client.js';

const m = (o) => ({ t: 'refueler-gate', v: 1, id: 'abcdefghijklmnopqrstuv', ...o });

describe('gateMessageOk', () => {
  it('takes each gate → app message in its exact shape', () => {
    expect(gateMessageOk({ t: 'refueler-gate', v: 1, op: 'ready', id: null })).toBe(true);
    expect(gateMessageOk(m({ op: 'asking' }))).toBe(true);
    expect(gateMessageOk(m({ op: 'expired' }))).toBe(true);
    expect(gateMessageOk(m({ op: 'token', token: 'a'.repeat(2048) }))).toBe(true);
    expect(gateMessageOk(m({ op: 'token', token: '0.Ab-c_d' }))).toBe(true);
    expect(gateMessageOk(m({ op: 'error', code: 'load' }))).toBe(true);
    expect(gateMessageOk(m({ op: 'error', code: 'failed' }))).toBe(true);
  });

  it('drops everything else', () => {
    for (const bad of [
      null, undefined, 'token', 5, [], [m({ op: 'asking' })],
      m({ op: 'asking', extra: 1 }),                      // extra key
      { t: 'refueler-gate', v: 1, op: 'asking' },          // missing id
      m({ op: 'asking', t: 'other' }), m({ op: 'asking', v: 2 }), m({ op: 'asking', v: '1' }),
      m({ op: 'init', purpose: 'upload', theme: 'dark' }), // app → gate op
      m({ op: 'ready' }),                                   // ready with an id
      { t: 'refueler-gate', v: 1, op: 'ready', id: null, x: 1 },
      m({ op: 'token' }), m({ op: 'token', token: '' }), m({ op: 'token', token: 'a'.repeat(2049) }),
      m({ op: 'token', token: 'a b' }), m({ op: 'token', token: '<img>' }), m({ op: 'token', token: 5 }),
      m({ op: 'error', code: 'other' }), m({ op: 'error' }),
      m({ op: 'asking', id: 5 }), m({ op: 'constructor' }), m({ op: '__proto__' }),
    ]) expect(gateMessageOk(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe('newRequestId', () => {
  it('is 16 random bytes, base64url (22 chars), fresh each time', () => {
    const a = newRequestId(), b = newRequestId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});
