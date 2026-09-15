/**
 * worker/src/locke.js
 *
 * B8-1: NUT-11 Mode 2 (P2PK) crypto primitives — pure functions, no I/O.
 *
 * Six functions:
 *   deriveLockeFromDeed(mnemonic)           → { privateKey: Uint8Array(32), publicKey: Uint8Array(33) }
 *   parseP2PKSecret(secretStr)              → { pubkey: string, nonce: string, tags: object }
 *   parseWitness(witnessStr)               → { signatures: string[] }
 *   xonlyFromCompressed(compressed)         → Uint8Array(32)
 *   schnorrVerifyP2PK(secret, witness)     → boolean
 *   buildLockeLoginMsg(harbourUuid, challengeHex)
 *   buildLockeAuthoriseMsg(harbourUuid, newPubkeyHex)
 *   buildLockeRevokeMsg(harbourUuid, targetPubkeyHex)
 *
 * NUT-11 Mode 2 signed-message preimage — PINNED from cashu-ts 4.10.1:
 *   The message passed to schnorr.sign/verify is SHA-256(utf8(proof.secret)).
 *   proof.secret is the raw secret string, e.g. '["P2PK",{"nonce":"...","data":"..."}]'.
 *   Source: cashu-ts@4.10.1 src/crypto.ts — computeMessageDigest(n) = sha256(TextEncoder.encode(n))
 *           called as schnorrVerifyMessage(sig, proof.secret, pubkey).
 *   Confirmed via cashu-ts@4.10.1 bundle inspection (B8-1, 13 Sep 2026).
 *   DO NOT change this preimage without re-pinning against a new reference implementation.
 *
 * Do-not-retry (B8):
 *   - NEVER use Web Crypto for secp256k1 — @noble/secp256k1 only
 *   - NEVER hand raw HKDF bytes to the curve — reduce/reject-sample to 1 ≤ d < n
 *   - NEVER verify against the 33-byte compressed pubkey — x-only only (drop byte 0)
 *   - NEVER guess the message preimage — it is pinned above
 *   - NEVER touch hashSecret() — that is Mode 1, independent
 */

import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { hkdf } from '@noble/hashes/hkdf';
import { pbkdf2 } from '@noble/hashes/pbkdf2';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Curve order n for secp256k1 — the reject-sampling ceiling. */
const SECP256K1_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);

/** BIP-39 PBKDF2 parameters (per spec). */
const BIP39_SALT_PREFIX = 'mnemonic'; // + passphrase (empty string)
const BIP39_ITERATIONS  = 2048;
const BIP39_KEY_LEN     = 64;

/** HKDF salt for the Locke derivation (locked B8-Opus D-1). */
const LOCKE_HKDF_SALT = new TextEncoder().encode('refueler.locke.v1');

/** Base info string for the Locke keypair HKDF (locked B8-Opus D-1). */
const LOCKE_HKDF_INFO_BASE = 'locke_keypair';

/** Domain tags for Locke message construction (locked B8-Opus). */
const DOMAIN_LOGIN     = 'refueler.locke.login.v1';
const DOMAIN_AUTHORISE = 'refueler.locke.authorise.v1';
const DOMAIN_REVOKE    = 'refueler.locke.revoke.v1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new TypeError(`hexToBytes: invalid hex string (length ${hex?.length})`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) throw new TypeError(`hexToBytes: invalid hex at index ${i * 2}`);
    bytes[i] = byte;
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isValidHex(str, expectedByteLen) {
  if (typeof str !== 'string') return false;
  if (str.length !== expectedByteLen * 2) return false;
  return /^[0-9a-fA-F]+$/.test(str);
}

// ---------------------------------------------------------------------------
// 1. deriveLockeFromDeed
// ---------------------------------------------------------------------------

/**
 * Derives a secp256k1 keypair from a BIP-39 mnemonic.
 *
 * Steps (locked B8-Opus D-1):
 *   1. BIP-39 seed: PBKDF2-HMAC-SHA512(mnemonic, "mnemonic", 2048 iterations, 64 bytes)
 *   2. HKDF-SHA256(ikm=seed, salt="refueler.locke.v1", info="locke_keypair", L=32)
 *   3. Reject-sample: read OKM big-endian as d; accept if 1 ≤ d < n.
 *      If not, re-derive with info="locke_keypair.1", ".2", … until valid.
 *      Rejection probability ≈ 2⁻¹²⁸ — the loop is specified for determinism, not frequency.
 *
 * @param {string} mnemonic  BIP-39 mnemonic (12 or 24 words)
 * @returns {{ privateKey: Uint8Array, publicKey: Uint8Array }}
 */
