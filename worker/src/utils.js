/**
 * utils.js — shared constants, response helpers, and fetch utilities
 *
 * Extracted from index.js at SW9. Everything here was previously defined
 * inline in index.js and used across multiple handlers. No behaviour changes.
 *
 * Exports (constants):
 *   UUID_RE, CHUNK_SIZE_MAX, MANIFEST_SIZE_MAX, MIME_DENYLIST
 *
 * Exports (functions):
 *   corsHeaders(request) → headers object
 *   safeGetManifest(bucket, uuid, env) → { manifest, oversize }
 *   supabaseFetch(env, method, path, body?, extraHeaders?) → Response
 *   json(data, status?) → Response
 *   err(status, message) → Response
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
export const MIME_DENYLIST = new Set([
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
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
export function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ['https://refueler.io'];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cashu-Credential, X-Blake3-Root, X-Blake3-Chunk-Hash, X-Total-Chunks, X-Total-Bytes, X-Tier, X-Expiry-Timestamp, X-P2SH-Secret-Hash, X-File-Name, X-Admin-Key, X-Email, X-Credential-Commitment, X-Issued-Tier, X-Resume-From-Chunk, X-Destroy-After-Download, X-Available-From, X-Available-Until, X-Transfer-UUID, X-Api-Sign-Key, X-Transfer-Ref',
    'Access-Control-Expose-Headers': 'X-File-Name, X-Total-Bytes, X-Expiry-Timestamp',
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
    console.error(`Manifest oversize: ${obj.size} bytes for ${uuid}`);
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

export function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
