/* eslint-disable no-undef, no-use-before-define */
// ─────────────────────────────────────────────────────────────────────────────
// worker/src/handlers/test_credential.js  (Share-Admin-1)
//
// POST /admin/test-credential
//
// X-Admin-Key gated (requireAdmin), rate-limited in index.js. Issues a real
// blind-signed credential plus the MAC'd X-Test-Credential header value
// (KV-Fix-1b · B12-SR S2, src/testcred.js) that lets /initiate skip the Cashu
// spend for this one UUID, capped at cap_chunks. Soak testing only.
// Nothing is written to KV here; /initiate sets testcred_used:{uuid} on use.
// The expiry ceiling still applies at /initiate (free tier, 7 days).
//
// Body:
//   {
//     blinded_message:    string,  // REQUIRED — client BDHKE blinded point
//     cap_bytes:          number,  // default 250 GiB; rounded up to chunks, ≤ 8,000 chunks
//     expires_in_seconds: number,  // credential life; default 7200 (2 h); max 86400 (24 h)
//   }
//
// Response (same shape as /credential/issue so the test page can reuse it):
//   {
//     signed_point, mint_pubkey, allocation_bytes, uuid,
//     issued_tier, commitment, expires_at,
//     test_credential: "v1.<uuid>.<cap_chunks>.<exp>.<mac>",  // send as X-Test-Credential
//   }
//
// NEVER add this endpoint to bin/sync-share.sh.
// NEVER serve /share/admin/test-upload.html via the public mirror.
// ─────────────────────────────────────────────────────────────────────────────

import { issueBlindSignature } from '../nut00.js';
import { computeCommitment } from '../commitment.js';
import { TIERS, isCharteredTier } from '../tiers.js';
import { requireAdmin } from '../utils.js';
import { CHUNK_SIZE } from '../sweep_rules.js';
import { importTestCredKey, makeTestCredential, TESTCRED_MAX_CHUNKS } from '../testcred.js';

// ─── Module-local helpers (mirrors index.js / admin.js) ─────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Constants ───────────────────────────────────────────────────────────────
const DEFAULT_CAP_BYTES       = 250 * 1024 * 1024 * 1024; // 250 GiB = 8,000 chunks
const DEFAULT_EXPIRES_SECONDS = 2 * 3600;                 // 2 h
const MAX_EXPIRES_SECONDS     = 24 * 3600;                // 24 h hard ceiling
const API_EXPIRY_WINDOW       = 90 * 24 * 3600;           // chartered commitment window (mirrors index.js)

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function handleTestCredential(request, env) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  // ── Body ──────────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON body');
  }

  // No secret → no test credentials (and /initiate never bypasses).
  const tcKey = await importTestCredKey(env);
  if (!tcKey) return err(503, 'Test credentials not configured');

  const { blinded_message } = body;
  if (!blinded_message) {
    return err(400, 'blinded_message is required');
  }

  const capBytes = typeof body.cap_bytes === 'number' && body.cap_bytes > 0
    ? Math.floor(body.cap_bytes)
    : DEFAULT_CAP_BYTES;

  const capChunks = Math.ceil(capBytes / CHUNK_SIZE);
  if (capChunks > TESTCRED_MAX_CHUNKS) {
    return err(400, `cap_bytes exceeds ${TESTCRED_MAX_CHUNKS} chunks`);
  }

  const expiresInSeconds = typeof body.expires_in_seconds === 'number' && body.expires_in_seconds > 0
    ? Math.min(Math.floor(body.expires_in_seconds), MAX_EXPIRES_SECONDS)
    : DEFAULT_EXPIRES_SECONDS;

  // ── Blind-sign (real credential, consumer mint key) ───────────────────────
  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, env.MINT_PRIVATE_KEY));
  } catch (e) {
    console.error('handleTestCredential: blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  // ── UUID + commitment ─────────────────────────────────────────────────────
  const uuid       = crypto.randomUUID();
  const issuedTier = TIERS.CHARTERED;
  let commitment;
  try {
    commitment = await computeCommitment(env.COMMITMENT_KEY, uuid, issuedTier, API_EXPIRY_WINDOW);
  } catch (e) {
    console.error('handleTestCredential: commitment error:', e);
    return err(500, 'Credential issuance not configured');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt  = nowSeconds + expiresInSeconds;

  // ── MAC'd header value — the ONLY thing that selects the /initiate bypass ─
  const testCredential = await makeTestCredential(tcKey, uuid, capChunks, expiresAt);

  // ── AE event admin.testcred.issued (count only, B12-SR S2.4) ─────────────
  if (env.AE) {
    try {
      env.AE.writeDataPoint({
        blobs:   ['admin.testcred.issued'],
        doubles: [1],
        indexes: ['admin.testcred.issued'],
      });
    } catch (e) {
      console.error('handleTestCredential: AE write failed:', e);
    }
  }

  console.log(`handleTestCredential: issued cap_chunks=${capChunks} expires_in=${expiresInSeconds}s`);

  return json({
    signed_point:     signedPoint,
    mint_pubkey:      mintPubkey,
    allocation_bytes: capChunks * CHUNK_SIZE,
    uuid,
    issued_tier:      issuedTier,
    commitment,
    expires_at:       expiresAt,
    test_credential:  testCredential,
  });
}