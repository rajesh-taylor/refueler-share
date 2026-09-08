// worker/src/handlers/api_capabilities.js
//
// GET /api/v1/capabilities — HMAC-authenticated capability discovery.
//
// Returns the rate-card, tier model, feature flags, MCP tool list, and
// (identity rail only) live quota from KV.
//
// Anonymous rail quota model:
//   The server holds NO quota record for anonymous-rail clients.
//   Quota = client-held bearer Cashu capability-atom tokens (blind-signed,
//   unlinkable, non-recoverable). The server cannot report a balance it does
//   not hold. The capabilities response returns the rate card (cost per action
//   in capability atoms) so the client can compute their own remaining balance
//   against their local token stack.
//
// Bundle denominations (locked SW2c):
//   Anonymous-rail clients purchase tokens in fixed lots only.
//   Fixed denominations prevent purchase-size fingerprinting:
//   a client who buys exactly 37 tokens is more distinguishable than one who
//   buys a round lot from the standard set.
//   Standard lots: 10 / 50 / 100 / 500 tokens.
//   Bespoke lots available for identity-rail clients on request (AM-mediated).
//
// Rate card v1.0 (locked SW-Opus-2, 7 Sep 2026):
//   1 capability atom = 1 credential issuance = 1 transfer slot.
//   GBP peg: £50k BTC 30-day trailing average review trigger.
//   Sat cost per atom defined in RATE_CARD below — informational only in this
//   response; the mint enforces atom cost at issuance time.
//
// MCP tool list (locked SW-Opus-1):
//   refueler_capabilities, refueler_send_file,
//   refueler_check_transfer, refueler_quote
//
// This handler is imported by index.js.
// Bundle denomination constants are exported for use by other handlers
// (e.g. onboarding, invoice generation at SW7).

import { requireApiAuth } from '../api_auth.js';
import { kvQuotaKey }     from '../api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bundle denominations
//
// Fixed lots for anonymous-rail token purchases.
// Fingerprinting protection: all clients buy from this set.
// ─────────────────────────────────────────────────────────────────────────────
export const BUNDLE_DENOMINATIONS = [10, 50, 100, 500];

export const BUNDLE_DEFAULT = 50; // Recommended starting lot for new clients.

// ─────────────────────────────────────────────────────────────────────────────
// Rate card v1.0
//
// cost_atoms: capability atoms consumed per action.
// sat_reference: informational sat equivalent at rate-card v1.0 peg.
//                Do NOT use for billing — atom is the unit, not the sat value.
// ─────────────────────────────────────────────────────────────────────────────
export const RATE_CARD = {
  version: '1.0',
  reviewed_at: '2026-09-07',
  review_trigger_gbp_btc: 50000, // Rate-card governance: review at £50k BTC 30d trailing avg.
  actions: {
    credential_issue: {
      cost_atoms:    1,
      sat_reference: 10,
      description:   'Issue one transfer credential (one transfer slot).',
    },
    storage_gb: {
      cost_atoms:    null,           // Identity rail: invoiced. Anonymous rail: not available at v1.
      sat_reference: 100,            // 100 sat/GB reference — informational.
      description:   'Storage overage per GB beyond allocation. Identity rail invoiced; anonymous rail v2.',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tier model — API tier only
//
// Storage cap and expiry window match the locked decisions from SW-Opus-1.
// ─────────────────────────────────────────────────────────────────────────────
const TIER_MODEL = {
  api: {
    storage_bytes:      250 * 1024 * 1024 * 1024, // 250 GB
    expiry_window_days: 90,
    features: [
      'upload',
      'download',
      'timestamp',
      'mcp_tools',
    ],
    features_pending: [
      'silent_drop_anon', // SD-block, requires B8 (NUT-11 Mode 2)
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// MCP tool list (locked SW-Opus-1)
// ─────────────────────────────────────────────────────────────────────────────
const MCP_TOOLS = [
  'refueler_capabilities',
  'refueler_send_file',
  'refueler_check_transfer',
  'refueler_quote',
];

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(status, message, code) {
  return new Response(
    JSON.stringify({ error: message, ...(code ? { code } : {}) }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// handleApiCapabilities — GET /api/v1/capabilities
//
// HMAC-authenticated. Both rails.
//
// Identity rail response includes:
//   quota.remaining  — live from KV
//   quota.updated_at — unix seconds of last top-up / decrement
//   quota.model      — 'kv_pool'
//
// Anonymous rail response:
//   quota.remaining  — null  (server holds no balance)
//   quota.model      — 'bearer'
//   quota.note       — plain-English explanation for the API client / agent
//
// Both rails receive:
//   api_version, rate_card, bundle_denominations, tiers, mcp_tools,
//   endpoints (informational route map)
// ─────────────────────────────────────────────────────────────────────────────
export async function handleApiCapabilities(request, env) {
  // ── HMAC auth ─────────────────────────────────────────────────────────────
  // GET has no body — pass empty ArrayBuffer for body hash.
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('api_capabilities: unexpected auth error:', authErr);
    return err(500, 'Authentication error');
  }

  const rail = client.rail ?? 'identity';

  // ── Quota — rail-dependent ────────────────────────────────────────────────
  let quota;

  if (rail === 'identity') {
    // Read live quota from KV.
    const qKey = await kvQuotaKey(apiKey);
    let quotaRecord = null;
    try {
      quotaRecord = await env.STATUS_KV.get(qKey, { type: 'json' });
    } catch (e) {
      console.error('api_capabilities: KV quota read failed:', e);
      // Non-fatal — return null quota rather than 502. The client can retry.
    }

    quota = {
      model:      'kv_pool',
      remaining:  quotaRecord?.remaining  ?? null,
      updated_at: quotaRecord?.updated_at ?? null,
      note: quotaRecord
        ? null
        : 'Quota record not found. Contact your account manager to confirm your credit pool.',
    };
  } else {
    // Anonymous rail — server holds no balance. Client computes from token stack.
    quota = {
      model:     'bearer',
      remaining: null,
      note:      'Anonymous rail: quota is your local Cashu token stack. ' +
                 'Present one capability-atom token per credential issuance. ' +
                 'The server cannot report a balance it does not hold.',
    };
  }

  // ── Response ──────────────────────────────────────────────────────────────
  return json({
    api_version:         'v1',
    rail,
    rate_card:           RATE_CARD,
    bundle_denominations: BUNDLE_DENOMINATIONS,
    bundle_default:      BUNDLE_DEFAULT,
    tiers:               TIER_MODEL,
    mcp_tools:           MCP_TOOLS,
    quota,
    endpoints: {
      credential_issue:   'POST /api/v1/credential/issue',
      capabilities:       'GET  /api/v1/capabilities',
      transfer_status:    'GET  /api/v1/transfer/:uuid',    // SW4
      webhook_register:   'POST /api/v1/webhook',           // SW5
      keys_rotate:        'POST /api/v1/keys/rotate',       // SW6
    },
    sandbox: {
      note:         'Use rfs_test_ prefixed credentials against the same Worker. ' +
                    'Test credits are non-anonymous by design (observable for debugging). ' +
                    'Do not send real cargo to the sandbox.',
      key_prefix:   'rfs_test_',
      sign_prefix:  'rfs_test_sign_',
    },
  });
}
