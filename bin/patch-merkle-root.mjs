#!/usr/bin/env node
// bin/patch-merkle-root.mjs
// Share-6-6a — patch the stored merkle_root for a transfer whose sidecar is
// correct but whose root was computed without the RFC 6962 0x00 leaf domain tag
// (i.e. uploaded via the pre-fix test harness).
//
// Reads {uuid}/hashes from R2, recomputes the correct root, and patches
// {uuid}/manifest.json in-place.
//
// Usage (from repo root):
//   node bin/patch-merkle-root.mjs <uuid>

import { execSync }                          from 'node:child_process';
import { writeFileSync, readFileSync,
         mkdirSync, rmSync }                 from 'node:fs';
import { tmpdir }                            from 'node:os';
import { join, dirname }                     from 'node:path';
import { fileURLToPath }                     from 'node:url';
import { blake3 }                            from '../worker/node_modules/@noble/hashes/blake3.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const WRANGLER   = join(__dirname, '../worker/node_modules/.bin/wrangler');
const WORKER_DIR = join(__dirname, '../worker');
const BUCKET     = 'refueler-share-prod';
const DIGEST_LEN = 32;

// ── Merkle algorithm — mirrors worker/src/merkle.js exactly ─────────────────
function leafHash(digest) {
  const buf = new Uint8Array(1 + DIGEST_LEN);
  buf[0] = 0x00;           // RFC 6962 leaf domain separation
  buf.set(digest, 1);
  return blake3(buf);
}

function nodeHash(left, right) {
  const buf = new Uint8Array(1 + DIGEST_LEN + DIGEST_LEN);
  buf[0] = 0x01;           // RFC 6962 node domain separation
  buf.set(left,  1);
  buf.set(right, 1 + DIGEST_LEN);
  return blake3(buf);
}

function reconstructRoot(rawDigests) {
  // rawDigests: Uint8Array(32)[] — raw per-chunk BLAKE3 ciphertext digests
  let nodes = rawDigests.map(d => leafHash(d));
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < nodes.length; i += 2) {
      next.push(nodeHash(nodes[i], nodes[i + 1]));
    }
    if (nodes.length % 2 === 1) next.push(nodes[nodes.length - 1]); // promote odd
    nodes = next;
  }
  return nodes[0];
}

function toB64url(u8) { return Buffer.from(u8).toString('base64url'); }

// ── main ─────────────────────────────────────────────────────────────────────
const uuid = process.argv[2];
if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) {
  console.error('Usage: node bin/patch-merkle-root.mjs <uuid>');
  process.exit(1);
}

const tmp = join(tmpdir(), `patch-root-${uuid}`);
mkdirSync(tmp, { recursive: true });

try {
  // 1. Download sidecar
  const sidecarKey   = `${uuid}/hashes`;
  const sidecarLocal = join(tmp, 'hashes.bin');
  console.log(`\n[1/5] Fetching sidecar: ${BUCKET}/${sidecarKey}`);
  execSync(`"${WRANGLER}" r2 object get "${BUCKET}/${sidecarKey}" --file "${sidecarLocal}" --remote`,
    { stdio: 'inherit', cwd: WORKER_DIR });

  const sidecarBuf = readFileSync(sidecarLocal);
  if (sidecarBuf.length % DIGEST_LEN !== 0) {
    console.error(`Sidecar length ${sidecarBuf.length} is not a multiple of 32`);
    process.exit(1);
  }
  const chunkCount = sidecarBuf.length / DIGEST_LEN;
  console.log(`       ${sidecarBuf.length} bytes → ${chunkCount} chunk digests`);

  // 2. Parse raw digests
  console.log('\n[2/5] Parsing digests');
  const digests = [];
  for (let i = 0; i < chunkCount; i++) {
    digests.push(new Uint8Array(sidecarBuf.buffer,
      sidecarBuf.byteOffset + i * DIGEST_LEN, DIGEST_LEN));
  }

  // 3. Recompute correct root
  console.log('\n[3/5] Reconstructing Merkle root (RFC 6962, 0x00 leaf domain tag)');
  const correctRoot      = reconstructRoot(digests);
  const correctRootB64   = toB64url(correctRoot);
  console.log(`       merkle_root = ${correctRootB64}`);

  // 4. Download manifest
  const manifestKey   = `${uuid}/manifest.json`;
  const manifestLocal = join(tmp, 'manifest.json');
  console.log(`\n[4/5] Fetching manifest: ${BUCKET}/${manifestKey}`);
  execSync(`"${WRANGLER}" r2 object get "${BUCKET}/${manifestKey}" --file "${manifestLocal}" --remote`,
    { stdio: 'inherit', cwd: WORKER_DIR });

  const manifest = JSON.parse(readFileSync(manifestLocal, 'utf8'));
  console.log(`       stored merkle_root = ${manifest.merkle_root}`);

  if (manifest.merkle_root === correctRootB64) {
    console.log('\n       Root already correct — no patch needed.');
    process.exit(0);
  }

  const oldRoot = manifest.merkle_root;
  manifest.merkle_root = correctRootB64;
  const patchedPath = join(tmp, 'manifest-patched.json');
  writeFileSync(patchedPath, JSON.stringify(manifest));

  // 5. Upload patched manifest
  console.log('\n[5/5] Uploading patched manifest');
  execSync(`"${WRANGLER}" r2 object put "${BUCKET}/${manifestKey}" --file "${patchedPath}" --content-type "application/json" --remote`,
    { stdio: 'inherit', cwd: WORKER_DIR });

  console.log(`\n✓  Manifest patched for ${uuid}`);
  console.log(`   old: ${oldRoot}`);
  console.log(`   new: ${correctRootB64}`);
  console.log('\n   Download-verify should now pass.\n');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
