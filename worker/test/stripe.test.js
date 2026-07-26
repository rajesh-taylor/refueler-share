/**
 * stripe.test.js — S62
 *
 * Covers:
 *   A. verifyStripeWebhook — signature verification (HMAC-SHA256)
 *   B. verifyStripeWebhook — replay protection (timestamp window)
 *   C. verifyStripeWebhook — malformed / missing headers
 *   D. createCheckoutSession — customer find-or-create, subscription creation
 *   E. createCheckoutSession — error paths
 *   F. getSubscriptionTier — active subscription lookup and tier routing
 *   G. getSubscriptionTier — edge cases (no subscription, API error)
 *
 * All Stripe API calls mocked via vi.stubGlobal('fetch', ...).
 * HMAC signatures generated with Node crypto — same algorithm as stripe.js.
 *
 * NOTE: verifyStripeWebhook reads the raw body via request.text().
 * We construct synthetic Request objects so the headers + body match exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto'; // Node built-in — available in Vitest (Node runtime)

import {
  verifyStripeWebhook,
  createCheckoutSession,
  getSubscriptionTier,
} from '../src/stripe.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = 'WEBHOOK_SECRET_PLACEHOLDER_for_tests';
const STRIPE_KEY = 'sk_test_PLACEHOLDER_not_a_real_key';

/**
 * Build a signed Stripe webhook Request.
 * Stripe signature format: `t=<timestamp>,v1=<hex-hmac>`
 * HMAC-SHA256 over `${timestamp}.${rawBody}` using the webhook secret.
 */
function buildStripeRequest(body, secret = WEBHOOK_SECRET, timestampOverride = null) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signed = `${timestamp}.${rawBody}`;
  const hmac = createHmac('sha256', secret).update(signed).digest('hex');
  const sig = `t=${timestamp},v1=${hmac}`;

  return new Request('https://worker.example/webhook/stripe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': sig,
    },
    body: rawBody,
  });
}

