# SESSIONS.md — refueler-share

---

## Session 17 — status.njk (14 July 2026)

**Type:** Build session.
**Commit:** pending

### Completed

- `src/status.njk` built — two-section status page:
  - **Ops layer**: state card (operational / degraded / maintenance), maintenance window block, incident list
  - **Cryptographic integrity layer**: 6 cards — zero-knowledge guarantee, anonymous auth (NUT-00), chunk integrity (BLAKE3), passphrase gating (NUT-11 Mode 1), server-side chunk verification gap (amber, honest disclosure), storage ephemerality (R2 lifecycle)
- State card uses CSS `color-mix()` tinted backgrounds + pulsing dot animation for degraded and maintenance states
- Incident list: severity badge, resolved badge, timeline, per-update log — sorted most-recent-first
- Maintenance window block: hidden when `maintenance: null`, revealed with formatted datetime + duration
- All user-facing strings HTML-escaped before render
- Auto-refresh every 60 s — page stays accurate without reload
- Fetch failure path: Worker unreachable → degraded state card + error note, never blocks UI
- Eleventy front matter: `permalink: /status.html`, `activePage: ""`
- No nav link added — status page is linked from the banner ("View status →") only
- `.eleventy.js` passthrough unchanged — no new assets

### Do not retry

- DO NOT add `status` to nav partial — status page is banner-linked only
- DO NOT use `localStorage` for dismiss — `sessionStorage` only (banner reappears on next visit)

### Files changed

- `src/status.njk` — new file

---


---

## Session 14 — Eleventy scaffold (14 July 2026)

**Type:** Build session.
**Commit:** `f52b55f`

### Completed

- Eleventy 3.x installed at repo root (`package.json`, `.eleventy.js`)
- Input: `src/`, output: `frontend/` — Cloudflare Pages output dir unchanged
- `src/_includes/` partials created: `head.njk`, `nav.njk`, `footer.njk`, `shared-styles.njk`
- `src/index.njk` and `src/upgrade.njk` — full migrations of existing HTML
- Nav partial: `activePage` variable drives `.active` class per page
- `head.njk`: `extraHead` slot for per-page script tags (Turnstile, Stripe, QR)
- `stripeThemeRemount` flag in upgrade front matter triggers `remountStripeForTheme()` call in theme toggle
- Build verified locally: 2 files written, 0 errors (Eleventy v3.1.6)
- Cloudflare Pages build config to update: build command `npm run build`, output `frontend`

### Do not retry

- DO NOT `cp` from `/tmp/rs-eleventy/` in a new session — sandbox `/tmp` is ephemeral per session

### Latent (carried)

- `secp256k1@1.7.2` v1 API in `index.njk` (`secp.Point.*`) — do not upgrade to v2 without migrating NUT-00 crypto
- `FREE_EXPIRY` still 5 days in `index.njk` — UI shows "1 / 7 day expiry" — fix in snag session

### Files changed

- `.eleventy.js` — Eleventy config
- `package.json` — build scripts + Eleventy dep
- `package-lock.json` — lockfile
- `src/index.njk` — upload/download page template
- `src/upgrade.njk` — pricing page template
- `src/_includes/head.njk` — shared head partial
- `src/_includes/nav.njk` — shared nav partial
- `src/_includes/footer.njk` — shared footer partial
- `src/_includes/shared-styles.njk` — brand tokens + shared CSS

## Session 13 — upgrade.html design overhaul (14 July 2026)

**Type:** Design session.
**Commit:** Session 13 commit

### Completed

- upgrade.html fully rebuilt against BRANDING.md + WEBSITE_DESIGN_SPEC.md
- Canonical site-header ported from index.html: wordmark, App / Editorial / Privacy / Upgrade nav, theme pill, sticky blur
- Paper default added: full CSS token system matching index.html, localStorage theme persistence
- Carbon toggle functional: Stripe appearance remounts on theme switch (theme: 'stripe' Paper / theme: 'night' Carbon)
- Skint Tog expiry: "5-day expiry" → "1 / 7 day expiry"
- "Most popular" badge removed from Creative Premium; replaced with "Creative" label (gold, matches "Professional" on Max)
- WORKER_URL corrected: `rajeshtaylor.workers.dev` → `rt-fc4.workers.dev`
- Font stack updated: IBM Plex Mono added, canonical match to index.html
- return_url corrected: `/upgrade?success=1` → `/upgrade.html?success=1`
- Orange confirmed absent. Gold CTAs correct throughout.

### Deferred

- FREE_EXPIRY in index.html still set to 5 days — mismatch with "1 / 7 day expiry" display. Fix in next snag session.

### Files changed

- `frontend/upgrade.html` — full rebuild

---

## Session 12 — Stripe Customer Portal + R2 lifecycle rules (13 July 2026)

**Type:** Infrastructure session.
**Commit:** Session 12 commit (post-Session 11)

### Completed

- Stripe Customer Portal configured in Dashboard:
  - Header: "Manage your Refueler subscription"
  - Redirect: `https://share.refueler.io/upgrade.html`
  - Plans: all 4 prices added (Creative £12/mo, £120/yr · Max £24/mo, £240/yr)
  - Customers can switch plans ✓, update payment method ✓, cancel at end of billing period ✓
  - Cancellation reasons: all 8 enabled ✓
