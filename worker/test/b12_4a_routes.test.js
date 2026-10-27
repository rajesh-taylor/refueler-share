// test/b12_4a_routes.test.js
// B12-4a — sign-in routes end to end through worker.fetch, with a fake
// Supabase that mirrors supabase/migrations/20261012_b12_4a_auth.sql (the real
// SQL passed its own 30-check self-test on the live project, rolled back).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async (t) => t === 'ok'),
  verifyTurnstile:      vi.fn(async (t) => t === 'ok'),
}));
import worker from '../src/index.js';
import { secretHash, COOKIE_NAME } from '../src/auth.js';
import { signInEmailText } from '../src/mailer.js';
import { makeKv } from './helpers/kv-mock.js';

const API    = 'https://api.share.refueler.io';
const ORIGIN = 'https://refueler.io';
const PEPPER = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
const CUS    = 'cus_TESTdev0001';
const ORG    = '00000000-0000-4000-8000-0000000b124a';

// ── fake Supabase (auth functions only) ──────────────────────────────────────
function makeAuthDb() {
  const db = { down: false, principals: new Map(), tokens: new Map(), sessions: new Map(), entitlements: new Map() };
  const now = () => Math.floor(Date.now() / 1000);
  const exists = (k, r) => [...db.principals.values()].flat().some(p => p.kind === k && p.ref === r);
  const fns = {
    auth_principals_for_email: ({ p_email }) => db.principals.get(p_email.trim().toLowerCase()) ?? [],
    auth_token_issue: ({ p_token_hash, p_kind, p_ref }) => {
      if (!exists(p_kind, p_ref)) throw new Error('unknown principal');
      db.tokens.set(p_token_hash, { kind: p_kind, ref: p_ref, exp: now() + 900, used: null }); return null;
    },
    auth_token_consume: ({ p_token_hash }) => {
      const t = db.tokens.get(p_token_hash);
      if (!t || t.used !== null || t.exp <= now()) return null;
      t.used = now();
      return exists(t.kind, t.ref) ? { kind: t.kind, ref: t.ref } : null;
    },
    auth_session_create: ({ p_session_hash, p_kind, p_ref, p_idle_ttl, p_abs_ttl, p_cap }) => {
      const t = now();
      db.sessions.set(p_session_hash, { kind: p_kind, ref: p_ref, created: t, idle: t + p_idle_ttl, abs: t + p_abs_ttl, seq: db.sessions.size });
      const mine = [...db.sessions.entries()].filter(([, s]) => s.kind === p_kind && s.ref === p_ref)
        .sort((a, b) => b[1].seq - a[1].seq);
      for (const [h] of mine.slice(p_cap)) db.sessions.delete(h);
      return { created_at: t, idle_expires_at: t + p_idle_ttl, absolute_expires_at: t + p_abs_ttl };
    },
    auth_session_check: ({ p_session_hash, p_idle_ttl }) => {
      const s = db.sessions.get(p_session_hash); const t = now();
      if (!s) return null;
      if (s.idle <= t || s.abs <= t) { db.sessions.delete(p_session_hash); return null; }
      s.idle = Math.min(t + p_idle_ttl, s.abs);
      return { kind: s.kind, ref: s.ref, idle_expires_at: s.idle, absolute_expires_at: s.abs };
    },
    auth_session_delete: ({ p_session_hash }) => db.sessions.delete(p_session_hash),
    auth_session_delete_all: ({ p_session_hash }) => {
      const s = db.sessions.get(p_session_hash); if (!s) return 0;
      let n = 0;
      for (const [h, x] of db.sessions) if (x.kind === s.kind && x.ref === s.ref) { db.sessions.delete(h); n++; }
      for (const [h, x] of db.tokens) if (x.kind === s.kind && x.ref === s.ref) db.tokens.delete(h);
      return n;
    },
    auth_sweep: () => ({ tokens: 0, sessions: 0 }),
    citizen_entitlement: ({ p_ref }) => db.entitlements.get(p_ref) ?? { tier: 'free', paid: false },
  };
  db.fetchImpl = async (url, opts) => {
    const m = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (db.down || !m || !fns[m[1]]) return new Response('down', { status: 503 });
    try {
      const out = fns[m[1]](JSON.parse(opts.body ?? '{}'));
      return new Response(out === null || out === undefined ? '' : JSON.stringify(out), { status: 200 });
    } catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: 400 }); }
  };
  return db;
}

