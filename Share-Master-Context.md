# Share-Master-Context — refueler-share
> **Version:** 7.6 | **Last updated:** SW4-Opus · 8 Sep 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` (canonical `refueler-share/frontend/`, mirror `refueler-io/src/share/assets/`) · Local: `/Users/rajeshtaylor/Documents/refueler.io` |
| Subdomain | `refueler.io/share/` → `refueler-io.pages.dev` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser local bundle + Worker WASM), secp256k1 (@noble v2) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | LNbits on Hetzner CAX21 (B7+) — `LNBITS_API_KEY` / `LNBITS_URL` |

---

## Supabase

Project: `tihgvdokeofnjxjkenmm`

| Table | Key columns | Notes |
|-------|-------------|-------|
| `spent_tokens` | `serial TEXT PK`, `melted_at TIMESTAMPTZ` | RLS deny-all |
| `subscribers` | `stripe_customer_id TEXT PK`, `email`, `tier`, `status`, `current_period_end`, `cancelled_at` | RLS deny-all · index on email |
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
| Pages | `refueler.io/share/` → `refueler-io.pages.dev` |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Managed widget (visible only) |

Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD),
`STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`,
`CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).
`WEBHOOK_SIGNING_MASTER_KEY` (SW4a, stateless webhook signing master).
`WEBHOOK_SIGNING_MASTER_KEY` set (SW4a). Do not rotate without cause — rotation requires fleet-wide client re-registration.

---

## Stripe — live mode

| Product | Price ID | Lookup key | Amount | Status |
|---------|----------|------------|--------|--------|
| Sovereign monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo | ✅ Active |
| Sovereign 3-month | `price_1TyzMLGlctwiB9U3cA31BOQc` | `share-max-3month` | £72/3mo | ✅ Active |
| Sovereign yearly | `price_1TyzNaGlctwiB9U3T8uV4UIW` | `share-max-yearly` | £288/yr | ✅ Active |

**Tier rename complete S90:** Citizen (free). Sovereign (paid, two rails). Creative Premium archived. Product ID: `prod_Urre2e3PQgr5Uq`.

Archived: `price_1Ts7sqGlctwiB9U3YRloCFfi` · `price_1Ts7xIGlctwiB9U3JyZB8Kwj` · `price_1Ts7lsGlctwiB9U3hdtgChU2` · `price_1TyzF4GlctwiB9U3Zo0fG8Ic` · `price_1TyzKIGlctwiB9U3Dn71fGbA` (Creative Premium)

**API tier:** invoiced manually via Stripe invoice template. No subscription price object — off-repo, managed manually.

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://refueler.io/share/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Lightning infrastructure (B7)

**Provider: LNbits on Hetzner CAX21. Locked pre-Opus-2.** Blink dead (UK custodial discontinued Aug 31 2026). Voltage eliminated (US company, invoice metadata). Strike eliminated (custodial).

**Stack on Instance A (Share+Pass):** phoenixd (ACINQ, no bitcoind required) → LNbits (wallets: Share, Pass, Ops) → cloudflared tunnel (Worker→LNbits, no inbound ports) → Tor (per-service .onion for LNbits admin + phoenixd transport).

**Liquidation:** phoenixd splice-out → standard bech32 in Sparrow Wallet. Sweep when balance exceeds ops reserve. Payjoin v2 recommended on sweep (Sparrow native).

**Phoenixd → LND trigger (locked):** ≥£10k/mo Lightning receipts sustained 3 consecutive months AND named operator committed OR ACINQ discontinues phoenixd.

**Payment flow (B7):**
1. Frontend → `POST /subscription/lightning` with `{ tier, period }`
2. Worker → LNbits `POST /api/v1/payments` → BOLT11 + payment hash
3. KV write: `{ paymentHash, tier, period, created_at, expires_at, settled: false }` — 25h TTL
4. Frontend: QR + BOLT11 copy. User pays any Lightning wallet.
5. LNbits webhook → Worker KV lookup → **authenticated GET re-verify** `paid: true` → Cashu credential → `settled: true`
6. Credential in KV (10 min TTL) + browser memory only. No Supabase row.
7. Frontend polls `GET /subscription/lightning/credential?hash={paymentHash}`

