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
export const WORKER_URL  = 'https://api.share.refueler.io';
export const CHUNK_SIZE  = 32 * 1024 * 1024;        // 32 MiB — Share-6-2 spec §2
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

// =============================================================================
// B8-1 — NUT-11 Mode 2 (Locke) pure functions — sign side
//
// Parity: worker/src/locke.js (verify) ↔ this file (sign) ↔ refueler-mcp/src/crypto.js
//
// Noble imports required — add to your bundler / import map for B8-5:
//   @noble/curves/secp256k1  → schnorr, secp256k1
//   @noble/hashes/sha2       → sha256, sha512
//   @noble/hashes/hkdf       → hkdf
//   @noble/hashes/pbkdf2     → pbkdf2
// These are the v2 noble packages already present in the Worker.
// The existing NUT-00 functions above use secp v1 via esm.sh — these are separate
// and must not share the same secp binding.
// =============================================================================

// Resolved at B8-5 when the frontend import map is wired. Stubs declared here
// so the functions below can be pasted verbatim into B8-5 without modification.
// Remove this block and replace with real imports at B8-5.
let _nobleSchnorr    = null; // schnorr from @noble/curves/secp256k1
let _nobleSecp256k1  = null; // secp256k1 from @noble/curves/secp256k1
let _nobleSha256     = null; // sha256 from @noble/hashes/sha2
let _nobleSha512     = null; // sha512 from @noble/hashes/sha2
let _nobleHkdf       = null; // hkdf from @noble/hashes/hkdf
let _noblePbkdf2     = null; // pbkdf2 from @noble/hashes/pbkdf2

/** Call once at B8-5 when noble v2 packages are available in the browser bundle. */
export async function loadLockeDeps() {
  if (_nobleSchnorr) return;
  const [curveMod, sha2Mod, hkdfMod, pbkdf2Mod] = await Promise.all([
    import('@noble/curves/secp256k1'),
    import('@noble/hashes/sha2'),
    import('@noble/hashes/hkdf'),
    import('@noble/hashes/pbkdf2'),
  ]);
  _nobleSchnorr   = curveMod.schnorr;
  _nobleSecp256k1 = curveMod.secp256k1;
  _nobleSha256    = sha2Mod.sha256;
  _nobleSha512    = sha2Mod.sha512;
  _nobleHkdf      = hkdfMod.hkdf;
  _noblePbkdf2    = pbkdf2Mod.pbkdf2;
}

// ---------------------------------------------------------------------------
// Locke constants (must match worker/src/locke.js exactly)
// ---------------------------------------------------------------------------

const _LOCKE_N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'
);
const _LOCKE_HKDF_SALT  = new TextEncoder().encode('refueler.locke.v1');
const _LOCKE_INFO_BASE   = 'locke_keypair';
const _LOCKE_DOMAIN_LOGIN      = 'refueler.locke.login.v1';
const _LOCKE_DOMAIN_AUTHORISE  = 'refueler.locke.authorise.v1';
const _LOCKE_DOMAIN_REVOKE     = 'refueler.locke.revoke.v1';

// ---------------------------------------------------------------------------
// deriveLockeFromDeed
//
// BIP-39 mnemonic → secp256k1 keypair via HKDF (B8-Opus D-1).
// Requires loadLockeDeps() to have been awaited.
//
// @param {string} mnemonic
// @returns {Promise<{ privateKey: Uint8Array, publicKey: Uint8Array }>}
// ---------------------------------------------------------------------------
export async function deriveLockeFromDeed(mnemonic) {
  if (typeof mnemonic !== 'string' || !mnemonic.trim()) {
    throw new TypeError('deriveLockeFromDeed: mnemonic must be a non-empty string');
  }
  if (!_noblePbkdf2) throw new Error('deriveLockeFromDeed: call loadLockeDeps() first');

  const mnemonicBytes = new TextEncoder().encode(mnemonic.normalize('NFKD'));
  const saltBytes     = new TextEncoder().encode('mnemonic'); // BIP-39 passphrase = ""
  const seed = _noblePbkdf2(_nobleSha512, mnemonicBytes, saltBytes, { c: 2048, dkLen: 64 });

  let counter = 0;
  while (true) {
    const info = counter === 0 ? _LOCKE_INFO_BASE : `${_LOCKE_INFO_BASE}.${counter}`;
    const okm  = _nobleHkdf(_nobleSha256, seed, _LOCKE_HKDF_SALT, new TextEncoder().encode(info), 32);

    let d = BigInt(0);
    for (const byte of okm) { d = (d << BigInt(8)) | BigInt(byte); }

    if (d >= BigInt(1) && d < _LOCKE_N) {
      return {
        privateKey: okm,
        publicKey:  _nobleSecp256k1.getPublicKey(okm, true),
      };
    }
    counter++;
    if (counter > 100) throw new Error('deriveLockeFromDeed: reject-sampling failed (cosmological event)');
  }
}

