// KV-Fix-2 — API keys and credit pools move from KV to Supabase (9 Oct 2026).
// Design: docs/KV-Audit-v1.md §4.2. SQL: supabase/migrations/20261009_kv_fix_2_api_keys.sql
// (its own rules were checked against the live database in a rolled-back transaction).
//
//   • requireApiAuth reads Supabase only — a planted KV api_client_ record authorises nothing
//   • revocation bites within 60 s (isolate cache), and a Supabase outage is 503, never KV
//   • sandbox keys never pass a production route, and production keys never pass a sandbox one
//   • API credential issue: atomic spend before signing; refund when signing fails; sandbox 403
//   • Chartered initiate: debit after the spend INSERT; a refused debit un-spends the credential
//   • admin onboarding stores hashes only and writes nothing to KV
//
// Supabase is a fake in a stubbed fetch, mirroring the SQL functions (spend uses
// applyQuotaSpend, which the SQL implements line for line).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

// Import order mirrors commitment.test.js (the workerd pool resolves @noble/hashes
// CJS/ESM differently depending on which module loads it first).
import '@noble/secp256k1';
import '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import worker from '../src/index.js';
import { requireApiAuth, sha256Hex } from '../src/api_auth.js';
import { forgetApiKey, KEY_CACHE_TTL_MS } from '../src/api_store.js';
import { randomBase58 } from '../src/handlers/api_admin.js';
import { applyQuotaSpend, addOneMonth } from '../src/quota.js';
import { computeTransferCost } from '../src/r2_presign.js';
import { makeBucket, makeKV } from './_r2_mock.js';
// Load order matters in the workerd pool: Worker modules before @cashu/cashu-ts.
import { blindMessage, unblindSignature, pointFromHex } from '@cashu/cashu-ts';

const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
const ADMIN = 'admin-test';
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ORIGIN = 'https://api.share.test';

