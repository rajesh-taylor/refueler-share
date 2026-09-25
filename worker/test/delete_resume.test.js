// test/delete_resume.test.js
// Share-Soak-2 — owner/recipient delete: batched, resumable, sidecar-clean.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeBucket, makeKV } from './_r2_mock.js';

vi.mock('../src/nut11.js', () => ({ verifyDownloadToken: vi.fn(async () => ({ valid: true, uuid: globalThis.__uuid })) }));
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

import { handleOwnerDelete, handleDeleteTransfer } from '../src/handlers/delete_transfer.js';

const NOW  = 1_800_000_000;
const UUID = '11111111-2222-4333-8444-555555555555';
const pad  = (i) => String(i).padStart(4, '0');

function transfer(chunks, manifestExtra = {}) {
  const seed = { [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify({ uuid: UUID, total_chunks: chunks, upload_complete: true, ...manifestExtra }) },
                 [`${UUID}/hashes`]: { size: 32 * chunks, uploaded: NOW },
                 [`${UUID}/date-seal.ots.enc`]: { size: 10, uploaded: NOW } };
  for (let i = 0; i < chunks; i++) seed[`${UUID}/${pad(i)}`] = { size: 100, uploaded: NOW };
  return makeBucket(seed);
}
const ownerReq = () => new Request(`https://w.test/transfer/${UUID}`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_owner_x', 'X-Admin-Key': 'k' } });
const ownerEnv = (bucket, kv = makeKV()) => ({ BUCKET: bucket, STATUS_KV: kv, ADMIN_KEY: 'k' });
const remaining = (b) => [...b._store.keys()].sort();

beforeEach(() => { globalThis.__uuid = UUID; vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000); });
afterEach(()  => vi.restoreAllMocks());

describe('owner delete — batching', () => {
  it('2,500 chunks = 3 R2 delete calls (≤1000 keys each), not 2,500', async () => {
    const bucket = transfer(2500);
    const res = await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID);
    expect(res.status).toBe(200);
    expect((await res.json()).destroyed).toBe(true);
    expect(bucket._log.deletes.length).toBe(3);
    expect(Math.max(...bucket._log.deletes.map(d => d.length))).toBeLessThanOrEqual(1000);
  });

  it('leaves only a tombstone: chunks, hashes and date-seal all gone; root_verified + dock_index cleared', async () => {
    const bucket = transfer(5);
    const kv = makeKV({ [`root_verified:${UUID}`]: '1', [`dock_index:${UUID}`]: { uuid: UUID } });
    await handleOwnerDelete(ownerReq(), ownerEnv(bucket, kv), UUID);
    await new Promise(r => setTimeout(r, 0));
    expect(remaining(bucket)).toEqual([`${UUID}/manifest.json`]);
    expect(JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body)).toEqual({ consumed: true, consumed_at: NOW });
    expect(kv._store.has(`root_verified:${UUID}`)).toBe(false);
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(false);
  });

  it('also removes stray chunks beyond total_chunks', async () => {
    const bucket = transfer(3);
    bucket._store.set(`${UUID}/0009`, { size: 1, uploaded: new Date() });
    await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID);
    expect(remaining(bucket)).toEqual([`${UUID}/manifest.json`]);
  });
});

describe('owner delete — resume', () => {
  it('a half-done delete (consumed:true, total_chunks still present) resumes instead of 410', async () => {
    const bucket = transfer(6, { consumed: true, consumed_at: NOW - 500 });
    for (const k of [0, 1, 2]) bucket._store.delete(`${UUID}/${pad(k)}`);   // died after 3 chunks
    const res = await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.destroyed).toBe(true);
    expect(body.consumed_at).toBe(NOW - 500);                                // original timestamp kept
    expect(remaining(bucket)).toEqual([`${UUID}/manifest.json`]);
  });

  it('a real tombstone still returns 410', async () => {
    const bucket = makeBucket({ [`${UUID}/manifest.json`]: { uploaded: NOW, body: JSON.stringify({ consumed: true, consumed_at: NOW - 5 }) } });
    const res = await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID);
    expect(res.status).toBe(410);
  });

  it('a failed batch returns partial, writes NO tombstone, and a retry finishes', async () => {
    const bucket = transfer(1500);
    const realDelete = bucket.delete.bind(bucket);
    let calls = 0;
    bucket.delete = async (keys) => { if (++calls === 2) throw new Error('boom'); return realDelete(keys); };
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = await (await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID)).json();
    expect(first.destroyed).toBe(false);
    expect(first.partial).toBe(true);
    expect(first.remaining).toBeGreaterThan(0);
    const m = JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body);
    expect(m.total_chunks).toBe(1500);                                       // still in-progress, not tombstoned

    bucket.delete = realDelete;
    const second = await handleOwnerDelete(ownerReq(), ownerEnv(bucket), UUID);
    expect(second.status).toBe(200);
    expect((await second.json()).destroyed).toBe(true);
    expect(remaining(bucket)).toEqual([`${UUID}/manifest.json`]);
  });
});

describe('recipient (bearer) delete uses the same sequence', () => {
  it('batches and clears the sidecar', async () => {
    const bucket = transfer(1200);
    const req = new Request(`https://w.test/transfer/${UUID}`, { method: 'DELETE', headers: { Authorization: 'Bearer rfs_recipient_token' } });
    const res = await handleDeleteTransfer(req, { BUCKET: bucket, STATUS_KV: makeKV(), MINT_PRIVATE_KEY: 'x' }, UUID);
    expect(res.status).toBe(200);
    expect(bucket._log.deletes.length).toBe(2);
    expect(remaining(bucket)).toEqual([`${UUID}/manifest.json`]);
  });
});
