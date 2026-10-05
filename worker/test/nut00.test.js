/**
 * nut00.test.js — NUT-00 BDHKE blind signature round-trip tests
 *
 * Tests the Cashu blind signature primitive used for anonymous upload credentials.
 * Client side uses @cashu/cashu-ts (what the browser runs, via frontend/cashu-crypto.js).
 *
 * Protocol under test (BDHKE, credential format v2):
 *   Client:  secret = 64-hex string
 *            Y  = hash_to_curve(utf8(secret))
 *            r  = random blinding factor
 *            B_ = Y + r*G  (blinded point sent to mint)
 *   Mint:    C_ = k * B_   (blind signature)
 *            K  = k * G    (mint pubkey)
 *   Client:  C  = C_ - r*K (unblinded sig)
 *   Verify:  k * Y == C    (verifyProofV2, server-side)
 * Official vectors and the /initiate wiring live in credential-v2.test.js.
 */

import { describe, it, expect } from 'vitest';
// Load order matters in the workerd pool: Worker modules before @cashu/cashu-ts.
import {
  issueBlindSig,
  issueBlindSignature,
  keysetIdFor,
  verifyProofV2,
} from '../src/nut00.js';
import * as secp from '@noble/secp256k1';
import { blindMessage, hashToCurve } from '@cashu/cashu-ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Deterministic test mint private key (32 bytes, valid scalar).
// Do NOT use in production. This is a known-value test fixture only.
const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
// A second key for wrong-key tests
const WRONG_PRIVKEY_HEX = '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f';

// Known secret for deterministic tests (a v2 secret: its UTF-8 bytes are hashed)
const SECRET_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const utf8 = (str) => new TextEncoder().encode(str);

// Helper: client-side blinding (what the browser does, via cashu-ts)
function clientBlind(secret, blindingFactorHex) {
  const r = BigInt('0x' + blindingFactorHex);
  const { B_ } = blindMessage(utf8(secret), r);
  return { Y: hashToCurve(utf8(secret)), B_, r };
}

// Helper: client-side unblinding — independent noble arithmetic, C = C_ - r*K
function clientUnblind(blindedSigHex, blindingFactorHex, mintPubkeyHex) {
  const C_ = secp.ProjectivePoint.fromHex(blindedSigHex);
  const r  = BigInt('0x' + blindingFactorHex);
  const K  = secp.ProjectivePoint.fromHex(mintPubkeyHex);
  const rK = K.multiply(r);
  const C  = C_.add(rK.negate());
  return C.toHex(true);
}

// Helper: the proof the browser sends (credential format v2)
function proofFor(secret, C, privkeyHex = MINT_PRIVKEY_HEX) {
  return { id: keysetIdFor(privkeyHex), amount: 1, secret, C };
}

// ─── issueBlindSig ───────────────────────────────────────────────────────────

describe('issueBlindSig', () => {
  const BLINDING_FACTOR = '4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f';

  it('returns signed_point and mint_pubkey', () => {
    const { B_ } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const result = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    expect(result).toHaveProperty('signed_point');
    expect(result).toHaveProperty('mint_pubkey');
  });

  it('signed_point is a valid compressed secp256k1 point', () => {
    const { B_ } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    expect(signed_point).toMatch(/^0[23]/);
    expect(signed_point).toHaveLength(66);
    // Must be parseable as a point
    expect(() => secp.ProjectivePoint.fromHex(signed_point)).not.toThrow();
  });

  it('mint_pubkey matches k*G for the given private key', () => {
    const { B_ } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const k = BigInt('0x' + MINT_PRIVKEY_HEX);
    const expectedK = secp.ProjectivePoint.BASE.multiply(k).toHex(true);
    expect(mint_pubkey).toBe(expectedK);
  });

  it('issueBlindSignature alias returns camelCase fields', () => {
    const { B_ } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const result = issueBlindSignature(B_.toHex(true), MINT_PRIVKEY_HEX);
    expect(result).toHaveProperty('signedPoint');
    expect(result).toHaveProperty('mintPubkey');
    // Values match the snake_case version
    const ref = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    expect(result.signedPoint).toBe(ref.signed_point);
    expect(result.mintPubkey).toBe(ref.mint_pubkey);
  });

  it('different blinding factors yield different blind sigs for same secret', () => {
    const { B_: B1 } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { B_: B2 } = clientBlind(SECRET_HEX, '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a');
    const { signed_point: s1 } = issueBlindSig(B1.toHex(true), MINT_PRIVKEY_HEX);
    const { signed_point: s2 } = issueBlindSig(B2.toHex(true), MINT_PRIVKEY_HEX);
    expect(s1).not.toBe(s2);
  });
});

