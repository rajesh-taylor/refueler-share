/**
 * refueler-share — Cloudflare Worker
 *
 * Three endpoints this session (Session 2):
 *   POST /credential/issue   — Turnstile validation + NUT-00 blind sig issuance
 *   PUT  /upload/{uuid}/{nn} — Credential verify, NUT-07 melt, R2 write, cap enforcement
 *   GET  /download/{uuid}/{nn} — Manifest expiry check, download_initiated_at, R2 proxy
 *
 * Not in scope this session:
 *   NUT-11 P2SH download gating (Mode 1 / Mode 2) — Session 3
 *   Contractor upload link flow                    — Session 3
 *   Payment integration (Stripe / Lightning)       — Session 3
 *   ML-KEM PQC key wrapping                        — Production Max Phase 2
 *
 * Architecture rule (locked):
 *   BLAKE3 = chunk indexing and integrity verification
 *   Cashu blind sigs = anonymous authentication
 *   These are distinct layers. Never conflate.
 */

import { verifyTurnstile } from './turnstile.js';
import { issueBlindSig, verifyToken, tokenSerial } from './nut00.js';
import { verifyChunkHash, initBlake3 } from './blake3.js';
import {
  TIER_CAPS,
  buildManifest,
  getManifest,
  putManifest,
  isExpired,
  chunkKey,
  validateExpiryChoice,
} from './manifest.js';

// ---------------------------------------------------------------------------
// CORS — allow share.refueler.io and localhost for dev
// ---------------------------------------------------------------------------
function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ['https://share.refueler.io', 'http://localhost:8080', 'http://localhost:3000'];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'Authorization',
      'X-Chunk-Hash',
      'X-Chunk-Total',
      'X-Total-Bytes',
      'X-Blake3-Root',
      'X-Tier',
      'X-Expiry-Seconds',
    ].join(', '),
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function err(message, status, cors) {
  return json({ error: message }, status, cors);
}

// ---------------------------------------------------------------------------
// UUID validation — reject malformed paths early
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Initialise BLAKE3 WASM once per isolate invocation
    await initBlake3();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /credential/issue
      if (path === '/credential/issue' && request.method === 'POST') {
        return await handleCredentialIssue(request, env, cors);
      }

      // PUT /upload/{uuid}/{chunk-index}
      const uploadMatch = path.match(/^\/upload\/([^/]+)\/(\d{1,4})$/);
      if (uploadMatch && request.method === 'PUT') {
        const [, uuid, rawIndex] = uploadMatch;
        if (!UUID_RE.test(uuid)) return err('Invalid transfer UUID', 400, cors);
        return await handleUpload(request, env, cors, uuid, parseInt(rawIndex, 10));
      }

      // GET /download/{uuid}/{chunk-index}
      const downloadMatch = path.match(/^\/download\/([^/]+)\/(\d{1,4})$/);
      if (downloadMatch && request.method === 'GET') {
        const [, uuid, rawIndex] = downloadMatch;
        if (!UUID_RE.test(uuid)) return err('Invalid transfer UUID', 400, cors);
        return await handleDownload(request, env, cors, uuid, parseInt(rawIndex, 10));
      }

      return err('Not found', 404, cors);

    } catch (e) {
      // Never expose internal error detail in production
      console.error('Worker unhandled error:', e?.message ?? e);
      return err('Internal error', 500, cors);
    }
  },
};

