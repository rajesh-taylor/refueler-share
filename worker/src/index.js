/* eslint-disable no-undef, no-use-before-define */
import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { verifyChunkHash } from './blake3.js';
import { putManifest, createManifest, isExpired, isInGracePeriod, isDownloadBlocked, requiresPassphrase, TIER_CAPS } from './manifest.js';
import { hashSecret, timingSafeEqual, issueDownloadToken, verifyDownloadToken } from './nut11.js';
import { verifyStripeWebhook, createCheckoutSession } from './stripe.js';
import { checkRateLimit, getClientIp, rateLimitResponse } from './ratelimit.js';
import { createInvoice, getInvoiceStatus } from './lightning.js';
import { handleLightningCreate, handleLightningStatus, handleLightningWebhook } from './lightning-routes.js';
import { checkTransferStatus, flipPendingDestruction, buildTombstone, isTidalPermitted, validateTidalHeaders, getTimestampState, buildTimestampPendingPatch, isTimestampEligible } from './manifest_tg.js';
import { handleConfirmTransfer } from './handlers/confirm_transfer.js';
import { handleExecutionDock } from './handlers/execution_dock.js';
import { handleAdminStatus, handleAdminMetrics, handleAdminAeMetrics, handleAdminSnapshot } from './handlers/admin.js';
import { handleWlConfig, handleCfChallenge } from './wl_config.js';
import { requireApiAuth, kvQuotaKey } from './api_auth.js';
import { handleApiCapabilities }      from './handlers/api_capabilities.js';
import { handleWebhookRegister }        from './webhook_reg.js';
import { findApiKeyHashForUuid, deliverWebhookInline, retryDeadLetterQueue } from './webhook_delivery.js';
// SW5: acceptance + collection receipts
import { buildSignedReceipt, emitReceipt, handleApiReceipt } from './receipts.js';
import { handleAuthPing, handleAuthPingOptions } from './auth_ping.js';
// SW5b: webhook status + hostname health cards
import { handleWebhookStatus }  from './handlers/webhook_status.js';
import { handleHostnameHealth } from './handlers/hostname_health.js';
// SW6: sandbox environment
import { handleSandboxActivate, handleSandboxReset, handleSandboxStatus, handleSandboxSpend, isSandboxRequest, consumeSandboxCredit, lookupSandboxClient } from './sandbox.js';
// SW9: shared utilities extracted from index.js
import {
  UUID_RE, CHUNK_SIZE_MAX, MANIFEST_SIZE_MAX, MIME_DENYLIST,
  corsHeaders, safeGetManifest, supabaseFetch,
  json, err, addCors, parseRange,
} from './utils.js';

// MIME_DENYLIST, UUID_RE, corsHeaders — imported from ./utils.js

