/**
 * checkout-gate.test.js — Plans-Stripe-1 (18 Oct 2026)
 *
 * POST /subscription/checkout runs only with a passing Turnstile token, and
 * nothing reaches Stripe until it has passed (row 26: no Stripe customer before
 * the "Continue to payment" press). All HTTP mocked via vi.stubGlobal('fetch').
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleCheckout } from '../src/handlers/stripe_sub.js';

const PRICE = 'price_1Ts7vIGlctwiB9U3kb3NCLue';
const env = { TURNSTILE_SECRET_KEY: 'test-turnstile-secret', STRIPE_SECRET_KEY: 'sk_test_PLACEHOLDER' };
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function req(body) {
  return new Request('https://api.share.refueler.io/subscription/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** fetch stub: siteverify answers `turnstileOk`; Stripe answers a customer, then a subscription. */
function stubFetch(turnstileOk) {
  const f = vi.fn(async (url) => {
    const u = String(url);
    if (u === SITEVERIFY) return Response.json({ success: turnstileOk });
    if (u.includes('/v1/customers?')) return Response.json({ data: [] });
    if (u.endsWith('/v1/customers')) return Response.json({ id: 'cus_test' });
    if (u.endsWith('/v1/subscriptions')) {
      return Response.json({ id: 'sub_test', latest_invoice: { payment_intent: { client_secret: 'pi_secret_test' } } });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const stripeCalls = (f) => f.mock.calls.filter(([u]) => String(u).startsWith('https://api.stripe.com'));

afterEach(() => vi.unstubAllGlobals());

describe('checkout gate', () => {
  it('refuses with 403 and never calls Stripe when the token is missing', async () => {
    const f = stubFetch(true);
    const res = await handleCheckout(req({ price_id: PRICE, email: 'a@example.com' }), env);
    expect(res.status).toBe(403);
    expect(stripeCalls(f)).toHaveLength(0);
  });

  it('refuses with 403 and never calls Stripe when Turnstile says no', async () => {
    const f = stubFetch(false);
    const res = await handleCheckout(req({ price_id: PRICE, email: 'a@example.com', turnstile_token: 'bad' }), env);
    expect(res.status).toBe(403);
    expect(stripeCalls(f)).toHaveLength(0);
  });

  it('refuses a bad price before spending a Turnstile check', async () => {
    const f = stubFetch(true);
    const res = await handleCheckout(req({ price_id: 'price_nope', email: 'a@example.com', turnstile_token: 't' }), env);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('creates the checkout only after Turnstile passes', async () => {
    const f = stubFetch(true);
    const res = await handleCheckout(req({ price_id: PRICE, email: 'a@example.com', turnstile_token: 'good' }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ client_secret: 'pi_secret_test' });
    expect(String(f.mock.calls[0][0])).toBe(SITEVERIFY);
    expect(stripeCalls(f).length).toBeGreaterThan(0);
  });
});
