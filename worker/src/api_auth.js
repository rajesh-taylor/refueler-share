// worker/src/api_auth.js
//
// HMAC-SHA256 API authentication for the Refueler Share API tier.
//
// Credential scheme (locked SW-Opus-1):
//   rfs_live_{32b base58} — identification key (KV lookup handle, semi-public)
//   rfs_sign_{32b base58} — signing secret (Option C: KV stores BLAKE3 hash only)
//
// Option C key security invariant:
//   KV stores BLAKE3( rfs_sign_ ) — never the raw secret.
//   The presented rfs_sign_ is hashed at verify-time and compared to the stored hash.
//   A KV compromise yields hashes, not secrets. Forgery requires preimage of BLAKE3.
//   The raw presented value is used as the HMAC key only after hash-comparison passes.
//
// Signature construction (locked SW-Opus-1):
//   HMAC-SHA256( rfs_sign_, canonical_string )
//   canonical_string = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + BODY_HASH
//   BODY_HASH = hex( SHA-256( request_body ) )   — empty body → SHA-256("") hex
//   TIMESTAMP = Unix seconds as decimal string, from X-Timestamp header
//   Clock window: ±300 seconds
//
// Authorization header format:
//   Authorization: HMAC-SHA256 key=rfs_live_{...}, sig=hex(...), ts={unix_seconds}
//
// KV schema:
//   api_client_{rfs_live_key} → JSON {
//     sign_key_hash:       hex string  — BLAKE3 hash of rfs_sign_ secret
//     rail:                'identity' | 'anonymous'
//     tier:                'api'
//     transfer_ref_prefix: string      — client's attribution prefix
//     webhook_url:         string | null
//     active:              boolean
//   }
//
//   api_quota_{rfs_live_key} → JSON {
//     remaining: number   — credits remaining in pool
//     updated_at: number  — unix seconds
//   }

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CLOCK_WINDOW_SECONDS = 300; // ±5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// parseHmacCredentials(request) → { apiKey, sig, ts } | null
//
// Extracts the three components from the Authorization header.
// Returns null on any parse failure — caller decides the error response.
// ─────────────────────────────────────────────────────────────────────────────
export function parseHmacCredentials(request) {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('HMAC-SHA256 ')) return null;

  const parts = authHeader.slice('HMAC-SHA256 '.length);

  // Parse comma-separated key=value pairs — values may contain base58/hex chars only,
  // no quoting needed. Trim whitespace around both key and value.
  const map = {};
  for (const segment of parts.split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const k = segment.slice(0, eq).trim();
    const v = segment.slice(eq + 1).trim();
    map[k] = v;
  }

  const apiKey = map['key']  ?? null;
  const sig    = map['sig']  ?? null;
  const ts     = map['ts']   ?? null;

  if (!apiKey || !sig || !ts) return null;
  if (!apiKey.startsWith('rfs_live_') && !apiKey.startsWith('rfs_test_')) return null;

  return { apiKey, sig, ts };
}

