/**
 * app_turnstile.js — which Turnstile tokens the app's widget may spend (Turnstile-Gate-1,
 * 6 Nov 2026, docs/Turnstile-Gate-plan-v1.md §5). Kept apart from turnstile.js so the tests
 * that stub siteverify (vi.mock('../src/turnstile.js')) still get the real rule.
 */

// Where the app's widget ran before the gate. Accepted only inside the legacy window,
// and only without an action (the old app set none).
export const LEGACY_APP_TURNSTILE_HOSTNAME = 'share.refueler.io';

/**
 * appTurnstileRule(env, action, nowSeconds?) → options for verifyTurnstileToken.
 * The app widget (TURNSTILE_SECRET_KEY): gate host + action; the legacy host while
 * now < APP_TURNSTILE_LEGACY_UNTIL (unix seconds; "0" or absent = shut).
 */
export function appTurnstileRule(env, action, nowSeconds = Math.floor(Date.now() / 1000)) {
  const until = Number(env?.APP_TURNSTILE_LEGACY_UNTIL ?? 0);
  return {
    hostnames:       env?.APP_TURNSTILE_HOSTNAME ? [env.APP_TURNSTILE_HOSTNAME] : [],
    action,
    legacyHostnames: Number.isFinite(until) && nowSeconds < until ? [LEGACY_APP_TURNSTILE_HOSTNAME] : [],
    // Integration runs only (wrangler dev); turnstile.js takes nothing but a localhost address.
    ...(env?.TURNSTILE_VERIFY_URL ? { verifyUrl: env.TURNSTILE_VERIFY_URL } : {}),
  };
}

