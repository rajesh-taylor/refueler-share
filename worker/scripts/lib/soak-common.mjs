// worker/scripts/lib/soak-common.mjs  (Share-Soak-4)
//
// Shared by soak-headless.mjs and soak-download.mjs:
//   - the browser's own part-key and link-v2 code (frontend/crypto.js,
//     fragment.js, config.js), imported as-is, never copied
//   - a known-answer self-test against worker/test/part-crypto.test.js
//   - the deterministic soak plaintext generator
//   - BLAKE3 (the Worker's vendored WASM) and the rfc6962-unbalanced-blake3-v1 tree
//
// Node prints MODULE_TYPELESS_PACKAGE_JSON once when it loads the frontend
// modules (the repo root package.json has no "type"); run with
// --disable-warning=MODULE_TYPELESS_PACKAGE_JSON to hide it. Harmless.

import { blake3 } from '@noble/hashes/blake3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// ─── Browser modules (the same files refueler.io/share/ serves) ────────────
const FRONTEND = new URL('../../../frontend/', import.meta.url);
export const { derivePartKey, encryptPart, decryptPart } = await import(new URL('crypto.js', FRONTEND).href);
export const { assembleFragment, parseFragment }         = await import(new URL('fragment.js', FRONTEND).href);
export const { CHUNK_SIZE }                              = await import(new URL('config.js', FRONTEND).href);
export const TAG_BYTES = 16;

// ─── WASM BLAKE3 (Node instantiation of the Worker's vendored bundle) ──────
const WASM_DIR = new URL('../../blake3-wasm/', import.meta.url);
const bg = await import(new URL('blake3_wasm_bg.js', WASM_DIR).href);
bg.__wbg_set_wasm(new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(new URL('blake3_wasm_bg.wasm', WASM_DIR))),
  { './blake3_wasm_bg.js': { __wbindgen_init_externref_table: bg.__wbindgen_init_externref_table } },
).exports);
export const hashChunk = (u8) => bg.hash(u8);

// ─── Encoding helpers ─────────────────────────────────────────────────────
export const hex = u8 => Buffer.from(u8).toString('hex');
export const b64url = u8 => Buffer.from(u8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
export const b64urlDecode = s => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

// ─── Merkle (rfc6962-unbalanced-blake3-v1) — leaves are ciphertext digests ─
export function buildMerkleRoot(leaves) {
  let nodes = leaves.map(d => { const b = new Uint8Array(33); b[0] = 0x00; b.set(d, 1); return blake3(b); });
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 < nodes.length) {
        const b = new Uint8Array(65); b[0] = 0x01; b.set(nodes[i], 1); b.set(nodes[i + 1], 33);
        next.push(blake3(b));
      } else next.push(nodes[i]);
    }
    nodes = next;
  }
  return nodes[0];
}

// ─── Soak plaintext ───────────────────────────────────────────────────────
// Part i = SHAKE256(utf8("refueler.share.soak.plain.v1") ‖ 0x00 ‖ seed(16) ‖ BE32(i)),
// output length = the part's plaintext length. Test data only — a generator,
// not a cipher. The seed travels in the link's filename so a link is self-contained.
const PLAIN_TAG = Buffer.from('refueler.share.soak.plain.v1\0', 'utf8');
export const SOAK_NAME_RE = /^refueler-soak-([0-9a-f]{32})\.bin$/;
export const soakName = seed => `refueler-soak-${hex(seed)}.bin`;

export function soakPlain(seed, i, len) {
  const idx = Buffer.alloc(4); idx.writeUInt32BE(i);
  return new Uint8Array(createHash('shake256', { outputLength: len })
    .update(PLAIN_TAG).update(seed).update(idx).digest());
}

export const partCount = z => Math.ceil(z / CHUNK_SIZE);
export const plainLen  = (z, i) => (i === partCount(z) - 1 ? z - i * CHUNK_SIZE : CHUNK_SIZE);

// SHA-256 of the whole soak plaintext, generated in order.
export function soakPlainSha256(seed, z) {
  const h = createHash('sha256');
  for (let i = 0; i < partCount(z); i++) h.update(soakPlain(seed, i, plainLen(z, i)));
  return h.digest('hex');
}

// ─── Known-answer self-test (vectors from worker/test/part-crypto.test.js) ─
// Refuse to run if the browser's code no longer gives the locked answers.
export async function selfTest() {
  const K = Uint8Array.from({ length: 32 }, (_, i) => i);
  const T2 = '88b66ec651266c7222c3d1da3f5d544d85688199515e75129211588dc55681e47c833567470c';
  const T4 = 'eyJ2IjoyLCJrIjoiQUFFQ0F3UUZCZ2NJQ1FvTERBME9EeEFSRWhNVUZSWVhHQmthR3h3ZEhoOCIsIm4iOiJ0ZXN0LmJpbiIsInoiOjMzNTU0NDU1fQ';
  const pt = new TextEncoder().encode('refueler share v2 tail');
  const ct = await encryptPart(await derivePartKey(K, ['encrypt']), pt, 0, 1);
  if (hex(ct) !== T2) throw new Error('self-test: encryptPart ≠ KAT T2');
  const back = new Uint8Array(await decryptPart(await derivePartKey(K, ['decrypt']), ct, 0, 1));
  if (Buffer.compare(Buffer.from(back), Buffer.from(pt)) !== 0) throw new Error('self-test: decryptPart round trip');
  if (assembleFragment({ keyBytes: K, filename: 'test.bin', sizeBytes: 33554455 }) !== T4) throw new Error('self-test: assembleFragment ≠ KAT T4');
  const f = parseFragment(T4);
  if (f.v !== 2 || hex(f.keyBytes) !== hex(K) || f.sizeBytes !== 33554455) throw new Error('self-test: parseFragment(T4)');
  if (CHUNK_SIZE !== 33554432) throw new Error('self-test: CHUNK_SIZE ≠ 32 MiB');
  if (hashChunk(new TextEncoder().encode('abc')).length !== 32 ||
      hex(hashChunk(new TextEncoder().encode('abc'))) !== '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85')
    throw new Error('self-test: BLAKE3("abc")');
}
