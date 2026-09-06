# Share-Master-Context — refueler-share
> **Version:** 7.3 | **Last updated:** S-TG-4b · 5 Sep 2026
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

---

## Stripe — live mode

| Product | Price ID | Lookup key | Amount | Status |
|---------|----------|------------|--------|--------|
| Sovereign monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo | ✅ Active |
| Sovereign 3-month | `price_1TyzMLGlctwiB9U3cA31BOQc` | `share-max-3month` | £72/3mo | ✅ Active |
| Sovereign yearly | `price_1TyzNaGlctwiB9U3T8uV4UIW` | `share-max-yearly` | £288/yr | ✅ Active |

**Tier rename complete S90:** Citizen (free). Sovereign (paid, two rails). Creative Premium archived. Product ID: `prod_Urre2e3PQgr5Uq`.

Archived: `price_1Ts7sqGlctwiB9U3YRloCFfi` · `price_1Ts7xIGlctwiB9U3JyZB8Kwj` · `price_1Ts7lsGlctwiB9U3hdtgChU2` · `price_1TyzF4GlctwiB9U3Zo0fG8Ic` · `price_1TyzKIGlctwiB9U3Dn71fGbA` (Creative Premium)

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://refueler.io/share/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

Business tier: invoiced manually via Stripe invoice template. No subscription price object. Off-repo.

---

## Lightning infrastructure (B7)

**Provider: LNbits on Hetzner CAX21. Locked pre-Opus-2.** Blink dead (UK custodial discontinued Aug 31 2026). Voltage eliminated (US company, invoice metadata). Strike eliminated (custodial).

**Stack on Instance A (Share+Pass):** phoenixd (ACINQ, no bitcoind required) → LNbits (wallets: Share, Pass, Ops) → cloudflared tunnel (Worker→LNbits, no inbound ports) → Tor (per-service .onion for LNbits admin + phoenixd transport).

**Liquidation:** phoenixd splice-out → standard bech32 in Sparrow Wallet. phoenixd cannot send to BIP-352 Silent Payments (no node for scanning). Sweep when balance exceeds ops reserve (set at NB-4). Payjoin v2 recommended on sweep transactions (Sparrow supports natively) — breaks payment-graph pattern-matching on liquidation. Ops note for NB-4, not a build session.

**Phoenixd → LND trigger (locked):** Migrate when EITHER: (1) ≥£10k/mo Lightning receipts sustained 3 consecutive months AND named operator committed to channel ops; OR (2) ACINQ discontinues/changes phoenixd terms.

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

**Privacy model:** Lightning payer = payment hash + amount + tier only — no identity at any layer. Honest claim: "pseudonymous." DO NOT claim "anonymous." Silent Drop subscription payments further decouple payment from cargo: one payment per billing period, not per transfer. Amount = tier, not file size. State explicitly in B9 whitepaper.

**DO NOT add a Supabase row or email field to the Lightning credential path** — load-bearing for Silent Drop.

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
| Sub-keys per API user (Business tier) | One keypair per commercial relationship + `transfer_ref` attribution |
| Require Turnstile on resume credential path | `resume: true` + `resume_uuid` + R2 HEAD check on chunk 0000 |
| HTTP 409 on resume chunk PUT as generic 4xx | 409 = transfer already complete — clear IDB + "already completed" message + New Upload CTA |
| Add email / Supabase row to Lightning credential path | Load-bearing for Silent Drop — invariant, locked |
| Reuse upload credential UUID as SD cargo UUID | Generate separate cargo UUID at Lighthouse layer — never expose upload UUID to sender |
| Return 402 at `GET /inbox/{token}` intake check | Defer quota errors to upload attempt — consistent response shape prevents storage side-channel |
| Math.random() in Deed keypair generation | `crypto.getRandomValues()` only — no exceptions |
| Separate entropy source for BIP-39 mnemonic vs keypair | Same `crypto.getRandomValues()` call for both |
| Claim "anonymous" for Stripe-rail Silent Drop | Stripe rail = private (not anonymous). Lightning rail = anonymous. |
| Local refueler.io path wrong | Local repo is `/Users/rajeshtaylor/Documents/refueler.io` — not `refueler-io`. Never use `refueler-io` as a local filesystem path. |
| Surgical sed/python patch to `index.js` | Always produce a complete replacement file. Run `node --check worker/src/index.js` before presenting. |

