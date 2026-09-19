// frontend/merkle.js
// Share-6-3c — browser twin of worker/src/merkle.js. B9-1 parity half.
// RFC 6962 unbalanced, domain-separated (0x00 leaf / 0x01 node), BLAKE3 node hash.
// Pure functions, no side effects, no imports run on load. type="module".
//
// PARITY IS THE ENTIRE POINT. This module must reproduce, byte-for-byte, the roots
// that worker/src/merkle.js produces from identical chunk digests. A one-byte
// divergence silently corrupts every merkle_root and surfaces only as a 409 wall at
// download (6-5a). The inline selfTest() below is a HARD gate against exactly that:
// four pinned vectors, identical to the Worker module. If any differs, the port is
// wrong — fix the code, never the vectors.
//
// BLAKE3 source: the SAME local WASM bundle the chunk-integrity path already uses,
// reached through crypto.js's blake3Hash(). No @noble in the browser bundle, no CDN
// fetch of blake3 (both are locked do-not-retry). Parity holds because both sides
// compute the standardised BLAKE3-256 digest: identical bytes in, identical root out —
// the same equivalence the upload chunk-hash path already relies on in production.
//
// PRECONDITION: crypto.js's loadDeps() must have been awaited before buildMerkleTree()
// or reconstructRoot() is called (the WASM must be initialised). The core functions
// stay synchronous to mirror the Worker exactly; upload.js already awaits loadDeps()
// on the chunk-hash path, so the wiring in 6-3d inherits the guarantee for free.
// selfTest() awaits loadDeps() itself, so it runs cold from the browser console.

import { blake3Hash, loadDeps } from './crypto.js';

// Pinned. Any change is a NEW version string, never an in-place edit.
export const TREE_ALGO = 'rfc6962-unbalanced-blake3-v1';

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;
const DIGEST_LEN = 32;

// BLAKE3-256 over a byte buffer, returned as a raw 32-byte Uint8Array.
// blake3Hash() returns hex from the WASM bundle; we widen it back to bytes so the
// tree operates on Uint8Array throughout, exactly as the Worker module does. Reusing
// blake3Hash() (not a second WASM instance) is what "the SAME browser BLAKE3" means.
function b3(buf) {
  return _hexToBytes(blake3Hash(buf));
}

// leaf_hash = BLAKE3(0x00 ‖ chunk_ciphertext_digest_i)
function leafHash(digest) {
  const buf = new Uint8Array(1 + DIGEST_LEN);
  buf[0] = LEAF_PREFIX;
  buf.set(digest, 1);
  return b3(buf);
}

// node_hash = BLAKE3(0x01 ‖ left ‖ right)
function nodeHash(left, right) {
  const buf = new Uint8Array(1 + DIGEST_LEN + DIGEST_LEN);
  buf[0] = NODE_PREFIX;
  buf.set(left, 1);
  buf.set(right, 1 + DIGEST_LEN);
  return b3(buf);
}

function assertLeaves(leafHashes) {
  if (!Array.isArray(leafHashes)) {
    throw new TypeError('merkle: leafHashes must be an array of Uint8Array');
  }
  if (leafHashes.length === 0) {
    // chunk_count is always >= 1; an empty tree has no committed root.
    throw new RangeError('merkle: leafHashes must be non-empty (chunk_count >= 1)');
  }
  for (let i = 0; i < leafHashes.length; i++) {
    const h = leafHashes[i];
    if (!(h instanceof Uint8Array) || h.length !== DIGEST_LEN) {
      throw new TypeError('merkle: leaf ' + i + ' must be a 32-byte Uint8Array');
    }
  }
}

