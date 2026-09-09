// worker/src/webhook_delivery.js
//
// SW4a — Webhook delivery engine.
// SW4b — Dead-letter retry (retryDeadLetterQueue, called from scheduled cron).
//
// Exports:
//   deliverWebhook(env, ctx, apiKeyHash, event)
//     → Schedules delivery via ctx.waitUntil. Use from top-level request handlers.
//
//   deliverWebhookInline(env, apiKeyHash, event) → Promise<void>
//     → Awaitable delivery for callers already inside ctx.waitUntil (e.g.
//       confirm_transfer). Cannot nest waitUntil; call this directly instead.
//
//   findApiKeyHashForUuid(env, uuid) → Promise<string|null>
//     → Reads dock_index:{uuid} KV. Returns api_key_hash for API-tier transfers,
//       null for consumer transfers (no webhook to fire).
//
//   deriveWhsecFromHash(masterKey, apiKeyHash, createdAt) → Promise<string>
//     → Re-exported for webhook_reg.js (SW4a): registration switches from
//       raw apiKey to apiKeyHash as the HMAC message component so that
//       registration and delivery share identical key material.
//
//   retryDeadLetterQueue(env) → Promise<{ retried, succeeded, failed }>
//     → SW4b: lists all wh_dlq_* KV keys, retries each via _deliver with a
//       fresh timestamp, deletes the KV entry on success. Called from the
//       Worker's scheduled() handler (daily cron). Never re-uses original t.
//
// ── Signing model ─────────────────────────────────────────────────────────────
//
//   At registration (webhook_reg.js POST), the Worker has the raw rfs_live_ key
//   (apiKey) available. SW4 originally derived whsec from apiKey directly.
//
//   At delivery, the Worker only has sha256hex(apiKey) — the KV lookup key.
//   To make registration and delivery consistent without storing the raw key,
//   SW4a switches both to derive from apiKeyHash:
//
//     signingKeyBytes = HMAC-SHA256(
//       WEBHOOK_SIGNING_MASTER_KEY,
//       "refueler.webhook.v1.sign\n" + apiKeyHash + "\n" + created_at
//     )
//     rfs_whsec_ = "rfs_whsec_" + base58(signingKeyBytes)
//
//   SIGN_DOMAIN_TAG = 'refueler.webhook.v1.sign'   (updated from 'refueler.webhook.v1')
//
//   This is a breaking change only for clients registered before SW4a. No live
//   API clients exist pre-launch — acceptable. webhook_reg.js is updated in
//   the same commit (SW4a patch section at bottom of this file).
//
// ── Payload format ────────────────────────────────────────────────────────────
//
//   POST to client URL, Content-Type: application/json
//   Body: { "event": "<type>", "uuid": "<uuid>", "t": <unix_seconds> }
//
//   Signature:
//     X-Refueler-Signature: t=<unix>,v0=<hex>
//   where hex = HMAC-SHA256(signingKeyBytes, "v0:" + t + ":" + bodyString)
//
//   Clients reconstruct the same HMAC and compare to v0. The t value must
//   be within ±300s of the client's clock for replay protection — clients
//   enforce this; the Worker does not (delivery is best-effort).
//
// ── Dead-letter KV schema ─────────────────────────────────────────────────────
//
//   Key:   wh_dlq_{apiKeyHash}_{uuid}_{attemptTs}
//   Value: { event, uuid, api_key_hash, attempt_at, status_code, error }
//   TTL:   7 days (604,800 s)
//
//   SW4b (daily cron) reads all wh_dlq_ keys and retries with a fresh
//   timestamp — DO NOT re-sign retries with the original t value.
//
// ── AE schema ─────────────────────────────────────────────────────────────────
//
//   endpoint index: 'webhook_delivery'
//   blob1: event type  blob2: 'success'|'fail'  blob3: status or error class
//   double1: latency_ms  double2: HTTP status code (0 on network error)

'use strict';

import { sha256Hex } from './api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Domain tag for signing key derivation — updated from 'refueler.webhook.v1'
// in SW4a to use apiKeyHash as the HMAC input. Bumping the tag ensures any
// previously derived whsec (SW4 pre-patch) is invalidated automatically.
const SIGN_DOMAIN_TAG = 'refueler.webhook.v1.sign';

// Dead-letter TTL: 7 days.
const DLQ_TTL = 7 * 24 * 3600; // 604,800 s

// Delivery fetch timeout: 10 seconds.
const DELIVERY_TIMEOUT_MS = 10_000;

