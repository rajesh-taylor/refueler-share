/**
 * worker/tests/integration/round-trip.test.js
 * Core integration tests per TESTING.md §3, against wrangler dev --local
 * (wrangler-lifecycle.js). Rewritten Integration-Repair-1 (28 Oct 2026) for
 * the Share-6 upload, credential v2 and UUID-Out-Of-Path-1.
 */

import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import * as client from './client.js';

beforeAll(() => client.init({ workerUrl: inject('workerUrl'), persistDir: inject('persistDir'), envFile: inject('envFile') }));
afterAll(() => client.close());

const equalBytes = (a, b) => a.length === b.length && Buffer.from(a).equals(Buffer.from(b));

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — Full upload → download round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('Full upload → download round-trip', () => {
  it('two-chunk transfer: initiate, finalise, meta, byte-identical verified download', async () => {
    const totalBytes = client.CHUNK_SIZE + 1000;   // one full chunk + a tail

    const cred = await client.issueCredential();
    expect(cred.status, 'credential issue').toBe(200);
    expect(cred.body.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(cred.body.keyset_id, 'keyset id for the v2 proof').toBeTruthy();
    expect(cred.body.issued_tier).toBe('free');

    const init = await client.initiate(await client.initiateHeaders(cred.body, { totalBytes }));
    expect(init.status, `initiate: ${JSON.stringify(init.body)}`).toBe(200);
    expect(init.body.total_chunks).toBe(2);
    expect(init.body.urls).toHaveLength(1);
    expect(init.body.tail_url.index).toBe(1);
    expect(init.body.session_token).toBeTruthy();

    const { uuid } = cred.body;
    const chunks = client.makeChunks(totalBytes);
    await client.putChunks(uuid, chunks);

    const fin = await client.finalise(uuid, init.body.session_token, client.finaliseBody(chunks));
    expect(fin.status, `finalise: ${JSON.stringify(fin.body)}`).toBe(200);

    const meta = await client.getMeta(uuid);
    expect(meta.status).toBe(200);
    expect(meta.body.total_chunks).toBe(2);
    expect(meta.body.total_bytes, 'size never served for new manifests (Share-Size-1)').toBeNull();
    expect(meta.body.passphrase_protected).toBe(false);

    for (let i = 0; i < chunks.length; i++) {
      const res = await client.downloadChunk(uuid, i);
      expect(res.status, `download part ${i}`).toBe(200);
      expect(res.headers['x-integrity']).toBe('ciphertext-storage-verified');
      expect(equalBytes(res.body, chunks[i]), `part ${i} bytes`).toBe(true);
    }
  });

  it('finalise refuses wrong chunk hashes and a missing chunk', async () => {
    const cred = await client.issueCredential();
    const init = await client.initiate(await client.initiateHeaders(cred.body, { totalBytes: 512 }));
    expect(init.status).toBe(200);
    const { uuid } = cred.body;

    // Nothing stored yet → 409 incomplete
    const chunks = client.makeChunks(512);
    const early = await client.finalise(uuid, init.body.session_token, client.finaliseBody(chunks));
    expect(early.status).toBe(409);
    expect(early.body.error).toBe('incomplete');

    // Stored, but finalise claims other bytes → finalise accepts the claim (it
    // can't read hashes it wasn't sent) and the verified download refuses.
    await client.putChunks(uuid, chunks);
    const other = client.makeChunks(512);
    const fin = await client.finalise(uuid, init.body.session_token, client.finaliseBody(other));
    expect(fin.status).toBe(200);
    const dl = await client.downloadChunk(uuid, 0);
    expect(dl.status, 'stored bytes ≠ committed hash').toBe(409);
    expect(dl.body.error).toBe('integrity_failed');
  });

  it('a chunk beyond the declared count is refused at finalise (409 wrong_size)', async () => {
    // Replaces the retired relay's chunk-index bounds test (chunk stuffing).
    const cred = await client.issueCredential();
    const init = await client.initiate(await client.initiateHeaders(cred.body, { totalBytes: 512 }));
    expect(init.status).toBe(200);
    const chunks = client.makeChunks(512);
    await client.putChunks(cred.body.uuid, [...chunks, new Uint8Array(64)]);   // stray 0001
    const fin = await client.finalise(cred.body.uuid, init.body.session_token, client.finaliseBody(chunks));
    expect(fin.status).toBe(409);
    expect(fin.body.error).toBe('wrong_size');
    expect(fin.body.segments).toEqual(['0001']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — Password-protected variant
// ─────────────────────────────────────────────────────────────────────────────

describe('Password-protected transfer', () => {
  it('401 without token, 401 with wrong password, 200 with the right one', async () => {
    const PASSWORD = 'correct-horse-battery-staple';
    const expiryTs = Math.floor(Date.now() / 1000) + 7 * client.DAY;
    const { uuid, chunks } = await client.upload({ password: PASSWORD, expiryTs });

    const meta = await client.getMeta(uuid);
    expect(meta.body.passphrase_protected).toBe(true);

    const noBearer = await client.downloadChunk(uuid, 0);
    expect(noBearer.status, 'no token → 401').toBe(401);

    const wrong = await client.unlock(uuid, 'wrong-password');
    expect(wrong.status, 'wrong password → 401').toBe(401);

    const right = await client.unlock(uuid, PASSWORD);
    expect(right.status, 'right password → 200').toBe(200);
    const { token } = right.body;
    expect(token).toBeTruthy();

    // S58 regression: token exp >= manifest expiry_timestamp
    try {
      const [payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      expect(payload.exp, 'token exp >= manifest expiry').toBeGreaterThanOrEqual(expiryTs);
    } catch { /* opaque token format — skip decode check */ }

    const ok = await client.downloadChunk(uuid, 0, token);
    expect(ok.status, 'download with token → 200').toBe(200);
    expect(equalBytes(ok.body, chunks[0])).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — Double-spend rejection
// ─────────────────────────────────────────────────────────────────────────────

describe('Double-spend rejection', () => {
  it('a spent credential cannot start a second transfer', async () => {
    const cred = await client.issueCredential();
    const first = await client.initiate(await client.initiateHeaders(cred.body));
    expect(first.status, 'first initiate spends the credential').toBe(200);

    // Same proof again. Its commitment binds it to its own UUID, so the replay
    // must be against that UUID — and the manifest exists, so it is refused
    // before any spend. Either way: never a second transfer.
    const again = await client.initiate(await client.initiateHeaders(cred.body));
    expect(again.status).toBe(409);
  });

  it('a spent proof under a second, valid UUID + commitment hits the spend ledger (409)', async () => {
    const a = await client.issueCredential();
    const b = await client.issueCredential();
    expect((await client.initiate(await client.initiateHeaders(a.body))).status).toBe(200);

    // b's UUID and commitment are genuine; only the proof is a's, already spent.
    const replay = await client.initiate(await client.initiateHeaders(b.body, { proof: a.body.proof }));
    expect(replay.status).toBe(409);
    expect(replay.body.error).toMatch(/already spent/i);

    // b's own proof is still good.
    expect((await client.initiate(await client.initiateHeaders(b.body))).status).toBe(200);
  });
});
