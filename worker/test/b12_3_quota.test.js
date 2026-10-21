// B12-3 — storage quota (Registered-rail Chartered), MAC'd upload sessions,
// create-if-absent initiate, the deletion latch, reconcile (11 Oct 2026).
// Design: docs/B12-SR-spec-v1.md S1 "Tests B12-3 must show green" + S3(a).
//
// Real-R2 proofs (build gate, scratch Worker on refueler-share-dev, 11 Oct):
//   signed content-length (403 on ±1 byte, full chunk + 1 KiB), create-if-absent
//   (5 racers × 10: one winner; tombstone refuses), etagMatches latch (5 × 10:
//   one winner; stale etag refused). The in-memory bucket here implements the
//   same onlyIf semantics (test/_r2_mock.js); the fake Supabase mirrors
//   supabase/migrations/20261011_b12_3_quota.sql.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import '@noble/secp256k1';
import '@noble/hashes/sha256';
import worker from '../src/index.js';
import { forgetApiKey } from '../src/api_store.js';
import { quotaRefFor, quotaBand } from '../src/quota_store.js';
import { makeSessionToken, verifySessionToken, sessionHash, sessionExpiry, UPLOAD_WINDOW } from '../src/upload_session.js';
import { sealQref, openQref, hasQref } from '../src/seal.js';
import { latchConsumed, releaseHeld, putManifestIfAbsent } from '../src/latch.js';
import { destroyTransfer } from '../src/handlers/delete_transfer.js';
import { purgeExpiredTransfer } from '../src/sweep_rules.js';
import { runQuotaReconcile } from '../src/handlers/quota_reconcile.js';
import { buildTombstone } from '../src/manifest_tg.js';
import { computeCommitment } from '../src/commitment.js';
import { importTestCredKey, makeTestCredential } from '../src/testcred.js';
import { makeBucket } from './_r2_mock.js';
import {
  makeSupabase, makeEnv, seedClient as seed, apiIssue, charteredInitiate, ctx, ORIGIN,
  QUOTA_REF_KEY, UPLOAD_SESSION_KEY,
} from './helpers/api-fake.js';
import { transferRequest } from './helpers/transfer-request.js';

const CHUNK = 32 * 1024 * 1024;
const B32 = 'q'.repeat(43);

// ── Known-answer vectors (scratch kat.mjs: Node createHmac / hkdfSync /
//    createCipheriv + @noble/hashes blake3 — independent of the Worker code) ──
const KAT_ORG   = '0f0e0d0c-0b0a-4908-8706-050403020100';
const KAT_UUID  = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const KAT_QREF  = 'e44647685cf890326754cef19ff45ae86fab26d8f8fcfcdd1fceb5083c90e1e3';
const KAT_TOKEN = 'v1.1800000000.7.QWX8LM30yT0E-x1TR28aXiGrOMXBafKyuWZAg_ur5RI';
const KAT_SHASH = 'd803aaa6393b88eca4f04778e4131b7801f61acc892552aa5abb4b0bd0de7211';
const KAT_QCT_C = 'mlmjJHvrfN0jWTtZaruLuMcLBsBTft2HLTCjFwSB2uqSbKRj8RUcwOXs5rjvmvDprCoUgx94fjAyzNrPkeiueRgVYMUMXf95BOWcsH5H3To';

let sb;
beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  vi.stubGlobal('fetch', async (url, opts = {}) => sb.fetchImpl(url, opts));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const seedClient = (o) => seed(sb, o);
const nowS = () => Math.floor(Date.now() / 1000);

function waitCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, passThroughOnException() {}, settle: () => Promise.all(pending) };
}
const acct = (c) => sb.quota.get(c.quotaRef);

