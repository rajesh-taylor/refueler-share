// worker/src/merkle.js
// B9-1 — refueler-share ciphertext-chunk Merkle tree.
// RFC 6962 unbalanced, domain-separated (0x00 leaf / 0x01 node), BLAKE3 node hash.
// Pure functions, no side effects, no Worker imports. Import-safe: nothing runs on load.
// Client (upload) mints the authoritative root; Worker (download) reconstructs and compares.

import { blake3 } from '../node_modules/@noble/hashes/blake3.js';

// Pinned. Any change is a NEW version string, never an in-place edit.
export const TREE_ALGO = 'rfc6962-unbalanced-blake3-v1';

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;
const DIGEST_LEN = 32;

// leaf_hash = BLAKE3(0x00 ‖ chunk_ciphertext_digest_i)
function leafHash(digest) {
  const buf = new Uint8Array(1 + DIGEST_LEN);
  buf[0] = LEAF_PREFIX;
  buf.set(digest, 1);
  return blake3(buf);
}

// node_hash = BLAKE3(0x01 ‖ left ‖ right)
function nodeHash(left, right) {
  const buf = new Uint8Array(1 + DIGEST_LEN + DIGEST_LEN);
  buf[0] = NODE_PREFIX;
  buf.set(left, 1);
  buf.set(right, 1 + DIGEST_LEN);
  return blake3(buf);
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
// Worker download-path entry point. Delegates to buildMerkleTree so the two
// exports can never drift: the reconstructed root is the built root, by construction.
export function reconstructRoot(leafHashes) {
  return buildMerkleTree(leafHashes).root;
}

// ---------------------------------------------------------------------------
// Inline test vectors (N = 1, 2, 3-odd, 4). Self-contained and deterministic:
// test leaf i = BLAKE3(utf8("refueler-share/merkle/v1 leaf " + i)), so a third
// party reproduces every expected root from this file alone. Nothing here runs
// on import — call selfTest() explicitly (see footer command in the session notes).
const _enc = new TextEncoder();
function _testLeaf(i) {
  return blake3(_enc.encode('refueler-share/merkle/v1 leaf ' + i));
}
function _toHex(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
  return s;
}

export const TEST_VECTORS = {
  algo: TREE_ALGO,
  // N -> expected root hex over test leaves [0 .. N-1]
  1: '4cd7f5f299a2b771456696c501cf2b8f81be7b8f7c2bf1e2a788bddf3f0a50a8',
  2: '8b17cfc93a3cd63287d3a7392c7de27e4b81709e721f77ef8045deee80308b42',
  3: '10ea1b69823bb8b87b541fe6530cc24589201887ba520896ab317f795b5a3ea1',
  4: 'a9b25513176fc8eb9ee938569ba8c75b1bd7078cb5ac45b77bce9c09a998e7a7',
};

export function selfTest() {
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
    if (expected !== 'REPLACE_N' + n && expected !== rootHex) {
      throw new Error('N=' + n + ': root ' + rootHex + ' != pinned ' + expected);
    }
    results.push({ n, root: rootHex, layers: layers.length });
  }
  return results;
}
