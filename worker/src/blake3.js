/**
 * BLAKE3 WASM — chunk fingerprint verification
 *
 * LAYER BOUNDARY: BLAKE3 handles internal indexing and chunk integrity only.
 * Cashu blind signatures (nut00.js) handle anonymous authentication.
 * These layers are distinct and must never be conflated.
 *
 * In the Worker:
 *   - Verifies that received chunk bytes match the client-computed BLAKE3 hash
 *   - Derives the 32-byte BLAKE3 root hash used in the manifest
 *
 * The blake3-wasm package provides a sync API after initialisation.
 * Cloudflare Workers support WASM modules via wrangler's bundler.
 */

import { createHash, load } from 'blake3-wasm';

let initialised = false;
let blake3;

/**
 * Initialise the BLAKE3 WASM module.
 * Must be called once per Worker invocation before any hash operations.
 * Workers isolate memory per request, so this is lightweight.
 */
export async function initBlake3() {
  if (!initialised) {
    await load();
    blake3 = { createHash, initialised: true };
    initialised = true;
  }
  return blake3;
}

/**
 * chunkHash(buffer) → lowercase hex string (32 bytes)
 *
 * Computes the BLAKE3 hash of a single chunk's raw bytes.
 * Called by the Worker to verify client-provided X-Chunk-Hash headers.
 */
export async function chunkHash(buffer) {
  await initBlake3();
  const hasher = createHash();
  hasher.update(new Uint8Array(buffer));
  return hasher.digest('hex');
}

/**
 * verifyChunkHash(buffer, expectedHex) → boolean
 *
 * Timing-safe comparison of computed vs client-declared BLAKE3 hash.
 * Returns false if hashes don't match — caller should reject with 400.
 */
export async function verifyChunkHash(buffer, expectedHex) {
  const computed = await chunkHash(buffer);
  if (computed.length !== expectedHex.length) return false;
  // Constant-time comparison to prevent timing oracle on hash values
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}
