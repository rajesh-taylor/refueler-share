/**
 * turnstile.js — Cloudflare Turnstile verification
 *
 * Free tier (Skint Tog) gate. No account, no payment.
 * Turnstile is the only abuse-prevention layer before NUT-00 blind sig issuance.
 * Paid tiers bypass Turnstile — subscription status checked instead.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * verifyTurnstileToken(token, secretKey) → boolean
 * Fail-closed: any error returns false.
 */
export async function verifyTurnstileToken(token, secretKey) {
  if (!token || typeof token !== 'string' || token.length === 0) return false;

  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', token);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

// Alias for any legacy callers
export { verifyTurnstileToken as verifyTurnstile };
