// worker/src/webhook_delivery.js
//
// Webhook routing, signing, delivery and dead-letter retry.
// SW4a/SW4b, rebuilt at API-Repair-1 (9 Oct 2026; design: docs/KV-Audit-v1.md §4.3).
//
// ── Who gets an event ────────────────────────────────────────────────────────
//   R2 manifest cref_ct (sealed org_account_id, seal.js) → org → wh_config_{orgtag}.
//   The manifest is the ground truth; nothing in KV says which client owns a
//   transfer. Callers pass the manifest they already hold (read before any
//   tombstone is written). No cref_ct → consumer transfer → no event.
//
// ── KV records (B12-SR X1: KV is compromised for write) ─────────────────────
//   wh_config_{orgtag} → { v:1, url, created_at, active, deleted_at, mac }
//     mac = HMAC(K_whcfg, utf8(WHCFG_TAG) ‖ 0x00 ‖ orgtag16 ‖ BE64(created_at)
//                ‖ active(1 B) ‖ BE64(deleted_at) ‖ utf8(url))
//   wh_dlq_{orgtag}_{rand16hex} → { v:1, org, event, uuid, attempt_at, mac }
//     mac = HMAC(K_whdlq, utf8(WHDLQ_TAG) ‖ 0x00 ‖ orgtag16 ‖ rand16 ‖ org16
//                ‖ uuid16 ‖ BE64(attempt_at) ‖ utf8(event))
//   orgtag = orgTag(env, org) (kvmac.js): keyed, so no raw org id in a key name.
//   Unverifiable values read as absent. The URL is re-validated at every send.
//   A DLQ retry also re-checks the event against R2 (or the MAC'd receipt) and
//   drops anything R2 does not confirm, so a genuine old entry can't be replayed
//   into a different claim. Residual: a KV reader sees org ↔ uuid for failed
//   deliveries for up to 7 days.
//
// ── Signing (no live clients before v2, so no compatibility shim) ───────────
//   rfs_whsec_ = base58( HKDF-SHA256(ikm = utf8(WEBHOOK_SIGNING_MASTER_KEY), salt = empty,
//                        info = utf8("refueler.share.whsec.v2") ‖ 0x00 ‖ org16 ‖ BE64(created_at)) )
//   Derived, never stored; re-registration (new created_at) rotates it.
//   Envelope: body = JSON {event, uuid, t, …}; header
//     X-Refueler-Signature: t=<unix>,v0=hex(HMAC(utf8(rfs_whsec_), "v0:" + t + ":" + body))
//   Receipts (receipts.js) are signed with the same rfs_whsec_ string.
//
// Webhooks are notification, never control flow: nothing here throws to callers.

import {
  deriveKvMacKey, macFields, checkMacFields, orgTag, hex16, be64, uuidToBytes,
  bytesToB64url, concat,
} from './kvmac.js';
import { validateWebhookUrl } from './webhook_url.js';
import { openCref, hasCref } from './seal.js';
import { safeGetManifest } from './utils.js';
import { getReceipt } from './receipt_store.js';

export const WHCFG_TAG = 'refueler.share.kvmac.whcfg.v1';
export const WHDLQ_TAG = 'refueler.share.kvmac.whdlq.v1';
const WHSEC_INFO = 'refueler.share.whsec.v2';

export const EVENTS = Object.freeze({
  CONFIRMED:  'transfer.confirmed',
  TIMESTAMP:  'transfer.timestamp_submitted',
  ACCEPTED:   'cargo.accepted',
  DISCHARGED: 'cargo.discharged',
});
const RECEIPT_TYPE = { 'cargo.accepted': 'acceptance', 'cargo.discharged': 'collection' };

const WH_CONFIG_ACTIVE_TTL   = 2 * 365 * 24 * 3600;
const WH_CONFIG_INACTIVE_TTL = 7 * 24 * 3600;
const DLQ_TTL                = 7 * 24 * 3600;
const DELIVERY_TIMEOUT_MS    = 10_000;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const enc = new TextEncoder();

