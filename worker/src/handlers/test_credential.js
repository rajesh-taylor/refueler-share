/* eslint-disable no-undef, no-use-before-define */
// ─────────────────────────────────────────────────────────────────────────────
// worker/src/handlers/test_credential.js  (Share-Admin-1)
//
// POST /admin/test-credential
//
// X-Admin-Key gated. Issues a real blind-signed credential that /initiate
// will accept, but bypasses Turnstile, Cashu payment, and tier resolution.
// Intended solely for soak testing transfers > 4 GiB (streaming branch) where
// no production credential can reach VERIFY_INLINE_CHUNK_THRESHOLD = 128.
//
// After issuing, stores a short-lived KV record:
//   test_credential:{uuid} → { cap_bytes, initiated: false }
//   TTL: max(expires_in_seconds, 3600) + 300 s grace
//
// handleInitiate reads this record (Share-Admin-1 patch in index.js).
// If present, it:
//   - skips the Cashu double-spend check
//   - uses cap_bytes from the record instead of resolved tier cap
//   - sets initiated: true so a second /initiate 409s normally
//
// Body (all optional — sensible defaults):
//   {
//     blinded_message:   string,   // REQUIRED — client BDHKE blinded point
//     cap_bytes:         number,   // default 268435456000 (250 GiB)
//     expires_in_seconds: number,  // default 7200 (2 h); max 86400 (24 h)
//   }
//
// Response (same shape as /credential/issue so the test page can reuse it):
//   {
//     signed_point, mint_pubkey, allocation_bytes, uuid,
//     issued_tier, commitment, expires_at,
//     test_credential: true,
//   }
//
// NEVER add this endpoint to bin/sync-share.sh.
// NEVER serve /share/admin/test-upload.html via the public mirror.
// ─────────────────────────────────────────────────────────────────────────────

import { issueBlindSignature } from '../nut00.js';
import { TIERS, isCharteredTier } from '../tiers.js';

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
const DEFAULT_CAP_BYTES       = 250 * 1024 * 1024 * 1024; // 250 GiB
const DEFAULT_EXPIRES_SECONDS = 2 * 3600;                 // 2 h
const MAX_EXPIRES_SECONDS     = 24 * 3600;                // 24 h hard ceiling
const API_EXPIRY_WINDOW       = 90 * 24 * 3600;           // chartered commitment window (mirrors index.js)

// ─── Commitment — mirrors computeApiCommitment in index.js ──────────────────
async function computeApiCommitment(uuid, tier, expiryWindow) {
  const input = new TextEncoder().encode(`${uuid}:${tier}:${expiryWindow}`);
  const hash  = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function handleTestCredential(request, env) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  // ── Body ──────────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { blinded_message } = body;
  if (!blinded_message) {
    return err(400, 'blinded_message is required');
  }

  const capBytes = typeof body.cap_bytes === 'number' && body.cap_bytes > 0
    ? Math.floor(body.cap_bytes)
    : DEFAULT_CAP_BYTES;

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
  const commitment = await computeApiCommitment(uuid, issuedTier, API_EXPIRY_WINDOW);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt  = nowSeconds + expiresInSeconds;

  // ── KV flag — handleInitiate reads this to bypass tier cap + Cashu spend ──
  // TTL = credential window + 5-minute grace so the flag outlives any in-flight /initiate.
  const kvKey = `test_credential:${uuid}`;
  const kvTtl = expiresInSeconds + 300;
  try {
    await env.STATUS_KV.put(
      kvKey,
      JSON.stringify({ cap_bytes: capBytes, initiated: false, issued_at: nowSeconds }),
      { expirationTtl: kvTtl },
    );
  } catch (e) {
    console.error('handleTestCredential: KV write failed:', e);
    return err(502, 'KV write failed — credential not issued');
  }

  // ── AE event (test runs distinguishable from production) ─────────────────
  if (env.AE) {
    try {
      env.AE.writeDataPoint({
        blobs:   ['admin_test_credential', issuedTier, '', ''],
        doubles: [0, 200, 0, 0, capBytes],
        indexes: ['admin_test_credential'],
      });
    } catch (e) {
      console.error('handleTestCredential: AE write failed:', e);
    }
  }

  console.log(`handleTestCredential: issued uuid=${uuid} cap_bytes=${capBytes} expires_in=${expiresInSeconds}s`);

  return json({
    signed_point:     signedPoint,
    mint_pubkey:      mintPubkey,
    allocation_bytes: capBytes,
    uuid,
    issued_tier:      issuedTier,
    commitment,
    expires_at:       expiresAt,
    test_credential:  true,
  });
}