/** Issue + initiate a Chartered transfer of `chunks` full-size chunks. */
async function start(env, c, chunks = 1, extra = {}) {
  const { body, credential } = await apiIssue(env, c);
  const bytes = chunks * CHUNK;
  const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, client: c, bytes, extra });
  return { res, uuid: body.uuid, json: res.status === 200 ? await res.json() : await res.json().catch(() => null) };
}
/** Put every chunk at its exact size, then finalise. */
async function finish(env, uuid, token, chunks) {
  for (let i = 0; i < chunks; i++) env.BUCKET._store.set(`${uuid}/${String(i).padStart(4, '0')}`, { size: CHUNK + 16, uploaded: new Date(), etag: `c${i}` });
  const c = waitCtx();
  const res = await worker.fetch(transferRequest(`${ORIGIN}/upload/finalise`, uuid, {
    method: 'POST', headers: { 'X-Upload-Session': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: Array(chunks).fill(B32), merkle_root: B32 }),
  }), env, c);
  await c.settle();
  return res;
}
const urlsReq = (env, uuid, token, from, count = 10) => worker.fetch(transferRequest(`${ORIGIN}/upload/urls`, uuid, {
  method: 'POST', headers: { 'X-Upload-Session': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, count }),
}), env, ctx);
const manifestOf = (env, uuid) => JSON.parse(env.BUCKET._store.get(`${uuid}/manifest.json`).body);