export function deriveLockeFromDeed(mnemonic) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) {
    throw new TypeError('deriveLockeFromDeed: mnemonic must be a non-empty string');
  }

  // Step 1: BIP-39 seed (PBKDF2-HMAC-SHA512, passphrase = "")
  const mnemonicBytes = new TextEncoder().encode(mnemonic.normalize('NFKD'));
  const saltBytes     = new TextEncoder().encode(BIP39_SALT_PREFIX); // passphrase ""
  const seed = pbkdf2(sha512, mnemonicBytes, saltBytes, {
    c: BIP39_ITERATIONS,
    dkLen: BIP39_KEY_LEN,
  });

  // Step 2 + 3: HKDF-SHA256 + reject-sample to valid scalar
  let counter = 0;
  while (true) {
    const info = counter === 0
      ? LOCKE_HKDF_INFO_BASE
      : `${LOCKE_HKDF_INFO_BASE}.${counter}`;

    const okm = hkdf(sha256, seed, LOCKE_HKDF_SALT, new TextEncoder().encode(info), 32);

    // Read big-endian as BigInt
    let d = BigInt(0);
    for (const byte of okm) {
      d = (d << BigInt(8)) | BigInt(byte);
    }

    // Reject-sample: must satisfy 1 ≤ d < n
    if (d >= BigInt(1) && d < SECP256K1_N) {
      const privateKey = okm; // already 32 bytes, value is valid scalar
      const publicKey  = secp256k1.getPublicKey(privateKey, true); // compressed 33 bytes
      return { privateKey, publicKey };
    }

    counter++;
    // Astronomically unlikely to reach here (probability ≈ 2⁻¹²⁸ per iteration)
    if (counter > 100) {
      throw new Error('deriveLockeFromDeed: reject-sampling failed after 100 iterations (cosmological event)');
    }
  }
}

// ---------------------------------------------------------------------------
// 2. parseP2PKSecret
// ---------------------------------------------------------------------------

/**
 * Parses a NUT-11 P2PK proof secret string.
 *
 * Expected format (NUT-11 spec):
 *   '["P2PK", {"nonce": "<hex32>", "data": "<hex33>", "tags": [...]}]'
 *
 * @param {string} secretStr  The proof's `secret` field (raw JSON string)
 * @returns {{ pubkey: string, nonce: string, tags: object }}
 * @throws {Error} on any parse or validation failure
 */