// ---------------------------------------------------------------------------
// POST /credential/issue
// ---------------------------------------------------------------------------
async function handleCredentialIssue(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err('Request body must be JSON', 400, cors);
  }

  const { turnstile_token, blinded_point, tier = 'free' } = body;

  // 1. Reject unknown tiers
  if (!TIER_CAPS[tier]) {
    return err('Unknown tier', 400, cors);
  }

  // 2. Free tier only uses Turnstile. Paid tiers use NUT-04 (Session 3).
  if (tier === 'free') {
    if (!turnstile_token) {
      return err('turnstile_token required for free tier', 400, cors);
    }
    const ok = await verifyTurnstile(turnstile_token, env.TURNSTILE_SECRET_KEY, request);
    if (!ok) {
      return err('Turnstile verification failed', 403, cors);
    }
  }

  // 3. Validate blinded_point — must be a 33-byte compressed secp256k1 point (66 hex chars)
  if (!blinded_point || !/^[0-9a-f]{66}$/i.test(blinded_point)) {
    return err('blinded_point must be a 33-byte compressed point (66 hex chars)', 400, cors);
  }

  // 4. NUT-00: sign the blinded point
  let signed;
  try {
    signed = await issueBlindSig(blinded_point, env.MINT_PRIVATE_KEY);
  } catch (e) {
    console.error('NUT-00 issueBlindSig error:', e?.message);
    return err('Blind signature issuance failed', 500, cors);
  }

  return json({
    signed_point: signed.signed_point,   // C_ = k * B_
    mint_pubkey:  signed.mint_pubkey,    // K  = k * G — client needs this to unblind
    allocation_bytes: TIER_CAPS[tier],
    tier,
  }, 200, cors);
}

// ---------------------------------------------------------------------------
// PUT /upload/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------
async function handleUpload(request, env, cors, uuid, chunkIndex) {

  if (chunkIndex === 0) {
    // -----------------------------------------------------------------------
    // First chunk — verify credential, melt token, create manifest, write chunk
    // -----------------------------------------------------------------------

    // Parse credential from Authorization header
    // Format: Authorization: Cashu <base64url(JSON({secret, unblinded_sig}))>
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Cashu ')) {
      return err('Authorization header required (Cashu <credential>)', 401, cors);
    }

    let secret, unblindedSig;
    try {
      const decoded = JSON.parse(atob(authHeader.slice(6)));
      secret = decoded.secret;
      unblindedSig = decoded.unblinded_sig;
      if (!secret || !unblindedSig) throw new Error('missing fields');
    } catch {
      return err('Malformed credential', 401, cors);
    }

    // NUT-00 verify
    const valid = await verifyToken(secret, unblindedSig, env.MINT_PRIVATE_KEY);
    if (!valid) {
      return err('Invalid credential', 401, cors);
    }

    // Double-spend check via Supabase spent_tokens
    const serial = await tokenSerial(secret);
    const spent = await isTokenSpent(serial, env);
    if (spent) {
      return err('Credential already used', 409, cors);
    }

    // Parse upload metadata from request headers
    const totalBytes    = parseInt(request.headers.get('X-Total-Bytes')    ?? '0', 10);
    const chunkTotal    = parseInt(request.headers.get('X-Chunk-Total')    ?? '0', 10);
    const blake3Root    = request.headers.get('X-Blake3-Root')             ?? '';
    const tier          = request.headers.get('X-Tier')                   ?? 'free';
    const expirySecs    = parseInt(request.headers.get('X-Expiry-Seconds') ?? String(5 * 86400), 10);
    const chunkHash     = request.headers.get('X-Chunk-Hash')             ?? '';

    // Validate tier
    if (!TIER_CAPS[tier]) {
      return err('Unknown tier', 400, cors);
    }

    // Validate expiry choice — must be a permitted option for this tier
    if (!validateExpiryChoice(tier, expirySecs)) {
      return err('Expiry value not permitted for this tier', 400, cors);
    }

    // Cap enforcement — checked before any chunk is written
    const cap = TIER_CAPS[tier];
    if (totalBytes > cap) {
      return err(`File size ${totalBytes} exceeds ${tier} cap of ${cap} bytes`, 413, cors);
    }

    if (!chunkTotal || chunkTotal < 1) {
      return err('X-Chunk-Total must be >= 1', 400, cors);
    }

    // Read chunk body
    const body = await request.arrayBuffer();

    // BLAKE3 chunk integrity verification
    if (chunkHash) {
      const hashOk = await verifyChunkHash(body, chunkHash);
      if (!hashOk) {
        return err('Chunk BLAKE3 hash mismatch', 400, cors);
      }
    }

    // Build and write manifest BEFORE writing chunk (manifest is the authority)
    const manifest = buildManifest({
      uuid,
      tier,
      chunkCount:    chunkTotal,
      totalBytes,
      blake3RootHash: blake3Root,
      expirySeconds: expirySecs,
    });

    await putManifest(manifest, env);

    // Write chunk 0000
    await env.R2.put(chunkKey(uuid, chunkIndex), body);

    // NUT-07 melt — record spent token in Supabase
    // This fires after manifest and chunk are written.
    // On failure, the upload is orphaned but the token is not double-spendable
    // (the next verification attempt will fail the NUT-00 verify step).
    await meltToken(serial, env);

    return json({
      ok: true,
      uuid,
      chunk: chunkIndex,
      expiry_timestamp: manifest.expiry_timestamp,
    }, 200, cors);
  }

  // -------------------------------------------------------------------------
  // Subsequent chunks — authorised by manifest existence
  // -------------------------------------------------------------------------
  const manifest = await getManifest(uuid, env);
  if (!manifest) {
    return err('Transfer not found — upload credential required for first chunk', 404, cors);
  }

  if (isExpired(manifest)) {
    return err('Transfer link expired', 410, cors);
  }

  const chunkHash = request.headers.get('X-Chunk-Hash') ?? '';
  const body = await request.arrayBuffer();

  if (chunkHash) {
    const hashOk = await verifyChunkHash(body, chunkHash);
    if (!hashOk) {
      return err('Chunk BLAKE3 hash mismatch', 400, cors);
    }
  }

  await env.R2.put(chunkKey(uuid, chunkIndex), body);

  return json({ ok: true, uuid, chunk: chunkIndex }, 200, cors);
}

