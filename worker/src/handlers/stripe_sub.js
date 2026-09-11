// worker/src/handlers/stripe_sub.js
//
// SW9a — Extracted from index.js (Phase 2).
// Stripe subscription handlers: webhook, checkout, status, portal.
// Stripe helper functions: fetchTierFromSubscription, fetchPeriodEnd,
//   tierFromPriceKey, upsertSubscriber.
//
// All imports from ./utils.js — never from index.js.
// Stripe API client calls use env.STRIPE_SECRET_KEY directly.

import { verifyStripeWebhook, createCheckoutSession } from '../stripe.js';
import { supabaseFetch, json, err }                   from '../utils.js';

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
// Subscription status — GET /subscription/status
// ─────────────────────────────────────────────────────────────────────────────
export async function handleSubscriptionStatus(request, env) {
  const url   = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return err(400, 'Missing email');

  const res = await supabaseFetch(env, 'GET', `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=tier,status,current_period_end&limit=1`);
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || rows[0].status === 'cancelled') {
    return json({ tier: 'free', status: 'inactive' });
  }

  const { tier, status, current_period_end } = rows[0];
  return json({ tier, status, current_period_end });
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal — POST /subscription/portal
// ─────────────────────────────────────────────────────────────────────────────
export async function handlePortal(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { email } = body;
  if (!email) return err(400, 'Missing email');

  const res = await supabaseFetch(env, 'GET', `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=stripe_customer_id,status&limit=1`);
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || !rows[0].stripe_customer_id) {
    return err(404, 'No active subscription found for this email');
  }
  if (rows[0].status === 'cancelled') {
    return err(404, 'No active subscription found for this email');
  }

  const customerId = rows[0].stripe_customer_id;
  const portalRes  = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer:   customerId,
      return_url: 'https://refueler.io/share/upgrade/',
    }).toString(),
  });

  if (!portalRes.ok) {
    const portalErr = await portalRes.json();
    console.error('Portal session error:', portalErr);
    return err(502, 'Could not create portal session');
  }

  const session = await portalRes.json();
  return json({ url: session.url });
}

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
