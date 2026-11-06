/**
 * turnstile.js — Cloudflare Turnstile verification
 *
 * Free tier (Skint Tog) gate. No account, no payment.
 * Turnstile is the only abuse-prevention layer before NUT-00 blind sig issuance.
 * Paid tiers bypass Turnstile — subscription status checked instead.
 *
 * Turnstile-Gate-1 (6 Nov 2026, docs/Turnstile-Gate-plan-v1.md §5): the app's widget runs
 * only on gate.share.refueler.io, so a token must say it was made there (siteverify's
 * `hostname`) and for the job it is spent on (`action`: upload / signin). The old app
 * (share.refueler.io, no action) is accepted only until APP_TURNSTILE_LEGACY_UNTIL.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// The integration run (tests/integration, wrangler dev) answers siteverify itself, since
// Cloudflare's test secret names no gate host and no action. Only a localhost address is ever
// taken: on the live Worker one could only fail (nothing listens there), never pass.
const LOCAL_VERIFY_RE = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}\/[\w/-]*$/;
export const verifyUrlFor = (url) => (typeof url === 'string' && LOCAL_VERIFY_RE.test(url) ? url : TURNSTILE_VERIFY_URL);

/**
 * verifyTurnstileToken(token, secretKey, { hostnames, action, legacyHostnames }) → boolean
 * Fail-closed: any error, or no hostnames, returns false.
 *   hostnames        siteverify's `hostname` must be one of these…
 *   action           …and, when given, its `action` must equal this exactly.
 *   legacyHostnames  a token from one of these passes only with no action at all.
 *   verifyUrl        integration runs only: a localhost siteverify (see LOCAL_VERIFY_RE).
 */
export async function verifyTurnstileToken(token, secretKey, opts = {}) {
  if (!token || typeof token !== 'string' || token.length === 0) return false;
  if (!secretKey) return false;
  const hostnames = Array.isArray(opts?.hostnames) ? opts.hostnames.filter(Boolean) : [];
  const legacy    = Array.isArray(opts?.legacyHostnames) ? opts.legacyHostnames.filter(Boolean) : [];
  if (hostnames.length === 0) return false;

  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', token);

  try {
    const res = await fetch(verifyUrlFor(opts?.verifyUrl), { method: 'POST', body });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== 'object' || data.success !== true) return false;
    const host = typeof data.hostname === 'string' ? data.hostname : '';
    const act  = data.action ?? '';
    if (hostnames.includes(host)) return opts.action === undefined || act === opts.action;
    if (legacy.includes(host)) return act === '';
    return false;
  } catch {
    return false;
  }
}

// Alias for any legacy callers
export { verifyTurnstileToken as verifyTurnstile };
