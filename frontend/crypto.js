// ── frontend/crypto.js — cryptographic primitives and shared config ───────────
// Extracted from share.js at Share-JS-Refactor session (TH-block).
// Imported by upload.js and download.js. Never imported by index.njk directly.
//
// Exports:
//   loadDeps()                         — initialise blake3 + cashu-crypto (upload only)
//   loadBlake3(), loadCashu()          — the two halves of loadDeps()
//   blake3Impl()                       — 'wasm' | 'js' | null (which BLAKE3 loaded)
//   blake3Hash(data)                   — BLAKE3-256, returns hex string
//   sha256Hex(data)                    — SHA-256, returns hex string
//   generateBlindedCredential()        — NUT-00 blind sig step 1 (credential format v2)
//   unblindSignature(issued, blinded)  — NUT-12 DLEQ check + NUT-00 step 2 → credential JSON
//   derivePartKey, partNonce, partAad  — part key schedule (link format v2)
//   encryptPart, decryptPart           — part i of n under the part key (v2)
//   decryptPartV1                      — parts of links made before v2
//   bufToHex(buf)                      — ArrayBuffer/Uint8Array → hex string
//   hexToBuf(hex)                      — hex string → ArrayBuffer
//   WORKER_URL, CHUNK_SIZE, FREE_CAP, FREE_EXPIRY, TIER_EXPIRY_SECONDS
//   CHUNK_UPLOAD_TIMEOUT_MS
//
// Architectural note: blake3 and cashu are module-level mutable state.
// loadDeps() must be awaited before calling blake3Hash() or any NUT-00 function.
// Only upload mode calls it (upload.js, merkle.js selfTest). Receiver mode uses
// neither and must not wait on it (Share-Deps-1). Safe to call repeatedly: each
// loader caches its promise.
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
// Dynamic dependencies — local files only, loaded once, reused (Share-Deps-1)
// ─────────────────────────────────────────────────────────────────────────────
// Module-level mutable state. Safe: ES module is a singleton — all importers
// share the same binding.
//
// Nothing here is ever fetched from a CDN: the upload page holds the AES key (F-21).
//
// BLAKE3: the WASM bundle (frontend/blake3/) first. If WebAssembly is missing
// (Vanadium with the JIT off, F-20), fails to load, or gets the known answer
// wrong, fall back to vendored pure-JS noble BLAKE3 (frontend/noble-blake3.js).
// Same digests either way; the fallback is just slower (~2.5 MiB/s with no JIT).
//
// Cashu (credential format v2): vendored @cashu/cashu-ts 4.11.0 subset
// (frontend/cashu-crypto.js, built by bin/vendor-cashu.sh) — the same library and
// version the Worker verifies with. No hand-rolled curve maths here.
let blake3     = null;   // { createHash() } — WASM module or the noble wrapper below
let blake3Kind = null;   // 'wasm' | 'js'
let cashu      = null;   // { hashToCurve, blindMessage, unblindSignature, verifyDLEQProof, pointFromHex }
let _blake3Loading = null;
let _cashuLoading  = null;

// BLAKE3("abc") — official test vector. Checked against whichever BLAKE3 loads.
const _B3_KAT_ABC = '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85';

export async function loadDeps() {
  await Promise.all([loadBlake3(), loadCashu()]);
}

export function loadBlake3() {
  if (!_blake3Loading) {
    _blake3Loading = _loadBlake3().catch(e => { _blake3Loading = null; throw e; });
  }
  return _blake3Loading;
}

export function loadCashu() {
  if (!_cashuLoading) {
    _cashuLoading = import('./cashu-crypto.js')
      .then(mod => { cashu = mod; })
      .catch(e => { _cashuLoading = null; throw e; });
  }
  return _cashuLoading;
}

export function blake3Impl() {
  return blake3Kind;
}

async function _loadBlake3() {
  if (typeof WebAssembly === 'object') {
    try {
      const b3mod = await import('./blake3/browser-async.js');
      const wasm  = await b3mod.default();
      if (_blake3Kat(wasm)) { blake3 = wasm; blake3Kind = 'wasm'; return; }
    } catch { /* fall through to pure JS */ }
  }
  const { blake3: nobleBlake3 } = await import('./noble-blake3.js');
  const js = { createHash: () => _nobleHasher(nobleBlake3.create({})) };
  if (!_blake3Kat(js)) throw new Error('BLAKE3 self-test failed');
  blake3 = js; blake3Kind = 'js';
}

function _blake3Kat(impl) {
  const h = impl.createHash();
  h.update(new TextEncoder().encode('abc'));
  return h.digest('hex') === _B3_KAT_ABC;
}

