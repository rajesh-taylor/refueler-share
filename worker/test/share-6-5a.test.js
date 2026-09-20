// worker/test/share-6-5a.test.js
// Share-6-5a unit tests — Worker-side download verification (B9-3 server half).
//
// Same split as share-6-3a.test.js: the pure verification primitives run
// standalone here (Web Crypto + noble blake3 + the real merkle.js, no Worker
// harness, no live R2) — the sidecar-root reconstruction, the per-chunk body
// hash compare, and the per-manifest gate predicate. The HTTP-level handler
// behaviour (verified vs legacy fork, 416-on-Range, 409 wire body, mid-stream
// abort, AE log, no-auto-destroy) needs real R2/KV and the HTTP route, and is
// recorded at the foot of this file as pending integration tests for the
// wrangler-dev --local harness (`npm run test:integration`), exactly as
// share-6-3a recorded its finalise integration.
//
// Wire contract under test (session brief §Build this):
//   merkle-spec §3 steps 1–4 inside the download handler:
//     1. manifest → merkle_root, chunk_count (total_chunks), tree_algo
//     2. single GET {uuid}/hashes; byte-length ≠ chunk_count×32 → 409 integrity_failed
//     3. reconstruct root via merkle.js; ≠ manifest merkle_root → 409
//     4. verify-then-flush per chunk: BLAKE3 over EXACTLY the stored bytes
//        (ciphertext‖tag, no IV prepend), compare sidecar[i]; mismatch → 409
//   Gate: per-manifest upload_complete + merkle_root + pinned tree_algo (NOT global).
//   Pre-6-3 manifest (no merkle_root) → legacy serve, never 409.

import { describe, it, expect } from 'vitest';
import { blake3 } from '../node_modules/@noble/hashes/blake3.js';
import { buildMerkleTree, TREE_ALGO } from '../src/merkle.js';
import {
  isVerifiedPath,
  reconstructAndCheckRoot,
  verifyChunkBody,
  b64urlToBytes,
  ctEqualBytes,
  VERIFY_INLINE_CHUNK_THRESHOLD,
} from '../src/handlers/download_verify.js';

// ── Fixture helpers (NOT production code) ────────────────────────────────────
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Build N synthetic ciphertext chunks. Leaf digest = BLAKE3 over EXACTLY the
// stored bytes — the operative merkle-spec §1 clause, and exactly what
// verifyChunkBody recomputes. No IV prepend (the nonce trap): the stored object
// is ciphertext‖tag; here a deterministic body stands in for those bytes.
function makeTransfer(N) {
  const chunkBytes = [];
  const leafDigests = [];
  for (let i = 0; i < N; i++) {
    const body = new Uint8Array(64).fill((i * 7 + 1) & 0xff);
    chunkBytes.push(body);
    leafDigests.push(blake3(body));
  }
  const { root } = buildMerkleTree(leafDigests);
  const sidecar = new Uint8Array(N * 32);
  leafDigests.forEach((d, i) => sidecar.set(d, i * 32));
  return { chunkBytes, leafDigests, root, sidecar };
}

// Minimal R2 mock — only .get(key) is exercised by reconstructAndCheckRoot.
// Returns an object exposing arrayBuffer() (used by the root check).
function mockEnv(uuid, { sidecar, dropSidecar, corruptSidecar } = {}) {
  const store = new Map();
  const put = corruptSidecar || sidecar;
  if (!dropSidecar) store.set(`${uuid}/hashes`, put);
  return {
    BUCKET: {
      async get(key) {
        const v = store.get(key);
        if (!v) return null;
        return {
          async arrayBuffer() {
            return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
          },
          size: v.length,
        };
      },
    },
  };
}

const UUID       = 'c4a5fbc4-6935-404c-a0b7-c8195b5e8ef1'; // the live 6-3d verification UUID
const OTHER_ROOT = b64url(new Uint8Array(32).fill(0x99));

