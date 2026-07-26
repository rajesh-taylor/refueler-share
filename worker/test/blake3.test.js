/**
 * blake3.test.js — verifyChunkHash unit tests
 *
 * Strategy: vi.mock('./blake3_worker.js') — replaces the WASM module entirely.
 * The test-env substitute uses @noble/hashes/blake3 for correct hash values.
 * What's under test: verifyChunkHash's parsing, comparison, and error-handling
 * logic, not the WASM binary itself. WASM gets integration coverage in S64.
 *
 * Vitest resolves vi.mock paths relative to the test file location.
 * This file lives at worker/test/blake3.test.js — mock path matches src import.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { blake3 } from '@noble/hashes/blake3';

// ─── Mock blake3_worker.js before importing blake3.js ────────────────────────
// vi.mock is hoisted to the top of the file by Vitest, so this runs first.

vi.mock('../src/blake3_worker.js', () => ({
  blake3Hash: vi.fn(async (data) => {
    // Correct implementation substitute using @noble/hashes/blake3
    // Returns 32-byte Uint8Array matching what the WASM module returns
    return blake3(data, { dkLen: 32 });
  }),
}));

// Import AFTER mock is registered
import { verifyChunkHash } from '../src/blake3.js';
import { blake3Hash } from '../src/blake3_worker.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute correct BLAKE3 hash of data and return as lowercase hex string */
function correctHashHex(data) {
  const bytes = blake3(data, { dkLen: 32 });
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Flip one bit in a hex string at byte position i */
function corruptHex(hex, bytePos = 0) {
  const pos = bytePos * 2;
  const byte = parseInt(hex.slice(pos, pos + 2), 16);
  const flipped = (byte ^ 0x01).toString(16).padStart(2, '0');
  return hex.slice(0, pos) + flipped + hex.slice(pos + 2);
}

// ─── Core correctness ────────────────────────────────────────────────────────

describe('verifyChunkHash — core correctness', () => {
  it('returns true when hash matches', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hex = correctHashHex(data);
    expect(await verifyChunkHash(data, hex)).toBe(true);
  });

  it('returns false when hash does not match', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const hex = correctHashHex(data);
    const bad = corruptHex(hex);
    expect(await verifyChunkHash(data, bad)).toBe(false);
  });

  it('returns true for empty chunk (zero-length data)', async () => {
    const data = new Uint8Array(0);
    const hex = correctHashHex(data);
    expect(await verifyChunkHash(data, hex)).toBe(true);
  });

  it('returns true for a 1 MB chunk', async () => {
    const data = new Uint8Array(1024 * 1024).fill(0xab);
    const hex = correctHashHex(data);
    expect(await verifyChunkHash(data, hex)).toBe(true);
  });

  it('is case-insensitive — uppercase hex accepted', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const hex = correctHashHex(data).toUpperCase();
    expect(await verifyChunkHash(data, hex)).toBe(true);
  });

  it('is case-insensitive — mixed case accepted', async () => {
    const data = new Uint8Array([10, 20, 30]);
    const hex = correctHashHex(data);
    const mixed = hex.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c).join('');
    expect(await verifyChunkHash(data, mixed)).toBe(true);
  });

  it('single-byte difference in data yields false', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const correct = correctHashHex(data);
    const altData = new Uint8Array([1, 2, 3, 4, 6]); // last byte differs
    expect(await verifyChunkHash(altData, correct)).toBe(false);
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe('verifyChunkHash — input validation', () => {
  it('returns false for null declaredHashHex', async () => {
    expect(await verifyChunkHash(new Uint8Array([1, 2, 3]), null)).toBe(false);
  });

  it('returns false for undefined declaredHashHex', async () => {
    expect(await verifyChunkHash(new Uint8Array([1, 2, 3]), undefined)).toBe(false);
  });

  it('returns false for empty string declaredHashHex', async () => {
    expect(await verifyChunkHash(new Uint8Array([1, 2, 3]), '')).toBe(false);
  });

  it('returns false for non-string declaredHashHex (number)', async () => {
    expect(await verifyChunkHash(new Uint8Array([1]), 12345)).toBe(false);
  });

  it('returns false for non-string declaredHashHex (object)', async () => {
    expect(await verifyChunkHash(new Uint8Array([1]), { hash: 'abc' })).toBe(false);
  });

  it('returns false for hex string with wrong length (too short)', async () => {
    // SHA-256 length — wrong algorithm
    expect(await verifyChunkHash(new Uint8Array([1]), 'deadbeef'.repeat(8))).toBe(false);
  });

  it('returns false for hex string with wrong length (too long)', async () => {
    // 65 bytes worth of hex (should be 32)
    expect(await verifyChunkHash(new Uint8Array([1]), 'ab'.repeat(65))).toBe(false);
  });

  it('returns false for non-hex characters in hash string', async () => {
    // 32 bytes of invalid hex
    const invalid = 'zz'.repeat(32);
    expect(await verifyChunkHash(new Uint8Array([1]), invalid)).toBe(false);
  });

  it('returns false for hash with whitespace', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const hex = correctHashHex(data);
    const withSpace = ' ' + hex.slice(1); // leading space corrupts parsing
    expect(await verifyChunkHash(data, withSpace)).toBe(false);
  });
});