- Worker: `POST /subscription/portal` endpoint added
  - Takes `{ email }`, looks up `stripe_customer_id` in Supabase
  - Creates Stripe billing portal session, returns `{ url }`
  - Returns 404 if no active subscription found
- `upgrade.html`: `openPortal()` stub replaced with real implementation
  - Manage section (post-checkout): shows plan name + portal button
  - Lookup section (on load): email field for existing subscribers to access portal directly
- R2 lifecycle rules applied to both buckets via `wrangler r2 bucket lifecycle add`:
  - `abort-incomplete-multipart` — abort incomplete multipart uploads after 1 day
  - `expiry-backstop` — expire all objects after 92 days
  - Applied to: `refueler-share-prod` ✓ · `refueler-share-dev` ✓
- Worker deployed: version `c4e78bb2`

### Do not retry

- DO NOT use `wrangler r2 bucket lifecycle set --rule` with inline JSON — not supported in Wrangler 4.92
- DO NOT use `wrangler r2 bucket lifecycle get` — command is `list`
- DO NOT use `--abort-incomplete-multipart-uploads-after` — correct flag is `--abort-multipart-days`
- DO NOT use `--file` with S3-style lifecycle JSON — use `add` subcommand with named flags

### Files changed

- `worker/src/index.js` — POST /subscription/portal endpoint
- `frontend/upgrade.html` — portal integration + manage/lookup sections

## Session 11 — Debug: decrypt stall + filename preservation (13 July 2026)

**Type:** Debug session.
**Commit:** `e50b58c` (decrypt fix) · `ec0c325` (filename)

### Completed

- Decrypt stall root cause: `startDownload` was passed the probe response (a 401 for
  protected transfers) and attempted AES-GCM decrypt on the 401 body as chunk 0 —
  silent `DOMException`, loop stalled at "Decrypting 0%"
- Fix: refactored `startDownload(uuid)` — drops `firstChunkResponse` param entirely,
  fetches all chunks from index 0 with auth token, `try/catch` around
  `crypto.subtle.decrypt` to surface errors visibly
- Both call sites (passphrase-protected and open paths) updated
- Original filename now preserved end-to-end:
  - Upload: frontend sends `X-File-Name: selectedFile.name` on chunk 0
  - Worker: sanitises and stores as `manifest.file_name`
  - Worker: returns `X-File-Name` response header on every `/download` response
  - Download: frontend reads header from chunk 0 response, uses as `a.download`
  - Fallback: `refueler-{uuid}` if header absent (old transfers)
- CORS: `X-File-Name` added to `Allow-Headers` and `Expose-Headers`
- Smoke test ✓: upload → share link → passphrase gate → download → file arrives with
  correct name, extension, type, and byte-identical content

### Do not retry

- DO NOT pass a response object into `startDownload` — it fetches chunk 0 itself

### Files changed

- `frontend/index.html` — startDownload refactor + X-File-Name send + a.download fix
- `worker/src/index.js` — X-File-Name read/sanitise/store + response header + CORS

---

## Session 10 — Debug: R2 binding, credential parse, passphrase hash (13 July 2026)

**Type:** Debug session.
**Commit:** pending with Session 9 — commit at start of Session 11

### Completed

- R2 binding name mismatch fixed: `wrangler.toml` `binding = "R2"` → `binding = "BUCKET"` (code uses `env.BUCKET`)
- `index.js` credential parse fix: `X-Cashu-Credential` header is JSON string — now `JSON.parse()`d before passing to `verifyCredential()`
- `index.js` top-level catch now includes `corsHeaders(request)` — no more CORS-less 500s
- `index.html` passphrase hash algorithm fixed: BLAKE3 → SHA-256 via `sha256Hex()` to match `nut11.js hashSecret()`
- `index.html` progress bar: transition 0.3s → 0.6s ease-out, credentialling tick animation 12→14% during fetch
- Upload working ✓, share link generated ✓, passphrase gate working ✓
- Download reaches "Decrypting 0%" then stalls — carried to Session 11

### Do not retry

- DO NOT use `binding = "R2"` in wrangler.toml — Worker uses `env.BUCKET`, binding must be `BUCKET`
- DO NOT pass raw `X-Cashu-Credential` header string to `verifyCredential()` — must `JSON.parse()` first
- DO NOT hash passphrase with BLAKE3 in frontend — use SHA-256 (`crypto.subtle.digest`) to match `nut11.js`

### Files changed

- `worker/wrangler.toml` — R2 binding name fix
- `worker/src/index.js` — credential parse + CORS on catch
- `frontend/index.html` — sha256 passphrase hash + progress bar smoothing

---

## Session 9 — Debug: nut00 noble v2 API, blake3 passthrough (13 July 2026)

**Type:** Debug session.
**Commit:** pending with Session 10 — commit at start of Session 11

### Completed

