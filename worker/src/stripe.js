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
 * createCheckoutSession(priceId, successUrl, cancelUrl, stripeSecretKey) → { clientSecret, sessionId }
 */
export async function createCheckoutSession(priceId, customerEmail, successUrl, cancelUrl, stripeSecretKey) {
  const params = new URLSearchParams({
    'mode': 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'ui_mode': 'embedded',
    'customer_email': customerEmail,
    'allow_promotion_codes': 'true',
  });

  const res = await stripeFetch('/v1/checkout/sessions', 'POST', params, stripeSecretKey);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stripe checkout error: ${err}`);
  }
  const session = await res.json();
  return { clientSecret: session.client_secret, sessionId: session.id };
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
