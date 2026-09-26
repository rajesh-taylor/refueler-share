// Cred-Fix-1 — commitment hardening.
//   • computeCommitment is keyed (COMMITMENT_KEY) and deterministic
//   • /upload/:uuid/initiate only accepts a Worker-issued (uuid, commitment) pair
//   • missing COMMITMENT_KEY fails closed (500 at issue, 503 at initiate)
//   • /credential/issue resume branch removed (400)
//   • X-Email no longer selects a tier
//   • /api/v1/credential/issue anonymous rail stays closed until Cred-Fix-2
// All env is in-memory (test/_r2_mock.js) + a stubbed fetch. No network.

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));
vi.mock('../src/api_auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  requireApiAuth: vi.fn(async () => ({ client: { rail: 'anonymous' }, apiKey: 'rfs_test_commitment' })),
}));

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { computeCommitment, commitmentMessage, COMMITMENT_TAG } from '../src/commitment.js';
import { hashToCurve } from '../src/nut00.js';
import worker from '../src/index.js';
import { makeBucket, makeKV } from './_r2_mock.js';

const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
const KEY   = 'test-commitment-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const UUID  = '0f8fad5b-d9cb-469f-a165-70867728950e';
const UUID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const WEEK  = 7 * 24 * 3600;
const API_WINDOW = 90 * 24 * 3600;
const ctx = { waitUntil() {}, passThroughOnException() {} };

function makeEnv(overrides = {}) {
  return {
    COMMITMENT_KEY:          KEY,
    MINT_PRIVATE_KEY:        MINT_PRIVKEY_HEX,
    TURNSTILE_SECRET_KEY:    'ts',
    ADMIN_KEY:               'admin-test',
    SUPABASE_URL:            'https://sb.test',
    SUPABASE_SERVICE_KEY:    'x',
    BUCKET:                  makeBucket(),
    STATUS_KV:               makeKV(),
    CF_ACCOUNT_ID:           'acct',
    R2_S3_ACCESS_KEY_ID:     'ak',
    R2_S3_SECRET_ACCESS_KEY: 'sk',
    R2_BUCKET_NAME:          'refueler-share-dev',
    ...overrides,
  };
}

function stubFetch() {
  const calls = [];
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    calls.push(`${opts.method ?? 'GET'} ${String(url).replace('https://sb.test', '')}`);
    if (String(url).includes('/rest/v1/spent_tokens')) return new Response(null, { status: 201 });
    if (String(url).includes('/rest/v1/subscribers')) {
      return new Response(JSON.stringify([{ tier: 'max' }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  });
  return calls;
}

// Normal client flow: blind a secret, ask /credential/issue, unblind.
async function issueViaWorker(env, extraBody = {}) {
  const x  = secp.utils.randomPrivateKey();
  const Y  = hashToCurve(x);
  const r  = BigInt('0x' + bytesToHex(secp.utils.randomPrivateKey()));
  const B_ = Y.add(secp.ProjectivePoint.BASE.multiply(r));
  const res = await worker.fetch(new Request('https://api.share.test/credential/issue', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ blinded_message: B_.toHex(true), turnstile_token: 'tt-' + bytesToHex(x), ...extraBody }),
  }), env, ctx);
  const body = await res.json();
  if (res.status !== 200) return { res, body };
  const K = secp.ProjectivePoint.fromHex(body.mint_pubkey);
  const C = secp.ProjectivePoint.fromHex(body.signed_point).add(K.multiply(r).negate());
  return { res, body, credential: JSON.stringify({ C: C.toHex(true), mint_pubkey: body.mint_pubkey }) };
}

function initiate(env, uuid, { credential, commitment, tier = 'free', bytes = 1024, extra = {} }) {
  const now = Math.floor(Date.now() / 1000);
  return worker.fetch(new Request(`https://api.share.test/upload/${uuid}/initiate`, {
    method: 'POST',
    headers: {
      'X-Cashu-Credential':      credential,
      'X-Credential-Commitment': commitment,
      'X-Issued-Tier':           tier,
      'X-Total-Chunks':          '1',
      'X-Total-Bytes':           String(bytes),
      'X-Expiry-Timestamp':      String(now + 3600),
      ...extra,
    },
  }), env, ctx);
}

afterEach(() => vi.unstubAllGlobals());

