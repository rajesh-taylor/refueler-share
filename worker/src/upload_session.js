// ─────────────────────────────────────────────────────────────────────────────
// upload_session.js — MAC'd upload session token (B12-3 · 11 Oct 2026; B12-SR S1.2/S1.3 🔒)
//
//   X-Upload-Session: v1.<session_exp>.<total_chunks>.<mac>
//   mac = HMAC-SHA256(UPLOAD_SESSION_KEY, utf8("refueler.share.upsession.v1") ‖ 0x00 ‖
//                     uuid16 ‖ u32be(total_chunks) ‖ u64be(session_exp))      (b64url, 32 B)
//
// The bound /urls and /finalise enforce comes from this MAC, never from KV (S1.3):
// there is no KV session record at all. "Spent" and "deleted" are read from the
// R2 manifest (upload_complete / consumed), which is the truth anyway.
//
// Deviation from S1.3 (B12-3, stated in the session log): the commitment is not
// a MAC input. No verifier holds an independent copy of it (it is checked once,
// at initiate, against COMMITMENT_KEY), so including it would add bytes, not a
// check. The UUID binds the token to the transfer the commitment authorised.
//
// One clock (S1.2): session_exp = min(initiate + UPLOAD_WINDOW, transfer expiry).
// Reservation expires_at and every presigned URL's expiry use the same value.
// WebCrypto only; known-answer vector in test/b12_3_quota.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { uuidToBytes, b64ToBytes, bytesToB64url, b64urlToBytes } from './kvmac.js';
import { blake3Hash } from './blake3_worker.js';

const enc = new TextEncoder();
const MIN_SECRET_BYTES = 32;

export const UPSESSION_TAG       = 'refueler.share.upsession.v1';
export const UPLOAD_WINDOW       = 6 * 24 * 3600;   // 6 days (S1.2) = PRESIGN_EXPIRY
export const MAX_TRANSFER_CHUNKS = 8_000;           // 250 GiB at 32 MiB (S1.6)

const TOKEN_RE = /^v1\.([1-9]\d{0,11})\.([1-9]\d{0,3})\.([A-Za-z0-9_-]{43})$/;

async function importKey(env) {
  const secret = typeof env?.UPLOAD_SESSION_KEY === 'string' ? b64ToBytes(env.UPLOAD_SESSION_KEY) : null;
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** True when UPLOAD_SESSION_KEY is usable (initiate fails closed before any spend). */
export async function hasUploadSessionKey(env) {
  return (await importKey(env)) !== null;
}

async function sessionMac(key, uuid, totalChunks, sessionExp) {
  const u = uuidToBytes(uuid);
  if (!u) return null;
  const tag = enc.encode(UPSESSION_TAG);
  const msg = new Uint8Array(tag.length + 1 + 16 + 4 + 8);
  msg.set(tag, 0);
  msg[tag.length] = 0;
  msg.set(u, tag.length + 1);
  const dv = new DataView(msg.buffer);
  dv.setUint32(tag.length + 17, totalChunks, false);
  dv.setBigUint64(tag.length + 21, BigInt(sessionExp), false);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
}

/** sessionExpiry(nowSeconds, expiryTs) → min(now + UPLOAD_WINDOW, transfer expiry). */
export function sessionExpiry(nowSeconds, expiryTs) {
  return Math.min(nowSeconds + UPLOAD_WINDOW, expiryTs);
}

/** makeSessionToken(env, uuid, totalChunks, sessionExp) → token string | null (key missing). */
export async function makeSessionToken(env, uuid, totalChunks, sessionExp) {
  const key = await importKey(env);
  if (!key) return null;
  const mac = await sessionMac(key, uuid, totalChunks, sessionExp);
  if (!mac) return null;
  return `v1.${sessionExp}.${totalChunks}.${bytesToB64url(mac)}`;
}

/**
 * verifySessionToken(env, token, uuid, nowSeconds) → { totalChunks, sessionExp } | null
 * null = absent, malformed, wrong MAC (constant time), other UUID, or expired.
 */
export async function verifySessionToken(env, token, uuid, nowSeconds) {
  if (typeof token !== 'string') return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const sessionExp  = Number(m[1]);
  const totalChunks = Number(m[2]);
  if (totalChunks > MAX_TRANSFER_CHUNKS || sessionExp <= nowSeconds) return null;
  const key = await importKey(env);
  if (!key) return null;
  const presented = b64urlToBytes(m[3]);
  const expected  = await sessionMac(key, uuid, totalChunks, sessionExp);
  if (!presented || !expected || presented.length !== expected.length) return null;
  return crypto.subtle.timingSafeEqual(presented, expected) ? { totalChunks, sessionExp } : null;
}

/** sessionHash(token) → 64 hex chars: BLAKE3(utf8(token)), unkeyed (high-entropy secret). */
export async function sessionHash(token) {
  const h = await blake3Hash(enc.encode(token));
  return Array.from(h, b => b.toString(16).padStart(2, '0')).join('');
}