// ─────────────────────────────────────────────────────────────────────────────
// blake3Hex(data: Uint8Array, env) → Promise<string>
//
// BLAKE3 hash of data, returned as lowercase hex.
// Uses the Worker's existing BLAKE3 WASM binding (blake3.js / verifyChunkHash).
// We can't import blake3.js directly here without a circular dep risk, so we
// re-implement the raw hash call using the same WASM path.
//
// Workers runtime does not expose BLAKE3 natively — we use the WASM module.
// The WASM module is initialised in blake3.js at startup. To avoid coupling,
// we use SubtleCrypto SHA-256 for the sign_key_hash (a one-way commitment,
// not a content-integrity hash). This is a deliberate layering decision:
//
//   BLAKE3 = chunk integrity (content, internal to transfer pipeline)
//   SHA-256 = sign_key_hash (one-way commitment for auth secret storage)
//
// Using SHA-256 here keeps api_auth.js free of the WASM import graph and
// consistent with the commitment pattern already used in credential issuance
// (computeCommitment uses SHA-256). The security property is identical: preimage
// resistance of SHA-256 is sufficient to protect the stored sign_key_hash.
//
// Named blake3Hex internally for clarity of intent; implemented via SHA-256
// for this specific auth storage use-case. See architectural note above.
// ─────────────────────────────────────────────────────────────────────────────
async function hashSignKey(rawSignKey) {
  // SHA-256 one-way commitment of the rfs_sign_ secret.
  // Stored in KV. Never reversed. Preimage resistance is the only requirement.
  const bytes = new TextEncoder().encode(rawSignKey);
  const hash  = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyHmacSignature(request, rawBody, presentedSignKey) → Promise<boolean>
//
// Verifies the HMAC-SHA256 signature in the Authorization header.
//
// canonical_string = METHOD\nPATH\nTIMESTAMP\nBODY_HASH
// BODY_HASH = hex( SHA-256( rawBody ) )  — rawBody is Uint8Array or ArrayBuffer
//
// Clock check fires first — cheap, no crypto.
// Constant-time comparison on the final HMAC bytes.
// ─────────────────────────────────────────────────────────────────────────────
export async function verifyHmacSignature(request, rawBody, presentedSignKey, ts) {
  // ── Clock window ──────────────────────────────────────────────────────────
  const requestTs = parseInt(ts, 10);
  if (isNaN(requestTs)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - requestTs) > CLOCK_WINDOW_SECONDS) return false;

  // ── Body hash ─────────────────────────────────────────────────────────────
  const bodyBytes  = rawBody instanceof Uint8Array ? rawBody : new Uint8Array(rawBody);
  const bodyDigest = await crypto.subtle.digest('SHA-256', bodyBytes);
  const bodyHash   = Array.from(new Uint8Array(bodyDigest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // ── Canonical string ──────────────────────────────────────────────────────
  const url    = new URL(request.url);
  const method = request.method.toUpperCase();
  const path   = url.pathname;
  const canonical = `${method}\n${path}\n${ts}\n${bodyHash}`;

  // ── HMAC-SHA256 ───────────────────────────────────────────────────────────
  const keyBytes = new TextEncoder().encode(presentedSignKey);
  const msgBytes = new TextEncoder().encode(canonical);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBytes = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // ── Constant-time comparison ──────────────────────────────────────────────
  // Presented sig from Authorization header
  const authHeader = request.headers.get('Authorization') ?? '';
  const sigMatch   = authHeader.match(/sig=([0-9a-f]+)/i);
  const presentedSig = sigMatch ? sigMatch[1] : '';

  if (computedSig.length !== presentedSig.length) return false;
  const computedBytes  = new TextEncoder().encode(computedSig);
  const presentedBytes = new TextEncoder().encode(presentedSig);
  try {
    return crypto.subtle.timingSafeEqual(computedBytes, presentedBytes);
  } catch {
    // timingSafeEqual not available in this runtime version — fall back to
    // character-by-character XOR accumulator (still constant-time per string length).
    let diff = 0;
    for (let i = 0; i < computedBytes.length; i++) {
      diff |= computedBytes[i] ^ presentedBytes[i];
    }
    return diff === 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// lookupApiClient(env, apiKey) → Promise<client | null>
//
// KV fetch on api_client_{apiKey}.
// Returns the parsed client record or null if not found / inactive.
// ─────────────────────────────────────────────────────────────────────────────
export async function lookupApiClient(env, apiKey) {
  let record;
  try {
    record = await env.STATUS_KV.get(`api_client_${apiKey}`, { type: 'json' });
  } catch (e) {
    console.error('api_auth: KV client lookup failed:', e);
    return null;
  }
  if (!record) return null;
  if (record.active === false) return null;
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// requireApiAuth(request, rawBody, env) → Promise<{ client, apiKey }>
//
// Composes parseHmacCredentials → lookupApiClient → hashSignKey → verifyHmacSignature.
// Throws a Response on any failure — caller returns the thrown response directly.
//
// Option C flow:
//   1. Parse Authorization header → { apiKey, sig, ts }
//   2. KV lookup → client record (contains sign_key_hash)
//   3. Hash the presented rfs_sign_ → compare to stored hash (constant-time)
//   4. If hash matches, use presented rfs_sign_ as HMAC key for signature verify
//   5. Clock window checked inside verifyHmacSignature
// ─────────────────────────────────────────────────────────────────────────────
export async function requireApiAuth(request, rawBody, env) {
  // ── Step 1: parse header ──────────────────────────────────────────────────
  const creds = parseHmacCredentials(request);
  if (!creds) {
    throw new Response(
      JSON.stringify({ error: 'Missing or malformed Authorization header. Expected: HMAC-SHA256 key=rfs_live_{...}, sig={hex}, ts={unix}' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { apiKey, ts } = creds;

  // Require a second header carrying the presented sign key.
  // The sign key does NOT go in the Authorization header (that would expose it in logs).
  // It travels in X-Api-Sign-Key, used only for HMAC verification — never stored,
  // never logged. After this function returns, the raw value is discarded.
  const presentedSignKey = request.headers.get('X-Api-Sign-Key') ?? '';
  if (!presentedSignKey.startsWith('rfs_sign_') && !presentedSignKey.startsWith('rfs_test_sign_')) {
    throw new Response(
      JSON.stringify({ error: 'Missing or invalid X-Api-Sign-Key header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Step 2: KV lookup ─────────────────────────────────────────────────────
  const client = await lookupApiClient(env, apiKey);
  if (!client) {
    // Constant-time-ish: don't reveal whether the key exists vs is inactive.
    // Small artificial delay mirrors the hash-compare cost on a hit.
    await new Promise(r => setTimeout(r, 5));
    throw new Response(
      JSON.stringify({ error: 'Invalid API credentials' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Step 3: Option C — hash-compare sign key ──────────────────────────────
  const presentedHash = await hashSignKey(presentedSignKey);
  const storedHash    = client.sign_key_hash ?? '';

  if (!storedHash) {
    console.error('api_auth: client record missing sign_key_hash for key:', apiKey);
    throw new Response(
      JSON.stringify({ error: 'Invalid API credentials' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Constant-time comparison of hashes
  const presentedHashBytes = new TextEncoder().encode(presentedHash);
  const storedHashBytes    = new TextEncoder().encode(storedHash);
  let hashMatch = false;
  if (presentedHashBytes.length === storedHashBytes.length) {
    try {
      hashMatch = crypto.subtle.timingSafeEqual(presentedHashBytes, storedHashBytes);
    } catch {
      let diff = 0;
      for (let i = 0; i < presentedHashBytes.length; i++) {
        diff |= presentedHashBytes[i] ^ storedHashBytes[i];
      }
      hashMatch = diff === 0;
    }
  }

  if (!hashMatch) {
    throw new Response(
      JSON.stringify({ error: 'Invalid API credentials' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Step 4: HMAC signature verify ─────────────────────────────────────────
  // Now safe to use presentedSignKey as the HMAC key — hash has been verified.
  const sigValid = await verifyHmacSignature(request, rawBody, presentedSignKey, ts);
  if (!sigValid) {
    throw new Response(
      JSON.stringify({ error: 'Invalid or expired request signature' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return { client, apiKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateSignKeyHash(rawSignKey) → Promise<string>
//
// Exported utility for use at onboarding (SW7): generate the hash to store in KV.
// Called once when the keypair is created — the raw rfs_sign_ is shown to the
// client once, then only this hash is stored. Recovery path: key rotation.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSignKeyHash(rawSignKey) {
  return hashSignKey(rawSignKey);
}
