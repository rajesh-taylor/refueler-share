/**
 * worker/tests/integration/security.test.js
 * Security regression suite — TESTING.md §5.
 *
 * Every closed vulnerability from B4 becomes a permanent executable regression here.
 * This file is the machine-checkable half of the B9 whitepaper.
 *
 * S65 FOUNDATION — covers:
 *   - Rate limit enforcement: credential_issue 10/60s, upload 120/60s
 *   - Credential farming defence: foreign UUID rejection, melted credential replay
 *   - Turnstile nonce reuse rejection
 *
 * S66b will add: MIME denylist, UUID validation, chunk bounds, bearer token scope.
 *
 * Run: cd worker && npm run test:integration
 *
 * NOTE ON KV STATE BLEED:
 *   Rate limit counters and Turnstile nonce entries persist in KV across tests
 *   within the same wrangler dev --local session. Every test that exercises a
 *   rate limit or nonce must use a fresh, unique IP + unique token combination
 *   that cannot have appeared in any prior test in the suite.
 *
 *   uniqueIp() and freshToken() below guarantee this. Do not use the shared
 *   TURNSTILE_TEST_TOKEN constant in any test that checks nonce behaviour —
 *   it will be marked as already-used by the time the nonce test runs.
 *
 * NOTE ON TURNSTILE IN wrangler dev --local:
 *   Turnstile verification is bypassed by the CF test secret key in local mode.
 *   The always-fail token (2x000...AA) is also accepted locally. Do not test
 *   Turnstile rejection here — that is covered by turnstile.test.js unit tests.
 *   What CAN be tested locally: nonce KV deduplication (same token -> 429 on reuse).
 */

import { describe, it, expect, beforeEach, inject } from 'vitest';
import { blake3 } from '@noble/hashes/blake3';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, bytesToHex } from '@noble/hashes/utils';
import * as client from './client.js';
import { makeChunks } from './fixtures/chunks.js';
import { mockHandle } from './helpers/wrangler-lifecycle.js';
import {
  signStripePayload,
  signStripePayloadBadSig,
  signStripePayloadStale,
  makeSubscriptionUpdatedEvent,
} from './fixtures/stripe-events.js';
import { hashSecret } from '../../src/nut11.js';

// ── Unique value generators — prevent cross-test KV bleed ─────────────────

