/**
 * lightning-routes.js — HTTP handlers for Lightning payment endpoints  (S75)
 *
 * Self-contained: no dependency on blake3-wasm, so Vitest can import this
 * file directly without the ESM-WASM loader error.
 *
 * Exports:
 *   handleLightningCreate(request, env, deps)
 *   handleLightningStatus(request, env, deps)
 *   handleLightningWebhook(request, env, deps)
 *   fetchBtcGbpRate(fetchFn?)   ← exported for test mocking
 *
 * deps = { verifyTurnstileToken, issueBlindSignature, createInvoice,
 *           getInvoiceStatus, checkRateLimit, getClientIp,
 *           rateLimitResponse, logEvent, corsHeaders }
 *
 * index.js passes its own imported locals as deps.
 */

const VALID_TIERS   = new Set(['creative', 'max']);
const VALID_PERIODS = new Set(['monthly', 'yearly']);
const INVOICE_EXPIRY_SECONDS = 86400; // 24 hours

function resolveGbpPrice(tier, period, env) {
  const key = `PRICE_${tier.toUpperCase()}_${period.toUpperCase()}_GBP`;
  const raw = env[key];
  if (!raw) throw new Error(`Missing env var: ${key}`);
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0) throw new Error(`Invalid price in ${key}: "${raw}"`);
  return parsed;
}

