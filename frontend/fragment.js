/**
 * fragment.js — URL fragment grammar v1 helper
 *
 * Implements the locked fragment grammar (D-1 filename fix, SW-MCP-4):
 *
 *   { v: 1, k: "<aes-key-b64url>", i: "<iv-b64url>", n: "<real-filename>", s: "<seal-nonce-b64url>", z: <plaintext-bytes> }
 *
 * The `s` (seal_nonce) field is present only for permanent-record transfers.
 * The `z` field (Share-Size-1) is the exact plaintext byte count (for a folder,
 * the zip as sent). Optional: links made before it parse with sizeBytes null.
 * It moves the size out of the manifest and /meta; it does not hide the size
 * (the chunk count and R2 object sizes still reveal it approximately).
 * The AES session key lives in the URL fragment only — never in requests,
 * never in logs, never in the manifest.
 *
 * Legacy fallback: pre-v1 links carried the raw base64url key with no JSON
 * wrapper. parseFragment() handles these transparently (no `v` field).
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
 * assembleFragment({ keyBytes, filename, sealNonce }) → string
 *
 * Builds the base64url-encoded JSON fragment blob per §7.2:
 *   { v: 1, k: "<b64url key>", n: "<filename>", s: "<b64url seal_nonce>" }
 *
 * `s` is included only when `sealNonce` is provided (permanent-record transfers).
 *
 * The returned string is suitable for appending after `#` in a share URL.
 *
 * @param {object}      params
 * @param {Uint8Array}  params.keyBytes   — 32-byte AES session key
 * @param {Uint8Array}  params.ivBytes    — 12-byte AES-GCM IV
 * @param {string}      params.filename   — real filename (not "encrypted-payload")
 * @param {Uint8Array}  [params.sealNonce] — seal nonce for permanent-record transfers
 * @param {number}      [params.sizeBytes] — exact plaintext byte count (Share-Size-1)
 * @returns {string} base64url-encoded JSON fragment
 */
export function assembleFragment({ keyBytes, ivBytes, filename, sealNonce, sizeBytes } = {}) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length === 0) {
    throw new TypeError('keyBytes must be a non-empty Uint8Array');
  }
  if (!(ivBytes instanceof Uint8Array) || ivBytes.length === 0) {
    throw new TypeError('ivBytes must be a non-empty Uint8Array');
  }
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new TypeError('filename must be a non-empty string');
  }

  const obj = {
    v: 1,
    k: toBase64url(keyBytes),
    i: toBase64url(ivBytes),
    n: filename,
  };

  if (sealNonce !== undefined) {
    if (!(sealNonce instanceof Uint8Array) || sealNonce.length === 0) {
      throw new TypeError('sealNonce must be a non-empty Uint8Array when provided');
    }
    obj.s = toBase64url(sealNonce);
  }

  if (sizeBytes !== undefined) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
      throw new TypeError('sizeBytes must be a positive safe integer when provided');
    }
    obj.z = sizeBytes;
  }

  const json = JSON.stringify(obj);
  // Encode the JSON itself as base64url so it survives URL fragment parsing
  return toBase64url(new TextEncoder().encode(json));
}

/**
 * parseFragment(fragmentString) → { keyBytes, filename, sealNonce, legacy }
 *
 * Parses a URL fragment string produced by assembleFragment().
 * Also handles legacy pre-v1 fragments (raw base64url key, no JSON wrapper).
 *
 * Throws on malformed input.
 *
 * @param {string} fragmentString — the raw fragment value (after `#`)
 * @returns {{
 *   keyBytes:   Uint8Array,
 *   filename:   string | null,  — null for legacy fragments
 *   sealNonce:  Uint8Array | null,
 *   sizeBytes:  number | null,  — v1 only; null when absent or damaged
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

  // v1 fragment: has a numeric `v` field
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
    throw new Error(`Malformed fragment: cannot parse as v1 or legacy key — ${err.message}`);
  }
}
