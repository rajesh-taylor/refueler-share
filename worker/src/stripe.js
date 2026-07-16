/**
 * stripe.js — Stripe webhook verification and subscription helpers
 *
 * Handles:
 *   - Webhook signature verification (HMAC-SHA256, Stripe's svix-style format)
 *   - Subscription status lookup from Supabase
 *   - Checkout session creation
 */

/**
 * verifyStripeWebhook(request, webhookSecret) → event object or throws
 *
 * Stripe sends: Stripe-Signature header with t=timestamp,v1=hmac
 * We verify: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) === v1
 */
export async function verifyStripeWebhook(request, webhookSecret) {
  const sig = request.headers.get('Stripe-Signature');
  if (!sig) throw new Error('Missing Stripe-Signature header');

  const rawBody = await request.text();

  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const v1 = parts.v1;

  if (!timestamp || !v1) throw new Error('Invalid Stripe-Signature format');

  // Replay attack protection — reject events older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    throw new Error('Webhook timestamp too old');
  }

  const signed = `${timestamp}.${rawBody}`;
  const keyBytes = new TextEncoder().encode(webhookSecret);
  const msgBytes = new TextEncoder().encode(signed);

  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig256 = await crypto.subtle.sign('HMAC', key, msgBytes);
  const computed = bytesToHex(new Uint8Array(sig256));

  if (!timingSafeEqual(computed, v1)) {
    throw new Error('Webhook signature mismatch');
  }

  return JSON.parse(rawBody);
}

/**
 * createCheckoutSession(priceId, customerEmail, successUrl, cancelUrl, stripeSecretKey)
 * → { clientSecret, subscriptionId }
 *
 * Creates (or reuses) a Stripe Customer, then creates a Subscription with
 * payment_behavior=default_incomplete, which surfaces a PaymentIntent client_secret
 * compatible with stripe.elements() + stripe.confirmPayment() in the frontend.
 */
export async function createCheckoutSession(priceId, customerEmail, successUrl, cancelUrl, stripeSecretKey) {
  // 1. Find or create customer by email
  const searchRes = await stripeFetch(
    `/v1/customers?email=${encodeURIComponent(customerEmail)}&limit=1`,
    'GET', null, stripeSecretKey
  );
  if (!searchRes.ok) throw new Error(`Stripe customer search error: ${await searchRes.text()}`);
  const searchData = await searchRes.json();

  let customerId;
  if (searchData.data && searchData.data.length > 0) {
    customerId = searchData.data[0].id;
  } else {
    const createRes = await stripeFetch('/v1/customers', 'POST',
      new URLSearchParams({ email: customerEmail }), stripeSecretKey);
    if (!createRes.ok) throw new Error(`Stripe customer create error: ${await createRes.text()}`);
    const customer = await createRes.json();
    customerId = customer.id;
  }

  // 2. Create subscription with default_incomplete — produces a PaymentIntent
  const subParams = new URLSearchParams({
    'customer': customerId,
    'items[0][price]': priceId,
    'payment_behavior': 'default_incomplete',
    'payment_settings[save_default_payment_method]': 'on_subscription',
    'expand[0]': 'latest_invoice.payment_intent',
  });

  const subRes = await stripeFetch('/v1/subscriptions', 'POST', subParams, stripeSecretKey);
  if (!subRes.ok) throw new Error(`Stripe subscription error: ${await subRes.text()}`);
  const sub = await subRes.json();

  const clientSecret = sub.latest_invoice?.payment_intent?.client_secret;
  if (!clientSecret) throw new Error('No client_secret in subscription response');

  return { clientSecret, subscriptionId: sub.id };
}

/**
 * getSubscriptionTier(stripeCustomerId, stripeSecretKey) → 'free' | 'creative' | 'max'
 */
export async function getSubscriptionTier(stripeCustomerId, stripeSecretKey) {
  const res = await stripeFetch(
    `/v1/subscriptions?customer=${stripeCustomerId}&status=active&limit=1`,
    'GET', null, stripeSecretKey
  );
  if (!res.ok) return 'free';
  const data = await res.json();
  if (!data.data || data.data.length === 0) return 'free';

  const sub = data.data[0];
  const priceId = sub.items?.data?.[0]?.price?.lookup_key ?? '';

  if (priceId.includes('max')) return 'max';
  if (priceId.includes('creative')) return 'creative';
  return 'free';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stripeFetch(path, method, params, secretKey) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };
  if (params) opts.body = params.toString();
  return fetch(`https://api.stripe.com${path}`, opts);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
