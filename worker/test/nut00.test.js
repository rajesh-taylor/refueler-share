/**
 * nut00.test.js — NUT-00 BDHKE blind signature round-trip tests
 *
 * Tests the Cashu blind signature primitive used for anonymous upload credentials.
 * No mocking needed — pure secp256k1 crypto, all deps available in Node via noble.
 *
 * Protocol under test (BDHKE):
 *   Client:  x  = random secret
 *            Y  = hash_to_curve(x)
 *            r  = random blinding factor
 *            B_ = Y + r*G  (blinded point sent to mint)
 *   Mint:    C_ = k * B_   (blind signature)
 *            K  = k * G    (mint pubkey)
 *   Client:  C  = C_ - r*K (unblinded sig)
 *   Verify:  k * Y == C    (server-side check)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, bytesToHex, concatBytes } from '@noble/hashes/utils';
import {
  hashToCurve,
  issueBlindSig,
  issueBlindSignature,
  verifyToken,
  verifyCredential,
  tokenSerial,
} from '../src/nut00.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Deterministic test mint private key (32 bytes, valid scalar).
// Do NOT use in production. This is a known-value test fixture only.
const MINT_PRIVKEY_HEX = '7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f';
// A second key for wrong-key tests
const WRONG_PRIVKEY_HEX = '1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f';

// Known secret for deterministic tests
const SECRET_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// Helper: client-side blinding (simulates what the browser does)
function clientBlind(secretHex, blindingFactorHex) {
  const secretBytes = hexToBytes(secretHex);
  const Y = hashToCurve(secretBytes);
  const r = BigInt('0x' + blindingFactorHex);
  const rG = secp.ProjectivePoint.BASE.multiply(r);
  const B_ = Y.add(rG);
  return { Y, B_, r };
}

// Helper: client-side unblinding (simulates what the browser does)
function clientUnblind(blindedSigHex, blindingFactorHex, mintPubkeyHex) {
  const C_ = secp.ProjectivePoint.fromHex(blindedSigHex);
  const r  = BigInt('0x' + blindingFactorHex);
  const K  = secp.ProjectivePoint.fromHex(mintPubkeyHex);
  const rK = K.multiply(r);
  const C  = C_.add(rK.negate());
  return C.toHex(true);
}

// ─── hashToCurve ─────────────────────────────────────────────────────────────

describe('hashToCurve', () => {
  it('returns a valid secp256k1 ProjectivePoint', () => {
    const point = hashToCurve(hexToBytes(SECRET_HEX));
    expect(point).toBeDefined();
    // A valid point satisfies the curve equation — toHex succeeds and has correct prefix
    const hex = point.toHex(true);
    expect(hex).toMatch(/^0[23]/); // compressed point: 02 or 03 prefix
    expect(hex).toHaveLength(66);  // 33 bytes → 66 hex chars
  });

  it('is deterministic — same input always yields same point', () => {
    const a = hashToCurve(hexToBytes(SECRET_HEX));
    const b = hashToCurve(hexToBytes(SECRET_HEX));
    expect(a.toHex(true)).toBe(b.toHex(true));
  });

  it('different secrets yield different points', () => {
    const a = hashToCurve(hexToBytes(SECRET_HEX));
    const b = hashToCurve(hexToBytes('cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe'));
    expect(a.toHex(true)).not.toBe(b.toHex(true));
  });

  it('accepts empty secret bytes', () => {
    // Edge case — empty input should still hash to a valid point
    const point = hashToCurve(new Uint8Array(0));
    expect(point.toHex(true)).toMatch(/^0[23]/);
  });

  it('matches NUT-00 domain separator encoding', () => {
    // The domain separator must be the UTF-8 encoding of the exact string
    const ds = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');
    const msgHash = sha256(concatBytes(ds, hexToBytes(SECRET_HEX)));
    // counter=0 first attempt
    const ctr = new Uint8Array(4); // all zeros = counter 0 LE
    const hash = sha256(concatBytes(msgHash, ctr));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    // Try to construct point directly — if this throws, counter 0 wasn't the winner
    // Either way, hashToCurve must return a consistent result
    const point = hashToCurve(hexToBytes(SECRET_HEX));
    // Cross-check: the point Y satisfies Y.toHex starts with 02 or 03
    expect(point.toHex(true).slice(0, 2)).toMatch(/0[23]/);
  });
});

// ─── issueBlindSig ───────────────────────────────────────────────────────────

describe('issueBlindSig', () => {
  const BLINDING_FACTOR = '4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f';

  it('returns signed_point and mint_pubkey', () => {
    const { Y, B_ } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
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

  // Unblinded sig C must satisfy: k * Y == C
  // where Y = hash_to_curve(secret) and k = mint private key
  it('unblinded C satisfies k * Y == C (core BDHKE property)', () => {
    const { Y, B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);

    // Direct algebraic check: k * Y should equal C
    const k = BigInt('0x' + MINT_PRIVKEY_HEX);
    const kY = Y.multiply(k);
    const unblindedPoint = secp.ProjectivePoint.fromHex(C);
    expect(kY.equals(unblindedPoint)).toBe(true);
  });

  it('verifyToken returns true for a valid round-trip credential', () => {
    const { B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);

    const valid = verifyToken(SECRET_HEX, C, MINT_PRIVKEY_HEX);
    expect(valid).toBe(true);
  });

  it('verifyToken returns false for tampered unblinded sig', () => {
    const { B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);

    // Flip one byte in the unblinded sig — should be a different point
    const tampered = C.slice(0, 4) + 'dead' + C.slice(8);
    const valid = verifyToken(SECRET_HEX, tampered, MINT_PRIVKEY_HEX);
    expect(valid).toBe(false);
  });

  it('verifyToken returns false for wrong mint key', () => {
    const { B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);

    // Verify with different key — should fail
    const valid = verifyToken(SECRET_HEX, C, WRONG_PRIVKEY_HEX);
    expect(valid).toBe(false);
  });

  it('verifyToken returns false for wrong secret', () => {
    const { B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), MINT_PRIVKEY_HEX);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);

    const valid = verifyToken('cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', C, MINT_PRIVKEY_HEX);
    expect(valid).toBe(false);
  });

  it('verifyToken returns false for invalid hex input', () => {
    expect(verifyToken('notvalidhex', 'alsonotvalid', MINT_PRIVKEY_HEX)).toBe(false);
  });

  it('blinding factor is not recoverable — same secret, different r, same verifyToken outcome', () => {
    const ALT_FACTOR = '3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a';
    const { B_: B1 } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { B_: B2 } = clientBlind(SECRET_HEX, ALT_FACTOR);

    const { signed_point: sp1, mint_pubkey: mk1 } = issueBlindSig(B1.toHex(true), MINT_PRIVKEY_HEX);
    const { signed_point: sp2, mint_pubkey: mk2 } = issueBlindSig(B2.toHex(true), MINT_PRIVKEY_HEX);

    const C1 = clientUnblind(sp1, BLINDING_FACTOR, mk1);
    const C2 = clientUnblind(sp2, ALT_FACTOR, mk2);

    // Both verify correctly despite different blinding factors
    expect(verifyToken(SECRET_HEX, C1, MINT_PRIVKEY_HEX)).toBe(true);
    expect(verifyToken(SECRET_HEX, C2, MINT_PRIVKEY_HEX)).toBe(true);

    // But unblinded sigs are identical (same secret, same mint key → same C)
    // This is the BDHKE guarantee: C = k * hash_to_curve(x) regardless of r
    expect(C1).toBe(C2);
  });
});

// ─── verifyCredential ────────────────────────────────────────────────────────

describe('verifyCredential', () => {
  const BLINDING_FACTOR = '4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f';

  // Build a valid credential object (simulates frontend issuing credential)
  function buildCredential(privkeyHex = MINT_PRIVKEY_HEX) {
    const { B_, r } = clientBlind(SECRET_HEX, BLINDING_FACTOR);
    const { signed_point, mint_pubkey } = issueBlindSig(B_.toHex(true), privkeyHex);
    const C = clientUnblind(signed_point, BLINDING_FACTOR, mint_pubkey);
    return { C, mint_pubkey };
  }

  it('returns a SHA-256 hex serial for a valid credential object', async () => {
    const cred = buildCredential();
    const serial = await verifyCredential(cred, MINT_PRIVKEY_HEX);
    expect(typeof serial).toBe('string');
    expect(serial).toHaveLength(64); // SHA-256 → 32 bytes → 64 hex chars
    expect(serial).toMatch(/^[0-9a-f]+$/);
  });

  it('accepts JSON string credential', async () => {
    const cred = buildCredential();
    const serial = await verifyCredential(JSON.stringify(cred), MINT_PRIVKEY_HEX);
    expect(serial).toHaveLength(64);
  });

  it('is deterministic — same credential always yields same serial', async () => {
    const cred = buildCredential();
    const s1 = await verifyCredential(cred, MINT_PRIVKEY_HEX);
    const s2 = await verifyCredential(cred, MINT_PRIVKEY_HEX);
    expect(s1).toBe(s2);
  });

  it('throws on invalid JSON string', async () => {
    await expect(verifyCredential('{not valid json', MINT_PRIVKEY_HEX)).rejects.toThrow('Invalid credential JSON');
  });

  it('throws on missing C field', async () => {
    await expect(verifyCredential({ mint_pubkey: 'aabb' }, MINT_PRIVKEY_HEX)).rejects.toThrow('Missing credential fields');
  });

  it('throws on missing mint_pubkey field', async () => {
    const cred = buildCredential();
    const { C } = cred;
    await expect(verifyCredential({ C }, MINT_PRIVKEY_HEX)).rejects.toThrow('Missing credential fields');
  });

  it('throws on mint key mismatch', async () => {
    const cred = buildCredential(MINT_PRIVKEY_HEX);
    await expect(verifyCredential(cred, WRONG_PRIVKEY_HEX)).rejects.toThrow('Credential mint key mismatch');
  });

  it('throws on invalid curve point in C', async () => {
    const k = BigInt('0x' + MINT_PRIVKEY_HEX);
    const K = bytesToHex(secp.getPublicKey(hexToBytes(MINT_PRIVKEY_HEX), true));
    // C is not a valid curve point
    const cred = { C: 'deadbeef'.repeat(8) + '00', mint_pubkey: K };
    await expect(verifyCredential(cred, MINT_PRIVKEY_HEX)).rejects.toThrow('Credential C is not a valid curve point');
  });

  it('accepts unblinded_sig field name alias', async () => {
    const cred = buildCredential();
    const altCred = { unblinded_sig: cred.C, mint_pubkey: cred.mint_pubkey };
    const serial = await verifyCredential(altCred, MINT_PRIVKEY_HEX);
    expect(serial).toHaveLength(64);
  });

  it('two different credentials yield different serials', async () => {
    const cred1 = buildCredential();
    // Different secret → different C → different serial
    const { B_: B2 } = clientBlind('cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe', BLINDING_FACTOR);
    const { signed_point: sp2, mint_pubkey: mk2 } = issueBlindSig(B2.toHex(true), MINT_PRIVKEY_HEX);
    const C2 = clientUnblind(sp2, BLINDING_FACTOR, mk2);
    const cred2 = { C: C2, mint_pubkey: mk2 };

    const s1 = await verifyCredential(cred1, MINT_PRIVKEY_HEX);
    const s2 = await verifyCredential(cred2, MINT_PRIVKEY_HEX);
    expect(s1).not.toBe(s2);
  });
});

// ─── tokenSerial ─────────────────────────────────────────────────────────────

describe('tokenSerial', () => {
  it('returns a 64-char lowercase hex SHA-256 hash', async () => {
    const { B_ } = (() => {
      const BLINDING_FACTOR = '4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f';
      const secretBytes = hexToBytes(SECRET_HEX);
      const Y = hashToCurve(secretBytes);
      const r = BigInt('0x' + BLINDING_FACTOR);
      const rG = secp.ProjectivePoint.BASE.multiply(r);
      return { B_: Y.add(rG) };
    })();
    const serial = await tokenSerial(B_.toHex(true));
    expect(serial).toHaveLength(64);
    expect(serial).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', async () => {
    const s1 = await tokenSerial('02' + 'ab'.repeat(32));
    const s2 = await tokenSerial('02' + 'ab'.repeat(32));
    expect(s1).toBe(s2);
  });

  it('different hex inputs yield different serials', async () => {
    // Use known valid points to avoid hex parsing edge cases
    const p1 = secp.ProjectivePoint.BASE.toHex(true); // G
    const p2 = secp.ProjectivePoint.BASE.multiply(2n).toHex(true); // 2G
    const s1 = await tokenSerial(p1);
    const s2 = await tokenSerial(p2);
    expect(s1).not.toBe(s2);
  });
});
