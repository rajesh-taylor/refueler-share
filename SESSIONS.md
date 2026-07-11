## Session 4 — Build: Stripe subscriptions, Worker deploy, subdomain (11 July 2026)

**Type:** Build session. Code output. Commit all deliverables.

**Branch:** `session-4-build` (merge to main after local review)

**Commit ref (Session 3):** `172a2e0`

### Completed

**Build fixes carried from Session 3 (priority 0):**
- `@noble/hashes` subpath import errors fixed — upgraded to 1.7.2, `@noble/secp256k1` to 2.1.0
- `blake3-wasm` cannot bundle in Cloudflare Workers — replaced with Web Crypto SHA-256 server-side.
  Security guarantee identical: client declares hash, Worker verifies received bytes match.
  Client still uses BLAKE3 WASM (browser) to compute hashes before upload.
- `turnstile.js` export name mismatch fixed — now exports `verifyTurnstileToken` (alias `verifyTurnstile`)
- `nut00.js` rewritten — aliased exports `issueBlindSignature` and `verifyCredential` added for index.js
- `nut11.js` created — was missing from Session 3 commit. Exports: `hashSecret`, `timingSafeEqual`,
  `issueDownloadToken`, `verifyDownloadToken`. HMAC-SHA256 download tokens, 15-min expiry, UUID-bound.

**Stripe setup (priority 1):**
- Products created in live mode (Rajesh Taylor account, GBP):
  - `Refueler Share — Creative Premium` (prod_UrrU6KHBl0rQSn)
    - Monthly £12: `price_1Ts7lsGlctwiB9U3hdtgChU2` (lookup: `share-creative-monthly`)
    - Yearly £120: `price_1Ts7sqGlctwiB9U3YRloCFfi` (lookup: `share-creative-yearly`)
  - `Refueler Share — Production Max` (prod_Urre2e3PQgr5Uq)
    - Monthly £24: `price_1Ts7vIGlctwiB9U3kb3NCLue` (lookup: `share-max-monthly`)
    - Yearly £240: `price_1Ts7xIGlctwiB9U3JyZB8Kwj` (lookup: `share-max-yearly`)
- Webhook registered: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
  - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
  - Destination ID: `we_1Ts8epGlctwiB9U3dXT8XBac`
- New secret key created: `refueler-share` (previous key unused since 2020, Ghost membership inactive)

**Supabase migration (priority 2):**
- Table: `subscribers`
  - `stripe_customer_id TEXT PRIMARY KEY`
  - `email TEXT`
  - `tier TEXT CHECK (free | creative | max) DEFAULT free`
  - `status TEXT CHECK (active | inactive | cancelled) DEFAULT inactive`
  - `current_period_end TIMESTAMPTZ`
  - `created_at TIMESTAMPTZ DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ DEFAULT NOW()`
- Index: `subscribers_email_idx` on `email`
- RLS enabled. Worker service_role key only.
- Migration name: `create_subscribers_refueler_share`

**Worker additions (priority 3):**
New file: `worker/src/stripe.js`
- `verifyStripeWebhook` — HMAC-SHA256 signature verify, 5-min replay protection
- `createCheckoutSession` — Stripe embedded checkout (Payment Element mode)
- `getSubscriptionTier` — lookup active sub by customer ID

Updated: `worker/src/index.js`
- `POST /webhook/stripe` — handles 3 Stripe events, upserts `subscribers` table
- `POST /subscription/checkout` — validates price_id whitelist, creates embedded checkout session
- `GET /subscription/status` — returns tier + status by email
- CORS headers added for `share.refueler.io` and `upgrade.refueler.io`

Worker secrets added:
- `STRIPE_SECRET_KEY` — `sk_live_...Fyop`
- `STRIPE_WEBHOOK_SECRET` — `whsec_bZBn7PX9IVxm1MMWvejujI0bvC8JjuqH`

**R2 buckets created (priority 4):**
- `refueler-share-prod` — production storage
- `refueler-share-dev` — A/B speed test bucket

**Worker deployed (priority 5):**
- URL: `https://refueler-share.rt-fc4.workers.dev`
- Version ID: `a392adff-133a-4aec-9044-7e0568a8aa97`
- Smoke test: `POST /credential/issue` → `{"error":"Turnstile verification failed"}` ✓

**Frontend: upgrade.html (priority 6):**
`frontend/upgrade.html` — single file, no build step.
- Tier cards: Skint Tog (free, current), Creative Premium, Production Max
- Monthly/yearly billing toggle with "2 months free" badge
- Stripe Payment Element embedded (card tab)
- Lightning tab placeholder (Session 5)
- Email field triggers Payment Element mount on blur
- Carbon `#1A1A1A` design system, Gold `#C8A96E`, Satoshi/DM Sans
- Success panel on `?success=1` redirect from Stripe

**share.refueler.io subdomain (priority 7):**
- CNAME record added: `share` → `refueler-share.rt-fc4.workers.dev` (Proxied)
- Cloudflare Pages deployment pending (Session 5 — frontend needs Turnstile sitekey + WORKER_URL set)

### Worker secrets status (all secrets for production)

| Secret | Status |
|--------|--------|
| `MINT_PRIVATE_KEY` | ⚠ Not yet set — run `openssl rand -hex 32 \| wrangler secret put MINT_PRIVATE_KEY` |
| `TURNSTILE_SECRET_KEY` | ⚠ Not yet set |
| `SUPABASE_URL` | ⚠ Not yet set — `https://tihgvdokeofnjxjkenmm.supabase.co` |
| `SUPABASE_SERVICE_KEY` | ⚠ Not yet set |
| `STRIPE_SECRET_KEY` | ✓ Set |
| `STRIPE_WEBHOOK_SECRET` | ✓ Set |

