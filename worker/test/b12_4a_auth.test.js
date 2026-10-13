// test/b12_4a_auth.test.js
// B12-4a — auth.js primitives. Known-answer vectors computed outside the Worker
// with Node's own HKDF and TWO BLAKE3 implementations (@noble/hashes and
// blake3-wasm), which agree.

import { describe, it, expect } from 'vitest';
import {
  newSecret, parseSecret, secretHash, csrfFor, csrfOk, rlId, normaliseEmail,
  sessionCookie, clearSessionCookie, readSessionCookie, authOrigins, isAuthOrigin,
  SESSION_TTL, COOKIE_NAME,
} from '../src/auth.js';

const PEPPER = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';     // 32 × 0x42
const SID    = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';     // bytes 00..1f
const env    = { AUTH_PEPPER: PEPPER };

describe('auth.js — known answers', () => {
  it('session/token hash = BLAKE3(32 raw bytes), hex', () => {
    expect(secretHash(SID)).toBe('e528e95798037df410543d9f31e396ecdd458d71b157d6014398bae32fb56c65');
  });
  it('X-CSRF = BLAKE3-keyed(HKDF(pepper, "refueler.share.csrf.v1"‖0), tag‖0‖sid)', async () => {
    expect(await csrfFor(env, SID)).toBe('2Nid8LnqeyljGfO-z7Gem8Kr4ASgzHcE9D3LquBiS2c');
  });
  it('rate-limit id = BLAKE3-keyed(HKDF(pepper, "refueler.share.rl.v1"‖0), tag‖0‖scope‖0‖value)', async () => {
    expect(await rlId(env, 'magic_ip', '203.0.113.7'))
      .toBe('260a457fb9004da09f7b0778e7389052b07f9f9534847543e6aede523eb31d51');
  });
});

describe('auth.js — secrets', () => {
  it('newSecret is 32 random bytes, b64url, never repeats', () => {
    const a = newSecret(), b = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parseSecret(a)).toHaveLength(32);
    expect(a).not.toBe(b);
  });
  it('parseSecret refuses wrong length, padding and non-b64url', () => {
    expect(parseSecret(SID.slice(1))).toBeNull();
    expect(parseSecret(SID + '=')).toBeNull();
    expect(parseSecret(SID.slice(0, 42) + '+')).toBeNull();
    expect(parseSecret(null)).toBeNull();
    expect(secretHash('nope')).toBeNull();
  });
});

describe('auth.js — CSRF and rate-limit ids fail closed', () => {
  it('no pepper / short pepper → null', async () => {
    expect(await csrfFor({}, SID)).toBeNull();
    expect(await csrfFor({ AUTH_PEPPER: 'QUJD' }, SID)).toBeNull();
    expect(await rlId({}, 'magic_ip', '1.2.3.4')).toBeNull();
  });
  it('csrfOk: right value passes; wrong, absent, other session fail', async () => {
    const good = await csrfFor(env, SID);
    expect(await csrfOk(env, SID, good)).toBe(true);
    expect(await csrfOk(env, SID, good.slice(0, 42) + (good[42] === 'A' ? 'B' : 'A'))).toBe(false);
    expect(await csrfOk(env, SID, undefined)).toBe(false);
    expect(await csrfOk(env, newSecret(), good)).toBe(false);
    expect(await csrfOk({}, SID, good)).toBe(false);
  });
  it('rate-limit ids differ by scope and refuse NUL', async () => {
    expect(await rlId(env, 'magic_ip', 'x')).not.toBe(await rlId(env, 'magic_principal', 'x'));
    expect(await rlId(env, 'magic_ip', 'a\0b')).toBeNull();
  });
});

describe('auth.js — email', () => {
  it('normalises and refuses junk', () => {
    expect(normaliseEmail('  Dev@Refueler.IO ')).toBe('dev@refueler.io');
    for (const bad of ['', 'a@b', 'no-at.example', 'a b@c.io', 'a@b@c.io', 'x'.repeat(250) + '@a.io', 7, null]) {
      expect(normaliseEmail(bad)).toBeNull();
    }
  });
});

describe('auth.js — cookie (S6.5)', () => {
  it('exact attributes, host-only, no Domain', () => {
    const c = sessionCookie(SID, SESSION_TTL.citizen.absolute);
    expect(c).toBe(`__Host-rfs_session=${SID}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`);
    expect(c).not.toMatch(/Domain/i);
    expect(clearSessionCookie()).toMatch(/^__Host-rfs_session=; .*Max-Age=0$/);
  });
  it('reads exactly one well-formed cookie; duplicates and junk refused', () => {
    const req = (h) => new Request('https://w.test/', { headers: h ? { Cookie: h } : {} });
    expect(readSessionCookie(req(`a=1; ${COOKIE_NAME}=${SID}; b=2`))).toBe(SID);
    expect(readSessionCookie(req(`${COOKIE_NAME}=${SID}; ${COOKIE_NAME}=${SID}`))).toBeNull();
    expect(readSessionCookie(req(`${COOKIE_NAME}=short`))).toBeNull();
    expect(readSessionCookie(req(`rfs_session=${SID}`))).toBeNull();
    expect(readSessionCookie(req(null))).toBeNull();
  });
  it('TTL table matches S6.5', () => {
    expect(SESSION_TTL).toEqual({ citizen: { idle: 3600, absolute: 86400 }, org_admin: { idle: 1800, absolute: 28800 } });
  });
});

describe('auth.js — origins (S6.6)', () => {
  it('exact https origins only; localhost and wildcards never count', () => {
    const e = { AUTH_ORIGINS: 'https://refueler.io, https://share.refueler.io, http://localhost:8080, *' };
    expect(authOrigins(e)).toEqual(['https://refueler.io', 'https://share.refueler.io']);
    expect(isAuthOrigin(e, 'https://refueler.io')).toBe(true);
    expect(isAuthOrigin(e, 'https://refueler.io.evil.example')).toBe(false);
    expect(isAuthOrigin(e, 'http://localhost:8080')).toBe(false);
    expect(isAuthOrigin(e, null)).toBe(false);
    expect(isAuthOrigin({}, 'https://refueler.io')).toBe(false);
  });
});
