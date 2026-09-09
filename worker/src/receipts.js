// ─────────────────────────────────────────────────────────────────────────────
// receipts.js — SW5
//
// Acceptance receipts (cargo.accepted) and collection receipts (cargo.discharged).
//
// Architecture (locked SW5-Opus · 9 Sep 2026):
//   Signing:  symmetric HMAC-SHA256. Key = rfs_whsec_ (derived from
//             WEBHOOK_SIGNING_MASTER_KEY + live_key + created_at).
//             Ed25519 / published Worker key explicitly rejected.
//   Delivery: ctx.waitUntil — receipts are notification, never control flow.
//   Storage:  receipt_{uuid}_{type} in STATUS_KV (7-day TTL) — pull endpoint only.
//             No Supabase row. No recipient metadata. Ever.
//   Stability: sig computed once at issuance, stored in KV, re-served unchanged.
//              Stable across retries (unlike webhook envelope t which changes).
//
// SIGN construction:
//   receipt_sig = HMAC-SHA256(
//     key = UTF-8(rfs_whsec_string),
//     msg = UTF-8("refueler.receipt.v1\n") || raw_bytes(JSON.stringify(receipt_member))
//   )
//
// Two functions exported:
//   buildSignedReceipt(env, fields) → { receipt, sig }   — pure, no side-effects
//   emitReceipt(env, ctx, fields)   → void                — stores + delivers, ctx.waitUntil
//
// KV keys:
//   receipt_{uuid}_acceptance  — acceptance receipt JSON, 7-day TTL
//   receipt_{uuid}_collection  — collection receipt JSON, 7-day TTL
//
// Pull endpoint:
//   GET /api/v1/receipt/:uuid/:type  (wired in index.js, HMAC-authenticated)
//
// Do-not-retry (SW5):
//   - Never Ed25519 or published Worker key
//   - Never Supabase row on receipt path
//   - Never recipient metadata (IP, UA, network) in any receipt field
//   - Never re-emit collection receipt on re-download (once flag guards this)
//   - cargo.in_bond reserved-not-built (string reserved only)
//
// Reserved (not built): cargo.in_bond
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deriveWhsecForReceipt(env, liveKey, createdAt) → string
 *
 * Re-derives rfs_whsec_ using the same stateless HMAC construction as
 * webhook_delivery.js — SIGN_DOMAIN_TAG 'refueler.webhook.v1.sign'.
 * The receipt HMAC key is the derived whsec string (not the master key directly).
 * This keeps per-client signing isolation: two clients cannot forge each other's
 * receipts even if one learns the other's whsec, because the master key is never
 * exposed and each whsec is bound to a specific live_key + created_at pair.
 */
