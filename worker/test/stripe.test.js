/**
 * stripe.test.js — S62
 *
 * Covers:
 *   A. verifyStripeWebhook — signature verification (HMAC-SHA256)
 *   B. verifyStripeWebhook — replay protection (timestamp window)
 *   C. verifyStripeWebhook — malformed / missing headers
 *   D. createCheckoutSession — customer find-or-create, subscription creation
 *   E. createCheckoutSession — error paths
 *   F. tierFromLookupKey + resolveCitizenPrice — exact lookup keys, price resolve
 *   G. handleStripeWebhook — re-fetch, period end from the item, retries
 *   H. Stripe-Version — every Stripe call pins STRIPE_API_VERSION
 *
 * Fixtures are in the 2025-09-30.clover shape (Stripe-Account-1): period end on
 * items.data[], client secret at latest_invoice.confirmation_secret.
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
  resolveCitizenPrice,
  tierFromLookupKey,
  STRIPE_API_VERSION,
} from '../src/stripe.js';
import { handleStripeWebhook } from '../src/handlers/stripe_sub.js';

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

const PERIOD_END = 1_800_000_000;

/** Build a minimal Stripe subscription (2025-09-30.clover shape) with a price lookup_key */
function makeSubscription(lookupKey = 'share-citizen-monthly', subId = 'sub_test999', extra = {}) {
  return {
    object: 'subscription',
    id: subId,
    customer: 'cus_test123',
    status: 'active',
    items: { data: [{ id: 'si_1', current_period_end: PERIOD_END, price: { id: 'price_abc', lookup_key: lookupKey } }] },
    latest_invoice: {
      id: 'in_test1',
      confirmation_secret: { type: 'payment_intent', client_secret: 'pi_test123_secret_abc' },
    },
    ...extra,
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
  const PRICE_ID = 'price_sandbox_monthly';
  const EMAIL = 'test@refueler.io';

  it('D1: existing customer found → reuses customer ID, creates subscription', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([makeCustomer('cus_existing')]) }, // customer search
      { body: makeSubscription() },                          // subscription create
    ]);
    vi.stubGlobal('fetch', spy);

    const result = await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    expect(result.clientSecret).toBe('pi_test123_secret_abc');
    expect(result.subscriptionId).toBe('sub_test999');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('D2: no existing customer → creates new customer then subscription', async () => {
    const spy = mockFetchSequence([
      { body: stripeList([]) },
      { body: makeCustomer('cus_new') },
      { body: makeSubscription() },
    ]);
    vi.stubGlobal('fetch', spy);

    const result = await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    expect(result.clientSecret).toBe('pi_test123_secret_abc');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('D3: clientSecret comes from latest_invoice.confirmation_secret', async () => {
    const sub = makeSubscription();
    sub.latest_invoice.confirmation_secret.client_secret = 'pi_unique_secret_xyz_999';
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makeCustomer()]) }, { body: sub }]));
    const { clientSecret } = await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    expect(clientSecret).toBe('pi_unique_secret_xyz_999');
  });

  it('D4: subscriptionId extracted from subscription response', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([
      { body: stripeList([makeCustomer()]) },
      { body: makeSubscription('share-citizen-monthly', 'sub_specific_id') },
    ]));
    const { subscriptionId } = await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    expect(subscriptionId).toBe('sub_specific_id');
  });

  function recordCalls() {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) return { ok: true, json: async () => stripeList([makeCustomer()]) };
      return { ok: true, json: async () => makeSubscription() };
    }));
    return calls;
  }

  it('D5: Authorization header uses Bearer + secret key', async () => {
    const calls = recordCalls();
    await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    for (const c of calls) expect(c.opts.headers['Authorization']).toBe(`Bearer ${STRIPE_KEY}`);
  });

  it('D6: customer search uses email query param (encoded)', async () => {
    const calls = recordCalls();
    await createCheckoutSession(PRICE_ID, 'test+user@refueler.io', STRIPE_KEY);
    expect(calls[0].url).toContain('/v1/customers');
    expect(calls[0].url).toContain('email=test%2Buser%40refueler.io');
  });

  it('D7: subscription POST: default_incomplete, card only, the given price', async () => {
    const calls = recordCalls();
    await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    const body = new URLSearchParams(calls[1].opts.body);
    expect(body.get('payment_behavior')).toBe('default_incomplete');
    expect(body.get('payment_settings[payment_method_types][0]')).toBe('card');
    expect(body.get('items[0][price]')).toBe(PRICE_ID);
  });

  it('D8: subscription POST expands latest_invoice.confirmation_secret (not payment_intent)', async () => {
    const calls = recordCalls();
    await createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY);
    const body = new URLSearchParams(calls[1].opts.body);
    expect(body.get('expand[0]')).toBe('latest_invoice.confirmation_secret');
    expect(calls[1].opts.body).not.toContain('payment_intent');
  });
});

