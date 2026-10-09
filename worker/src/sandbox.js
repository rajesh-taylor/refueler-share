// worker/src/sandbox.js
//
// SW6 — API sandbox environment.
//
// Purpose: lets future API clients walk the rails with real HMAC signatures,
// real request/response shapes, and real Worker logic — without touching
// production cargo, production quota, or the production credit ledger.
//
// Intentionally observable (non-anonymous by design):
//   - All sandbox responses carry X-Refueler-Sandbox: true.
//   - The sandbox states plainly: "do not send real cargo here."
//
// Key scheme (GitHub-scanner safe):
//   rfs_test_live_{base58}  — identification
//   rfs_test_sign_{base58}  — signing secret (only SHA-256 stored)
//
// Store (KV-Fix-2 · 9 Oct 2026): Supabase, the same tables as production —
//   api_keys row with sandbox = true, expires_at = activation + 30 days;
//   identity rail: api_credit_pools row, plan 'sandbox' (25 credits, hard stop,
//   refilled only by /reset). Anonymous-rail sandbox: key row, no pool; test
//   tokens are returned to the caller and never stored. Nothing in KV — a KV
//   writer could otherwise forge a client or refill credits (B12-SR X1).
//   The raw live key is no longer stored anywhere (was sandbox_meta_).
//
// Sandbox keys authenticate ONLY on these routes (requireApiAuth sandbox:true);
// production routes refuse them, and credential issue refuses them outright
// (it would sign on the production mint key — KV-Audit F6).
//
// Endpoints (all rate-limited under api_sandbox bucket):
//   POST /api/v1/sandbox/activate  — issue keypair + test credits. Admin-key only.
//   POST /api/v1/sandbox/reset     — refill credits / reissue tokens. Admin-key only.
//   GET  /api/v1/sandbox/status    — HMAC-auth, returns credit balance + rail info.
//   POST /api/v1/sandbox/spend     — HMAC-auth, consumes one identity credit (test path).
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

import { sha256Hex, requireApiAuth } from './api_auth.js';
import { requireAdmin } from './utils.js';
import { PLAN_SANDBOX, PLAN_DEFAULTS } from './quota.js';
import { randomBase58, keyHashFrom } from './handlers/api_admin.js';
import {
  createApiKey, apiKeyOrg, getPool, provisionPool, spendCredits, StoreUnavailable,
} from './api_store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Identity-rail sandbox credits per activation / reset (quota.js PLAN_DEFAULTS). */
const SANDBOX_CREDIT_LIMIT = PLAN_DEFAULTS[PLAN_SANDBOX].allocation;

/**
 * Anonymous-rail sandbox: number of test Cashu token strings returned at
 * activation. These are plaintext bearer tokens for integration test use only —
 * not real ecash, not spendable on the production mint.
 */
const SANDBOX_TOKEN_COUNT = 10;

/** Sandbox keys expire; no accumulation of stale state. */
const SANDBOX_TTL_SECONDS = 30 * 24 * 60 * 60;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateTestTokens(n) → string[]
 *
 * Produces `n` dummy Cashu token strings for anonymous-rail sandbox use.
 * Format: "cashuA{base64url(JSON)}" — structurally valid prefix, dummy payload.
 * These are clearly marked as sandbox tokens and are not accepted by any mint.
 */
function generateTestTokens(n) {
  const tokens = [];
  for (let i = 0; i < n; i++) {
    const payload = {
      token: [{ mint: 'https://sandbox.refueler.io/mint', proofs: [{ amount: 1, id: 'rfs_test', secret: randomBase58(16), C: randomBase58(32) }] }],
      memo: `Refueler sandbox token ${i + 1} of ${n} - not real ecash`,
    };
    // Use TextEncoder + manual binary string for btoa — Workers runtime btoa()
    // throws on any char > U+00FF (e.g. em-dash). This path is ASCII-safe.
    const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of jsonBytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    tokens.push(`cashuA${encoded}`);
  }
  return tokens;
}

