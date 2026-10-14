# X5-Plan — Block A: Share on its own origin (`share.refueler.io`)

> **X5-Plan · 13 Oct 2026** (Opus, planning, no code). Builds on Served-Code-Opus (Master Context row 16a, `docs/research/served-code-and-ohttp-2026-10.md`) and the design theory (`docs/design/share-design-theory-v1.md` §4, §7–§13).
> Sessions: **X5-1** (build on the real host, unannounced) → **X5-2** (cutover, invite testers) → **Share-Release-1** (release discipline).
> Decisions in §8 were taken by Rajesh in this session.

---

## 0. What the code says today (read this before trusting row 16a's wording)

| # | Finding | Where | Consequence |
|---|---|---|---|
| F1 | `corsHeaders()` hard-codes `['https://refueler.io']` and answers any other origin **with `https://refueler.io`** | `worker/src/utils.js:76` | From a new origin, `/status`, `/meta`, `/download`, `/credential/issue`, `/urls`, `/log/error` all fail CORS. "X5-2 = vars only" (CLAUDE.md B12-4a-1 lock) is **not true**. One small Worker change is needed (X5-1). |
| F2 | `auth_ping.js` hard-codes the same origin twice | `worker/src/auth_ping.js:74`, `:135` | Same fix, same var. |
| F3 | R2 bucket CORS allows PUT from `https://refueler.io` only (plus a localhost:8181 dev rule) | `wrangler r2 bucket cors list refueler-share-prod` (read 13 Oct) | Presigned uploads fail from the new origin until a rule is added. `cors set` replaces all rules — keep the localhost rule. |
| F4 | The share link is built from `location.origin + location.pathname` | `frontend/upload-send.js:257` | New links take the new host automatically. Path becomes `/` (see §1). |
| F5 | Notes card fetches `https://refueler.io/notes/latest.json` (same-origin today) | `frontend/download-notes.js:10` | Becomes cross-origin: needs one CORS header on refueler.io + `connect-src`. |
| F6 | Theme is a JS cookie `rs-theme` on `domain=.refueler.io` | `src/_includes/head.njk` (inline) | It rides along to `api.share.refueler.io` on every credentialed initiate. The new origin uses `localStorage` instead. |
| F7 | Relative links into refueler.io-owned pages: `/share/status/`, `/share/plans/`, `/share/` | `src/index.njk:36, 219, 369, 377`, `src/signin.njk:80` | Become absolute `https://refueler.io/share/status/` etc., or point at the new origin's `/` for "Send a file". |
| F8 | Inline JS: 2 blocks in `index.njk`, 1 in `head.njk` (theme), plus refueler.io nav `onclick`s; 2 `style=` attributes | `src/` | All out of the standalone layout (no inline JS, no `style-src-attr`). |
| F9 | Pages already emits `Link:` headers from `<link rel=modulepreload>` (seen live on `refueler.io/share/`) | live headers | `! Link` in `_headers` from day one. |
| F10 | Presign host is `<account>.r2.cloudflarestorage.com` (path-style) | `worker/src/r2_presign.js:115` | Exact host in `connect-src`; never a wildcard. |
| F11 | Stripe success/cancel URLs → `https://refueler.io/share/upgrade/…` | `worker/src/handlers/stripe_sub.js:98` | No change: refueler.io owns Plans / upgrade (CLAUDE.md). B12-6 repoints the portal. |
| F12 | MCP link base `https://refueler.io/share/` | `refueler-mcp/src/tools/send.js:59` | Changes at X5-2 (MCP not published — no live consumer). |

Cookie scope is **not** a problem: `__Host-rfs_session` lives on `api.share.refueler.io` (the API host), not on the page origin. `share.refueler.io` → `api.share.refueler.io` is same-site, exactly like `refueler.io` → `api.share.refueler.io` today, so `SameSite=Strict` behaves the same.

---

## 1. The origin