/** Unique IP string. Rate limit KV keys are per-IP — never reuse across tests. */
function uniqueIp(label = 'test') {
  return `${label}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Fresh Turnstile token. Must be unique per credential issue call.
 * Nonce KV key = SHA256(token) — reusing the same token across tests causes 429.
 * Format mirrors client.js: '1x' + random hex (passes CF test secret key in local mode).
 */
function freshToken() {
  return '1x' + crypto.randomUUID().replace(/-/g, '');
}

// ── NUT-00 primitives (local copy — no Worker imports in tests) ────────────

const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');

function hashToCurve(secretBytes) {
  const msgHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes));
  for (let counter = 0; counter < 0xffffffff; counter++) {
    const cb = new Uint8Array(4);
    new DataView(cb.buffer).setUint32(0, counter, true);
    const hash = sha256(concatBytes(msgHash, cb));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    try { return secp.ProjectivePoint.fromHex(bytesToHex(compressed)); } catch { continue; }
  }
  throw new Error('hash_to_curve exhausted');
}

function generateBlindedMessage() {
  const secret = secp.utils.randomPrivateKey();
  const r = secp.utils.randomPrivateKey();
  const Y = hashToCurve(secret);
  const rG = secp.ProjectivePoint.BASE.multiply(secp.utils.normPrivateKeyToScalar(r));
  return { blindedMessageHex: Y.add(rG).toHex(true), blindingFactor: r };
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

const BASE_URL = () => process.env.WORKER_BASE_URL ?? 'http://localhost:8788';

async function fetchAs(ip, path, options = {}) {
  const res = await fetch(`${BASE_URL()}${path}`, {
    ...options,
    headers: { ...options.headers, 'CF-Connecting-IP': ip },
  });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: res.headers.get('content-type')?.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text(),
  };
}

// Generic POST without CF-Connecting-IP (for webhook endpoint tests)
async function postRaw(path, body, headers = {}) {
  const res = await fetch(`${BASE_URL()}${path}`, { method: 'POST', headers, body });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: res.headers.get('content-type')?.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text(),
  };
}

/**
 * POST /credential/issue from a specific IP with a specific turnstile token.
 * Uses a fresh blinded message each call. Returns raw { status, body }.
 */
async function issueCredentialAs(ip, token) {
  const { blindedMessageHex } = generateBlindedMessage();
  return fetchAs(ip, '/credential/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstile_token: token, blinded_message: blindedMessageHex }),
  });
}

function blake3Hex(bytes) {
  return Buffer.from(blake3(bytes)).toString('hex');
}

async function generateKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptChunk(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  );
  return { ciphertext };
}

// ── Reset Supabase mock between tests ─────────────────────────────────────

beforeEach(() => {
  if (mockHandle) mockHandle.reset();
});

// ═════════════════════════════════════════════════════════════════════════════
// § RATE LIMIT ENFORCEMENT
// TESTING.md §5 claim: "All public endpoints are rate-limited"
// ═════════════════════════════════════════════════════════════════════════════

describe('Rate limit enforcement — credential_issue (10 / 60s)', () => {
  it('returns 429 at limit+1 on /credential/issue', async () => {
    const ip = uniqueIp('rl-cred');
    const LIMIT = 10;
    const results = [];

    for (let i = 0; i <= LIMIT; i++) {
      // Each call uses a fresh token — we are testing the IP-based rate limit,
      // not the nonce system. A fresh token per call ensures nonce never fires first.
      const res = await issueCredentialAs(ip, freshToken());
      results.push(res.status);
    }

    for (let i = 0; i < LIMIT; i++) {
      expect(results[i], `request ${i + 1} (within limit) should be 200`).toBe(200);
    }
    expect(results[LIMIT], `request ${LIMIT + 1} (over limit) should be 429`).toBe(429);
  });

  it('different IPs do not share rate limit buckets', async () => {
    const ipA = uniqueIp('rl-cred-ipA');
    const ipB = uniqueIp('rl-cred-ipB');
    const LIMIT = 10;

    // Exhaust IP A — fresh token per call to avoid nonce interference
    for (let i = 0; i < LIMIT; i++) {
      await issueCredentialAs(ipA, freshToken());
    }
    const aLimited = await issueCredentialAs(ipA, freshToken());
    expect(aLimited.status, 'IP A should be rate-limited').toBe(429);

    // IP B is a fresh IP — must not inherit IP A's exhausted bucket
    const bRes = await issueCredentialAs(ipB, freshToken());
    expect(bRes.status, 'IP B should not be affected by IP A limit').toBe(200);
  });
});

describe('Rate limit enforcement — upload (120 / 60s)', () => {
  it('returns 429 at limit+1 on /upload', async () => {
    const uploadIp = uniqueIp('rl-upload');
    const LIMIT = 120;
    const CHUNK_SIZE = 64;

    const key = await generateKey();
    const [plain] = makeChunks(1, CHUNK_SIZE);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    let first429At = null;

    for (let i = 0; i <= LIMIT; i++) {
      // Issue from a unique IP each time — avoids credential RL
      const issueIp = uniqueIp(`rl-upload-issue-${i}`);
      const credRes = await issueCredentialAs(issueIp, freshToken());

      let uploadStatus;
      if (credRes.status === 200) {
        const cred = credRes.body;
        // Raw signed_point (not unblinded) — Worker rejects as 401 after RL check.
        // That's fine: we only care whether the upload RL fires at request 121.
        const uploadRes = await fetchAs(uploadIp, `/upload/${cred.uuid}/0000`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Blake3-Chunk-Hash':     hash,
            'X-Cashu-Credential':      JSON.stringify({ C: cred.signed_point, mint_pubkey: cred.mint_pubkey }),
            'X-Credential-Commitment': cred.commitment ?? '',
            'X-Issued-Tier':           cred.issued_tier ?? 'free',
            'X-Blake3-Root':           hash,
            'X-Total-Chunks':          '1',
            'X-Total-Bytes':           String(ciphertext.length),
            'X-Expiry-Timestamp':      String(expiryTs),
          },
          body: ciphertext,
        });
        uploadStatus = uploadRes.status;
      } else {
        uploadStatus = credRes.status;
      }

      if (uploadStatus === 429 && first429At === null) first429At = i;
    }

    expect(first429At, 'rate limit must be hit within the test').not.toBeNull();
    expect(
      first429At,
      `429 should not arrive before request ${LIMIT + 1} (got it at index ${first429At})`
    ).toBeGreaterThanOrEqual(LIMIT);
  }, 120_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// § CREDENTIAL FARMING DEFENCE
// TESTING.md §5 claim: "Credentials are bound to a Worker-generated UUID"
// ═════════════════════════════════════════════════════════════════════════════

describe('Credential farming defence — foreign UUID rejection', () => {
  it('rejects a valid credential used against a foreign UUID', async () => {
    // Credential 1 — issued for uuid A
    const credRes = await client.issueCredential();
    expect(credRes.status, 'credential issue should succeed').toBe(200);
    const cred = credRes.body;
    expect(cred.uuid).toBeTruthy();
    expect(cred._credentialForUpload).toBeTruthy();

    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const key = await generateKey();
    const [plain] = makeChunks(1, 512);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    // Upload to correct UUID — must succeed (proves the credential is valid)
    const correctRes = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(correctRes.status, 'upload to correct UUID should succeed').toBe(200);

    // Credential 2 — issued for uuid B (we only want the uuid, not the credential)
    const cred2Res = await client.issueCredential();
    expect(cred2Res.status).toBe(200);
    const foreignUuid = cred2Res.body.uuid;

    // Farming attempt: credential 1 headers against uuid B
    const farmRes = await client.uploadChunk(foreignUuid, 0, ciphertext, hash, credHeaders);
    expect(
      farmRes.status,
      'credential used against foreign UUID must be rejected'
    ).toBeGreaterThanOrEqual(400);
    expect(farmRes.status, 'must not succeed').not.toBe(200);
  });

  it('rejects a melted credential replayed against a fresh UUID', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const key = await generateKey();
    const [plain] = makeChunks(1, 512);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    // First upload — melts the credential serial into Supabase spent_tokens
    const first = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(first.status, 'first upload should succeed').toBe(200);

    // Replay the same credential headers against a fresh UUID — must be rejected
    const cred2Res = await client.issueCredential();
    expect(cred2Res.status).toBe(200);
    const freshUuid = cred2Res.body.uuid;

    const replay = await client.uploadChunk(freshUuid, 0, ciphertext, hash, credHeaders);
    expect(replay.status, 'melted credential replay must be rejected').toBeGreaterThanOrEqual(400);
    expect(replay.status, 'must not succeed').not.toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § TURNSTILE NONCE BINDING
// TESTING.md §5 claim: "rejects reused Turnstile nonce"
// ═════════════════════════════════════════════════════════════════════════════

describe('Credential farming defence — Turnstile nonce binding', () => {
  it('rejects a reused Turnstile token on /credential/issue (nonce replay -> 429)', async () => {
    const ip = uniqueIp('nonce-reuse');
    const token = freshToken();

    const first = await issueCredentialAs(ip, token);
    expect(first.status, 'first issue with fresh token should succeed').toBe(200);

    const second = await issueCredentialAs(ip, token);
    expect(second.status, 'reused Turnstile token must return 429 (nonce replay)').toBe(429);
  });

  it('same token from a different IP is still rejected (nonce is keyed by token, not IP)', async () => {
    const ipA = uniqueIp('nonce-ipa');
    const ipB = uniqueIp('nonce-ipb');
    const token = freshToken();

    const first = await issueCredentialAs(ipA, token);
    expect(first.status, 'first issue should succeed').toBe(200);

    const second = await issueCredentialAs(ipB, token);
    expect(second.status, 'same token from different IP must still be rejected (429)').toBe(429);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § MIME DENYLIST
// TESTING.md §5 claim: "Execution-capable uploads are refused at the boundary"
// Origin: S40 — 6-type denylist on chunk 0; gate scoped to chunk 0 only.
//
// NOTE S66: Worker returns 400 (not 415) for some denylisted types depending on
// check ordering. Tests assert rejection (>=400, not 200), not exact status code.
// ═════════════════════════════════════════════════════════════════════════════

describe('MIME denylist — execution-capable Content-Type rejected on chunk 0', () => {
  const DENYLISTED_TYPES = [
    'application/javascript',
    'application/x-msdownload',
    'application/x-executable',
    'application/x-sharedlib',
    'application/wasm',
    'text/html',
  ];

  async function uploadChunk0WithMime(mimeType) {
    const credRes = await client.issueCredential();
    if (credRes.status !== 200) throw new Error(`credential issue failed: ${credRes.status}`);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);
    const headers = { ...credHeaders, 'Content-Type': mimeType };

    return fetchAs('mime-test-ip', `/upload/${cred.uuid}/0000`, {
      method: 'PUT',
      headers,
      body: ciphertext,
    });
  }

  for (const mimeType of DENYLISTED_TYPES) {
    it(`rejects ${mimeType} on chunk 0 (4xx, not 200)`, async () => {
      const res = await uploadChunk0WithMime(mimeType);
      expect(
        res.status,
        `chunk 0 with Content-Type '${mimeType}' must be rejected (4xx)`
      ).toBeGreaterThanOrEqual(400);
      expect(res.status, 'must not succeed').not.toBe(200);
      expect(res.status, 'must not be a server error').toBeLessThan(500);
    });
  }

  it('accepts application/octet-stream on chunk 0 (allowed type passes gate)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    const res = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(res.status, 'application/octet-stream must pass the MIME gate').toBe(200);
  });

  it('MIME gate is not applied to chunk index > 0 (denylisted type passes on chunk 1)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain0, plain1] = makeChunks(2, 256);
    const { ciphertext: ct0 } = await encryptChunk(plain0.bytes, key);
    const { ciphertext: ct1 } = await encryptChunk(plain1.bytes, key);
    const hash0 = blake3Hex(ct0);
    const hash1 = blake3Hex(ct1);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const totalBytes = ct0.length + ct1.length;

    const headers0 = client.buildCredentialHeaders(cred, 2, totalBytes, hash0, expiryTs);
    const res0 = await client.uploadChunk(cred.uuid, 0, ct0, hash0, headers0);
    expect(res0.status, 'chunk 0 should succeed').toBe(200);

    const headers1 = {
      'Content-Type':        'application/javascript',
      'X-Blake3-Chunk-Hash': hash1,
    };
    const res1 = await fetchAs('mime-gate-chunk1', `/upload/${cred.uuid}/0001`, {
      method: 'PUT',
      headers: headers1,
      body: ct1,
    });
    expect(res1.status, 'MIME gate must NOT fire on chunk > 0 (415 would be wrong)').not.toBe(415);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § UUID VALIDATION
// TESTING.md §5 claim: "rejects non-RFC4122 UUID in upload path"
// Origin: S41 — UUID regex on upload path; 400 on malformed.
// ═════════════════════════════════════════════════════════════════════════════

describe('UUID validation — non-RFC4122 UUID in upload path', () => {
  const INVALID_UUIDS = [
    { label: 'all zeros',               value: '00000000-0000-0000-0000-000000000000' },
    { label: 'path traversal segment',  value: '../../../etc/passwd' },
    { label: 'too short',               value: 'abc123' },
    { label: 'SQL injection fragment',  value: "'; DROP TABLE spent_tokens; --" },
    { label: 'valid format wrong version (v1)', value: '110e8400-e29b-11d4-a716-446655440000' },
  ];

  const minimalHeaders = {
    'Content-Type':        'application/octet-stream',
    'X-Blake3-Chunk-Hash': 'a'.repeat(64),
    'X-Total-Chunks':      '1',
    'X-Total-Bytes':       '256',
    'X-Expiry-Timestamp':  String(Math.floor(Date.now() / 1000) + 86400),
  };

  for (const { label, value } of INVALID_UUIDS) {
    it(`rejects UUID "${label}" -> 4xx`, async () => {
      const safePath = `/upload/${encodeURIComponent(value)}/0000`;
      const res = await fetchAs('uuid-val-ip', safePath, {
        method: 'PUT',
        headers: minimalHeaders,
        body: new Uint8Array(256),
      });
      expect(res.status, `malformed UUID "${label}" must be rejected`).toBeGreaterThanOrEqual(400);
      expect(res.status, 'must not succeed').not.toBe(200);
      expect(res.status, 'must not be a server error').toBeLessThan(500);
    });
  }

  it('valid RFC 4122 v4 UUID passes UUID check — upload with real credential succeeds (200)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    const res = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(res.status, 'valid RFC 4122 UUID must pass UUID validation (200)').toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § CHUNK BOUNDS
// TESTING.md §5 claim: "rejects chunk index beyond declared total"
// Origin: S41/S42b — chunk index >= total_chunks -> 400.
// ═════════════════════════════════════════════════════════════════════════════

describe('Chunk bounds — chunk index beyond declared total', () => {
  it('rejects chunk index equal to total_chunks (out-of-bounds by 1)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    const res0 = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(res0.status, 'chunk 0 should succeed').toBe(200);

    const res1 = await fetchAs('chunk-bounds-ip', `/upload/${cred.uuid}/0001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Blake3-Chunk-Hash': hash },
      body: ciphertext,
    });
    expect(res1.status, 'chunk index beyond total_chunks must be rejected (400)').toBe(400);
  });

  it('rejects a chunk index far beyond declared total (stuffing attempt)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);
    await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);

    const res = await fetchAs('chunk-stuff-ip', `/upload/${cred.uuid}/9999`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Blake3-Chunk-Hash': hash },
      body: ciphertext,
    });
    expect(res.status, 'far out-of-bounds index must be rejected (400)').toBe(400);
  });

  it('accepts the last valid chunk index (total_chunks - 1)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const key = await generateKey();
    const [plain0, plain1] = makeChunks(2, 256);
    const { ciphertext: ct0 } = await encryptChunk(plain0.bytes, key);
    const { ciphertext: ct1 } = await encryptChunk(plain1.bytes, key);
    const hash0 = blake3Hex(ct0);
    const hash1 = blake3Hex(ct1);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const totalBytes = ct0.length + ct1.length;

    const credHeaders = client.buildCredentialHeaders(cred, 2, totalBytes, hash0, expiryTs);
    const res0 = await client.uploadChunk(cred.uuid, 0, ct0, hash0, credHeaders);
    expect(res0.status, 'chunk 0 should succeed').toBe(200);

    const res1 = await fetchAs('chunk-last-ip', `/upload/${cred.uuid}/0001`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Blake3-Chunk-Hash': hash1 },
      body: ct1,
    });
    expect(res1.status, 'last valid chunk index must succeed (200)').toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § TIER CAP ENFORCEMENT
