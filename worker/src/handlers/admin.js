/* eslint-disable no-undef, no-use-before-define */
// ─────────────────────────────────────────────────────────────────────────────
// Admin handlers — extracted from index.js (SW2b)
//
// Handles:
//   POST /admin/status       — Dragon state write (KV)
//   GET  /admin/metrics      — Supabase subscriber + Cashu metrics
//   GET  /admin/ae-metrics   — Analytics Engine SQL queries
//   GET  /admin/snapshot     — KPI summary (metrics + AE combined)
//
// All routes are X-Admin-Key protected.
// supabaseFetch, json, err are module-local — same implementations as index.js.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Module-local response helpers
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
// Supabase fetch
// ─────────────────────────────────────────────────────────────────────────────
async function supabaseFetch(env, method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${env.SUPABASE_URL}${path}`, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin status — POST /admin/status
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminStatus(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const validStates = ['operational', 'degraded', 'maintenance'];
  if (body.state !== undefined && !validStates.includes(body.state)) {
    return err(400, `Invalid state. Must be one of: ${validStates.join(', ')}`);
  }

  // S71: validate lightning_available if present
  const validLightning = ['blink', 'true', 'false'];
  if (body.lightning_available !== undefined && !validLightning.includes(String(body.lightning_available))) {
    return err(400, `Invalid lightning_available. Must be one of: ${validLightning.join(', ')}`);
  }

  let current = null;
  try {
    current = await env.STATUS_KV.get('status:current', { type: 'json' });
  } catch {}

  if (!current) {
    current = {
      state:       'operational',
      message:     null,
      maintenance: null,
      incidents:   [],
      updated_at:  Math.floor(Date.now() / 1000),
    };
  }

  const bodyPatch = { ...body };
  if (bodyPatch.lightning_available !== undefined) {
    bodyPatch.lightning_available = String(bodyPatch.lightning_available) === 'true';
  }
  const updated = {
    ...current,
    ...bodyPatch,
    updated_at: Math.floor(Date.now() / 1000),
  };

  try {
    await env.STATUS_KV.put('status:current', JSON.stringify(updated));
  } catch (e) {
    console.error('KV write error:', e);
    return err(502, 'Failed to write status to KV');
  }

  return json({ ok: true, status: updated });
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin metrics — GET /admin/metrics
// X-Admin-Key protected.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminMetrics(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');
  const [data, aeData] = await Promise.all([
    fetchMetricsData(env),
    fetchAeMetricsData(env),
  ]);
  if (data._error) return err(data._status ?? 500, data._error);

  const issByTier = aeData?.credential_issuances_by_tier;
  if (issByTier && !aeData?.credential_issuances_note) {
    const totalIssuances = (issByTier.free ?? 0) + (issByTier.creative ?? 0) + (issByTier.max ?? 0);
    data.free_to_paid_conversion_rate = totalIssuances > 0
      ? parseFloat((data.paid_total / totalIssuances * 100).toFixed(2))
      : null;
    data.free_to_paid_conversion_issuances_30d = totalIssuances;
    data.free_to_paid_conversion_note =
      'Snapshot rate: active paid subscribers now ÷ total credential issuances last 30d. ' +
      'Under-counts if issuances span >30d before conversion. ' +
      'True cohort rate deferred to B9 (requires issuance→subscriber ETL).';
  } else {
    data.free_to_paid_conversion_rate = null;
    data.free_to_paid_conversion_issuances_30d = null;
    data.free_to_paid_conversion_note =
      aeData?.credential_issuances_note
        ? `AE issuances unavailable: ${aeData.credential_issuances_note}`
        : 'AE credential_issuances_by_tier not available.';
  }

  return json(data);
}

async function fetchMetricsData(env) {
  const TIER_MRR = { creative: 12, max: 24 };

  try {
    const countRes = await supabaseFetch(env, 'GET', '/rest/v1/subscribers?status=eq.active&select=tier');
    if (!countRes.ok) return err(502, 'Database unavailable');
    const activeRows = await countRes.json();

    const subscribersByTier = { free: 0, creative: 0, max: 0 };
    for (const row of activeRows) {
      const t = row.tier ?? 'free';
      subscribersByTier[t] = (subscribersByTier[t] ?? 0) + 1;
    }

    const mrrGbp =
      (subscribersByTier.creative ?? 0) * TIER_MRR.creative +
      (subscribersByTier.max      ?? 0) * TIER_MRR.max;

    const paidTotal = (subscribersByTier.creative ?? 0) + (subscribersByTier.max ?? 0);

    const now          = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const churnRes = await supabaseFetch(
      env, 'GET',
      `/rest/v1/subscribers?status=eq.cancelled&cancelled_at=gte.${encodeURIComponent(startOfMonth)}&select=stripe_customer_id`
    );
    if (!churnRes.ok) return err(502, 'Database unavailable');
    const cancelledMtd = (await churnRes.json()).length;

    const activeStartOfMonth = paidTotal + cancelledMtd;
    const churnRateMtd = activeStartOfMonth > 0
      ? parseFloat(((cancelledMtd / activeStartOfMonth) * 100).toFixed(2))
      : 0;

    const parseSbCount = (res) => {
      const cr = res.headers.get('Content-Range') ?? '';
      const m  = cr.match(/\/(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    };

    const [meltsRes, attemptsRes] = await Promise.all([
      supabaseFetch(env, 'GET', '/rest/v1/spent_tokens?select=serial',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
      supabaseFetch(env, 'GET', '/rest/v1/double_spend_attempts?select=id',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
    ]);

    const totalMelts    = meltsRes.ok    ? parseSbCount(meltsRes)    : null;
    const totalAttempts = attemptsRes.ok ? parseSbCount(attemptsRes) : null;

    let credentialUniquenessRate = null;
    let credentialUniquenessNote;

    if (totalMelts !== null && totalAttempts !== null) {
      const total = totalMelts + totalAttempts;
      credentialUniquenessRate = total > 0
        ? parseFloat((totalMelts / total).toFixed(4))
        : 1.0;
      credentialUniquenessNote =
        'Fraction of credential uses that were first-time (legitimate) melts. ' +
        '1.0 = no replay attacks observed. Excludes attacks failing verifyCredential() ' +
        'before the spent_tokens lookup (those return 401, not 409, and are not captured here).';
    } else {
      credentialUniquenessNote = 'Supabase count query failed — both spent_tokens and double_spend_attempts counts required.';
    }

    return {
      as_of: new Date().toISOString(),
      mrr_gbp: mrrGbp,
      mrr_note: 'Conservative floor: monthly plan prices used for all tiers. Yearly subscribers (£120/yr creative, £240/yr max) are under-counted by £2–4/mo each. Accurate MRR requires Stripe API interval lookup (dashboard layer, S22).',
      subscribers_by_tier: subscribersByTier,
      paid_total: paidTotal,
      churn_rate_mtd_pct: churnRateMtd,
      cancelled_mtd: cancelledMtd,
      active_start_of_month_approx: activeStartOfMonth,
      churn_note: 'Approximation: active_now + cancelled_mtd. Under-counts if any subscriber signed up and cancelled within the current calendar month.',
      credential_issuances: null,
      credential_issuances_note: 'Requires Cloudflare AE SQL API (external REST call with account token). Computed in dashboard layer (S22).',
      credential_uniqueness_rate: credentialUniquenessRate,
      credential_uniqueness_total_melts: totalMelts,
      credential_uniqueness_total_attempts: totalAttempts,
      credential_uniqueness_note: credentialUniquenessNote,
      r2_bytes_uploaded: null,
      r2_bytes_purged: null,
      r2_storage_note: 'Both require Cloudflare AE SQL API (external REST, not Worker-callable). Uploaded bytes: sum(doubles[4]) WHERE blob1=upload AND doubles[2]=0. Purged bytes: not measurable until R2 event notifications wired to AE (B4). Computed in dashboard layer (S22).',
      r2_chunk_retrieval_success_rate: null,
      r2_chunk_retrieval_note: "Requires Cloudflare AE SQL API. Query: 1 - (countIf(blob3 != '') / count()) WHERE blob1='download'. Computed in dashboard layer (S22).",
      zk_verification_rate: null,
      zk_verification_note: "R2 manifests not enumerable in aggregate from Worker. blob4 now logs http_protocol on upload and credential_issue events (HQ1). AE SQL: countIf(blob4='HTTP/3')/count() WHERE blob1='upload'.",
    };

  } catch (e) {
    console.error('Metrics error:', e);
    return { _error: 'Metrics query failed', _status: 500 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin AE metrics — GET /admin/ae-metrics
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminAeMetrics(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');
  return json(await fetchAeMetricsData(env));
}

async function fetchAeMetricsData(env) {
  if (!env.CF_ACCOUNT_ID || !env.CF_AE_TOKEN) {
    return {
      error: 'CF_ACCOUNT_ID or CF_AE_TOKEN not set',
      credential_issuances_by_tier: null,
      r2_bytes_uploaded: null,
      r2_chunk_retrieval_success_rate: null,
    };
  }

  const AE_URL = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;

  async function aeQuery(sql) {
    const res = await fetch(AE_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_AE_TOKEN}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AE SQL error ${res.status}: ${text}`);
    }
    return res.json();
  }

  const [issuanceResult, uploadResult, downloadResult, latencyResult, errorRateResult, clientErrorsResult, clientErrorsDetailResult] = await Promise.allSettled([

    aeQuery(`
      SELECT blob2 AS tier, count() AS issued
      FROM share_events
      WHERE blob1 = 'credential_issue'
      AND timestamp > NOW() - INTERVAL '30' DAY
      GROUP BY tier
    `),

    aeQuery(`
      SELECT sum(double5) AS total_bytes_uploaded
      FROM share_events
      WHERE blob1 = 'upload'
      AND double3 = 0
      AND timestamp > NOW() - INTERVAL '90' DAY
    `),

    aeQuery(`
      SELECT
        countIf(double2 = 200) AS successful_chunks,
        count() AS total_chunks,
        countIf(double2 = 200) / count() AS success_rate
      FROM share_events
      WHERE blob1 = 'download'
      AND timestamp > NOW() - INTERVAL '1' DAY
    `),

    aeQuery(`
      SELECT
        blob1 AS endpoint,
        quantile(0.95)(double1) AS p95_ms,
        quantile(0.99)(double1) AS p99_ms,
        count() AS requests
      FROM share_events
      WHERE timestamp > NOW() - INTERVAL '1' DAY
      GROUP BY endpoint
      ORDER BY p95_ms DESC
    `),

    aeQuery(`
      SELECT
        blob1 AS endpoint,
        countIf(double2 >= 500) AS error_count,
        count() AS total_count,
        countIf(double2 >= 500) / count() AS error_rate
      FROM share_events
      WHERE timestamp > NOW() - INTERVAL '1' DAY
      GROUP BY endpoint
      ORDER BY error_rate DESC
    `),

    aeQuery(`
      SELECT count() AS error_count
      FROM share_events
      WHERE blob1 = 'client_error'
      AND timestamp > NOW() - INTERVAL '1' DAY
    `),

    aeQuery(`
      SELECT
        blob2 AS context,
        blob3 AS message,
        blob4 AS detail,
        double1 AS ts_ms
      FROM share_events
      WHERE blob1 = 'client_error'
      AND timestamp > NOW() - INTERVAL '1' DAY
      ORDER BY ts_ms DESC
      LIMIT 20
    `),
  ]);

  let credentialIssuancesByTier = null;
  let credentialIssuancesNote = null;
  if (issuanceResult.status === 'fulfilled') {
    const rows = issuanceResult.value?.data ?? [];
    credentialIssuancesByTier = { free: 0, creative: 0, max: 0 };
    for (const row of rows) {
      const tier = row.tier ?? 'free';
      credentialIssuancesByTier[tier] = parseInt(row.issued ?? 0, 10);
    }
  } else {
    credentialIssuancesNote = `AE query failed: ${issuanceResult.reason?.message}`;
  }

  let r2BytesUploaded = null;
  let r2BytesNote = null;
  if (uploadResult.status === 'fulfilled') {
    const rows = uploadResult.value?.data ?? [];
    r2BytesUploaded = parseFloat(rows[0]?.total_bytes_uploaded ?? 0);
  } else {
    r2BytesNote = `AE query failed: ${uploadResult.reason?.message}`;
  }

  let r2ChunkSuccessRate = null;
  let r2ChunkSuccessfulChunks = null;
  let r2ChunkTotalChunks = null;
  let r2ChunkNote = null;
  if (downloadResult.status === 'fulfilled') {
    const rows = downloadResult.value?.data ?? [];
    if (rows.length > 0) {
      r2ChunkSuccessRate        = parseFloat((rows[0]?.success_rate ?? 0).toFixed(4));
      r2ChunkSuccessfulChunks   = parseInt(rows[0]?.successful_chunks ?? 0, 10);
      r2ChunkTotalChunks        = parseInt(rows[0]?.total_chunks ?? 0, 10);
    } else {
      r2ChunkSuccessRate      = null;
      r2ChunkNote             = 'No download events in last 24h — rate unavailable';
    }
  } else {
    r2ChunkNote = `AE query failed: ${downloadResult.reason?.message}`;
  }

  let latencyByEndpoint = null;
  let latencyNote = null;
  if (latencyResult.status === 'fulfilled') {
    const rows = latencyResult.value?.data ?? [];
    latencyByEndpoint = {};
    for (const row of rows) {
      latencyByEndpoint[row.endpoint] = {
        p95_ms: parseFloat((row.p95_ms ?? 0).toFixed(1)),
        p99_ms: parseFloat((row.p99_ms ?? 0).toFixed(1)),
        requests: parseInt(row.requests ?? 0, 10),
      };
    }
    if (rows.length === 0) latencyNote = 'No events in last 24h';
  } else {
    latencyNote = `AE query failed: ${latencyResult.reason?.message}`;
  }

  let errorRateByEndpoint = null;
  let errorRateNote = null;
  if (errorRateResult.status === 'fulfilled') {
    const rows = errorRateResult.value?.data ?? [];
    errorRateByEndpoint = {};
    for (const row of rows) {
      errorRateByEndpoint[row.endpoint] = {
        error_count: parseInt(row.error_count ?? 0, 10),
        total_count: parseInt(row.total_count ?? 0, 10),
        error_rate: parseFloat((row.error_rate ?? 0).toFixed(4)),
      };
    }
    if (rows.length === 0) errorRateNote = 'No events in last 24h';
  } else {
    errorRateNote = `AE query failed: ${errorRateResult.reason?.message}`;
  }

  let clientErrors24h = null;
  let clientErrorsNote = null;
  if (clientErrorsResult.status === 'fulfilled') {
    const rows = clientErrorsResult.value?.data ?? [];
    clientErrors24h = parseInt(rows[0]?.error_count ?? 0, 10);
  } else {
    clientErrorsNote = `AE query failed: ${clientErrorsResult.reason?.message}`;
  }

  let clientErrorsDetail = null;
  if (clientErrorsDetailResult.status === 'fulfilled') {
    const rows = clientErrorsDetailResult.value?.data ?? [];
    clientErrorsDetail = rows.map(r => ({
      ts:      r.ts_ms ? new Date(r.ts_ms).toISOString() : null,
      context: r.context ?? '',
      message: r.message ?? '',
      detail:  r.detail  ?? '',
    }));
  }

  return {
    as_of: new Date().toISOString(),
    window_notes: {
      credential_issuances: 'Rolling 30 days',
      r2_bytes_uploaded: 'Rolling 90 days (chunk-0 events only; total_bytes logged on first chunk per transfer)',
      r2_chunk_retrieval_success_rate: 'Rolling 24 hours',
      latency: 'Rolling 24 hours — p95/p99 per endpoint',
      error_rate: 'Rolling 24 hours — 5xx / total per endpoint',
    },
    credential_issuances_by_tier: credentialIssuancesByTier,
    credential_issuances_note: credentialIssuancesNote,
    r2_bytes_uploaded: r2BytesUploaded,
    r2_bytes_purged: null,
    r2_bytes_note: r2BytesNote ?? 'r2_bytes_purged not measurable until R2 event notifications wired to AE (B4 scope)',
    r2_chunk_retrieval_success_rate: r2ChunkSuccessRate,
    r2_chunk_successful_chunks: r2ChunkSuccessfulChunks,
    r2_chunk_total_chunks: r2ChunkTotalChunks,
    r2_chunk_note: r2ChunkNote,
    latency_by_endpoint: latencyByEndpoint,
    latency_note: latencyNote,
    error_rate_by_endpoint: errorRateByEndpoint,
    error_rate_note: errorRateNote,
    client_errors_24h: clientErrors24h,
    client_errors_24h_note: clientErrorsNote,
    client_errors_detail: clientErrorsDetail,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin snapshot — GET /admin/snapshot
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAdminSnapshot(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  const [metrics, ae] = await Promise.all([
    fetchMetricsData(env),
    fetchAeMetricsData(env),
  ]);

  if (metrics._error) return err(metrics._status ?? 500, metrics._error);

  let workerErrorRate = null;
  const errs = ae.error_rate_by_endpoint;
  if (errs && !ae.error_rate_note) {
    let totalErrors = 0, totalReqs = 0;
    for (const ep of Object.values(errs)) {
      totalErrors += ep.error_count;
      totalReqs   += ep.total_count;
    }
    workerErrorRate = totalReqs > 0
      ? parseFloat((totalErrors / totalReqs).toFixed(4))
      : 0;
  }

  const snapshot = {
    generated_at:             new Date().toISOString(),
    mrr_gbp:                  metrics.mrr_gbp ?? null,
    paid_subscribers:         metrics.paid_total ?? null,
    credential_uniqueness_rate: metrics.credential_uniqueness_rate ?? null,
    p95_upload_latency_ms:    ae.latency_by_endpoint?.upload?.p95_ms ?? null,
    p95_download_latency_ms:  ae.latency_by_endpoint?.download?.p95_ms ?? null,
    worker_error_rate:        workerErrorRate,
  };

  return json(snapshot);
}
