/**
 * execution_dock.js — Harbourmaster sent-transfers view
 * worker/src/handlers/execution_dock.js
 *
 * GET /admin/execution-dock
 * Auth: X-Admin-Key header (same as all /admin/* endpoints).
 *
 * KV schema (dock_index:{uuid}):
 *   {
 *     uuid:              string,
 *     file_name:         string | null,
 *     expiry_timestamp:  number,   // unix seconds
 *     created_at:        number,   // unix seconds
 *     tier:              string,
 *     collected:         boolean,
 *     collected_at:      number | null,
 *   }
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
 *   'expired'      — past expiry_timestamp, not collected (R2 lifecycle handles chunks)
 *
 * Display cap: 200 most recent transfers by created_at desc.
 */

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
  if (entry.collected) return 'collected';
  if (nowSeconds > entry.expiry_timestamp) return 'expired';

  const elapsed   = nowSeconds - entry.created_at;
  const threshold = badgeThreshold(entry.created_at, entry.expiry_timestamp);
  if (threshold !== null && elapsed >= threshold) return 'active_nudge';
  return 'active';
}

export async function handleExecutionDock(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // ── List dock_index: keys ─────────────────────────────────────────────────
  // KV list() is eventually consistent — a just-collected transfer may briefly
  // still appear. The dashboard [Destroy now] button handles 410 gracefully.
  let keys;
  try {
    const result = await env.STATUS_KV.list({ prefix: 'dock_index:' });
    keys = result.keys ?? [];
  } catch (e) {
    console.error('Execution Dock: KV list failed:', e);
    return new Response(JSON.stringify({ error: 'Failed to list transfers' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  if (keys.length === 0) {
    return new Response(JSON.stringify({ transfers: [], badge_count: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Fetch all entries in parallel ─────────────────────────────────────────
  const entries = [];
  await Promise.all(keys.map(async (keyMeta) => {
    try {
      const raw = await env.STATUS_KV.get(keyMeta.name, { type: 'json' });
      if (raw && typeof raw === 'object') entries.push(raw);
    } catch (e) {
      console.error(`Execution Dock: KV get failed for ${keyMeta.name}:`, e);
      // Skip malformed entries silently — don't fail the whole request
    }
  }));

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
