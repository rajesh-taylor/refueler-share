/**
 * preload-transfers.mjs
 *
 * Uploads N complete transfers before running download-saturation.js and
 * mixed-realistic.js. Each transfer is public (no passphrase), so chunks
 * can be downloaded without a bearer token.
 *
 * Usage (four terminals — same startup order as concurrent-transfers):
 *   Terminal 1: node worker/tests/load/start-mock.mjs
 *               (wait for "Mock ready" message)
 *   Terminal 2: npx wrangler dev --local --port 8787
 *               (starts AFTER mock is ready)
 *   Terminal 3: node worker/tests/load/preissue-credentials.mjs
 *               node worker/tests/load/preload-transfers.mjs
 *   Terminal 4: k6 run worker/tests/load/download-saturation.js
 *               k6 run worker/tests/load/mixed-realistic.js
 *
 * Output:
 *   worker/tests/load/transfers.json — array of { uuid, chunkCount, totalBytes }
 *
 * Requires wrangler dev --local --port 8787 to be running first.
 * BLAKE3 hashes pre-computed to match chunks.js HASH_TABLE[524288].
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, bytesToHex } from '@noble/hashes/utils';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE_URL      = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:8787';
const TRANSFER_COUNT = parseInt(process.env.TRANSFER_COUNT ?? '20', 10);
const OUTPUT_PATH   = join(dirname(fileURLToPath(import.meta.url)), 'transfers.json');

const CHUNK_COUNT = 5;          // 5 chunks per transfer — enough to stress R2 without slowness
const CHUNK_SIZE  = 1024 * 512; // 512 KB — matches HASH_TABLE key
const TOTAL_BYTES = CHUNK_COUNT * CHUNK_SIZE;

// ── Pre-computed BLAKE3 hashes — mirrors concurrent-transfers.js (first 5) ────
// These must match chunks.js HASH_TABLE[524288]. Do not modify.

const PRECOMPUTED_HASHES = [
  '2f2a0bec89395b19c7b9f663e4d1eb271b40c899ec8fc71e53f6798e889866ea',
  '7d009094a9381a666df1e5e75a3df1d98b3d962ee0bcbc700a2be44e0ea7c295',
  'e0aa5142c41ccd93bb2b053b5b7672dd7a054477bca959d52ae44ce32b1416df',
  '15f03a5c91a6fe02c2f64406bd9525b34ee38d3a88e8527ea2532d17489e8ec0',
  'beced66f3e30945f4aff0c6a48cb6c0c87b40b87fea952320ae1c867903c89c7',
];

// ── NUT-00 primitives (mirrors preissue-credentials.mjs exactly) ──────────────

const DOMAIN_SEPARATOR = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_');

function hashToCurve(secretBytes) {
  const msgHash = sha256(concatBytes(DOMAIN_SEPARATOR, secretBytes));
  for (let counter = 0; counter < 0xffffffff; counter++) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, true);
    const hash = sha256(concatBytes(msgHash, counterBytes));
    const compressed = concatBytes(new Uint8Array([0x02]), hash);
    try {
      return secp.ProjectivePoint.fromHex(bytesToHex(compressed));
    } catch { continue; }
  }
  throw new Error('hash_to_curve: exhausted counter space');
}

function generateBlindedMessage() {
  const secret       = secp.utils.randomPrivateKey();
  const r            = secp.utils.randomPrivateKey();
  const Y            = hashToCurve(secret);
  const rG           = secp.ProjectivePoint.BASE.multiply(secp.utils.normPrivateKeyToScalar(r));
  const B_           = Y.add(rG);
  return { blindedMessageHex: B_.toHex(true), blindingFactor: r };
}

function unblindSignature(signedPointHex, blindingFactor, mintPubkeyHex) {
  const C_ = secp.ProjectivePoint.fromHex(signedPointHex);
  const K  = secp.ProjectivePoint.fromHex(mintPubkeyHex);
  const rK = K.multiply(secp.utils.normPrivateKeyToScalar(blindingFactor));
  return C_.add(rK.negate()).toHex(true);
}

// ── Deterministic chunk bytes (mirrors concurrent-transfers.js makeChunkBytes) ─

function makeChunkBytes(index) {
  const buf  = new Uint8Array(CHUNK_SIZE);
  let seed   = (index + 1) * 1_000_003;
  for (let i = 0; i < CHUNK_SIZE; i++) {
    seed   = (seed * 1_664_525 + 1_013_904_223) >>> 0;
    buf[i] = seed & 0xff;
  }
  return buf;
}

function padIndex(i) { return String(i).padStart(4, '0'); }

// ── Issue one credential ──────────────────────────────────────────────────────

async function issueCredential(transferIndex) {
  const { blindedMessageHex, blindingFactor } = generateBlindedMessage();
  const turnstileToken = `1x-preload-${transferIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const res = await fetch(`${BASE_URL}/credential/issue`, {
    method:  'POST',
    headers: {
      'Content-Type':     'application/json',
      'CF-Connecting-IP': `10.1.${Math.floor(transferIndex / 256)}.${transferIndex % 256}`,
    },
    body: JSON.stringify({ turnstile_token: turnstileToken, blinded_message: blindedMessageHex }),
  });

  if (res.status === 429) {
    // Wait out the rate limit window and retry once
    console.warn(`  [transfer ${transferIndex}] 429 on credential — waiting 65s for window reset...`);
    await new Promise(r => setTimeout(r, 65_000));
    return issueCredential(transferIndex);
  }

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`[transfer ${transferIndex}] /credential/issue returned ${res.status}: ${body}`);
  }

  const body = await res.json();
  const C    = unblindSignature(body.signed_point, blindingFactor, body.mint_pubkey);

  return {
    uuid:       body.uuid,
    credential: JSON.stringify({ C, mint_pubkey: body.mint_pubkey }),
    commitment: body.commitment  ?? '',
    tier:       body.issued_tier ?? 'free',
  };
}

// ── Upload one complete transfer ──────────────────────────────────────────────

async function uploadTransfer(transferIndex) {
  const cred        = await issueCredential(transferIndex);
  const { uuid }    = cred;
  const expiryTs    = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  const connectIp   = `10.2.${Math.floor(transferIndex / 256)}.${transferIndex % 256}`;

  for (let chunkIdx = 0; chunkIdx < CHUNK_COUNT; chunkIdx++) {
    const bytes = makeChunkBytes(chunkIdx);
    const hash  = PRECOMPUTED_HASHES[chunkIdx];

    const headers = {
      'Content-Type':            'application/octet-stream',
      'CF-Connecting-IP':        connectIp,
      'X-Blake3-Chunk-Hash':     hash,
      'X-Cashu-Credential':      cred.credential,
      'X-Credential-Commitment': cred.commitment,
      'X-Issued-Tier':           cred.tier,
      'X-Total-Chunks':          String(CHUNK_COUNT),
      'X-Total-Bytes':           String(TOTAL_BYTES),
    };

    if (chunkIdx === 0) {
      headers['X-Blake3-Root']      = PRECOMPUTED_HASHES[0];
      headers['X-Expiry-Timestamp'] = String(expiryTs);
    }

    const res = await fetch(`${BASE_URL}/upload/${uuid}/${padIndex(chunkIdx)}`, {
      method:  'PUT',
      headers,
      body:    bytes,
    });

    if (res.status !== 200) {
      const body = await res.text();
      throw new Error(`[transfer ${transferIndex}] chunk ${chunkIdx} returned ${res.status}: ${body}`);
    }
  }

  return { uuid, chunkCount: CHUNK_COUNT, totalBytes: TOTAL_BYTES };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Pre-loading ${TRANSFER_COUNT} transfers (${CHUNK_COUNT} chunks × ${CHUNK_SIZE / 1024}KB each)...`);
  console.log('Wrangler must be running on port 8787.\n');

  const transfers = [];
  // Sequential to avoid hammering wrangler with concurrent 512KB bodies
  for (let i = 0; i < TRANSFER_COUNT; i++) {
    process.stdout.write(`  Uploading transfer ${i + 1} / ${TRANSFER_COUNT}...`);
    try {
      const t = await uploadTransfer(i);
      transfers.push(t);
      process.stdout.write(` ✓ uuid=${t.uuid.slice(0, 8)}...\n`);
    } catch (err) {
      process.stdout.write(` ✗ FAILED: ${err.message}\n`);
      // Continue — partial transfers.json is still useful for load testing
    }

    // Small gap between transfers — not strictly necessary but keeps wrangler happy
    if (i < TRANSFER_COUNT - 1) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  if (transfers.length === 0) {
    console.error('\nNo transfers uploaded — aborting.');
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(transfers, null, 2));
  console.log(`\n✓ ${transfers.length} transfers written to ${OUTPUT_PATH}`);
  console.log('Run k6 now — each transfer has chunks available for download.');

  if (transfers.length < TRANSFER_COUNT) {
    console.warn(`  Warning: only ${transfers.length}/${TRANSFER_COUNT} succeeded.`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