// ─────────────────────────────────────────────────────────────────────────────
describe('known-answer vectors', () => {
  it('quota_ref = HMAC(QUOTA_REF_KEY, tag ‖ 0x00 ‖ org16)', async () => {
    expect(await quotaRefFor({ QUOTA_REF_KEY }, KAT_ORG)).toBe(KAT_QREF);
    expect(await quotaRefFor({}, KAT_ORG)).toBeNull();                       // fails closed without the key
    expect(await quotaRefFor({ QUOTA_REF_KEY: 'c2hvcnQ=' }, KAT_ORG)).toBeNull(); // < 32 bytes
  });
  it('session token MAC and BLAKE3 session hash', async () => {
    expect(await makeSessionToken({ UPLOAD_SESSION_KEY }, KAT_UUID, 7, 1_800_000_000)).toBe(KAT_TOKEN);
    expect(await sessionHash(KAT_TOKEN)).toBe(KAT_SHASH);
  });
  it('qref_ct = AES-256-GCM under HKDF(SHARE_SEAL_KEY_1, info "refueler.share.qref.v1" ‖ 0x00)', async () => {
    const env = makeEnv();
    const sealed = await sealQref(env, KAT_UUID, KAT_QREF, KAT_SHASH, new Uint8Array(12).fill(0x24));
    expect(sealed).toEqual({ v: 1, k: '1', n: 'JCQkJCQkJCQkJCQk', c: KAT_QCT_C });
    expect(await openQref(env, KAT_UUID, sealed)).toEqual({ quotaRef: KAT_QREF, sessionHash: KAT_SHASH });
    expect(await openQref(env, '00000000-0000-4000-8000-000000000000', sealed)).toBeNull(); // AAD binds the uuid
  });
  it('fresh nonce per seal', async () => {
    const env = makeEnv();
    const a = await sealQref(env, KAT_UUID, KAT_QREF, KAT_SHASH);
    const b = await sealQref(env, KAT_UUID, KAT_QREF, KAT_SHASH);
    expect(a.n).not.toBe(b.n);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('upload session token (SR S1.2 / S1.3)', () => {
  it('one clock: session ends at min(now + 6 d, expiry)', () => {
    expect(sessionExpiry(1000, 1000 + 10 * 86400)).toBe(1000 + UPLOAD_WINDOW);
    expect(sessionExpiry(1000, 1000 + 3600)).toBe(1000 + 3600);
  });
  it('rejects wrong uuid, tampered MAC, expired, malformed, missing key', async () => {
    const env = { UPLOAD_SESSION_KEY };
    const t = await makeSessionToken(env, KAT_UUID, 7, nowS() + 60);
    expect(await verifySessionToken(env, t, KAT_UUID, nowS())).toEqual({ totalChunks: 7, sessionExp: nowS() + 60 });
    expect(await verifySessionToken(env, t, '00000000-0000-4000-8000-000000000000', nowS())).toBeNull();
    const bad = t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.at(-1);
    expect(await verifySessionToken(env, bad, KAT_UUID, nowS())).toBeNull();
    expect(await verifySessionToken(env, t.replace('.7.', '.8.'), KAT_UUID, nowS())).toBeNull(); // bound is in the MAC
    expect(await verifySessionToken(env, t, KAT_UUID, nowS() + 61)).toBeNull();
    expect(await verifySessionToken(env, 'tok', KAT_UUID, nowS())).toBeNull();
    expect(await verifySessionToken({}, t, KAT_UUID, nowS())).toBeNull();
  });
  it('forged KV session record → 401 at /urls and /finalise (KV is never read)', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid } = await start(env, c, 3);
    await env.STATUS_KV.put(`upload_session:${uuid}`, 'planted');
    expect((await urlsReq(env, uuid, 'planted', 0)).status).toBe(401);
    expect((await finish(env, uuid, 'planted', 3)).status).toBe(401);
  });
  it('initiate writes no KV session record; 503 before any spend when the key is missing', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { res, uuid } = await start(env, c, 1);
    expect(res.status).toBe(200);
    expect([...env.STATUS_KV._store.keys()].some(k => k.startsWith('upload_session:'))).toBe(false);
    const env2 = makeEnv({ UPLOAD_SESSION_KEY: undefined });
    const r2 = await start(env2, c, 1);
    expect(r2.res.status).toBe(503);
    expect(sb.spent.size).toBe(1);            // only the first upload spent
    expect(acct(c).reserved_chunks).toBe(1);  // only the first upload reserved
    void uuid;
  });
  it('presigned URLs expire with the session', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { json } = await start(env, c, 1);
    const q = new URL(json.tail_url.url).searchParams;
    expect(Number(q.get('X-Amz-Expires'))).toBeLessThanOrEqual(3600);   // transfer expires in 1 h
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('initiate (SR S1.4 / S1.5 / X6)', () => {
  it.each([['-1'], ['abc'], ['1e9'], ['12abc'], ['0x10'], ['9007199254740993'], ['1.5']])(
    'X-Total-Bytes %s → 400, nothing reserved or spent', async (v) => {
      const env = makeEnv();
      const c = await seedClient({ allocation: 1e6 });
      const { body, credential } = await apiIssue(env, c);
      const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, client: c, bytes: 1,
        extra: { 'X-Total-Bytes': v } });
      expect(res.status).toBe(400);
      expect(sb.spent.size).toBe(0);
      expect(acct(c).reserved_chunks).toBe(0);
    });

  it('more than 8,000 chunks → 400', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e9 });
    const { res } = await start(env, c, 8001);
    expect(res.status).toBe(400);
  });

  it('reserves need chunks against the signer org; qref_ct sealed, no raw quota_ref in the manifest', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { res, uuid, json } = await start(env, c, 3);
    expect(res.status).toBe(200);
    expect(acct(c).reserved_chunks).toBe(3);
    const m = manifestOf(env, uuid);
    expect(hasQref(m)).toBe(true);
    expect(JSON.stringify(m)).not.toContain(c.quotaRef);
    const q = await openQref(env, uuid, m.qref_ct);
    expect(q).toEqual({ quotaRef: c.quotaRef, sessionHash: await sessionHash(json.session_token) });
    expect(sb.reservations.has(q.sessionHash)).toBe(true);
  });

  it('quota full → 402 quota_exceeded with a 5 % band, credential not spent', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6, limitChunks: 10 });
    acct(c).used_chunks = 9;
    const { res, json } = await start(env, c, 2);
    expect(res.status).toBe(402);
    expect(json).toMatchObject({ code: 'quota_exceeded', band: '90–95%' });
    expect(JSON.stringify(json)).not.toMatch(/used_chunks|limit_chunks/);
    expect(sb.spent.size).toBe(0);
  });

  it('no storage quota row → 402 quota_not_provisioned; in-flight cap → 429', async () => {
    const env = makeEnv();
    const none = await seedClient({ allocation: 1e6, storageQuota: false });
    expect((await start(env, none, 1)).res.status).toBe(402);
    const c = await seedClient({ allocation: 1e6, maxInFlight: 1 });
    expect((await start(env, c, 1)).res.status).toBe(200);
    const second = await start(env, c, 1);
    expect(second.res.status).toBe(429);
    expect(second.json.code).toBe('too_many_in_flight');
  });

  it('concurrent initiates at limit − 1 → exactly one 200', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6, limitChunks: 5 });
    acct(c).used_chunks = 4;
    const a = await apiIssue(env, c), b = await apiIssue(env, c);
    const [ra, rb] = await Promise.all([
      charteredInitiate(env, a.body.uuid, { credential: a.credential, commitment: a.body.commitment, client: c, bytes: CHUNK }),
      charteredInitiate(env, b.body.uuid, { credential: b.credential, commitment: b.body.commitment, client: c, bytes: CHUNK }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 402]);
    expect(acct(c).reserved_chunks).toBe(1);
  });

  it('spend refused (double spend) → reservation released', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const a = await apiIssue(env, c);
    const b = await apiIssue(env, c);
    expect((await charteredInitiate(env, a.body.uuid, { credential: a.credential, commitment: a.body.commitment, client: c, bytes: CHUNK })).status).toBe(200);
    // same credential on a second (valid) uuid → 409 at the spend; its reservation is cancelled
    const r = await charteredInitiate(env, b.body.uuid, { credential: a.credential, commitment: b.body.commitment, client: c, bytes: CHUNK });
    expect(r.status).toBe(409);
    expect(acct(c).reserved_chunks).toBe(1);
    expect(sb.reservations.size).toBe(1);
  });

  it('re-initiate on a live or tombstoned UUID → 409; race on one UUID → one creates, loser releases', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid } = await start(env, c, 1);
    const again = await apiIssue(env, c);
    const r1 = await charteredInitiate(env, uuid, { credential: again.credential, commitment: again.body.commitment, client: c, bytes: CHUNK });
    expect(r1.status).toBe(409);                                     // live (commitment for another uuid is refused anyway)

    const tomb = '11111111-2222-4333-8444-555555555555';
    await env.BUCKET.put(`${tomb}/manifest.json`, JSON.stringify(buildTombstone(nowS())));
    expect(await putManifestIfAbsent(env.BUCKET, tomb, { x: 1 })).toBe(false);

    // The race itself: both pass the early check, one conditional put wins.
    const fresh = '22222222-3333-4444-8555-666666666666';
    const results = await Promise.all([1, 2, 3].map(i => putManifestIfAbsent(env.BUCKET, fresh, { i })));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('create-if-absent loser at initiate cancels its reservation', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const a = await apiIssue(env, c);
    // Plant the manifest between the early check and the conditional put.
    const realPut = env.BUCKET.put.bind(env.BUCKET);
    env.BUCKET.put = async (k, v, o) => {
      if (k === `${a.body.uuid}/manifest.json` && o?.onlyIf) await realPut(k, '{"planted":true}');
      return realPut(k, v, o);
    };
    const r = await charteredInitiate(env, a.body.uuid, { credential: a.credential, commitment: a.body.commitment, client: c, bytes: CHUNK });
    expect(r.status).toBe(409);
    expect(acct(c).reserved_chunks).toBe(0);
    expect(sb.reservations.size).toBe(0);
  });

  it('Citizen / Pro Bono: no principal → no reservation, no qref_ct (until B12-4a)', async () => {
    const env = makeEnv();
    const uuid = '33333333-4444-4555-8666-777777777777';
    const exp = nowS() + 3600;
    const res = await worker.fetch(transferRequest(`${ORIGIN}/upload/initiate`, uuid, {
      method: 'POST', headers: {
        'X-Cashu-Credential': '{}', 'X-Total-Chunks': '1', 'X-Total-Bytes': '10', 'X-Expiry-Timestamp': String(exp),
        'X-Credential-Commitment': await computeCommitment(env.COMMITMENT_KEY, uuid, 'free', 7 * 86400),
        'X-Test-Credential': await makeTestCredential(await importTestCredKey(env), uuid, 10, exp),
      },
    }), env, ctx);
    expect(res.status).toBe(200);
    const m = manifestOf(env, uuid);
    expect(m.soak).toBe(true);
    expect(hasQref(m)).toBe(false);
    expect(sb.rpcCalls('quota_reserve')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('/urls bound (SR S1.1 / S1.4)', () => {
  it('index ≥ need → 400; tail only from initiate; chunk count from the token', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid, json } = await start(env, c, 3);
    const ok = await urlsReq(env, uuid, json.session_token, 0, 10);
    expect(ok.status).toBe(200);
    expect((await ok.json()).urls.map(u => u.index)).toEqual([0, 1]);   // 2 = tail, never here
    expect((await urlsReq(env, uuid, json.session_token, 2)).status).toBe(400);
    expect((await urlsReq(env, uuid, json.session_token, 3)).status).toBe(400);
  });
  it('a session for another transfer, or after deletion, gets nothing', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const a = await start(env, c, 2);
    const b = await start(env, c, 2);
    expect((await urlsReq(env, b.uuid, a.json.session_token, 0)).status).toBe(401);
    await latchConsumed(env, a.uuid, nowS());
    expect((await urlsReq(env, a.uuid, a.json.session_token, 0)).status).toBe(410);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('finalise conversion (SR S1.7)', () => {
  it('reserved → used once; finalise twice → one conversion', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid, json } = await start(env, c, 2);
    expect((await finish(env, uuid, json.session_token, 2)).status).toBe(200);
    expect(acct(c)).toMatchObject({ used_chunks: 2, reserved_chunks: 0 });
    expect((await finish(env, uuid, json.session_token, 2)).status).toBe(409);
    expect(acct(c)).toMatchObject({ used_chunks: 2, reserved_chunks: 0 });
    expect(sb.rpcCalls('quota_finalise')).toHaveLength(1);
  });
  it('store down at finalise → finalise still 200; reconcile counts it later', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid, json } = await start(env, c, 1);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    sb.state.down = true;
    const p = finish(env, uuid, json.session_token, 1);
    await vi.runAllTimersAsync();
    expect((await p).status).toBe(200);
    vi.useRealTimers();
    sb.state.down = false;
    expect(sb.rpcCalls('quota_finalise').length).toBe(4);        // 1 + 3 retries
    expect(acct(c)).toMatchObject({ used_chunks: 0, reserved_chunks: 1 });
    acct(c).updated_at = nowS() - 100;
    const r = await runQuotaReconcile(env);
    expect(r).toMatchObject({ ok: true, corrected: 1, drift_chunks: 1 });
    expect(acct(c)).toMatchObject({ used_chunks: 1, reserved_chunks: 0 });   // failed-conversion reservation dropped
  });
  it('a deletion that latched first wins: finalise 410s and converts nothing', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const { uuid, json } = await start(env, c, 1);
    const l = await latchConsumed(env, uuid, nowS());
    expect(l.won).toBe(true);
    expect(l.release.released).toBe('reservation');
    expect((await finish(env, uuid, json.session_token, 1)).status).toBe(410);
    expect(acct(c)).toMatchObject({ used_chunks: 0, reserved_chunks: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deletion latch (SR S1.8) — every path releases exactly once', () => {
  async function completed(env, c, chunks = 2) {
    const { uuid, json } = await start(env, c, chunks);
    expect((await finish(env, uuid, json.session_token, chunks)).status).toBe(200);
    return uuid;
  }

  it('concurrent DAD + owner delete + sweep → one credit-back', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const uuid = await completed(env, c, 2);
    expect(acct(c).used_chunks).toBe(2);
    const m = manifestOf(env, uuid);
    const expiredNow = (m.expiry_timestamp ?? 0) + 10 * 86400;
    await Promise.all([
      destroyTransfer(env, uuid, m, nowS(), 'DAD'),
      destroyTransfer(env, uuid, m, nowS(), 'owner'),
      purgeExpiredTransfer(env, uuid, [[], []], expiredNow),
    ]);
    expect(sb.rpcCalls('quota_release')).toHaveLength(1);
    expect(acct(c).used_chunks).toBe(0);
    const t = manifestOf(env, uuid);
    expect(t).toEqual({ consumed: true, consumed_at: t.consumed_at });     // tombstone strips qref_ct
  });

  it('same arguments reach Supabase whichever path wins', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const u1 = await completed(env, c, 1), u2 = await completed(env, c, 1);
    await destroyTransfer(env, u1, manifestOf(env, u1), nowS(), 'DAD');
    await purgeExpiredTransfer(env, u2, [[], []], nowS() + 365 * 86400);
    const [a, b] = sb.rpcCalls('quota_release').map(x => Object.keys(x.body).sort());
    expect(a).toEqual(b);
    expect(a).toEqual(['p_chunks', 'p_complete', 'p_quota_ref', 'p_session_hash']);
  });

  it('a resumed partial delete releases nothing', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const uuid = await completed(env, c, 2);
    const realDelete = env.BUCKET.delete.bind(env.BUCKET);
    env.BUCKET.delete = async () => { throw new Error('R2 down'); };
    const first = await destroyTransfer(env, uuid, manifestOf(env, uuid), nowS(), 'owner');
    expect(first.destroyed).toBe(false);
    env.BUCKET.delete = realDelete;
    const again = await destroyTransfer(env, uuid, manifestOf(env, uuid), nowS(), 'owner');
    expect(again.destroyed).toBe(true);
    expect(sb.rpcCalls('quota_release')).toHaveLength(1);
    expect(acct(c).used_chunks).toBe(0);
  });

  it('deleting an in-progress upload cancels its reservation, never touches used', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    await completed(env, c, 1);
    const { uuid } = await start(env, c, 3);
    expect(acct(c)).toMatchObject({ used_chunks: 1, reserved_chunks: 3 });
    await destroyTransfer(env, uuid, manifestOf(env, uuid), nowS(), 'owner');
    expect(acct(c)).toMatchObject({ used_chunks: 1, reserved_chunks: 0 });
  });

  it('a stale writer cannot clobber consumed:true (download start, timestamp, finalise)', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const uuid = await completed(env, c, 1);
    // The download reads a live copy; a deletion latches before the download
    // writes download_initiated_at. The write must decline, not resurrect.
    const realGet = env.BUCKET.get.bind(env.BUCKET);
    let first = true;
    env.BUCKET.get = async (k, o) => {
      const obj = await realGet(k, o);
      if (first && k === `${uuid}/manifest.json`) {
        first = false;
        env.BUCKET.get = realGet;
        await latchConsumed(env, uuid, nowS());            // lands between read and write
      }
      return obj;
    };
    const dl = await worker.fetch(transferRequest(`${ORIGIN}/download`, uuid, {}, 0), env, ctx);
    expect(dl.status).toBe(410);
    expect(manifestOf(env, uuid).consumed).toBe(true);
    expect(manifestOf(env, uuid).download_initiated_at ?? null).toBeNull();
    // a second latch attempt (another deletion path) loses
    const l2 = await latchConsumed(env, uuid, nowS());
    expect(l2).toMatchObject({ won: false, reason: 'already_consumed' });
    expect(sb.rpcCalls('quota_release')).toHaveLength(1);
  });

  it('Pro Bono / soak manifests release nothing', async () => {
    const env = makeEnv();
    expect(await releaseHeld(env, KAT_UUID, { total_chunks: 2, upload_complete: true })).toMatchObject({ skipped: 'no_quota' });
    expect(await releaseHeld(env, KAT_UUID, { total_chunks: 2, soak: true, qref_ct: {} })).toMatchObject({ skipped: 'no_quota' });
    expect(sb.rpcCalls('quota_release')).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('reconcile (SR S1.9)', () => {
  async function completed(env, c, chunks) {
    const { uuid, json } = await start(env, c, chunks);
    await finish(env, uuid, json.session_token, chunks);
    return uuid;
  }

  it('recomputes used from R2; zero-transfer accounts go to 0', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const idle = await seedClient({ allocation: 1e6 });
    await completed(env, c, 2);
    acct(c).used_chunks = 7;  acct(c).updated_at = nowS() - 100;     // drifted
    acct(idle).used_chunks = 3; acct(idle).updated_at = nowS() - 100;
    const r = await runQuotaReconcile(env);
    expect(r).toMatchObject({ ok: true, accounts: 2, corrected: 2, drift_chunks: 8, skipped: 0 });
    expect(acct(c).used_chunks).toBe(2);
    expect(acct(idle).used_chunks).toBe(0);
  });

  it('skips a row touched mid-run (updated_at ≥ t0)', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    await completed(env, c, 2);
    sb.state.clock = nowS() - 50;                // t0 read before the scan
    acct(c).used_chunks = 99;                    // …and the row changed after it
    acct(c).updated_at = nowS();
    const r = await runQuotaReconcile(env);
    expect(r).toMatchObject({ ok: true, skipped: 1, corrected: 0 });
    expect(acct(c).used_chunks).toBe(99);
  });

  it('ignores soak, consumed and in-progress manifests; aborts without writing if a seal will not open', async () => {
    const env = makeEnv();
    const c = await seedClient({ allocation: 1e6 });
    const u = await completed(env, c, 1);
    await start(env, c, 4);                                   // in progress: reserved, not used
    acct(c).updated_at = nowS() - 100;
    expect(await runQuotaReconcile(env)).toMatchObject({ ok: true, corrected: 0 });
    expect(acct(c)).toMatchObject({ used_chunks: 1, reserved_chunks: 4 });

    const m = manifestOf(env, u);
    m.qref_ct = { ...m.qref_ct, c: m.qref_ct.c.slice(0, -2) + 'AA' };
    env.BUCKET._store.get(`${u}/manifest.json`).body = JSON.stringify(m);
    acct(c).used_chunks = 50; acct(c).updated_at = nowS() - 100;
    expect(await runQuotaReconcile(env)).toMatchObject({ ok: false, error: 'seal_open_failed' });
    expect(acct(c).used_chunks).toBe(50);                    // nothing written
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('helpers', () => {
  it('quotaBand: 5 % bands, rounded down, clamped', () => {
    expect(quotaBand({ used_chunks: 0, reserved_chunks: 0, limit_chunks: 100 })).toBe('0–5%');
    expect(quotaBand({ used_chunks: 9, reserved_chunks: 0, limit_chunks: 10 })).toBe('90–95%');
    expect(quotaBand({ used_chunks: 120, reserved_chunks: 0, limit_chunks: 100 })).toBe('95–100%');
    expect(quotaBand({ limit_chunks: 0 })).toBe('95–100%');
  });
  it('admin client create provisions a storage quota (8,000 chunks, 20 in flight)', async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request(`${ORIGIN}/api/v1/admin/api-client`, {
      method: 'POST', headers: { 'X-Admin-Key': env.ADMIN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'personal_api' }),
    }), env, ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.storage_quota).toMatchObject({ kind: 'chartered', limit_chunks: 8000, max_in_flight: 20, used_chunks: 0 });
    expect(sb.quota.has(await quotaRefFor(env, body.org_account_id))).toBe(true);
  });
});
