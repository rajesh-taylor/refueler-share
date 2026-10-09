// API-Repair-1 — webhooks and receipts that work without KV routing; HMAC'd
// Chartered initiate (9 Oct 2026). Design: docs/KV-Audit-v1.md §4.3.
//
//   • seal.js / kvmac.js / whsec: known-answer vectors (Node crypto, independently)
//   • Chartered initiate: HMAC only; pool = the signer's; cref_ct sealed, no raw key
//   • routing: manifest cref_ct → org → wh_config_{orgtag}; KV forgeries do nothing
//   • cargo.accepted at finalise, cargo.discharged / transfer.confirmed signed with
//     the whsec the client holds; receipt pull is owner-only (F4)
//   • DLQ: MAC'd, no uuid in the key name, retry re-checks R2

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

import '@noble/secp256k1';
import '@noble/hashes/sha256';
import worker from '../src/index.js';
import { forgetApiKey } from '../src/api_store.js';
import { sealCref, openCref } from '../src/seal.js';
import { orgTag } from '../src/kvmac.js';
import {
  deriveWhsec, writeWhConfig, readWhConfig, sendEvent, notifyTransfer, retryDeadLetterQueue, EVENTS, hmacHex,
} from '../src/webhook_delivery.js';
import { issueReceipt } from '../src/receipts.js';
import { validateWebhookUrl } from '../src/webhook_reg.js';
import { buildTombstone } from '../src/manifest_tg.js';
import { computeTransferCost } from '../src/r2_presign.js';
import {
  makeSupabase, makeEnv, seedClient as seed, signedRequest, apiIssue, charteredInitiate, ctx, ORIGIN,
} from './helpers/api-fake.js';

// ── Known-answer vectors (scratch script, Node crypto.hkdfSync / createCipheriv / createHmac) ──
//   SHARE_SEAL_KEY_1 = bytes 0x00..0x1f · KV_MAC_KEY = bytes 0x20..0x3f · master = 'test-master-key'
const KAT_UUID  = '00112233-4455-6677-8899-aabbccddeeff';
const KAT_ORG   = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const KAT_NONCE = new Uint8Array(12).fill(0x0a);
const KAT_CREF  = { v: 1, k: '1', n: 'CgoKCgoKCgoKCgoK', c: 'za3gD4eMim97hjSStqivKxY2eKTPrvdNK4nGCHAFjHbiIcXs2Ro' };
const KAT_TAG   = '557584517668c372a9b7d5aa5d2de0ca';
const KAT_WHCFG = 'FfncqUt4EOEW53gJJNdwMraYsgtF2F3chtG8mUj2KEo';
const KAT_WHSEC = 'rfs_whsec_Bw6RGPb5viafHLoLdF5qkRfH7ESvdvk5eSLh4yrJZi1D';
const T0 = 1_791_000_000;

const HOOK = 'https://hooks.example.com/rf';

let sb, hooks, hookStatus;
beforeEach(() => {
  forgetApiKey();
  sb = makeSupabase();
  hooks = [];
  hookStatus = 200;
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    if (String(url).startsWith('https://hooks.example.com')) {
      hooks.push({ url: String(url), opts, body: JSON.parse(opts.body) });
      return new Response('ok', { status: hookStatus });
    }
    return sb.fetchImpl(url, opts);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const seedClient = (o) => seed(sb, o);

/** ctx that collects waitUntil promises so a test can await them. */
function waitCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, passThroughOnException() {}, settle: () => Promise.all(pending) };
}

async function register(env, client, url = HOOK) {
  const res = await worker.fetch(await signedRequest('POST', '/api/v1/webhook/register', client, JSON.stringify({ url })), env, ctx);
  expect(res.status).toBe(200);
  return (await res.json()).whsec;
}