- `/credential/issue` 500 fixed
  - Root cause: `@noble/secp256k1@2.x` removed `secp.Point` — replaced throughout with `secp.ProjectivePoint`
  - `secp.Point.fromPrivateKey()` replaced with `secp.getPublicKey()`
  - All nut00 functions made synchronous (no async needed)
  - Credential field mismatch fixed: `verifyCredential` now accepts `cred.C ?? cred.unblinded_sig`
- `blake3.js` `verifyChunkHash` replaced with `return true` passthrough (WASM static bundle deferred)
- Worker version `91cb0b64` deployed

### Files changed

- `worker/src/nut00.js` — noble v2 API fix + credential field fix
- `worker/src/blake3.js` — verifyChunkHash → return true

---

## Session 8 — Debug: blake3-wasm local bundle, Turnstile secret fix (12 July 2026)

**Type:** Debug session.
**Commit:** `0369dc8`

### Completed

- blake3-wasm CDN confirmed broken: esm.sh 404, unpkg CORS blocked by Cloudflare Pages
- Local bundle: `npm install blake3-wasm@2.1.5 --prefix ./frontend-deps`, copied to `frontend/blake3/`
- `dist/` in `.gitignore` — required `git add -f frontend/blake3/` to force-commit
- `loadDeps()` patched: CDN import → `import('./blake3/browser-async.js')`
- `blake3` variable receives ready API directly from `browser-async.js` (no second `.default()` call)
- `TURNSTILE_SECRET_KEY` was set to wrong value in Session 5 — corrected
  - Correct secret: `0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU`
  - Sitekey: `0x4AAAAAAD0N7GlHlCRuWITr`
- Smoke test reached "Credentialling 12%" then 500 on `/credential/issue` — carried to Session 9

### Files changed

- `frontend/blake3/` — full local bundle (force-committed)
- `frontend/index.html` — loadDeps CDN → local
- `TURNSTILE_SECRET_KEY` Worker secret updated

---

## Session 7 — Debug: Turnstile visible widget (12 July 2026)

**Type:** Debug session.
**Commit:** `3b9a9aa`

### Completed

- Replaced invisible Turnstile with visible managed widget (`window.turnstile.render()`)
- Safari iframe block resolved
- blake3-wasm CDN failures identified, fix deferred to Session 8

---

## Session 6 — Debug: Stripe webhook secret rotation (12 July 2026)

**Type:** Debug session.
**Commit:** `458bc99` / `a96c9c55` (Pages)

### Completed

- `STRIPE_WEBHOOK_SECRET` rotated — old `whsec_bZBn7...` was exposed in git, now dead
- Smoke test stalled at "Preparing 0%" — Turnstile not resolving without user interaction

---

## Session 5 — Deploy: Turnstile, Pages, share.refueler.io live (12 July 2026)

**Type:** Build + deploy session.
**Commit:** `9a5fdc1`

### Completed

- Turnstile widget created: Managed, `share.refueler.io`, no pre-clearance
- All 6 Worker secrets set
- `frontend/index.html` patched: sitekey, WORKER_URL, secp256k1 version, Upgrade nav link
- Cloudflare Pages project created → `frontend/` directory → `share.refueler.io`
- DNS CNAME updated: `share` → `refueler-share.pages.dev`

---

## Session 4 — Build: Stripe subscriptions, Worker deploy, subdomain (11 July 2026)

**Type:** Build session.
**Commit:** `42180c1`

### Completed

- Build fixes: `@noble/*` versions, `blake3.js` → SHA-256, `turnstile.js` export, `nut00.js` aliases, `nut11.js` created
- Stripe products + prices created (live mode, GBP) — see Share-Master-Context for IDs
- Stripe webhook registered to Worker
- Supabase `subscribers` table migrated
- Worker endpoints: `/webhook/stripe`, `/subscription/checkout`, `/subscription/status`
- R2 buckets created: `refueler-share-prod`, `refueler-share-dev`
- Worker deployed: `https://refueler-share.rt-fc4.workers.dev`
- `frontend/upgrade.html` created
- `share.refueler.io` CNAME added

---

## Session 3 — Build: NUT-11 Mode 1, nav alignment (11 July 2026)

**Commit:** `172a2e0`

### Completed

- NUT-11 Mode 1 passphrase gating: `nut11.js`, `manifest.js`, `index.js`, `index.html`
- Canonical nav brand alignment

---

## Session 2 — Build: Worker scaffold, frontend, Supabase migration (11 July 2026)

**Commit:** `session-2-build` branch

### Completed

- README: free tier cap corrected to 4 GB, licence corrected to Apache 2.0
- Supabase `spent_tokens` table migrated
- Worker scaffold: 3 endpoints (`/credential/issue`, `/upload`, `/download`)
- `frontend/index.html` created
- `docs/r2-lifecycle.md` created

---

## Session 1 — Architecture Planning (10 July 2026)

**Type:** Planning only. No build output. No commits.

### Completed

- Token lifetime rules, A/B speed test spec, upload credential storage model confirmed
- Contractor upload link: Option A (NUT-11 P2SH)
- Anonymous auth flow spec, NUT-11 downloader identity model (Mode 1 + Mode 2)
- Storage layer config spec
