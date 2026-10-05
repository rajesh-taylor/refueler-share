// test/b12-1d.test.js — Share-B12-1d (B12-SR S1.1): presigned PUTs sign content-length.
//
//   /initiate  — full chunks 0…N−2 sign CHUNK_SIZE + 16; the tail N−1 signs its exact
//                ciphertext length and is returned ONLY as tail_url (every N, incl. 1).
//              — 400 unless totalChunks === ceil(totalBytes / CHUNK_SIZE).
//   /urls      — full chunks only: from ≥ N−1 → 400; batches stop at N−2.
//   finalise   — 409 wrong_size on a wrong-size full chunk / oversize tail; deletes
//                queued via ctx.waitUntil; no state changes, no new size field.
//
// Driven through worker.fetch with in-memory R2/KV (test/_r2_mock.js) and the
// Share-Admin-1 test-credential path (no Cashu, no Supabase). No network.

import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';
import { handleFinalise } from '../src/handlers/finalise.js';
import { presignPutObject } from '../src/r2_presign.js';
import { computeCommitment } from '../src/commitment.js';
import { CHUNK_SIZE, CHUNK_TAG_BYTES } from '../src/sweep_rules.js';
import { makeBucket, makeKV, FULL } from './_r2_mock.js';

const UUID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KEY  = 'test-commitment-key-b12-1d';
const R2   = { accountId: 'acct', accessKeyId: 'AKID', secretAccessKey: 'secret', bucket: 'refueler-share-dev' };
const FREE_WINDOW = 7 * 24 * 3600;
const ctx  = () => { const p = []; return { waitUntil: x => p.push(x), passThroughOnException() {}, _p: p }; };

function env() {
  return {
    BUCKET:    makeBucket(),
    STATUS_KV: makeKV({ [`test_credential:${UUID}`]: { initiated: false, cap_bytes: 400 * 1024 ** 3 } }),
    COMMITMENT_KEY:          KEY,
    CF_ACCOUNT_ID:           R2.accountId,
    R2_S3_ACCESS_KEY_ID:     R2.accessKeyId,
    R2_S3_SECRET_ACCESS_KEY: R2.secretAccessKey,
    R2_BUCKET_NAME:          R2.bucket,
  };
}

async function initiate(e, totalBytes, totalChunks = Math.ceil(totalBytes / CHUNK_SIZE)) {
  const req = new Request(`https://api.share.test/upload/${UUID}/initiate`, {
    method: 'POST',
    headers: {
      'X-Cashu-Credential':      '{}',
      'X-Total-Chunks':          String(totalChunks),
      'X-Total-Bytes':           String(totalBytes),
      'X-Expiry-Timestamp':      String(Math.floor(Date.now() / 1000) + 3600),
      'X-Credential-Commitment': await computeCommitment(KEY, UUID, 'free', FREE_WINDOW),
    },
  });
  const res = await worker.fetch(req, e, ctx());
  return { status: res.status, body: await res.json() };
}

async function urls(e, token, from, count) {
  const req = new Request(`https://api.share.test/upload/${UUID}/urls`, {
    method: 'POST', headers: { 'X-Upload-Session': token }, body: JSON.stringify({ from, count }),
  });
  const res = await worker.fetch(req, e, ctx());
  return { status: res.status, body: await res.json() };
}

