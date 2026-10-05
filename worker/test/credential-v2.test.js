// Cred-Fix-2a — credential format v2: standard Cashu proof verification.
//   • NUT-00 hash_to_curve + blind-signature vectors, NUT-02 keyset id, NUT-12 DLEQ
//     (deterministic nonce) — official vectors, cashubtc/nuts tests/ @ 8bde3c0
//   • verifyProofV2: Y = hash_to_curve(utf8(secret)), k·Y == C, serial = hex(Y)
//   • /credential/issue returns keyset_id + dleq (additive)
//   • /upload/:uuid/initiate accepts v2 only; format v1 refused (Cred-Fix-2b)
// All env is in-memory (test/_r2_mock.js) + a stubbed fetch. No network.

import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/turnstile.js', () => ({
  verifyTurnstileToken: vi.fn(async () => true),
  verifyTurnstile:      vi.fn(async () => true),
}));

// Load order matters in the workerd pool: the Worker modules (and noble hashes v1,
// CJS via the vitest alias) must load before @cashu/cashu-ts.
import { issueBlindSig, keysetIdFor, verifyProofV2 } from '../src/nut00.js';
import worker from '../src/index.js';
import * as secp from '@noble/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import {
  blindMessage,
  unblindSignature,
  verifyDLEQProof,
  deriveKeysetId,
  pointFromHex,
  hashToCurve as cashuHashToCurve,
} from '@cashu/cashu-ts';
import { makeBucket, makeKV } from './_r2_mock.js';

const MINT_PRIVKEY_HEX  = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
const OTHER_PRIVKEY_HEX = '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f';
const ONE_HEX           = '0000000000000000000000000000000000000000000000000000000000000001';
const KEY = 'test-commitment-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ctx = { waitUntil() {}, passThroughOnException() {} };
const utf8 = (s) => new TextEncoder().encode(s);

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

// Supabase stub with a real unique-serial ledger: a second INSERT of the same serial → 409.
function stubLedger() {
  const spent = [];
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/spent_tokens') && opts.method === 'POST') {
      const { serial } = JSON.parse(opts.body);
      if (spent.includes(serial)) return new Response('{"code":"23505"}', { status: 409 });
      spent.push(serial);
      return new Response(null, { status: 201 });
    }
    return new Response('[]', { status: 200 });
  });
  return spent;
}

const randomSecret = () => bytesToHex(crypto.getRandomValues(new Uint8Array(32)));

// Standard wallet flow with cashu-ts: blind utf8(secret), /credential/issue, unblind.
async function issueV2(env, secret = randomSecret()) {
  const { B_, r } = blindMessage(utf8(secret));
  const res = await worker.fetch(new Request('https://api.share.test/credential/issue', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ blinded_message: B_.toHex(true), turnstile_token: 'tt-' + secret }),
  }), env, ctx);
  const body = await res.json();
  const K = pointFromHex(body.mint_pubkey);
  const C = unblindSignature(pointFromHex(body.signed_point), r, K);
  const proof = { id: body.keyset_id, amount: 1, secret, C: C.toHex(true) };
  return { res, body, B_, K, secret, proof };
}

function initiate(env, uuid, credential, commitment) {
  const now = Math.floor(Date.now() / 1000);
  return worker.fetch(new Request(`https://api.share.test/upload/${uuid}/initiate`, {
    method: 'POST',
    headers: {
      'X-Cashu-Credential':      typeof credential === 'string' ? credential : JSON.stringify(credential),
      'X-Credential-Commitment': commitment,
      'X-Issued-Tier':           'free',
      'X-Total-Chunks':          '1',
      'X-Total-Bytes':           '1024',
      'X-Expiry-Timestamp':      String(now + 3600),
    },
  }), env, ctx);
}

afterEach(() => vi.unstubAllGlobals());

