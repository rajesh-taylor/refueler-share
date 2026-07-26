# Share-Master-Context — refueler-share
> **Version:** 4.4 | **Last updated:** S61 · 26 July 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.

---

## What this repo is

`rajesh-taylor/refueler-share` — anonymous, encrypted peer-to-peer file transfer.
BLAKE3 chunk integrity + Cashu NUT-00 blind signatures as anonymous auth. **Distinct layers — never conflate.**

Local path: `/Users/rajeshtaylor/Documents/refueler-share/` · Licence: Apache 2.0

---

## Stack

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.pages.dev` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser local bundle + Worker WASM), secp256k1 (@noble v2) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | Blink BOLT11 primary (Share-specific account) → LNbits Tier 2 (B9) |

---

## Lightning infrastructure — B7 plan

**Account structure:** Separate Blink account for Share (not shared with refueler.io merchant POS).
Privacy, regulatory, and webhook separation all require distinct accounts. Share Blink account:
email `rt+share@rajeshtaylor.com` (or equivalent). API key `refueler-share-b7` — scopes READ +
RECEIVE only (no WRITE — Share only receives payments, never sends). Wallet ID queried post-creation
via `me { defaultAccount { wallets { id walletCurrency } } }`.

**Callback endpoint:** Registered on Share Blink account pointing to
`https://refueler-share.rt-fc4.workers.dev/webhook/lightning`. No signing secret — Blink does not
sign payloads. Verification via KV payment hash lookup. Blink fires twice per payment — Worker
deduplicates via `settled: true` KV flag. Endpoint ID logged at registration.

**Lightning payment flow (B7 — BOLT11 invoice model):**
1. Frontend → `POST /subscription/lightning` with `{ tier, period }`
2. Worker queries Blink `btcPrice` for live GBP/sats rate at invoice creation time
3. Worker calls `lnInvoiceCreate` → BOLT11 string + payment hash
4. Worker writes `{ paymentHash, tier, period, created_at, expires_at, settled: false }` to KV — 25h TTL
5. Frontend displays QR + BOLT11 copy. User pays from any Lightning wallet.
6. Blink fires callback to `/webhook/lightning` — Worker verifies hash against KV
7. Worker issues Cashu credential for tier (NUT-00 path, capacity-appropriate)
8. Worker marks KV entry `settled: true` — prevents double-issuance
9. Worker writes credential to short-lived KV slot keyed by `paymentHash` — 10 min TTL
10. Frontend polls `GET /subscription/lightning/credential?hash={paymentHash}` → picks up credential
11. Credential stored in browser memory only. No Supabase row. No email. No persistent record.

**GBP/sats rate:** Blink `btcPrice` query at invoice creation time. No external dependency.

**Backend abstraction (built at B7 — enables Tier 2 switch without rework):**
`worker/src/lightning.js` exports `createInvoice()` and `getInvoiceStatus()`.
`LIGHTNING_BACKEND` env var (default: `blink`) routes to correct implementation.
LNbits slots in via env var swap + new secret — zero frontend or Cashu logic changes.

**Migration trigger to LNbits (Tier 2):** When any 2 of 3 conditions are true:
- Paid Lightning subscriber count exceeds 100 active accounts, OR
- Monthly Lightning settlement volume exceeds £2,000 GBP equivalent, OR
- Blink API reliability falls below 99.5% over a 30-day window

**Fallback 1 — LNbits instability:** Revert to Blink within 4 hours.
`wrangler secret put LIGHTNING_BACKEND blink` → `wrangler deploy`. Dashboard toggle executes
without a code deploy (KV flag `lightning_available: blink`).

**Fallback 2 — both unavailable:** Activate graceful degradation within 30 minutes.
KV flag `lightning_available: false`. Lightning option hidden on upgrade page.
Stripe fiat path remains fully operational. Dashboard toggle executes without a code deploy.

**Privacy model — Lightning vs Stripe vs PayNym:**
- Stripe payer: Refueler sees name, email, card last 4. Stripe sees full identity. Supabase row
  persists with email + customer ID. Not anonymous. Honest framing: "Private by default."