- **Host:** `https://share.refueler.io`. App at **`/`** (link format: `https://share.refueler.io/?uuid=<uuid>#<v2 blob>` — grammar unchanged, only the base moves). Sign-in at **`/signin/`**. Reserved in scope: `/sent` (Nostr reading side, row 19), `/.well-known/webcat/` (Block B), `/verify/` (Share-Release-1).
- **No separate staging host for X5-1 (Rajesh, 13 Oct).** `share.refueler.io` has no DNS record today, so X5-1 builds straight onto it: unannounced, Pre-alpha chip, `X-Robots-Tag: noindex`. Testers only ever see the real name — a `share-staging` URL would read as a hoax. A private staging host (`share-staging.refueler.io`, first-level so Universal SSL covers it) is added later, only when there are testers to protect (Share-Release-1 decides); it is Rajesh's alone and never in a link. WEBCAT slots: 2 of 5.
- **Pages project:** new, `refueler-share-app`, **direct upload** (Rajesh, 13 Oct) — never Git-connected. Its `refueler-share-app.pages.dev` alias exists but is in no allowlist (Worker CORS, R2 CORS, `AUTH_ORIGINS`, Turnstile), so nothing can upload or sign in there; never link to it, never verify against it (same rule as the orphaned `refueler-share.pages.dev`).
- **Error pages:** a top-level `404.html` (stops Pages SPA mode) and `error.html` (WEBCAT minimum) — both carry the same headers.

---

## 2. X5-1 — build on `share.refueler.io` (Sonnet build, Rajesh deploys)

Goal: the full app running on the new origin **in parallel** with `refueler.io/share/`, which stays the public page until X5-2. One body markup for both.

### 2.1 Source layout

- `src/_includes/share-body.njk` — the sheets (upload + receiver) extracted from `src/index.njk`, included by **both** the old mirror page and the new app page. One copy of the markup while both run.
- `src/app/index.njk`, `src/app/signin.njk` — standalone pages on `src/_includes/app-layout.njk` (no refueler.io nav, footer, section pill, Satoshi or Google/Fontshare CSS).
- Eleventy writes the old pages to `frontend/` (unchanged) and the app to **`dist/`** (gitignored). `dist/` = exactly what is deployed and hashed.
- **Versioned asset paths:** HTML at the root; every JS/CSS/WASM file under `/v/<shortsha>/`. Imports are relative (`./x.js`), so they resolve inside one release; only HTML names the directory, and HTML revalidates every load. Fixes the B12-4a-2 watch item (a tab running modules from before a ship) and the research's mixed-version risk. `ship-app.sh` keeps the **previous** release directory in each deploy so a tab open across a ship can still lazy-load.

### 2.2 Layout and design (from the design theory — nothing re-decided here)

- **Header** (§4.4, §10, §11): one 48 px row — SVG wordmark "Refueler Share" · stage chip `Pre-alpha` · right: account slot · theme toggle. Fits at 375 px. Chip **moves from the eyebrow row to the header** on the app page; the word stays in `share.css` `::before` (one place). Chip not a link until the landing page exists (X5-2). Receiver: no account slot.
- **Account** (§11): header = who (`Citizen` / `Sign in`); slip "Send as" row = what this upload uses. **The live "Send without my account" toggle stays** until Chambers-Design designs the full-storage offer (§11.1a); X5-1 restyles it, doesn't remove it.
- **Tokens** (§4.5–§4.7, §6.5): one rebuilt `share-tokens.css` (contrast fixes both themes, warm Carbon surfaces, solid field edges, `--accent` gold `#C8A96E` / `#7A5F2E`, `--attention` reserved and unused, no `--danger`/`--warn`/`--success`, `--rx-*` folded in). The old mirror keeps loading the old file (refueler.io `global.css` takes its own fixes when refueler.io unfreezes).
- **Type and measure** (§4.1–§4.4): seven-step scale, 480 px sheet, 132 px label column, spacing scale, width rules, phone fold rule (button above the fold at 375 × 667).
- **Carried in from the design sessions:** link box two-line clamp **on an inner span** (§9) · one-sentence link-ready lede (§5.3, §13) · Carbon **Dial 1 % + dither** (static PNG tile, `img-src 'self'`), Paper flat (§12.1) · hand tip on the progress bar (§12.1) · the touch: 200 ms, one tone step (§13) · motion tokens + never-move list incl. the `status.css` pulse and `banner-in` (§7) · components (§9) · emoji out of banner/modal, "Got it" → "Close" (§4.7.7) · small bugs: day count round vs floor (`share.js:254`, `download-time.js:37`), curly apostrophe on the finished screen (§1.3).
- **Fonts:** self-hosted WOFF2 in `/v/<sha>/fonts/`: Source Serif 4 300, DM Sans variable 300–500, IBM Plex Mono 400/500, Latin subset; OFL texts shipped beside them. **Wordmark:** inline SVG paths (Satoshi outlined) — X5-1 checks the Satoshi licence (Fontshare / ITF FFL) allows an outlined logo; if not, set the wordmark in Source Serif 4.
- **Theme:** `localStorage` `rs-theme` (try/catch; default Carbon), applied by a tiny classic script `theme-early.js` in `<head>` before first paint. No cookie on the new origin.

