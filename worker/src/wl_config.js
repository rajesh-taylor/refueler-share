// worker/src/wl_config.js
'use strict';

const WL_CONFIGS = {
  'api.share.refueler.io': {
    hostname:          'api.share.refueler.io',
    label:             'Refueler Share API',
    tier:              'api',
    rail:              'identity',
    badge_url:         'https://refueler.io/share/',
    rate_card_version: '1.0',
    features: {
      permanent_record: true,
      silent_drop:      false,
      mcp_tools:        true,
      webhooks:         true,
      sandbox:          true,
    },
  },
};

export function getWlConfig(host) {
  if (!host) return null;
  const canonical = host.split(':')[0].toLowerCase().trim();
  return WL_CONFIGS[canonical] ?? null;
}

export function handleWlConfig(request) {
  const host   = request.headers.get('Host') ?? '';
  const config = getWlConfig(host);
  if (!config) {
    return new Response(
      JSON.stringify({ error: 'unknown_host', host }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response(
    JSON.stringify(config),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
}

const CF_CHALLENGES = {
  'd1d04abe-854c-48a0-8afe-bca47dfb0c3b': '46e1d042-103e-4dee-ae2d-13929039de69',
};

export function handleCfChallenge(path) {
  const m = path.match(/^\/.well-known\/cf-custom-hostname-challenge\/([0-9a-f-]{36})$/i);
  if (!m) return null;
  const body = CF_CHALLENGES[m[1]];
  if (!body) return new Response('not found', { status: 404 });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