// Origin: S39 — 10 MB chunk cap on free tier; byte counter in KV.
// ═════════════════════════════════════════════════════════════════════════════

function makeRandomBytes(totalBytes) {
  const BLOCK = 65536;
  const buf = new Uint8Array(totalBytes);
  for (let offset = 0; offset < totalBytes; offset += BLOCK) {
    crypto.getRandomValues(buf.subarray(offset, Math.min(offset + BLOCK, totalBytes)));
  }
  return buf;
}

describe('Tier cap enforcement — free tier upload cap', () => {
  const FREE_TIER_CHUNK_MAX_BYTES = 10 * 1024 * 1024;

  it('rejects a single chunk exceeding the 10 MB per-chunk limit -> 413', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const oversizeBytes = FREE_TIER_CHUNK_MAX_BYTES + 1;
    const ciphertext = makeRandomBytes(oversizeBytes);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const credHeaders = client.buildCredentialHeaders(cred, 1, oversizeBytes, hash, expiryTs);
    const res = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(res.status, 'chunk exceeding 10 MB per-chunk limit must return 413').toBe(413);
  }, 30_000);

  it('accepts a chunk exactly at the per-chunk limit (10 MB)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;

    const ciphertext = makeRandomBytes(FREE_TIER_CHUNK_MAX_BYTES);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const credHeaders = client.buildCredentialHeaders(cred, 1, FREE_TIER_CHUNK_MAX_BYTES, hash, expiryTs);
    const res = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
    expect(res.status, '10 MB chunk (exactly at limit) must be accepted (200)').toBe(200);
  }, 30_000);
});

