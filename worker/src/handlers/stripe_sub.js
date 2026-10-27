// worker/src/handlers/stripe_sub.js
//
// SW9a — Extracted from index.js (Phase 2).
// Stripe subscription handlers: webhook, checkout. Helper: upsertSubscriber.
// The Stripe calls themselves live in ../stripe.js (one pinned API version).
//
// All imports from ./utils.js — never from index.js.
// Stripe API client calls use env.STRIPE_SECRET_KEY directly.

import {
  verifyStripeWebhook, createCheckoutSession, resolveCitizenPrice,
  fetchSubscription, fetchCustomerEmail, citizenItem, tierFromLookupKey, CITIZEN_LOOKUP_KEYS,
} from '../stripe.js';
import { supabaseFetch, json, err }                   from '../utils.js';
import { verifyTurnstileToken }                     from '../turnstile.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — POST /webhook/stripe
//
// Stripe-Account-1: events are customer.subscription.created / updated /
// deleted. checkout.session.completed is gone — Plans uses the Payment Element
// on a default_incomplete subscription, so it never fired (plan v1 S-3); a
// Citizen becomes paid on the update to active.
//
// created / updated: the event body is only a pointer. The subscription is
// re-fetched with the pinned API version, so the endpoint's version (old
// account: 2020-03-02) never changes what is read, and an out-of-order event
// writes the subscription's current state. A failed re-fetch answers 500 so
// Stripe retries.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleStripeWebhook(request, env) {
  let event;
  try {
    event = await verifyStripeWebhook(request, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook verify failed:', e.message);
    return new Response('Unauthorized', { status: 401 });
  }

  const type = event.type;
  console.log('Stripe event:', type);

  try {
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const sub = await fetchSubscription(event.data?.object?.id, env.STRIPE_SECRET_KEY);
      if (!sub) {
        console.error('Webhook: subscription re-fetch failed');
        return new Response('Handler error', { status: 500 });
      }
      const customerId = sub.customer;
      const item       = citizenItem(sub);
      // Plans-Stripe-1: an unpaid (incomplete) subscription is not a subscriber — pressing
      // Continue must not count as a paying Citizen in Navy Office's figures.
      const status = (sub.status === 'active' || sub.status === 'trialing') ? 'active'
                   : sub.status === 'canceled' ? 'cancelled'
                   : 'inactive';
      const tier      = status === 'cancelled' ? 'free' : tierFromLookupKey(item?.price?.lookup_key ?? '');
      const periodEnd = item?.current_period_end ?? null;
      const email     = await fetchCustomerEmail(customerId, env.STRIPE_SECRET_KEY).catch(() => null);
      await upsertSubscriber(env, customerId, email, tier, status, periodEnd,
        status === 'cancelled' ? new Date().toISOString() : null);

    } else if (type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await upsertSubscriber(env, sub.customer, null, 'free', 'cancelled', null, new Date().toISOString());
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout — POST /subscription/checkout
//
// Plans-Stripe-1 (18 Oct 2026): runs only after the person presses "Continue to
// payment" on Plans, and only with a Turnstile token. A missing or failed token
// is refused before any Stripe call, so no Stripe customer or subscription
// exists until a person has pressed (row 26). Token in the JSON body — no new
// request header. Plans has its own Turnstile widget (secret
// TURNSTILE_PLANS_SECRET_KEY, hostname var PLANS_TURNSTILE_HOSTNAME): a token
// from the app's widget never opens checkout, and a Plans token never opens an
// upload. When Plans moves to pay.refueler.io, change the var + the widget.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  // Stripe-Account-1 (S-4): Plans names the plan; the Worker maps it to the
  // exact lookup key and asks Stripe for the price. No price IDs here or on Plans.
  const { plan, email } = body;
  if (!plan || !email) return err(400, 'Missing plan or email');
  if (typeof plan !== 'string' || !Object.hasOwn(CITIZEN_LOOKUP_KEYS, plan)) return err(400, 'Invalid plan');

  if (!(await verifyTurnstileToken(body.turnstile_token, env.TURNSTILE_PLANS_SECRET_KEY, env.PLANS_TURNSTILE_HOSTNAME))) {
    return err(403, 'Check failed. Please try again.');
  }

  try {
    const priceId = await resolveCitizenPrice(plan, env.STRIPE_SECRET_KEY);
    const { clientSecret } = await createCheckoutSession(priceId, email, env.STRIPE_SECRET_KEY);
    return json({ client_secret: clientSecret });
  } catch (e) {
    console.error('Checkout error:', e);
    return err(500, 'Checkout session creation failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /subscription/status and POST /subscription/portal — REMOVED (B12-4a task 0)
//
// Both took an unproven email: status answered "is this address a subscriber"
// for anyone, and portal opened ANY subscriber's Stripe Customer Portal for
// whoever typed their email. index.js now answers both with 410. The portal
// returns at B12-6 as POST /billing/portal behind the S6 session (B12-SR S6.9).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Stripe helpers
// ─────────────────────────────────────────────────────────────────────────────
export async function upsertSubscriber(env, stripeCustomerId, email, tier, status, currentPeriodEnd, cancelledAt = null) {
  const payload = {
    stripe_customer_id: stripeCustomerId,
    tier,
    status,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (email) payload.email = email;
  if (cancelledAt) payload.cancelled_at = cancelledAt;

  const res = await supabaseFetch(env, 'POST', '/rest/v1/subscribers?on_conflict=stripe_customer_id', payload, {
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  });
  // Stripe-Account-1: a refused write throws → the webhook answers 500 and Stripe retries.
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status}`);
}
