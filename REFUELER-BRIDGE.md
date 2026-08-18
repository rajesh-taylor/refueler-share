# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 4.7 | **Created:** 28 July 2026 | **Updated:** TDP-C · CC-98 · 2026-08-18
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), `refueler-pass/` (root), and `numo-fork/` (root).
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant terminal (Fenchurch St line cafés and restaurants — tablet, counter/kitchen) · NumoPay fork (in-house order taking, Android phone, waiter/floor staff) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · Consumer app (React Native, Blink Lightning — customer-facing, pre-orders + Legend + Pass)

**North star (internal only):** *Come for privacy, stay for Bitcoin.*

**Merchant profile (locked TDP-A):** Small, family-run independent businesses — cafés, coffee shops, delis, local restaurants. Community relationships, care over throughput. Not multi-national franchises. Not high-volume kitchens. Not competing with Square/Toast/Lightspeed. First merchants likely in Essex (Southend, Leigh-on-Sea, Westcliff) before London corridor.

**Local paths:** Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/` · Share: `/Users/rajeshtaylor/Documents/refueler-share/` · Legend: `/Users/rajeshtaylor/Documents/refueler-legend/` · NumoPay fork: `/Users/rajeshtaylor/Documents/refueler.io/terminals/numo-fork/` · Pass: `/Users/rajeshtaylor/Documents/refueler-pass/`

**GitHub:** `github.com/rajesh-taylor`

---

## Product architecture — confirmed CC-83

| Product | Repo | Audience | Form factor |
|---|---|---|---|
| Consumer app | `refueler-app` | Customers | Mobile (portrait) |
| Merchant terminal | `refueler-io/src/merchant/` | Counter/kitchen staff | Tablet, landscape + portrait |
| NumoPay fork | `numo-fork` (cashubtc/Numo v1.8 base) | Waiter/floor staff | Android phone, portrait |
| Command Centre | `refueler-io/src/command-centre/` | Franchise HQ / admin | Desktop |

**Order flow:** consumer app places order → merchant terminal receives → NumoPay handles in-venue fulfilment and payment.

---

## Repo boundary rule

> **If a browser requests it at `refueler.io`, it lives in `refueler-io`. Worker infrastructure and backend logic live in `refueler-share` or `refueler-legend`. Pass product logic and the credential engine live in `refueler-pass`.**

### Share boundary
| `refueler-io` | `refueler-share` |
|---|---|
| All Nunjucks templates at `refueler.io/share/*` | Cloudflare Worker (`worker/src/index.js`), `wrangler.toml` |
| `share-nav.njk`, `share-footer.njk`, `share.js`, `blake3/` | BLAKE3 source + build tooling |
| Admin dashboard pages `src/share/admin/` | Admin Worker endpoints |
| Notes articles at `refueler.io/notes/` | `notes-articles-list.md` (editorial planning) |

### Legend boundary
| `refueler-io` | `refueler-legend` |
|---|---|
| Legend Eleventy shell at `refueler.io/legend/` | Node infrastructure, FROST key management |
| `legend.css` (layout only) | `MASTER.md`, `legend-node-plan.md`, `legend-economics.md` |
| Legend wordmark + theme pill wiring | `legend-scope.md`, `legend-design-spec.md`, `legend-enterprise-pricing.md` |

### Pass boundary
| `refueler-io` | `refueler-pass` |
|---|---|
| Pass shell at `refueler.io/pass/` (when live) | All Pass product logic, ticketing backend, credential engine |
| Pass nav integration | `PASS-MASTER.md`, `claude.md`, `SESSIONS-pass.md` |
| Pass Wallet card UI (app Pass tab) | Cashu NUT implementation, varops logic, token state management |

**Pass credential classes:**
- **Access credential** — non-monetary, closed-loop, no melt path. Bearer (NUT-00) or bound (NUT-11 P2PK).
- **Reward token** — monetary, spendable sats. LNURL-withdraw (v1) → Cashu NUT-00 (v2, post-mint).
- **Proxy pickup credential** (logged CC-96) — bearer or named authorisation for delegated order collection. 6-digit code or NFC tap. Pass primitive, not a stamp primitive.

### NumoPay fork boundary
| `refueler-io` | `numo-fork` |
|---|---|
| Merchant terminal receives pre-orders from consumer app via Supabase | In-venue order entry, floor staff payment processing |
| Supabase shared schema — `orders`, `merchant_orders`, `venue_partners` | Android app code, NumoPay-specific UI, item catalogue (local → Supabase in NumoPay-A) |

---

## Supabase — shared backend

**Project:** `tihgvdokeofnjxjkenmm`
**All DDL via `apply_migration` only. `execute_sql` read-only. RLS on every table — no exceptions.**

---

## Design system — canonical tokens

**Paper (public web default):** `--bg: #E8E2D8` · `--fg: #1A1A1A` · `--surface: #DAD4CA`
**Carbon (app/terminal default):** `--bg: #1A1A1A` · `--fg: #E8E2D8` · `--surface: #242424`
**Gold:** `#C8A96E` · **Success:** `#27AE60`
**Fonts:** Satoshi (headings) · DM Sans (UI) · IBM Plex Mono (data) · Source Serif 4 (editorial)
**Theme persistence:** `rs-theme` cookie (web, `.refueler.io`, 30-day rolling) · `rfTheme` localStorage (terminal only).
**Abolished:** `#F5820A` orange · `#F7F4EF` (stale Paper) · `#1E1F22` (stale Carbon) · `backdrop-filter` · `localStorage` for web theme · `rfTheme` on web · `--accent-action`

**NumoPay Android theming (NumoPay-A agenda):** Carbon token set maps to Android `res/values/themes.xml`, `colors.xml`, `dimens.xml`. `Theme.Numo` to be reskinned to Refueler Carbon. CSS does not apply — Android XML resources only.

---

## Terminal design philosophy — locked CC-96

**Keystone:** The terminal is an arrival instrument, not an order-management system. Its job is to tell a craftsperson when their customer is about to walk in. If a surface does not help the merchant know who is coming, serve them well, or run their own shop on their own terms, it does not belong on this terminal.

**Register test:** It should behave like a good maître d' — present when needed, invisible when not, never flustered, always a half-step ahead, working for the merchant rather than the other way round.

**The terminal gets quieter and clearer under load, not louder.**

**Sidebar:** Removed CC-97. Darwin promoted to horizon strip. 340px reclaimed for queue. Mapbox dependency removal deferred TDP-C.

**Horizon strip — slot-based arrival-intelligence primitive (locked CC-96, built CC-97):**
`HORIZON_TENANTS = ['rail']`. Dispatches to `renderRailTenant()`. Fixture tenant stub present. Pass tenant is a comment only. Strip mirrored to Owner tab via `_mirrorHorizonToOwner()` — no extra fetch. Darwin/fixtures UI toggle deferred to CC-98 / Events intelligence layer session.

**Payment architecture — locked CC-97:**
`create-order` v10 uses LNURL-pay. Invoices go to `venue_partners.lightning_address` directly. Refueler's Blink account is never in the consumer→merchant path. Blink float = Refueler operating sats only (reward payouts). Fiat commission → Stripe → bank account (Revolut Business recommended).

**Owner tab (behind Owner PIN gate):**
- Stats, horizon strip (mirrored), Lightning address (display + change flow via `update-lightning-address` EF v1), on-chain address (display + privacy nudge), sign out.
- On-chain address changes are `[R]` (dashboard-only) permanently for now.
- Legend Owner tab integration (embedded balance/tx panel) — dedicated session, post-B9 when Legend API is live.

**Lightning address change flow (live CC-98):**
- Owner PIN re-auth → overlay → save via `update-lightning-address` v1 Edge Function.
- Function verifies Owner PIN server-side (bcrypt), validates LNURL reachability (fail-closed, 5s timeout), writes via service_role, post-write verifies (rule 4j).
- After any address change: AM or Rajesh sends 21 sats from Blink ops wallet to confirm receipt. Logged in crypto ops ledger.
- Rate limit: 5 attempts / 5 minutes per user (in-memory).

**Stamps:**
- Silent, passive issuance. Trigger: FULFILLED (READY status). `✦` glyph settles on tile.
- Plumbing-agnostic: same visual for LNURL-withdraw (v1) and Cashu NUT-00 (v2).
- Stamp metrics: reserved in Owner tab. Not built until Block 8 / post-mint.

---

## NumoPay fork — alignment findings (TDP-C, CC-98)

**Base:** cashubtc/Numo v1.8. **Package:** `io.refueler.merchant`. **Fork:** `rajesh-taylor/numo-fork`.
**Hardening phases 1–3:** complete (EventModeManager, EncryptedSharedPreferences, Svix webhook).
**Current state:** Clean v1.8 base with Refueler package name. No Supabase integration yet.

**Key capabilities already in the fork (relevant to NumoPay-A):**
- `OnboardingActivity` — first launch flow (needs replacing/wrapping for Supabase magic link auth)
- `ModernPOSActivity` — main POS screen, portrait Android
- `PinEntryActivity` / `PinSetupActivity` / `PinResetActivity` — PIN security built natively
- `ItemListActivity` / `ItemEntryActivity` / `ItemSelectionActivity` / basket system — item catalogue built
- `WebhookSettingsActivity` — webhook config UI exists
- `PaymentRequestActivity` — NFC/QR/Lightning request (Cashu-native; payment routing needs adapting)
- `InsightsActivity` / `PaymentsHistoryActivity` — history and analytics built
- `AutoWithdrawSettingsActivity` — automatic withdrawal threshold

**Stack:** OkHttp3 + Jackson + Gson (no Retrofit). `cdk-android:0.17.2-rc.1` — note `-rc.1` suffix, confirm vs stable before any Cashu work in NumoPay-A.

**NumoPay-A agenda items (locked TDP-C):**

| Item | Decision |
|---|---|
| Auth model | Replace/wrap `OnboardingActivity` with Supabase magic link + staff PIN. Screen-on flag; no mid-shift re-auth. Staff PIN only during shift. |
| Payment routing | Order entry → `merchant_orders` via Supabase. Not Cashu melt for floor orders. |
| Item catalogue source | Supabase `merchant_menu_items` (single source of truth). Study NumoPay's native catalogue UI/UX first. |
| Noun/verb/handle taxonomy | Order code as universal join key across consumer app → terminal → NumoPay. |
| Android theming | Map Refueler Carbon token set to `themes.xml` / `colors.xml` / `dimens.xml`. |
| `cdk-android:0.17.2-rc.1` | Confirm -rc.1 vs stable before any Cashu work begins. |
| Source files to attach | `OnboardingActivity`, `ModernPOSActivity`, `WebhookSettingsActivity` — attach manually at NumoPay-A open. |

---

## Ops wallet — locked CC-98

**Blink ops wallet ("Refueler Ops"):** Second BTC wallet under same Blink account, separate from treasury (`fd2357fe`). Used exclusively for onboarding test payments, Lightning address confirmation (21-sat sends), and support call testing. Top-ups logged as business expense in Refueler Crypto Ops Ledger (sats + GBP equivalent at time of transfer).

**AM access model (current):** Rajesh holds wallet. AM requests top-up; Rajesh transfers internally (Blink → Blink, instant, no fee). AM never uses personal wallet for Refueler business.

**Long-term (Staff Management v1):** Separate Blink account for AM, small dedicated balance, funded by internal transfer. Ops wallet balance monitoring via dev console (add wallet ID to `blink-balance` EF) when volume justifies it.

**Single-provider risk:** Both wallets affected if Blink is down. Accepted for pre-merchant phase. Review at Block 8 planning when reward payouts are live in anger.

---

## Incident response — locked Sim-Close

**Protocol:** `INCIDENT-PROTOCOL.md` in `refueler-io/docs/`.
**Internal channel:** Signal. **External (merchants):** Tuta `hello@refueler.io`. **Public:** `refueler.io/status/` only.
**Core rule:** Internal → contain → public.

---

## Merchant handover documents — locked Design-A

Files in `refueler-io/docs/`: `merchant-onboarding-v1.html`, `merchant-venue-keys-v1.html`, `merchant-onboarding-process-v1.html`, `INCIDENT-PROTOCOL.md`.

**Docs ↔ UI sync rule (active):** confirm currency at every block close touching terminal UI.

**September User Guide update (flagged CC-98):**
- Add Lightning address change section: after any change, AM sends 21-sat confirmation from Blink ops wallet. Log in crypto ops ledger.
- Add anti-phishing panel: "Refueler will never send a link you didn't request."
- On-chain address changes are support-only (`[R]`).
- AM onboarding checklist: log 21-sat confirmation send in onboarding expense record.

---

## Sim-Close — DECLARED COMPLETE (2026-08-17)

Pre-merchant gate list:
- **G-1** ✅ CLEARED CC-97 — LNURL-pay, `create-order` v10.
- **G-2** (hard blocker): Menu Management v1. After TDP-C.
- **G-3**: iPad physical check. Before first real merchant.
- **G-4**: ✅ Hardening-A — cleared CC-94.
- **G-5**: ✅ S-26 FK — cleared CC-94.

---

## Share — platform notes

**Pay-per-use API (planning — pre-AD-2):** Metered API for professional photographers and legal. Full plan in a dedicated Share API planning session.
**Safari upload ceiling:** ~1.5 GB real-world ceiling on current in-memory upload path. Do not headline large-file capability on Safari.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| CC-84 | refueler-io, Supabase | Portrait layout, walk-in overlay. Commit d0defcc. |
| CC-85 | refueler-io | Magic link email, first full sim run. |
| Design-A | refueler-io | Two merchant handover docs. ✅ Closed. |
| **Block-5 Close** | refueler-io | Block 5 review. Sim stages ratified. ✅ Closed. |
| **CC-92** | refueler-io, Supabase | Stage 3 payment simulation PASSED. ✅ Closed. |
| **Sim-Close** | refueler-io | Formal sign-off. INCIDENT-PROTOCOL.md. ✅ Closed. |
| **CC-94 / Hardening-A** | refueler-io, Supabase | Six migrations. G-4, G-5 cleared. ✅ Closed. |
| **CC-95 / TDP-A** | refueler-io | Terminal audit. Eight drift findings. S-27 added. ✅ Closed. |
| **CC-96 / TDP-philosophy** | refueler-io | Design philosophy locked. Sidebar removed. Strip promoted. ✅ Closed. |
| **CC-97 / TDP-B** | refueler-io, Supabase | Terminal redesign. G-1 cleared. S-27 deployed. ✅ Closed. |
| **CC-98 / TDP-C** | refueler-io, Supabase, numo-fork | `update-lightning-address` v1 deployed. NumoPay alignment. BRIDGE v4.7. ✅ Closed. |
| Pass-0 | refueler-pass | Founding scope. Two-credential-class model locked. |
| Pass-1 | refueler-pass | Bitcoin Events × Pass × Merchant. PASS-MASTER.md v2.0. |

---

## Active action items (Rajesh)

- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant)
- **Open Blink ops wallet ("Refueler Ops")** ← second BTC wallet in Blink mobile app, for onboarding/testing
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns; separate from fiat ledger
- Push updated BRIDGE v4.7 to `numo-fork/` root (re-run after numo-fork rebase resolves)
- Push BRIDGE v4.7 to `refueler-share/`, `refueler-legend/`, `refueler-pass/` root and `refueler-io/docs/`
- Add test `onchain_address` to Raj's Steakhouse in Supabase dashboard (verify Owner tab display)
- Push `refueler-app` dev branch ← CA-1 prerequisite
- Disconnect `share.refueler.io` from Cloudflare Pages
- Upgrade Supabase to Pro when first real merchant goes live
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume
- Send Mapbox coordinate accuracy email (drafted CC-84, in drafts)
- Visit Apple Store — iPad 10.9″ portrait layout check (G-3, before first real merchant)
- New Anthropic API key → rotate before csuite briefing reuse
- football-data.org API key held by Rajesh — ready for Events intelligence layer session
- **[Pass]** Solicitor briefing brief to draft before appointment
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29) before v2 build
- **[Pass]** P1 spike: issuance timing-correlation resistance
- **[All products]** Privacy page update queued
- **[All products]** Docs ↔ UI sync rule active from Design-A

---

## NumoPay fork — context

**Base:** cashubtc/Numo v1.8. **Fork:** `rajesh-taylor/numo-fork`. Hardening phases 1–3 complete.
**Timing:** NumoPay-A after TDP-C. Attach `OnboardingActivity`, `ModernPOSActivity`, `WebhookSettingsActivity` source files manually at NumoPay-A open.

---

*"Nothing stops this train."*
