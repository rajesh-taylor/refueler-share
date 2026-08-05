# Share-Master-Context — refueler-share
> **Version:** 5.4 | **Last updated:** S73a · 5 Aug 2026
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

**Account structure:** Separate Blink account for Share. Email `rt+share@rajeshtaylor.com`. API key `refueler-share-b7` — READ + RECEIVE scopes only. Wallet ID queried via `me { defaultAccount { wallets { id walletCurrency } } }`.

**Callback endpoint:** `https://refueler-share.rt-fc4.workers.dev/webhook/lightning`. No signing secret — Blink does not sign payloads. Verification via KV payment hash lookup. Blink fires twice per payment — Worker deduplicates via `settled: true` KV flag.

**Lightning payment flow (B7 — BOLT11 invoice model):**
1. Frontend → `POST /subscription/lightning` with `{ tier, period }`
2. Worker queries Blink `btcPrice` → live GBP/sats rate
3. Worker calls `lnInvoiceCreate` → BOLT11 + payment hash
4. Worker writes `{ paymentHash, tier, period, created_at, expires_at, settled: false }` to KV — 25h TTL
5. Frontend displays QR + BOLT11 copy. User pays from any Lightning wallet.
6. Blink fires callback → Worker verifies hash, issues Cashu credential, marks `settled: true`
7. Credential written to KV keyed by `paymentHash` — 10 min TTL. Browser memory only. No Supabase row.
8. Frontend polls `GET /subscription/lightning/credential?hash={paymentHash}`.

**Backend abstraction:** `worker/src/lightning.js` exports `createInvoice()` + `getInvoiceStatus()`. `LIGHTNING_BACKEND` env var (default: `blink`). LNbits slots in via env var swap + new secret.

**Migration trigger to LNbits (Tier 2):** 2 of 3: >100 paid Lightning accounts · >£2k/mo Lightning volume · Blink reliability <99.5%.

**Fallbacks:** KV flag `lightning_available: true/false/blink`. Fallback 1 (LNbits down): revert to Blink, 4h target. Fallback 2 (both down): Lightning hidden on upgrade page, Stripe fiat fully operational. Both via dashboard toggle, no code deploy.

**Privacy model:** Stripe payer = name/email/card visible to Refueler. Lightning payer = payment hash + amount + tier only. Blink internal correlation documented on upgrade page. DO NOT claim "anonymous" for Lightning. Honest claim: "Pseudonymous."

**Payment privacy table:** `src/_data/payment_privacy.json`. Three columns: Stripe / Lightning (Blink) / PayNym (coming soon). Also appears verbatim in B9 whitepaper §Privacy model.

**Own node (B9 scope):** Hetzner CX22, separate from personal + refueler.io nodes. Graph isolation. Stub dashboard cards (routing fee income, channel liquidity health) greyed until B9.

**LNURL-withdraw (B9 scope):** Cashu credential encoded as LNURL-withdraw. Gift use case: sender purchases capacity, forwards link to recipient. Wallet redeems. Refueler never knows who used it. NUT-20 binding potential. World-first for file transfer.

**LNbits fork (B9 scope):** Strip consumer UI, apply Paper/Carbon tokens, add webhook signing (HMAC-SHA256). B9 planning session required before touching repo.

**Dashboard cards — Lightning (B7):** Confirmation latency p95 LIVE. Webhook delivery rate / signature failures / routing fee income / channel liquidity health — STUB greyed (B9).

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

No discounts. No yearly savings framing. Price is the price.

| Product | Price ID | Lookup key | Amount |
|---------|----------|------------|--------|
| Creative Premium monthly | `price_1Ts7lsGlctwiB9U3hdtgChU2` | `share-creative-monthly` | £12/mo |
| Creative Premium 3-month | `price_1TyzF4GlctwiB9U3Zo0fG8Ic` | `share-creative-3month` | £36/3mo |
| Creative Premium yearly | `price_1TyzKIGlctwiB9U3Dn71fGbA` | `share-creative-yearly` | £144/yr |
| Production Max monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo |
| Production Max 3-month | `price_1TyzMLGlctwiB9U3cA31BOQc` | `share-max-3month` | £72/3mo |
| Production Max yearly | `price_1TyzNaGlctwiB9U3T8uV4UIW` | `share-max-yearly` | £288/yr |