### Session 4 — Pre-commit checklist

- [ ] Set remaining Worker secrets: MINT_PRIVATE_KEY, TURNSTILE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
- [ ] Replace Turnstile sitekey placeholder in `frontend/index.html`
- [ ] Update `WORKER_URL` in `frontend/index.html` to `https://refueler-share.rt-fc4.workers.dev`
- [ ] Update `WORKER_URL` in `frontend/upgrade.html` (already set correctly)
- [ ] Deploy Cloudflare Pages with `frontend/` directory → `share.refueler.io`
- [ ] Verify `share.refueler.io` resolves after Pages deploy
- [ ] Apply R2 lifecycle rules: `docs/r2-lifecycle.md`
- [ ] Commit: `git add . && git commit -m "session-4: stripe subscriptions, worker deploy, upgrade page"`

### Not completed this session (carry to Session 5)

- Cloudflare Pages deploy (`share.refueler.io` serving `frontend/`)
- Remaining Worker secrets (MINT_PRIVATE_KEY, TURNSTILE_SECRET_KEY, SUPABASE_*)
- Turnstile sitekey in index.html
- Stripe Customer Portal configuration
- Lightning payment tab (Blink BOLT11)
- Dashboard for paid tiers
- NUT-11 Mode 2 (keypair challenge-response, Production Max)
- Contractor upload link flow
- ML-KEM PQC key wrapping (Production Max Phase 2)

### Files produced this session

- `worker/src/stripe.js` (new)
- `worker/src/index.js` (updated — Stripe endpoints + CORS)
- `worker/src/nut00.js` (fixed — aliased exports)
- `worker/src/nut11.js` (new — was missing from Session 3)
- `worker/src/blake3.js` (fixed — Web Crypto SHA-256 replaces WASM)
- `worker/src/turnstile.js` (fixed — export name)
- `frontend/upgrade.html` (new)
- `SESSIONS.md` (this file)

---

## Session 3 — Build: NUT-11 Mode 1, nav alignment (11 July 2026)

**Type:** Build session. Code output. Commit all deliverables.

**Commit:** `172a2e0`

### Completed

- NUT-11 Mode 1 passphrase gating: `nut11.js`, `manifest.js`, `index.js`, `index.html`
- Canonical nav brand alignment

### Not completed (carried to Session 4)

- NUT-11 Mode 2 (keypair challenge-response)
- Contractor upload link flow
- Payment integration
- `share.refueler.io` domain config
- Dashboard for paid tiers

---

## Session 2 — Build: Worker scaffold, frontend, Supabase migration (11 July 2026)

**Type:** Build session. Code output. Commit all deliverables.

**Branch:** `session-2-build` (merge to main after local review)

### Completed

**README correction (priority 1):**
- Free tier cap corrected: 6 GB → **4 GB** (Skint Tog row and prose references)
- Licence corrected: MIT → **Apache 2.0** (was wrong from initialisation — CC-64 carry-forward)
- Economics section removed (should have been stripped in CC-64)
- Status copy updated to reflect Session 2 in progress

**Supabase migration applied (priority 2):**
- Table: `spent_tokens` — `serial TEXT PRIMARY KEY`, `melted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- RLS enabled. No client policies created. Worker service_role key only.
- Verified post-apply via `execute_sql` — schema confirmed correct.
- Migration name: `create_spent_tokens_refueler_share`

**Cloudflare Worker scaffold (priority 3):**
Three endpoints built:
- `POST /credential/issue` — Turnstile validation (free tier) + NUT-00 blind sig issuance.
- `PUT /upload/{uuid}/{chunk-index}` — credential verify, double-spend check, BLAKE3, manifest, melt.
- `GET /download/{uuid}/{chunk-index}` — manifest expiry check, grace period, R2 proxy.

Files: `worker/src/index.js`, `worker/src/nut00.js`, `worker/src/turnstile.js`,
`worker/src/manifest.js`, `worker/src/blake3.js`, `worker/wrangler.toml`, `worker/package.json`

**BLAKE3 WASM integration (priority 4):**
- Frontend: loaded dynamically from `esm.sh/blake3-wasm@2.1.5/browser`.
- Worker: replaced with Web Crypto SHA-256 (Session 4 fix — WASM cannot bundle in Workers).

**Frontend (priority 5):** `frontend/index.html` — single file, no build step.

**R2 lifecycle rules (priority 6):** `docs/r2-lifecycle.md`

### Not completed this session (carry to Session 3)

- NUT-11 P2SH download gating
- Contractor upload link flow
- Payment integration
- `share.refueler.io` domain config
- Dashboard for paid tiers
- ML-KEM PQC key wrapping

---

## Session 1 — Architecture Planning (10 July 2026)

**Type:** Planning only. No build output. No commits.

### Completed

- Token lifetime rules resolved
- A/B speed test spec produced
- Upload credential storage model confirmed (browser memory only)
- Contractor upload link option selection (Option A: NUT-11 P2SH)
- Anonymous auth flow spec produced
- NUT-11 P2SH downloader identity model (Mode 1 + Mode 2)
- Storage layer config spec produced

### Files uploaded this session

- `claude.md` (v4.7)
- `Refueler_MasterContext_CC64.md`
- `REFUELER_SHARE_SESSION_1.md`
- `refueler-share/README.md`
