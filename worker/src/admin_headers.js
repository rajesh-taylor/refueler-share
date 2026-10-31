/**
 * admin_headers.js — headers on every Navy Office file (H6a · Admin-Access-1b · 31 Oct 2026)
 *
 * Plan: private strategy/docs/H6a-Admin-Access-plan-v1.md §3.4. One source: the Worker
 * (admin_host.js) and the local harness (dev/share-harness/navy-office-serve.mjs) both
 * import this, so the CSP a fault shows under locally is the one served live.
 *
 * Strict CSP: no inline script, handler or style in navy-office/ (classes, data-* and
 * listeners in the .js files); fonts self-hosted in navy-office/fonts/; every call is a
 * relative path to this same host. Speed files are read with FileReader (no network).
 * Something new loads from elsewhere → widen exactly one directive here, never 'unsafe-inline'.
 * Kept free of imports so Node can load it as it is.
 */

export const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

export const ADMIN_HEADERS = Object.freeze({
  'Content-Security-Policy':   ADMIN_CSP,
  'Referrer-Policy':           'no-referrer',
  'X-Content-Type-Options':    'nosniff',
  'X-Robots-Tag':              'noindex',
  'Cache-Control':             'no-store',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
});
