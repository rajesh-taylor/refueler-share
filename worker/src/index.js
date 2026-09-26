/* eslint-disable no-undef, no-use-before-define */
import { verifyTurnstileToken } from './turnstile.js';
import { issueBlindSignature, verifyCredential } from './nut00.js';
import { computeCommitment } from './commitment.js';
import { putManifest, createManifest, isExpired, isInGracePeriod, isDownloadBlocked, requiresPassphrase, TIER_CAPS } from './manifest.js';
import { hashSecret, timingSafeEqual, issueDownloadToken, verifyDownloadToken } from './nut11.js';
// verifyStripeWebhook, createCheckoutSession — imported by ./handlers/stripe_sub.js
import { checkRateLimit, getClientIp, rateLimitResponse } from './ratelimit.js';
import { createInvoice, getInvoiceStatus } from './lightning.js';
import { handleLightningCreate, handleLightningStatus, handleLightningWebhook } from './lightning-routes.js';
import { checkTransferStatus, flipPendingDestruction, buildTombstone, isTidalPermitted, validateTidalHeaders, getTimestampState, buildTimestampPendingPatch, isTimestampEligible } from './manifest_tg.js';
import { handleConfirmTransfer } from './handlers/confirm_transfer.js';
import { handleExecutionDock } from './handlers/execution_dock.js';
import { handleFinalise } from './handlers/finalise.js';                       // Share-Dash-2 fold
import { handleDownload } from './handlers/download.js';                       // Share-6-5a full extraction
import { handleClientErrorsLog, appendClientError } from './handlers/client_errors_kv.js'; // Share-Dash-2
import { handleApiStats } from './handlers/api_stats.js';                      // Share-Dash-2
import { handleNewsEvents } from './handlers/news_events.js';                  // Share-Dash-2
import { handleOrphanSweep } from './handlers/orphan_sweep.js';               // Share-6-6a
import { handlePatchMerkleRoot } from './handlers/patch_merkle_root.js';  // Share-6-6a
import { handlePurgeTestTransfers } from './handlers/purge_test_transfers.js'; // Share-7-1
import { handleAdminStatus, handleAdminMetrics, handleAdminAeMetrics, handleAdminSnapshot, handleAdminKvStats } from './handlers/admin.js';
import { handleTestCredential } from './handlers/test_credential.js';                // Share-Admin-1
import { handleWlConfig, handleCfChallenge } from './wl_config.js';
import { requireApiAuth, kvQuotaKey } from './api_auth.js';
import { handleApiCapabilities }      from './handlers/api_capabilities.js';
import { handleAdminBtcRatePost, handleAdminBtcRateGet, refreshBtcRate } from './handlers/btc_rate.js';
import { handleAdminBtcPrice }  from './handlers/btc_price.js';        // Share-B10-1: live display ticker
import { handleGrowthSnapshot } from './handlers/growth_snapshot.js';  // Share-B10-1: growth chart lines
import { handleWebhookRegister }        from './webhook_reg.js';
import { deliverWebhookInline, retryDeadLetterQueue } from './webhook_delivery.js';
// SW5: acceptance + collection receipts
import { buildSignedReceipt, handleApiReceipt } from './receipts.js';
import { handleAuthPing, handleAuthPingOptions } from './auth_ping.js';
// SW5b: webhook status + hostname health cards
import { handleWebhookStatus }  from './handlers/webhook_status.js';
import { handleHostnameHealth } from './handlers/hostname_health.js';
// SW6: sandbox environment
import { handleSandboxActivate, handleSandboxReset, handleSandboxStatus, handleSandboxSpend, isSandboxRequest, consumeSandboxCredit, lookupSandboxClient } from './sandbox.js';
// SW9: shared utilities extracted from index.js
import {
  UUID_RE, MANIFEST_SIZE_MAX,
  corsHeaders, safeGetManifest, supabaseFetch,
  json, err, addCors, parseRange,
} from './utils.js';

import { TIERS, isCharteredTier } from './tiers.js';
// Share-6-1: direct-to-R2 presigning + upload-session token + transfer cost
import { makePresigner, presignPutObject, signSessionToken, computeTransferCost } from './r2_presign.js';
// SW-MCP-W2: monthly credit allocation, lazy reset, overage ceiling, personal_api plan
import {
  loadQuota, applyQuotaSpend, provisionQuota, cancelQuota,
  PLAN_IDENTITY_API, PLAN_PERSONAL_API,
} from './quota.js';

