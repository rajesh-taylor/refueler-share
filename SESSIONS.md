## Session 8 — Debug: blake3-wasm local bundle, Turnstile secret fix (12 July 2026)

**Type:** Debug + deploy session.
**Commit:** `0369dc8`

### Completed

**blake3-wasm CDN failure root cause confirmed:**
- `esm.sh` returns 404 for blake3-wasm browser build
- `unpkg.com` CORS blocks WASM module imports from `share.refueler.io` (Cloudflare Pages strips cross-origin headers)
- Fix: bundled blake3-wasm locally into `frontend/blake3/`

**Local bundle steps completed:**
- `npm install blake3-wasm@2.1.5 --prefix ./frontend-deps` (repo root, no package.json needed)
- Copied: `browser-async.js`, `esm/browser/*.js`, `esm/base/*.js`, `dist/wasm/web/blake3_js.js`, `dist/wasm/web/blake3_js_bg.wasm` → `frontend/blake3/`
- `dist/` was in `.gitignore` (under `# Build output`) — required `git add -f frontend/blake3/` to force-commit
- `loadDeps()` in `index.html` patched: `import('https://unpkg.com/blake3-wasm@2.1.5/esm/browser.js')` → `import('./blake3/browser-async.js')`
- `blake3` variable now receives ready API directly from `browser-async.js` (no second `.default()` call needed)
- Committed and pushed — Pages deployed, confirmed `content-type: application/javascript` for both `browser-async.js` and `blake3_js.js` via curl

**Turnstile secret key mismatch fixed:**
- `TURNSTILE_SECRET_KEY` was set to wrong value in Session 5
- Correct secret retrieved from Cloudflare Dashboard → Turnstile → refueler-share widget
- Re-set: `echo "0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU" | npx wrangler secret put TURNSTILE_SECRET_KEY`

**Smoke test progress:**
- Before Session 8: stuck at "Preparing 0%" — blake3 import failing
- After blake3 fix: reached "Credentialling 12%" — BLAKE3 loading confirmed working
- After Turnstile secret fix: reached "Credentialling 12%" then **500 Internal Server Error** from `/credential/issue`
- Error body: `{"error":"Credential issuance failed"}` — Turnstile verification now PASSES, Worker crashes inside NUT-00 blind sig logic

### Current blocker (Session 9)

`POST /credential/issue` → 500, `{"error":"Credential issuance failed"}`

Turnstile is verified correctly. Crash is inside `nut00.js` — `issueBlindSignature()`.
Likely cause: `MINT_PRIVATE_KEY` env var not accessible, or secp256k1 point arithmetic failing at Worker runtime.

**Session 9 fix plan:**
1. Pull Worker logs to get the actual stack trace:
   `npx wrangler tail --format pretty` (from `worker/` dir) then trigger an upload attempt
2. Likely fix: verify `MINT_PRIVATE_KEY` is valid 32-byte hex and accessible in `nut00.js` via `env.MINT_PRIVATE_KEY`
3. If key access issue: check `wrangler.toml` bindings and `index.js` env passthrough to `nut00.js`
4. Re-smoke-test to completion

### Do not retry

- DO NOT attempt CDN imports for blake3-wasm (esm.sh 404, unpkg CORS blocked)
- DO NOT use `import('https://unpkg.com/blake3-wasm...')` — confirmed broken on Cloudflare Pages
- DO NOT re-set TURNSTILE_SECRET_KEY — correct value now set, widget sitekey `0x4AAAAAAD0N7GlHlCRuWITr` matches

### Files changed this session

- `frontend/blake3/browser-async.js` (new — force-added)
- `frontend/blake3/esm/browser/*.js` (new — force-added)
- `frontend/blake3/esm/base/*.js` (new — force-added)
- `frontend/blake3/dist/wasm/web/blake3_js.js` (new — force-added)
- `frontend/blake3/dist/wasm/web/blake3_js_bg.wasm` (new — force-added)
- `frontend/index.html` (patched — loadDeps CDN → local)
- `TURNSTILE_SECRET_KEY` Worker secret updated

### Not completed (carry to Session 9)

- Smoke test to completion (upload + share link)
- Stripe Customer Portal enable
- R2 lifecycle rules (`docs/r2-lifecycle.md`)
- Lightning tab — Blink BOLT11 in `upgrade.html`
- NUT-11 Mode 2

---

## Session 7 — Debug: Turnstile visible widget, blake3 CDN failures (12 July 2026)

**Type:** Debug session.
**Commit:** `3b9a9aa`

### Completed

- Replaced invisible Turnstile with visible managed widget (explicit `window.turnstile.render()`)
- Safari iframe block resolved
- blake3-wasm CDN failures identified: esm.sh 404, unpkg CORS blocked
- Local bundle fix deferred to Session 8

### Not completed (carried to Session 8)

- blake3-wasm local bundle
- Smoke test

---

## Session 6 — Debug: Stripe webhook secret rotation, Turnstile fixes (12 July 2026)

**Type:** Debug session.
**Commit:** `458bc99` / `a96c9c55` (Pages)

### Completed

- `STRIPE_WEBHOOK_SECRET` rotated (old `whsec_bZBn7...` was exposed in git, now dead)
- Turnstile size/appearance fixes attempted
- Smoke test stalled at "Preparing 0%" — Turnstile not resolving in headless/interaction-only mode

### Not completed (carried to Session 7)

- Turnstile visible widget fix
- Smoke test

---

## Session 5 — Deploy: Turnstile, Pages, share.refueler.io live (12 July 2026)

**Type:** Build + deploy session.
**Commit:** `9a5fdc1`

### Completed

- Turnstile widget created (Managed, share.refueler.io, no pre-clearance)
- All 6 Worker secrets confirmed set
- `frontend/index.html` patched: sitekey, WORKER_URL, secp256k1 version, Upgrade nav link
- Cloudflare Pages project created — `refueler-share` → `frontend/` directory
- Custom domain `share.refueler.io` activated, SSL enabled
- DNS CNAME updated: share → refueler-share.pages.dev

### Not completed (carried to Session 6)

- End-to-end upload smoke test
- Stripe Customer Portal
- R2 lifecycle rules
- Lightning tab

---

## Session 4 — Build: Stripe subscriptions, Worker deploy, subdomain (11 July 2026)

**Type:** Build session. Code output. Commit all deliverables.
**Branch:** `session-4-build`
**Commit ref (Session 3):** `172a2e0`

### Completed

- Build fixes from Session 3: @noble/* versions, blake3.js→SHA-256, turnstile.js export, nut00.js aliases, nut11.js created
- Stripe products + webhook created (live mode, GBP)
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

- NUT-11 Mode 1 passphrase gating
- Canonical nav brand alignment

---

## Session 2 — Build: Worker scaffold, frontend, Supabase migration (11 July 2026)

**Branch:** `session-2-build`

### Completed

- README corrections (free tier cap 4 GB, Apache 2.0 licence)
- Supabase `spent_tokens` table migrated
- Worker scaffold: 3 endpoints
- Frontend: `frontend/index.html`
- R2 lifecycle rules: `docs/r2-lifecycle.md`

---

## Session 1 — Architecture Planning (10 July 2026)

**Type:** Planning only. No build output. No commits.

### Completed

- Token lifetime rules, A/B speed test spec, upload credential storage model
- Contractor upload link: Option A (NUT-11 P2SH)
- Anonymous auth flow spec, NUT-11 P2SH downloader identity model
- Storage layer config spec
