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
 *   What CAN be tested locally: nonce KV deduplication (same token → 429 on reuse).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { blake3 } from '@noble/hashes/blake3';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, bytesToHex } from '@noble/hashes/utils';
import * as client from './client.js';
import { makeChunks } from './fixtures/chunks.js';
import { mockHandle } from './helpers/wrangler-lifecycle.js';

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
  /**
   * Strategy: send 121 PUT /upload requests all from the same uploadIp.
   * Each uses a *valid* credential issued from a *different* IP (one issue per IP
   * → never hits the credential rate limit). The credential header uses the raw
   * signed_point, not a fully-unblinded C — the Worker will reject it as 401
   * (invalid credential) for the first 120, but the rate limiter (line ~189 in
   * index.js) fires BEFORE credential verification, so request 121 must be 429.
   *
   * We assert: first429At >= LIMIT (i.e., the 429 doesn't arrive too early).
   * A 429 at index 0 would mean KV bleed from a previous test — uniqueIp() prevents this.
   */
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
    // commitment = SHA256(uuid_A:tier:window) — does not match uuid B → must reject
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
  /**
   * Turnstile nonce binding (S42d): after a successful credential issue, the Worker
   * stores SHA256(token) in KV with a 600s TTL. A second /credential/issue with the
   * SAME token must return 429 (turnstile_nonce_replay).
   *
   * We use a freshly generated token (not the shared TURNSTILE_TEST_TOKEN constant)
   * to ensure it hasn't been seen in any earlier test in this suite.
   *
   * NOTE: Turnstile signature verification is bypassed in local mode — both the
   * CF always-pass AND always-fail tokens are accepted by the Worker in this
   * environment. What IS tested here is the KV nonce deduplication layer.
   */
  it('rejects a reused Turnstile token on /credential/issue (nonce replay → 429)', async () => {
    // Unique IP — its own rate limit bucket, not shared with any other test
    const ip = uniqueIp('nonce-reuse');
    // Fresh token — guaranteed not to have been used in any earlier test
    const token = freshToken();

    // First issue with this token — must succeed
    const first = await issueCredentialAs(ip, token);
    expect(first.status, 'first issue with fresh token should succeed').toBe(200);

    // Second issue with the SAME token — nonce KV entry exists → 429
    const second = await issueCredentialAs(ip, token);
    expect(second.status, 'reused Turnstile token must return 429 (nonce replay)').toBe(429);
  });

  it('same token from a different IP is still rejected (nonce is keyed by token, not IP)', async () => {
    const ipA = uniqueIp('nonce-ipa');
    const ipB = uniqueIp('nonce-ipb');
    const token = freshToken();

    // First issue from IP A — consumes the nonce
    const first = await issueCredentialAs(ipA, token);
    expect(first.status, 'first issue should succeed').toBe(200);

    // Same token from IP B — nonce is already in KV, IP does not matter → 429
    const second = await issueCredentialAs(ipB, token);
    expect(second.status, 'same token from different IP must still be rejected (429)').toBe(429);
  });
});