---

## Current state

**B7 in progress — S73/S73a complete. NB-series (node bootstrap) is the Hetzner-gated block.**
**SYNC-1 ✓ · RU-block ✓ · HQ-series ✓ · S88 ✓ (SD design locked) · TG-block in progress (TG-4 ✓)**
**Roadmap resequenced AP-10: no Hetzner required for TG-block, TH-series, SW, B8.**

| Block | Commit | Summary |
|-------|--------|---------|
| B1–B5 ✓ | — | Foundation → security hardening → design full pass (S1–S52) |
| B6 ✓ | `319225f` | 212 tests passing · 0 skipped · 8 suites. Folder upload, k6, CI Level 1. |
| B7 in progress | `a19778c` | S73/S73a: client errors modal fix. Node bootstrap Hetzner-gated. |
| SYNC-1 ✓ | `2d26587` | `bin/sync-share.sh` committed. Embedded git repos gitignored. |
| RU-block ✓ | `1e33ebe` | Streaming zip → IDB schema → resume flow → 409 handling. |
| HQ-series ✓ | `9cd2241` | HTTP/3 AE logging. BLAKE3 + HTTP/3 trust band. Plans/Status in nav. |
| S88 ✓ | — | Silent Drop design locked. SD-block session plan written. Threat model confirmed. |
| TG-block in progress | `9258050` | TG-2 ✓ · TG-3 ✓ · TG-3a ✓ · TG-4 ✓. Execution Dock live. Next: TG-5 (tests + smoke). |

**Test count: 212 passing · 0 skipped across 8 suites (6 unit + 2 integration). TG-2 added 36 unit + 8 integration = 355 passing.**

---

## Roadmap — resequenced AP-10 (3 Sep 2026)

| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1 | NB-1 (Opus, runbook writing) | ❌ | Planning only. |
| 2 | S89/S90 — tier + Stripe tidy-up | ❌ | S89 complete. S90 pending. |
| 3 | S93–S95 — B7 snag sweep | ❌ | Theme toggle in modals. AE event routing fix. |
| 4 | S88 ✓ — SD design | ❌ | Complete. |
| 5 | TG-block — Traitor's Gate | ❌ | TG-4 ✓. Next: TG-5. |
| 6 | TH-series — Tower Hill / OpenTimestamps | ❌ | 2–3 Opus scoping sessions then build. |
| 7 | SW block (SW1–SW9) | ❌ | Solicitor gate on Business sales only, not on build. |
| 8 | B8 — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost. |
| 9 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 10 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block with node live. |
| 11 | SD-block — Silent Drop | ✅ | Sovereign + Lightning-only. Full Locke (B8) required. |
| 12 | Article pipeline | ✅ | Unlocks after NB-4. |
| 13 | B9 → B10+ | — | Continue as previously sequenced. |

## TH-series — Tower Hill / Permanent Record (locked TH-Opus-1 · 5 Sep 2026)

**Internal name:** Tower Hill. **UI label:** Permanent record. **Short form:** Date seal
(badge labels, bundle filename: `date-seal.ots.enc`). "Traitor" discipline applies — no
OTS jargon, no "blockchain" in primary copy.

**Architectural locks:**
- All OTS logic is client-side. Worker is a blind byte-relay only — no OTS library in Worker.
- Worker relay endpoints: `POST /timestamp/submit` · `GET /timestamp/upgrade` (opaque byte
  forwarding to calendar servers; Worker sees nonced 32-byte SHA-256 digest only).
- Storage: `{uuid}/date-seal.ots.enc` — encrypted under transfer fragment key (AES-GCM,
  own AAD). Lazy client-side upgrade on download. No cron. No Durable Objects.
- Manifest fields: `timestamp_state: 'none' | 'pending' | 'complete'` · `timestamp_submitted_at`.
  No digest, no calendar URLs in manifest.
- Deletion: `date-seal.ots.enc` joins every deletion path — expiry, destroy-after-download,
  Execution Dock grace-sweep, owner delete. Load-bearing. Flag at TH-1 build.
