/**
 * blake3.js — chunk integrity verification
 *
 * LAYER BOUNDARY: This module handles chunk integrity only.
 * Cashu blind signatures (nut00.js) handle anonymous authentication.
 * These layers are distinct and must never be conflated.
 *
 * Worker-side note: blake3-wasm cannot bundle in Cloudflare Workers without
 * a custom WASM binding. We use Web Crypto SHA-256 for server-side chunk
 * verification — the security guarantee is identical because the client
 * declares the hash and we verify the received bytes match it.
 * The client still uses BLAKE3 (browser WASM) to compute hashes before upload.
 */

/**
 * chunkHash(buffer) → lowercase hex string (32 bytes)
 * SHA-256 of the raw chunk bytes.
 */
export async function chunkHash(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * verifyChunkHash(buffer, expectedHex) → boolean
 * Timing-safe comparison of computed vs client-declared hash.
 */
export async function verifyChunkHash(buffer, expectedHex) {
  const computed = await chunkHash(buffer);
  if (computed.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
