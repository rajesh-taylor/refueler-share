// worker/test/share-6-5d.test.js
// Share-6-5d — WASM BLAKE3 swap on the verified download path.
//
// Share-6-5e: now runs inside workerd via @cloudflare/vitest-pool-workers.
// wrangler.toml [[rules]] CompiledWasm makes src/blake3_wasm.js importable
// exactly as production, so the fs-based workaround from 6-5d is dropped:
//   - no node:fs / readFileSync
//   - no manual WebAssembly.Instance creation
//   - no inline copies of hashOneShot / verifyChunkBody
// All assertions and pinned digests are byte-identical to the 6-5d originals.
//
// GATE (session brief, acceptance §2): WASM == noble byte-for-byte on empty,
// small, and a real 32 MiB input, PLUS a standard BLAKE3 vector. If any fail the
// port is wrong and every verified download would 409 — fix the code, never the
// assertions. Pinned digests are third-party reproducible: empty/"abc" are the
// official BLAKE3 vectors; the 32 MiB digest is over byte[i] = (i*31 + 7) & 0xff.

import { describe, it, expect } from 'vitest';
import { hashOneShot } from '../src/blake3_wasm.js';
import { verifyChunkBody } from '../src/handlers/download_verify.js';

// Same pinned noble the verify path used before 6-5d, reached by the same file
// path merkle.js uses (noble v1 under CDK 0.17.2 exports ./blake3, not ./blake3.js;
// the file path bypasses the exports map — import-path invariant).
import { blake3 } from '../node_modules/@noble/hashes/blake3.js';

const DIGEST_LEN = 32;
const enc = new TextEncoder();

function toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

function make32MiB() {
  const n = 32 * 1024 * 1024;
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('Share-6-5d — WASM BLAKE3 hashOneShot (via src/blake3_wasm.js)', () => {
  it('reproduces the standard BLAKE3 vectors (empty, "abc")', () => {
    expect(toHex(hashOneShot(new Uint8Array(0)))).toBe(
      'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'
    );
    expect(toHex(hashOneShot(enc.encode('abc')))).toBe(
      '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85'
    );
  });

  it('returns a fresh 32-byte owned copy each call (no aliasing of wasm heap)', () => {
    const a = hashOneShot(enc.encode('first input'));
    const b = hashOneShot(enc.encode('second, different input'));
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(DIGEST_LEN);
    expect(toHex(a)).toBe(toHex(blake3(enc.encode('first input'))));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it('is byte-for-byte identical to pinned noble v1 (empty, small)', () => {
    for (const input of [new Uint8Array(0), enc.encode('refueler-share ciphertext chunk leaf')]) {
      expect(toHex(hashOneShot(input))).toBe(toHex(blake3(input)));
    }
  });

  it('is byte-for-byte identical to pinned noble v1 on a real 32 MiB chunk', () => {
    const big = make32MiB();
    const wasmHex = toHex(hashOneShot(big));
    expect(wasmHex).toBe(toHex(blake3(big)));
    expect(wasmHex).toBe(
      '04d09456cdd4e2a8b722124b554e7a4143e82906efe2866881a46f009c56a113'
    );
  });
});

describe('Share-6-5d — verifyChunkBody uses the WASM digest, semantics unchanged', () => {
  function sidecarWith(index, digest, total) {
    const sc = new Uint8Array(total * DIGEST_LEN);
    sc.set(digest, index * DIGEST_LEN);
    return sc;
  }

  it('accepts a chunk whose stored bytes match sidecar[i] (WASM == noble sidecar)', () => {
    const body = enc.encode('a stored ciphertext chunk (ciphertext ‖ GCM tag)');
    const sidecar = sidecarWith(2, blake3(body), 4);
    expect(verifyChunkBody(body, sidecar, 2)).toBe(true);
  });

  it('rejects a single flipped body byte', () => {
    const body = enc.encode('a stored ciphertext chunk (ciphertext ‖ GCM tag)');
    const sidecar = sidecarWith(2, blake3(body), 4);
    const tampered = body.slice();
    tampered[0] ^= 0x01;
    expect(verifyChunkBody(tampered, sidecar, 2)).toBe(false);
  });

  it('rejects a correct body checked against the wrong sidecar index', () => {
    const body = enc.encode('a stored ciphertext chunk (ciphertext ‖ GCM tag)');
    const sidecar = sidecarWith(2, blake3(body), 4);
    expect(verifyChunkBody(body, sidecar, 0)).toBe(false);
  });

  it('agrees with noble on a 32 MiB chunk inside verifyChunkBody', () => {
    const big = make32MiB();
    const sidecar = sidecarWith(0, blake3(big), 1);
    expect(verifyChunkBody(big, sidecar, 0)).toBe(true);
  });
});
