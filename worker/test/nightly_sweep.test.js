// test/nightly_sweep.test.js
// Tombstone-30 (16 Oct 2026): the 03:30 nightly sweep — worker/src/nightly_sweep.js.
//
// Covers: a leftover record ({consumed, consumed_at}) is deleted 30 days after
// the transfer ended and never sooner · live, in-progress and odd-shaped
// manifests are never deleted · expired transfers are purged by the same
// executor as the admin sweep (48 h grace) · residue under a consumed manifest
// goes · read and action caps · dry run · admin route auth · /meta 404 after.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  runNightlySweep, handleNightlySweep, isFinalTombstone,
  TOMBSTONE_KEEP_SECONDS, MAX_NIGHTLY_READS,
} from 'src/nightly_sweep.js';
import { makeBucket, makeKV, NOW, DAY, U, transfer, complete, partial, dock } from './_r2_mock.js';
import { transferRequest } from './helpers/transfer-request.js';

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000));
afterEach(() => vi.restoreAllMocks());

const flat = (bucket) => bucket._log.deletes.flat();
const tomb = (uuid, endedAt, uploaded = endedAt) => ({
  [`${uuid}/manifest.json`]: { body: JSON.stringify({ consumed: true, consumed_at: endedAt }), uploaded },
});
const env = (bucket, kv = makeKV()) => ({ BUCKET: bucket, STATUS_KV: kv, ADMIN_KEY: 'k' });

