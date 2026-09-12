/**
 * auth_ping.js — GET /api/v1/auth/ping
 *
 * Lightweight HMAC-authenticated liveness/identity check used by the
 * Harbourmaster client dashboard on login. Returns the rail + tier + quota
 * summary for the presenting API key so the dashboard and MCP tools can
 * gate features and warn before pool exhaustion.
 *
 * Auth: requireApiAuth() from api_auth.js (canonical HMAC-SHA256
 * over method + path + timestamp + body_hash, rfs_sign_ signing key).
 *
 * KV lookup (client record): api_client_{sha256hex(rfs_live_)} → { tier, rail, active, created_at }
 * KV lookup (quota record):  api_quota_{sha256hex(rfs_live_)}  → quota schema (quota.js)
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
 *   401 — HMAC invalid / timestamp stale / key not found
 *   403 — key exists but active: false (suspended), or wrong tier
 *   502 — KV read failure (quota record — non-fatal; ping still returns ok with quota: null)
 *   500 — unexpected internal error
 *
 * Do-not-retry:
 *   - Never return tier !== "api" as OK — API-tier-only endpoint.
 *   - Never proxy Supabase on this path — KV only.
 *   - Never log rfs_live_ value to AE — log apiKeyHash only.
 *   - Quota KV failure is non-fatal: return ping ok + quota: null rather than 502.
 *     The MCP tool degrades gracefully (shows credits as unknown, does not block a send).
 *
 * SW-MCP-W2: added quota summary fields to the identity-rail response.
 */

import { requireApiAuth, sha256Hex, kvQuotaKey } from './api_auth.js';
import { loadQuota, quotaSummary }               from './quota.js';

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

  // ── 2. Client record — tier + active gate ──────────────────────────────────
  let record;
  try {
    const raw = await env.STATUS_KV.get(`api_client_${apiKeyHash}`);
    if (!raw) return jsonError(401, 'key_not_found', 'API key not found.');
    record = JSON.parse(raw);
  } catch (e) {
    return jsonError(500, 'kv_read_failed', 'Could not read key record.');
  }

  if (!record.active) {
    logPingEvent(env, apiKeyHash, 'ping_rejected_suspended');
    return jsonError(403, 'key_suspended', 'This API key has been suspended.');
  }

  if (record.tier !== 'api') {
    logPingEvent(env, apiKeyHash, 'ping_rejected_wrong_tier');
    return jsonError(403, 'api_tier_required',
      'The Harbourmaster dashboard requires an API-tier credential.');
  }

  // ── 3. Quota summary — identity rail only ──────────────────────────────────
  // Anonymous rail: server is blind to the balance (client-held stack).
  // Quota KV failure is non-fatal — ping returns ok, quota fields set to null.
  let quota = null;
  if (record.rail === 'identity') {
    const qKey    = await kvQuotaKey(apiKey);
    const { record: qRecord, error: qError } = await loadQuota(env, qKey);

    if (qError) {
      // Non-fatal — log and continue. MCP tool will show credits as unknown.
      console.error('auth_ping: quota load failed:', qError);
    } else {
      quota = quotaSummary(qRecord);
    }
  }

  // ── 4. Success ─────────────────────────────────────────────────────────────
  logPingEvent(env, apiKeyHash, 'ping_ok');

  const responseBody = {
    ok:   true,
    tier: record.tier,   // "api"
    rail: record.rail,   // "identity" | "anonymous"
    ...(record.rail === 'identity' && quota !== null ? quota : {}),
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
