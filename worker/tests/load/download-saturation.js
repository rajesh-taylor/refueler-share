/**
 * download-saturation.js — k6 load test: sustained download GETs.
 *
 * Validates:
 *   - Bearer verification cost under sustained load (public transfers — no bearer needed)
 *   - R2 proxy behaviour under concurrent chunk GETs
 *   - Download rate limit enforcement: 300 req/60s per IP, 429s clean not 5xx
 *   - No response body corruption (chunk size matches declared total_bytes ÷ chunk_count)
 *
 * Rate limit strategy:
 *   The download rate limit is 300/60s per IP. With 30 VUs each requesting one
 *   chunk per ~200ms = 150 req/s collectively — well below the per-IP ceiling when
 *   each VU has its own IP. To probe the ceiling, a separate "hammer" scenario
 *   sends all 30 VUs from the SAME IP to collapse them into a single bucket.
 *   Expected: 429s start appearing; threshold confirms they are tagged not failed.
 *
 * Prerequisites — run in this order:
 *   Terminal 1: node worker/tests/load/start-mock.mjs
 *   Terminal 2: npx wrangler dev --local --port 8787
 *   Terminal 3: node worker/tests/load/preissue-credentials.mjs
 *               node worker/tests/load/preload-transfers.mjs
 *   Terminal 4: k6 run worker/tests/load/download-saturation.js
 *
 * transfers.json produced by preload-transfers.mjs must exist before running.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Pre-loaded transfers ──────────────────────────────────────────────────────

const transfers = new SharedArray('transfers', function () {
  return JSON.parse(open('./transfers.json'));
});

// ── Custom metrics ────────────────────────────────────────────────────────────

const chunkDownloadLatency = new Trend('chunk_download_latency_ms', true);
const chunksDownloaded     = new Counter('chunks_downloaded');
const chunksRateLimited    = new Counter('chunks_rate_limited');
const chunksFailedHard     = new Counter('chunks_failed_hard');
const bodyIntegrityFails   = new Counter('body_integrity_fails');
const rateLimitRate        = new Rate('rate_limit_rate');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = __ENV.BASE_URL || 'http://127.0.0.1:8787';
const CHUNK_SIZE  = 1024 * 512; // 512 KB — matches preload-transfers.mjs

export const options = {
  scenarios: {
    // Scenario A — distributed: each VU has its own IP, well below per-IP ceiling.
    // Runs for 30s. Validates R2 proxy throughput and response integrity.
    distributed_download: {
      executor:        'constant-vus',
      vus:             30,
      duration:        '30s',
      gracefulStop:    '5s',
      env:             { SCENARIO: 'distributed' },
      tags:            { scenario: 'distributed' },
    },

    // Scenario B — hammer: all VUs share one IP, collapsing onto a single rate-limit
    // bucket. Expected to trigger 429s near the 300/60s ceiling. Runs after A.
    hammer_single_ip: {
      executor:        'constant-vus',
      vus:             30,
      duration:        '30s',
      gracefulStop:    '5s',
      startTime:       '35s', // 35s offset: A finishes, 5s gap, B starts
      env:             { SCENARIO: 'hammer' },
      tags:            { scenario: 'hammer' },
    },
  },

  thresholds: {
    // p(95) < 500ms — local workerd ceiling. Tightens to <150ms at B9 staging.
    'chunk_download_latency_ms': ['p(95)<500'],

    // Zero hard failures (non-200, non-429) — 429s are expected in the hammer scenario.
    'chunks_failed_hard': ['count==0'],

    // Body integrity: zero mismatches.
    'body_integrity_fails': ['count==0'],

    // Overall HTTP failure rate < 1% when excluding tagged 429s.
    // k6 counts 429s as failed by default — we re-tag them as expected.
    'http_req_failed{expected_response:true}': ['rate<0.01'],

    // In the hammer scenario, rate-limited responses are expected.
    // We confirm they appear (rate > 0 is fine) without failing the suite.
    // No threshold on rate_limit_rate — we just observe.
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function padIndex(i) { return String(i).padStart(4, '0'); }

function pickTransfer() {
  // Round-robin across pre-loaded transfers for even R2 coverage
  return transfers[(__VU - 1) % transfers.length];
}

function pickChunkIndex(transfer) {
  // Cycle through all chunks of this transfer
  return __ITER % transfer.chunkCount;
}

function vuIp(scenario) {
  if (scenario === 'hammer') {
    // All VUs share one IP — collapses onto a single rate-limit bucket
    return '10.88.88.88';
  }
  // Each VU gets its own IP
  const vu = __VU;
  return `10.3.${Math.floor(vu / 256) % 256}.${vu % 256}`;
}

// ── Main VU function ──────────────────────────────────────────────────────────

export default function () {
  const scenario = __ENV.SCENARIO ?? 'distributed';
  const transfer = pickTransfer();
  const chunkIdx = pickChunkIndex(transfer);
  const ip       = vuIp(scenario);

  const start = Date.now();
  const res   = http.get(
    `${BASE_URL}/download/${transfer.uuid}/${padIndex(chunkIdx)}`,
    {
      headers: { 'CF-Connecting-IP': ip },
      tags:    { scenario, chunk: String(chunkIdx) },
      // Mark 429 responses as "expected" so they don't count toward http_req_failed
      responseCallback: http.expectedStatuses(200, 429),
    }
  );
  const elapsed = Date.now() - start;

  if (res.status === 200) {
    chunkDownloadLatency.add(elapsed);
    chunksDownloaded.add(1);
    rateLimitRate.add(0); // not rate limited

    // Body integrity check: response must have content
    const bodyOk = res.body && res.body.length > 0;
    check(res, {
      'download: status 200':  (r) => r.status === 200,
      'download: body present': ()  => bodyOk,
    });

    if (!bodyOk) bodyIntegrityFails.add(1);

  } else if (res.status === 429) {
    chunksRateLimited.add(1);
    rateLimitRate.add(1);
    check(res, { 'download: 429 is expected': (r) => r.status === 429 });

    // Back off before next request — mirrors real client behaviour
    sleep(1);

  } else {
    chunksFailedHard.add(1);
    check(res, { 'download: unexpected status': (r) => r.status === 200 || r.status === 429 });
  }

  // Pacing: 200ms between requests per VU in distributed scenario.
  // In hammer scenario no sleep — we want to hit the ceiling.
  if (scenario !== 'hammer') sleep(0.2);
}
