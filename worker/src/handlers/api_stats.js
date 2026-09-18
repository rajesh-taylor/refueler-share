/**
 * api_stats.js — GET /admin/api-stats
 * worker/src/handlers/api_stats.js
 *
 * Share-Dash-2. Feeds the Navy Office "API & MCP" card (replaces the CPU-time
 * stub). X-Admin-Key gated. Sources:
 *   · active API keys        — KV, prefix api_quota_  (one record per key)
 *   · requests 30d by rail   — AE share_events, GROUP BY tier → folded to rail
 *   · API attach rate        — AE, api-tier finalises ÷ all finalises (30d)
 *   · sandbox → live         — needs the sandbox KV shape (sandbox.js); returns
 *                              null + reason until wired, rather than a guess
 *
 * No paying Chartered client exists yet, so active_keys and attach_rate will
 * legitimately read 0 and the rail split will be empty. That is correct, not a
 * fault — the card shows honest empty states (Share-Dash-3).
 *
 * AE query goes through the Analytics Engine SQL API (env.CF_ACCOUNT_ID +
 * env.CF_AE_TOKEN, an Account Analytics Read token). If either is absent the
 * AE-derived blocks come back { ae_available:false } and the KV block still
 * answers — the card degrades one section at a time.
 *
 * AE schema (index.js §Analytics Engine):
 *   blob1 endpoint · blob2 tier · blob3 error_message · blob4 http_protocol
 *   double1 latency_ms · double2 status_code · … · double5 total_bytes
 */

const QUOTA_PREFIX = 'api_quota_';

// tier → internal rail (identity/anonymous). Pre-B7 every paid tier is identity;
// 'free' is Pro Bono and carries no rail. Matches finalise.js railForTier.
function railForTier(tier) {
  switch (tier) {
    case 'creative':
    case 'max':
    case 'api':  return 'identity';
    case 'free': return 'none';
    default:     return 'none';
  }
}

// POST one SQL statement to the AE SQL API. Returns an array of row objects, or
// null if the query cannot run (missing creds / non-200 / parse failure).
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
      console.error('api-stats AE query non-200:', res.status, await res.text());
      return null;
    }
    const body = await res.json();
    return Array.isArray(body?.data) ? body.data : [];
  } catch (e) {
    console.error('api-stats AE query failed:', e);
    return null;
  }
}

// ── Active API keys (KV, prefix api_quota_) ──────────────────────────────────
// One record per commercial key. We read each to report active-vs-total and a
// per-plan breakdown. Volume is tiny (no live clients yet); a full read is fine.
async function activeKeys(env) {
  const out = { provisioned: 0, active: 0, by_plan: {}, kv_available: true };
  try {
    let cursor;
    const names = [];
    do {
      const page = await env.STATUS_KV.list({ prefix: QUOTA_PREFIX, cursor });
      for (const k of page.keys) names.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    out.provisioned = names.length;
    for (const name of names) {
      let rec = null;
      try { rec = await env.STATUS_KV.get(name, { type: 'json' }); } catch { /* skip */ }
      if (!rec || typeof rec !== 'object') continue;
      const status = rec.status ?? 'active';
      const plan   = rec.plan   ?? 'unknown';
      if (status === 'active') out.active++;
      out.by_plan[plan] = (out.by_plan[plan] ?? 0) + 1;
    }
  } catch (e) {
    console.error('api-stats KV list failed:', e);
    out.kv_available = false;
  }
  return out;
}

export async function handleApiStats(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorised' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Requests in the last 30 days, grouped by tier then folded to rail ──────
  const byTier = await queryAE(
    env,
    "SELECT blob2 AS tier, count() AS n FROM share_events " +
    "WHERE timestamp > NOW() - INTERVAL '30' DAY GROUP BY tier",
  );

  let requests30d;
  if (byTier === null) {
    requests30d = { ae_available: false, by_rail: {}, total: 0 };
  } else {
    const by_rail = { identity: 0, anonymous: 0, none: 0 };
    let total = 0;
    for (const row of byTier) {
      const n = Number(row.n) || 0;
      by_rail[railForTier(row.tier)] += n;
      total += n;
    }
    requests30d = { ae_available: true, by_rail, total };
  }

  // ── API attach rate — api-tier finalises ÷ all finalises (30d) ─────────────
  // A completed transfer on the live path is a 200 upload_finalise. attach rate
  // is the share of those carrying the Chartered (api) tier.
  const finalises = await queryAE(
    env,
    "SELECT blob2 AS tier, count() AS n FROM share_events " +
    "WHERE blob1 = 'upload_finalise' AND double2 = 200 " +
    "AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY tier",
  );

  let attach;
  if (finalises === null) {
    attach = { ae_available: false, api_transfers: 0, total_transfers: 0, rate: null };
  } else {
    let apiN = 0, totalN = 0;
    for (const row of finalises) {
      const n = Number(row.n) || 0;
      totalN += n;
      if (row.tier === 'api') apiN += n;
    }
    attach = {
      ae_available:    true,
      api_transfers:   apiN,
      total_transfers: totalN,
      rate:            totalN > 0 ? apiN / totalN : null, // null = no transfers to divide
    };
  }

  // ── Sandbox → live conversion ──────────────────────────────────────────────
  // Not yet derivable here: the sandbox activation/conversion signal lives in
  // sandbox.js's KV records, whose shape this handler must not assume. Returned
  // as null with a reason so the card shows a pending state, not a wrong number.
  const sandboxToLive = {
    available: false,
    rate:      null,
    reason:    'sandbox KV signal not yet wired (needs sandbox.js record shape)',
  };

  return new Response(JSON.stringify({
    generated_at:      Math.floor(Date.now() / 1000),
    window_days:       30,
    active_keys:       await activeKeys(env),
    requests_30d:      requests30d,
    api_attach:        attach,
    sandbox_to_live:   sandboxToLive,
  }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
