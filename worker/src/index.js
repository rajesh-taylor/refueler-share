/**
 * index.js — Cloudflare Worker — refueler-share
 *
 * Endpoints:
 *   POST /credential/issue              NUT-00 blind sig issuance (free tier)
 *   PUT  /upload/{uuid}/{chunk}         Chunked upload with NUT-00 credential verify
 *   POST /auth/{uuid}                   NUT-11 Mode 1: passphrase verify → download token
 *   GET  /download/{uuid}/{chunk}       R2 chunk proxy
 *   POST /webhook/stripe                Stripe subscription lifecycle
 *   POST /subscription/checkout         Create Stripe Checkout session (Payment Element)
 *   GET  /subscription/status           Returns tier for current session
 *   POST /subscription/portal           Create Stripe Customer Portal session
 *
 * Secrets (wrangler secret put):
 *   MINT_PRIVATE_KEY        secp256k1 hex (32 bytes)
 *   TURNSTILE_SECRET_KEY    Cloudflare Turnstile secret
 *   SUPABASE_URL            https://tihgvdokeofnjxjkenmm.supabase.co
 *   SUPABASE_SERVICE_KEY    service_role JWT
 *   STRIPE_SECRET_KEY       sk_live_...
 *   STRIPE_WEBHOOK_SECRET   whsec_...
 */

import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { verifyChunkHash } from './blake3.js';
import {
  getManifest, putManifest, createManifest,
  isDownloadBlocked, requiresPassphrase,
  TIER_CAPS,
} from './manifest.js';
import {
  hashSecret, timingSafeEqual,
  issueDownloadToken, verifyDownloadToken,
} from './nut11.js';
import { verifyStripeWebhook, createCheckoutSession } from './stripe.js';

// ---------------------------------------------------------------------------
// CORS headers — allow share.refueler.io and upgrade.refueler.io
// ---------------------------------------------------------------------------
function corsHeaders(request) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = ['https://share.refueler.io', 'https://upgrade.refueler.io'];
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cashu-Credential, X-Blake3-Root, X-Blake3-Chunk-Hash, X-Total-Chunks, X-Total-Bytes, X-Tier, X-Expiry-Timestamp, X-P2SH-Secret-Hash, X-File-Name',
    'Access-Control-Expose-Headers': 'X-File-Name',
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // POST /credential/issue
      if (request.method === 'POST' && path === '/credential/issue') {
        return addCors(await handleCredentialIssue(request, env), request);
      }

      // PUT /upload/{uuid}/{chunk-index}
      const uploadMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'PUT' && uploadMatch) {
        return addCors(await handleUpload(request, env, uploadMatch[1], parseInt(uploadMatch[2], 10)), request);
      }

      // POST /auth/{uuid}
      const authMatch = path.match(/^\/auth\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && authMatch) {
        return addCors(await handleAuth(request, env, authMatch[1]), request);
      }

      // GET /download/{uuid}/{chunk-index}
      const downloadMatch = path.match(/^\/download\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'GET' && downloadMatch) {
        return addCors(await handleDownload(request, env, downloadMatch[1], parseInt(downloadMatch[2], 10)), request);
      }

      // POST /webhook/stripe
      if (request.method === 'POST' && path === '/webhook/stripe') {
        return handleStripeWebhook(request, env);
      }

      // POST /subscription/checkout
      if (request.method === 'POST' && path === '/subscription/checkout') {
        return addCors(await handleCheckout(request, env), request);
      }

      // GET /subscription/status
      if (request.method === 'GET' && path === '/subscription/status') {
        return addCors(await handleSubscriptionStatus(request, env), request);
      }

      // POST /subscription/portal
      if (request.method === 'POST' && path === '/subscription/portal') {
        return addCors(await handlePortal(request, env), request);
      }

      return new Response('Not found', { status: 404 });
    } catch (e) {
      console.error('Worker error:', e);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /credential/issue
// ---------------------------------------------------------------------------
async function handleCredentialIssue(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON'); }

  const { turnstile_token, blinded_message, tier = 'free' } = body;
  if (!turnstile_token || !blinded_message) return err(400, 'Missing turnstile_token or blinded_message');

  const turnstileOk = await verifyTurnstileToken(turnstile_token, env.TURNSTILE_SECRET_KEY);
  if (!turnstileOk) return err(403, 'Turnstile verification failed');

  const allocationBytes = TIER_CAPS[tier] ?? TIER_CAPS.free;

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, env.MINT_PRIVATE_KEY));
  } catch (e) {
    console.error('Blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  return json({ signed_point: signedPoint, mint_pubkey: mintPubkey, allocation_bytes: allocationBytes });
}

// ---------------------------------------------------------------------------
// PUT /upload/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------
async function handleUpload(request, env, uuid, chunkIndex) {
  const isFirstChunk = chunkIndex === 0;

  if (isFirstChunk) {
    const credential  = request.headers.get('X-Cashu-Credential');
    const blake3Root  = request.headers.get('X-Blake3-Root');
    const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
    const totalBytes  = parseInt(request.headers.get('X-Total-Bytes') ?? '0', 10);
    const tier        = request.headers.get('X-Tier') ?? 'free';
    const expiryTs    = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
    const chunkHash   = request.headers.get('X-Blake3-Chunk-Hash');
    const p2shHash    = request.headers.get('X-P2SH-Secret-Hash') ?? null;
    const rawFileName = request.headers.get('X-File-Name') ?? '';
    // Sanitise: strip path separators, limit length, fall back to uuid prefix
    const fileName    = rawFileName.replace(/[/\\]/g, '').slice(0, 255) || `refueler-${uuid.slice(0, 8)}`;

    if (!credential || !blake3Root || !totalChunks || !totalBytes || !expiryTs || !chunkHash) {
      return err(400, 'Missing required headers');
    }

    let serial;
    try {
      const credentialObj = JSON.parse(credential);
      serial = await verifyCredential(credentialObj, env.MINT_PRIVATE_KEY);
    } catch {
      return err(401, 'Invalid credential');
    }

    const spentRes = await supabaseFetch(env, 'GET', `/rest/v1/spent_tokens?serial=eq.${encodeURIComponent(serial)}&select=serial`);
    if (!spentRes.ok) return err(502, 'Ledger unavailable');
    const spent = await spentRes.json();
    if (spent.length > 0) return err(409, 'Credential already spent');

    const cap = TIER_CAPS[tier] ?? TIER_CAPS.free;
    if (totalBytes > cap) return err(413, `Exceeds ${tier} tier cap`);

    const chunkBody = await request.arrayBuffer();
    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHash);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    const manifest = createManifest({
      uuid, tier, totalChunks, totalBytes,
      expiryTimestamp: expiryTs,
      blake3Root,
      p2shSecretHash: p2shHash,
    });
    manifest.file_name = fileName;
    manifest.chunks_received = [0];
    await putManifest(env.BUCKET, uuid, manifest);

    const meltRes = await supabaseFetch(env, 'POST', '/rest/v1/spent_tokens', { serial });
    if (!meltRes.ok) console.error('NUT-07 melt failed:', serial, await meltRes.text());

    return json({ ok: true, chunk: 0, uuid });

  } else {
    const manifest = await getManifest(env.BUCKET, uuid);
    if (!manifest) return err(404, 'Transfer not found');
    if (manifest.upload_complete) return err(409, 'Upload already complete');

    const now = Math.floor(Date.now() / 1000);
    if (now > manifest.expiry_timestamp) return err(410, 'Transfer expired');

    const chunkHashHeader = request.headers.get('X-Blake3-Chunk-Hash');
    if (!chunkHashHeader) return err(400, 'Missing X-Blake3-Chunk-Hash');

    const chunkBody = await request.arrayBuffer();
    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHashHeader);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    manifest.chunks_received.push(chunkIndex);
    if (manifest.chunks_received.length === manifest.total_chunks) {
      manifest.upload_complete = true;
    }
    await putManifest(env.BUCKET, uuid, manifest);

    return json({ ok: true, chunk: chunkIndex, uuid });
  }
}