Archived (do not use): `price_1Ts7sqGlctwiB9U3YRloCFfi` (Creative £120/yr), `price_1Ts7xIGlctwiB9U3JyZB8Kwj` (Max £240/yr)

Business tier: invoiced manually via Stripe invoice template. No subscription price object. Off-repo.

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe`
Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://share.refueler.io/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: local WASM at `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. Server verifies every chunk — 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only (`crypto.subtle.digest`). Stored in manifest as `p2sh_secret_hash`. Argon2id KDF replaces this for Enterprise API tier post-B8.
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
- `src/_includes/head.njk` theme script: `localStorage`/`rfTheme` replaced with `rs-theme` cookie scoped to `.refueler.io` (30-day rolling, `SameSite=Lax`). `dataset.theme` attribute only — `[data-theme="carbon"]` CSS selector. `window.toggleTheme` exposed as global for nav pill `onclick`. Cross-domain theme persistence confirmed working (AP-8).
- `src/_includes/nav.njk` link set (AP-8): Notes (`refueler.io/notes/`), Upgrade (`/upgrade.html`), Support (`refueler.io/support/`), theme pill. App / Editorial / Privacy links removed. Legend deliberately omitted (not fully live). Wordmark stays `REFUELER / SHARE`.

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
- Share mint issues access credentials only — capability tokens, not monetary instruments. FCA authorisation not required.
- Cashu in Share = anonymous authentication mechanism, not payment instrument.
- UK GDPR Article 33: 72hr ICO notification for personal data breaches. Share's architecture minimises exposure — free tier holds no identity data; encrypted noise only at rest.

**Marketing / outreach:**
- No social media presence. refueler.io is the canonical destination for all outreach. Clients visit the site; Share does not go to them. This is by design and consistent with the product's values.

**Marketing claim rulings (S42e — update again after B8, B9, B10):**
- ✅ Safe: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting; UUID-bound credential issuance; Turnstile nonce binding; anonymous transfer (no account, free tier).
- 🔒 Blocked: full Merkle tree verification; NUT-11 Mode 2; "audit-certified"; ML-KEM; any "end-to-end file integrity" without the server-side-chunks-only qualifier.
- 📅 Resolution: B8 → NUT-11 Mode 2 · B9 → whitepaper + Merkle · B10 → ML-KEM.

---

## Known broken / do not retry

