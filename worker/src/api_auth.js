// worker/src/api_auth.js
//
// HMAC-SHA256 API authentication for the Refueler Share API tier.
//
// Credential scheme (locked SW-Opus-1):
//   rfs_live_{32b base58} — identification key (lookup handle, semi-public)
//   rfs_sign_{32b base58} — signing secret (Option C: only SHA-256 hash stored)
//   Sandbox: rfs_test_live_ / rfs_test_sign_, rows with sandbox = true.
//
// Option C key security invariant:
//   The store holds SHA-256( rfs_sign_ ) — never the raw secret.
//   The presented rfs_sign_ is hashed at verify-time and compared to the stored hash.
//   A store leak yields hashes, not secrets. Forgery requires preimage of SHA-256.
//   The raw presented value is used as the HMAC key only after hash-comparison passes.
//
// Store (KV-Fix-2 · 9 Oct 2026): Supabase `api_keys`, looked up by SHA-256(live key)
// via api_store.js (≤ 60 s isolate cache, so revocation bites within 60 s). Nothing
// here reads KV: a KV writer could forge a client or revive a revoked key (B12-SR X1).
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
// Client record returned by requireApiAuth:
//   { sign_key_hash, org_account_id, rail, sandbox, tier, created_at, expires_at }
//   tier = TIERS.CHARTERED for production keys, 'sandbox' for sandbox keys.
//   Credit pools: api_credit_pools (identity rail), via api_store.js. The anonymous
//   rail has no pool and no row (closed until B7; table CHECK refuses it).

'use strict';

