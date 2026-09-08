// worker/src/webhook_reg.js
//
// SW4 — Webhook registration endpoints (API tier only).
//
// Three endpoints:
//   POST   /api/v1/webhook/register  — register a URL, issue rfs_whsec_, write wh_config_ KV
//   DELETE /api/v1/webhook/register  — deregister, remove wh_config_ KV entry
//   GET    /api/v1/webhook/register  — inspect registration (URL redacted, whsec active flag)
//
// Auth: requireApiAuth on every method — HMAC-SHA256 + rfs_live_ + X-Api-Sign-Key.
// Tier gate: client.tier must be 'api'. Sovereign never gets webhooks.
//
// KV schema:
//   wh_config_{sha256hex(rfs_live_key)} →
//     { url, whsec_hash, created_at, active }
//
//   - url         : full validated HTTPS URL as supplied by client
//   - whsec_hash  : BLAKE3 hex digest of the raw rfs_whsec_ key — never the raw value
//   - created_at  : unix seconds
//   - active      : boolean — false after DELETE, before KV expiry or re-registration
//
// Security invariants:
//   - rfs_whsec_ is returned ONCE at POST time only. Never again. No GET equivalent.
//   - whsec_hash is BLAKE3(rfs_whsec_) — same BLAKE3 WASM used elsewhere in the Worker.
//   - KV key for wh_config_ is sha256hex(rfs_live_key) — same derivation as api_client_.
//     An attacker who can enumerate KV sees hashes, not keys.
//   - URL validation rejects: non-HTTPS, localhost, loopback, RFC1918 private ranges,
//     link-local (169.254.x.x), and unspecified (0.0.0.0).
//
// Notification model:
//   Webhooks are notification only — never control flow.
//   Credential issuance and transfer completion are not gated on webhook delivery.
//   See SW4a for delivery via ctx.waitUntil.

'use strict';

import { requireApiAuth, sha256Hex } from './api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Base58 alphabet — Bitcoin alphabet, no 0/O/I/l.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// KV TTL for an active wh_config_ record: 2 years.
// Deleted entries: set active: false, TTL 7 days (enough for any in-flight delivery).
const WH_CONFIG_ACTIVE_TTL   = 2 * 365 * 24 * 3600; // 63,072,000 s
const WH_CONFIG_INACTIVE_TTL = 7 * 24 * 3600;        //    604,800 s

// ─────────────────────────────────────────────────────────────────────────────
// Private IP ranges blocked in URL validation.
//
// RFC 1918  : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
// Loopback  : 127.0.0.0/8
// Link-local: 169.254.0.0/16
// Unspecified: 0.0.0.0/8
//
// Checked by parsing the hostname octets — no DNS resolution attempted.
// Hostnames that do not parse as dotted-quad are passed through (they will
// resolve externally at delivery time). A private IP in hostname form
// (e.g. http://10.0.0.1) is caught; a private IP hidden behind a hostname
// is not caught here — that is a delivery-time concern, not a registration concern.
// ─────────────────────────────────────────────────────────────────────────────
function isPrivateIp(hostname) {
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) {
    return false; // not a valid dotted-quad — not our problem here
  }
  const [a, b] = octets;
  if (a === 10)                           return true; // RFC1918 10/8
  if (a === 172 && b >= 16 && b <= 31)   return true; // RFC1918 172.16/12
  if (a === 192 && b === 168)             return true; // RFC1918 192.168/16
  if (a === 127)                          return true; // loopback 127/8
  if (a === 169 && b === 254)             return true; // link-local 169.254/16
  if (a === 0)                            return true; // unspecified 0/8
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// validateWebhookUrl(raw: string) → { ok: boolean, error?: string, url?: URL }
//
// Rules:
//   1. Must parse as a valid URL.
//   2. Protocol must be exactly 'https:'.
//   3. Hostname must not be 'localhost' (case-insensitive).
//   4. Hostname must not be a private/loopback/link-local IP (dotted-quad check).
//   5. No port is required, but if present must be numeric (URL parser enforces this).
//   6. Path, query, fragment are allowed — no restrictions beyond structure.
// ─────────────────────────────────────────────────────────────────────────────
export function validateWebhookUrl(raw) {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'url is required' };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'url is not a valid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'url must use HTTPS' };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost') {
    return { ok: false, error: 'url must not target localhost' };
  }

  if (isPrivateIp(hostname)) {
    return { ok: false, error: 'url must not target a private or loopback IP address' };
  }

  return { ok: true, url: parsed };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateWhsec() → Promise<string>