- Hash canon (never conflate — add to architectural lock table):
  - BLAKE3 → chunk integrity (internal)
  - SHA-256 (OTS) → existence proof, Bitcoin-anchored (client-side only)
  - Cashu → anonymous auth
- Verification: Legend is the native verifier. No duplicate verify view in Share v1.
- Copy register: "permanent record," never "notarise." Honest scope: proves bytes existed
  on or before a block date, not who sent them, not that they're true.
- OTS wariness on record: TH-0 spike (bundle size + calendar endpoint check) before any
  build commitment. Block parks without shame if spike is ugly.

**Tier placement (locked):**
- Sovereign+ only, opt-in toggle. No Citizen surface, no mention.
- Legend-provisioned Sovereign entitlement: 100 GB cap, no API access.
  (Full Sovereign = 100 GB. Business/API = 250 GB + pay-per-GB overage.)
- One-directional: Legend subscription includes Sovereign Share entitlement.
  Sovereign Share subscribers do not receive Legend access.

**Sovereign cap revision (locked TH-Opus-1):**
- Sovereign cap revised from 250 GB → **100 GB**. No legacy subscribers affected.
- Business/API: 250 GB included, pay-per-GB over. Overage invoiced (manual, annual minimum).
- Rationale: professional audience (legal, healthcare, estate) moves PDFs and documents,
  not bulk media. 250 GB was an unvalidated round number. Catch before any published copy.

**Cross-product entitlement (design dependency — TH-Opus-2/3):**
- Legend subscription provisions a Sovereign Share credential server-side.
- Architecture: KV entitlement flag or cross-product token. Design at TH-Opus-2/3.
- Legend-provisioned cap: 100 GB, no API access. Prevents Legend becoming API backdoor.
- Legend price to be set at TH-Opus-2. One or two scoping sessions, not a heavy block.

**Product loop:**
- Stamp in Share → verify in Legend. Connective tissue between products.
- Estate/will workflow: Legend user queries UTXOs, sends wallet descriptor/will/PSBT via
  Share with permanent record. Legend verifies. No third-party tool required.

**Locked sequence:** `NB-1 → S89/S90 → snag sweeps → [S88 ✓] → TG-block → TH-series → SW → B8 → [Hetzner] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`

**TH-Opus-3a locked (committed value + bundle):**
- Committed value: commitment = SHA-256(blake3_root ‖ seal_nonce). blake3_root = standard
  BLAKE3-256 of assembled plaintext (NOT chunk tree; capture at assembly — new). seal_nonce =
  16-byte crypto.getRandomValues, fragment-only, Permanent-Record transfers only, never the key.
- blake3_root reaches Legend by re-derivation only. Never shipped/embedded.
- Bundle: date-seal.ots.enc (encrypted, per TH-Opus-1) fetched once with download; seal_nonce from
  fragment; no plaintext R2, no flag beyond timestamp_state.
- AMENDS TH-Opus-1: upgrade moves to Legend. Share Worker = POST /timestamp/submit only.
  Drop GET /timestamp/upgrade from Share. Jittered submit delay for timing decorrelation.
- Nutroot (B8/B12 forward): x = commitment, H = SHA-256(x). Bearer by default; recipient binding =
  future P2PK leaf. `after` via two-phase credential (real anchor height); no estimation.
- Whitepaper calendar-trust line: "A pending calendar response is a promise, not proof; Refueler
  submits each commitment to multiple independent OpenTimestamps calendars, so a dishonest calendar
  cannot forge a Bitcoin attestation and cannot prevent anchoring while one honest calendar remains."
- Do-not-conflate: nonce carries all privacy; BLAKE3 carries none of it.
---

## SD-block — design locked (S88 · 4 Sep 2026)

**Full session plan in share-sessions.md §SD-block.**

**Key locks:**
- Opaque intake token → KV inbox key. No stable identifier visible to sender.
- Lightning rail only — architectural necessity, not preference. Stripe rail = private inbox (not anonymous).
- Recipient sets lifecycle. Execution Dock as optional Quay close. KV only — no Supabase row ever.
- Lighthouse + up to 10 Sovereign Quays at launch. Primary Quay anchored in dashboard by visual weight. Ad-hoc Quays default: 30-day + Execution Dock on. Defaults teach the pattern without explanatory copy.
- One Deed per Harbourmaster. 12-word BIP-39. Covers Locke + all Quays. UI: "recovery sheet." Whitepaper: "the Deed."
- Stripe Sovereign users also receive a recovery sheet (parallel flow, SD3b).
- SD ships after B8 (full Locke in place). No temp auth builds.
- Friend-group soft launch (7-day) gates public Sovereign access.
- Mid-block privacy audit at SD4b. Final audit at SD7a. Both mandatory.