// ── §1 · gate predicate (per-manifest, not global) ───────────────────────────
describe('6-5a §gate — isVerifiedPath', () => {
  it('finalised 6-3 manifest (merkle_root + pinned tree_algo + upload_complete) → verified', () => {
    expect(isVerifiedPath({
      upload_complete: true,
      merkle_root: 'AUQYQV2CCMjbqV8Fyfx-5bnh1Gah5PluRkzXHN944Ys',
      tree_algo: TREE_ALGO,
    })).toBe(true);
  });

  it('pre-6-3 manifest (no merkle_root) → legacy (false) — must NOT 409 a pre-sidecar file', () => {
    expect(isVerifiedPath({ upload_complete: true })).toBe(false);
    expect(isVerifiedPath({ upload_complete: true, blake3_root: 'deadbeef' })).toBe(false);
  });

  it('upload_complete false → legacy (finalise not done)', () => {
    expect(isVerifiedPath({ upload_complete: false, merkle_root: 'x', tree_algo: TREE_ALGO })).toBe(false);
  });

  it('wrong / unpinned tree_algo → legacy', () => {
    expect(isVerifiedPath({ upload_complete: true, merkle_root: 'x', tree_algo: 'some-other-v2' })).toBe(false);
  });

  it('empty merkle_root string → legacy', () => {
    expect(isVerifiedPath({ upload_complete: true, merkle_root: '', tree_algo: TREE_ALGO })).toBe(false);
  });
});

// ── §2 · b64url + constant-time compare primitives ───────────────────────────
describe('6-5a §primitives — b64urlToBytes / ctEqualBytes', () => {
  it('decodes a 32-byte b64url root', () => {
    const bytes = new Uint8Array(32).fill(0x41);
    expect(b64urlToBytes(b64url(bytes))?.length).toBe(32);
  });
  it('rejects non-base64url input', () => {
    expect(b64urlToBytes('not+valid/base64==')).toBeNull();
    expect(b64urlToBytes('')).toBeNull();
  });
  it('ctEqualBytes: equal arrays true, single-bit diff false, length diff false', () => {
    const a = new Uint8Array(32).fill(7);
    const b = new Uint8Array(32).fill(7);
    const c = new Uint8Array(32).fill(7); c[31] ^= 0x01;
    expect(ctEqualBytes(a, b)).toBe(true);
    expect(ctEqualBytes(a, c)).toBe(false);
    expect(ctEqualBytes(a, new Uint8Array(31).fill(7))).toBe(false);
  });
});

// ── §3 · golden path — reconstruct-and-serve (N = 1, 4, 128) ─────────────────
describe('6-5a §3 — golden path reconstruct + body verify', () => {
  for (const N of [1, 4, 128]) {
    it(`N=${N}: sidecar root reconstructs, matches manifest, every body verifies`, async () => {
      const t = makeTransfer(N);
      const manifest = {
        total_chunks: N,
        merkle_root: b64url(t.root),
        tree_algo: TREE_ALGO,
        upload_complete: true,
      };
      const env = mockEnv(UUID, { sidecar: t.sidecar });

      const rc = await reconstructAndCheckRoot(env, UUID, manifest);
      expect(rc.ok).toBe(true);
      expect(rc.chunkCount).toBe(N);

      // step 4 — every chunk body verifies against sidecar[i]
      for (let i = 0; i < N; i++) {
        expect(verifyChunkBody(t.chunkBytes[i], rc.sidecar, i)).toBe(true);
      }
    });
  }
});

// ── §4 · sidecar length-mismatch → 409 integrity_failed (step 2) ─────────────
describe('6-5a §2 — sidecar length mismatch', () => {
  it('sidecar byte-length ≠ chunk_count × 32 → integrity_failed', async () => {
    const t = makeTransfer(4);
    const manifest = { total_chunks: 4, merkle_root: b64url(t.root), tree_algo: TREE_ALGO, upload_complete: true };
    const short = t.sidecar.slice(0, 3 * 32); // 96 bytes, manifest claims 4×32=128
    const env = mockEnv(UUID, { corruptSidecar: short });
    const rc = await reconstructAndCheckRoot(env, UUID, manifest);
    expect(rc.ok).toBe(false);
    expect(rc.code).toBe('integrity_failed');
  });

  it('sidecar missing entirely on a verified manifest → integrity_failed (NOT treated as legacy)', async () => {
    const t = makeTransfer(2);
    const manifest = { total_chunks: 2, merkle_root: b64url(t.root), tree_algo: TREE_ALGO, upload_complete: true };
    const env = mockEnv(UUID, { sidecar: t.sidecar, dropSidecar: true });
    const rc = await reconstructAndCheckRoot(env, UUID, manifest);
    expect(rc.ok).toBe(false);
    expect(rc.code).toBe('integrity_failed');
  });
});

