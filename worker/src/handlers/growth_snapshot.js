// worker/src/handlers/growth_snapshot.js
//
// GET /admin/growth-snapshot?range=D|W|M|Y — Navy Office growth-signal source.
//
// Feeds the three auto-populated lines on the growth chart. The honest unit is
// CREDENTIALS ISSUED per tier, not "users":
//   · Pro Bono (free) is anonymous by design — there are no accounts to count.
//     Its line is credentials issued (≈ upload sessions). Labelled as such.
//   · Paid  = Citizen + Sovereign  (wire tiers 'creative' + 'max').
//   · API   = Chartered            (wire tier 'api').
//
// Source is Analytics Engine only (Share-B10-1, operator choice). Cloudflare AE
// retains ~90 days of raw events, so the 'Y' range is truncated to the retained
// window and flagged truncated:true — there is no year of history to draw.
//
// "Cumulative" is cumulative FROM THE START OF THE RETAINED WINDOW, since no
// pre-window baseline exists in AE. Each bucket carries both the per-bucket new
// count and the running cumulative, so the frontend can plot either; the B10
// spec plots cumulative.
//
// AE schema (index.js logEvent): blob1 endpoint · blob2 tier · double2 status.
// A successful issuance is blob1='credential_issue' AND double2=200. The tier
// blob also carries non-tier sentinels on failure paths ('rate_limited',
// 'resume_rejected', 'unknown'); we map only the three real tier buckets and
// drop the rest.
//
// AE SQL is a ClickHouse subset. toStartOfInterval(timestamp, INTERVAL 'n' UNIT)
// is supported and is how we bucket. If a future AE change rejects it, queryAE
// returns null and the endpoint answers { ae_available:false } — the card then
// shows an honest empty state rather than breaking.

// Range → { window: SQL interval, bucketUnit, bucketSeconds, truncated }.
// bucketSeconds is used to synthesise empty leading buckets client-independently
// is NOT done here — we return only buckets AE actually has, ascending.
const RANGES = {
  D: { windowQty: 1,  windowUnit: 'DAY', bucketQty: 1, bucketUnit: 'HOUR', truncated: false },
  W: { windowQty: 7,  windowUnit: 'DAY', bucketQty: 1, bucketUnit: 'DAY',  truncated: false },
  M: { windowQty: 30, windowUnit: 'DAY', bucketQty: 1, bucketUnit: 'DAY',  truncated: false },
  // AE retention is ~90d; a true year is unavailable. Truncate + flag.
  Y: { windowQty: 90, windowUnit: 'DAY', bucketQty: 1, bucketUnit: 'DAY',  truncated: true },
};

const RETENTION_DAYS = 90;

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

// tier blob → chart line. Returns 'free' | 'paid' | 'api' | null (drop).
function lineForTier(tier) {
  switch (tier) {
    case 'free':               return 'free';
    case 'creative': case 'max': return 'paid';
    case 'api':                return 'api';
    default:                   return null; // rate_limited / resume_rejected / unknown
  }
}

// POST one SQL statement to the AE SQL API. Returns row array, or null if it
// cannot run (missing creds / non-200 / parse failure). Mirrors api_stats.js.
async function queryAE(env, sql) {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${env.CF_AE_TOKEN}`, 'Content-Type': 'text/plain' },
        body:    sql,
      },
    );
    if (!res.ok) {
      console.error('growth-snapshot AE query non-200:', res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
  } catch (e) {
    console.error('growth-snapshot AE query failed:', e);
    return null;
  }
}

// AE returns the bucket column as a datetime string (e.g. '2026-09-01 00:00:00').
// Parse to unix seconds. Treat the naive datetime as UTC.
function bucketToUnix(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(' ', 'T');
  const iso = /Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// handleGrowthSnapshot — GET /admin/growth-snapshot
// ─────────────────────────────────────────────────────────────────────────────
export async function handleGrowthSnapshot(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised.');
  }

  const url = new URL(request.url);
  const rangeKey = (url.searchParams.get('range') || 'M').toUpperCase();
  const range = RANGES[rangeKey] || RANGES.M;

  const sql =
    `SELECT toStartOfInterval(timestamp, INTERVAL '${range.bucketQty}' ${range.bucketUnit}) AS bucket, ` +
    `blob2 AS tier, count() AS n ` +
    `FROM share_events ` +
    `WHERE blob1 = 'credential_issue' AND double2 = 200 ` +
    `AND timestamp > NOW() - INTERVAL '${range.windowQty}' ${range.windowUnit} ` +
    `GROUP BY bucket, tier ORDER BY bucket ASC`;

  const rows = await queryAE(env, sql);

  const base = {
    generated_at:   Math.floor(Date.now() / 1000),
    range:          rangeKey in RANGES ? rangeKey : 'M',
    bucket:         range.bucketUnit.toLowerCase(),
    truncated:      range.truncated,
    retention_days: RETENTION_DAYS,
    unit:           'credentials_issued',
    note:
      'Cumulative credentials issued per tier, from the start of the retained ' +
      'Analytics Engine window (~90 days). Free = Pro Bono credentials issued ' +
      '(anonymous — no accounts). Paid = Citizen + Sovereign. API = Chartered.' +
      (range.truncated
        ? ' Year view is truncated to the ~90-day AE retention window.'
        : ''),
  };

  if (rows === null) {
    return json({ ...base, ae_available: false, series: [] });
  }

  // Fold rows into a per-bucket map { t → { free, paid, api } } of NEW counts.
  const buckets = new Map(); // key: unix seconds
  for (const row of rows) {
    const t = bucketToUnix(row.bucket);
    if (t === null) continue;
    const line = lineForTier(row.tier);
    if (!line) continue;
    const n = Number(row.n) || 0;
    let rec = buckets.get(t);
    if (!rec) { rec = { free: 0, paid: 0, api: 0 }; buckets.set(t, rec); }
    rec[line] += n;
  }

  // Ascending buckets → running cumulative.
  const sortedTs = [...buckets.keys()].sort((a, b) => a - b);
  let cf = 0, cp = 0, ca = 0;
  const series = sortedTs.map((t) => {
    const rec = buckets.get(t);
    cf += rec.free; cp += rec.paid; ca += rec.api;
    return {
      t,
      free: rec.free, paid: rec.paid, api: rec.api,   // new in this bucket
      free_cum: cf,   paid_cum: cp,   api_cum: ca,     // cumulative within window
    };
  });

  return json({
    ...base,
    ae_available: true,
    totals: { free: cf, paid: cp, api: ca }, // cumulative within window
    series,
  });
}
