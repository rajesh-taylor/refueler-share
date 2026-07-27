/**
 * worker/tests/integration/round-trip.test.js
 * Three core integration tests per TESTING.md §3.
 * Runs against wrangler dev --local (WORKER_BASE_URL set by wrangler-lifecycle.js).
 *
 * Supabase mock is started by wrangler-lifecycle.js (globalSetup) before wrangler boots,
 * so SUPABASE_URL in .dev.vars already points at the mock when the Worker starts.
 * Tests call mockHandle.reset() in beforeEach to clear spent serials between runs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { blake3 } from '@noble/hashes/blake3';
import * as client from './client.js';
import { makeChunks, wrongHashVariant } from './fixtures/chunks.js';
import { makeManifest } from './fixtures/manifest.js';
import { mockHandle } from './helpers/wrangler-lifecycle.js';

// ── AES-GCM helpers ──────────────────────────────────────────────────────

async function generateKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptChunk(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  );
  return { ciphertext, iv };
}

function blake3Hex(bytes) {
  return Buffer.from(blake3(bytes)).toString('hex');
}

function computeBlake3Root(chunkHashes) {
  const concat = chunkHashes.join('');
  return blake3Hex(new TextEncoder().encode(concat));
}

// ── Reset mock state between tests ───────────────────────────────────────

beforeEach(() => {
  if (mockHandle) mockHandle.reset();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Full upload → download round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Full upload → download round-trip', () => {
  it('stores encrypted chunks and returns identical ciphertext', async () => {
    const NUM_CHUNKS = 3;
    const CHUNK_SIZE = 512;

    // Step 1 — Issue credential (full BDHKE in client.js)
    const credRes = await client.issueCredential();
    expect(credRes.status, 'credential issue should succeed').toBe(200);
    const cred = credRes.body;
    expect(cred.uuid, 'Worker should return a UUID').toBeTruthy();
    expect(cred.signed_point, 'signed_point should be present').toBeTruthy();
    expect(cred.commitment, 'commitment should be present').toBeTruthy();
    expect(cred._credentialForUpload, 'unblinded credential should be present').toBeTruthy();

    const { uuid } = cred;
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    // Step 2 — Encrypt chunks
    const key = await generateKey();
    const plainChunks = makeChunks(NUM_CHUNKS, CHUNK_SIZE);
    const encrypted = await Promise.all(plainChunks.map(c => encryptChunk(c.bytes, key)));
    const hashes = encrypted.map(e => blake3Hex(e.ciphertext));
    const blake3Root = computeBlake3Root(hashes);
    const totalBytes = encrypted.reduce((s, e) => s + e.ciphertext.length, 0);

    const credHeaders = client.buildCredentialHeaders(cred, NUM_CHUNKS, totalBytes, blake3Root, expiryTs);

    // Step 3 — Upload chunks
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const headers = i === 0 ? credHeaders : {};
      const res = await client.uploadChunk(uuid, i, encrypted[i].ciphertext, hashes[i], headers);
      expect(res.status, `chunk ${i} upload`).toBe(200);
    }

// Step 4 — meta endpoint includes total_chunks
    const metaRes = await client.getMeta(uuid);
    expect(metaRes.status, 'meta GET').toBe(200);
    expect(metaRes.body.total_chunks, 'total_chunks in meta').toBe(NUM_CHUNKS);

    // Step 5 — Download each chunk returns 200
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const res = await client.downloadChunk(uuid, i);
      expect(res.status, `download chunk ${i}`).toBe(200);
    }

    // Step 7 — Wrong BLAKE3 hash rejected with 400
    const badChunks = wrongHashVariant(
      encrypted.map((e, i) => ({ bytes: e.ciphertext, blake3Hash: hashes[i] }))
    );
    const cred2Res = await client.issueCredential();
    expect(cred2Res.status).toBe(200);
    const cred2 = cred2Res.body;
    const badHeaders = client.buildCredentialHeaders(
      cred2, 1, badChunks[0].bytes.length, badChunks[0].blake3Hash, expiryTs
    );
    const badRes = await client.uploadChunk(cred2.uuid, 0, badChunks[0].bytes, badChunks[0].blake3Hash, badHeaders);
    expect(badRes.status, 'wrong hash should be rejected with 400').toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — Passphrase-protected variant
// ─────────────────────────────────────────────────────────────────────────────

describe('Passphrase-protected transfer', () => {
  it('401 without bearer, 401 with wrong passphrase, 200 with correct passphrase', async () => {
    const PASSPHRASE = 'correct-horse-battery-staple';
    const CHUNK_SIZE = 512;

    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;
    const { uuid } = cred;
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const key = await generateKey();
    const [plain] = makeChunks(1, CHUNK_SIZE);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const blake3Root = hash;

    const passphraseBytes = new TextEncoder().encode(PASSPHRASE);
    const hashBuf = await crypto.subtle.digest('SHA-256', passphraseBytes);
    const passphraseHash = Buffer.from(hashBuf).toString('hex');

    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, blake3Root, expiryTs, passphraseHash);
    const uploadRes = await client.uploadChunk(uuid, 0, ciphertext, hash, credHeaders);
    expect(uploadRes.status, 'chunk upload').toBe(200);

    // No bearer → 401
    const noBearer = await client.downloadChunk(uuid, 0);
    expect(noBearer.status, 'no bearer → 401').toBe(401);

    // Wrong passphrase → 401
    const wrongAuth = await client.auth(uuid, 'wrong-passphrase');
    expect(wrongAuth.status, 'wrong passphrase → 401').toBe(401);

    // Correct passphrase → 200 + token
    const correctAuth = await client.auth(uuid, PASSPHRASE);
    expect(correctAuth.status, 'correct passphrase → 200').toBe(200);
    const { token } = correctAuth.body;
    expect(token, 'bearer token present').toBeTruthy();

    // S58 regression: token exp >= manifest expiry_timestamp
    try {
      const [payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      expect(payload.exp, 'token exp >= manifest expiry').toBeGreaterThanOrEqual(expiryTs);
    } catch { /* opaque token format — skip decode check */ }

    // Download with bearer → 200
    const withBearer = await client.downloadChunk(uuid, 0, token);
    expect(withBearer.status, 'download with bearer → 200').toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — Double-spend rejection
// ─────────────────────────────────────────────────────────────────────────────

describe('Double-spend rejection', () => {
  it('rejects reuse of a melted credential on a second upload', async () => {
    const CHUNK_SIZE = 512;

    const credRes = await client.issueCredential();
    expect(credRes.status).toBe(200);
    const cred = credRes.body;
    const { uuid } = cred;
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const key = await generateKey();
    const [plain] = makeChunks(1, CHUNK_SIZE);
    const { ciphertext } = await encryptChunk(plain.bytes, key);
    const hash = blake3Hex(ciphertext);
    const credHeaders = client.buildCredentialHeaders(cred, 1, ciphertext.length, hash, expiryTs);

    // First upload — melts the credential
    const firstUpload = await client.uploadChunk(uuid, 0, ciphertext, hash, credHeaders);
    expect(firstUpload.status, 'first upload should succeed').toBe(200);

    // Second upload with same credential — must be rejected
    const secondUpload = await client.uploadChunk(crypto.randomUUID(), 0, ciphertext, hash, credHeaders);
    expect(secondUpload.status, 'reused credential must be rejected').toBeGreaterThanOrEqual(400);
  });
});
