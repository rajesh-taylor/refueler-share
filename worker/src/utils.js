/**
 * utils.js — shared constants, response helpers, and fetch utilities
 *
 * Extracted from index.js at SW9. Everything here was previously defined
 * inline in index.js and used across multiple handlers. No behaviour changes.
 *
 * Exports (constants):
 *   UUID_RE, CHUNK_SIZE_MAX, MANIFEST_SIZE_MAX
 *
 * Exports (functions):
 *   corsHeaders(request) → headers object (allowlist: setAppOrigins(env), X5-1)
 *   safeGetManifest(bucket, uuid, env) → { manifest, oversize }
 *   supabaseFetch(env, method, path, body?, extraHeaders?) → Response
 *   json(data, status?) → Response
 *   err(status, message, request?) → Response   ← Share-5: optional request param adds CORS
 *   addCors(response, request) → Response
 *   parseRange(rangeHeader) → { offset, length } | undefined
 */

import { getManifest } from './manifest.js';

// ─────────────────────────────────────────────────────────────────────────────
// Upload enforcement constants (S39)
// ─────────────────────────────────────────────────────────────────────────────
export const CHUNK_SIZE_MAX    = 10 * 1024 * 1024; // 10 MB hard cap per chunk
export const MANIFEST_SIZE_MAX = 64 * 1024;        // 64 KB manifest ceiling (S42)

// ─────────────────────────────────────────────────────────────────────────────
// UUID validation (S41)
//
// RFC 4122 format: 8-4-4-4-12 lowercase hex groups separated by hyphens.
// The router regex [0-9a-f-]{36} already blocks non-hex/non-hyphen chars and
// enforces length, but accepts structurally invalid strings (e.g. all hyphens).
// This stricter check ensures the captured group is a valid UUID before any
// R2, Supabase, or KV operation is attempted.
// ─────────────────────────────────────────────────────────────────────────────
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Error-Notes-1 (21 Oct 2026): nothing kept longer than a day may name a transfer.
// Analytics Engine keeps every row for three months and can't delete one, so any
// text bound for it (thrown messages can carry an R2 key) goes through this first.
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const scrubUuids = s => String(s ?? '').replace(UUID_ANYWHERE, '{uuid}');

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
// X5-1: the page origins allowed to call the public API, from var APP_ORIGINS
// (comma-separated, https only — same parser as AUTH_ORIGINS). Set once per
// request by setAppOrigins(env) at the top of fetch(); env is fixed for the
// isolate, so this never carries one request's state into another. Unset or
// empty falls back to the pre-X5 list. An origin not on the list is answered
// with the first entry, as before (never an echo).
const DEFAULT_APP_ORIGINS = ['https://refueler.io'];
let appOriginList = DEFAULT_APP_ORIGINS;

export function parseOrigins(value) {
  return String(value ?? '')
    .split(',').map(s => s.trim()).filter(s => /^https:\/\/[a-z0-9.-]+$/.test(s));
}

export function setAppOrigins(env) {
  const list = parseOrigins(env?.APP_ORIGINS);
  appOriginList = list.length ? list : DEFAULT_APP_ORIGINS;
}

/** The ACAO value for a public (non-credentialed) response. */
export function appAllowOrigin(origin) {
  return appOriginList.includes(origin) ? origin : appOriginList[0];
}

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  // Share-Admin-1: allow any localhost origin for local soak testing.
  // Never reaches production paths — admin test endpoint is X-Admin-Key gated.
  // Never combined with Allow-Credentials (initiateCors/authCors use exact lists).
  const isLocalhost = origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
  const allowOrigin = isLocalhost ? origin : appAllowOrigin(origin);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',   // X5-1: the answer now depends on Origin (two app origins)
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cashu-Credential, X-Blake3-Root, X-Blake3-Chunk-Hash, X-Total-Chunks, X-Total-Bytes, X-Tier, X-Expiry-Timestamp, X-P2SH-Secret-Hash, X-File-Name, X-Admin-Key, X-Credential-Commitment, X-Issued-Tier, X-Resume-From-Chunk, X-Upload-Session, X-Destroy-After-Download, X-Available-From, X-Available-Until, X-Transfer-UUID, X-Api-Sign-Key, X-Transfer-Ref, X-Test-Credential, X-CSRF',
    'Access-Control-Expose-Headers': 'X-File-Name, X-Total-Bytes, X-Expiry-Timestamp, X-Integrity, X-Chunk-Index',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest fetch with size cap (S42)
//
// getManifest() is imported from manifest.js and reads the raw R2 object.
// An adversary-supplied or corrupted manifest larger than 64 KB would consume
// unnecessary memory and could cause unbounded JSON.parse allocation.
// This wrapper fetches the R2 object directly for a size check before delegating
// to the imported helper, returning null (not found) or throwing on oversize.
// ─────────────────────────────────────────────────────────────────────────────
export async function safeGetManifest(bucket, uuid, env) {
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
    console.error(`Manifest oversize: ${obj.size} bytes for ${String(uuid).slice(0, 8)}`);
    return { manifest: null, oversize: true };
  }

  // Delegate to the authoritative helper for parsing and field normalisation.
  const manifest = await getManifest(bucket, uuid);
  return { manifest, oversize: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase fetch
// ─────────────────────────────────────────────────────────────────────────────
export async function supabaseFetch(env, method, path, body = null, extraHeaders = {}) {
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
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Share-5: err() now accepts an optional request parameter.
// When provided, CORS headers are attached unconditionally — this ensures that
// any Worker-generated error (400, 401, 413, 415, 429, 500, etc.) is legible
// to cross-origin callers even if the call site forgot addCors().
// Callers that already wrap with addCors() are unaffected — duplicate header
// sets from the outer addCors() simply overwrite, which is idempotent.
// Callers that pass no request continue to work as before (no CORS headers on
// those responses — typically admin or server-to-server paths).
export function err(status, message, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (request) {
    Object.assign(headers, corsHeaders(request));
  }
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// requireAdmin(request, env) → Promise<Response | null>   (KV-Fix-1a, B12-SR S2.4)
//
// The ONE admin-key check. Returns null when X-Admin-Key matches ADMIN_KEY,
// else a 401 Response the caller returns as-is. Both sides are SHA-256'd first
// so the compare is fixed-length (no length leak), then timingSafeEqual.
// A missing ADMIN_KEY secret fails closed.
// ─────────────────────────────────────────────────────────────────────────────
export async function requireAdmin(request, env) {
  const presented = request.headers.get('X-Admin-Key') ?? '';
  const expected  = env.ADMIN_KEY ?? '';
  if (!presented || !expected) return err(401, 'Unauthorised');
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b) ? null : err(401, 'Unauthorised');
}

export function addCors(response, request) {
  const headers    = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

export function parseRange(rangeHeader) {
  const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  const offset = parseInt(m[1], 10);
  const end    = m[2] ? parseInt(m[2], 10) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}