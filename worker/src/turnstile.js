/**
 * Cloudflare Turnstile — free tier anonymous upload gate
 *
 * Free tier (Skint Tog) has no account and no payment.
 * Turnstile is the only abuse-prevention layer before NUT-00 blind sig issuance.
 * Paid tiers use NUT-04 payment verification instead.
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * verifyTurnstile(token, secretKey, request) → boolean
 *
 * Verifies a Turnstile challenge token with Cloudflare's siteverify endpoint.
 * Passes the client IP to strengthen the verification signal.
 *
 * Returns true only if Cloudflare confirms the token as valid.
 * Any network failure or non-success response is treated as failure (fail-closed).
 */
export async function verifyTurnstile(token, secretKey, request) {
  if (!token || typeof token !== 'string' || token.length === 0) {
    return false;
  }

  const clientIp = request.headers.get('CF-Connecting-IP') ?? '';

  const body = new FormData();
  body.append('secret', secretKey);
  body.append('response', token);
  if (clientIp) body.append('remoteip', clientIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    // Network failure → fail closed
    return false;
  }
}
