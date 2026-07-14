import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { verifyChunkHash } from './blake3.js';
import { getManifest, putManifest, createManifest, isExpired, isInGracePeriod, isDownloadBlocked, requiresPassphrase, TIER_CAPS } from './manifest.js';
import { hashSecret, timingSafeEqual, issueDownloadToken, verifyDownloadToken } from './nut11.js';
import { verifyStripeWebhook, createCheckoutSession } from './stripe.js';

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine
// Dataset: share_events (bound as AE in wrangler.toml)
//
// Schema (one data point per request):
//   blobs:   [endpoint, tier, error_message]
//   doubles: [latency_ms, status_code, chunk_index, total_chunks, total_bytes]
//   indexes: [endpoint]   <- enables fast GROUP BY in AE SQL
// ─────────────────────────────────────────────────────────────────────────────
function logEvent(env, {
  endpoint,
  tier        = 'free',
  status      = 200,
  latency     = 0,
  chunkIndex  = -1,
  totalChunks = 0,
  totalBytes  = 0,
  errorMsg    = '',
}) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, errorMsg],
      doubles: [latency, status, chunkIndex, totalChunks, totalBytes],
      indexes: [endpoint],
    });
  } catch (e) {
    console.error('AE write failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url  = new URL(request.url);
    const path = url.pathname;
    const t0   = performance.now();

    async function timed(endpoint, handler, logExtra = {}) {
      try {
        const response = await handler();
        const latency  = performance.now() - t0;
        logEvent(env, { endpoint, status: response.status, latency, ...logExtra });
        return response;
      } catch (e) {
        const latency = performance.now() - t0;
        logEvent(env, { endpoint, status: 500, latency, errorMsg: e?.message ?? 'unknown', ...logExtra });
        throw e;
      }
    }

    try {
      if (request.method === 'GET' && path === '/status') {
        return timed('status', () => handleStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/admin/status') {
        return timed('admin_status', () => handleAdminStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/credential/issue') {
        const cloned = request.clone();
        let credTier = 'free';
        try { const b = await cloned.json(); credTier = b.tier ?? 'free'; } catch {}
        return timed('credential_issue', () => handleCredentialIssue(request, env).then(r => addCors(r, request)), { tier: credTier });
      }

      const uploadMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'PUT' && uploadMatch) {
        const chunkIndex  = parseInt(uploadMatch[2], 10);
        const tier        = request.headers.get('X-Tier') ?? 'free';
        const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
        const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
        return timed('upload', () => handleUpload(request, env, uploadMatch[1], chunkIndex).then(r => addCors(r, request)), {
          tier, chunkIndex,
          totalChunks: chunkIndex === 0 ? totalChunks : 0,
          totalBytes:  chunkIndex === 0 ? totalBytes  : 0,
        });
      }

      const authMatch = path.match(/^\/auth\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && authMatch) {
        return timed('auth', () => handleAuth(request, env, authMatch[1]).then(r => addCors(r, request)));
      }

      const downloadMatch = path.match(/^\/download\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'GET' && downloadMatch) {
        const chunkIndex = parseInt(downloadMatch[2], 10);
        return timed('download', async () => {
          const response = await handleDownload(request, env, downloadMatch[1], chunkIndex);
          return addCors(response, request);
        }, { chunkIndex });
      }

      if (request.method === 'POST' && path === '/webhook/stripe') {
        return timed('webhook_stripe', () => handleStripeWebhook(request, env));
      }

      if (request.method === 'POST' && path === '/subscription/checkout') {
        return timed('subscription_checkout', () => handleCheckout(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/subscription/status') {
        return timed('subscription_status', () => handleSubscriptionStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/subscription/portal') {
        return timed('subscription_portal', () => handlePortal(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/metrics') {
        return timed('admin_metrics', () => handleAdminMetrics(request, env).then(r => addCors(r, request)));
      }

      logEvent(env, { endpoint: 'unknown', status: 404, latency: performance.now() - t0 });
      return new Response('Not found', { status: 404 });

    } catch (e) {
      const latency = performance.now() - t0;
      logEvent(env, { endpoint: 'unhandled', status: 500, latency, errorMsg: e?.message ?? 'unknown' });
      console.error('Worker error:', e);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
      });
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Status — GET /status
// ─────────────────────────────────────────────────────────────────────────────
async function handleStatus(request, env) {
  let current = null;
  try {
    const raw = await env.STATUS_KV.get('status:current', { type: 'json' });
    current = raw;
  } catch (e) {
    console.error('KV read error:', e);
  }

  if (!current) {
    current = {
      state:       'operational',
      message:     null,
      maintenance: null,
      incidents:   [],
      updated_at:  Math.floor(Date.now() / 1000),
    };
  }

  return json(current);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin status — POST /admin/status
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminStatus(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const validStates = ['operational', 'degraded', 'maintenance'];
  if (body.state !== undefined && !validStates.includes(body.state)) {
    return err(400, `Invalid state. Must be one of: ${validStates.join(', ')}`);
  }

  let current = null;
  try {
    current = await env.STATUS_KV.get('status:current', { type: 'json' });
  } catch {}

  if (!current) {
    current = {
      state:       'operational',
      message:     null,
      maintenance: null,
      incidents:   [],
      updated_at:  Math.floor(Date.now() / 1000),
    };
  }

  const updated = {
    ...current,
    ...body,
    updated_at: Math.floor(Date.now() / 1000),
  };

  try {
    await env.STATUS_KV.put('status:current', JSON.stringify(updated));
  } catch (e) {
    console.error('KV write error:', e);
    return err(502, 'Failed to write status to KV');
  }

  return json({ ok: true, status: updated });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential issue — POST /credential/issue
// ─────────────────────────────────────────────────────────────────────────────
async function handleCredentialIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Upload — PUT /upload/:uuid/:chunk
// ─────────────────────────────────────────────────────────────────────────────
async function handleUpload(request, env, uuid, chunkIndex) {
  const isFirstChunk = chunkIndex === 0;

  if (isFirstChunk) {
    const credential  = request.headers.get('X-Cashu-Credential');
    const blake3Root  = request.headers.get('X-Blake3-Root');
    const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
    const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
    const tier        = request.headers.get('X-Tier') ?? 'free';
    const expiryTs    = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
    const chunkHash   = request.headers.get('X-Blake3-Chunk-Hash');
    const p2shHash    = request.headers.get('X-P2SH-Secret-Hash') ?? null;
    const rawFileName = request.headers.get('X-File-Name') ?? '';
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

    // ── Double-spend detected ────────────────────────────────────────────────
    // Fire-and-forget audit write — never blocks the 409 response.
    // On Supabase failure: log and continue (same pattern as NUT-07 melt).
    if (spent.length > 0) {
      supabaseFetch(env, 'POST', '/rest/v1/double_spend_attempts', {
        serial,
        uuid,
        attempted_at: new Date().toISOString(),
      }).then(r => {
        if (!r.ok) r.text().then(t => console.error('double_spend_attempts write failed:', t));
      }).catch(e => console.error('double_spend_attempts fetch error:', e));

      return err(409, 'Credential already spent');
    }

    const cap = TIER_CAPS[tier] ?? TIER_CAPS.free;
    if (totalBytes > cap) return err(413, `Exceeds ${tier} tier cap`);

    const chunkBody = await request.arrayBuffer();
    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHash);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    const manifest = createManifest({ uuid, tier, totalChunks, totalBytes, expiryTimestamp: expiryTs, blake3Root, p2shSecretHash: p2shHash });
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

// ─────────────────────────────────────────────────────────────────────────────
// Auth — POST /auth/:uuid
// ─────────────────────────────────────────────────────────────────────────────
async function handleAuth(request, env, uuid) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Download — GET /download/:uuid/:chunk
// ─────────────────────────────────────────────────────────────────────────────
async function handleDownload(request, env, uuid, chunkIndex) {
  const manifest = await getManifest(env.BUCKET, uuid);
  if (!manifest) return err(404, 'Transfer not found');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  if (chunkIndex === 0) {
    logEvent(env, {
      endpoint:    'download_tier',
      tier:        manifest.tier ?? 'free',
      status:      200,
      latency:     0,
      totalChunks: manifest.total_chunks ?? 0,
      totalBytes:  manifest.total_bytes  ?? 0,
    });
  }

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
    'Content-Type':    'application/octet-stream',
    'Cache-Control':   'private, no-store',
    'X-Transfer-UUID': uuid,
    'X-Chunk-Index':   String(chunkIndex),
    'X-File-Name':     manifest.file_name ?? `refueler-${uuid.slice(0, 8)}`,
  });

  if (obj.range) {
    headers.set('Content-Range', `bytes ${obj.range.offset}-${obj.range.end}/${obj.size}`);
  }

  return new Response(obj.body, { status, headers });
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe webhook — POST /webhook/stripe
// ─────────────────────────────────────────────────────────────────────────────
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
      const session    = event.data.object;
      if (session.mode !== 'subscription') return new Response('ok');
      const customerId = session.customer;
      const email      = session.customer_details?.email ?? session.customer_email ?? '';
      const subId      = session.subscription;
      const tier       = await fetchTierFromSubscription(subId, env.STRIPE_SECRET_KEY);
      const periodEnd  = await fetchPeriodEnd(subId, env.STRIPE_SECRET_KEY);
      await upsertSubscriber(env, customerId, email, tier, 'active', periodEnd);

    } else if (type === 'customer.subscription.updated') {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const tier       = tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
      const status     = sub.status === 'active' ? 'active' : 'inactive';
      const periodEnd  = sub.current_period_end;
      await upsertSubscriber(env, customerId, null, tier, status, periodEnd);

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
async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

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
      price_id, email,
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

// ─────────────────────────────────────────────────────────────────────────────
// Subscription status — GET /subscription/status
// ─────────────────────────────────────────────────────────────────────────────
async function handleSubscriptionStatus(request, env) {
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
async function handlePortal(request, env) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Admin metrics — GET /admin/metrics
// X-Admin-Key protected.
//
// S19: mrr_gbp, subscribers_by_tier, paid_total, churn_rate_mtd
//
// S20 additions:
//   Metric 4 — credential_uniqueness_rate (Supabase: double_spend_attempts vs spent_tokens)
//   Metric 5 — r2_bytes_uploaded / r2_bytes_purged (null — AE SQL API, S22)
//   Metric 6 — r2_chunk_retrieval_success_rate (null — AE SQL API, S22)
//   Metric 3 — zk_verification_rate (null — needs has_passphrase AE logging, B4)
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminMetrics(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  const TIER_MRR = { creative: 12, max: 24 };

  try {
    // ── Active subscriber counts ──────────────────────────────────────────────
    const countRes = await supabaseFetch(env, 'GET', '/rest/v1/subscribers?status=eq.active&select=tier');
    if (!countRes.ok) return err(502, 'Database unavailable');
    const activeRows = await countRes.json();

    const subscribersByTier = { free: 0, creative: 0, max: 0 };
    for (const row of activeRows) {
      const t = row.tier ?? 'free';
      subscribersByTier[t] = (subscribersByTier[t] ?? 0) + 1;
    }

    const mrrGbp =
      (subscribersByTier.creative ?? 0) * TIER_MRR.creative +
      (subscribersByTier.max      ?? 0) * TIER_MRR.max;

    const paidTotal = (subscribersByTier.creative ?? 0) + (subscribersByTier.max ?? 0);

    // ── Churn rate MTD ────────────────────────────────────────────────────────
    const now          = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const churnRes = await supabaseFetch(
      env, 'GET',
      `/rest/v1/subscribers?status=eq.cancelled&cancelled_at=gte.${encodeURIComponent(startOfMonth)}&select=stripe_customer_id`
    );
    if (!churnRes.ok) return err(502, 'Database unavailable');
    const cancelledMtd = (await churnRes.json()).length;

    const activeStartOfMonth = paidTotal + cancelledMtd;
    const churnRateMtd = activeStartOfMonth > 0
      ? parseFloat(((cancelledMtd / activeStartOfMonth) * 100).toFixed(2))
      : 0;

    // ── Metric 4: Credential uniqueness rate ──────────────────────────────────
    // Uses Supabase Content-Range header for count without fetching rows:
    //   Prefer: count=exact + Range: 0-0 → Content-Range: 0-0/TOTAL
    // Rate = legitimate_melts / (legitimate_melts + replay_attempts)
    // Target: 1.0 (100%). Any value < 1.0 indicates active replay attacks.
    // Note: only counts 409s (credential verified but already spent).
    // Attacks failing verifyCredential() return 401 and are not captured here.
    const parseSbCount = (res) => {
      const cr = res.headers.get('Content-Range') ?? '';
      const m  = cr.match(/\/(\d+)$/);
      return m ? parseInt(m[1], 10) : null;
    };

    const [meltsRes, attemptsRes] = await Promise.all([
      supabaseFetch(env, 'GET', '/rest/v1/spent_tokens?select=serial',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
      supabaseFetch(env, 'GET', '/rest/v1/double_spend_attempts?select=id',
        null, { 'Prefer': 'count=exact', 'Range': '0-0' }),
    ]);

    const totalMelts    = meltsRes.ok    ? parseSbCount(meltsRes)    : null;
    const totalAttempts = attemptsRes.ok ? parseSbCount(attemptsRes) : null;

    let credentialUniquenessRate = null;
    let credentialUniquenessNote;

    if (totalMelts !== null && totalAttempts !== null) {
      const total = totalMelts + totalAttempts;
      credentialUniquenessRate = total > 0
        ? parseFloat((totalMelts / total).toFixed(4))
        : 1.0;
      credentialUniquenessNote =
        'Fraction of credential uses that were first-time (legitimate) melts. ' +
        '1.0 = no replay attacks observed. Excludes attacks failing verifyCredential() ' +
        'before the spent_tokens lookup (those return 401, not 409, and are not captured here).';
    } else {
      credentialUniquenessNote = 'Supabase count query failed — both spent_tokens and double_spend_attempts counts required.';
    }

    return json({
      as_of: new Date().toISOString(),

      // ── S19: Subscription / revenue metrics ──────────────────────────────
      mrr_gbp: mrrGbp,
      mrr_note: 'Conservative floor: monthly plan prices used for all tiers. Yearly subscribers (£120/yr creative, £240/yr max) are under-counted by £2–4/mo each. Accurate MRR requires Stripe API interval lookup (dashboard layer, S22).',
      subscribers_by_tier: subscribersByTier,
      paid_total: paidTotal,
      churn_rate_mtd_pct: churnRateMtd,
      cancelled_mtd: cancelledMtd,
      active_start_of_month_approx: activeStartOfMonth,
      churn_note: 'Approximation: active_now + cancelled_mtd. Under-counts if any subscriber signed up and cancelled within the current calendar month.',
      credential_issuances: null,
      credential_issuances_note: 'Requires Cloudflare AE SQL API (external REST call with account token). Computed in dashboard layer (S22).',

      // ── S20 Metric 4: Credential uniqueness rate ──────────────────────────
      credential_uniqueness_rate: credentialUniquenessRate,
      credential_uniqueness_total_melts: totalMelts,
      credential_uniqueness_total_attempts: totalAttempts,
      credential_uniqueness_note: credentialUniquenessNote,

      // ── S20 Metric 5: R2 sinks vs sources ────────────────────────────────
      // AE SQL for uploaded bytes (chunk 0 only, where total_bytes is logged):
      //   SELECT sum(doubles[4]) AS total_bytes_uploaded FROM share_events
      //   WHERE blob1 = 'upload' AND doubles[2] = 0
      //   AND timestamp > now() - INTERVAL '90' DAY;
      // Purged bytes: not directly measurable until R2 event notifications
      // are wired to an AE pipeline (B4 scope, alongside BLAKE3 WASM work).
      r2_bytes_uploaded: null,
      r2_bytes_purged: null,
      r2_storage_note: 'Both require Cloudflare AE SQL API (external REST, not Worker-callable). Uploaded bytes: sum(doubles[4]) WHERE blob1=upload AND doubles[2]=0. Purged bytes: not measurable until R2 event notifications wired to AE (B4). Computed in dashboard layer (S22).',

      // ── S20 Metric 6: R2 chunk retrieval success rate ─────────────────────
      // AE SQL (rolling 24h):
      //   SELECT
      //     countIf(blob3 != '') AS failed_chunks,
      //     count()              AS total_chunks,
      //     1 - (countIf(blob3 != '') / count()) AS success_rate
      //   FROM share_events
      //   WHERE blob1 = 'download'
      //   AND timestamp > now() - INTERVAL '1' DAY;
      r2_chunk_retrieval_success_rate: null,
      r2_chunk_retrieval_note: "Requires Cloudflare AE SQL API. Query: 1 - (countIf(blob3 != '') / count()) WHERE blob1='download'. Computed in dashboard layer (S22).",

      // ── S20 Metric 3: Zero-knowledge verification rate ────────────────────
      // Proxy: % of transfers where passphrase gate is active (p2sh_secret_hash set).
      // R2 manifests not enumerable in aggregate from Worker binding (no safe LIST+scan).
      // Fix: add has_passphrase as blob4 in upload AE logEvent call (B4 scope).
      // AE SQL once instrumented:
      //   SELECT countIf(blob4 = 'true') / count() AS zk_rate
      //   FROM share_events
      //   WHERE blob1 = 'upload' AND doubles[2] = 0;
      zk_verification_rate: null,
      zk_verification_note: "R2 manifests not enumerable in aggregate from Worker. Add has_passphrase as blob4 to upload logEvent call (B4 scope). AE SQL once instrumented: countIf(blob4='true')/count() WHERE blob1='upload' AND doubles[2]=0.",
    });

  } catch (e) {
    console.error('Metrics error:', e);
    return err(500, 'Metrics query failed');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stripe helpers
// ─────────────────────────────────────────────────────────────────────────────
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
  if (lookupKey.includes('max'))      return 'max';
  if (lookupKey.includes('creative')) return 'creative';
  return 'free';
}

async function upsertSubscriber(env, stripeCustomerId, email, tier, status, currentPeriodEnd, cancelledAt = null) {
  const payload = {
    stripe_customer_id: stripeCustomerId,
    tier,
    status,
    current_period_end: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  if (email) payload.email = email;
  if (cancelledAt) payload.cancelled_at = cancelledAt;

  const res = await supabaseFetch(env, 'POST', '/rest/v1/subscribers', payload, {
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  });
  if (!res.ok) {
    console.error('Supabase upsert failed:', await res.text());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase fetch
// ─────────────────────────────────────────────────────────────────────────────
async function supabaseFetch(env, method, path, body = null, extraHeaders = {}) {
  const opts = {
    method,
    headers: {
      'apikey':        env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${env.SUPABASE_URL}${path}`, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
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
  const headers    = corsHeaders(request);
  const newHeaders = new Headers(response.headers);
  Object.entries(headers).forEach(([k, v]) => newHeaders.set(k, v));
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

function parseRange(rangeHeader) {
  const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!m) return undefined;
  const offset = parseInt(m[1], 10);
  const end    = m[2] ? parseInt(m[2], 10) : undefined;
  return { offset, length: end !== undefined ? end - offset + 1 : undefined };
}
