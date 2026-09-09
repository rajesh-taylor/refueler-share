// worker/src/handlers/hostname_health.js
//
// SW5b — GET /api/v1/hostname/health
//
// Returns the CF for SaaS hostname configuration for the authenticated API
// client, derived from the Host header on the incoming request.
//
// WL_CONFIGS is the in-memory source of truth (wl_config.js). There is no KV
// store for hostname config — the Worker deploy is the config deploy. This
// means the health endpoint reflects the live deployed config, not a stored
// snapshot. If the hostname is in WL_CONFIGS, it is configured. If not, it is
// not. No staleness possible.
//
// Response shape:
//   {
//     hostname:    string,
//     configured:  boolean,
//     label:       string | null,
//     tier:        string | null,
//     rail:        string | null,
//     features:    object | null,
//     badge_url:   string | null,
//     checked_at:  number,           // unix seconds (now)
//   }
//
// Auth: HMAC-authenticated via requireApiAuth.
// The Host header identifies which hostname to report on — a client hitting
// api.share.refueler.io gets the config for that hostname. A white-label
// client hitting their own custom hostname gets their own config. One endpoint,
// N clients, zero cross-contamination.

'use strict';

import { requireApiAuth } from '../api_auth.js';
import { getWlConfig }    from '../wl_config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────────────────
function jsonOk(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function errJson(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// handleHostnameHealth — GET /api/v1/hostname/health
// ─────────────────────────────────────────────────────────────────────────────
export async function handleHostnameHealth(request, env) {
  // ── HMAC auth ─────────────────────────────────────────────────────────────
  try {
    await requireApiAuth(request, new ArrayBuffer(0), env);
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    console.error('hostname_health: unexpected auth error:', authErr);
    return errJson(500, 'Authentication error');
  }

  // ── Resolve hostname from Host header ─────────────────────────────────────
  const rawHost = request.headers.get('Host') ?? '';
  const hostname = rawHost.split(':')[0].toLowerCase().trim();
  const checkedAt = Math.floor(Date.now() / 1000);

  // ── Look up in-memory WL_CONFIGS ──────────────────────────────────────────
  const config = getWlConfig(rawHost);

  if (!config) {
    return jsonOk({
      hostname:   hostname,
      configured: false,
      label:      null,
      tier:       null,
      rail:       null,
      features:   null,
      badge_url:  null,
      checked_at: checkedAt,
    });
  }

  return jsonOk({
    hostname:   config.hostname,
    configured: true,
    label:      config.label,
    tier:       config.tier,
    rail:       config.rail,
    features:   config.features,
    badge_url:  config.badge_url,
    checked_at: checkedAt,
  });
}
