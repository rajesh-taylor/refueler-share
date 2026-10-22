// OSA-Tools-2 (22 Oct 2026) — take-down, the removed record, and the Execution Dock fixes.
// Plan: private docs/OSA-Tools-plan-v1.md §3 (take-down), §6 (dock), §8 "OSA-Tools-2".
//
//   • take-down: admin any category; helper csea / terrorism only (fraud → 403); 409 / 400
//     cases; idempotent; 410 on a plain record; part-way → 202 and the retry still ends
//     removed; register failure → register_updated:false (destroy first, record second)
//   • the removed record is ≤ 64 bytes and swept after 30 days (F7); every path that
//     finishes a take-down keeps removed (resume, racing destroy, nightly residue)
//   • /meta: 410 removed vs 410 deleted — only /meta tells them apart
//   • dock: initiate write awaited (late put), one retry, uuid in value + metadata;
//     > 1,000 keys paged by cursor from metadata alone; legacy get() fallback
//   • finalise: status 'complete'; dock entry keeps uuid, gains metadata, made if missing

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import worker from '../src/index.js';
import { forgetApiKey } from '../src/api_store.js';
import { buildTombstone } from '../src/manifest_tg.js';
import { destroyTransfer } from '../src/handlers/delete_transfer.js';
import { runNightlySweep, isFinalTombstone, TOMBSTONE_MAX_BYTES } from '../src/nightly_sweep.js';
import { handleExecutionDock, writeDockEntry } from '../src/handlers/execution_dock.js';
import { handleFinalise } from '../src/handlers/finalise.js';
import { computeCommitment } from '../src/commitment.js';
import { importTestCredKey, makeTestCredential } from '../src/testcred.js';
import { makeSessionToken } from '../src/upload_session.js';
import { makeBucket, makeKV } from './_r2_mock.js';
import { makeKv } from './helpers/kv-mock.js';
import { makeSupabase, makeEnv, ctx, ADMIN, ORIGIN } from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';

const HELPER = 'helper-key-test-0123456789abcdef-0123456789';
const UUID   = 'ab1602aa-d9cb-469f-a165-70867728950e';
const UUID8  = 'ab1602aa';
const OTHER  = '0f8fad5b-d9cb-469f-a165-70867728950e';
const NOW    = () => Math.floor(Date.now() / 1000);
const pad    = (i) => String(i).padStart(4, '0');

