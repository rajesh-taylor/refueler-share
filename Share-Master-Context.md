# Share-Master-Context — refueler-share
> **Version:** 7.1 | **Last updated:** S89 · 3 Sep 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` (canonical `refueler-share/frontend/`, mirror `refueler-io/src/share/assets/`) |
| Subdomain | `share.refueler.io` → CNAME → `refueler-share.pages.dev` |
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
| Pages | `share.refueler.io` → `refueler-share.pages.dev` |
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

Archived (do not use): `price_1Ts7sqGlctwiB9U3YRloCFfi` · `price_1Ts7xIGlctwiB9U3JyZB8Kwj` · `price_1Ts7lsGlctwiB9U3hdtgChU2` · `price_1TyzF4GlctwiB9U3Zo0fG8Ic` · `price_1TyzKIGlctwiB9U3Dn71fGbA` (Creative Premium)

Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · Destination: `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://share.refueler.io/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

Business tier: invoiced manually via Stripe invoice template. No subscription price object. Off-repo.

---

## Lightning infrastructure (B7)

**Provider: LNbits on Hetzner CAX21. Locked pre-Opus-2.** Blink dead (UK custodial discontinued Aug 31 2026). Voltage eliminated (US company, invoice metadata). Strike eliminated (custodial).

**Stack on Instance A (Share+Pass):** phoenixd (ACINQ, no bitcoind required) → LNbits (wallets: Share, Pass, Ops) → cloudflared tunnel (Worker→LNbits, no inbound ports) → Tor (per-service .onion for LNbits admin + phoenixd transport).

**Liquidation:** phoenixd splice-out → standard bech32 in Sparrow Wallet. phoenixd cannot send to BIP-352 Silent Payments (no node for scanning). Sweep when balance exceeds ops reserve (set at NB-4).

**Phoenixd → LND trigger (locked):** Migrate when EITHER: (1) ≥£10k/mo Lightning receipts sustained 3 consecutive months AND named operator committed to channel ops; OR (2) ACINQ discontinues/changes phoenixd terms. Not before — switching below £10k is a false economy for a non-coder founder.

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

**Privacy model:** Lightning payer = payment hash + amount + tier only — no identity at any layer. Honest claim: "pseudonymous." DO NOT claim "anonymous."

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
- `frontend/blake3/`, `frontend/fflate.min.js`, `frontend/qr-creator.min.js` — self-hosted, force-committed. DO NOT load from cdnjs.
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

---

## Current state

**B7 in progress — S73/S73a complete. NB-series (node bootstrap) is the Hetzner-gated block.**
**SYNC-1 ✓ · RU-block ✓ (RU0–RU2e) · HQ-series ✓ (HQ1–HQ2)**
**Roadmap resequenced AP-10: no Hetzner required for TG-block, TH-session, SW, B8.**

| Block | Commit | Summary |
|-------|--------|---------|
| B1–B5 ✓ | — | Foundation → security hardening → design full pass (S1–S52) |
| B6 ✓ | `319225f` | 212 tests passing · 0 skipped · 8 suites. Folder upload, k6, CI Level 1, Lightning toggle. |
| B7 in progress | `a19778c` | S73/S73a: client errors modal fix. Node bootstrap (NB-series) is Hetzner-gated — deferred after AP-10 resequence. |
| SYNC-1 ✓ | `2d26587` | `bin/sync-share.sh` committed. Embedded git repos gitignored in refueler-io. |
| RU-block ✓ | `1e33ebe` | Streaming zip (RU0) → IDB schema (RU1) → re-credential + Safari fix (RU1a) → full resume flow + 409 + reassurance note (RU2–RU2e). |
| HQ-series ✓ | `9cd2241` | HTTP/3 AE logging. BLAKE3 + HTTP/3 trust band on upgrade page. Plans/Status in nav. |

**Test count: 212 passing · 0 skipped across 8 suites (6 unit + 2 integration).**

---

## Roadmap — resequenced AP-10 (3 Sep 2026)

**No new server costs until the Hetzner commitment point. All sessions before that point run on existing Cloudflare + Supabase + Stripe infrastructure.**

| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1 | NB-1 (Opus, runbook writing) | ❌ | Planning only — runbook for NB-2 onwards. No server yet. |
| 2 | S89 — tier naming tidy-up | ❌ | Copy/naming pass across all pages. No Stripe objects. |
| 3 | S90 — Stripe objects | ❌ | Product/price alignment. After S89 confirmed. |
| 4 | S93–S95 — B7 snag sweep | ❌ | Theme toggle in modals. AE event routing fix. Existing infra. |
| 5 | S88 — SD design session | ❌ | Silent Drop design. No code. Planning only. |
| 6 | **TG-block — Traitor's Gate** | ❌ | New feature. Pure Worker + R2 + manifest. All tiers. |
| 7 | **TH-series — Tower Hill / OpenTimestamps** | ❌ | 2–3 Opus scoping sessions. Share + Pass + Legend `.ots` use cases. Then build session. |
| 8 | SW block (SW1–SW9) | ❌ | CF for SaaS on existing Workers plan. Solicitor gate on Business sales, not on build. |
| 9 | B8 — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost (~€8–10/month). |
| 10 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 11 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block runs with node live from day one. |
| 12 | SD-block — Silent Drop | ✅ | Sovereign + Lightning-only standing-receive inbox. |
| 13 | Article pipeline (first article) | ✅ | Unlocks after node fully functional. |
| 14 | B9 → B10+ | — | Continue as previously sequenced. |

**Locked sequence (revised AP-10):** `NB-1 → S89/S90 → snag sweeps → S88 → TG-block → TH-series → SW → B8 → [Hetzner] → NB-2–NB-4 → B7 → SD-block → articles → B9 → B10+`

---

## Traitor's Gate — feature decisions (locked AP-10 · 3 Sep 2026)

**Internal vocabulary only. Never in product-facing copy. UI label: "Destroy after download."**

### What it is
The Traitor's Gate is the water gate through which accused prisoners arrived at the Tower by barge, timed to high tide. One way in, no way back. The name is retrospective — many who entered were not traitors. The Gate is the mechanism, not a judgment.

**Feature:** sender toggles destruction mode at upload. Once the recipient's final chunk is confirmed downloaded and the user clicks the post-download confirmation, the Worker deletes all R2 objects and marks the manifest `consumed: true`. Any subsequent request returns 410.

### UI copy (locked)