| Pattern | Correct approach |
|---------|------------------|
| `checkout/sessions ui_mode:embedded` | Direct Subscription + PaymentIntent expansion |
| `new Uint8Array([i])` for AES-GCM AAD | `DataView.setUint32(0, i, false)` into 4-byte buffer |
| AE SQL `doubles[N]` / `blob[N]` syntax | Named columns: `double1`, `blob1` etc. |
| AE SQL from Worker binding | External REST only, proxy via `/admin/ae-metrics` |
| KV counter for double-spend | Supabase table only (race condition) |
| `await env.AE.writeDataPoint()` | Synchronous, fire-and-forget |
| Customer Portal without active subscription | Stripe returns `resource_missing` |
| `await reportError(...)` | `.catch(() => {})` fire-and-forget |
| `if (rl)` to check rate limit | Use `if (rl.limited)` — `checkRateLimit` returns object |
| `getManifest()` direct from handlers | Use `safeGetManifest()` — enforces 64KB ceiling |
| Generate UUID client-side | Worker generates UUID at `/credential/issue` since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| `classList.contains('carbon-mode')` for theme detection | Use `dataset.theme === 'carbon'` |
| Omit `{% include "shared-styles.njk" %}` from any Eleventy page | Required on every page |
| `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x | Bare `new Uint8Array(buf)` — default level-6 DEFLATE, macOS-compatible |
| Hardcode 900s TTL for download tokens | Pass `manifest.expiry_timestamp` as `expiresAt` |
| `client.putManifest()` in integration tests | No Worker route exists — manifest written automatically after final chunk |
| `X-P2SH-Secret-Hash` in separate manifest PUT | Must be sent as chunk 0 upload header |
| Dummy blinded message in `issueCredential` test helper | Must do real BDHKE unblinding (`C_ - r*K`) or `verifyCredential` returns 401 |
| Supabase mock started in test file | Lifecycle owns it — must start before wrangler so URL lands in `.dev.vars` |
| `ProjectivePoint.subtract()` in noble v2 | Use `.add(point.negate())` |
| `localStorage` / `rfTheme` for theme in `head.njk` | `rs-theme` cookie scoped to `.refueler.io`, `dataset.theme` only (AP-8) |
| `classList.add('carbon-mode')` in theme script | `document.documentElement.dataset.theme = 'carbon'` (AP-8) |
| Cloudflare Queues / Durable Objects / D1 for webhooks | `ctx.waitUntil` + KV dead-letter only |
| Sub-keys per API user (Business tier) | One keypair per commercial relationship + `transfer_ref` attribution |
| Never edit `frontend/upgrade.html` directly | Eleventy overwrites it from `src/upgrade.njk` on every build |

---

## Current state

**B7 in progress — S73a complete. S74 next (Lightning infra I-a).**

| Block | Commit | Summary |
|-------|--------|---------|
| B1–B5 ✓ | — | Foundation → security hardening → design full pass (S1–S52) |
| B6 ✓ | `319225f` | 212 tests passing · 0 skipped · 8 suites. Folder upload, k6 load tests (all green), CI Level 1, Lightning admin toggle, Stripe webhook security suite. |
| B7 in progress | `a19778c` | S73/S73a: client errors modal — UA parsing, detail table, provenance note, layout fix. |

**Test count: 212 passing · 0 skipped across 8 suites (6 unit + 2 integration).**

---

## Roadmap

Core S19–S100 · Buffer S101–S120. Session count is a guide not a constraint.

| Block | Sessions | Scope |
|-------|----------|-------|
| B1–B4 ✓ | S1–S42e | Foundation through security hardening |
| B5 ✓ | S43–S52 | Design full pass |
| B6 ✓ | S53–S72a | Testing infrastructure + folder upload |
| B7 | S73–S87+ | Lightning/Blink + anonymous paid tier — 25 core + 5 buffer |
| SW | SW1–SW9+ | White-label + API build — 12 core + 2 buffer · runs post-S87 |
| R-series | RU1–RU2+ | Resumable uploads — IndexedDB state persistence — 2 core + 2 buffer · runs post-SW |
| HQ-series | HQ1–HQ2+ | HTTP/3 + BLAKE3 integrity positioning — 2 core + 2 buffer · runs post-R-series |
| B8 | TBD | NUT-11 Mode 2 keypair auth (renumbered post-SW) |
| B9 | TBD | LNbits fork + node + LNURL-withdraw + whitepaper + staging + incident response plan |
| B10 | TBD | Enterprise + ML-KEM + chaos tests + contract tests |
| B11 | TBD | Alpha + load test + CI Level 3 + dashboard test card |
| B12 | TBD | Public beta launch + FROST threshold signatures (planning) |
| B13 | post-B12 | Go-to-market (brand, partnerships, non-traditional markets) |

Critical chains: S34→S42→S97 (integrity) · S18→S24→S75b (dashboard) · S60→S70→S119 (CI) · S73→S75 (anon paid tier) · S75→S80 (Lightning dashboard cards) · S84→S85→B9-Lightning (LNbits planning chain) · SW2→SW4 (API auth → webhooks) · SW3→SW5 (badge → client dashboard) · SW9→RU1→RU2 (resumable uploads) · RU2→HQ1→HQ2 (HTTP/3 + BLAKE3 positioning).

---

## B6 carried snags

- QR logo centre (Refueler mark in quiet zone) → B11
- Receiver page nav (shows main domain links) → B13
- Nav snag (Upgrade link on refueler.io) → B13
- Status tile for admin dashboard → B7 buffer (S87 sweep)
- Manifest-field minimalism audit (M-02 Blossom benchmark) → B9 whitepaper prep
- UUID/fragment token entropy pre-audit (birthday-paradox, Proton INFO-004 precedent) → B9
- REFUELER-BRIDGE.md: commit to `refueler-io` when /notes/ session opens that repo
- First-transfer experience aesthetic (Jaeger-LeCoultre restraint, Source Serif 4, ceremonial link presentation, haptics, A/B tests) — copy preparation in ad-hoc sessions; build scope B13a
- Pay-to-extend transfer window design — design document due B8. Framing locked: **"Purchase a recovery window"** — never "pay to extend." Use case: recipient (or sender) purchases additional download time without contacting the other party, preserving the professional relationship. Self-purchase scenario: junior partner extends window on firm's business account without interrupting senior partner or client. **Privacy properties (locked AP-7):** (1) Refueler cannot correlate the extension payment with the original upload — server is blind to who is extending and why; (2) Lightning payment preserves pseudonymity of the purchasing party; (3) original sender's anonymity is structurally unchanged. **Publication restriction (locked AP-7):** mention in B9 whitepaper §Future work only — no public product copy or marketing before the feature ships. Shipping first prevents misreading as punitive artificial-scarcity monetisation and prevents storing competitors implementing a degraded version and poisoning the framing. Tone in all copy when it ships: discreet, convenient, professional — not punitive. Do not build before design locked at B8.
- Context file archive strategy — implement at S87: split `Share-Master-Context.md` into working memory (≤350 lines, current + next block only) and new `Share-Archive.md` (compacted block summaries B1–B6, one paragraph per block, key commit hashes, permanent do-not-retry items not already in CLAUDE.md). `Share-Archive.md` lives in repo root, never loaded by default — attach to Project only if historical question arises.

---

## B7 notes

**Session numbering convention (B7 onwards):**
Single-scope sessions use plain numbers (e.g. S78). Sessions that split due to complexity use
lettered suffixes starting from `a` (e.g. S73, S73a). Plain number is never skipped.

**Difficulty scaling rule:** S = 1 session. M = 2. L = 3. Split early rather than overrun.

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

- PayNym column on payment privacy table — "coming soon" placeholder only at B7
- Own node stub cards (routing fee income, channel liquidity) — greyed until B9
- LNbits webhook signing cards (delivery rate, signature failures) — greyed until B9
- Renewal warning banner: 7-day pre-expiry notice on upgrade page for all paid tiers (Stripe + Lightning). SessionStorage-dismiss. Copy: *"Your subscription renews on [date]. Your transfers will remain accessible."* Build in same session as API credential renewal work.
- Theme toggle absent from modals — minor UX, add at S87 snag sweep
- `receiver_ab_shown` / `receiver_ab_downloaded` events routing to `/log/error` instead of AE — S47c A/B tracking code calling `reportError()` in error. Investigate `frontend/share.js` at S87.

---

## Post-B8 agenda (locked AP-4)

**Argon2id for Enterprise API passphrase-protected transfers:**
- Client-side KDF only. WASM bundle ~200KB, one-time page load, not per-chunk.
- Worker never sees raw passphrase — only the Argon2id-derived 32-byte key.
- Parameters: `m=65536`, `t=3`, `p=4` (OWASP minimum). ~300ms browser-side, imperceptible to user.
- Positioned as security feature to enterprise clients, not a caveat.
- Free tier review only if competitors force the issue.
- After B8 NUT-11 Mode 2 work is live: propose Argon2id as NUT-11 Mode 1 KDF extension via Cashu GitHub. Would replace SHA-256 in the P2SH secret hash path. Precedent: BIP-38 uses scrypt for the same purpose. Framing: "NUT-11 Mode 1 with optional KDF hardening for high-value secrets."

**ML-KEM (post-quantum key wrapping):**
- Ship Production Max and Enterprise tiers first. Free tier deferred until paid tier stable.
- Positioned as progression path — customers buy up into post-quantum security.
- B10 scope.

**BIP-85 for enterprise user management:**
- Enterprise admin generates master seed (BIP-39, 12-word phrase, confirmed on account creation).
- BIP-85 derives child signing keys per staff member from master.
- Admin can revoke/rotate individual child keys without affecting others.
- Server only verifies signatures — key hierarchy entirely client-owned.
- Staff offboarding: rotate child key derivation path, issue new `rfs_live_` against new child public key.
- Build scope: SW or B8 — confirm at SW close.

**Nostr keypair auth for dashboard (paid + enterprise):**
- secp256k1 challenge-response. No password, no email loop, no OAuth third-party dependency.
- Admin signs staff public keys into allowlist. BIP-85 derives staff Nostr keys from master seed.
- Team usage dashboard: per-user upload history, quota remaining, aggregated from KV.
- Creatives and Bitcoin-native users will already have Nostr keys.
- Notes article 12 reframed around this as "API technical integration guide."

---

## B9 scope additions (AP-4)

**Incident response plan and breach register:**
Full playbook in `docs/incident-response.md`. Breach log in `docs/security-breach.md`.
Both created AP-5. Build scope B9 — implement status page incident dashboard panel, `incident_active`
KV schema extension, homepage status widget, and tabletop simulation before alpha.
Key architectural point: R2 breach exposes ciphertext only (key never held). Supabase breach
triggers UK GDPR Article 33 (72hr ICO notification). Free tier: no personal data held, no
notification obligation, positive architectural narrative. Run tabletop simulation
(scenario documented in `docs/incident-response.md` §8) before first customer.

**SimpleX Chat:**
- Self-hosted SMP server on Hetzner alongside Lightning node (B9+).
- Internal Share team comms on infrastructure we control.
- Enterprise clients: dedicated SimpleX group per client as private support/incident channel.
- API too immature for dashboard embedding — revisit post-B12.
- Position as optional enhanced security channel, not mandatory.

---

## Future work (whitepaper §Future work + B12+)

**FROST threshold signatures (B12):**
- Require M-of-N co-signatories to authorise credential issuance before a transfer can proceed.
- Use cases: law firm partner sign-off before junior uploads client documents; music masters delivery requiring producer + manager + label co-authorisation; film/VFX delivery requiring director + supervisor sign-off.
- Framing: cryptographic chain of custody built into the transfer itself — not bolted on via a third-party witness service.
- Competitive displacement: DocuSign eSignature Business ~£200–£300/user/year. FROST-based approach is architecturally superior — no central attestation to subpoena, breach, or compel.
- Mention in B9 whitepaper §Future work. Build scope B12.

**Recovery window ("Purchase a recovery window") — also B9 whitepaper §Future work only:**
- See B6 carried snags for full framing, privacy properties, and publication restriction.
- Only public mention permitted before shipping: B9 whitepaper §Future work. No product copy, no upgrade page, no marketing.

**Silent Payments (BIP-352) — replaces PayNym/BIP-47:**
- Static payment address, unique on-chain output per sender. No interaction transaction required.
- Requires continuous blockchain scanning node — B9 infrastructure dependency.
- Long-term direction: Silent Payments over PayNym. PayNym column on upgrade page remains placeholder until B9 node is live.

**refueler-multi-core (blockchain scanning):**
- Fork Esplora (Blockstream, MIT) or Mempool.space (MIT) for Bitcoin blockchain scanning.
- Use case: Silent Payments scanning for Enterprise clients; internal infrastructure for Share's own on-chain payment rails.
- Prerequisite: Lightning node live at B9. Do not start before B9 operational.

---

## SW block notes — white-label + API (locked AP-3a)

**Block principle:** runs immediately after S87 (B7 close). No code before SW1.

**SW session plan:**

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| SW1 | CF for SaaS setup | SaaS enablement, fallback origin, Worker route. Smoke: `GET /status` via wl hostname. | S |
| SW2 | API auth I | `worker/src/api_auth.js` — HMAC-SHA256 verify, key lookup, ±300s window. Unit tests. | M |
| SW2a | API auth II | `POST /api/v1/credential/issue` + quota KV, 402 on exhaustion, AE `transfer_ref` logging. Rotation with 24h grace. | M |
| SW3 | Badge + /wl/config | `GET /wl/config` by Host header, fail-safe `badge: true`. Badge component Paper/Carbon. | S |
| SW4 | Webhooks I | Registration endpoints, `rfs_whsec_` issuance, `wh_config_` KV schema, URL validation. | M |
| SW4a | Webhooks II | Delivery via `ctx.waitUntil`. Dead-letter KV (7-day TTL). AE log per attempt. Daily cron retry. | M |
| SW5 | Client dashboard I | `dashboard.share.refueler.io` scaffold. API-key auth. Transfers table from AE. | M |
| SW5a | Client dashboard II | Capability gating. Webhook monitoring card. Hostname health card. Paper/Carbon. | M |
| SW6 | Onboarding flow | Per-client admin runbook. CF custom-hostname → keypair → KV write → activation smoke test. | S |
| SW7 | IT handover PDF | Two-page branded PDF. Paper theme. Three substitution fields. Built once, generated per client. | S |
| SW8 | Daily cron | Hostname health checks → AE. Dead-letter webhook retry. `[triggers]` in wrangler.toml. | S |
| SW9 | SW close | Snag sweep. TESTING.md additions. Context trim pass. B8 brief. Buffer review. | S |

**Buffer:** SW2b (auth overrun), SW5b (dashboard overrun).

**KV key prefixes introduced at SW:**
- `wl_config_{hostname}` — `{ api_key_id, badge, client_label, status }`
- `wh_config_{api_key_id}` — array of `{ webhook_id, url, events[], created_at }`
- `wh_dead_{api_key_id}_{event_id}` — dead-letter payload, 7-day TTL
- `api_quota_{key_id}` — `{ credentials_remaining, bytes_remaining, period_end }`
- `incident_active` — `{ severity, declared_at, updated_at, summary, actions, next_update }` · null = no active incident (B9)

**Webhook spec (locked AP-3a):** 4 events: `credential.issued`, `transfer.completed`, `quota.threshold`, `quota.exhausted`. Signing: `X-Refueler-Signature: t={unix},v1={hex}` — HMAC-SHA256 over `{t}.{raw_body}`. Replay window ±300s.

---

## Competitive intelligence — M-series (outside repo)

**Key locked findings — do not contradict in any copy:**
- Anonymity spectrum: WeTransfer/Smash/SwissTransfer → Tresorit/Proton → Wormhole → **Refueler Share** → OnionShare.
- DO NOT claim "no competitor offers anonymous payment" — Proton accepts on-chain Bitcoin and cash by post.
- Positioning: "professional-grade anonymity where only one side needs to be sophisticated."
- Core framing: "the server is blind and so is the till."
- "Pseudonymous is not unlinkable" — the Berlin line.

**Two-axis category framing (locked AP-7):**
Refueler Share is the only architecture that solves both of these simultaneously:
1. **The recipient problem:** the transfer survives the sender closing their laptop; it survives the recipient being on a plane. Every synchronous P2P tool (DashBeam, Wormhole) fails this by design.
2. **The compulsion problem:** there is nothing to hand over — not because we'd refuse, but because we never had it. Every storing service with server-side keys fails this by design.

This two-axis framing is the category definition and the spine of article 5's four-quadrant table. It is also the strongest candidate for the index page hero. Do not conflate with the one-line positioning ("only one side needs to be sophisticated") — they are complementary, not substitutes.

**DashBeam (dashbeam.net) — assessed AP-6, 2 Aug 2026:**
- Synchronous P2P (both parties must be online simultaneously). QUIC via Iroh framework. Unlimited free tier. Resumable transfers. Open source. No B2B intent. Anonymity = IP-to-IP direct handshakes (both IPs visible to each other and relay).
- **Not a threat to professional buyer segment.** Asynchronous delivery is a structural advantage.
- **One genuine gap confirmed:** resumable uploads. Addressed by R-series post-SW.
- **HTTP/3 positioning:** "Transfers run over HTTP/3 on Cloudflare's global edge network with per-chunk BLAKE3 integrity verification." TLS/QUIC proves the channel; BLAKE3 proves the content. Addressed by HQ-series post-R-series.
- Do not name DashBeam in any public copy — positioning by architecture, not by competitor name.

**OEM positioning paragraph (Berlin, verbatim — locked AP-3a):**
> "Some companies want to offer encrypted file delivery inside their own product, under their own name — and that's a conversation I'm genuinely happy to have. What you'd be taking on isn't a widget, it's the architecture: blind-signature credentials, client-side encryption, and a server that only ever stores noise — so it can't be compelled to hand over anything it never saw. Your users get transfers even we can't read, and you get to make that promise honestly, because it's structural, not a line in a privacy policy. It's not a tier on a pricing page — every integration is scoped with me directly, because embedding this properly depends on what your product already promises its users. If that's interesting, email support@refueler.io — it comes straight to me — and tell me what you'd want your users to be able to do. I'd rather have that conversation than hand you a feature list."

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred B8 | NUT-11 Mode 2 (keypair challenge-response, Prod Max) |
| Post-B8 proposal | Argon2id as NUT-11 Mode 1 KDF extension (Cashu GitHub discussion) |
| Deferred B10 | ML-KEM key wrapping |

---

## Worker endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/status` | public | Operational state from KV |
| POST | `/admin/status` | X-Admin-Key | Update KV state (inc. lightning_available + incident_active flags) |
| GET | `/admin/metrics` | X-Admin-Key | Supabase aggregation |
| GET | `/admin/ae-metrics` | X-Admin-Key | AE SQL proxy |
| GET | `/admin/snapshot` | X-Admin-Key | 6-field combined snapshot |
| POST | `/credential/issue` | Turnstile | NUT-00 blind sig (consumer path) |
| PUT | `/upload/{uuid}/{chunk}` | Cashu credential | Chunked upload |
| POST | `/auth/{uuid}` | — | NUT-11 passphrase → download token |
| GET | `/download/{uuid}/{chunk}` | Bearer (if protected) | R2 chunk proxy |
| POST | `/webhook/stripe` | Stripe sig | Subscription lifecycle |
| POST | `/subscription/checkout` | — | Subscription + PaymentIntent |
| GET | `/subscription/status` | — | Tier by email |
| POST | `/subscription/portal` | — | Customer Portal session |
| GET | `/subscription/credential` | — | Re-issue credential on demand (Stripe path) |
| POST | `/subscription/lightning` | — | Create BOLT11 invoice for tier purchase (B7) |
| POST | `/webhook/lightning` | — | Blink payment callback → credential issuance (B7) |
| GET | `/subscription/lightning/credential` | — | Poll for issued credential by paymentHash (B7) |
| POST | `/log/error` | — | Client error → AE (20/60s rate limited) |
| GET | `/wl/config` | — | Badge config by Host header, Cache-Control max-age=3600 (SW3) |
| POST | `/api/v1/credential/issue` | HMAC (rfs_live_ + rfs_sign_) | Issue credential on behalf of end user (SW2a) |
| POST | `/api/v1/keys/rotate` | HMAC | Rotate API keypair, 24h grace (SW2a) |
| GET | `/api/v1/transfers` | HMAC | AE-backed transfer list, transfer_ref filter (SW5) |
| POST | `/api/v1/webhooks` | HMAC | Register webhook endpoint (SW4) |
| GET | `/api/v1/webhooks` | HMAC | List webhook endpoints (SW4) |
| DELETE | `/api/v1/webhooks/{id}` | HMAC | Remove webhook endpoint (SW4) |
| — | Scheduled cron | — | Hostname health checks + dead-letter retry (SW8) |