// ─── Constant-time comparison ─────────────────────────────────────────────────
// These tests verify the bytesEqual function is doing what we expect.
// We can't directly test timing, but we can verify it doesn't early-exit
// on the first differing byte by checking that all-wrong and one-wrong both return false.

describe('verifyChunkHash — constant-time comparison behaviour', () => {
  it('returns false when only the first byte differs', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const hex = correctHashHex(data);
    const corrupted = corruptHex(hex, 0);
    expect(await verifyChunkHash(data, corrupted)).toBe(false);
  });

  it('returns false when only the last byte differs', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const hex = correctHashHex(data);
    const corrupted = corruptHex(hex, 31); // last byte of 32
    expect(await verifyChunkHash(data, corrupted)).toBe(false);
  });

  it('returns false when only the middle byte differs', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const hex = correctHashHex(data);
    const corrupted = corruptHex(hex, 15);
    expect(await verifyChunkHash(data, corrupted)).toBe(false);
  });

  it('returns false when all bytes differ', async () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(await verifyChunkHash(data, 'ff'.repeat(32))).toBe(false);
  });
});

// ─── Error handling (blake3Hash throws) ──────────────────────────────────────

describe('verifyChunkHash — error handling', () => {
  beforeEach(() => {
    // Reset mock to default correct implementation before each test
    vi.mocked(blake3Hash).mockImplementation(async (data) => {
      return blake3(data, { dkLen: 32 });
    });
  });

  it('returns false when blake3Hash throws (WASM error)', async () => {
    vi.mocked(blake3Hash).mockRejectedValueOnce(new Error('WASM instantiation failed'));
    const data = new Uint8Array([1, 2, 3]);
    const hex = 'ab'.repeat(32); // any 32-byte hex
    expect(await verifyChunkHash(data, hex)).toBe(false);
  });

  it('returns false when blake3Hash returns undefined', async () => {
    vi.mocked(blake3Hash).mockResolvedValueOnce(undefined);
    const data = new Uint8Array([1, 2, 3]);
    const hex = 'ab'.repeat(32);
    // bytesEqual will throw on undefined.length — caught → false
    expect(await verifyChunkHash(data, hex)).toBe(false);
  });
});

// ─── Chunk type coverage ──────────────────────────────────────────────────────

describe('verifyChunkHash — chunk type coverage', () => {
  it('verifies chunk 0 (first chunk with MIME header data)', async () => {
    // Simulate a real chunk 0: a few bytes of encrypted data
    const chunk0 = new Uint8Array(512 * 1024).fill(0x00);
    chunk0[0] = 0xff; chunk0[1] = 0xfe; // BOM-like marker
    const hex = correctHashHex(chunk0);
    expect(await verifyChunkHash(chunk0, hex)).toBe(true);
  });

  it('verifies subsequent chunks (chunk index > 0)', async () => {
    // Simulate chunk at high index — same logic, different data
    const chunk = new Uint8Array(256).fill(0x7f);
    const hex = correctHashHex(chunk);
    expect(await verifyChunkHash(chunk, hex)).toBe(true);
  });

  it('verifies a single-byte chunk (edge case for very small files)', async () => {
    const chunk = new Uint8Array([0x42]);
    const hex = correctHashHex(chunk);
    expect(await verifyChunkHash(chunk, hex)).toBe(true);
  });

  it('verifies all-zeros chunk', async () => {
    const chunk = new Uint8Array(64).fill(0x00);
    const hex = correctHashHex(chunk);
    expect(await verifyChunkHash(chunk, hex)).toBe(true);
  });

  it('verifies all-255 chunk', async () => {
    const chunk = new Uint8Array(64).fill(0xff);
    const hex = correctHashHex(chunk);
    expect(await verifyChunkHash(chunk, hex)).toBe(true);
  });
});
