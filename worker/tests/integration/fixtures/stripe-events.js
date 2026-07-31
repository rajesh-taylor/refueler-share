// worker/tests/integration/fixtures/stripe-events.js
// Stripe webhook payload factory — shared by Vitest integration tests and k6.
// Pure ESM. No vitest/node imports. Web Crypto only (available in k6 ≥ 0.43).
//
// Exports:
//   signStripePayload(eventJson)         — valid signature, current timestamp
//   signStripePayloadBadSig(eventJson)   — wrong HMAC, current timestamp
//   signStripePayloadStale(eventJson)    — valid HMAC, timestamp 400s in the past
//   makeSubscriptionUpdatedEvent(overrides)
//   makeSubscriptionDeletedEvent(overrides)
//   makeCheckoutCompletedEvent(overrides)
//
// The STRIPE_WEBHOOK_SECRET used here must match the env var in .dev.vars.
// For local integration tests this is the test value set in wrangler-lifecycle.js.

// Arbitrary value — only needs to be consistent within a test run.
// The four rejection tests (bad sig, stale, missing header, empty body) don't
// require matching the Worker's real secret; they test that wrong/missing creds
// are rejected. The valid-signature test is skipped until S72.
const TEST_WEBHOOK_SECRET = 'whsec_test_integration_suite';

// ─── HMAC signing ────────────────────────────────────────────────────────────

async function hmacSha256(secret, message) {
  const enc     = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, msgData);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function buildSignatureHeader(body, timestamp, secret) {
  const signed  = `${timestamp}.${body}`;
  const hmac    = await hmacSha256(secret, signed);
  return `t=${timestamp},v1=${hmac}`;
}

// ─── Public signing helpers ───────────────────────────────────────────────────

/**
 * Returns { body: string, headers: { 'Stripe-Signature': string } }
 * Valid signature, current timestamp.
 */
export async function signStripePayload(eventJson, secret = TEST_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig       = await buildSignatureHeader(eventJson, timestamp, secret);
  return {
    body:    eventJson,
    headers: { 'Stripe-Signature': sig },
  };
}

/**
 * Bad HMAC — signature will fail Worker verification.
 */
export async function signStripePayloadBadSig(eventJson, secret = TEST_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  // Build a valid sig then corrupt the hex
  const sig = await buildSignatureHeader(eventJson, timestamp, secret);
  const corrupted = sig.replace(/v1=([0-9a-f]{4})/, 'v1=0000');
  return {
    body:    eventJson,
    headers: { 'Stripe-Signature': corrupted },
  };
}

/**
 * Stale timestamp — 400 seconds in the past (outside the ±300s window).
 */
export async function signStripePayloadStale(eventJson, secret = TEST_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000) - 400;
  const sig       = await buildSignatureHeader(eventJson, timestamp, secret);
  return {
    body:    eventJson,
    headers: { 'Stripe-Signature': sig },
  };
}

// ─── Event factories ──────────────────────────────────────────────────────────

export function makeSubscriptionUpdatedEvent(overrides = {}) {
  const base = {
    id:      `evt_test_sub_updated_${Date.now()}`,
    type:    'customer.subscription.updated',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id:       `sub_test_${Date.now()}`,
        customer: `cus_test_${Date.now()}`,
        status:   'active',
        items: { data: [{ price: { lookup_key: 'share-creative-monthly' } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        cancel_at_period_end: false,
      },
    },
  };
  return JSON.stringify({ ...base, ...overrides });
}

export function makeSubscriptionDeletedEvent(overrides = {}) {
  const base = {
    id:      `evt_test_sub_deleted_${Date.now()}`,
    type:    'customer.subscription.deleted',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id:       `sub_test_${Date.now()}`,
        customer: `cus_test_${Date.now()}`,
        status:   'canceled',
        items: { data: [{ price: { lookup_key: 'share-max-monthly' } }] },
      },
    },
  };
  return JSON.stringify({ ...base, ...overrides });
}

export function makeCheckoutCompletedEvent(overrides = {}) {
  const base = {
    id:      `evt_test_checkout_${Date.now()}`,
    type:    'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id:       `cs_test_${Date.now()}`,
        customer: `cus_test_${Date.now()}`,
        customer_email: 'test@example.com',
        subscription: `sub_test_${Date.now()}`,
        payment_status: 'paid',
      },
    },
  };
  return JSON.stringify({ ...base, ...overrides });
}