export function parseP2PKSecret(secretStr) {
  if (typeof secretStr !== 'string') {
    throw new Error('parseP2PKSecret: secret must be a string');
  }

  let parsed;
  try {
    parsed = JSON.parse(secretStr);
  } catch {
    throw new Error('parseP2PKSecret: secret is not valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length < 2) {
    throw new Error('parseP2PKSecret: expected [kind, payload] array');
  }

  const [kind, payload] = parsed;

  if (kind !== 'P2PK') {
    throw new Error(`parseP2PKSecret: expected kind "P2PK", got "${kind}"`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('parseP2PKSecret: payload must be an object');
  }

  const { nonce, data, tags } = payload;

  // nonce: required, must be a non-empty string (convention: 32-byte hex)
  if (typeof nonce !== 'string' || nonce === '') {
    throw new Error('parseP2PKSecret: nonce is absent or empty');
  }

  // data: the 33-byte compressed pubkey hex that must sign
  if (!isValidHex(data, 33)) {
    throw new Error(
      `parseP2PKSecret: data must be a 33-byte compressed pubkey hex (66 chars), got ${JSON.stringify(data)}`
    );
  }

  // Validate the compressed pubkey prefix
  const prefix = data.slice(0, 2).toLowerCase();
  if (prefix !== '02' && prefix !== '03') {
    throw new Error(`parseP2PKSecret: pubkey data must start with 02 or 03, got "${prefix}"`);
  }

  return {
    pubkey: data.toLowerCase(),
    nonce,
    tags: tags ?? {},
  };
}

// ---------------------------------------------------------------------------
// 3. parseWitness
// ---------------------------------------------------------------------------

/**
 * Parses a NUT-11 proof witness string.
 *
 * Expected format: '{"signatures": ["<hex64>", ...]}'
 * For Mode 2 single-key (SIG_INPUTS, no threshold), exactly one signature is expected
 * but the parser accepts any array and validation is the caller's concern.
 *
 * @param {string} witnessStr  The proof's `witness` field (raw JSON string)
 * @returns {{ signatures: string[] }}
 * @throws {Error} on missing/invalid structure
 */
export function parseWitness(witnessStr) {
  if (typeof witnessStr !== 'string') {
    throw new Error('parseWitness: witness must be a string');
  }

  let parsed;
  try {
    parsed = JSON.parse(witnessStr);
  } catch {
    throw new Error('parseWitness: witness is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('parseWitness: witness must be a JSON object');
  }

  const { signatures } = parsed;

  if (!Array.isArray(signatures)) {
    throw new Error('parseWitness: signatures field is missing or not an array');
  }

  if (signatures.length === 0) {
    throw new Error('parseWitness: signatures array is empty');
  }

  // Validate the first element (required for Mode 2)
  if (!isValidHex(signatures[0], 64)) {
    throw new Error(
      `parseWitness: first signature must be a 64-byte hex string (128 chars), got ${JSON.stringify(signatures[0])}`
    );
  }

  // Validate any additional signatures
  for (let i = 1; i < signatures.length; i++) {
    if (!isValidHex(signatures[i], 64)) {
      throw new Error(`parseWitness: signature[${i}] is not a valid 64-byte hex string`);
    }
  }

  return { signatures };
}

// ---------------------------------------------------------------------------
// 4. xonlyFromCompressed
// ---------------------------------------------------------------------------

/**
 * Extracts the 32-byte x-coordinate from a 33-byte compressed secp256k1 pubkey.
 *
 * BIP-340 Schnorr operates on x-only (32-byte) pubkeys. The parity byte (index 0)
 * is dropped. Required before every schnorr.verify() call.
 *
 * @param {Uint8Array} compressed  33-byte compressed pubkey
 * @returns {Uint8Array}  32-byte x-only pubkey
 * @throws {TypeError} if input is not a 33-byte Uint8Array
 */
export function xonlyFromCompressed(compressed) {
  if (!(compressed instanceof Uint8Array) || compressed.length !== 33) {
    throw new TypeError(
      `xonlyFromCompressed: expected Uint8Array(33), got ${compressed?.constructor?.name}(${compressed?.length})`
    );
  }
  return compressed.slice(1); // drop parity byte at index 0
}

// ---------------------------------------------------------------------------
// 5. schnorrVerifyP2PK
// ---------------------------------------------------------------------------

/**
 * Verifies a NUT-11 Mode 2 (P2PK) Schnorr witness against a proof secret.
 *
 * NUT-11 signed-message preimage — PINNED from cashu-ts 4.10.1 (B8-1, 13 Sep 2026):
 *   message = SHA-256(utf8(proof.secret))
 *   The raw secret string is hashed in full — not its JSON-parsed contents.
 *   This matches cashu-ts computeMessageDigest() which calls:
 *     sha256(new TextEncoder().encode(secretString))
 *   Reference: cashu-ts@4.10.1 bundle, functions wt (computeMessageDigest),
 *              Dt (schnorrVerifyMessage), jt (getValidSigners), gn (verifyP2PKSpendingConditions).
 *
 * Verification steps:
 *   1. parseP2PKSecret(secret) → { pubkey (33-byte hex), nonce }
 *   2. parseWitness(witness)   → { signatures: [sig_hex, ...] }
 *   3. xonly = xonlyFromCompressed(hexToBytes(pubkey))  — drop parity byte
 *   4. msg   = SHA-256(utf8(secret))                    — NUT-11 preimage, pinned
 *   5. schnorr.verify(hexToBytes(sig), msg, xonly)
 *
 * Returns false (not throws) on verification failure; throws on structural errors.
 *
 * @param {string} secret   The proof's `secret` field (raw JSON string)
 * @param {string} witness  The proof's `witness` field (raw JSON string)
 * @returns {boolean}
 */
export function schnorrVerifyP2PK(secret, witness) {
  // Parse and validate structure — throws on bad input
  const { pubkey } = parseP2PKSecret(secret);
  const { signatures } = parseWitness(witness);

  // x-only pubkey (BIP-340 requires 32 bytes, not 33)
  const xonly = xonlyFromCompressed(hexToBytes(pubkey));

  // NUT-11 message preimage: SHA-256 of the UTF-8 encoded raw secret string
  // PINNED: cashu-ts@4.10.1 computeMessageDigest → sha256(TextEncoder.encode(secretStr))
  const msg = sha256(new TextEncoder().encode(secret));

  // Try each signature in the witness (single-sig for Mode 2 baseline)
  for (const sigHex of signatures) {
    try {
      const sig = hexToBytes(sigHex);
      if (schnorr.verify(sig, msg, xonly)) {
        return true;
      }
    } catch {
      // schnorr.verify may throw on malformed bytes — treat as verify failure
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// 6. Locke message constructors
// ---------------------------------------------------------------------------

/**
 * Shared builder: SHA-256(utf8(domainTag) ‖ utf8(harbourUuid) ‖ extraBytes)
 * Returns a Uint8Array to be passed to schnorr.sign(msg, privkey).
 *
 * Domain-tagging (locked B8-Opus) prevents cross-protocol signature reuse.
 */
function _buildLockeMsg(domainTag, harbourUuid, extraBytes) {
  if (typeof domainTag !== 'string' || !domainTag) {
    throw new TypeError('_buildLockeMsg: domainTag must be a non-empty string');
  }
  if (typeof harbourUuid !== 'string' || !harbourUuid) {
    throw new TypeError('_buildLockeMsg: harbourUuid must be a non-empty string');
  }

  const enc = new TextEncoder();
  const tagBytes  = enc.encode(domainTag);
  const uuidBytes = enc.encode(harbourUuid);

  // Concatenate: tag ‖ uuid ‖ extra
  const total = tagBytes.length + uuidBytes.length + (extraBytes ? extraBytes.length : 0);
  const combined = new Uint8Array(total);
  combined.set(tagBytes, 0);
  combined.set(uuidBytes, tagBytes.length);
  if (extraBytes) {
    combined.set(extraBytes, tagBytes.length + uuidBytes.length);
  }

  return sha256(combined);
}

/**
 * Builds the message to sign for a Locke login request.
 *
 * msg = SHA-256(utf8("refueler.locke.login.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(challengeHex))
 *
 * @param {string} harbourUuid    The harbour's UUID (string)
 * @param {string} challengeHex  32-byte one-shot challenge (64-char hex), issued by Worker
 * @returns {Uint8Array}  32-byte message for schnorr.sign
 */
export function buildLockeLoginMsg(harbourUuid, challengeHex) {
  if (!isValidHex(challengeHex, 32)) {
    throw new TypeError(
      `buildLockeLoginMsg: challengeHex must be 32-byte hex (64 chars), got "${challengeHex}"`
    );
  }
  return _buildLockeMsg(DOMAIN_LOGIN, harbourUuid, hexToBytes(challengeHex));
}

/**
 * Builds the message to sign when authorising a new device pubkey.
 *
 * msg = SHA-256(utf8("refueler.locke.authorise.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(newPubkeyHex))
 *
 * @param {string} harbourUuid   The harbour's UUID
 * @param {string} newPubkeyHex 33-byte compressed pubkey of device being authorised (66-char hex)
 * @returns {Uint8Array}  32-byte message for schnorr.sign
 */
export function buildLockeAuthoriseMsg(harbourUuid, newPubkeyHex) {
  if (typeof harbourUuid !== 'string' || !harbourUuid) {
    throw new TypeError('_buildLockeMsg: harbourUuid must be a non-empty string');
  }
  if (!isValidHex(newPubkeyHex, 33)) {
    throw new TypeError(
      `buildLockeAuthoriseMsg: newPubkeyHex must be 33-byte compressed pubkey hex (66 chars), got "${newPubkeyHex}"`
    );
  }
  return _buildLockeMsg(DOMAIN_AUTHORISE, harbourUuid, hexToBytes(newPubkeyHex));
}

/**
 * Builds the message to sign when revoking a device pubkey.
 *
 * msg = SHA-256(utf8("refueler.locke.revoke.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(targetPubkeyHex))
 *
 * @param {string} harbourUuid      The harbour's UUID
 * @param {string} targetPubkeyHex 33-byte compressed pubkey of device being revoked (66-char hex)
 * @returns {Uint8Array}  32-byte message for schnorr.sign
 */
export function buildLockeRevokeMsg(harbourUuid, targetPubkeyHex) {
  if (typeof harbourUuid !== 'string' || !harbourUuid) {
    throw new TypeError('_buildLockeMsg: harbourUuid must be a non-empty string');
  }
  if (!isValidHex(targetPubkeyHex, 33)) {
    throw new TypeError(
      `buildLockeRevokeMsg: targetPubkeyHex must be 33-byte compressed pubkey hex (66 chars), got "${targetPubkeyHex}"`
    );
  }
  return _buildLockeMsg(DOMAIN_REVOKE, harbourUuid, hexToBytes(targetPubkeyHex));
}

// ---------------------------------------------------------------------------
// Re-export helpers for use in tests and callers
// ---------------------------------------------------------------------------
export { hexToBytes, bytesToHex };
