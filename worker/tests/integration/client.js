/**
 * worker/tests/integration/client.js
 * Thin HTTP client helper. All methods return { status, headers, body }.
 * No assertions here — assertions belong in test files.
 * Pure ESM, no Vitest imports.
 *
 * BDHKE credential flow:
 *   1. Generate secret x and blinding factor r (random scalars)
 *   2. Compute B_ = hash_to_curve(x) + r*G  (blinded message)
 *   3. POST /credential/issue with B_ as blinded_message → { signed_point: C_, mint_pubkey: K, uuid, commitment, issued_tier }
 *   4. Unblind: C = C_ - r*K  (the unblinded credential point)
 *   5. Send { C, mint_pubkey } in X-Cashu-Credential header on upload
 */

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, hexToBytes, bytesToHex } from '@noble/hashes/utils';

// ── NUT-00 primitives (duplicated from nut00.js — no Worker imports in tests) ──

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
    } catch {
      continue;
    }
  }
  throw new Error('hash_to_curve: exhausted counter space');
}

/**
 * generateBlindedMessage() → { blindedMessageHex, secret, blindingFactor }
 * Generates a random secret x and blinding factor r.
 * B_ = hash_to_curve(x) + r*G
 */
function generateBlindedMessage() {
  const secret = secp.utils.randomPrivateKey();           // x — random bytes
  const r = secp.utils.randomPrivateKey();                // blinding factor
  const Y = hashToCurve(secret);                          // Y = hash_to_curve(x)
  const rG = secp.ProjectivePoint.BASE.multiply(secp.utils.normPrivateKeyToScalar(r));
  const B_ = Y.add(rG);                                   // B_ = Y + r*G
  return {
    blindedMessageHex: B_.toHex(true),
    secret,
    blindingFactor: r,
  };
}

/**
 * unblindSignature(signedPointHex, blindingFactor, mintPubkeyHex) → C hex string
 * C = C_ - r*K
 */
function unblindSignature(signedPointHex, blindingFactor, mintPubkeyHex) {
  const C_ = secp.ProjectivePoint.fromHex(signedPointHex);
  const K  = secp.ProjectivePoint.fromHex(mintPubkeyHex);
  const rK = K.multiply(secp.utils.normPrivateKeyToScalar(blindingFactor));
  const C  = C_.add(rK.negate());                        // C = C_ - r*K
  return C.toHex(true);
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

function baseUrl() {
  return process.env.WORKER_BASE_URL ?? 'http://localhost:8788';
}

function adminKey() {
  // Must match ADMIN_KEY in worker/.dev.vars exactly.
  return process.env.ADMIN_KEY ?? 'Neelam';
}

async function parseBody(res) {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  return await res.text();
}

async function request(path, options = {}) {
  const testIp = options._testIp ?? `test-${Math.random()}`;
  delete options._testIp;
  const url = `${baseUrl()}${path}`;
  options.headers = { ...options.headers, 'CF-Connecting-IP': testIp };
  const res = await fetch(url, options);
  const body = await parseBody(res);
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────────

/**
 * issueCredential() → { status, headers, body, _credentialForUpload, _uuid }
 *
 * Does the full BDHKE flow:
 *   1. Generates secret + blinding factor
 *   2. POSTs blinded_message to /credential/issue
 *   3. Unblinds the response to get C
 *   4. Returns the full response PLUS:
 *      body._credentialForUpload = { C, mint_pubkey }  ← what X-Cashu-Credential must contain
 *      body.uuid, body.commitment, body.issued_tier     ← from the Worker response (unchanged)
 */
export async function issueCredential() {
  const { blindedMessageHex, secret: _secret, blindingFactor } = generateBlindedMessage();
  const turnstileToken = '1x' + crypto.randomUUID().replace(/-/g, '');

  const res = await request('/credential/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnstile_token: turnstileToken, blinded_message: blindedMessageHex }),
  });

  if (res.status === 200 && res.body?.signed_point && res.body?.mint_pubkey) {
    // Unblind → C
    const C = unblindSignature(res.body.signed_point, blindingFactor, res.body.mint_pubkey);
    // Attach the ready-to-use credential object alongside the raw response body
    res.body._credentialForUpload = {
      C,
      mint_pubkey: res.body.mint_pubkey,
    };
  }

  return res;
}

/**
 * PUT /upload/{uuid}/{chunkIndex}
 */
export async function uploadChunk(uuid, chunkIndex, bytes, chunkHash, credentialHeaders = {}) {
  const padded = String(chunkIndex).padStart(4, '0');
  return request(`/upload/${uuid}/${padded}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      'X-Blake3-Chunk-Hash': chunkHash,
      ...credentialHeaders,
    },
    body: bytes,
  });
}

/**
 * buildCredentialHeaders(credBody, totalChunks, totalBytes, blake3Root, expiryTimestamp)
 *
 * credBody: the body returned by issueCredential() — must have _credentialForUpload
 */
export function buildCredentialHeaders(credBody, totalChunks, totalBytes, blake3Root, expiryTimestamp, p2shSecretHash = null) {
  if (!credBody._credentialForUpload) {
    throw new Error('buildCredentialHeaders: credBody missing _credentialForUpload — was issueCredential() used?');
  }
  const headers = {
    'X-Cashu-Credential':      JSON.stringify(credBody._credentialForUpload),
    'X-Credential-Commitment': credBody.commitment,
    'X-Issued-Tier':           credBody.issued_tier,
    'X-Blake3-Root':           blake3Root,
    'X-Total-Chunks':          String(totalChunks),
    'X-Total-Bytes':           String(totalBytes),
    'X-Expiry-Timestamp':      String(expiryTimestamp),
  };
  if (p2shSecretHash) headers['X-P2SH-Secret-Hash'] = p2shSecretHash;
  return headers;
}

/**
 * PUT /upload/{uuid}/manifest.json
 */
export async function putManifest(uuid, manifest) {
  return request(`/upload/${uuid}/manifest.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  });
}