**Threat model (locked S88):**

| Layer | State | Notes |
|---|---|---|
| Application | Fully blinded | Opaque tokens, UUID isolation, no metadata |
| Payment | Subscription decouples payment from cargo | Amount = tier, not file size. One payment per billing period. State in whitepaper. |
| Network | Mullvad multi-hop recommended | Sender-side correlation mitigation |
| Payment graph | Pseudonymous | Node-level observer sees payment arrived. BOLT12 blinded paths = B9 §Future work |
| PTLCs | Inherit when phoenixd/LND supports | No build session. B9 whitepaper §Future work. |
| Payjoin v2 | Liquidation sweep hygiene | Sparrow native. Ops note at NB-4. Not a product feature. |
| Submarine swaps | Not applicable to Share | Flagged for Pass liquidation privacy post-B9. |

---

## B7 notes

**Session numbering (B7+):** single-scope = plain number (S78). Split sessions = lettered suffix (S73, S73a). Plain number never skipped.

**Pre-B7 guards:**
- DO NOT provision Hetzner until NB-1 runbook is written.
- DO NOT build a phoenixd/LND funding swap — phoenixd is default; LND is trigger-gated.

---

## Marketing / competitive intelligence

**Anonymity spectrum:** WeTransfer/Smash/SwissTransfer → Tresorit/Proton → Wormhole → **Refueler Share** → OnionShare. DO NOT claim "no competitor offers anonymous payment" — Proton accepts on-chain Bitcoin.

**Positioning:** "professional-grade anonymity where only one side needs to be sophisticated."

**Two-axis category framing (locked AP-7):** (1) **Recipient problem** — transfer survives either party going offline. (2) **Compulsion problem** — nothing to hand over, never had it. Do not name DashBeam in public copy.

**Marketing claim rulings (S42e):**
- ✅ Safe: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting; UUID-bound credential issuance; anonymous transfer (free tier); subscription payment decoupled from cargo (Silent Drop).
- 🔒 Blocked: full Merkle tree; NUT-11 Mode 2; "audit-certified"; ML-KEM; "end-to-end file integrity" without qualifier.
- 🔒 Journalist/source-protection hero copy blocked: gate (1) SD shipped, (2) blinded-relay reviewed, (3) VPN scope stated.
- Resolution: B8 → NUT-11 Mode 2 · B9 → whitepaper + Merkle · B10 → ML-KEM.

---

## API / white-label — locked (AP-2 + AP-3a)

**Auth:** HMAC-SHA256 over `method + path + timestamp + body_hash`. Three credentials: `rfs_live_` (ID) + `rfs_sign_` (integrity) + `rfs_whsec_` (webhook, Business only).

**Credential issuance:** `POST /api/v1/credential/issue`. `transfer_ref` → AE `blob1` only, never Supabase. Quota in KV `api_quota_{key_id}`.

**Tier + rail structure (locked S89):**

| Tier | Cap | Expiry | Rail | Billing |
|------|-----|--------|------|---------|
| **Citizen** (free) | 4 GB | 1 / 7 days | n/a | — |
| **Sovereign** | 250 GB + API | 1 / 7 / 30 / 90 days | Stripe or Lightning | £24/mo · £72/3mo · £288/yr |
| **Business** | 2 TB/mo · 1,000 credentials | 1 / 7 / 30 / 90 days | Stripe or Lightning | Invoiced (annual minimum) |
| **Enterprise** | Custom · 5 TB/mo · Argon2id · BIP-85 | Custom | Stripe or Lightning | Annual contract |

**Rail model:** Sovereign has two rails. Stripe rail: identity at Stripe, conventional recovery, all features. Lightning rail: no identity at any layer, unlocks Silent Drop standing inbox. Rail is a property of the credential, not a tier name.

No discounts. No yearly savings framing.

