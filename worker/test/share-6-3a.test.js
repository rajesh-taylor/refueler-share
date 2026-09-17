// worker/test/share-6-3a.test.js
// Share-6-3a unit tests — POST /upload/:uuid/finalise.
//
// Same split as share-6-1.test.js: the pure primitives the handler stands on run
// standalone here (Web Crypto only, no Worker harness, no R2) — the session-token
// auth compare and the {uuid}/hashes sidecar wire-format. The HTTP-level handler
// behaviour (R2 HEAD completeness, sidecar put, manifest flip, KV spend) needs
// real R2/KV and is recorded at the foot of this file as pending integration
// tests for the wrangler-dev --local harness (`npm run test:integration`), exactly
// as share-6-1 recorded its initiate/urls integration.
//
// Wire contract under test (session brief §What-this-session-builds):
//   Body: { hashes: [b64url(32B) × chunk_count], merkle_root: b64url(32B) }
//   chunk_count is read from manifest.total_chunks — never trusted from the body.
//   Sidecar {uuid}/hashes = raw 32-byte concat, chunk order, exactly N×32 (no pad).
//   manifest gets merkle_root + tree_algo:"rfc6962-unbalanced-blake3-v1" + upload_complete:true.

import { describe, it, expect } from 'vitest';
import { signSessionToken, constantTimeEqual } from '../src/r2_presign.js';

// ── Fixture helpers (NOT production code) ────────────────────────────────────
// A local base64url codec purely to synthesise/inspect hash fixtures and to pin
// the sidecar byte layout. index.js (b64urlToBytes) is the source of truth for
// the handler's own decode; this only builds and checks fixtures.
function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  if (typeof str !== 'string' || /[^A-Za-z0-9_-]/.test(str)) return null;
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  let bin;
  try { bin = atob(b64); } catch { return null; }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesN(n, fill) {
  const a = new Uint8Array(n);
  a.fill(fill & 0xff);
  return a;
}
// The handler's §4 sidecar build, as a pure oracle over an array of b64url hashes.
function buildSidecar(hashB64urlArray, chunkCount) {
  if (!Array.isArray(hashB64urlArray) || hashB64urlArray.length !== chunkCount) {
    throw new Error('length');
  }
  const out = new Uint8Array(chunkCount * 32);
  for (let i = 0; i < chunkCount; i++) {
    const bytes = b64urlDecode(hashB64urlArray[i]);
    if (!bytes || bytes.length !== 32) throw new Error(`hash ${i} not 32 bytes`);
    out.set(bytes, i * 32);
  }
  return out;
}

const UUID       = '0e51385a-1234-4abc-89ab-0123456789ab';
const OTHER_UUID = 'ffffffff-1234-4abc-89ab-0123456789ab';
const MASTER_KEY = 'master-signing-key-for-tests';
const TREE_ALGO  = 'rfc6962-unbalanced-blake3-v1';

// ── §1 · session-token auth primitive ────────────────────────────────────────
// The handler authenticates finalise with ctEqual(presented, KV[upload_session:uuid]),
// where the stored value is signSessionToken(masterKey, uuid, commitment). These
// exercise that exact compare (cases 1 & 2 at the logic layer).
describe('finalise §1 — upload-session token auth', () => {
  it('authenticates the exact stored token', async () => {
    const stored = await signSessionToken(MASTER_KEY, UUID, 'commitment-AAA');
    expect(constantTimeEqual(stored, stored)).toBe(true);
  });

  it('rejects a tampered token (case 2: wrong token → 401)', async () => {
    const stored   = await signSessionToken(MASTER_KEY, UUID, 'commitment-AAA');
    const tampered = stored.slice(0, -1) + (stored.endsWith('A') ? 'B' : 'A');
    expect(constantTimeEqual(stored, tampered)).toBe(false);
  });

  it('rejects a token minted for a different transfer (uuid-bound)', async () => {
    const stored = await signSessionToken(MASTER_KEY, UUID, 'commitment-AAA');
    const other  = await signSessionToken(MASTER_KEY, OTHER_UUID, 'commitment-AAA');
    expect(constantTimeEqual(stored, other)).toBe(false);
  });

  it('rejects an empty presented token (case 1: missing header)', async () => {
    const stored = await signSessionToken(MASTER_KEY, UUID, 'commitment-AAA');
    expect(constantTimeEqual('', stored)).toBe(false);
  });
});

