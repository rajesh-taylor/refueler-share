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
// DLQ depth: counts KV keys with prefix `wh_dlq_{orgtag}_` (API-Repair-1).
// KV list() is eventually consistent — depth is approximate, not transactional.
// Amber threshold: > 0. Client should investigate delivery failures promptly.
//
// Auth: HMAC-authenticated via requireApiAuth (same pattern as all /api/v1/* handlers).
// Tier gate: none — any API-tier client may check their own webhook status.
//            A client with no registration receives { registered: false, dlq_depth: 0 }.

'use strict';

import { requireApiAuth }             from '../api_auth.js';
import { readWhConfig, dlqDepth }     from '../webhook_delivery.js';
import { redactUrl }                  from '../webhook_reg.js';

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
  let client;
  try {
    ({ client } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('webhook_status: unexpected auth error:', authErr);
    return errJson(500, 'Authentication error');
  }
  const org = client.org_account_id;

  let record = null;
  try {
    record = await readWhConfig(env, org);
  } catch (e) {
    console.error('webhook_status: KV read wh_config_ failed:', e);
    return errJson(502, 'Failed to read webhook registration — please retry');
  }

  // Informational; capped at one KV list page (1000). Non-fatal.
  let depth = 0;
  try {
    depth = await dlqDepth(env, org);
  } catch (e) {
    console.error('webhook_status: KV list wh_dlq_ failed:', e);
  }

  return jsonOk({
    registered: !!record,
    active:     record?.active === true,
    url_host:   record ? redactUrl(record.url) : null,
    created_at: record?.created_at ?? null,
    dlq_depth:  depth,
  });
}