- Lightning payer: Refueler sees payment hash, amount, tier, timestamp only. Blink sees invoice
  paid + receiving wallet. Blink can internally correlate if sender is also a Blink user — this
  is documented explicitly in the upgrade page privacy table. KV entry expires 25h post-settlement.
  No Supabase row. No email. Honest claim: "Pseudonymous. No identity data collected."
- PayNym payer (on-chain, future): BIP47 reusable payment code. No Lightning routing. Sparrow cold
  storage wallet, manual/semi-manual settlement. Column present on upgrade page marked "coming soon."
- DO NOT claim "anonymous" for Lightning — Lightning graph is public; Blink internal correlation
  is a real and documented caveat.

**Payment privacy table — upgrade page:**
Data-driven Eleventy partial. Source: `src/_data/payment_privacy.json`. Rendered in collapsible
section on `src/upgrade.njk` headed "What does each payment method know about you?" Three columns:
Stripe / Lightning (Blink) / PayNym (coming soon). Provider-specific caveats (e.g. Blink
correlation) are rows in the JSON, not hardcoded HTML. Update JSON when provider changes —
single redeploy, no HTML edits. Also appears verbatim in B9 whitepaper §Privacy model.

**Own dedicated Lightning node (B9 scope):**
Separate from personal node and refueler.io node. Graph isolation — no shared channels, no common
funding wallet. Three separate entities in the Lightning graph. Separate HMRC ledger per product.
Hosting: Hetzner CX22 (~£4/month). Full-disk encryption. Enclave hardening assessed at B9 planning
— not urgent for Blink/LNbits phase. Routing fee income and channel liquidity metrics activate on
own node — stubbed as greyed dashboard cards until then.

**LNURL-withdraw credential delivery (B9 scope — gift use case primary):**
Cashu credential encoded as LNURL-withdraw payload. Recipient scans QR in Lightning wallet →
wallet calls back → node returns Cashu credential as withdrawal response. Primary narrative: gift
use case — sender purchases upload capacity, forwards LNURL-withdraw link to recipient. Recipient
redeems in their wallet. Refueler never knows who used the capacity. NUT-20 binding potential:
mint signs `{ lnurlw_nonce, tier, expiry }` → unforgeable chain from Lightning payment to
credential. World-first for file transfer — no existing service delivers credentials wallet-natively.
Scoped to B9. Two dedicated sessions minimum.

**LNbits fork (B9 scope):**
Fork `lnbits/lnbits` (Apache 2.0). Strip consumer wallet UI. Keep: invoice creation, payment
tracking, webhook dispatch, extension loader (LNURLp, LNURLw, Boltcard). Apply Paper/Carbon
design tokens to admin templates — Satoshi figures, IBM Plex Mono for hashes, gold accent on
Carbon. B9 planning session required before touching the repo. No branding work until planning
session locks scope. Webhook signing (HMAC-SHA256) activates dashboard metrics: delivery rate,
confirmation latency, signature failures. Saves KV writes vs Blink polling model.

**Dashboard cards — Lightning (B7):**
- Lightning confirmation latency (p95) — LIVE at B7 (KV timestamps, works on Blink)
- Webhook delivery rate — STUB greyed (requires LNbits signing, B9)
- Webhook signature failures — STUB greyed (requires LNbits signing, B9)
- Routing fee income (MTD) — STUB greyed (requires own node, B9)
- Channel liquidity health — STUB greyed (requires own node, B9)

---
## Supabase

Project: `tihgvdokeofnjxjkenmm`

| Table | Key columns | Notes |
|-------|-------------|-------|
| `spent_tokens` | `serial TEXT PK`, `melted_at TIMESTAMPTZ` | RLS deny-all |
| `subscribers` | `stripe_customer_id TEXT PK`, `email`, `tier` (free/creative/max), `status` (active/inactive/cancelled), `current_period_end`, `cancelled_at`, `created_at`, `updated_at` | RLS deny-all · index on email |
| `double_spend_attempts` | `id BIGSERIAL PK`, `serial`, `uuid`, `attempted_at` | RLS deny-all · fire-and-forget on 409 |

Count pattern: `Prefer: count=exact` + `Range: 0-0` → parse total from `Content-Range: 0-0/TOTAL`.

---

## Cloudflare resources