// ─── Full BDHKE round-trip ────────────────────────────────────────────────────

describe('BDHKE full round-trip', () => {
  const BLINDING_FACTOR = '4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f';

  function roundTrip(secret = SECRET_HEX, factor = BLINDING_FACTOR, privkeyHex = MINT_PRIVKEY_HEX) {
    const { B_ } = clientBlind(secret, factor);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), privkeyHex);
    return clientUnblind(signed_point, factor, mint_pubkey);
  }

  // Unblinded sig C must satisfy: k * Y == C
  // where Y = hash_to_curve(utf8(secret)) and k = mint private key
  it('unblinded C satisfies k * Y == C (core BDHKE property)', () => {
    const { Y } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const C = roundTrip();
    const kY = secp.ProjectivePoint.fromHex(Y.toHex(true)).multiply(BigInt('0x' + MINT_PRIVKEY_HEX));
    expect(kY.toHex(true)).toBe(C);
  });

  it('verifyProofV2 accepts a valid round-trip proof; serial = hex(Y)', () => {
    const C = roundTrip();
    const { serial } = verifyProofV2(proofFor(SECRET_HEX, C), MINT_PRIVKEY_HEX);
    expect(serial).toBe(hashToCurve(utf8(SECRET_HEX)).toHex(true));
  });

  it('verifyProofV2 refuses a tampered unblinded sig', () => {
    const C = roundTrip();
    const tampered = C.slice(0, 4) + 'dead' + C.slice(8);
    expect(() => verifyProofV2(proofFor(SECRET_HEX, tampered), MINT_PRIVKEY_HEX)).toThrow();
  });

  it('verifyProofV2 refuses a proof under the wrong mint key', () => {
    const C = roundTrip();
    expect(() => verifyProofV2(proofFor(SECRET_HEX, C, WRONG_PRIVKEY_HEX), WRONG_PRIVKEY_HEX)).toThrow('Proof signature invalid');
    expect(() => verifyProofV2(proofFor(SECRET_HEX, C), WRONG_PRIVKEY_HEX)).toThrow('Unknown keyset id');
  });

  it('verifyProofV2 refuses the right C with a different secret', () => {
    const C = roundTrip();
    const other = 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
    expect(() => verifyProofV2(proofFor(other, C), MINT_PRIVKEY_HEX)).toThrow('Proof signature invalid');
  });

  it('verifyProofV2 refuses malformed input', () => {
    expect(() => verifyProofV2(proofFor('notvalidhex', 'alsonotvalid'), MINT_PRIVKEY_HEX)).toThrow();
  });

  it('blinding factor is not recoverable — same secret, different r, same C', () => {
    const ALT_FACTOR = '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a';
    const C1 = roundTrip(SECRET_HEX, BLINDING_FACTOR);
    const C2 = roundTrip(SECRET_HEX, ALT_FACTOR);

    // Both verify correctly despite different blinding factors
    expect(() => verifyProofV2(proofFor(SECRET_HEX, C1), MINT_PRIVKEY_HEX)).not.toThrow();
    expect(() => verifyProofV2(proofFor(SECRET_HEX, C2), MINT_PRIVKEY_HEX)).not.toThrow();

    // But unblinded sigs are identical (same secret, same mint key → same C)
    // This is the BDHKE guarantee: C = k * hash_to_curve(secret) regardless of r
    expect(C1).toBe(C2);
  });

  it('two different secrets yield different serials', () => {
    const other = 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
    const s1 = verifyProofV2(proofFor(SECRET_HEX, roundTrip(SECRET_HEX)), MINT_PRIVKEY_HEX).serial;
    const s2 = verifyProofV2(proofFor(other, roundTrip(other)), MINT_PRIVKEY_HEX).serial;
    expect(s1).not.toBe(s2);
  });
});
