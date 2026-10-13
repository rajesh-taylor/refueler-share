// ─────────────────────────────────────────────────────────────────────────────
// quota_store.js — storage quota (occupancy) in Supabase (B12-3 · 11 Oct 2026)
//
// Design: docs/B12-spec-v1.1.md §1 + docs/B12-SR-spec-v1.md S1 (SR wins).
// SQL: supabase/migrations/20261011_b12_3_quota.sql. Unit = 32 MiB chunks.
// Quota (chunks held at once) and credits (api_credit_pools) are two meters,
// never merged.
//
//   quota_ref = HMAC-SHA256(QUOTA_REF_KEY, utf8("refueler.share.quotaref.v1") ‖ 0x00 ‖ org16)
//
// computed ONLY from an authenticated principal (S1.4): the Chartered org from
// requireApiAuth, or the Citizen from the S6 session (B12-4a-2):
//
//   quota_ref = HMAC-SHA256(QUOTA_REF_KEY, utf8("refueler.share.quotaref.citizen.v1") ‖ 0x00 ‖ utf8(stripe_customer_id))
//
// Own tag, so a Citizen ref can never equal an org ref. No request field can
// name one. Bearer-rail principals never get one (X2).
// Nothing here touches KV. Any Supabase failure throws StoreUnavailable.
// ─────────────────────────────────────────────────────────────────────────────

import { rpc } from './api_store.js';
import { uuidToBytes, b64ToBytes, macFields } from './kvmac.js';

const MIN_SECRET_BYTES = 32;

export const QUOTAREF_TAG          = 'refueler.share.quotaref.v1';
export const CITIZEN_QUOTAREF_TAG = 'refueler.share.quotaref.citizen.v1';
export const DEFAULT_ORG_LIMIT_CHUNKS = 8_000;  // 250 GiB held at once (Rajesh, 11 Oct 2026)
export const CITIZEN_LIMIT_CHUNKS     = 3_200;  // 100 GiB held at once (Rajesh, 13 Oct 2026)
export const DEFAULT_MAX_IN_FLIGHT    = 20;     // S1.11; asked at onboarding, watched early on

const hex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** quotaRefFor(env, org) → 64 hex chars | null (QUOTA_REF_KEY missing/short, or bad org). */
export async function quotaRefFor(env, org) {
  const o = uuidToBytes(org);
  const secret = typeof env?.QUOTA_REF_KEY === 'string' ? b64ToBytes(env.QUOTA_REF_KEY) : null;
  if (!o || !secret || secret.length < MIN_SECRET_BYTES) return null;
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await macFields(key, QUOTAREF_TAG, o);
  return mac ? hex(mac) : null;
}

const CUS_RE = /^cus_[A-Za-z0-9]{1,64}$/;

/** citizenQuotaRefFor(env, stripeCustomerId) → 64 hex chars | null. */
export async function citizenQuotaRefFor(env, stripeCustomerId) {
  if (typeof stripeCustomerId !== 'string' || !CUS_RE.test(stripeCustomerId)) return null;
  const secret = typeof env?.QUOTA_REF_KEY === 'string' ? b64ToBytes(env.QUOTA_REF_KEY) : null;
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await macFields(key, CITIZEN_QUOTAREF_TAG, new TextEncoder().encode(stripeCustomerId));
  return mac ? hex(mac) : null;
}

/** → { ok, code?, limit_chunks, used_chunks, reserved_chunks } */
export async function reserveQuota(env, quotaRef, sessionHashHex, need, expiresAt) {
  return rpc(env, 'quota_reserve', {
    p_quota_ref: quotaRef, p_session_hash: sessionHashHex, p_need: need, p_expires_at: expiresAt,
  });
}

/** → { ok, converted } — idempotent. */
export async function finaliseQuota(env, sessionHashHex) {
  return rpc(env, 'quota_finalise', { p_session_hash: sessionHashHex });
}

/** → { ok, released: 'reservation'|'used'|'none', chunks } — call once per transfer (the latch winner). */
export async function releaseQuota(env, quotaRef, sessionHashHex, chunks, complete) {
  return rpc(env, 'quota_release', {
    p_quota_ref: quotaRef, p_session_hash: sessionHashHex, p_chunks: chunks, p_complete: Boolean(complete),
  });
}

export async function provisionQuota(env, quotaRef, { kind = 'chartered', limitChunks = DEFAULT_ORG_LIMIT_CHUNKS, maxInFlight = DEFAULT_MAX_IN_FLIGHT } = {}) {
  return rpc(env, 'quota_provision', {
    p_quota_ref: quotaRef, p_kind: kind, p_limit_chunks: limitChunks, p_max_in_flight: maxInFlight,
  });
}

export async function getQuota(env, quotaRef) {
  return rpc(env, 'quota_get', { p_quota_ref: quotaRef });
}

export async function quotaNow(env) {
  return rpc(env, 'quota_now', {});
}

/** rows = [{ q, used, done: [sessionHashHex…] }] → { ok, accounts, corrected, drift_chunks, skipped } */
export async function reconcileQuotaRows(env, t0, rows) {
  return rpc(env, 'quota_reconcile', { p_t0: t0, p_rows: rows });
}

/**
 * quotaBand(r) → "90–95%" style string: held (used + reserved) as a share of the
 * limit, in 5 % bands rounded down (B12-SR S5; Chartered 402 bodies carry the
 * band, never exact figures). A zero limit reads as full.
 */
export function quotaBand({ used_chunks = 0, reserved_chunks = 0, limit_chunks = 0 } = {}) {
  const held = Math.max(0, used_chunks) + Math.max(0, reserved_chunks);
  const pct  = limit_chunks > 0 ? (held / limit_chunks) * 100 : 100;
  const lo   = Math.min(95, Math.floor(pct / 5) * 5);
  return `${lo}–${lo + 5}%`;
}