---

## Testing infrastructure

Canonical reference: `TESTING.md` (repo root). Load for any testing session.

| Layer | Tool | Status |
|-------|------|--------|
| Unit tests | Vitest 2 | 212 passing · 0 skipped · 8 suites |
| Integration tests | Vitest + wrangler dev --local | 212 passing / 0 skipped. All 5 seams closed. |
| Security regression suite | Vitest integration | Complete. MIME, UUID, chunk bounds, tier cap, rate limits, credential farming, nonce binding. |
| Load tests | k6 | ✅ S68–S69. All four scripts passing. Local workerd thresholds. Tighten to <150ms at B9 staging. |
| CI pipeline | GitHub Actions | Level 1 live and green (S70–S72). Level 2 (integration suite in CI) — B7–B8. |
| Dashboard emission | JSON reporter → KV → dashboard card | B10–B11 scope |
| Staging environment | refueler-share-staging Worker | B9 scope |

---

## /notes/ article pipeline — refueler.io

All articles live on `refueler.io/notes/` (main domain). Source Serif 4 body, IBM Plex Mono for data/tables.
No social media distribution. refueler.io is the canonical destination.
**Full editorial detail:** see `notes-articles-list.md` in repo root.

| # | Title (short) | Publish order | Dependency | Status |
|---|--------------|---------------|------------|--------|
| 1 | Subpoena table | 1st | None | Live — iteration ready from week of 5 Aug |
| 2 | Client files / inbox | 2nd | None | Planned — structure locked AP-1 |
| 3 | Metadata value | 3rd | None | Planned — structure locked AP-1 |
| 4 | Blind vs secure server | 4th | None | Planned — structure locked AP-1 |
| 5 | Jurisdiction vs architecture | 5th | None | Planned — structure locked AP-1 |
| 6 | Anonymous payment option | After B7 live | B7 Lightning | Planned |
| 7 | Journalists and file transfer | Flexible | Susie intro first | Planned |
| 8 | PI insurer risk | After SW complete | SW block | Planned — highest B2B value |
| 9 | After the link expires | Anytime | None | Planned |
| 10 | Case study (video editor) | Last | Real user + history | Planned |
| 11 | API / white-label notes | After SW complete | SW block | Planned |
| 12 | API technical integration / Nostr auth | After SW complete | SW block | Planned |

