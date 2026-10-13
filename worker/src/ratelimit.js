// ─────────────────────────────────────────────────────────────────────────────
// ratelimit.js — KV-backed sliding window rate limiter
//
// Uses STATUS_KV (existing binding) — no new Cloudflare resources needed.
// Key format: rl:{endpoint}:{id}, id = rlId(endpoint, value) — a keyed BLAKE3
// pseudonym under an AUTH_PEPPER subkey (auth.js). No raw IP, email or UUID is
// ever a KV key (KV-Audit, B12-4a-2). Rotating AUTH_PEPPER resets every counter.
// A courtesy throttle, never a security gate: no pepper or KV → fail open.
// Value: JSON array of timestamps (ms) within the current window
//
// Usage:
//   const limited = await checkRateLimit(env, ip, 'credential_issue', 10, 60);
//   if (limited) return rateLimitResponse(request);
// ─────────────────────────────────────────────────────────────────────────────

import { rlId } from './auth.js';

/**
 * Sliding-window rate limiter.
 *
 * @param {object} env           - Worker env (must have STATUS_KV binding)
 * @param {string} ip            - Client IP address
 * @param {string} endpoint      - Logical endpoint name (used as part of KV key)
 * @param {number} maxRequests   - Max requests allowed within windowSeconds
 * @param {number} windowSeconds - Window size in seconds
 * @returns {Promise<{limited: boolean, remaining: number, resetAt: number}>}
 */
export async function checkRateLimit(env, ip, endpoint, maxRequests, windowSeconds) {
  if (!env.STATUS_KV) {
    // KV not available — fail open (never block in degraded state)
    return { limited: false, remaining: maxRequests, resetAt: 0 };
  }

  const id = await rlId(env, endpoint, String(ip));
  if (!id) {
    console.error('ratelimit: AUTH_PEPPER missing — limiter off');
    return { limited: false, remaining: maxRequests, resetAt: 0 };
  }
  const key = `rl:${endpoint}:${id}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  let timestamps = [];
  try {
    const raw = await env.STATUS_KV.get(key, { type: 'json' });
    if (Array.isArray(raw)) {
      // Slide the window — drop anything older than cutoff
      timestamps = raw.filter(t => t > cutoff);
    }
  } catch {
    // KV read error — fail open
    return { limited: false, remaining: maxRequests, resetAt: 0 };
  }

  const limited = timestamps.length >= maxRequests;

  if (!limited) {
    // Record this request
    timestamps.push(now);
    try {
      // TTL = windowSeconds + 10s buffer so KV auto-expires stale keys
      await env.STATUS_KV.put(key, JSON.stringify(timestamps), {
        expirationTtl: windowSeconds + 10,
      });
    } catch {
      // KV write error — non-fatal, request proceeds
    }
  }

  const remaining = Math.max(0, maxRequests - timestamps.length);
  // resetAt: when the oldest recorded request falls out of the window
  const oldest = timestamps.length > 0 ? timestamps[0] : now;
  const resetAt = Math.ceil((oldest + windowMs) / 1000); // Unix seconds

  return { limited, remaining, resetAt };
}

/**
 * Returns the client IP from CF-Connecting-IP (Cloudflare header).
 * Falls back to a fixed string if not present (local dev / no Cloudflare proxy).
 */
export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

/**
 * Builds a 429 Response with Retry-After and standard rate-limit headers.
 *
 * @param {Request} request
 * @param {number}  resetAt   - Unix timestamp (seconds) when the window resets
 * @param {object}  corsHdrs  - CORS headers object to merge in
 */
export function rateLimitResponse(request, resetAt, corsHdrs = {}) {
  const retryAfter = Math.max(1, resetAt - Math.floor(Date.now() / 1000));
  return new Response(
    JSON.stringify({ error: 'Too many requests', retryAfter }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
        'X-RateLimit-Reset': String(resetAt),
        ...corsHdrs,
      },
    }
  );
}
