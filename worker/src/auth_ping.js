/**
 * auth_ping.js — GET /api/v1/auth/ping
 *
 * Lightweight HMAC-authenticated liveness/identity check used by the
 * Harbourmaster client dashboard on login. Returns the rail + tier for
 * the presenting API key so the dashboard can gate features correctly.
 *
 * Auth: reuses verifyApiRequest() from api_auth.js (canonical HMAC-SHA256
 * over method + path + timestamp + body_hash, rfs_sign_ signing key).
 *
 * KV lookup: api_key_{sha256hex(rfs_live_)} → { tier, rail, active, created_at }
 * Written at credential issuance (POST /api/v1/credential/issue, SW2/SW2a).
 *
 * Response (200):
 *   { ok: true, tier: "api", rail: "identity" | "anonymous" }
 *
 * Error responses:
 *   401 — HMAC invalid / timestamp stale / key not found
 *   403 — key exists but active: false (suspended)
 *   500 — KV read failure
 *
 * Do-not-retry (SW5a):
 *   - Never return tier !== "api" as OK — this endpoint is API-tier-only.
 *     Sovereign/Citizen keys get 403, not a degraded 200.
 *   - Never proxy Supabase on this path — KV only.
 *   - Never log rfs_live_ value to AE — log apiKeyHash only.
 */

import { verifyApiRequest } from './api_auth.js';

/**
 * handleAuthPing
 *
 * @param {Request} request
 * @param {object} env  — Worker bindings (STATUS_KV, AE)
 * @returns {Response}
 */
export async function handleAuthPing(request, env) {
  // ── 1. HMAC verification ────────────────────────────────────────────────
  // verifyApiRequest resolves the rfs_live_ key from the Authorization header,
  // derives the canonical signing string, and validates the HMAC.
  // Returns { valid, apiKeyHash, liveKey } or { valid: false }.
  let authResult;
  try {
    authResult = await verifyApiRequest(request, env);
  } catch (e) {
    return jsonError(500, 'auth_check_failed', 'Internal error during auth verification.');
  }

  if (!authResult.valid) {
    return jsonError(401, 'unauthorized', 'Invalid or missing HMAC signature.');
  }

  const { apiKeyHash } = authResult;

  // ── 2. KV lookup ─────────────────────────────────────────────────────────
  // Key written by POST /api/v1/credential/issue (SW2a).
  // Shape: { tier, rail, active, created_at, quota_bytes }
  let record;
  try {
    const raw = await env.STATUS_KV.get(`api_key_${apiKeyHash}`);
    if (!raw) {
      // Key hash not found — issued key that was never activated, or wrong env.
      return jsonError(401, 'key_not_found', 'API key not found.');
    }
    record = JSON.parse(raw);
  } catch (e) {
    return jsonError(500, 'kv_read_failed', 'Could not read key record.');
  }

  // ── 3. Active gate ────────────────────────────────────────────────────────
  if (!record.active) {
    logPingEvent(env, apiKeyHash, 'ping_rejected_suspended');
    return jsonError(403, 'key_suspended', 'This API key has been suspended.');
  }

  // ── 4. Tier gate — API-tier only ─────────────────────────────────────────
  // Dashboard is API-tier only (SW5a scope). Sovereign/Citizen keys may hold
  // a valid HMAC but are not admitted here. A Sovereign holder never gets an
  // API keypair, so this is defence-in-depth — not expected to fire in prod.
  if (record.tier !== 'api') {
    logPingEvent(env, apiKeyHash, 'ping_rejected_wrong_tier');
    return jsonError(403, 'api_tier_required',
      'The Harbourmaster dashboard requires an API-tier credential.');
  }

  // ── 5. Success ────────────────────────────────────────────────────────────
  logPingEvent(env, apiKeyHash, 'ping_ok');

  return new Response(JSON.stringify({
    ok:   true,
    tier: record.tier,                          // "api"
    rail: record.rail,                          // "identity" | "anonymous"
  }), {
    status: 200,
    headers: corsHeaders(),
  });
}

// ── CORS preflight ────────────────────────────────────────────────────────────
// Dashboard is served from dashboard.share.refueler.io (Cloudflare Pages).
// Worker is at api.share.refueler.io. Cross-origin preflight needed.
export function handleAuthPingOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  'https://dashboard.share.refueler.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Refueler-Timestamp, X-Refueler-Key',
    'Cache-Control':                'no-store',
  };
}

/**
 * Fire-and-forget AE log. Never awaited — never control flow.
 * Logs apiKeyHash (never the raw rfs_live_ value).
 */
function logPingEvent(env, apiKeyHash, eventType) {
  try {
    env.AE.writeDataPoint({
      blobs:   [eventType, apiKeyHash],
      doubles: [Date.now() / 1000],
      indexes: ['auth_ping'],
    });
  } catch (_) {
    // AE is fire-and-forget — ignore write failures.
  }
}