// ─────────────────────────────────────────────────────────────────────────────
// Analytics Engine
// Dataset: share_events (bound as AE in wrangler.toml)
//
// Schema (one data point per request):
//   blobs:   [endpoint, tier, error_message, http_protocol]
//   doubles: [latency_ms, status_code, chunk_index, total_chunks, total_bytes]
//   indexes: [endpoint]   <- enables fast GROUP BY in AE SQL
//
// blob4 (http_protocol): 'HTTP/3' | 'HTTP/2' | 'HTTP/1.1' | '' — from request.cf.httpProtocol.
// Populated on upload and credential_issue events (HQ1). Empty string on all other events.
// AE SQL: countIf(blob4='HTTP/3')/count() WHERE blob1='upload'
// ─────────────────────────────────────────────────────────────────────────────
function logEvent(env, {
  endpoint,
  tier         = 'free',
  status       = 200,
  latency      = 0,
  chunkIndex   = -1,
  totalChunks  = 0,
  totalBytes   = 0,
  errorMsg     = '',
  httpProtocol = '',
}) {
  if (!env.AE) return;
  try {
    env.AE.writeDataPoint({
      blobs:   [endpoint, tier, errorMsg, httpProtocol],
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
    async fetch(request, env, ctx) {
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
      // SW1: CF for SaaS ownership challenge — must be first, no auth, no CORS needed
      if (request.method === 'GET' && path.startsWith('/.well-known/cf-custom-hostname-challenge/')) {
        const challengeResponse = handleCfChallenge(path);
        if (challengeResponse) return challengeResponse;
      }
      if (request.method === 'OPTIONS' && path === '/api/v1/auth/ping') return handleAuthPingOptions();
      if (request.method === 'GET'     && path === '/api/v1/auth/ping') return handleAuthPing(request, env);

      // SW1: white-label config discovery
      if (request.method === 'GET' && path === '/wl/config') {
        return timed('wl_config', () => Promise.resolve(handleWlConfig(request)).then(r => addCors(r, request)));
      }
      if (request.method === 'GET' && path === '/status') {
        return timed('status', () => handleStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/admin/status') {
        return timed('admin_status', () => handleAdminStatus(request, env).then(r => addCors(r, request)));
      }

      // ── SW2a: API credential issuance — POST /api/v1/credential/issue ─────
      // HMAC-authenticated. Both rails. No Supabase row on anonymous rail.
      // Quota tracked in KV only. Rate-limited under credential_issue bucket.
      if (request.method === 'POST' && path === '/api/v1/credential/issue') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'credential_issue', 10, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'api_credential_issue', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('api_credential_issue', () => handleApiCredentialIssue(request, env).then(r => addCors(r, request)));
      }

            if (request.method === 'GET' && path === '/api/v1/capabilities') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_capabilities', 30, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'api_capabilities', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('api_capabilities', () => handleApiCapabilities(request, env).then(r => addCors(r, request)));
      }
      // ── SW4: Webhook registration — POST / DELETE / GET /api/v1/webhook/register ─
      // HMAC-authenticated, API tier only. See webhook_reg.js for KV schema.
      if (path === '/api/v1/webhook/register' && ['POST', 'DELETE', 'GET'].includes(request.method)) {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'webhook_reg', 10, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'webhook_reg', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('webhook_reg', () => handleWebhookRegister(request, env).then(r => addCors(r, request)));
      }

      // ── SW5: Receipt pull — GET /api/v1/receipt/:uuid/:type ───────────────
      // HMAC-authenticated. Returns stored { receipt, sig } from KV.
      // type: 'acceptance' | 'collection'
      // 7-day TTL — client can pull keepsake receipt at any time within TTL.
      // No re-computation: stored receipt is the canonical artefact.
      const receiptMatch = path.match(/^\/api\/v1\/receipt\/([0-9a-f-]{36})\/(acceptance|collection)$/i);
      if (request.method === 'GET' && receiptMatch) {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_receipt', 30, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'api_receipt', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('api_receipt', async () => {
          // HMAC auth — reuse requireApiAuth (reads rawBody; GET has no body)
          try {
            await requireApiAuth(request, new ArrayBuffer(0), env);
          } catch (authErr) {
            if (authErr instanceof Response) return addCors(authErr, request);
            return addCors(err(500, 'Authentication error'), request);
          }
          const response = await handleApiReceipt(request, env, receiptMatch[1], receiptMatch[2]);
          return addCors(response, request);
        });
      }

      // ── SW5b: Webhook status — GET /api/v1/webhooks/status ─────────────────
      // HMAC-authenticated. Returns registration state + DLQ depth for caller.
      if (request.method === 'GET' && path === '/api/v1/webhooks/status') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_webhook_status', 20, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'api_webhook_status', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('api_webhook_status', () => handleWebhookStatus(request, env).then(r => addCors(r, request)));
      }

      // ── SW5b: Hostname health — GET /api/v1/hostname/health ─────────────────
      // HMAC-authenticated. Returns WL_CONFIGS entry for the caller's hostname.
      if (request.method === 'GET' && path === '/api/v1/hostname/health') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_hostname_health', 20, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'api_hostname_health', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('api_hostname_health', () => handleHostnameHealth(request, env).then(r => addCors(r, request)));
      }

      // ── SW6: Sandbox endpoints — POST/GET /api/v1/sandbox/* ──────────────
      // Admin-key protected (activate, reset). HMAC-authenticated (status, spend).
      // All responses carry X-Refueler-Sandbox: true.
      // Rate-limited under api_sandbox bucket — tighter than production to discourage
      // using the sandbox as a free tier with a different name.
      if (request.method === 'POST' && path === '/api/v1/sandbox/activate') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_sandbox', 5, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'sandbox_activate', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('sandbox_activate', () => handleSandboxActivate(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/api/v1/sandbox/reset') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_sandbox', 5, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'sandbox_reset', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('sandbox_reset', () => handleSandboxReset(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/api/v1/sandbox/status') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_sandbox', 20, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'sandbox_status', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('sandbox_status', () => handleSandboxStatus(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/api/v1/sandbox/spend') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'api_sandbox', 10, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'sandbox_spend', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('sandbox_spend', () => handleSandboxSpend(request, env).then(r => addCors(r, request)));
      }

      // Consumer credential issuance — POST /credential/issue
      // Turnstile-gated, anonymous, issues Cashu blind signature + UUID + commitment.
      // Resume path (body.resume === true) skips Turnstile, verifies R2 partial upload instead.
      if (request.method === 'POST' && path === '/credential/issue') {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'credential_issue', 10, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'credential_issue', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('credential_issue', () => handleCredentialIssue(request, env).then(r => addCors(r, request)), {
          httpProtocol: request.cf?.httpProtocol ?? '',
        });
      }

      const uploadMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'PUT' && uploadMatch) {
        // Rate limit: 120 requests / 60s per IP — generous for legitimate chunked uploads, blocks bulk abuse
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'upload', 120, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'upload', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        const chunkIndex  = parseInt(uploadMatch[2], 10);
        const tier        = request.headers.get('X-Tier') ?? 'free';
        const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
        const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
        return timed('upload', () => handleUpload(request, env, ctx, uploadMatch[1], chunkIndex).then(r => addCors(r, request)), {
          tier, chunkIndex,
          totalChunks:  chunkIndex === 0 ? totalChunks : 0,
          totalBytes:   chunkIndex === 0 ? totalBytes  : 0,
          httpProtocol: request.cf?.httpProtocol ?? '',
        });
      }

      const authMatch = path.match(/^\/auth\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && authMatch) {
        // Rate limit layer 1: 5 requests / 60s per IP — password brute-force protection
        const ip   = getClientIp(request);
        const rlIp = await checkRateLimit(env, ip, 'auth', 5, 60);
        if (rlIp.limited) {
          logEvent(env, { endpoint: 'auth', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_ip' });
          return rateLimitResponse(request, rlIp.resetAt, corsHeaders(request));
        }
        // Rate limit layer 2: 10 requests / 60s per UUID — distributed brute-force protection.
        // An attacker rotating IPs still hits this ceiling per transfer.
        const rlUuid = await checkRateLimit(env, authMatch[1], 'auth_uuid', 10, 60);
        if (rlUuid.limited) {
          logEvent(env, { endpoint: 'auth', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_uuid' });
          return rateLimitResponse(request, rlUuid.resetAt, corsHeaders(request));
        }
        return timed('auth', () => handleAuth(request, env, authMatch[1]).then(r => addCors(r, request)));
      }

      const metaMatch = path.match(/^\/meta\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && metaMatch) {
        return timed('meta', () => handleMeta(request, env, metaMatch[1]).then(r => addCors(r, request)));
      }

      const downloadMatch = path.match(/^\/download\/([0-9a-f-]{36})\/(\d{4})$/i);
      if (request.method === 'GET' && downloadMatch) {
        // Rate limit: 300 requests / 60s per IP — generous for legitimate chunked downloads
        // (250 GB max transfer at 1 MB chunks = 250 chunks), blocks flood attacks.
        const ip   = getClientIp(request);
        const rlDl = await checkRateLimit(env, ip, 'download', 300, 60);
        if (rlDl.limited) {
          logEvent(env, { endpoint: 'download', tier: 'rate_limited', status: 429, latency: performance.now() - t0, errorMsg: 'rate_limit_ip' });
          return rateLimitResponse(request, rlDl.resetAt, corsHeaders(request));
        }
        const chunkIndex = parseInt(downloadMatch[2], 10);
        return timed('download', async () => {
          const response = await handleDownload(request, env, ctx, downloadMatch[1], chunkIndex);
          return addCors(response, request);
        }, { chunkIndex });
      }

      const deleteMatch = path.match(/^\/transfer\/([0-9a-f-]{36})$/i);
      if (request.method === 'DELETE' && deleteMatch) {
        const uuid = deleteMatch[1];
        if (!UUID_RE.test(uuid)) return err(400, 'Invalid transfer ID');
        return timed('delete_transfer', () => handleDeleteTransfer(request, env, uuid).then(r => addCors(r, request)));
      }

      const confirmMatch = path.match(/^\/confirm\/([0-9a-f-]{36})$/i);
      if (request.method === 'POST' && confirmMatch) {
        const uuid = confirmMatch[1];
        if (!UUID_RE.test(uuid)) return err(400, 'Invalid transfer ID');
        return timed('confirm_transfer', () => handleConfirmTransfer(request, env, ctx, uuid).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/timestamp/submit') {
        // Rate limit: 10 requests / 60s per IP — one per transfer; prevents calendar spam
        const tsTipIp = getClientIp(request);
        const tsTipRl = await checkRateLimit(env, tsTipIp, 'timestamp_submit', 10, 60);
        if (tsTipRl.limited) {
          logEvent(env, { endpoint: 'timestamp_submit', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, tsTipRl.resetAt, corsHeaders(request));
        }
        return timed('timestamp_submit', () => handleTimestampSubmit(request, env, ctx).then(r => addCors(r, request)));
      }

      // TH-2: GET /timestamp/seal/:uuid — fetch encrypted .ots blob for download-path offer
      const sealMatch = path.match(/^\/timestamp\/seal\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && sealMatch) {
        const uuid = sealMatch[1];
        if (!UUID_RE.test(uuid)) return addCors(err(400, 'Invalid transfer ID'), request);
        return timed('timestamp_seal', () => handleTimestampSeal(request, env, uuid).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/webhook/stripe') {
        return timed('webhook_stripe', () => handleStripeWebhook(request, env));
      }

      if (request.method === 'POST' && path === '/subscription/lightning') {
        const deps = { verifyTurnstileToken, createInvoice, checkRateLimit, getClientIp, rateLimitResponse, logEvent, corsHeaders };
        return timed('lightning_create', () => handleLightningCreate(request, env, deps).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/subscription/lightning/status') {
        const deps = { getInvoiceStatus, checkRateLimit, getClientIp, rateLimitResponse, logEvent, corsHeaders };
        return timed('lightning_status', () => handleLightningStatus(request, env, deps).then(r => addCors(r, request)));
      }

      if (request.method === 'POST' && path === '/webhook/lightning') {
        const deps = { issueBlindSignature, logEvent };
        return timed('lightning_webhook', () => handleLightningWebhook(request, env, deps));
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

      if (request.method === 'POST' && path === '/log/error') {
        return handleLogError(request, env).then(r => addCors(r, request));
      }

      if (request.method === 'GET' && path === '/admin/metrics') {
        return timed('admin_metrics', () => handleAdminMetrics(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/ae-metrics') {
        return timed('admin_ae_metrics', () => handleAdminAeMetrics(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/snapshot') {
        return timed('admin_snapshot', () => handleAdminSnapshot(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/execution-dock') {
        return timed('admin_execution_dock', () => handleExecutionDock(request, env).then(r => addCors(r, request)));
      }

      // ── SW8: Hostname health — GET /admin/hostname-health ──────────────────
      // Admin-key gated. Returns latest hostname_health results from STATUS_KV.
      // Written by the daily cron at 03:00 UTC (checkHostnameHealth). Pull-only.
      if (request.method === 'GET' && path === '/admin/hostname-health') {
        return timed('admin_hostname_health', () => handleAdminHostnameHealth(request, env).then(r => addCors(r, request)));
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

  // ── SW4b + SW8: Daily cron (cron: 0 3 * * *) ─────────────────────────────
  //
  // Task 1 (SW4b): dead-letter webhook retry.
  //   Reads all wh_dlq_* KV entries, re-attempts each with a fresh timestamp.
  //   Deletes on 2xx; non-2xx entries remain until 7-day TTL expires.
  //
  // Task 2 (SW8): hostname health checks.
  //   Iterates all wh_config_* KV entries. For each active record that carries a
  //   `hostname` field (written at SW7 onboarding), makes a HEAD request to
  //   https://{hostname}/ with a 10s timeout. Logs one `hostname_health` AE
  //   event per hostname. Persists a summary to STATUS_KV as
  //   `hostname_health:latest` (24h TTL) for the dashboard pull endpoint.
  //
  // Tasks run sequentially — DLQ retry first, then hostname checks.
  // scheduled() runs until the handler resolves; ctx.waitUntil is not used.
  // ─────────────────────────────────────────────────────────────────────────
  async scheduled(event, env, _ctx) {
    if (event.cron === '0 3 * * *') {
      // Task 1 — DLQ retry
      try {
        await retryDeadLetterQueue(env);
      } catch (e) {
        console.error('scheduled/dlq: unhandled error:', e);
      }

      // Task 2 — Hostname health checks
      try {
        await checkHostnameHealth(env);
      } catch (e) {
        console.error('scheduled/hostname_health: unhandled error:', e);
      }
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
// SW8: Hostname health check cron task
//
// Called from scheduled() at 03:00 UTC daily.
// Iterates all wh_config_* KV keys via list(). For each active record that has
// a `hostname` field (set at SW7 onboarding under wh_config_{apiKeyHash}),
// fires a HEAD request to https://{hostname}/ with a 10-second abort timeout.
//
// AE event per hostname:
//   blob1 = 'hostname_health'
//   blob2 = hostname (e.g. 'share.acmecorp.com')
//   blob3 = status string: 'ok' | 'error' | 'timeout'
//   blob4 = HTTP status code as string, or '' on network error
//   double1 = latency_ms (0 on timeout/error)
//   double2 = http_status (0 on network error)
//
// AE writes are fire-and-forget (never awaited). Summary is persisted to
// STATUS_KV as `hostname_health:latest` (24h TTL) for the dashboard.
//
// Limits: max 100 wh_config_ keys per run to avoid CPU overruns. Checks run
// sequentially — parallel fanout would burst edge network from a single cron.
// ─────────────────────────────────────────────────────────────────────────────
async function checkHostnameHealth(env) {
  const HOSTNAME_HEALTH_MAX = 100;
  const REQUEST_TIMEOUT_MS  = 10_000;

  let cursor;
  const results = [];

  // Page through all wh_config_ keys (KV list returns max 1000 per call).
  outer: do {
    let listResult;
    try {
      listResult = await env.STATUS_KV.list({ prefix: 'wh_config_', cursor });
    } catch (e) {
      console.error('hostname_health: KV list failed:', e);
      break;
    }

    for (const key of listResult.keys) {
      if (results.length >= HOSTNAME_HEALTH_MAX) break outer;

      let record;
      try {
        record = await env.STATUS_KV.get(key.name, { type: 'json' });
      } catch (e) {
        console.error(`hostname_health: KV get failed for ${key.name}:`, e);
        continue;
      }

      // Only check active records that have a hostname field (set at SW7).
      if (!record || record.active !== true || !record.hostname) continue;

      const { hostname } = record;
      const url = `https://${hostname}/`;
      const t0  = Date.now();
      let httpStatus = 0;
      let statusStr  = 'error';
      let latencyMs  = 0;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let res;
        try {
          res = await fetch(url, {
            method:  'HEAD',
            headers: { 'User-Agent': 'refueler-share-healthcheck/1.0' },
            signal:  controller.signal,
          });
          latencyMs  = Date.now() - t0;
          httpStatus = res.status;
          statusStr  = res.ok ? 'ok' : 'error';
        } catch (fetchErr) {
          latencyMs = Date.now() - t0;
          if (fetchErr.name === 'AbortError') {
            statusStr = 'timeout';
          } else {
            statusStr = 'error';
          }
        } finally {
          clearTimeout(timer);
        }
      } catch (outerErr) {
        latencyMs = Date.now() - t0;
        statusStr = 'error';
        console.error(`hostname_health: unexpected error for ${hostname}:`, outerErr);
      }

      // AE log — fire-and-forget, never await.
      if (env.AE) {
        try {
          env.AE.writeDataPoint({
            blobs:   ['hostname_health', hostname, statusStr, httpStatus ? String(httpStatus) : ''],
            doubles: [latencyMs, httpStatus, 0, 0, 0],
            indexes: ['hostname_health'],
          });
        } catch (aeErr) {
          console.error('hostname_health: AE write failed:', aeErr);
        }
      }

      results.push({ hostname, status: statusStr, http_status: httpStatus, latency_ms: latencyMs });
      console.log(`hostname_health: ${hostname} → ${statusStr} (${httpStatus}) ${latencyMs}ms`);
    }

    cursor = listResult.list_complete ? undefined : listResult.cursor;
  } while (cursor);

  // Persist summary for dashboard pull.
  const summary = {
    checked_at: Math.floor(Date.now() / 1000),
    count:      results.length,
    healthy:    results.filter(r => r.status === 'ok').length,
    results,
  };

  try {
    await env.STATUS_KV.put(
      'hostname_health:latest',
      JSON.stringify(summary),
      { expirationTtl: 24 * 3600 },
    );
  } catch (e) {
    console.error('hostname_health: KV summary write failed:', e);
  }

  console.log(`hostname_health: checked ${results.length} hostnames, ${summary.healthy} healthy`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SW8: Admin hostname health pull — GET /admin/hostname-health
//
// X-Admin-Key gated. Reads `hostname_health:latest` from STATUS_KV and returns
// the last cron run's summary. 404 if no cron has run yet.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminHostnameHealth(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  let summary;
  try {
    summary = await env.STATUS_KV.get('hostname_health:latest', { type: 'json' });
  } catch (e) {
    console.error('handleAdminHostnameHealth: KV read failed:', e);
    return err(502, 'KV read failed');
  }

  if (!summary) {
    return json({ checked_at: null, count: 0, healthy: 0, results: [] }, 200);
  }

  return json(summary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Client error reporting — POST /log/error (S36b)
// ─────────────────────────────────────────────────────────────────────────────
async function handleLogError(request, env) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(env, ip, 'log_error', 20, 60);
  if (rl.limited) return new Response('Too Many Requests', { status: 429 });

  let body;
  try { body = await request.json(); } catch { return new Response('OK', { status: 200 }); }

  const context = String(body.context || '').slice(0, 64);
  const message = String(body.message || '').slice(0, 200);
  const detail  = String(body.detail  || '').slice(0, 200);

  try {
    env.AE.writeDataPoint({
      blobs:   ['client_error', context, message, detail],
      doubles: [Date.now()],
      indexes: ['client_error'],
    });
  } catch {}

  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// API credential issuance — POST /api/v1/credential/issue  (SW2a, updated SW2c)
//
// HMAC-authenticated API-tier endpoint. Both rails.
//
// Identity rail:
//   - Quota tracked in KV under hashed key: api_quota_{ sha256(rfs_live_key) }
//   - 402 if pool exhausted. Decrement after successful issuance.
//   - Supabase row created at onboarding (SW7) — never here.
//
// Anonymous rail (SW2c):
//   - NO KV quota record. NO Supabase row. Ever.
//   - Client presents X-Cashu-Token: a blind-signed capability-atom token
//     issued from the API keyset (MINT_API_PRIVATE_KEY).
//   - Worker verifies the token against the API keyset, checks api_spent_tokens
//     for double-spend, marks spent, then issues the credential.
//   - The "balance" is the client's local token stack. The server is blind to it.
//
// Request body:
//   { blinded_message, tier?, transfer_ref? }
//   tier: 'api' only — other values rejected.
//   transfer_ref: optional attribution string. Logged to AE only, max 128 chars.
//
// Response:
//   { signed_point, mint_pubkey, allocation_bytes, uuid, issued_tier,
//     commitment, expires_at, quota_remaining }
//   quota_remaining: number (identity rail) | null (anonymous rail)
//
// Auth headers required:
//   Authorization:  HMAC-SHA256 key=rfs_live_{...}, sig={hex}, ts={unix}
//   X-Api-Sign-Key: rfs_sign_{...}
//   X-Cashu-Token:  <capability-atom token>  — anonymous rail only
// ─────────────────────────────────────────────────────────────────────────────
async function handleApiCredentialIssue(request, env) {
  // ── Read body (needed for HMAC body-hash verification) ───────────────────
  let rawBody;
  let body;
  try {
    rawBody = await request.arrayBuffer();
    body    = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return err(400, 'Invalid JSON body');
  }

  // ── HMAC auth ─────────────────────────────────────────────────────────────
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, rawBody, env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('api_credential_issue: unexpected auth error:', authErr);
    return err(500, 'Authentication error');
  }

  const rail = client.rail ?? 'identity';

  // ── Validate body ─────────────────────────────────────────────────────────
  const { blinded_message, transfer_ref } = body;
  if (!blinded_message) return err(400, 'Missing blinded_message');

  const safeTransferRef = transfer_ref
    ? String(transfer_ref).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
    : null;

  // ─────────────────────────────────────────────────────────────────────────
  // Rail-specific quota gate
  // ─────────────────────────────────────────────────────────────────────────

  let quotaRemaining = null; // Returned in response. null = anonymous rail.

  // ── SW6: Sandbox routing ──────────────────────────────────────────────────
  // rfs_test_ keys are routed to sandbox quota — never the production pool.
  // Identity-rail sandbox: consume one test credit then jump straight to
  // issuance (skipping the production KV quota gate below).
  // Anonymous-rail sandbox: falls through to the X-Cashu-Token check — test
  // tokens are structurally valid cashuA... strings but fail verifyCredential,
  // which surfaces the correct 401 for integration test assertions.
  if (isSandboxRequest(apiKey)) {
    if (rail === 'identity') {
      const sandboxCredit = await consumeSandboxCredit(env, apiKey);
      if (!sandboxCredit.ok) {
        const reason = sandboxCredit.reason;
        if (reason === 'exhausted' || reason === 'no_quota_record') {
          return new Response(
            JSON.stringify({
              error:     'Sandbox test credit limit reached. Call POST /api/v1/sandbox/reset.',
              code:      'sandbox_quota_exhausted',
              remaining: 0,
              sandbox:   true,
            }),
            { status: 402, headers: { 'Content-Type': 'application/json', 'X-Refueler-Sandbox': 'true' } }
          );
        }
        return new Response(
          JSON.stringify({ error: 'Sandbox quota check failed', sandbox: true }),
          { status: 500, headers: { 'Content-Type': 'application/json', 'X-Refueler-Sandbox': 'true' } }
        );
      }
      // Credit consumed — skip production quota gate, proceed to issuance.
      quotaRemaining = sandboxCredit.remaining;
    }
    // Anonymous-rail sandbox: fall through to X-Cashu-Token block below.
  } else if (rail === 'identity') {
    // ── Identity rail: KV pool check ────────────────────────────────────────
    const quotaKey = await kvQuotaKey(apiKey);
    let quotaRecord;
    try {
      quotaRecord = await env.STATUS_KV.get(quotaKey, { type: 'json' });
    } catch (e) {
      console.error('api_credential_issue: KV quota read failed:', e);
      return err(502, 'Quota check unavailable — please retry');
    }

    const remaining = quotaRecord?.remaining ?? 0;
    if (remaining <= 0) {
      logEvent(env, {
        endpoint: 'api_credential_issue',
        tier:     'api',
        status:   402,
        errorMsg: 'quota_exhausted',
      });
      return new Response(
        JSON.stringify({
          error:     'Credit pool exhausted',
          code:      'quota_exhausted',
          remaining: 0,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Store for decrement after issuance.
    quotaRemaining = remaining;

  } else {
    // ── Anonymous rail: capability-atom token verification ──────────────────
    //
    // The client presents one blind-signed capability-atom token per issuance.
    // Token is verified against the API keyset (MINT_API_PRIVATE_KEY).
    // Double-spend check against api_spent_tokens Supabase table.
    // On success, token serial is marked spent — atomic with issuance.
    //
    // If MINT_API_PRIVATE_KEY is not yet provisioned (pre-B7 bootstrap),
    // the anonymous rail is unavailable and returns 503.

    const cashuToken = request.headers.get('X-Cashu-Token') ?? '';
    if (!cashuToken) {
      return new Response(
        JSON.stringify({
          error: 'Anonymous rail requires X-Cashu-Token header (one capability-atom token per issuance)',
          code:  'token_required',
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!env.MINT_API_PRIVATE_KEY) {
      console.error('api_credential_issue: MINT_API_PRIVATE_KEY not provisioned');
      return new Response(
        JSON.stringify({
          error: 'Anonymous rail token issuance not yet available — use identity rail or contact support',
          code:  'anon_rail_unavailable',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify the presented token was signed by the API keyset.
    let tokenSerial;
    try {
      const verified = await verifyCredential(cashuToken, env.MINT_API_PRIVATE_KEY);
      if (!verified || !verified.serial) {
        return new Response(
          JSON.stringify({ error: 'Invalid capability token', code: 'token_invalid' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      tokenSerial = verified.serial;
    } catch (e) {
      console.error('api_credential_issue: token verification error:', e);
      return new Response(
        JSON.stringify({ error: 'Invalid capability token', code: 'token_invalid' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Double-spend check — api_spent_tokens table.
    const spendCheckRes = await supabaseFetch(
      env, 'GET',
      `/rest/v1/api_spent_tokens?serial=eq.${encodeURIComponent(tokenSerial)}&select=serial`,
      null,
      { 'Prefer': 'count=exact', 'Range': '0-0' }
    );

    if (!spendCheckRes.ok) {
      console.error('api_credential_issue: api_spent_tokens check failed:', await spendCheckRes.text());
      return err(502, 'Token verification unavailable — please retry');
    }

    const cr = spendCheckRes.headers.get('Content-Range') ?? '';
    const crMatch = cr.match(/\/(\d+)$/);
    const alreadySpent = crMatch ? parseInt(crMatch[1], 10) > 0 : false;

    if (alreadySpent) {
      supabaseFetch(env, 'POST', '/rest/v1/api_double_spend_attempts', {
        serial:       tokenSerial,
        attempted_at: new Date().toISOString(),
      }, { 'Prefer': 'return=minimal' }).catch(e =>
        console.error('api_credential_issue: double_spend_attempt log failed:', e)
      );

      return new Response(
        JSON.stringify({ error: 'Token already spent', code: 'token_spent' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const markSpentRes = await supabaseFetch(
      env, 'POST', '/rest/v1/api_spent_tokens',
      { serial: tokenSerial, created_at: new Date().toISOString() },
      { 'Prefer': 'return=minimal' }
    );

    if (!markSpentRes.ok) {
      console.error('api_credential_issue: mark spent failed:', await markSpentRes.text());
      return err(502, 'Token spend recording failed — please retry');
    }

    // quotaRemaining stays null — no server-side balance for anonymous rail.
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Issue credential — same mint path as consumer
  // ─────────────────────────────────────────────────────────────────────────
  const API_EXPIRY_WINDOW = 90 * 24 * 3600;
  const uuid              = crypto.randomUUID();
  const issuedTier        = 'api';
  const mintKey           = rail === 'anonymous'
    ? env.MINT_API_PRIVATE_KEY
    : env.MINT_PRIVATE_KEY;

  const commitment = await computeApiCommitment(uuid, issuedTier, API_EXPIRY_WINDOW);

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, mintKey));
  } catch (e) {
    console.error('api_credential_issue: blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // ── Identity rail: decrement quota (fire-and-forget) ──────────────────────
  // Sandbox keys skip this — consumeSandboxCredit() already decremented in KV.
  if (rail === 'identity' && !isSandboxRequest(apiKey)) {
    const newRemaining = (quotaRemaining ?? 1) - 1;
    const quotaKey     = await kvQuotaKey(apiKey);
    env.STATUS_KV.put(
      quotaKey,
      JSON.stringify({ remaining: newRemaining, updated_at: nowSeconds }),
    ).catch(e => console.error('api_credential_issue: KV quota decrement failed:', e));
    quotaRemaining = newRemaining;
  }

  // ── AE event ──────────────────────────────────────────────────────────────
  // Never logs apiKey, rail, or any PII.
  // blob4 carries transfer_ref (reusing http_protocol slot — AE has 4 blobs).
  if (env.AE) {
    try {
      env.AE.writeDataPoint({
        blobs:   ['api_credential_issue', issuedTier, '', safeTransferRef ?? ''],
        doubles: [0, 200, 0, 0, 0],
        indexes: ['api_credential_issue'],
      });
    } catch (e) {
      console.error('AE write failed (api_credential_issue):', e);
    }
  }

  const expiresAt = nowSeconds + API_EXPIRY_WINDOW;

  return json({
    signed_point:     signedPoint,
    mint_pubkey:      mintPubkey,
    allocation_bytes: 250 * 1024 * 1024 * 1024, // 250 GB API tier cap
    uuid,
    issued_tier:      issuedTier,
    commitment,
    expires_at:       expiresAt,
    quota_remaining:  quotaRemaining, // number for identity rail, null for anonymous
  });
}

// computeApiCommitment — same pattern as consumer computeCommitment.
// Kept separate to avoid confusion with the consumer EXPIRY_WINDOWS map.
async function computeApiCommitment(uuid, tier, expiryWindow) {
  const input = new TextEncoder().encode(`${uuid}:${tier}:${expiryWindow}`);
  const hash  = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential issue — POST /credential/issue
//
// S42c: UUID-bound credential issuance.
//
// The Worker generates the transfer UUID here — the client no longer generates
// it client-side. A commitment H(uuid‖issued_tier‖expiry_window_seconds) is
// computed and returned alongside the blind signature. The frontend echoes this
// commitment and issued_tier on chunk 0; the Worker recomputes and verifies.
//
// This closes the cross-transfer credential farming vector: a credential farmed
// for one UUID is cryptographically invalid for any other UUID.
//
// Nothing is stored. The binding lives in the commitment itself.
// Full NUT-20 quote signatures deferred to B8 Rust mint.
//
// RU2c: resume path bypasses Turnstile.
// When body.resume === true, Turnstile verification and nonce binding are
// skipped. Instead, the Worker verifies a real partial upload exists in R2
// (HEAD check on chunk 0000) before issuing. This prevents the bypass being
// used as a free credential farm — you need a real partial upload to resume.
// Turnstile was already solved when the original upload began; requiring it
// again after a connection drop is security theatre that breaks the flow.
// ─────────────────────────────────────────────────────────────────────────────

// Canonical expiry windows (seconds) — mirrored in handleUpload.
// These constants must stay in sync. A mismatch breaks commitment verification.
const EXPIRY_WINDOWS = {
  free:     7  * 24 * 3600,  //    604,800 s
  creative: 30 * 24 * 3600,  //  2,592,000 s
  max:      90 * 24 * 3600,  //  7,776,000 s
};

/**
 * computeCommitment(uuid, tier, expiryWindow) → hex string
 * SHA-256( utf8(uuid) || utf8(':') || utf8(tier) || utf8(':') || utf8(expiryWindow) )
 * Simple, deterministic, no parsing ambiguity (UUID contains only hex+hyphen; tier is alpha).
 */
async function computeCommitment(uuid, tier, expiryWindow) {
  const input = new TextEncoder().encode(`${uuid}:${tier}:${expiryWindow}`);
  const hash  = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleCredentialIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { blinded_message, tier = 'free', resume = false, resume_uuid = null } = body;
  if (!blinded_message) return err(400, 'Missing blinded_message');

  // ── Resume path (RU2c) ───────────────────────────────────────────────────
  if (resume === true) {
    if (!resume_uuid || !UUID_RE.test(resume_uuid)) {
      return err(400, 'resume_uuid is required and must be a valid UUID');
    }
    let chunkExists = false;
    try {
      const obj = await env.BUCKET.head(`${resume_uuid}/0000`);
      chunkExists = obj !== null;
    } catch (e) {
      console.error('R2 head check failed on resume:', e);
      return err(502, 'Could not verify partial upload');
    }
    if (!chunkExists) {
      logEvent(env, { endpoint: 'credential_issue', tier: 'resume_rejected', status: 403, errorMsg: 'resume_no_partial_upload' });
      return err(403, 'No partial upload found for this transfer');
    }
    logEvent(env, { endpoint: 'credential_issue', tier: tier === 'free' ? 'free' : tier, status: 200, errorMsg: 'resume' });
  } else {
    // ── Normal path — Turnstile required ──────────────────────────────────
    const { turnstile_token } = body;
    if (!turnstile_token) return err(400, 'Missing turnstile_token or blinded_message');

    const turnstileOk = await verifyTurnstileToken(turnstile_token, env.TURNSTILE_SECRET_KEY);
    if (!turnstileOk) return err(403, 'Turnstile verification failed');

    // ── Turnstile nonce binding (S42d) ──────────────────────────────────────
    const nonceHash = await (async () => {
      const bytes = new TextEncoder().encode(turnstile_token);
      const hash  = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    })();
    const nonceKey = `tt_nonce:${nonceHash}`;
    let nonceSeen = false;
    try {
      const existing = await env.STATUS_KV.get(nonceKey);
      nonceSeen = existing !== null;
    } catch (e) {
      console.error('Turnstile nonce KV read failed, proceeding:', e);
    }
    if (nonceSeen) {
      logEvent(env, { endpoint: 'credential_issue', tier: 'rate_limited', status: 429, latency: 0, errorMsg: 'turnstile_nonce_replay' });
      return err(429, 'Turnstile token already used');
    }
    env.STATUS_KV.put(nonceKey, '1', { expirationTtl: 600 }).catch(e =>
      console.error('Turnstile nonce KV write failed:', e)
    );
  }

  const issuedTier      = EXPIRY_WINDOWS[tier] !== undefined ? tier : 'free';
  const expiryWindow    = EXPIRY_WINDOWS[issuedTier];
  const allocationBytes = TIER_CAPS[issuedTier] ?? TIER_CAPS.free;

  const uuid = crypto.randomUUID();

  const commitment = await computeCommitment(uuid, issuedTier, expiryWindow);

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, env.MINT_PRIVATE_KEY));
  } catch (e) {
    console.error('Blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  return json({
    signed_point:     signedPoint,
    mint_pubkey:      mintPubkey,
    allocation_bytes: allocationBytes,
    uuid,
    issued_tier:      issuedTier,
    commitment,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload — PUT /upload/:uuid/:chunk
//
// SW5 additions:
//   - Reads X-Transfer-Ref header at chunk 0; stored in manifest as
//     api_transfer_ref for API-tier transfers (used in acceptance receipt).
//   - Reads X-Api-Live-Key header at chunk 0; stored in manifest as
//     api_live_key for API-tier transfers (used in receipts).
//   - After manifest-write (chunk 0 putManifest): emits cargo.accepted receipt
//     via ctx.waitUntil for API-tier transfers with a registered webhook.
//   - After upload_complete (subsequent chunks): receipt emission already
//     happened at chunk 0 — no re-emit needed here.
// ─────────────────────────────────────────────────────────────────────────────
async function handleUpload(request, env, ctx, uuid, chunkIndex) {
  // ── UUID format validation (S41) ──────────────────────────────────────────
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'upload', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  const isFirstChunk = chunkIndex === 0;

  // ── MIME type gate (S40) — chunk 0 only ───────────────────────────────────
  if (isFirstChunk) {
    const rawContentType = request.headers.get('Content-Type') ?? '';
    const mimeType = rawContentType.split(';')[0].trim().toLowerCase();

    if (!mimeType) {
      logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 415, errorMsg: 'mime_missing' });
      return err(415, 'Content-Type header is required');
    }

    if (MIME_DENYLIST.has(mimeType)) {
      logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 415, errorMsg: 'mime_denied' });
      return err(415, `File type '${mimeType}' is not permitted`);
    }
  }

  // ── Chunk size hard cap ────────────────────────────────────────────────────
  const declaredLength = parseInt(request.headers.get('Content-Length') ?? '0', 10);
  if (declaredLength > CHUNK_SIZE_MAX) {
    logEvent(env, { endpoint: 'upload', tier: 'unknown', status: 413, errorMsg: 'chunk_too_large' });
    return err(413, `Chunk exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
  }

  // ── Resolve tier from Supabase (S39) ──────────────────────────────────────
  const email = (request.headers.get('X-Email') ?? '').trim().toLowerCase();
  let resolvedTier = 'free';
  if (email) {
    try {
      const subRes = await supabaseFetch(
        env, 'GET',
        `/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&status=eq.active&select=tier&limit=1`
      );
      if (subRes.ok) {
        const rows = await subRes.json();
        if (rows.length > 0 && rows[0].tier) {
          resolvedTier = rows[0].tier;
        }
      }
    } catch (e) {
      console.error('Tier resolution failed, defaulting to free:', e);
    }
  }

  const tierCap = TIER_CAPS[resolvedTier] ?? TIER_CAPS.free;

  // ── Cumulative byte cap via KV (S39) ──────────────────────────────────────
  const kvKey = `upload_bytes:${uuid}`;
  let bytesAlreadyWritten = 0;
  try {
    const stored = await env.STATUS_KV.get(kvKey);
    bytesAlreadyWritten = stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    console.error('KV byte counter read failed, proceeding:', e);
  }

  const projectedTotal = bytesAlreadyWritten + declaredLength;
  if (projectedTotal > tierCap) {
    logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'tier_cap_exceeded' });
    return err(413, `Upload would exceed ${resolvedTier} tier cap of ${tierCap} bytes`);
  }

  if (isFirstChunk) {
    const credential  = request.headers.get('X-Cashu-Credential');
    const blake3Root  = request.headers.get('X-Blake3-Root');
    const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
    const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
    const expiryTs    = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
    const chunkHash   = request.headers.get('X-Blake3-Chunk-Hash');
    const p2shHash    = request.headers.get('X-P2SH-Secret-Hash') ?? null;
    const rawFileName = request.headers.get('X-File-Name') ?? '';

    // ── SW5: read transfer_ref and live_key for API-tier receipt emission ─
    // X-Transfer-Ref: client attribution string (max 128 chars, sanitised).
    // X-Api-Live-Key: rfs_live_… — identifies the API client for receipt sig.
    // Both stored in manifest for API-tier transfers only. Never for consumer tier.
    const rawTransferRef = request.headers.get('X-Transfer-Ref') ?? null;
    const apiTransferRef = rawTransferRef
      ? String(rawTransferRef).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
      : null;
    const apiLiveKey = request.headers.get('X-Api-Live-Key') ?? null;

    const sanitisedFileName = rawFileName
      .replace(/[/\\]/g, '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .trim();
    const fileNameBytes = new TextEncoder().encode(sanitisedFileName);
    const fileName = fileNameBytes.length > 255
      ? new TextDecoder().decode(fileNameBytes.slice(0, 255))
      : (sanitisedFileName || `refueler-${uuid.slice(0, 8)}`);

    const commitment = request.headers.get('X-Credential-Commitment') ?? '';
    const issuedTier = (request.headers.get('X-Issued-Tier') ?? 'free').trim().toLowerCase();

    if (!credential || !blake3Root || !totalChunks || !totalBytes || !expiryTs || !chunkHash) {
      return err(400, 'Missing required headers');
    }

    // ── UUID-bound commitment verification (S42c) ─────────────────────────
    if (!commitment) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 401, errorMsg: 'credential_commitment_missing' });
      return err(401, 'Missing credential commitment');
    }

    let expectedCommitment;
    if (issuedTier === 'api') {
      const API_EXPIRY_WINDOW = 90 * 24 * 3600;
      expectedCommitment = await computeApiCommitment(uuid, 'api', API_EXPIRY_WINDOW);
    } else {
      const canonicalTier  = EXPIRY_WINDOWS[issuedTier] !== undefined ? issuedTier : 'free';
      const expectedWindow = EXPIRY_WINDOWS[canonicalTier];
      expectedCommitment   = await computeCommitment(uuid, canonicalTier, expectedWindow);
    }

    const commitmentBytes         = new TextEncoder().encode(commitment);
    const expectedCommitmentBytes = new TextEncoder().encode(expectedCommitment);
    const commitmentMatch = commitmentBytes.length === expectedCommitmentBytes.length &&
      crypto.subtle.timingSafeEqual
        ? await (async () => {
            try { return crypto.subtle.timingSafeEqual(commitmentBytes, expectedCommitmentBytes); }
            catch { return commitment === expectedCommitment; }
          })()
        : commitment === expectedCommitment;
    if (!commitmentMatch) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 401, errorMsg: 'credential_uuid_mismatch' });
      return err(401, 'Credential commitment mismatch');
    }

    // ── Total chunks upper bound (S42) ────────────────────────────────────
    const TOTAL_CHUNKS_MAX = 10_000;
    if (totalChunks > TOTAL_CHUNKS_MAX) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'total_chunks_exceeded' });
      return err(400, `X-Total-Chunks exceeds maximum of ${TOTAL_CHUNKS_MAX}`);
    }

    // ── Expiry timestamp tier validation (S42) ────────────────────────────
    const EXPIRY_MAX_SECONDS = {
      free:     7  * 24 * 3600,
      creative: 30 * 24 * 3600,
      max:      90 * 24 * 3600,
      api:      90 * 24 * 3600,
    };
    const nowSeconds  = Math.floor(Date.now() / 1000);
    const maxWindow   = EXPIRY_MAX_SECONDS[resolvedTier] ?? EXPIRY_MAX_SECONDS.free;
    const maxExpiryTs = nowSeconds + maxWindow;
    if (expiryTs <= nowSeconds) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'expiry_in_past' });
      return err(400, 'X-Expiry-Timestamp is in the past');
    }
    if (expiryTs > maxExpiryTs) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'expiry_exceeds_tier' });
      return err(400, `X-Expiry-Timestamp exceeds maximum window for ${resolvedTier} tier (${maxWindow / 86400} days)`);
    }

    // ── Early cap check against declared total (S39) ───────────────────────
    if (totalBytes > tierCap) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'declared_total_exceeds_cap' });
      return err(413, `Declared total ${totalBytes} bytes exceeds ${resolvedTier} tier cap of ${tierCap} bytes`);
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

    const chunkBody = await request.arrayBuffer();

    if (chunkBody.byteLength > CHUNK_SIZE_MAX) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 413, errorMsg: 'chunk_body_too_large' });
      return err(413, `Chunk body exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
    }

    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHash);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    try {
      await env.STATUS_KV.put(kvKey, String(bytesAlreadyWritten + chunkBody.byteLength), { expirationTtl: 86400 });
    } catch (e) {
      console.error('KV byte counter write failed:', e);
    }

    // ── TG: tidal header processing (chunk 0 only) ────────────────────────
    const destroyAfterDownload = request.headers.get('X-Destroy-After-Download') === '1';
    const availableFromHeader  = request.headers.get('X-Available-From');
    const availableUntilHeader = request.headers.get('X-Available-Until');
    const hasTidalHeaders = availableFromHeader !== null || availableUntilHeader !== null;

    if (hasTidalHeaders && !isTidalPermitted(resolvedTier)) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 403, errorMsg: 'tidal_tier_gate' });
      return err(403, 'Availability scheduling requires a paid subscription');
    }

    let availableFromTs = null;
    let availableUntilTs = null;

    if (availableFromHeader !== null) {
      availableFromTs = parseInt(availableFromHeader, 10);
      if (isNaN(availableFromTs)) return err(400, 'X-Available-From must be a unix timestamp (integer)');
    }
    if (availableUntilHeader !== null) {
      availableUntilTs = parseInt(availableUntilHeader, 10);
      if (isNaN(availableUntilTs)) return err(400, 'X-Available-Until must be a unix timestamp (integer)');
    }

    const tidalInvariantError = validateTidalHeaders(
      availableFromTs,
      availableUntilTs,
      Math.floor(Date.now() / 1000),
      expiryTs
    );
    if (tidalInvariantError) {
      logEvent(env, { endpoint: 'upload', tier: resolvedTier, status: 400, errorMsg: 'tidal_invariant_violation' });
      return err(400, tidalInvariantError);
    }

    const manifest = createManifest({
      uuid,
      tier: resolvedTier,
      totalChunks,
      totalBytes,
      expiryTimestamp: expiryTs,
      blake3Root,
      p2shSecretHash: p2shHash,
    });
    manifest.file_name = fileName;
    manifest.chunks_received = [0];

    // Apply TG fields
    if (destroyAfterDownload) manifest.pending_destruction = false; // armed
    if (availableFromTs !== null)  manifest.available_from_timestamp  = availableFromTs;
    if (availableUntilTs !== null) manifest.available_until_timestamp = availableUntilTs;

    // ── SW5: store API-tier receipt fields in manifest ────────────────────
    // api_live_key and api_transfer_ref are stored for API-tier transfers only.
    // They are needed when emitting the collection receipt at download time
    // (manifest is the only durable store at that point).
    // Consumer-tier manifests never carry these fields.
    const manifestNowSeconds = Math.floor(Date.now() / 1000);
    if (issuedTier === 'api' && apiLiveKey) {
      manifest.api_live_key      = apiLiveKey;
      manifest.api_accepted_at   = manifestNowSeconds;
      if (apiTransferRef) manifest.api_transfer_ref = apiTransferRef;
    }

    await putManifest(env.BUCKET, uuid, manifest);

    // ── Execution Dock: write dock_index KV entry (TG-4) ──────────────────
    const dockTtl = (expiryTs - Math.floor(Date.now() / 1000)) + 48 * 3600 + 3600;
    env.STATUS_KV.put(
      `dock_index:${uuid}`,
      JSON.stringify({
        expiry_timestamp: expiryTs,
        tier:             resolvedTier,
        file_name:        fileName,
        created_at:       Math.floor(Date.now() / 1000),
      }),
      { expirationTtl: Math.max(dockTtl, 3600) }
    ).catch(e => console.error('Execution Dock KV write failed:', e));

    const meltRes = await supabaseFetch(env, 'POST', '/rest/v1/spent_tokens', { serial });
    if (!meltRes.ok) console.error('NUT-07 melt failed:', serial, await meltRes.text());

    // ── SW5: emit cargo.accepted receipt ─────────────────────────────────
    // Fired at manifest-write transition (chunk 0 putManifest above).
    // API-tier only: we need a live_key + webhook registration to sign and deliver.
    // A 409 resume-of-complete does not re-emit — this path only reached on
    // fresh chunk-0 writes that are not resume paths (upload_complete guard).
    // ctx.waitUntil — receipt is notification, never control flow.
    if (issuedTier === 'api' && apiLiveKey) {
      ctx.waitUntil(
        (async () => {
          try {
            const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
            if (apiKeyHash) {
              emitReceipt(env, ctx, {
                receipt_type:     'acceptance',
                event:            'cargo.accepted',
                live_key:         apiLiveKey,
                uuid,
                transfer_ref:     apiTransferRef,
                size_bytes:       totalBytes,
                chunk_count:      totalChunks,
                issued_at:        manifestNowSeconds,
                accepted_at:      manifestNowSeconds,
                expiry_timestamp: expiryTs,
                apiKeyHash,
                // wh_created_at resolved inside emitReceipt via wh_config_ KV lookup
              });
            }
          } catch (e) {
            console.error('SW5 cargo.accepted emit error:', e);
          }
        })()
      );
    }

    return json({ ok: true, chunk: 0, uuid });

  } else {
    // ── Subsequent chunks ──────────────────────────────────────────────────
    const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
    if (oversize) {
      logEvent(env, { endpoint: 'upload', status: 502, errorMsg: 'manifest_oversize' });
      return err(502, 'Transfer manifest exceeds size limit');
    }
    if (!manifest) return err(404, 'Transfer not found');
    if (manifest.upload_complete) return err(409, 'Upload already complete');

    const now = Math.floor(Date.now() / 1000);
    if (now > manifest.expiry_timestamp) return err(410, 'Transfer expired');

    const chunkHashHeader = request.headers.get('X-Blake3-Chunk-Hash');
    if (!chunkHashHeader) return err(400, 'Missing X-Blake3-Chunk-Hash');

    const chunkBody = await request.arrayBuffer();

    if (chunkBody.byteLength > CHUNK_SIZE_MAX) {
      logEvent(env, { endpoint: 'upload', tier: manifest.tier ?? resolvedTier, status: 413, errorMsg: 'chunk_body_too_large' });
      return err(413, `Chunk body exceeds maximum size of ${CHUNK_SIZE_MAX} bytes`);
    }

    const hashOk = await verifyChunkHash(new Uint8Array(chunkBody), chunkHashHeader);
    if (!hashOk) return err(400, 'Chunk hash mismatch');

    await env.BUCKET.put(`${uuid}/${String(chunkIndex).padStart(4, '0')}`, chunkBody);

    try {
      await env.STATUS_KV.put(kvKey, String(bytesAlreadyWritten + chunkBody.byteLength), { expirationTtl: 86400 });
    } catch (e) {
      console.error('KV byte counter write failed:', e);
    }

    if (chunkIndex >= manifest.total_chunks) {
      logEvent(env, { endpoint: 'upload', tier: manifest.tier ?? resolvedTier, status: 400, errorMsg: 'chunk_index_out_of_bounds' });
      return err(400, 'Chunk index exceeds declared total');
    }

    manifest.chunks_received.push(chunkIndex);
    if (manifest.chunks_received.length === manifest.total_chunks) {
      manifest.upload_complete = true;
      try {
        await env.STATUS_KV.delete(kvKey);
      } catch (e) {
        console.error('KV byte counter delete failed:', e);
      }
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

  const { manifest, oversize: authOversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (authOversize) {
    logEvent(env, { endpoint: 'auth', status: 502, errorMsg: 'manifest_oversize' });
    return err(502, 'Transfer manifest exceeds size limit');
  }
  if (!manifest) return err(404, 'Transfer not found');

  const authNowSeconds = Math.floor(Date.now() / 1000);
  const authStatusCheck = checkTransferStatus(manifest, authNowSeconds);
  if (!authStatusCheck.ok) return err(authStatusCheck.status, authStatusCheck.body);

  if (!requiresPassphrase(manifest)) return err(400, 'Transfer is not passphrase-protected');
  if (isDownloadBlocked(manifest)) return err(410, 'Transfer expired');

  const submitted = await hashSecret(passphrase);
  const match = timingSafeEqual(submitted, manifest.p2sh_secret_hash);
  if (!match) {
    await new Promise(r => setTimeout(r, 200));
    return err(401, 'Incorrect passphrase');
  }

  const token = await issueDownloadToken(uuid, env.MINT_PRIVATE_KEY, manifest.expiry_timestamp);
  return json({ token });
}

// ─────────────────────────────────────────────────────────────────────────────
// Meta — GET /meta/:uuid
// Public, no auth. Returns filename, size, expiry, passphrase flag from manifest.
async function handleMeta(request, env, uuid) {
  const { manifest } = await safeGetManifest(env.BUCKET, uuid, env);
  if (!manifest) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    file_name:                manifest.file_name               ?? null,
    total_bytes:              manifest.total_bytes             ?? null,
    total_chunks:             manifest.total_chunks            ?? null,
    expiry_timestamp:         manifest.expiry_timestamp        ?? null,
    passphrase_protected:     !!manifest.p2sh_secret_hash,
    pending_destruction:      manifest.pending_destruction     ?? false,
    available_from_timestamp: manifest.available_from_timestamp  ?? null,
    available_until_timestamp: manifest.available_until_timestamp ?? null,
    timestamp_state:          getTimestampState(manifest),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download — GET /download/:uuid/:chunk
//
// SW5 additions:
//   - Emits cargo.discharged receipt at first complete download (last chunk
//     served for the first time), guarded by a KV once-flag
//     `receipt_discharged_guard:{uuid}`.
//   - For destroy-after-download transfers: co-located with
//     pending_destruction flip (same chunk — last chunk).
//   - No re-emit on re-download — once-flag is permanent until 7-day TTL.
//   - No recipient metadata (IP, UA, network) in any receipt field.
// ─────────────────────────────────────────────────────────────────────────────
async function handleDownload(request, env, ctx, uuid, chunkIndex) {
  // ── UUID format validation (S41) ──────────────────────────────────────────
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  if (chunkIndex < 0 || chunkIndex > 9999) {
    logEvent(env, { endpoint: 'download', status: 400, errorMsg: 'invalid_chunk_index' });
    return err(400, 'Invalid chunk index');
  }

  const { manifest, oversize: dlOversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (dlOversize) {
    logEvent(env, { endpoint: 'download', status: 502, errorMsg: 'manifest_oversize' });
    return err(502, 'Transfer manifest exceeds size limit');
  }
  if (!manifest) return err(404, 'Transfer not found');

  const dlNowSeconds = Math.floor(Date.now() / 1000);
  const dlStatusCheck = checkTransferStatus(manifest, dlNowSeconds);
  if (!dlStatusCheck.ok) return err(dlStatusCheck.status, dlStatusCheck.body);

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

  const dlResponse = new Response(obj.body, { status, headers });

  // ── TG: flip pending_destruction → true on last chunk of a DAD transfer ───
  const updatedManifestForFlip = flipPendingDestruction(manifest, chunkIndex);
  const pendingDestructionFlipped = updatedManifestForFlip !== manifest;
  if (pendingDestructionFlipped) {
    putManifest(env.BUCKET, uuid, updatedManifestForFlip).catch(e =>
      console.error('TG: pending_destruction flip write failed:', e)
    );
  }

  // ── SW5: emit cargo.discharged receipt ────────────────────────────────────
  // Fired when the last chunk is served for the first time.
  // Guards:
  //   1. isLastChunk — only fire on the final chunk of the transfer.
  //   2. once-flag KV key `receipt_discharged_guard:{uuid}` — prevents
  //      re-emission on re-download. Set atomically (fire-and-forget) with
  //      the receipt itself.
  //   3. api_live_key in manifest — only API-tier transfers carry this; consumer
  //      transfers do not emit receipts (no signing key available at download time).
  //   4. No recipient metadata — manifest carries only sender-declared fields.
  //
  // Co-located with pending_destruction flip for DAD transfers. For non-DAD
  // transfers, fires on last-chunk serve regardless of flip.
  const isLastChunk = manifest.total_chunks > 0 && chunkIndex === manifest.total_chunks - 1;
  if (isLastChunk && manifest.api_live_key) {
    ctx.waitUntil(
      (async () => {
        try {
          // Once-flag guard — set before emitting to prevent race on concurrent requests.
          const guardKey  = `receipt_discharged_guard:${uuid}`;
          let alreadyFired = false;
          try {
            const existing = await env.STATUS_KV.get(guardKey);
            alreadyFired   = existing !== null;
          } catch (e) {
            console.error('SW5 discharge guard KV read failed:', e);
            // Fail open — proceed; duplicate emission is less bad than silent drop.
          }

          if (!alreadyFired) {
            // Set guard first — 7-day TTL matches receipt KV TTL.
            env.STATUS_KV.put(guardKey, '1', { expirationTtl: 7 * 24 * 3600 }).catch(e =>
              console.error('SW5 discharge guard KV write failed:', e)
            );

            const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
            if (apiKeyHash) {
              emitReceipt(env, ctx, {
                receipt_type: 'collection',
                event:        'cargo.discharged',
                live_key:     manifest.api_live_key,
                uuid,
                transfer_ref: manifest.api_transfer_ref ?? null,
                size_bytes:   manifest.total_bytes  ?? 0,
                chunk_count:  manifest.total_chunks ?? 0,
                issued_at:    Math.floor(Date.now() / 1000),
                collected_at: Math.floor(Date.now() / 1000),
                apiKeyHash,
                // wh_created_at resolved inside emitReceipt via wh_config_ KV lookup
              });
            }
          }
        } catch (e) {
          console.error('SW5 cargo.discharged emit error:', e);
        }
      })()
    );
  }

  return dlResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp submit — POST /timestamp/submit  (TH-1)
// ─────────────────────────────────────────────────────────────────────────────
async function handleTimestampSubmit(request, env, ctx) {
  const uuid = request.headers.get('X-Transfer-UUID') ?? '';
  if (!UUID_RE.test(uuid)) return err(400, 'Invalid or missing X-Transfer-UUID');

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  const manifestTier = (manifest.tier ?? 'free').toLowerCase();
  if (manifestTier === 'free' || manifestTier === 'citizen') {
    return err(403, 'Permanent record requires a Sovereign subscription');
  }

  if (!isTimestampEligible(manifest)) {
    const state = getTimestampState(manifest);
    if (manifest.consumed === true) return err(410, 'Transfer has been destroyed');
    if (manifest.upload_complete !== true) return err(409, 'Upload not yet complete');
    return err(409, `Timestamp already in state: ${state}`);
  }

  let otsBlob;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength < 13) return err(400, 'Timestamp blob too short (min 13 bytes: iv + ciphertext)');
    if (buf.byteLength > 8192) return err(413, 'Timestamp blob exceeds 8 KB limit');
    otsBlob = new Uint8Array(buf);
  } catch (e) {
    return err(400, 'Could not read request body');
  }

  try {
    await env.BUCKET.put(`${uuid}/date-seal.ots.enc`, otsBlob, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
  } catch (e) {
    console.error('TH-1: R2 put date-seal.ots.enc failed:', e);
    return err(502, 'Failed to store timestamp blob');
  }

  const jitterMs = 50 + Math.floor(Math.random() * 150);
  await new Promise(r => setTimeout(r, jitterMs));

  const nowSeconds = Math.floor(Date.now() / 1000);
  const patch = buildTimestampPendingPatch(nowSeconds);
  await putManifest(env.BUCKET, uuid, { ...manifest, ...patch });

  logEvent(env, {
    endpoint: 'timestamp_submit',
    tier:     manifestTier,
    status:   200,
  });

  ctx.waitUntil(
    (async () => {
      try {
        const apiKeyHash = await findApiKeyHashForUuid(env, uuid);
        if (apiKeyHash) {
          await deliverWebhookInline(env, apiKeyHash, {
            type: 'transfer.timestamp_submitted',
            uuid,
          });
        }
      } catch (e) {
        console.error('timestamp_submit: webhook delivery error:', e);
      }
    })()
  );

  return json({ ok: true, timestamp_state: 'pending' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp seal fetch — GET /timestamp/seal/:uuid  (TH-2)
// ─────────────────────────────────────────────────────────────────────────────
async function handleTimestampSeal(request, env, uuid) {
  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');
  if (manifest.consumed === true) return err(410, 'Transfer has been destroyed');

  const state = getTimestampState(manifest);
  if (state === 'none') return err(404, 'No date seal for this transfer');

  let obj;
  try {
    obj = await env.BUCKET.get(`${uuid}/date-seal.ots.enc`);
  } catch (e) {
    console.error('TH-2: R2 get date-seal.ots.enc failed:', e);
    return err(502, 'Could not retrieve date seal');
  }
  if (!obj) return err(404, 'Date seal not found');

  const buf = await obj.arrayBuffer();

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete transfer — DELETE /transfer/:uuid  (TG-block)
// ─────────────────────────────────────────────────────────────────────────────
async function handleDeleteTransfer(request, env, uuid) {
  const authHeader = request.headers.get('Authorization') ?? '';

  if (authHeader.startsWith('Bearer rfs_owner_')) {
    return handleOwnerDelete(request, env, uuid);
  }

  if (!authHeader.startsWith('Bearer ')) {
    return err(401, 'Authorization required');
  }

  const bearerToken = authHeader.slice(7);

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  if (manifest.consumed === true) {
    return err(410, 'Transfer has already been destroyed');
  }

  const { valid, uuid: tokenUuid } = await verifyDownloadToken(bearerToken, env.MINT_PRIVATE_KEY);
  if (!valid || tokenUuid !== uuid) {
    return err(403, 'Not authorised to destroy this transfer');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  const deleteErrors = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await env.BUCKET.delete(`${uuid}/${String(i).padStart(4, '0')}`);
    } catch (e) {
      console.error(`TG: chunk delete failed at index ${i}:`, e);
      deleteErrors.push(i);
    }
  }

  env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
    console.error('TH-1: date-seal.ots.enc delete failed (bearer path):', e)
  );

  const tombstone = buildTombstone(nowSeconds);
  await putManifest(env.BUCKET, uuid, tombstone);

  logEvent(env, {
    endpoint:  'delete_transfer',
    tier:      manifest.tier ?? 'free',
    status:    200,
    totalChunks,
    errorMsg:  deleteErrors.length > 0 ? `partial_delete:${deleteErrors.length}` : '',
  });

  return json({
    destroyed:    true,
    consumed_at:  nowSeconds,
    ...(deleteErrors.length > 0 ? { partial: true, failed_chunks: deleteErrors } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner delete — admin-keyed forced deletion (TG-4)
// ─────────────────────────────────────────────────────────────────────────────
async function handleOwnerDelete(request, env, uuid) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) {
    return err(401, 'Unauthorised');
  }

  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');

  if (manifest.consumed === true) {
    return err(410, 'Transfer has already been destroyed');
  }

  const nowSeconds  = Math.floor(Date.now() / 1000);
  const totalChunks = manifest.total_chunks ?? 0;

  await putManifest(env.BUCKET, uuid, { ...manifest, consumed: true, consumed_at: nowSeconds });

  const deleteErrors = [];
  for (let i = 0; i < totalChunks; i++) {
    try {
      await env.BUCKET.delete(`${uuid}/${String(i).padStart(4, '0')}`);
    } catch (e) {
      console.error(`TG owner delete: chunk delete failed at index ${i}:`, e);
      deleteErrors.push(i);
    }
  }

  env.BUCKET.delete(`${uuid}/date-seal.ots.enc`).catch(e =>
    console.error('TH-1: date-seal.ots.enc delete failed (owner path):', e)
  );

  const tombstone = buildTombstone(nowSeconds);
  await putManifest(env.BUCKET, uuid, tombstone);

  env.STATUS_KV.delete(`dock_index:${uuid}`).catch(e =>
    console.error('Execution Dock KV delete failed:', e)
  );

  logEvent(env, {
    endpoint: 'owner_delete',
    tier:     manifest.tier ?? 'free',
    status:   200,
    totalChunks,
    errorMsg: deleteErrors.length > 0 ? `partial_delete:${deleteErrors.length}` : '',
  });

  return json({
    destroyed:   true,
    consumed_at: nowSeconds,
    ...(deleteErrors.length > 0 ? { partial: true, failed_chunks: deleteErrors } : {}),
  });
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

    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      const sub        = event.data.object;
      const customerId = sub.customer;
      const tier       = tierFromPriceKey(sub.items?.data?.[0]?.price?.lookup_key ?? '');
      const status = (sub.status === 'active' || sub.status === 'incomplete') ? 'active' : 'inactive';
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

  const res = await supabaseFetch(env, 'POST', '/rest/v1/subscribers?on_conflict=stripe_customer_id', payload, {
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  });
  if (!res.ok) {
    console.error('Supabase upsert failed:', await res.text());
  }
}

// supabaseFetch, json, err, addCors, parseRange — imported from ./utils.js
