// Signed Stripe webhook payloads for the 3 events the Worker subscribes to.
// Uses Node crypto — not importable by k6. Vitest integration tests only.

import { createHmac } from 'node:crypto';

/**
 * signStripePayload(payload, secret, timestampOverride?)
 * Returns { body, headers } ready to POST to /webhook/stripe.
 */
export function signStripePayload(payload, secret, timestampOverride = null) {
  const ts = timestampOverride ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const sigInput = `${ts}.${body}`;
  const sig = createHmac('sha256', secret).update(sigInput).digest('hex');
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${ts},v1=${sig}`,
    },
  };
}

export function checkoutCompletedEvent({ customerId = 'cus_test_001', email = 'test@example.com', lookupKey = 'share-creative-monthly' } = {}) {
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

export function subscriptionUpdatedEvent({ customerId = 'cus_test_001', status = 'active', lookupKey = 'share-creative-monthly' } = {}) {
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

export function subscriptionDeletedEvent({ customerId = 'cus_test_001' } = {}) {
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
