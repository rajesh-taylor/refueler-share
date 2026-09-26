// test/dock_b12.test.js
// Share-B12-1 — dock_index handling outside the sweep:
//   DAD (finishDownload step 7) · recipient delete · owner delete · finalise (X4)
//   · Execution Dock API (purged status, no size_bytes).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeBucket, makeKV } from './_r2_mock.js';

// Isolate the units under test from heavy siblings (WASM, crypto, receipts).
vi.mock('../src/nut11.js',                     () => ({ verifyDownloadToken: vi.fn(async (_t, _k) => ({ valid: true, uuid: globalThis.__uuid })) }));
vi.mock('../src/receipts.js',                  () => ({ emitReceipt: vi.fn() }));
vi.mock('../src/webhook_delivery.js',          () => ({ findApiKeyHashForUuid: vi.fn() }));
vi.mock('../src/handlers/download_verify.js',  () => ({ isVerifiedPath: vi.fn(), readSidecarWithRootCheck: vi.fn(), verifyChunkBody: vi.fn(), VERIFY_INLINE_CHUNK_THRESHOLD: 0 }));
// DAD flips on the last chunk of an armed transfer — pin that predicate so this
// test exercises the destruction SEQUENCE, not manifest_tg's internals.
vi.mock('../src/manifest_tg.js', () => ({
  buildTombstone:         (n) => ({ consumed: true, consumed_at: n }),
  flipPendingDestruction: (m, i) => (m.pending_destruction === false && i === m.total_chunks - 1) ? { ...m, pending_destruction: true } : m,
  checkTransferStatus:    vi.fn(),
}));
// Read the manifest straight from the mock bucket (keeps real json/err/UUID_RE).
vi.mock('../src/utils.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    safeGetManifest: async (bucket, uuid) => {
      const o = await bucket.get(`${uuid}/manifest.json`);
      return { manifest: o ? await o.json() : null, oversize: false };
    },
  };
});

import { finishDownload }                             from '../src/handlers/download.js';
import { handleDeleteTransfer, handleOwnerDelete }    from '../src/handlers/delete_transfer.js';
import { handleFinalise }                             from '../src/handlers/finalise.js';
import { handleExecutionDock }                        from '../src/handlers/execution_dock.js';

const NOW  = 1_800_000_000;
const DAY  = 86400;
const UUID = '11111111-2222-4333-8444-555555555555';
const B32  = 'A'.repeat(43); // base64url of 32 zero bytes
const dockEntry = (o = {}) => ({ uuid: UUID, expiry_timestamp: NOW + DAY, tier: 'creative', file_name: 'encrypted-payload', created_at: NOW - 100, ...o });

function armedTransfer(pendingDestruction) {
  const seed = { [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify({ uuid: UUID, total_chunks: 3, upload_complete: true, pending_destruction: pendingDestruction }) } };
  for (let i = 0; i < 3; i++) seed[`${UUID}/000${i}`] = { size: 100, uploaded: NOW };
  seed[`${UUID}/hashes`] = { size: 96, uploaded: NOW };
  return makeBucket(seed);
}

