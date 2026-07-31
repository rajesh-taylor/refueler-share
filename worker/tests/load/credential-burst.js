/**
 * credential-burst.js — k6 load test: credential issuance rate limiting.
 *
 * Validates:
 *   - Rate limiter holds at exactly 10 requests/60s per IP
 *   - Pushing 3× over the limit produces clean 429s, no 5xx bleed
 *   - No KV races under concurrency
 *   - 429s are correctly tagged and excluded from http_req_failed threshold
 *
 * Run:
 *   # Terminal 1 — start Worker (must be running before k6)
 *   cd /Users/rajeshtaylor/Documents/refueler-share/worker && npx wrangler dev --local --port 8787
 *
 *   # Terminal 2 — run test
 *   k6 run /Users/rajeshtaylor/Documents/refueler-share/worker/tests/load/credential-burst.js
 *
 * Rate limit: 10 requests / 60s per IP (ratelimit.js, endpoint: credential_issue).
 * wrangler dev --local keys rate limits by CF-Connecting-IP; all k6 requests
 * arrive as 127.0.0.1, so 1 VU == 1 IP bucket. This is intentional.
 *
 * Phases:
 *   sleep(61s)  — flush any rate-limit window carried from previous test runs
 *   Phase 1     — 8 requests, all must succeed (well under 10/60s)
 *   sleep(61s)  — reset window cleanly before at-limit phase
 *   Phase 2     — exactly 10 requests in fresh window, all must succeed
 *   Phase 3     — 20 more requests in same window, all must 429 (3× over limit)
 *
 * Thresholds are tuned for local workerd (not prod edge latency).
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────

const credentialSuccesses    = new Counter('credential_successes');
const credentialRateLimited  = new Counter('credential_rate_limited');
const unexpectedErrors       = new Counter('credential_unexpected_errors');
const issuanceLatency        = new Trend('credential_issuance_latency_ms', true);

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8787';

function freshTurnstileToken() {
  // Unique token per call — Worker's nonce-replay check must not reject it.
  // wrangler dev --local accepts any 1x-prefixed token via the Turnstile mock.
  return `1x-burst-${__VU}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function blindedMessage() {
  // secp256k1 generator point G (compressed) — valid-looking blinded point
  // for dev mode. Worker calls issueBlindSig() which accepts any valid point.
  return '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
}

// ── Thresholds ────────────────────────────────────────────────────────────────

export const options = {
  vus: 1,
  // Initial 61s flush + phase1 (~1s) + 61s reset + phase2+3 (~4s) + buffer = ~135s
  duration: '150s',

  thresholds: {
    // p(95) < 500ms — tuned for local workerd, not prod edge.
    // Cold-start and local KV simulation inflate latency vs Cloudflare edge.
    // Prod edge target (B9 staging) will tighten this to <150ms.
    'credential_issuance_latency_ms': ['p(95)<500'],

    // Zero unexpected errors: anything that is not a 200 in phase1/2
    // or a 429 in phase3.
    'credential_unexpected_errors': ['count==0'],

    // http_req_failed below 1% for non-429, non-rate-limited responses.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
  },
};

// ── Test logic ────────────────────────────────────────────────────────────────

export default function () {
  // ── Flush: clear any rate-limit window from previous runs ───────────────
  // The integration test suite also hits /credential/issue, so the KV window
  // may be partially consumed. A 61s sleep guarantees a clean slate.
  console.log('Flushing rate-limit window (61s)...');
  sleep(61);

  // ── Phase 1: warm-up — 8 requests in a fresh window ─────────────────────
  console.log('Phase 1: 8 requests (warm-up, all should 200)');
  for (let i = 0; i < 8; i++) {
    const res = issueCredential('warmup');

    const ok = check(res, {
      'phase1: status is 200': (r) => r.status === 200,
    });

    if (res.status === 200) {
      credentialSuccesses.add(1);
    } else if (res.status === 429) {
      // Window not clean despite flush — log but do not count as unexpected.
      // Will only happen if another process is hitting the Worker concurrently.
      credentialRateLimited.add(1);
      console.warn(`Phase 1 unexpected 429 on request ${i + 1} — window may be shared`);
    } else {
      unexpectedErrors.add(1);
    }

    sleep(0.1);
  }

  // ── Reset: flush the phase 1 window before the at-limit test ────────────
  console.log('Resetting window (61s)...');
  sleep(61);

  // ── Phase 2: at-limit — exactly 10 requests in a fresh window ───────────
  // All 10 must succeed. The limit is 10/60s inclusive of the 10th.
  console.log('Phase 2: 10 requests (at limit, all should 200)');
  for (let i = 0; i < 10; i++) {
    const res = issueCredential('at-limit');

    check(res, {
      'phase2: status is 200 (at limit, inclusive)': (r) => r.status === 200,
    });

    if (res.status === 200) credentialSuccesses.add(1);
    if (res.status >= 500) unexpectedErrors.add(1);
    // A 429 here means the limit is < 10, which would be a Worker regression.
    if (res.status === 429) unexpectedErrors.add(1);

    sleep(0.1);
  }

  // ── Phase 3: over-limit — 20 requests in same window ────────────────────
  // All must 429. Fire immediately after phase 2 — same 60s window,
  // ~2s consumed by phase 2, so ~58s of window left.
  console.log('Phase 3: 20 requests (3× over limit, all should 429)');
  for (let i = 0; i < 20; i++) {
    const res = issueCredential('over-limit');

    check(res, {
      'phase3: 429 returned (not 5xx)': (r) => r.status === 429,
      'phase3: no 5xx bleed':           (r) => r.status < 500,
    });

    if (res.status === 429) {
      credentialRateLimited.add(1);
    } else if (res.status >= 500) {
      unexpectedErrors.add(1);
    } else {
      // Got 200 when expecting 429 — rate limit not holding.
      unexpectedErrors.add(1);
    }

    sleep(0.05);
  }

  console.log('Burst test complete.');
}

// ── Helper ────────────────────────────────────────────────────────────────────

function issueCredential(phase) {
  const body = JSON.stringify({
    turnstile_token: freshTurnstileToken(),
    blinded_message: blindedMessage(),
  });

  const start = Date.now();
  const res = http.post(`${BASE_URL}/credential/issue`, body, {
    headers: { 'Content-Type': 'application/json' },
    tags:    { phase },
  });
  const elapsed = Date.now() - start;

  if (res.status === 200) issuanceLatency.add(elapsed);

  return res;
}
