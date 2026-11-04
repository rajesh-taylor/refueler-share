// crypto-edges.test.js — checks that scripted mutants showed nothing was making (Test-Hardening-1,
// 4 Nov 2026; dev/mutants/run.mjs). The code already did the right thing in each case; these make
// sure it keeps doing it. The first block is the Worker-Keys-1 lesson again: junk fails for many
// reasons, so a check only proves itself against input that is right in every other way.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { hashToCurve } from '@cashu/cashu-ts';

import { keysetIdFor, verifyProofV2 } from '../src/nut00.js';
import { issueDownloadToken, verifyDownloadToken } from '../src/nut11.js';
import { makeSessionToken, verifySessionToken } from '../src/upload_session.js';
import { derivePartKey } from '../../frontend/crypto.js';

const MINT = 'ab'.repeat(32);
const ID = keysetIdFor(MINT);
const signed = (secret) => hashToCurve(new TextEncoder().encode(secret)).multiply(BigInt('0x' + MINT)).toHex(true);
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const FAR = 4102444800;
const DL_KEY = 'QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI=';
const SESSION_KEY = 'c2Vzc2lvbi1rZXktdGVzdC1vbmx5LTMyLWJ5dGVzLSE=';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('verifyProofV2: format rules hold even when the signature is right', () => {
  // The mint signs blindly, so anyone can hold a true signature over any secret they like.
  const good = 'c'.repeat(64);

  it('the shape these tests rely on does pass', () => {
    expect(verifyProofV2({ id: ID, secret: good, C: signed(good) }, MINT).serial).toMatch(/^0[23][0-9a-f]{64}$/);
  });

  it.each([
    ['not hex', 'g'.repeat(64)],
    ['upper-case hex', 'C'.repeat(64)],
    ['one character short', 'c'.repeat(63)],
    ['one character long', 'c'.repeat(65)],
    ['free text', 'any secret someone chose'],
    ['empty', ''],
  ])('a true signature over a secret that is %s is refused', (_, secret) => {
    expect(() => verifyProofV2({ id: ID, secret, C: signed(secret) }, MINT)).toThrow('Invalid proof secret');
  });

  it('a true signature spelled in upper case is refused: one proof, one spelling', () => {
    const C = signed(good);
    const upper = C.slice(0, 2) + C.slice(2).toUpperCase();
    expect(upper).not.toBe(C);
    expect(() => verifyProofV2({ id: ID, secret: good, C: upper }, MINT)).toThrow('Invalid proof C');
  });
});

describe('download token expiry, to the second', () => {
  const env = { DL_TOKEN_KEY: DL_KEY };
  const EXP = 1893456000;

  it('good at its expiry second, refused one second later', async () => {
    const token = await issueDownloadToken(UUID, env, EXP);
    vi.useFakeTimers();
    vi.setSystemTime(EXP * 1000);
    expect(await verifyDownloadToken(token, env)).toEqual({ valid: true, uuid: UUID });
    vi.setSystemTime((EXP + 1) * 1000);
    expect(await verifyDownloadToken(token, env)).toEqual({ valid: false, uuid: null });
  });
});

describe('upload session tokens fail closed', () => {
  const env = { UPLOAD_SESSION_KEY: SESSION_KEY };

  it.each([
    ['no key', {}],
    ['a key too short', { UPLOAD_SESSION_KEY: btoa('short') }],
    ['a key that is not base64', { UPLOAD_SESSION_KEY: '***' }],
  ])('with %s nothing is issued and nothing verifies', async (_, bad) => {
    expect(await makeSessionToken(bad, UUID, 3, FAR)).toBeNull();
    const real = await makeSessionToken(env, UUID, 3, FAR);
    expect(await verifySessionToken(bad, real, UUID, 1)).toBeNull();
  });

  it.each(['', 'not-a-uuid', `${UUID}0`])('a transfer ID of "%s" gets no token and matches none', async (id) => {
    expect(await makeSessionToken(env, id, 3, FAR)).toBeNull();
    const real = await makeSessionToken(env, UUID, 3, FAR);
    expect(await verifySessionToken(env, real, id, 1)).toBeNull();
  });
});

describe('keys stay unexportable', () => {
  it('the part key cannot be exported, and does only the job asked', async () => {
    const key = await derivePartKey(new Uint8Array(32), ['decrypt']);
    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(['decrypt']);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('download and session token keys are imported unexportable', async () => {
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    await issueDownloadToken(UUID, { DL_TOKEN_KEY: DL_KEY }, FAR);
    await makeSessionToken({ UPLOAD_SESSION_KEY: SESSION_KEY }, UUID, 3, FAR);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of spy.mock.calls) expect(call[3]).toBe(false);
  });
});
