/**
 * storage.js — Navy Office Storage & Billing: what R2 holds right now
 * worker/src/handlers/storage.js
 *
 * GET /admin/storage  (X-Admin-Key)  — B12-2.
 *
 * Pages the whole bucket, groups object sizes by UUID prefix, then reads each
 * transfer's manifest for its tier and state. Returns AGGREGATES ONLY (B12 §2.1):
 * no UUIDs, no per-transfer sizes, nothing read from KV (B12-SR X1). The bytes
 * are ciphertext as stored — the thing R2 bills for.
 *
 * Buckets:
 *   live      — upload complete, not expired, not deleted. Split by tier key.
 *   uploading — manifest says upload_complete:false (in flight or abandoned).
 *   expired   — past expiry, objects not yet swept.
 *   deleted   — tombstone (consumed) plus any leftover objects under it.
 *   unattached — objects with no manifest at all (orphan sweep's job).
 *
 * Budget: R2_BUDGET_GIB ([vars], display only — it authorises nothing).
 */

import { err, json } from '../utils.js';

const UUID_PREFIX_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i;
const GIB = 1024 ** 3;
const DEFAULT_BUDGET_GIB = 500;

export async function handleAdminStorage(request, env) {
  const adminKey = request.headers.get('X-Admin-Key') ?? '';
  if (!adminKey || !env.ADMIN_KEY || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');
  return json(await buildStorageSummary(env, Math.floor(Date.now() / 1000)));
}

export async function buildStorageSummary(env, nowSeconds) {
  // ── 1. Page the bucket, sum sizes per UUID prefix ──────────────────────────
  const byUuid = new Map();   // uuid → { bytes, hasManifest }
  let otherBytes = 0, objects = 0, cursor;
  do {
    const page = await env.BUCKET.list(cursor ? { limit: 1000, cursor } : { limit: 1000 });
    for (const o of page.objects ?? []) {
      objects++;
      const m = UUID_PREFIX_RE.exec(o.key);
      if (!m) { otherBytes += o.size ?? 0; continue; }
      const e = byUuid.get(m[1]) ?? { bytes: 0, hasManifest: false };
      e.bytes += o.size ?? 0;
      if (o.key === `${m[1]}/manifest.json`) e.hasManifest = true;
      byUuid.set(m[1], e);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // ── 2. Classify each transfer from its manifest ───────────────────────────
  const blank = () => ({ transfers: 0, bytes: 0 });
  const live = {};                     // tier key → { transfers, bytes }
  const uploading = blank(), expired = blank(), deleted = blank(), unattached = blank(), unreadable = blank();

  await Promise.all([...byUuid].map(async ([uuid, e]) => {
    let bucket;
    if (!e.hasManifest) bucket = unattached;
    else {
      let m = null;
      try { const o = await env.BUCKET.get(`${uuid}/manifest.json`); if (o) m = await o.json(); } catch {}
      if (!m)                                   bucket = unreadable;
      else if (m.consumed === true)             bucket = deleted;
      else if (m.upload_complete !== true)      bucket = uploading;
      else if (nowSeconds > (m.expiry_timestamp ?? 0)) bucket = expired;
      else {
        const tier = typeof m.tier === 'string' ? m.tier : 'unknown';
        bucket = live[tier] ??= blank();
      }
    }
    bucket.transfers++;
    bucket.bytes += e.bytes;
  }));

  const totalBytes = [...byUuid.values()].reduce((s, e) => s + e.bytes, 0) + otherBytes;
  const budget = Number(env.R2_BUDGET_GIB) > 0 ? Number(env.R2_BUDGET_GIB) : DEFAULT_BUDGET_GIB;

  return {
    as_of_day:   new Date(nowSeconds * 1000).toISOString().slice(0, 10),   // day-granular
    total_bytes: totalBytes,
    total_gib:   +(totalBytes / GIB).toFixed(1),
    objects,
    budget_gib:  budget,
    // 5 % bands, rounded down (B12-SR S5 rule, applied here too).
    budget_band_pct: Math.floor((totalBytes / GIB) / budget * 20) * 5,
    live,
    uploading, expired, deleted, unattached, unreadable,
    other_bytes: otherBytes,
  };
}
