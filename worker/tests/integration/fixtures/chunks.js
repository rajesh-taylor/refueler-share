import { blake3 } from '@noble/hashes/blake3';

const CHUNK_SIZE = 1024 * 512; // 512 KB — fast for tests

/**
 * Deterministic pseudo-random bytes seeded by index.
 * Same index → same bytes → same hash across test runs.
 */
function deterministicBytes(index, size = CHUNK_SIZE) {
  const buf = new Uint8Array(size);
  // Simple LCG seeded by chunk index — not crypto, just deterministic.
  let seed = (index + 1) * 1_000_003;
  for (let i = 0; i < size; i++) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

/**
 * makeChunks(n) → Array of { bytes: Uint8Array, blake3Hash: string }
 */
export function makeChunks(n = 3, sizeBytes = CHUNK_SIZE) {
  return Array.from({ length: n }, (_, i) => {
    const bytes = deterministicBytes(i, sizeBytes);
    const hash = Buffer.from(blake3(bytes)).toString('hex');
    return { bytes, blake3Hash: hash };
  });
}

/**
 * Returns a copy of chunks with the hash at `index` deliberately wrong.
 */
export function wrongHashVariant(chunks, index = 0) {
  const copy = chunks.map(c => ({ ...c }));
  copy[index] = { ...copy[index], blake3Hash: 'deadbeef'.repeat(8) };
  return copy;
}


//
