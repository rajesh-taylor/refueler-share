// test/ratelimit.test.js
// Unit tests for worker/src/ratelimit.js
//
// Covers:
//   checkRateLimit — happy path, window sliding, limit enforcement,
//                    KV unavailable (fail open), KV read error (fail open),
//                    KV write error (non-fatal), resetAt calculation
//   getClientIp   — CF header present, CF header absent
//   rateLimitResponse — status, headers, body shape

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkRateLimit, getClientIp, rateLimitResponse } from 'src/ratelimit.js';
import { makeEnv, makeKv } from './helpers/kv-mock.js';

// ─── Time helpers ────────────────────────────────────────────────────────────

function freezeTime(ms) {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
}

function advanceTimeTo(ms) {
  vi.spyOn(Date, 'now').mockReturnValue(ms);
}

// ─── Constants ───────────────────────────────────────────────────────────────

const IP = '1.2.3.4';
const ENDPOINT = 'credential_issue';
const MAX = 3;       // low limit for test speed
const WINDOW = 60;   // seconds

const T0 = 1_000_000_000_000; // arbitrary base timestamp (ms)

// ─────────────────────────────────────────────────────────────────────────────
// checkRateLimit
// ─────────────────────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
    freezeTime(T0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('allows first request and returns limited:false', async () => {
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(MAX - 1); // one slot consumed
  });

  it('accumulates requests and tracks remaining correctly', async () => {
    // Two requests at T0 — remaining should be MAX-2 = 1
    await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(1);
  });

  it('blocks request at exactly maxRequests', async () => {
    // Fill up to limit
    for (let i = 0; i < MAX; i++) {
      await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    }
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('slides the window — requests older than windowSeconds fall out', async () => {
    // Fill up to limit at T0
    for (let i = 0; i < MAX; i++) {
      await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    }

    // Advance time past the window so all T0 timestamps are stale
    advanceTimeTo(T0 + (WINDOW + 1) * 1000);

    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    // All old timestamps dropped — this is a fresh first request
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(MAX - 1);
  });

  it('slides partially — only stale timestamps drop out', async () => {
    // 2 requests at T0, 1 at T0 + 30s
    await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);

    advanceTimeTo(T0 + 30_000);
    await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW); // 3rd req

    // Now advance past the T0 window (T0 + 65s) — first 2 drop out, 30s one stays
    advanceTimeTo(T0 + 65_000);
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    // Only the 30s req remains → remaining = MAX - 1 - 1 = 1
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(1);
  });

  it('uses separate KV keys per endpoint', async () => {
    // Fill credential_issue to limit
    for (let i = 0; i < MAX; i++) {
      await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    }
    // upload endpoint is untouched — should be allowed
    const result = await checkRateLimit(env, IP, 'upload', MAX, WINDOW);
    expect(result.limited).toBe(false);
  });

  it('uses separate KV keys per IP', async () => {
    // Fill up for 1.2.3.4
    for (let i = 0; i < MAX; i++) {
      await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    }
    // Different IP is unaffected
    const result = await checkRateLimit(env, '5.6.7.8', ENDPOINT, MAX, WINDOW);
    expect(result.limited).toBe(false);
  });

  it('fails open when STATUS_KV is not present', async () => {
    const degradedEnv = makeEnv({ STATUS_KV: undefined });
    const result = await checkRateLimit(degradedEnv, IP, ENDPOINT, MAX, WINDOW);
    expect(result.limited).toBe(false);
    expect(result.remaining).toBe(MAX);
  });

  it('fails open on KV read error', async () => {
    // Corrupt the stored value so JSON.parse throws
    env.STATUS_KV._store.set(`rl:${ENDPOINT}:${IP}`, '{INVALID}');
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    // ratelimit.js catches and returns fail-open
    expect(result.limited).toBe(false);
  });

  it('is non-fatal when KV write fails — request still allowed', async () => {
    env.STATUS_KV.simulatePutError();
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    // Request proceeds despite failed write
    expect(result.limited).toBe(false);
  });

  it('returns a resetAt in the future (unix seconds)', async () => {
    await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    const result = await checkRateLimit(env, IP, ENDPOINT, MAX, WINDOW);
    const nowSec = Math.floor(T0 / 1000);
    expect(result.resetAt).toBeGreaterThan(nowSec);
    // resetAt is within the window from now
    expect(result.resetAt).toBeLessThanOrEqual(nowSec + WINDOW + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getClientIp
// ─────────────────────────────────────────────────────────────────────────────

describe('getClientIp', () => {
  it('returns CF-Connecting-IP header value when present', () => {
    const req = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '203.0.113.1' },
    });
    expect(getClientIp(req)).toBe('203.0.113.1');
  });

  it('returns "unknown" when CF-Connecting-IP is absent', () => {
    const req = new Request('https://example.com');
    expect(getClientIp(req)).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rateLimitResponse
// ─────────────────────────────────────────────────────────────────────────────

describe('rateLimitResponse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns status 429', () => {
    const req = new Request('https://example.com');
    const resetAt = Math.floor(Date.now() / 1000) + 30;
    const res = rateLimitResponse(req, resetAt);
    expect(res.status).toBe(429);
  });

  it('includes Retry-After header with a positive value', () => {
    freezeTime(T0);
    const req = new Request('https://example.com');
    const resetAt = Math.floor(T0 / 1000) + 45;
    const res = rateLimitResponse(req, resetAt);
    const retryAfter = parseInt(res.headers.get('Retry-After'), 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(45);
  });

  it('includes X-RateLimit-Reset header matching resetAt', () => {
    const req = new Request('https://example.com');
    const resetAt = 9999999;
    const res = rateLimitResponse(req, resetAt);
    expect(res.headers.get('X-RateLimit-Reset')).toBe('9999999');
  });

  it('merges CORS headers when provided', () => {
    const req = new Request('https://example.com');
    const res = rateLimitResponse(req, 9999999, {
      'Access-Control-Allow-Origin': '*',
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('body is JSON with error and retryAfter fields', async () => {
    freezeTime(T0);
    const req = new Request('https://example.com');
    const resetAt = Math.floor(T0 / 1000) + 20;
    const res = rateLimitResponse(req, resetAt);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('retryAfter');
    expect(typeof body.retryAfter).toBe('number');
  });
});
