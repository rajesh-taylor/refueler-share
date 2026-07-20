// blake3.js — server-side BLAKE3 chunk verification
// Replaces the passthrough stub. Calls blake3Hash() from the Workers WASM wrapper.
// verifyChunkHash is called per-chunk in handleUpload (index.js lines 326 + 353).

import { blake3Hash } from './blake3_worker.js';

// Converts a hex string to Uint8Array.
function hexToBytes(hex) {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

// Constant-time comparison of two Uint8Arrays.
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Verifies that BLAKE3(chunkBytes) === declaredHashHex.
// Returns true on match, false on mismatch or invalid input.
// Called for every chunk — both chunk 0 and subsequent chunks.
export async function verifyChunkHash(chunkBytes, declaredHashHex) {
  if (!declaredHashHex || typeof declaredHashHex !== 'string') return false;
  const declared = hexToBytes(declaredHashHex.toLowerCase());
  if (!declared || declared.length !== 32) return false;

  let computed;
  try {
    computed = await blake3Hash(chunkBytes);
  } catch (e) {
    console.error('BLAKE3 hash error:', e);
    return false;
  }

  return bytesEqual(computed, declared);
}
