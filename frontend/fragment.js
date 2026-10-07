/**
 * fragment.js — URL fragment grammar helper
 *
 * Link format v2 (Share-Crypto-1) — the only shape senders produce:
 *
 *   { v: 2, k: "<transfer-key-b64url, 32 B>", n: "<real-filename>", s: "<seal-nonce-b64url>", z: <plaintext-bytes> }
 *
 * `k` is the transfer key K; parts are encrypted under a key derived from it
 * (crypto.js derivePartKey), so v2 carries no IV. `z` is required: the exact
 * plaintext byte count (for a folder, the zip as sent); the receiver checks
 * ceil(z / CHUNK_SIZE) against the stored part count before downloading.
 * `s` (seal_nonce) is present only for permanent-record transfers.
 *
 * Older links still parse (receivers decrypt them the old way):
 *   v1: { v: 1, k, i: "<iv-b64url>", n, s?, z? }   (z optional, Share-Size-1)
 *   legacy: the raw base64url key with no JSON wrapper (no `v` field).
 *
 * `z` moves the size out of the manifest and /meta; it does not hide the size
 * (the chunk count gives it to within 32 MiB; R2 object sizes give it exactly).
 * The key lives in the URL fragment only — never in requests, never in logs,
 * never in the manifest.
 */

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/**
 * toBase64url(bytes) → string
 * Encodes a Uint8Array as base64url (no padding).
 */
function toBase64url(bytes) {
  // btoa requires a binary string; build one from the byte array
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * fromBase64url(str) → Uint8Array
 * Decodes a base64url string (with or without padding).
 */
function fromBase64url(str) {
  // Restore standard base64 padding
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const mod = padded.length % 4;
  const standard = mod === 0 ? padded : padded + '===='.slice(mod);
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * assembleFragment({ keyBytes, filename, sealNonce, sizeBytes }) → string
 *
 * Builds the base64url-encoded JSON fragment blob, link format v2:
 *   { v: 2, k: "<b64url K>", n: "<filename>", s: "<b64url seal_nonce>"?, z: <bytes> }
 *
 * `s` is included only when `sealNonce` is provided (permanent-record transfers).
 * The returned string is suitable for appending after `#` in a share URL.
 *
 * @param {object}      params
 * @param {Uint8Array}  params.keyBytes    — 32-byte transfer key K
 * @param {string}      params.filename    — real filename (not "encrypted-payload")
 * @param {Uint8Array}  [params.sealNonce] — seal nonce for permanent-record transfers
 * @param {number}      params.sizeBytes   — exact plaintext byte count
 * @returns {string} base64url-encoded JSON fragment
 */
export function assembleFragment({ keyBytes, filename, sealNonce, sizeBytes } = {}) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    throw new TypeError('keyBytes must be a 32-byte Uint8Array');
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new TypeError('filename must be a non-empty string');
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new TypeError('sizeBytes must be a positive safe integer');
  }

  // Key order: v, k, n, s?, z
  const obj = { v: 2, k: toBase64url(keyBytes), n: filename };

  if (sealNonce !== undefined) {
    if (!(sealNonce instanceof Uint8Array) || sealNonce.length === 0) {
      throw new TypeError('sealNonce must be a non-empty Uint8Array when provided');
    }
    obj.s = toBase64url(sealNonce);
  }

  obj.z = sizeBytes;

  const json = JSON.stringify(obj);
  // Encode the JSON itself as base64url so it survives URL fragment parsing
  return toBase64url(new TextEncoder().encode(json));
}

