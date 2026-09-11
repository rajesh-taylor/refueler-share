/**
 * lightning.js — Refueler Share Lightning payment adapter
 *
 * B7 migration seam. All Lightning backend calls route through this module.
 * Nothing else in the Worker calls LNbits directly.
 *
 * Exports:
 *   createInvoice({ tier, period, amountSats, expirySeconds }, env)
 *     → { bolt11, paymentHash, expiresAt }
 *
 *   getInvoiceStatus({ paymentHash }, env)
 *     → { settled: boolean, tier: string, period: string } | null
 *
 * Backend routing: env.LIGHTNING_BACKEND (default: 'lnbits')
 * Blink is dead (discontinued UK custodial accounts Aug 2026). Its functions
 * are tombstoned below — do not re-enable.
 */

// ---------------------------------------------------------------------------
// Blink — TOMBSTONED (discontinued Aug 2026, do not re-enable)
// ---------------------------------------------------------------------------

async function blinkCreateInvoice(_params, _env) {
  throw new Error('Blink backend discontinued Aug 2026 — use lnbits');
}

async function blinkGetInvoiceStatus(_params, _env) {
  throw new Error('Blink backend discontinued Aug 2026 — use lnbits');
}

// ---------------------------------------------------------------------------
// LNbits — createInvoice
//
// POST {LNBITS_URL}/api/v1/payments
// Headers: X-API-KEY: {LNBITS_API_KEY}
// Body:    { out: false, amount: amountSats, memo, expiry: expirySeconds }
// Returns: { payment_hash, payment_request }
//
// KV record keyed by payment_hash:
//   { tier, period, settled: false, created_at }
//   TTL: 25 hours — outlives the invoice; provides lookup window for webhooks.
// ---------------------------------------------------------------------------

async function lnbitsCreateInvoice({ tier, period, amountSats, expirySeconds }, env) {
  if (!env.LNBITS_URL || !env.LNBITS_API_KEY) {
    throw new Error('LNBITS_URL and LNBITS_API_KEY must be set as Worker secrets');
  }

  const memo = `Refueler Share — ${tier} ${period}`;

  const body = JSON.stringify({
    out:    false,
    amount: amountSats,
    memo,
    expiry: expirySeconds,
  });

  let response;
  try {
    response = await fetch(`${env.LNBITS_URL}/api/v1/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY':    env.LNBITS_API_KEY,
      },
      body,
    });
  } catch (e) {
    throw new Error(`LNbits network error on createInvoice: ${e.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LNbits createInvoice HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const { payment_hash: paymentHash, payment_request: bolt11 } = json;

  if (!paymentHash || !bolt11) {
    throw new Error('LNbits createInvoice: payment_hash or payment_request missing from response');
  }

  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

  // Persist { tier, period } keyed by paymentHash so getInvoiceStatus can
  // return them without a second LNbits call.
  // 25h TTL — invoice itself is shorter-lived, but we want the record to
  // outlive polling and the LNbits webhook delivery window.
  await env.STATUS_KV.put(
    `lightning:invoice:${paymentHash}`,
    JSON.stringify({ tier, period, settled: false, created_at: new Date().toISOString() }),
    { expirationTtl: 90000 }, // 25 hours
  );

  return { bolt11, paymentHash, expiresAt };
}

// ---------------------------------------------------------------------------
// LNbits — getInvoiceStatus
//
// GET {LNBITS_URL}/api/v1/payments/{payment_hash}
// Headers: X-API-KEY: {LNBITS_API_KEY}
// Returns: { paid: boolean, ... }
//
// Returns null if the KV record is missing (unknown hash or TTL expired).
// Returns null if LNbits 404s the hash (invoice not found on node).
// ---------------------------------------------------------------------------

async function lnbitsGetInvoiceStatus({ paymentHash }, env) {
  if (!env.LNBITS_URL || !env.LNBITS_API_KEY) {
    throw new Error('LNBITS_URL and LNBITS_API_KEY must be set as Worker secrets');
  }

  // Retrieve stored tier/period — written at createInvoice time.
  const stored = await env.STATUS_KV.get(`lightning:invoice:${paymentHash}`, 'json');
  if (!stored) {
    // Unknown payment hash — not created by this Worker, or TTL expired.
    return null;
  }

  let response;
  try {
    response = await fetch(`${env.LNBITS_URL}/api/v1/payments/${encodeURIComponent(paymentHash)}`, {
      method:  'GET',
      headers: { 'X-API-KEY': env.LNBITS_API_KEY },
    });
  } catch (e) {
    throw new Error(`LNbits network error on getInvoiceStatus: ${e.message}`);
  }

  if (response.status === 404) {
    // LNbits doesn't know this hash — treat as not found.
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LNbits getInvoiceStatus HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();

  // LNbits payment object: { paid: boolean, ... }
  const settled = json.paid === true;

  return {
    settled,
    tier:   stored.tier,
    period: stored.period,
  };
}

// ---------------------------------------------------------------------------
// Public exports — backend routing
// ---------------------------------------------------------------------------

/**
 * createInvoice
 * @param {{ tier: string, period: string, amountSats: number, expirySeconds: number }} params
 * @param {object} env — Cloudflare Worker env bindings
 * @returns {{ bolt11: string, paymentHash: string, expiresAt: string }}
 */
export async function createInvoice(params, env) {
  const backend = env.LIGHTNING_BACKEND ?? 'lnbits';

  switch (backend) {
    case 'lnbits':
      return lnbitsCreateInvoice(params, env);
    case 'blink':
      return blinkCreateInvoice(params, env);
    default:
      throw new Error(
        `Unknown LIGHTNING_BACKEND: "${backend}". Valid value: "lnbits"`,
      );
  }
}

/**
 * getInvoiceStatus
 * @param {{ paymentHash: string }} params
 * @param {object} env — Cloudflare Worker env bindings
 * @returns {{ settled: boolean, tier: string, period: string } | null}
 */
export async function getInvoiceStatus(params, env) {
  const backend = env.LIGHTNING_BACKEND ?? 'lnbits';

  switch (backend) {
    case 'lnbits':
      return lnbitsGetInvoiceStatus(params, env);
    case 'blink':
      return blinkGetInvoiceStatus(params, env);
    default:
      throw new Error(
        `Unknown LIGHTNING_BACKEND: "${backend}". Valid value: "lnbits"`,
      );
  }
}