// ── §5 · root-mismatch → 409 (step 3) ────────────────────────────────────────
describe('6-5a §3 — reconstructed root ≠ manifest root', () => {
  it('a corrupted sidecar leaf makes the root diverge → integrity_failed', async () => {
    const t = makeTransfer(4);
    const corrupt = t.sidecar.slice();
    corrupt[0] ^= 0xff; // flip a byte in leaf 0 → different reconstructed root
    const manifest = { total_chunks: 4, merkle_root: b64url(t.root), tree_algo: TREE_ALGO, upload_complete: true };
    const env = mockEnv(UUID, { corruptSidecar: corrupt });
    const rc = await reconstructAndCheckRoot(env, UUID, manifest);
    expect(rc.ok).toBe(false);
    expect(rc.code).toBe('integrity_failed');
  });

  it('a manifest root that decodes but is the wrong value → integrity_failed', async () => {
    const t = makeTransfer(4);
    const manifest = { total_chunks: 4, merkle_root: OTHER_ROOT, tree_algo: TREE_ALGO, upload_complete: true };
    const env = mockEnv(UUID, { sidecar: t.sidecar });
    const rc = await reconstructAndCheckRoot(env, UUID, manifest);
    expect(rc.ok).toBe(false);
    expect(rc.code).toBe('integrity_failed');
  });
});

// ── §6 · single-chunk body tamper at i (step 4) ──────────────────────────────
describe('6-5a §4 — verify-then-flush body tamper isolation', () => {
  it('tamper at chunk i fails verifyChunkBody; earlier chunks (already flushed) still verify', () => {
    const t = makeTransfer(4);
    const i = 2;
    const tampered = t.chunkBytes[i].slice();
    tampered[0] ^= 0x01; // one flipped bit in chunk 2's stored bytes

    // the tampered chunk is caught
    expect(verifyChunkBody(t.chunkBytes[i], t.sidecar, i)).toBe(true);   // control
    expect(verifyChunkBody(tampered,         t.sidecar, i)).toBe(false); // tamper caught

    // chunks 0 and 1 were flushed before i and remain valid; 3 is beyond the abort
    for (const j of [0, 1, 3]) {
      expect(verifyChunkBody(t.chunkBytes[j], t.sidecar, j)).toBe(true);
    }
  });

  it('a chunk verified against the WRONG index fails (order binding)', () => {
    const t = makeTransfer(4);
    // chunk 0's bytes checked against sidecar entry 1 → mismatch (leaf order binds)
    expect(verifyChunkBody(t.chunkBytes[0], t.sidecar, 1)).toBe(false);
  });
});

// ── §7 · pinned constants ────────────────────────────────────────────────────
describe('6-5a §pins', () => {
  it('tree_algo pin flows through from merkle.js', () => {
    expect(TREE_ALGO).toBe('rfc6962-unbalanced-blake3-v1');
  });
  it('hybrid threshold is the free-tier chunk ceiling (128)', () => {
    expect(VERIFY_INLINE_CHUNK_THRESHOLD).toBe(128);
  });
});

// ── Integration — Worker harness (npm run test:integration, wrangler dev --local) ──
// Pending, mirroring share-6-3a.test.js: these need real R2 (get/head/put), KV,
// a seeded manifest (safeGetManifest/putManifest), the /download HTTP route, and
// AE capture. They assert the full handler contract end-to-end.
describe.skip('download handler — Worker harness (6-5a)', () => {
  it('verified N=1: GET /download/{uuid}/0000 → 200, body served, X-Integrity: ciphertext-storage-verified');
  it('verified N=4: all four chunks serve 200 in order; last chunk emits cargo.discharged only if api_live_key');
  it('verified N=128: golden reconstruct-and-serve across all 128 chunk GETs');
  it('sidecar length-mismatch: GET → 409 {"error":"integrity_failed"}, no chunk body served');
  it('root-mismatch (manifest root ≠ reconstructed): GET → 409 {"error":"integrity_failed"}');
  it('single-chunk tamper at i (≤128): buffered path → 409 {"error":"integrity_failed","chunk":i}; chunks 0..i-1 already served 200; AE logged; R2 object NOT deleted');
  it('single-chunk tamper at i (>128): streamed path → connection truncates mid-body; AE logged; object NOT deleted');
  it('Range header on a verified transfer → 416 (no partial "verified" 206)');
  it('pre-6-3 manifest (no merkle_root): legacy serve → 200, NO sidecar read, NO 409, Range still 206');
  it('mismatch does NOT touch date-seal.ots.enc (deletion invariant separate)');
  it('no receipt gains verified:true in 6-5a (barred — 6-5b/B9-4)');
  it('live UUID c4a5fbc4-6935-404c-a0b7-c8195b5e8ef1 (1 chunk, free tier) serves through the verified path');
});