import { TIERS } from './tiers.js';
import { lookupApiKey, StoreUnavailable } from './api_store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CLOCK_WINDOW_SECONDS = 300; // ±5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// sha256Hex(input: string | Uint8Array) → Promise<string>
//
// SHA-256 one-way hash, returned as lowercase hex.
// Used for:
//   - key lookup handle:        sha256Hex(rfs_live_key)
//   - sign_key_hash storage:    sha256Hex(rfs_sign_key)
//   - body hash in HMAC canonical string
//
// Exported so onboarding (POST /api/v1/admin/api-client) stores the same hash
// that lookupApiClient() uses at verify-time.
// ─────────────────────────────────────────────────────────────────────────────
export async function sha256Hex(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : input;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// hashSignKey(rawSignKey: string) → Promise<string>
//
// SHA-256 one-way commitment of the rfs_sign_ secret.
// Stored as sign_key_hash. Never reversed.
// Module-private — callers use generateSignKeyHash() export below.
// ─────────────────────────────────────────────────────────────────────────────
async function hashSignKey(rawSignKey) {
  return sha256Hex(rawSignKey);
}

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

  // Parse comma-separated key=value pairs — values contain base58/hex chars only,
  // no quoting needed. Trim whitespace around both key and value.
  const map = {};
  for (const segment of parts.split(',')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const k = segment.slice(0, eq).trim();
    const v = segment.slice(eq + 1).trim();
    map[k] = v;
  }

  const apiKey = map['key'] ?? null;
  const sig    = map['sig'] ?? null;
  const ts     = map['ts']  ?? null;

  if (!apiKey || !sig || !ts) return null;
  if (!apiKey.startsWith('rfs_live_') && !apiKey.startsWith('rfs_test_')) return null;

  return { apiKey, sig, ts };
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyHmacSignature(request, rawBody, presentedSignKey, ts) → Promise<boolean>
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
  const bodyHash   = await sha256Hex(bodyBytes);

  // ── Canonical string ──────────────────────────────────────────────────────
  const url       = new URL(request.url);
  const method    = request.method.toUpperCase();
  const path      = url.pathname;
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

  const sigBytes    = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // ── Constant-time comparison ──────────────────────────────────────────────
  const authHeader   = request.headers.get('Authorization') ?? '';
  const sigMatch     = authHeader.match(/sig=([0-9a-f]+)/i);
  const presentedSig = sigMatch ? sigMatch[1] : '';

  if (computedSig.length !== presentedSig.length) return false;
  const computedBytes  = new TextEncoder().encode(computedSig);
  const presentedBytes = new TextEncoder().encode(presentedSig);
  try {
    return crypto.subtle.timingSafeEqual(computedBytes, presentedBytes);
  } catch {
    // timingSafeEqual not available in this runtime version — XOR accumulator fallback.
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
// Supabase lookup on SHA-256(apiKey) (cached ≤ 60 s). null = unknown, revoked or
// expired. Throws StoreUnavailable when Supabase cannot answer — never falls
// back to KV.
// ─────────────────────────────────────────────────────────────────────────────
export async function lookupApiClient(env, apiKey) {
  const row = await lookupApiKey(env, await sha256Hex(apiKey));
  if (!row) return null;
  return {
    sign_key_hash:  row.sign_key_hash,
    org_account_id: row.org_account_id,
    rail:           row.rail,
    sandbox:        row.sandbox === true,
    tier:           row.sandbox === true ? 'sandbox' : TIERS.CHARTERED,
    created_at:     row.created_at ?? null,
    expires_at:     row.expires_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// requireApiAuth(request, rawBody, env, { sandbox }) → Promise<{ client, apiKey }>
//
// Composes parseHmacCredentials → lookupApiClient → hashSignKey → verifyHmacSignature.
// Throws a Response on any failure — caller returns the thrown response directly.
//
// sandbox: false (default) admits production keys only; true admits sandbox keys
// only (the /api/v1/sandbox/* routes). Key prefixes and the stored sandbox flag
// must all agree, or 401 — a sandbox key never reaches a production route.
//
// Returns { client, apiKey } on success (client shape: see top of file).
//
// Option C flow:
//   1. Parse Authorization header → { apiKey, sig, ts }
//   2. Supabase lookup on hashed key (≤ 60 s cache) → client record
//   3. Hash the presented rfs_sign_ → compare to stored hash (constant-time)
//   4. If hash matches, use presented rfs_sign_ as HMAC key for signature verify
//   5. Clock window checked inside verifyHmacSignature
// Supabase unreachable → 503, never a KV fallback.
// ─────────────────────────────────────────────────────────────────────────────
function authFail(status, error) {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function requireApiAuth(request, rawBody, env, { sandbox = false } = {}) {
  // ── Step 1: parse header ──────────────────────────────────────────────────
  const creds = parseHmacCredentials(request);
  if (!creds) {
    throw new Response(
      JSON.stringify({
        error: 'Missing or malformed Authorization header. Expected: HMAC-SHA256 key=rfs_live_{...}, sig={hex}, ts={unix}',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { apiKey, ts } = creds;

  // The sign key travels in X-Api-Sign-Key, NOT in Authorization.
  // Authorization is logged by proxies and dashboards; the sign key must not appear there.
  const presentedSignKey = request.headers.get('X-Api-Sign-Key') ?? '';
  const livePrefix = sandbox ? 'rfs_test_live_' : 'rfs_live_';
  const signPrefix = sandbox ? 'rfs_test_sign_' : 'rfs_sign_';
  if (!presentedSignKey.startsWith(signPrefix)) {
    throw authFail(401, 'Missing or invalid X-Api-Sign-Key header');
  }
  if (!apiKey.startsWith(livePrefix)) {
    throw authFail(401, 'Invalid API credentials');
  }

  // ── Step 2: Supabase lookup (hashed key, ≤ 60 s isolate cache) ───────────
  let client;
  try {
    client = await lookupApiClient(env, apiKey);
  } catch (e) {
    if (e instanceof StoreUnavailable) {
      console.error('api_auth: key store unavailable:', e.message);
      throw authFail(503, 'Authentication temporarily unavailable — please retry');
    }
    throw e;
  }
  if (!client || client.sandbox !== sandbox) {
    // Constant-time-ish: artificial delay mirrors hash-compare cost on a hit.
    await new Promise(r => setTimeout(r, 5));
    throw authFail(401, 'Invalid API credentials');
  }

  // ── Step 3: Option C — hash-compare sign key ──────────────────────────────
  const presentedHash = await hashSignKey(presentedSignKey);
  const storedHash    = client.sign_key_hash ?? '';

  if (!storedHash) {
    console.error('api_auth: client record missing sign_key_hash');
    throw new Response(
      JSON.stringify({ error: 'Invalid API credentials' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

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
  // Safe to use presentedSignKey as HMAC key — hash verified above.
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
// Exported utility for onboarding: the hash stored in api_keys.sign_key_hash.
// Called once when the keypair is created — the raw rfs_sign_ is shown to the
// client once, then only this hash is stored server-side.
// Recovery path: admin revoke + new client (POST /api/v1/keys/rotate is specified, not built).
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSignKeyHash(rawSignKey) {
  return hashSignKey(rawSignKey);
}
