/**
 * NUT-00 — Blind Diffie-Hellman Key Exchange (BDHKE)
 *
 * Implements the Cashu blind signature scheme for anonymous upload credentials.
 * This is NOT a monetary implementation. No external mint. No ecash-to-sats path.
 * The blind sig primitive is repurposed as a zero-knowledge anonymous credential.
 *
 * References: https://github.com/cashubtc/nuts/blob/main/00.md
 *
 * LAYER BOUNDARY: This module handles anonymous authentication only.
 * BLAKE3 chunk verification lives in blake3.js. These layers must never be conflated.
 *
 * NOTE: Uses @noble/secp256k1@2.x API for the pubkey; NUT-00/02/12 maths via @cashu/cashu-ts.
 */

import * as secp from '@noble/secp256k1';
import { secp256k1 } from '@noble/curves/secp256k1.js';
// Hex helpers from noble-curves v2 (ESM), not noble-hashes v1: in the vitest workerd pool,
// an ESM import of hashes v1 utils.js first breaks blake3.js's later CJS require() of it.
import { equalBytes, hexToBytes, bytesToHex } from '@noble/curves/utils.js';
import {
  hashToCurve,
  createBlindSignature,
  createDLEQProof,
  deriveKeysetId,
  pointFromHex,
} from '@cashu/cashu-ts';

/**
 * keysetIdFor(mintPrivkeyHex) → NUT-02 keyset id (version 01, 66 hex chars)
 * One key at amount 1, unit "auth" (NUT-22 convention — no monetary unit).
 * Consumer and API keys have different pubkeys, so their ids differ.
 */
export function keysetIdFor(mintPrivkeyHex) {
  const K = bytesToHex(secp.getPublicKey(hexToBytes(mintPrivkeyHex), true));
  return deriveKeysetId({ 1: K }, { unit: 'auth', versionByte: 1 });
}

/**
 * issueBlindSig(blindedPointHex, mintPrivkeyHex)
 *   → { signed_point, mint_pubkey, keyset_id, dleq: { e, s } }
 * C_ = k * B_ ; K = k * G (mint pubkey).
 * Cred-Fix-2: signing and the NUT-12 DLEQ proof come from @cashu/cashu-ts
 * (deterministic nonce). keyset_id and dleq are additive response fields.
 */
export function issueBlindSig(blindedPointHex, mintPrivkeyHex) {
  const privkeyBytes = hexToBytes(mintPrivkeyHex);
  const B_ = pointFromHex(blindedPointHex);
  const id = keysetIdFor(mintPrivkeyHex);
  const { C_ } = createBlindSignature(B_, privkeyBytes, id);
  const { e, s } = createDLEQProof(B_, privkeyBytes);
  return {
    signed_point: C_.toHex(true),
    mint_pubkey:  bytesToHex(secp.getPublicKey(privkeyBytes, true)),
    keyset_id:    id,
    dleq:         { e: bytesToHex(e), s: bytesToHex(s) },
  };
}

// Alias used by index.js — returns { signedPoint, mintPubkey, keysetId, dleq }
export function issueBlindSignature(blindedPointHex, mintPrivkeyHex) {
  const result = issueBlindSig(blindedPointHex, mintPrivkeyHex);
  return {
    signedPoint: result.signed_point,
    mintPubkey:  result.mint_pubkey,
    keysetId:    result.keyset_id,
    dleq:        result.dleq,
  };
}

/**
 * verifyProofV2(proof, mintPrivkeyHex) → { serial }   (throws on any failure)
 *
 * Credential format v2 — a standard Cashu proof { id, secret, C } (amount
 * omitted or 1). Standard Cashu proof verification:
 *   Y = hash_to_curve(utf8(secret))   (NUT-00; the secret STRING's UTF-8 bytes)
 *   require k·Y == C                  (compressed bytes, constant-time compare)
 *   serial = hex(Y)                   (NUT-07 convention, 66 hex chars)
 * id must be this key's NUT-02 keyset id. Unknown fields are refused.
 */
const PROOF_V2_FIELDS = new Set(['id', 'amount', 'secret', 'C']);

export function verifyProofV2(proof, mintPrivkeyHex) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error('Invalid proof');
  for (const key of Object.keys(proof)) {
    if (!PROOF_V2_FIELDS.has(key)) throw new Error('Unexpected proof field');
  }
  const { id, amount, secret, C } = proof;
  if (amount !== undefined && amount !== 1)                   throw new Error('Invalid proof amount');
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) throw new Error('Invalid proof secret');
  if (typeof C !== 'string' || !/^0[23][0-9a-f]{64}$/.test(C))      throw new Error('Invalid proof C');
  if (typeof id !== 'string' || id !== keysetIdFor(mintPrivkeyHex)) throw new Error('Unknown keyset id');

  const Y = hashToCurve(new TextEncoder().encode(secret));
  const k = secp256k1.Point.Fn.fromBytes(hexToBytes(mintPrivkeyHex));
  const expected = Y.multiply(k).toBytes(true);
  if (!equalBytes(expected, hexToBytes(C))) throw new Error('Proof signature invalid');

  return { serial: Y.toHex(true) };
}
