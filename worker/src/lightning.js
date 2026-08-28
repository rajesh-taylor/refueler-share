/**
 * lightning.js — Refueler Share Lightning payment adapter
 *
 * B9 migration seam. All Lightning backend calls route through this module.
 * Nothing else in the Worker calls Blink or LNbits directly.
 *
 * Exports:
 *   createInvoice({ tier, period, amountSats, expirySeconds }, env)
 *     → { bolt11, paymentHash, expiresAt }
 *
 *   getInvoiceStatus({ paymentHash }, env)
 *     → { settled: boolean, tier: string, period: string } | null
 *
 * Backend routing: env.LIGHTNING_BACKEND (default: 'blink')
 * At B9: set LIGHTNING_BACKEND='lnbits', no other Worker code changes required.
 */

const BLINK_API_URL = 'https://api.blink.sv/graphql';

// ---------------------------------------------------------------------------
// Blink — createInvoice
// ---------------------------------------------------------------------------

const BLINK_CREATE_INVOICE_MUTATION = `
  mutation LnInvoiceCreate($input: LnInvoiceCreateInput!) {
    lnInvoiceCreate(input: $input) {
      invoice {
        paymentRequest
        paymentHash
      }
      errors {
        message
      }
    }
  }
`;

async function blinkCreateInvoice({ tier, period, amountSats, expirySeconds }, env) {
  const memo = `Refueler Share — ${tier} ${period}`;

  const body = JSON.stringify({
    query: BLINK_CREATE_INVOICE_MUTATION,
    variables: {
      input: {
        walletId: env.BLINK_WALLET_ID,
        amount: amountSats,
        memo,
        expiresIn: expirySeconds,
      },
    },
  });

  const response = await fetch(BLINK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': env.BLINK_API_KEY,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Blink API HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const result = json?.data?.lnInvoiceCreate;

  if (!result) {
    throw new Error('Blink createInvoice: unexpected response shape — lnInvoiceCreate missing');
  }

  if (result.errors && result.errors.length > 0) {
    const messages = result.errors.map((e) => e.message).join('; ');
    throw new Error(`Blink createInvoice error: ${messages}`);
  }

  const { paymentRequest: bolt11, paymentHash } = result.invoice;

  if (!bolt11 || !paymentHash) {
    throw new Error('Blink createInvoice: invoice fields missing from response');
  }

  const expiresAt = new Date(Date.now() + expirySeconds * 1000).toISOString();

  // Persist { tier, period } keyed by paymentHash so getInvoiceStatus can return them.
  // 25h TTL — invoice itself is shorter-lived, but we want the record to outlive polling.
  await env.STATUS_KV.put(
    `lightning:invoice:${paymentHash}`,
    JSON.stringify({ tier, period, settled: false, created_at: new Date().toISOString() }),
    { expirationTtl: 90000 }, // 25 hours
  );

  return { bolt11, paymentHash, expiresAt };
}

// ---------------------------------------------------------------------------
// Blink — getInvoiceStatus
// ---------------------------------------------------------------------------

const BLINK_GET_INVOICE_QUERY = `
  query LnInvoice($paymentHash: PaymentHash!) {
    lnInvoice(paymentHash: $paymentHash) {
      paymentHash
      paymentStatus
    }
  }
`;

async function blinkGetInvoiceStatus({ paymentHash }, env) {
  // Retrieve stored tier/period — written at createInvoice time.
  const stored = await env.STATUS_KV.get(`lightning:invoice:${paymentHash}`, 'json');
  if (!stored) {
    // Unknown payment hash — not created by this Worker, or TTL expired.
    return null;
  }

  const body = JSON.stringify({
    query: BLINK_GET_INVOICE_QUERY,
    variables: { paymentHash },
  });

  const response = await fetch(BLINK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': env.BLINK_API_KEY,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Blink API HTTP error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const invoice = json?.data?.lnInvoice;

  if (!invoice) {
    // Blink doesn't know this hash either — treat as not found.
    return null;
  }

  // Blink paymentStatus values: 'PENDING' | 'PAID' | 'EXPIRED'
  const settled = invoice.paymentStatus === 'PAID';

  return {
    settled,
    tier: stored.tier,
    period: stored.period,
  };
}

// ---------------------------------------------------------------------------
// LNbits stubs — wire at B9
// ---------------------------------------------------------------------------

async function lnbitsCreateInvoice(_params, _env) {
  // wire at B9 — POST /api/v1/payments
  throw new Error('LNbits backend not yet implemented');
}

async function lnbitsGetInvoiceStatus(_params, _env) {
  // wire at B9 — GET /api/v1/payments/{payment_hash}
  throw new Error('LNbits backend not yet implemented');
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
  const backend = env.LIGHTNING_BACKEND ?? 'blink';

  switch (backend) {
    case 'blink':
      return blinkCreateInvoice(params, env);
    case 'lnbits':
      return lnbitsCreateInvoice(params, env);
    default:
      throw new Error(
        `Unknown LIGHTNING_BACKEND: "${backend}". Valid values: "blink" | "lnbits"`,
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
  const backend = env.LIGHTNING_BACKEND ?? 'blink';

  switch (backend) {
    case 'blink':
      return blinkGetInvoiceStatus(params, env);
    case 'lnbits':
      return lnbitsGetInvoiceStatus(params, env);
    default:
      throw new Error(
        `Unknown LIGHTNING_BACKEND: "${backend}". Valid values: "blink" | "lnbits"`,
      );
  }
}
