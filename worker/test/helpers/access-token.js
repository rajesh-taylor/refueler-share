// test/helpers/access-token.js — Cloudflare Access tokens for tests (H6a · Admin-Access-1a).
// Shared by access_jwt.test.js and admin_host.test.js.
//
// TEST KEY ONLY: a 2048-bit RSA key made for these tests on 30 Oct 2026
// (`openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`). It signs nothing
// anywhere else and Access never saw it.
//
// Known answer (KAT_TOKEN), checked once outside the Worker, 30 Oct 2026:
//   signed with node:crypto sign('sha256', …); `openssl dgst -sha256 -sign` over the same
//   header.payload gave byte-identical signature bytes; `openssl dgst -sha256 -verify`
//   with the public key → "Verified OK", and → "Verification failure" with one byte
//   appended to the signed text. SHA-256(header.payload) 4e351971…c0556566,
//   SHA-256(signature) 4d2348b1…a4d17fc9.

export const TEAM = 'kat-team';
export const AUD  = 'aud-test-0123456789abcdef';
export const KID  = 'kat-kid-1';
export const ISS  = `https://${TEAM}.cloudflareaccess.com`;
export const CERTS_URL = `${ISS}/cdn-cgi/access/certs`;
export const KAT_NOW = 1799990000;   // inside the KAT token's iat … exp

export const PUBLIC_JWK = {
  kty: 'RSA', e: 'AQAB',
  n: 'qJ_5oXXV5GnAhle3VXu10zPlxbpQ1I8He2X6Mcjs107QWSBxO6PUbRYmTZJb3ULabBkkFODQhviFszkcSoGZM1gGcBtmbkK0eR__dFHyqeI1gGWzdlg5oZOvdRdwGxkqIHDMY9anrKdNyggH9S36InbggHidmYz3n2gphWAU3--k00H4h3HLwteiBgz-j1sDqt0kyMpz_LLVP5KBLQkHuICC-2bay76Qg5Li9gMm3MP6Rx1dVLatqDKZVOD7lqC4a2ZaPWa_Cm7sF7r4zmjRaukIyP_8h2sbFVrVN_yEsjkA54DryJE32BfwlqkJ-I4T9vgb68_bJXExXy5F2G8RCQ',
};
const PRIVATE_JWK = {
  ...PUBLIC_JWK,
  d:  'HUnD-wZTg1vW476iikd1elyeQSyuU20QWJ-KyFDkyjTXPVPENx6qi9P4DSspp5GwDGyFdtbhgT_zQQDfaBWAfYmBfMFVljshy5QCM7r0EgvHTSjc9eY3BFh5djX-88X4KjBNX93tu7BHc5rXfv9gXdIWBlpszTnN3LMj2xWoKojV1DBhiEOFiL_20QlNrZBYDtGXaK1u5VanhY2O15qeGfMFCHfV_pyOe_TCW3uWcDX3O-QEdhqgaIl9jYjCVJRWRkXYT6kR5hdIUWG58UcmVt8znCLkYWTVGyjTC9Bi_g91Ie0tx1aMoZmqI-d_Tx0VPgtB3KaUnIpGY2rz6WPqzQ',
  p:  '305a8Cka3qbUMKVBoTnEeT9tjk-aF_Cyn1V-0ZdHtbXrhvojhQeFXo38DVi3A7SW5ZZlBGnQL41PO5ki1ZjzLGkH2q6f_TyLwfpLzTWxH7JKG2BUgATr0MEQt7JzkeFj5YmxKiOKmuglHnDJOSknCbZl817_wz80bI3cSnPL0Ic',
  q:  'wVAjEFw_LoDYkJgA_ITtptfMjhQldi9dXbGmBG9VG01sxfOGWAcj6vKo-f9PBI2Srd7ogyaEva3-0vLyqjM7ut0w5gglBW1VyQMZDM7e4T3K4kTVICkkFV3CXO2bgcAFxS1oIXBkghTNbSgQXbd8tkuf5tZYGuNFc5HBuc41Re8',
  dp: 'VCd5SeyTvbjtWm_M7e-RRYhLx0fkcIU7K6TSqDX0xlwKqNF3tViCQIINrRHz1qel_lvRMfqWhHUimPk7EXgUnHXwic8paAv7N10WV_2WBLXyC6Mf9Sbln8RCgpfzydRBC236oEDIqVw3MOOcUbhah-R_Q1pX1MLrBMXpcP12n90',
  dq: 'mbLonhpqFcRV6-kfZ6cc-Tm9Jv33pxcTqeoUMJSAW1vc7yqnlxfeQ_C5z0NiBSG3DM0dmyEmC1XrNLf7nr1rcTBqr4qsPLtoqJDw-tEEPpwN0oed2Js9WEuavJ4itTACpnpqv6OIFjEKAA8JrCm2W46XTUcA-CfZUYEDQYMlsjs',
  qi: 'IptikhmP88tuBsUGVLcdXIQ-wFxOqFpz5-2x2Mvg9pTT2QK8iUvbRb0OsY0pnVRL4sZ6Q0hTd7lAtFuZMhYZR880Duk2zQP34aW6sc6nU_yaH657018n5Gn1GDTEkeYGTilUk8XYwLhdnDdbfBp3MJw4oN2CPpglqqFFRBM3H68',
};

