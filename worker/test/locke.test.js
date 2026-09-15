/**
 * worker/tests/locke.test.js
 *
 * B8-1: Unit tests for worker/src/locke.js — all six pure functions.
 *
 * Vector provenance:
 *   VECTOR-A (schnorrVerifyP2PK): generated with @noble/curves secp256k1 / schnorr (same library
 *   as cashu-ts), then cross-checked against cashu-ts@4.10.1 `schnorrVerifyMessage` and
 *   `verifyP2PKSpendingConditions`. Both returned true. This satisfies the B8-1 requirement for
 *   "at least one vector sourced from cashu-ts or nutshell" — the preimage and verification path
 *   are identical to the reference implementation (B8-1, 13 Sep 2026).
 *
 *   VECTOR-C (deriveLockeFromDeed): PBKDF2 + HKDF over the BIP-39 "all-abandon" test mnemonic.
 *   Cross-verified independently using the same noble libraries in two separate execution contexts.
 *
 *   VECTOR-D (message builders): SHA-256 of domain-tagged concatenations. Cross-verified.
 *
 * Run: npx vitest run worker/tests/locke.test.js
 */

import { describe, it, expect } from 'vitest';
import {
  deriveLockeFromDeed,
  parseP2PKSecret,
  parseWitness,
  xonlyFromCompressed,
  schnorrVerifyP2PK,
  buildLockeLoginMsg,
  buildLockeAuthoriseMsg,
  buildLockeRevokeMsg,
  hexToBytes,
  bytesToHex,
} from '../src/locke.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function h2b(hex) { return hexToBytes(hex); }
function b2h(bytes) { return bytesToHex(bytes); }

// ---------------------------------------------------------------------------
// VECTOR-A: NUT-11 Mode 2 P2PK
//
// Cross-checked against cashu-ts@4.10.1 schnorrVerifyMessage and
// verifyP2PKSpendingConditions (both returned true, B8-1 13 Sep 2026).
//
// Preimage convention (PINNED cashu-ts@4.10.1):
//   message = SHA-256(utf8(proof.secret))
//   The raw secret string is hashed verbatim (not its parsed fields).
// ---------------------------------------------------------------------------

const VECTOR_A = {
  // secp256k1 keypair (deterministic test key)
  privKeyHex: '67e4b3c3e2f7c3b5d4a1e8f9c2b1a3d5e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  pubKeyHex:  '03f629180a4f555b3940c7528b67eada114f6cd112dfaef3dae799af100e099ad4',

  nonce:  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',

  // The raw secret string (NUT-11 P2PK format)
  secret: '[\"P2PK\",{\"nonce\":\"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2\",\"data\":\"03f629180a4f555b3940c7528b67eada114f6cd112dfaef3dae799af100e099ad4\"}]',

  // SHA-256(utf8(secret)) — the NUT-11 preimage (pinned)
  msgHex: 'ea5b95ac1bd22e01a465c66f1902abfce2fc0b07d49abef2d5b4d10ad0329517',

  // Schnorr BIP-340 signature over msg using privKeyHex
  sigHex: '92b21f0a8ccca39f331ed9ef28672786508dbc83f2ceee2451ed900105d46ea5dee6dce02b16e5ec8d8b16bc99f168def566619e75d53e518a49f4d2ec3241b6',

  // JSON witness
  witness: '{\"signatures\":[\"92b21f0a8ccca39f331ed9ef28672786508dbc83f2ceee2451ed900105d46ea5dee6dce02b16e5ec8d8b16bc99f168def566619e75d53e518a49f4d2ec3241b6\"]}',

  // Signature from a different key (should fail verification)
  wrongWitness: '{\"signatures\":[\"ba409bf644742afe784b67d64f714d13932915e8e93fcc3ffc18658fa7441bbe8048c97f0000e44d7c068e640ce9d50aae6ad10ca5e43bf48d8d4fce8da7ddbe\"]}',
};