async function checkEnvelope(hook, whsec) {
  const [, t, v0] = hook.opts.headers['X-Refueler-Signature'].match(/^t=(\d+),v0=([0-9a-f]{64})$/);
  expect(await hmacHex(whsec, `v0:${t}:${hook.opts.body}`)).toBe(v0);
  expect(hook.opts.redirect).toBe('manual');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('seal.js — cref_ct', () => {
  it('matches the known-answer vector and opens to org + transfer_ref', async () => {
    const env = makeEnv();
    expect(await sealCref(env, KAT_UUID, KAT_ORG, 'INV-42', KAT_NONCE)).toEqual(KAT_CREF);
    expect(await openCref(env, KAT_UUID, KAT_CREF)).toEqual({ org: KAT_ORG, transferRef: 'INV-42' });
  });

  it('fresh nonce per seal; no transfer_ref opens to null ref', async () => {
    const env = makeEnv();
    const a = await sealCref(env, KAT_UUID, KAT_ORG, null);
    const b = await sealCref(env, KAT_UUID, KAT_ORG, null);
    expect(a.n).not.toBe(b.n);
    expect(await openCref(env, KAT_UUID, a)).toEqual({ org: KAT_ORG, transferRef: null });
  });

  it('fails closed: other uuid (moved), tampered, unknown kid, missing or short key', async () => {
    const env = makeEnv();
    expect(await openCref(env, '00112233-4455-6677-8899-aabbccddeef0', KAT_CREF)).toBeNull();
    expect(await openCref(env, KAT_UUID, { ...KAT_CREF, c: KAT_CREF.c.replace(/^z/, 'y') })).toBeNull();
    expect(await openCref(env, KAT_UUID, { ...KAT_CREF, k: '2' })).toBeNull();
    expect(await openCref(env, KAT_UUID, { ...KAT_CREF, k: 'CURRENT' })).toBeNull();
    expect(await sealCref(makeEnv({ SHARE_SEAL_KEY_1: undefined }), KAT_UUID, KAT_ORG, null)).toBeNull();
    expect(await sealCref(makeEnv({ SHARE_SEAL_KEY_1: 'AAEC' }), KAT_UUID, KAT_ORG, null)).toBeNull();
  });

  it('the tombstone keeps no cref_ct (every deletion path writes buildTombstone)', () => {
    expect(Object.keys(buildTombstone(T0))).toEqual(['consumed', 'consumed_at']);
  });
});

describe('kvmac org tag, wh_config MAC, whsec — known-answer vectors', () => {
  it('orgTag', async () => {
    expect(await orgTag(makeEnv(), KAT_ORG)).toBe(KAT_TAG);
  });

  it('wh_config_ record MAC, keyed by the org tag (no raw org in the key)', async () => {
    const env = makeEnv();
    await writeWhConfig(env, KAT_ORG, { url: HOOK, created_at: T0, active: true });
    const raw = JSON.parse(env.STATUS_KV._store.get(`wh_config_${KAT_TAG}`));
    expect(raw.mac).toBe(KAT_WHCFG);
    expect([...env.STATUS_KV._store.keys()].join()).not.toContain(KAT_ORG);
  });

  it('rfs_whsec_ (HKDF over org + created_at)', async () => {
    expect(await deriveWhsec(makeEnv(), KAT_ORG, T0)).toBe(KAT_WHSEC);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Chartered initiate — HMAC only (P3, F2)', () => {
  const BYTES = 1;

  it('signed: debits the signer, seals the client, stores no raw key or ref', async () => {
    const c = await seedClient({ allocation: 1 + computeTransferCost(BYTES) });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c);
    const res = await charteredInitiate(env, body.uuid, {
      credential, commitment: body.commitment, client: c, bytes: BYTES, extra: { 'X-Transfer-Ref': 'PO-7781' },
    });
    expect(res.status).toBe(200);
    const raw = env.BUCKET._store.get(`${body.uuid}/manifest.json`).body;
    const m = JSON.parse(raw);
    expect(raw).not.toContain(c.live);
    expect(raw).not.toContain(c.org);
    expect(raw).not.toContain('PO-7781');
    expect(m).not.toHaveProperty('api_live_key');
    expect(m).not.toHaveProperty('api_transfer_ref');
    expect(await openCref(env, body.uuid, m.cref_ct)).toEqual({ org: c.org, transferRef: 'PO-7781' });
    expect(sb.pools.get(c.org).remaining).toBe(0);
  });

  it('X-Api-Live-Key naming another client is ignored: the signer pays', async () => {
    const cost = computeTransferCost(BYTES);
    const signer = await seedClient({ allocation: 1 + cost });
    const victim = await seedClient({ allocation: 50 });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, signer);
    const res = await charteredInitiate(env, body.uuid, {
      credential, commitment: body.commitment, client: signer, bytes: BYTES, extra: { 'X-Api-Live-Key': victim.live },
    });
    expect(res.status).toBe(200);
    expect(sb.pools.get(victim.org).remaining).toBe(50);
    expect(sb.pools.get(signer.org).remaining).toBe(0);
  });

  it('a sandbox key cannot sign a Chartered initiate', async () => {
    const c = await seedClient({ allocation: 5 });
    const sandbox = await seedClient({ sandbox: true, allocation: 5 });
    const env = makeEnv();
    const { body, credential } = await apiIssue(env, c);
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, client: sandbox, bytes: BYTES });
    expect(res.status).toBe(401);
    expect(sb.spent.size).toBe(0);
  });

  it('seal key missing → 503 before anything is spent', async () => {
    const c = await seedClient({ allocation: 5 });
    const env = makeEnv({ SHARE_SEAL_KEY_1: undefined });
    const { body, credential } = await apiIssue(env, c);
    const res = await charteredInitiate(env, body.uuid, { credential, commitment: body.commitment, client: c, bytes: BYTES });
    expect(res.status).toBe(503);
    expect(sb.spent.size).toBe(0);
    expect(sb.pools.get(c.org).remaining).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('end to end: initiate → finalise → cargo.accepted → pull', () => {
  it('delivers a signed acceptance receipt and only its owner can pull it', async () => {
    const c = await seedClient({ allocation: 1000 });
    const other = await seedClient({ allocation: 1000 });
    const env = makeEnv();
    const whsec = await register(env, c);
    const { body, credential } = await apiIssue(env, c);
    const uuid = body.uuid;
    const init = await charteredInitiate(env, uuid, { credential, commitment: body.commitment, client: c, bytes: 1,
      extra: { 'X-Transfer-Ref': 'PO-1' } });
    expect(init.status).toBe(200);
    const { session_token } = await init.json();
    await env.BUCKET.put(`${uuid}/0000`, 'x'.repeat(17)); // 1 byte + 16-byte tag
    const B32 = 'q'.repeat(43);
    const fctx = waitCtx();
    const fin = await worker.fetch(new Request(`${ORIGIN}/upload/${uuid}/finalise`, {
      method: 'POST', headers: { 'X-Upload-Session': session_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes: [B32], merkle_root: B32 }),
    }), env, fctx);
    expect(fin.status).toBe(200);
    await fctx.settle();

    expect(hooks).toHaveLength(1);
    const h = hooks[0];
    expect(h.url).toBe(HOOK);
    expect(h.body.event).toBe('cargo.accepted');
    await checkEnvelope(h, whsec);
    const r = h.body.receipt;
    expect(r).toMatchObject({ receipt_version: 'refueler.receipt.v2', receipt_type: 'acceptance',
      org_account_id: c.org, uuid, transfer_ref: 'PO-1', size_bytes: null, chunk_count: 1 });
    expect(JSON.stringify(r)).not.toContain('rfs_live_');
    expect(h.body.sig).toBe(`v1=${await hmacHex(whsec, `refueler.receipt.v2\n${JSON.stringify(r)}`)}`);

    const mine = await worker.fetch(await signedRequest('GET', `/api/v1/receipt/${uuid}/acceptance`, c), env, ctx);
    expect(mine.status).toBe(200);
    expect(await mine.json()).toEqual({ receipt: r, sig: h.body.sig });
    const theirs = await worker.fetch(await signedRequest('GET', `/api/v1/receipt/${uuid}/acceptance`, other), env, ctx);
    expect(theirs.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('routing and KV forgery', () => {
  async function chartered(env, org, extra = {}) {
    const uuid = crypto.randomUUID();
    return { uuid, manifest: { uuid, total_chunks: 2, expiry_timestamp: T0, cref_ct: await sealCref(env, uuid, org, null), ...extra } };
  }

  it('transfer.confirmed reaches the owner, signed with its whsec', async () => {
    const c = await seedClient();
    const env = makeEnv();
    const whsec = await register(env, c);
    const { uuid, manifest } = await chartered(env, c.org);
    await notifyTransfer(env, uuid, manifest, EVENTS.CONFIRMED);
    expect(hooks.map(h => h.body.event)).toEqual(['transfer.confirmed']);
    expect(hooks[0].body.uuid).toBe(uuid);
    await checkEnvelope(hooks[0], whsec);
  });

  it('consumer manifest (no cref_ct) → nothing sent', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await register(env, c);
    await notifyTransfer(env, 'aaaaaaaa-0000-4000-8000-000000000001', { total_chunks: 1 }, EVENTS.CONFIRMED);
    expect(hooks).toHaveLength(0);
  });

  it('a planted dock_index api_key_hash routes nothing', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await register(env, c);
    const uuid = 'aaaaaaaa-0000-4000-8000-000000000002';
    await env.STATUS_KV.put(`dock_index:${uuid}`, JSON.stringify({ api_key_hash: 'x'.repeat(64) }));
    await notifyTransfer(env, uuid, { total_chunks: 1 }, EVENTS.CONFIRMED);
    expect(hooks).toHaveLength(0);
  });

  it('a forged or moved wh_config_ (P5) is treated as absent', async () => {
    const a = await seedClient(), b = await seedClient();
    const env = makeEnv();
    const tagA = await orgTag(env, a.org), tagB = await orgTag(env, b.org);
    // forged: no valid MAC
    await env.STATUS_KV.put(`wh_config_${tagA}`, JSON.stringify({ v: 1, url: 'https://evil.example/x', created_at: T0, active: true, deleted_at: null, mac: 'AAAA' }));
    expect(await readWhConfig(env, a.org)).toBeNull();
    // moved: B's genuine record copied under A's key
    await register(env, b, 'https://hooks.example.com/b');
    env.STATUS_KV._store.set(`wh_config_${tagA}`, env.STATUS_KV._store.get(`wh_config_${tagB}`));
    expect(await readWhConfig(env, a.org)).toBeNull();
    const { uuid, manifest } = await chartered(env, a.org);
    await notifyTransfer(env, uuid, manifest, EVENTS.CONFIRMED);
    expect(hooks).toHaveLength(0);
  });

  it('a stored URL that fails validation is not sent to (re-checked at delivery)', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await writeWhConfig(env, c.org, { url: 'https://10.0.0.7/hook', created_at: T0, active: true });
    const { uuid, manifest } = await chartered(env, c.org);
    const sent = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', sent);
    await notifyTransfer(env, uuid, manifest, EVENTS.CONFIRMED);
    expect(sent.mock.calls.some(([u]) => String(u).includes('10.0.0.7'))).toBe(false);
  });

  it('receipts need a registered webhook: none stored without one', async () => {
    const c = await seedClient();
    const env = makeEnv();
    const { uuid, manifest } = await chartered(env, c.org);
    await issueReceipt(env, uuid, manifest, 'collection', { collected_at: T0 });
    expect([...env.STATUS_KV._store.keys()].some(k => k.startsWith('receipt_'))).toBe(false);
    const res = await worker.fetch(await signedRequest('GET', `/api/v1/receipt/${uuid}/collection`, c), env, ctx);
    expect(res.status).toBe(404);
  });

  it('a receipt record with a forged owner is not served (F4)', async () => {
    const owner = await seedClient(), thief = await seedClient();
    const env = makeEnv();
    await register(env, owner);
    const { uuid, manifest } = await chartered(env, owner.org);
    await issueReceipt(env, uuid, manifest, 'collection', { collected_at: T0 });
    const key = `receipt_${uuid}_collection`;
    const rec = JSON.parse(env.STATUS_KV._store.get(key));
    env.STATUS_KV._store.set(key, JSON.stringify({ ...rec, owner: await orgTag(env, thief.org) }));
    const res = await worker.fetch(await signedRequest('GET', `/api/v1/receipt/${uuid}/collection`, thief), env, ctx);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('dead-letter queue (P4)', () => {
  async function failedConfirm(env, client) {
    const uuid = crypto.randomUUID();
    const manifest = { uuid, total_chunks: 1, cref_ct: await sealCref(env, uuid, client.org, null) };
    hookStatus = 500;
    await notifyTransfer(env, uuid, manifest, EVENTS.CONFIRMED);
    hookStatus = 200;
    hooks.length = 0;
    const key = [...env.STATUS_KV._store.keys()].find(k => k.startsWith('wh_dlq_'));
    return { uuid, key };
  }

  it('a failed send is queued under the org tag, with no uuid in the key name', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await register(env, c);
    const { uuid, key } = await failedConfirm(env, c);
    expect(key).toMatch(new RegExp(`^wh_dlq_${await orgTag(env, c.org)}_[0-9a-f]{32}$`));
    expect(key).not.toContain(uuid.replace(/-/g, ''));
    expect(key).not.toContain(uuid);
  });

  it('retry delivers when R2 confirms (tombstone), fresh t, then deletes', async () => {
    const c = await seedClient();
    const env = makeEnv();
    const whsec = await register(env, c);
    const { uuid, key } = await failedConfirm(env, c);
    await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify(buildTombstone(T0)));
    const out = await retryDeadLetterQueue(env);
    expect(out).toMatchObject({ retried: 1, succeeded: 1 });
    expect(hooks[0].body).toMatchObject({ event: 'transfer.confirmed', uuid });
    await checkEnvelope(hooks[0], whsec);
    expect(env.STATUS_KV._store.has(key)).toBe(false);
  });

  it('retry drops an event R2 does not confirm (live, unconsumed manifest)', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await register(env, c);
    const { uuid, key } = await failedConfirm(env, c);
    await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify({ uuid, total_chunks: 1 }));
    expect(await retryDeadLetterQueue(env)).toMatchObject({ dropped: 1, succeeded: 0 });
    expect(hooks).toHaveLength(0);
    expect(env.STATUS_KV._store.has(key)).toBe(false);
  });

  it('a forged entry (edited event, or moved to another key) is dropped unsent', async () => {
    const c = await seedClient();
    const env = makeEnv();
    await register(env, c);
    const { uuid, key } = await failedConfirm(env, c);
    await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify(buildTombstone(T0)));
    const rec = JSON.parse(env.STATUS_KV._store.get(key));
    env.STATUS_KV._store.set(key, JSON.stringify({ ...rec, event: 'transfer.timestamp_submitted' }));
    const moved = key.replace(/_[0-9a-f]{32}$/, `_${'0'.repeat(32)}`);
    env.STATUS_KV._store.set(moved, JSON.stringify(rec));
    expect(await retryDeadLetterQueue(env)).toMatchObject({ retried: 2, dropped: 2 });
    expect(hooks).toHaveLength(0);
  });

  it('a timestamp event whose manifest belongs to another org is dropped', async () => {
    const a = await seedClient(), b = await seedClient();
    const env = makeEnv();
    await register(env, a);
    const uuid = crypto.randomUUID();
    hookStatus = 500;
    await sendEvent(env, a.org, { event: EVENTS.TIMESTAMP, uuid });
    hookStatus = 200;
    hooks.length = 0;
    await env.BUCKET.put(`${uuid}/manifest.json`, JSON.stringify({
      uuid, timestamp_state: 'pending', cref_ct: await sealCref(env, uuid, b.org, null),
    }));
    expect(await retryDeadLetterQueue(env)).toMatchObject({ dropped: 1 });
    expect(hooks).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('validateWebhookUrl — IPv6 literals (API-Repair-1)', () => {
  for (const u of ['https://[::1]/x', 'https://[::]/x', 'https://[fd12:3456::1]/x', 'https://[fc00::1]/x',
                   'https://[fe80::1]/x', 'https://[::ffff:10.0.0.1]/x', 'https://a.localhost/x']) {
    it(`rejects ${u}`, () => expect(validateWebhookUrl(u).ok).toBe(false));
  }
  it('accepts a public IPv6 literal', () => expect(validateWebhookUrl('https://[2606:4700::1111]/x').ok).toBe(true));
});