export async function fetchBtcGbpRate(fetchFn = fetch) {
  const resp = await fetchFn(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp',
    { headers: { Accept: 'application/json' } }
  );
  if (!resp.ok) throw new Error(`CoinGecko fetch failed: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  const rate = data?.bitcoin?.gbp;
  if (typeof rate !== 'number' || rate < 1000) {
    throw new Error(`Implausible BTC/GBP rate from CoinGecko: ${rate}`);
  }
  return rate;
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errResp(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// POST /subscription/lightning
// ---------------------------------------------------------------------------
export async function handleLightningCreate(request, env, deps) {
  const {
    verifyTurnstileToken, createInvoice,
    checkRateLimit, getClientIp, rateLimitResponse, logEvent, corsHeaders,
  } = deps;

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, ip, 'credential_issue', 10, 60);
  if (rl.limited) {
    logEvent(env, { endpoint: 'lightning_create', status: 429, latency: 0 });
    return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
  }

  let body;
  try { body = await request.json(); }
  catch { return errResp(400, 'Invalid JSON body'); }

  const { tier, period, turnstileToken } = body ?? {};

  if (!VALID_TIERS.has(tier)) {
    return errResp(400, `Invalid tier. Must be one of: ${[...VALID_TIERS].join(', ')}`);
  }
  if (!VALID_PERIODS.has(period)) {
    return errResp(400, `Invalid period. Must be one of: ${[...VALID_PERIODS].join(', ')}`);
  }
  if (!turnstileToken || typeof turnstileToken !== 'string') {
    return errResp(400, 'Turnstile token required');
  }

  // Validate Turnstile BEFORE any Blink call — fail closed.
  const tsOk = await verifyTurnstileToken(turnstileToken, env.TURNSTILE_SECRET_KEY);
  if (!tsOk) {
    logEvent(env, { endpoint: 'lightning_create', status: 403, latency: 0, errorMsg: 'turnstile_failed' });
    return errResp(403, 'Turnstile validation failed');
  }

  let gbpPrice, btcPerGbp, amountSats;
  try {
    gbpPrice   = resolveGbpPrice(tier, period, env);
    btcPerGbp  = await fetchBtcGbpRate();
    amountSats = Math.ceil((gbpPrice / btcPerGbp) * 1e8);
  } catch (e) {
    console.error('Lightning price error:', e);
    logEvent(env, { endpoint: 'lightning_create', status: 502, latency: 0, errorMsg: 'price_fetch_failed' });
    return errResp(502, 'Failed to compute invoice amount');
  }

  let invoice;
  try {
    invoice = await createInvoice({ tier, period, amountSats, expirySeconds: INVOICE_EXPIRY_SECONDS }, env);
  } catch (e) {
    console.error('Lightning invoice error:', e);
    logEvent(env, { endpoint: 'lightning_create', status: 502, latency: 0, errorMsg: 'blink_invoice_failed' });
    return errResp(502, 'Failed to create Lightning invoice');
  }

  logEvent(env, { endpoint: 'lightning_create', tier, status: 200, latency: 0 });

  return jsonResp({
    bolt11:      invoice.bolt11,
    paymentHash: invoice.paymentHash,
    expiresAt:   invoice.expiresAt,
    amountSats,
    btcPerGbp,
  });
}

// ---------------------------------------------------------------------------
// GET /subscription/lightning/status?hash={paymentHash}
// ---------------------------------------------------------------------------
export async function handleLightningStatus(request, env, deps) {
  const {
    getInvoiceStatus,
    checkRateLimit, getClientIp, rateLimitResponse, logEvent, corsHeaders,
  } = deps;

  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, ip, 'auth', 5, 60);
  if (rl.limited) return rateLimitResponse(request, rl.resetAt, corsHeaders(request));

  const url  = new URL(request.url);
  const hash = url.searchParams.get('hash');

  if (!hash || typeof hash !== 'string' || hash.length < 10) {
    return errResp(400, 'Missing or invalid hash parameter');
  }

  let result;
  try {
    result = await getInvoiceStatus({ paymentHash: hash }, env);
  } catch (e) {
    console.error('Lightning status error:', e);
    logEvent(env, { endpoint: 'lightning_status', status: 502, latency: 0, errorMsg: 'status_fetch_failed' });
    return errResp(502, 'Failed to check invoice status');
  }

  if (result === null) return errResp(404, 'Payment hash not found');

  return jsonResp({ settled: result.settled, tier: result.tier, period: result.period });
}

// ---------------------------------------------------------------------------
// POST /webhook/lightning
// Always returns 200. Dedup via settled: true KV flag.
// ---------------------------------------------------------------------------
export async function handleLightningWebhook(request, env, deps) {
  const { issueBlindSignature, logEvent } = deps;

  let body;
  try { body = await request.json(); }
  catch {
    logEvent(env, { endpoint: 'lightning_webhook', status: 200, latency: 0, errorMsg: 'malformed_body' });
    return new Response('ok', { status: 200 });
  }

  const paymentHash = body?.paymentHash ?? body?.payment_hash;

  if (!paymentHash || typeof paymentHash !== 'string') {
    logEvent(env, { endpoint: 'lightning_webhook', status: 200, latency: 0, errorMsg: 'missing_hash' });
    return new Response('ok', { status: 200 });
  }

  const kvKey = `lightning:invoice:${paymentHash}`;
  let stored;
  try {
    stored = await env.STATUS_KV.get(kvKey, 'json');
  } catch (e) {
    console.error('Lightning webhook KV read error:', e);
    return new Response('ok', { status: 200 });
  }

  if (!stored) {
    logEvent(env, { endpoint: 'lightning_webhook', status: 200, latency: 0, errorMsg: 'unknown_hash' });
    return new Response('ok', { status: 200 });
  }

  if (stored.settled === true) {
    logEvent(env, { endpoint: 'lightning_webhook', status: 200, latency: 0, errorMsg: 'duplicate' });
    return new Response('ok', { status: 200 });
  }

  const { tier, period } = stored;

  // B7: paymentHash used as surrogate blinded_message.
  // Full NUT-00 client round-trip deferred to Silent Drop block.
  let signedPoint, mintPubkey;
  let credentialIssued = false;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(
      paymentHash.slice(0, 64),
      env.MINT_PRIVATE_KEY
    ));
    credentialIssued = true;
  } catch (e) {
    console.error('Lightning credential issuance error:', e);
    // Fall through — still mark settled to prevent double-issuance on retry
  }

  if (credentialIssued) {
    try {
      await env.STATUS_KV.put(
        `lightning:credential:${paymentHash}`,
        JSON.stringify({ signed_point: signedPoint, mint_pubkey: mintPubkey, tier, period, issued_at: new Date().toISOString() }),
        { expirationTtl: 600 }
      );
    } catch (e) {
      console.error('Lightning credential KV write error:', e);
    }
  }

  try {
    await env.STATUS_KV.put(
      kvKey,
      JSON.stringify({ ...stored, settled: true, settled_at: new Date().toISOString() }),
      { expirationTtl: 90000 }
    );
  } catch (e) {
    console.error('Lightning settled KV write error:', e);
  }

  const createdAt = stored.created_at ? new Date(stored.created_at).getTime() : null;
  const latencyMs = createdAt ? Date.now() - createdAt : 0;

  logEvent(env, {
    endpoint: 'lightning_webhook',
    tier,
    status:   200,
    latency:  latencyMs,
    errorMsg: credentialIssued ? '' : 'credential_issue_failed',
  });

  return new Response('ok', { status: 200 });
}
