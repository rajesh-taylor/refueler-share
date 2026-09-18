/**
 * client_errors_kv.js — server-observed HTTP error log
 * worker/src/handlers/client_errors_kv.js
 *
 * Share-Dash-2. Distinct from the existing /log/error → AE path, which is
 * CLIENT-REPORTED (the browser tells us it failed). This is SERVER-OBSERVED:
 * the Worker records every 4xx/5xx response it emits, so the two are different
 * observers of different failure classes — the Navy Office client-errors modal
 * shows both behind a source toggle (Share-Dash-3).
 *
 *   appendClientError(env, entry)  — fire-and-forget writer, called from the
 *                                    index.js router at every ≥400 egress.
 *   handleClientErrorsLog(req, env) — GET /admin/client-errors-log (admin-key).
 *
 * KV schema (single key, admin:client_errors_log):
 *   [ { ts, status, endpoint, path, method, msg }, … ]  newest-first
 *   · capped at MAX_ENTRIES (500)
 *   · entries older than RETENTION_SECONDS (90 days) dropped on each append
 *
 * BEST-EFFORT by design. A single-key read-modify-write is not concurrency-safe
 * and is subject to KV's per-key write rate — under a burst of 4xx (e.g. a flood
 * of 429s) some appends will race and be lost. That is acceptable for an
 * internal error log at current volume. If 4xx volume grows, move to per-entry
 * keys (admin:client_errors_log:{ts}) with list()+get on read, or sample here.
 */

const LOG_KEY           = 'admin:client_errors_log';
const MAX_ENTRIES       = 500;
const RETENTION_SECONDS = 90 * 24 * 3600;

/**
 * Append one server-observed error. Never throws — callers fire-and-forget via
 * ctx.waitUntil(). A KV failure is logged to console and swallowed.
 */
export async function appendClientError(env, { status, endpoint, path, method, errorMsg } = {}) {
  if (!env.STATUS_KV) return;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const entry = {
    ts:       nowSeconds,
    status:   Number(status) || 0,
    endpoint: typeof endpoint === 'string' ? endpoint : 'unknown',
    path:     typeof path === 'string' ? path.slice(0, 256) : '',
    method:   typeof method === 'string' ? method : '',
    msg:      typeof errorMsg === 'string' && errorMsg ? errorMsg.slice(0, 200) : '',
  };

  try {
    let log = await env.STATUS_KV.get(LOG_KEY, { type: 'json' });
    if (!Array.isArray(log)) log = [];

    log.unshift(entry); // newest-first

    // Drop anything past the retention window, then cap the length.
    const cutoff = nowSeconds - RETENTION_SECONDS;
    log = log.filter(e => e && typeof e.ts === 'number' && e.ts >= cutoff).slice(0, MAX_ENTRIES);

    // No TTL: retention is enforced above at write time, and the key must
    // survive a 90-day quiet spell so the window is honestly "last 90 days".
    await env.STATUS_KV.put(LOG_KEY, JSON.stringify(log));
  } catch (e) {
    console.error('appendClientError KV write failed:', e);
  }
}

/**
 * GET /admin/client-errors-log — X-Admin-Key gated. Returns the rolling log,
 * newest-first, plus a small summary the modal can render without recomputing.
 */
export async function handleClientErrorsLog(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  let log;
  try {
    log = await env.STATUS_KV.get(LOG_KEY, { type: 'json' });
  } catch (e) {
    console.error('client-errors-log KV read failed:', e);
    return new Response(JSON.stringify({ error: 'Failed to read error log' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!Array.isArray(log)) log = [];

  // Cheap rollups for the card/badge.
  let count4xx = 0, count5xx = 0;
  for (const e of log) {
    if (e.status >= 500) count5xx++;
    else if (e.status >= 400) count4xx++;
  }

  return new Response(JSON.stringify({
    source:      'server_observed_kv',
    window_days: 90,
    total:       log.length,
    count_4xx:   count4xx,
    count_5xx:   count5xx,
    entries:     log,
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
