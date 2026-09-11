// worker/src/handlers/api_capabilities.js
//
// GET /api/v1/capabilities — HMAC-authenticated capability discovery.
//
// Response shape: locked in spec §7.1 and CLAUDE.md (SW-MCP-W1).
// schema_version: "cap.v1" — this exact string must never change without
// a major version bump.
//
// rails_available: live state only. ["identity"] until B7/NB-4.
// Never add "lightning" until the node is live and passing health checks.
//
// daily_reference_rate: floated from KV key btc_ref_rate:current.
// On cold start (no KV entry): null block, never invented.
//
// credit_unit: "sat" — internal canonical. User-facing copy always "credits".
//
// Bundle denominations (locked SW2c):
//   Fixed lots: 10 / 50 / 100 / 500 credits.
//   Prevents purchase-size fingerprinting on the anonymous rail.
//
// Rate card v1.0 (locked SW-Opus-2, 7 Sep 2026):
//   transfer:          10 credits
//   storage_per_gb:   100 credits
//   permanent_record:  20 credits
//   Governance: first review at £100k BTC 30d trailing avg or ±40% GBP drift.
//
// MCP tool list (locked SW-Opus-1):
//   refueler_capabilities, refueler_send_file,
//   refueler_check_transfer, refueler_quote

import { requireApiAuth, kvQuotaKey } from '../api_auth.js';

// ─────────────────────────────────────────────────────────────────────────────
// Bundle denominations — fixed lots for both rails.
// Exported so onboarding and invoice handlers can reference without duplication.
// ─────────────────────────────────────────────────────────────────────────────
export const BUNDLE_DENOMINATIONS = [10, 50, 100, 500];
export const BUNDLE_DEFAULT       = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Rate card v1.0
// All values are integers (credits). Do not use floats.
// ─────────────────────────────────────────────────────────────────────────────
export const RATE_CARD = {
  transfer:          10,  // credits per transfer slot (one credential issuance)
  storage_per_gb:   100,  // credits per GB of storage overage
  permanent_record:  20,  // credits per OTS timestamp (Tower Hill)
};

// Rate card governance metadata — informational, not enforced here.
const RATE_CARD_META = {
  version:                  '1.0',
  published:                '2026-09-07',
  review_trigger_btc_gbp:   100000, // 30d trailing average — first review point
  reprice_drift_threshold:  0.40,   // ±40% GBP drift → new version
};

// ─────────────────────────────────────────────────────────────────────────────
// Features map (locked SW-Opus-1)
//
// Values: true = live, false = not yet shipped, null = gated (see note).
// Consumer context: every feature key is stable once present. Do not remove.
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = {
  upload:              true,
  download:            true,
  permanent_record:    true,   // Tower Hill (TH-series)
  webhook:             true,   // SW4+
  receipts:            true,   // SW5+
  mcp_tools:           true,   // SW-MCP-W1 (this session)
  silent_drop_anon:    false,  // SD-block — requires B8 (NUT-11 Mode 2)
  anonymous_rail:      false,  // B7/NB-4 — Lightning node not yet live
};

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────
const LIMITS = {
  max_file_size_gb: 250,
  transfer_expiry_days: {
    citizen:   7,
    sovereign: 90,
    api:       90,
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
// KV key for the BTC reference rate
// ─────────────────────────────────────────────────────────────────────────────
export const BTC_RATE_KV_KEY = 'btc_ref_rate:current';

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
// Identity rail:
//   quota.remaining  — live from KV (null if no record yet)
//   quota.updated_at — unix seconds of last top-up / decrement
//   quota.model      — 'kv_pool'
//
// Anonymous rail:
//   quota.remaining  — null (server holds no balance)
//   quota.model      — 'bearer'
//   quota.server_blind — true
//   quota.note       — plain-English explanation for the agent / client
//
// Both rails receive the full capabilities payload.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleApiCapabilities(request, env) {
  // ── HMAC auth ─────────────────────────────────────────────────────────────
  let client, apiKey;
  try {
    ({ client, apiKey } = await requireApiAuth(request, new ArrayBuffer(0), env));
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('api_capabilities: unexpected auth error:', authErr);
    return err(500, 'Authentication error.');
  }

  const rail = client.rail ?? 'identity';

  // ── Daily reference rate — read from KV, never invented ───────────────────
  let daily_reference_rate = null;
  try {
    const rateRecord = await env.STATUS_KV.get(BTC_RATE_KV_KEY, { type: 'json' });
    if (rateRecord && typeof rateRecord.gbp_per_btc === 'number') {
      // Surface the full schema: { gbp_per_btc, source, last_updated, set_by, previous }
      daily_reference_rate = {
        gbp_per_btc:  rateRecord.gbp_per_btc,
        source:       rateRecord.source        ?? null,
        last_updated: rateRecord.last_updated  ?? null,
        set_by:       rateRecord.set_by        ?? null,
        previous:     rateRecord.previous      ?? null,
      };
    }
    // If rateRecord is null (cold start) — daily_reference_rate stays null.
    // Never invent a number.
  } catch (e) {
    // KV read failure → null block, not 502. Capabilities should degrade
    // gracefully; the rate card is advisory, not load-bearing for auth.
    console.error('api_capabilities: KV btc_ref_rate read failed:', e);
  }

  // ── Quota — rail-dependent ────────────────────────────────────────────────
  let quota;

  if (rail === 'identity') {
    const qKey = await kvQuotaKey(apiKey);
    let quotaRecord = null;
    try {
      quotaRecord = await env.STATUS_KV.get(qKey, { type: 'json' });
    } catch (e) {
      console.error('api_capabilities: KV quota read failed:', e);
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
    // Anonymous rail — server is blind to balance.
    quota = {
      model:        'bearer',
      remaining:    null,
      server_blind: true,
      note: 'You hold your credits locally as Cashu tokens. ' +
            'Present one token per credential issuance. ' +
            'The server cannot report a balance it does not hold.',
    };
  }

  // ── Response ──────────────────────────────────────────────────────────────
  return json({
    schema_version:       'cap.v1',
    api_version:          'v1',
    rail,

    // Live state — ["identity"] until B7/NB-4. Never invent future state.
    rails_available:       ['identity'],

    credit_unit:           'sat',

    rate_card_version:     RATE_CARD_META.version,
    rate_card:             RATE_CARD,
    rate_card_governance:  RATE_CARD_META,

    bundle_denominations:  BUNDLE_DENOMINATIONS,
    bundle_default:        BUNDLE_DEFAULT,

    features:              FEATURES,
    mcp_tools:             MCP_TOOLS,
    limits:                LIMITS,

    // Floating reference rate — null on cold start, never invented.
    daily_reference_rate,

    quota,

    endpoints: {
      capabilities:       'GET  /api/v1/capabilities',
      credential_issue:   'POST /api/v1/credential/issue',
      transfer_status:    'GET  /api/v1/transfer/:uuid',
      webhook_register:   'POST /api/v1/webhook/register',
      receipt:            'GET  /api/v1/receipt/:uuid/:type',
      webhook_status:     'GET  /api/v1/webhooks/status',
      hostname_health:    'GET  /api/v1/hostname/health',
    },

    sandbox: {
      note:        'Use rfs_test_ prefixed credentials against the same Worker. ' +
                   'Test credits are non-anonymous by design (observable for debugging). ' +
                   'Do not send real cargo to the sandbox.',
      key_prefix:  'rfs_test_',
      sign_prefix: 'rfs_test_sign_',
    },
  });
}