// Base58 alphabet — Bitcoin alphabet, no 0/O/I/l.
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ─────────────────────────────────────────────────────────────────────────────
// findApiKeyHashForUuid(env, uuid) → Promise<string|null>
//
// Reads dock_index:{uuid} from KV. Returns api_key_hash if set (API-tier
// transfer), null if absent (consumer transfer — no webhook to fire).
// ─────────────────────────────────────────────────────────────────────────────
export async function findApiKeyHashForUuid(env, uuid) {
  try {
    const record = await env.STATUS_KV.get(`dock_index:${uuid}`, { type: 'json' });
    return record?.api_key_hash ?? null;
  } catch (e) {
    console.error('webhook_delivery: dock_index KV read failed:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// deliverWebhook(env, ctx, apiKeyHash, event) → void
//
// Schedules delivery inside ctx.waitUntil. Returns immediately.
// Use from top-level request handlers where ctx is available.
//
// Parameters:
//   env         — Worker env
//   ctx         — Worker execution context
//   apiKeyHash  — sha256hex(rfs_live_key) from findApiKeyHashForUuid
//   event       — { type: string, uuid: string }
//                 type: 'transfer.confirmed' | 'transfer.timestamp_submitted'
// ─────────────────────────────────────────────────────────────────────────────
export function deliverWebhook(env, ctx, apiKeyHash, event) {
  if (!apiKeyHash) return;
  ctx.waitUntil(deliverWebhookInline(env, apiKeyHash, event));
}

// ─────────────────────────────────────────────────────────────────────────────
// deliverWebhookInline(env, apiKeyHash, event) → Promise<void>
//
// Awaitable delivery. Use when already inside ctx.waitUntil (cannot nest).
// Callers should catch — this never throws, but wrapping in try/catch at the
// call site prevents a silent swallow if _deliver ever gains a throw path.
// ─────────────────────────────────────────────────────────────────────────────
export async function deliverWebhookInline(env, apiKeyHash, event) {
  if (!apiKeyHash) return;
  await _deliver(env, apiKeyHash, event);
}

// ─────────────────────────────────────────────────────────────────────────────
// deriveWhsecFromHash(masterKey, apiKeyHash, createdAt) → Promise<string>
//
// Public export for webhook_reg.js (SW4a patch).
// Registration switches from raw apiKey to apiKeyHash as HMAC input.
// Returns rfs_whsec_ prefixed base58 string — shown once at registration.
// ─────────────────────────────────────────────────────────────────────────────
export async function deriveWhsecFromHash(masterKey, apiKeyHash, createdAt) {
  const bytes = await _deriveSigningKeyBytes(masterKey, apiKeyHash, createdAt);
  return `rfs_whsec_${_toBase58(bytes)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// retryDeadLetterQueue(env) → Promise<{ retried, succeeded, failed }>
//
// SW4b — Daily cron retry of dead-letter items.
//
// Lists all wh_dlq_* KV keys (prefix scan, up to 1000 per page; KV list()
// paginates automatically). For each entry:
//   1. Parse the stored value to recover { event, uuid, api_key_hash }.
//   2. Re-deliver via _deliver() with a fresh timestamp (NEVER the original t).
//   3. On success (2xx from client endpoint): delete the KV key.
//   4. On failure: leave in place — 7-day TTL handles natural expiry.
//
// Returns a summary object for AE logging in the scheduled handler.
//
// Design constraints (from SW4b do-not-retry rules):
//   - DO NOT pass the original attemptTs to _deliver — _deliver builds its own t.
//   - DO NOT delete on network error — leave for the next cron run.
//   - DO NOT use ctx.waitUntil here — this is called from inside scheduled(),
//     which itself runs to completion. Direct await is correct.
// ─────────────────────────────────────────────────────────────────────────────
export async function retryDeadLetterQueue(env) {
  let retried   = 0;
  let succeeded = 0;
  let failed    = 0;

  let cursor;
  do {
    let listResult;
    try {
      listResult = await env.STATUS_KV.list({ prefix: 'wh_dlq_', cursor, limit: 1000 });
    } catch (e) {
      console.error('webhook_delivery/dlq: KV list failed:', e);
      break;
    }

    for (const key of listResult.keys) {
      retried++;
      let record;

      // ── Read the DLQ entry ─────────────────────────────────────────────────
      try {
        record = await env.STATUS_KV.get(key.name, { type: 'json' });
      } catch (e) {
        console.error(`webhook_delivery/dlq: KV get failed for ${key.name}:`, e);
        failed++;
        continue;
      }

      if (!record || !record.api_key_hash || !record.event || !record.uuid) {
        // Malformed entry — delete it; it can never be retried successfully.
        console.error(`webhook_delivery/dlq: malformed entry, deleting ${key.name}`);
        try { await env.STATUS_KV.delete(key.name); } catch (_) {}
        failed++;
        continue;
      }

      // ── Re-deliver with fresh timestamp ────────────────────────────────────
      // _deliver() builds its own `t = Math.floor(Date.now() / 1000)` internally.
      // We reconstruct the event object from the stored record fields.
      const event = { type: record.event, uuid: record.uuid };
      let deliverySucceeded = false;

      try {
        deliverySucceeded = await _deliverForCron(env, record.api_key_hash, event);
      } catch (e) {
        console.error(`webhook_delivery/dlq: retry error for ${key.name}:`, e);
      }

      if (deliverySucceeded) {
        succeeded++;
        try {
          await env.STATUS_KV.delete(key.name);
        } catch (e) {
          console.error(`webhook_delivery/dlq: KV delete failed for ${key.name}:`, e);
        }
      } else {
        failed++;
        // Leave in KV — 7-day TTL handles expiry naturally.
      }
    }

    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  // AE log — one summary point per cron run.
  if (env.AE) {
    try {
      env.AE.writeDataPoint({
        blobs:   ['webhook_dlq_cron', 'cron', retried > 0 ? 'ran' : 'idle', ''],
        doubles: [retried, succeeded, failed, 0, 0],
        indexes: ['webhook_dlq_cron'],
      });
    } catch (e) {
      console.error('webhook_delivery/dlq: AE log failed:', e);
    }
  }

  console.log(`webhook_delivery/dlq: retried=${retried} succeeded=${succeeded} failed=${failed}`);
  return { retried, succeeded, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// _deliverForCron → Promise<boolean>
//
// Thin wrapper around _deliver that captures delivery success/failure as a
// boolean return value for the cron caller, rather than relying on AE logging
// (which is fire-and-forget). _deliver itself still logs to AE.
//
// Returns true if the client endpoint responded 2xx, false on any failure.
// ─────────────────────────────────────────────────────────────────────────────
async function _deliverForCron(env, apiKeyHash, event) {
  // We need to intercept the outcome of _deliver, which currently returns void
  // and signals success/failure only via AE. Rather than mutating _deliver's
  // signature (it is used by the live request path), we read the wh_config_
  // ourselves, call the underlying fetch logic, and return the boolean.
  // This duplicates the config lookup but keeps _deliver's contract clean.

  const configKey = `wh_config_${apiKeyHash}`;
  let config;
  try {
    config = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_delivery/dlq: wh_config KV read failed:', e);
    return false;
  }

  // Client deregistered or config missing — nothing to retry.
  if (!config || config.active !== true) {
    return true; // Treat as "resolved" — remove from DLQ, endpoint no longer registered.
  }

  const { url, created_at } = config;

  const t       = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ event: event.type, uuid: event.uuid, t });

  let signingKeyBytes;
  try {
    signingKeyBytes = await _deriveSigningKeyBytes(
      env.WEBHOOK_SIGNING_MASTER_KEY,
      apiKeyHash,
      created_at,
    );
  } catch (e) {
    console.error('webhook_delivery/dlq: signing key derivation failed:', e);
    return false;
  }

  let sigHex;
  try {
    sigHex = await _signPayload(signingKeyBytes, t, payload);
  } catch (e) {
    console.error('webhook_delivery/dlq: payload signing failed:', e);
    return false;
  }

  const signatureHeader = `t=${t},v0=${sigHex}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let fetchRes;
    try {
      fetchRes = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':         'application/json',
          'X-Refueler-Signature': signatureHeader,
          'User-Agent':           'Refueler-Webhook/1.0',
        },
        body:   payload,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const ok = fetchRes.status >= 200 && fetchRes.status < 300;
    _aeLog(env, event.type, ok ? 'success' : 'fail', String(fetchRes.status), fetchRes.status, 0);
    return ok;
  } catch (e) {
    const errorClass = e?.name === 'AbortError' ? 'timeout' : 'network_error';
    _aeLog(env, event.type, 'fail', errorClass, 0, 0);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _deliver — core async delivery logic (private)
// ─────────────────────────────────────────────────────────────────────────────
async function _deliver(env, apiKeyHash, event) {
  const t0 = Date.now();

  // ── 1. Read wh_config_ ────────────────────────────────────────────────────
  const configKey = `wh_config_${apiKeyHash}`;
  let config;
  try {
    config = await env.STATUS_KV.get(configKey, { type: 'json' });
  } catch (e) {
    console.error('webhook_delivery: KV read failed:', e);
    _aeLog(env, event.type, 'fail', 'kv_read_error', 0, Date.now() - t0);
    return;
  }

  // No registration or deregistered — silent skip, not an error.
  if (!config || config.active !== true) {
    return;
  }

  const { url, created_at } = config;

  // ── 2. Build payload ──────────────────────────────────────────────────────
  const t       = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ event: event.type, uuid: event.uuid, t });

  // ── 3. Derive signing key bytes ───────────────────────────────────────────
  let signingKeyBytes;
  try {
    signingKeyBytes = await _deriveSigningKeyBytes(
      env.WEBHOOK_SIGNING_MASTER_KEY,
      apiKeyHash,
      created_at,
    );
  } catch (e) {
    console.error('webhook_delivery: signing key derivation failed:', e);
    _aeLog(env, event.type, 'fail', 'signing_key_error', 0, Date.now() - t0);
    return;
  }

  // ── 4. Sign payload ───────────────────────────────────────────────────────
  // HMAC-SHA256(signingKeyBytes, "v0:" + t + ":" + payload) → hex
  let sigHex;
  try {
    sigHex = await _signPayload(signingKeyBytes, t, payload);
  } catch (e) {
    console.error('webhook_delivery: payload signing failed:', e);
    _aeLog(env, event.type, 'fail', 'sign_error', 0, Date.now() - t0);
    return;
  }

  const signatureHeader = `t=${t},v0=${sigHex}`;

  // ── 5. POST to client URL ─────────────────────────────────────────────────
  let statusCode = 0;
  let deliveryOk = false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

    let fetchRes;
    try {
      fetchRes = await fetch(url, {
        method:  'POST',
        headers: {
          'Content-Type':         'application/json',
          'X-Refueler-Signature': signatureHeader,
          'User-Agent':           'Refueler-Webhook/1.0',
        },
        body:   payload,
        signal: controller.signal,
      });
      statusCode = fetchRes.status;
      deliveryOk = fetchRes.status >= 200 && fetchRes.status < 300;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    const errorClass = e?.name === 'AbortError' ? 'timeout' : 'network_error';
    console.error('webhook_delivery: fetch failed:', e);
    _aeLog(env, event.type, 'fail', errorClass, 0, Date.now() - t0);
    await _deadLetter(env, apiKeyHash, event, t, statusCode, errorClass);
    return;
  }

  const latency = Date.now() - t0;

  if (deliveryOk) {
    _aeLog(env, event.type, 'success', String(statusCode), statusCode, latency);
    return;
  }

  // Non-2xx — dead-letter.
  _aeLog(env, event.type, 'fail', String(statusCode), statusCode, latency);
  await _deadLetter(env, apiKeyHash, event, t, statusCode, `http_${statusCode}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// _deriveSigningKeyBytes — raw 32-byte HMAC output
//
// HMAC-SHA256(masterKey, SIGN_DOMAIN_TAG + "\n" + apiKeyHash + "\n" + createdAt)
// Returns Uint8Array. Used both for whsec derivation (base58 output) and for
// payload signing (raw bytes as HMAC key).
// ─────────────────────────────────────────────────────────────────────────────
async function _deriveSigningKeyBytes(masterKey, apiKeyHash, createdAt) {
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const message   = `${SIGN_DOMAIN_TAG}\n${apiKeyHash}\n${createdAt}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
  return new Uint8Array(sigBuffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// _signPayload — HMAC-SHA256(signingKeyBytes, "v0:" + t + ":" + body) → hex
// ─────────────────────────────────────────────────────────────────────────────
async function _signPayload(signingKeyBytes, t, body) {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    signingKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const message   = `v0:${t}:${body}`;
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// _deadLetter — write failed delivery to KV DLQ (7-day TTL)
//
// Key: wh_dlq_{apiKeyHash}_{uuid}_{attemptTs}
// SW4b cron reads and retries with a fresh timestamp (never the original t).
// ─────────────────────────────────────────────────────────────────────────────
async function _deadLetter(env, apiKeyHash, event, attemptTs, statusCode, errorClass) {
  const key   = `wh_dlq_${apiKeyHash}_${event.uuid}_${attemptTs}`;
  const value = {
    event:        event.type,
    uuid:         event.uuid,
    api_key_hash: apiKeyHash,
    attempt_at:   attemptTs,
    status_code:  statusCode,
    error:        errorClass,
  };
  try {
    await env.STATUS_KV.put(key, JSON.stringify(value), { expirationTtl: DLQ_TTL });
  } catch (e) {
    console.error('webhook_delivery: DLQ write failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _aeLog — fire-and-forget AE datapoint
// ─────────────────────────────────────────────────────────────────────────────
function _aeLog(env, eventType, outcome, statusOrError, statusCode, latencyMs) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   ['webhook_delivery', eventType, outcome, statusOrError],
      doubles: [latencyMs, statusCode, 0, 0, 0],
      indexes: ['webhook_delivery'],
    });
  } catch (e) {
    console.error('webhook_delivery: AE write failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _toBase58 — standard base58 (Bitcoin alphabet, no checksum)
// Duplicated from webhook_reg.js to keep this module self-contained.
// ─────────────────────────────────────────────────────────────────────────────
function _toBase58(bytes) {
  let leadingZeroes = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    leadingZeroes++;
  }

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return '1'.repeat(leadingZeroes) +
    digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
}