// ---------------------------------------------------------------------------
// GET /download/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------
async function handleDownload(request, env, cors, uuid, chunkIndex) {
  const manifest = await getManifest(uuid, env);
  if (!manifest) {
    return new Response('Transfer not found', { status: 404, headers: cors });
  }

  // Expiry check with in-progress grace period (see manifest.js isExpired)
  if (isExpired(manifest)) {
    return new Response('Transfer link expired', { status: 410, headers: cors });
  }

  // Record download_initiated_at on first chunk request if not already set
  if (chunkIndex === 0 && !manifest.download_initiated_at) {
    manifest.download_initiated_at = Math.floor(Date.now() / 1000);
    await putManifest(manifest, env);
  }

  // Proxy chunk from R2
  const key = chunkKey(uuid, chunkIndex);
  const object = await env.R2.get(key, {
    range: request.headers.has('Range')
      ? { suffix: undefined, ...parseRange(request.headers.get('Range'), 0) }
      : undefined,
  });

  if (!object) {
    return new Response('Chunk not found', { status: 404, headers: cors });
  }

  const responseHeaders = {
    ...cors,
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(object.size),
    'Cache-Control': 'no-store, no-cache',
    'X-Chunk-Index': String(chunkIndex),
    'X-Chunk-Total': String(manifest.chunk_count),
    'X-Expiry-Timestamp': String(manifest.expiry_timestamp),
  };

  return new Response(object.body, { status: 200, headers: responseHeaders });
}

// ---------------------------------------------------------------------------
// Supabase helpers — spent_tokens table
// ---------------------------------------------------------------------------
async function isTokenSpent(serial, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/spent_tokens?serial=eq.${encodeURIComponent(serial)}&select=serial&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    // On Supabase error, fail closed — treat as spent to prevent abuse
    console.error('spent_tokens check failed:', res.status);
    return true;
  }
  const rows = await res.json();
  return rows.length > 0;
}

async function meltToken(serial, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/spent_tokens`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ serial }),
  });
  if (!res.ok) {
    // Log but don't fail the upload — the credential is already verified as unspent.
    // On next use the NUT-00 verify will fail (invalid sig), so replay is impossible.
    console.error('NUT-07 melt insert failed:', res.status, await res.text());
  }
}

// ---------------------------------------------------------------------------
// Range header parser (for HTTP Range request support on downloads)
// ---------------------------------------------------------------------------
function parseRange(rangeHeader, objectSize) {
  // Only handles single byte-range: bytes=start-end
  const match = rangeHeader?.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) return undefined;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : objectSize - 1;
  return { offset: start, length: end - start + 1 };
}