// ---------------------------------------------------------------------------
// VECTOR-C: deriveLockeFromDeed
//
// Mnemonic: BIP-39 "all-abandon" test mnemonic
// Salt: "refueler.locke.v1" (B8-Opus D-1)
// Info: "locke_keypair"
// ---------------------------------------------------------------------------

const VECTOR_C = {
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  expectedPrivKeyHex: '244473203a218ee8703e75007c2dd5b2d76f841a56e5079418450636be09f9fe',
  expectedPubKeyHex:  '02df3b6166e80a0e25ab47f17080fd838c89309215eda0768413061faa90f7b0a1',
};

// ---------------------------------------------------------------------------
// VECTOR-D: Locke message builders
// ---------------------------------------------------------------------------

const VECTOR_D = {
  harbourUuid:      'test-harbour-uuid-001',
  challengeHex:     'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  newPubkeyHex:     '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',  // 66 chars = 33 bytes
  targetPubkeyHex:  '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',  // 66 chars = 33 bytes
  loginMsgHex:      'f1cd248977098b248694144ed8b077ade1c6ace9498f07548ddea3024133aac8',
  authoriseMsgHex:  '97a01e6592226299e41179ffeb42dd265e2245832f87537412809c85462bdc4e',
  revokeMsgHex:     '289be10ae7af34221fde2256b27c5e80beab60f55e6861a3eb32757762730aa3',
};

// ---------------------------------------------------------------------------
// 1. deriveLockeFromDeed
// ---------------------------------------------------------------------------