// ─────────────────────────────────────────────────────────────────────────────
// Routing
// ─────────────────────────────────────────────────────────────────────────────

/** clientForManifest(env, uuid, manifest) → { org, transferRef } | null */
export async function clientForManifest(env, uuid, manifest) {
  if (!hasCref(manifest)) return null;
  const client = await openCref(env, uuid, manifest.cref_ct);
  if (!client) console.error('webhook_delivery: cref_ct did not open for', uuid);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// wh_config_ (MAC'd)
// ─────────────────────────────────────────────────────────────────────────────

export async function whConfigKey(env, org) {
  const tag = await orgTag(env, org);
  return tag ? `wh_config_${tag}` : null;
}

function cfgParts(tag, rec) {
  const t = hex16(tag);
  if (!t || typeof rec.url !== 'string') return null;
  return [t, be64(rec.created_at), new Uint8Array([rec.active === true ? 1 : 0]),
          be64(rec.deleted_at ?? 0), enc.encode(rec.url)];
}

/** writeWhConfig(env, org, { url, created_at, active, deleted_at? }) → boolean. Throws on KV failure. */
export async function writeWhConfig(env, org, rec) {
  const tag = await orgTag(env, org);
  const p = tag ? cfgParts(tag, rec) : null;
  const mac = await macFields(p ? await deriveKvMacKey(env, 'whcfg') : null, WHCFG_TAG, ...(p ?? []));
  if (!mac) return false;
  const value = {
    v: 1, url: rec.url, created_at: rec.created_at, active: rec.active === true,
    deleted_at: rec.deleted_at ?? null, mac: bytesToB64url(mac),
  };
  await env.STATUS_KV.put(`wh_config_${tag}`, JSON.stringify(value), {
    expirationTtl: value.active ? WH_CONFIG_ACTIVE_TTL : WH_CONFIG_INACTIVE_TTL,
  });
  return true;
}

/**
 * readWhConfig(env, org) → { url, created_at, active, deleted_at } | null
 * null = absent or unverifiable. Throws on KV failure (callers decide).
 */
export async function readWhConfig(env, org) {
  const tag = await orgTag(env, org);
  if (!tag) return null;
  const rec = await env.STATUS_KV.get(`wh_config_${tag}`, { type: 'json' });
  if (!rec || rec.v !== 1 || !Number.isInteger(rec.created_at)) return null;
  const p = cfgParts(tag, rec);
  const key = p ? await deriveKvMacKey(env, 'whcfg') : null;
  if (!key || !(await checkMacFields(key, WHCFG_TAG, rec.mac, ...p))) return null;
  return { url: rec.url, created_at: rec.created_at, active: rec.active === true, deleted_at: rec.deleted_at ?? null };
}

/** Active, verified, URL still valid — or null. Never throws. */
async function deliverableConfig(env, org) {
  let cfg;
  try { cfg = await readWhConfig(env, org); } catch (e) {
    console.error('webhook_delivery: wh_config read failed:', e);
    return null;
  }
  if (!cfg || !cfg.active) return null;
  if (!validateWebhookUrl(cfg.url).ok) {
    console.error('webhook_delivery: stored URL fails validation; not sending');
    return null;
  }
  return cfg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signing
// ─────────────────────────────────────────────────────────────────────────────

/** deriveWhsec(env, org, createdAt) → 'rfs_whsec_…' (throws if the master key is unset). */
export async function deriveWhsec(env, org, createdAt) {
  const master = env.WEBHOOK_SIGNING_MASTER_KEY;
  const o = uuidToBytes(org);
  if (!master || !o) throw new Error('whsec derivation: master key or org missing');
  const ikm  = await crypto.subtle.importKey('raw', enc.encode(master), 'HKDF', false, ['deriveBits']);
  const info = concat(enc.encode(WHSEC_INFO), new Uint8Array([0]), o, be64(createdAt));
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, ikm, 256,
  );
  return `rfs_whsec_${toBase58(new Uint8Array(bits))}`;
}

export async function hmacHex(keyString, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyString),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────

/** POST one signed envelope. → true on 2xx. Redirects are not followed. */
async function post(env, cfg, org, fields) {
  const t0 = Date.now();
  let whsec;
  try { whsec = await deriveWhsec(env, org, cfg.created_at); } catch (e) {
    console.error('webhook_delivery: whsec derivation failed:', e);
    aeLog(env, fields.event, 'fail', 'signing_key_error', 0, 0);
    return false;
  }
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ ...fields, t });
  const sig = await hmacHex(whsec, `v0:${t}:${body}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(cfg.url, {
      method:   'POST',
      redirect: 'manual',
      headers: {
        'Content-Type':         'application/json',
        'X-Refueler-Signature': `t=${t},v0=${sig}`,
        'X-Refueler-Event':     fields.event,
        'User-Agent':           'Refueler-Webhook/2.0',
      },
      body,
      signal: controller.signal,
    });
    const ok = res.status >= 200 && res.status < 300;
    aeLog(env, fields.event, ok ? 'success' : 'fail', String(res.status), res.status, Date.now() - t0);
    if (!ok) console.warn(`webhook_delivery: ${fields.event} → HTTP ${res.status}`); // never the URL
    return ok;
  } catch (e) {
    const cls = e?.name === 'AbortError' ? 'timeout' : 'network_error';
    aeLog(env, fields.event, 'fail', cls, 0, Date.now() - t0);
    console.warn(`webhook_delivery: ${fields.event} → ${cls}: ${e?.message ?? e}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * sendEvent(env, org, { event, uuid, ...extra }) → Promise<boolean>
 * No registration → false, nothing queued. Failed send → dead-lettered.
 * Never throws.
 */
export async function sendEvent(env, org, fields) {
  try {
    const cfg = await deliverableConfig(env, org);
    if (!cfg) return false;
    if (await post(env, cfg, org, fields)) return true;
    await deadLetter(env, org, fields.event, fields.uuid);
    return false;
  } catch (e) {
    console.error('webhook_delivery: sendEvent failed:', e);
    return false;
  }
}

/**
 * notifyTransfer(env, uuid, manifest, event) → Promise<void>
 * For transfer.* events. manifest = the one the caller read (pre-tombstone).
 */
export async function notifyTransfer(env, uuid, manifest, event) {
  const client = await clientForManifest(env, uuid, manifest);
  if (client) await sendEvent(env, client.org, { event, uuid });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dead-letter queue (MAC'd)
// ─────────────────────────────────────────────────────────────────────────────

function dlqParts(tag, rand, rec) {
  const t = hex16(tag), r = hex16(rand), o = uuidToBytes(rec.org), u = uuidToBytes(rec.uuid);
  if (!t || !r || !o || !u || typeof rec.event !== 'string') return null;
  return [t, r, o, u, be64(rec.attempt_at), enc.encode(rec.event)];
}

async function deadLetter(env, org, event, uuid) {
  const tag = await orgTag(env, org);
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const rec = { org, event, uuid, attempt_at: Math.floor(Date.now() / 1000) };
  const p = tag ? dlqParts(tag, rand, rec) : null;
  const mac = await macFields(p ? await deriveKvMacKey(env, 'whdlq') : null, WHDLQ_TAG, ...(p ?? []));
  if (!mac) return;
  try {
    await env.STATUS_KV.put(`wh_dlq_${tag}_${rand}`,
      JSON.stringify({ v: 1, ...rec, mac: bytesToB64url(mac) }), { expirationTtl: DLQ_TTL });
  } catch (e) {
    console.error('webhook_delivery: DLQ write failed:', e);
  }
}

const DLQ_KEY_RE = /^wh_dlq_([0-9a-f]{32})_([0-9a-f]{32})$/;

/** Verified DLQ entry for a KV key name, or null. */
async function readDlqEntry(env, name) {
  const m = name.match(DLQ_KEY_RE);
  if (!m) return null;
  const rec = await env.STATUS_KV.get(name, { type: 'json' });
  if (!rec || rec.v !== 1) return null;
  const p = dlqParts(m[1], m[2], rec);
  const key = p ? await deriveKvMacKey(env, 'whdlq') : null;
  if (!key || !(await checkMacFields(key, WHDLQ_TAG, rec.mac, ...p))) return null;
  if ((await orgTag(env, rec.org)) !== m[1]) return null;
  return { tag: m[1], org: rec.org, event: rec.event, uuid: rec.uuid };
}

/**
 * Re-derive the event from stored state. → fields to send, or null to drop.
 *   transfer.confirmed            R2 manifest is a consumed tombstone
 *   transfer.timestamp_submitted  live manifest, timestamp_state set, cref → same org
 *   cargo.*                       MAC'd receipt record owned by the same org
 */
async function confirmEvent(env, entry) {
  const { org, event, uuid } = entry;
  const type = RECEIPT_TYPE[event];
  if (type) {
    const r = await getReceipt(env, uuid, type, entry.tag);
    return r ? { event, uuid, receipt: r.receipt, sig: r.sig } : null;
  }
  const { manifest } = await safeGetManifest(env.BUCKET, uuid, env);
  if (!manifest) return null;
  if (event === EVENTS.CONFIRMED) {
    return manifest.consumed === true ? { event, uuid } : null;
  }
  if (event === EVENTS.TIMESTAMP) {
    if (manifest.consumed === true || !manifest.timestamp_state || manifest.timestamp_state === 'none') return null;
    const client = await clientForManifest(env, uuid, manifest);
    return client?.org === org ? { event, uuid } : null;
  }
  return null;
}

/**
 * retryDeadLetterQueue(env) → { retried, succeeded, failed, dropped }
 * Daily cron. Fresh t on every attempt. Entries that fail the MAC or that
 * stored state no longer confirms are deleted; failed sends stay until TTL.
 */
export async function retryDeadLetterQueue(env) {
  let retried = 0, succeeded = 0, failed = 0, dropped = 0;
  let cursor;
  do {
    let list;
    try {
      list = await env.STATUS_KV.list({ prefix: 'wh_dlq_', cursor, limit: 1000 });
    } catch (e) {
      console.error('webhook_delivery/dlq: KV list failed:', e);
      break;
    }
    for (const { name } of list.keys) {
      retried++;
      let fields = null, entry = null;
      try {
        entry = await readDlqEntry(env, name);
        fields = entry ? await confirmEvent(env, entry) : null;
      } catch (e) {
        console.error('webhook_delivery/dlq: read failed, leaving entry:', e);
        failed++;
        continue;
      }
      const cfg = fields ? await deliverableConfig(env, entry.org) : null;
      if (!cfg) {
        dropped++;
        try { await env.STATUS_KV.delete(name); } catch { /* TTL clears it */ }
        continue;
      }
      if (await post(env, cfg, entry.org, fields)) {
        succeeded++;
        try { await env.STATUS_KV.delete(name); } catch { /* TTL clears it */ }
      } else {
        failed++;
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  if (env.AE) {
    try {
      env.AE.writeDataPoint({
        blobs:   ['webhook_dlq_cron', 'cron', retried > 0 ? 'ran' : 'idle', ''],
        doubles: [retried, succeeded, failed, dropped, 0],
        indexes: ['webhook_dlq_cron'],
      });
    } catch (e) {
      console.error('webhook_delivery/dlq: AE log failed:', e);
    }
  }
  console.log(`webhook_delivery/dlq: retried=${retried} succeeded=${succeeded} failed=${failed} dropped=${dropped}`);
  return { retried, succeeded, failed, dropped };
}

/** DLQ depth for one client (display only; capped at one KV list page). */
export async function dlqDepth(env, org) {
  const tag = await orgTag(env, org);
  if (!tag) return 0;
  const listed = await env.STATUS_KV.list({ prefix: `wh_dlq_${tag}_` });
  return listed.keys.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function aeLog(env, eventType, outcome, statusOrError, statusCode, latencyMs) {
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

function toBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => BASE58_ALPHABET[d]).join('');
}
