/**
 * mixed-realistic.js — k6 load test: realistic mixed traffic baseline.
 *
 * Traffic split:
 *   70% — download (GET /download/{uuid}/{chunk}) from pre-loaded transfers
 *   25% — upload   (PUT /upload/{uuid}/{chunk}) with pre-issued credentials
 *    5% — credential issuance (POST /credential/issue) — observes rate limit
 *
 * This is the alpha go/no-go baseline (B11). If this passes, the system
 * handles real-world traffic shapes under local workerd. Thresholds tighten
 * to <150ms at B9 staging.
 *
 * Prerequisites — run in this order:
 *   Terminal 1: node worker/tests/load/start-mock.mjs
 *   Terminal 2: npx wrangler dev --local --port 8787
 *   Terminal 3: node worker/tests/load/preissue-credentials.mjs
 *               node worker/tests/load/preload-transfers.mjs
 *   Terminal 4: k6 run worker/tests/load/mixed-realistic.js
 *
 * Both credentials.json and transfers.json must exist before running.
 *
 * VU allocation (40 total):
 *   VUs 1–28  → download scenario (70%)
 *   VUs 29–38 → upload scenario (25%)
 *   VUs 39–40 → credential issuance scenario (5%)
 *
 * Each VU has its own IP so rate-limit buckets are isolated per user,
 * matching real production behaviour.
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

// ── Shared data ───────────────────────────────────────────────────────────────

const credentials = new SharedArray('credentials', function () {
  return JSON.parse(open('./credentials.json'));
});

const transfers = new SharedArray('transfers', function () {
  return JSON.parse(open('./transfers.json'));
});

// ── Custom metrics ────────────────────────────────────────────────────────────

const downloadLatency    = new Trend('mixed_download_latency_ms', true);
const uploadLatency      = new Trend('mixed_upload_latency_ms', true);
const credentialLatency  = new Trend('mixed_credential_latency_ms', true);
const downloadsOk        = new Counter('mixed_downloads_ok');
const uploadsOk          = new Counter('mixed_uploads_ok');
const credentialsOk      = new Counter('mixed_credentials_ok');
const hardFailures       = new Counter('mixed_hard_failures');
const rateLimitedTotal   = new Counter('mixed_rate_limited');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = __ENV.BASE_URL || 'http://127.0.0.1:8787';
const CHUNK_COUNT = 5;            // matches preload-transfers.mjs
const CHUNK_SIZE  = 1024 * 512;   // 512 KB
const TOTAL_BYTES = CHUNK_COUNT * CHUNK_SIZE;

// ── Pre-computed BLAKE3 hashes — mirrors preload-transfers.mjs (first 5) ──────

const PRECOMPUTED_HASHES = [
  '2f2a0bec89395b19c7b9f663e4d1eb271b40c899ec8fc71e53f6798e889866ea',
  '7d009094a9381a666df1e5e75a3df1d98b3d962ee0bcbc700a2be44e0ea7c295',
  'e0aa5142c41ccd93bb2b053b5b7672dd7a054477bca959d52ae44ce32b1416df',
  '15f03a5c91a6fe02c2f64406bd9525b34ee38d3a88e8527ea2532d17489e8ec0',
  'beced66f3e30945f4aff0c6a48cb6c0c87b40b87fea952320ae1c867903c89c7',
];

export const options = {
  // 40 VUs for 60 seconds. Simple constant load — representative of a busy
  // afternoon, not a spike. Duration long enough for rate limit windows to cycle.
  vus:      40,
  duration: '60s',

  thresholds: {
    // Download p(95) < 500ms (local). Tightens to <150ms at B9 staging.
    'mixed_download_latency_ms':   ['p(95)<500'],
    // Upload p(95) < 600ms (local — includes BLAKE3 verify cost).
    'mixed_upload_latency_ms':     ['p(95)<600'],
    // Credential p(95) < 400ms (local).
    'mixed_credential_latency_ms': ['p(95)<400'],

    // Zero hard failures (non-200, non-429).
    'mixed_hard_failures': ['count==0'],

    // Overall HTTP failure rate < 1% (excluding expected 429s).
    'http_req_failed{expected_response:true}': ['rate<0.01'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function padIndex(i) { return String(i).padStart(4, '0'); }

// Unique IP per VU — independent rate-limit buckets
function vuIp() {
  const vu = __VU;
  return `10.4.${Math.floor(vu / 256) % 256}.${vu % 256}`;
}

function makeChunkBytes(index) {
  const buf  = new Uint8Array(CHUNK_SIZE);
  let seed   = (index + 1) * 1_000_003;
  for (let i = 0; i < CHUNK_SIZE; i++) {
    seed   = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

// ── Scenario: download ────────────────────────────────────────────────────────

function doDownload() {
  if (!transfers.length) return; // guard: transfers.json empty

  // Round-robin across available transfers
  const transfer = transfers[(__VU - 1) % transfers.length];
  const chunkIdx = __ITER % transfer.chunkCount;

  const start = Date.now();
  const res   = http.get(
    `${BASE_URL}/download/${transfer.uuid}/${padIndex(chunkIdx)}`,
    {
      headers:          { 'CF-Connecting-IP': vuIp() },
      responseCallback: http.expectedStatuses(200, 429),
      tags:             { op: 'download' },
    }
  );
  const elapsed = Date.now() - start;

  if (res.status === 200) {
    downloadLatency.add(elapsed);
    downloadsOk.add(1);
    check(res, {
      'download: 200':          (r) => r.status === 200,
      'download: body present': (r) => (r.body?.length ?? 0) > 0,
    });
  } else if (res.status === 429) {
    rateLimitedTotal.add(1);
    check(res, { 'download: 429 tagged': (r) => r.status === 429 });
    sleep(1);
  } else {
    hardFailures.add(1);
    check(res, { 'download: unexpected': () => false });
  }

  sleep(0.15);
}

// ── Scenario: upload ──────────────────────────────────────────────────────────

function doUpload() {
  // Upload VUs are indices 29–38 (1-based: 29..38), so credential offset = VU - 29
  // credentials array is indexed 0-based; use modulo in case of re-runs
  const credIdx = (__VU - 29) % credentials.length;
  const cred    = credentials[credIdx];

  if (!cred) { hardFailures.add(CHUNK_COUNT); return; }

  const expiryTs  = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  let allOk       = true;

  for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
    const bytes = makeChunkBytes(chunkIdx);
    const hash  = PRECOMPUTED_HASHES[chunkIdx];

    const headers = {
      'Content-Type':            'application/octet-stream',
      'CF-Connecting-IP':        vuIp(),
      'X-Blake3-Chunk-Hash':     hash,
      'X-Cashu-Credential':      cred.credentialHeader,
      'X-Credential-Commitment': cred.commitment,
      'X-Issued-Tier':           cred.issued_tier || 'free',
      'X-Total-Chunks':          String(CHUNK_COUNT),
      'X-Total-Bytes':           String(TOTAL_BYTES),
    };

    if (chunkIdx === 0) {
      headers['X-Blake3-Root']      = PRECOMPUTED_HASHES[0];
      headers['X-Expiry-Timestamp'] = String(expiryTs);
    }

    const start = Date.now();
    const res   = http.put(
      `${BASE_URL}/upload/${cred.uuid}/${padIndex(chunkIdx)}`,
      bytes.buffer,
      { headers, responseCallback: http.expectedStatuses(200, 429), tags: { op: 'upload' } }
    );
    const elapsed = Date.now() - start;

    if (res.status === 200) {
      uploadLatency.add(elapsed);
      uploadsOk.add(1);
      check(res, { 'upload: 200': (r) => r.status === 200 });
    } else if (res.status === 429) {
      rateLimitedTotal.add(1);
      check(res, { 'upload: 429 tagged': (r) => r.status === 429 });
      allOk = false;
      sleep(1);
    } else {
      hardFailures.add(1);
      allOk = false;
      check(res, { 'upload: unexpected': () => false });
    }

    sleep(0.05);
  }

  if (!allOk) {
    // Credential may be partially consumed — not an error, just observed
  }
}

// ── Scenario: credential issuance ─────────────────────────────────────────────

function doCredentialIssue() {
  // Credential VUs are 39–40. Use a unique blinded_message per iteration.
  // We send a deterministic-but-plausible blinded_message hex string.
  // The Worker will validate it as a secp256k1 point — use a known valid
  // compressed point. The signed response is discarded; we measure latency only.
  //
  // Valid compressed secp256k1 generator point (G):
  const GENERATOR_HEX = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';

  const turnstileToken = `1x-mixed-${__VU}-${__ITER}-${Date.now()}`;

  const start = Date.now();
  const res   = http.post(
    `${BASE_URL}/credential/issue`,
    JSON.stringify({ turnstile_token: turnstileToken, blinded_message: GENERATOR_HEX }),
    {
      headers: {
        'Content-Type':     'application/json',
        'CF-Connecting-IP': vuIp(),
      },
      responseCallback: http.expectedStatuses(200, 429),
      tags:             { op: 'credential_issue' },
    }
  );
  const elapsed = Date.now() - start;

  if (res.status === 200) {
    credentialLatency.add(elapsed);
    credentialsOk.add(1);
    check(res, {
      'credential: 200':         (r) => r.status === 200,
      'credential: has uuid':    (r) => { try { return !!JSON.parse(r.body).uuid; } catch { return false; } },
    });
  } else if (res.status === 429) {
    rateLimitedTotal.add(1);
    check(res, { 'credential: 429 tagged': (r) => r.status === 429 });
    sleep(2); // longer backoff — credential rate limit is tighter (10/60s)
  } else {
    hardFailures.add(1);
    check(res, { 'credential: unexpected': () => false });
  }

  sleep(0.5); // credentials don't hammer — real users don't issue 2/s
}

// ── Main VU function — dispatch by VU number ──────────────────────────────────

export default function () {
  const vu = __VU;

  if (vu <= 28) {
    // VUs 1–28 → download (70%)
    group('download', doDownload);
  } else if (vu <= 38) {
    // VUs 29–38 → upload (25%)
    group('upload', doUpload);
  } else {
    // VUs 39–40 → credential issuance (5%)
    group('credential_issue', doCredentialIssue);
  }
}