beforeEach(() => { globalThis.__uuid = UUID; vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000); });
afterEach(()  => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('DAD — finishDownload step 7 (B12 §6.5)', () => {
  async function download(pendingDestruction, chunkIndex) {
    const bucket = armedTransfer(pendingDestruction);
    const kv     = makeKV({ [`dock_index:${UUID}`]: dockEntry() });
    const env    = { BUCKET: bucket, STATUS_KV: kv };
    const jobs   = [];
    const ctx    = { waitUntil: (p) => jobs.push(p) };
    const manifest = await (await bucket.get(`${UUID}/manifest.json`)).json();
    finishDownload(new Request('https://w.test/'), env, ctx, UUID, chunkIndex, manifest, new Response('x'));
    await Promise.all(jobs);
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget tail settle
    return { bucket, kv };
  }

  it('removes dock_index:{uuid} when the destruction sequence runs', async () => {
    const { bucket, kv } = await download(false, 2);           // armed DAD, last chunk
    expect(JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body).consumed).toBe(true);
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(false);   // absence — same trace as owner-delete
    expect(kv._log.deletes).toContain(`dock_index:${UUID}`);
  });

  it('leaves the entry alone when nothing is destroyed (not a DAD transfer, or not the last chunk)', async () => {
    expect((await download(null, 2)).kv._store.has(`dock_index:${UUID}`)).toBe(true);   // not DAD
    expect((await download(false, 1)).kv._store.has(`dock_index:${UUID}`)).toBe(true);  // mid-download
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Share-DAD-2: DAD runs the shared destroyTransfer — everything under {uuid}/
// goes (chunks, hashes, date-seal), batched, tombstone last, all awaited.
describe('DAD — shared destroyTransfer (Share-DAD-2)', () => {
  function bigArmed(chunks, seal = true) {
    const seed = { [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify({ uuid: UUID, total_chunks: chunks, total_bytes: chunks * 100, expiry_timestamp: NOW + DAY, upload_complete: true, pending_destruction: false }) } };
    for (let i = 0; i < chunks; i++) seed[`${UUID}/${String(i).padStart(4, '0')}`] = { size: 100, uploaded: NOW };
    seed[`${UUID}/hashes`] = { size: 32 * chunks, uploaded: NOW };
    if (seal) seed[`${UUID}/date-seal.ots.enc`] = { size: 50, uploaded: NOW };
    return makeBucket(seed);
  }
  async function run(bucket) {
    const kv   = makeKV({ [`dock_index:${UUID}`]: dockEntry(), [`root_verified:${UUID}`]: '1' });
    const jobs = [];
    const manifest = await (await bucket.get(`${UUID}/manifest.json`)).json();
    finishDownload(new Request('https://w.test/'), { BUCKET: bucket, STATUS_KV: kv }, { waitUntil: (p) => jobs.push(p) },
      UUID, manifest.total_chunks - 1, manifest, new Response('x'));
    await Promise.all(jobs);                      // no extra tick — every step must be inside the awaited job
    return { kv, manifest: JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body) };
  }

  it('deletes chunks, hashes and date-seal, then writes a bare tombstone', async () => {
    const bucket = bigArmed(3);
    const { kv, manifest } = await run(bucket);
    expect([...bucket._store.keys()]).toEqual([`${UUID}/manifest.json`]);
    expect(manifest).toEqual({ consumed: true, consumed_at: NOW });   // no size, expiry or chunk count left
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(false);
    expect(kv._store.has(`root_verified:${UUID}`)).toBe(false);
  });

  it('batches large transfers (2,500 chunks = 3 delete calls, not 2,500)', async () => {
    const bucket = bigArmed(2500);
    await run(bucket);
    expect(bucket._log.deletes.length).toBe(3);
    expect(bucket._store.size).toBe(1);
  });

  it('a failed batch leaves the transfer blocked and resumable, never tombstoned', async () => {
    const bucket = bigArmed(3);
    bucket.delete = async () => { throw new Error('R2 down'); };
    const { manifest } = await run(bucket);
    expect(manifest.consumed).toBe(true);        // downloads stay blocked
    expect(manifest.total_chunks).toBe(3);       // in-progress, so owner/bearer delete resumes it
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('every deletion path leaves the same trace in dock_index: absence', () => {
  const setup = () => ({ bucket: armedTransfer(false), kv: makeKV({ [`dock_index:${UUID}`]: dockEntry() }) });

  it('owner delete', async () => {
    const { bucket, kv } = setup();
    const req = new Request(`https://w.test/transfer/${UUID}`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_owner_x', 'X-Admin-Key': 'k' } });
    const res = await handleOwnerDelete(req, { BUCKET: bucket, STATUS_KV: kv, ADMIN_KEY: 'k' }, UUID);
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 0));
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(false);
  });

  it('recipient (bearer) delete — was missing before B12-1', async () => {
    const { bucket, kv } = setup();
    const req = new Request(`https://w.test/transfer/${UUID}`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_recipient_token' } });
    const res = await handleDeleteTransfer(req, { BUCKET: bucket, STATUS_KV: kv, MINT_PRIVATE_KEY: 'x' }, UUID);
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 0));
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finalise — X4: no plaintext size in dock_index', () => {
  async function finalise(existingDock) {
    const seed = { [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify({ uuid: UUID, tier: 'creative', total_chunks: 2, total_bytes: 12345, upload_complete: false, expiry_timestamp: NOW + DAY }) },
                   [`${UUID}/0000`]: { size: 10, uploaded: NOW }, [`${UUID}/0001`]: { size: 10, uploaded: NOW } };
    const bucket = makeBucket(seed);
    const kv = makeKV({ [`upload_session:${UUID}`]: 'tok', [`dock_index:${UUID}`]: existingDock });
    const req = new Request(`https://w.test/upload/${UUID}/finalise`, {
      method: 'POST', headers: { 'X-Upload-Session': 'tok' },
      body: JSON.stringify({ hashes: [B32, B32], merkle_root: B32 }),
    });
    const res = await handleFinalise(req, { BUCKET: bucket, STATUS_KV: kv }, UUID);
    return { res, entry: JSON.parse(kv._store.get(`dock_index:${UUID}`)) };
  }

  it('writes rail + merkle_root, never size_bytes, and preserves collected', async () => {
    const { res, entry } = await finalise(dockEntry({ collected: true, collected_at: 5 }));
    expect(res.status).toBe(200);
    expect('size_bytes' in entry).toBe(false);
    expect(entry.rail).toBe('identity');
    expect(entry.merkle_root).toBe(B32);
    expect(entry.collected).toBe(true);
  });

  it('strips a legacy size_bytes instead of carrying it forward', async () => {
    const { entry } = await finalise(dockEntry({ size_bytes: 999 }));
    expect('size_bytes' in entry).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Execution Dock API — Active · Expired · Purged', () => {
  it('reports purged with the original expiry, never returns size_bytes', async () => {
    const A = 'a'.repeat(8) + '-0000-4000-8000-000000000001';
    const E = 'a'.repeat(8) + '-0000-4000-8000-000000000002';
    const P = 'a'.repeat(8) + '-0000-4000-8000-000000000003';
    const kv = makeKV({
      [`dock_index:${A}`]: dockEntry({ uuid: A, expiry_timestamp: NOW + 5 * DAY, size_bytes: 111 }),
      [`dock_index:${E}`]: dockEntry({ uuid: E, expiry_timestamp: NOW - DAY,     size_bytes: 222 }),
      [`dock_index:${P}`]: dockEntry({ uuid: P, expiry_timestamp: NOW - 4 * DAY, size_bytes: 333, purged_at: NOW - 100 }),
    });
    const res  = await handleExecutionDock(new Request('https://w.test/admin/execution-dock', { headers: { 'X-Admin-Key': 'k' } }), { STATUS_KV: kv, ADMIN_KEY: 'k' });
    const body = await res.json();
    const by   = Object.fromEntries(body.transfers.map(t => [t.uuid, t]));

    expect(by[A].status).toBe('active');
    expect(by[E].status).toBe('expired');
    expect(by[P].status).toBe('purged');
    expect(by[P].expiry_timestamp).toBe(NOW - 4 * DAY);   // Expires column keeps the original date
    expect(by[P].purged_at).toBe(NOW - 100);
    for (const t of body.transfers) expect('size_bytes' in t).toBe(false);
  });
});