// The WASM hasher's surface, as far as Share uses it: update(bytes), digest('hex').
function _nobleHasher(h) {
  return {
    update(data) { h.update(data instanceof Uint8Array ? data : new Uint8Array(data)); return this; },
    digest(enc)  { const out = h.digest(); return enc === 'hex' ? bufToHex(out) : out; },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BLAKE3
// ─────────────────────────────────────────────────────────────────────────────
// Returns BLAKE3-256 hex digest of data (Uint8Array or ArrayBuffer).
// blake3 must be initialised via loadDeps() (or loadBlake3()) before calling.
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
// Part encryption (link format v2, Share-Crypto-1)
//
// K = the 32-byte transfer key in the link. Parts use a key derived from it:
//   part_key = HKDF-SHA256(K, salt = empty, info = utf8("refueler.share.payload.v2") ‖ 0x00)
//   nonce_i  = 0x00 ×7 ‖ BE32(i) ‖ last   (last = 0x01 on part N−1, else 0x00)
//   AAD_i    = BE32(i)
// Stored part = AES-256-GCM(part_key, nonce_i, AAD_i, P_i) = ciphertext ‖ 16-byte tag.
// The date seal (timestamp.js) stays on K itself, with its own random IV.
// Links before v2 (v0/v1) decrypt with decryptPartV1: K directly + the link's IV.
// ─────────────────────────────────────────────────────────────────────────────
const _PAYLOAD_INFO = new Uint8Array([...new TextEncoder().encode('refueler.share.payload.v2'), 0x00]);

/** K (32 bytes) → AES-GCM CryptoKey for parts. usages: ['encrypt'] or ['decrypt']. */
export async function derivePartKey(kBytes, usages) {
  const k = kBytes instanceof Uint8Array ? kBytes : new Uint8Array(kBytes);
  if (k.length !== 32) throw new TypeError('derivePartKey: K must be 32 bytes');
  const ikm = await crypto.subtle.importKey('raw', k, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: _PAYLOAD_INFO },
    ikm, { name: 'AES-GCM', length: 256 }, false, usages,
  );
}

/** 12-byte nonce for part i; last = true on the final part. */
export function partNonce(i, last) {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setUint32(7, i, false);
  n[11] = last ? 1 : 0;
  return n;
}

/** 4-byte AAD for part i (BE uint32 = object index = Merkle leaf index). */
export function partAad(i) {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, i, false);
  return a;
}

/** Encrypt part i of n → Uint8Array (ciphertext ‖ tag). */
export async function encryptPart(partKey, raw, i, n) {
  return new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: partNonce(i, i === n - 1), additionalData: partAad(i) }, partKey, raw,
  ));
}

/** Decrypt part i of n → ArrayBuffer. Throws if the part, its index or its place as last doesn't check out. */
export function decryptPart(partKey, ct, i, n) {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: partNonce(i, i === n - 1), additionalData: partAad(i) }, partKey, ct,
  );
}

/** Links before v2: K imported directly as AES-GCM, the link's 12-byte IV, AAD = BE32(i). */
export function decryptPartV1(key, iv, ct, i) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: partAad(i) }, key, ct);
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential format v2 — a standard Cashu proof { id, amount: 1, secret, C }.
// Worker side: verifyProofV2 in worker/src/nut00.js (Y = hash_to_curve(utf8(secret)),
// k·Y == C). Requires loadDeps() (or loadCashu()) first.
// ─────────────────────────────────────────────────────────────────────────────

/** Step 1 → { blindedMsg, blindingFactor, secret }. Keep the result until step 2. */
export async function generateBlindedCredential() {
  // secret: 64-hex string of 32 random bytes; its UTF-8 bytes are hashed to the curve (NUT-00).
  const secret = bufToHex(crypto.getRandomValues(new Uint8Array(32)));
  const { B_, r } = cashu.blindMessage(new TextEncoder().encode(secret));
  return {
    blindedMsg:     B_.toHex(true),
    blindingFactor: r.toString(16).padStart(64, '0'),
    secret,
  };
}

/** Thrown when the issue response's NUT-12 DLEQ proof does not check out. */
export class CredentialProofError extends Error {
  constructor(message) { super(message); this.name = 'CredentialProofError'; }
}

/**
 * Step 2. issued = the /credential/issue JSON ({ signed_point, mint_pubkey, keyset_id, dleq }),
 * blinded = generateBlindedCredential()'s result. Checks the NUT-12 DLEQ proof (the signature
 * matches the key it came with — the key is not pinned), then unblinds.
 * → JSON string for X-Cashu-Credential. Throws CredentialProofError on a bad or missing proof.
 */
export async function unblindSignature(issued, blinded) {
  const { signed_point, mint_pubkey, keyset_id, dleq } = issued || {};
  if (!signed_point || !mint_pubkey || !keyset_id || !dleq?.e || !dleq?.s) {
    throw new CredentialProofError('Credential issue response missing signature, keyset id or DLEQ proof');
  }
  let C_, K, verified = false;
  try {
    C_ = cashu.pointFromHex(signed_point);
    K  = cashu.pointFromHex(mint_pubkey);
    const B_ = cashu.pointFromHex(blinded.blindedMsg);
    const proof = { e: new Uint8Array(hexToBuf(dleq.e)), s: new Uint8Array(hexToBuf(dleq.s)) };
    verified = cashu.verifyDLEQProof(proof, B_, C_, K);
  } catch {
    // malformed point or out-of-range scalar — the library throws rather than returning false
  }
  if (!verified) throw new CredentialProofError('Credential DLEQ proof did not verify');
  const C = cashu.unblindSignature(C_, BigInt('0x' + blinded.blindingFactor), K);
  return JSON.stringify({ id: keyset_id, amount: 1, secret: blinded.secret, C: C.toHex(true) });
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
// The credential functions above use the vendored cashu-ts subset (frontend/cashu-crypto.js)
// — these are separate and must not share the same secp binding.
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
