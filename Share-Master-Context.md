# Share-Master-Context — refueler-share
> **Version:** 1.3 | **Last updated:** Session 10 · 13 July 2026
> Load this file alongside `CLAUDE.md` (refueler-share) and `SESSIONS.md` for every share session.

---

## What this repo is

`rajesh-taylor/refueler-share` — anonymous, encrypted peer-to-peer file transfer.
BLAKE3 chunk integrity + Cashu NUT-00 blind signatures as anonymous auth.
**These are distinct layers. Never conflate.**

Local path: `/Users/rajeshtaylor/Documents/refueler-share/`
Licence: **Apache 2.0**

---

## Stack (share only)

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens` + `subscribers` |
| Frontend | Static HTML5 — `frontend/index.html` + `frontend/upgrade.html` |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.pages.dev` (Pages) |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser, local bundle), secp256k1 (@noble) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | Blink BOLT11 — deferred |

---

## Supabase — share-specific

Project: `tihgvdokeofnjxjkenmm`

**Table: `spent_tokens`** (Session 2)
```
serial     TEXT PRIMARY KEY
melted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

**Table: `subscribers`** (Session 4)
```
stripe_customer_id  TEXT PRIMARY KEY
email               TEXT
tier                TEXT CHECK (free | creative | max) DEFAULT free
status              TEXT CHECK (active | inactive | cancelled) DEFAULT inactive
current_period_end  TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT NOW()
updated_at          TIMESTAMPTZ DEFAULT NOW()
```
Index: `subscribers_email_idx` on `email`. RLS enabled. Worker service_role key only.

---

## Cloudflare resources

| Resource | Name / Value |
|----------|-------------|
| Worker | `refueler-share` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| R2 prod bucket | `refueler-share-prod` |
| R2 dev bucket | `refueler-share-dev` |
| Pages | `share.refueler.io` — LIVE · project `refueler-share` · CNAME → refueler-share.pages.dev |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Secret `0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU` · Widget: refueler-share (Managed) |
| DNS | `share.refueler.io` CNAME → `refueler-share.pages.dev` ✓ |

Worker secrets (all set ✓):
- `MINT_PRIVATE_KEY` — secp256k1 hex (32 bytes) ✓
- `TURNSTILE_SECRET_KEY` — `0x4AAAAAAD0N7OIqbRdBAbVR66n3FqTFkLU` ✓ (corrected Session 8)
- `SUPABASE_URL` → `https://tihgvdokeofnjxjkenmm.supabase.co` ✓
- `SUPABASE_SERVICE_KEY` → service_role JWT ✓
- `STRIPE_SECRET_KEY` → `sk_live_...Fyop` ✓
- `STRIPE_WEBHOOK_SECRET` → rotated Session 6 ✓

---

## Stripe — live mode

Account: Rajesh Taylor (`rt@rajeshtaylor.com`), GBP
Publishable key: `pk_live_qTLdmzRXg6KHXtxbgGYQZc7L00Kl4saD2q`

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium yearly | `price_1Ts7sqGlctwiB9U3YRloCFfi` | `share-creative-yearly` | £120/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max yearly | `price_1Ts7xIGlctwiB9U3JyZB8Kwj` | `share-max-yearly` | £240/yr |

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
Customer Portal: configured ✓ · redirect → `https://share.refueler.io/upgrade.html` · all 4 plans · cancel at period end · cancellation reasons enabled
Destination ID: `we_1Ts8epGlctwiB9U3dXT8XBac`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

- **Free tier cap: 4 GB** per transfer
- **Worker URL: `https://refueler-share.rt-fc4.workers.dev`** — hardcoded in both HTML files ✓
- **R2 binding name: `BUCKET`** — `wrangler.toml` must use `binding = "BUCKET"`, code uses `env.BUCKET`
- **`X-Cashu-Credential` header is a JSON string** — must `JSON.parse()` before passing to `verifyCredential()`
- **Passphrase hashing: SHA-256 only** — frontend uses `crypto.subtle.digest('SHA-256')`, stored in manifest as `p2sh_secret_hash`. BLAKE3 is for chunk integrity only. Never conflate.
- BLAKE3 = chunk integrity (browser WASM, local bundle at `frontend/blake3/`). Server-side uses Web Crypto SHA-256.
- `frontend/blake3/` is force-committed via `git add -f` — `dist/` is in `.gitignore`, must use `-f` flag if re-adding
- Cashu blind sigs = anonymous auth. Never conflate with BLAKE3.
- No external mint. No ecash-to-sats path. No Cashu monetary usage.
- AES-GCM session key lives in URL fragment only. Never in network requests. Never in logs.
- Browser memory only for credentials. Never localStorage. Never sessionStorage.
- Subscription model (monthly/yearly). Pay-per-transfer deferred to future.
- Stripe embedded Payment Element (not Checkout redirect) — card in upgrade.html.
- Lightning tab in upgrade.html is placeholder — Blink BOLT11 deferred.
- NUT-07 melt fires after first chunk write. On Supabase failure: log and continue.
- Turnstile: fail-closed on any verification error.
- R2 manifest is authoritative transfer state. Supabase is ledger only.
- Chunk key format: `{uuid}/{0000}` (zero-padded 4 digits)
- Manifest key: `{uuid}/manifest.json`
- Direct R2 URL exposure: none. Worker proxies all R2 access.
- curl: always single-line, real key inlined, no backslash continuations.
- Downloaded files: Rajesh moves manually. Claude gives destination path as one-liner only.