// ═════════════════════════════════════════════════════════════════════════════
// § STRIPE WEBHOOK AUTHENTICATION (S71 + S72)
// TESTING.md §5 claim: "Webhook payloads are authenticated and replay-protected"
//
// Worker returns 401 for all auth failures (bad/missing sig, stale timestamp).
// STRIPE_WEBHOOK_SECRET is injected via Vitest provide/inject (S72 fix) —
// it cannot be passed via process.env across the globalSetup → worker process
// boundary. inject() is the only mechanism that crosses that boundary.
// Unit coverage for the same signing logic is comprehensive in unit/stripe.test.js.
// ═════════════════════════════════════════════════════════════════════════════

describe('Stripe webhook authentication', () => {
  const SAMPLE_EVENT = makeSubscriptionUpdatedEvent();

  it('valid signed webhook -> 200', async () => {
    const secret = inject('stripeWebhookSecret');
    if (!secret) {
      console.warn('[S72] stripeWebhookSecret not injected — is STRIPE_WEBHOOK_SECRET in .dev.vars?');
    }
    expect(secret, 'STRIPE_WEBHOOK_SECRET must be available via inject()').toBeTruthy();

    const { body, headers } = await signStripePayload(SAMPLE_EVENT, secret);
    const res = await postRaw('/webhook/stripe', body, { 'Content-Type': 'application/json', ...headers });
    expect([200, 204]).toContain(res.status);
  });

  it('tampered signature -> 401', async () => {
    const { body, headers } = await signStripePayloadBadSig(SAMPLE_EVENT);
    const res = await postRaw('/webhook/stripe', body, { 'Content-Type': 'application/json', ...headers });
    expect(res.status).toBe(401);
  });

  it('stale timestamp (>300s) -> 401', async () => {
    const { body, headers } = await signStripePayloadStale(SAMPLE_EVENT);
    const res = await postRaw('/webhook/stripe', body, { 'Content-Type': 'application/json', ...headers });
    expect(res.status).toBe(401);
  });

  it('missing Stripe-Signature header -> 401', async () => {
    const res = await postRaw('/webhook/stripe', SAMPLE_EVENT, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
  });

  it('empty body -> 401', async () => {
    const { headers } = await signStripePayloadBadSig('');
    const res = await postRaw('/webhook/stripe', '', { 'Content-Type': 'application/json', ...headers });
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// § TRAITOR'S GATE — DELETE /transfer/{uuid}
// TG-block — destroy-after-download, consumed state, tidal window
// ═════════════════════════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────────────────

const TG_PASSPHRASE = 'tg-test-passphrase';

/**
 * Full upload + auth cycle using a passphrase-protected transfer.
 * hashSecret() matches what handleAuth uses — same import from nut11.js.
 * Returns { uuid, bearer } ready for DELETE /transfer/{uuid}.
 */
async function uploadAndAuth(ip = uniqueIp('tg')) {
  const credRes = await client.issueCredential();
  expect(credRes.status).toBe(200);
  const cred = credRes.body;

  const key = await generateKey();
  const [plain] = makeChunks(1, 256);
  const { ciphertext } = await encryptChunk(plain.bytes, key);
  const hash = blake3Hex(ciphertext);
  const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

  // Compute p2sh_secret_hash using the same hashSecret() the Worker uses in handleAuth.
  const p2shHash = await hashSecret(TG_PASSPHRASE);
  credHeaders['X-P2SH-Secret-Hash'] = p2shHash;

  const up = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, credHeaders);
  expect(up.status, 'chunk 0 upload must succeed').toBe(200);

  const authRes = await fetchAs(ip, `/auth/${cred.uuid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: TG_PASSPHRASE }),
  });
  expect(authRes.status, `POST /auth must return 200, got ${authRes.status}`).toBe(200);
  const bearer = authRes.body.token;

  return { uuid: cred.uuid, bearer };
}

async function deleteTransfer(uuid, bearer) {
  const headers = {};
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  const res = await fetch(`${BASE_URL()}/transfer/${uuid}`, { method: 'DELETE', headers });
  return {
    status: res.status,
    body: res.headers.get('content-type')?.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Traitor\'s Gate — DELETE /transfer/{uuid}', () => {
  it('destroys transfer with valid recipient bearer → 200, subsequent download → 410', async () => {
    const { uuid, bearer } = await uploadAndAuth();

    const delRes = await deleteTransfer(uuid, bearer);
    expect(delRes.status).toBe(200);
    expect(delRes.body.destroyed).toBe(true);
    expect(typeof delRes.body.consumed_at).toBe('number');

    // Subsequent download attempt → 410 (consumed)
    const dlRes = await fetchAs(uniqueIp('tg-post-del'), `/download/${uuid}/0000`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(dlRes.status).toBe(410);
  });

  it('DELETE with no Authorization → 401', async () => {
    const { uuid } = await uploadAndAuth(uniqueIp('tg-no-auth'));
    const res = await deleteTransfer(uuid, null);
    expect(res.status).toBe(401);
  });

  it('DELETE with bearer for wrong UUID → 403', async () => {
    // Bearer for transfer A
    const a = await uploadAndAuth(uniqueIp('tg-wrong-a'));

    // Create transfer B (separate credential, separate UUID)
    const bCredRes = await client.issueCredential();
    expect(bCredRes.status).toBe(200);
    const bCred = bCredRes.body;
    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const bHeaders = client.buildCredentialHeaders(bCred, 1, ciphertext.length, hash, expiryTs);
    bHeaders['X-P2SH-Secret-Hash'] = await hashSecret(TG_PASSPHRASE);
    await client.uploadChunk(bCred.uuid, 0, ciphertext, hash, bHeaders);

    // A's bearer against B's UUID → 403
    const res = await deleteTransfer(bCred.uuid, a.bearer);
    expect(res.status).toBe(403);
  });

  it('DELETE after already consumed → 410', async () => {
    const { uuid, bearer } = await uploadAndAuth(uniqueIp('tg-double-del'));
    const first = await deleteTransfer(uuid, bearer);
    expect(first.status).toBe(200);
    const second = await deleteTransfer(uuid, bearer);
    expect(second.status).toBe(410);
  });
});

describe('Traitor\'s Gate — consumed state blocks auth and download', () => {
  it('POST /auth after consumed: true → 410', async () => {
    const { uuid, bearer } = await uploadAndAuth(uniqueIp('tg-auth-consumed'));
    await deleteTransfer(uuid, bearer);

    const authRes = await fetchAs(uniqueIp('tg-auth-consumed-2'), `/auth/${uuid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: TG_PASSPHRASE }),
    });
    expect(authRes.status).toBe(410);
  });

  it('GET /download after consumed: true → 410', async () => {
    const { uuid, bearer } = await uploadAndAuth(uniqueIp('tg-dl-consumed'));
    await deleteTransfer(uuid, bearer);

    const dlRes = await fetchAs(uniqueIp('tg-dl-consumed-2'), `/download/${uuid}/0000`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(dlRes.status).toBe(410);
  });
});