| Element | Copy |
|---|---|
| Toggle label | **Destroy after download** |
| Toggle subtitle | "The link and server copy are permanently deleted once collected." |
| Post-upload amber notice (sender) | "This transfer is set to destroy after download. Your recipient will be prompted to save the file before the link is deleted." |
| Pre-download modal (recipient) | "This transfer is set to destroy after download. Save the file to a device you control — the link will be permanently deleted once you confirm receipt." [I understand — download now] |
| Post-download confirmation (recipient) | "File received. Save it now to a device you control. The link and server copy will be deleted when you confirm." → **[I've saved it]** |

**Deletion is user-triggered, not automatic.** Worker sets `pending_destruction: true` on manifest after final chunk is served. Actual R2 deletion and `consumed: true` happen only on the frontend `DELETE /transfer/{uuid}` call triggered by [I've saved it]. If the browser crashes before confirmation, the normal expiry backstop applies.

### Tidal window — the extension (locked AP-10)

Four settings building on the Traitor's Gate concept. Prisoners had to time their arrival to the tide — the gate only opened at high water. Sender controls when the gate opens and closes.

| Setting | Tier | Mechanism |
|---|---|---|
| **Destroy after download** (core) | All tiers | `pending_destruction: true` on manifest · user-triggered deletion |
| **Close tide** — auto-delete at precise datetime | Sovereign + Business + Enterprise | `available_until_timestamp` on manifest · Worker returns 410 after this moment regardless of download status |
| **Open tide** — available from datetime | Sovereign + Business + Enterprise | `available_from_timestamp` on manifest · Worker returns 423 Locked before this moment |
| **Combined tidal window** | Sovereign + Business + Enterprise | Both fields set · destroy after download active · gate opens and closes on sender's schedule |

Manifest fields: `available_from_timestamp` (ISO 8601, optional) · `available_until_timestamp` (ISO 8601, optional) · `pending_destruction` (boolean) · `consumed` (boolean).

### Execution Dock (locked AP-10)

Harbourmaster dashboard card for uncollected expired transfers. **No fee mechanism — no "stay of execution" payment.** Sender-facing only.

| State | Timing | Dashboard |
|---|---|---|
| Active | Within expiry window | Green |
| **Execution Dock** | Expired, not yet collected, within 48h grace (Three Tides) | Amber — countdown to deletion |
| Consumed | Deleted (collected or grace elapsed) | Grey |

Dashboard card shows: transfer label · expiry timestamp · deletion countdown · [Destroy now] button (immediate) · [Do nothing] (tide executes at hour 48). No extension option on free tier — re-upload. Paid tier longer expiry windows make the Dock less common.

Three Tides = 48-hour grace period, named for the Execution Dock, Wapping sentence: bodies left until three tides washed over them (~36–48 hours).

### Whitepaper treatment
Traitor's Gate and the Tidal Window system belong in the whitepaper's §Transfer lifecycle section, with the historical context stated once, briefly. "The gate opened only at high tide. The timing was the recipient's, not the sender's. Our architecture makes the sender the tidekeeper." Do not over-explain the metaphor.

---

## Tower Hill / OpenTimestamps — scoping (agreed AP-10)

**2–3 Opus planning sessions before any build.** Cover Share + Pass + Legend use cases together.

**The feature:** optional at upload — BLAKE3 hash of assembled file submitted to OpenTimestamps API (`https://a.pool.opentimestamps.org/timestamp/{hash_hex}`). Aggregates thousands of hashes, commits a single Merkle root to Bitcoin OP_RETURN every few hours. Sender receives `.ots` proof file alongside transfer link. Verification requires no trust in Refueler or OpenTimestamps — mathematically verifiable from Bitcoin blockchain alone.

**Framing:** temporal existence proof only. "This file existed at this moment." No ownership claim. No IP registration. Honest and technically precise. Not spamming the blockchain — one OP_RETURN shared across all users globally, every few hours.

**Cross-product use cases to scope in TH-series:**
- Share: BLAKE3 hash of assembled file. `.ots` proof downloadable alongside transfer.
- Pass: ticket issuance timestamped. Verifiable without relying on Refueler's ledger.
- Legend: native `.ots` verification in the block explorer UI. The only privacy-respecting explorer that also speaks OpenTimestamps.

**Whitepaper:** Tower Hill section — Bitcoin as immutable public witness to private transfers. Public existence proof for a private transfer. No contradiction.

**Blockchain spam concern:** addressed by OpenTimestamps aggregation. One OP_RETURN, shared across global users, every few hours. Correct response to any Bitcoiner who asks: "We're not adding UTXOs or inscribing. We're using a 32-byte OP_RETURN shared across millions of documents. That's what the blockchain is for."

---

## Dragon — system status vocabulary (locked AP-10)

**Dragon = operational status. Raven = legal warrant canary. Never conflated.**

The Dragon is the wall; the Raven is the alarm. The Dragon signals presence — it holds the line, continuously. The Raven signals absence — when it stops being renewed, something has fallen.

| Dragon state | Copy | KV flag |
|---|---|---|
| All systems operational | **The Dragon holds** | `maintenance_active: false` |
| Degraded / partial outage | **The Dragon sleeps** | `maintenance_active: partial` |
| Critical / maintenance | **The Dragon has fallen** | `maintenance_active: true` |

Status page (`/status`) in internal vocabulary = **The Dragon**. The admin maintenance toggle = the Dragonkeeper. Internal/status page vocabulary only — never in public product copy. City of London boundary bollard dragons are a separate concept and must not be conflated.

---

## B6 carried snags

- QR logo centre (Refueler mark in quiet zone) → B11
- Receiver page nav (shows main domain links) → B13
- Manifest-field minimalism audit (M-02 Blossom benchmark) → B9 whitepaper prep
- UUID/fragment token entropy pre-audit (birthday-paradox) → B9
- First-transfer experience aesthetic (Jaeger-LeCoultre restraint, ceremonial link presentation, haptics, A/B tests) — B13a
- Pay-to-extend / "Purchase a recovery window" — design document due B8. **Publication restriction:** B9 whitepaper §Future work only — no product copy before shipping.
- Context file archive strategy — implement at S87: split into working memory (≤350L) + `Share-Archive.md`.

---

## B7 open snags (resolve at S93–S95, final pass S100)

- PayNym column on payment privacy table — "coming soon" placeholder only
- Own node stub cards (routing fee income, channel liquidity) — greyed until B9
- Renewal warning banner: 7-day pre-expiry, all paid tiers (Stripe + Lightning). SessionStorage-dismiss.
- Theme toggle absent from modals
- `receiver_ab_shown` / `receiver_ab_downloaded` events routing to `/log/error` instead of AE

---

## B7 notes

**Session numbering (B7+):** single-scope = plain number (S78). Split sessions = lettered suffix (S73, S73a). Plain number never skipped.

**Pre-B7 guards:**
- DO NOT create Stripe objects or lock "Silent Drop" name — naming S89, Stripe S90, SD build SD-block.
- DO NOT provision Hetzner until NB-1 runbook is written.
- DO NOT build a phoenixd/LND funding swap — phoenixd is default; LND is trigger-gated.

---

## SD-block placement (locked Opus-2, confirmed AP-10)

**Where:** after B7, before SW. Tidy-up sessions S89 (tier naming) and S90 (Stripe objects) precede SD build.

**Note on SW resequencing:** AP-10 moves SW before B7 (no Hetzner required for SW build). SD-block still ships after B7 is live (SD requires Lightning). The solicitor gate applies to opening Business tier sales, not to building SW code.

**Feature vs positioning split:**
- **SD-feature** (standing-receive inbox, recovery-cliff framing, Sovereign Lightning-only) — ships at SD-block.
- **SD journalist/source-protection hero copy** — gated until B9: blinded-relay crypto reviewed + VPN scope stated honestly.

**Tabletop gate:** incident-response tabletop (hard constraint before first customer) gates SD-block launch.

---

## Marketing / competitive intelligence

**Anonymity spectrum:** WeTransfer/Smash/SwissTransfer → Tresorit/Proton → Wormhole → **Refueler Share** → OnionShare. DO NOT claim "no competitor offers anonymous payment" — Proton accepts on-chain Bitcoin.

**Positioning:** "professional-grade anonymity where only one side needs to be sophisticated."

**Two-axis category framing (locked AP-7):** (1) **Recipient problem** — transfer survives either party going offline (synchronous P2P fails by design). (2) **Compulsion problem** — nothing to hand over, never had it (storing services with server-side keys fail by design). Do not name DashBeam in public copy — position by architecture only.

**Marketing claim rulings (S42e):**
- ✅ Safe: server-side BLAKE3 chunk integrity; double-spend detection; rate limiting; UUID-bound credential issuance; anonymous transfer (free tier).
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

**Rail model:** Sovereign has two rails. Stripe rail: identity at Stripe, conventional recovery, all features. Lightning rail: no identity at any layer, unlocks identity-free features (Silent Drop standing inbox). Rail is a property of the credential, not a separate tier name.

**Retired:** Freeman (never shipped). Creative Premium (stale — no live subscribers). Archive stale Stripe price objects at S90. Crown retires to brand/institutional vocabulary only — no longer a tier name.

No discounts. No yearly savings framing.

---

## Worker endpoints (summary)

Core consumer paths: `POST /credential/issue` (Turnstile) · `PUT /upload/{uuid}/{chunk}` (Cashu) · `POST /auth/{uuid}` · `GET /download/{uuid}/{chunk}` · `POST /log/error`.
Admin: `GET|POST /admin/status` · `GET /admin/metrics` · `GET /admin/ae-metrics` · `GET /admin/snapshot`.
Stripe: `POST /webhook/stripe` · `POST /subscription/checkout` · `GET /subscription/status` · `POST /subscription/portal` · `GET /subscription/credential`.
Lightning (B7): `POST /subscription/lightning` · `POST /webhook/lightning` · `GET /subscription/lightning/credential`.
SW: `GET /wl/config` · `POST /api/v1/credential/issue` · `POST /api/v1/keys/rotate` · `GET /api/v1/transfers` · `POST|GET|DELETE /api/v1/webhooks{/id}` · scheduled cron.
TG-block (new): `DELETE /transfer/{uuid}` (user-triggered destruction) · manifest fields `pending_destruction`, `consumed`, `available_from_timestamp`, `available_until_timestamp`.

---

## Testing infrastructure

Canonical reference: `TESTING.md` (repo root). Load for any testing session. **212 passing · 0 skipped · 8 suites** (6 unit + 2 integration). k6 load tests all green. CI Level 1 live. Level 2 (integration in CI) — B7–B8 scope.

---

## /notes/ article pipeline

12 articles planned at `refueler.io/notes/`. Full editorial detail: `notes-articles-list.md`. Articles 1–5: no product dependency (article 1 live). Article 6: unlocks post-B7 Lightning. Articles 8/11/12: post-SW. Article 7 (journalists): Susie (Bitcoin Policy UK) intro first. Key contact: BHODL co-founder (lawyer + Bitcoiner) — article 2 feedback.

**Article pipeline gated on node live (Hetzner).** First article written after NB-4. Four additional article topics identified at AP-10 — see REFUELER-BRIDGE.md §Editorial vocabulary.

---

## NUT protocol scope

| Status | NUTs |
|--------|------|
| Complete | NUT-00 (blind sig), NUT-07 (melt), NUT-11 Mode 1 (passphrase gate) |
| Deferred B8 | NUT-11 Mode 2 (keypair challenge-response, Prod Max) — review NUT-22 BATs before B8 design lock |
| Post-B8 | Argon2id as NUT-11 Mode 1 KDF extension |
| Deferred B10 | ML-KEM key wrapping |
| Monitor | NUT-10 v3 "Nutroot secrets" PR #421 — HIGH for B12/Pass |

---

## Future work + B9 scope

**B9:** Incident response tabletop (**gates SD-block launch** — first self-serve customer arrives there, before B9). `docs/incident-response.md` + `docs/security-breach.md` created AP-5. Build: status page incident panel, `incident_active` KV schema. SimpleX SMP on Instance C (own box, B9). Cyber Essentials Plus · G-Cloud · ISO 27001 · NHS DSPT · Defensive publication via IP.com (30 days after whitepaper).

**B12:** FROST threshold signatures — M-of-N co-signatories for credential issuance. Law firm partner sign-off, music masters delivery, film/VFX chain of custody.

**B8+:** Argon2id Enterprise KDF — WASM, client-side, m=65536 t=3 p=4. BIP-85 enterprise key management. Nostr keypair auth for dashboard (secp256k1 challenge-response).

**B10:** ML-KEM post-quantum key wrapping — Sovereign + Enterprise first, Citizen deferred.

**B9+:** Silent Payments (BIP-352) — requires full Bitcoin node. refueler-multi-core (Esplora fork) — post-B9.

**Publication-gated (B9 whitepaper §Future work only):** "Purchase a recovery window" — no product copy before shipping.

---

## Compression strategy (RU0 · B13)

Skip-compress via `fflate.ZipPassThrough` (STORED, method=0) for: Video (`.mov .mp4 .mxf .r3d .braw .ari .mkv .avi .wmv .webm .m4v`) · Audio (`.mp3 .aac .m4a .ogg .flac .opus`) · Images (`.jpg .jpeg .heic .heif .webp .avif`) · Archives (`.zip .gz .bz2 .xz .7z .rar`). PNG/TIFF/TXT/MD/CSV/JSON — keep `ZipDeflate` level 6. Never `{ level: 0 }` in ZipDeflate — macOS Archive Utility rejects DEFLATED method=8 with zero passes.

Market sequencing: lawyers/professionals first; creatives second. Speed honesty: "Faster than email. Slower than services that can read your files. That's the trade."

---

*"Nothing stops this train."*