export const KAT_TOKEN =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImthdC1raWQtMSIsInR5cCI6IkpXVCJ9' +
  '.eyJhdWQiOlsiYXVkLXRlc3QtMDEyMzQ1Njc4OWFiY2RlZiJdLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUudGVzdCIsImV4cCI6MTgwMDAwMDAwMCwiaWF0IjoxNzk5OTcxMjAwLCJuYmYiOjE3OTk5NzEyMDAsImlzcyI6Imh0dHBzOi8va2F0LXRlYW0uY2xvdWRmbGFyZWFjY2Vzcy5jb20iLCJ0eXBlIjoiYXBwIiwic3ViIjoia2F0LXN1YiIsImlkZW50aXR5X25vbmNlIjoia2F0In0' +
  '.HHDbHIRV4M09jHQzIA0q-jafxnU_AGTd_5HLvc7sDajRF-Iq14VY6Z0rEBGeAmWYgHVzb6ntWLQg8Q6jzAbotk0opvRpjRE-qbpe92SL5WjMkfLMYLZerDnPrO4wxy5TzOCBJ2wyPwjmJijkX8dT9cZEThY5FACfkXvZsq6bYBnH0c7X3xs5bxSfgAletWFYKShpFeoU4i_MIrw8RaS8eqWoyWvO0U8Qsd02fPW1wkJSQV5Rm18_2lhZQ1pGubVvY-EzxW3zx0C_ybuT72uc4DRmfYjMAplv43cw7FEUCrIjv3sVZZMR0yoWTN3IlVEIVe6XEJyWD35-oSv_cZiMXw';

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64json = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let privateKey;
async function signer() {
  privateKey ??= await crypto.subtle.importKey('jwk', PRIVATE_JWK, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return privateKey;
}

export function goodClaims(now = Math.floor(Date.now() / 1000), o = {}) {
  return { aud: [AUD], email: 'admin@example.test', exp: now + 3600, iat: now - 10, nbf: now - 10,
           iss: ISS, type: 'app', sub: 'test-sub', ...o };
}

/** A token signed with the test key. header/claims override the defaults. */
export async function makeToken({ now, claims = {}, header = {} } = {}) {
  const h = b64json({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const p = b64json(goodClaims(now, claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signer(), new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

/** The team's certs document, as Access serves it. */
export const certsBody = (kid = KID) => ({ keys: [{ kid, kty: 'RSA', alg: 'RS256', use: 'sig', ...PUBLIC_JWK }] });

/** fetch stand-in: the certs URL answers with the test key (or `certs`), anything else → `other`. */
export function certsFetch({ certs = () => certsBody(), other, calls = [] } = {}) {
  return async (url, opts) => {
    const u = String(url);
    if (u === CERTS_URL) {
      calls.push(u);
      const body = certs();
      return body instanceof Response ? body : new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    }
    if (other) return other(url, opts);
    throw new Error(`unexpected fetch ${u}`);
  };
}
