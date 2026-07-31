/**
 * debug-single-upload.mjs
 * Reads credentials.json, attempts one chunk upload, prints full response.
 * Run: node worker/tests/load/debug-single-upload.mjs
 * Requires: wrangler dev --local --port 8787 running, credentials.json present.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const BASE_URL = 'http://127.0.0.1:8787';
const credsPath = join(dirname(fileURLToPath(import.meta.url)), 'credentials.json');
const credentials = JSON.parse(readFileSync(credsPath, 'utf8'));
const cred = credentials[0];

const CHUNK_SIZE = 1024 * 512;
const CHUNK_COUNT = 20;
const TOTAL_BYTES = CHUNK_COUNT * CHUNK_SIZE;
const PRECOMPUTED_HASH = '2f2a0bec89395b19c7b9f663e4d1eb271b40c899ec8fc71e53f6798e889866ea';

// Make chunk 0 bytes
const buf = new Uint8Array(CHUNK_SIZE);
let seed = 1 * 1_000_003;
for (let i = 0; i < CHUNK_SIZE; i++) {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  buf[i] = seed & 0xff;
}

const expiryTs = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

console.log('Credential:', JSON.stringify(cred, null, 2));
console.log('\nAttempting chunk 0 upload to UUID:', cred.uuid);

const res = await fetch(`${BASE_URL}/upload/${cred.uuid}/0000`, {
  method: 'PUT',
  headers: {
    'Content-Type':            'application/octet-stream',
    'CF-Connecting-IP':        '10.0.0.1',
    'X-Blake3-Chunk-Hash':           PRECOMPUTED_HASH,
    'X-Cashu-Credential':      cred.credentialHeader,
    'X-Credential-Commitment': cred.commitment,
    'X-Issued-Tier':           cred.issued_tier || 'free',
    'X-Total-Chunks':          String(CHUNK_COUNT),
    'X-Total-Bytes':           String(TOTAL_BYTES),
    'X-Blake3-Root':           PRECOMPUTED_HASH,
    'X-Expiry-Timestamp':      String(expiryTs),
  },
  body: buf,
});

const body = await res.text();
console.log('\nStatus:', res.status);
console.log('Response:', body);
