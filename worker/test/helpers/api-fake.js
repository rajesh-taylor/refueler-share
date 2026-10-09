// test/helpers/api-fake.js — shared by kv_fix_2 and api_repair_1 tests.
// Fake Supabase (mirrors the SQL functions; spend uses applyQuotaSpend, which the
// SQL implements line for line), a test env, and signed-request helpers.
// Import AFTER the Worker modules (workerd pool load order, see kv_fix_2.test.js).

import { bytesToHex } from '@noble/hashes/utils';
import worker from '../../src/index.js';
import { sha256Hex } from '../../src/api_auth.js';
import { randomBase58 } from '../../src/handlers/api_admin.js';
import { applyQuotaSpend, addOneMonth } from '../../src/quota.js';
import { makeBucket, makeKV } from '../_r2_mock.js';
import { blindMessage, unblindSignature, pointFromHex } from '@cashu/cashu-ts';

export const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
export const ADMIN = 'admin-test';
export const ctx = { waitUntil() {}, passThroughOnException() {} };
export const ORIGIN = 'https://api.share.test';

// ── Fake Supabase ─────────────────────────────────────────────────────────────
export function makeSupabase() {
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
    WEBHOOK_SIGNING_MASTER_KEY: 'test-master-key',
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export async function seedClient(sb, { sandbox = false, plan = 'personal_api', allocation = 10, rail = 'identity' } = {}) {
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