// buildMerkleTree(leafHashes: Uint8Array[]) -> { root: Uint8Array, layers: Uint8Array[][] }
// leafHashes are the raw 32-byte per-chunk ciphertext digests, in big-endian chunk order.
// layers[0] is the domain-separated leaf layer; the final layer is [root].
export function buildMerkleTree(leafHashes) {
  assertLeaves(leafHashes);

  const leaves = new Array(leafHashes.length);
  for (let i = 0; i < leafHashes.length; i++) {
    leaves[i] = leafHash(leafHashes[i]);
  }

  const layers = [leaves];
  let current = leaves;

  // Fold pairwise. No padding: an odd tail node is promoted unchanged to the
  // next layer (RFC 6962 unbalanced). No duplicate-last-leaf (CVE-2012-2459),
  // no zero-pad. chunk_count in the manifest closes the residual ambiguity.
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < current.length; i += 2) {
      next.push(nodeHash(current[i], current[i + 1]));
    }
    if (current.length % 2 === 1) {
      next.push(current[current.length - 1]);
    }
    layers.push(next);
    current = next;
  }

  return { root: current[0], layers };
}

// reconstructRoot(leafHashes: Uint8Array[]) -> Uint8Array
// Download-path entry point. Delegates to buildMerkleTree so the two exports can
// never drift: the reconstructed root is the built root, by construction.
export function reconstructRoot(leafHashes) {
  return buildMerkleTree(leafHashes).root;
}

// ---------------------------------------------------------------------------
// Byte helpers (local — no coupling beyond the one digest function that matters)
// ---------------------------------------------------------------------------
function _hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function _toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

// ---------------------------------------------------------------------------
// Inline parity vectors (N = 1, 2, 3-odd, 4) — HARD pass/fail gate.
// Identical to worker/src/merkle.js. Deterministic test leaves:
//   test leaf i = BLAKE3(utf8("refueler-share/merkle/v1 leaf " + i))
// so a third party reproduces every expected root from this file alone. These four
// values are the shared parity contract with the Worker — NEVER edit them to match
// the code; a mismatch means the port is wrong.
const _enc = new TextEncoder();
function _testLeaf(i) {
  return b3(_enc.encode('refueler-share/merkle/v1 leaf ' + i));
}

export const TEST_VECTORS = {
  algo: TREE_ALGO,
  // N -> expected root hex over test leaves [0 .. N-1]
  1: '4cd7f5f299a2b771456696c501cf2b8f81be7b8f7c2bf1e2a788bddf3f0a50a8',
  2: '8b17cfc93a3cd63287d3a7392c7de27e4b81709e721f77ef8045deee80308b42',
  3: '10ea1b69823bb8b87b541fe6530cc24589201887ba520896ab317f795b5a3ea1',
  4: 'a9b25513176fc8eb9ee938569ba8c75b1bd7078cb5ac45b77bce9c09a998e7a7',
};

// selfTest() -> [{ n, root, layers }]  (throws on any parity failure)
// async: awaits loadDeps() so the WASM bundle is live, then runs the synchronous
// build. Runs from the browser console (wherever the module is served) and under
// Vitest if the WASM bundle loads in node.
export async function selfTest() {
  await loadDeps();

  const results = [];
  for (const n of [1, 2, 3, 4]) {
    const leaves = [];
    for (let i = 0; i < n; i++) leaves.push(_testLeaf(i));

    const { root, layers } = buildMerkleTree(leaves);
    const rootHex = _toHex(root);
    const reHex = _toHex(reconstructRoot(leaves));

    if (rootHex !== reHex) {
      throw new Error('N=' + n + ': buildMerkleTree/reconstructRoot disagree');
    }
    if (_toHex(layers[layers.length - 1][0]) !== rootHex) {
      throw new Error('N=' + n + ': top layer is not the root');
    }
    const expected = TEST_VECTORS[n];
    if (expected !== rootHex) {
      throw new Error(
        'N=' + n + ': root ' + rootHex + ' != pinned ' + expected +
        ' — PORT IS WRONG. Fix the code; do not touch the vectors.'
      );
    }
    results.push({ n, root: rootHex, layers: layers.length });
  }
  return results;
}
