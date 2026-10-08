// ─────────────────────────────────────────────────────────────────────────────
// kvmac.js — MAC'd KV values (KV-Fix-1a · 8 Oct 2026; design: docs/KV-Audit-v1.md §4.1)
//
// KV is compromised for write (B12-SR X1). A KV value that selects a branch is
// trusted only if it carries a MAC under a Worker secret.
//
//   KV_MAC_KEY          32+ random bytes, base64 (wrangler secret).
//   K_p = HKDF-SHA256(KV_MAC_KEY, salt = empty,
//                     info = utf8("refueler.share.kvmac.<p>.v1") ‖ 0x00, 32 B)
//   MAC = HMAC-SHA256(K_p, utf8(tag) ‖ 0x00 ‖ fixed-length binary fields)
//
// Any failure (secret missing, bad JSON, wrong MAC) reads as ABSENT — never an
// error that reveals the branch. Missing secret → nothing is written or trusted.
// WebCrypto only; known-answer vector in test/kv_fix_1a.test.js.
// ─────────────────────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const MIN_SECRET_BYTES = 32;

export const ROOTV_TAG = 'refueler.share.kvmac.rootv.v1';

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

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
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
}

/** 'xxxxxxxx-xxxx-…' → 16 raw bytes, or null. */
export function uuidToBytes(uuid) {
  const hex = typeof uuid === 'string' ? uuid.replace(/-/g, '') : '';
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g), h => parseInt(h, 16));
}

/**
 * deriveKvMacKey(env, purpose) → CryptoKey (HMAC-SHA256) | null
 * null when KV_MAC_KEY is unset or shorter than 32 bytes.
 */
export async function deriveKvMacKey(env, purpose) {
  const secret = typeof env?.KV_MAC_KEY === 'string' ? b64ToBytes(env.KV_MAC_KEY) : null;
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const ikm  = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const info = concat(enc.encode(`refueler.share.kvmac.${purpose}.v1`), new Uint8Array([0]));
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, ikm, 256,
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function rootvMac(key, uuid, root) {
  const u = uuidToBytes(uuid);
  if (!u || !(root instanceof Uint8Array) || root.length !== 32) return null;
  const msg = concat(enc.encode(ROOTV_TAG), new Uint8Array([0]), u, root);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
}

/**
 * makeRootVerifiedValue(key, uuid, root32) → string for KV `root_verified:{uuid}`
 * Binds uuid AND the manifest merkle_root: a flag copied to another transfer,
 * or left over after the root changes, fails verification.
 */
export async function makeRootVerifiedValue(key, uuid, root) {
  const mac = await rootvMac(key, uuid, root);
  return mac ? JSON.stringify({ v: 1, mac: bytesToB64url(mac) }) : null;
}

/** checkRootVerifiedValue(key, uuid, root32, stored) → boolean (false = absent). */
export async function checkRootVerifiedValue(key, uuid, root, stored) {
  if (!key || typeof stored !== 'string') return false;
  let parsed;
  try { parsed = JSON.parse(stored); } catch { return false; }
  if (!parsed || parsed.v !== 1) return false;
  const presented = b64urlToBytes(parsed.mac);
  const expected  = await rootvMac(key, uuid, root);
  if (!presented || !expected || presented.length !== expected.length) return false;
  return crypto.subtle.timingSafeEqual(presented, expected);
}
