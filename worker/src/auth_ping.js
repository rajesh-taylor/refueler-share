/**
 * auth_ping.js — GET /api/v1/auth/ping
 *
 * Lightweight HMAC-authenticated liveness/identity check used by the
 * Harbourmaster client dashboard on login. Returns the rail + tier for
 * the presenting API key so the dashboard can gate features correctly.
 *
 * Auth: requireApiAuth() from api_auth.js (canonical HMAC-SHA256
 * over method + path + timestamp + body_hash, rfs_sign_ signing key).
 *
 * KV lookup: api_client_{sha256hex(rfs_live_)} → { tier, rail, active, created_at }
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

import { requireApiAuth, sha256Hex } from './api_auth.js';

/**
 * handleAuthPing
 *
 * @param {Request} request
 * @param {object} env  — Worker bindings (STATUS_KV, AE)
 * @returns {Response}
 */
export async function handleAuthPing(request, env) {
  // ── 1. HMAC verification ────────────────────────────────────────────────
  // requireApiAuth throws a Response on any auth failure — malformed header,
  // unknown key, bad sign-key hash, invalid HMAC, or stale timestamp.
  // On success returns { client, apiKey }.
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (e) {
    if (e instanceof Response) return e;
    return jsonError(500, 'auth_check_failed', 'Internal error during auth verification.');
  }

  const apiKeyHash = await sha256Hex(apiKey);

  // ── 2. Tier + active gate ─────────────────────────────────────────────────
  // requireApiAuth already rejected inactive keys. We re-read the client record
  // here only to enforce the API-tier gate — requireApiAuth does not check tier.
  // KV key: api_client_{ sha256hex(rfs_live_) } — matches api_auth.js schema.
  let record;
  try {
    const raw = await env.STATUS_KV.get(`api_client_${apiKeyHash}`);
    if (!raw) {
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