**Key contacts:**
- Susie, Bitcoin Policy UK — article 7 / journalist angle. Approach after article 2 is live.
- BHODL co-founder (lawyer + Bitcoiner) — article 2 feedback reader, potential case study subject.

---

## API / white-label — architecture locked (AP-2 + AP-3a)

**Auth:** HMAC-SHA256 over `method + path + timestamp + body_hash`. Three credentials per relationship: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, Business only, shown once).

**Credential issuance:** `POST /api/v1/credential/issue`. Request: `{ tier, transfer_ref, expiry_hours }`. `transfer_ref` logged to AE as `blob1`, never Supabase, opaque to Refueler. Returns `{ uuid, credential, upload_url_base }`. Quota in KV `api_quota_{key_id}`. 402 on exhaustion.

**Stripe decoupling:** `subscribers` = billing ledger only, never queried on upload path. Credential issued at webhook receipt, collected via `GET /subscription/credential`. `X-Email` dropped. Renewal: credentials stack, 7-day warning banner (sessionStorage-dismiss).

**Five-tier structure (pricing off-repo):**

| Tier | Cap | Expiry | Billing |
|------|-----|--------|---------|
| Free | 4 GB | 1 / 7 days | — |
| Creative Premium | 100 GB | 1 / 7 / 30 days | Monthly / 3-month / yearly |
| Production Max | 250 GB + API (100 creds + 250 GB quota) | 1 / 7 / 30 / 90 days | Monthly / 3-month / yearly |
| Business | 2 TB/mo · 1,000 credentials | 1 / 7 / 30 / 90 days | Invoiced (annual minimum) |
| Enterprise | Custom · 5 TB/mo included · Argon2id KDF · BIP-85 key mgmt | Custom | Annual contract |

No discounts. No savings framing. Prepay cadences are convenience, not a deal.

**Badge:** "Powered by Refueler Share" — Production Max API only. Removed at Business+. Fail-safe: no KV record → `badge: true`.

**Custom hostname:** CF for SaaS. Client CNAME → `wl.share.refueler.io`. Existing Worker. No new Worker.

---

*"Nothing stops this train."*
