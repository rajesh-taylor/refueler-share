# Share-CSP-1 — Content-Security-Policy for refueler.io/share/ (notes, not built)

> Written at Share-Deps-1 (28 Sep 2026). Its own session, after Deps-1 is live and tested.
> Lives in the refueler.io repo's `_headers`, scoped to `/share/*`. Nothing in refueler-share changes
> except moving inline scripts out of `src/index.njk` (below).

## Why

The upload and receiver pages hold the AES key in memory. Share-Deps-1 removed the only third-party
code (esm.sh). A CSP makes that stick: if a future change, a compromised asset or an injection tries to
load or send anything to an unlisted origin, the browser refuses.

## Draft header (start as `Content-Security-Policy-Report-Only`)

```
/share/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://api.share.refueler.io https://<ACCOUNT_ID>.r2.cloudflarestorage.com https://alice.btc.calendar.opentimestamps.org https://bob.btc.calendar.opentimestamps.org; style-src 'self' https://fonts.googleapis.com https://api.fontshare.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com https://cdn.fontshare.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

Directive by directive:

| Directive | Why |
|---|---|
| `script-src 'self'` | All Share JS is in `/share/assets/` (incl. vendored `noble-secp256k1.js`, `noble-blake3.js`, `blake3/`). |
| `'wasm-unsafe-eval'` | **Required.** Without it browsers refuse to compile the BLAKE3 WASM and every visitor silently falls back to pure-JS BLAKE3 (10× slower or worse; measured 636 vs 9 MiB/s in Chromium at Share-Deps-1). Allows WASM compilation only, not `eval`. |
| `https://challenges.cloudflare.com` | Turnstile `api.js` (script) and its iframe (`frame-src`). |
| `connect-src` `api.share.refueler.io` | Worker: `/status`, `/meta`, `/credential/issue`, upload/finalise, download, `/log/error`, OTS relay. |
| `connect-src` R2 host | Presigned PUTs go to `<account>.r2.cloudflarestorage.com` (`worker/src/r2_presign.js:115`). Take the exact host from a live presigned URL. **Never `*.r2.cloudflarestorage.com`**: that allows anyone's bucket, which is an exfiltration route. |
| `connect-src` OTS calendars | `timestamp.js` `submitToCalendars()` POSTs the 32-byte commitment straight to alice/bob from the browser (paid permanent record; unreachable today, F-10). Drop these if that moves behind the Worker relay. |
| `connect-src 'self'` | Notes card fetch `refueler.io/notes/latest.json` (same origin). |
| `style-src` / `font-src` | Google Fonts (DM Sans, IBM Plex Mono, Source Serif 4) and Fontshare (Satoshi) from refueler.io's layout. Check `cdn.fontshare.com` is the font host in the Fontshare CSS. |
| `style-src-attr 'unsafe-inline'` | 14 `style="…"` attributes on the live page. Low risk (attributes only, no `<style>`); remove them later and drop this. |
| `img-src 'self' data:` | Icons; QR code (qr-creator canvas). |
| `frame-ancestors 'none'` | Nobody frames the key-holding page. |

If `crypto.js` `WORKER_URL` is ever reverted to `https://refueler-share.rt-fc4.workers.dev` (CLAUDE.md
Brave note), add that host to `connect-src` in the same change.

## Must be done before the header can be enforced

1. **Inline scripts.** The live `/share/` page has 4 inline `<script>` blocks: 2 from `src/index.njk`
   (status banner, ~lines 26–126; tail block ~lines 367–382) and 2 from refueler.io's layout. Move them
   to files in `/share/assets/` or `/assets/`. Hashes (`'sha256-…'`) would work but break on every copy
   edit, since `sync-share.sh` re-renders the page. **Never add `'unsafe-inline'` to `script-src`**: it
   defeats the policy.
2. **Inline handlers.** refueler.io's layout has `onclick="toggleNavDrawer()"` and
   `onclick="toggleTheme()"`. Swap them for `addEventListener` in the layout's script file. This is
   suite-wide, so do it in refueler.io once.
3. **Admin page.** `/share/admin/test-upload.html` (mirrored from `worker/src/share/admin/test-upload.html`)
   still imports `@noble/hashes@1.8.0/blake3` and `@noble/secp256k1@2.2.1` from esm.sh. Either vendor
   them too, or give `/share/admin/*` its own policy. A `/share/*` CSP will break it as it stands.
4. **Reporting.** No report endpoint exists. Options: a small `POST /log/csp` on the Worker (same
   shape as `/log/error`, KV-free, AE only), or just run Report-Only and read the console in each browser.

## Test plan

- Report-Only first. Check the console on Safari (iPhone 13 mini), Vanadium (Pixel 9a, defaults), Chrome
  and Firefox, in both page modes: upload, folder upload, receive, password receive, dead link, Notes card.
- Confirm `blake3Impl()` is `'wasm'` on Chrome/Safari with the policy on (proves `'wasm-unsafe-eval'` works).
- Then switch to enforcing. `ship-frontend.sh` could grow a live check that the header is present, like
  `sm_live_cache`.
