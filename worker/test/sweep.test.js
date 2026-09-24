// test/sweep.test.js
// Unit tests for worker/src/handlers/orphan_sweep.js + worker/src/sweep_rules.js
// Share-B12-1 (B12 §6, B12-SR §S1.10 / §S3(b)).
//
// Covers: dry run writes nothing · purge marks only on its own transition ·
// each sweep rule deletes exactly its target and nothing else.
// (In-flight / protected-UUID / action-cap safety lives in sweep_safety.test.js.)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleOrphanSweep } from 'src/handlers/orphan_sweep.js';
import { makeBucket, makeKV, NOW, DAY, FULL, U, transfer, complete, partial, dock, sweep } from './_r2_mock.js';

const flat = (bucket) => bucket._log.deletes.flat();

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000));
afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
describe('auth', () => {
  it('rejects a missing admin key before touching R2', async () => {
    const bucket = makeBucket();
    const spy = vi.spyOn(bucket, 'list');
    const res = await handleOrphanSweep(new Request('https://w.test/admin/orphan-sweep'), { BUCKET: bucket, STATUS_KV: makeKV(), ADMIN_KEY: 'k' });
    expect(res.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('dry run', () => {
  it('reports every class but writes and deletes nothing', async () => {
    const E = U(1), T = U(2), S = U(3), O = U(4), W = U(5);
    const bucket = makeBucket({
      ...transfer(E, { manifest: complete(E, { expiry_timestamp: NOW - 3 * DAY }), hashes: true, seal: true }), // expired → purgeable
      ...transfer(T, { manifest: { consumed: true, consumed_at: NOW - DAY } }),                                // tombstone residue
      ...transfer(S, { manifest: partial(S, { created_at: NOW - 10 * DAY }), uploaded: NOW - 10 * DAY }),      // stale
      ...transfer(O, { uploaded: NOW - 9 * DAY }),                                                             // orphan, old
      ...transfer(W, { total: 4, present: 5, manifest: complete(W, { total_chunks: 4 }) }),                    // has index 4 ≥ total → wrong size
    });
    const kv = makeKV({ [`dock_index:${E}`]: dock(), [`dock_index:${S}`]: dock() });

    const { body } = await sweep(bucket, kv); // default = dry run

    expect(body.dry_run).toBe(true);
    expect(bucket._log.puts).toEqual([]);
    expect(bucket._log.deletes).toEqual([]);
    expect(kv._log.puts).toEqual([]);
    expect(kv._log.deletes).toEqual([]);

    expect(body.summary.expired_purgeable).toBe(1);
    expect(body.summary.tombstone_residue).toBe(1);
    expect(body.summary.stale).toBe(1);
    expect(body.summary.orphan_chunks).toBe(1);
    expect(body.summary.wrong_size).toBe(1);
    expect(body.summary.would_delete_objects).toBeGreaterThan(0);
    expect(body.summary.deleted_objects).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('expired purge — PURGED marking (B12 §6.2, SR §S3(b))', () => {
  it('purges an expired transfer and marks purged_at because THIS run made the transition', async () => {
    const E = U(1), B = U(9);
    const bucket = makeBucket({
      ...transfer(E, { manifest: complete(E, { expiry_timestamp: NOW - 3 * DAY }), hashes: true, seal: true }),
      ...transfer(B, { manifest: complete(B), hashes: true }), // healthy bystander
    });
    const kv = makeKV({ [`dock_index:${E}`]: dock({ collected: false }), [`dock_index:${B}`]: dock({ expiry_timestamp: NOW + DAY }) });

    const { body } = await sweep(bucket, kv, 'dry_run=false');

    // exact objects, in order: chunks → hashes+seal (tombstone replaces the manifest)
    expect(bucket._log.deletes).toEqual([
      [`${E}/0000`, `${E}/0001`, `${E}/0002`],
      [`${E}/hashes`, `${E}/date-seal.ots.enc`],
    ]);
    expect(body.summary.purged).toBe(1);
    expect(body.summary.deleted_objects).toBe(5);

    // guard write first (full manifest, consumed), tombstone last
    const guard = JSON.parse(bucket._log.puts[0].value);
    expect(guard.consumed).toBe(true);
    expect(guard.total_chunks).toBe(3);
    expect(JSON.parse(bucket._log.puts.at(-1).value).consumed).toBe(true);

    // dock entry: purged_at set, original expiry kept, 7-day display TTL
    const entry = JSON.parse(kv._store.get(`dock_index:${E}`));
    expect(entry.purged_at).toBe(NOW);
    expect(entry.expiry_timestamp).toBe(NOW - 3 * DAY);
    expect(entry.tier).toBe('creative');
    expect(kv._log.puts.find(p => p.key === `dock_index:${E}`).opts.expirationTtl).toBe(7 * DAY);
    expect(body.summary.dock_marked).toBe(1);
    expect(kv._log.deletes).toContain(`root_verified:${E}`);

    // bystander untouched
    expect([...bucket._store.keys()].filter(k => k.startsWith(B))).toHaveLength(5);
    expect(kv._store.has(`dock_index:${B}`)).toBe(true);
    expect(JSON.parse(kv._store.get(`dock_index:${B}`)).purged_at).toBeUndefined();
  });

  it('does NOT mark purged_at when another path consumed the transfer first — the entry is removed', async () => {
    const E = U(1);
    const m = complete(E, { expiry_timestamp: NOW - 3 * DAY });
    const bucket = makeBucket(transfer(E, { manifest: m, hashes: true }));
    const kv = makeKV({ [`dock_index:${E}`]: dock() });

    // Classification sees it unconsumed; by the time the sweep re-reads, DAD has won.
    const realGet = bucket.get.bind(bucket);
    let reads = 0;
    bucket.get = async (key) => {
      if (key === `${E}/manifest.json` && ++reads === 2) {
        bucket._store.get(key).body = JSON.stringify({ ...m, consumed: true, consumed_at: NOW - 5 });
      }
      return realGet(key);
    };

    const { body } = await sweep(bucket, kv, 'dry_run=false');

    expect(bucket._log.deletes).toEqual([]);
    expect(bucket._log.puts).toEqual([]);
    expect(body.summary.purged).toBe(0);
    expect(body.summary.purge_skipped).toBe(1);
    expect(kv._store.has(`dock_index:${E}`)).toBe(false);                          // absence
    expect(kv._log.puts.some(p => p.value.includes('purged_at'))).toBe(false);     // never marked
  });

  it('leaves alone: expired but inside the 48 h grace, or a download still inside its grace', async () => {
    const A = U(1), D = U(2);
    const bucket = makeBucket({
      ...transfer(A, { manifest: complete(A, { expiry_timestamp: NOW - 47 * 3600 }) }),
      ...transfer(D, { manifest: complete(D, { expiry_timestamp: NOW - 3 * DAY, download_initiated_at: NOW - 3600 }) }),
    });
    const { body } = await sweep(bucket, makeKV(), 'dry_run=false');
    expect(body.summary.expired_purgeable).toBe(0);
    expect(bucket._log.deletes).toEqual([]);
    expect(bucket._log.puts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S1.10 rule 1 — chunks under a tombstoned UUID', () => {
  it('deletes the residue, keeps the tombstone manifest, removes the dock entry, never marks purged', async () => {
    const T = U(2), B = U(9);
    const bucket = makeBucket({
      ...transfer(T, { manifest: { consumed: true, consumed_at: NOW - DAY }, hashes: true, seal: true }),
      ...transfer(B, { manifest: complete(B) }),
    });
    const kv = makeKV({ [`dock_index:${T}`]: dock() });

    await sweep(bucket, kv, 'dry_run=false');

    expect(bucket._log.deletes).toEqual([
      [`${T}/0000`, `${T}/0001`, `${T}/0002`],
      [`${T}/hashes`, `${T}/date-seal.ots.enc`],
    ]);
    expect(bucket._store.has(`${T}/manifest.json`)).toBe(true);   // the recipient's 410 survives
    expect(bucket._log.puts).toEqual([]);
    expect(kv._store.has(`dock_index:${T}`)).toBe(false);
    expect(kv._log.puts).toEqual([]);
    expect([...bucket._store.keys()].filter(k => k.startsWith(B))).toHaveLength(4);
  });

  it('does nothing to a clean tombstone', async () => {
    const T = U(2);
    const bucket = makeBucket(transfer(T, { present: 0, manifest: { consumed: true, consumed_at: NOW - DAY } }));
    const kv = makeKV();
    await sweep(bucket, kv, 'dry_run=false');
    expect(bucket._log.deletes).toEqual([]);
    expect(kv._log.deletes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S1.10 rule 2 — orphan chunks older than 7 days', () => {
  it('deletes only the chunk objects whose R2 uploaded is older than 7 days', async () => {
    const O = U(4), Y = U(5);
    const bucket = makeBucket({
      [`${O}/0000`]: { size: FULL, uploaded: NOW - 8 * DAY },
      [`${O}/0001`]: { size: FULL, uploaded: NOW - 8 * DAY },
      [`${O}/0002`]: { size: FULL, uploaded: NOW - 1 * DAY },   // young: same UUID, must stay
      ...transfer(Y, { uploaded: NOW - 2 * DAY }),              // all young: must stay
    });
    const kv = makeKV();

    await sweep(bucket, kv, 'dry_run=false');

    expect(flat(bucket).sort()).toEqual([`${O}/0000`, `${O}/0001`]);
    expect(bucket._store.has(`${O}/0002`)).toBe(true);
    expect([...bucket._store.keys()].filter(k => k.startsWith(Y))).toHaveLength(3);
    expect(kv._log.deletes).toEqual([]); // no index entry to touch
    expect(kv._log.puts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S1.10 rule 3 — wrong-size objects', () => {
  const seed = (X, Y) => ({
    [`${X}/0000`]: { size: FULL },        // ok
    [`${X}/0001`]: { size: FULL - 1 },    // full chunk, wrong size  → bad
    [`${X}/0002`]: { size: FULL },        // ok
    [`${X}/0003`]: { size: 1000 },        // tail, smaller           → ok
    [`${X}/0004`]: { size: FULL },        // index ≥ total_chunks    → bad
    [`${X}/manifest.json`]: { body: JSON.stringify(complete(X, { total_chunks: 4 })) },
    [`${Y}/0000`]: { size: FULL },
    [`${Y}/0001`]: { size: FULL + 1 },    // tail larger than a full chunk → bad
    [`${Y}/manifest.json`]: { body: JSON.stringify(complete(Y, { total_chunks: 2 })) },
  });
  const withTime = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { uploaded: NOW - DAY, ...v }]));

  it('reports but does not delete by default', async () => {
    const X = U(6), Y = U(7);
    const bucket = makeBucket(withTime(seed(X, Y)));
    const { body } = await sweep(bucket, makeKV(), 'dry_run=false');
    expect(body.summary.wrong_size).toBe(2);
    expect(bucket._log.deletes).toEqual([]);
  });

  it('with ?wrong_size=delete removes exactly the offenders', async () => {
    const X = U(6), Y = U(7);
    const bucket = makeBucket(withTime(seed(X, Y)));
    await sweep(bucket, makeKV(), 'dry_run=false&wrong_size=delete');
    expect(flat(bucket).sort()).toEqual([`${X}/0001`, `${X}/0004`, `${Y}/0001`]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('stale never-finalised uploads (existing rule, now 7-day safe)', () => {
  it('deletes chunks → hashes+seal → manifest, in that order, and removes the dock entry', async () => {
    const S = U(3), F = U(8);
    const bucket = makeBucket({
      ...transfer(S, { manifest: partial(S, { created_at: NOW - 10 * DAY }), hashes: true, uploaded: NOW - 10 * DAY }),
      ...transfer(F, { manifest: partial(F, { created_at: NOW - 2 * DAY }), uploaded: NOW - 3600 }), // in flight
    });
    const kv = makeKV({ [`dock_index:${S}`]: dock() });

    await sweep(bucket, kv, 'dry_run=false');

    expect(bucket._log.deletes).toEqual([
      [`${S}/0000`, `${S}/0001`, `${S}/0002`],
      [`${S}/hashes`, `${S}/date-seal.ots.enc`],
      [`${S}/manifest.json`],
    ]);
    expect(kv._store.has(`dock_index:${S}`)).toBe(false);
    expect([...bucket._store.keys()].filter(k => k.startsWith(F))).toHaveLength(4);
  });
});