### 2.3 No inline code

- Inline blocks → files: `theme-early.js` (classic, sync, head), `status-banner.js` (module), the tail block into `share.js` or its own module.
- No `onclick` (header controls use `addEventListener`). No `style=` attributes (classes; JS writing `el.style` is unaffected by CSP).
- Build check (in `ship-app.sh`): any `<script>` without `src`, any `on*=` attribute, any `style=` in `dist/**/*.html` → refuse.

### 2.4 Headers — `dist/_headers`

```
/*
  Content-Security-Policy-Report-Only: <CSP below, one line>
  Cache-Control: no-transform
  ! Link
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  X-Robots-Tag: noindex
```

(`Cache-Control` from Pages stays `public, max-age=0, must-revalidate`; `no-transform` is added. `X-Robots-Tag` is removed at X5-2.)

**The CSP string** (Report-Only at X5-1; enforced at X5-2 after the browser matrix; identical on every path, error pages included):

```
default-src 'none'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://api.share.refueler.io https://fc4f3e5aeebe483677d14185daf544f5.r2.cloudflarestorage.com https://alice.btc.calendar.opentimestamps.org https://bob.btc.calendar.opentimestamps.org https://refueler.io; style-src 'self'; font-src 'self'; img-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests
```

| Directive | Why |
|---|---|
| `default-src 'none'` | Everything listed explicitly; anything new fails loudly. |
| `script-src 'self' 'wasm-unsafe-eval'` | All app JS is same-origin; BLAKE3 WASM needs `wasm-unsafe-eval` (else silent pure-JS fallback, ~70× slower). |
| `https://challenges.cloudflare.com` (script + frame) | Turnstile, in the main page for Block A. Moving it into a sandboxed gate frame on its own origin is **WEBCAT-1 (Block B)**, not X5. |
| `connect-src` | Worker; exact R2 host (F10 — never `*.r2…`, that is anyone's bucket); OTS calendars (paid permanent record, `timestamp.js`); `https://refueler.io` for the Notes card only (F5). |
| `style-src 'self'`, `font-src 'self'` | Self-hosted CSS and fonts; no Google/Fontshare. No `style-src-attr`. |
| `img-src 'self'` | Icons, dither tile. QR draws on canvas (no image load). X5-1 confirms in Report-Only; add `data:` only if a real violation needs it. |
| `worker-src 'self'` | Reserved for the DL-track streaming service worker. |
| `form-action 'none'` | No form posts anywhere (sign-in is `fetch`). |

**Nostr reading side (row 19) — reserved, not listed.** The `connect-src` grammar takes `wss://` relay hosts, and the release manifest has a relay-list slot, but the hosts are **added in the Nostr build session**, not now: an allowed origin with no feature behind it is an exfiltration route. *(Planner's recommendation; row 16a said "relay hosts in `connect-src`" — this narrows it to "slot reserved".)* `/sent` is inside the PWA scope `/` already.

**Reporting:** no report endpoint (no telemetry). Report-Only violations are read from the console on each browser in the matrix.

### 2.5 PWA manifest

`/manifest.webmanifest`: name "Refueler Share", short_name "Share", `start_url "/"`, `scope "/"`, `display "standalone"`, background/theme Carbon `#1A1917`, icons 192 + 512 + maskable (PNG, from the wordmark). **No caching service worker in Block A** — a worker that caches app code outlives a release and fights the served-code story; the DL track's streaming worker comes later. Pixel 9a check: install offered or not (record, don't chase).

### 2.6 Cloudflare settings for the host (dashboard, off-repo; `ship-app.sh` checks what it can from headers)

- **Cache Rule** `http.host eq "share.refueler.io"` → Browser TTL **Respect origin** (Share-Cache-1 trap: without it the zone TTL rewrites `max-age=0` to 4 h). Checked live on every ship.
- Rocket Loader **off**, Email Obfuscation **off** (also skipped by `no-transform`), Web Analytics auto-inject **off** for this host, **no** challenge / managed-challenge / Under-Attack rules matching the host, Bot Fight Mode checked not to challenge static paths.
- Turnstile widget (sitekey `0x4AAAAAAD0N7GlHlCRuWITr`): add `share.refueler.io` to allowed hostnames explicitly (don't rely on subdomain inheritance).

### 2.7 The small Worker change (in X5-1, Rajesh deploys)

- New var **`APP_ORIGINS`** (comma-separated, `https://` only, same parser as `authOrigins`) = `https://refueler.io,https://share.refueler.io`.
- `corsHeaders(request)` and `auth_ping.js` echo the origin only if it is in `APP_ORIGINS` (localhost echo unchanged, still never with credentials). Non-matching origin: return the first entry, as today (no behaviour change for other callers). `corsHeaders` gets `env` threaded through, or reads a module-level list set once per request in `index.js` — the build session picks the smaller diff.
- `AUTH_ORIGINS` = `https://refueler.io,https://share.refueler.io` (sign-in from the new origin and Citizen initiate both work during the parallel run). `AUTH_SIGNIN_URL` **unchanged** until X5-2.
- R2 CORS: add `https://share.refueler.io` (PUT; same headers) — `wrangler r2 bucket cors set` with a JSON that keeps the existing two rules.
- Tests: CORS echo per origin, unknown origin, localhost, credentials only on `AUTH_ORIGINS`.

### 2.8 Ship tooling — `bin/ship-app.sh` (new)

`build → check → deploy → prove`, stops at first failure, ends `✓ SHIPPED (app)`:
1. Preflight: on `main`, clean, not behind.
2. Build `dist/` (Eleventy + copy `frontend/` assets into `/v/<shortsha>/`, plus the previous release dir).
3. Check: no inline code (§2.3); `_headers` has exactly one CSP and it equals `bin/lib/app-csp.txt` byte for byte; `! Link` and `no-transform` present; every file in `SM_ASSETS` present (the asset list stays in `share-mirror.sh` while both surfaces run — one list).
4. Deploy: `npx wrangler pages deploy dist --project-name refueler-share-app --branch main` (Rajesh runs it — auto mode blocks deploys).
5. Prove: every `dist/` file byte-identical at `https://share.refueler.io/…` (cache-busting query, Pages answers missing files with 404 now, not 200); response headers on `/`, a module, `404.html`: CSP string exact, no `Link`, `no-transform`, effective browser cache `max-age=0`.

While the mirror runs, a change to shared JS/CSS ships **twice**: `ship-frontend.sh` (refueler.io) then `ship-app.sh`. X5-2 ends that.

### 2.9 X5-1 gate — done when

- Safari on the Mac with Mullvad on, on `share.refueler.io`: upload (file + folder), password, DAD, receiver ready/done, dead link, signed-in Citizen upload (sign in via the old page — `AUTH_SIGNIN_URL` still points there; the cookie is on the API host, so it works), "Send without my account", Paper + Carbon.
- Report-Only console clean in Safari, Vanadium (Pixel 9a), Firefox, Chrome — both modes; `blake3Impl() === 'wasm'`.
- iPhone 13 mini: fold rule at 375 × 667; header fits; chip in header.
- One ten-minute look at the Dial on an ordinary non-Apple screen (§12.1).
- `refueler.io/share/` unchanged and still working (both surfaces live).

---

## 3. X5-2 — cutover (Sonnet, Rajesh in the loop)

Order matters; each step is reversible until step 9.

1. **CSP enforced** on the app: Report-Only → `Content-Security-Policy` (same string), re-run the four-browser matrix in both modes. Drop `X-Robots-Tag`; add `<link rel="canonical">`.
2. **Worker vars:** `AUTH_SIGNIN_URL = https://share.refueler.io/signin/`. `AUTH_ORIGINS`, `APP_ORIGINS`, R2 CORS keep `https://refueler.io` **for 7 days** (one `UPLOAD_WINDOW` + 1: in-progress uploads on the old page finish; IDB resume state is per-origin and does not move), then a short follow-up removes it. Stripe URLs unchanged (F11); email sender unchanged.
3. **Stage chip → `Alpha`** (one word in `share.css` + refueler.io homepage chip); chip becomes a link to `https://refueler.io/share/#alpha`.
4. **refueler.io (same session, Rajesh OK'd Share edits there):**
   - `src/share/index.njk` → **landing page**: what Share is in two lines, a button to `https://share.refueler.io/`, "What alpha means" (§10: things change; links made now may stop working before 1.0; don't send anything you can't send again). Badge and homepage links keep pointing here (badge lock stands).
   - **Forwarder** (Rajesh, 13 Oct: until 12 Jan 2027): external `share/forward.js`, loaded first on `/share/` and `/share/signin/`. If `location.search` contains `uuid=` **or** `location.hash` is non-empty: `location.replace('https://share.refueler.io' + path + location.search + location.hash)` where `path` is `/` or `/signin/`. Fixed destination (no open redirect), never parses or logs the fragment. Removed on the same date as v0/v1 links. The landing page has a real CSP too (`script-src 'self'`).
   - Remove the mirror: `src/share/assets/*` (except `plans.css`, `navy-office.*`), `src/share/signin/`, `src/share/admin/test-upload.html`. The admin page does **not** move to the app origin: admin tooling stays off the public key-handling host, in `worker/src/share/admin/` for local use only.
   - `_headers`: `/notes/latest.json` → `Access-Control-Allow-Origin: https://share.refueler.io` (F5, Rajesh: keep the card).
   - Homepage Share entry → `https://share.refueler.io/`.
5. **Pipeline retired:** delete `bin/ship-frontend.sh`, `bin/sync-share.sh`, `bin/lib/share-mirror.sh` (asset list moves into `bin/lib/app-assets.sh`), `bin/githooks/pre-push` (or replace with a check that `dist/` builds and passes §2.8 step 3), `.github/workflows/mirror-check.yml` → `app-check.yml` (build + header/CSP checks in CI; live byte check stays on the Mac until Share-Release-1's watchdog). Then remove the refueler.io `/share/assets/` Cache Rule (dashboard) — **after** the mirror files are gone.
6. **Other link bases:** `refueler-mcp` `SHARE_BASE_URL` + error text + `dashboard_url`; `worker/src/index.js:1298` `dashboard_url`; `wl_config.js` stays (`badge_url` = landing); live-check scripts (`bin/*-live-check.mjs`) and soak tools.
7. **Docs + memory sweep:** every `refueler.io/share` string in CLAUDE.md, Master Context, `TESTING.md`, specs and memory — rewritten or marked historical. CLAUDE.md §Deploy surfaces + §Frontend change checklist rewritten for `ship-app.sh`.
8. **Live check:** the CLAUDE.md checklist on `share.refueler.io` (link has `?uuid=` + fragment; new tab shows receiver; name/size/expiry; one error state triggered live; password unlock); an **old** `refueler.io/share/?uuid=…#…` link opens via the forwarder; a sign-in email lands on the new `/signin/`; Notes card renders.
9. **Invite testers** (Rajesh, Signal). Month of Dial feedback starts here (§12.1).

**Rollback (steps 1–8):** revert `AUTH_SIGNIN_URL`; `git revert` the refueler.io landing commit (the mirror returns from history); the app stays up harmlessly.

---

## 4. Share-Release-1 — scope

- **Reproducible build:** pinned Eleventy + Node, `SOURCE_DATE_EPOCH` from the commit time, sorted file walk, clamped mtimes; two clean builds on the Mac produce identical `dist/` (checked by the script).
- **Release manifest, WEBCAT format, unsigned:** `files` (path → SHA-256 base64url), `default_csp` (= `bin/lib/app-csp.txt`, byte-equal to `_headers`), `default_index`, `default_fallback`, `wasm` hashes, `version` = tag. Extras (commit, previous release, later the relay list and APK fingerprint) in a sidecar `release-extra.json`. Served at `/release.json` — **not** under `/.well-known/webcat/` until Block B signs it. Same files attached to the GitHub release.
- `ship-app.sh` refuses to deploy a `dist/` whose hashes ≠ the manifest.
- **Generated Verify page** `/verify/`: how to check the served files against the GitHub release (curl + `shasum`, step by step). Says what it shows and what it doesn't. Never "verified", never "proves".
- **Public watchdog** GitHub Action every 6 h: fetch live files from `share.refueler.io`, compare to the latest release, fail red. (Possible from CI now: the host carries no challenge rules.)
- Decides whether to add the private staging host (§1).

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| CORS still answering `refueler.io` (F1/F2) | `APP_ORIGINS` in X5-1, tested; the X5-1 gate exercises every endpoint from the new origin. |
| R2 PUT blocked (F3) | Rule added in X5-1; `cors set` JSON keeps existing rules; upload in the gate. |
| `__Host-` cookie scope | Unaffected (cookie on the API host, same-site from both origins). Credentials only for exact `AUTH_ORIGINS`; localhost echo never with credentials (unchanged). |
| Turnstile hostname | Explicit hostname added before the X5-1 gate; failure shows as the widget never drawing. |
| Stripe / email links | Stripe stays on refueler.io (F11). Sign-in emails follow `AUTH_SIGNIN_URL`; a link mailed minutes before cutover lands on the old `/share/signin/` → forwarder carries `#t=` across. |
| Old links | Forwarder until 12 Jan 2027; fixed destination; fragment never parsed. |
| Safari module cache / mixed versions | Versioned `/v/<sha>/` paths + previous release kept + host Cache Rule checked every ship. |
| Cloudflare injection (analytics beacon, email obfuscation, Rocket Loader, challenge page) | Settings off + `no-transform`; ship script fails on any `<script>` in served HTML it didn't build. |
| `Link` header | `! Link`; checked live. |
| SPA fallback hides missing files | Top-level `404.html`; prove step expects exact bytes. |
| Trailing-slash redirects (`/signin` → `/signin/`) | Check Pages' `Location` is relative (research open question 1); links always use the slash form. |
| Two surfaces drift during the parallel run | Shared body include + one asset list; X5-1 → X5-2 kept short. |
| pages.dev alias serves the app | In no allowlist; nothing works there; never linked. |
| Satoshi licence for an outlined wordmark | Checked in X5-1; Source Serif fallback. |
| Theme cookie on `.refueler.io` | New origin uses `localStorage`; old cookie ignored there. |

---

## 6. Not in Block A

Turnstile in a sandboxed gate frame, WEBCAT enrolment, Sigsum, app (all Block B) · Nostr relay hosts (Nostr build) · removing the "Send without my account" toggle (Chambers-Design → X5-1 or B12-4b) · full Chambers account page · refueler.io `global.css` contrast fixes (when refueler.io unfreezes) · Legend token fixes (refueler-legend session) · streaming download service worker (DL track) · `require-trusted-types-for 'script'` (try at B12-Audit).

---

## 7. Session list

| Session | Model | Deliverable | Gate |
|---|---|---|---|
| X5-1 (split 14 Oct, Rajesh: **1a** = Worker, R2, shared body, layout, `ship-app.sh`, dashboard · **1b** = §2.2 carry-ins + gate) | Sonnet (Opus if the Worker CORS change grows) | App on `share.refueler.io` (unannounced), `ship-app.sh`, Worker `APP_ORIGINS`, R2 CORS, Turnstile hostname, Cache Rule | §2.9 |
| X5-2 | Sonnet | Cutover + landing + forwarder + pipeline retired + sweep | §3.8, then testers |
| X5-2b (tiny) | Sonnet | Drop `https://refueler.io` from `APP_ORIGINS` / `AUTH_ORIGINS` / R2 CORS (7 days after X5-2) | curl |
| Share-Release-1 | Sonnet | Reproducible build, manifest, Verify page, watchdog | two identical builds; watchdog green |

---

## 8. Decisions (Rajesh, 13 Oct 2026)

1. **No public staging name.** X5-1 builds on `share.refueler.io` itself, unannounced; a private `share-staging.refueler.io` only when there are testers to protect.
2. **Direct upload** from `ship-app.sh` (exact bytes deployed = bytes hashed); Rajesh runs the deploy.
3. **Old links forwarded** from `refueler.io/share/` to `share.refueler.io` **until 12 Jan 2027** (the v0/v1 link removal date). Supersedes row 16a's "old test links may break — no bridge".
4. **Notes card kept**, cross-origin (one CORS header on refueler.io, `https://refueler.io` in `connect-src`).

Planner's calls, open to override: app at `/` (not `/share/`); versioned asset paths; no caching service worker; Nostr hosts reserved not listed; admin test page stays off the public app origin; 7-day overlap before removing the old origin from the allowlists.
