/**
 * execution_dock.js — Execution Dock: Navy Office sent-transfers view
 * worker/src/handlers/execution_dock.js
 *
 * GET /admin/execution-dock
 * Auth: X-Admin-Key header (same as all /admin/* endpoints).
 *
 * KV schema (dock_index:{uuid}) — the same object is the value AND the key's
 * metadata (OSA-Tools-2 §6), so the dock is read from list() alone, every page
 * through the cursor. Legacy keys without metadata fall back to get() until
 * their TTL ends; their transfer ID comes from the key name.
 *   {
 *     uuid:              string,
 *     file_name:         string | null,
 *     expiry_timestamp:  number,   // unix seconds
 *     created_at:        number,   // unix seconds
 *     tier:              string,
 *     collected:         boolean,
 *     collected_at:      number | null,
 *     purged_at:         number | null,   // B12-1: set by a sweep that purged the objects
 *   }
 *   size_bytes is NOT part of the schema (B12-SR X4). Legacy entries may still
 *   carry it in KV until TTL; it is never returned.
 *
 * Badge trigger thresholds — proportional to expiry window:
 *   1-day  expiry → no badge (too short to be meaningful)
 *   7-day  expiry → badge at day 4  (elapsed ≥ 345,600s)
 *   30-day expiry → badge at day 15 (elapsed ≥ 1,296,000s)
 *   90-day expiry → badge at day 45 (elapsed ≥ 3,888,000s)
 *
 * Status values:
 *   'active'       — not expired, not collected
 *   'active_nudge' — active AND elapsed ≥ badge threshold for this expiry window
 *   'collected'    — recipient confirmed download
 *   'expired'      — past expiry_timestamp, not collected, objects not yet purged
 *   'purged'       — a sweep deleted the objects (purged_at set); wins over every
 *                    other status. Expires column keeps the original date.
 *
 * Display cap: 200 most recent transfers by created_at desc.
 */

import { requireAdmin } from '../utils.js';

const PREFIX = 'dock_index:';
const METADATA_MAX = 1000;   // KV allows 1,024 bytes of serialised metadata

/** TTL the initiate write has always used: expiry + 48 h grace + 1 h, at least 1 h. */
export function dockTtl(expiryTimestamp, nowSeconds) {
  return Math.max((expiryTimestamp - nowSeconds) + 48 * 3600 + 3600, 3600);
}

/** One write of dock_index:{uuid}: value + metadata (metadata dropped if it would not fit). */
export async function putDockEntry(kv, uuid, entry, expirationTtl) {
  const value = JSON.stringify(entry);
  await kv.put(`${PREFIX}${uuid}`, value,
    value.length <= METADATA_MAX ? { expirationTtl, metadata: entry } : { expirationTtl });
}

/**
 * The initiate write (F1): awaited, one retry after retryMs, then one log line
 * naming uuid8 only. Never throws — initiate never fails because of the dock.
 * → true when written.
 */
export async function writeDockEntry(kv, uuid, entry, nowSeconds, { retryMs = 250 } = {}) {
  const ttl = dockTtl(entry.expiry_timestamp, nowSeconds);
  let last;
  for (const wait of [0, retryMs]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try { await putDockEntry(kv, uuid, entry, ttl); return true; }
    catch (e) { last = e; }
  }
  console.error(`Execution Dock: entry not written for ${String(uuid).slice(0, 8)}:`, last?.message ?? last);
  return false;
}

// Badge elapsed-time thresholds in seconds, keyed by expiry window in seconds.

const BADGE_THRESHOLDS = new Map([
  [86400,          null],          // 1 day  — no badge
  [86400 * 7,      86400 * 4],     // 7 days  — badge at day 4
  [86400 * 30,     86400 * 15],    // 30 days — badge at day 15
  [86400 * 90,     86400 * 45],    // 90 days — badge at day 45
]);

/**
 * Derive badge threshold for this transfer's expiry window.
 * Snaps to nearest known window if an unusual value is stored.
 */
