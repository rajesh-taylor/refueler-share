/**
 * nut11.js — NUT-11 P2SH Mode 1: pre-shared secret gating
 *
 * Mode 1 flow:
 *   Upload:   caller supplies passphrase → BLAKE3 hash → stored in manifest.p2sh_secret_hash
 *   Download: recipient POSTs passphrase to /auth/{uuid} → Worker hashes + timing-safe compare
 *             → issues short-lived download token (signed HMAC, 15 min TTL)
 *             → GET /download/{uuid}/{chunk} requires valid token in Authorization header
 *
 * Never stores raw passphrase. Never logs passphrase. Never echoes passphrase.
 */

import { chunkHash } from './blake3.js';

// ---------------------------------------------------------------------------
// Secret hashing
// ---------------------------------------------------------------------------

/**
 * Hash a passphrase with BLAKE3.
 * We reuse blake3.js's `chunkHash` which returns a hex string.
 * Input is UTF-8 encoded. Output is 64-char hex (256-bit).
 */
export async function hashSecret(passphrase) {
  const enc = new TextEncoder().encode(passphrase);
  return chunkHash(enc);
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

/**
 * Timing-safe compare of two hex strings.
 * Both are converted to Uint8Array and compared with constant-time XOR.
 * Returns true only if identical length and all bytes match.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = hexToBytes(a);
  const bb = hexToBytes(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Download token (short-lived HMAC-SHA256, 15 min TTL)
// ---------------------------------------------------------------------------

/**
 * Issue a download token for a given uuid.
 * Token payload: `{uuid}.{expiry_unix_seconds}`
 * Token: `{payload}.{hex_hmac}`
 * Signed with MINT_PRIVATE_KEY (reused as HMAC key — same secret, different role).
 */
export async function issueDownloadToken(uuid, mintPrivateKeyHex, ttlSeconds = 900) {
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${uuid}.${expiry}`;
  const sig = await hmacSign(payload, mintPrivateKeyHex);
  return `${payload}.${sig}`;
}

/**
 * Verify a download token.
 * Returns { valid: boolean, uuid: string|null }
 */
export async function verifyDownloadToken(token, mintPrivateKeyHex) {
  if (!token || typeof token !== 'string') return { valid: false, uuid: null };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, uuid: null };

  const [uuid, expiryStr, sig] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry)) return { valid: false, uuid: null };

  // Check expiry first (non-secret branch — fine to short-circuit here)
  if (Math.floor(Date.now() / 1000) > expiry) return { valid: false, uuid: null };

  // Timing-safe sig check
  const payload = `${uuid}.${expiryStr}`;
  const expected = await hmacSign(payload, mintPrivateKeyHex);
  const valid = timingSafeEqual(sig, expected);

  return { valid, uuid: valid ? uuid : null };
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 helper (Web Crypto)
// ---------------------------------------------------------------------------

async function hmacSign(message, hexKey) {
  const keyBytes = hexToBytes(hexKey);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const msgBytes = new TextEncoder().encode(message);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