| Resource | Value |
|----------|-------|
| Worker | `refueler-share` |
| R2 buckets | `refueler-share-prod`, `refueler-share-dev` |
| KV | `refueler-share-kv` · id `5b1dca6a8f06423f98d0bbc4286e2968` · binding `STATUS_KV` |
| AE dataset | `share_events` · binding `AE` |
| Pages | `share.refueler.io` → `refueler-share.pages.dev` |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Managed widget (visible only) |

Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD, S29),
`STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`,
`CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).

---

## Stripe — live mode

Account: `rt@rajeshtaylor.com` · GBP · Publishable key: `pk_live_qTLdmzRXg6KHXtxbgGYQZc7L00Kl4saD2q`

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium yearly | `price_1Ts7sqGlctwiB9U3YRloCFfi` | `share-creative-yearly` | £120/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max yearly | `price_1Ts7xIGlctwiB9U3JyZB8Kwj` | `share-max-yearly` | £240/yr |

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://share.refueler.io/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: local WASM at `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. Server verifies every chunk — 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only (`crypto.subtle.digest`). Stored in manifest as `p2sh_secret_hash`.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- Upload boundary: `Content-Type` header validated on chunk 0 against denylist of execution-capable MIME types. 415 on missing or denylisted type, logged to AE. MIME type is never stored.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`. Never `new Uint8Array([i])`.

**Storage:**
- R2 binding: `BUCKET`. KV binding: `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`.
- R2 manifest is authoritative. Supabase is ledger only. No direct R2 URL exposure.
- `safeGetManifest()` double-read: minor R2 inefficiency, not a security gap.

**Frontend:**
- Credentials in browser memory only — never localStorage, never sessionStorage.
- `frontend/blake3/`, `frontend/fflate.min.js`, `frontend/qr-creator.min.js` — all self-hosted, force-committed via `git add -f`. DO NOT load from cdnjs.
- Status banner: `sessionStorage` dismiss. Status page `/status.html` — no nav entry.
- QR library: `qr-creator` (SVG output, self-hosted). DO NOT use `qrcodejs`.
- Drop zone: single file only. Multiple file drag rejected with explicit message. File inputs outside drop zone hit area, JS-triggered only.
- Folder upload via client-side zip (fflate, S53–S56). DO NOT implement multi-file manifest.
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit `frontend/share.css`, `frontend/share.js`, `frontend/upgrade.css` only (extracted S51).
- `share.js` must remain `type="module"` — scoped deps, top-level await support.

**Stripe:**
- Direct Subscription + `expand[0]=latest_invoice.payment_intent` → `pi_...` secret for `stripe.elements()`.
- Paid tier cards greyed out (soft launch). Re-enable only on explicit instruction from Rajesh at B7 close.

**Ops:**
- NUT-07 melt after first chunk write. Supabase failure: log and continue.
- Turnstile: fail-closed on any error.
- Rate limits (STATUS_KV): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s · `log_error` 20/60s · `download` 300/60s. All 429s logged to AE.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated to 8 chars, detail max 200 chars.
- Wrangler 4.113.0. ✓
- Download bearer token TTL = `manifest.expiry_timestamp`. DO NOT hardcode 900s. (Fixed S58.)

**Regulatory (UK):**
- Refueler cannot operate as an e-money issuer without FCA authorisation.
- Share mint issues access credentials only — capability tokens, not monetary instruments.
- Cashu in Share = anonymous authentication mechanism, not payment instrument.
- Whitepaper language drafted S42e (exact text in userMemories). Legal review required before any public claims.

**Payment flow (locked):**
- Lightning → Blink API (primary) → LNbits (Tier 2 on trigger)
- PayNym → Sparrow cold storage wallet, manual/semi-manual settlement
- Share mint → upload credentials only, zero monetary value, no e-money

**Mint architecture (locked):**
- Share mint in `refueler-share`. Loyalty mint in `refueler-mint`. Ticketing mint in future `refueler-tickets`. Test lab in `refueler-ecash-lab` — B8 planning task.
- Resilience: one mint down must not affect other products. All mints are capability/loyalty token issuers — none handle e-money.

**Folder upload (locked, complete S56):**
- Client-side zip via `fflate` before AES-GCM encrypt. Worker sees one blob — unchanged.
- `webkitdirectory` input or folder drag. Relative paths preserved in zip. Zip as-is delivery — receiver unzips natively.

**Marketing claim rulings (S42e — update again after B8, B9, B10):**
- ✅ Safe: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting; UUID-bound credential issuance; Turnstile nonce binding; anonymous transfer (no account, free tier).
- 🔒 Blocked: full Merkle tree verification; NUT-11 Mode 2; "audit-certified"; ML-KEM; any "end-to-end file integrity" without the server-side-chunks-only qualifier.
- 📅 Resolution: B8 → NUT-11 Mode 2 · B9 → whitepaper + Merkle · B10 → ML-KEM.

---

## Known broken / do not retry

| Pattern | Correct approach |
|---------|--------------------|
| `checkout/sessions ui_mode:embedded` | Direct Subscription + PaymentIntent expansion |
| `decodeURIComponent` on Stripe `client_secret` | Already decoded |
| `new Uint8Array([i])` for AES-GCM AAD | `DataView.setUint32(0, i, false)` into 4-byte buffer |
| AE SQL `doubles[N]` / `blob[N]` syntax | Named columns: `double1`, `blob1` etc. |
| AE SQL from Worker binding | External REST only, proxy via `/admin/ae-metrics` |
| KV counter for double-spend | Supabase table only (race condition) |
| `await env.AE.writeDataPoint()` | Synchronous, fire-and-forget |
| Sub-100ms loop to test KV rate limiter | Use `sleep 0.5` — KV eventual consistency |
| Customer Portal without active subscription | Stripe returns `resource_missing` |
| 4242 card in live mode | Test mode only |
| `await reportError(...)` | `.catch(() => {})` fire-and-forget |
| Full UUID in `/log/error` | First 8 chars only |
| Trust `X-Tier` upload header | Ignored — tier resolved from Supabase via `X-Email` |
| Apply MIME gate to chunks > 0 | Gate is chunk-0 only |
| URL shortener for share links | Privacy attack point; fragment key exposed to shortener |
| `if (rl)` to check rate limit | Use `if (rl.limited)` — `checkRateLimit` returns object |
| `getManifest()` direct from handlers | Use `safeGetManifest()` — enforces 64KB ceiling |
| Generate UUID client-side | Worker generates UUID at `/credential/issue` since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| Fail-closed on nonce KV error | Fail open — KV blip must not block legitimate uploads |
| Await nonce KV write | Fire-and-forget only |
| `renderTurnstile()` without `pendingTurnstileRender` flag | Causes double-render |
| `types: [...]` in showSaveFilePicker | Use `types: []` |
| Omit `total_chunks` from `/meta/` response | Must be included — FSAA loop bound |
| `TIER_EXPIRY_SECONDS.free` = 5 days | Canonical value is 7 days everywhere |
| `--display` as sole heading token | Declare both `--display` and `--heading` in shared-styles.njk |
| `classList.contains('carbon-mode')` for theme detection | Use `dataset.theme === 'carbon'` |
| Omit `{% include "shared-styles.njk" %}` from any Eleventy page | Required on every page |
| `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x | Bare `new Uint8Array(buf)` — default level-6 DEFLATE, macOS-compatible |
| Hardcode 900s TTL for download tokens | Pass `manifest.expiry_timestamp` as `expiresAt` |