let db, env, sent, waits;
const ctx = { waitUntil: (p) => waits.push(p) };
const settle = () => Promise.all(waits.splice(0));

function makeEnv(over = {}) {
  return {
    SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'svc', TURNSTILE_SECRET_KEY: 'x',
    AUTH_PEPPER: PEPPER, AUTH_API_HOST: 'api.share.refueler.io', AUTH_ORIGINS: ORIGIN,
    AUTH_SIGNIN_URL: 'https://share.refueler.io/signin/', AUTH_MAIL_FROM: 'signin@mail.refueler.io',
    STATUS_KV: makeKv(),
    EMAIL: { send: vi.fn(async (m) => { sent.push(m); return { messageId: 'm' }; }) },
    ...over,
  };
}

beforeEach(() => {
  db = makeAuthDb(); sent = []; waits = [];
  db.principals.set('dev@refueler.io', [{ kind: 'citizen', ref: CUS }]);
  vi.stubGlobal('fetch', async (url, opts = {}) => db.fetchImpl(url, opts));
  env = makeEnv();
});
afterEach(() => vi.unstubAllGlobals());

const post = (path, body, { origin = ORIGIN, cookie, csrf, ip = '203.0.113.1', host = API } = {}) =>
  worker.fetch(new Request(`${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
      ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {}),
      ...(csrf ? { 'X-CSRF': csrf } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }), env, ctx);

const getSession = (cookie, origin = ORIGIN) => worker.fetch(new Request(`${API}/chambers/session`, {
  headers: { Origin: origin, ...(cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {}) },
}), env, ctx);

/** Request a link, return the token from the email. */
async function magicToken(email = 'dev@refueler.io', ip = '203.0.113.1') {
  const r = await post('/auth/magic', { email, turnstile_token: 'ok' }, { ip });
  await settle();
  const m = sent.at(-1)?.text.match(/#t=([A-Za-z0-9_-]{43})/);
  return { status: r.status, token: m?.[1] ?? null };
}

/** Full sign-in → { cookie, csrf, res }. */
async function signIn(ip) {
  const { token } = await magicToken('dev@refueler.io', ip);
  const res = await post('/auth/verify', { token });
  const set = res.headers.get('Set-Cookie') ?? '';
  const cookie = set.match(new RegExp(`${COOKIE_NAME}=([A-Za-z0-9_-]{43})`))?.[1];
  const body = await res.json();
  return { cookie, csrf: body.csrf, res, body, set };
}

describe('host + CORS (S6.5, S6.6)', () => {
  it('auth routes 404 off the API host (workers.dev never serves them)', async () => {
    const r = await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' },
      { host: 'https://refueler-share.rt-fc4.workers.dev' });
    expect(r.status).toBe(404);
  });
  it('preflight: exact origin gets credentials; localhost and others get nothing', async () => {
    const pre = (o) => worker.fetch(new Request(`${API}/auth/signout`, {
      method: 'OPTIONS', headers: { Origin: o, 'Access-Control-Request-Method': 'POST' } }), env, ctx);
    const good = await pre(ORIGIN);
    expect(good.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(good.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(good.headers.get('Access-Control-Allow-Headers')).toMatch(/X-CSRF/);
    for (const o of ['http://localhost:8080', 'https://evil.example', 'https://refueler.io.evil.example']) {
      const r = await pre(o);
      expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });
  it('public routes keep their CORS and never send Allow-Credentials', async () => {
    const r = await worker.fetch(new Request(`${API}/status`, { method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8080' } }), env, ctx);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8080');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});

describe('POST /auth/magic (S6.2, S6.3)', () => {
  it('202 returns before the lookup/send finishes (send held open)', async () => {
    let release; const gate = new Promise(r => { release = r; });
    env.EMAIL.send = vi.fn(async (m) => { await gate; sent.push(m); });
    const r = await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' });
    expect(r.status).toBe(202);
    expect(sent).toHaveLength(0);
    release(); await settle();
    expect(sent).toHaveLength(1);
  });
  it('known and unknown email: same status and body; only the known one gets mail', async () => {
    const a = await post('/auth/magic', { email: ' DEV@refueler.io ', turnstile_token: 'ok' });
    const b = await post('/auth/magic', { email: 'stranger@example.com', turnstile_token: 'ok' }, { ip: '203.0.113.2' });
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(await a.text()).toBe(await b.text());
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('dev@refueler.io');
    expect(sent[0].from).toBe('signin@mail.refueler.io');
    expect(sent[0].html).toBeUndefined();
  });
  it('the link carries the token in the fragment; only BLAKE3(token) is stored', async () => {
    const { token } = await magicToken();
    expect(sent[0].text).toContain(`https://share.refueler.io/signin/#t=${token}`);
    expect(sent[0].text).not.toMatch(/\?t=/);
    expect(db.tokens.has(secretHash(token))).toBe(true);
    expect([...db.tokens.keys()]).not.toContain(token);
  });
  it('refuses: wrong origin 403 · malformed email 400 · bad Turnstile 403', async () => {
    expect((await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/auth/magic', { email: 'nope', turnstile_token: 'ok' })).status).toBe(400);
    expect((await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'bad' })).status).toBe(403);
    await settle();
    expect(sent).toHaveLength(0);
  });
  it('per-IP limit: 6th request in the window → 429', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post('/auth/magic', { email: 'x@example.com', turnstile_token: 'ok' })).status);
    expect(codes).toEqual([202, 202, 202, 202, 202, 429]);
  });
  it('per-principal limit: 4th request in the hour → still 202, no 4th email', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' }, { ip: `198.51.100.${i}` })).status).toBe(202);
    }
    await settle();
    expect(sent).toHaveLength(3);
  });
  it('rate-limit keys in KV are pseudonyms: no raw IP or email', async () => {
    await magicToken();
    const keys = [...env.STATUS_KV._store.keys()].join(' ');
    expect(keys).not.toMatch(/203\.0\.113\.1|dev@refueler|cus_/);
  });
  it('no AUTH_PEPPER → nothing sent (fail closed)', async () => {
    env = makeEnv({ AUTH_PEPPER: undefined });
    const r = await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' });
    await settle();
    expect(r.status).toBe(429);
    expect(sent).toHaveLength(0);
  });
  it('one email, one link per principal, labelled', async () => {
    db.principals.set('dev@refueler.io', [{ kind: 'citizen', ref: CUS }, { kind: 'org_admin', ref: ORG }]);
    await magicToken();
    expect(sent).toHaveLength(1);
    expect(sent[0].text.match(/#t=/g)).toHaveLength(2);
    expect(sent[0].text).toMatch(/Your account:\n.*\n\nYour organisation \(admin\):/);
  });
});

