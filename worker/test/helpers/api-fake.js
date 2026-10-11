// test/helpers/api-fake.js — shared by kv_fix_2 and api_repair_1 tests.
// Fake Supabase (mirrors the SQL functions; spend uses applyQuotaSpend, which the
// SQL implements line for line), a test env, and signed-request helpers.
// Import AFTER the Worker modules (workerd pool load order, see kv_fix_2.test.js).

import { bytesToHex } from '@noble/hashes/utils';
import worker from '../../src/index.js';
import { sha256Hex } from '../../src/api_auth.js';
import { randomBase58 } from '../../src/handlers/api_admin.js';
import { applyQuotaSpend, addOneMonth } from '../../src/quota.js';
import { quotaRefFor } from '../../src/quota_store.js';
import { makeBucket, makeKV } from '../_r2_mock.js';
import { blindMessage, unblindSignature, pointFromHex } from '@cashu/cashu-ts';

export const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
export const ADMIN = 'admin-test';
export const ctx = { waitUntil() {}, passThroughOnException() {} };
export const ORIGIN = 'https://api.share.test';
export const QUOTA_REF_KEY      = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
export const UPLOAD_SESSION_KEY = 'c2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWJ5dGVzLSE=';

// ── Fake Supabase ─────────────────────────────────────────────────────────────
export function makeSupabase() {
  const keys  = new Map(); // key_hash hex → row
  const pools = new Map(); // org → pool
  const spent = new Set();
  const quota = new Map();        // quota_ref hex → account   (B12-3; mirrors 20261011_b12_3_quota.sql)
  const reservations = new Map(); // session_hash hex → { q, chunks, expires_at }
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
    // ── B12-3 quota: same rules as the SQL functions, single-threaded ─────────
    quota_provision({ p_quota_ref, p_kind, p_limit_chunks, p_max_in_flight }) {
      const a = quota.get(p_quota_ref) ?? { used_chunks: 0, reserved_chunks: 0 };
      Object.assign(a, { kind: p_kind, limit_chunks: p_limit_chunks, max_in_flight: p_max_in_flight, updated_at: now() });
      quota.set(p_quota_ref, a);
      return qjson(a);
    },
    quota_get({ p_quota_ref }) { const a = quota.get(p_quota_ref); return a ? qjson(a) : null; },
    quota_reserve({ p_quota_ref, p_session_hash, p_need, p_expires_at }) {
      if (!(p_need >= 1 && p_need <= 8000)) throw new Error('need out of range');
      const a = quota.get(p_quota_ref);
      if (!a) return { ok: false, code: 'quota_not_provisioned' };
      const r = refresh(p_quota_ref);
      const n = [...reservations.values()].filter(x => x.q === p_quota_ref).length;
      const fig = { limit_chunks: a.limit_chunks, used_chunks: a.used_chunks, reserved_chunks: r };
      if (n >= a.max_in_flight) return { ok: false, code: 'too_many_in_flight', ...fig };
      if (a.used_chunks + r + p_need > a.limit_chunks) return { ok: false, code: 'quota_exceeded', ...fig };
      if (reservations.has(p_session_hash)) throw new Error('duplicate session_hash');
      reservations.set(p_session_hash, { q: p_quota_ref, chunks: p_need, expires_at: p_expires_at });
      a.reserved_chunks = r + p_need; a.updated_at = now();
      return { ok: true, ...fig, reserved_chunks: a.reserved_chunks };
    },
    quota_finalise({ p_session_hash }) {
      const r = reservations.get(p_session_hash);
      if (!r) return { ok: true, converted: 0 };
      reservations.delete(p_session_hash);
      const a = quota.get(r.q);
      a.reserved_chunks = Math.max(a.reserved_chunks - r.chunks, 0); a.used_chunks += r.chunks; a.updated_at = now();
      return { ok: true, converted: r.chunks };
    },
    quota_release({ p_quota_ref, p_session_hash, p_chunks, p_complete }) {
      const a = quota.get(p_quota_ref);
      if (!a) return { ok: false, code: 'quota_not_provisioned' };
      const r = reservations.get(p_session_hash);
      if (r && r.q === p_quota_ref) {
        reservations.delete(p_session_hash);
        a.reserved_chunks = Math.max(a.reserved_chunks - r.chunks, 0); a.updated_at = now();
        return { ok: true, released: 'reservation', chunks: r.chunks };
      }
      if (p_complete) {
        const clamped = a.used_chunks < p_chunks;
        a.used_chunks = Math.max(a.used_chunks - p_chunks, 0); a.updated_at = now();
        return { ok: true, released: 'used', chunks: p_chunks, clamped };
      }
      return { ok: true, released: 'none', chunks: 0 };
    },
    quota_now() { return state.clock ?? now(); },
    quota_reconcile({ p_t0, p_rows }) {
      let accounts = 0, corrected = 0, skipped = 0, drift = 0;
      for (const [q, a] of quota) {
        accounts++;
        const e = (p_rows ?? []).find(x => x.q === q);
        const computed = e?.used ?? 0;
        if (a.updated_at < p_t0) {
          for (const h of e?.done ?? []) if (reservations.get(h)?.q === q) reservations.delete(h);
          refresh(q);
          if (a.used_chunks !== computed) { corrected++; drift += Math.abs(a.used_chunks - computed); }
          a.used_chunks = computed; a.reconciled_at = now();
        } else { skipped++; refresh(q); }
      }
      return { ok: true, accounts, corrected, drift_chunks: drift, skipped };
    },
    api_pool_stats() {
      const prod = [...pools.values()].filter(p => p.plan !== 'sandbox');
      const by_plan = {};
      for (const p of prod) by_plan[p.plan] = (by_plan[p.plan] ?? 0) + 1;
      return { provisioned: prod.length, active: prod.filter(p => p.status === 'active').length, by_plan };
    },
  };

  function qjson(a) {
    return { kind: a.kind, limit_chunks: a.limit_chunks, used_chunks: a.used_chunks,
             reserved_chunks: a.reserved_chunks, max_in_flight: a.max_in_flight };
  }
  function refresh(q) {
    const t = now();
    let r = 0;
    for (const [h, x] of reservations) {
      if (x.q !== q) continue;
      if (x.expires_at <= t) reservations.delete(h); else r += x.chunks;
    }
    quota.get(q).reserved_chunks = r;
    return r;
  }

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
      let out;
      try { out = fn(opts.body ? JSON.parse(opts.body) : {}); }
      catch (e) { return new Response(String(e.message), { status: 400 }); }
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

  return { keys, pools, spent, quota, reservations, calls, state, fetchImpl, rpcCalls: (fn) => calls.filter(c => c.path === `/rest/v1/rpc/${fn}`) };
}

