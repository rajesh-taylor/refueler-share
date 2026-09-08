// worker/src/api_auth.js
//
// HMAC-SHA256 API authentication for the Refueler Share API tier.
//
// Credential scheme (locked SW-Opus-1):
//   rfs_live_{32b base58} — identification key (KV lookup handle, semi-public)
//   rfs_sign_{32b base58} — signing secret (Option C: KV stores SHA-256 hash only)
//
// Option C key security invariant:
//   KV stores SHA-256( rfs_sign_ ) — never the raw secret.
//   The presented rfs_sign_ is hashed at verify-time and compared to the stored hash.
//   A KV compromise yields hashes, not secrets. Forgery requires preimage of SHA-256.
//   The raw presented value is used as the HMAC key only after hash-comparison passes.
//
// KV lookup key hardening (SW2c):
//   KV key = api_client_{ SHA-256( rfs_live_key ) }  — NOT api_client_{rfs_live_key}
//   Rationale: the live key appears in the Authorization header on every request and
//   could surface in Cloudflare dashboard logs, AE events, or console.error paths.
//   Hashing the lookup key means KV key names never contain a recognisable rfs_live_
//   string. An attacker who knows the live key can still compute the KV lookup key
//   (SHA-256 is not a secret), but the key does not leak passively into infrastructure
//   logs. sha256Hex() is exported so onboarding (SW7) writes the same hashed key.
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
//   api_client_{ sha256hex(rfs_live_key) } → JSON {
//     sign_key_hash:       hex string  — SHA-256 hash of rfs_sign_ secret
//     rail:                'identity' | 'anonymous'
//     tier:                'api'
//     transfer_ref_prefix: string      — client's attribution prefix
//     webhook_url:         string | null
//     active:              boolean
//   }
//
//   api_quota_{ sha256hex(rfs_live_key) } → JSON {   ← identity rail only
//     remaining: number   — credits remaining in pool
//     updated_at: number  — unix seconds
//   }
//
//   Anonymous rail has NO api_quota_ KV record. Quota is client-held bearer
//   Cashu tokens (blind-signed capability atoms). The spent-token ledger
//   (api_spent_tokens Supabase table) tracks consumption. No server-side balance.

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CLOCK_WINDOW_SECONDS = 300; // ±5 minutes

// ─────────────────────────────────────────────────────────────────────────────
// sha256Hex(input: string | Uint8Array) → Promise<string>
//
// SHA-256 one-way hash, returned as lowercase hex.
// Used for:
//   - KV lookup key derivation: sha256Hex(rfs_live_key)
//   - sign_key_hash storage:    sha256Hex(rfs_sign_key)
//   - body hash in HMAC canonical string
//
// Exported for use at onboarding (SW7) to write KV records under the same
// hashed key format that lookupApiClient() uses at verify-time.
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
// Stored in KV as sign_key_hash. Never reversed.
// Module-private — callers use generateSignKeyHash() export below.
// ─────────────────────────────────────────────────────────────────────────────
async function hashSignKey(rawSignKey) {
  return sha256Hex(rawSignKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// kvClientKey(apiKey: string) → Promise<string>
//
// Derives the KV lookup key for a given rfs_live_ key.
// KV key = "api_client_" + sha256Hex(apiKey)
//
// Used by lookupApiClient() at verify-time and by SW7 onboarding at write-time.
// Exported so onboarding tooling can produce the correct key without duplicating
// the derivation logic.
// ─────────────────────────────────────────────────────────────────────────────
export async function kvClientKey(apiKey) {
  return `api_client_${await sha256Hex(apiKey)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// kvQuotaKey(apiKey: string) → Promise<string>
//
// Derives the KV quota key for a given rfs_live_ key.
// KV key = "api_quota_" + sha256Hex(apiKey)
//
// Identity rail only. Anonymous rail has no quota KV record.
// Exported for onboarding tooling and admin top-up scripts.
// ─────────────────────────────────────────────────────────────────────────────
export async function kvQuotaKey(apiKey) {
  return `api_quota_${await sha256Hex(apiKey)}`;
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
// KV fetch on api_client_{ sha256Hex(apiKey) }.
// The KV key is a hash of the live key — never the raw rfs_live_ string.
// Returns the parsed client record or null if not found / inactive.
// ─────────────────────────────────────────────────────────────────────────────
export async function lookupApiClient(env, apiKey) {
  const key = await kvClientKey(apiKey);
  let record;
  try {
    record = await env.STATUS_KV.get(key, { type: 'json' });
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
// Returns { client, apiKey } on success.
//   client.rail  → 'identity' | 'anonymous'  — caller branches on this
//   client.tier  → 'api'
//   client.*     → full KV record
//
// Option C flow:
//   1. Parse Authorization header → { apiKey, sig, ts }
//   2. KV lookup on hashed key → client record (contains sign_key_hash)
//   3. Hash the presented rfs_sign_ → compare to stored hash (constant-time)
//   4. If hash matches, use presented rfs_sign_ as HMAC key for signature verify
//   5. Clock window checked inside verifyHmacSignature
// ─────────────────────────────────────────────────────────────────────────────
export async function requireApiAuth(request, rawBody, env) {
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
  if (
    !presentedSignKey.startsWith('rfs_sign_') &&
    !presentedSignKey.startsWith('rfs_test_sign_')
  ) {
    throw new Response(
      JSON.stringify({ error: 'Missing or invalid X-Api-Sign-Key header' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Step 2: KV lookup (hashed key) ───────────────────────────────────────
  const client = await lookupApiClient(env, apiKey);
  if (!client) {
    // Constant-time-ish: artificial delay mirrors hash-compare cost on a hit.
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
// Exported utility for onboarding (SW7): generate the hash to store in KV.
// Called once when the keypair is created — the raw rfs_sign_ is shown to the
// client once, then only this hash is stored server-side.
// Recovery path: key rotation via POST /api/v1/keys/rotate.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSignKeyHash(rawSignKey) {
  return hashSignKey(rawSignKey);
}