describe('POST /auth/verify (S6.3–S6.5)', () => {
  it('good token → session cookie with exact flags + CSRF; ref never returned', async () => {
    const { res, body, set, cookie } = await signIn();
    expect(res.status).toBe(200);
    expect(set).toBe(`${COOKIE_NAME}=${cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`);
    expect(body.kind).toBe('citizen');
    expect(body.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(body)).not.toContain(CUS);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(db.sessions.has(secretHash(cookie))).toBe(true);
  });
  it('single use: second verify with the same token → 401', async () => {
    const { token } = await magicToken();
    expect((await post('/auth/verify', { token })).status).toBe(200);
    expect((await post('/auth/verify', { token })).status).toBe(401);
  });
  it('expired, garbage or missing token → 401; wrong origin → 403', async () => {
    const { token } = await magicToken();
    db.tokens.get(secretHash(token)).exp = 0;
    expect((await post('/auth/verify', { token })).status).toBe(401);
    expect((await post('/auth/verify', { token: 'x'.repeat(43) })).status).toBe(401);
    expect((await post('/auth/verify', {})).status).toBe(401);
    expect((await post('/auth/verify', { token }, { origin: 'http://localhost:8080' })).status).toBe(403);
  });
  it('Supabase down → 503, no cookie', async () => {
    const { token } = await magicToken();
    db.down = true;
    const r = await post('/auth/verify', { token });
    expect(r.status).toBe(503);
    expect(r.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('session, sign-out, sign-out-everywhere (S6.6, S6.7)', () => {
  it('GET /chambers/session: no cookie 401; valid → kind + same CSRF', async () => {
    expect((await getSession(null)).status).toBe(401);
    const { cookie, csrf } = await signIn();
    const r = await getSession(cookie);
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b).toMatchObject({ kind: 'citizen', csrf, tier: 'free' });
    expect(JSON.stringify(b)).not.toContain(CUS);
  });
  it('GET /chambers/session: tier citizen only when paid (B12-4a-2)', async () => {
    const { cookie } = await signIn();
    db.entitlements.set(CUS, { tier: 'citizen', paid: true });
    expect((await (await getSession(cookie)).json()).tier).toBe('citizen');
    db.entitlements.set(CUS, { tier: 'citizen', paid: false });
    expect((await (await getSession(cookie)).json()).tier).toBe('free');
  });
  it('expired session → 401 and the cookie is cleared', async () => {
    const { cookie } = await signIn();
    db.sessions.get(secretHash(cookie)).idle = 0;
    const r = await getSession(cookie);
    expect(r.status).toBe(401);
    expect(r.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
  });
  it('sign-out needs all three: cookie · X-CSRF · exact Origin', async () => {
    const { cookie, csrf } = await signIn();
    expect((await post('/auth/signout', {}, { cookie })).status).toBe(403);                         // no CSRF
    expect((await post('/auth/signout', {}, { cookie, csrf: 'A'.repeat(43) })).status).toBe(403);   // wrong CSRF
    expect((await post('/auth/signout', {}, { cookie, csrf, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/auth/signout', {}, { cookie, csrf, origin: null })).status).toBe(403);
    expect((await post('/auth/signout', {}, { csrf })).status).toBe(401);                           // no cookie
    expect(db.sessions.size).toBe(1);
    const ok = await post('/auth/signout', {}, { cookie, csrf });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    expect(db.sessions.size).toBe(0);
    expect((await getSession(cookie)).status).toBe(401);
  });
  it('sign-out-everywhere ends every session of that person', async () => {
    const a = await signIn('198.51.100.1');
    const b = await signIn('198.51.100.2');
    const c = await signIn('198.51.100.3');
    expect(db.sessions.size).toBe(3);
    expect((await post('/auth/signout-everywhere', {}, { cookie: a.cookie, csrf: a.csrf })).status).toBe(200);
    expect((await getSession(b.cookie)).status).toBe(401);
    expect((await getSession(c.cookie)).status).toBe(401);
    expect(db.sessions.size).toBe(0);
  });
});

describe('mailer + logs', () => {
  it('email text: plain, 15-minute expiry, ignore line, no-reply line', () => {
    const t = signInEmailText([{ kind: 'citizen', url: 'https://share.refueler.io/signin/#t=abc' }]);
    expect(t).toContain('expires in 15 minutes');
    expect(t).toContain("If you didn't ask for this, ignore this email.");
    expect(t).toContain('https://share.refueler.io/signin/#t=abc');
    expect(t).not.toMatch(/<|http:\/\//);
  });
  it('nothing logged contains the email, token or session id', async () => {
    const lines = [];
    const spy = (...a) => lines.push(a.map(String).join(' '));
    vi.spyOn(console, 'log').mockImplementation(spy);
    vi.spyOn(console, 'error').mockImplementation(spy);
    vi.spyOn(console, 'warn').mockImplementation(spy);
    env.EMAIL.send = vi.fn(async () => { throw new Error('boom'); });   // force the error path too
    await post('/auth/magic', { email: 'dev@refueler.io', turnstile_token: 'ok' });
    await settle();
    env.EMAIL.send = vi.fn(async (m) => { sent.push(m); });
    const { cookie } = await signIn('198.51.100.9');
    const all = lines.join('\n');
    expect(all).not.toMatch(/dev@refueler\.io|#t=/);
    expect(all).not.toContain(cookie);
    vi.restoreAllMocks();
  });
});