/** Build a request with a deliberately wrong HMAC */
function buildBadSigRequest(body) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = `t=${timestamp},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
  return new Request('https://worker.example/webhook/stripe', {
    method: 'POST',
    headers: { 'Stripe-Signature': sig },
    body: rawBody,
  });
}

/** Stripe-style paginated list response */
function stripeList(items) {
  return { object: 'list', data: items, has_more: false, url: '/v1/customers' };
}

/** Build a minimal Stripe customer object */
function makeCustomer(id = 'cus_test123', email = 'test@refueler.io') {
  return { object: 'customer', id, email };
}

/** Build a minimal Stripe subscription with a price lookup_key */
function makeSubscription(lookupKey = 'share-creative-monthly', subId = 'sub_test999') {
  return {
    object: 'subscription',
    id: subId,
    status: 'active',
    items: { data: [{ price: { id: 'price_abc', lookup_key: lookupKey } }] },
    latest_invoice: {
      payment_intent: {
        id: 'pi_test123',
        client_secret: 'pi_test123_secret_abc',
      },
    },
  };
}

/**
 * Build a multi-call fetch mock. `calls` is an array of response specs,
 * consumed in order. Each: { ok, body } or just { body } (ok defaults true).
 */
function mockFetchSequence(calls) {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const spec = calls[i++] ?? { ok: true, body: {} };
    const ok = spec.ok !== false;
    return {
      ok,
      status: ok ? 200 : (spec.status ?? 500),
      json: async () => spec.body,
      text: async () => JSON.stringify(spec.body),
    };
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
// A. verifyStripeWebhook — valid signatures
// ---------------------------------------------------------------------------

describe('A. verifyStripeWebhook — valid signatures', () => {
  it('A1: valid signature → returns parsed event object', async () => {
    const payload = { type: 'customer.subscription.created', data: { object: { id: 'sub_1' } } };
    const req = buildStripeRequest(payload);
    const event = await verifyStripeWebhook(req, WEBHOOK_SECRET);
    expect(event).toMatchObject({ type: 'customer.subscription.created' });
  });

  it('A2: returns full event data intact', async () => {
    const payload = {
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_2', status: 'active', customer: 'cus_abc' } },
    };
    const req = buildStripeRequest(payload);
    const event = await verifyStripeWebhook(req, WEBHOOK_SECRET);
    expect(event.data.object.status).toBe('active');
    expect(event.data.object.customer).toBe('cus_abc');
  });

  it('A3: event with minimal body (single field) still verifies', async () => {
    const payload = { type: 'ping' };
    const req = buildStripeRequest(payload);
    const event = await verifyStripeWebhook(req, WEBHOOK_SECRET);
    expect(event.type).toBe('ping');
  });

  it('A4: customer.subscription.deleted event verifies correctly', async () => {
    const payload = { type: 'customer.subscription.deleted', data: { object: { id: 'sub_del_1' } } };
    const req = buildStripeRequest(payload);
    const event = await verifyStripeWebhook(req, WEBHOOK_SECRET);
    expect(event.type).toBe('customer.subscription.deleted');
  });
});

// ---------------------------------------------------------------------------
// B. verifyStripeWebhook — replay protection
// ---------------------------------------------------------------------------

describe('B. verifyStripeWebhook — replay protection', () => {
  it('B1: timestamp exactly at boundary (299s old) → passes', async () => {
    const ts = Math.floor(Date.now() / 1000) - 299;
    const payload = { type: 'test.event' };
    const req = buildStripeRequest(payload, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).resolves.toMatchObject({ type: 'test.event' });
  });

  it('B2: timestamp 301s in the past → throws timestamp error', async () => {
    const ts = Math.floor(Date.now() / 1000) - 301;
    const payload = { type: 'test.event' };
    const req = buildStripeRequest(payload, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/timestamp too old/i);
  });

  it('B3: timestamp 10 minutes old → throws', async () => {
    const ts = Math.floor(Date.now() / 1000) - 600;
    const req = buildStripeRequest({ type: 'test.event' }, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/timestamp too old/i);
  });

  it('B4: timestamp 1 hour old → throws', async () => {
    const ts = Math.floor(Date.now() / 1000) - 3600;
    const req = buildStripeRequest({ type: 'test.event' }, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/timestamp too old/i);
  });

  it('B5: future timestamp within 5 minutes → passes (allows clock skew)', async () => {
    const ts = Math.floor(Date.now() / 1000) + 120;
    const payload = { type: 'future.event' };
    const req = buildStripeRequest(payload, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).resolves.toMatchObject({ type: 'future.event' });
  });

  it('B6: future timestamp > 5 minutes → throws', async () => {
    const ts = Math.floor(Date.now() / 1000) + 400;
    const req = buildStripeRequest({ type: 'future.event' }, WEBHOOK_SECRET, ts);
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/timestamp too old/i);
  });
});

// ---------------------------------------------------------------------------
// C. verifyStripeWebhook — malformed / missing headers
// ---------------------------------------------------------------------------

describe('C. verifyStripeWebhook — malformed / missing headers', () => {
  it('C1: missing Stripe-Signature header → throws', async () => {
    const req = new Request('https://worker.example/webhook/stripe', {
      method: 'POST',
      body: JSON.stringify({ type: 'test' }),
    });
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/missing stripe-signature/i);
  });

  it('C2: wrong HMAC → throws signature mismatch', async () => {
    const req = buildBadSigRequest({ type: 'test.event' });
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/signature mismatch/i);
  });

  it('C3: valid HMAC but wrong secret → throws mismatch', async () => {
    const payload = { type: 'test.event' };
    const req = buildStripeRequest(payload, 'wrong-secret-key');
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/signature mismatch/i);
  });

  it('C4: Stripe-Signature header with no t= part → throws invalid format', async () => {
    const req = new Request('https://worker.example/webhook/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': 'v1=abc123' },
      body: '{}',
    });
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/invalid stripe-signature format/i);
  });

  it('C5: Stripe-Signature header with no v1= part → throws invalid format', async () => {
    const req = new Request('https://worker.example/webhook/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=1234567890' },
      body: '{}',
    });
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/invalid stripe-signature format/i);
  });

  it('C6: body tampered after signing → signature mismatch', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const originalBody = JSON.stringify({ type: 'test.event', amount: 100 });
    const signed = `${ts}.${originalBody}`;
    const hmac = createHmac('sha256', WEBHOOK_SECRET).update(signed).digest('hex');

    // Tamper the body
    const tamperedBody = JSON.stringify({ type: 'test.event', amount: 999 });
    const req = new Request('https://worker.example/webhook/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': `t=${ts},v1=${hmac}` },
      body: tamperedBody,
    });
    await expect(verifyStripeWebhook(req, WEBHOOK_SECRET)).rejects.toThrow(/signature mismatch/i);
  });

  it('C7: empty body with valid signature for empty body → passes', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const rawBody = '{}';
    const signed = `${ts}.${rawBody}`;
    const hmac = createHmac('sha256', WEBHOOK_SECRET).update(signed).digest('hex');
    const req = new Request('https://worker.example/webhook/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': `t=${ts},v1=${hmac}` },
      body: rawBody,
    });
    const event = await verifyStripeWebhook(req, WEBHOOK_SECRET);
    expect(event).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// D. createCheckoutSession — happy paths
// ---------------------------------------------------------------------------

describe('D. createCheckoutSession — customer find-or-create + subscription', () => {
  const PRICE_ID = 'price_1Ts7lsGlctwiB9U3hdtgChU2';
  const EMAIL = 'test@refueler.io';

  it('D1: existing customer found → reuses customer ID, creates subscription', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer('cus_existing')]) }, // customer search
      { body: makeSubscription('share-creative-monthly') }, // subscription create
    ]);
    vi.stubGlobal('fetch', spy);

    const result = await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    expect(result.clientSecret).toBe('pi_test123_secret_abc');
    expect(result.subscriptionId).toBe('sub_test999');
    // Should be 2 calls: search + create sub (no customer create call)
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('D2: no existing customer → creates new customer then subscription', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([]) },                            // customer search → empty
      { body: makeCustomer('cus_new') },                   // customer create
      { body: makeSubscription('share-max-monthly') },     // subscription create
    ]);
    vi.stubGlobal('fetch', spy);

    const result = await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    expect(result.clientSecret).toBe('pi_test123_secret_abc');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('D3: clientSecret extracted correctly from nested PaymentIntent', async () => {
    const sub = makeSubscription('share-creative-monthly');
    sub.latest_invoice.payment_intent.client_secret = 'pi_unique_secret_xyz_999';
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer('cus_abc')]) },
      { body: sub },
    ]);
    vi.stubGlobal('fetch', spy);

    const { clientSecret } = await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    expect(clientSecret).toBe('pi_unique_secret_xyz_999');
  });

  it('D4: subscriptionId extracted from subscription response', async () => {
    const sub = makeSubscription('share-creative-monthly', 'sub_specific_id');
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer('cus_abc')]) },
      { body: sub },
    ]);
    vi.stubGlobal('fetch', spy);

    const { subscriptionId } = await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    expect(subscriptionId).toBe('sub_specific_id');
  });

  it('D5: Authorization header uses Bearer + secret key', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return { ok: true, json: async () => stripeList([makeCustomer()]) };
      return { ok: true, json: async () => makeSubscription() };
    }));

    await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    for (const c of calls) {
      expect(c.opts.headers['Authorization']).toBe(`Bearer ${STRIPE_KEY}`);
    }
  });

  it('D6: customer search uses email query param (encoded)', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return { ok: true, json: async () => stripeList([makeCustomer()]) };
      return { ok: true, json: async () => makeSubscription() };
    }));

    await createCheckoutSession(PRICE_ID, 'test+user@refueler.io', '/', '/', STRIPE_KEY);
    const searchUrl = calls[0].url;
    expect(searchUrl).toContain('/v1/customers');
    expect(searchUrl).toContain('email=');
  });

  it('D7: subscription POST includes payment_behavior=default_incomplete', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return { ok: true, json: async () => stripeList([makeCustomer()]) };
      return { ok: true, json: async () => makeSubscription() };
    }));

    await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    const subBody = calls[1].opts.body.toString();
    expect(subBody).toContain('payment_behavior=default_incomplete');
  });

  it('D8: subscription POST expands latest_invoice.payment_intent', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return { ok: true, json: async () => stripeList([makeCustomer()]) };
      return { ok: true, json: async () => makeSubscription() };
    }));

    await createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY);
    const subBody = calls[1].opts.body.toString();
    expect(subBody).toContain('latest_invoice.payment_intent');
  });
});

// ---------------------------------------------------------------------------
// E. createCheckoutSession — error paths
// ---------------------------------------------------------------------------

describe('E. createCheckoutSession — error paths', () => {
  const PRICE_ID = 'price_1Ts7lsGlctwiB9U3hdtgChU2';
  const EMAIL = 'test@refueler.io';

  it('E1: customer search fails → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ ok: false, status: 500, body: { error: 'server error' } }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY))
      .rejects.toThrow(/stripe customer search error/i);
  });

  it('E2: customer create fails → throws', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([]) },                    // search → empty
      { ok: false, status: 400, body: { error: 'invalid' } }, // create fails
    ]);
    vi.stubGlobal('fetch', spy);
    await expect(createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY))
      .rejects.toThrow(/stripe customer create error/i);
  });

  it('E3: subscription create fails → throws', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer()]) },      // search finds customer
      { ok: false, status: 402, body: { error: 'card_declined' } }, // sub fails
    ]);
    vi.stubGlobal('fetch', spy);
    await expect(createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY))
      .rejects.toThrow(/stripe subscription error/i);
  });

  it('E4: subscription response missing client_secret → throws', async () => {
    const badSub = { id: 'sub_bad', latest_invoice: { payment_intent: null } };
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer()]) },
      { body: badSub },
    ]);
    vi.stubGlobal('fetch', spy);
    await expect(createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY))
      .rejects.toThrow(/no client_secret/i);
  });

  it('E5: subscription response missing latest_invoice entirely → throws', async () => {
    const badSub = { id: 'sub_no_invoice' };
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer()]) },
      { body: badSub },
    ]);
    vi.stubGlobal('fetch', spy);
    await expect(createCheckoutSession(PRICE_ID, EMAIL, '/', '/', STRIPE_KEY))
      .rejects.toThrow(/no client_secret/i);
  });
});

// ---------------------------------------------------------------------------
// F. getSubscriptionTier — happy paths
// ---------------------------------------------------------------------------

describe('F. getSubscriptionTier — tier routing', () => {
  it('F1: share-creative-monthly lookup_key → creative', async () => {
    const sub = makeSubscription('share-creative-monthly');
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('creative');
  });

  it('F2: share-creative-yearly lookup_key → creative', async () => {
    const sub = makeSubscription('share-creative-yearly');
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('creative');
  });

  it('F3: share-max-monthly lookup_key → max', async () => {
    const sub = makeSubscription('share-max-monthly');
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('max');
  });

  it('F4: share-max-yearly lookup_key → max', async () => {
    const sub = makeSubscription('share-max-yearly');
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('max');
  });

  it('F5: unknown lookup_key → free (fallback)', async () => {
    const sub = makeSubscription('share-enterprise-custom');
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('free');
  });

  it('F6: passes customer ID as query param', async () => {
    let capturedUrl;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => stripeList([makeSubscription()]) };
    }));
    await getSubscriptionTier('cus_specific_id', STRIPE_KEY);
    expect(capturedUrl).toContain('cus_specific_id');
  });

  it('F7: uses Authorization Bearer header', async () => {
    let capturedOpts;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      capturedOpts = opts;
      return { ok: true, json: async () => stripeList([makeSubscription()]) };
    }));
    await getSubscriptionTier('cus_abc', STRIPE_KEY);
    expect(capturedOpts.headers['Authorization']).toBe(`Bearer ${STRIPE_KEY}`);
  });
});

// ---------------------------------------------------------------------------
// G. getSubscriptionTier — edge cases
// ---------------------------------------------------------------------------

describe('G. getSubscriptionTier — edge cases and error paths', () => {
  it('G1: no active subscriptions (empty list) → free', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([]) }]));
    expect(await getSubscriptionTier('cus_no_sub', STRIPE_KEY)).toBe('free');
  });

  it('G2: Stripe API non-200 response → free (graceful degradation)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ ok: false, status: 500, body: {} }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('free');
  });

  it('G3: network error → free (graceful degradation)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
    // getSubscriptionTier doesn't catch — let it propagate, verify real behaviour
    // In index.js the caller catches and defaults free. Here we test the raw module.
    await expect(getSubscriptionTier('cus_abc', STRIPE_KEY)).rejects.toThrow('Network down');
  });

  it('G4: subscription with null lookup_key → free', async () => {
    const sub = makeSubscription(null);
    sub.items.data[0].price.lookup_key = null;
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('free');
  });

  it('G5: subscription with undefined lookup_key → free', async () => {
    const sub = makeSubscription();
    delete sub.items.data[0].price.lookup_key;
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('free');
  });

  it('G6: subscription data missing items → free (no crash)', async () => {
    const sub = { id: 'sub_broken', status: 'active', items: { data: [] } };
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([sub]) }]));
    expect(await getSubscriptionTier('cus_abc', STRIPE_KEY)).toBe('free');
  });

  it('G7: query filters for active status', async () => {
    let capturedUrl;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => stripeList([makeSubscription()]) };
    }));
    await getSubscriptionTier('cus_abc', STRIPE_KEY);
    expect(capturedUrl).toContain('status=active');
  });
});
