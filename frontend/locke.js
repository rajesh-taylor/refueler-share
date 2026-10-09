// ── frontend/locke.js — Locke (B8, NUT-11 Mode 2) sign side ──────────────────
// Moved out of crypto.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// Loaded by no page yet: B8-5 wires it. Kept, not deleted.
// ─────────────────────────────────────────────────────────────────────────────

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
// The credential functions in crypto.js use the vendored cashu-ts subset (frontend/cashu-crypto.js)
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