---

## Known broken / do not retry

- **blake3-wasm CDN imports** — `esm.sh` returns 404, `unpkg.com` blocked by CORS on Cloudflare Pages. Local bundle only.
- **`import('https://unpkg.com/blake3-wasm...')`** — confirmed broken, do not use.
- **Invisible Turnstile mode** — doesn't resolve in Chrome/Safari without user interaction. Visible managed widget only.
- **`secp.Point`** — removed in `@noble/secp256k1@2.x`. Use `secp.ProjectivePoint` throughout.
- **`binding = "R2"` in wrangler.toml** — Worker uses `env.BUCKET`, binding must be `BUCKET`.
- **BLAKE3 for passphrase hash** — frontend must use SHA-256 to match `nut11.js hashSecret()`.
- **`wrangler r2 bucket lifecycle set --rule` inline JSON** — not supported in Wrangler 4.92. Use `add` subcommand with `--abort-multipart-days` / `--expire-days` flags.
- **`wrangler r2 bucket lifecycle get`** — command is `list`.

---

## Current blocker (Session 11 priority 0)

## Current state

## Current state

**Full upload → share link → passphrase gate → download flow is end-to-end functional.**
Stripe Customer Portal live. R2 lifecycle rules applied to prod and dev buckets.
upgrade.html rebuilt: Paper default, canonical nav, theme toggle, brand-compliant. (Session 13)

**Latent mismatch (deferred):** `FREE_EXPIRY` in `index.html` is 5 days but free tier UI displays "1 / 7 day expiry". Fix in next snag session.

---

## Tiers

| Tier | Cap | Expiry options |
|------|-----|---------------|
| Skint Tog (free) | **4 GB** | 1 / 7 days |
| Creative Premium (£12/mo or £120/yr) | 100 GB | 1 / 7 / 30 days |
| Production Max (£24/mo or £240/yr) | 250 GB | 1 / 7 / 30 / 90 days |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price (2 months free).

---

## NUT protocol scope

| Session | NUTs in scope |
|---------|--------------|
| Sessions 2-4 (complete) | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Session 11 | Fix decrypt stall, complete smoke test |
| Session 12+ | Stripe Customer Portal, R2 lifecycle rules, Lightning tab (Blink BOLT11) |
| Future | NUT-11 Mode 2 (keypair challenge-response, Production Max) |
| Prod Max Phase 2 | ML-KEM key wrapping (deferred) |

---

## Worker endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/credential/issue` | NUT-00 blind sig (free tier, Turnstile gate) ✓ |
| PUT | `/upload/{uuid}/{chunk}` | Chunked upload, credential verify ✓ |
| POST | `/auth/{uuid}` | NUT-11 Mode 1 passphrase → download token ✓ |
| GET | `/download/{uuid}/{chunk}` | R2 chunk proxy |
| POST | `/webhook/stripe` | Stripe subscription lifecycle |
| POST | `/subscription/checkout` | Create embedded checkout session |
| GET | `/subscription/status` | Returns tier by email |
| POST | `/subscription/portal` | Create Stripe Customer Portal session |
---

## Design snag list (separate design session)

- Progress bar: 15%→100% jump is choppy — needs smooth animation during upload chunk loop
- Turnstile widget should sit above passphrase field in upload UI (logical vertical flow)
- QR code render is blurry — needs sharper output
- Copy button: add double-square icon alongside text
- Brand audit: run refueler.io branding .md against share UI

---

## File map

```
refueler-share/
  README.md
  CLAUDE.md
  SESSIONS.md
  Share-Master-Context.md   ← this file (v1.3)
  LICENSE                   ← Apache 2.0
  frontend-deps/            ← throwaway npm install dir, not committed
  worker/
    wrangler.toml           ← binding = "BUCKET" ✓
    package.json            ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    src/
      index.js              ← 7 endpoints + CORS ✓
      nut00.js              ← NUT-00 BDHKE, noble v2 API ✓
      nut11.js              ← NUT-11 Mode 1 helpers + download tokens ✓
      blake3.js             ← verifyChunkHash → return true (passthrough)
      turnstile.js          ← Turnstile verify ✓
      manifest.js           ← R2 manifest helpers + TIER_CAPS ✓
      stripe.js             ← Stripe webhook verify + checkout session ✓
  frontend/
    index.html              ← upload UI ✓ sha256 passphrase hash ✓
    upgrade.html            ← tier cards + Payment Element
    blake3/                 ← local blake3-wasm bundle (force-committed)
      browser-async.js
      esm/browser/*.js
      esm/base/*.js
      dist/wasm/web/blake3_js.js
      dist/wasm/web/blake3_js_bg.wasm
  docs/
    r2-lifecycle.md         ← R2 lifecycle rules (not yet applied)
```

---

*"Nothing stops this train."*
