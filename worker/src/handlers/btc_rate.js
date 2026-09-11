// worker/src/handlers/btc_rate.js
//
// BTC/GBP reference rate management for the Refueler API.
//
// KV key: btc_ref_rate:current (STATUS_KV, no TTL — staleness derived from last_updated).
//
// Schema (locked SW-MCP-Opus-2 / CLAUDE.md §API feature gates):
//   {
//     gbp_per_btc:  number,   // e.g. 62000
//     source:       string,   // 'coingecko' | 'manual'
//     last_updated: string,   // ISO 8601
//     set_by:       string,   // 'manual' | 'coingecko_cron'
//     previous:     {         // null on first write
//       gbp_per_btc:  number,
//       set_by:       string,
//       last_updated: string,
//     } | null,
//   }
//
// No TTL on the KV entry. The server never evicts a known-good rate.
// Staleness is the consumer's problem to derive from last_updated.
//
// set_by values (exhaustive):
//   'manual'          — POST /admin/btc-rate override by operator
//   'coingecko_cron'  — 03:00 UTC daily cron (Task 3 in scheduled())
//
// ±20% guard (mandatory):
//   If a previous entry exists and the new CoinGecko value differs by more than
//   20% from the previous gbp_per_btc, the write is suppressed.
//   Log the guard breach to AE. Leave last-good in place.
//   Manual overrides bypass the guard (operator is authoritative).
//
// CoinGecko endpoint:
//   https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp
//   Response: { bitcoin: { gbp: <number> } }
//
// Admin routes:
//   POST /admin/btc-rate  — X-Admin-Key gated manual override
//   GET  /admin/btc-rate  — X-Admin-Key gated panel read
//
// Both are wired in index.js under the existing admin router section.
// refreshBtcRate() is called from scheduled() as Task 3 (after DLQ + hostname health).

import { BTC_RATE_KV_KEY } from './api_capabilities.js';

// CoinGecko free tier — no key required for simple/price.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp';

