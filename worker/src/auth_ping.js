/**
 * auth_ping.js — GET /api/v1/auth/ping
 *
 * Lightweight HMAC-authenticated liveness/identity check used by the
 * Custom House client dashboard on login. Returns the rail + tier + quota
 * summary for the presenting API key so the dashboard and MCP tools can
 * gate features and warn before pool exhaustion.
 *
 * Auth: requireApiAuth() from api_auth.js (canonical HMAC-SHA256
 * over method + path + timestamp + body_hash, rfs_sign_ signing key).
 *
 * Client record: from requireApiAuth (Supabase api_keys, KV-Fix-2). Revoked keys
 *   fail auth (401) within 60 s; there is no separate "suspended" state.
 * Pool: Supabase api_credit_pools via api_store.getPool (quota.js schema).
 *
 * Response (200) — identity rail:
 *   {
 *     ok:                 true,
 *     tier:               "api",
 *     rail:               "identity",
 *     plan:               "identity_api" | "personal_api",
 *     allocation_credits: number,
 *     remaining_credits:  number,
 *     period_end:         number,       // unix secs
 *     overage_credits:    number,       // identity_api only
 *     overage_ceiling:    number,       // identity_api only
 *     status:             "active" | "cancelled",
 *   }
 *
 * Response (200) — anonymous rail:
 *   {
 *     ok:   true,
 *     tier: "api",
 *     rail: "anonymous",
 *     // No quota fields — balance is client-held; server is blind to it.
 *   }
 *
 * Error responses:
 *   401 — HMAC invalid / timestamp stale / key not found or revoked
 *   403 — wrong tier
 *   503 — key store unavailable (auth cannot be decided)
 *   500 — unexpected internal error
 *
 * Do-not-retry:
 *   - Never return tier !== "api" as OK — API-tier-only endpoint.
 *   - Never read the client or pool from KV (KV-Fix-2: Supabase is the arbiter).
 *   - Never log rfs_live_ value to AE — log apiKeyHash only.
 *   - Pool read failure is non-fatal: return ping ok without quota fields.
 *     The MCP tool degrades gracefully (shows credits as unknown, does not block a send).
 *
 * SW-MCP-W2: added quota summary fields to the identity-rail response.
 */

import { requireApiAuth, sha256Hex } from './api_auth.js';
import { quotaSummary }              from './quota.js';
import { getPool }                   from './api_store.js';
import { isCharteredTier }           from './tiers.js';

/**
 * handleAuthPing
 *
 * @param {Request} request
 * @param {object}  env  — Worker bindings (STATUS_KV, AE)
 * @returns {Response}
 */
export async function handleAuthPing(request, env) {
  // ── 1. HMAC verification ────────────────────────────────────────────────────
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (e) {
    if (e instanceof Response) {
      const h = new Headers(e.headers);
      h.set('Access-Control-Allow-Origin', 'https://refueler.io');
      return new Response(e.body, { status: e.status, headers: h });
    }
    return jsonError(500, 'auth_check_failed', 'Internal error during auth verification.');
  }

  const apiKeyHash = await sha256Hex(apiKey);

  // ── 2. Tier gate (F8: helper, never a literal) ──────────────────────────
  if (!isCharteredTier(client.tier)) {
    logPingEvent(env, apiKeyHash, 'ping_rejected_wrong_tier');
    return jsonError(403, 'api_tier_required',
      'The Custom House dashboard requires an API-tier credential.');
  }

  // ── 3. Quota summary — identity rail only ──────────────────────────────────
  // Anonymous rail: server is blind to the balance (client-held stack).
  // Pool read failure is non-fatal — ping returns ok without quota fields.
  let quota = null;
  if (client.rail === 'identity') {
    try {
      const pool = await getPool(env, client.org_account_id);
      if (pool) quota = quotaSummary(pool);
    } catch (e) {
      console.error('auth_ping: pool read failed:', e?.message ?? e);
    }
  }

  // ── 4. Success ─────────────────────────────────────────────────────────────
  logPingEvent(env, apiKeyHash, 'ping_ok');

  const responseBody = {
    ok:   true,
    tier: client.tier,   // "api"
    rail: client.rail,   // "identity" (anonymous closed until B7)
    ...(quota !== null ? quota : {}),
  };

  return new Response(JSON.stringify(responseBody), {
    status:  200,
    headers: corsHeaders(),
  });
}

// ── CORS preflight ─────────────────────────────────────────────────────────────
export function handleAuthPingOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  'https://refueler.io',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Refueler-Timestamp, X-Refueler-Key',
    'Cache-Control':                'no-store',
  };
}

function logPingEvent(env, apiKeyHash, eventType) {
  try {
    env.AE.writeDataPoint({
      blobs:   [eventType, apiKeyHash],
      doubles: [Date.now() / 1000],
      indexes: ['auth_ping'],
    });
  } catch (_) {
    // Fire-and-forget — ignore.
  }
}
