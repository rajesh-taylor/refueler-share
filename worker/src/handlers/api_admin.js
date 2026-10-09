// ─────────────────────────────────────────────────────────────────────────────
// api_admin.js — API client onboarding, revocation and pool admin
// (KV-Fix-2 · 9 Oct 2026; design docs/KV-Audit-v1.md §4.2)
//
// All routes: X-Admin-Key (requireAdmin). Store: Supabase via api_store.js —
// nothing here touches KV, so onboarding needs no Cloudflare KV:Edit token
// (replaces ONBOARDING-RUNBOOK Step 3, F5).
//
//   POST /api/v1/admin/api-client          { plan, overage_ceiling?, label? }
//        → 201 { live_key, sign_key, org_account_id, rail, pool }   keys shown ONCE
//   POST /api/v1/admin/api-client/revoke   { live_key }             → 200 | 404
//        Revoked at once in Supabase; other isolates stop within 60 s (key cache TTL).
//   POST /api/v1/admin/quota/provision     { live_key, plan, overage_ceiling?, period_start?, period_end? }
//   POST /api/v1/admin/quota/cancel        { live_key, immediate? }
//
// live_key may be the raw rfs_live_… value or its 64-char SHA-256 hex.
// Identity rail only: the anonymous rail stays closed until B7 and never gets a row.
// ─────────────────────────────────────────────────────────────────────────────

import { requireAdmin, json, err } from '../utils.js';
import { sha256Hex } from '../api_auth.js';
import { provisionParams } from '../quota.js';
import {
  createApiKey, revokeApiKey, apiKeyOrg, provisionPool, cancelPool, StoreUnavailable,
} from '../api_store.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** base58 (Bitcoin alphabet) of `n` random bytes — unbiased, unlike a byte-mod-58 map. */
export function randomBase58(n = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  let out = '';
  while (x > 0n) { out = B58[Number(x % 58n)] + out; x /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

/** rfs_live_… → its SHA-256 hex; 64-char hex passes through; else null. */
export async function keyHashFrom(liveKey, prefixes = ['rfs_live_']) {
  if (typeof liveKey !== 'string') return null;
  if (prefixes.some(p => liveKey.startsWith(p))) return sha256Hex(liveKey);
  return /^[0-9a-f]{64}$/.test(liveKey) ? liveKey : null;
}

function noStore(body, status) {
  const r = json(body, status);
  r.headers.set('Cache-Control', 'no-store');
  return r;
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StoreUnavailable) {
      console.error('api_admin: store unavailable:', e.message);
      return err(503, 'Key store unavailable — please retry');
    }
    throw e;
  }
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

// Production identity-rail org for this key, or a Response to return.
async function productionOrg(env, liveKey) {
  const keyHash = await keyHashFrom(liveKey);
  if (!keyHash) return { resp: err(400, 'live_key must be rfs_live_... or 64-char sha256 hex') };
  const row = await apiKeyOrg(env, keyHash);
  if (!row || row.sandbox) return { resp: err(404, 'No API client found for this key') };
  return { org: row.org_account_id };
}

export async function handleAdminApiClientCreate(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body) return err(400, 'Invalid JSON body');

  const params = provisionParams({
    plan:            body.plan,
    overage_ceiling: body.overage_ceiling ?? undefined,
  }, Math.floor(Date.now() / 1000));
  if (params.error) return err(400, params.error);
  if (params.plan === 'sandbox') return err(400, 'Use POST /api/v1/sandbox/activate for sandbox keys');
  if (body.label !== undefined && (typeof body.label !== 'string' || body.label.length > 64)) {
    return err(400, 'label must be a string of at most 64 characters');
  }

  return guarded(async () => {
    const org     = crypto.randomUUID();
    const liveKey = `rfs_live_${randomBase58(32)}`;
    const signKey = `rfs_sign_${randomBase58(32)}`;
    // Pool first: a pool without a key authorises nothing.
    const pool = await provisionPool(env, org, params);
    await createApiKey(env, {
      keyHash: await sha256Hex(liveKey), signKeyHash: await sha256Hex(signKey),
      org, rail: 'identity', sandbox: false, label: body.label ?? null,
    });
    return noStore({
      live_key:       liveKey,
      sign_key:       signKey,
      org_account_id: org,
      rail:           'identity',
      pool,
      note:           'Keys are shown once. Only their SHA-256 hashes are stored.',
    }, 201);
  });
}

export async function handleAdminApiClientRevoke(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body) return err(400, 'Invalid JSON body');
  const keyHash = await keyHashFrom(body.live_key, ['rfs_live_', 'rfs_test_live_']);
  if (!keyHash) return err(400, 'live_key must be rfs_live_... / rfs_test_live_... or 64-char sha256 hex');

  return guarded(async () => {
    const org = await revokeApiKey(env, keyHash);
    if (!org) return err(404, 'No API client found for this key');
    return json({ ok: true, revoked: true, org_account_id: org, takes_effect_within_seconds: 60 });
  });
}

export async function handleAdminQuotaProvision(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body) return err(400, 'Invalid JSON body');
  if (!body.live_key) return err(400, 'live_key is required');
  if (!body.plan)     return err(400, 'plan is required (identity_api | personal_api)');

  const params = provisionParams(body, Math.floor(Date.now() / 1000));
  if (params.error) return err(400, params.error);
  if (params.plan === 'sandbox') return err(400, 'plan must be identity_api or personal_api');

  return guarded(async () => {
    const { org, resp } = await productionOrg(env, body.live_key);
    if (resp) return resp;
    const record = await provisionPool(env, org, params);
    return json({ ok: true, org_account_id: org, record });
  });
}

export async function handleAdminQuotaCancel(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const body = await readBody(request);
  if (!body) return err(400, 'Invalid JSON body');
  if (!body.live_key) return err(400, 'live_key is required');

  return guarded(async () => {
    const { org, resp } = await productionOrg(env, body.live_key);
    if (resp) return resp;
    const result = await cancelPool(env, org, Boolean(body.immediate));
    if (!result?.ok) return err(404, 'No quota record found for this key');
    return json({ ok: true, already_cancelled: result.already_cancelled ?? false, record: result.record ?? null });
  });
}