// ─────────────────────────────────────────────────────────────────────────────
describe('official vectors', () => {
  it('NUT-00 hash_to_curve (cashu-ts, as used by verifyProofV2)', () => {
    const vectors = [
      ['0000000000000000000000000000000000000000000000000000000000000000', '024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725'],
      ['0000000000000000000000000000000000000000000000000000000000000001', '022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf'],
      ['0000000000000000000000000000000000000000000000000000000000000002', '026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f'],
    ];
    for (const [msg, point] of vectors) {
      expect(cashuHashToCurve(hexToBytes(msg)).toHex(true)).toBe(point);
    }
  });

  it('NUT-00 blinded signatures via issueBlindSig', () => {
    const B_ = '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2';
    expect(issueBlindSig(B_, ONE_HEX).signed_point).toBe(B_);
    expect(issueBlindSig(B_, MINT_PRIVKEY_HEX).signed_point)
      .toBe('0398bc70ce8184d27ba89834d19f5199c84443c31131e48d3c1214db24247d005d');
  });

  it('NUT-12 deterministic nonce: issueBlindSig reproduces e and s exactly', () => {
    const a  = '0000000000000000000000000000000000000000000000000000000000000002';
    const B_ = '02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2';
    const out = issueBlindSig(B_, a);
    expect(out.mint_pubkey).toBe('02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5');
    expect(out.signed_point).toBe('0244eccfc7a348274458bb38044c7f3c389b3c2086c7ec18b5812d2877ab937787');
    expect(out.dleq).toEqual({
      e: '2a16ffee280aff3c429045607f9b8e0bf8b35910c44c1b20b9dfaf01b263d7b3',
      s: '9df27731238334718d120d4f74611a7c668233f988e687ac3fb188f0a34a2dab',
    });
  });

  it('NUT-12 Proof vector: C == hash_to_curve(utf8(secret)) under k = 1, so verifyProofV2 accepts it', () => {
    const secret = 'daf4dd00a2b68a0858a80450f52c8a7d2ccf87d375e43e216e0c571f089f63e9';
    const C      = '024369d2d22a80ecf78f3937da9d5f30c1b9f74f0c32684d583cca0fa6a61cdcfc';
    const { serial } = verifyProofV2({ id: keysetIdFor(ONE_HEX), amount: 1, secret, C }, ONE_HEX);
    expect(serial).toBe(C); // k = 1 → C = Y
  });

  it('NUT-02 keyset id version 01 (vector 1) — pins the deriveKeysetId we call', () => {
    const keys = {
      1: '03a40f20667ed53513075dc51e715ff2046cad64eb68960632269ba7f0210e38bc',
      2: '03fd4ce5a16b65576145949e6f99f445f8249fee17c606b688b504a849cdc452de',
      4: '02648eccfa4c026960966276fa5a4cae46ce0fd432211a4f449bf84f13aa5f8303',
      8: '02fdfd6796bfeac490cbee12f778f867f0a2c68f6508d17c649759ea0dc3547528',
    };
    expect(deriveKeysetId(keys, { unit: 'sat', input_fee_ppk: 100, expiry: 2059210353, versionByte: 1 }))
      .toBe('015ba18a8adcd02e715a58358eb618da4a4b3791151a4bee5e968bb88406ccf76a');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('keysetIdFor + issuance', () => {
  it('is a 66-hex version-01 id, stable per key, distinct across keys', () => {
    const a = keysetIdFor(MINT_PRIVKEY_HEX);
    expect(a).toMatch(/^01[0-9a-f]{64}$/);
    expect(keysetIdFor(MINT_PRIVKEY_HEX)).toBe(a);
    expect(keysetIdFor(OTHER_PRIVKEY_HEX)).not.toBe(a);
  });

  it('issued DLEQ proof verifies against the mint pubkey', () => {
    const { B_ } = blindMessage(utf8(randomSecret()));
    const out = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const ok = verifyDLEQProof(
      { e: hexToBytes(out.dleq.e), s: hexToBytes(out.dleq.s) },
      B_, pointFromHex(out.signed_point), pointFromHex(out.mint_pubkey),
    );
    expect(ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('verifyProofV2', () => {
  function genuine(privHex = MINT_PRIVKEY_HEX) {
    const secret = randomSecret();
    const { B_, r } = blindMessage(utf8(secret));
    const out = issueBlindSig(B_.toHex(true), privHex);
    const C = unblindSignature(pointFromHex(out.signed_point), r, pointFromHex(out.mint_pubkey));
    return { id: out.keyset_id, amount: 1, secret, C: C.toHex(true) };
  }

  it('accepts a genuine proof; serial = hex(hash_to_curve(utf8(secret)))', () => {
    const proof = genuine();
    const { serial } = verifyProofV2(proof, MINT_PRIVKEY_HEX);
    expect(serial).toBe(cashuHashToCurve(utf8(proof.secret)).toHex(true));
    expect(serial).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it('accepts amount omitted', () => {
    const { amount, ...proof } = genuine();
    expect(() => verifyProofV2(proof, MINT_PRIVKEY_HEX)).not.toThrow();
  });

  it('rejects a C not signed by this key', () => {
    const proof = genuine(OTHER_PRIVKEY_HEX);
    proof.id = keysetIdFor(MINT_PRIVKEY_HEX);
    expect(() => verifyProofV2(proof, MINT_PRIVKEY_HEX)).toThrow('Proof signature invalid');
  });

  it('rejects a valid curve point that is not k·Y', () => {
    const proof = { ...genuine(), C: secp.ProjectivePoint.BASE.multiply(12345n).toHex(true) };
    expect(() => verifyProofV2(proof, MINT_PRIVKEY_HEX)).toThrow('Proof signature invalid');
  });

  it('rejects a genuine C presented with a different secret', () => {
    const proof = { ...genuine(), secret: randomSecret() };
    expect(() => verifyProofV2(proof, MINT_PRIVKEY_HEX)).toThrow('Proof signature invalid');
  });

  it('rejects a wrong keyset id', () => {
    expect(() => verifyProofV2({ ...genuine(), id: keysetIdFor(OTHER_PRIVKEY_HEX) }, MINT_PRIVKEY_HEX))
      .toThrow('Unknown keyset id');
    expect(() => verifyProofV2({ ...genuine(), id: '00882760bfa2eb41' }, MINT_PRIVKEY_HEX))
      .toThrow('Unknown keyset id');
  });

  it('rejects malformed fields', () => {
    const p = genuine();
    const bad = [
      null, [], 'str',
      { ...p, amount: 2 },
      { ...p, secret: p.secret.toUpperCase() },
      { ...p, secret: p.secret.slice(2) },
      { ...p, secret: 123 },
      { ...p, C: p.C.slice(2) },
      { ...p, C: '04' + p.C.slice(2) },
      { ...p, dleq: { e: '00', s: '00' } },
      { ...p, witness: '{}' },
    ];
    for (const proof of bad) expect(() => verifyProofV2(proof, MINT_PRIVKEY_HEX)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Worker: /credential/issue + /upload/:uuid/initiate with format v2', () => {
  it('issue returns keyset_id and a verifying dleq alongside the existing fields', async () => {
    stubLedger();
    const env = makeEnv();
    const { res, body, B_, K } = await issueV2(env);
    expect(res.status).toBe(200);
    expect(body.keyset_id).toBe(keysetIdFor(MINT_PRIVKEY_HEX));
    expect(body).toHaveProperty('signed_point');
    expect(body).toHaveProperty('mint_pubkey');
    expect(verifyDLEQProof(
      { e: hexToBytes(body.dleq.e), s: hexToBytes(body.dleq.s) }, B_, pointFromHex(body.signed_point), K,
    )).toBe(true);
  });

  it('genuine v2 proof → 200; ledger serial is hex(Y)', async () => {
    const spent = stubLedger();
    const env = makeEnv();
    const { body, proof, secret } = await issueV2(env);
    const res = await initiate(env, body.uuid, proof, body.commitment);
    expect(res.status).toBe(200);
    expect(spent).toEqual([cashuHashToCurve(utf8(secret)).toHex(true)]);
  });

  it('replayed v2 proof → 409 on a second transfer', async () => {
    stubLedger();
    const env = makeEnv();
    const first  = await issueV2(env);
    const second = await issueV2(env);
    expect((await initiate(env, first.body.uuid, first.proof, first.body.commitment)).status).toBe(200);
    const res = await initiate(env, second.body.uuid, first.proof, second.body.commitment);
    expect(res.status).toBe(409);
  });

  it('v2 point not signed by k → 401, nothing spent', async () => {
    const spent = stubLedger();
    const env = makeEnv();
    const { body, proof } = await issueV2(env);
    const forged = { ...proof, C: secp.ProjectivePoint.BASE.multiply(777n).toHex(true) };
    const res = await initiate(env, body.uuid, forged, body.commitment);
    expect(res.status).toBe(401);
    expect(spent).toEqual([]);
  });

  it('v2 with the wrong keyset id → 401, nothing spent', async () => {
    const spent = stubLedger();
    const env = makeEnv();
    const { body, proof } = await issueV2(env);
    const res = await initiate(env, body.uuid, { ...proof, id: keysetIdFor(OTHER_PRIVKEY_HEX) }, body.commitment);
    expect(res.status).toBe(401);
    expect(spent).toEqual([]);
  });

  it('format v1 {C, mint_pubkey} → 401, nothing spent (Cred-Fix-2b)', async () => {
    const spent = stubLedger();
    const env = makeEnv();
    const { body, proof } = await issueV2(env);
    const v1 = { C: proof.C, mint_pubkey: body.mint_pubkey };
    const res = await initiate(env, body.uuid, v1, body.commitment);
    expect(res.status).toBe(401);
    expect(spent).toEqual([]);
  });
});
