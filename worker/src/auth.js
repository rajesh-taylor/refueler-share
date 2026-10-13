// ─────────────────────────────────────────────────────────────────────────────
// auth.js — Registered-rail sign-in primitives (B12-4a · 13 Oct 2026)
//
// Design: docs/B12-SR-spec-v1.md S6 (wins). Pure functions only — storage is
// auth_store.js (Supabase), routes are handlers/auth.js.
//
// Secrets (house rule: BLAKE3 unkeyed for high-entropy secrets, keyed for
// low-entropy identifiers):
//   token, session id     32 random bytes; stored only as BLAKE3(secret).
//   AUTH_PEPPER           32+ random bytes, base64 (wrangler secret). Never used
//                         directly — one subkey per job:
//     K_p = HKDF-SHA256(AUTH_PEPPER, salt = empty,
//                       info = utf8("refueler.share.<p>.v1") ‖ 0x00, 32 B)
//     p = "csrf"  → X-CSRF = b64url(BLAKE3-keyed(K_csrf, utf8(tag) ‖ 0x00 ‖ session_id[32]))
//     p = "rl"    → rate-limit KV key = hex(BLAKE3-keyed(K_rl, utf8(tag) ‖ 0x00 ‖ utf8(scope) ‖ 0x00 ‖ utf8(value)))
// Missing or short AUTH_PEPPER → null everywhere; callers fail closed.
// Known-answer vectors: test/b12_4a_auth.test.js.
// ─────────────────────────────────────────────────────────────────────────────

import { blake3 } from '../node_modules/@noble/hashes/blake3.js';
import { concat, b64ToBytes, bytesToB64url, b64urlToBytes } from './kvmac.js';

const enc = new TextEncoder();
const MIN_PEPPER_BYTES = 32;

export const CSRF_TAG = 'refueler.share.csrf.v1';
export const RL_TAG   = 'refueler.share.rl.v1';
export const COOKIE_NAME = '__Host-rfs_session';
export const MAGIC_TTL_SECONDS = 900;   // fixed in SQL too (auth_token_issue)
export const SESSION_CAP = 10;          // S6.5 🟡 — oldest evicted

// S6.5 🔒 — seconds.
export const SESSION_TTL = Object.freeze({
  citizen:   Object.freeze({ idle: 3600, absolute: 86400 }),
  org_admin: Object.freeze({ idle: 1800, absolute: 28800 }),
});

export const PRINCIPAL_KINDS = Object.freeze(['citizen', 'org_admin']);

const toHex = (b) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** 32 fresh random bytes as b64url (43 chars). */
export function newSecret() {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** b64url → 32 bytes, or null for anything else. */
export function parseSecret(s) {
  if (typeof s !== 'string' || s.length !== 43) return null;
  const b = b64urlToBytes(s);
  return b && b.length === 32 ? b : null;
}

/** BLAKE3(secret) as lowercase hex — what Supabase stores. null if malformed. */
export function secretHash(s) {
  const b = parseSecret(s);
  return b ? toHex(blake3(b)) : null;
}

async function subkey(env, purpose) {
  const pepper = typeof env?.AUTH_PEPPER === 'string' ? b64ToBytes(env.AUTH_PEPPER) : null;
  if (!pepper || pepper.length < MIN_PEPPER_BYTES) return null;
  const ikm  = await crypto.subtle.importKey('raw', pepper, 'HKDF', false, ['deriveBits']);
  const info = concat(enc.encode(`refueler.share.${purpose}.v1`), new Uint8Array([0]));
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, ikm, 256,
  );
  return new Uint8Array(bits);
}

/** X-CSRF for a session id (b64url). Derived, never stored (S6.6). */
export async function csrfFor(env, sessionId) {
  const id = parseSecret(sessionId);
  const k  = await subkey(env, 'csrf');
  if (!id || !k) return null;
  return bytesToB64url(blake3(concat(enc.encode(CSRF_TAG), new Uint8Array([0]), id), { key: k }));
}

/** Constant-time check of a presented X-CSRF against the session's. */
export async function csrfOk(env, sessionId, presented) {
  if (typeof presented !== 'string' || presented.length !== 43) return false;
  const want = await csrfFor(env, sessionId);
  if (!want) return false;
  const a = enc.encode(want), b = enc.encode(presented);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Pseudonymous rate-limit id for an email or IP (S6.2): never the raw value at
 * rest in KV. scope names the counter ("magic_ip", "magic_principal", …).
 */
export async function rlId(env, scope, value) {
  if (typeof scope !== 'string' || typeof value !== 'string' || /\0/.test(scope + value)) return null;
  const k = await subkey(env, 'rl');
  if (!k) return null;
  const msg = concat(enc.encode(RL_TAG), new Uint8Array([0]), enc.encode(scope), new Uint8Array([0]), enc.encode(value));
  return toHex(blake3(msg, { key: k }));
}

/** Lowercase, trimmed, plausibly an address, ≤ 254 chars — else null. */
export function normaliseEmail(e) {
  if (typeof e !== 'string') return null;
  const s = e.trim().toLowerCase();
  if (s.length < 3 || s.length > 254 || /[\s\0<>"]/.test(s)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(s) ? s : null;
}

// ── Cookie (S6.5) ────────────────────────────────────────────────────────────
// Host-only (no Domain), Path=/, Secure, HttpOnly, SameSite=Strict.

export function sessionCookie(sessionId, maxAge) {
  return `${COOKIE_NAME}=${sessionId}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** The session id from a Cookie header, or null. Exactly one well-formed value. */
export function readSessionCookie(request) {
  const header = request.headers.get('Cookie') ?? '';
  let found = null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== COOKIE_NAME) continue;
    if (found !== null) return null;                 // duplicate → refuse
    found = part.slice(i + 1).trim();
  }
  return parseSecret(found) ? found : null;
}

// ── Origins (S6.6) ───────────────────────────────────────────────────────────
// AUTH_ORIGINS (wrangler var): comma-separated exact origins allowed to make
// credentialed calls. X5-2 swaps it to https://share.refueler.io — no code change.
// Never a localhost entry in production; never a wildcard.

export function authOrigins(env) {
  return String(env?.AUTH_ORIGINS ?? '')
    .split(',').map(s => s.trim()).filter(s => /^https:\/\/[a-z0-9.-]+$/.test(s));
}

export function isAuthOrigin(env, origin) {
  return typeof origin === 'string' && authOrigins(env).includes(origin);
}