// ─────────────────────────────────────────────────────────────────────────────
describe('computeCommitment', () => {
  it('is 64-char lowercase hex and deterministic for the same key + inputs', async () => {
    const a = await computeCommitment(KEY, UUID, 'free', WEEK);
    const b = await computeCommitment(KEY, UUID, 'free', WEEK);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('differs across uuid, tier, window and key', async () => {
    const base = await computeCommitment(KEY, UUID, 'free', WEEK);
    const variants = await Promise.all([
      computeCommitment(KEY, UUID2, 'free', WEEK),
      computeCommitment(KEY, UUID, 'creative', WEEK),
      computeCommitment(KEY, UUID, 'free', WEEK + 1),
      computeCommitment(KEY + 'x', UUID, 'free', WEEK),
    ]);
    for (const v of variants) expect(v).not.toBe(base);
  });

  it('matches an independent HMAC over the documented encoding', async () => {
    const msg = new Uint8Array([
      ...new TextEncoder().encode('refueler.share.commit.v1'), 0x00,
      ...hexToBytes(UUID.replace(/-/g, '')),
      0, 0, 0, 0, 0, 0x09, 0x3a, 0x80,               // 604800 as uint64 BE
      ...new TextEncoder().encode('free'),
    ]);
    expect(COMMITMENT_TAG).toBe('refueler.share.commit.v1');
    expect(commitmentMessage(UUID, 'free', WEEK)).toEqual(msg);
    const k   = await crypto.subtle.importKey('raw', new TextEncoder().encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, msg)));
    expect(await computeCommitment(KEY, UUID, 'free', WEEK)).toBe(mac);
  });

  it('throws without a key (no unkeyed fallback)', async () => {
    await expect(computeCommitment('', UUID, 'free', WEEK)).rejects.toThrow(/COMMITMENT_KEY/);
    await expect(computeCommitment(undefined, UUID, 'free', WEEK)).rejects.toThrow(/COMMITMENT_KEY/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /credential/issue', () => {
  it('returns a commitment equal to computeCommitment(key, uuid, tier, window)', async () => {
    stubFetch();
    const env = makeEnv();
    const { res, body } = await issueViaWorker(env);
    expect(res.status).toBe(200);
    expect(body.issued_tier).toBe('free');
    expect(body.commitment).toBe(await computeCommitment(KEY, body.uuid, 'free', WEEK));
  });

  it('500 when COMMITMENT_KEY is missing', async () => {
    stubFetch();
    const { res } = await issueViaWorker(makeEnv({ COMMITMENT_KEY: undefined }));
    expect(res.status).toBe(500);
  });

  it('400 for resume:true (resume-issue path removed)', async () => {
    stubFetch();
    const env = makeEnv();
    const res = await worker.fetch(new Request('https://api.share.test/credential/issue', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ blinded_message: secp.ProjectivePoint.BASE.toHex(true), resume: true, resume_uuid: UUID }),
    }), env, ctx);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /upload/:uuid/initiate — commitment gate', () => {
  it('accepts a Worker-issued (uuid, commitment) pair', async () => {
    stubFetch();
    const env = makeEnv();
    const { body, credential } = await issueViaWorker(env);
    const res = await initiate(env, body.uuid, { credential, commitment: body.commitment });
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.session_token).toBeTruthy();
  });

  it('401 credential_uuid_mismatch for a commitment not computed under the key', async () => {
    stubFetch();
    const env = makeEnv();
    const { body, credential } = await issueViaWorker(env);
    const unkeyed = bytesToHex(sha256(new TextEncoder().encode(`${body.uuid}:free:${WEEK}`)));
    const otherKey = await computeCommitment('some-other-key', body.uuid, 'free', WEEK);
    for (const commitment of [unkeyed, otherKey]) {
      const res = await initiate(env, body.uuid, { credential, commitment });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/commitment mismatch/i);
    }
  });

  it('401 when an issued commitment is presented for a different uuid', async () => {
    stubFetch();
    const env = makeEnv();
    const { body, credential } = await issueViaWorker(env);
    const res = await initiate(env, UUID2, { credential, commitment: body.commitment });
    expect(res.status).toBe(401);
  });

  it('503 when COMMITMENT_KEY is missing', async () => {
    stubFetch();
    const issuer = makeEnv();
    const { body, credential } = await issueViaWorker(issuer);
    const env = makeEnv({ COMMITMENT_KEY: undefined, BUCKET: issuer.BUCKET, STATUS_KV: issuer.STATUS_KV });
    const res = await initiate(env, body.uuid, { credential, commitment: body.commitment });
    expect(res.status).toBe(503);
  });

  it('ignores X-Email — tier stays free and no subscriber lookup is made', async () => {
    const calls = stubFetch();
    const env = makeEnv();
    const { body, credential } = await issueViaWorker(env);
    const overFreeCap = 5 * 1024 * 1024 * 1024; // > free 4 GB, < max
    const res = await initiate(env, body.uuid, {
      credential, commitment: body.commitment, bytes: overFreeCap,
      extra: { 'X-Email': 'subscriber@example.com' },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/free tier cap/);
    expect(calls.some(c => c.includes('/subscribers'))).toBe(false);
  });

  it('Chartered (api, 90-day window) commitment from /admin/test-credential passes the gate', async () => {
    stubFetch();
    const env = makeEnv();
    const blinded = secp.ProjectivePoint.BASE.multiply(12345n).toHex(true);
    const issueRes = await worker.fetch(new Request('https://api.share.test/admin/test-credential', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': 'admin-test' },
      body:    JSON.stringify({ blinded_message: blinded }),
    }), env, ctx);
    expect(issueRes.status).toBe(200);
    const body = await issueRes.json();
    expect(body.commitment).toBe(await computeCommitment(KEY, body.uuid, 'api', API_WINDOW));
    const res = await initiate(env, body.uuid, { credential: '{}', commitment: body.commitment, tier: 'api' });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/v1/credential/issue — anonymous rail stays closed', () => {
  function anonIssue(env, token) {
    return worker.fetch(new Request('https://api.share.test/api/v1/credential/issue', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cashu-Token': token },
      body:    JSON.stringify({ blinded_message: secp.ProjectivePoint.BASE.toHex(true) }),
    }), env, ctx);
  }

  it('503 for any token while MINT_API_PRIVATE_KEY is unset', async () => {
    stubFetch();
    const res = await anonIssue(makeEnv(), 'anything');
    expect(res.status).toBe(503);
  });

  it('401 for any token, including a genuinely issued API-keyset credential', async () => {
    stubFetch();
    const env = makeEnv({ MINT_API_PRIVATE_KEY: MINT_PRIVKEY_HEX });
    const { credential } = await issueViaWorker(env);
    for (const token of ['anything', '{}', credential]) {
      const res = await anonIssue(env, token);
      expect(res.status).toBe(401);
    }
  });
});
