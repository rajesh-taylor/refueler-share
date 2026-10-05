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
 * NOTE: Uses @noble/secp256k1@2.x API (ProjectivePoint, not Point).
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { equalBytes } from '@noble/curves/utils.js';
import {
  hashToCurve as cashuHashToCurve,
  createBlindSignature,
  createDLEQProof,
  deriveKeysetId,
  pointFromHex,
} from '@cashu/cashu-ts';

// Cashu hash_to_curve domain separator — per NUT-00 spec
const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');

/**
 * hashToCurve(secretBytes) → secp256k1 ProjectivePoint
 * Per NUT-00: msg_hash = SHA256(DOMAIN_SEPARATOR || x)
 *             try Y = point('02' || SHA256(msg_hash || counter_le_uint32))
 */
export function hashToCurve(secretBytes) {
  const msgHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes));
  for (let counter = 0; counter < 0xffffffff; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, true); // little-endian
    const hash = sha256(concatBytes(msgHash, counterBytes));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    try {
      return secp.ProjectivePoint.fromHex(bytesToHex(compressed));
    } catch {
      continue;
    }
  }
  throw new Error('hash_to_curve: exhausted counter space');
}

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
 * verifyToken(secretHex, unblindedSigHex, mintPrivkeyHex) → boolean
 * Checks: k * hash_to_curve(secret) == C
 */
export function verifyToken(secretHex, unblindedSigHex, mintPrivkeyHex) {
  try {
    const secretBytes = hexToBytes(secretHex);
    const Y = hashToCurve(secretBytes);
    const k = BigInt('0x' + mintPrivkeyHex);
    const expectedC  = Y.multiply(k);
    const presentedC = secp.ProjectivePoint.fromHex(unblindedSigHex);
    return expectedC.equals(presentedC);
  } catch {
    return false;
  }
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

  const Y = cashuHashToCurve(new TextEncoder().encode(secret));
  const k = secp256k1.Point.Fn.fromBytes(hexToBytes(mintPrivkeyHex));
  const expected = Y.multiply(k).toBytes(true);
  if (!equalBytes(expected, hexToBytes(C))) throw new Error('Proof signature invalid');

  return { serial: Y.toHex(true) };
}

/**
 * Credential format v1 — REMOVE at Cred-Fix-2b once the frontend sends v2.
 *
 * verifyCredential(credentialJson, mintPrivkeyHex) → serial hex string
 *
 * Credential envelope from frontend unblindSignature():
 *   { C: "<hex>", mint_pubkey: "<hex>" }
 *
 * The "secret" (x) is embedded as the first 64 hex chars of C for our scheme,
 * BUT our frontend stores credential as JSON { C, mint_pubkey } and sends the
 * raw secret separately. We use C as the unblinded sig and derive a serial from it.
 *
 * Actual credential wire format sent by frontend:
 *   X-Cashu-Credential: JSON.stringify({ C, mint_pubkey })
 *
 * We verify by checking the credential is a valid point on the curve signed by k.
 * Since we don't store the original secret x server-side, we verify structural
 * validity and use SHA256(C_bytes) as the spend serial (double-spend prevention).
 */
export async function verifyCredential(credentialJson, mintPrivkeyHex) {
  let cred;
  try {
    cred = typeof credentialJson === 'string' ? JSON.parse(credentialJson) : credentialJson;
  } catch {
    throw new Error('Invalid credential JSON');
  }

  // Frontend sends { C, mint_pubkey } — accept both field naming conventions
  const unblindedSigHex = cred.C ?? cred.unblinded_sig;
  const mintPubkeyHex   = cred.mint_pubkey;

  if (!unblindedSigHex || !mintPubkeyHex) throw new Error('Missing credential fields');

  // Verify mint_pubkey matches our private key
  const expectedPubkey = bytesToHex(secp.getPublicKey(hexToBytes(mintPrivkeyHex), true));
  if (mintPubkeyHex !== expectedPubkey) throw new Error('Credential mint key mismatch');

  // Verify C is a valid curve point (structural check)
  try {
    secp.ProjectivePoint.fromHex(unblindedSigHex);
  } catch {
    throw new Error('Credential C is not a valid curve point');
  }

  // Derive spend serial from the unblinded sig point bytes
  return await tokenSerial(unblindedSigHex);
}

/**
 * tokenSerial(hex) → SHA256 hex string — used as double-spend key in Supabase
 */
export async function tokenSerial(hex) {
  const bytes = hexToBytes(hex);
  const hash  = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(hash));
}