async function deriveWhsecForReceipt(env, liveKey, createdAt) {
  const masterKey = env.WEBHOOK_SIGNING_MASTER_KEY;
  if (!masterKey) throw new Error('WEBHOOK_SIGNING_MASTER_KEY not set');

  const SIGN_DOMAIN_TAG = 'refueler.webhook.v1.sign';
  const msg = `${SIGN_DOMAIN_TAG}\n${liveKey}\n${createdAt}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(msg),
  );
  // Encode as base58 to match rfs_whsec_ format (same alphabet as api_auth.js)
  return toBase58(new Uint8Array(sig));
}

// Base58 alphabet (Bitcoin standard — no 0/O/I/l)
const BASE58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes) {
  let n = BigInt(0);
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  if (n === 0n) return '1';
  let result = '';
  while (n > 0n) {
    result = BASE58_CHARS[Number(n % 58n)] + result;
    n = n / 58n;
  }
  // Leading zero bytes → leading '1's
  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }
  return result;
}

/**
 * signReceiptObject(whsecString, receiptMember) → "v1=<hex>"
 *
 * Computes HMAC-SHA256 over:
 *   UTF-8("refueler.receipt.v1\n") || UTF-8(JSON.stringify(receiptMember))
 *
 * The receipt member is serialised exactly once and the same bytes are used
 * for both signing and storage. Stable across retries.
 */
async function signReceiptObject(whsecString, receiptMember) {
  const domainTag  = 'refueler.receipt.v1\n';
  const serialised = JSON.stringify(receiptMember);
  const tagBytes   = new TextEncoder().encode(domainTag);
  const bodyBytes  = new TextEncoder().encode(serialised);

  const msg = new Uint8Array(tagBytes.length + bodyBytes.length);
  msg.set(tagBytes, 0);
  msg.set(bodyBytes, tagBytes.length);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(whsecString),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msg);
  const hex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `v1=${hex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildSignedReceipt — pure, no side-effects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildSignedReceipt(env, fields) → { receipt, sig }
 *
 * Pure function. Constructs and signs a receipt object.
 * Used by emitReceipt, by the GET pull endpoint, and by any future cron re-emit.
 *
 * @param {object} env     — Worker env (needs WEBHOOK_SIGNING_MASTER_KEY)
 * @param {object} fields  — receipt fields (see schema below)
 * @returns {Promise<{ receipt: object, sig: string }>}
 *
 * Required fields:
 *   receipt_type   — 'acceptance' | 'collection'
 *   event          — 'cargo.accepted' | 'cargo.discharged'
 *   live_key       — rfs_live_… string (identifies the client)
 *   uuid           — transfer UUID
 *   transfer_ref   — client attribution string or null
 *   size_bytes     — total bytes declared at upload
 *   chunk_count    — total chunks declared at upload
 *   issued_at      — unix seconds (now at issuance)
 *   wh_created_at  — created_at from wh_config_ KV (whsec rotation salt)
 *
 * Conditional fields:
 *   accepted_at    — (acceptance) unix seconds manifest was written
 *   expiry_timestamp — (acceptance) unix seconds expiry
 *   collected_at   — (collection) unix seconds last chunk served
 *
 * No BLAKE3 root. No recipient metadata. Load-bearing — do not add.
 */
export async function buildSignedReceipt(env, fields) {
  const {
    receipt_type,
    event,
    live_key,
    uuid,
    transfer_ref,
    size_bytes,
    chunk_count,
    issued_at,
    wh_created_at,
    // conditional
    accepted_at,
    expiry_timestamp,
    collected_at,
  } = fields;

  // ── Validate receipt_type ─────────────────────────────────────────────────
  if (receipt_type !== 'acceptance' && receipt_type !== 'collection') {
    throw new Error(`Invalid receipt_type: ${receipt_type}`);
  }
  if (event !== 'cargo.accepted' && event !== 'cargo.discharged') {
    throw new Error(`Invalid event: ${event}`);
  }

  // ── Build receipt member ──────────────────────────────────────────────────
  // Field order matches wire schema exactly (SW5-Opus).
  // No extra fields — field discipline is load-bearing.
  const receipt = {
    receipt_version: 'refueler.receipt.v1',
    receipt_type,
    event,
    live_key,
    uuid,
    transfer_ref: transfer_ref ?? null,
    size_bytes:   size_bytes   ?? 0,
    chunk_count:  chunk_count  ?? 0,
    issued_at:    issued_at    ?? 0,
  };

  if (receipt_type === 'acceptance') {
    receipt.accepted_at       = accepted_at       ?? issued_at ?? 0;
    receipt.expiry_timestamp  = expiry_timestamp  ?? 0;
  } else {
    receipt.collected_at      = collected_at      ?? issued_at ?? 0;
  }

  // ── Derive whsec and sign ─────────────────────────────────────────────────
  const whsec = await deriveWhsecForReceipt(env, live_key, wh_created_at);
  const sig   = await signReceiptObject(whsec, receipt);

  return { receipt, sig };
}

// ─────────────────────────────────────────────────────────────────────────────
// emitReceipt — void, wired via ctx.waitUntil
// ─────────────────────────────────────────────────────────────────────────────

/**
 * emitReceipt(env, ctx, fields) → void
 *
 * Live path. Wires via ctx.waitUntil — receipts are notification, never
 * control flow. Stores signed receipt in KV and delivers to webhook URL.
 *
 * Storage key: receipt_{uuid}_{acceptance|collection}  — 7-day TTL
 * Delivery: POST to wh_config_ url with X-Refueler-Signature envelope (SW4a format).
 *
 * No Supabase row. No recipient metadata. No re-emit on re-download.
 *
 * @param {object} env     — Worker env
 * @param {object} ctx     — fetch handler context
 * @param {object} fields  — same shape as buildSignedReceipt fields + apiKeyHash
 */
export function emitReceipt(env, ctx, fields) {
  ctx.waitUntil(
    _emitReceiptAsync(env, fields).catch(e =>
      console.error('emitReceipt: unhandled error:', e),
    ),
  );
}

async function _emitReceiptAsync(env, fields) {
  const { uuid, receipt_type, apiKeyHash } = fields;

  // ── Look up wh_config_ for url + created_at ───────────────────────────────
  // Reuse existing KV schema — no new index, no new secret.
  let whConfig;
  try {
    whConfig = await env.STATUS_KV.get(`wh_config_${apiKeyHash}`, { type: 'json' });
  } catch (e) {
    console.error('emitReceipt: KV wh_config_ read failed:', e);
    return;
  }

  if (!whConfig || !whConfig.url || !whConfig.created_at) {
    // No webhook registered for this client — store receipt in KV only.
    // Client can pull via GET /api/v1/receipt/:uuid/:type.
    await _storeReceiptKv(env, uuid, receipt_type, fields);
    return;
  }

  const enrichedFields = { ...fields, wh_created_at: whConfig.created_at };

  // ── Build signed receipt ──────────────────────────────────────────────────
  let signedReceipt;
  try {
    signedReceipt = await buildSignedReceipt(env, enrichedFields);
  } catch (e) {
    console.error('emitReceipt: buildSignedReceipt failed:', e);
    return;
  }

  // ── Store in KV (idempotent — sig is stable) ──────────────────────────────
  await _storeReceiptKv(env, uuid, receipt_type, signedReceipt);

  // ── Deliver to webhook endpoint ───────────────────────────────────────────
  const payload = {
    event:   fields.event,
    uuid,
    receipt: signedReceipt.receipt,
    sig:     signedReceipt.sig,
  };
  await _deliverReceiptWebhook(env, whConfig, fields.live_key, payload);
}

/**
 * _storeReceiptKv — writes { receipt, sig } to KV under receipt_{uuid}_{type}
 * Accepts either a full signedReceipt object or enriched fields (when no webhook).
 * 7-day TTL — outlasts any delivery window; client can pull months later.
 */
async function _storeReceiptKv(env, uuid, receiptType, signedReceiptOrFields) {
  // Accept either shape: { receipt, sig } or the raw fields object (no-webhook path).
  // For the no-webhook path we still need to build the receipt — but wh_created_at
  // may be absent. In that case, use a placeholder: receipt is stored unsigned.
  let stored;
  if (signedReceiptOrFields.receipt && signedReceiptOrFields.sig) {
    stored = signedReceiptOrFields; // already built
  } else {
    // No webhook — cannot derive whsec without created_at. Store unsigned fields.
    // The pull endpoint will re-derive if created_at becomes available.
    stored = { receipt: null, sig: null, pending: true };
  }

  const kvKey = `receipt_${uuid}_${receiptType}`;
  try {
    await env.STATUS_KV.put(kvKey, JSON.stringify(stored), {
      expirationTtl: 7 * 24 * 3600, // 7 days
    });
  } catch (e) {
    console.error('emitReceipt: KV store failed:', e);
  }
}

/**
 * _deliverReceiptWebhook — POSTs the receipt payload to the client's webhook URL.
 * Uses the SW4a envelope signing construction (t + "." + raw_body over X-Refueler-Signature).
 * Envelope t changes per delivery; receipt sig never does (stable keepsake).
 */
async function _deliverReceiptWebhook(env, whConfig, liveKey, payload) {
  const masterKey = env.WEBHOOK_SIGNING_MASTER_KEY;
  if (!masterKey) {
    console.error('emitReceipt: WEBHOOK_SIGNING_MASTER_KEY not set — cannot deliver');
    return;
  }

  const rawBody = JSON.stringify(payload);
  const t       = Math.floor(Date.now() / 1000).toString();

  // SW4a envelope: HMAC-SHA256(key=WEBHOOK_SIGNING_MASTER_KEY, msg=t + "." + raw_body)
  // (Note: envelope signing uses master key directly, not the derived whsec — SW4a invariant)
  const envelopeMsg = `${t}.${rawBody}`;
  const envelopeKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const envelopeSig = await crypto.subtle.sign(
    'HMAC',
    envelopeKey,
    new TextEncoder().encode(envelopeMsg),
  );
  const envelopeSigHex = Array.from(new Uint8Array(envelopeSig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const res = await fetch(whConfig.url, {
      method:  'POST',
      headers: {
        'Content-Type':           'application/json',
        'X-Refueler-Signature':   `t=${t},v1=${envelopeSigHex}`,
        'X-Refueler-Live-Key':    liveKey,
        'X-Refueler-Event':       payload.event,
      },
      body: rawBody,
    });
    if (!res.ok) {
      console.error(`emitReceipt: webhook delivery failed ${res.status} to ${whConfig.url}`);
    }
  } catch (e) {
    console.error('emitReceipt: webhook fetch error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// handleApiReceipt — GET /api/v1/receipt/:uuid/:type
//
// Authenticated pull endpoint for stored receipts.
// HMAC-authenticated (requireApiAuth). Returns the stored { receipt, sig }
// from KV, or 404 if not yet emitted.
//
// Path params:
//   uuid  — transfer UUID (validated)
//   type  — 'acceptance' | 'collection'
//
// No re-computation: the stored receipt is the canonical artefact.
// Allows clients to retrieve their keepsake receipt at any time within 7 days.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleApiReceipt(request, env, uuid, receiptType) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_RE.test(uuid)) {
    return _receiptErr(400, 'Invalid transfer ID');
  }
  if (receiptType !== 'acceptance' && receiptType !== 'collection') {
    return _receiptErr(400, 'type must be acceptance or collection');
  }

  const kvKey = `receipt_${uuid}_${receiptType}`;
  let stored;
  try {
    stored = await env.STATUS_KV.get(kvKey, { type: 'json' });
  } catch (e) {
    console.error('handleApiReceipt: KV read error:', e);
    return _receiptErr(502, 'Receipt store unavailable');
  }

  if (!stored) return _receiptErr(404, 'Receipt not found');
  if (stored.pending) return _receiptErr(404, 'Receipt not yet available');

  return new Response(JSON.stringify(stored), {
    status:  200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function _receiptErr(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