---

## Current state

**B6 Testing infrastructure + folder upload — current. S62 (Worker unit tests III) next.**

| Session | Commit | Shipped |
|---------|--------|---------|
| S53 | `ca1260c` | Folder upload I. fflate 0.8.2. Drag+drop + picker. Zip progress card. Bare Uint8Array fix. ✓ |
| S54 | `c732abf` | Folder upload II. Depth limit (20). File count cap (2000). sanitisePath. Memory warning. fflate guard. |
| S55 | — | Folder upload III. Receiver UX: folder icon, zip-as-is, folder note. |
| S56 | `6cf711d`·`7735787` | fflate+qr self-hosted. Drop zone fix. Full folder round-trip ✓ |
| S57 | — | Bearer TTL investigation. 15-min exp fatal for large transfers. |
| S58 | `f94a158` | Bearer token TTL fix. Token lifetime = transfer expiry. |
| S60 | `e59305c` | Vitest 2 harness. ratelimit + manifest tests. 43 passing. |
| S61 | TBD | NUT-00 BDHKE + blake3 unit tests. 100 passing. blake3.js null-guard fix. |
---

## Roadmap

Core S19–S100 · Buffer S101–S120. Session count is a guide not a constraint.

| Block | Sessions | Scope |
|-------|----------|-------|
| B1–B4 ✓ | S1–S42e | Foundation through security hardening |
| B5 ✓ | S43–S52 | Design full pass |
| B6 | S53–S72+ | Testing infrastructure + folder upload ← current |
| B7 | S73–S87+ | Lightning/Blink + anonymous paid tier — 25 core + 5 buffer |
| B8 | S88–S96 | NUT-11 Mode 2 keypair auth (renumbered post-B7) |
| B9 | S97–S110 | LNbits fork + skin + node + LNURL-withdraw + whitepaper — 8 Lightning sessions + docs |
| B10 | S111–S118 | Enterprise + ML-KEM spike |
| B11 | S119–S126 | Week 0 alpha, load test, go/no-go |
| B12 | S127–S128 | Public beta launch |
| B13 | post-B12 | Go-to-market (brand, partnerships, non-traditional markets) |