// Recompute the presigned URL for (index, contentLength) at the URL's own
// X-Amz-Date; equal URL ⇒ the Worker signed exactly that content-length.
async function expectSigned(u, index, contentLength) {
  const q = new URL(u).searchParams;
  expect(q.get('X-Amz-SignedHeaders')).toBe('content-length;host');
  const d = q.get('X-Amz-Date');
  const now = new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`);
  const { url } = await presignPutObject({ ...R2, key: `${UUID}/${String(index).padStart(4, '0')}`, contentLength, now });
  expect(u).toBe(url);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('B12-1d — constants', () => {
  it('index.js part_size (PART_SIZE_BYTES) equals sweep_rules CHUNK_SIZE', async () => {
    const { body } = await initiate(env(), 1000);
    expect(body.part_size).toBe(CHUNK_SIZE);
    expect(CHUNK_TAG_BYTES).toBe(16);
  });
});

describe('B12-1d — /initiate signs content-length', () => {
  it('1-chunk file: urls [], batch_next null, tail_url signs bytes + 16', async () => {
    const { status, body } = await initiate(env(), 1000);
    expect(status).toBe(200);
    expect(body.urls).toEqual([]);
    expect(body.batch_next).toBeNull();
    expect(body.tail_url.index).toBe(0);
    expect(typeof body.tail_url.expires).toBe('number');
    await expectSigned(body.tail_url.url, 0, 1000 + 16);
  });

  it('ragged tail: full chunks sign CHUNK_SIZE + 16, tail signs remainder + 16', async () => {
    const bytes = 3 * CHUNK_SIZE + 12345;
    const { body } = await initiate(env(), bytes);
    expect(body.urls.map(u => u.index)).toEqual([0, 1, 2]);
    for (const u of body.urls) await expectSigned(u.url, u.index, CHUNK_SIZE + 16);
    expect(body.tail_url.index).toBe(3);
    await expectSigned(body.tail_url.url, 3, 12345 + 16);
    expect(body.batch_next).toBeNull();
  });

  it('exact multiple of CHUNK_SIZE: tail is a full-size chunk, still only in tail_url', async () => {
    const { body } = await initiate(env(), 2 * CHUNK_SIZE);
    expect(body.urls.map(u => u.index)).toEqual([0]);
    await expectSigned(body.tail_url.url, 1, CHUNK_SIZE + 16);
  });

  it('257 chunks: first batch is 0…255, batch_next null (tail is 256)', async () => {
    const { body } = await initiate(env(), 256 * CHUNK_SIZE + 1);
    expect(body.urls).toHaveLength(256);
    expect(body.urls.at(-1).index).toBe(255);
    expect(body.batch_next).toBeNull();
    expect(body.tail_url.index).toBe(256);
    await expectSigned(body.tail_url.url, 256, 1 + 16);
  });

  it('258 chunks: batch_next 256, tail 257 outside the first batch', async () => {
    const { body } = await initiate(env(), 257 * CHUNK_SIZE + 7);
    expect(body.urls).toHaveLength(256);
    expect(body.batch_next).toBe(256);
    expect(body.tail_url.index).toBe(257);
  });

  it.each([
    ['too many chunks', 1000, 2],
    ['too few chunks',  CHUNK_SIZE + 1, 1],
    ['exact multiple, one extra', 2 * CHUNK_SIZE, 3],
  ])('400 on chunk/byte mismatch (%s), before the test credential is consumed', async (_n, bytes, chunks) => {
    const e = env();
    const { status } = await initiate(e, bytes, chunks);
    expect(status).toBe(400);
    expect(JSON.parse(e.STATUS_KV._store.get(`test_credential:${UUID}`)).initiated).toBe(false);
    expect(e.BUCKET._store.has(`${UUID}/manifest.json`)).toBe(false);
  });
});

describe('B12-1d — /urls serves full chunks only', () => {
  async function started(chunksMinusTail, tail = 99) {
    const e = env();
    const { body } = await initiate(e, chunksMinusTail * CHUNK_SIZE + tail);
    return { e, token: body.session_token, n: chunksMinusTail + 1 };
  }

  it('from = N−1 (the tail) → plain 400', async () => {
    const { e, token, n } = await started(3);
    const { status } = await urls(e, token, n - 1, 1);
    expect(status).toBe(400);
  });

  it('1-chunk transfer: from 0 → 400 (nothing for /urls to serve)', async () => {
    const { e, token } = await started(0);
    expect((await urls(e, token, 0, 1)).status).toBe(400);
  });

  it('a batch reaching the tail stops at N−2, signed full-size, batch_next null', async () => {
    const { e, token, n } = await started(3);
    const { status, body } = await urls(e, token, 1, 256);
    expect(status).toBe(200);
    expect(body.urls.map(u => u.index)).toEqual([1, 2]);
    expect(body.urls.at(-1).index).toBe(n - 2);
    for (const u of body.urls) await expectSigned(u.url, u.index, CHUNK_SIZE + 16);
    expect(body.batch_next).toBeNull();
  });

  it('second batch of a 258-chunk transfer: 256 only, tail 257 never served', async () => {
    const { e, token } = await started(257);
    const { body } = await urls(e, token, 256, 256);
    expect(body.urls.map(u => u.index)).toEqual([256]);
    expect(body.batch_next).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const B32 = 'A'.repeat(43); // 32 zero bytes, b64url

describe('B12-1d — finalise exact-size check', () => {
  async function finalise(sizes) {
    const seed = { [`${UUID}/manifest.json`]: { uploaded: 1, body: JSON.stringify({ uuid: UUID, tier: 'free', total_chunks: sizes.length, total_bytes: 123, upload_complete: false }) } };
    sizes.forEach((size, i) => { seed[`${UUID}/${String(i).padStart(4, '0')}`] = { size, uploaded: 1 }; });
    const bucket = makeBucket(seed);
    const kv  = makeKV({ [`upload_session:${UUID}`]: 'tok' });
    const c   = ctx();
    const req = new Request(`https://w.test/upload/${UUID}/finalise`, {
      method: 'POST', headers: { 'X-Upload-Session': 'tok' },
      body: JSON.stringify({ hashes: sizes.map(() => B32), merkle_root: B32 }),
    });
    const res = await handleFinalise(req, { BUCKET: bucket, STATUS_KV: kv }, UUID, c);
    return { res, body: await res.json(), bucket, kv, c };
  }

  it('correct sizes → 200, manifest gains no new size field', async () => {
    const { res, bucket } = await finalise([FULL, FULL, 500]);
    expect(res.status).toBe(200);
    const m = JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body);
    expect(m.upload_complete).toBe(true);
    expect(Object.keys(m).sort()).toEqual(['merkle_root', 'tier', 'total_bytes', 'total_chunks', 'tree_algo', 'upload_complete', 'uuid']);
  });

  it('wrong-size full chunk → 409 wrong_size; delete queued via waitUntil; no state written', async () => {
    const { res, body, bucket, kv, c } = await finalise([FULL, CHUNK_SIZE, 500]);
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: 'wrong_size', segments: ['0001'] });
    expect(c._p).toHaveLength(1);
    await Promise.all(c._p);
    expect(bucket._log.deletes).toEqual([[`${UUID}/0001`]]);
    expect(bucket._store.has(`${UUID}/hashes`)).toBe(false);
    expect(JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body).upload_complete).toBe(false);
    expect(kv._store.has(`upload_session:${UUID}`)).toBe(true); // session not spent — browser can re-PUT
  });

  it('oversize tail → 409 wrong_size', async () => {
    const { res, body } = await finalise([FULL, FULL + 1]);
    expect(res.status).toBe(409);
    expect(body.segments).toEqual(['0001']);
  });

  it('1-chunk transfer: tail up to FULL ok, FULL + 1 refused', async () => {
    expect((await finalise([FULL])).res.status).toBe(200);
    expect((await finalise([FULL + 1])).res.status).toBe(409);
  });

  it('missing chunk is reported as incomplete before any size check (unchanged contract)', async () => {
    const seed = { [`${UUID}/manifest.json`]: { uploaded: 1, body: JSON.stringify({ uuid: UUID, total_chunks: 3, upload_complete: false }) },
                   [`${UUID}/0000`]: { size: 5, uploaded: 1 } }; // wrong size AND 0001/0002 missing
    const bucket = makeBucket(seed);
    const c   = ctx();
    const req = new Request(`https://w.test/upload/${UUID}/finalise`, { method: 'POST', headers: { 'X-Upload-Session': 'tok' }, body: '{}' });
    const res = await handleFinalise(req, { BUCKET: bucket, STATUS_KV: makeKV({ [`upload_session:${UUID}`]: 'tok' }) }, UUID, c);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'incomplete', missing: ['0001', '0002'] });
    expect(c._p).toHaveLength(0);
  });
});