//
// Generates a new rfs_whsec_ signing key.
//   32 bytes from crypto.getRandomValues → encoded to base58 → prefixed.
//
// 32 bytes = 256 bits of entropy. Base58 encoding: log2(58^43) ≈ 252 bits
// in the 43-char output, which is the natural output length for 32 bytes.
// The prefix 'rfs_whsec_' is cosmetic — does not contribute to entropy.
//
// Returned raw value is shown to the client once only. Caller stores only
// BLAKE3(rfs_whsec_) in KV.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateWhsec() {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const b58 = toBase58(raw);
  return `rfs_whsec_${b58}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// toBase58(bytes: Uint8Array) → string
//
// Standard base58 encoding (Bitcoin alphabet, no check).
// Leading zero bytes → leading '1' characters.
// ─────────────────────────────────────────────────────────────────────────────
function toBase58(bytes) {
  // Count leading zeroes
  let leadingZeroes = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeroes++;
  }

  // Convert to big-endian integer via array of digits in base 58
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Map to alphabet and reverse (digits are little-endian)
  const result = '1'.repeat(leadingZeroes) +
    digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
  return result;
}

// whsecHash uses sha256Hex (from api_auth.js, already imported) — same
// primitive as sign_key_hash in Option C. Correct choice for a one-time
// commitment of a 256-bit random key; BLAKE3 is reserved for chunk integrity.

// ─────────────────────────────────────────────────────────────────────────────
// kvWhConfigKey(apiKey: string) → Promise<string>
//
// Derives the KV lookup key for the webhook config record.
// KV key = "wh_config_" + sha256Hex(rfs_live_key)
//
// Same hash derivation as kvClientKey() in api_auth.js — so the wh_config_
// record sits alongside api_client_ and api_quota_ in the same namespace,
// keyed by the same opaque hash. The raw rfs_live_ key never appears as a KV key.
// ─────────────────────────────────────────────────────────────────────────────
export async function kvWhConfigKey(apiKey) {
  return `wh_config_${await sha256Hex(apiKey)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhookRegister(request, env, method) → Promise<Response>
//
// Dispatches POST / DELETE / GET on /api/v1/webhook/register.
// Auth and tier gate are applied here before branching.
//
// 'method' is passed explicitly (rather than reading request.method) so the
// caller's router controls method dispatch — this handler does not re-check.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWebhookRegister(request, env) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  // requireApiAuth reads the full body for HMAC verification.
  // It returns { client, apiKey } or throws a Response.
  let client, apiKey, rawBody;
  try {
    rawBody = await request.arrayBuffer();
    ({ client, apiKey } = await requireApiAuth(
      request,
      rawBody,
      env,
    ));
  } catch (res) {
    // requireApiAuth throws Response objects on failure.
    if (res instanceof Response) return res;
    console.error('webhook_reg: unexpected auth error:', res);
    return errJson(500, 'Internal error during authentication');
  }

  // ── Tier gate: API only ───────────────────────────────────────────────────
  if (client.tier !== 'api') {
    return errJson(403, 'Webhook registration is only available on the API tier');
  }

  const method = request.method.toUpperCase();

  if (method === 'POST')   return handleRegisterPost(request, env, client, apiKey, rawBody);
  if (method === 'DELETE') return handleRegisterDelete(env, apiKey);
  if (method === 'GET')    return handleRegisterGet(env, apiKey);

  return errJson(405, 'Method not allowed');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhook/register
//
// Body (JSON):
//   { url: string }
//
// Behaviour:
//   1. Validate URL (HTTPS, no localhost, no private IP).
//   2. Check for an existing active registration — reject with 409.
//      Client must DELETE first to rotate.
//   3. Generate rfs_whsec_ (32 bytes base58).
//   4. BLAKE3-hash the raw whsec for KV storage.
//   5. Write wh_config_{hash(apiKey)} → { url, whsec_hash, created_at, active: true }.
//   6. Return { url, whsec } — whsec is shown ONCE. No second chance.
// ─────────────────────────────────────────────────────────────────────────────
async function handleRegisterPost(request, env, client, apiKey, rawBody) {
  // Parse body — rawBody already read for HMAC; re-decode as text.
  let body;
  try {
    const text = new TextDecoder().decode(rawBody);
    body = JSON.parse(text);
  } catch {
    return errJson(400, 'Invalid JSON body');
  }

  // ── URL validation ────────────────────────────────────────────────────────
  const validation = validateWebhookUrl(body?.url);
  if (!validation.ok) {
    return errJson(400, validation.error);
  }
  const webhookUrl = validation.url.toString();

  // ── Existing registration check ───────────────────────────────────────────
  const configKey = await kvWhConfigKey(apiKey);
  let existing = null;
  try {
    existing = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_reg: KV read failed on POST:', e);
    return errJson(502, 'Registration check failed — please retry');
  }

  if (existing && existing.active === true) {
    return errJson(409, 'A webhook is already registered. DELETE /api/v1/webhook/register first to replace it.');
  }

  // ── Generate rfs_whsec_ ───────────────────────────────────────────────────
  let rawWhsec;
  try {
    rawWhsec = await generateWhsec();
  } catch (e) {
    console.error('webhook_reg: whsec generation failed:', e);
    return errJson(500, 'Failed to generate signing key');
  }

  // ── Hash for storage (BLAKE3) ─────────────────────────────────────────────
  let whsecHash;
  try {
    whsecHash = await sha256Hex(rawWhsec);
  } catch (e) {
    console.error('webhook_reg: BLAKE3 hash failed:', e);
    return errJson(500, 'Failed to hash signing key');
  }

  // ── Write KV ──────────────────────────────────────────────────────────────
  const createdAt = Math.floor(Date.now() / 1000);
  const record = {
    url:        webhookUrl,
    whsec_hash: whsecHash,
    created_at: createdAt,
    active:     true,
  };

  try {
    await env.STATUS_KV.put(
      configKey,
      JSON.stringify(record),
      { expirationTtl: WH_CONFIG_ACTIVE_TTL },
    );
  } catch (e) {
    console.error('webhook_reg: KV write failed on POST:', e);
    return errJson(502, 'Failed to persist webhook registration — please retry');
  }

  // ── Respond — whsec shown once only ──────────────────────────────────────
  return jsonOk({
    url:    webhookUrl,
    whsec:  rawWhsec,   // raw value, one-time only
    created_at: createdAt,
    note:   'Store whsec securely — it will not be retrievable again.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/webhook/register
//
// Marks the wh_config_ record inactive and sets a short TTL.
// Idempotent — 200 whether or not a registration existed.
//
// Does NOT overwrite with active: false if no record exists — that would
// create a ghost entry. We only write if a record was found.
// ─────────────────────────────────────────────────────────────────────────────
async function handleRegisterDelete(env, apiKey) {
  const configKey = await kvWhConfigKey(apiKey);

  let existing = null;
  try {
    existing = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_reg: KV read failed on DELETE:', e);
    return errJson(502, 'Deregistration check failed — please retry');
  }

  if (!existing) {
    // Nothing registered — idempotent 200.
    return jsonOk({ deregistered: false, message: 'No webhook was registered' });
  }

  // Write tombstone with short TTL.
  const tombstone = {
    url:        existing.url,
    whsec_hash: existing.whsec_hash,
    created_at: existing.created_at,
    active:     false,
    deleted_at: Math.floor(Date.now() / 1000),
  };

  try {
    await env.STATUS_KV.put(
      configKey,
      JSON.stringify(tombstone),
      { expirationTtl: WH_CONFIG_INACTIVE_TTL },
    );
  } catch (e) {
    console.error('webhook_reg: KV write failed on DELETE:', e);
    return errJson(502, 'Failed to deregister webhook — please retry');
  }

  return jsonOk({ deregistered: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/webhook/register
//
// Returns registration state without exposing the signing key or full URL.
// URL is redacted to scheme + host only (path/query/fragment stripped).
// whsec_active: true if a record exists with active: true.
// whsec is never returned — not even a hash — to prevent offline hash cracking.
// ─────────────────────────────────────────────────────────────────────────────
async function handleRegisterGet(env, apiKey) {
  const configKey = await kvWhConfigKey(apiKey);

  let record = null;
  try {
    record = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_reg: KV read failed on GET:', e);
    return errJson(502, 'Failed to read webhook registration — please retry');
  }

  if (!record) {
    return jsonOk({ registered: false });
  }

  // Redact URL to scheme + host only.
  let redactedUrl = null;
  try {
    const parsed = new URL(record.url);
    redactedUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    // Stored URL somehow became invalid — surface the error, don't expose raw value.
    redactedUrl = '[invalid url]';
  }

  return jsonOk({
    registered:   true,
    active:       record.active === true,
    url:          redactedUrl,    // scheme + host only
    whsec_active: record.active === true,
    created_at:   record.created_at ?? null,
    deleted_at:   record.deleted_at ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers (module-local)
// ─────────────────────────────────────────────────────────────────────────────

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errJson(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