Critical chains: S34→S42→S97 (integrity) · S18→S24→S75b (dashboard) · S60→S70→S119 (CI) · S73→S75 (anon paid tier) · S75→S80 (Lightning dashboard cards) · S84→S85→B9-Lightning (LNbits planning chain).

B3 gap deferred to B11: full cancel → webhook → Supabase loop needs a real live subscriber.

B7 Lightning sessions planned: S73→S87 (25 core + 5 buffer). B8 session numbers shift accordingly — renumber at B7 close.
B9 includes 8 dedicated Lightning sessions: LNbits fork/skin, webhook signing, own node setup, LNURL-withdraw credential delivery, privacy table update, whitepaper §Lightning.

---

## B6 notes

**Admin dashboard Lightning toggle (B6 scope):**
KV flag `lightning_available: true/false/blink`. Dashboard toggle card. Upgrade page reads flag.
Enables Fallback 1 + Fallback 2 without a code deploy, within target time windows.

---

## B6 open snags (resolve at S72)

- QR logo centre (Refueler mark in quiet zone) → B11 prep
- X-Email header wiring for paid tier enforcement → B7
- Receiver page nav: shows main domain links, should be share-subdomain only → B13
- Nav snag (Upgrade link on refueler.io) → B13
- Status tile for admin dashboard → S72 sweep

---

## B7 notes

**Session numbering convention (B7 onwards):**
Single-scope sessions use plain numbers (e.g. S78). Sessions that split due to complexity use
lettered suffixes starting from `a` (e.g. S73, S73a). Buffer sessions follow the same pattern
(e.g. S75c if S75b is consumed). Plain number is never skipped — S73 is always the first session
of that group, S73a is the second.

**Difficulty scaling rule (B7 onwards):**
S = 1 session. M = 2 sessions (e.g. S73, S73a). L = 3 sessions (e.g. S75, S75a, S75b).
Very L = 4 sessions. Split early rather than overrun.

**Rajesh pre-B7 checklist:**
1. Create Share Blink account (non-UK connection — Mullvad or VPN). Email `rt+share@rajeshtaylor.com`.
2. Generate `refueler-share-b7` API key — READ + RECEIVE scopes only.
3. Query BTC wallet ID: `curl -s -X POST https://api.blink.sv/graphql -H "X-API-KEY: YOUR_KEY" -H "Content-Type: application/json" -d '{"query":"{ me { defaultAccount { wallets { id walletCurrency } } } }"}' | jq .`
4. Register callback endpoint: `curl -s -X POST https://api.blink.sv/graphql -H "X-API-KEY: YOUR_KEY" -H "Content-Type: application/json" -d '{"query":"mutation { callbackEndpointAdd(input: { url: \"https://refueler-share.rt-fc4.workers.dev/webhook/lightning\" }) { id } }"}' | jq .`
5. Note endpoint ID from step 4 — needed at S73 start.
6. Make 2 GB test file: `dd if=/dev/urandom of=/tmp/testfile.bin bs=1m count=2048`
7. Read LNbits repo README before S84: `https://github.com/lnbits/lnbits`