/**
 * POST /auth/{uuid}
 */
export async function auth(uuid, passphrase) {
  return request(`/auth/${uuid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
}

/**
 * GET /download/{uuid}/{chunkIndex}
 */
export async function downloadChunk(uuid, chunkIndex, bearer = null) {
  const padded = String(chunkIndex).padStart(4, '0');
  const headers = {};
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  return request(`/download/${uuid}/${padded}`, { method: 'GET', headers });
}

/**
 * GET /status
 */
export async function getStatus() {
  return request('/status');
}

/**
 * GET /meta/{uuid}
 */
export async function getMeta(uuid) {
  return request(`/meta/${uuid}`);
}

/**
 * Generic POST (S71) — used by Stripe webhook security tests.
 * Returns { status, headers, body }.
 */
export async function post(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers,
    body,
  });
}

// ── TG-block endpoints (S-TG-5) ───────────────────────────────────────────

/**
 * POST /confirm/{uuid}
 *
 * Recipient-side destroy confirmation for open (non-passphrase) transfers.
 * For passphrase-protected transfers, pass the bearer token from POST /auth/{uuid}.
 * For open transfers, bearer may be omitted — the endpoint does not require it.
 *
 * @param {string} uuid
 * @param {string|null} bearer - download token from POST /auth/{uuid}, or null
 */
export async function confirmTransfer(uuid, bearer = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  return request(`/confirm/${uuid}`, { method: 'POST', headers });
}

/**
 * DELETE /transfer/{uuid} — recipient-authenticated deletion (passphrase path).
 *
 * @param {string} uuid
 * @param {string|null} bearer - download token from POST /auth/{uuid}
 * @param {object} opts
 * @param {boolean} opts.omitAuth - if true, sends no Authorization header at all (tests 401 path)
 */
export async function deleteTransfer(uuid, bearer = null, opts = {}) {
  const { omitAuth = false } = opts;
  const headers = {};
  if (!omitAuth) {
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer}`;
    } else {
      headers['Authorization'] = 'Bearer invalid-token';
    }
  }
  return request(`/transfer/${uuid}`, { method: 'DELETE', headers });
}

/**
 * DELETE /transfer/{uuid} — admin-keyed owner deletion (Execution Dock path).
 *
 * Sends "Authorization: Bearer rfs_owner_executiondock" to trigger the owner
 * path in handleDeleteTransfer, then X-Admin-Key for the actual authorisation.
 *
 * @param {string} uuid
 * @param {object} opts
 * @param {boolean} opts.badKey - send a wrong X-Admin-Key value (tests 401 path)
 */
export async function ownerDeleteTransfer(uuid, opts = {}) {
  const { badKey = false } = opts;
  return request(`/transfer/${uuid}`, {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer rfs_owner_executiondock',
      'X-Admin-Key':   badKey ? 'wrong-key' : adminKey(),
    },
  });
}
