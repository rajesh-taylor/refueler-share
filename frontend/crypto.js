// ── frontend/crypto.js — cryptographic primitives and shared config ───────────
// Extracted from share.js at Share-JS-Refactor session (TH-block).
// Imported by upload.js and download.js. Never imported by index.njk directly.
//
// Exports:
//   loadDeps()                         — initialise blake3 + secp256k1
//   blake3Hash(data)                   — BLAKE3-256, returns hex string
//   sha256Hex(data)                    — SHA-256, returns hex string
//   generateBlindedCredential()        — NUT-00 blind sig step 1
//   unblindSignature(...)              — NUT-00 blind sig step 2
//   bufToHex(buf)                      — ArrayBuffer/Uint8Array → hex string
//   hexToBuf(hex)                      — hex string → ArrayBuffer
//   WORKER_URL, CHUNK_SIZE, FREE_CAP, FREE_EXPIRY, TIER_EXPIRY_SECONDS
//   CHUNK_UPLOAD_TIMEOUT_MS
//
// Architectural note: blake3 and secp are module-level mutable state.
// loadDeps() must be awaited before calling blake3Hash() or any NUT-00 function.
// Both upload.js and download.js call loadDeps() — it is safe to call twice
// (the Promise.all resolves quickly on the second call via module cache).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Config — single source of truth, consumed by upload.js and download.js
// ─────────────────────────────────────────────────────────────────────────────
export const WORKER_URL  = 'https://refueler-share.rt-fc4.workers.dev';
export const CHUNK_SIZE  = 8 * 1024 * 1024;         // 8 MB
export const FREE_CAP    = 4 * 1024 * 1024 * 1024;  // 4 GB
export const FREE_EXPIRY = 7 * 24 * 60 * 60;        // 7 days in seconds

// Tier expiry seconds — mirrors server TIER_EXPIRY_SECONDS.
// Used by resume flow to determine whether a saved transfer is still within window.
export const TIER_EXPIRY_SECONDS = {
  free:              7 * 24 * 60 * 60,
  creative_premium: 30 * 24 * 60 * 60,
  production_max:   90 * 24 * 60 * 60,
};

// Safari fetch timeout — Safari silently hangs on network drops.
export const CHUNK_UPLOAD_TIMEOUT_MS = 60_000; // 60 s per chunk

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic dependencies — loaded once, reused
// ─────────────────────────────────────────────────────────────────────────────
// Module-level mutable state. Safe: ES module is a singleton — all importers
// share the same binding. loadDeps() is idempotent via module cache.
let blake3 = null;
let secp   = null;

export async function loadDeps() {
  if (blake3 && secp) return; // already loaded
  const [b3mod, secpMod] = await Promise.all([
    import('./blake3/browser-async.js'),
    import('https://esm.sh/@noble/secp256k1@1.7.2'),
  ]);
  blake3 = await b3mod.default();
  secp   = secpMod;
  // NOTE: secp256k1@1.7.2 (v1 API) — secp.Point.fromPrivateKey / secp.Point.fromHex
  // Removed in v2. Do not upgrade without migrating NUT-00 crypto.
}

// ─────────────────────────────────────────────────────────────────────────────
// BLAKE3
// ─────────────────────────────────────────────────────────────────────────────
// Returns BLAKE3-256 hex digest of data (Uint8Array or ArrayBuffer).
// blake3 must be initialised via loadDeps() before calling.
export function blake3Hash(data) {
  const h = blake3.createHash();
  h.update(data instanceof Uint8Array ? data : new Uint8Array(data));
  return h.digest('hex');
}

// Returns a new incremental BLAKE3 hasher.
// Caller: h.update(chunk), then h.digest('hex') after final chunk.
// Used by startUpload() for the streaming plaintext root capture (TH-2).
export function blake3CreateHash() {
  return blake3.createHash();
}

// ─────────────────────────────────────────────────────────────────────────────
// SHA-256
// ─────────────────────────────────────────────────────────────────────────────
export async function sha256Hex(data) {
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// NUT-00 blind signature — uses secp256k1 v1 API (secp.Point.*)
// DO NOT upgrade secp256k1 to v2 without migrating these functions.
// ─────────────────────────────────────────────────────────────────────────────
export async function generateBlindedCredential() {
  const r   = secp.utils.randomPrivateKey();
  const msg = crypto.getRandomValues(new Uint8Array(32));
  const Y   = await _hashToCurve(bufToHex(msg));
  const rG  = secp.Point.fromPrivateKey(r);
  const B_  = Y.add(rG);
  return { blindedMsg: B_.toHex(true), blindingFactor: bufToHex(r) };
}

export async function unblindSignature(signedPoint, blindingFactor, mintPubkeyHex) {
  const C_ = secp.Point.fromHex(signedPoint);
  const K  = secp.Point.fromHex(mintPubkeyHex);
  const r  = BigInt('0x' + blindingFactor);
  const C  = C_.add(K.multiply(r).negate());
  return JSON.stringify({ C: C.toHex(true), mint_pubkey: mintPubkeyHex });
}

async function _hashToCurve(msgHex) {
  const hash = await crypto.subtle.digest('SHA-256', hexToBuf(msgHex));
  const hashHex = bufToHex(hash);
  for (let i = 0; i < 256; i++) {
    try {
      return secp.Point.fromHex('02' + (BigInt('0x' + hashHex) + BigInt(i)).toString(16).padStart(64, '0'));
    } catch { continue; }
  }
  throw new Error('hashToCurve failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Byte helpers
// ─────────────────────────────────────────────────────────────────────────────
export function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return out.buffer;
}