/**
 * parseFragment(fragmentString) → { v, keyBytes, ivBytes, filename, sealNonce, sizeBytes, legacy }
 *
 * Parses a URL fragment string produced by assembleFragment() (v2), a v1
 * fragment, or a legacy pre-v1 fragment (raw base64url key, no JSON wrapper).
 *
 * Throws on malformed input. A v2 blob is checked strictly (k exactly 32 bytes,
 * n non-empty, z a positive safe integer) and never falls back to legacy.
 *
 * @param {string} fragmentString — the raw fragment value (after `#`)
 * @returns {{
 *   v:          2 | 1 | undefined,  — undefined for legacy fragments
 *   keyBytes:   Uint8Array,
 *   ivBytes:    Uint8Array | null,  — v1 only; v2 carries no IV
 *   filename:   string | null,  — null for legacy fragments
 *   sealNonce:  Uint8Array | null,
 *   sizeBytes:  number | null,  — always set for v2; v1: null when absent or damaged
 *   legacy:     boolean,
 * }}
 */
export function parseFragment(fragmentString) {
  if (typeof fragmentString !== 'string' || fragmentString.length === 0) {
    throw new TypeError('fragmentString must be a non-empty string');
  }

  // Attempt to decode as base64url → UTF-8 → JSON
  let decoded;
  try {
    const bytes = fromBase64url(fragmentString);
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // Not valid base64url→JSON — treat as legacy raw key
    decoded = null;
  }

  // v2 fragment: strict — anything malformed throws (never read as a legacy raw key)
  if (decoded !== null && typeof decoded === 'object' && decoded.v === 2) {
    if (typeof decoded.k !== 'string') throw new Error('Fragment v2: missing key field (k)');
    let keyBytes;
    try { keyBytes = fromBase64url(decoded.k); } catch { throw new Error('Fragment v2: key field (k) is not base64url'); }
    if (keyBytes.length !== 32) throw new Error('Fragment v2: key field (k) must be 32 bytes');
    if (typeof decoded.n !== 'string' || decoded.n.length === 0) {
      throw new Error('Fragment v2: missing or empty filename field (n)');
    }
    if (!Number.isSafeInteger(decoded.z) || decoded.z < 1) {
      throw new Error('Fragment v2: size field (z) must be a positive integer');
    }
    let sealNonce = null;
    if (decoded.s !== undefined) {
      if (typeof decoded.s !== 'string') throw new Error('Fragment v2: bad seal nonce field (s)');
      try { sealNonce = fromBase64url(decoded.s); } catch { throw new Error('Fragment v2: bad seal nonce field (s)'); }
      if (sealNonce.length === 0) throw new Error('Fragment v2: bad seal nonce field (s)');
    }
    return {
      v: 2,
      keyBytes,
      ivBytes: null,
      filename: decoded.n,
      sealNonce,
      sizeBytes: decoded.z,
      legacy: false,
    };
  }

  // v1 fragment (links made before v2)
  if (decoded !== null && typeof decoded === 'object' && decoded.v === 1) {
    if (typeof decoded.k !== 'string' || decoded.k.length === 0) {
      throw new Error('Fragment v1: missing or empty key field (k)');
    }
    if (typeof decoded.n !== 'string' || decoded.n.length === 0) {
      throw new Error('Fragment v1: missing or empty filename field (n)');
    }

    const keyBytes  = fromBase64url(decoded.k);
    const ivBytes   = decoded.i ? fromBase64url(decoded.i) : null;
    const sealNonce = decoded.s ? fromBase64url(decoded.s) : null;
    // z is optional: a missing or damaged size never breaks the link.
    const sizeBytes = (Number.isSafeInteger(decoded.z) && decoded.z > 0) ? decoded.z : null;

    return {
      v: 1,
      keyBytes,
      ivBytes,
      filename: decoded.n,
      sealNonce,
      sizeBytes,
      legacy: false,
    };
  }

  // Legacy fallback: raw base64url key (no JSON, no `v` field)
  // Accept if the decoded result is not an object with `v`, or if JSON
  // parsing failed entirely. Treat the original string as the raw key.
  try {
    const keyBytes = fromBase64url(fragmentString);
    if (keyBytes.length === 0) {
      throw new Error('Legacy fragment: decoded key is empty');
    }
    return {
      keyBytes,
      filename: null,
      sealNonce: null,
      legacy: true,
    };
  } catch (err) {
    throw new Error(`Malformed fragment: cannot parse as v2, v1 or legacy key — ${err.message}`);
  }
}
