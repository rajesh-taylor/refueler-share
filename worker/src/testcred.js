// ─────────────────────────────────────────────────────────────────────────────
// testcred.js — soak-test credential (KV-Fix-1b · 8 Oct 2026; B12-SR S2 🔒)
//
// The /initiate test bypass is selected by ONE thing only: the header
//   X-Test-Credential: v1.<uuid>.<cap_chunks>.<exp>.<mac>
//   mac = HMAC-SHA256(TEST_CRED_KEY, utf8("refueler.share.testcred.v1") ‖ 0x00 ‖
//                     uuid16 ‖ u32be(cap_chunks) ‖ u64be(exp))      (b64url, 32 B)
// minted only by POST /admin/test-credential. TEST_CRED_KEY is its own secret
// (never derived from ADMIN_KEY or KV_MAC_KEY).
//
// Any failure (secret missing, malformed, wrong MAC, expired, exp > 24 h ahead,
// cap > 8,000, other UUID) reads as ABSENT — the caller takes the normal paid
// path, never an error that reveals the branch. The R2 no-manifest check and
// the KV single-use flag live in handleInitiate.
// WebCrypto only; known-answer vector in test/kv_fix_1b.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { uuidToBytes } from './kvmac.js';

const enc = new TextEncoder();
const MIN_SECRET_BYTES = 32;

export const TESTCRED_TAG         = 'refueler.share.testcred.v1';
export const TESTCRED_MAX_CHUNKS  = 8_000;      // code constant, not config (S2.2)
export const TESTCRED_MAX_LIFE_S  = 24 * 3600;  // exp ≤ 24 h ahead (S2.2)
export const TESTCRED_USED_PREFIX = 'testcred_used:'; // KV single-use flag only

const TOKEN_RE = /^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9]\d{0,3})\.([1-9]\d{0,11})\.([A-Za-z0-9_-]{43})$/;

function b64ToBytes(b64) {
  try {
    const bin = atob(b64.trim());
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch { return null; }
}

function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s) {
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
}

/** importTestCredKey(env) → CryptoKey (HMAC-SHA256) | null when TEST_CRED_KEY is unset or < 32 B. */
export async function importTestCredKey(env) {
  const secret = typeof env?.TEST_CRED_KEY === 'string' ? b64ToBytes(env.TEST_CRED_KEY) : null;
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function testCredMac(key, uuid, capChunks, exp) {
  const u = uuidToBytes(uuid);
  if (!u) return null;
  const tag = enc.encode(TESTCRED_TAG);
  const msg = new Uint8Array(tag.length + 1 + 16 + 4 + 8);
  msg.set(tag, 0);
  msg[tag.length] = 0;
  msg.set(u, tag.length + 1);
  const dv = new DataView(msg.buffer);
  dv.setUint32(tag.length + 17, capChunks, false);
  dv.setBigUint64(tag.length + 21, BigInt(exp), false);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
}

/** makeTestCredential(key, uuid, capChunks, exp) → header value string. */
export async function makeTestCredential(key, uuid, capChunks, exp) {
  const mac = await testCredMac(key, uuid, capChunks, exp);
  if (!mac) throw new Error('makeTestCredential: bad uuid');
  return `v1.${uuid}.${capChunks}.${exp}.${bytesToB64url(mac)}`;
}

/**
 * checkTestCredential(env, header, pathUuid, nowSeconds) → { capChunks, exp } | null
 * null = absent. Checks: format, MAC (constant-time), exp not passed and ≤ 24 h
 * ahead, 1 ≤ cap_chunks ≤ 8,000, token uuid === path uuid.
 */
export async function checkTestCredential(env, header, pathUuid, nowSeconds) {
  if (typeof header !== 'string') return null;
  const m = TOKEN_RE.exec(header);
  if (!m) return null;
  const [, uuid, capStr, expStr, macStr] = m;
  const capChunks = Number(capStr);
  const exp       = Number(expStr);
  if (uuid !== pathUuid) return null;
  if (capChunks > TESTCRED_MAX_CHUNKS) return null;
  if (exp <= nowSeconds || exp > nowSeconds + TESTCRED_MAX_LIFE_S) return null;
  const key = await importTestCredKey(env);
  if (!key) return null;
  const presented = b64urlToBytes(macStr);
  const expected  = await testCredMac(key, uuid, capChunks, exp);
  if (!presented || !expected || presented.length !== expected.length) return null;
  return crypto.subtle.timingSafeEqual(presented, expected) ? { capChunks, exp } : null;
}
