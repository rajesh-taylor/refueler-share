import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { verifyChunkHash } from './blake3.js';
import { getManifest, putManifest, createManifest, isExpired, isInGracePeriod, isDownloadBlocked, requiresPassphrase, TIER_CAPS } from './manifest.js';
import { hashSecret, timingSafeEqual, issueDownloadToken, verifyDownloadToken } from './nut11.js';
import { verifyStripeWebhook, createCheckoutSession } from './stripe.js';
import { checkRateLimit, getClientIp, rateLimitResponse } from './ratelimit.js';

// ─────────────────────────────────────────────────────────────────────────────
// Upload enforcement constants (S39)
// ─────────────────────────────────────────────────────────────────────────────
const CHUNK_SIZE_MAX    = 10 * 1024 * 1024; // 10 MB hard cap per chunk
const MANIFEST_SIZE_MAX = 64 * 1024;        // 64 KB manifest ceiling (S42)

// ─────────────────────────────────────────────────────────────────────────────
// Manifest fetch with size cap (S42)
//
// getManifest() is imported from manifest.js and reads the raw R2 object.
// An adversary-supplied or corrupted manifest larger than 64 KB would consume
// unnecessary memory and could cause unbounded JSON.parse allocation.
// This wrapper fetches the R2 object directly for a size check before delegating
// to the imported helper, returning null (not found) or throwing on oversize.
// ─────────────────────────────────────────────────────────────────────────────
async function safeGetManifest(bucket, uuid, env) {
  const key = `${uuid}/manifest.json`;
  let obj;
  try {
    obj = await bucket.get(key);
  } catch (e) {
    console.error('R2 manifest get error:', e);
    return { manifest: null, oversize: false };
  }
  if (!obj) return { manifest: null, oversize: false };

  if ((obj.size ?? 0) > MANIFEST_SIZE_MAX) {
    console.error(`Manifest oversize: ${obj.size} bytes for ${uuid}`);
    return { manifest: null, oversize: true };
  }

  // Delegate to the authoritative helper for parsing and field normalisation.
  const manifest = await getManifest(bucket, uuid);
  return { manifest, oversize: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME type denylist (S40)
//
// Rejects upload requests whose Content-Type header declares an
// execution-capable file type with no legitimate anonymous transfer use.
//
// This gate checks declared intent only — the Worker receives AES-GCM
// ciphertext and cannot inspect payload content. A cooperative client
// sets Content-Type correctly via the browser File API. A malicious client
// can declare any header; the denylist is a signal gate, not a sandbox.
//
// Denylisted types:
//   application/x-msdownload   — Windows PE executables (.exe, .dll)
//   application/x-executable   — ELF binaries (Linux/macOS native executables)
//   application/x-sh           — Shell scripts (.sh) — execution-capable on any Unix host
//   application/x-bat          — Windows batch files (.bat, .cmd)
//   text/x-shellscript         — Shell scripts (alternate MIME, same risk)
//   application/x-php          — PHP source — execution-capable on any PHP host
//
// Permitted by deliberate decision:
//   application/java-archive (.jar) — legitimate developer artefact;
//   requires JVM invocation, not passive execution.
// ─────────────────────────────────────────────────────────────────────────────
const MIME_DENYLIST = new Set([
  'application/x-msdownload',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'text/x-shellscript',
  'application/x-php',
]);

// ─────────────────────────────────────────────────────────────────────────────
// UUID validation (S41)
//
// RFC 4122 format: 8-4-4-4-12 lowercase hex groups separated by hyphens.
// The router regex [0-9a-f-]{36} already blocks non-hex/non-hyphen chars and
// enforces length, but accepts structurally invalid strings (e.g. all hyphens).
// This stricter check ensures the captured group is a valid UUID before any
// R2, Supabase, or KV operation is attempted.
// ─────────────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ['https://share.refueler.io', 'https://upgrade.refueler.io'];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cashu-Credential, X-Blake3-Root, X-Blake3-Chunk-Hash, X-Total-Chunks, X-Total-Bytes, X-Tier, X-Expiry-Timestamp, X-P2SH-Secret-Hash, X-File-Name, X-Admin-Key, X-Email, X-Credential-Commitment, X-Issued-Tier',
    'Access-Control-Expose-Headers': 'X-File-Name, X-Total-Bytes, X-Expiry-Timestamp',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine
// Dataset: share_events (bound as AE in wrangler.toml)
//
// Schema (one data point per request):
//   blobs:   [endpoint, tier, error_message]
//   doubles: [latency_ms, status_code, chunk_index, total_chunks, total_bytes]
//   indexes: [endpoint]   <- enables fast GROUP BY in AE SQL
// ─────────────────────────────────────────────────────────────────────────────
function logEvent(env, {
  endpoint,
  tier        = 'free',
  status      = 200,
  latency     = 0,
  chunkIndex  = -1,
  totalChunks = 0,
  totalBytes  = 0,
  errorMsg    = '',
}) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, errorMsg],
      doubles: [latency, status, chunkIndex, totalChunks, totalBytes],
      indexes: [endpoint],
    });
  } catch (e) {
    console.error('AE write failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url  = new URL(request.url);
    const path = url.pathname;
    const t0   = performance.now();

    async function timed(endpoint, handler, logExtra = {}) {
      try {
        const response = await handler();
        const latency  = performance.now() - t0;
        logEvent(env, { endpoint, status: response.status, latency, ...logExtra });
        return response;
      } catch (e) {
        const latency = performance.now() - t0;
        logEvent(env, { endpoint, status: 500, latency, errorMsg: e?.message ?? 'unknown', ...logExtra });
        throw e;
      }
    }

    try {
      if (request.method === 'GET' && path === '/status') {
        return timed('status', () => handleStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/admin/status') {
        return timed('admin_status', () => handleAdminStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/credential/issue') {
        // Rate limit: 10 requests / 60s per IP — prevents token farming and Turnstile abuse
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'credential_issue', 10, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'credential_issue', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        const cloned = request.clone();
        let credTier = 'free';
        try { const b = await cloned.json(); credTier = b.tier ?? 'free'; } catch {}
        return timed('credential_issue', () => handleCredentialIssue(request, env).then(r => addCors(r, request)), { tier: credTier });
      }

      const uploadMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'PUT' && uploadMatch) {
        // Rate limit: 120 requests / 60s per IP — generous for legitimate chunked uploads, blocks bulk abuse
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'upload', 120, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'upload', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        const chunkIndex  = parseInt(uploadMatch[2], 10);
        const tier        = request.headers.get('X-Tier') ?? 'free';
        const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
        const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
        return timed('upload', () => handleUpload(request, env, uploadMatch[1], chunkIndex).then(r => addCors(r, request)), {
          tier, chunkIndex,
          totalChunks: chunkIndex === 0 ? totalChunks : 0,
          totalBytes:  chunkIndex === 0 ? totalBytes  : 0,
        });
      }

      const authMatch = path.match(/^\/auth\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && authMatch) {
        // Rate limit layer 1: 5 requests / 60s per IP — passphrase brute-force protection
        const ip   = getClientIp(request);
        const rlIp = await checkRateLimit(env, ip, 'auth', 5, 60);
        if (rlIp.limited) {
          logEvent(env, { endpoint: 'auth', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_ip' });
          return rateLimitResponse(request, rlIp.resetAt, corsHeaders(request));
        }
        // Rate limit layer 2: 10 requests / 60s per UUID — distributed brute-force protection.
        // An attacker rotating IPs still hits this ceiling per transfer.
        const rlUuid = await checkRateLimit(env, authMatch[1], 'auth_uuid', 10, 60);
        if (rlUuid.limited) {
          logEvent(env, { endpoint: 'auth', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_uuid' });
          return rateLimitResponse(request, rlUuid.resetAt, corsHeaders(request));
        }
        return timed('auth', () => handleAuth(request, env, authMatch[1]).then(r => addCors(r, request)));
      }

      const downloadMatch = path.match(/^\/download\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'GET' && downloadMatch) {
        // Rate limit: 300 requests / 60s per IP — generous for legitimate chunked downloads
        // (250 GB max transfer at 1 MB chunks = 250 chunks), blocks flood attacks.
        const ip   = getClientIp(request);
        const rlDl = await checkRateLimit(env, ip, 'download', 300, 60);
        if (rlDl.limited) {
          logEvent(env, { endpoint: 'download', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_ip' });
          return rateLimitResponse(request, rlDl.resetAt, corsHeaders(request));
        }
        const chunkIndex = parseInt(downloadMatch[2], 10);
        return timed('download', async () => {
          const response = await handleDownload(request, env, downloadMatch[1], chunkIndex);
          return addCors(response, request);
        }, { chunkIndex });
      }

      if (request.method === 'POST' && path === '/webhook/stripe') {
        return timed('webhook_stripe', () => handleStripeWebhook(request, env));
      }

      if (request.method === 'POST' && path === '/subscription/checkout') {
        return timed('subscription_checkout', () => handleCheckout(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/subscription/status') {
        return timed('subscription_status', () => handleSubscriptionStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/subscription/portal') {
        return timed('subscription_portal', () => handlePortal(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/log/error') {
        return handleLogError(request, env).then(r => addCors(r, request));
      }

      if (request.method === 'GET' && path === '/admin/metrics') {
        return timed('admin_metrics', () => handleAdminMetrics(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/ae-metrics') {
        return timed('admin_ae_metrics', () => handleAdminAeMetrics(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/snapshot') {
        return timed('admin_snapshot', () => handleAdminSnapshot(request, env).then(r => addCors(r, request)));
      }

      logEvent(env, { endpoint: 'unknown', status: 404, latency: performance.now() - t0 });
      return new Response('Not found', { status: 404 });

    } catch (e) {
      const latency = performance.now() - t0;
      logEvent(env, { endpoint: 'unhandled', status: 500, latency, errorMsg: e?.message ?? 'unknown' });
      console.error('Worker error:', e);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Status — GET /status
// ─────────────────────────────────────────────────────────────────────────────
async function handleStatus(request, env) {
  let current = null;
  try {
    const raw = await env.STATUS_KV.get('status:current', { type: 'json' });
    current = raw;
  } catch (e) {
    console.error('KV read error:', e);
  }

  if (!current) {
    current = {
      state:       'operational',
      message:     null,
      maintenance: null,
      incidents:   [],
      updated_at:  Math.floor(Date.now() / 1000),
    };
  }

  return json(current);
}

// ─────────────────────────────────────────────────────────────────────────────
// Client error reporting — POST /log/error (S36b)
// ─────────────────────────────────────────────────────────────────────────────
async function handleLogError(request, env) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, ip, 'log_error', 20, 60);
  if (rl.limited) return new Response('Too Many Requests', { status: 429 });

  let body;
  try { body = await request.json(); } catch { return new Response('OK', { status: 200 }); }

  const context = String(body.context || '').slice(0, 64);
  const message = String(body.message || '').slice(0, 200);
  const detail  = String(body.detail  || '').slice(0, 200);

  try {
    env.AE.writeDataPoint({
      blobs:   ['client_error', context, message],
      doubles: [Date.now()],
      indexes: ['client_error'],
    });
  } catch {}

  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin status — POST /admin/status
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminStatus(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const validStates = ['operational', 'degraded', 'maintenance'];
  if (body.state !== undefined && !validStates.includes(body.state)) {
    return err(400, `Invalid state. Must be one of: ${validStates.join(', ')}`);
  }

  let current = null;
  try {
    current = await env.STATUS_KV.get('status:current', { type: 'json' });
  } catch {}

  if (!current) {
    current = {
      state:       'operational',
      message:     null,
      maintenance: null,
      incidents:   [],
      updated_at:  Math.floor(Date.now() / 1000),
    };
  }

  const updated = {
    ...current,
    ...body,
    updated_at: Math.floor(Date.now() / 1000),
  };

  try {
    await env.STATUS_KV.put('status:current', JSON.stringify(updated));
  } catch (e) {
    console.error('KV write error:', e);
    return err(502, 'Failed to write status to KV');
  }

  return json({ ok: true, status: updated });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential issue — POST /credential/issue
//
// S42c: UUID-bound credential issuance.
//
// The Worker generates the transfer UUID here — the client no longer generates
// it client-side. A commitment H(uuid‖issued_tier‖expiry_window_seconds) is
// computed and returned alongside the blind signature. The frontend echoes this
// commitment and issued_tier on chunk 0; the Worker recomputes and verifies.
//
// This closes the cross-transfer credential farming vector: a credential farmed
// for one UUID is cryptographically invalid for any other UUID.
//
// Nothing is stored. The binding lives in the commitment itself.
// Full NUT-20 quote signatures deferred to B8 Rust mint.
// ─────────────────────────────────────────────────────────────────────────────

// Canonical expiry windows (seconds) — mirrored in handleUpload.
// These constants must stay in sync. A mismatch breaks commitment verification.
const EXPIRY_WINDOWS = {
  free:     7  * 24 * 3600,  //    604,800 s
  creative: 30 * 24 * 3600,  //  2,592,000 s
  max:      90 * 24 * 3600,  //  7,776,000 s
};

/**
 * computeCommitment(uuid, tier, expiryWindow) → hex string
 * SHA-256( utf8(uuid) || utf8(':') || utf8(tier) || utf8(':') || utf8(expiryWindow) )
 * Simple, deterministic, no parsing ambiguity (UUID contains only hex+hyphen; tier is alpha).
 */
async function computeCommitment(uuid, tier, expiryWindow) {
  const input = new TextEncoder().encode(`${uuid}:${tier}:${expiryWindow}`);
  const hash  = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleCredentialIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { turnstile_token, blinded_message, tier = 'free' } = body;
  if (!turnstile_token || !blinded_message) return err(400, 'Missing turnstile_token or blinded_message');

  const turnstileOk = await verifyTurnstileToken(turnstile_token, env.TURNSTILE_SECRET_KEY);
  if (!turnstileOk) return err(403, 'Turnstile verification failed');

  // ── Turnstile nonce binding (S42d) ────────────────────────────────────────
  // One Turnstile solve must produce at most one credential.
  // Cloudflare expires tokens server-side after ~300s; we extend that to 600s
  // (10 min) to cover clock skew and replay within the Cloudflare window.
  // The token is hashed one-way before storage — cannot reverse to identify user.
  // Key: tt_nonce:{sha256_hex}. Fails open on KV error (privacy over abuse prevention).
  // 429 on second use of the same Turnstile token within the TTL window.
  const nonceHash = await (async () => {
    const bytes = new TextEncoder().encode(turnstile_token);
    const hash  = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  })();
  const nonceKey = `tt_nonce:${nonceHash}`;
  let nonceSeen = false;
  try {
    const existing = await env.STATUS_KV.get(nonceKey);
    nonceSeen = existing !== null;
  } catch (e) {
    // KV read error — fail open. Privacy takes precedence; do not block on infra hiccup.
    console.error('Turnstile nonce KV read failed, proceeding:', e);
  }
  if (nonceSeen) {
    logEvent(env, { endpoint: 'credential_issue', tier: 'rate_limited', status: 429, latency: 0, errorMsg: 'turnstile_nonce_replay' });
    return err(429, 'Turnstile token already used');
  }
  // Store nonce — fire-and-forget, never block issuance on write failure.
  env.STATUS_KV.put(nonceKey, '1', { expirationTtl: 600 }).catch(e =>
    console.error('Turnstile nonce KV write failed:', e)
  );

  // Canonicalise tier — unknown values fall back to free silently.
  const issuedTier      = EXPIRY_WINDOWS[tier] !== undefined ? tier : 'free';
  const expiryWindow    = EXPIRY_WINDOWS[issuedTier];
  const allocationBytes = TIER_CAPS[issuedTier] ?? TIER_CAPS.free;

  // Generate transfer UUID server-side. Client no longer calls crypto.randomUUID().
  const uuid = crypto.randomUUID();

  // Compute commitment — binds this credential to exactly this uuid + tier + window.
  const commitment = await computeCommitment(uuid, issuedTier, expiryWindow);

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, env.MINT_PRIVATE_KEY));
  } catch (e) {
    console.error('Blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  return json({
    signed_point:     signedPoint,
    mint_pubkey:      mintPubkey,
    allocation_bytes: allocationBytes,
    uuid,
    issued_tier:      issuedTier,
    commitment,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload — PUT /upload/:uuid/:chunk
//
// S39 changes:
//   - X-Tier header no longer trusted. Tier resolved from Supabase subscribers
//     table via X-Email header. Falls back to 'free' on any error or if no
//     active subscriber found.
//   - Per-chunk Content-Length hard cap: 10 MB → 413 if exceeded.
//   - Cumulative byte tracking via STATUS_KV key `upload_bytes:{uuid}`.
//     Before each chunk write: read counter + Content-Length. If sum exceeds
//     tier cap → 413. Counter deleted on upload_complete.
//   - All 413 rejections logged to AE.
//
// S40 changes:
//   - Content-Type header checked against MIME_DENYLIST before any other
//     processing. Missing Content-Type → 415. Denylisted type → 415.
//   - Gate applies to chunk 0 only — subsequent chunks carry no meaningful
//     Content-Type (they are raw ciphertext continuations).
//   - All 415 rejections logged to AE with errorMsg: 'mime_denied' or
//     'mime_missing'.
// ─────────────────────────────────────────────────────────────────────────────
async function handleUpload(request, env, uuid, chunkIndex) {
  // ── UUID format validation (S41) ──────────────────────────────────────────
  // Fires before any R2, Supabase, or KV operation.
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'upload', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  const isFirstChunk = chunkIndex === 0;

  // ── MIME type gate (S40) — chunk 0 only ───────────────────────────────────
  // Subsequent chunks are raw ciphertext continuations; Content-Type on those
  // is not meaningful. Gate applies exclusively to the first chunk, which
  // carries the file's declared type from the browser File API.
  if (isFirstChunk) {
    const rawContentType = request.headers.get('Content-Type') ?? '';
    // Strip parameters (e.g. "application/x-sh; charset=utf-8" → "application/x-sh")
    const mimeType = rawContentType.split(';')[0].trim().toLowerCase();

    if (!mimeType) {
      logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 415, errorMsg: 'mime_missing' });
      return err(415, 'Content-Type header is required');
    }

    if (MIME_DENYLIST.has(mimeType)) {
      logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 415, errorMsg: 'mime_denied' });
      return err(415, `File type '${mimeType}' is not permitted`);
    }
  }

  // ── Chunk size hard cap ────────────────────────────────────────────────────
  // Reject before reading body. Content-Length is required for PUT from our
  // client; absence treated as 0 (actual body size is also checked after read).
  const declaredLength = parseInt(request.headers.get('Content-Length') ?? '0', 10);
  if (declaredLength > CHUNK_SIZE_MAX) {
    logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 413, errorMsg: 'chunk_too_large' });
    return err(413, `Chunk exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
  }

  // ── Resolve tier from Supabase (S39) ──────────────────────────────────────
  // X-Tier header is ignored. X-Email is used to look up an active subscriber.
  // Falls back to 'free' on any Supabase error or missing/inactive subscriber.
  const email = (request.headers.get('X-Email') ?? '').trim().toLowerCase();
  let resolvedTier = 'free';
  if (email) {
    try {
      const subRes = await supabaseFetch(
        env, 'GET',
        `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&status=eq.active&select=tier&limit=1`
      );
      if (subRes.ok) {
        const rows = await subRes.json();
        if (rows.length > 0 && rows[0].tier) {
          resolvedTier = rows[0].tier;
        }
      }
    } catch (e) {
      console.error('Tier resolution failed, defaulting to free:', e);
    }
  }

  const tierCap = TIER_CAPS[resolvedTier] ?? TIER_CAPS.free;

  // ── Cumulative byte cap via KV (S39) ──────────────────────────────────────
  // Read current byte counter for this UUID. Add Content-Length and check
  // against tier cap before writing the chunk body to R2.
  const kvKey = `upload_bytes:${uuid}`;
  let bytesAlreadyWritten = 0;
  try {
    const stored = await env.STATUS_KV.get(kvKey);
    bytesAlreadyWritten = stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    console.error('KV byte counter read failed, proceeding:', e);
    // Fail open — do not block upload on KV read error.
  }

  const projectedTotal = bytesAlreadyWritten + declaredLength;
  if (projectedTotal > tierCap) {
    logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'tier_cap_exceeded' });
    return err(413, `Upload would exceed ${resolvedTier} tier cap of ${tierCap} bytes`);
  }

  if (isFirstChunk) {
    const credential  = request.headers.get('X-Cashu-Credential');
    const blake3Root  = request.headers.get('X-Blake3-Root');
    const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
    const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
    const expiryTs    = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
    const chunkHash   = request.headers.get('X-Blake3-Chunk-Hash');
    const p2shHash    = request.headers.get('X-P2SH-Secret-Hash') ?? null;
    const rawFileName = request.headers.get('X-File-Name') ?? '';
    // Strip path separators, null bytes, C0/C1 control characters (U+0000–U+001F, U+007F),
    // and Unicode bidirectional override characters (U+202A–U+202E, U+2066–U+2069)
    // that can spoof filenames in terminal or file-manager display.
    // Truncate to 255 bytes (not chars) after sanitisation to respect FS limits.
    const sanitisedFileName = rawFileName
      .replace(/[/\\]/g, '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .trim();
    const fileNameBytes = new TextEncoder().encode(sanitisedFileName);
    const fileName = fileNameBytes.length > 255
      ? new TextDecoder().decode(fileNameBytes.slice(0, 255))
      : (sanitisedFileName || `refueler-${uuid.slice(0, 8)}`);

    const commitment = request.headers.get('X-Credential-Commitment') ?? '';
    const issuedTier = (request.headers.get('X-Issued-Tier') ?? 'free').trim().toLowerCase();

    if (!credential || !blake3Root || !totalChunks || !totalBytes || !expiryTs || !chunkHash) {
      return err(400, 'Missing required headers');
    }

    // ── UUID-bound commitment verification (S42c) ─────────────────────────
    // Recompute H(uuid:issued_tier:expiry_window) and compare to the value
    // the client echoed from the credential issue response. A farmed credential
    // carries a commitment for a different UUID and will fail here.
    // Fires before credential verification — avoids a Supabase call on farming
    // attempts. Nothing is stored; the binding is in the commitment itself.
    if (!commitment) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 401, errorMsg: 'credential_commitment_missing' });
      return err(401, 'Missing credential commitment');
    }
    const canonicalTier   = EXPIRY_WINDOWS[issuedTier] !== undefined ? issuedTier : 'free';
    const expectedWindow  = EXPIRY_WINDOWS[canonicalTier];
    const expectedCommitment = await computeCommitment(uuid, canonicalTier, expectedWindow);
    // Constant-time comparison — commitment is not secret but avoids timing oracle on hex strings.
    const commitmentBytes         = new TextEncoder().encode(commitment);
    const expectedCommitmentBytes = new TextEncoder().encode(expectedCommitment);
    const commitmentMatch = commitmentBytes.length === expectedCommitmentBytes.length &&
      crypto.subtle.timingSafeEqual
        ? await (async () => {
            // timingSafeEqual available in Workers runtime
            try { return crypto.subtle.timingSafeEqual(commitmentBytes, expectedCommitmentBytes); }
            catch { return commitment === expectedCommitment; }
          })()
        : commitment === expectedCommitment;
    if (!commitmentMatch) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 401, errorMsg: 'credential_uuid_mismatch' });
      return err(401, 'Credential commitment mismatch');
    }

    // ── Total chunks upper bound (S42) ────────────────────────────────────
    // 10,000 chunks × 25 MB = 250 GB — covers Production Max with headroom.
    // Rejects inflated values before any credential or storage operation.
    const TOTAL_CHUNKS_MAX = 10_000;
    if (totalChunks > TOTAL_CHUNKS_MAX) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'total_chunks_exceeded' });
      return err(400, `X-Total-Chunks exceeds maximum of ${TOTAL_CHUNKS_MAX}`);
    }

    // ── Expiry timestamp tier validation (S42) ────────────────────────────
    // Server validates that the client-declared expiry falls within the
    // maximum window permitted for the resolved tier. Client cannot extend
    // its own expiry beyond tier entitlement by supplying a distant timestamp.
    //
    // Windows (seconds from now):
    //   free:     7 days  (604,800s)
    //   creative: 30 days (2,592,000s)
    //   max:      90 days (7,776,000s)
    const EXPIRY_MAX_SECONDS = {
      free:     7  * 24 * 3600,  //  7 days
      creative: 30 * 24 * 3600,  // 30 days
      max:      90 * 24 * 3600,  // 90 days
    };
    const nowSeconds  = Math.floor(Date.now() / 1000);
    const maxWindow   = EXPIRY_MAX_SECONDS[resolvedTier] ?? EXPIRY_MAX_SECONDS.free;
    const maxExpiryTs = nowSeconds + maxWindow;
    if (expiryTs <= nowSeconds) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'expiry_in_past' });
      return err(400, 'X-Expiry-Timestamp is in the past');
    }
    if (expiryTs > maxExpiryTs) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'expiry_exceeds_tier' });
      return err(400, `X-Expiry-Timestamp exceeds maximum window for ${resolvedTier} tier (${maxWindow / 86400} days)`);
    }

    // ── Early cap check against declared total (S39) ───────────────────────
    // If the client's declared total already exceeds the tier cap, reject
    // before credential verification to avoid burning a Cashu token.
    if (totalBytes > tierCap) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'declared_total_exceeds_cap' });
      return err(413, `Declared total ${totalBytes} bytes exceeds ${resolvedTier} tier cap of ${tierCap} bytes`);
    }

    let serial;
    try {
      const credentialObj = JSON.parse(credential);
      serial = await verifyCredential(credentialObj, env.MINT_PRIVATE_KEY);
    } catch {
      return err(401, 'Invalid credential');
    }

    const spentRes = await supabaseFetch(env, 'GET', `/rest/v1/spent_tokens?serial=eq.${encodeURIComponent(serial)}&select=serial`);
    if (!spentRes.ok) return err(502, 'Ledger unavailable');
    const spent = await spentRes.json();

    // ── Double-spend detected ────────────────────────────────────────────────
    // Fire-and-forget audit write — never blocks the 409 response.
    // On Supabase failure: log and continue (same pattern as NUT-07 melt).
    if (spent.length > 0) {
      supabaseFetch(env, 'POST', '/rest/v1/double_spend_attempts', {
        serial,
        uuid,
        attempted_at: new Date().toISOString(),
      }).then(r => {
        if (!r.ok) r.text().then(t => console.error('double_spend_attempts write failed:', t));
      }).catch(e => console.error('double_spend_attempts fetch error:', e));

      return err(409, 'Credential already spent');
    }

    const chunkBody = await request.arrayBuffer();

    // ── Actual body size guard (S39) ──────────────────────────────────────
    // Body may differ from Content-Length header. Guard the real byte count.
    if (chunkBody.byteLength > CHUNK_SIZE_MAX) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'chunk_body_too_large' });
      return err(413, `Chunk body exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
    }

    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHash);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    // ── Increment KV byte counter (S39) ───────────────────────────────────
    try {
      await env.STATUS_KV.put(kvKey, String(bytesAlreadyWritten + chunkBody.byteLength), { expirationTtl: 86400 });
    } catch (e) {
      console.error('KV byte counter write failed:', e);
    }

    const manifest = createManifest({
      uuid,
      tier: resolvedTier,
      totalChunks,
      totalBytes,
      expiryTimestamp: expiryTs,
      blake3Root,
      p2shSecretHash: p2shHash,
    });
    manifest.file_name = fileName;
    manifest.chunks_received = [0];
    await putManifest(env.BUCKET, uuid, manifest);

    const meltRes = await supabaseFetch(env, 'POST', '/rest/v1/spent_tokens', { serial });
    if (!meltRes.ok) console.error('NUT-07 melt failed:', serial, await meltRes.text());

    return json({ ok: true, chunk: 0, uuid });

  } else {
    // ── Subsequent chunks ──────────────────────────────────────────────────
    const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
    if (oversize) {
      logEvent(env, { endpoint: 'upload', status: 502, errorMsg: 'manifest_oversize' });
      return err(502, 'Transfer manifest exceeds size limit');
    }
    if (!manifest) return err(404, 'Transfer not found');
    if (manifest.upload_complete) return err(409, 'Upload already complete');

    const now = Math.floor(Date.now() / 1000);
    if (now > manifest.expiry_timestamp) return err(410, 'Transfer expired');

    const chunkHashHeader = request.headers.get('X-Blake3-Chunk-Hash');
    if (!chunkHashHeader) return err(400, 'Missing X-Blake3-Chunk-Hash');

    const chunkBody = await request.arrayBuffer();

    // ── Actual body size guard (S39) ──────────────────────────────────────
    if (chunkBody.byteLength > CHUNK_SIZE_MAX) {
      logEvent(env, { endpoint: 'upload', tier: manifest.tier ?? resolvedTier, status: 413, errorMsg: 'chunk_body_too_large' });
      return err(413, `Chunk body exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
    }

    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHashHeader);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    // ── Increment KV byte counter (S39) ───────────────────────────────────
    // TTL refreshed on every chunk write — 24h from last activity.
    try {
      await env.STATUS_KV.put(kvKey, String(bytesAlreadyWritten + chunkBody.byteLength), { expirationTtl: 86400 });
    } catch (e) {
      console.error('KV byte counter write failed:', e);
    }

    // ── Chunk count manipulation defence (S42b) ───────────────────────────
    // Reject any chunk index ≥ declared total_chunks. Without this, an
    // adversary could push indices beyond the declared ceiling, inflating
    // chunks_received indefinitely and corrupting the completion check.
    if (chunkIndex >= manifest.total_chunks) {
      logEvent(env, { endpoint: 'upload', tier: manifest.tier ?? resolvedTier, status: 400, errorMsg: 'chunk_index_out_of_bounds' });
      return err(400, 'Chunk index exceeds declared total');
    }

    manifest.chunks_received.push(chunkIndex);
    if (manifest.chunks_received.length === manifest.total_chunks) {
      manifest.upload_complete = true;
      // ── Delete KV counter on completion (S39) ─────────────────────────
      try {
        await env.STATUS_KV.delete(kvKey);
      } catch (e) {
        console.error('KV byte counter delete failed:', e);
      }
    }
    await putManifest(env.BUCKET, uuid, manifest);

    return json({ ok: true, chunk: chunkIndex, uuid });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — POST /auth/:uuid
// ─────────────────────────────────────────────────────────────────────────────
async function handleAuth(request, env, uuid) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { passphrase } = body;
  if (!passphrase || typeof passphrase !== 'string') return err(400, 'Missing passphrase');

  const { manifest, oversize: authOversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (authOversize) {
    logEvent(env, { endpoint: 'auth', status: 502, errorMsg: 'manifest_oversize' });
    return err(502, 'Transfer manifest exceeds size limit');
  }
  if (!manifest) return err(404, 'Transfer not found');
  if (!requiresPassphrase(manifest)) return err(400, 'Transfer is not passphrase-protected');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  const submitted = await hashSecret(passphrase);
  const match = timingSafeEqual(submitted, manifest.p2sh_secret_hash);
  if (!match) {
    await new Promise(r => setTimeout(r, 200));
    return err(401, 'Incorrect passphrase');
  }

  const token = await issueDownloadToken(uuid, env.MINT_PRIVATE_KEY);
  return json({ token });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download — GET /download/:uuid/:chunk
// ─────────────────────────────────────────────────────────────────────────────
async function handleDownload(request, env, uuid, chunkIndex) {
  // ── UUID format validation (S41) ──────────────────────────────────────────
  // Fires before any R2 or Supabase operation.
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  // ── Chunk index bounds check (S41) ────────────────────────────────────────
  // Router regex \d{4} structurally prevents negative values and 5+ digit
  // numbers, but an explicit guard here makes the invariant visible and
  // provides belt-and-braces defence against future router changes.
  if (chunkIndex < 0 || chunkIndex > 9999) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_chunk_index' });
    return err(400, 'Invalid chunk index');
  }

  const { manifest, oversize: dlOversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (dlOversize) {
    logEvent(env, { endpoint: 'download', status: 502, errorMsg: 'manifest_oversize' });
    return err(502, 'Transfer manifest exceeds size limit');
  }
  if (!manifest) return err(404, 'Transfer not found');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  if (chunkIndex === 0) {
    logEvent(env, {
      endpoint:    'download_tier',
      tier:        manifest.tier ?? 'free',
      status:      200,
      latency:     0,
      totalChunks: manifest.total_chunks ?? 0,
      totalBytes:  manifest.total_bytes  ?? 0,
    });
  }

  if (requiresPassphrase(manifest)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return err(401, 'Download token required');
    const { valid, uuid: tokenUuid } = await verifyDownloadToken(token, env.MINT_PRIVATE_KEY);
    if (!valid || tokenUuid !== uuid) return err(401, 'Invalid or expired download token');
  }

  if (chunkIndex === 0 && !manifest.download_initiated_at) {
    manifest.download_initiated_at = Math.floor(Date.now() / 1000);
    await putManifest(env.BUCKET, uuid, manifest);
  }

  const key = `${uuid}/${String(chunkIndex).padStart(4, '0')}`;
  const obj = await env.BUCKET.get(key, {
    range: request.headers.has('Range') ? parseRange(request.headers.get('Range')) : undefined,
  });
  if (!obj) return err(404, 'Chunk not found');

  const status = request.headers.has('Range') ? 206 : 200;
  const headers = new Headers({
    'Content-Type':    'application/octet-stream',
    'Cache-Control':   'private, no-store',
    'X-Transfer-UUID': uuid,
    'X-Chunk-Index':   String(chunkIndex),
    'X-File-Name':     manifest.file_name ?? `refueler-${uuid.slice(0, 8)}`,
  });

  if (obj.range) {
    headers.set('Content-Range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
  }

  return new Response(obj.body, { status, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — POST /webhook/stripe
// ─────────────────────────────────────────────────────────────────────────────
async function handleStripeWebhook(request, env) {
  let event;
  try {
    event = await verifyStripeWebhook(request, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook verify failed:', e.message);
    return new Response('Unauthorized', { status: 401 });
  }

  const type = event.type;
  console.log('Stripe event:', type);

  try {
    if (type === 'checkout.session.completed') {
      const session    = event.data.object;
      if (session.mode !== 'subscription') return new Response('ok');
      const customerId = session.customer;
      const email      = session.customer_details?.email ?? session.customer_email ?? '';
      const subId      = session.subscription;
      const tier       = await fetchTierFromSubscription(subId, env.STRIPE_SECRET_KEY);
      const periodEnd  = await fetchPeriodEnd(subId, env.STRIPE_SECRET_KEY);
      await upsertSubscriber(env, customerId, email, tier, 'active', periodEnd);

    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const tier       = tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
      const status = (sub.status === "active" || sub.status === "incomplete") ? "active" : "inactive";
      const periodEnd  = sub.current_period_end;
      let email = null;
      try {
        const custRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
        });
        if (custRes.ok) { const c = await custRes.json(); email = c.email ?? null; }
      } catch {}
      await upsertSubscriber(env, customerId, email, tier, status, periodEnd);

    } else if (type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await upsertSubscriber(env, sub.customer, null, 'free', 'cancelled', null, new Date().toISOString());
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout — POST /subscription/checkout
// ─────────────────────────────────────────────────────────────────────────────
async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { price_id, email } = body;
  if (!price_id || !email) return err(400, 'Missing price_id or email');

 const validPriceIds = [
    // live
    "price_1Ts7lsGlctwiB9U3hdtgChU2",
    "price_1Ts7sqGlctwiB9U3YRloCFfi",
    "price_1Ts7vIGlctwiB9U3kb3NCLue",
    "price_1Ts7xIGlctwiB9U3JyZB8Kwj",
    // test
    "price_1TtnCEGlctwiB9U3tErRazp2",
    "price_1TtnD0GlctwiB9U3UzFr27Zl",
    "price_1TtnDVGlctwiB9U3BYGRnWl6",
    "price_1TtnETGlctwiB9U3UJH3uaA"
  ];
  if (!validPriceIds.includes(price_id)) return err(400, 'Invalid price_id');

  try {
    const { clientSecret } = await createCheckoutSession(
      price_id, email,
      'https://share.refueler.io/upgrade?success=1',
      'https://share.refueler.io/upgrade?cancelled=1',
      env.STRIPE_SECRET_KEY
    );
    return json({ client_secret: clientSecret });
  } catch (e) {
    console.error('Checkout error:', e);
    return err(500, 'Checkout session creation failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscription status — GET /subscription/status
// ─────────────────────────────────────────────────────────────────────────────
async function handleSubscriptionStatus(request, env) {
  const url   = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return err(400, 'Missing email');

  const res = await supabaseFetch(env, 'GET', `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=tier,status,current_period_end&limit=1`);
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || rows[0].status === 'cancelled') {
    return json({ tier: 'free', status: 'inactive' });
  }

  const { tier, status, current_period_end } = rows[0];
  return json({ tier, status, current_period_end });
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal — POST /subscription/portal
// ─────────────────────────────────────────────────────────────────────────────
async function handlePortal(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { email } = body;
  if (!email) return err(400, 'Missing email');

  const res = await supabaseFetch(env, 'GET', `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=stripe_customer_id,status&limit=1`);
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || !rows[0].stripe_customer_id) {
    return err(404, 'No active subscription found for this email');
  }
  if (rows[0].status === 'cancelled') {
    return err(404, 'No active subscription found for this email');
  }

  const customerId = rows[0].stripe_customer_id;
  const portalRes  = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer:   customerId,
      return_url: 'https://share.refueler.io/upgrade.html',
    }).toString(),
  });

  if (!portalRes.ok) {
    const portalErr = await portalRes.json();
    console.error('Portal session error:', portalErr);
    return err(502, 'Could not create portal session');
  }

  const session = await portalRes.json();
  return json({ url: session.url });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin metrics — GET /admin/metrics
// X-Admin-Key protected.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminMetrics(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');
  const [data, aeData] = await Promise.all([
    fetchMetricsData(env),
    fetchAeMetricsData(env),
  ]);
  if (data._error) return err(data._status ?? 500, data._error);

  const issByTier = aeData?.credential_issuances_by_tier;
  if (issByTier && !aeData?.credential_issuances_note) {
    const totalIssuances = (issByTier.free ?? 0) + (issByTier.creative ?? 0) + (issByTier.max ?? 0);
    data.free_to_paid_conversion_rate = totalIssuances > 0
      ? parseFloat((data.paid_total / totalIssuances * 100).toFixed(2))
      : null;
    data.free_to_paid_conversion_issuances_30d = totalIssuances;
    data.free_to_paid_conversion_note =
      'Snapshot rate: active paid subscribers now ÷ total credential issuances last 30d. ' +
      'Under-counts if issuances span >30d before conversion. ' +
      'True cohort rate deferred to B9 (requires issuance→subscriber ETL).';
  } else {
    data.free_to_paid_conversion_rate = null;
    data.free_to_paid_conversion_issuances_30d = null;
    data.free_to_paid_conversion_note =
      aeData?.credential_issuances_note
        ? `AE issuances unavailable: ${aeData.credential_issuances_note}`
        : 'AE credential_issuances_by_tier not available.';
  }

  return json(data);
}

async function fetchMetricsData(env) {
  const TIER_MRR = { creative: 12, max: 24 };

  try {
    const countRes = await supabaseFetch(env, 'GET', '/rest/v1/subscribers?status=eq.active&select=tier');
    if (!countRes.ok) return err(502, 'Database unavailable');
    const activeRows = await countRes.json();

    const subscribersByTier = { free: 0, creative: 0, max: 0 };
    for (const row of activeRows) {
      const t = row.tier ?? 'free';
      subscribersByTier[t] = (subscribersByTier[t] ?? 0) + 1;
    }

    const mrrGbp =
      (subscribersByTier.creative ?? 0) * TIER_MRR.creative +
      (subscribersByTier.max      ?? 0) * TIER_MRR.max;

    const paidTotal = (subscribersByTier.creative ?? 0) + (subscribersByTier.max ?? 0);

    const now          = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const churnRes = await supabaseFetch(
      env, 'GET',
      `/rest/v1/subscribers?status=eq.cancelled&cancelled_at=gte.${encodeURIComponent(startOfMonth)}&select=stripe_customer_id`
    );
    if (!churnRes.ok) return err(502, 'Database unavailable');
    const cancelledMtd = (await churnRes.json()).length;

    const activeStartOfMonth = paidTotal + cancelledMtd;
    const churnRateMtd = activeStartOfMonth > 0
      ? parseFloat(((cancelledMtd / activeStartOfMonth) * 100).toFixed(2))
      : 0;

    const parseSbCount = (res) => {
      const cr = res.headers.get('Content-Range') ?? '';
      const m  = cr.match(/\/(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    };

    const [meltsRes, attemptsRes] = await Promise.all([
      supabaseFetch(env, 'GET', '/rest/v1/spent_tokens?select=serial',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
      supabaseFetch(env, 'GET', '/rest/v1/double_spend_attempts?select=id',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
    ]);

    const totalMelts    = meltsRes.ok    ? parseSbCount(meltsRes)    : null;
    const totalAttempts = attemptsRes.ok ? parseSbCount(attemptsRes) : null;

    let credentialUniquenessRate = null;
    let credentialUniquenessNote;

    if (totalMelts !== null && totalAttempts !== null) {
      const total = totalMelts + totalAttempts;
      credentialUniquenessRate = total > 0
        ? parseFloat((totalMelts / total).toFixed(4))
        : 1.0;
      credentialUniquenessNote =
        'Fraction of credential uses that were first-time (legitimate) melts. ' +
        '1.0 = no replay attacks observed. Excludes attacks failing verifyCredential() ' +
        'before the spent_tokens lookup (those return 401, not 409, and are not captured here).';
    } else {
      credentialUniquenessNote = 'Supabase count query failed — both spent_tokens and double_spend_attempts counts required.';
    }

    return {
      as_of: new Date().toISOString(),
      mrr_gbp: mrrGbp,
      mrr_note: 'Conservative floor: monthly plan prices used for all tiers. Yearly subscribers (£120/yr creative, £240/yr max) are under-counted by £2–4/mo each. Accurate MRR requires Stripe API interval lookup (dashboard layer, S22).',
      subscribers_by_tier: subscribersByTier,
      paid_total: paidTotal,
      churn_rate_mtd_pct: churnRateMtd,
      cancelled_mtd: cancelledMtd,
      active_start_of_month_approx: activeStartOfMonth,
      churn_note: 'Approximation: active_now + cancelled_mtd. Under-counts if any subscriber signed up and cancelled within the current calendar month.',
      credential_issuances: null,
      credential_issuances_note: 'Requires Cloudflare AE SQL API (external REST call with account token). Computed in dashboard layer (S22).',
      credential_uniqueness_rate: credentialUniquenessRate,
      credential_uniqueness_total_melts: totalMelts,
      credential_uniqueness_total_attempts: totalAttempts,
      credential_uniqueness_note: credentialUniquenessNote,
      r2_bytes_uploaded: null,
      r2_bytes_purged: null,
      r2_storage_note: 'Both require Cloudflare AE SQL API (external REST, not Worker-callable). Uploaded bytes: sum(doubles[4]) WHERE blob1=upload AND doubles[2]=0. Purged bytes: not measurable until R2 event notifications wired to AE (B4). Computed in dashboard layer (S22).',
      r2_chunk_retrieval_success_rate: null,
      r2_chunk_retrieval_note: "Requires Cloudflare AE SQL API. Query: 1 - (countIf(blob3 != '') / count()) WHERE blob1='download'. Computed in dashboard layer (S22).",
      zk_verification_rate: null,
      zk_verification_note: "R2 manifests not enumerable in aggregate from Worker. Add has_passphrase as blob4 to upload logEvent call (B4 scope). AE SQL once instrumented: countIf(blob4='true')/count() WHERE blob1='upload' AND doubles[2]=0.",
    };

  } catch (e) {
    console.error('Metrics error:', e);
    return { _error: 'Metrics query failed', _status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin AE metrics — GET /admin/ae-metrics
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminAeMetrics(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');
  return json(await fetchAeMetricsData(env));
}

async function fetchAeMetricsData(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_TOKEN) {
    return {
      error: 'CF_ACCOUNT_ID or CF_AE_TOKEN not set',
      credential_issuances_by_tier: null,
      r2_bytes_uploaded: null,
      r2_chunk_retrieval_success_rate: null,
    };
  }

  const AE_URL = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;

  async function aeQuery(sql) {
    const res = await fetch(AE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_AE_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AE SQL error ${res.status}: ${text}`);
    }
    return res.json();
  }

  const [issuanceResult, uploadResult, downloadResult, latencyResult, errorRateResult, clientErrorsResult] = await Promise.allSettled([

    aeQuery(`
      SELECT blob2 AS tier, count() AS issued
      FROM share_events
      WHERE blob1 = 'credential_issue'
      AND timestamp > NOW() - INTERVAL '30' DAY
      GROUP BY tier
    `),

    aeQuery(`
      SELECT sum(double5) AS total_bytes_uploaded
      FROM share_events
      WHERE blob1 = 'upload'
      AND double3 = 0
      AND timestamp > NOW() - INTERVAL '90' DAY
    `),

    aeQuery(`
      SELECT
        countIf(double2 = 200) AS successful_chunks,
        count() AS total_chunks,
        countIf(double2 = 200) / count() AS success_rate
      FROM share_events
      WHERE blob1 = 'download'
      AND timestamp > NOW() - INTERVAL '1' DAY
    `),

    aeQuery(`
      SELECT
        blob1 AS endpoint,
        quantilesTDigest(0.95)(double1)[1] AS p95_ms,
        quantilesTDigest(0.99)(double1)[1] AS p99_ms,
        count() AS requests
      FROM share_events
      WHERE timestamp > NOW() - INTERVAL '1' DAY
      GROUP BY endpoint
      ORDER BY p95_ms DESC
    `),

    aeQuery(`
      SELECT
        blob1 AS endpoint,
        countIf(double2 >= 500) AS error_count,
        count() AS total_count,
        countIf(double2 >= 500) / count() AS error_rate
      FROM share_events
      WHERE timestamp > NOW() - INTERVAL '1' DAY
      GROUP BY endpoint
      ORDER BY error_rate DESC
    `),

    aeQuery(`
      SELECT count() AS error_count
      FROM share_events
      WHERE blob1 = 'client_error'
      AND timestamp > NOW() - INTERVAL '1' DAY
    `),
  ]);

  let credentialIssuancesByTier = null;
  let credentialIssuancesNote = null;
  if (issuanceResult.status === 'fulfilled') {
    const rows = issuanceResult.value?.data ?? [];
    credentialIssuancesByTier = { free: 0, creative: 0, max: 0 };
    for (const row of rows) {
      const tier = row.tier ?? 'free';
      credentialIssuancesByTier[tier] = parseInt(row.issued ?? 0, 10);
    }
  } else {
    credentialIssuancesNote = `AE query failed: ${issuanceResult.reason?.message}`;
  }

  let r2BytesUploaded = null;
  let r2BytesNote = null;
  if (uploadResult.status === 'fulfilled') {
    const rows = uploadResult.value?.data ?? [];
    r2BytesUploaded = parseFloat(rows[0]?.total_bytes_uploaded ?? 0);
  } else {
    r2BytesNote = `AE query failed: ${uploadResult.reason?.message}`;
  }

  let r2ChunkSuccessRate = null;
  let r2ChunkSuccessfulChunks = null;
  let r2ChunkTotalChunks = null;
  let r2ChunkNote = null;
  if (downloadResult.status === 'fulfilled') {
    const rows = downloadResult.value?.data ?? [];
    if (rows.length > 0) {
      r2ChunkSuccessRate        = parseFloat((rows[0]?.success_rate ?? 0).toFixed(4));
      r2ChunkSuccessfulChunks   = parseInt(rows[0]?.successful_chunks ?? 0, 10);
      r2ChunkTotalChunks        = parseInt(rows[0]?.total_chunks ?? 0, 10);
    } else {
      r2ChunkSuccessRate      = null;
      r2ChunkNote             = 'No download events in last 24h — rate unavailable';
    }
  } else {
    r2ChunkNote = `AE query failed: ${downloadResult.reason?.message}`;
  }

  let latencyByEndpoint = null;
  let latencyNote = null;
  if (latencyResult.status === 'fulfilled') {
    const rows = latencyResult.value?.data ?? [];
    latencyByEndpoint = {};
    for (const row of rows) {
      latencyByEndpoint[row.endpoint] = {
        p95_ms: parseFloat((row.p95_ms ?? 0).toFixed(1)),
        p99_ms: parseFloat((row.p99_ms ?? 0).toFixed(1)),
        requests: parseInt(row.requests ?? 0, 10),
      };
    }
    if (rows.length === 0) latencyNote = 'No events in last 24h';
  } else {
    latencyNote = `AE query failed: ${latencyResult.reason?.message}`;
  }

  let errorRateByEndpoint = null;
  let errorRateNote = null;
  if (errorRateResult.status === 'fulfilled') {
    const rows = errorRateResult.value?.data ?? [];
    errorRateByEndpoint = {};
    for (const row of rows) {
      errorRateByEndpoint[row.endpoint] = {
        error_count: parseInt(row.error_count ?? 0, 10),
        total_count: parseInt(row.total_count ?? 0, 10),
        error_rate: parseFloat((row.error_rate ?? 0).toFixed(4)),
      };
    }
    if (rows.length === 0) errorRateNote = 'No events in last 24h';
  } else {
    errorRateNote = `AE query failed: ${errorRateResult.reason?.message}`;
  }

  let clientErrors24h = null;
  let clientErrorsNote = null;
  if (clientErrorsResult.status === 'fulfilled') {
    const rows = clientErrorsResult.value?.data ?? [];
    clientErrors24h = parseInt(rows[0]?.error_count ?? 0, 10);
  } else {
    clientErrorsNote = `AE query failed: ${clientErrorsResult.reason?.message}`;
  }

  return {
    as_of: new Date().toISOString(),
    window_notes: {
      credential_issuances: 'Rolling 30 days',
      r2_bytes_uploaded: 'Rolling 90 days (chunk-0 events only; total_bytes logged on first chunk per transfer)',
      r2_chunk_retrieval_success_rate: 'Rolling 24 hours',
      latency: 'Rolling 24 hours — p95/p99 per endpoint',
      error_rate: 'Rolling 24 hours — 5xx / total per endpoint',
    },
    credential_issuances_by_tier: credentialIssuancesByTier,
    credential_issuances_note: credentialIssuancesNote,
    r2_bytes_uploaded: r2BytesUploaded,
    r2_bytes_purged: null,
    r2_bytes_note: r2BytesNote ?? 'r2_bytes_purged not measurable until R2 event notifications wired to AE (B4 scope)',
    r2_chunk_retrieval_success_rate: r2ChunkSuccessRate,
    r2_chunk_successful_chunks: r2ChunkSuccessfulChunks,
    r2_chunk_total_chunks: r2ChunkTotalChunks,
    r2_chunk_note: r2ChunkNote,
    latency_by_endpoint: latencyByEndpoint,
    latency_note: latencyNote,
    error_rate_by_endpoint: errorRateByEndpoint,
    error_rate_note: errorRateNote,
    client_errors_24h: clientErrors24h,
    client_errors_24h_note: clientErrorsNote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin snapshot — GET /admin/snapshot
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminSnapshot(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  const [metrics, ae] = await Promise.all([
    fetchMetricsData(env),
    fetchAeMetricsData(env),
  ]);

  if (metrics._error) return err(metrics._status ?? 500, metrics._error);

  let workerErrorRate = null;
  const errs = ae.error_rate_by_endpoint;
  if (errs && !ae.error_rate_note) {
    let totalErrors = 0, totalReqs = 0;
    for (const ep of Object.values(errs)) {
      totalErrors += ep.error_count;
      totalReqs   += ep.total_count;
    }
    workerErrorRate = totalReqs > 0
      ? parseFloat((totalErrors / totalReqs).toFixed(4))
      : 0;
  }

  const snapshot = {
    generated_at:             new Date().toISOString(),
    mrr_gbp:                  metrics.mrr_gbp ?? null,
    paid_subscribers:         metrics.paid_total ?? null,
    credential_uniqueness_rate: metrics.credential_uniqueness_rate ?? null,
    p95_upload_latency_ms:    ae.latency_by_endpoint?.upload?.p95_ms ?? null,
    p95_download_latency_ms:  ae.latency_by_endpoint?.download?.p95_ms ?? null,
    worker_error_rate:        workerErrorRate,
  };

  return json(snapshot);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe helpers
// ─────────────────────────────────────────────────────────────────────────────
async function fetchTierFromSubscription(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return 'free';
  const sub = await res.json();
  return tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
}

async function fetchPeriodEnd(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const sub = await res.json();
  return sub.current_period_end ?? null;
}

function tierFromPriceKey(lookupKey) {
  if (lookupKey.includes('max'))      return 'max';
  if (lookupKey.includes('creative')) return 'creative';
  return 'free';
}

async function upsertSubscriber(env, stripeCustomerId, email, tier, status, currentPeriodEnd, cancelledAt = null) {
  const payload = {
    stripe_customer_id: stripeCustomerId,
    tier,
    status,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (email) payload.email = email;
  if (cancelledAt) payload.cancelled_at = cancelledAt;

  const res = await supabaseFetch(env, 'POST', '/rest/v1/subscribers?on_conflict=stripe_customer_id', payload, {
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  });
  if (!res.ok) {
    console.error('Supabase upsert failed:', await res.text());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase fetch
// ─────────────────────────────────────────────────────────────────────────────
async function supabaseFetch(env, method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${env.SUPABASE_URL}${path}`, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
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

function addCors(response, request) {
  const headers    = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

function parseRange(rangeHeader) {
  const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  const offset = parseInt(m[1], 10);
  const end    = m[2] ? parseInt(m[2], 10) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}