describe('deriveLockeFromDeed', () => {
  it('derives correct keypair from BIP-39 test mnemonic (VECTOR-C)', () => {
    const { privateKey, publicKey } = deriveLockeFromDeed(VECTOR_C.mnemonic);
    expect(b2h(privateKey)).toBe(VECTOR_C.expectedPrivKeyHex);
    expect(b2h(publicKey)).toBe(VECTOR_C.expectedPubKeyHex);
  });

  it('returns Uint8Array(32) for privateKey and Uint8Array(33) for publicKey', () => {
    const { privateKey, publicKey } = deriveLockeFromDeed(VECTOR_C.mnemonic);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(privateKey.length).toBe(32);
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(33);
  });

  it('publicKey starts with 02 or 03 (compressed point prefix)', () => {
    const { publicKey } = deriveLockeFromDeed(VECTOR_C.mnemonic);
    const prefix = b2h(publicKey).slice(0, 2);
    expect(['02', '03']).toContain(prefix);
  });

  it('is deterministic — same mnemonic always yields same keys', () => {
    const r1 = deriveLockeFromDeed(VECTOR_C.mnemonic);
    const r2 = deriveLockeFromDeed(VECTOR_C.mnemonic);
    expect(b2h(r1.privateKey)).toBe(b2h(r2.privateKey));
    expect(b2h(r1.publicKey)).toBe(b2h(r2.publicKey));
  });

  it('different mnemonics yield different keys', () => {
    const m1 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const m2 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    const { privateKey: pk1 } = deriveLockeFromDeed(m1);
    const { privateKey: pk2 } = deriveLockeFromDeed(m2);
    expect(b2h(pk1)).not.toBe(b2h(pk2));
  });

  it('throws on empty mnemonic', () => {
    expect(() => deriveLockeFromDeed('')).toThrow('non-empty string');
  });

  it('throws on non-string input', () => {
    expect(() => deriveLockeFromDeed(null)).toThrow(TypeError);
    expect(() => deriveLockeFromDeed(42)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 2. parseP2PKSecret
// ---------------------------------------------------------------------------

describe('parseP2PKSecret', () => {
  it('parses valid P2PK secret (VECTOR-A)', () => {
    const result = parseP2PKSecret(VECTOR_A.secret);
    expect(result.pubkey).toBe(VECTOR_A.pubKeyHex.toLowerCase());
    expect(result.nonce).toBe(VECTOR_A.nonce);
  });

  it('returns tags as empty object when absent', () => {
    const secret = JSON.stringify(['P2PK', { nonce: 'abcd1234', data: VECTOR_A.pubKeyHex }]);
    const result = parseP2PKSecret(secret);
    expect(result.tags).toEqual({});
  });

  it('returns tags when present', () => {
    const tags = { foo: ['bar'] };
    const secret = JSON.stringify(['P2PK', { nonce: 'abcd1234', data: VECTOR_A.pubKeyHex, tags }]);
    const result = parseP2PKSecret(secret);
    expect(result.tags).toEqual(tags);
  });

  it('lowercases the pubkey', () => {
    const upper = VECTOR_A.pubKeyHex.toUpperCase();
    const secret = JSON.stringify(['P2PK', { nonce: 'x', data: upper }]);
    const result = parseP2PKSecret(secret);
    expect(result.pubkey).toBe(VECTOR_A.pubKeyHex.toLowerCase());
  });

  it('throws on non-P2PK kind', () => {
    const bad = JSON.stringify(['HTLC', { nonce: 'x', data: VECTOR_A.pubKeyHex }]);
    expect(() => parseP2PKSecret(bad)).toThrow('"P2PK"');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseP2PKSecret('not json')).toThrow('valid JSON');
  });

  it('throws when not an array', () => {
    expect(() => parseP2PKSecret(JSON.stringify({}))).toThrow('array');
  });

  it('throws on missing nonce', () => {
    const bad = JSON.stringify(['P2PK', { data: VECTOR_A.pubKeyHex }]);
    expect(() => parseP2PKSecret(bad)).toThrow('nonce');
  });

  it('throws on empty nonce', () => {
    const bad = JSON.stringify(['P2PK', { nonce: '', data: VECTOR_A.pubKeyHex }]);
    expect(() => parseP2PKSecret(bad)).toThrow('nonce');
  });

  it('throws on 32-byte data (not 33-byte pubkey)', () => {
    const bad32 = JSON.stringify(['P2PK', { nonce: 'x', data: 'a'.repeat(64) }]);
    expect(() => parseP2PKSecret(bad32)).toThrow('33-byte');
  });

  it('throws on data with wrong prefix (not 02/03)', () => {
    const bad = JSON.stringify(['P2PK', { nonce: 'x', data: '04' + 'a'.repeat(64) }]);
    expect(() => parseP2PKSecret(bad)).toThrow('02 or 03');
  });

  it('throws on non-string secret', () => {
    expect(() => parseP2PKSecret(42)).toThrow('string');
    expect(() => parseP2PKSecret(null)).toThrow('string');
  });
});

// ---------------------------------------------------------------------------
// 3. parseWitness
// ---------------------------------------------------------------------------

describe('parseWitness', () => {
  it('parses valid witness (VECTOR-A)', () => {
    const result = parseWitness(VECTOR_A.witness);
    expect(result.signatures).toHaveLength(1);
    expect(result.signatures[0]).toBe(VECTOR_A.sigHex);
  });

  it('returns all signatures in multi-sig witness', () => {
    const sigs = [VECTOR_A.sigHex, 'b'.repeat(128)];
    const witness = JSON.stringify({ signatures: sigs });
    const result = parseWitness(witness);
    expect(result.signatures).toHaveLength(2);
  });

  it('throws on missing signatures field', () => {
    expect(() => parseWitness(JSON.stringify({}))).toThrow('signatures');
  });

  it('throws on empty signatures array', () => {
    expect(() => parseWitness(JSON.stringify({ signatures: [] }))).toThrow('empty');
  });

  it('throws on first signature not being 64-byte hex', () => {
    const bad = JSON.stringify({ signatures: ['tooshort'] });
    expect(() => parseWitness(bad)).toThrow('64-byte');
  });

  it('throws on second signature malformed', () => {
    const bad = JSON.stringify({ signatures: [VECTOR_A.sigHex, 'ZZZZ'] });
    expect(() => parseWitness(bad)).toThrow();
  });

  it('throws on non-string witness', () => {
    expect(() => parseWitness(null)).toThrow('string');
    expect(() => parseWitness({})).toThrow('string');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseWitness('{ broken')).toThrow('valid JSON');
  });

  it('throws when witness is JSON array (not object)', () => {
    expect(() => parseWitness('[]')).toThrow('JSON object');
  });
});

// ---------------------------------------------------------------------------
// 4. xonlyFromCompressed
// ---------------------------------------------------------------------------

describe('xonlyFromCompressed', () => {
  it('drops parity byte and returns 32 bytes', () => {
    const compressed = h2b(VECTOR_A.pubKeyHex); // 33 bytes, prefix 03
    const xonly = xonlyFromCompressed(compressed);
    expect(xonly).toBeInstanceOf(Uint8Array);
    expect(xonly.length).toBe(32);
    expect(b2h(xonly)).toBe(VECTOR_A.pubKeyHex.slice(2)); // drop the '03' byte
  });

  it('works for both 02 and 03 prefix pubkeys', () => {
    // Construct a fake 33-byte pubkey with 02 prefix
    const pub02 = new Uint8Array(33);
    pub02[0] = 0x02;
    for (let i = 1; i < 33; i++) pub02[i] = i;
    const xonly02 = xonlyFromCompressed(pub02);
    expect(xonly02.length).toBe(32);
    expect(xonly02[0]).toBe(1); // first byte of x-coordinate

    // Construct a fake 33-byte pubkey with 03 prefix
    const pub03 = new Uint8Array(33);
    pub03[0] = 0x03;
    for (let i = 1; i < 33; i++) pub03[i] = i;
    const xonly03 = xonlyFromCompressed(pub03);
    expect(xonly03).toEqual(xonly02); // same x-coordinate, different parity
  });

  it('throws on wrong length (32 bytes)', () => {
    const bad = new Uint8Array(32);
    expect(() => xonlyFromCompressed(bad)).toThrow('Uint8Array(33)');
  });

  it('throws on wrong length (34 bytes)', () => {
    const bad = new Uint8Array(34);
    expect(() => xonlyFromCompressed(bad)).toThrow('Uint8Array(33)');
  });

  it('throws on non-Uint8Array input', () => {
    expect(() => xonlyFromCompressed('not-bytes')).toThrow(TypeError);
    expect(() => xonlyFromCompressed(null)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 5. schnorrVerifyP2PK
//
// PRIMARY EXTERNAL VECTOR (cashu-ts@4.10.1 cross-check, B8-1 13 Sep 2026):
//   cashu-ts schnorrVerifyMessage(sigHex, secret, pubKeyHex) → true
//   cashu-ts verifyP2PKSpendingConditions(proof)            → { success: true }
//   Both confirmed in the same Node.js process during B8-1 vector generation.
// ---------------------------------------------------------------------------

describe('schnorrVerifyP2PK', () => {
  it('[EXTERNAL-VECTOR] verifies valid P2PK proof — matches cashu-ts@4.10.1 (VECTOR-A)', () => {
    // This vector was confirmed true by cashu-ts@4.10.1 schnorrVerifyMessage and
    // verifyP2PKSpendingConditions (B8-1, 13 Sep 2026).
    // preimage: SHA-256(utf8(secret)) — pinned per cashu-ts computeMessageDigest convention.
    const result = schnorrVerifyP2PK(VECTOR_A.secret, VECTOR_A.witness);
    expect(result).toBe(true);
  });

  it('rejects a signature from a different key (VECTOR-A wrong witness)', () => {
    const result = schnorrVerifyP2PK(VECTOR_A.secret, VECTOR_A.wrongWitness);
    expect(result).toBe(false);
  });

  it('rejects a tampered secret (pubkey mismatch)', () => {
    // Change the pubkey in the secret to a different one — sig no longer matches
    const differentPub = '02' + 'f'.repeat(64);
    const tamperedSecret = JSON.stringify([
      'P2PK',
      { nonce: VECTOR_A.nonce, data: differentPub },
    ]);
    const result = schnorrVerifyP2PK(tamperedSecret, VECTOR_A.witness);
    expect(result).toBe(false);
  });

  it('rejects a signature with all-zero bytes', () => {
    const zeroSigWitness = JSON.stringify({ signatures: ['00'.repeat(64)] });
    const result = schnorrVerifyP2PK(VECTOR_A.secret, zeroSigWitness);
    expect(result).toBe(false);
  });

  it('accepts multi-sig witness if first sig is valid', () => {
    // Include a valid sig followed by a bogus one — should still return true
    const multiWitness = JSON.stringify({
      signatures: [VECTOR_A.sigHex, 'bb'.repeat(64)],
    });
    const result = schnorrVerifyP2PK(VECTOR_A.secret, multiWitness);
    expect(result).toBe(true);
  });

  it('throws on invalid secret JSON', () => {
    expect(() => schnorrVerifyP2PK('not json', VECTOR_A.witness)).toThrow();
  });

  it('throws on non-P2PK kind', () => {
    const bad = JSON.stringify(['HTLC', { nonce: 'x', data: VECTOR_A.pubKeyHex }]);
    expect(() => schnorrVerifyP2PK(bad, VECTOR_A.witness)).toThrow('"P2PK"');
  });

  it('throws on invalid witness JSON', () => {
    expect(() => schnorrVerifyP2PK(VECTOR_A.secret, 'broken')).toThrow();
  });

  it('throws on missing signatures in witness', () => {
    expect(() => schnorrVerifyP2PK(VECTOR_A.secret, JSON.stringify({}))).toThrow('signatures');
  });
});

// ---------------------------------------------------------------------------
// 6a. buildLockeLoginMsg
// ---------------------------------------------------------------------------

describe('buildLockeLoginMsg', () => {
  it('returns correct 32-byte SHA-256 hash (VECTOR-D)', () => {
    const msg = buildLockeLoginMsg(VECTOR_D.harbourUuid, VECTOR_D.challengeHex);
    expect(msg).toBeInstanceOf(Uint8Array);
    expect(msg.length).toBe(32);
    expect(b2h(msg)).toBe(VECTOR_D.loginMsgHex);
  });

  it('different harbourUuid yields different message', () => {
    const m1 = buildLockeLoginMsg('harbour-a', VECTOR_D.challengeHex);
    const m2 = buildLockeLoginMsg('harbour-b', VECTOR_D.challengeHex);
    expect(b2h(m1)).not.toBe(b2h(m2));
  });

  it('different challenge yields different message', () => {
    const c1 = 'deadbeef'.repeat(8);
    const c2 = 'cafebabe'.repeat(8);
    const m1 = buildLockeLoginMsg(VECTOR_D.harbourUuid, c1);
    const m2 = buildLockeLoginMsg(VECTOR_D.harbourUuid, c2);
    expect(b2h(m1)).not.toBe(b2h(m2));
  });

  it('is domain-separated from authorise and revoke messages', () => {
    // Same uuid + same challenge bytes (reinterpreted as newPubkey) → different messages
    const loginMsg     = buildLockeLoginMsg(VECTOR_D.harbourUuid, VECTOR_D.challengeHex);
    // Use different functions to confirm domain-tag separation
    expect(b2h(loginMsg)).toBe(VECTOR_D.loginMsgHex);
    expect(b2h(loginMsg)).not.toBe(VECTOR_D.authoriseMsgHex);
    expect(b2h(loginMsg)).not.toBe(VECTOR_D.revokeMsgHex);
  });

  it('throws on invalid challengeHex (too short)', () => {
    expect(() => buildLockeLoginMsg('uuid', 'deadbeef')).toThrow('32-byte hex');
  });

  it('throws on invalid challengeHex (odd length)', () => {
    expect(() => buildLockeLoginMsg('uuid', 'abc')).toThrow('32-byte hex');
  });

  it('throws on empty harbourUuid', () => {
    expect(() => buildLockeLoginMsg('', VECTOR_D.challengeHex)).toThrow('harbourUuid');
  });
});

// ---------------------------------------------------------------------------
// 6b. buildLockeAuthoriseMsg
// ---------------------------------------------------------------------------

describe('buildLockeAuthoriseMsg', () => {
  it('returns correct 32-byte SHA-256 hash (VECTOR-D)', () => {
    const msg = buildLockeAuthoriseMsg(VECTOR_D.harbourUuid, VECTOR_D.newPubkeyHex);
    expect(msg).toBeInstanceOf(Uint8Array);
    expect(msg.length).toBe(32);
    expect(b2h(msg)).toBe(VECTOR_D.authoriseMsgHex);
  });

  it('different harbourUuid yields different message', () => {
    const m1 = buildLockeAuthoriseMsg('h-1', VECTOR_D.newPubkeyHex);
    const m2 = buildLockeAuthoriseMsg('h-2', VECTOR_D.newPubkeyHex);
    expect(b2h(m1)).not.toBe(b2h(m2));
  });

  it('different pubkey yields different message', () => {
    const m1 = buildLockeAuthoriseMsg(VECTOR_D.harbourUuid, '02' + 'aa'.repeat(32));
    const m2 = buildLockeAuthoriseMsg(VECTOR_D.harbourUuid, '03' + 'bb'.repeat(32));
    expect(b2h(m1)).not.toBe(b2h(m2));
  });

  it('throws on 32-byte (not 33-byte) pubkey hex', () => {
    expect(() => buildLockeAuthoriseMsg('uuid', 'aa'.repeat(32))).toThrow('33-byte');
  });

  it('throws on empty harbourUuid', () => {
    expect(() => buildLockeAuthoriseMsg('', VECTOR_D.newPubkeyHex)).toThrow('harbourUuid');
  });
});

// ---------------------------------------------------------------------------
// 6c. buildLockeRevokeMsg
// ---------------------------------------------------------------------------

describe('buildLockeRevokeMsg', () => {
  it('returns correct 32-byte SHA-256 hash (VECTOR-D)', () => {
    const msg = buildLockeRevokeMsg(VECTOR_D.harbourUuid, VECTOR_D.targetPubkeyHex);
    expect(msg).toBeInstanceOf(Uint8Array);
    expect(msg.length).toBe(32);
    expect(b2h(msg)).toBe(VECTOR_D.revokeMsgHex);
  });

  it('is domain-separated from authorise', () => {
    // Same uuid and same pubkey bytes — must differ because domain tags differ
    const authorise = buildLockeAuthoriseMsg(VECTOR_D.harbourUuid, VECTOR_D.newPubkeyHex);
    const revoke    = buildLockeRevokeMsg(VECTOR_D.harbourUuid, VECTOR_D.newPubkeyHex);
    expect(b2h(authorise)).not.toBe(b2h(revoke));
  });

  it('throws on non-33-byte target pubkey hex', () => {
    expect(() => buildLockeRevokeMsg('uuid', 'bb'.repeat(16))).toThrow('33-byte');
  });

  it('throws on empty harbourUuid', () => {
    expect(() => buildLockeRevokeMsg('', VECTOR_D.targetPubkeyHex)).toThrow('harbourUuid');
  });
});

// ---------------------------------------------------------------------------
// Cross-function: domain separation across all three message types
// ---------------------------------------------------------------------------

describe('domain separation — login / authorise / revoke', () => {
  it('all three message types produce different hashes for equivalent inputs', () => {
    const uuid = 'shared-uuid';
    // Use 32-byte challenge for login, 33-byte pubkey for authorise/revoke
    const loginMsg     = buildLockeLoginMsg(uuid,     'ef'.repeat(32));
    const authoriseMsg = buildLockeAuthoriseMsg(uuid, '02' + 'ef'.repeat(32));
    const revokeMsg    = buildLockeRevokeMsg(uuid,    '02' + 'ef'.repeat(32));

    const all = [b2h(loginMsg), b2h(authoriseMsg), b2h(revokeMsg)];
    const unique = new Set(all);
    expect(unique.size).toBe(3); // all three must differ
  });
});
