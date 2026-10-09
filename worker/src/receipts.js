// ─────────────────────────────────────────────────────────────────────────────
// receipts.js — SW5, rebuilt at API-Repair-1 (9 Oct 2026)
//
// Acceptance receipts (cargo.accepted, at finalise) and collection receipts
// (cargo.discharged, at the last chunk served).
//
// Architecture (SW5-Opus, unchanged): symmetric HMAC-SHA256 under the client's
// rfs_whsec_; delivered as notification, never control flow; stored 7 days in
// KV for pull; no Supabase row; no recipient metadata, ever.
//
// v2 (API-Repair-1): the receipt names the client by org_account_id (never the
// live key, which the manifest no longer holds). It is signed with the SAME
// rfs_whsec_ string the client got at registration (v1 derived a different key
// the client never held). It travels in the same v0 envelope as webhooks.
// A receipt needs a registered webhook: no registration → no whsec → no receipt.
//
//   receipt_sig = "v1=" + hex(HMAC-SHA256(utf8(rfs_whsec_),
//                   utf8("refueler.receipt.v2\n") ‖ utf8(JSON.stringify(receipt))))
//
// Ownership at pull: the MAC'd receipt record's owner tag must be the caller's
// (receipt_store.js) — F4. No BLAKE3 root, no plaintext root. Load-bearing.
// Reserved (not built): cargo.in_bond.
// ─────────────────────────────────────────────────────────────────────────────

import { readWhConfig, deriveWhsec, hmacHex, sendEvent, clientForManifest, EVENTS } from './webhook_delivery.js';
import { orgTag } from './kvmac.js';
import { putReceipt, getReceipt } from './receipt_store.js';

export const RECEIPT_VERSION = 'refueler.receipt.v2';

/**
 * buildSignedReceipt(whsec, fields) → { receipt, sig }   (pure)
 *
 * fields: receipt_type, event, org_account_id, uuid, transfer_ref, chunk_count,
 *         issued_at; acceptance: accepted_at, expiry_timestamp;
 *         collection: collected_at.
 * size_bytes is always null (Share-Size-1); the key stays in the schema.
 */
export async function buildSignedReceipt(whsec, fields) {
  const { receipt_type, event } = fields;
  if (receipt_type === 'acceptance' ? event !== EVENTS.ACCEPTED
      : receipt_type === 'collection' ? event !== EVENTS.DISCHARGED : true) {
    throw new Error(`Invalid receipt_type/event: ${receipt_type}/${event}`);
  }
  // Field order is the wire schema. No extra fields.
  const receipt = {
    receipt_version: RECEIPT_VERSION,
    receipt_type,
    event,
    org_account_id: fields.org_account_id,
    uuid:           fields.uuid,
    transfer_ref:   fields.transfer_ref ?? null,
    size_bytes:     null,
    chunk_count:    fields.chunk_count ?? 0,
    issued_at:      fields.issued_at,
  };
  if (receipt_type === 'acceptance') {
    receipt.accepted_at      = fields.accepted_at ?? fields.issued_at;
    receipt.expiry_timestamp = fields.expiry_timestamp ?? 0;
  } else {
    receipt.collected_at     = fields.collected_at ?? fields.issued_at;
  }
  const sig = `v1=${await hmacHex(whsec, `${RECEIPT_VERSION}\n${JSON.stringify(receipt)}`)}`;
  return { receipt, sig };
}

/**
 * issueReceipt(env, uuid, manifest, type, times) → Promise<void>
 * Wrap in ctx.waitUntil. manifest = the one the caller holds (pre-tombstone).
 * Consumer transfer, no registration, or any failure → nothing. Never throws.
 */
export async function issueReceipt(env, uuid, manifest, type, times = {}) {
  try {
    const client = await clientForManifest(env, uuid, manifest);
    if (!client) return;
    const cfg = await readWhConfig(env, client.org);
    if (!cfg || !cfg.active) return;
    const now = Math.floor(Date.now() / 1000);
    const event = type === 'acceptance' ? EVENTS.ACCEPTED : EVENTS.DISCHARGED;
    const signed = await buildSignedReceipt(await deriveWhsec(env, client.org, cfg.created_at), {
      receipt_type: type, event, org_account_id: client.org, uuid,
      transfer_ref: client.transferRef, chunk_count: manifest.total_chunks ?? 0, issued_at: now,
      accepted_at: times.accepted_at, expiry_timestamp: manifest.expiry_timestamp,
      collected_at: times.collected_at,
    });
    const tag = await orgTag(env, client.org);
    if (!(await putReceipt(env, uuid, type, tag, signed))) return;
    await sendEvent(env, client.org, { event, uuid, receipt: signed.receipt, sig: signed.sig });
  } catch (e) {
    console.error(`issueReceipt(${type}) failed:`, e);
  }
}

/**
 * handleApiReceipt(env, client, uuid, type) — GET /api/v1/receipt/:uuid/:type
 * Caller already HMAC-authenticated (index.js). 404 unless the caller owns it.
 */
export async function handleApiReceipt(env, client, uuid, receiptType) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(uuid)) return receiptErr(400, 'Invalid transfer ID');
  if (receiptType !== 'acceptance' && receiptType !== 'collection') {
    return receiptErr(400, 'type must be acceptance or collection');
  }
  let stored;
  try {
    stored = await getReceipt(env, uuid, receiptType, await orgTag(env, client.org_account_id));
  } catch (e) {
    console.error('handleApiReceipt: KV read error:', e);
    return receiptErr(502, 'Receipt store unavailable');
  }
  if (!stored) return receiptErr(404, 'Receipt not found (receipts need a registered webhook)');
  return new Response(JSON.stringify(stored), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function receiptErr(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