**Webhook:** LNbits does NOT HMAC-sign callbacks — treat as notification, re-verify via authenticated GET. Dedup via `settled: true` KV flag.

**Fallback:** `lightning_available` KV flag. Dashboard toggle → Stripe fully operational while re-provisioning.

**Privacy model:** Lightning payer = payment hash + amount + tier only — no identity at any layer. Honest claim: "pseudonymous." DO NOT claim "anonymous." Silent Drop subscription payments further decouple payment from cargo.

**DO NOT add a Supabase row or email field to the Lightning credential path** — load-bearing for Silent Drop and for the anonymous API rail.

---

## Locked architecture decisions

**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only. Stored as `p2sh_secret_hash` in manifest.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`.

**Storage:** R2 binding `BUCKET`. KV binding `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`. `safeGetManifest()` enforces 64 KB ceiling.

**Frontend:**
- Credentials in browser memory only — never localStorage, never sessionStorage.
- `frontend/blake3/`, `frontend/fflate.min.js`, `frontend/qr-creator.min.js` — self-hosted, force-committed.
- QR library: `qr-creator` (SVG, self-hosted). DO NOT use `qrcodejs`.
- Folder upload via streaming `fflate.Zip` (S53/RU0). Never `fflate.zip()` (buffered — OOM).
- `share.js` must remain `type="module"`.
- Theme: `rs-theme` cookie scoped to `.refueler.io` (30-day, SameSite=Lax). `dataset.theme` attribute only. `window.toggleTheme` global for nav pill.

**Ops:**
- Rate limits (STATUS_KV): `credential_issue` 10/60s · `upload` 120/60s · `auth` 5/60s · `log_error` 20/60s · `download` 300/60s.
- `/log/error`: always 200, fire-and-forget AE write, UUID truncated 8 chars, detail max 200 chars.
- Wrangler 4.113.0.

**Regulatory (UK):**
- Share mint issues access credentials only — capability tokens, not monetary instruments. FCA authorisation not required.
- UK GDPR Article 33: 72hr ICO notification for personal data breaches. Free tier: no identity data held.

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
| `if (rl)` to check rate limit | Use `if (rl.limited)` — `checkRateLimit` returns object |
| `getManifest()` direct from handlers | Use `safeGetManifest()` — enforces 64 KB ceiling |
| Generate UUID client-side | Worker generates UUID at `/credential/issue` since S42c |
| Turnstile nonce TTL = 7 days | Cloudflare expires tokens ~300s; use 600s KV TTL |
| `fflate.zip()` (buffered) for folder uploads | `fflate.Zip` streaming API only — OOM on large folders |
| `ZipDeflate` with `{ level: 0 }` for already-compressed files | `fflate.ZipPassThrough` (STORED, method=0) — Archive Utility compatible |
| Multiple concurrent `arrayBuffer()` calls in zip loop | One file at a time; yield via `setTimeout(0)` |
| Hardcode 900s TTL for download tokens | Pass `manifest.expiry_timestamp` |
| `ProjectivePoint.subtract()` in noble v2 | Use `.add(point.negate())` |
| `localStorage` / `rfTheme` for theme in `head.njk` | `rs-theme` cookie, `dataset.theme` only |
| `classList.add('carbon-mode')` in theme script | `document.documentElement.dataset.theme = 'carbon'` |
| Template changes in `refueler-share/src/` | `*.njk` → `refueler-io/src/share/` · CSS/JS → `refueler-share/frontend/` + `bin/sync-share.sh` |
| Edit files in `refueler.io/src/share/assets/` | GENERATED — edit in `refueler-share/frontend/` then sync |
| Cloudflare Queues / Durable Objects / D1 for webhooks | `ctx.waitUntil` + KV dead-letter only |
| Store `whsec_hash` in `wh_config_` KV | Field removed SW4-patch — Option B derives, never stores |
| Derive `rfs_whsec_` without `created_at` in HMAC message | `created_at` is required rotation salt |
| Re-sign dead-letter retries with original `t` | Always re-sign with fresh current timestamp at retry |
| Begin SW5 build without SW5-Opus session | SW5-Opus must decide receipt verifier audience (symmetric HMAC vs asymmetric Ed25519) first |
| Sub-keys per API user | One keypair per commercial relationship + `transfer_ref` attribution |
| Require Turnstile on resume credential path | `resume: true` + `resume_uuid` + R2 HEAD check on chunk 0000 |
| HTTP 409 on resume chunk PUT as generic 4xx | 409 = transfer already complete — clear IDB + "already completed" message + New Upload CTA |
| Add email / Supabase row to Lightning or anonymous-rail API credential path | Load-bearing for Silent Drop + anonymous API rail — invariant, locked |
| Reuse upload credential UUID as SD cargo UUID | Generate separate cargo UUID at Lighthouse layer — never expose upload UUID to sender |
| Return 402 at `GET /inbox/{token}` intake check | Defer quota errors to upload attempt — consistent response shape prevents storage side-channel |
| Math.random() in Deed keypair generation | `crypto.getRandomValues()` only — no exceptions |
| Claim "anonymous" for Stripe-rail Silent Drop | Stripe rail = private (not anonymous). Lightning rail = anonymous. |
| Local refueler.io path wrong | Local repo is `/Users/rajeshtaylor/Documents/refueler.io` — not `refueler-io`. Never use `refueler-io` as a local filesystem path. |
| Surgical sed/python patch to `index.js` | Always produce a complete replacement file. Run `node --check worker/src/index.js` before presenting. |
| MCP server as Refueler-hosted plaintext endpoint | MCP runs in agent's trust domain, handles ciphertext only — invariant, locked SW-Opus-1 |
| Claim "proof of delivery" for transfer receipts | Unprovable. Issue acceptance receipts + collection receipts. Never "delivery". |

---

## Current state

**TH-series ✓ complete. SW-Opus-1 ✓ · SW-Opus-2 ✓ · SW-Opus-3 ✓ · SW4-Opus ✓ complete. SW4-patch + SW4a next.**
**TG-block ✓ · Share-JS-Refactor ✓ · 432 tests passing.**

| Block | Commit | Summary |
|-------|--------|---------|
| B1–B5 ✓ | — | Foundation → security hardening → design full pass (S1–S52) |
| B6 ✓ | `319225f` | 212 tests passing · 0 skipped · 8 suites. Folder upload, k6, CI Level 1. |
| B7 in progress | `a19778c` | S73/S73a: client errors modal fix. Node bootstrap Hetzner-gated. |
| SYNC-1 ✓ | `2d26587` | `bin/sync-share.sh` committed. Embedded git repos gitignored. |
| RU-block ✓ | `1e33ebe` | Streaming zip → IDB schema → resume flow → 409 handling. |
| HQ-series ✓ | `9cd2241` | HTTP/3 AE logging. BLAKE3 + HTTP/3 trust band. Plans/Status in nav. |
| TG-block ✓ | `0e51385` | Destroy-after-download · tidal window · Execution Dock · owner DELETE. 432 tests. |
| TH-series ✓ | `45a4d3b3` | OTS relay · permanent-record UI · JS refactor (5 modules). |
| SW-Opus-1 ✓ | — | Three-tier model · rail model · Model B · API v1 features · MCP v1 tools · BOLT12 · sandbox. BRIDGE v8.3. |
| SW4-Opus ✓ | — | Webhook signing architecture locked. Option B (stateless HMAC derivation). `WEBHOOK_SIGNING_MASTER_KEY` new secret. `whsec_hash` removed from KV schema. Dead-letter schema locked. BRIDGE v8.8. |

---

## Roadmap — resequenced SW-Opus-1 (7 Sep 2026)

| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1 | NB-1 (Opus, runbook writing) | ❌ | Complete. |
| 2 | S89/S90 — tier + Stripe tidy-up | ❌ | S89 ✓. S90 ✓. |
| 3 | S93–S95 — B7 snag sweep | ❌ | Theme toggle in modals. AE event routing fix. |
| 4 | S88 ✓ — SD design | ❌ | Complete. |
| 5 | TG-block ✓ | ❌ | Complete. |
| 6 | TH-series ✓ | ❌ | Complete. |
| 7 | SW-Opus-1 ✓ | ❌ | Complete. Three-tier + API architecture locked. |
| 8 | SW-Opus-2 ✓ | ❌ | Unit economics, rate-card v1.0, Sovereign Teams, GTM reframe. BRIDGE v8.4. |
| 8a | SW-Opus-3 ✓ | ❌ | Identity-API fee, DPA, AM role, disclosure wording, SW build confirmed. BRIDGE v8.5. |
| 9 | SW block (SW1–SW9) | ❌ | HMAC auth, credential issuance, webhooks, capability discovery, OTS webhook, receipts, sandbox, onboarding. **Next.** |
| 10 | B8 — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost. |
| 11 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 12 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block with node live. |
| 13 | SD-block — Silent Drop | ✅ | Sovereign + Lightning-only. Full Locke (B8) required. |
| 14 | Article pipeline | ✅ | Unlocks after NB-4. |
| 15 | B9 → B10+ | — | Continue as previously sequenced. |

---
**Buffer pool (2 sessions):** SW2c · SW5c

---

## TH-series — Tower Hill / Permanent Record (complete · 6 Sep 2026)

All locked decisions in CLAUDE.md. TH-1 deployed `a71f12fe`. TH-2 deployed `53e3c7fb`. JS refactor deployed `45a4d3b3`.

---

## TG-block — Traitor's Gate (complete · 5 Sep 2026)

432 tests passing. Commits `0e51385` + `18d2157`.

**TG-block do-not-retry:**
- DO NOT auto-delete R2 on final chunk served — set `pending_destruction: true`, wait for frontend confirmation
- DO NOT use the word "Traitor" in any UI copy, tooltip, or aria-label
- DO NOT compute `X-P2SH-Secret-Hash` with plain BLAKE3 in tests — use `hashSecret()` from `nut11.js`
- `pending_destruction` flip not reliably observable in local wrangler — test via unit tests only
- `available_from` must be >= `created_at` — use `nowSeconds() + 1` minimum in tests
- Supabase mock `seedSubscriber()` callable only via HTTP `POST /_test/seed-subscriber`

---

## SW-Opus-1/2/3 — locked decisions (7 Sep 2026)

Full decision log in BRIDGE v8.5 §SW-Opus-2 decisions and §SW-Opus-3 decisions.

**SW-Opus-2 resolved:** rate-card v1.0 (10 sat/transfer + 100 sat/GB, £50k BTC peg), credit blocks (10k sat dust floor, v1 presets 10k/50k/200k/custom), Sovereign Teams (S/M/L bands £49/£89/£169, shared 100 GB pool), treasury policy (GBP in/out on identity rail, sats held in phoenixd), GTM reframe (Bitcoin-native HNW + accountant, warm intro only).

**SW-Opus-3 resolved:** identity-API £99 flat (Professional £249 defined-not-built, banded on service not allowance). DPA mandatory by default, Refueler provides standard Art. 28 addendum. GDPR framing: anonymous rail = controller-of-metadata, not "outside GDPR." AM role: onboarding, rail sign-off, DPA, incident notification, Raven canary explanation, quarterly review, rate-card notice — async/best-effort, no SLA. Four-surface disclosure wording locked (both rails), ecash → "signed digital tokens" in all client copy, bracketed placeholders slot at SW7. Identity-rail revenue planned as access-fee-only — metered sat component is abuse ceiling not billing meter. SW table in share-sessions.md corrected to match Master-Context. IT handover PDF dropped by intent.

**Still open (allocate before B9):**
- `refueler_capabilities`, `refueler_quote`/`refueler_balance` — London-register atom descriptors, vocabulary track
- Keyset-versioned rate-lock for anonymous rail — optional v2 extension
