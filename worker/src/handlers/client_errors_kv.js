/**
 * client_errors_kv.js — the two error logs that may hold detail, kept one day
 * worker/src/handlers/client_errors_kv.js
 *
 * Share-Dash-2, rewritten Error-Notes-1 (21 Oct 2026). Rule: anything that can
 * name a transfer is kept in KV for one day and then deleted by KV itself.
 * Analytics Engine (three months, fixed by Cloudflare, no per-row delete) gets
 * counts only, never a transfer ID.
 *
 *   SERVER-OBSERVED — every 4xx/5xx the Worker returns (transfer IDs scrubbed):
 *     appendClientError(env, entry)    — fire-and-forget, from the index.js router.
 *     handleClientErrorsLog(req, env)  — GET /admin/client-errors-log (admin-key).
 *   BROWSER-REPORTED — POST /log/error notes (step, error name, uuid:xxxxxxxx, chunk):
 *     appendErrorNote(env, note)       — from handleLogError.
 *     readErrorNotes(env, max)         — for /admin/ae-metrics client_errors_detail.
 *
 * KV schema: one key per entry, `errlog:` / `errnote:` + inverted ms timestamp +
 * random suffix, so list() comes back newest-first; the entry lives in the key's
 * metadata (list() returns it, no get per entry); expirationTtl = one day.
 * One key per entry also ends the old single-key read-modify-write race.
 */

import { requireAdmin, scrubUuids } from '../utils.js';

export const RETENTION_SECONDS = 24 * 3600;
const LOG_PREFIX  = 'errlog:';
const NOTE_PREFIX = 'errnote:';
const MAX_ENTRIES = 500;

// The single 90-day key this replaces. Deleted on the first log read after deploy;
// drop this line on/after 21 Nov 2026.
const LEGACY_KEY = 'admin:client_errors_log';

function entryKey(prefix, nowMs) {
  const inv  = String(9_999_999_999_999 - nowMs).padStart(13, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${inv}:${rand}`;
}

async function putEntry(env, prefix, entry, nowMs) {
  await env.STATUS_KV.put(entryKey(prefix, nowMs), '1', {
    expirationTtl: RETENTION_SECONDS,
    metadata: entry,
  });
}

async function listEntries(env, prefix, max) {
  const out = [];
  let cursor;
  do {
    const page = await env.STATUS_KV.list({ prefix, limit: Math.min(1000, max - out.length), cursor });
    for (const k of page.keys) if (k.metadata) out.push(k.metadata);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < max);
  return out;
}

/** "uuid:1a2b3c4d chunk:12" → "chunk:12" — the Analytics Engine copy of a note. */
export function stripTransferId(detail) {
  return String(detail ?? '').replace(/uuid:[0-9a-f]{8}\s*/gi, '').trim();
}

/**
 * Append one server-observed error. Never throws — callers fire-and-forget via
 * ctx.waitUntil(). A KV failure is logged to console and swallowed.
 */
export async function appendClientError(env, { status, endpoint, path, method, errorMsg } = {}) {
  if (!env.STATUS_KV) return;
  const nowMs = Date.now();
  const entry = {
    ts:       Math.floor(nowMs / 1000),
    status:   Number(status) || 0,
    endpoint: typeof endpoint === 'string' ? endpoint : 'unknown',
    path:     typeof path === 'string' ? scrubUuids(path).slice(0, 256) : '',
    method:   typeof method === 'string' ? method : '',
    msg:      typeof errorMsg === 'string' && errorMsg ? scrubUuids(errorMsg).slice(0, 200) : '',
  };
  try {
    await putEntry(env, LOG_PREFIX, entry, nowMs);
  } catch (e) {
    console.error('appendClientError KV write failed:', e);
  }
}

/** Append one browser-reported note (already shape-checked by handleLogError). Never throws. */
export async function appendErrorNote(env, { context, message, detail } = {}) {
  if (!env.STATUS_KV) return;
  const nowMs = Date.now();
  try {
    await putEntry(env, NOTE_PREFIX, {
      ts_ms:   nowMs,
      context: String(context ?? '').slice(0, 64),
      message: String(message ?? '').slice(0, 200),
      detail:  String(detail ?? '').slice(0, 200),
    }, nowMs);
  } catch (e) {
    console.error('appendErrorNote KV write failed:', e);
  }
}

/** Newest-first browser notes from the last day, in the shape Navy Office reads. */
export async function readErrorNotes(env, max = 100) {
  if (!env.STATUS_KV) return [];
  const rows = await listEntries(env, NOTE_PREFIX, max);
  return rows.map(r => ({
    ts:      r.ts_ms ? new Date(r.ts_ms).toISOString() : null,
    context: r.context ?? '',
    message: r.message ?? '',
    detail:  r.detail  ?? '',
  }));
}

/**
 * GET /admin/client-errors-log — X-Admin-Key gated. Returns the last day's log,
 * newest-first, plus a small summary the modal can render without recomputing.
 */
export async function handleClientErrorsLog(request, env) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let log;
  try {
    log = await listEntries(env, LOG_PREFIX, MAX_ENTRIES);
    await env.STATUS_KV.delete(LEGACY_KEY);
  } catch (e) {
    console.error('client-errors-log KV read failed:', e);
    return new Response(JSON.stringify({ error: 'Failed to read error log' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cheap rollups for the card/badge.
  let count4xx = 0, count5xx = 0;
  for (const e of log) {
    if (e.status >= 500) count5xx++;
    else if (e.status >= 400) count4xx++;
  }

  return new Response(JSON.stringify({
    source:      'server_observed_kv',
    window_days: 1,
    total:       log.length,
    max_entries: MAX_ENTRIES,
    oldest_ts:   log.length ? log[log.length - 1].ts : null,
    count_4xx:   count4xx,
    count_5xx:   count5xx,
    entries:     log,
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
