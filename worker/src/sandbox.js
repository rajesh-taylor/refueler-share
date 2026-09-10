// worker/src/sandbox.js
//
// SW6 — API sandbox environment.
//
// Purpose: lets future API clients walk both rails with real HMAC signatures,
// real request/response shapes, and real Worker logic — without touching
// production cargo, production quota, or the production credit ledger.
//
// Intentionally observable (non-anonymous by design):
//   - All sandbox requests receive X-Refueler-Sandbox: true in every response.
//   - Sandbox AE events are tagged blob2='sandbox' so they never pollute
//     production latency/error metrics.
//   - The sandbox itself states plainly: "do not send real cargo here."
//
// Key scheme (GitHub-scanner safe):
//   rfs_test_live_{32 base58}  — identification (KV lookup handle)
//   rfs_test_sign_{32 base58}  — signing secret (Option C: KV stores SHA-256 only)
//
//   These prefixes are distinct from production rfs_live_ / rfs_sign_.
//   parseHmacCredentials() in api_auth.js already accepts both rfs_live_ and
//   rfs_test_live_ prefixes; sign key validation similarly accepts rfs_test_sign_.
//
// KV layout (all under STATUS_KV binding):
//   sandbox_client_{sha256hex(rfs_test_live_key)}  → {
//     sign_key_hash:    string    — SHA-256 of rfs_test_sign_ key
//     rail:             'identity' | 'anonymous'
//     tier:             'sandbox'
//     active:           true
//     created_at:       unix seconds
//     transfer_ref_prefix: string
//   }
//   sandbox_quota_{sha256hex(rfs_test_live_key)} → {
//     remaining:  number     — test credits remaining (identity rail)
//     total:      number     — initial credit grant
//     updated_at: unix seconds
//   }
//   sandbox_meta_{sha256hex(rfs_test_live_key)} → {
//     live_key:     string   — rfs_test_live_ (stored so dashboard can display it)
//     rail:         string
//     created_at:   unix seconds
//     last_reset:   unix seconds | null
//   }
//
// Anonymous-rail sandbox:
//   No quota KV record — mirrors production invariant exactly.
//   "Credits" are the test Cashu tokens returned at activation; client holds them.
//   No server-side balance. No Supabase row. Spending a token writes to
//   sandbox_spent_tokens KV (not the production Supabase spent_tokens table).
//
// Credential limit: SANDBOX_CREDIT_LIMIT (identity) / SANDBOX_TOKEN_COUNT (anonymous).
// Both are small, non-renewable without an explicit /reset call.
// This is a deliberate friction point: the sandbox is for integration testing,
// not a free tier with a different name.
//
// Endpoints (all rate-limited under api_sandbox bucket):
//   POST /api/v1/sandbox/activate  — issue keypair + test credits. Admin-key only.
//   POST /api/v1/sandbox/reset     — wipe quota + reissue credits. Admin-key only.
//   GET  /api/v1/sandbox/status    — HMAC-auth, returns credit balance + rail info.
//   POST /api/v1/sandbox/spend     — HMAC-auth, consumes one identity credit (test path).
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

import { sha256Hex } from './api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Identity-rail sandbox: credits granted at activation and on each reset. */
const SANDBOX_CREDIT_LIMIT = 25;

/**
 * Anonymous-rail sandbox: number of test Cashu token strings returned at
 * activation. These are plaintext bearer tokens for integration test use only —
 * not real ecash, not spendable on the production mint.
 */
const SANDBOX_TOKEN_COUNT = 10;

/** KV TTL: 30 days. Sandbox credentials expire; no accumulation of stale state. */
const SANDBOX_TTL_SECONDS = 30 * 24 * 60 * 60;

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateBase58Key(byteLength) → string
 *
 * Generates a cryptographically random base58 string of approximately
 * `byteLength` characters. Uses Web Crypto — never Math.random().
 *
 * Strictly speaking this is base58-of-random-bytes, not Bitcoin-style
 * base58check encoding. The output is used as an opaque bearer token, not
 * a Bitcoin address, so check digits are unnecessary.
 */
function generateBase58Key(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // Map each byte modulo 58 — small bias (256 % 58 = 24), acceptable for
  // key material where only unpredictability matters, not uniform distribution.
  return Array.from(bytes)
    .map(b => B58_ALPHABET[b % 58])
    .join('');
}

