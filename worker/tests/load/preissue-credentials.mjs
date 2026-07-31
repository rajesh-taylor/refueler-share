/**
 * preissue-credentials.mjs
 *
 * Pre-issues credentials for concurrent-transfers.js k6 load test.
 * Run this BEFORE k6 — it does the BDHKE crypto that k6 cannot perform.
 *
 * Usage:
 *   node /Users/rajeshtaylor/Documents/refueler-share/worker/tests/load/preissue-credentials.mjs
 *
 * Output:
 *   worker/tests/load/credentials.json  — array of { uuid, credentialHeader, commitment, issued_tier }
 *
 * Requires wrangler dev --local --port 8787 to be running first.
 * Issues 55 credentials (50 VUs + 5 buffer for any rate-limit losses).
 * Each credential is single-use — re-run this script between k6 runs.
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, bytesToHex } from '@noble/hashes/utils';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE_URL    = process.env.WORKER_BASE_URL ?? 'http://127.0.0.1:8787';
const COUNT       = 55;   // 50 VUs + 5 buffer
const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'credentials.json');

// ── NUT-00 primitives (mirrors client.js exactly) ────────────────────────────

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
  const secret        = secp.utils.randomPrivateKey();
  const r             = secp.utils.randomPrivateKey();
  const Y             = hashToCurve(secret);
  const rG            = secp.ProjectivePoint.BASE.multiply(secp.utils.normPrivateKeyToScalar(r));
  const B_            = Y.add(rG);
  return { blindedMessageHex: B_.toHex(true), blindingFactor: r };
}

function unblindSignature(signedPointHex, blindingFactor, mintPubkeyHex) {
  const C_ = secp.ProjectivePoint.fromHex(signedPointHex);
  const K  = secp.ProjectivePoint.fromHex(mintPubkeyHex);
  const rK = K.multiply(secp.utils.normPrivateKeyToScalar(blindingFactor));
  return C_.add(rK.negate()).toHex(true);
}

// ── Issue one credential via the Worker ──────────────────────────────────────

async function issueOne(index) {
  const { blindedMessageHex, blindingFactor } = generateBlindedMessage();
  const turnstileToken = `1x-preissue-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const res = await fetch(`${BASE_URL}/credential/issue`, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'CF-Connecting-IP': `10.0.${Math.floor(index / 256)}.${index % 256}`, // unique IP per credential
    },
    body: JSON.stringify({ turnstile_token: turnstileToken, blinded_message: blindedMessageHex }),
  });

  if (res.status === 429) {
    // Rate limited — return null, caller will skip
    console.warn(`  [${index}] 429 rate limited — will retry after window`);
    return null;
  }

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`[${index}] /credential/issue returned ${res.status}: ${body}`);
  }

  const body = await res.json();

  if (!body.signed_point || !body.mint_pubkey || !body.uuid) {
    throw new Error(`[${index}] Missing fields in response: ${JSON.stringify(body)}`);
  }

  const C = unblindSignature(body.signed_point, blindingFactor, body.mint_pubkey);

  return {
    uuid:             body.uuid,
    credentialHeader: JSON.stringify({ C, mint_pubkey: body.mint_pubkey }),
    commitment:       body.commitment   ?? '',
    issued_tier:      body.issued_tier  ?? 'free',
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Pre-issuing ${COUNT} credentials from ${BASE_URL}...`);
  console.log('Wrangler must be running on port 8787.');
  console.log('Each credential uses a unique CF-Connecting-IP to avoid rate limiting.\n');

  const credentials = [];
  const batchSize   = 10; // issue in batches to avoid hammering wrangler

  for (let i = 0; i < COUNT; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, COUNT); j++) {
      batch.push(issueOne(j));
    }
    const results = await Promise.all(batch);
    for (const cred of results) {
      if (cred) credentials.push(cred);
    }
    console.log(`  Issued ${Math.min(i + batchSize, COUNT)} / ${COUNT}...`);

    // Small pause between batches
    if (i + batchSize < COUNT) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (credentials.length < 50) {
    console.error(`\nOnly ${credentials.length} credentials issued — need at least 50 for 50 VUs.`);
    console.error('Re-run after 60s to let rate limit windows reset.');
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(credentials, null, 2));
  console.log(`\n✓ ${credentials.length} credentials written to ${OUTPUT_PATH}`);
  console.log('Run k6 now — credentials are single-use, do not delay.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
