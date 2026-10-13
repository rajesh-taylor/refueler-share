// B12-4a-2 — Citizen principal at initiate (B12-SR S6.10 + S1.4), Chartered
// resolved tier, initiate credentialed CORS (S6.6), TIER_CAPS one wire name per
// tier (13 Oct 2026). Fake Supabase = test/helpers/api-fake.js + the auth and
// entitlement functions (migrations 20261012_b12_4a_auth, 20261013_b12_4a2_citizen).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import '@noble/secp256k1';
import '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { blindMessage, unblindSignature, pointFromHex } from '@cashu/cashu-ts';
import worker from '../src/index.js';
import { forgetApiKey } from '../src/api_store.js';
import { quotaRefFor, citizenQuotaRefFor, CITIZEN_LIMIT_CHUNKS } from '../src/quota_store.js';
import { openQref } from '../src/seal.js';
import { newSecret, secretHash, csrfFor } from '../src/auth.js';
import { TIER_CAPS, CHARTERED_CAP_BYTES } from '../src/manifest.js';
import { destroyTransfer } from '../src/handlers/delete_transfer.js';
import {
  makeSupabase, makeEnv as baseEnv, seedClient as seed, apiIssue, charteredInitiate, ctx, ORIGIN, QUOTA_REF_KEY,
} from './helpers/api-fake.js';

const CHUNK  = 32 * 1024 * 1024;
const GIB    = 1024 ** 3;
const PAGE   = 'https://refueler.io';
const CUS    = 'cus_TestCitizen01';
const B32    = 'q'.repeat(43);
const PEPPER = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
// Independent KAT (Node createHmac): HMAC(QUOTA_REF_KEY, "refueler.share.quotaref.citizen.v1" ‖ 0x00 ‖ "cus_TestCitizen01")
const KAT_CITIZEN_QREF = '73ade465eefbc2d28807768d8045cd961fca10faba6a41ca5bdfe89a7b7a0a57';

let sb, sessions, entitlements;
const nowS = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  sessions = new Map();       // session_hash → { kind, ref, idle, abs }
  entitlements = new Map();   // ref → { tier, paid }
  const extra = {
    auth_session_check: ({ p_session_hash }) => {
      const s = sessions.get(p_session_hash);
      if (!s || s.idle <= nowS()) return null;
      return { kind: s.kind, ref: s.ref, idle_expires_at: s.idle, absolute_expires_at: s.abs };
    },
    citizen_entitlement: ({ p_ref }) => entitlements.get(p_ref) ?? { tier: 'free', paid: false },
  };
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const m = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (m && extra[m[1]]) {
      sb.calls.push({ method: 'POST', path: `/rest/v1/rpc/${m[1]}` });
      if (sb.state.down) return new Response('down', { status: 503 });
      const out = extra[m[1]](JSON.parse(opts.body ?? '{}'));
      return new Response(out === null ? 'null' : JSON.stringify(out), { status: 200 });
    }
    return sb.fetchImpl(url, opts);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const makeEnv = (o = {}) => baseEnv({
  AUTH_PEPPER: PEPPER, AUTH_API_HOST: new URL(ORIGIN).hostname, AUTH_ORIGINS: PAGE, ...o,
});

/** A live session for `ref` → { cookie, csrf }. */
async function signIn(env, { kind = 'citizen', ref = CUS, paid = true } = {}) {
  const id = newSecret();
  sessions.set(secretHash(id), { kind, ref, idle: nowS() + 3600, abs: nowS() + 86400 });
  if (kind === 'citizen') entitlements.set(ref, { tier: 'max', paid });
  return { cookie: `__Host-rfs_session=${id}`, csrf: await csrfFor(env, id) };
}