// ---------------------------------------------------------------------------
// POST /auth/{uuid}
// ---------------------------------------------------------------------------
async function handleAuth(request, env, uuid) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON'); }

  const { passphrase } = body;
  if (!passphrase || typeof passphrase !== 'string') return err(400, 'Missing passphrase');

  const manifest = await getManifest(env.BUCKET, uuid);
  if (!manifest) return err(404, 'Transfer not found');
  if (!requiresPassphrase(manifest)) return err(400, 'Transfer is not passphrase-protected');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  const submitted = await hashSecret(passphrase);
  const match = timingSafeEqual(submitted, manifest.p2sh_secret_hash);

  if (!match) {
    await new Promise(r => setTimeout(r, 200));
    return err(401, 'Incorrect passphrase');
  }

  const token = await issueDownloadToken(uuid, env.MINT_PRIVATE_KEY);
  return json({ token });
}

// ---------------------------------------------------------------------------
// GET /download/{uuid}/{chunk-index}
// ---------------------------------------------------------------------------
async function handleDownload(request, env, uuid, chunkIndex) {
  const manifest = await getManifest(env.BUCKET, uuid);
  if (!manifest) return err(404, 'Transfer not found');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  if (requiresPassphrase(manifest)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return err(401, 'Download token required');

    const { valid, uuid: tokenUuid } = await verifyDownloadToken(token, env.MINT_PRIVATE_KEY);
    if (!valid || tokenUuid !== uuid) return err(401, 'Invalid or expired download token');
  }

  if (chunkIndex === 0 && !manifest.download_initiated_at) {
    manifest.download_initiated_at = Math.floor(Date.now() / 1000);
    await putManifest(env.BUCKET, uuid, manifest);
  }

  const key = `${uuid}/${String(chunkIndex).padStart(4, '0')}`;
  const obj = await env.BUCKET.get(key, {
    range: request.headers.has('Range') ? parseRange(request.headers.get('Range')) : undefined,
  });

  if (!obj) return err(404, 'Chunk not found');

  const status = request.headers.has('Range') ? 206 : 200;
  const headers = new Headers({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'X-Transfer-UUID': uuid,
    'X-Chunk-Index': String(chunkIndex),
    'X-File-Name': manifest.file_name ?? `refueler-${uuid.slice(0, 8)}`,
  });
  if (obj.range) {
    headers.set('Content-Range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
  }

  return new Response(obj.body, { status, headers });
}

// ---------------------------------------------------------------------------
// POST /subscription/portal
// ---------------------------------------------------------------------------
async function handlePortal(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON'); }

  const { email } = body;
  if (!email) return err(400, 'Missing email');

  // Look up Stripe customer ID from Supabase
  const res = await supabaseFetch(env, 'GET',
    `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=stripe_customer_id,status&limit=1`
  );
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || !rows[0].stripe_customer_id) {
    return err(404, 'No active subscription found for this email');
  }
  if (rows[0].status === 'cancelled') {
    return err(404, 'No active subscription found for this email');
  }

  const customerId = rows[0].stripe_customer_id;

  // Create Stripe billing portal session
  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: customerId,
      return_url: 'https://share.refueler.io/upgrade.html',
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

// ---------------------------------------------------------------------------
// POST /webhook/stripe
// ---------------------------------------------------------------------------
async function handleStripeWebhook(request, env) {
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
      const session = event.data.object;
      if (session.mode !== 'subscription') return new Response('ok');

      const customerId = session.customer;
      const email = session.customer_details?.email ?? session.customer_email ?? '';
      const subId = session.subscription;

      // Fetch subscription to get price lookup key → tier
      const tier = await fetchTierFromSubscription(subId, env.STRIPE_SECRET_KEY);
      const periodEnd = await fetchPeriodEnd(subId, env.STRIPE_SECRET_KEY);

      await upsertSubscriber(env, customerId, email, tier, 'active', periodEnd);

    } else if (type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const customerId = sub.customer;
      const tier = tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
      const status = sub.status === 'active' ? 'active' : 'inactive';
      const periodEnd = sub.current_period_end;

      await upsertSubscriber(env, customerId, null, tier, status, periodEnd);

    } else if (type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await upsertSubscriber(env, sub.customer, null, 'free', 'cancelled', null);
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('ok', { status: 200 });
}

// ---------------------------------------------------------------------------
// POST /subscription/checkout
// ---------------------------------------------------------------------------
async function handleCheckout(request, env) {
  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON'); }

  const { price_id, email } = body;
  if (!price_id || !email) return err(400, 'Missing price_id or email');

  const validPriceIds = [
    'price_1Ts7lsGlctwiB9U3hdtgChU2',
    'price_1Ts7sqGlctwiB9U3YRloCFfi',
    'price_1Ts7vIGlctwiB9U3kb3NCLue',
    'price_1Ts7xIGlctwiB9U3JyZB8Kwj',
  ];
  if (!validPriceIds.includes(price_id)) return err(400, 'Invalid price_id');

  try {
    const { clientSecret } = await createCheckoutSession(
      price_id,
      email,
      'https://share.refueler.io/upgrade?success=1',
      'https://share.refueler.io/upgrade?cancelled=1',
      env.STRIPE_SECRET_KEY
    );
    return json({ client_secret: clientSecret });
  } catch (e) {
    console.error('Checkout error:', e);
    return err(500, 'Checkout session creation failed');
  }
}

// ---------------------------------------------------------------------------
// GET /subscription/status
// ---------------------------------------------------------------------------
async function handleSubscriptionStatus(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  if (!email) return err(400, 'Missing email');

  const res = await supabaseFetch(env, 'GET',
    `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=tier,status,current_period_end&limit=1`
  );
  if (!res.ok) return err(502, 'Database unavailable');
  const rows = await res.json();

  if (!rows.length || rows[0].status === 'cancelled') {
    return json({ tier: 'free', status: 'inactive' });
  }

  const { tier, status, current_period_end } = rows[0];
  return json({ tier, status, current_period_end });
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------
async function fetchTierFromSubscription(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return 'free';
  const sub = await res.json();
  return tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
}

async function fetchPeriodEnd(subId, secretKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { 'Authorization': `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const sub = await res.json();
  return sub.current_period_end ?? null;
}

function tierFromPriceKey(lookupKey) {
  if (lookupKey.includes('max')) return 'max';
  if (lookupKey.includes('creative')) return 'creative';
  return 'free';
}

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------
async function upsertSubscriber(env, stripeCustomerId, email, tier, status, currentPeriodEnd) {
  const payload = {
    stripe_customer_id: stripeCustomerId,
    tier,
    status,
    current_period_end: currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  if (email) payload.email = email;

  const res = await supabaseFetch(env, 'POST', '/rest/v1/subscribers', payload, {
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  });
  if (!res.ok) {
    console.error('Supabase upsert failed:', await res.text());
  }
}

async function supabaseFetch(env, method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${env.SUPABASE_URL}${path}`, opts);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function addCors(response, request) {
  const headers = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

function parseRange(rangeHeader) {
  const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  const offset = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}