// ─────────────────────────────────────────────────────────────────────────────
describe('isFinalTombstone', () => {
  it('accepts exactly {consumed:true, consumed_at:<number>}', () => {
    expect(isFinalTombstone({ consumed: true, consumed_at: NOW })).toBe(true);
  });
  it('rejects live, in-progress and odd shapes', () => {
    expect(isFinalTombstone(complete(U(1)))).toBe(false);
    expect(isFinalTombstone({ ...complete(U(1)), consumed: true, consumed_at: NOW })).toBe(false); // in progress
    expect(isFinalTombstone({ consumed: true })).toBe(false);
    expect(isFinalTombstone({ consumed: true, consumed_at: 'x' })).toBe(false);
    expect(isFinalTombstone({ consumed: true, consumed_at: NOW, extra: 1 })).toBe(false);
    expect(isFinalTombstone(null)).toBe(false);
  });
  it('keeps for 30 days', () => expect(TOMBSTONE_KEEP_SECONDS).toBe(30 * DAY));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('leftover record — 30 days', () => {
  it('deletes a leftover record 31 days after the transfer ended, and keeps one at 29 days', async () => {
    const OLD = U(1), YOUNG = U(2);
    const bucket = makeBucket({ ...tomb(OLD, NOW - 31 * DAY), ...tomb(YOUNG, NOW - 29 * DAY) });

    const r = await runNightlySweep(env(bucket), NOW);

    expect(flat(bucket)).toEqual([`${OLD}/manifest.json`]);
    expect(bucket._store.has(`${YOUNG}/manifest.json`)).toBe(true);
    expect(r.tombstones_deleted).toBe(1);
  });

  it('goes by consumed_at, not by when R2 wrote the object', async () => {
    const T = U(1);
    // Written long ago, but the record says the transfer ended 10 days ago → keep.
    const bucket = makeBucket(tomb(T, NOW - 10 * DAY, NOW - 40 * DAY));
    await runNightlySweep(env(bucket), NOW);
    expect(bucket._log.deletes).toEqual([]);
  });

  it('never deletes a live transfer, an in-progress deletion or an unrecognised shape, however old', async () => {
    const LIVE = U(1), PART = U(2), PROG = U(3), ODD = U(4);
    const old = NOW - 60 * DAY;
    const bucket = makeBucket({
      ...transfer(LIVE, { manifest: complete(LIVE, { expiry_timestamp: NOW + DAY }), uploaded: old }),
      ...transfer(PART, { present: 0, manifest: partial(PART, { created_at: old }), uploaded: old }),
      [`${PROG}/manifest.json`]: { body: JSON.stringify({ ...complete(PROG), consumed: true, consumed_at: old }), uploaded: old },
      [`${ODD}/manifest.json`]:  { body: JSON.stringify({ consumed: true, consumed_at: old, note: 'x' }), uploaded: old },
    });

    const r = await runNightlySweep(env(bucket), NOW);

    expect(bucket._store.has(`${LIVE}/manifest.json`)).toBe(true);
    expect(bucket._store.has(`${PART}/manifest.json`)).toBe(true);
    expect(bucket._store.has(`${PROG}/manifest.json`)).toBe(true);
    expect(bucket._store.has(`${ODD}/manifest.json`)).toBe(true);
    expect(r.tombstones_deleted).toBe(0);
  });

  it('leaves the leftover record while pieces remain under it, and removes the pieces', async () => {
    const T = U(1);
    const bucket = makeBucket({
      ...transfer(T, { manifest: { consumed: true, consumed_at: NOW - 40 * DAY }, uploaded: NOW - 40 * DAY, hashes: true }),
    });
    const r = await runNightlySweep(env(bucket), NOW);

    expect(flat(bucket)).not.toContain(`${T}/manifest.json`);
    expect(flat(bucket)).toEqual(expect.arrayContaining([`${T}/0000`, `${T}/0001`, `${T}/0002`, `${T}/hashes`]));
    expect(bucket._store.has(`${T}/manifest.json`)).toBe(true);
    expect(r.residue_cleared).toBe(1);

    // Next night, with the pieces gone, the record itself goes.
    bucket._log.deletes.length = 0;
    await runNightlySweep(env(bucket), NOW);
    expect(flat(bucket)).toEqual([`${T}/manifest.json`]);
  });

  it('finishes a deletion that died part-way: pieces go, the leftover record keeps its date', async () => {
    const P = U(1), ended = NOW - 5 * DAY;
    const bucket = makeBucket({ ...transfer(P, { present: 2, manifest: { ...complete(P), consumed: true, consumed_at: ended } }) });
    const r = await runNightlySweep(env(bucket), NOW);
    expect(r.residue_cleared).toBe(1);
    expect(bucket._store.has(`${P}/0000`)).toBe(false);
    expect(JSON.parse(bucket._store.get(`${P}/manifest.json`).body)).toEqual({ consumed: true, consumed_at: ended });
  });

  it('never touches a protected id', async () => {
    const { SWEEP_PROTECTED_UUIDS } = await import('src/sweep_rules.js');
    const T = U(1);
    SWEEP_PROTECTED_UUIDS.add(T);
    try {
      const bucket = makeBucket(tomb(T, NOW - 40 * DAY));
      await runNightlySweep(env(bucket), NOW);
      expect(bucket._log.deletes).toEqual([]);
    } finally { SWEEP_PROTECTED_UUIDS.delete(T); }
  });

  it('after deletion the link reads as absent (404), not deleted (410)', async () => {
    const T = U(1);
    const bucket = makeBucket(tomb(T, NOW - 31 * DAY));
    await runNightlySweep(env(bucket), NOW);
    const { default: worker } = await import('src/index.js');
    const res = await worker.fetch(transferRequest(`https://w.test/meta`, T), env(bucket), { waitUntil() {} });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('expired transfers — nightly purge', () => {
  it('purges a transfer past expiry + 48 h and leaves a leftover record dated now', async () => {
    const E = U(1), B = U(2);
    const bucket = makeBucket({
      ...transfer(E, { manifest: complete(E, { expiry_timestamp: NOW - 3 * DAY }), hashes: true, seal: true }),
      ...transfer(B, { manifest: complete(B), hashes: true }),
    });
    const kv = makeKV({ [`dock_index:${E}`]: dock() });

    const r = await runNightlySweep(env(bucket, kv), NOW);

    expect(r.expired_purged).toBe(1);
    expect(JSON.parse(bucket._store.get(`${E}/manifest.json`).body)).toEqual({ consumed: true, consumed_at: NOW });
    for (const k of [`${E}/0000`, `${E}/0001`, `${E}/0002`, `${E}/hashes`, `${E}/date-seal.ots.enc`]) {
      expect(bucket._store.has(k)).toBe(false);
    }
    // bystander untouched
    expect(flat(bucket).some(k => k.startsWith(B))).toBe(false);
    expect(JSON.parse(kv._store.get(`dock_index:${E}`)).purged_at).toBe(NOW);
  });

  it('keeps a transfer inside the 48 h grace, and one with a download still inside its grace', async () => {
    const G = U(1), D = U(2);
    const bucket = makeBucket({
      ...transfer(G, { manifest: complete(G, { expiry_timestamp: NOW - DAY }) }),
      ...transfer(D, { manifest: complete(D, { expiry_timestamp: NOW - 3 * DAY, download_initiated_at: NOW - DAY }) }),
    });
    const r = await runNightlySweep(env(bucket), NOW);
    expect(r.expired_purged).toBe(0);
    expect(bucket._log.deletes).toEqual([]);
  });

  it('caps transfer actions per night (ACTION_CAP 25) and says so', async () => {
    const seed = {};
    for (let i = 1; i <= 30; i++) Object.assign(seed, transfer(U(i), { manifest: complete(U(i), { expiry_timestamp: NOW - 3 * DAY }) }));
    const bucket = makeBucket(seed);
    const r = await runNightlySweep(env(bucket), NOW);
    expect(r.expired_purged).toBe(25);
    expect(r.action_capped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('limits and dry run', () => {
  it('reads at most MAX_NIGHTLY_READS manifests a night', async () => {
    const seed = {};
    for (let i = 1; i <= MAX_NIGHTLY_READS + 20; i++) Object.assign(seed, transfer(U(i), { manifest: complete(U(i)) }));
    const bucket = makeBucket(seed);
    const spy = vi.spyOn(bucket, 'get');
    const r = await runNightlySweep(env(bucket), NOW);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_NIGHTLY_READS);
    expect(r.read_capped).toBe(true);
  });

  it('dry run reports and writes nothing', async () => {
    const T = U(1), E = U(2);
    const bucket = makeBucket({
      ...tomb(T, NOW - 31 * DAY),
      ...transfer(E, { manifest: complete(E, { expiry_timestamp: NOW - 3 * DAY }) }),
    });
    const kv = makeKV();
    const r = await runNightlySweep(env(bucket, kv), NOW, { dryRun: true });
    expect(r.dry_run).toBe(true);
    expect(r.tombstones_due).toBe(1);
    expect(r.expired_due).toBe(1);
    expect(bucket._log.deletes).toEqual([]);
    expect(bucket._log.puts).toEqual([]);
    expect(kv._log.puts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /admin/nightly-sweep', () => {
  it('refuses without the admin key before touching R2', async () => {
    const bucket = makeBucket();
    const spy = vi.spyOn(bucket, 'list');
    const res = await handleNightlySweep(new Request('https://w.test/admin/nightly-sweep', { method: 'POST' }), env(bucket));
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });

  it('is a dry run unless dry_run=false', async () => {
    const T = U(1);
    const bucket = makeBucket(tomb(T, NOW - 31 * DAY));
    const h = { method: 'POST', headers: { 'X-Admin-Key': 'k' } };

    let res = await handleNightlySweep(new Request('https://w.test/admin/nightly-sweep', h), env(bucket));
    expect((await res.json()).dry_run).toBe(true);
    expect(bucket._log.deletes).toEqual([]);

    res = await handleNightlySweep(new Request('https://w.test/admin/nightly-sweep?dry_run=false', h), env(bucket));
    const body = await res.json();
    expect(body.tombstones_deleted).toBe(1);
    expect(bucket._store.has(`${T}/manifest.json`)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('cron', () => {
  it('the 03:30 trigger runs the sweep; the 03:00 one does not', async () => {
    const { default: worker } = await import('src/index.js');
    const T = U(1);
    const bucket = makeBucket(tomb(T, NOW - 31 * DAY));
    await worker.scheduled({ cron: '30 3 * * *' }, env(bucket), {});
    expect(bucket._store.has(`${T}/manifest.json`)).toBe(false);

    const bucket2 = makeBucket(tomb(T, NOW - 31 * DAY));
    const spy = vi.spyOn(bucket2, 'list');
    await worker.scheduled({ cron: '0 3 * * *' }, env(bucket2), {}).catch(() => {});
    expect(spy).not.toHaveBeenCalledWith({ limit: 1000 });
    expect(bucket2._store.has(`${T}/manifest.json`)).toBe(true);
  });
});