/** Consumer issue (POST /credential/issue) → { uuid, commitment, issued_tier, credential }. */
async function issue(env, tier = 'free') {
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const { B_, r } = blindMessage(new TextEncoder().encode(secret));
  const res = await worker.fetch(new Request(`${ORIGIN}/credential/issue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: PAGE },
    body: JSON.stringify({ blinded_message: B_.toHex(true), turnstile_token: newSecret(), tier }),
  }), env, ctx);
  const j = await res.json();
  const C = unblindSignature(pointFromHex(j.signed_point), r, pointFromHex(j.mint_pubkey));
  return { ...j, credential: JSON.stringify({ id: j.keyset_id, amount: 1, secret, C: C.toHex(true) }) };
}

/** Consumer initiate. session: { cookie, csrf } | null. */
async function initiate(env, cred, { bytes = CHUNK, expiry = nowS() + 3600, session = null, csrf, origin = PAGE, url = ORIGIN } = {}) {
  const headers = {
    'X-Cashu-Credential':      cred.credential,
    'X-Credential-Commitment': cred.commitment,
    'X-Issued-Tier':           cred.issued_tier,
    'X-Total-Chunks':          String(Math.ceil(bytes / CHUNK)),
    'X-Total-Bytes':           String(bytes),
    'X-Expiry-Timestamp':      String(expiry),
  };
  if (origin) headers.Origin = origin;
  if (session) headers.Cookie = session.cookie;
  const c = csrf === undefined ? session?.csrf : csrf;
  if (c) headers['X-CSRF'] = c;
  return worker.fetch(new Request(`${url}/upload/${cred.uuid}/initiate`, { method: 'POST', headers }), env, ctx);
}

const manifestOf = (env, uuid) => JSON.parse(env.BUCKET._store.get(`${uuid}/manifest.json`).body);
const acct = () => sb.quota.get(KAT_CITIZEN_QREF);

// ─────────────────────────────────────────────────────────────────────────────
describe('TIER_CAPS — one wire name per tier', () => {
  it('free 4 GiB · max 100 GiB · api 250 GiB; Chartered cap = api', () => {
    expect(TIER_CAPS).toEqual({ free: 4 * GIB, max: 100 * GIB, api: 250 * GIB });
    expect(CHARTERED_CAP_BYTES).toBe(250 * GIB);
    expect(CITIZEN_LIMIT_CHUNKS * CHUNK).toBe(100 * GIB);
  });
});

describe('Citizen quota_ref (S1.4)', () => {
  it('known answer; own tag; fails closed', async () => {
    expect(await citizenQuotaRefFor({ QUOTA_REF_KEY }, CUS)).toBe(KAT_CITIZEN_QREF);
    expect(await citizenQuotaRefFor({}, CUS)).toBeNull();
    expect(await citizenQuotaRefFor({ QUOTA_REF_KEY }, 'not-a-customer')).toBeNull();
    expect(await citizenQuotaRefFor({ QUOTA_REF_KEY }, 'cus_x\u0000y')).toBeNull();
    expect(await quotaRefFor({ QUOTA_REF_KEY }, '00000000-0000-4000-8000-000000000001')).not.toBe(KAT_CITIZEN_QREF);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Citizen initiate (S6.10)', () => {
  it('paid session → tier max, account-of-one provisioned and reserved, qref_ct sealed', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    const cred = await issue(env, 'max');
    const res = await initiate(env, cred, { bytes: 3 * CHUNK, session: s, expiry: nowS() + 60 * 86400 });
    expect(res.status).toBe(200);
    const m = manifestOf(env, cred.uuid);
    expect(m.tier).toBe('max');
    expect(JSON.stringify(m)).not.toContain(CUS);
    expect(JSON.stringify(m)).not.toContain(KAT_CITIZEN_QREF);
    expect((await openQref(env, cred.uuid, m.qref_ct)).quotaRef).toBe(KAT_CITIZEN_QREF);
    expect(acct()).toMatchObject({ kind: 'registered', limit_chunks: CITIZEN_LIMIT_CHUNKS, reserved_chunks: 3 });
  });

  it('paid Citizen gets the 100 GiB cap; Pro Bono still 413 above 4 GiB', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    expect((await initiate(env, await issue(env, 'max'), { bytes: 5 * GIB, session: s })).status).toBe(200);
    expect((await initiate(env, await issue(env, 'max'), { bytes: 100 * GIB + 1, session: s })).status).toBe(413);
    expect((await initiate(env, await issue(env), { bytes: 5 * GIB })).status).toBe(413);
  });

  it('no cookie → Pro Bono: no session lookup, no quota, 7-day ceiling', async () => {
    const env = makeEnv();
    const cred = await issue(env, 'max');
    expect((await initiate(env, cred, { expiry: nowS() + 30 * 86400 })).status).toBe(400);
    const ok = await issue(env);
    expect((await initiate(env, ok)).status).toBe(200);
    expect(manifestOf(env, ok.uuid).tier).toBe('free');
    expect(manifestOf(env, ok.uuid).qref_ct).toBeUndefined();
    expect(sb.rpcCalls('auth_session_check')).toHaveLength(0);
    expect(sb.quota.size).toBe(0);
  });

  it('cookie without X-CSRF / wrong CSRF / wrong or missing Origin → 403, nothing spent or reserved', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    for (const o of [{ csrf: null }, { csrf: 'A'.repeat(43) }, { origin: 'https://evil.example' }, { origin: null }, { origin: 'http://localhost:8080' }]) {
      const cred = await issue(env, 'max');
      const r = await initiate(env, cred, { session: s, ...o });
      expect(r.status).toBe(403);
      expect(env.BUCKET._store.has(`${cred.uuid}/manifest.json`)).toBe(false);
    }
    expect(sb.spent.size).toBe(0);
    expect(sb.quota.size).toBe(0);
  });

  it('expired or unknown session → 401, cookie cleared, nothing spent', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    sessions.clear();
    const r = await initiate(env, await issue(env, 'max'), { session: s });
    expect(r.status).toBe(401);
    expect(r.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);
    expect(sb.spent.size).toBe(0);
  });

  it('unpaid Citizen → Pro Bono, no quota', async () => {
    const env = makeEnv();
    const s = await signIn(env, { paid: false });
    const cred = await issue(env);
    expect((await initiate(env, cred, { session: s })).status).toBe(200);
    expect(manifestOf(env, cred.uuid).tier).toBe('free');
    expect(manifestOf(env, cred.uuid).qref_ct).toBeUndefined();
    expect(sb.quota.size).toBe(0);
  });

  it('org admin session cannot upload through the page → 403', async () => {
    const env = makeEnv();
    const s = await signIn(env, { kind: 'org_admin', ref: '00000000-0000-4000-8000-0000000b124a' });
    expect((await initiate(env, await issue(env), { session: s })).status).toBe(403);
    expect(sb.spent.size).toBe(0);
  });

  it('cookie on a non-auth host is ignored (Pro Bono)', async () => {
    const env = makeEnv({ AUTH_API_HOST: 'api.share.refueler.io' });
    const s = await signIn(env);
    const cred = await issue(env);
    expect((await initiate(env, cred, { session: s })).status).toBe(200);
    expect(manifestOf(env, cred.uuid).tier).toBe('free');
  });

  it('Supabase down at the session check → 503, nothing spent', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    const cred = await issue(env, 'max');
    sb.state.down = true;
    expect((await initiate(env, cred, { session: s })).status).toBe(503);
    sb.state.down = false;
    expect(sb.spent.size).toBe(0);
  });

  it('quota full → 402 with the Citizen\'s exact figures, nothing spent', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    sb.quota.set(KAT_CITIZEN_QREF, { kind: 'registered', limit_chunks: 4, used_chunks: 3, reserved_chunks: 0, max_in_flight: 20, updated_at: 0 });
    const r = await initiate(env, await issue(env, 'max'), { bytes: 2 * CHUNK, session: s });
    expect(r.status).toBe(402);
    expect(await r.json()).toMatchObject({ code: 'quota_exceeded', held_chunks: 3, limit_chunks: 4, need_chunks: 2 });
    expect(sb.spent.size).toBe(0);
    expect(acct().limit_chunks).toBe(4);               // provision never overwrites a live account
  });

  it('finalise converts, DAD releases (one latch, one release)', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    const cred = await issue(env, 'max');
    const r = await initiate(env, cred, { bytes: 2 * CHUNK, session: s });
    const { session_token } = await r.json();
    for (let i = 0; i < 2; i++) env.BUCKET._store.set(`${cred.uuid}/${String(i).padStart(4, '0')}`, { size: CHUNK + 16, uploaded: new Date(), etag: `c${i}` });
    const pending = [];
    const fin = await worker.fetch(new Request(`${ORIGIN}/upload/${cred.uuid}/finalise`, {
      method: 'POST', headers: { 'X-Upload-Session': session_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: [B32, B32], merkle_root: B32 }),
    }), env, { waitUntil: (p) => pending.push(p), passThroughOnException() {} });
    await Promise.all(pending);
    expect(fin.status).toBe(200);
    expect(acct()).toMatchObject({ used_chunks: 2, reserved_chunks: 0 });
    await destroyTransfer(env, cred.uuid, manifestOf(env, cred.uuid), nowS(), 'DAD');
    expect(acct()).toMatchObject({ used_chunks: 0, reserved_chunks: 0 });
    expect(manifestOf(env, cred.uuid).qref_ct).toBeUndefined();   // tombstone strips it
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initiate CORS (S6.6)', () => {
  const preflight = (env, origin, url = ORIGIN) => worker.fetch(new Request(`${url}/upload/00000000-0000-4000-8000-000000000001/initiate`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf' },
  }), env, ctx);

  it('exact page origin on the auth host → credentials allowed, X-CSRF allowed', async () => {
    const r = await preflight(makeEnv(), PAGE);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(PAGE);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(r.headers.get('Access-Control-Allow-Headers')).toMatch(/X-CSRF/);
    expect(r.headers.get('Vary')).toMatch(/Origin/);
  });
  it('localhost echo never meets credentials', async () => {
    const r = await preflight(makeEnv(), 'http://localhost:8080');
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it('other origins and other hosts: no credentials', async () => {
    expect((await preflight(makeEnv(), 'https://evil.example')).headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect((await preflight(makeEnv({ AUTH_API_HOST: 'api.share.refueler.io' }), PAGE)).headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it('other routes keep the public CORS (no credentials)', async () => {
    const r = await worker.fetch(new Request(`${ORIGIN}/credential/issue`, { method: 'OPTIONS', headers: { Origin: PAGE } }), makeEnv(), ctx);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it('the initiate response itself carries credentialed CORS', async () => {
    const env = makeEnv();
    const s = await signIn(env);
    const r = await initiate(env, await issue(env, 'max'), { session: s });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(PAGE);
    expect(r.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Chartered resolved tier (B12-4a-2)', () => {
  it('HMAC-authenticated initiate → tier api, 250 GiB cap, 90-day expiry', async () => {
    const env = makeEnv();
    const c = await seed(sb, { allocation: 1e9 });
    const { body, credential } = await apiIssue(env, c);
    expect(body.allocation_bytes).toBe(250 * GIB);
    const res = await charteredInitiate(env, body.uuid, {
      credential, commitment: body.commitment, client: c, bytes: 5 * GIB,
      extra: { 'X-Expiry-Timestamp': String(nowS() + 80 * 86400) },
    });
    expect(res.status).toBe(200);
    expect(manifestOf(env, body.uuid).tier).toBe('api');
  });
});
