// test/storage_b12_2.test.js
// B12-2 — GET /admin/storage: aggregates of what R2 holds, never UUIDs or per-transfer sizes.

import { describe, it, expect } from 'vitest';
import { makeBucket } from './_r2_mock.js';
import { buildStorageSummary, handleAdminStorage } from '../src/handlers/storage.js';

const NOW = 1_800_000_000;
const U = (n) => `0000000${n}-0000-4000-8000-000000000000`;
const man = (o) => ({ body: JSON.stringify(o) });
const blob = (size) => ({ body: undefined, size });

function seed() {
  return {
    // live Pro Bono, 2 chunks
    [`${U(1)}/manifest.json`]: man({ tier: 'free', upload_complete: true, expiry_timestamp: NOW + 100 }),
    [`${U(1)}/chunk-0`]: blob(1000), [`${U(1)}/chunk-1`]: blob(500),
    // live Sovereign
    [`${U(2)}/manifest.json`]: man({ tier: 'max', upload_complete: true, expiry_timestamp: NOW + 100 }),
    [`${U(2)}/chunk-0`]: blob(4000),
    // still uploading
    [`${U(3)}/manifest.json`]: man({ tier: 'free', upload_complete: false, expiry_timestamp: NOW + 100 }),
    [`${U(3)}/chunk-0`]: blob(700),
    // expired, not swept
    [`${U(4)}/manifest.json`]: man({ tier: 'creative', upload_complete: true, expiry_timestamp: NOW - 1 }),
    [`${U(4)}/chunk-0`]: blob(300),
    // tombstone
    [`${U(5)}/manifest.json`]: man({ consumed: true, consumed_at: NOW - 5 }),
    // no manifest
    [`${U(6)}/chunk-0`]: blob(200),
    // non-transfer key
    'mirror-canary.txt': blob(10),
  };
}

describe('B12-2 /admin/storage', () => {
  it('splits held bytes by state and tier', async () => {
    const env = { BUCKET: makeBucket(seed()), R2_BUDGET_GIB: '500' };
    const s = await buildStorageSummary(env, NOW);
    expect(s.live.free).toMatchObject({ transfers: 1 });
    expect(s.live.free.bytes).toBeGreaterThanOrEqual(1500);
    expect(s.live.max.transfers).toBe(1);
    expect(s.uploading.transfers).toBe(1);
    expect(s.expired.transfers).toBe(1);
    expect(s.deleted.transfers).toBe(1);
    expect(s.unattached).toEqual({ transfers: 1, bytes: 200 });
    expect(s.other_bytes).toBe(10);
    expect(s.budget_gib).toBe(500);
    expect(s.budget_band_pct).toBe(0);
    expect(s.as_of_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never returns a UUID', async () => {
    const env = { BUCKET: makeBucket(seed()) };
    const out = JSON.stringify(await buildStorageSummary(env, NOW));
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('bands occupancy in 5 % steps, rounded down', async () => {
    const env = { BUCKET: makeBucket({ 'x/a': blob(Math.round(0.149 * 1024 ** 3)) }), R2_BUDGET_GIB: '1' };
    expect((await buildStorageSummary(env, NOW)).budget_band_pct).toBe(10);
  });

  it('pages past 1000 objects', async () => {
    const big = {};
    for (let i = 0; i < 2500; i++) big[`${U(7)}/chunk-${i}`] = blob(1);
    const s = await buildStorageSummary({ BUCKET: makeBucket(big) }, NOW);
    expect(s.objects).toBe(2500);
    expect(s.unattached.bytes).toBe(2500);
  });

  it('401 without the admin key', async () => {
    const r = await handleAdminStorage(new Request('https://x/admin/storage'), { ADMIN_KEY: 'k', BUCKET: makeBucket() });
    expect(r.status).toBe(401);
  });
});