---

## Worker endpoints (summary)

Core: `POST /credential/issue` · `PUT /upload/{uuid}/{chunk}` · `POST /auth/{uuid}` · `GET /download/{uuid}/{chunk}` · `POST /log/error`.
Admin: `GET|POST /admin/status` · `GET /admin/metrics` · `GET /admin/ae-metrics` · `GET /admin/snapshot` · `GET /admin/execution-dock`.
Stripe: `POST /webhook/stripe` · `POST /subscription/checkout` · `GET /subscription/status` · `POST /subscription/portal` · `GET /subscription/credential`.
Lightning (B7): `POST /subscription/lightning` · `POST /webhook/lightning` · `GET /subscription/lightning/credential`.
SW: `GET /wl/config` · `POST /api/v1/credential/issue` · `POST /api/v1/keys/rotate` · `GET /api/v1/transfers` · `POST|GET|DELETE /api/v1/webhooks{/id}` · scheduled cron.
TG-block: `DELETE /transfer/{uuid}` · manifest fields `pending_destruction`, `consumed`, `available_from_timestamp`, `available_until_timestamp`.
SD-block (new): `POST /inbox/create` · `GET /inbox/{token}` · `POST /inbox/{token}/upload`.

---

## Testing infrastructure

Canonical reference: `TESTING.md` (repo root). Load for any testing session. **355 passing · 0 skipped · 8 suites** (6 unit + 2 integration + TG-2 additions). k6 load tests all green. CI Level 1 live. Level 2 — B7–B8 scope.

---

## /notes/ article pipeline

12 articles planned at `refueler.io/notes/`. Full editorial detail: `notes-articles-list.md`. Articles 1–5: no product dependency (article 1 live). Article 6: unlocks post-B7 Lightning. Articles 8/11/12: post-SW. Article 7 (journalists): Susie (Bitcoin Policy UK) intro first. Article pipeline gated on node live (NB-4).

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred B8 | NUT-11 Mode 2 (keypair challenge-response) — review NUT-22 BATs before B8 design lock |
| Post-B8 | Argon2id as NUT-11 Mode 1 KDF extension |
| Deferred B10 | ML-KEM key wrapping |
| Monitor | NUT-10 v3 "Nutroot secrets" PR #421 — HIGH for B12/Pass |

---

## Future work + B9 scope

**B9:** Incident response tabletop. SimpleX SMP on Instance C. BOLT12 blinded paths §Future work. PTLC §Future work (one sentence). Cyber Essentials Plus · G-Cloud · ISO 27001 · NHS DSPT · Defensive publication via IP.com (30 days after whitepaper).

**B12:** FROST threshold signatures — M-of-N co-signatories for credential issuance.

**B8+:** Argon2id Enterprise KDF. BIP-85 enterprise key management. Nostr keypair auth for dashboard.

**B10:** ML-KEM post-quantum key wrapping — Sovereign + Enterprise first.

**B9+:** Silent Payments (BIP-352) — requires full Bitcoin node. refueler-multi-core (Esplora fork) — post-B9.

**Publication-gated (B9 whitepaper §Future work only):** "Purchase a recovery window."

---

## B6 carried snags

- QR logo centre → B11
- Receiver page nav → B13
- Manifest-field minimalism audit → B9 whitepaper prep
- UUID/fragment token entropy pre-audit → B9
- First-transfer experience aesthetic → B13a
- Pay-to-extend design document — B8. Publication restriction: B9 whitepaper §Future work only.
- Context file archive strategy — implement at S96.

---

## B7 open snags (resolve at S93–S95)

- PayNym column on payment privacy table — "coming soon" placeholder only
- Own node stub cards — greyed until B9
- Renewal warning banner — 7-day pre-expiry, all paid tiers
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routing to `/log/error` instead of AE

---

## Compression strategy (RU0)

Skip-compress via `fflate.ZipPassThrough` (STORED, method=0): Video · Audio · Images (jpg/heic/heif/webp/avif) · Archives. PNG/TIFF/TXT/MD/CSV/JSON — `ZipDeflate` level 6. Never `{ level: 0 }` in ZipDeflate.

Speed honesty: "Faster than email. Slower than services that can read your files. That's the trade."

---

*"Nothing stops this train."*
