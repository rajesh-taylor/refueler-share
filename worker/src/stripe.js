/**
 * stripe.js — Stripe webhook verification and the Stripe calls the Worker makes
 *
 * Handles:
 *   - Webhook signature verification (HMAC-SHA256, Stripe's svix-style format)
 *   - Citizen price resolve by lookup key, checkout (customer + subscription)
 *   - Subscription read for the webhook (re-fetched, never trusted from the event)
 *
 * Stripe-Account-1 (27 Oct 2026): every call pins STRIPE_API_VERSION, so the
 * account's default version and the webhook endpoint's version never change
 * the shapes read here. Field names checked against Stripe's changelog:
 *   - period end lives on the subscription item (Basil: removed from the
 *     subscription) → items.data[].current_period_end
 *   - the Payment Element secret is the invoice's confirmation_secret (Basil:
 *     invoice.payment_intent removed) → latest_invoice.confirmation_secret.client_secret
 */

export const STRIPE_API_VERSION = '2025-09-30.clover';

// Exact lookup keys (plan v1 §1). No substring match: any other key is not Citizen.
export const CITIZEN_LOOKUP_KEYS = Object.freeze({
  monthly: 'share-citizen-monthly',
  yearly:  'share-citizen-yearly',
});
const PLAN_INTERVAL = Object.freeze({ monthly: 'month', yearly: 'year' });
const CITIZEN_KEY_SET = new Set(Object.values(CITIZEN_LOOKUP_KEYS));

/** tierFromLookupKey('share-citizen-yearly') → 'citizen'; anything else → 'free'. */
export function tierFromLookupKey(lookupKey) {
  return CITIZEN_KEY_SET.has(lookupKey) ? 'citizen' : 'free';
}

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
 * resolveCitizenPrice(plan, stripeSecretKey) → price id
 *
 * plan 'monthly' | 'yearly' → its lookup key → GET /v1/prices. Exactly one
 * active GBP recurring price with the plan's interval, or it throws. No price
 * IDs live in the Worker or on Plans.
 */
export async function resolveCitizenPrice(plan, stripeSecretKey) {
  // own keys only: 'toString' / '__proto__' must not resolve through the prototype
  if (typeof plan !== 'string' || !Object.hasOwn(CITIZEN_LOOKUP_KEYS, plan)) throw new Error('Unknown plan');
  const lookupKey = CITIZEN_LOOKUP_KEYS[plan];
  const res = await stripeFetch(
    `/v1/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=2`,
    'GET', null, stripeSecretKey
  );
  if (!res.ok) throw new Error(`Stripe price lookup error: ${await res.text()}`);
  const data = await res.json();
  const prices = data.data ?? [];
  if (prices.length !== 1) throw new Error(`Expected one price for ${lookupKey}, found ${prices.length}`);
  const p = prices[0];
  if (p.lookup_key !== lookupKey || p.currency !== 'gbp' || p.type !== 'recurring'
      || p.recurring?.interval !== PLAN_INTERVAL[plan]) {
    throw new Error(`Price for ${lookupKey} is not a GBP ${PLAN_INTERVAL[plan]}ly recurring price`);
  }
  return p.id;
}

/**
 * createCheckoutSession(priceId, customerEmail, stripeSecretKey)
 * → { clientSecret, subscriptionId }
 *
 * Creates (or reuses) a Stripe Customer, then creates a Subscription with
 * payment_behavior=default_incomplete; its first invoice's confirmation_secret
 * feeds stripe.elements() + stripe.confirmPayment() on Plans.
 */
export async function createCheckoutSession(priceId, customerEmail, stripeSecretKey) {
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

  // 2. Create subscription with default_incomplete — its first invoice carries the secret
  const subParams = new URLSearchParams({
    'customer': customerId,
    'items[0][price]': priceId,
    'payment_behavior': 'default_incomplete',
    'payment_settings[save_default_payment_method]': 'on_subscription',
    // Plans-Stripe-1: card only — no Link ("Onelink" / "Save my information"), which follows
    // buyers across shops. Apple Pay still works (a card wallet); Google Pay is off on the page.
    'payment_settings[payment_method_types][0]': 'card',
    'expand[0]': 'latest_invoice.confirmation_secret',
  });

  const subRes = await stripeFetch('/v1/subscriptions', 'POST', subParams, stripeSecretKey);
  if (!subRes.ok) throw new Error(`Stripe subscription error: ${await subRes.text()}`);
  const sub = await subRes.json();

  const clientSecret = sub.latest_invoice?.confirmation_secret?.client_secret;
  if (!clientSecret) throw new Error('No client_secret in subscription response');

  return { clientSecret, subscriptionId: sub.id };
}

/** fetchSubscription(subId, stripeSecretKey) → subscription object, or null on any refusal. */
export async function fetchSubscription(subId, stripeSecretKey) {
  if (typeof subId !== 'string' || !/^sub_[A-Za-z0-9]+$/.test(subId)) return null;
  const res = await stripeFetch(`/v1/subscriptions/${subId}`, 'GET', null, stripeSecretKey);
  if (!res.ok) return null;
  return res.json();
}

/** fetchCustomerEmail(customerId, stripeSecretKey) → email or null. */
export async function fetchCustomerEmail(customerId, stripeSecretKey) {
  if (typeof customerId !== 'string' || !/^cus_[A-Za-z0-9]+$/.test(customerId)) return null;
  const res = await stripeFetch(`/v1/customers/${customerId}`, 'GET', null, stripeSecretKey);
  if (!res.ok) return null;
  const c = await res.json();
  return c.email ?? null;
}

/**
 * citizenItem(sub) → the subscription item on a Citizen price, else the first item.
 * Its price.lookup_key gives the tier and its current_period_end the paid-until.
 */
export function citizenItem(sub) {
  const items = sub?.items?.data ?? [];
  return items.find(i => CITIZEN_KEY_SET.has(i?.price?.lookup_key)) ?? items[0] ?? null;
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
      'Stripe-Version': STRIPE_API_VERSION,
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