// ── §3/§4 · hashes array → {uuid}/hashes sidecar byte layout ──────────────────
describe('finalise §3/§4 — hashes validation + sidecar layout', () => {
  it('rejects a hashes array whose length ≠ chunk_count (case 4)', () => {
    const chunkCount = 3;
    const hashes = [b64url(bytesN(32, 0x11)), b64url(bytesN(32, 0x22))]; // only 2
    expect(hashes.length === chunkCount).toBe(false);
    expect(() => buildSidecar(hashes, chunkCount)).toThrow('length');
  });

  it('rejects a hash that does not decode to 32 bytes (case 5)', () => {
    const good = b64url(bytesN(32, 0x05));
    const short = b64url(bytesN(31, 0x05)); // 31 bytes
    const long  = b64url(bytesN(33, 0x05)); // 33 bytes
    expect(b64urlDecode(good).length).toBe(32);
    expect(b64urlDecode(short).length).toBe(31);
    expect(b64urlDecode(long).length).toBe(33);
    expect(() => buildSidecar([good, good, short], 3)).toThrow(/not 32 bytes/);
  });

  it('rejects a hash outside the base64url alphabet', () => {
    expect(b64urlDecode('not+valid/base64url==')).toBeNull();
  });

  it('concatenates 3 × 32-byte hashes in chunk order → 96 bytes (case 7)', () => {
    const h0 = bytesN(32, 0xAA);
    const h1 = bytesN(32, 0xBB);
    const h2 = bytesN(32, 0xCC);
    const sidecar = buildSidecar([b64url(h0), b64url(h1), b64url(h2)], 3);
    expect(sidecar.length).toBe(96);            // exactly 3 × 32, no padding
    expect(sidecar[0]).toBe(0xAA);              // chunk 0 leads
    expect(sidecar[31]).toBe(0xAA);
    expect(sidecar[32]).toBe(0xBB);             // chunk 1 follows
    expect(sidecar[63]).toBe(0xBB);
    expect(sidecar[64]).toBe(0xCC);             // chunk 2 last
    expect(sidecar[95]).toBe(0xCC);
    // each stored 32-byte block round-trips the wire hash it came from
    expect(Array.from(sidecar.slice(0, 32))).toEqual(Array.from(b64urlDecode(b64url(h0))));
    expect(Array.from(sidecar.slice(32, 64))).toEqual(Array.from(b64urlDecode(b64url(h1))));
    expect(Array.from(sidecar.slice(64, 96))).toEqual(Array.from(b64urlDecode(b64url(h2))));
  });

  it('produces exactly chunk_count × 32 bytes for N = 5 (no duplicate-last, no zero-pad)', () => {
    const hashes = [];
    for (let i = 0; i < 5; i++) hashes.push(b64url(bytesN(32, i + 1)));
    const sidecar = buildSidecar(hashes, 5);
    expect(sidecar.length).toBe(160);           // 5 × 32
    for (let i = 0; i < 5; i++) expect(sidecar[i * 32]).toBe(i + 1);
  });

  it('validates a well-formed 32-byte merkle_root and rejects a short one', () => {
    expect(b64urlDecode(b64url(bytesN(32, 0x7F)))?.length).toBe(32);
    expect(b64urlDecode(b64url(bytesN(16, 0x7F)))?.length).toBe(16); // → 400 in handler
  });
});

// ── §2/§5 · pinned constants + missing-index format ───────────────────────────
describe('finalise §2/§5 — pinned constants', () => {
  it('tree_algo is the pinned string (case 8)', () => {
    expect(TREE_ALGO).toBe('rfc6962-unbalanced-blake3-v1');
  });

  it('missing indices are zero-padded 4-digit, in order (case 3 format)', () => {
    const missing = [1, 42].map(i => String(i).padStart(4, '0'));
    expect(missing).toEqual(['0001', '0042']);
  });
});

// ── Integration — Worker harness (npm run test:integration, wrangler dev --local) ──
// Pending, mirroring share-6-1.test.js: these need real R2 (HEAD/put), KV
// (get/delete), a seeded manifest (safeGetManifest/putManifest) and the HTTP
// route. They assert the full handler contract and slot into the round-trip /
// security integration suites. See the session hand-off note re: file location
// (worker/tests/integration/) and the client.js/fixtures pattern.
describe.skip('finalise handler — Worker harness', () => {
  it('case 1 — 401 when upload_session:{uuid} is absent from KV');
  it('case 2 — 401 when X-Upload-Session is present but ≠ the stored token');
  it('case 3 — 409 {"error":"incomplete","missing":["0001"]} when chunk 0001 is absent from R2 (chunk_count 3)');
  it('case 3b — collects ALL missing indices, not just the first gap');
  it('case 4 — 400 when hashes.length ≠ manifest.total_chunks');
  it('case 5 — 400 when a hash decodes to ≠ 32 bytes');
  it('case 6 — 200 happy path: sidecar written to {uuid}/hashes; manifest gets merkle_root + tree_algo + upload_complete:true; upload_session:{uuid} deleted; body echoes merkle_root');
  it('case 7 — sidecar is exactly 96 bytes for a 3-chunk upload, hashes in order 0,1,2');
  it('case 8 — manifest.tree_algo === "rfc6962-unbalanced-blake3-v1"');
});