import { handleStripeWebhook, handleCheckout, handleSubscriptionStatus, handlePortal } from './handlers/stripe_sub.js';
import { fetchTierFromSubscription, fetchPeriodEnd, tierFromPriceKey, upsertSubscriber } from './handlers/stripe_sub.js';
import { handleTimestampSubmit, handleTimestampSeal } from './handlers/timestamp.js';
import { handleDeleteTransfer, handleOwnerDelete }    from './handlers/delete_transfer.js';


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
        // Share-Dash-2: server-observed error log (KV, 90d). Fire-and-forget —
        // never blocks the response. Thrown errors are logged once in the outer
        // catch instead, so this covers only returned 4xx/5xx (no double-count).
        if (response.status >= 400) {
          ctx.waitUntil(appendClientError(env, {
            status: response.status, endpoint, path, method: request.method,
          }));
        }
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

      // ── Share-6-6b: PUT /upload/:uuid/:chunk RETIRED ─────────────────────────
      // Legacy Worker-relay chunk path removed. All uploads use the direct-to-R2
      // presigned-URL path (/upload/:uuid/initiate → presigned PUT → /finalise).
      // Any client hitting this path is pre-6-2 and must re-upload.

      // ── Share-6-1: initiate direct-to-R2 upload — POST /upload/:uuid/initiate ──
      // Cashu verify+spend once here, size-cap
      // via resolvedTier, manifest create, first presigned-URL batch + session token.
      const initiateMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/initiate$/i);
      if (request.method === 'POST' && initiateMatch) {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'upload_initiate', 20, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'upload_initiate', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('upload_initiate', () => handleInitiate(request, env, ctx, initiateMatch[1]).then(r => addCors(r, request)), {
          httpProtocol: request.cf?.httpProtocol ?? '',
        });
      }

      // ── Share-6-1: next presigned-URL batch — POST /upload/:uuid/urls ──────────
      // Authed by the upload-session token (NOT by re-verifying/re-spending Cashu).
      const uploadUrlsMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/urls$/i);
      if (request.method === 'POST' && uploadUrlsMatch) {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'upload_urls', 60, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'upload_urls', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('upload_urls', () => handleUploadUrls(request, env, uploadUrlsMatch[1]).then(r => addCors(r, request)));
      }

      // ── Share-6-3a: finalise direct-to-R2 upload — POST /upload/:uuid/finalise ──
      // Authed by the upload-session token (NOT a Cashu re-spend). HEAD completeness
      // check, write the {uuid}/hashes sidecar, set merkle_root + tree_algo +
      // upload_complete:true, then spend (delete) the session token.
      const finaliseMatch = path.match(/^\/upload\/([0-9a-f-]{36})\/finalise$/i);
      if (request.method === 'POST' && finaliseMatch) {
        const ip = getClientIp(request);
        const rl = await checkRateLimit(env, ip, 'upload_finalise', 20, 60);
        if (rl.limited) {
          logEvent(env, { endpoint: 'upload_finalise', tier: 'rate_limited', status: 429, latency: performance.now() - t0 });
          return rateLimitResponse(request, rl.resetAt, corsHeaders(request));
        }
        return timed('upload_finalise', () => handleFinalise(request, env, finaliseMatch[1]).then(r => addCors(r, request)));
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

      // ── Share-Dash-2: Navy Office admin surfaces ──────────────────────────
      // Server-observed 4xx/5xx log (KV, 90d) — distinct from /log/error (AE).
      if (request.method === 'GET' && path === '/admin/client-errors-log') {
        return timed('admin_client_errors_log', () => handleClientErrorsLog(request, env).then(r => addCors(r, request)));
      }
      // API & MCP stats — active keys (KV) · requests by rail + attach (AE).
      if (request.method === 'GET' && path === '/admin/api-stats') {
        return timed('admin_api_stats', () => handleApiStats(request, env).then(r => addCors(r, request)));
      }
      // Growth-signal events — GET list / POST append.
      if (path === '/admin/news-events' && (request.method === 'GET' || request.method === 'POST')) {
        return timed('admin_news_events', () => handleNewsEvents(request, env).then(r => addCors(r, request)));
      }
      // Growth-signal events — DELETE by id.
      const newsDeleteMatch = path.match(/^\/admin\/news-events\/([A-Za-z0-9_-]+)$/);
      if (request.method === 'DELETE' && newsDeleteMatch) {
        return timed('admin_news_events_delete', () => handleNewsEvents(request, env, newsDeleteMatch[1]).then(r => addCors(r, request)));
      }

      // ── SW8: Hostname health — GET /admin/hostname-health ──────────────────
      // Admin-key gated. Returns latest hostname_health results from STATUS_KV.
      // Written by the daily cron at 03:00 UTC (checkHostnameHealth). Pull-only.
      if (request.method === 'GET' && path === '/admin/hostname-health') {
        return timed('admin_hostname_health', () => handleAdminHostnameHealth(request, env).then(r => addCors(r, request)));
      }
            // ── SW-MCP-W1: BTC reference rate admin panel ─────────────────────────
      if (request.method === 'POST' && path === '/admin/btc-rate') {
        return timed('admin_btc_rate_set', () => handleAdminBtcRatePost(request, env).then(r => addCors(r, request)));
      }
      if (request.method === 'GET' && path === '/admin/btc-rate') {
        return timed('admin_btc_rate_get', () => handleAdminBtcRateGet(request, env).then(r => addCors(r, request)));
      }

      // ── Share-B10-1: live BTC/GBP display ticker (growth chart overlay) ────
      // Distinct from /admin/btc-rate (governed rate card). KV-cached 15 min.
      if (request.method === 'GET' && path === '/admin/btc-price') {
        return timed('admin_btc_price', () => handleAdminBtcPrice(request, env).then(r => addCors(r, request)));
      }

      // ── Share-B10-1: growth snapshot (AE credentials-issued per tier) ──────
      if (request.method === 'GET' && path === '/admin/growth-snapshot') {
        return timed('admin_growth_snapshot', () => handleGrowthSnapshot(request, env).then(r => addCors(r, request)));
      }

      if (request.method === 'GET' && path === '/admin/kv-stats') {
        return timed('admin_kv_stats', () => handleAdminKvStats(request, env).then(r => addCors(r, request)));
      }

      // ── Share-6-1: R2 presign smoke test — POST /admin/r2-presign-test ────
      // X-Admin-Key gated. Presigns a single PutObject to the DEV bucket only
      // (never prod) so the presigner can be proven end-to-end without a full
      // Cashu credential flow. Remove after Share-6-6 cutover if desired.
      if (request.method === 'POST' && path === '/admin/r2-presign-test') {
        return timed('admin_r2_presign_test', () => handleAdminR2PresignTest(request, env).then(r => addCors(r, request)));
      }

      // ── SW-MCP-W2: Quota admin endpoints ──────────────────────────────────
      // Admin-key gated. Provision or cancel an API client's monthly quota record.
      // POST /api/v1/admin/quota/provision — write initial quota record at onboarding.
      // POST /api/v1/admin/quota/cancel    — cancel-at-period-end or immediate.
      if (request.method === 'POST' && path === '/api/v1/admin/quota/provision') {
        return timed('admin_quota_provision', () => handleAdminQuotaProvision(request, env).then(r => addCors(r, request)));
      }
      if (request.method === 'POST' && path === '/api/v1/admin/quota/cancel') {
        return timed('admin_quota_cancel', () => handleAdminQuotaCancel(request, env).then(r => addCors(r, request)));
      }

      // ── Share-6-6a: orphan-object audit — GET /admin/orphan-sweep ───────────
      // Admin-key gated, dry-run only. Pages all R2 objects, groups by UUID,
      // classifies complete / incomplete / stale / orphan_chunks / sidecar_only.
      // No deletion — report only. Deletion gate is Share-6-6b.
      if (request.method === 'GET' && path === '/admin/orphan-sweep') {
        return timed('admin_orphan_sweep', () => handleOrphanSweep(request, env).then(r => addCors(r, request)));
      }

      // ── Share-6-6a: patch stored merkle_root — POST /admin/patch-merkle-root ─
      // Admin-key gated. Reads {uuid}/hashes from R2, recomputes the correct root
      // (RFC 6962 0x00 leaf domain tag), patches {uuid}/manifest.json if wrong.
      if (request.method === 'POST' && path === '/admin/patch-merkle-root') {
        return timed('admin_patch_merkle_root', () => handlePatchMerkleRoot(request, env).then(r => addCors(r, request)));
      }

      // ── Share-7-1: purge complete test transfers — DELETE /admin/purge-test-transfers ─
      // Admin-key gated. Deletes all R2 objects for complete UUIDs (upload_complete: true).
      // Use after soak tests to reset R2 to a clean state. dry_run=true by default.
      if (request.method === 'DELETE' && path === '/admin/purge-test-transfers') {
        return timed('admin_purge_test_transfers', () => handlePurgeTestTransfers(request, env).then(r => addCors(r, request)));
      }

      // ── Share-Admin-1: test credential — POST /admin/test-credential ─────────
      // X-Admin-Key gated. Issues a real blind-signed credential bypassing Turnstile,
      // Cashu payment, and tier resolution. Stores a KV flag so /initiate skips the
      // spend ledger and uses the specified cap_bytes. Soak-test only.
      // NEVER add to bin/sync-share.sh.
      if (request.method === 'POST' && path === '/admin/test-credential') {
        return timed('admin_test_credential', () => handleTestCredential(request, env).then(r => addCors(r, request)));
      }

      logEvent(env, { endpoint: 'unknown', status: 404, latency: performance.now() - t0 });
            ctx.waitUntil(appendClientError(env, { status: 404, endpoint: 'unknown', path, method: request.method }));
            return new Response('Not found', { status: 404, headers: corsHeaders(request) });

    } catch (e) {
      const latency = performance.now() - t0;
      logEvent(env, { endpoint: 'unhandled', status: 500, latency, errorMsg: e?.message ?? 'unknown' });
      ctx.waitUntil(appendClientError(env, { status: 500, endpoint: 'unhandled', path, method: request.method, errorMsg: e?.message ?? 'unknown' }));
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
            // Task 3 — BTC reference rate refresh (SW-MCP-W1)
      try {
        await refreshBtcRate(env);
      } catch (e) {
        console.error('scheduled/btc_rate: unhandled error:', e);
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
      phoenixd:    null,
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
// SW-MCP-W2: Admin quota provisioning — POST /api/v1/admin/quota/provision
//
// X-Admin-Key gated. Writes the initial api_quota_{hash} KV record for a new
// API client at onboarding. Idempotent — re-provisioning resets the period and
// remaining balance to allocation (use with care on live accounts).
//
// Body:
//   {
//     live_key:        "rfs_live_..." | sha256_hex,  // identify the client
//     plan:            "identity_api" | "personal_api",
//     overage_ceiling: number,   // identity_api only; ignored for personal_api
//     period_start:    number,   // optional unix secs; defaults to now
//     period_end:      number,   // optional unix secs; defaults to period_start + 1 month
//   }
//
// live_key may be the raw rfs_live_... value or a pre-hashed sha256 hex string.
// The handler hashes rfs_live_... values — admin never needs to compute this manually.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminQuotaProvision(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON body'); }

  const { live_key, plan, overage_ceiling, period_start, period_end } = body;
  if (!live_key) return err(400, 'live_key is required');
  if (!plan)     return err(400, 'plan is required (identity_api | personal_api)');

  // Hash the live key if it looks like a raw rfs_live_... value.
  let keyHash;
  try {
    if (live_key.startsWith('rfs_live_') || live_key.startsWith('rfs_test_')) {
      const bytes = new TextEncoder().encode(live_key);
      const hash  = await crypto.subtle.digest('SHA-256', bytes);
      keyHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Assume pre-hashed hex (64 chars).
      if (!/^[0-9a-f]{64}$/.test(live_key)) return err(400, 'live_key must be rfs_live_... or 64-char sha256 hex');
      keyHash = live_key;
    }
  } catch (e) {
    console.error('handleAdminQuotaProvision: key hashing failed:', e);
    return err(500, 'Key hash computation failed');
  }

  const quotaKey = `api_quota_${keyHash}`;
  const result   = await provisionQuota(env, quotaKey, {
    plan,
    overage_ceiling: overage_ceiling ?? undefined,
    period_start:    period_start    ?? undefined,
    period_end:      period_end      ?? undefined,
  });

  if (result.error) {
    console.error('handleAdminQuotaProvision: provision failed:', result.error);
    return err(500, `Quota provision failed: ${result.error}`);
  }

  return json({ ok: true, quota_key: quotaKey, record: result.record });
}

// ─────────────────────────────────────────────────────────────────────────────
// SW-MCP-W2: Admin quota cancel — POST /api/v1/admin/quota/cancel
//
// X-Admin-Key gated. Two flavours (§7.4):
//   immediate: false (default) — cancel-at-period-end. Credits valid until period_end.
//   immediate: true  — admin-initiated. Zeroes remaining immediately.
//
// Body:
//   {
//     live_key:  "rfs_live_..." | sha256_hex,
//     immediate: boolean,   // optional, default false
//   }
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminQuotaCancel(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  let body;
  try { body = await request.json(); } catch { return err(400, 'Invalid JSON body'); }

  const { live_key, immediate = false } = body;
  if (!live_key) return err(400, 'live_key is required');

  let keyHash;
  try {
    if (live_key.startsWith('rfs_live_') || live_key.startsWith('rfs_test_')) {
      const bytes = new TextEncoder().encode(live_key);
      const hash  = await crypto.subtle.digest('SHA-256', bytes);
      keyHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      if (!/^[0-9a-f]{64}$/.test(live_key)) return err(400, 'live_key must be rfs_live_... or 64-char sha256 hex');
      keyHash = live_key;
    }
  } catch (e) {
    console.error('handleAdminQuotaCancel: key hashing failed:', e);
    return err(500, 'Key hash computation failed');
  }

  const quotaKey = `api_quota_${keyHash}`;
  const result   = await cancelQuota(env, quotaKey, { immediate: Boolean(immediate) });

  if (result.error) {
    if (result.error === 'record_absent') return err(404, 'No quota record found for this key');
    console.error('handleAdminQuotaCancel: cancel failed:', result.error);
    return err(500, `Quota cancel failed: ${result.error}`);
  }

  return json({ ok: true, already_cancelled: result.already_cancelled ?? false, record: result.record ?? null });
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

  // Share-B10-1 (B7 snag S93–S95): receiver A/B telemetry is NOT an error — it is
  // a legitimate completion signal that was mis-routed here and so polluted the
  // client-error log. The consumer frontend posts these as { context:'receiver_ab',
  // message:'receiver_ab_downloaded'|'receiver_ab_shown', detail:'variant:<x>' }.
  // Route them to a first-class AE event via logEvent() instead of the
  // 'client_error' blob: blob1 = the real event name (so shown vs downloaded stay
  // distinct), blob3 = the variant. They then count as their own events and drop
  // out of the Navy Office client-errors card automatically. No new browser header
  // or endpoint — the browser keeps POSTing to /log/error, so the
  // corsHeaders()/preflight contract is untouched.
  if (context === 'receiver_ab' || context.startsWith('receiver_ab')) {
    const eventName = message.startsWith('receiver_ab') ? message.slice(0, 64) : context;
    logEvent(env, { endpoint: eventName, status: 200, errorMsg: detail });
    return new Response('OK', { status: 200 });
  }

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
// API credential issuance — POST /api/v1/credential/issue  (SW2a/SW2c/SW-MCP-W2)
//
// HMAC-authenticated API-tier endpoint. Both rails.
//
// Identity rail (SW-MCP-W2):
//   - Quota tracked in KV under: api_quota_{ sha256(rfs_live_key) }
//   - Full schema: plan, allocation, remaining, overage_credits, overage_ceiling,
//     period_start, period_end, status, updated_at.
//   - Lazy period reset: if now >= period_end, rolls to next billing anniversary
//     before applying this spend. Unused credits expire — no rollover.
//   - identity_api plan: metered overage past allocation up to overage_ceiling.
//     402 overage_ceiling only when the ceiling is breached.
//   - personal_api plan: hard stop at allocation. 402 quota_exhausted, no overage.
//   - Cancelled accounts: 402 account_cancelled (immediate if remaining=0,
//     else at period_end).
//   - Supabase row created at onboarding (SW7) — never here.
//
// Anonymous rail (SW2c):
//   - NO KV quota record. NO Supabase row. Ever.
//   - Client presents X-Cashu-Token: one blind-signed capability-atom token.
//   - Worker verifies against API keyset, double-spend-checks, marks spent.
//   - The "balance" is the client's local stack. Server is blind to it.
//
// Request body:
//   { blinded_message, transfer_ref? }
//   transfer_ref: optional attribution string. Logged to AE only, max 128 chars.
//
// Response:
//   { signed_point, mint_pubkey, allocation_bytes, uuid, issued_tier,
//     commitment, expires_at, quota_remaining, period_end? }
//   quota_remaining: number (identity rail) | null (anonymous rail)
//   period_end:      unix secs (identity rail) | undefined (anonymous rail)
//
// Auth headers required:
//   Authorization:  HMAC-SHA256 key=rfs_live_{...}, sig={hex}, ts={unix}
//   X-Api-Sign-Key: rfs_sign_{...}
//   X-Cashu-Token:  <capability-atom token>  — anonymous rail only
// ─────────────────────────────────────────────────────────────────────────────
async function handleApiCredentialIssue(request, env) {
  // ── Read body (needed for HMAC body-hash verification) ────────────────────
  let rawBody;
  let body;
  try {
    rawBody = await request.arrayBuffer();
    body    = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return err(400, 'Invalid JSON body');
  }

  // ── HMAC auth ──────────────────────────────────────────────────────────────
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, rawBody, env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('api_credential_issue: unexpected auth error:', authErr);
    return err(500, 'Authentication error');
  }

  const rail = client.rail ?? 'identity';

  // Fail closed before any quota or token spend if the commitment key is absent.
  if (!env.COMMITMENT_KEY) {
    console.error('api_credential_issue: COMMITMENT_KEY not configured');
    return err(500, 'Credential issuance not configured');
  }

  // ── Validate body ──────────────────────────────────────────────────────────
  const { blinded_message, transfer_ref } = body;
  if (!blinded_message) return err(400, 'Missing blinded_message');

  const safeTransferRef = transfer_ref
    ? String(transfer_ref).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
    : null;

  // ───────────────────────────────────────────────────────────────────────────
  // Rail-specific quota gate
  // ───────────────────────────────────────────────────────────────────────────

  let quotaRemaining = null; // number (identity) | null (anonymous)
  let quotaPeriodEnd = undefined; // unix secs (identity) | undefined (anonymous)

  // ── SW6: Sandbox routing ───────────────────────────────────────────────────
  // rfs_test_ keys route to sandbox quota — never the production pool.
  // Identity-rail sandbox: consume one test credit, skip production quota gate.
  // Anonymous-rail sandbox: falls through to X-Cashu-Token check.
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
      quotaRemaining = sandboxCredit.remaining;
    }
    // Anonymous-rail sandbox: fall through to X-Cashu-Token block below.

  } else if (rail === 'identity') {
    // ── Identity rail: full W2 quota gate ────────────────────────────────────
    const quotaKey = await kvQuotaKey(apiKey);

    // Load quota record.
    const { record: quotaRecord, error: loadErr } = await loadQuota(env, quotaKey);
    if (loadErr) {
      if (loadErr === 'kv_read_failed') {
        return err(502, 'Quota check unavailable — please retry');
      }
      // record_absent: account provisioned without a quota record.
      logEvent(env, { endpoint: 'api_credential_issue', tier: TIERS.CHARTERED, status: 402, errorMsg: 'quota_not_provisioned' });
      return new Response(
        JSON.stringify({ error: 'No quota record found — contact support', code: 'quota_not_provisioned' }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Apply spend (includes lazy reset and all plan-specific logic).
    const CREDENTIAL_COST = 1; // 1 credit per issuance in v1
    const nowSecs = Math.floor(Date.now() / 1000);
    const { updated, response402 } = applyQuotaSpend(quotaRecord, CREDENTIAL_COST, nowSecs);

    if (response402) {
      // Spend blocked — return the appropriate 402.
      logEvent(env, {
        endpoint: 'api_credential_issue',
        tier:     TIERS.CHARTERED,
        status:   402,
        errorMsg: response402.code,
      });

      // Build the payment_required envelope (MCP spec §2.5).
      return new Response(
        JSON.stringify({
          error:             'payment_required',
          code:              response402.code,
          rail:              'identity',
          remaining_credits: response402.remaining_credits ?? 0,
          shortfall_credits: response402.shortfall_credits ?? CREDENTIAL_COST,
          ...(response402.overage_credits !== undefined
            ? { overage_credits: response402.overage_credits, overage_ceiling: response402.overage_ceiling }
            : {}),
          payment: {
            method:        'out_of_band_v1',
            instructions:  'Request a credit top-up (or wait for your monthly reset) from your Refueler account.',
            dashboard_url: 'https://refueler.io/share/',
            offer:         null,
          },
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Spend permitted — write updated record back to KV (fire-and-forget).
    // KV is last-write-wins; the race-critical path (double-spend) is in Supabase.
    env.STATUS_KV.put(quotaKey, JSON.stringify(updated)).catch(e =>
      console.error('api_credential_issue: KV quota write-back failed:', e)
    );

    quotaRemaining = updated.remaining;
    quotaPeriodEnd = updated.period_end;

  } else {
    // ── Anonymous rail: capability-atom token verification ────────────────────
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
    // Do not change until Cred-Fix-2 — see cred-fix-tracker. This site fails
    // closed today; it must only change together with full token verification.
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

    const cr       = spendCheckRes.headers.get('Content-Range') ?? '';
    const crMatch  = cr.match(/\/(\d+)$/);
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

    // quotaRemaining stays null — server is blind to anonymous rail balance.
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Issue credential — same mint path as consumer
  // ───────────────────────────────────────────────────────────────────────────
  const API_EXPIRY_WINDOW = 90 * 24 * 3600;
  const uuid              = crypto.randomUUID();
  const issuedTier        = TIERS.CHARTERED;
  const mintKey           = rail === 'anonymous'
    ? env.MINT_API_PRIVATE_KEY
    : env.MINT_PRIVATE_KEY;

  const commitment = await computeCommitment(env.COMMITMENT_KEY, uuid, issuedTier, API_EXPIRY_WINDOW);

  let signedPoint, mintPubkey;
  try {
    ({ signedPoint, mintPubkey } = await issueBlindSignature(blinded_message, mintKey));
  } catch (e) {
    console.error('api_credential_issue: blind sig error:', e);
    return err(500, 'Credential issuance failed');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // ── AE event ───────────────────────────────────────────────────────────────
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
    allocation_bytes: 250 * 1024 * 1024 * 1024, // 250 GB API tier cap (SW-Opus-1)
    uuid,
    issued_tier:      issuedTier,
    commitment,
    expires_at:       expiresAt,
    quota_remaining:  quotaRemaining,             // number (identity) | null (anonymous)
    ...(quotaPeriodEnd !== undefined ? { period_end: quotaPeriodEnd } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Credential issue — POST /credential/issue
//
// S42c: UUID-bound credential issuance.
//
// The Worker generates the transfer UUID here — the client no longer generates
// it client-side. A commitment HMAC(COMMITMENT_KEY, uuid‖window‖tier) is
// computed (./commitment.js) and returned alongside the blind signature. The frontend echoes this
// commitment and issued_tier on chunk 0; the Worker recomputes and verifies.
//
// This closes the cross-transfer credential farming vector: a credential farmed
// for one UUID is cryptographically invalid for any other UUID.
//
// Nothing is stored. The binding lives in the commitment itself; only the
// Worker holds COMMITMENT_KEY, so only this endpoint (Turnstile-gated) and the
// HMAC-authed API issue path can mint a (uuid, commitment) pair.
// Full NUT-20 quote signatures deferred to B8 Rust mint.
//
// Resume-issue path removed (Cred-Fix-1). Resume uses the IDB-stored upload
// session token (Share-6); no client sends resume:true. It now returns 400.
// ─────────────────────────────────────────────────────────────────────────────

// Canonical expiry windows (seconds). Issue and /initiate both read this map;
// a change invalidates every outstanding commitment.
const EXPIRY_WINDOWS = {
  free:     7  * 24 * 3600,  //    604,800 s
  creative: 30 * 24 * 3600,  //  2,592,000 s
  max:      90 * 24 * 3600,  //  7,776,000 s
};

async function handleCredentialIssue(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }

  const { blinded_message, tier = 'free' } = body;
  if (!blinded_message) return err(400, 'Missing blinded_message');

  // Resume-issue path removed (Cred-Fix-1) — resume uses the upload session token.
  if (body.resume === true) {
    logEvent(env, { endpoint: 'credential_issue', tier: 'resume_rejected', status: 400, errorMsg: 'resume_issue_removed' });
    return err(400, 'Resume credential issuance is no longer supported');
  }

  // Fail closed before Turnstile is consumed if the commitment key is absent.
  if (!env.COMMITMENT_KEY) {
    console.error('credential_issue: COMMITMENT_KEY not configured');
    return err(500, 'Credential issuance not configured');
  }

  // ── Turnstile required ───────────────────────────────────────────────
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

  const issuedTier      = EXPIRY_WINDOWS[tier] !== undefined ? tier : 'free';
  const expiryWindow    = EXPIRY_WINDOWS[issuedTier];
  const allocationBytes = TIER_CAPS[issuedTier] ?? TIER_CAPS.free;

  const uuid = crypto.randomUUID();

  const commitment = await computeCommitment(env.COMMITMENT_KEY, uuid, issuedTier, expiryWindow);

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
  // Share-DAD-2: deleted (tombstone) or being deleted (consumed guard written,
  // tombstone not yet) → 410 and nothing else — no size, expiry or chunk count.
  if (manifest.consumed === true) {
    return new Response(JSON.stringify({ error: 'deleted' }), {
      status: 410, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({
    file_name:                manifest.file_name               ?? null,
    total_bytes:              manifest.total_bytes             ?? null,
    total_chunks:             manifest.total_chunks            ?? null,
    expiry_timestamp:         manifest.expiry_timestamp        ?? null,
    passphrase_protected:     !!manifest.p2sh_secret_hash,
    pending_destruction:      manifest.pending_destruction     ?? null,
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
// handleDownload — extracted to ./handlers/download.js (Share-6-5a).
//   Legacy serve preserved verbatim; verified path (merkle-spec §3 / B9-3)
//   added behind the per-manifest gate. index.js dispatches only (router).

// handleTimestampSubmit, handleTimestampSeal — moved to ./handlers/timestamp.js (SW9a)
// handleDeleteTransfer, handleOwnerDelete    — moved to ./handlers/delete_transfer.js (SW9a)
// handleStripeWebhook, handleCheckout, handleSubscriptionStatus, handlePortal,
// fetchTierFromSubscription, fetchPeriodEnd, tierFromPriceKey, upsertSubscriber
//   — moved to ./handlers/stripe_sub.js (SW9a)

// ═════════════════════════════════════════════════════════════════════════════
// Share-6-1 — direct-to-R2 upload: initiate + next-batch + presign smoke test.
//
// The legacy PUT /upload/:uuid/:chunk path was retired at Share-6-6b and its
// handler removed at Cred-Fix-1. This is the only upload path.
//
// Flow (Share-6-spec §3):
//   POST /upload/:uuid/initiate  → Cashu verify+spend once, size-cap, credit
//                                  debit (API tier), manifest, session token,
//                                  first batch of 256 presigned PutObject URLs.
//   POST /upload/:uuid/urls      → next batch, authed by the session token only.
//   (browser PUTs each ciphertext chunk direct to R2 — Worker not in the path.)
//   POST /upload/:uuid/finalise  → Share-6-3 (not this session).
// ═════════════════════════════════════════════════════════════════════════════

// Canonical expiry ceilings (seconds), keyed on resolvedTier.
// free/creative/max/api are the live Stripe-axis logic keys.
const INITIATE_EXPIRY_MAX = {
  free:     7  * 24 * 3600,
  creative: 30 * 24 * 3600,
  max:      90 * 24 * 3600,
  api:      90 * 24 * 3600,
};

const PART_SIZE_BYTES = 33_554_432; // 32 MiB (Share-6-spec §2, D-1)
const URL_BATCH_SIZE  = 256;        // Share-6-spec §6, D-5

// Constant-time string compare (matches the inline chunk-0 pattern). Used for
// commitment binding and session-token auth.
function ctEqual(a, b) {
  const ab = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (ab.length !== bb.length) return false;
  try {
    if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(ab, bb);
  } catch { /* fall through to manual compare */ }
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Resolve the R2 S3 endpoint config from Worker secrets/vars.
// The R2 secret access key is a Worker secret — never KV, never a URL (invariant).
function r2Config(env) {
  return {
    accountId:       env.CF_ACCOUNT_ID,
    accessKeyId:     env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
    bucket:          env.R2_BUCKET_NAME
                       || (env.ENVIRONMENT === 'production' ? 'refueler-share-prod' : 'refueler-share-dev'),
  };
}

// Build the MCP-spec §2.5 payment_required envelope from an applyQuotaSpend 402.
function paymentRequired402(response402, cost) {
  return new Response(
    JSON.stringify({
      error:             'payment_required',
      code:              response402.code,
      rail:              'identity',
      remaining_credits: response402.remaining_credits ?? 0,
      shortfall_credits: response402.shortfall_credits ?? cost,
      ...(response402.overage_credits !== undefined
        ? { overage_credits: response402.overage_credits, overage_ceiling: response402.overage_ceiling }
        : {}),
      payment: {
        method:        'out_of_band_v1',
        instructions:  'Request a credit top-up (or wait for your monthly reset) from your Refueler account.',
        dashboard_url: 'https://refueler.io/share/',
        offer:         null,
      },
    }),
    { status: 402, headers: { 'Content-Type': 'application/json' } }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload/:uuid/initiate
// ─────────────────────────────────────────────────────────────────────────────
async function handleInitiate(request, env, ctx, uuid) {
  if (!UUID_RE.test(uuid)) {
    logEvent(env, { endpoint: 'upload_initiate', status: 400, errorMsg: 'invalid_uuid' });
    return err(400, 'Invalid transfer ID');
  }

  // Idempotency: a transfer that already has a manifest must not re-spend.
  const existing = await safeGetManifest(env.BUCKET, uuid, env);
  if (existing.oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (existing.manifest) {
    logEvent(env, { endpoint: 'upload_initiate', status: 409, errorMsg: 'already_initiated' });
    return err(409, 'Transfer already initiated');
  }

  // ── Headers (migrated from chunk-0; no body, no per-chunk hash) ────────────
  const credential  = request.headers.get('X-Cashu-Credential');
  const totalChunks = parseInt(request.headers.get('X-Total-Chunks') ?? '0', 10);
  const totalBytes  = parseInt(request.headers.get('X-Total-Bytes')  ?? '0', 10);
  const expiryTs    = parseInt(request.headers.get('X-Expiry-Timestamp') ?? '0', 10);
  const p2shHash    = request.headers.get('X-P2SH-Secret-Hash') ?? null;
  const commitment  = request.headers.get('X-Credential-Commitment') ?? '';
  const issuedTier  = (request.headers.get('X-Issued-Tier') ?? 'free').trim().toLowerCase();
  const apiLiveKey  = request.headers.get('X-Api-Live-Key') ?? null;
  const rawTransferRef = request.headers.get('X-Transfer-Ref') ?? null;
  const apiTransferRef = rawTransferRef
    ? String(rawTransferRef).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 128)
    : null;

  if (!credential || !totalChunks || !totalBytes || !expiryTs) {
    return err(400, 'Missing required headers');
  }
  if (!commitment) {
    logEvent(env, { endpoint: 'upload_initiate', status: 401, errorMsg: 'credential_commitment_missing' });
    return err(401, 'Missing credential commitment');
  }
  // Fail closed (before the test-credential flag is consumed) if the key is absent.
  if (!env.COMMITMENT_KEY) {
    console.error('upload_initiate: COMMITMENT_KEY not configured');
    logEvent(env, { endpoint: 'upload_initiate', status: 503, errorMsg: 'commitment_key_missing' });
    return err(503, 'Upload temporarily unavailable');
  }

  // ── Share-Admin-1: test credential KV bypass ──────────────────────────────
  // Issued by POST /admin/test-credential. If present with initiated:false, skip
  // Supabase tier resolution, expiry ceiling check, size cap, Cashu verify, and
  // the spend INSERT. Marks the flag initiated:true so a second /initiate 409s.
  let isTestCredential = false;
  let testCredCapBytes = null;
  const testCredKvKey  = `test_credential:${uuid}`;
  try {
    const testCredRaw = await env.STATUS_KV.get(testCredKvKey, { type: 'json' });
    if (testCredRaw && testCredRaw.initiated === false) {
      isTestCredential = true;
      testCredCapBytes = testCredRaw.cap_bytes;
      // Mark initiated — a second /initiate will fall through to the normal 409 idempotency check.
      await env.STATUS_KV.put(
        testCredKvKey,
        JSON.stringify({ ...testCredRaw, initiated: true }),
        // keep whatever TTL is left — we can't read it, so reuse expiresInSeconds from the
        // credential's expires_at field embedded in the stored record.
        // Safest: let it expire naturally (no expirationTtl rewrite needed here).
      );
      console.log(`handleInitiate: test_credential bypass for uuid=${uuid} cap_bytes=${testCredCapBytes}`);
    }
  } catch (e) {
    console.error('handleInitiate: test_credential KV read failed, continuing normally:', e);
    // Non-fatal — fall through to normal path
  }

  // ── Resolved tier — never issued_tier for the cap ─────────────────────────
  // Cred-Fix-1: no request header selects a tier. Every consumer upload is
  // 'free' until B12-4a resolves paid tiers from an authenticated session.
  const resolvedTier = 'free';
  // For test credentials, use the stored cap_bytes directly; TIER_CAPS is not consulted.
  const tierCap = isTestCredential
    ? (testCredCapBytes ?? (250 * 1024 * 1024 * 1024))
    : (TIER_CAPS[resolvedTier] ?? TIER_CAPS.free);

  // ── UUID-bound commitment verification (S42c) ──────────────────────────────
  let expectedCommitment;
  if (isCharteredTier(issuedTier)) {
    const API_EXPIRY_WINDOW = 90 * 24 * 3600;
    expectedCommitment = await computeCommitment(env.COMMITMENT_KEY, uuid, TIERS.CHARTERED, API_EXPIRY_WINDOW);
  } else {
    const canonicalTier  = EXPIRY_WINDOWS[issuedTier] !== undefined ? issuedTier : 'free';
    expectedCommitment   = await computeCommitment(env.COMMITMENT_KEY, uuid, canonicalTier, EXPIRY_WINDOWS[canonicalTier]);
  }
  if (!ctEqual(commitment, expectedCommitment)) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 401, errorMsg: 'credential_uuid_mismatch' });
    return err(401, 'Credential commitment mismatch');
  }

  // ── Total chunks advisory ceiling (§1/§2) ──────────────────────────────────
  const TOTAL_CHUNKS_MAX = 10_000;
  if (totalChunks > TOTAL_CHUNKS_MAX) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 400, errorMsg: 'total_chunks_exceeded' });
    return err(400, `X-Total-Chunks exceeds maximum of ${TOTAL_CHUNKS_MAX}`);
  }

  // ── Expiry tier validation ─────────────────────────────────────────────────
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiryTs <= nowSeconds) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 400, errorMsg: 'expiry_in_past' });
    return err(400, 'X-Expiry-Timestamp is in the past');
  }
  if (!isTestCredential) {
    // Share-Admin-1: test credentials skip the expiry ceiling — they are admin-issued
    // with a configurable window up to 24 h. Normal tier ceiling does not apply.
    const maxWindow = INITIATE_EXPIRY_MAX[resolvedTier] ?? INITIATE_EXPIRY_MAX.free;
    if (expiryTs > nowSeconds + maxWindow) {
      logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 400, errorMsg: 'expiry_exceeds_tier' });
      return err(400, `X-Expiry-Timestamp exceeds maximum window for ${resolvedTier} tier (${maxWindow / 86400} days)`);
    }
  }

  // ── Size-cap guard (§5) — resolvedTier, never issued_tier. 413 on breach ───
  if (totalBytes > tierCap) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 413, errorMsg: 'declared_total_exceeds_cap' });
    return err(413, `Declared total ${totalBytes} bytes exceeds ${resolvedTier} tier cap of ${tierCap} bytes`);
  }

  // ── Cashu verify + spend ───────────────────────────────────────────────────
  // Share-Admin-1: test credentials skip both the BDHKE verify and the Supabase
  // spent_tokens INSERT. The test_credential KV flag (marked initiated:true above)
  // is the single-use guard. No serial → no Supabase write.
  let serial;
  if (!isTestCredential) {
    try {
      serial = await verifyCredential(JSON.parse(credential), env.MINT_PRIVATE_KEY);
    } catch {
      return err(401, 'Invalid credential');
    }
  }

  // ── API-tier credit-pool debit — COMPUTE and refuse (402) BEFORE the spend. ─
  // Sandbox (rfs_test_) keys never touch the production pool. Write-back happens
  // AFTER the atomic spend commits, so a double-spend (409) never debits credits.
  // Share-Admin-1: test credentials also skip the quota gate — there is no live_key.
  let quotaKey = null;
  let quotaUpdated = null;
  const isApiTier = !isTestCredential && isCharteredTier(issuedTier) && !!apiLiveKey && !isSandboxRequest(apiLiveKey);
  if (isApiTier) {
    const cost = computeTransferCost(totalBytes);
    quotaKey = await kvQuotaKey(apiLiveKey);
    const { record, error: loadErr } = await loadQuota(env, quotaKey);
    if (loadErr === 'kv_read_failed') {
      return err(502, 'Quota check unavailable — please retry');
    }
    if (loadErr) {
      logEvent(env, { endpoint: 'upload_initiate', tier: TIERS.CHARTERED, status: 402, errorMsg: 'quota_not_provisioned' });
      return new Response(
        JSON.stringify({ error: 'No quota record found — contact support', code: 'quota_not_provisioned' }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const { updated, response402 } = applyQuotaSpend(record, cost, nowSeconds);
    if (response402) {
      logEvent(env, { endpoint: 'upload_initiate', tier: TIERS.CHARTERED, status: 402, errorMsg: response402.code });
      return paymentRequired402(response402, cost);
    }
    quotaUpdated = updated;
  }

  // ── Tidal / destroy-after-download (migrated from chunk-0) ─────────────────
  const destroyAfterDownload = request.headers.get('X-Destroy-After-Download') === '1';
  const availableFromHeader  = request.headers.get('X-Available-From');
  const availableUntilHeader = request.headers.get('X-Available-Until');
  const hasTidalHeaders = availableFromHeader !== null || availableUntilHeader !== null;

  if (hasTidalHeaders && !isTidalPermitted(resolvedTier)) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 403, errorMsg: 'tidal_tier_gate' });
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
  const tidalInvariantError = validateTidalHeaders(availableFromTs, availableUntilTs, nowSeconds, expiryTs);
  if (tidalInvariantError) {
    logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 400, errorMsg: 'tidal_invariant_violation' });
    return err(400, tidalInvariantError);
  }

  // ── Spend — atomic double-spend guard: INSERT-on-serial (B8 §D-3). ─────────
  // sig → BDHKE done above; this INSERT is the point of no return. 409 conflict
  // = already spent (fire-and-forget log). This is the LAST Supabase write.
  // Share-Admin-1: test credentials skip the spend INSERT entirely — the KV flag
  // (initiated:true) is the single-use gate; no serial exists to insert.
  if (!isTestCredential) {
    const meltRes = await supabaseFetch(env, 'POST', '/rest/v1/spent_tokens', { serial });
    if (meltRes.status === 409) {
      supabaseFetch(env, 'POST', '/rest/v1/double_spend_attempts', {
        serial, uuid, attempted_at: new Date().toISOString(),
      }).then(r => {
        if (!r.ok) r.text().then(t => console.error('double_spend_attempts write failed:', t));
      }).catch(e => console.error('double_spend_attempts fetch error:', e));
      logEvent(env, { endpoint: 'upload_initiate', tier: resolvedTier, status: 409, errorMsg: 'credential_double_spend' });
      return err(409, 'Credential already spent');
    }
    if (!meltRes.ok) {
      console.error('spend INSERT failed:', serial, await meltRes.text());
      return err(502, 'Ledger unavailable');
    }
  }

  // ── Credit write-back — only after the spend commits (fire-and-forget KV) ──
  if (isApiTier && quotaKey && quotaUpdated) {
    env.STATUS_KV.put(quotaKey, JSON.stringify(quotaUpdated)).catch(e =>
      console.error('initiate: KV quota write-back failed:', e)
    );
  }

  // ── Manifest: upload_complete:false, chunks_received:[], filename constant ──
  // No merkle_root here — the browser writes it at /finalise (Share-6-3 / B9-1).
  const manifest = createManifest({
    uuid,
    tier: resolvedTier,
    totalChunks,
    totalBytes,
    expiryTimestamp: expiryTs,
    blake3Root: null,
    p2shSecretHash: p2shHash,
  });
  manifest.file_name       = 'encrypted-payload'; // D-1: real name in fragment only
  manifest.chunks_received = [];
  manifest.upload_complete = false;
  manifest.status          = 'uploading';
  manifest.upload_mode     = 'direct-r2'; // Share-6 marker for finalise/download branch

  if (destroyAfterDownload) manifest.pending_destruction = false; // armed
  if (availableFromTs !== null)  manifest.available_from_timestamp  = availableFromTs;
  if (availableUntilTs !== null) manifest.available_until_timestamp = availableUntilTs;

  if (isCharteredTier(issuedTier) && apiLiveKey) {
    manifest.api_live_key    = apiLiveKey;
    manifest.api_accepted_at = nowSeconds;
    if (apiTransferRef) manifest.api_transfer_ref = apiTransferRef;
  }

  await putManifest(env.BUCKET, uuid, manifest);

  // ── Execution Dock KV entry (TG-4) ─────────────────────────────────────────
  const dockTtl = (expiryTs - nowSeconds) + 48 * 3600 + 3600;
  env.STATUS_KV.put(
    `dock_index:${uuid}`,
    JSON.stringify({
      expiry_timestamp: expiryTs,
      tier:             resolvedTier,
      file_name:        'encrypted-payload',
      created_at:       nowSeconds,
    }),
    { expirationTtl: Math.max(dockTtl, 3600) }
  ).catch(e => console.error('Execution Dock KV write failed:', e));

  // NOTE: the cargo.accepted receipt is deferred to /finalise (Share-6-3, spec
  // §3③.4). Under direct-R2 the transfer is not "accepted" until finalise
  // validates completeness — so it is NOT emitted here. (In the legacy chunk-0
  // path it fired at manifest-write; that path is unchanged.)

  // ── Upload-session token (32 opaque random bytes, KV-TTL to expiry) ──────────────
  // Severs the gratuitous HMAC binding to WEBHOOK_SIGNING_MASTER_KEY (Share-6-4a).
  // KV storage, TTL, and both ctEqual verifiers (handleUploadUrls, finalise.js)
  // are UNCHANGED — they compare the stored value byte-for-byte. Backward-compatible:
  // HMAC-shaped tokens already in KV still verify; only newly-minted tokens change shape.
  const _rndBytes   = crypto.getRandomValues(new Uint8Array(32));
  const sessionToken = btoa(String.fromCharCode(..._rndBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sessionTtl   = Math.max(expiryTs - nowSeconds, 3600);
  try {
    await env.STATUS_KV.put(`upload_session:${uuid}`, sessionToken, { expirationTtl: sessionTtl });
  } catch (e) {
    console.error('upload_session KV write failed:', e);
    return err(502, 'Session store unavailable');
  }

  // ── First batch of presigned PutObject URLs (§6) ───────────────────────────
  let presign;
  try {
    presign = await makePresigner(r2Config(env));
  } catch (e) {
    console.error('makePresigner failed:', e);
    return err(503, 'R2 presigning not configured');
  }
  const firstCount = Math.min(totalChunks, URL_BATCH_SIZE);
  const urls = [];
  for (let i = 0; i < firstCount; i++) {
    const { url, expires } = await presign(`${uuid}/${String(i).padStart(4, '0')}`);
    urls.push({ index: i, url, expires });
  }
  const batchNext = totalChunks > URL_BATCH_SIZE ? URL_BATCH_SIZE : null;

  return json({
    uuid,
    session_token: sessionToken,
    part_size:     PART_SIZE_BYTES,
    total_chunks:  totalChunks,
    urls,
    batch_next:    batchNext,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload/:uuid/urls  — next presigned-URL batch, session-token authed.
// Never re-verifies or re-spends Cashu (spec §6, do-not-retry §10).
// Body: { from:int, count:int }.  Returns { urls:[{index,url,expires}], batch_next }.
// ─────────────────────────────────────────────────────────────────────────────
async function handleUploadUrls(request, env, uuid) {
  if (!UUID_RE.test(uuid)) return err(400, 'Invalid transfer ID');

  // ── Session-token auth (timing-safe compare vs KV) ─────────────────────────
  const presented = request.headers.get('X-Upload-Session') ?? '';
  let stored = null;
  try {
    stored = await env.STATUS_KV.get(`upload_session:${uuid}`);
  } catch (e) {
    console.error('upload_session KV read failed:', e);
    return err(502, 'Session store unavailable');
  }
  if (!presented || !stored || !ctEqual(presented, stored)) {
    logEvent(env, { endpoint: 'upload_urls', status: 401, errorMsg: 'session_token_invalid' });
    return err(401, 'Invalid or expired upload session');
  }

  // ── Manifest bounds ────────────────────────────────────────────────────────
  const { manifest, oversize } = await safeGetManifest(env.BUCKET, uuid, env);
  if (oversize) return err(502, 'Transfer manifest exceeds size limit');
  if (!manifest) return err(404, 'Transfer not found');
  if (manifest.upload_complete) return err(409, 'Upload already complete');
  const totalChunks = manifest.total_chunks ?? 0;

  let body;
  try {
    body = await request.json();
  } catch {
    return err(400, 'Invalid JSON');
  }
  const from  = parseInt(body.from, 10);
  let   count = parseInt(body.count, 10);
  if (!Number.isInteger(from) || from < 0 || from >= totalChunks) {
    return err(400, 'from out of range');
  }
  if (!Number.isInteger(count) || count < 1) {
    return err(400, 'count must be a positive integer');
  }
  count = Math.min(count, URL_BATCH_SIZE, totalChunks - from);

  let presign;
  try {
    presign = await makePresigner(r2Config(env));
  } catch (e) {
    console.error('makePresigner failed:', e);
    return err(503, 'R2 presigning not configured');
  }
  const urls = [];
  for (let i = from; i < from + count; i++) {
    const { url, expires } = await presign(`${uuid}/${String(i).padStart(4, '0')}`);
    urls.push({ index: i, url, expires });
  }
  const next = (from + count) < totalChunks ? (from + count) : null;

  return json({ uuid, urls, batch_next: next });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /admin/r2-presign-test  — X-Admin-Key gated. DEV bucket only.
// Presigns one PutObject so the presigner can be proven end-to-end (Share-6-1
// definition of done) without a Cashu credential. Cannot mint a prod write URL.
// Body (optional): { key }.  Returns { url, expires, bucket, key }.
// ─────────────────────────────────────────────────────────────────────────────
async function handleAdminR2PresignTest(request, env) {
  const adminKey = request.headers.get('X-Admin-Key');
  if (!adminKey || adminKey !== env.ADMIN_KEY) return err(401, 'Unauthorised');

  let body = {};
  try { body = await request.json(); } catch { /* optional body */ }

  const key = (typeof body.key === 'string' && body.key)
    ? body.key.replace(/[^0-9A-Za-z/_-]/g, '')
    : `share-6-1-smoke/${crypto.randomUUID()}/0000`;

  const cfg = {
    accountId:       env.CF_ACCOUNT_ID,
    accessKeyId:     env.R2_S3_ACCESS_KEY_ID,
    secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
    bucket:          'refueler-share-dev', // forced — never prod from this endpoint
  };
  if (!cfg.accessKeyId || !cfg.secretAccessKey) {
    return err(503, 'R2 API token not configured (set R2_S3_ACCESS_KEY_ID / R2_S3_SECRET_ACCESS_KEY)');
  }
  try {
    const { url, expires } = await presignPutObject({ ...cfg, key });
    return json({ ok: true, bucket: cfg.bucket, key, url, expires });
  } catch (e) {
    return err(500, `Presign failed: ${e.message}`);
  }
}