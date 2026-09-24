// test/sweep_safety.test.js
// Share-B12-1 — what the sweep must NEVER do:
//   touch an in-flight upload younger than 7 days · touch the protected soak
//   UUID · act on more than 25 transfers in one run.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeBucket, makeKV, NOW, DAY, FULL, U, SOAK, transfer, complete, partial, dock, sweep } from './_r2_mock.js';

const flat = (bucket) => bucket._log.deletes.flat();

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000));
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('an in-flight upload younger than 7 days is never touched', () => {
  it('survives every rule, even with stale_hours=1', async () => {
    const A = U(1), B = U(2), C = U(3), D = U(4);
    const bucket = makeBucket({
      ...transfer(A, { present: 0, manifest: partial(A, { created_at: NOW - 3600 }), uploaded: NOW - 3600 }),        // just initiated, no chunks yet
      ...transfer(B, { manifest: partial(B, { created_at: NOW - 5 * DAY }), uploaded: NOW - 4 * DAY }),              // slow upload, day 5
      [`${C}/0000`]: { size: FULL, uploaded: NOW - 6.9 * DAY },                                                     // orphan chunk, 6.9 days
      ...transfer(D, { manifest: partial(D, { created_at: NOW - 30 * DAY }), uploaded: NOW - 60 }),                  // old manifest but active a minute ago
    });
    const kv = makeKV();

    const { body } = await sweep(bucket, kv, 'dry_run=false&stale_hours=1');

    expect(body.stale_hours).toBe(168);          // floored: cannot be tuned below the window
    expect(bucket._log.deletes).toEqual([]);
    expect(bucket._log.puts).toEqual([]);
    expect(kv._log.deletes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('protected soak UUID', () => {
  it.each([
    ['looks stale',   () => transfer(SOAK, { manifest: partial(SOAK, { created_at: NOW - 30 * DAY }), uploaded: NOW - 30 * DAY, hashes: true })],
    ['looks expired', () => transfer(SOAK, { manifest: complete(SOAK, { expiry_timestamp: NOW - 9 * DAY }), hashes: true })],
    ['looks orphaned', () => transfer(SOAK, { uploaded: NOW - 30 * DAY })],
  ])('is never touched, whatever dry_run says (%s)', async (_label, build) => {
    const bucket = makeBucket(build());
    const kv = makeKV({ [`dock_index:${SOAK}`]: dock() });

    const { body } = await sweep(bucket, kv, 'dry_run=false&wrong_size=delete');

    expect(body.summary.protected).toBe(1);
    expect(bucket._log.deletes).toEqual([]);
    expect(bucket._log.puts).toEqual([]);
    expect(kv._log.deletes).toEqual([]);
    expect(kv._log.puts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('action cap', () => {
  it('acts on at most 25 transfers per run and says so', async () => {
    const seed = {};
    for (let i = 1; i <= 27; i++) {
      const u = U(i);
      Object.assign(seed, transfer(u, { present: 0, manifest: partial(u, { created_at: NOW - 20 * DAY }), uploaded: NOW - 20 * DAY }));
    }
    const bucket = makeBucket(seed);
    const { body } = await sweep(bucket, makeKV(), 'dry_run=false');
    expect(body.summary.action_capped).toBe(true);
    expect(flat(bucket).filter(k => k.endsWith('/manifest.json'))).toHaveLength(25);
  });
});