/**
 * kvSandboxClientKey(liveKey) → Promise<string>
 * kvSandboxQuotaKey(liveKey)  → Promise<string>
 * kvSandboxMetaKey(liveKey)   → Promise<string>
 *
 * All derived from SHA-256(liveKey) so the raw rfs_test_live_ string never
 * appears in KV key names (mirrors production api_auth.js convention).
 */
async function kvSandboxClientKey(liveKey) {
  return `sandbox_client_${await sha256Hex(liveKey)}`;
}
async function kvSandboxQuotaKey(liveKey) {
  return `sandbox_quota_${await sha256Hex(liveKey)}`;
}
async function kvSandboxMetaKey(liveKey) {
  return `sandbox_meta_${await sha256Hex(liveKey)}`;
}

/**
 * generateTestTokens(n) → string[]
 *
 * Produces `n` dummy Cashu token strings for anonymous-rail sandbox use.
 * Format: "cashuA{base64url(JSON)}" — structurally valid prefix, dummy payload.
 * These are clearly marked as sandbox tokens and are not accepted by any mint.
 */
function generateTestTokens(n) {
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const payload = {
      token: [{ mint: 'https://sandbox.refueler.io/mint', proofs: [{ amount: 1, id: 'rfs_test', secret: generateBase58Key(16), C: generateBase58Key(32) }] }],
      memo: `Refueler sandbox token ${i + 1} of ${n} - not real ecash`,
    };
    // Use TextEncoder + manual binary string for btoa — Workers runtime btoa()
    // throws on any char > U+00FF (e.g. em-dash). This path is ASCII-safe.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of jsonBytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    tokens.push(`cashuA${encoded}`);
  }
  return tokens;
}

/**
 * requireAdminKey(request, env) → void | throws Response
 *
 * Validates the X-Admin-Key header against the ADMIN_KEY Worker secret.
 * Sandbox activation and reset are admin operations — they create credentials
 * that can issue real upload UUIDs. Only Rajesh (or an AM) runs these.
 */
function requireAdminKey(request, env) {
  const presented = request.headers.get('X-Admin-Key') ?? '';
  const expected  = env.ADMIN_KEY ?? '';
  if (!presented || !expected) {
    throw json({ error: 'Admin authentication required' }, 401);
  }
  // Constant-time comparison — ADMIN_KEY is short ASCII, so length check first.
  const a = new TextEncoder().encode(presented.padEnd(128, '\0'));
  const b = new TextEncoder().encode(expected.padEnd(128, '\0'));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) throw json({ error: 'Admin authentication required' }, 401);
}

/**
 * sandboxResponse(data, status, extraHeaders) → Response
 *
 * Wraps every sandbox response with X-Refueler-Sandbox: true.
 * This header is the observable signal that a request hit sandbox infrastructure.
 */
function sandboxResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':       'application/json',
      'X-Refueler-Sandbox': 'true',
      'Cache-Control':      'no-store',
      ...extraHeaders,
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/activate
//
// Admin-only. Creates a sandbox keypair for a given rail.
//
// Request body (JSON):
//   { rail: 'identity' | 'anonymous', transfer_ref_prefix: string }
//
// Response (201):
//   {
//     live_key:   'rfs_test_live_{32 base58}',
//     sign_key:   'rfs_test_sign_{32 base58}',   ← shown ONCE, never stored raw
//     rail:       'identity' | 'anonymous',
//     credits:    number | null,                  ← null on anonymous rail
//     test_tokens: string[] | null,               ← null on identity rail
//     expires_at: unix seconds,
//     sandbox:    true,
//     note:       string,
//   }
//
// The sign_key is shown exactly once. The server stores SHA-256(sign_key) only.
// Caller must record it. There is no recovery — reset issues new keys.
//
// Calling activate a second time for the same live_key (not possible — each
// call generates a fresh live_key) is not a concern. Two activate calls produce
// two independent sandbox clients.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxActivate(request, env) {
  try { requireAdminKey(request, env); } catch (r) { return r; }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const rail = body.rail ?? 'identity';
  if (rail !== 'identity' && rail !== 'anonymous') {
    return json({ error: "rail must be 'identity' or 'anonymous'" }, 400);
  }

  const transferRefPrefix = String(body.transfer_ref_prefix ?? 'sandbox').slice(0, 32);

  // ── Generate keypair ───────────────────────────────────────────────────────
  const liveKey = `rfs_test_live_${generateBase58Key(32)}`;
  const signKey = `rfs_test_sign_${generateBase58Key(32)}`;

  const signKeyHash = await sha256Hex(signKey);
  const clientKvKey = await kvSandboxClientKey(liveKey);
  const metaKvKey   = await kvSandboxMetaKey(liveKey);
  const nowSeconds  = Math.floor(Date.now() / 1000);
  const expiresAt   = nowSeconds + SANDBOX_TTL_SECONDS;

  // ── Write client record ────────────────────────────────────────────────────
  const clientRecord = {
    sign_key_hash:        signKeyHash,
    rail,
    tier:                 'sandbox',
    active:               true,
    created_at:           nowSeconds,
    transfer_ref_prefix:  transferRefPrefix,
  };

  await env.STATUS_KV.put(
    clientKvKey,
    JSON.stringify(clientRecord),
    { expirationTtl: SANDBOX_TTL_SECONDS }
  );

  // ── Write meta record (dashboard-readable) ─────────────────────────────────
  const metaRecord = {
    live_key:    liveKey,
    rail,
    created_at:  nowSeconds,
    last_reset:  null,
    expires_at:  expiresAt,
  };

  await env.STATUS_KV.put(
    metaKvKey,
    JSON.stringify(metaRecord),
    { expirationTtl: SANDBOX_TTL_SECONDS }
  );

  // ── Rail-specific: quota or test tokens ───────────────────────────────────
  let credits    = null;
  let testTokens = null;

  if (rail === 'identity') {
    const quotaKvKey = await kvSandboxQuotaKey(liveKey);
    const quotaRecord = {
      remaining:  SANDBOX_CREDIT_LIMIT,
      total:      SANDBOX_CREDIT_LIMIT,
      updated_at: nowSeconds,
    };
    await env.STATUS_KV.put(
      quotaKvKey,
      JSON.stringify(quotaRecord),
      { expirationTtl: SANDBOX_TTL_SECONDS }
    );
    credits = SANDBOX_CREDIT_LIMIT;
  } else {
    // Anonymous rail: client holds tokens, no server-side balance.
    testTokens = generateTestTokens(SANDBOX_TOKEN_COUNT);
  }

  return sandboxResponse({
    live_key:    liveKey,
    sign_key:    signKey,
    rail,
    credits,
    test_tokens: testTokens,
    expires_at:  expiresAt,
    sandbox:     true,
    note:        rail === 'anonymous'
      ? 'Test tokens shown once — not real ecash, not accepted by any production mint. Do not send real cargo to the sandbox.'
      : `${SANDBOX_CREDIT_LIMIT} test credits issued. Do not send real cargo to the sandbox.`,
  }, 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/reset
//
// Admin-only. Wipes and reissues credits/tokens for an existing sandbox client.
// Does NOT rotate the keypair — the live_key and sign_key_hash are preserved.
// Useful for integration test suites that need a clean credit slate between runs.
//
// Request body (JSON):
//   { live_key: 'rfs_test_live_{...}' }
//
// Response (200):
//   {
//     rail:        string,
//     credits:     number | null,
//     test_tokens: string[] | null,
//     reset_at:    unix seconds,
//     sandbox:     true,
//   }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxReset(request, env) {
  try { requireAdminKey(request, env); } catch (r) { return r; }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const liveKey = body.live_key ?? '';
  if (!liveKey.startsWith('rfs_test_live_')) {
    return json({ error: 'live_key must be a rfs_test_live_ key' }, 400);
  }

  const clientKvKey = await kvSandboxClientKey(liveKey);
  let clientRecord;
  try {
    clientRecord = await env.STATUS_KV.get(clientKvKey, { type: 'json' });
  } catch (e) {
    console.error('sandbox/reset: KV client lookup failed:', e);
    return json({ error: 'Internal error' }, 500);
  }

  if (!clientRecord) return json({ error: 'Sandbox client not found or expired' }, 404);

  const nowSeconds   = Math.floor(Date.now() / 1000);
  let credits        = null;
  let testTokens     = null;

  if (clientRecord.rail === 'identity') {
    const quotaKvKey  = await kvSandboxQuotaKey(liveKey);
    const quotaRecord = {
      remaining:  SANDBOX_CREDIT_LIMIT,
      total:      SANDBOX_CREDIT_LIMIT,
      updated_at: nowSeconds,
    };
    await env.STATUS_KV.put(
      quotaKvKey,
      JSON.stringify(quotaRecord),
      { expirationTtl: SANDBOX_TTL_SECONDS }
    );
    credits = SANDBOX_CREDIT_LIMIT;
  } else {
    testTokens = generateTestTokens(SANDBOX_TOKEN_COUNT);
  }

  // ── Update meta record ─────────────────────────────────────────────────────
  const metaKvKey = await kvSandboxMetaKey(liveKey);
  let metaRecord;
  try {
    metaRecord = await env.STATUS_KV.get(metaKvKey, { type: 'json' });
  } catch {}

  if (metaRecord) {
    metaRecord.last_reset = nowSeconds;
    await env.STATUS_KV.put(
      metaKvKey,
      JSON.stringify(metaRecord),
      { expirationTtl: SANDBOX_TTL_SECONDS }
    );
  }

  return sandboxResponse({
    rail:        clientRecord.rail,
    credits,
    test_tokens: testTokens,
    reset_at:    nowSeconds,
    sandbox:     true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sandbox/status
//
// HMAC-authenticated (rfs_test_ keypair). Returns current sandbox state for the
// calling client: rail, credits remaining (identity) or "client-held" (anonymous),
// expiry, and whether the client is still active.
//
// This is the endpoint the dashboard polls to populate the sandbox card.
// It can also be used by client integration test suites to check their own state.
//
// Response (200):
//   {
//     rail:          string,
//     tier:          'sandbox',
//     credits:       number | 'client-held' | null,
//     active:        boolean,
//     created_at:    unix seconds,
//     last_reset:    unix seconds | null,
//     expires_at:    unix seconds,
//     sandbox:       true,
//     transfer_ref_prefix: string,
//   }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxStatus(request, env) {
  // HMAC auth — we reuse the same flow as production but against sandbox_client_ KV entries.
  // requireApiAuth() from api_auth.js looks up api_client_ keys; we need sandbox_client_ keys.
  // So we do the auth inline here, routing to the sandbox KV namespace.
  const { isSandboxKey, client: authClient, liveKey, error: authError } =
    await _sandboxAuth(request, env);

  if (authError) {
    return sandboxResponse({ error: authError }, 401);
  }

  const metaKvKey = await kvSandboxMetaKey(liveKey);
  let metaRecord;
  try {
    metaRecord = await env.STATUS_KV.get(metaKvKey, { type: 'json' });
  } catch (e) {
    console.error('sandbox/status: KV meta lookup failed:', e);
  }

  let credits = null;
  if (authClient.rail === 'identity') {
    const quotaKvKey = await kvSandboxQuotaKey(liveKey);
    let quotaRecord;
    try {
      quotaRecord = await env.STATUS_KV.get(quotaKvKey, { type: 'json' });
    } catch {}
    credits = quotaRecord?.remaining ?? 0;
  } else {
    credits = 'client-held';
  }

  return sandboxResponse({
    rail:                 authClient.rail,
    tier:                 'sandbox',
    credits,
    active:               authClient.active,
    created_at:           metaRecord?.created_at ?? authClient.created_at,
    last_reset:           metaRecord?.last_reset ?? null,
    expires_at:           metaRecord?.expires_at ?? null,
    transfer_ref_prefix:  authClient.transfer_ref_prefix,
    sandbox:              true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/spend
//
// HMAC-authenticated. Consumes one identity-rail test credit.
// Used by integration test suites to verify that the credential-limit enforcement
// works correctly: spend credits → hit 402 → call /reset → credits restored.
//
// Anonymous-rail callers receive 422 (Unprocessable) — the anonymous rail has no
// server-side credits; test by presenting a test token instead.
//
// Response (200): { remaining: number, sandbox: true }
// Response (402): { error: 'Test credit limit reached', remaining: 0, sandbox: true }
// Response (422): { error: 'Anonymous rail: no server-side credits', sandbox: true }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxSpend(request, env) {
  const { client: authClient, liveKey, error: authError } = await _sandboxAuth(request, env);
  if (authError) return sandboxResponse({ error: authError }, 401);

  if (authClient.rail === 'anonymous') {
    return sandboxResponse({
      error:   'Anonymous rail: no server-side credits. Present a test token to verify token-gated endpoints.',
      sandbox: true,
    }, 422);
  }

  const quotaKvKey = await kvSandboxQuotaKey(liveKey);
  let quotaRecord;
  try {
    quotaRecord = await env.STATUS_KV.get(quotaKvKey, { type: 'json' });
  } catch (e) {
    console.error('sandbox/spend: KV quota lookup failed:', e);
    return sandboxResponse({ error: 'Internal error' }, 500);
  }

  if (!quotaRecord) {
    return sandboxResponse({ error: 'Sandbox client has no credit record. Call /reset.' }, 409);
  }

  if (quotaRecord.remaining <= 0) {
    return sandboxResponse({
      error:     'Test credit limit reached. Call POST /api/v1/sandbox/reset to reissue.',
      remaining: 0,
      sandbox:   true,
    }, 402);
  }

  quotaRecord.remaining  -= 1;
  quotaRecord.updated_at  = Math.floor(Date.now() / 1000);

  await env.STATUS_KV.put(
    quotaKvKey,
    JSON.stringify(quotaRecord),
    { expirationTtl: SANDBOX_TTL_SECONDS }
  );

  return sandboxResponse({ remaining: quotaRecord.remaining, sandbox: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// _sandboxAuth(request, env)
//
// Internal: validates HMAC signature against sandbox_client_ KV entries.
// Does NOT call requireApiAuth() from api_auth.js — that reads api_client_ keys.
// Sandbox clients live under sandbox_client_ keys.
//
// Mirrors the same Option C flow as api_auth.js:
//   1. Parse Authorization header  → { apiKey, sig, ts }
//   2. KV lookup on hashed key     → clientRecord
//   3. Hash presented X-Api-Sign-Key → compare to stored sign_key_hash
//   4. Verify HMAC signature
//
// Returns { client, liveKey } on success.
// Returns { error: string } on failure.
// ─────────────────────────────────────────────────────────────────────────────
const CLOCK_WINDOW = 300;

async function _sandboxAuth(request, env) {
  // ── Parse Authorization header ────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('HMAC-SHA256 ')) {
    return { error: 'Missing or malformed Authorization header' };
  }

  const parts = authHeader.slice('HMAC-SHA256 '.length);
  const map   = {};
  for (const seg of parts.split(',')) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    map[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  }

  const apiKey = map['key'] ?? null;
  const sig    = map['sig'] ?? null;
  const ts     = map['ts']  ?? null;

  if (!apiKey || !sig || !ts) return { error: 'Incomplete Authorization header' };
  if (!apiKey.startsWith('rfs_test_live_')) {
    return { error: 'Sandbox status requires rfs_test_live_ credentials' };
  }

  // ── Clock window ──────────────────────────────────────────────────────────
  const requestTs = parseInt(ts, 10);
  if (isNaN(requestTs)) return { error: 'Invalid timestamp' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - requestTs) > CLOCK_WINDOW) {
    return { error: 'Request timestamp outside ±5 minute window' };
  }

  // ── KV lookup (sandbox_client_ namespace) ─────────────────────────────────
  const clientKvKey = await kvSandboxClientKey(apiKey);
  let clientRecord;
  try {
    clientRecord = await env.STATUS_KV.get(clientKvKey, { type: 'json' });
  } catch (e) {
    console.error('_sandboxAuth: KV lookup failed:', e);
    return { error: 'Internal error' };
  }

  if (!clientRecord || clientRecord.active === false) {
    await new Promise(r => setTimeout(r, 5)); // constant-time-ish on miss
    return { error: 'Invalid sandbox credentials' };
  }

  // ── Sign key validation (Option C) ────────────────────────────────────────
  const presentedSignKey = request.headers.get('X-Api-Sign-Key') ?? '';
  if (!presentedSignKey.startsWith('rfs_test_sign_')) {
    return { error: 'Missing or invalid X-Api-Sign-Key header' };
  }

  const presentedHash = await sha256Hex(presentedSignKey);
  const storedHash    = clientRecord.sign_key_hash ?? '';

  const pBytes = new TextEncoder().encode(presentedHash);
  const sBytes = new TextEncoder().encode(storedHash);
  let hashMatch = false;
  if (pBytes.length === sBytes.length) {
    try {
      hashMatch = crypto.subtle.timingSafeEqual(pBytes, sBytes);
    } catch {
      let diff = 0;
      for (let i = 0; i < pBytes.length; i++) diff |= pBytes[i] ^ sBytes[i];
      hashMatch = diff === 0;
    }
  }

  if (!hashMatch) return { error: 'Invalid sandbox credentials' };

  // ── HMAC signature verify ─────────────────────────────────────────────────
  // Body hash: GET requests have no body; POST bodies are consumed before this
  // call in each handler, so we pass an empty ArrayBuffer here and rely on the
  // handler to call _sandboxAuth before reading the body (or accept empty body
  // hash for status/spend which have trivial or no bodies).
  // For spend: body is consumed by the handler; auth is called first, so this
  // is fine — spend has no body, and status is a GET.
  const rawBody   = new ArrayBuffer(0);
  const bodyBytes = new Uint8Array(rawBody);
  const bodyHash  = await sha256Hex(bodyBytes);

  const url       = new URL(request.url);
  const canonical = `${request.method.toUpperCase()}\n${url.pathname}\n${ts}\n${bodyHash}`;

  const keyBytes = new TextEncoder().encode(presentedSignKey);
  const msgBytes = new TextEncoder().encode(canonical);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBytes    = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  const computedSig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const sigMatch     = authHeader.match(/sig=([0-9a-f]+)/i);
  const presentedSig = sigMatch ? sigMatch[1] : '';

  if (computedSig.length !== presentedSig.length) {
    return { error: 'Invalid or expired request signature' };
  }
  const cBytes = new TextEncoder().encode(computedSig);
  const pSig   = new TextEncoder().encode(presentedSig);
  let sigDiff  = 0;
  try {
    const ok = crypto.subtle.timingSafeEqual(cBytes, pSig);
    if (!ok) return { error: 'Invalid or expired request signature' };
  } catch {
    for (let i = 0; i < cBytes.length; i++) sigDiff |= cBytes[i] ^ pSig[i];
    if (sigDiff !== 0) return { error: 'Invalid or expired request signature' };
  }

  return { client: clientRecord, liveKey: apiKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// isSandboxRequest(apiKey)
//
// Exported predicate: returns true if the Authorization header carries an
// rfs_test_ prefixed key. Called from index.js to route sandbox requests
// to sandbox quota, not production quota.
// ─────────────────────────────────────────────────────────────────────────────
export function isSandboxRequest(apiKey) {
  return typeof apiKey === 'string' && apiKey.startsWith('rfs_test_live_');
}

// ─────────────────────────────────────────────────────────────────────────────
// consumeSandboxCredit(env, liveKey)
//
// Exported: called from handleApiCredentialIssue when a sandbox key is detected.
// Decrements the identity-rail sandbox quota.
// Returns { ok: true, remaining } on success.
// Returns { ok: false, reason } when exhausted or no quota record.
// No-op (returns ok: true) on anonymous rail — client holds tokens.
// ─────────────────────────────────────────────────────────────────────────────
export async function consumeSandboxCredit(env, liveKey) {
  const quotaKvKey = await kvSandboxQuotaKey(liveKey);
  let quota;
  try {
    quota = await env.STATUS_KV.get(quotaKvKey, { type: 'json' });
  } catch (e) {
    console.error('consumeSandboxCredit: KV read failed:', e);
    return { ok: false, reason: 'internal_error' };
  }

  if (!quota) return { ok: false, reason: 'no_quota_record' };
  if (quota.remaining <= 0) return { ok: false, reason: 'exhausted' };

  quota.remaining  -= 1;
  quota.updated_at  = Math.floor(Date.now() / 1000);

  try {
    await env.STATUS_KV.put(quotaKvKey, JSON.stringify(quota), {
      expirationTtl: SANDBOX_TTL_SECONDS,
    });
  } catch (e) {
    console.error('consumeSandboxCredit: KV write failed:', e);
    return { ok: false, reason: 'internal_error' };
  }

  return { ok: true, remaining: quota.remaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// lookupSandboxClient(env, apiKey)
//
// Exported: identical semantics to lookupApiClient() in api_auth.js, but reads
// sandbox_client_ KV namespace. Used where production code calls lookupApiClient
// and we need to distinguish the routing.
// ─────────────────────────────────────────────────────────────────────────────
export async function lookupSandboxClient(env, apiKey) {
  const key = await kvSandboxClientKey(apiKey);
  let record;
  try {
    record = await env.STATUS_KV.get(key, { type: 'json' });
  } catch (e) {
    console.error('lookupSandboxClient: KV lookup failed:', e);
    return null;
  }
  if (!record) return null;
  if (record.active === false) return null;
  return record;
}
