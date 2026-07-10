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
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils';

// Cashu hash_to_curve domain separator — per NUT-00 spec
const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');

/**
 * hash_to_curve(secret_bytes) → secp256k1 Point
 *
 * Deterministically maps arbitrary bytes to a curve point.
 * Per NUT-00: SHA256("Secp256k1_HashToCurve_Cashu_" || secret) → try 0x02||SHA256(result||counter)
 */
export async function hashToCurve(secretBytes) {
  const msgToHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes));

  for (let counter = 0; counter < 0xffffffff; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, true); // little-endian per spec
    const hash = sha256(concatBytes(msgToHash, counterBytes));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    try {
      const point = secp.Point.fromHex(bytesToHex(compressed));
      return point;
    } catch {
      // Not a valid compressed point — try next counter
      continue;
    }
  }
  throw new Error('hash_to_curve: exhausted counter space — unreachable in practice');
}

/**
 * issueBlindSig(blindedPointHex, mintPrivkeyHex) → { signed_point: hex, mint_pubkey: hex }
 *
 * Mint-side operation. Signs the blinded point B_ received from the client.
 * C_ = k * B_
 *
 * The mint never sees the client's secret x. The blinded point B_ reveals nothing
 * about x because B_ = Y + r*G where r is the client's private blinding factor.
 */
export async function issueBlindSig(blindedPointHex, mintPrivkeyHex) {
  const k = BigInt('0x' + mintPrivkeyHex);
  const B_ = secp.Point.fromHex(blindedPointHex);
  const C_ = B_.multiply(k);

  const K = secp.Point.fromPrivateKey(hexToBytes(mintPrivkeyHex));

  return {
    signed_point: C_.toHex(true),   // compressed
    mint_pubkey: K.toHex(true),      // compressed — returned so client can unblind
  };
}

/**
 * verifyToken(secretHex, unblindedSigHex, mintPrivkeyHex) → boolean
 *
 * Mint-side verification at melt time.
 * Receives the client's (secret x, unblinded signature C).
 * Verifies: C == k * hash_to_curve(x)
 *
 * If valid, the caller must immediately insert serial into spent_tokens
 * to prevent replay attacks.
 */
export async function verifyToken(secretHex, unblindedSigHex, mintPrivkeyHex) {
  try {
    const secretBytes = hexToBytes(secretHex);
    const Y = await hashToCurve(secretBytes);
    const k = BigInt('0x' + mintPrivkeyHex);
    const expectedC = Y.multiply(k);
    const presentedC = secp.Point.fromHex(unblindedSigHex);
    return expectedC.equals(presentedC);
  } catch {
    return false;
  }
}

/**
 * tokenSerial(secretHex) → hex string
 *
 * Derives the double-spend serial from the client secret.
 * Serial = BLAKE3(secret). Stored in spent_tokens, never the secret itself.
 *
 * Note: blake3 import is lazy to avoid circular dependency with blake3.js.
 * Falls back to SHA-256 if BLAKE3 WASM is not yet initialised.
 */
export async function tokenSerial(secretHex, blake3Instance) {
  const secretBytes = hexToBytes(secretHex);
  if (blake3Instance) {
    return blake3Instance.hash(secretBytes, { length: 32 }).toString('hex');
  }
  // SHA-256 fallback (used before BLAKE3 WASM is ready — only in dev)
  const hash = await crypto.subtle.digest('SHA-256', secretBytes);
  return bytesToHex(new Uint8Array(hash));
}