// ---------------------------------------------------------------------------
// E. createCheckoutSession — error paths
// ---------------------------------------------------------------------------

describe('E. createCheckoutSession — error paths', () => {
  const PRICE_ID = 'price_sandbox_monthly';
  const EMAIL = 'test@refueler.io';

  it('E1: customer search fails → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ ok: false, status: 500, body: { error: 'server error' } }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY)).rejects.toThrow(/stripe customer search error/i);
  });

  it('E2: customer create fails → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([]) }, { ok: false, status: 400, body: { error: 'invalid' } }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY)).rejects.toThrow(/stripe customer create error/i);
  });

  it('E3: subscription create fails → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makeCustomer()]) }, { ok: false, status: 402, body: { error: 'card_declined' } }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY)).rejects.toThrow(/stripe subscription error/i);
  });

  it('E4: old-shape response (latest_invoice.payment_intent only) → throws, never half-works', async () => {
    const oldShape = { id: 'sub_old', latest_invoice: { payment_intent: { client_secret: 'pi_x_secret_y' } } };
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makeCustomer()]) }, { body: oldShape }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY)).rejects.toThrow(/no client_secret/i);
  });

  it('E5: subscription response missing latest_invoice entirely → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makeCustomer()]) }, { body: { id: 'sub_no_invoice' } }]));
    await expect(createCheckoutSession(PRICE_ID, EMAIL, STRIPE_KEY)).rejects.toThrow(/no client_secret/i);
  });
});

// ---------------------------------------------------------------------------
// F. Exact lookup keys + price resolve (S-4)
// ---------------------------------------------------------------------------

function makePrice(lookupKey, interval, extra = {}) {
  return { object: 'price', id: `price_${interval}`, lookup_key: lookupKey, currency: 'gbp',
    type: 'recurring', recurring: { interval }, active: true, ...extra };
}

describe('F. tierFromLookupKey + resolveCitizenPrice', () => {
  it('F1: exactly the two Citizen keys → citizen', () => {
    expect(tierFromLookupKey('share-citizen-monthly')).toBe('citizen');
    expect(tierFromLookupKey('share-citizen-yearly')).toBe('citizen');
  });

  it('F2: no substring match — old keys, near misses and empties → free', () => {
    for (const k of ['share-max-monthly', 'share-max-yearly', 'share-max-3month', 'share-creative-monthly',
                     'share-citizen-monthly-x', 'xshare-citizen-yearly', 'SHARE-CITIZEN-MONTHLY',
                     'share-citizen', '', 'citizen', 'max']) {
      expect(tierFromLookupKey(k)).toBe('free');
    }
    expect(tierFromLookupKey(null)).toBe('free');
    expect(tierFromLookupKey(undefined)).toBe('free');
  });

  it('F3: monthly → GET /v1/prices by lookup key, active only → its id', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => stripeList([makePrice('share-citizen-monthly', 'month')]) };
    }));
    expect(await resolveCitizenPrice('monthly', STRIPE_KEY)).toBe('price_month');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/prices?lookup_keys[]=share-citizen-monthly&active=true&limit=2');
    expect(calls[0].opts.method).toBe('GET');
  });

  it('F4: yearly → share-citizen-yearly, interval year', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makePrice('share-citizen-yearly', 'year')]) }]));
    expect(await resolveCitizenPrice('yearly', STRIPE_KEY)).toBe('price_year');
  });

  it('F5: unknown plan → throws before any Stripe call', async () => {
    const spy = vi.fn(); vi.stubGlobal('fetch', spy);
    for (const plan of ['3month', 'max', 'price_1Ts7vIGlctwiB9U3kb3NCLue', '', '__proto__', 'toString']) {
      await expect(resolveCitizenPrice(plan, STRIPE_KEY)).rejects.toThrow(/unknown plan/i);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('F6: none or two prices for the key → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([]) }]));
    await expect(resolveCitizenPrice('monthly', STRIPE_KEY)).rejects.toThrow(/found 0/);
    vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([makePrice('share-citizen-monthly', 'month'), makePrice('share-citizen-monthly', 'month')]) }]));
    await expect(resolveCitizenPrice('monthly', STRIPE_KEY)).rejects.toThrow(/found 2/);
  });

  it('F7: wrong currency, interval, type or key on the returned price → throws', async () => {
    for (const bad of [
      makePrice('share-citizen-monthly', 'month', { currency: 'usd' }),
      makePrice('share-citizen-monthly', 'year'),
      makePrice('share-citizen-monthly', 'month', { type: 'one_time' }),
      makePrice('share-citizen-yearly', 'month'),
    ]) {
      vi.stubGlobal('fetch', mockFetchSequence([{ body: stripeList([bad]) }]));
      await expect(resolveCitizenPrice('monthly', STRIPE_KEY)).rejects.toThrow(/not a GBP/);
    }
  });

  it('F8: Stripe error → throws', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ ok: false, status: 401, body: { error: 'no' } }]));
    await expect(resolveCitizenPrice('monthly', STRIPE_KEY)).rejects.toThrow(/price lookup error/i);
  });
});

