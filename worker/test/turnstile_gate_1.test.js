// Turnstile-Gate-1 (6 Nov 2026, docs/Turnstile-Gate-plan-v1.md §5): through worker.fetch, with
// siteverify stubbed. /credential/issue wants a gate token for `upload`, /auth/magic one for
// `signin`; the old app's host passes only inside APP_TURNSTILE_LEGACY_UNTIL, without an action.
// The gate origin is never a CORS origin. A blinded_message that isn't a point is 400 before
// Turnstile (Worker-Keys-2 leftover).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { env as shipped } from 'cloudflare:test';
import { hashToCurve } from '@cashu/cashu-ts';
import worker from '../src/index.js';
import { corsHeaders, setAppOrigins } from '../src/utils.js';
import { isBlindedPoint } from '../src/nut00.js';
import { makeEnv, ctx, ORIGIN } from './helpers/api-fake.js';
import { makeKv } from './helpers/kv-mock.js';

const GATE = 'gate.share.refueler.io';
const GATE_ORIGIN = `https://${GATE}`;
const NOW = Math.floor(Date.now() / 1000);
const blinded = hashToCurve(new TextEncoder().encode('turnstile-gate-1')).toHex(true);

let answer, calls;
beforeEach(() => {
  calls = 0;
  answer = { success: true, hostname: GATE, action: 'upload' };
  vi.stubGlobal('fetch', async (url) => {
    if (String(url).includes('siteverify')) { calls++; return Response.json(answer); }
    return new Response('down', { status: 503 });
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setAppOrigins({}); });

const issue = (env, body = {}) => worker.fetch(new Request(`${ORIGIN}/credential/issue`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.30' },
  body: JSON.stringify({ blinded_message: blinded, turnstile_token: `t-${Math.random()}`, ...body }),
}), env, ctx);

describe('/credential/issue: gate token for upload', () => {
  it('gate host + upload → 200', async () => {
    expect((await issue(makeEnv())).status).toBe(200);
  });

  it('gate host + signin, checkout or no action → 403', async () => {
    for (const action of ['signin', 'checkout', '', undefined]) {
      answer = { success: true, hostname: GATE, action };
      expect((await issue(makeEnv())).status, String(action)).toBe(403);
    }
  });

  it('another host → 403', async () => {
    for (const hostname of ['refueler-share-gate.pages.dev', 'refueler.io', 'localhost']) {
      answer = { success: true, hostname, action: 'upload' };
      expect((await issue(makeEnv())).status, hostname).toBe(403);
    }
  });

  it('old app (share.refueler.io, no action): 200 inside the window, 403 after or when shut', async () => {
    answer = { success: true, hostname: 'share.refueler.io', action: '' };
    expect((await issue(makeEnv({ APP_TURNSTILE_LEGACY_UNTIL: String(NOW + 3600) }))).status).toBe(200);
    expect((await issue(makeEnv({ APP_TURNSTILE_LEGACY_UNTIL: String(NOW - 1) }))).status).toBe(403);
    expect((await issue(makeEnv({ APP_TURNSTILE_LEGACY_UNTIL: '0' }))).status).toBe(403);
    answer = { success: true, hostname: 'share.refueler.io', action: 'upload' };
    expect((await issue(makeEnv({ APP_TURNSTILE_LEGACY_UNTIL: String(NOW + 3600) }))).status).toBe(403);
  });

  it('no APP_TURNSTILE_HOSTNAME → 403 for every token (fail-closed)', async () => {
    expect((await issue(makeEnv({ APP_TURNSTILE_HOSTNAME: undefined }))).status).toBe(403);
  });

  it('a blinded_message that is not a point → 400, Turnstile not used', async () => {
    const offCurve = '02' + 'f'.repeat(64);   // x ≥ p: no such point
    for (const bad of ['zz', 'not-hex', '04' + 'a'.repeat(64), blinded.slice(0, 64), blinded + '00', offCurve, ' ' + blinded]) {
      expect((await issue(makeEnv(), { blinded_message: bad })).status, bad).toBe(400);
    }
    expect(calls).toBe(0);
    expect(isBlindedPoint(blinded)).toBe(true);
    expect(isBlindedPoint(offCurve)).toBe(false);
  });
});

describe('/auth/magic: gate token for signin', () => {
  const API = 'https://api.share.refueler.io';
  const APP = 'https://share.refueler.io';
  const authEnv = () => ({
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'svc', TURNSTILE_SECRET_KEY: 'x',
    AUTH_PEPPER: 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=', AUTH_API_HOST: 'api.share.refueler.io',
    AUTH_ORIGINS: APP, AUTH_SIGNIN_URL: `${APP}/signin/`, AUTH_MAIL_FROM: 'signin@mail.refueler.io',
    APP_TURNSTILE_HOSTNAME: GATE, STATUS_KV: makeKv(), EMAIL: { send: vi.fn(async () => ({ messageId: 'm' })) },
  });
  const magic = (env, ip) => worker.fetch(new Request(`${API}/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: APP },
    body: JSON.stringify({ email: 'dev@refueler.io', turnstile_token: 'ok' }),
  }), env, { waitUntil() {} });

  it('gate + signin → 202; gate + upload → 403', async () => {
    answer = { success: true, hostname: GATE, action: 'signin' };
    expect((await magic(authEnv(), '203.0.113.71')).status).toBe(202);
    answer = { success: true, hostname: GATE, action: 'upload' };
    expect((await magic(authEnv(), '203.0.113.72')).status).toBe(403);
  });
});

describe('the gate is never a CORS origin', () => {
  it('shipped APP_ORIGINS and AUTH_ORIGINS do not name it', () => {
    expect(String(shipped.APP_ORIGINS).split(',')).not.toContain(GATE_ORIGIN);
    expect(String(shipped.AUTH_ORIGINS).split(',')).not.toContain(GATE_ORIGIN);
  });

  it('public CORS answers the gate with the first app origin, never an echo, never credentials', () => {
    setAppOrigins(shipped);
    const h = corsHeaders(new Request('https://api.share.refueler.io/status', { headers: { Origin: GATE_ORIGIN } }));
    expect(h['Access-Control-Allow-Origin']).not.toBe(GATE_ORIGIN);
    expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('credentialed preflight from the gate gets no allow-origin for it', async () => {
    const r = await worker.fetch(new Request('https://api.share.refueler.io/auth/signout', {
      method: 'OPTIONS', headers: { Origin: GATE_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    }), shipped, { waitUntil() {} });
    expect(r.headers.get('Access-Control-Allow-Origin')).not.toBe(GATE_ORIGIN);
    expect(r.headers.get('Access-Control-Allow-Credentials')).not.toBe('true');
  });
});