export function makeEnv(overrides = {}) {
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
    SHARE_SEAL_CURRENT:      '1',
    SHARE_SEAL_KEY_1:        'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    KV_MAC_KEY:              'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=',
    QUOTA_REF_KEY,
    UPLOAD_SESSION_KEY,
    WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key',
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export async function seedClient(sb, { sandbox = false, plan = 'personal_api', allocation = 10, rail = 'identity', limitChunks = 8000, maxInFlight = 20, storageQuota = true } = {}) {
  const live = sandbox ? `rfs_test_live_${randomBase58()}` : `rfs_live_${randomBase58()}`;
  const sign = sandbox ? `rfs_test_sign_${randomBase58()}` : `rfs_sign_${randomBase58()}`;
  const org  = crypto.randomUUID();
  sb.keys.set(await sha256Hex(live), { sign_key_hash: await sha256Hex(sign), org, rail, sandbox, active: true, expires_at: null });
  const t = Math.floor(Date.now() / 1000);
  if (rail === 'identity') {
    sb.pools.set(org, { plan, allocation, remaining: allocation, overage_credits: 0, overage_ceiling: 0,
                        period_start: t, period_end: addOneMonth(t), status: 'active', updated_at: t });
    // B12-3: identity-rail orgs get a storage quota account at onboarding.
    if (storageQuota) {
      const q = await quotaRefFor({ QUOTA_REF_KEY }, org);
      sb.quota.set(q, { kind: 'chartered', limit_chunks: limitChunks, used_chunks: 0, reserved_chunks: 0,
                        max_in_flight: maxInFlight, updated_at: t - 10 });
    }
  }
  return { live, sign, org, quotaRef: rail === 'identity' && storageQuota ? await quotaRefFor({ QUOTA_REF_KEY }, org) : null };
}

export async function signedRequest(method, path, { live, sign }, body = '', extra = {}) {
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

export async function apiIssue(env, client) {
  const secret = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const { B_, r } = blindMessage(new TextEncoder().encode(secret));
  const body = JSON.stringify({ blinded_message: B_.toHex(true) });
  const res = await worker.fetch(await signedRequest('POST', '/api/v1/credential/issue', client, body), env, ctx);
  const json = await res.json();
  if (res.status !== 200) return { res, body: json };
  const C = unblindSignature(pointFromHex(json.signed_point), r, pointFromHex(json.mint_pubkey));
  return { res, body: json, credential: JSON.stringify({ id: json.keyset_id, amount: 1, secret, C: C.toHex(true) }) };
}

/** Chartered initiate, HMAC-signed by `client` (API-Repair-1). unsigned: true → no auth headers. */
export async function charteredInitiate(env, uuid, { credential, commitment, client, bytes, unsigned = false, extra = {} }) {
  const now = Math.floor(Date.now() / 1000);
  const headers = {
    'X-Cashu-Credential':      credential,
    'X-Credential-Commitment': commitment,
    'X-Issued-Tier':           'api',
    'X-Total-Chunks':          String(Math.ceil(bytes / (32 * 1024 * 1024))),
    'X-Total-Bytes':           String(bytes),
    'X-Expiry-Timestamp':      String(now + 3600),
    ...extra,
  };
  const path = `/upload/${uuid}/initiate`;
  const req = unsigned
    ? new Request(`${ORIGIN}${path}`, { method: 'POST', headers })
    : await signedRequest('POST', path, client, '', headers);
  return worker.fetch(req, env, ctx);
}