// ---------------------------------------------------------------------------
// G. handleStripeWebhook — re-fetch, period end from the item (S-1, S-3)
// ---------------------------------------------------------------------------

describe('G. handleStripeWebhook', () => {
  const env = {
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: STRIPE_KEY,
    SUPABASE_URL: 'https://sb.test',
    SUPABASE_SERVICE_KEY: 'service-test',
  };

  /** Stripe answers `sub` for the re-fetch; Supabase records the upsert body. */
  function stub(sub, { subOk = true, sbOk = true } = {}) {
    const f = vi.fn(async (url, opts = {}) => {
      const u = String(url);
      f.urls.push(u);
      if (u.startsWith('https://api.stripe.com/v1/subscriptions/')) {
        return subOk ? Response.json(sub) : new Response('{}', { status: 404 });
      }
      if (u.startsWith('https://api.stripe.com/v1/customers/')) return Response.json({ id: sub?.customer, email: 'c@example.com' });
      if (u.startsWith('https://sb.test/rest/v1/subscribers')) {
        f.upserts.push(JSON.parse(opts.body));
        return new Response(null, { status: sbOk ? 201 : 400 });
      }
      throw new Error(`unexpected fetch ${u}`);
    });
    f.urls = []; f.upserts = [];
    vi.stubGlobal('fetch', f);
    return f;
  }
  const event = (type, object) => buildStripeRequest({ type, data: { object } });

  it('G1: updated → re-fetches the subscription and writes citizen / active / item period end', async () => {
    const f = stub(makeSubscription('share-citizen-yearly'));
    // The event body is stale and old-shaped (2020-03-02 endpoint): ignored apart from the id.
    const res = await handleStripeWebhook(event('customer.subscription.updated',
      { id: 'sub_test999', status: 'incomplete', current_period_end: 1, items: { data: [{ price: { lookup_key: 'share-max-yearly' } }] } }), env);
    expect(res.status).toBe(200);
    expect(f.urls).toContain('https://api.stripe.com/v1/subscriptions/sub_test999');
    expect(f.upserts).toHaveLength(1);
    expect(f.upserts[0]).toMatchObject({
      stripe_customer_id: 'cus_test123', email: 'c@example.com', tier: 'citizen', status: 'active',
      current_period_end: new Date(PERIOD_END * 1000).toISOString(),
    });
  });

  it('G2: created + incomplete → inactive, never counted as paid', async () => {
    const f = stub(makeSubscription('share-citizen-monthly', 'sub_test999', { status: 'incomplete' }));
    await handleStripeWebhook(event('customer.subscription.created', { id: 'sub_test999' }), env);
    expect(f.upserts[0]).toMatchObject({ tier: 'citizen', status: 'inactive' });
  });

  it('G3: an old-account key (share-max-*) is not Citizen', async () => {
    const f = stub(makeSubscription('share-max-monthly'));
    await handleStripeWebhook(event('customer.subscription.updated', { id: 'sub_test999' }), env);
    expect(f.upserts[0]).toMatchObject({ tier: 'free', status: 'active' });
  });

  it('G4: re-fetched as canceled (out-of-order update) → free / cancelled', async () => {
    const f = stub(makeSubscription('share-citizen-monthly', 'sub_test999', { status: 'canceled' }));
    await handleStripeWebhook(event('customer.subscription.updated', { id: 'sub_test999' }), env);
    expect(f.upserts[0]).toMatchObject({ tier: 'free', status: 'cancelled' });
    expect(f.upserts[0].cancelled_at).toBeTruthy();
  });

  it('G5: no period end on the item → null (citizen_entitlement fails closed)', async () => {
    const sub = makeSubscription();
    delete sub.items.data[0].current_period_end;
    const f = stub(sub);
    await handleStripeWebhook(event('customer.subscription.updated', { id: 'sub_test999' }), env);
    expect(f.upserts[0].current_period_end).toBeNull();
  });

  it('G6: re-fetch fails → 500 so Stripe retries; nothing written', async () => {
    const f = stub(null, { subOk: false });
    const res = await handleStripeWebhook(event('customer.subscription.updated', { id: 'sub_test999' }), env);
    expect(res.status).toBe(500);
    expect(f.upserts).toHaveLength(0);
  });

  it('G7: a malformed subscription id is never fetched → 500', async () => {
    const f = stub(makeSubscription());
    const res = await handleStripeWebhook(event('customer.subscription.updated', { id: '../customers/cus_x' }), env);
    expect(res.status).toBe(500);
    expect(f.urls).toHaveLength(0);
  });

  it('G8: Supabase refuses the write → 500 so Stripe retries', async () => {
    stub(makeSubscription(), { sbOk: false });
    const res = await handleStripeWebhook(event('customer.subscription.updated', { id: 'sub_test999' }), env);
    expect(res.status).toBe(500);
  });

  it('G9: deleted → free / cancelled from the event, no Stripe call', async () => {
    const f = stub(null);
    const res = await handleStripeWebhook(event('customer.subscription.deleted', { id: 'sub_test999', customer: 'cus_gone' }), env);
    expect(res.status).toBe(200);
    expect(f.urls.filter(u => u.startsWith('https://api.stripe.com'))).toHaveLength(0);
    expect(f.upserts[0]).toMatchObject({ stripe_customer_id: 'cus_gone', tier: 'free', status: 'cancelled' });
  });

  it('G10: checkout.session.completed (S-3) and other types → 200, nothing written', async () => {
    const f = stub(null);
    for (const type of ['checkout.session.completed', 'invoice.paid']) {
      const res = await handleStripeWebhook(event(type, { id: 'cs_1', mode: 'subscription', customer: 'cus_x', subscription: 'sub_test999' }), env);
      expect(res.status).toBe(200);
    }
    expect(f.urls).toHaveLength(0);
  });

  it('G11: bad signature → 401, nothing fetched', async () => {
    const f = stub(makeSubscription());
    const res = await handleStripeWebhook(buildBadSigRequest({ type: 'customer.subscription.updated', data: { object: { id: 'sub_test999' } } }), env);
    expect(res.status).toBe(401);
    expect(f.urls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// H. Stripe-Version pin (S-1)
// ---------------------------------------------------------------------------

describe('H. Stripe-Version', () => {
  it('H1: the pinned version is a Clover version', () => {
    expect(STRIPE_API_VERSION).toBe('2025-09-30.clover');
  });

  it('H2: checkout, price resolve and webhook re-fetch all send it', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://api.stripe.com')) seen.push([u, opts.headers?.['Stripe-Version']]);
      if (u.includes('/v1/prices')) return Response.json(stripeList([makePrice('share-citizen-monthly', 'month')]));
      if (u.includes('/v1/customers?')) return Response.json(stripeList([makeCustomer()]));
      if (u.includes('/v1/customers/')) return Response.json(makeCustomer());
      if (u.includes('/v1/subscriptions')) return Response.json(makeSubscription());
      return new Response(null, { status: 201 });
    }));
    await resolveCitizenPrice('monthly', STRIPE_KEY);
    await createCheckoutSession('price_month', 'a@example.com', STRIPE_KEY);
    await handleStripeWebhook(buildStripeRequest({ type: 'customer.subscription.updated', data: { object: { id: 'sub_test999' } } }),
      { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_SECRET_KEY: STRIPE_KEY, SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_KEY: 'k' });
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const [u, v] of seen) expect(v, u).toBe(STRIPE_API_VERSION);
  });
});
