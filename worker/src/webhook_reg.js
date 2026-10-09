// worker/src/webhook_reg.js
//
// SW4 — Webhook registration (API tier only), rekeyed by org at API-Repair-1.
//
//   POST   /api/v1/webhook/register  — validate URL, write wh_config_, return rfs_whsec_ once
//   DELETE /api/v1/webhook/register  — mark inactive (7-day TTL)
//   GET    /api/v1/webhook/register  — state, URL redacted to scheme + host
//
// Auth: requireApiAuth (HMAC). Tier gate: Chartered only (Sovereign never gets webhooks).
// Record, MAC and whsec derivation: webhook_delivery.js. The record is keyed by
// the org (via a keyed org tag), not by the live key, so routing from a sealed
// manifest needs no key lookup. An unverifiable record reads as absent.
//
// rfs_whsec_ is returned ONCE at POST and never stored: it is re-derived from
// (org, created_at) at every send. Re-registering (new created_at) rotates it.

import { requireApiAuth } from './api_auth.js';
import { readWhConfig, writeWhConfig, deriveWhsec } from './webhook_delivery.js';
import { isCharteredTier } from './tiers.js';
import { validateWebhookUrl } from './webhook_url.js';

export { validateWebhookUrl };

export async function handleWebhookRegister(request, env) {
  let client, rawBody;
  try {
    rawBody = await request.arrayBuffer();
    ({ client } = await requireApiAuth(request, rawBody, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  if (!isCharteredTier(client.tier)) {
    return errJson(403, 'Webhook registration is only available on the API tier');
  }

  const org = client.org_account_id;
  const method = request.method.toUpperCase();
  if (method === 'POST')   return registerPost(env, org, rawBody);
  if (method === 'DELETE') return registerDelete(env, org);
  if (method === 'GET')    return registerGet(env, org);
  return errJson(405, 'Method not allowed');
}

async function current(env, org) {
  try {
    return { record: await readWhConfig(env, org) };
  } catch (e) {
    console.error('webhook_reg: KV read failed:', e);
    return { failed: true };
  }
}

async function registerPost(env, org, rawBody) {
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody ?? new ArrayBuffer(0)));
  } catch {
    return errJson(400, 'Invalid JSON body');
  }
  const validation = validateWebhookUrl(body?.url);
  if (!validation.ok) return errJson(400, validation.error);
  const url = validation.url.toString();

  const { record, failed } = await current(env, org);
  if (failed) return errJson(502, 'Registration check failed — please retry');
  if (record?.active) {
    return errJson(409, 'A webhook is already registered. DELETE /api/v1/webhook/register first to replace it.');
  }

  const createdAt = Math.floor(Date.now() / 1000);
  let whsec;
  try {
    whsec = await deriveWhsec(env, org, createdAt);
    if (!(await writeWhConfig(env, org, { url, created_at: createdAt, active: true }))) {
      console.error('webhook_reg: KV_MAC_KEY unavailable; not registering');
      return errJson(503, 'Webhook registration temporarily unavailable');
    }
  } catch (e) {
    console.error('webhook_reg: register failed:', e);
    return errJson(502, 'Failed to persist webhook registration — please retry');
  }

  return jsonOk({
    url,
    whsec,
    created_at: createdAt,
    note: 'Store whsec securely — it will not be retrievable again.',
  });
}

async function registerDelete(env, org) {
  const { record, failed } = await current(env, org);
  if (failed) return errJson(502, 'Deregistration check failed — please retry');
  if (!record) return jsonOk({ deregistered: false, message: 'No webhook was registered' });
  try {
    await writeWhConfig(env, org, {
      url: record.url, created_at: record.created_at, active: false,
      deleted_at: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    console.error('webhook_reg: KV write failed on DELETE:', e);
    return errJson(502, 'Failed to deregister webhook — please retry');
  }
  return jsonOk({ deregistered: true });
}

async function registerGet(env, org) {
  const { record, failed } = await current(env, org);
  if (failed) return errJson(502, 'Failed to read webhook registration — please retry');
  if (!record) return jsonOk({ registered: false });
  return jsonOk({
    registered:   true,
    active:       record.active,
    url:          redactUrl(record.url),
    whsec_active: record.active,
    created_at:   record.created_at,
    deleted_at:   record.deleted_at,
  });
}

/** Scheme + host only. */
export function redactUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '[invalid url]';
  }
}

function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errJson(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
