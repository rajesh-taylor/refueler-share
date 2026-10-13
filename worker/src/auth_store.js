// ─────────────────────────────────────────────────────────────────────────────
// auth_store.js — sign-in tokens and sessions in Supabase (B12-4a · 13 Oct 2026)
//
// SQL: supabase/migrations/20261012_b12_4a_auth.sql. Never KV (B12-SR X1): a
// KV writer must not be able to mint a session. No cache — revocation is
// immediate. Any Supabase failure throws StoreUnavailable; callers answer 503.
// Arguments are BLAKE3 hashes (hex) from auth.js — never a raw token or id.
// ─────────────────────────────────────────────────────────────────────────────

import { rpc } from './api_store.js';
export { StoreUnavailable } from './api_store.js';

/** → [{ kind, ref }] for a normalised email (≤ 3 of each kind). */
export async function principalsForEmail(env, email) {
  const r = await rpc(env, 'auth_principals_for_email', { p_email: email });
  return Array.isArray(r) ? r : [];
}

export async function issueToken(env, tokenHash, kind, ref) {
  await rpc(env, 'auth_token_issue', { p_token_hash: tokenHash, p_kind: kind, p_ref: ref });
}

/** Atomic single use → { kind, ref } | null. */
export async function consumeToken(env, tokenHash) {
  return (await rpc(env, 'auth_token_consume', { p_token_hash: tokenHash })) ?? null;
}

export async function createSession(env, sessionHash, kind, ref, ttl, cap) {
  return rpc(env, 'auth_session_create', {
    p_session_hash: sessionHash, p_kind: kind, p_ref: ref,
    p_idle_ttl: ttl.idle, p_abs_ttl: ttl.absolute, p_cap: cap,
  });
}

/** → { kind, ref, idle_expires_at, absolute_expires_at } | null (expired rows are deleted). */
export async function checkSession(env, sessionHash, idleTtl) {
  return (await rpc(env, 'auth_session_check', { p_session_hash: sessionHash, p_idle_ttl: idleTtl })) ?? null;
}

export async function deleteSession(env, sessionHash) {
  return rpc(env, 'auth_session_delete', { p_session_hash: sessionHash });
}

/** Every session and unused token of this session's principal → rows deleted. */
export async function deleteAllSessions(env, sessionHash) {
  return rpc(env, 'auth_session_delete_all', { p_session_hash: sessionHash });
}

export async function sweepAuth(env) {
  return rpc(env, 'auth_sweep', {});
}