// ---------------------------------------------------------------------------
// signLockeMessage
//
// Signs a 32-byte Locke message (from buildLockeLoginMsg etc.) with the
// Locke private key. Requires loadLockeDeps().
//
// @param {Uint8Array} msg      32-byte message
// @param {Uint8Array} privKey  32-byte Locke private key
// @returns {Uint8Array}  64-byte Schnorr BIP-340 signature
// ---------------------------------------------------------------------------
export function signLockeMessage(msg, privKey) {
  if (!_nobleSchnorr) throw new Error('signLockeMessage: call loadLockeDeps() first');
  if (!(msg instanceof Uint8Array) || msg.length !== 32) {
    throw new TypeError('signLockeMessage: msg must be Uint8Array(32)');
  }
  if (!(privKey instanceof Uint8Array) || privKey.length !== 32) {
    throw new TypeError('signLockeMessage: privKey must be Uint8Array(32)');
  }
  return _nobleSchnorr.sign(msg, privKey);
}

// ---------------------------------------------------------------------------
// buildLockeLoginMsg
//
// msg = SHA-256(utf8("refueler.locke.login.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(challengeHex))
//
// @param {string} harbourUuid
// @param {string} challengeHex  32-byte hex (64 chars)
// @returns {Uint8Array}  32-byte message
// ---------------------------------------------------------------------------
export function buildLockeLoginMsg(harbourUuid, challengeHex) {
  if (!_nobleSha256) throw new Error('buildLockeLoginMsg: call loadLockeDeps() first');
  _lockeAssertHex(challengeHex, 32, 'challengeHex');
  return _lockeBuildMsg(_LOCKE_DOMAIN_LOGIN, harbourUuid, _lockeHexToBytes(challengeHex));
}

// ---------------------------------------------------------------------------
// buildLockeAuthoriseMsg
//
// msg = SHA-256(utf8("refueler.locke.authorise.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(newPubkeyHex))
//
// @param {string} harbourUuid
// @param {string} newPubkeyHex  33-byte compressed pubkey hex (66 chars)
// @returns {Uint8Array}  32-byte message
// ---------------------------------------------------------------------------
export function buildLockeAuthoriseMsg(harbourUuid, newPubkeyHex) {
  if (!_nobleSha256) throw new Error('buildLockeAuthoriseMsg: call loadLockeDeps() first');
  _lockeAssertHex(newPubkeyHex, 33, 'newPubkeyHex');
  return _lockeBuildMsg(_LOCKE_DOMAIN_AUTHORISE, harbourUuid, _lockeHexToBytes(newPubkeyHex));
}

// ---------------------------------------------------------------------------
// buildLockeRevokeMsg
//
// msg = SHA-256(utf8("refueler.locke.revoke.v1") ‖ utf8(harbourUuid) ‖ hexToBytes(targetPubkeyHex))
//
// @param {string} harbourUuid
// @param {string} targetPubkeyHex  33-byte compressed pubkey hex (66 chars)
// @returns {Uint8Array}  32-byte message
// ---------------------------------------------------------------------------
export function buildLockeRevokeMsg(harbourUuid, targetPubkeyHex) {
  if (!_nobleSha256) throw new Error('buildLockeRevokeMsg: call loadLockeDeps() first');
  _lockeAssertHex(targetPubkeyHex, 33, 'targetPubkeyHex');
  return _lockeBuildMsg(_LOCKE_DOMAIN_REVOKE, harbourUuid, _lockeHexToBytes(targetPubkeyHex));
}

// ---------------------------------------------------------------------------
// Internal helpers (Locke-local, prefixed _locke to avoid collision)
// ---------------------------------------------------------------------------

function _lockeHexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function _lockeAssertHex(hex, expectedByteLen, name) {
  if (typeof hex !== 'string' || hex.length !== expectedByteLen * 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new TypeError(`${name} must be ${expectedByteLen}-byte hex (${expectedByteLen * 2} chars)`);
  }
}

function _lockeBuildMsg(domain, harbourUuid, extraBytes) {
  if (!harbourUuid) throw new TypeError('harbourUuid required');
  const enc = new TextEncoder();
  const t = enc.encode(domain), u = enc.encode(harbourUuid);
  const combined = new Uint8Array(t.length + u.length + extraBytes.length);
  combined.set(t); combined.set(u, t.length); combined.set(extraBytes, t.length + u.length);
  return _nobleSha256(combined);
}
