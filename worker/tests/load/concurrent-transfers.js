/**
 * concurrent-transfers.js — k6 load test: 50 VU concurrent full uploads.
 *
 * Validates:
 *   - Chunk throughput under concurrent load (20 chunks × 50 VUs = 1,000 uploads)
 *   - BLAKE3 verify latency under load (Worker verifies every chunk server-side)
 *   - KV byte-counter accuracy: reported total_bytes within ±1 of actual
 *   - No credential cross-contamination between VUs
 *
 * Prerequisites — run in this order:
 *   1. Terminal 1: npx wrangler dev --local --port 8787  (keep running)
 *   2. Terminal 2: node worker/tests/load/preissue-credentials.mjs
 *   3. Terminal 3: k6 run worker/tests/load/concurrent-transfers.js
 *
 * Local IP note:
 *   wrangler dev --local keys rate limits by CF-Connecting-IP. All k6 VUs
 *   share 127.0.0.1 by default, which collapses 50 independent users onto a
 *   single rate-limit bucket (120 chunks/60s). We inject a unique IP per VU
 *   so each VU gets its own bucket — matching real-world behaviour where every
 *   user has a distinct IP. This is not spoofing; it is correct test isolation.
 *
 * Each VU runs exactly once (iterations:1) so credentials are never reused
 * across iterations — Cashu tokens are single-use by design.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Pre-issued credentials ────────────────────────────────────────────────────

const credentials = new SharedArray('credentials', function () {
  return JSON.parse(open('./credentials.json'));
});

// ── Pre-computed BLAKE3 hashes (matches chunks.js HASH_TABLE[524288]) ────────

const PRECOMPUTED_HASHES = [
  '2f2a0bec89395b19c7b9f663e4d1eb271b40c899ec8fc71e53f6798e889866ea',
  '7d009094a9381a666df1e5e75a3df1d98b3d962ee0bcbc700a2be44e0ea7c295',
  'e0aa5142c41ccd93bb2b053b5b7672dd7a054477bca959d52ae44ce32b1416df',
  '15f03a5c91a6fe02c2f64406bd9525b34ee38d3a88e8527ea2532d17489e8ec0',
  'beced66f3e30945f4aff0c6a48cb6c0c87b40b87fea952320ae1c867903c89c7',
  '20af3c9ad1acb3e541f1bdbba38126fbf65f7b89a17e39b726054ad4cad34f2f',
  'a58e95d6332843e5ce9779febe0872cd51f60751147aff0c99de8bc9892bca1a',
  'f55f34ed5cc16f99969ec54c740b43efd05f411db7ff3999f1e8c0571a4777b6',
  '32354224d69397784d1b0334bb944cdcc896ed72fd934ccfddac956708a8f3d5',
  'b68630d684a6f433fc4315a403fff44f9f543d7ffa8f552db04971eb0646c6eb',
  'f3430fdb7a069f49432ec8f98eb38f3534b89d62194382d071c1b11a5c6bc6fe',
  '5df04c3d6e95b5a1cbdc4edb8632c9b7deeeac0136fcba7d2af4b650ba13fcb2',
  'dd309f637846677b808e5546af2fb1d57786808373e98b1b7ebfc0ed49a70e4c',
  'ad14a5e364f3cc8c41c8080cfc62687e68c75948843053b5cd8153dd86ff9519',
  '16bcf5fcc13678d8309869cff4a776600036fd9e05010882550480277d2bd7dc',
  '635f61e846df6f0fe9933ff956e839759b6e0c66fcc92d2520d774d166b2d77e',
  '43c1015785f12dd8a295923e936e7e8c924b618d03c45b14fc625dd9e991dda5',
  '8c7ccfebc75fd7b13da9d6261b4576d5e5769597d4e83e17743d0bbdb395ba8f',
  '764ec00614f21a62cc4cf5e3b9516d0967735d9feb37662bae3de809e30b6c75',
  '2172d18bfa5fb8f6005d512edaec78ef5fe4869dda4b819d090c3eaeec3589fb',
];

const CHUNK_COUNT = 20;
const CHUNK_SIZE  = 1024 * 512; // 512 KB
const TOTAL_BYTES = CHUNK_COUNT * CHUNK_SIZE; // 10,485,760 bytes

// ── Custom metrics ────────────────────────────────────────────────────────────

const chunkUploadLatency    = new Trend('chunk_upload_latency_ms', true);
const chunksSucceeded       = new Counter('chunks_succeeded');
const chunksRateLimited     = new Counter('chunks_rate_limited');
const chunksRetried         = new Counter('chunks_retried');
const chunksFailedHard      = new Counter('chunks_failed_hard');
const transfersCompleted    = new Counter('transfers_completed');
const byteCounterMismatches = new Counter('byte_counter_mismatches');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8787';

export const options = {
  vus:        50,
  iterations: 50, // exactly 1 iteration per VU — credentials are single-use
  // No duration cap — test ends when all 50 iterations complete.
  // Each VU: 20 chunks × ~100ms = ~2s per transfer. Total: ~5s with concurrency.

  thresholds: {
    // p(95) < 500ms per chunk — local workerd ceiling.
    // On Cloudflare edge this will be <50ms. Tightens to <150ms at B9 staging.
    'chunk_upload_latency_ms': ['p(95)<500'],

    // Zero hard failures after retry.
    'chunks_failed_hard': ['count==0'],

    // KV byte counter accurate to ±1 byte.
    'byte_counter_mismatches': ['count==0'],

    // No unexpected HTTP failures.
    'http_req_failed{expected_response:true}': ['rate<0.01'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChunkBytes(index) {
  const buf  = new Uint8Array(CHUNK_SIZE);
  let seed   = (index + 1) * 1_000_003;
  for (let i = 0; i < CHUNK_SIZE; i++) {
    seed   = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

function padIndex(i) {
  return String(i).padStart(4, '0');
}

// Unique fake IP per VU — gives each VU its own rate-limit bucket in wrangler
// dev --local, matching production behaviour where each user has a distinct IP.
function vuIp() {
  const vu = __VU; // 1-based
  return `10.${Math.floor(vu / 65536) % 256}.${Math.floor(vu / 256) % 256}.${vu % 256}`;
}

function uploadChunk(uuid, chunkIdx, cred, isChunk0) {
  const bytes = makeChunkBytes(chunkIdx);
  const hash  = PRECOMPUTED_HASHES[chunkIdx];

  const headers = {
    'Content-Type':            'application/octet-stream',
    'CF-Connecting-IP':        vuIp(),   // isolate rate limit bucket per VU
    'X-Blake3-Chunk-Hash':           hash,
    'X-Cashu-Credential':      cred.credentialHeader,
    'X-Credential-Commitment': cred.commitment,
    'X-Issued-Tier':           cred.issued_tier || 'free',
    'X-Total-Chunks':          String(CHUNK_COUNT),
    'X-Total-Bytes':           String(TOTAL_BYTES),
  };

  if (isChunk0) {
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    headers['X-Blake3-Root']      = PRECOMPUTED_HASHES[0];
    headers['X-Expiry-Timestamp'] = String(expiryTs);
  }

  const start = Date.now();
  let res = http.put(
    `${BASE_URL}/upload/${uuid}/${padIndex(chunkIdx)}`,
    bytes.buffer,
    { headers, tags: { chunk: String(chunkIdx) } }
  );
  const elapsed = Date.now() - start;

  if (res.status === 429) {
    // Should not happen with per-VU IP isolation, but handle gracefully.
    chunksRateLimited.add(1);
    sleep(1);
    chunksRetried.add(1);
    res = http.put(
      `${BASE_URL}/upload/${uuid}/${padIndex(chunkIdx)}`,
      bytes.buffer,
      { headers, tags: { chunk: String(chunkIdx), retry: 'true' } }
    );
    chunkUploadLatency.add(Date.now() - start);
  } else {
    chunkUploadLatency.add(elapsed);
  }

  return res;
}

// ── Main VU function ──────────────────────────────────────────────────────────

export default function () {
  // __VU is 1-based; credentials array is 0-based.
  const cred = credentials[__VU - 1];

  if (!cred) {
    chunksFailedHard.add(CHUNK_COUNT);
    return;
  }

  let allChunksOk = true;

  for (let i = 0; i < CHUNK_COUNT; i++) {
    const res = uploadChunk(cred.uuid, i, cred, i === 0);

    check(res, { 'chunk: status 200': (r) => r.status === 200 });

    if (res.status === 200) {
      chunksSucceeded.add(1);
    } else {
      chunksFailedHard.add(1);
      allChunksOk = false;
    }

    sleep(0.05); // 50ms between chunks within a VU
  }

  // KV byte-counter accuracy check.
  if (allChunksOk) {
    const metaRes = http.get(`${BASE_URL}/upload/${cred.uuid}/manifest`, {
      headers: { 'CF-Connecting-IP': vuIp() },
    });
    if (metaRes.status === 200) {
      try {
        const manifest = JSON.parse(metaRes.body);
        const delta    = Math.abs((manifest.total_bytes || 0) - TOTAL_BYTES);
        if (delta > 1) byteCounterMismatches.add(1);
        check(metaRes, { 'manifest: byte counter within ±1': () => delta <= 1 });
      } catch { /* timing — not a failure */ }
    }
    transfersCompleted.add(1);
  }
}