---

## B7 open snags (resolve at S87)

- X-Email header wiring for paid tier enforcement (Lightning path uses credential not email — design at S75)
- PayNym column on payment privacy table — "coming soon" placeholder only at B7
- Own node stub cards (routing fee income, channel liquidity) — greyed until B9
- LNbits webhook signing cards (delivery rate, signature failures) — greyed until B9

---

## Tiers

| Tier | Cap | Expiry |
|------|-----|--------|
| Skint Tog (free) | 4 GB | 1 / 7 days |
| Creative Premium (£12/mo · £120/yr) | 100 GB | 1 / 7 / 30 days |
| Production Max (£24/mo · £240/yr) | 250 GB | 1 / 7 / 30 / 90 days |
| Enterprise | Unlimited | Custom |

Yearly = 10 months price.

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred B8 | NUT-11 Mode 2 (keypair challenge-response, Prod Max) |
| Deferred B10 | ML-KEM key wrapping |

---

## Worker endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/status` | public | Operational state from KV |
| POST | `/admin/status` | X-Admin-Key | Update KV state (inc. lightning_available flag) |
| GET | `/admin/metrics` | X-Admin-Key | Supabase aggregation |
| GET | `/admin/ae-metrics` | X-Admin-Key | AE SQL proxy |
| GET | `/admin/snapshot` | X-Admin-Key | 6-field combined snapshot |
| POST | `/credential/issue` | Turnstile | NUT-00 blind sig |
| PUT | `/upload/{uuid}/{chunk}` | Cashu credential | Chunked upload |
| POST | `/auth/{uuid}` | — | NUT-11 passphrase → download token |
| GET | `/download/{uuid}/{chunk}` | Bearer (if protected) | R2 chunk proxy |
| POST | `/webhook/stripe` | Stripe sig | Subscription lifecycle |
| POST | `/subscription/checkout` | — | Subscription + PaymentIntent |
| GET | `/subscription/status` | — | Tier by email |
| POST | `/subscription/portal` | — | Customer Portal session |
| POST | `/subscription/lightning` | — | Create BOLT11 invoice for tier purchase (B7) |
| POST | `/webhook/lightning` | — | Blink payment callback → credential issuance (B7) |
| GET | `/subscription/lightning/credential` | — | Poll for issued credential by paymentHash (B7) |
| POST | `/log/error` | — | Client error → AE (20/60s rate limited) |

---

## File map

```
refueler-share/
  CLAUDE.md  share-sessions.md  Share-Master-Context.md  LICENSE  README.md
  .eleventy.js   package.json   package-lock.json
  src/
    index.njk  upgrade.njk  status.njk
    _includes/  head.njk  nav.njk  footer.njk  shared-styles.njk
  frontend/                      ← Eleventy output (committed, Pages serves)
    index.html  upgrade.html  status.html
    share.css                    ← extracted from src/index.njk (S51)
    share.js                     ← extracted from src/index.njk (S51), type="module"
    upgrade.css                  ← extracted from src/upgrade.njk (S51)
    fflate.min.js                ← self-hosted (S56)
    qr-creator.min.js            ← self-hosted (S56)
    blake3/                      ← WASM bundle (force-committed, git add -f)
    admin/
      dashboard.html             ← self-contained, no build step
      dashboard.css              ← extracted S46a
      dashboard.js               ← extracted S46a
  worker/
    wrangler.toml                ← BUCKET + STATUS_KV + AE bindings
    package.json                 ← @noble/hashes@1.7.2, @noble/secp256k1@2.1.0
    blake3-wasm/                 ← compiled WASM + glue (force-committed)
    src/
      index.js  nut00.js  nut11.js  blake3.js  blake3_worker.js
      manifest.js  turnstile.js  stripe.js  ratelimit.js
      lightning.js                 ← Lightning backend abstraction (B7)
    src/_data/
      payment_privacy.json         ← Payment privacy table data (B7)
  docs/r2-lifecycle.md
```

---

*"Nothing stops this train."*