/**
 * sandboxResponse(data, status, extraHeaders) → Response
 *
 * Wraps every sandbox response with X-Refueler-Sandbox: true.
 * This header is the observable signal that a request hit sandbox infrastructure.
 */
function sandboxResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':       'application/json',
      'X-Refueler-Sandbox': 'true',
      'Cache-Control':      'no-store',
      ...extraHeaders,
    },
  });
}

// Store errors → 503; auth Responses get the sandbox header.
async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Response) {
      const h = new Headers(e.headers);
      h.set('X-Refueler-Sandbox', 'true');
      return new Response(e.body, { status: e.status, headers: h });
    }
    if (e instanceof StoreUnavailable) {
      console.error('sandbox: store unavailable:', e.message);
      return sandboxResponse({ error: 'Sandbox store unavailable — please retry', sandbox: true }, 503);
    }
    throw e;
  }
}

async function provisionSandboxPool(env, org, nowSeconds) {
  return provisionPool(env, org, {
    plan:           PLAN_SANDBOX,
    allocation:     SANDBOX_CREDIT_LIMIT,
    overageCeiling: 0,
    periodStart:    nowSeconds,
    periodEnd:      nowSeconds + SANDBOX_TTL_SECONDS, // informational; sandbox never resets lazily
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/activate
//
// Admin-only. Creates a sandbox keypair for a given rail.
//
// Request body (JSON):
//   { rail: 'identity' | 'anonymous' }
//
// Response (201):
//   {
//     live_key:   'rfs_test_live_{base58}',
//     sign_key:   'rfs_test_sign_{base58}',   ← shown ONCE, never stored raw
//     rail:       'identity' | 'anonymous',
//     credits:    number | null,               ← null on anonymous rail
//     test_tokens: string[] | null,            ← null on identity rail
//     expires_at: unix seconds,
//     sandbox:    true,
//     note:       string,
//   }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxActivate(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return sandboxResponse({ error: 'Invalid JSON' }, 400); }

  const rail = body?.rail ?? 'identity';
  if (rail !== 'identity' && rail !== 'anonymous') {
    return sandboxResponse({ error: "rail must be 'identity' or 'anonymous'" }, 400);
  }

  return guarded(async () => {
    const liveKey    = `rfs_test_live_${randomBase58(32)}`;
    const signKey    = `rfs_test_sign_${randomBase58(32)}`;
    const org        = crypto.randomUUID();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt  = nowSeconds + SANDBOX_TTL_SECONDS;

    let credits    = null;
    let testTokens = null;
    if (rail === 'identity') {
      await provisionSandboxPool(env, org, nowSeconds); // pool first: authorises nothing alone
      credits = SANDBOX_CREDIT_LIMIT;
    } else {
      testTokens = generateTestTokens(SANDBOX_TOKEN_COUNT);
    }
    await createApiKey(env, {
      keyHash: await sha256Hex(liveKey), signKeyHash: await sha256Hex(signKey),
      org, rail, sandbox: true, expiresAt: new Date(expiresAt * 1000).toISOString(), label: 'sandbox',
    });

    return sandboxResponse({
      live_key:    liveKey,
      sign_key:    signKey,
      rail,
      credits,
      test_tokens: testTokens,
      expires_at:  expiresAt,
      sandbox:     true,
      note:        rail === 'anonymous'
        ? 'Test tokens shown once — not real ecash, not accepted by any production mint. Do not send real cargo to the sandbox.'
        : `${SANDBOX_CREDIT_LIMIT} test credits issued. Do not send real cargo to the sandbox.`,
    }, 201);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/reset
//
// Admin-only. Refills credits (identity) or reissues test tokens (anonymous).
// Does NOT rotate the keypair.
//
// Request body (JSON):  { live_key: 'rfs_test_live_{...}' }
// Response (200):       { rail, credits, test_tokens, reset_at, sandbox: true }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxReset(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try { body = await request.json(); } catch { return sandboxResponse({ error: 'Invalid JSON' }, 400); }

  const liveKey = body?.live_key ?? '';
  if (typeof liveKey !== 'string' || !liveKey.startsWith('rfs_test_live_')) {
    return sandboxResponse({ error: 'live_key must be a rfs_test_live_ key' }, 400);
  }

  return guarded(async () => {
    const row = await apiKeyOrg(env, await keyHashFrom(liveKey, ['rfs_test_live_']));
    if (!row || !row.sandbox || !row.active) {
      return sandboxResponse({ error: 'Sandbox client not found or revoked' }, 404);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    let credits    = null;
    let testTokens = null;
    if (row.rail === 'identity') {
      await provisionSandboxPool(env, row.org_account_id, nowSeconds);
      credits = SANDBOX_CREDIT_LIMIT;
    } else {
      testTokens = generateTestTokens(SANDBOX_TOKEN_COUNT);
    }

    return sandboxResponse({
      rail:        row.rail,
      credits,
      test_tokens: testTokens,
      reset_at:    nowSeconds,
      sandbox:     true,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sandbox/status
//
// HMAC-authenticated (rfs_test_ keypair). Returns the calling client's state.
//
// Response (200):
//   {
//     rail:              string,
//     tier:              'sandbox',
//     credits:           number | 'client-held',
//     active:            true,
//     created_at:        unix seconds,
//     credits_issued_at: unix seconds | null,   ← last activation / reset (identity)
//     expires_at:        unix seconds,
//     sandbox:           true,
//   }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxStatus(request, env) {
  return guarded(async () => {
    const { client } = await requireApiAuth(request, new ArrayBuffer(0), env, { sandbox: true });

    let credits = 'client-held';
    let issuedAt = null;
    if (client.rail === 'identity') {
      const pool = await getPool(env, client.org_account_id);
      credits  = pool?.remaining ?? 0;
      issuedAt = pool?.period_start ?? null;
    }

    return sandboxResponse({
      rail:              client.rail,
      tier:              'sandbox',
      credits,
      active:            true,
      created_at:        client.created_at,
      credits_issued_at: issuedAt,
      expires_at:        client.expires_at,
      sandbox:           true,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sandbox/spend
//
// HMAC-authenticated. Consumes one identity-rail test credit through the same
// atomic SQL spend as production (plan 'sandbox': hard stop, no reset).
//
// Response (200): { remaining: number, sandbox: true }
// Response (402): { error: 'Test credit limit reached', remaining: 0, sandbox: true }
// Response (422): { error: 'Anonymous rail: no server-side credits', sandbox: true }
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSandboxSpend(request, env) {
  return guarded(async () => {
    const rawBody = await request.arrayBuffer();
    const { client } = await requireApiAuth(request, rawBody, env, { sandbox: true });

    if (client.rail === 'anonymous') {
      return sandboxResponse({
        error:   'Anonymous rail: no server-side credits. Present a test token to verify token-gated endpoints.',
        sandbox: true,
      }, 422);
    }

    const spend = await spendCredits(env, client.org_account_id, 1);
    if (!spend?.ok) {
      return sandboxResponse({
        error:     'Test credit limit reached. Call POST /api/v1/sandbox/reset to reissue.',
        code:      spend?.code ?? 'quota_exhausted',
        remaining: spend?.remaining_credits ?? 0,
        sandbox:   true,
      }, 402);
    }
    return sandboxResponse({ remaining: spend.record.remaining, sandbox: true });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// isSandboxRequest(apiKey)
//
// True for an rfs_test_live_ key. index.js uses it to refuse sandbox keys at
// credential issue and to keep them off the production pool at initiate.
// ─────────────────────────────────────────────────────────────────────────────
export function isSandboxRequest(apiKey) {
  return typeof apiKey === 'string' && apiKey.startsWith('rfs_test_live_');
}