function badgeThreshold(createdAt, expiryTimestamp) {
  const windowSeconds = expiryTimestamp - createdAt;
  if (BADGE_THRESHOLDS.has(windowSeconds)) return BADGE_THRESHOLDS.get(windowSeconds);

  // Nearest known window
  let closest = null;
  let closestDiff = Infinity;
  for (const [key] of BADGE_THRESHOLDS) {
    const diff = Math.abs(windowSeconds - key);
    if (diff < closestDiff) { closestDiff = diff; closest = key; }
  }
  return closest !== null ? BADGE_THRESHOLDS.get(closest) : null;
}

function computeStatus(entry, nowSeconds) {
  if (entry.purged_at) return 'purged';
  if (entry.collected) return 'collected';
  if (nowSeconds > entry.expiry_timestamp) return 'expired';

  const elapsed   = nowSeconds - entry.created_at;
  const threshold = badgeThreshold(entry.created_at, entry.expiry_timestamp);
  if (threshold !== null && elapsed >= threshold) return 'active_nudge';
  return 'active';
}

export async function handleExecutionDock(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const nowSeconds = Math.floor(Date.now() / 1000);

  // ── List dock_index: keys — every page (F3) ───────────────────────────────
  // KV list() is eventually consistent: a new entry can take up to ~60 s to
  // appear, and a just-deleted one may briefly still show.
  const entries = [];
  const legacy  = [];
  try {
    let cursor;
    do {
      const page = await env.STATUS_KV.list(cursor ? { prefix: PREFIX, cursor } : { prefix: PREFIX });
      for (const k of page.keys ?? []) {
        const uuid = k.name.slice(PREFIX.length);
        if (k.metadata && typeof k.metadata === 'object') entries.push({ ...k.metadata, uuid: k.metadata.uuid ?? uuid });
        else legacy.push(k.name);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (e) {
    console.error('Execution Dock: KV list failed:', e);
    return new Response(JSON.stringify({ error: 'Failed to list transfers' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Legacy entries (no metadata): one get() each, until they age out ──────
  await Promise.all(legacy.map(async (name) => {
    try {
      const raw = await env.STATUS_KV.get(name, { type: 'json' });
      if (raw && typeof raw === 'object') entries.push({ ...raw, uuid: raw.uuid ?? name.slice(PREFIX.length) });
    } catch (e) {
      console.error('Execution Dock: KV get failed for one legacy entry:', e?.message ?? e);
      // Skip malformed entries silently — don't fail the whole request
    }
  }));

  if (entries.length === 0) {
    return new Response(JSON.stringify({ transfers: [], badge_count: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Enrich with computed status ───────────────────────────────────────────
  const enriched = entries.map(entry => {
    const status = computeStatus(entry, nowSeconds);
    const daysRemaining = entry.collected
      ? null
      : Math.max(0, Math.ceil((entry.expiry_timestamp - nowSeconds) / 86400));

    return {
      uuid:             entry.uuid,
      file_name:        entry.file_name ?? null,
      expiry_timestamp: entry.expiry_timestamp,
      created_at:       entry.created_at,
      tier:             entry.tier ?? 'free',
      collected:        entry.collected ?? false,
      collected_at:     entry.collected_at ?? null,
      status,
      days_remaining:   daysRemaining,
      purged_at:        entry.purged_at ?? null,
      // Share-Dash-2 enrichment — written into dock_index at finalise.
      // (size_bytes removed in B12-1 — plaintext size is never persisted.)
      rail:             entry.rail ?? null,
      // merkle_root IS captured in dock_index at finalise (ciphertext-chunk root),
      // but is deliberately WITHHELD here until Share-6-5 download verify is live
      // (kept pending, Rajesh · Share-Dash-2). Surfacing it is then a one-line
      // change: merkle_root: entry.merkle_root ?? null.
      merkle_root:      null,
    };
  });

  // ── Sort by created_at desc, cap at 200 ───────────────────────────────────
  enriched.sort((a, b) => b.created_at - a.created_at);
  const capped = enriched.slice(0, 200);

  // badge_count = active_nudge transfers only (not expired, not collected)
  const badgeCount = enriched.filter(t => t.status === 'active_nudge').length;

  return new Response(JSON.stringify({ transfers: capped, badge_count: badgeCount }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