let sb;
let failRpc = null;   // name of one Supabase function to fail (503), or null
beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  failRpc = null;
  vi.stubGlobal('fetch', async (url, opts = {}) =>
    failRpc && String(url).includes(`/rpc/${failRpc}`) ? new Response('down', { status: 503 }) : sb.fetchImpl(url, opts));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function liveTransfer(uuid = UUID, chunks = 3, extra = {}) {
  const seed = {
    [`${uuid}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify({ uuid, tier: 'free', total_chunks: chunks, upload_complete: true,
      expiry_timestamp: NOW() + 86400, created_at: NOW() - 60, status: 'complete', ...extra }) },
    [`${uuid}/hashes`]: { size: 32 * chunks, uploaded: NOW() },
  };
  for (let i = 0; i < chunks; i++) seed[`${uuid}/${pad(i)}`] = { size: 100, uploaded: NOW() };
  return seed;
}
const envWith = (seed, o = {}) => {
  const e = makeEnv({ HELPER_KEY: HELPER, BUCKET: makeBucket(seed), ...o });
  e.STATUS_KV._store.set(`dock_index:${UUID}`, JSON.stringify({ uuid: UUID, expiry_timestamp: NOW() + 86400, created_at: NOW() - 60, tier: 'free' }));
  return e;
};
const call = (e, method, path, { key = ADMIN, body, uuid } = {}) => {
  const headers = { ...(key ? { 'X-Admin-Key': key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const init = { method, headers, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) };
  return worker.fetch(uuid ? transferRequest(`${ORIGIN}${path}`, uuid, init) : new Request(`${ORIGIN}${path}`, init), e, ctx);
};
const openCase = async (e, o = {}, key = ADMIN) => {
  const res = await call(e, 'POST', '/admin/reports/open', { key, body: { training: true, route: 'report@', category: 'csea', uuid8: UUID8, ...o } });
  expect(res.status).toBe(200);
  return (await res.json()).case_ref;
};
const takedown = (e, caseRef, { key = ADMIN, confirm = UUID8, uuid = UUID, body } = {}) =>
  call(e, 'POST', '/admin/reports/takedown', { key, uuid, body: body ?? { case_ref: caseRef, confirm } });
const stored = (e, uuid = UUID) => { const o = e.BUCKET._store.get(`${uuid}/manifest.json`); return o ? JSON.parse(o.body) : null; };
const keysUnder = (e, uuid = UUID) => [...e.BUCKET._store.keys()].filter((k) => k.startsWith(`${uuid}/`)).sort();
const meta = async (e, uuid = UUID) => { const r = await call(e, 'GET', '/meta', { key: null, uuid }); return [r.status, await r.json()]; };
const lookup = async (e) => (await call(e, 'GET', '/admin/reports/lookup', { uuid: UUID })).json();

// ── POST /admin/reports/takedown ─────────────────────────────────────────────
describe('take-down — the admin key, any category', () => {
  it('removes every object, leaves the removed record, clears the dock, records it in the register', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e, { category: 'fraud' });
    const res = await takedown(e, ref);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const j = await res.json();
    expect(j).toEqual({ destroyed: true, removed_at: NOW(), register_updated: true });
    expect(keysUnder(e)).toEqual([`${UUID}/manifest.json`]);
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW(), removed: true });
    expect(e.STATUS_KV._store.has(`dock_index:${UUID}`)).toBe(false);
    const row = sb.reports.register.get(ref);
    expect(row).toMatchObject({ takedown_at: NOW(), takedown_by: 'admin', decision: 'open' });   // closing is a separate step
    expect(sb.reports.events.filter((x) => x.case_ref === ref).map((x) => x.action)).toEqual(['open', 'takedown']);
    expect(await lookup(e)).toEqual({ state: 'removed', consumed: true });
    expect(await meta(e)).toEqual([410, { error: 'removed' }]);
  });

  it('confirm is matched case-insensitively against the first 8 characters', async () => {
    const e = envWith(liveTransfer());
    expect((await takedown(e, await openCase(e), { confirm: 'AB1602AA' })).status).toBe(200);
  });
});

describe('take-down — the helper key', () => {
  it.each(['csea', 'terrorism'])('%s case → allowed, recorded as by helper', async (category) => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e, { category }, HELPER);
    const res = await takedown(e, ref, { key: HELPER });
    expect(res.status).toBe(200);
    expect(sb.reports.register.get(ref).takedown_by).toBe('helper');
    expect(stored(e).removed).toBe(true);
  });

  it.each(['fraud', 'iia', 'other_illegal', 'terms'])('%s case → 403 helper_category, nothing touched', async (category) => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e, { category });
    const before = keysUnder(e);
    const res = await takedown(e, ref, { key: HELPER });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'helper_category' });
    expect(keysUnder(e)).toEqual(before);
    expect(stored(e).consumed).toBeUndefined();
    expect(sb.reports.register.get(ref).takedown_at).toBeNull();
  });

  it('the category comes from the register row: a body naming one is refused, not obeyed', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e, { category: 'fraud' });
    const res = await takedown(e, ref, { key: HELPER, body: { case_ref: ref, confirm: UUID8, category: 'csea' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('unknown_field');
    expect(stored(e).consumed).toBeUndefined();
  });
});

describe('take-down — refusals (nothing deleted)', () => {
  it('409 case_mismatch: no such case, another link, a closed case', async () => {
    const e = envWith(liveTransfer());
    const other  = await openCase(e, { uuid8: OTHER.slice(0, 8) });
    const closed = await openCase(e);
    await call(e, 'POST', '/admin/reports/update', { body: { case_ref: closed, decision: 'not_removed' } });
    for (const [ref, why] of [[`T-${new Date().getUTCFullYear()}-999`, 'no_such_case'], [other, 'other_link'], [closed, 'case_closed']]) {
      const res = await takedown(e, ref);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'case_mismatch', why });
    }
    expect(stored(e).consumed).toBeUndefined();
  });

  it('400 confirm_mismatch: wrong, short, missing — checked server-side', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e);
    for (const body of [{ case_ref: ref, confirm: 'ab1602ab' }, { case_ref: ref, confirm: 'ab1602' }, { case_ref: ref }, { case_ref: ref, confirm: 12345678 }]) {
      const res = await takedown(e, ref, { body });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('confirm_mismatch');
    }
    expect(stored(e).consumed).toBeUndefined();
  });

  it('400 on a bad body, bad case reference or no transfer ID; 401 with no key or a wrong one', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e);
    expect((await takedown(e, ref, { body: { case_ref: 'R-26-1', confirm: UUID8 } })).status).toBe(400);
    expect((await takedown(e, ref, { body: [] })).status).toBe(400);
    expect((await call(e, 'POST', '/admin/reports/takedown', { body: '{not json' , uuid: UUID })).status).toBe(400);
    expect((await call(e, 'POST', '/admin/reports/takedown', { body: { case_ref: ref, confirm: UUID8 } })).status).toBe(400);
    expect((await takedown(e, ref, { key: null })).status).toBe(401);
    expect((await takedown(e, ref, { key: 'wrong' })).status).toBe(401);
    expect(stored(e).consumed).toBeUndefined();
  });

  it('404 when the link has no record at all', async () => {
    const e = envWith({});
    const res = await takedown(e, await openCase(e));
    expect(res.status).toBe(404);
  });

  it('register unavailable before the take-down → 503, nothing deleted', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e);
    failRpc = 'report_get';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await takedown(e, ref)).status).toBe(503);
    expect(stored(e).consumed).toBeUndefined();
  });
});

describe('take-down — already gone, idempotent, part-way, register failure', () => {
  it('a second take-down → 200 already_removed; the register is left alone', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e);
    await takedown(e, ref);
    const events = sb.reports.events.length;
    const res = await takedown(e, ref);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ already_removed: true, removed_at: NOW() });
    expect(sb.reports.events.length).toBe(events);
  });

  it('a second report about the same link: already_removed, its row untouched (closed by hand)', async () => {
    const e = envWith(liveTransfer());
    const first = await openCase(e), second = await openCase(e);
    await takedown(e, first);
    expect((await (await takedown(e, second)).json()).already_removed).toBe(true);
    expect(sb.reports.register.get(second).takedown_at).toBeNull();
  });

  it('a plain record (deleted after download, or swept) → 410 already_gone, record unchanged', async () => {
    const e = envWith({ [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify(buildTombstone(NOW() - 5)) } });
    const res = await takedown(e, await openCase(e));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'already_gone' });
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW() - 5 });
    expect(await meta(e)).toEqual([410, { error: 'deleted' }]);
  });

  it('a plain deletion left part-way is finished as what it was → 410 already_gone, plain record', async () => {
    const seed = liveTransfer(UUID, 3, { consumed: true, consumed_at: NOW() - 9 });
    const e = envWith(seed);
    const res = await takedown(e, await openCase(e));
    expect(res.status).toBe(410);
    expect(keysUnder(e)).toEqual([`${UUID}/manifest.json`]);
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW() - 9 });
  });

  it('part-way → 202 partial; the link already reads removed; the retry finishes and still ends removed', async () => {
    const e = envWith(liveTransfer(UUID, 5));
    const ref = await openCase(e);
    const real = e.BUCKET.delete.bind(e.BUCKET);
    e.BUCKET.delete = async () => { throw new Error('r2 down'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await takedown(e, ref);
    expect(first.status).toBe(202);
    expect((await first.json()).partial).toBe(true);
    expect(stored(e)).toMatchObject({ consumed: true, removed: true, total_chunks: 5 });   // latched, not yet a record
    expect(await meta(e)).toEqual([410, { error: 'removed' }]);
    expect(sb.reports.register.get(ref).takedown_at).toBeNull();

    e.BUCKET.delete = real;
    const second = await takedown(e, ref);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ destroyed: true, register_updated: true });
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW(), removed: true });
  });

  it('register write fails after the destroy → 200 destroyed, register_updated:false, removed_at for the hand entry', async () => {
    const e = envWith(liveTransfer());
    const ref = await openCase(e);
    failRpc = 'report_takedown';
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await takedown(e, ref);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ destroyed: true, removed_at: NOW(), register_updated: false });
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW(), removed: true });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).not.toContain(ref);
    expect(logged).not.toContain(UUID);
  });

  it('the old DELETE /transfer owner path still deletes without the removed mark (test clean-up)', async () => {
    const e = envWith(liveTransfer());
    const res = await worker.fetch(transferRequest(`${ORIGIN}/transfer`, UUID,
      { method: 'DELETE', headers: { Authorization: 'Bearer rfs_owner_x', 'X-Admin-Key': ADMIN } }), e, ctx);
    expect(res.status).toBe(200);
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW() });
  });
});

// ── the removed record (F7) ──────────────────────────────────────────────────
describe('the removed record — ≤ 64 bytes, swept after 30 days', () => {
  it('is exactly {consumed, consumed_at, removed}: 57 bytes, ≤ TOMBSTONE_MAX_BYTES even at 10-digit times', () => {
    expect(TOMBSTONE_MAX_BYTES).toBe(64);
    expect(JSON.stringify(buildTombstone(1_800_000_000, { removed: true }))).toBe('{"consumed":true,"consumed_at":1800000000,"removed":true}');
    expect(JSON.stringify(buildTombstone(1_800_000_000, { removed: true })).length).toBe(57);
    expect(JSON.stringify(buildTombstone(9_999_999_999, { removed: true })).length).toBeLessThanOrEqual(TOMBSTONE_MAX_BYTES);
    expect(buildTombstone(1_800_000_000)).toEqual({ consumed: true, consumed_at: 1_800_000_000 });
  });

  it('isFinalTombstone accepts removed: true and nothing else extra', () => {
    expect(isFinalTombstone({ consumed: true, consumed_at: 1, removed: true })).toBe(true);
    expect(isFinalTombstone({ consumed: true, consumed_at: 1, removed: false })).toBe(false);
    expect(isFinalTombstone({ consumed: true, consumed_at: 1, removed: 'yes' })).toBe(false);
    expect(isFinalTombstone({ consumed: true, consumed_at: 1, removed: true, case_ref: 'R-2026-001' })).toBe(false);
  });

  it('the nightly sweep deletes a removed record 31 days on and keeps one at 29 days', async () => {
    const T0 = 1_800_000_000, DAY = 86400;
    vi.spyOn(Date, 'now').mockReturnValue(T0 * 1000);
    const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
    const rec = (at) => ({ body: JSON.stringify(buildTombstone(at, { removed: true })), uploaded: at });
    const bucket = makeBucket({ [`${A}/manifest.json`]: rec(T0 - 31 * DAY), [`${B}/manifest.json`]: rec(T0 - 29 * DAY) });
    const r = await runNightlySweep({ BUCKET: bucket, STATUS_KV: makeKV() }, T0);
    expect(r.tombstones_deleted).toBe(1);
    expect(bucket._store.has(`${A}/manifest.json`)).toBe(false);
    expect(bucket._store.has(`${B}/manifest.json`)).toBe(true);
  });

  it('the sweep finishing a take-down left part-way writes the removed record', async () => {
    const T0 = 1_800_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(T0 * 1000);
    const bucket = makeBucket({
      [`${UUID}/manifest.json`]: { body: JSON.stringify({ uuid: UUID, total_chunks: 2, consumed: true, consumed_at: T0 - 100, removed: true }), uploaded: T0 - 100 },
      [`${UUID}/0001`]: { size: 1, uploaded: T0 - 200 },
    });
    await runNightlySweep({ BUCKET: bucket, STATUS_KV: makeKV() }, T0);
    expect(JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body)).toEqual({ consumed: true, consumed_at: T0 - 100, removed: true });
  });

  it('a destroy that loses the latch to a take-down (download racing it) still writes removed', async () => {
    const seed = liveTransfer();
    const e = envWith(seed);
    const preRead = stored(e);   // the download path read the manifest before the take-down latched
    const m = { ...preRead, consumed: true, consumed_at: NOW(), removed: true };
    e.BUCKET._store.set(`${UUID}/manifest.json`, { ...e.BUCKET._store.get(`${UUID}/manifest.json`), body: JSON.stringify(m) });
    const r = await destroyTransfer(e, UUID, preRead, NOW(), 'DAD');
    expect(r.destroyed).toBe(true);
    expect(stored(e)).toEqual({ consumed: true, consumed_at: NOW(), removed: true });
  });
});

// ── /meta ────────────────────────────────────────────────────────────────────
describe('/meta — removed vs deleted (only /meta tells them apart)', () => {
  it('removed record → 410 removed; plain record → 410 deleted; being deleted → 410 deleted; nothing else in the body', async () => {
    const cases = [
      [buildTombstone(NOW(), { removed: true }), { error: 'removed' }],
      [buildTombstone(NOW()), { error: 'deleted' }],
      [{ uuid: UUID, total_chunks: 3, consumed: true, consumed_at: NOW(), file_name: 'x' }, { error: 'deleted' }],
    ];
    for (const [m, want] of cases) {
      const e = envWith({ [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify(m) } });
      expect(await meta(e)).toEqual([410, want]);
    }
  });

  it('a download request on a removed link gets the general 410 (no "removed")', async () => {
    const e = envWith({ [`${UUID}/manifest.json`]: { uploaded: NOW(), body: JSON.stringify(buildTombstone(NOW(), { removed: true })) } });
    const res = await worker.fetch(transferRequest(`${ORIGIN}/download`, UUID, { headers: { 'X-Part': '0000' } }), e, ctx);
    expect(res.status).toBe(410);
    expect(await res.text()).not.toContain('removed');
  });
});

// ── Execution Dock — initiate write (F1, F2) ─────────────────────────────────
const KEY = 'test-commitment-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TC_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
async function initiate(e) {
  const exp = NOW() + 3600;
  const req = transferRequest(`${ORIGIN}/upload/initiate`, UUID, {
    method: 'POST',
    headers: {
      'X-Cashu-Credential': '{}', 'X-Total-Chunks': '1', 'X-Total-Bytes': '100', 'X-Expiry-Timestamp': String(exp),
      'X-Credential-Commitment': await computeCommitment(KEY, UUID, 'free', 7 * 24 * 3600),
      'X-Test-Credential': await makeTestCredential(await importTestCredKey({ TEST_CRED_KEY: TC_KEY }), UUID, 8000, exp),
    },
  });
  return worker.fetch(req, e, ctx);
}

describe('Execution Dock — the initiate write', () => {
  it('is awaited: a put that resolves late is done before the response; uuid in value and metadata', async () => {
    const kv = makeKv();
    const realPut = kv.put.bind(kv);
    let landed = false;
    kv.put = async (k, v, o) => {
      if (!k.startsWith('dock_index:')) return realPut(k, v, o);
      await new Promise((r) => setTimeout(r, 40));
      await realPut(k, v, o);
      landed = true;
    };
    const e = makeEnv({ STATUS_KV: kv });
    const res = await initiate(e);
    expect(res.status).toBe(200);
    expect(landed).toBe(true);
    const entry = JSON.parse(kv._store.get(`dock_index:${UUID}`));
    expect(entry).toMatchObject({ uuid: UUID, tier: 'free', file_name: 'encrypted-payload', created_at: NOW() });
    expect(kv._meta.get(`dock_index:${UUID}`).metadata).toEqual(entry);
    expect(kv._meta.get(`dock_index:${UUID}`).expirationTtl).toBeGreaterThan(48 * 3600);
  });

  it('one failure is retried; two failures are logged (uuid8 only) and initiate still succeeds', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const fails of [1, 2]) {
      const kv = makeKv();
      const realPut = kv.put.bind(kv);
      let n = 0;
      kv.put = async (k, v, o) => {
        if (k.startsWith('dock_index:') && n++ < fails) throw new Error('kv down');
        return realPut(k, v, o);
      };
      const res = await initiate(makeEnv({ STATUS_KV: kv }));
      expect(res.status).toBe(200);
      expect(kv._store.has(`dock_index:${UUID}`)).toBe(fails === 1);
    }
    const lines = log.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('Execution Dock'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(UUID8);
    expect(lines[0]).not.toContain(UUID);
  });

  it('writeDockEntry drops metadata it could not fit (KV 1,024-byte limit), keeps the value', async () => {
    const kv = makeKv();
    await writeDockEntry(kv, UUID, { uuid: UUID, expiry_timestamp: NOW() + 10, pad: 'x'.repeat(1200) }, NOW(), { retryMs: 0 });
    expect(kv._store.has(`dock_index:${UUID}`)).toBe(true);
    expect(kv._meta.get(`dock_index:${UUID}`).metadata).toBeUndefined();
  });
});

// ── Execution Dock — the list (F3) ───────────────────────────────────────────
describe('Execution Dock — every page, from metadata; legacy get() fallback', () => {
  const dockReq = () => new Request('https://w.test/admin/execution-dock', { headers: { 'X-Admin-Key': 'k' } });
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('> 1,000 keys: pages through the cursor, reads no key one by one, finds the newest on the last page', async () => {
    const kv = makeKv();
    for (let n = 0; n < 1500; n++) {
      const entry = { uuid: id(n), expiry_timestamp: NOW() + 86400, created_at: NOW() - 100000 + n, tier: 'free' };
      await kv.put(`dock_index:${id(n)}`, JSON.stringify(entry), { metadata: entry });
    }
    const list = vi.spyOn(kv, 'list');
    const get  = vi.spyOn(kv, 'get');
    const res = await handleExecutionDock(dockReq(), { ADMIN_KEY: 'k', STATUS_KV: kv });
    const j = await res.json();
    expect(list).toHaveBeenCalledTimes(2);
    expect(get).not.toHaveBeenCalled();
    expect(j.transfers).toHaveLength(200);
    expect(j.transfers[0].uuid).toBe(id(1499));
    expect(j.transfers.every((t) => typeof t.uuid === 'string')).toBe(true);
  });

  it('a legacy key without metadata is read with get(); its transfer ID comes from the key name', async () => {
    const kv = makeKv();
    const fresh = { uuid: id(1), expiry_timestamp: NOW() + 86400, created_at: NOW() - 10, tier: 'max' };
    await kv.put(`dock_index:${id(1)}`, JSON.stringify(fresh), { metadata: fresh });
    await kv.put(`dock_index:${id(2)}`, JSON.stringify({ expiry_timestamp: NOW() + 86400, created_at: NOW() - 20, tier: 'free', size_bytes: 9 }));
    const get = vi.spyOn(kv, 'get');
    const j = await (await handleExecutionDock(dockReq(), { ADMIN_KEY: 'k', STATUS_KV: kv })).json();
    expect(get).toHaveBeenCalledTimes(1);
    expect(j.transfers.map((t) => t.uuid)).toEqual([id(1), id(2)]);
    expect(JSON.stringify(j)).not.toContain('size_bytes');
  });
});

// ── finalise (F5) + dock enrich ──────────────────────────────────────────────
describe('finalise — status complete; the dock entry keeps uuid, gains metadata, is made if missing', () => {
  const SESSION_KEY = 'c2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWJ5dGVzLSE=';
  const B32 = 'A'.repeat(43);
  async function finalise(kv) {
    const bucket = makeBucket({
      [`${UUID}/manifest.json`]: { uploaded: 1, body: JSON.stringify({ uuid: UUID, tier: 'free', total_chunks: 1, upload_complete: false,
        status: 'uploading', expiry_timestamp: NOW() + 86400, created_at: NOW() - 30 }) },
      [`${UUID}/0000`]: { size: 500, uploaded: 1 },
    });
    const req = transferRequest('https://w.test/upload/finalise', UUID, {
      method: 'POST', headers: { 'X-Upload-Session': await makeSessionToken({ UPLOAD_SESSION_KEY: SESSION_KEY }, UUID, 1, NOW() + 3600) },
      body: JSON.stringify({ hashes: [B32], merkle_root: B32 }),
    });
    const res = await handleFinalise(req, { BUCKET: bucket, STATUS_KV: kv, UPLOAD_SESSION_KEY: SESSION_KEY }, UUID,
      { waitUntil() {}, passThroughOnException() {} });
    return { res, m: JSON.parse(bucket._store.get(`${UUID}/manifest.json`).body) };
  }

  it("sets status 'complete' in the same write as upload_complete", async () => {
    const { res, m } = await finalise(makeKv());
    expect(res.status).toBe(200);
    expect(m).toMatchObject({ upload_complete: true, status: 'complete' });
  });

  it('merges into the existing entry: uuid kept, rail added, value = metadata', async () => {
    const kv = makeKv();
    await kv.put(`dock_index:${UUID}`, JSON.stringify({ uuid: UUID, expiry_timestamp: NOW() + 86400, created_at: NOW() - 30, tier: 'free', file_name: 'encrypted-payload' }));
    await finalise(kv);
    const entry = JSON.parse(kv._store.get(`dock_index:${UUID}`));
    expect(entry).toMatchObject({ uuid: UUID, created_at: NOW() - 30, merkle_root: 'A'.repeat(43) });
    expect(entry).toHaveProperty('rail');
    expect(kv._meta.get(`dock_index:${UUID}`).metadata).toEqual(entry);
  });

  it('an entry the initiate write never made is created from the manifest', async () => {
    const kv = makeKv();
    await finalise(kv);
    const entry = JSON.parse(kv._store.get(`dock_index:${UUID}`));
    expect(entry).toMatchObject({ uuid: UUID, tier: 'free', created_at: NOW() - 30, expiry_timestamp: NOW() + 86400 });
    expect(entry.size_bytes).toBeUndefined();
  });
});
