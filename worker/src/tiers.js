// worker/src/tiers.js
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Tier vocabulary — single source of truth for tier logic keys and display names
//
// Share-1 (Tier Constants Decoupling): display names are divorced from logic
// keys. All tier-gating logic keys off the TIERS.* enum below. Display names
// live in TIER_DISPLAY and are resolved at render time only (Session 3 wires
// the render layer — this session introduces the module and the api→CHARTERED
// gate only).
//
// ── IMPORTANT: two distinct tier axes exist in this codebase ─────────────────
//
//   1. The CHARTERED (API) axis — the rfs_live_ / rfs_test_ key-holder rail.
//      Wire value: 'api'. This is what wl_config.js, webhook_reg.js, and the
//      index.js credential-issue / upload branches gate on today. CHARTERED
//      below deliberately carries the wire value 'api' so isCharteredTier()
//      matches every existing `client.tier === 'api'` / `issuedTier === 'api'`
//      contract without a data migration. Renaming the wire string to
//      'chartered' is a later, separate migration decision.
//
//   2. The consumer / Stripe axis — free | creative | max. These strings are
//      derived from Stripe lookup keys (see stripe.js getSubscriptionTier and
//      index.js EXPIRY_WINDOWS / TIER_CAPS). They are Stripe-owned, immutable
//      this session, and NOT modelled by TIERS below. Do not fold them in here
//      without a dedicated migration session — the price-lookup-key coupling
//      makes them load-bearing on the wire.
//
// The Pro Bono / Citizen / Sovereign / Chartered display set (TIER_DISPLAY) is
// the brand-locked naming from Share-Brand-Opus-1. FREE/PAID_REGISTERED/
// PAID_BEARER are reserved logic keys for the future registered/bearer split;
// they are defined here so the render layer and later sessions have stable
// keys to build against, even though index.js does not yet emit them.
// ─────────────────────────────────────────────────────────────────────────────

/** Internal logic keys. Gate on these, never on display names. */
export const TIERS = Object.freeze({
  FREE:            'free',
  PAID_REGISTERED: 'paid_registered',
  PAID_BEARER:     'paid_bearer',
  CHARTERED:       'api', // wire value stays 'api' — see axis note above
});

/** Display names — resolved at render time only (Session 3). */
export const TIER_DISPLAY = Object.freeze({
  [TIERS.FREE]:            'Pro Bono',
  [TIERS.PAID_REGISTERED]: 'Citizen',
  [TIERS.PAID_BEARER]:     'Sovereign',
  [TIERS.CHARTERED]:       'Chartered',
});

/** Payment rail per tier. null = no rail (free / chartered gate on key-holding). */
export const TIER_RAIL = Object.freeze({
  [TIERS.FREE]:            null,
  [TIERS.PAID_REGISTERED]: 'registered',
  [TIERS.PAID_BEARER]:     'bearer',
  [TIERS.CHARTERED]:       null,
});

/** displayName('api') → 'Chartered'. Falls back to the key itself if unmapped. */
export function displayName(tierKey) {
  return TIER_DISPLAY[tierKey] ?? tierKey;
}

/** True for any tier that is not the free tier. */
export function isPaidTier(tierKey) {
  return tierKey !== TIERS.FREE;
}

/** True only for the anonymous bearer tier. */
export function isBearerTier(tierKey) {
  return tierKey === TIERS.PAID_BEARER;
}

/** True only for the Chartered (API) tier — wire value 'api'. */
export function isCharteredTier(tierKey) {
  return tierKey === TIERS.CHARTERED;
}