// ±20% guard threshold. Mandatory — prevents a CoinGecko glitch repricing the API.
const GUARD_THRESHOLD = 0.20;

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared KV read — returns current rate record or null.
// ─────────────────────────────────────────────────────────────────────────────
async function readRateRecord(env) {
  try {
    return await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
  } catch (e) {
    console.error('btc_rate: KV read error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared KV write.
// Accepts new gbp_per_btc and set_by, reads current to build the previous block.
// No TTL — staleness derived from last_updated by consumers.
// ─────────────────────────────────────────────────────────────────────────────
async function writeRateRecord(env, gbp_per_btc, set_by, current) {
  const previous = current
    ? {
        gbp_per_btc:  current.gbp_per_btc,
        set_by:       current.set_by,
        last_updated: current.last_updated,
      }
    : null;

  const record = {
    gbp_per_btc,
    source:       set_by === 'manual' ? 'manual' : 'coingecko',
    last_updated: new Date().toISOString(),
    set_by,
    previous,
  };

  await env.STATUS_KV.put(BTC_RATE_KV_KEY, JSON.stringify(record));
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// handleAdminBtcRatePost — POST /admin/btc-rate
//
// X-Admin-Key gated. Manual override — bypasses the ±20% guard.
// Body: { gbp_per_btc: number }
//
// Validation:
//   - gbp_per_btc must be a finite positive number.
//   - Sanity floor/ceiling: £1,000–£10,000,000. Outside these bounds the
//     operator has made a typo and we refuse rather than silently corrupt the
//     rate card. The ceiling is deliberately generous — a seven-figure BTC
//     is not impossible on a long horizon.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminBtcRatePost(request, env) {
  // ── Admin key gate ────────────────────────────────────────────────────────
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised.');
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON.');
  }

  const { gbp_per_btc } = body;

  if (
    gbp_per_btc === undefined ||
    gbp_per_btc === null ||
    typeof gbp_per_btc !== 'number' ||
    !Number.isFinite(gbp_per_btc) ||
    gbp_per_btc <= 0
  ) {
    return err(400, 'gbp_per_btc must be a finite positive number.');
  }

  // Sanity bounds — outside this range, the operator has very likely mistyped.
  if (gbp_per_btc < 1_000 || gbp_per_btc > 10_000_000) {
    return err(400, 'gbp_per_btc must be between 1,000 and 10,000,000.');
  }

  // ── Read current (for previous block) ────────────────────────────────────
  const current = await readRateRecord(env);

  // ── Write — manual overrides bypass the ±20% guard ───────────────────────
  let record;
  try {
    record = await writeRateRecord(env, gbp_per_btc, 'manual', current);
  } catch (e) {
    console.error('btc_rate: KV write error:', e);
    return err(502, 'Failed to write rate to KV.');
  }

  return json({ ok: true, rate: record });
}

// ─────────────────────────────────────────────────────────────────────────────
// handleAdminBtcRateGet — GET /admin/btc-rate
//
// X-Admin-Key gated. Returns current KV entry or { set: false } on cold start.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminBtcRateGet(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised.');
  }

  const current = await readRateRecord(env);

  if (!current) {
    return json({ set: false });
  }

  // Compute staleness for the panel.
  const ageSeconds = current.last_updated
    ? Math.floor((Date.now() - new Date(current.last_updated).getTime()) / 1000)
    : null;

  return json({
    set:        true,
    rate:       current,
    age_seconds: ageSeconds,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// refreshBtcRate — called from scheduled() as Task 3 at 03:00 UTC.
//
// Fetches CoinGecko simple/price. Applies ±20% guard against previous value
// if a previous entry exists. On guard breach: log to AE, leave last-good.
//
// On cold start (no previous entry): write unconditionally — any CoinGecko
// value is better than null. The guard requires a previous to compare against.
//
// This function is intentionally synchronous-looking — it must resolve (not
// throw) so scheduled() can proceed to other tasks regardless. All errors are
// caught and logged.
// ─────────────────────────────────────────────────────────────────────────────
export async function refreshBtcRate(env) {
  // ── Fetch CoinGecko ───────────────────────────────────────────────────────
  let newRate;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    let cgRes;
    try {
      cgRes = await fetch(COINGECKO_URL, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!cgRes.ok) {
      console.error(`btc_rate/cron: CoinGecko returned HTTP ${cgRes.status}`);
      _logAeGuardBreach(env, null, null, `coingecko_http_${cgRes.status}`);
      return;
    }

    const data = await cgRes.json();
    newRate = data?.bitcoin?.gbp;

    if (typeof newRate !== 'number' || !Number.isFinite(newRate) || newRate <= 0) {
      console.error('btc_rate/cron: CoinGecko response missing bitcoin.gbp:', JSON.stringify(data));
      _logAeGuardBreach(env, null, null, 'coingecko_bad_response');
      return;
    }
  } catch (e) {
    // Network error or timeout.
    const reason = e?.name === 'AbortError' ? 'coingecko_timeout' : 'coingecko_network_error';
    console.error(`btc_rate/cron: fetch failed (${reason}):`, e?.message ?? e);
    _logAeGuardBreach(env, null, null, reason);
    return;
  }

  // ── Read current record ───────────────────────────────────────────────────
  const current = await readRateRecord(env);

  // ── ±20% guard ────────────────────────────────────────────────────────────
  if (current && typeof current.gbp_per_btc === 'number') {
    const prev      = current.gbp_per_btc;
    const pctChange = Math.abs(newRate - prev) / prev;

    if (pctChange > GUARD_THRESHOLD) {
      console.error(
        `btc_rate/cron: ±20% guard triggered. prev=${prev} new=${newRate} drift=${(pctChange * 100).toFixed(1)}%`
      );
      _logAeGuardBreach(env, prev, newRate, 'guard_breach');
      // Leave last-good in place. Do not write.
      return;
    }
  }
  // Cold start OR within guard: write.

  // ── Sanity bounds (belt-and-suspenders) ───────────────────────────────────
  if (newRate < 1_000 || newRate > 10_000_000) {
    console.error(`btc_rate/cron: CoinGecko rate ${newRate} outside sanity bounds — not writing.`);
    _logAeGuardBreach(env, current?.gbp_per_btc ?? null, newRate, 'sanity_bounds');
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  try {
    await writeRateRecord(env, newRate, 'coingecko_cron', current);
    console.log(`btc_rate/cron: rate updated to £${newRate.toLocaleString()}/BTC via CoinGecko.`);
  } catch (e) {
    console.error('btc_rate/cron: KV write failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// _logAeGuardBreach — fire-and-forget AE event for guard breach / fetch failure.
//
// blob1 = 'btc_rate_guard'
// blob2 = reason string
// blob3 = previous gbp_per_btc as string (or 'null')
// blob4 = new gbp_per_btc as string (or 'null')
// ─────────────────────────────────────────────────────────────────────────────
function _logAeGuardBreach(env, prev, next, reason) {
  if (!env?.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   ['btc_rate_guard', reason, String(prev ?? 'null'), String(next ?? 'null')],
      doubles: [Date.now(), prev ?? 0, next ?? 0, 0, 0],
      indexes: ['btc_rate_guard'],
    });
  } catch (e) {
    console.error('btc_rate: AE write failed:', e);
  }
}
