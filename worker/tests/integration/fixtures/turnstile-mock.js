// No server needed — wrangler dev accepts the CF always-pass test token.

/**
 * CF Turnstile always-pass test token.
 * Works in wrangler dev --local without any mock server.
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
export const TURNSTILE_TEST_TOKEN = '1x0000000000000000000000000000000AA';

/** Always-fail test token */
export const TURNSTILE_FAIL_TOKEN = '2x0000000000000000000000000000000AA';


//