// ── Fake Supabase ─────────────────────────────────────────────────────────────
function makeSupabase() {
  const keys  = new Map(); // key_hash hex → row
  const pools = new Map(); // org → pool
  const spent = new Set();
  const calls = [];
  const state = { down: false };
  const now = () => Math.floor(Date.now() / 1000);

  const rpcs = {
    api_key_lookup({ p_key_hash }) {
      const k = keys.get(p_key_hash);
      const t = Date.now();
      if (!k) return null;
      if (!(k.active || (k.grace_until && k.grace_until > t))) return null;
      if (k.expires_at && k.expires_at <= t) return null;
      return { sign_key_hash: k.sign_key_hash, org_account_id: k.org, rail: k.rail, sandbox: k.sandbox,
               created_at: 1, expires_at: k.expires_at ? Math.floor(k.expires_at / 1000) : null };
    },
    api_key_create({ p_key_hash, p_sign_key_hash, p_org, p_rail, p_sandbox, p_expires_at }) {
      keys.set(p_key_hash, { sign_key_hash: p_sign_key_hash, org: p_org, rail: p_rail, sandbox: p_sandbox,
                             active: true, expires_at: p_expires_at ? Date.parse(p_expires_at) : null });
      return null;
    },
    api_key_revoke({ p_key_hash }) {
      const k = keys.get(p_key_hash);
      if (!k) return null;
      k.active = false; k.grace_until = null;
      return k.org;
    },
    api_key_org({ p_key_hash }) {
      const k = keys.get(p_key_hash);
      return k ? { org_account_id: k.org, rail: k.rail, sandbox: k.sandbox, active: k.active } : null;
    },
    api_pool_get({ p_org }) { return pools.get(p_org) ?? null; },
    api_pool_provision({ p_org, p_plan, p_allocation, p_overage_ceiling, p_period_start, p_period_end }) {
      const p = { plan: p_plan, allocation: p_allocation, remaining: p_allocation, overage_credits: 0,
                  overage_ceiling: p_plan === 'identity_api' ? p_overage_ceiling : 0,
                  period_start: p_period_start, period_end: p_period_end, status: 'active', updated_at: now() };
      pools.set(p_org, p);
      return p;
    },
    api_pool_cancel({ p_org, p_immediate }) {
      const p = pools.get(p_org);
      if (!p) return { ok: false, code: 'record_absent' };
      if (p.status === 'cancelled') return { ok: true, already_cancelled: true, record: p };
      p.status = 'cancelled'; if (p_immediate) p.remaining = 0;
      return { ok: true, already_cancelled: false, record: p };
    },
    api_credits_spend({ p_org, p_cost }) {
      const p = pools.get(p_org);
      if (!p) return { ok: false, code: 'quota_not_provisioned' };
      const { updated, response402 } = applyQuotaSpend(p, p_cost, now());
      if (response402) return { ok: false, ...response402 };
      pools.set(p_org, updated);
      return { ok: true, record: updated };
    },
    api_credits_refund({ p_org, p_cost }) {
      const p = pools.get(p_org);
      if (!p) return null;
      const back = Math.min(p.overage_credits, p_cost);
      p.overage_credits -= back;
      p.remaining = Math.min(p.allocation, p.remaining + (p_cost - back));
      return p;
    },
    api_pool_stats() {
      const prod = [...pools.values()].filter(p => p.plan !== 'sandbox');
      const by_plan = {};
      for (const p of prod) by_plan[p.plan] = (by_plan[p.plan] ?? 0) + 1;
      return { provisioned: prod.length, active: prod.filter(p => p.status === 'active').length, by_plan };
    },
  };

  async function fetchImpl(url, opts = {}) {
    const u = String(url);
    const method = opts.method ?? 'GET';
    calls.push({ method, path: u.replace('https://sb.test', ''), body: opts.body ? JSON.parse(opts.body) : null });
    if (!u.startsWith('https://sb.test')) return new Response('[]', { status: 200 });
    if (state.down) return new Response('unavailable', { status: 503 });
    const m = u.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      const fn = rpcs[m[1]];
      if (!fn) return new Response('no such rpc', { status: 404 });
      const out = fn(opts.body ? JSON.parse(opts.body) : {});
      return new Response(out === null ? 'null' : JSON.stringify(out), { status: 200 });
    }
    if (u.includes('/rest/v1/spent_tokens')) {
      if (method === 'POST') {
        const { serial } = JSON.parse(opts.body);
        if (spent.has(serial)) return new Response('dup', { status: 409 });
        spent.add(serial);
        return new Response(null, { status: 201 });
      }
      if (method === 'DELETE') {
        spent.delete(decodeURIComponent(u.split('serial=eq.')[1]));
        return new Response(null, { status: 204 });
      }
    }
    return new Response('[]', { status: 200 });
  }

  return { keys, pools, spent, calls, state, fetchImpl, rpcCalls: (fn) => calls.filter(c => c.path === `/rest/v1/rpc/${fn}`) };
}

function makeEnv(overrides = {}) {
  return {
    COMMITMENT_KEY:          'test-commitment-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    MINT_PRIVATE_KEY:        MINT_PRIVKEY_HEX,
    TURNSTILE_SECRET_KEY:    'ts',
    ADMIN_KEY:               ADMIN,
    TEST_CRED_KEY:           'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
    SUPABASE_URL:            'https://sb.test',
    SUPABASE_SERVICE_KEY:    'x',
    BUCKET:                  makeBucket(),
    STATUS_KV:               makeKV(),
    CF_ACCOUNT_ID:           'acct',
    R2_S3_ACCESS_KEY_ID:     'ak',
    R2_S3_SECRET_ACCESS_KEY: 'sk',
    R2_BUCKET_NAME:          'refueler-share-dev',
    ...overrides,
  };
}

let sb;
beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  vi.stubGlobal('fetch', sb.fetchImpl);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── Helpers ───────────────────────────────────────────────────────────────────
async function seedClient({ sandbox = false, plan = 'personal_api', allocation = 10, rail = 'identity' } = {}) {
  const live = sandbox ? `rfs_test_live_${randomBase58()}` : `rfs_live_${randomBase58()}`;
  const sign = sandbox ? `rfs_test_sign_${randomBase58()}` : `rfs_sign_${randomBase58()}`;
  const org  = crypto.randomUUID();
  sb.keys.set(await sha256Hex(live), { sign_key_hash: await sha256Hex(sign), org, rail, sandbox, active: true, expires_at: null });
  const t = Math.floor(Date.now() / 1000);
  if (rail === 'identity') {
    sb.pools.set(org, { plan, allocation, remaining: allocation, overage_credits: 0, overage_ceiling: 0,
                        period_start: t, period_end: addOneMonth(t), status: 'active', updated_at: t });
  }
  return { live, sign, org };
}

