// Signed Stripe webhook payloads for the 3 events the Worker subscribes to.
// Pure ESM — no node:crypto. Uses Web Crypto subtle (available in Node 20+ and k6).
// Shared between Vitest integration tests and k6 load scripts.

/**
 * signStripePayload(payload, secret, timestampOverride?)
 * Returns { body, headers } ready to POST to /webhook/stripe.
 * Async — Web Crypto subtle.sign is always async.
 */
export async function signStripePayload(payload, secret, timestampOverride = null) {
  const ts = timestampOverride ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const sigInput = `${ts}.${body}`;

  const keyBytes = new TextEncoder().encode(secret);
  const msgBytes = new TextEncoder().encode(sigInput);

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig256 = await crypto.subtle.sign('HMAC', key, msgBytes);
  const sig = bytesToHex(new Uint8Array(sig256));

  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${ts},v1=${sig}`,
    },
  };
}

/**
 * signStripePayloadStale(payload, secret)
 * Returns a signed payload with a timestamp 10 minutes in the past — outside the ±300s window.
 */
export async function signStripePayloadStale(payload, secret) {
  return signStripePayload(payload, secret, Math.floor(Date.now() / 1000) - 700);
}

/**
 * signStripePayloadBadSig(payload, secret)
 * Returns a payload with a valid timestamp but a tampered HMAC — should be rejected.
 */
export async function signStripePayloadBadSig(payload, secret) {
  const result = await signStripePayload(payload, secret);
  // Flip the last character of the v1 signature
  const sig = result.headers['stripe-signature'];
  const flipped = sig.replace(/v1=([0-9a-f]{63})([0-9a-f])$/, (_, pre, last) => {
    const flippedChar = last === 'f' ? '0' : String.fromCharCode(last.charCodeAt(0) + 1);
    return `v1=${pre}${flippedChar}`;
  });
  result.headers['stripe-signature'] = flipped;
  return result;
}

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

export function checkoutCompletedEvent({
  customerId = 'cus_test_001',
  email = 'test@example.com',
  lookupKey = 'share-creative-monthly',
} = {}) {
  return {
    id: 'evt_test_checkout',
    type: 'checkout.session.completed',
    data: {
      object: {
        customer: customerId,
        customer_email: email,
        subscription: 'sub_test_001',
      },
    },
  };
}

export function subscriptionUpdatedEvent({
  customerId = 'cus_test_001',
  status = 'active',
  lookupKey = 'share-creative-monthly',
} = {}) {
  return {
    id: 'evt_test_sub_updated',
    type: 'customer.subscription.updated',
    data: {
      object: {
        customer: customerId,
        status,
        current_period_end: Math.floor(Date.now() / 1000) + 2_592_000,
        items: {
          data: [{ price: { lookup_key: lookupKey } }],
        },
      },
    },
  };
}

export function subscriptionDeletedEvent({
  customerId = 'cus_test_001',
} = {}) {
  return {
    id: 'evt_test_sub_deleted',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        customer: customerId,
        status: 'canceled',
        items: { data: [{ price: { lookup_key: 'share-creative-monthly' } }] },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
