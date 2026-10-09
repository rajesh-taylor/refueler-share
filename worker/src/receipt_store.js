// worker/src/receipt_store.js
//
// Signed receipts at rest in KV (API-Repair-1 · 9 Oct 2026).
//
//   receipt_{uuid}_{acceptance|collection} →
//     { v: 1, owner: <org tag>, receipt, sig, mac }   7-day TTL
//
// The owner is bound here, not read from the manifest: DAD writes the tombstone
// (which strips cref_ct) at the moment cargo.discharged fires, so a manifest
// check would refuse the real owner. MAC under the KV_MAC_KEY 'rcpt' subkey:
//   HMAC(K_rcpt, utf8(RCPT_TAG) ‖ 0x00 ‖ uuid16 ‖ type(1 B) ‖ orgtag16 ‖ utf8(JSON {receipt, sig}))
// The KV key name (uuid + type) is inside the MAC, so a record can't be moved.
// Any failure reads as absent.

import { deriveKvMacKey, macFields, checkMacFields, uuidToBytes, hex16, bytesToB64url } from './kvmac.js';

export const RCPT_TAG = 'refueler.share.kvmac.rcpt.v1';
const RECEIPT_TTL = 7 * 24 * 3600;
const TYPE_BYTE = { acceptance: 1, collection: 2 };
const enc = new TextEncoder();

function parts(uuid, type, ownerTag, body) {
  const u = uuidToBytes(uuid);
  const t = TYPE_BYTE[type];
  const o = hex16(ownerTag);
  if (!u || !t || !o) return null;
  return [u, new Uint8Array([t]), o, enc.encode(body)];
}

export function receiptKey(uuid, type) {
  return `receipt_${uuid}_${type}`;
}

/** putReceipt(env, uuid, type, ownerTag, { receipt, sig }) → boolean */
export async function putReceipt(env, uuid, type, ownerTag, signed) {
  const body = JSON.stringify({ receipt: signed.receipt, sig: signed.sig });
  const p = parts(uuid, type, ownerTag, body);
  const key = p ? await deriveKvMacKey(env, 'rcpt') : null;
  const mac = await macFields(key, RCPT_TAG, ...(p ?? []));
  if (!mac) return false;
  try {
    await env.STATUS_KV.put(receiptKey(uuid, type), JSON.stringify({
      v: 1, owner: ownerTag, receipt: signed.receipt, sig: signed.sig, mac: bytesToB64url(mac),
    }), { expirationTtl: RECEIPT_TTL });
    return true;
  } catch (e) {
    console.error('receipt_store: KV put failed:', e);
    return false;
  }
}

/**
 * getReceipt(env, uuid, type, ownerTag) → { receipt, sig } | null
 * null when absent, unverifiable, or owned by someone else.
 * Throws only when KV itself fails (caller → 502).
 */
export async function getReceipt(env, uuid, type, ownerTag) {
  const rec = await env.STATUS_KV.get(receiptKey(uuid, type), { type: 'json' });
  if (!rec || rec.v !== 1 || rec.owner !== ownerTag) return null;
  const body = JSON.stringify({ receipt: rec.receipt, sig: rec.sig });
  const p = parts(uuid, type, ownerTag, body);
  const key = p ? await deriveKvMacKey(env, 'rcpt') : null;
  if (!key || !(await checkMacFields(key, RCPT_TAG, rec.mac, ...p))) return null;
  return { receipt: rec.receipt, sig: rec.sig };
}