async function signedRequest(method, path, { live, sign }, body = '', extra = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256Hex(new TextEncoder().encode(body));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(sign), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${method}\n${path}\n${ts}\n${bodyHash}`)));
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      'Authorization':  `HMAC-SHA256 key=${live}, sig=${bytesToHex(mac)}, ts=${ts}`,
      'X-Api-Sign-Key': sign,
      'Content-Type':   'application/json',
      ...extra,
    },
    ...(method === 'GET' ? {} : { body }),
  });
}

async function apiIssue(env, client) {
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const { B_, r } = blindMessage(new TextEncoder().encode(secret));
  const body = JSON.stringify({ blinded_message: B_.toHex(true) });
  const res = await worker.fetch(await signedRequest('POST', '/api/v1/credential/issue', client, body), env, ctx);
  const json = await res.json();
  if (res.status !== 200) return { res, body: json };
  const C = unblindSignature(pointFromHex(json.signed_point), r, pointFromHex(json.mint_pubkey));
  return { res, body: json, credential: JSON.stringify({ id: json.keyset_id, amount: 1, secret, C: C.toHex(true) }) };
}

function charteredInitiate(env, uuid, { credential, commitment, liveKey, bytes }) {
  const now = Math.floor(Date.now() / 1000);
  return worker.fetch(new Request(`${ORIGIN}/upload/${uuid}/initiate`, {
    method: 'POST',
    headers: {
      'X-Cashu-Credential':      credential,
      'X-Credential-Commitment': commitment,
      'X-Issued-Tier':           'api',
      'X-Api-Live-Key':          liveKey,
      'X-Total-Chunks':          String(Math.ceil(bytes / (32 * 1024 * 1024))),
      'X-Total-Bytes':           String(bytes),
      'X-Expiry-Timestamp':      String(now + 3600),
    },
  }), env, ctx);
}

function admin(path, body) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'X-Admin-Key': ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('requireApiAuth — Supabase is the arbiter', () => {
  it('authenticates a key held in Supabase and returns its org', async () => {
    const c = await seedClient();
    const { client } = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), makeEnv());
    expect(client.org_account_id).toBe(c.org);
    expect(client.tier).toBe('api');
    expect(client.sandbox).toBe(false);
  });

  it('a planted KV api_client_ record authorises nothing (X1 forge)', async () => {
    const live = `rfs_live_${randomBase58()}`;
    const sign = `rfs_sign_${randomBase58()}`;
    const env = makeEnv();
    await env.STATUS_KV.put(`api_client_${await sha256Hex(live)}`, JSON.stringify({
      sign_key_hash: await sha256Hex(sign), rail: 'identity', tier: 'api', active: true,
    }));
    const res = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', { live, sign }), new ArrayBuffer(0), env).catch(r => r);
    expect(res.status).toBe(401);
  });

  it('a revoked key keeps working at most 60 s (isolate cache), then 401', async () => {
    const c = await seedClient();
    const env = makeEnv();
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env);
    sb.keys.get(await sha256Hex(c.live)).active = false; // revoked elsewhere (another isolate)

    now.mockReturnValue(t0 + KEY_CACHE_TTL_MS - 1000);
    await expect(requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env)).resolves.toBeTruthy();

    now.mockReturnValue(t0 + KEY_CACHE_TTL_MS + 1);
    const res = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env).catch(r => r);
    expect(res.status).toBe(401);
    expect(KEY_CACHE_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it('Supabase down → 503, and a KV record is never consulted as a fallback', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await env.STATUS_KV.put(`api_client_${await sha256Hex(c.live)}`, JSON.stringify({ sign_key_hash: await sha256Hex(c.sign), rail: 'identity', tier: 'api', active: true }));
    sb.state.down = true;
    const res = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env).catch(r => r);
    expect(res.status).toBe(503);
  });

  it('a sandbox key never passes a production route, nor a production key a sandbox route', async () => {
    const sbx  = await seedClient({ sandbox: true, plan: 'sandbox' });
    const prod = await seedClient();
    const a = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', sbx), new ArrayBuffer(0), makeEnv()).catch(r => r);
    expect(a.status).toBe(401);
    const b = await requireApiAuth(await signedRequest('GET', '/api/v1/sandbox/status', prod), new ArrayBuffer(0), makeEnv(), { sandbox: true }).catch(r => r);
    expect(b.status).toBe(401);
  });

  it('a production-prefixed key whose row says sandbox is refused (flag and prefix must agree)', async () => {
    const c = await seedClient();
    sb.keys.get(await sha256Hex(c.live)).sandbox = true;
    const res = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), makeEnv()).catch(r => r);
    expect(res.status).toBe(401);
  });

  it('wrong sign key → 401', async () => {
    const c = await seedClient();
    const res = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', { live: c.live, sign: `rfs_sign_${randomBase58()}` }), new ArrayBuffer(0), makeEnv()).catch(r => r);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/credential/issue — atomic spend', () => {
  it('spends one credit in Supabase before signing and reports the balance', async () => {
    const c = await seedClient({ allocation: 3 });
    const env = makeEnv();
    const { res, body } = await apiIssue(env, c);
    expect(res.status).toBe(200);
    expect(body.quota_remaining).toBe(2);
    expect(body.period_end).toBe(sb.pools.get(c.org).period_end);
    expect(sb.rpcCalls('api_credits_spend')).toHaveLength(1);
    expect(sb.rpcCalls('api_credits_spend')[0].body).toEqual({ p_org: c.org, p_cost: 1 });
  });

  it('an empty pool → 402, no signature; a planted KV balance changes nothing', async () => {
    const c = await seedClient({ allocation: 1 });
    const env = makeEnv();
    await env.STATUS_KV.put(`api_quota_${await sha256Hex(c.live)}`, JSON.stringify({ plan: 'personal_api', remaining: 1e9, period_end: 4e9, status: 'active' }));
    expect((await apiIssue(env, c)).res.status).toBe(200);
    const { res, body } = await apiIssue(env, c);
    expect(res.status).toBe(402);
    expect(body.code).toBe('quota_exhausted');
    expect(body.signed_point).toBeUndefined();
  });

  it('Supabase down at spend → 503, nothing signed', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env); // warm the key cache
    sb.state.down = true;
    const { res, body } = await apiIssue(env, c);
    expect(res.status).toBe(503);
    expect(body.signed_point).toBeUndefined();
  });

  it('a failed blind signature refunds the credit', async () => {
    const c = await seedClient({ allocation: 5 });
    const env = makeEnv({ MINT_PRIVATE_KEY: 'not-a-key' });
    const { res } = await apiIssue(env, c);
    expect(res.status).toBe(500);
    expect(sb.rpcCalls('api_credits_refund')).toHaveLength(1);
    expect(sb.pools.get(c.org).remaining).toBe(5);
  });

  it('sandbox keys are refused outright (403), before auth or any spend (F6)', async () => {
    const s = await seedClient({ sandbox: true, plan: 'sandbox', allocation: 25 });
    const { res, body } = await apiIssue(makeEnv(), s);
    expect(res.status).toBe(403);
    expect(body.code).toBe('sandbox_issue_unavailable');
    expect(res.headers.get('X-Refueler-Sandbox')).toBe('true');
    expect(sb.rpcCalls('api_key_lookup')).toHaveLength(0);
    expect(sb.rpcCalls('api_credits_spend')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Chartered initiate — debit after the spend INSERT', () => {
  const BYTES = 40 * 1024 * 1024;

  it('debits the transfer cost atomically after the credential is spent', async () => {
    const cost = computeTransferCost(BYTES);
    const c = await seedClient({ plan: 'identity_api', allocation: 1 + cost });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c);
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, liveKey: c.live, bytes: BYTES });
    expect(res.status).toBe(200);
    expect(sb.pools.get(c.org).remaining).toBe(0);
    const spends = sb.rpcCalls('api_credits_spend');
    expect(spends.at(-1).body).toEqual({ p_org: c.org, p_cost: cost });
    const insertAt = sb.calls.findIndex(x => x.method === 'POST' && x.path === '/rest/v1/spent_tokens');
    expect(sb.calls.indexOf(spends.at(-1))).toBeGreaterThan(insertAt);
  });

  it('pre-check refuses an empty pool (402) before the credential is spent', async () => {
    const c = await seedClient({ allocation: 1 });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c); // uses the only credit
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, liveKey: c.live, bytes: BYTES });
    expect(res.status).toBe(402);
    expect(sb.spent.size).toBe(0);
  });

  it('a debit lost to a concurrent spend un-spends the credential and returns 402', async () => {
    const cost = computeTransferCost(BYTES);
    const c = await seedClient({ allocation: 1 + cost });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c);
    // Another request drains the pool between the pre-check and the debit.
    const realFetch = sb.fetchImpl;
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (String(url).endsWith('/rest/v1/spent_tokens') && opts.method === 'POST') sb.pools.get(c.org).remaining = 0;
      return realFetch(url, opts);
    });
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, liveKey: c.live, bytes: BYTES });
    expect(res.status).toBe(402);
    expect(sb.calls.some(x => x.method === 'DELETE' && x.path.startsWith('/rest/v1/spent_tokens?serial=eq.'))).toBe(true);
    expect(sb.spent.size).toBe(0); // credential usable again
    expect(await env.BUCKET.get(`${body.uuid}/manifest.json`)).toBeNull();
  });

  it('an unknown live key → 402 quota_not_provisioned, credential untouched', async () => {
    const c = await seedClient({ allocation: 5 });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c);
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, liveKey: `rfs_live_${randomBase58()}`, bytes: BYTES });
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe('quota_not_provisioned');
    expect(sb.spent.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('admin onboarding + revocation (no KV)', () => {
  it('creates a client: keys shown once, only hashes stored, nothing written to KV', async () => {
    const env = makeEnv();
    const kvPut = vi.spyOn(env.STATUS_KV, 'put');
    const res = await worker.fetch(admin('/api/v1/admin/api-client', { plan: 'identity_api', label: 'test' }), env, ctx);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const b = await res.json();
    expect(b.live_key).toMatch(/^rfs_live_[1-9A-HJ-NP-Za-km-z]{40,44}$/);
    expect(b.sign_key).toMatch(/^rfs_sign_[1-9A-HJ-NP-Za-km-z]{40,44}$/);
    expect(b.pool.allocation).toBe(50_000);
    const stored = JSON.stringify(sb.calls.map(c => c.body));
    expect(stored).not.toContain(b.live_key);
    expect(stored).not.toContain(b.sign_key);
    expect(sb.keys.get(await sha256Hex(b.live_key)).org).toBe(b.org_account_id);
    expect(kvPut.mock.calls.filter(([k]) => !k.startsWith('rl:') && k !== 'admin:client_errors_log')).toHaveLength(0);
    // and the new key authenticates
    const { client } = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', { live: b.live_key, sign: b.sign_key }), new ArrayBuffer(0), env);
    expect(client.org_account_id).toBe(b.org_account_id);
  });

  it('refuses without the admin key, and refuses sandbox / unknown plans', async () => {
    const env = makeEnv();
    const bad = new Request(`${ORIGIN}/api/v1/admin/api-client`, { method: 'POST', headers: { 'X-Admin-Key': 'nope' }, body: '{}' });
    expect((await worker.fetch(bad, env, ctx)).status).toBe(401);
    expect((await worker.fetch(admin('/api/v1/admin/api-client', { plan: 'sandbox' }), env, ctx)).status).toBe(400);
    expect((await worker.fetch(admin('/api/v1/admin/api-client', { plan: 'enterprise' }), env, ctx)).status).toBe(400);
  });

  it('revoke: immediate in this isolate, 404 for an unknown key', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env); // cached
    const res = await worker.fetch(admin('/api/v1/admin/api-client/revoke', { live_key: c.live }), env, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).org_account_id).toBe(c.org);
    const after = await requireApiAuth(await signedRequest('GET', '/api/v1/capabilities', c), new ArrayBuffer(0), env).catch(r => r);
    expect(after.status).toBe(401);
    const none = await worker.fetch(admin('/api/v1/admin/api-client/revoke', { live_key: `rfs_live_${randomBase58()}` }), env, ctx);
    expect(none.status).toBe(404);
  });

  it('quota provision/cancel act on the Supabase pool of that key', async () => {
    const c = await seedClient({ plan: 'personal_api', allocation: 3 });
    const env = makeEnv();
    const p = await worker.fetch(admin('/api/v1/admin/quota/provision', { live_key: c.live, plan: 'identity_api', overage_ceiling: 100 }), env, ctx);
    expect(p.status).toBe(200);
    expect(sb.pools.get(c.org)).toMatchObject({ plan: 'identity_api', allocation: 50_000, overage_ceiling: 100 });
    const x = await worker.fetch(admin('/api/v1/admin/quota/cancel', { live_key: c.live, immediate: true }), env, ctx);
    expect(x.status).toBe(200);
    expect(sb.pools.get(c.org)).toMatchObject({ status: 'cancelled', remaining: 0 });
    const s = await seedClient({ sandbox: true, plan: 'sandbox' });
    const y = await worker.fetch(admin('/api/v1/admin/quota/provision', { live_key: await sha256Hex(s.live), plan: 'identity_api' }), env, ctx);
    expect(y.status).toBe(404); // sandbox rows are not production pools
  });

  it('auth/ping reports the Supabase pool', async () => {
    const c = await seedClient({ plan: 'personal_api', allocation: 7 });
    const res = await worker.fetch(await signedRequest('GET', '/api/v1/auth/ping', c), makeEnv(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tier: 'api', rail: 'identity', plan: 'personal_api', remaining_credits: 7 });
  });

  it('api-stats counts production pools only', async () => {
    await seedClient({ plan: 'identity_api' });
    await seedClient({ sandbox: true, plan: 'sandbox' });
    const res = await worker.fetch(new Request(`${ORIGIN}/admin/api-stats`, { headers: { 'X-Admin-Key': ADMIN } }), makeEnv(), ctx);
    const b = await res.json();
    expect(b.active_keys).toMatchObject({ provisioned: 1, active: 1, by_plan: { identity_api: 1 }, kv_available: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('sandbox on Supabase', () => {
  it('activate → status → spend to zero → 402 → reset; no KV writes, raw key never stored', async () => {
    const env = makeEnv();
    const kvPut = vi.spyOn(env.STATUS_KV, 'put');
    const act = await worker.fetch(admin('/api/v1/sandbox/activate', { rail: 'identity' }), env, ctx);
    expect(act.status).toBe(201);
    const a = await act.json();
    const cred = { live: a.live_key, sign: a.sign_key };
    expect(JSON.stringify(sb.calls.map(c => c.body))).not.toContain(a.live_key);

    const st = await worker.fetch(await signedRequest('GET', '/api/v1/sandbox/status', cred), env, ctx);
    expect(st.status).toBe(200);
    expect((await st.json()).credits).toBe(25);

    const org = sb.keys.get(await sha256Hex(a.live_key)).org;
    sb.pools.get(org).remaining = 1;
    expect((await worker.fetch(await signedRequest('POST', '/api/v1/sandbox/spend', cred), env, ctx)).status).toBe(200);
    const out = await worker.fetch(await signedRequest('POST', '/api/v1/sandbox/spend', cred), env, ctx);
    expect(out.status).toBe(402);

    const rs = await worker.fetch(admin('/api/v1/sandbox/reset', { live_key: a.live_key }), env, ctx);
    expect(rs.status).toBe(200);
    expect(sb.pools.get(org).remaining).toBe(25);
    expect(kvPut.mock.calls.filter(([k]) => !k.startsWith('rl:') && k !== 'admin:client_errors_log')).toHaveLength(0);
  });

  it('a sandbox key is refused on a production API route', async () => {
    const s = await seedClient({ sandbox: true, plan: 'sandbox' });
    const res = await worker.fetch(await signedRequest('GET', '/api/v1/auth/ping', s), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });
});

describe('randomBase58', () => {
  it('Bitcoin alphabet only, ~44 chars for 32 bytes, distinct each call', () => {
    const a = randomBase58(32), b = randomBase58(32);
    expect(a).toMatch(/^[1-9A-HJ-NP-Za-km-z]{40,44}$/);
    expect(a).not.toBe(b);
  });
});
