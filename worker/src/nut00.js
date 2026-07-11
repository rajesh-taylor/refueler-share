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
import * as nobleHashes from '@noble/hashes/sha256';
import * as nobleUtils from '@noble/hashes/utils';

const sha256 = nobleHashes.sha256;
const { concatBytes, hexToBytes, bytesToHex } = nobleUtils;

// Cashu hash_to_curve domain separator — per NUT-00 spec
const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');

/**
 * hashToCurve(secretBytes) → secp256k1 Point
 */
export async function hashToCurve(secretBytes) {
  const msgToHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes));
  for (let counter = 0; counter < 0xffffffff; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, true);
    const hash = sha256(concatBytes(msgToHash, counterBytes));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    try {
      const point = secp.Point.fromHex(bytesToHex(compressed));
      return point;
    } catch {
      continue;
    }
  }
  throw new Error('hash_to_curve: exhausted counter space');
}

/**
 * issueBlindSig(blindedPointHex, mintPrivkeyHex) → { signed_point, mint_pubkey }
 */
export async function issueBlindSig(blindedPointHex, mintPrivkeyHex) {
  const k = BigInt('0x' + mintPrivkeyHex);
  const B_ = secp.Point.fromHex(blindedPointHex);
  const C_ = B_.multiply(k);
  const K = secp.Point.fromPrivateKey(hexToBytes(mintPrivkeyHex));
  return {
    signed_point: C_.toHex(true),
    mint_pubkey: K.toHex(true),
  };
}

// Alias used by index.js
export async function issueBlindSignature(blindedPointHex, mintPrivkeyHex) {
  const result = await issueBlindSig(blindedPointHex, mintPrivkeyHex);
  return { signedPoint: result.signed_point, mintPubkey: result.mint_pubkey };
}

/**
 * verifyToken(secretHex, unblindedSigHex, mintPrivkeyHex) → boolean
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
 * verifyCredential(credentialJson, mintPrivkeyHex) → serial hex string
 * Parses credential envelope and verifies. Throws on invalid.
 */
export async function verifyCredential(credentialJson, mintPrivkeyHex) {
  let cred;
  try {
    cred = typeof credentialJson === 'string' ? JSON.parse(credentialJson) : credentialJson;
  } catch {
    throw new Error('Invalid credential JSON');
  }
  const { secret, unblinded_sig } = cred;
  if (!secret || !unblinded_sig) throw new Error('Missing credential fields');
  const valid = await verifyToken(secret, unblinded_sig, mintPrivkeyHex);
  if (!valid) throw new Error('Credential verification failed');
  return await tokenSerial(secret);
}

/**
 * tokenSerial(secretHex) → hex string
 */
export async function tokenSerial(secretHex, blake3Instance) {
  const secretBytes = hexToBytes(secretHex);
  if (blake3Instance) {
    return blake3Instance.hash(secretBytes, { length: 32 }).toString('hex');
  }
  const hash = await crypto.subtle.digest('SHA-256', secretBytes);
  return bytesToHex(new Uint8Array(hash));
}