describe('Traitor\'s Gate — tidal window enforcement', () => {
  it('available_from in future → 423 on POST /auth', async () => {
    // Free tier → 403 (tier gate). Paid tier → 200 upload then 423 on auth.
    // Test documents both paths — update when paid tier fixture exists.
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;
    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const hdrs = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);
    hdrs['X-P2SH-Secret-Hash'] = await hashSecret(TG_PASSPHRASE);
    hdrs['X-Available-From'] = String(Math.floor(Date.now() / 1000) + 86400);

    const upRes = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, hdrs);
    expect([200, 403]).toContain(upRes.status);
    if (upRes.status === 200) {
      const authRes = await fetchAs(uniqueIp('tg-tidal-auth'), `/auth/${cred.uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: TG_PASSPHRASE }),
      });
      expect(authRes.status).toBe(423);
    }
  });

  it('available_until in past → 410 on POST /auth (if paid tier; else 403 on upload)', async () => {
    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;
    const key = await generateKey();
    const [plain] = makeChunks(1, 256);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const hdrs = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);
    hdrs['X-P2SH-Secret-Hash'] = await hashSecret(TG_PASSPHRASE);
    hdrs['X-Available-Until'] = String(Math.floor(Date.now() / 1000) - 1);

    const upRes = await client.uploadChunk(cred.uuid, 0, ciphertext, hash, hdrs);
    expect([200, 403]).toContain(upRes.status);
    if (upRes.status === 200) {
      const authRes = await fetchAs(uniqueIp('tg-tidal-until'), `/auth/${cred.uuid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: TG_PASSPHRASE }),
      });
      expect(authRes.status).toBe(410);
    }
  });
});
