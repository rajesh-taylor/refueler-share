// worker/src/handlers/webhook_status.js
//
// SW5b — GET /api/v1/webhooks/status
//
// Returns the webhook registration state and dead-letter queue depth for the
// authenticated API client.
//
// Response shape:
//   {
//     registered:  boolean,
//     active:      boolean,
//     url_host:    string | null,   // scheme + host only — path/query stripped
//     created_at:  number | null,   // unix seconds
//     dlq_depth:   number,          // count of pending dead-letter retries
//   }
//
// DLQ depth: counts KV keys with prefix `wh_dlq_{apiKeyHash}_`.
// KV list() is eventually consistent — depth is approximate, not transactional.
// Amber threshold: > 0. Client should investigate delivery failures promptly.
//
// Auth: HMAC-authenticated via requireApiAuth (same pattern as all /api/v1/* handlers).
// Tier gate: none — any API-tier client may check their own webhook status.
//            A client with no registration receives { registered: false, dlq_depth: 0 }.

'use strict';

import { requireApiAuth, sha256Hex } from '../api_auth.js';
import { kvWhConfigKey }             from '../webhook_reg.js';

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errJson(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// handleWebhookStatus — GET /api/v1/webhooks/status
// ─────────────────────────────────────────────────────────────────────────────
export async function handleWebhookStatus(request, env) {
  // ── HMAC auth ─────────────────────────────────────────────────────────────
  let apiKey;
  try {
    ({ apiKey } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('webhook_status: unexpected auth error:', authErr);
    return errJson(500, 'Authentication error');
  }

  const apiKeyHash = await sha256Hex(apiKey);

  // ── Read wh_config_ record ─────────────────────────────────────────────────
  let record = null;
  try {
    const configKey = await kvWhConfigKey(apiKey);
    record = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_status: KV read wh_config_ failed:', e);
    return errJson(502, 'Failed to read webhook registration — please retry');
  }

  // ── Count dead-letter queue entries ───────────────────────────────────────
  // KV keys written by webhook_delivery.js: `wh_dlq_{apiKeyHash}_{uuid}`
  // We list with prefix to count pending retries for this client only.
  let dlqDepth = 0;
  try {
    const dlqPrefix = `wh_dlq_${apiKeyHash}_`;
    const listed    = await env.STATUS_KV.list({ prefix: dlqPrefix });
    dlqDepth        = listed.keys.length;
    // KV list() returns up to 1000 keys per call. DLQ accumulation above 1000
    // would indicate a severely broken endpoint — treat 1000 as the display cap.
  } catch (e) {
    // Non-fatal — return 0 rather than 502. Depth is informational.
    console.error('webhook_status: KV list wh_dlq_ failed:', e);
  }

  // ── No registration ────────────────────────────────────────────────────────
  if (!record) {
    return jsonOk({
      registered: false,
      active:     false,
      url_host:   null,
      created_at: null,
      dlq_depth:  dlqDepth,
    });
  }

  // ── Redact URL to scheme + host only ──────────────────────────────────────
  let urlHost = null;
  try {
    const parsed = new URL(record.url);
    urlHost      = `${parsed.protocol}//${parsed.host}`;
  } catch {
    urlHost = '[invalid url]';
  }

  return jsonOk({
    registered: true,
    active:     record.active === true,
    url_host:   urlHost,
    created_at: record.created_at ?? null,
    dlq_depth:  dlqDepth,
  });
}
