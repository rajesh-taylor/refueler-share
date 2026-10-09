// ─────────────────────────────────────────────────────────────────────────────
// api_store.js — API keys and credit pools in Supabase (KV-Fix-2 · 9 Oct 2026)
//
// Design: docs/KV-Audit-v1.md §4.2; SQL: supabase/migrations/20261009_kv_fix_2_api_keys.sql.
// KV is compromised for write (B12-SR X1), so nothing here touches KV. Supabase
// is the arbiter for authentication, spend, allocation and revocation.
//
// Key records are cached in isolate memory (never KV) for KEY_CACHE_TTL_MS, so a
// revoked key stops working within 60 s (Rajesh, 8 Oct). Pools are never cached.
// Any Supabase failure throws StoreUnavailable — callers fail closed (503).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseFetch } from './utils.js';

export const KEY_CACHE_TTL_MS = 60_000;
const KEY_CACHE_MAX = 1000;
const keyCache = new Map(); // key_hash hex → { record | null, at }

export class StoreUnavailable extends Error {}

async function rpc(env, fn, args) {
  let res;
  try {
    res = await supabaseFetch(env, 'POST', `/rest/v1/rpc/${fn}`, args);
  } catch (e) {
    throw new StoreUnavailable(`${fn}: ${e?.message ?? e}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new StoreUnavailable(`${fn}: ${res.status} ${detail.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * lookupApiKey(env, keyHashHex) → { sign_key_hash, org_account_id, rail, sandbox, created_at, expires_at } | null
 * null = unknown, revoked (past grace) or expired. Cached ≤ 60 s per isolate.
 */
export async function lookupApiKey(env, keyHashHex) {
  const now = Date.now();
  const hit = keyCache.get(keyHashHex);
  if (hit && now - hit.at < KEY_CACHE_TTL_MS) return hit.record;
  const record = await rpc(env, 'api_key_lookup', { p_key_hash: keyHashHex });
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(keyHashHex, { record, at: now });
  return record;
}

/** Drop a key from this isolate's cache (admin revoke; tests). */
export function forgetApiKey(keyHashHex) {
  if (keyHashHex === undefined) keyCache.clear();
  else keyCache.delete(keyHashHex);
}

export async function createApiKey(env, { keyHash, signKeyHash, org, rail, sandbox, expiresAt = null, label = null }) {
  await rpc(env, 'api_key_create', {
    p_key_hash: keyHash, p_sign_key_hash: signKeyHash, p_org: org, p_rail: rail,
    p_sandbox: sandbox, p_expires_at: expiresAt, p_label: label,
  });
}

/** → org uuid, or null if the key is unknown. */
export async function revokeApiKey(env, keyHashHex) {
  const org = await rpc(env, 'api_key_revoke', { p_key_hash: keyHashHex });
  forgetApiKey(keyHashHex);
  return org;
}

/** Admin lookup regardless of state → { org_account_id, rail, sandbox, active } | null. */
export async function apiKeyOrg(env, keyHashHex) {
  return rpc(env, 'api_key_org', { p_key_hash: keyHashHex });
}

/** → pool record (quota.js schema) | null. */
export async function getPool(env, org) {
  return rpc(env, 'api_pool_get', { p_org: org });
}

export async function provisionPool(env, org, { plan, allocation, overageCeiling, periodStart, periodEnd }) {
  return rpc(env, 'api_pool_provision', {
    p_org: org, p_plan: plan, p_allocation: allocation, p_overage_ceiling: overageCeiling,
    p_period_start: periodStart, p_period_end: periodEnd,
  });
}

/** → { ok, already_cancelled?, record?, code? } */
export async function cancelPool(env, org, immediate) {
  return rpc(env, 'api_pool_cancel', { p_org: org, p_immediate: Boolean(immediate) });
}

/**
 * spendCredits(env, org, cost) → { ok: true, record } | { ok: false, code, ... }
 * Atomic (row lock). Same rules as applyQuotaSpend() in quota.js.
 */
export async function spendCredits(env, org, cost) {
  return rpc(env, 'api_credits_spend', { p_org: org, p_cost: cost });
}

export async function refundCredits(env, org, cost) {
  return rpc(env, 'api_credits_refund', { p_org: org, p_cost: cost });
}

export async function poolStats(env) {
  return rpc(env, 'api_pool_stats', {});
}
