// worker/src/handlers/stripe_sub.js
//
// SW9a — Extracted from index.js (Phase 2).
// Stripe subscription handlers: webhook, checkout.
// Stripe helper functions: fetchTierFromSubscription, fetchPeriodEnd,
//   tierFromPriceKey, upsertSubscriber.
//
// All imports from ./utils.js — never from index.js.
// Stripe API client calls use env.STRIPE_SECRET_KEY directly.

import { verifyStripeWebhook, createCheckoutSession } from '../stripe.js';
import { supabaseFetch, json, err }                   from '../utils.js';
import { verifyTurnstileToken }                     from '../turnstile.js';

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — POST /webhook/stripe
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
    if (type === 'checkout.session.completed') {
      const session    = event.data.object;
      if (session.mode !== 'subscription') return new Response('ok');
      const customerId = session.customer;
      const email      = session.customer_details?.email ?? session.customer_email ?? '';
      const subId      = session.subscription;
      const tier       = await fetchTierFromSubscription(subId, env.STRIPE_SECRET_KEY);
      const periodEnd  = await fetchPeriodEnd(subId, env.STRIPE_SECRET_KEY);
      await upsertSubscriber(env, customerId, email, tier, 'active', periodEnd);

    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const tier       = tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
      const status     = (sub.status === 'active' || sub.status === 'incomplete') ? 'active' : 'inactive';
      const periodEnd  = sub.current_period_end;
      let email = null;
      try {
        const custRes = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
        });
        if (custRes.ok) { const c = await custRes.json(); email = c.email ?? null; }
      } catch {}
      await upsertSubscriber(env, customerId, email, tier, status, periodEnd);

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
// request header.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { price_id, email } = body;
  if (!price_id || !email) return err(400, 'Missing price_id or email');

  const validPriceIds = [
    // live
    'price_1Ts7lsGlctwiB9U3hdtgChU2',
    'price_1Ts7sqGlctwiB9U3YRloCFfi',
    'price_1Ts7vIGlctwiB9U3kb3NCLue',
    'price_1Ts7xIGlctwiB9U3JyZB8Kwj',
    // test
    'price_1TtnCEGlctwiB9U3tErRazp2',
    'price_1TtnD0GlctwiB9U3UzFr27Zl',
    'price_1TtnDVGlctwiB9U3BYGRnWl6',
    'price_1TtnETGlctwiB9U3UJH3uaA',
  ];
  if (!validPriceIds.includes(price_id)) return err(400, 'Invalid price_id');

  if (!(await verifyTurnstileToken(body.turnstile_token, env.TURNSTILE_SECRET_KEY))) {
    return err(403, 'Check failed. Please try again.');
  }

  try {
    const { clientSecret } = await createCheckoutSession(
      price_id, email,
      'https://refueler.io/share/upgrade/?success=1',
      'https://refueler.io/share/upgrade/?cancelled=1',
      env.STRIPE_SECRET_KEY
    );
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
export async function fetchTierFromSubscription(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return 'free';
  const sub = await res.json();
  return tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
}

export async function fetchPeriodEnd(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const sub = await res.json();
  return sub.current_period_end ?? null;
}

export function tierFromPriceKey(lookupKey) {
  if (lookupKey.includes('max'))      return 'max';
  if (lookupKey.includes('creative')) return 'creative';
  return 'free';
}

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
  if (!res.ok) {
    console.error('Supabase upsert failed:', await res.text());
  }
}
