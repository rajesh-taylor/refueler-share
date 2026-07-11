/**
 * nut11.js — NUT-11 Mode 1 helpers
 *
 * Passphrase hashing, timing-safe comparison, and short-lived download tokens.
 * Tokens are HMAC-SHA256 signed, bound to a UUID, with 15-minute expiry.
 *
 * LAYER BOUNDARY: This module handles download gating only.
 * NUT-00 blind sig lives in nut00.js. These layers must never be conflated.
 */

/**
 * hashSecret(passphrase) → hex string
 * SHA-256 of the UTF-8 passphrase. Stored in manifest as p2sh_secret_hash.
 */
export async function hashSecret(passphrase) {
  const encoded = new TextEncoder().encode(passphrase);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * timingSafeEqual(a, b) → boolean
 * Constant-time string comparison. Both inputs are hex strings.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const aBytes = hexToBytes(a);
  const bBytes = hexToBytes(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * issueDownloadToken(uuid, mintPrivkeyHex) → token string
 *
 * Issues a 15-minute HMAC-SHA256 download token bound to the transfer UUID.
 * Format: base64url(json({ uuid, exp })) + '.' + base64url(hmac)
 */
export async function issueDownloadToken(uuid, mintPrivkeyHex) {
  const exp = Math.floor(Date.now() / 1000) + 900; // 15 minutes
  const payload = JSON.stringify({ uuid, exp });
  const payloadB64 = btoa(payload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const key = await importHmacKey(mintPrivkeyHex);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = bufToBase64url(sig);

  return `${payloadB64}.${sigB64}`;
}

/**
 * verifyDownloadToken(token, mintPrivkeyHex) → { valid: boolean, uuid: string|null }
 */
export async function verifyDownloadToken(token, mintPrivkeyHex) {
  try {
    const [payloadB64, sigB64] = token.split('.');
    if (!payloadB64 || !sigB64) return { valid: false, uuid: null };

    const key = await importHmacKey(mintPrivkeyHex);
    const expectedSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const expectedB64 = bufToBase64url(expectedSig);

    // Timing-safe sig comparison
    if (!timingSafeEqual(sigB64.padEnd(64, '0'), expectedB64.padEnd(64, '0'))) {
      return { valid: false, uuid: null };
    }

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    const now = Math.floor(Date.now() / 1000);

    if (now > payload.exp) return { valid: false, uuid: null };

    return { valid: true, uuid: payload.uuid };
  } catch {
    return { valid: false, uuid: null };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function importHmacKey(mintPrivkeyHex) {
  const keyBytes = hexToBytes(mintPrivkeyHex.slice(0, 64)); // 32 bytes
  return crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bufToBase64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
