// H6a Admin-Access-1a (30 Oct 2026) — Cloudflare Access token check (src/access_jwt.js).
// Plan: private strategy/docs/H6a-Admin-Access-plan-v1.md §3.2–§3.3.
//
//   • known-answer token (checked with openssl, see helpers/access-token.js)
//   • every rule: header shape, alg pinned to RS256, kid → team certs, signature, claims
//   • key cache: ≤ 1 h, unknown kid refetches at most once per 5 min, unreachable → 503

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requireAccess, forgetAccessCerts, ACCESS_HEADER } from '../src/access_jwt.js';
import {
  TEAM, AUD, KID, KAT_TOKEN, KAT_NOW, CERTS_URL, makeToken, certsBody, certsFetch, b64url,
} from './helpers/access-token.js';

const NOW = 1800000000;
const env = (o = {}) => ({ ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, ...o });
const req = (token, extra = {}) => new Request('https://admin.share.test/admin/reports/whoami', {
  headers: token === undefined ? extra : { [ACCESS_HEADER]: token, ...extra },
});
// null = passed; otherwise the refusal's status
const check = async (token, { e = env(), now = NOW, request } = {}) => {
  const r = await requireAccess(request ?? req(token), e, now);
  return r === null ? 'pass' : r.status;
};

let calls;
beforeEach(() => {
  forgetAccessCerts();
  calls = [];
  vi.stubGlobal('fetch', certsFetch({ calls }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('known answer', () => {
  it('the recorded token passes at its own time', async () => {
    expect(await check(KAT_TOKEN, { now: KAT_NOW })).toBe('pass');
    expect(calls).toEqual([CERTS_URL]);
  });

  it('one bit off in its signature → 401', async () => {
    const [h, p, s] = KAT_TOKEN.split('.');
    const flipped = s.slice(0, 10) + (s[10] === 'A' ? 'B' : 'A') + s.slice(11);
    expect(await check(`${h}.${p}.${flipped}`, { now: KAT_NOW })).toBe(401);
  });
});

describe('a good token', () => {
  it('passes; the refusal never echoes the token', async () => {
    expect(await check(await makeToken({ now: NOW }))).toBe('pass');
    const bad = await requireAccess(req('x.y.z'), env(), NOW);
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'access' });
  });
});

describe('header shape (rule 1)', () => {
  it('missing, empty, cookie only → 401', async () => {
    expect(await check(undefined)).toBe(401);
    expect(await check('')).toBe(401);
    const cookieOnly = req(undefined, { Cookie: `CF_Authorization=${await makeToken({ now: NOW })}` });
    expect(await check(null, { request: cookieOnly })).toBe(401);
  });

  it('two headers → 401', async () => {
    const t = await makeToken({ now: NOW });
    const h = new Headers();
    h.append(ACCESS_HEADER, t);
    h.append(ACCESS_HEADER, t);
    expect(await check(null, { request: new Request('https://admin.share.test/', { headers: h }) })).toBe(401);
  });

  it('not three base64url parts, or over 8 KB → 401', async () => {
    const t = await makeToken({ now: NOW });
    expect(await check(t.split('.').slice(0, 2).join('.'))).toBe(401);
    expect(await check(`${t}.x`)).toBe(401);
    expect(await check(t.replace('.', '.=') )).toBe(401);
    expect(await check(await makeToken({ now: NOW, claims: { pad: 'x'.repeat(8192) } }))).toBe(401);
  });
});

describe('algorithm and key id (rule 2)', () => {
  it('alg none → 401', async () => {
    const t = await makeToken({ now: NOW, header: { alg: 'none' } });
    expect(await check(t)).toBe(401);
    expect(await check(t.split('.').slice(0, 2).join('.') + '.')).toBe(401);
  });

  it('alg HS256 signed with the public key as the HMAC secret → 401', async () => {
    const enc = new TextEncoder();
    const h = b64url(enc.encode(JSON.stringify({ alg: 'HS256', kid: KID, typ: 'JWT' })));
    const p = (await makeToken({ now: NOW })).split('.')[1];
    for (const secret of [JSON.stringify(certsBody().keys[0]), certsBody().keys[0].n]) {
      const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', k, enc.encode(`${h}.${p}`));
      expect(await check(`${h}.${p}.${b64url(sig)}`)).toBe(401);
    }
  });

  it('other algs, a missing kid → 401', async () => {
    for (const alg of ['RS384', 'RS512', 'PS256', 'ES256', 'rs256', '']) {
      expect(await check(await makeToken({ now: NOW, header: { alg } }))).toBe(401);
    }
    expect(await check(await makeToken({ now: NOW, header: { kid: undefined } }))).toBe(401);
    expect(await check(await makeToken({ now: NOW, header: { kid: '' } }))).toBe(401);
  });
});

describe('signature (rule 4)', () => {
  it('a tampered payload → 401', async () => {
    const [h, , s] = (await makeToken({ now: NOW })).split('.');
    const p = (await makeToken({ now: NOW, claims: { email: 'someone-else@example.test' } })).split('.')[1];
    expect(await check(`${h}.${p}.${s}`)).toBe(401);
  });

  it('a signature from another token → 401', async () => {
    const [h, p] = (await makeToken({ now: NOW })).split('.');
    const s = KAT_TOKEN.split('.')[2];
    expect(await check(`${h}.${p}.${s}`)).toBe(401);
  });
});

describe('claims (rule 5)', () => {
  const withClaims = (claims) => makeToken({ now: NOW, claims });

  it('wrong iss, wrong aud, aud not an array → 401', async () => {
    expect(await check(await withClaims({ iss: 'https://other.cloudflareaccess.com' }))).toBe(401);
    expect(await check(await withClaims({ iss: `https://${TEAM}.cloudflareaccess.com/` }))).toBe(401);
    expect(await check(await withClaims({ aud: ['another-aud'] }))).toBe(401);
    expect(await check(await withClaims({ aud: AUD }))).toBe(401);
    expect(await check(await withClaims({ aud: ['another-aud', AUD] }))).toBe('pass');
  });

  it('expired by 61 s → 401; by 59 s → pass (60 s skew)', async () => {
    expect(await check(await withClaims({ exp: NOW - 61 }))).toBe(401);
    expect(await check(await withClaims({ exp: NOW - 60 }))).toBe(401);
    expect(await check(await withClaims({ exp: NOW - 59 }))).toBe('pass');
    expect(await check(await withClaims({ exp: undefined }))).toBe(401);
    expect(await check(await withClaims({ exp: String(NOW + 60) }))).toBe(401);
  });

  it('nbf or iat in the future beyond 60 s → 401', async () => {
    expect(await check(await withClaims({ nbf: NOW + 61 }))).toBe(401);
    expect(await check(await withClaims({ iat: NOW + 61 }))).toBe(401);
    expect(await check(await withClaims({ nbf: NOW + 59, iat: NOW + 59 }))).toBe('pass');
    expect(await check(await withClaims({ nbf: undefined }))).toBe('pass');
    expect(await check(await withClaims({ iat: undefined }))).toBe(401);
  });

  it('type not "app", email missing → 401', async () => {
    expect(await check(await withClaims({ type: 'org' }))).toBe(401);
    expect(await check(await withClaims({ type: undefined }))).toBe(401);
    expect(await check(await withClaims({ email: undefined }))).toBe(401);
    expect(await check(await withClaims({ email: '' }))).toBe(401);
  });

  it('ACCESS_TEAM or ACCESS_AUD unset → 503 for every token (fails closed)', async () => {
    const t = await makeToken({ now: NOW });
    expect(await check(t, { e: env({ ACCESS_TEAM: undefined }) })).toBe(503);
    expect(await check(t, { e: env({ ACCESS_AUD: '' }) })).toBe(503);
    expect(await check(t, { e: env({ ACCESS_TEAM: 'evil.example/x' }) })).toBe(503);
    expect(calls).toEqual([]);
  });
});

describe('team keys (rule 3)', () => {
  it('cached: two good tokens, one fetch', async () => {
    expect(await check(await makeToken({ now: NOW }))).toBe('pass');
    expect(await check(await makeToken({ now: NOW + 10 }), { now: NOW + 10 })).toBe('pass');
    expect(calls.length).toBe(1);
  });

  it('unknown kid: refetch once, then 401; no second refetch inside 5 min; one after', async () => {
    expect(await check(await makeToken({ now: NOW }))).toBe('pass');                         // fetch 1
    const stranger = (now) => makeToken({ now, header: { kid: 'unknown-kid' } });
    expect(await check(await stranger(NOW + 301), { now: NOW + 301 })).toBe(401);            // fetch 2
    expect(await check(await stranger(NOW + 302), { now: NOW + 302 })).toBe(401);            // throttled
    expect(calls.length).toBe(2);
    expect(await check(await stranger(NOW + 602), { now: NOW + 602 })).toBe(401);            // fetch 3
    expect(calls.length).toBe(3);
  });

  it('a rotated key is found by the refetch', async () => {
    let kid = 'old-kid';
    vi.stubGlobal('fetch', certsFetch({ calls, certs: () => certsBody(kid) }));
    expect(await check(await makeToken({ now: NOW, header: { kid: 'old-kid' } }))).toBe('pass');
    kid = 'new-kid';
    expect(await check(await makeToken({ now: NOW + 400, header: { kid: 'new-kid' } }), { now: NOW + 400 })).toBe('pass');
    expect(calls.length).toBe(2);
  });

  it('certs unreachable and nothing cached → 503, never a pass', async () => {
    const t = await makeToken({ now: NOW });
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    expect(await check(t)).toBe(503);
    vi.stubGlobal('fetch', certsFetch({ certs: () => new Response('nope', { status: 500 }) }));
    expect(await check(t)).toBe(503);
    vi.stubGlobal('fetch', certsFetch({ certs: () => ({ keys: [] }) }));
    expect(await check(t)).toBe(503);
    vi.stubGlobal('fetch', certsFetch({ certs: () => ({ keys: [{ ...certsBody().keys[0], alg: 'RS512' }] }) }));
    expect(await check(t)).toBe(503);
  });

  it('keys kept at most an hour: stale + unreachable → 503; fresh + refetch fails → cache still used', async () => {
    expect(await check(await makeToken({ now: NOW }))).toBe('pass');
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    expect(await check(await makeToken({ now: NOW + 3599 }), { now: NOW + 3599 })).toBe('pass');
    expect(await check(await makeToken({ now: NOW + 3600 }), { now: NOW + 3600 })).toBe(503);
  });

  it('keys come from this team only', async () => {
    const seen = [];
    vi.stubGlobal('fetch', async (url) => { seen.push(String(url)); return new Response(JSON.stringify(certsBody())); });
    await check(await makeToken({ now: NOW }), { e: env({ ACCESS_TEAM: 'refueler' }) });
    expect(seen).toEqual(['https://refueler.cloudflareaccess.com/cdn-cgi/access/certs']);
  });
});
