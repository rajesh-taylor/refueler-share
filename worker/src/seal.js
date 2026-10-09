// ─────────────────────────────────────────────────────────────────────────────
// seal.js — fields sealed at rest under SHARE_SEAL_KEY_<kid>
// (API-Repair-1 · 9 Oct 2026; construction: B12-SR S3(a), amended for the
//  global encryption rule — info = utf8(tag) ‖ 0x00)
//
//   K   = HKDF-SHA256(ikm  = SHARE_SEAL_KEY_<kid>,
//                     salt = utf8("refueler.share.seal.v1"),
//                     info = utf8(<purpose tag>) ‖ 0x00, 32 B)
//   ct  = AES-256-GCM(K, nonce = 12 fresh random bytes,
//                     aad = utf8(<aad tag>) ‖ 0x00 ‖ uuid16 ‖ utf8(kid))
//   stored as { v: 1, k: kid, n: b64url(nonce), c: b64url(ct ‖ tag) }
//
// One key per job (purpose tag), a fresh nonce per write: never two
// encryptions under one key and nonce. kid is the non-secret SHARE_SEAL_CURRENT
// var; rotation adds SHARE_SEAL_KEY_2 and flips it; reads pick by k.
// Any failure (secret missing, bad shape, wrong key, tampered) → null. Callers
// fail closed. WebCrypto only; known-answer vectors in test/api_repair_1.test.js.
//
// Users today:
//   cref_ct — the Chartered client (org_account_id) + its transfer_ref, in the
//             R2 manifest. Stripped by buildTombstone (it keeps two fields only).
// B12-3 adds qref_ct with purpose 'refueler.share.qref.v1'.
// ─────────────────────────────────────────────────────────────────────────────

import { concat, b64ToBytes, bytesToB64url, b64urlToBytes, uuidToBytes } from './kvmac.js';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
const SALT = enc.encode('refueler.share.seal.v1');
const MIN_SECRET_BYTES = 32;
const KID_RE = /^[1-9][0-9]{0,2}$/;

export const CREF_TAG     = 'refueler.share.cref.v1';
export const CREF_AAD_TAG = 'refueler.share.manifest.cref.v1';
const TRANSFER_REF_MAX = 128;

async function sealKey(env, kid, purpose) {
  if (!KID_RE.test(String(kid ?? ''))) return null;
  const raw = env?.[`SHARE_SEAL_KEY_${kid}`];
  const secret = typeof raw === 'string' ? b64ToBytes(raw) : null;
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const ikm  = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const info = concat(enc.encode(purpose), new Uint8Array([0]));
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info }, ikm,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function aadFor(aadTag, uuid16, kid) {
  return concat(enc.encode(aadTag), new Uint8Array([0]), uuid16, enc.encode(String(kid)));
}

/**
 * seal(env, { purpose, aadTag, uuid, plaintext }, _nonce?) → { v, k, n, c } | null
 * _nonce is for known-answer tests only; production always draws a fresh one.
 */
export async function seal(env, { purpose, aadTag, uuid, plaintext }, _nonce) {
  const kid = String(env?.SHARE_SEAL_CURRENT ?? '');
  const u = uuidToBytes(uuid);
  const key = u ? await sealKey(env, kid, purpose) : null;
  if (!key || !(plaintext instanceof Uint8Array)) return null;
  const nonce = _nonce ?? crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aadFor(aadTag, u, kid) }, key, plaintext,
  ));
  return { v: 1, k: kid, n: bytesToB64url(nonce), c: bytesToB64url(ct) };
}

/** open(env, { purpose, aadTag, uuid, sealed }) → Uint8Array | null */
export async function open(env, { purpose, aadTag, uuid, sealed }) {
  if (!sealed || typeof sealed !== 'object' || sealed.v !== 1) return null;
  const u = uuidToBytes(uuid);
  const nonce = b64urlToBytes(sealed.n);
  const ct = b64urlToBytes(sealed.c);
  if (!u || !nonce || nonce.length !== 12 || !ct || ct.length < 16) return null;
  const key = await sealKey(env, sealed.k, purpose);
  if (!key) return null;
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aadFor(aadTag, u, sealed.k) }, key, ct,
    ));
  } catch { return null; }
}

// ── cref_ct: plaintext = org16 ‖ utf8(transfer_ref) ─────────────────────────

/** sealCref(env, uuid, org, transferRef) → sealed object | null */
export async function sealCref(env, uuid, org, transferRef, _nonce) {
  const o = uuidToBytes(org);
  if (!o) return null;
  const ref = transferRef ? enc.encode(String(transferRef).slice(0, TRANSFER_REF_MAX)) : new Uint8Array(0);
  return seal(env, { purpose: CREF_TAG, aadTag: CREF_AAD_TAG, uuid, plaintext: concat(o, ref) }, _nonce);
}

/** openCref(env, uuid, sealed) → { org, transferRef } | null */
export async function openCref(env, uuid, sealed) {
  const pt = await open(env, { purpose: CREF_TAG, aadTag: CREF_AAD_TAG, uuid, sealed });
  if (!pt || pt.length < 16) return null;
  const h = Array.from(pt.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  const org = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  let transferRef = null;
  try { transferRef = pt.length > 16 ? dec.decode(pt.slice(16)) : null; } catch { return null; }
  return { org, transferRef };
}

/** True when a manifest says a Chartered client owns the transfer (no decrypt). */
export function hasCref(manifest) {
  return !!manifest && typeof manifest.cref_ct === 'object' && manifest.cref_ct !== null;
}
