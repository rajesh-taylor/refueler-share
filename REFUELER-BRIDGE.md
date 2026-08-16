# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 4.2 | **Created:** 28 July 2026 | **Updated:** Block-5 Close · 2026-08-16
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), and `refueler-pass/` (root). Committed to each at every block close.
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant terminal (Fenchurch St line cafés and restaurants — tablet, counter/kitchen) · NumoPay fork (in-house order taking, Android phone, waiter/floor staff) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · Consumer app (React Native, Blink Lightning — customer-facing, pre-orders + Legend + Pass)

**North star (internal only):** *Come for privacy, stay for Bitcoin.*

**Local paths:** Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/` · Share: `/Users/rajeshtaylor/Documents/refueler-share/` · Legend: `/Users/rajeshtaylor/Documents/refueler-legend/` · NumoPay fork: `/Users/rajeshtaylor/Documents/refueler.io/terminals/numo-fork/` · Pass: `/Users/rajeshtaylor/Documents/refueler-pass/`

**GitHub:** `github.com/rajesh-taylor`

---

## Product architecture — confirmed CC-83

| Product | Repo | Audience | Form factor |
|---|---|---|---|
| Consumer app | `refueler-app` | Customers | Mobile (portrait) |
| Merchant terminal | `refueler-io/src/merchant/` | Counter/kitchen staff | Tablet, landscape + portrait |
| NumoPay fork | `numo-fork` (cashubtc/Numo v1.6 base) | Waiter/floor staff | Android phone, portrait |
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

### NumoPay fork boundary
| `refueler-io` | `numo-fork` |
|---|---|
| Merchant terminal receives orders from NumoPay via Supabase | In-house order entry, payment processing, menu management |
| Supabase shared schema — `orders`, `merchant_orders`, `venue_partners` | Android app code, NumoPay-specific UI |

---

## Supabase — shared backend

**Project:** `tihgvdokeofnjxjkenmm`
**All DDL via `apply_migration` only. `execute_sql` read-only. RLS on every table — no exceptions.**

**Pending migration (next Sonnet session — highest priority):** `venue_partners` additions:
- `lightning_address TEXT`
- `onchain_address TEXT`
- `silent_payment_address TEXT`
- `mapbox_place_id TEXT`

---

## Design system — canonical tokens

**Paper (public web default):** `--bg: #E8E2D8` · `--fg: #1A1A1A` · `--surface: #DAD4CA`
**Carbon (app/terminal default):** `--bg: #1A1A1A` · `--fg: #E8E2D8` · `--surface: #242424`
**Gold:** `#C8A96E` · **Success:** `#27AE60`
**Fonts:** Satoshi (headings) · DM Sans (UI) · IBM Plex Mono (data) · Source Serif 4 (editorial)
**Theme persistence:** `rs-theme` cookie, `.refueler.io`, 30-day rolling. Never localStorage.
**Abolished:** `#F5820A` orange · `backdrop-filter` · `localStorage` theme · `rfTheme` · `--accent-action`

---

## Merchant terminal — design locked CC-83

### Nav
- Default (no logo): Refueler wordmark (Satoshi 700, 16px, `#E4E2DC`) · divider · "MERCHANT TERMINAL" (IBM Plex Mono, 12px, `#C8C9CB`)
- Right: QUEUE·OPS·OWNER merged pill (42px, OWNER gold tint) · separator · PAPER·CARBON pill

### Horizon strip
- Always dark `#1A1A1A` · 64px height
- Station name: IBM Plex Mono 15px `#E4E2DC` · ETA: gold · counts: `#A8A4A0` uniform
- "DARWIN · LIVE" label hidden by default — strip height and ETA are the implicit liveness signal

### Order tiles
- `[ID] · [items]` single line · status badge right only
- PENDING gold · IN PREP blue `#7899D4` · READY green `#3DCA7A`

### Portrait layout (CC-84)
- Option A: sidebar collapses to horizontal-scroll card strip above main. CSS-only.
- `@media (orientation: portrait), (max-width: 820px)`

---

## Merchant handover documents — locked Design-A

**Files committed f0157ef to `refueler-io/docs/`:**
- `merchant-onboarding-v1.html` — User Guide, 6 A4 pages, print-ready standalone
- `merchant-venue-keys-v1.html` — Venue Keys card, 1 A4 page, print-ready standalone
- `merchant-onboarding-process-v1.html` — Internal process doc (to produce — Stage 1 sim deliverable)

**Key rules:**
- Standalone HTML files. Each prints independently as its own PDF.
- Gold on section h2 dividers and warn-banner left-border only.
- All sensitive values (Owner PIN, wallet addresses, Staff PIN) handwritten at handover — never typed.
- Open in Chrome for cleanest PDF output.
- Docs will iterate. Do not print full runs until design is stable.
- Docs ↔ UI sync rule active: confirm currency at every block close touching terminal UI.

**Future Owner tab integration (queued post Sim-Close):**
- Two downloadable document tiles in Owner tab.
- Amber dot: new version available. Green: current version downloaded.

---

## Block 5 — status (Block-5 Close · 2026-08-16)

**Closed as: capability complete. No go-live date.**

London merchants are experienced operators with expensive overheads (business rates, utilities). They will not give time to a startup unless the product is polished. Gaps in design, UX, payments depth, and menu management are too significant to gloss over. Foundational work comes first.

**Sim-Close stages (ratified Block-5 Close):**
- Stage 1: Internal onboarding process doc — to produce.
- Stage 2: Operational sim — PASSED (browser). iPad check non-blocking.
- Stage 3: Payment sim — not yet run. Standalone Sonnet session, gated on schema migration.
- Stage 4: Physical handover — non-blocking. Print when stable.

**Permanently closed snags:** S-12 (`car_park_occupancy` — strip from FEEDS array on next `rail-signal-poll` touch) · S-14 (Costa label — fix on next `rail-signal-poll` touch).

---

## Share — platform notes (logged Block-5 Close · 2026-08-16)

**Pay-per-use API (planning — pre-AD-2):**
A metered pay-per-use Share API is scoped ahead of AD-2. Initial v1 segments: **professional photographers** (deliver large shoots to clients who needn't hold an account) and **legal** (transfer survives sender closing laptop; recipient needn't be sophisticated — the two-axis category, AP-7). Staging: v1 metered API for these segments → v2 broaden → v3 white-label option (partner-branded Share). **Recipient flywheel:** every anonymous recipient is a latent sender — the download page is a growth asset, not a dead end. Full plan in a dedicated Share API planning session (queue after foundational terminal work, before AD-2).

**Safari upload ceiling (constraint):**
Safari imposes an effective ~1.5 GB real-world ceiling on the current in-memory upload path, well below the advertised 4 GB free-tier figure. **Fix:** chunked streaming encryption (encrypt-and-upload per chunk rather than whole-file in memory) lifts the ceiling toward the true tier limit. **Copy implication:** do not headline large-file capability on Safari; the "4 GB free" claim must not imply a 4 GB Safari upload works today. Honesty-scope rule applies — reconcile tier figure with Safari reality in any Share marketing copy.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| CC-66 | refueler-io, Supabase | Schema hardening |
| CC-69 | refueler-io, refueler-app, Supabase | Consumer app ↔ terminal connection |
| CC-81 | refueler-io, Supabase | Franchise dashboard |
| CC-82 | refueler-io, Supabase | Block 5 pre-work, test env, E2E |
| CC-83 | refueler-io (design only) | Terminal nav/UI design locked |
| CC-83b | refueler-io, Supabase | Production code: migrations, nav HTML/CSS/JS |
| CC-84 | refueler-io, Supabase | Portrait layout, walk-in overlay, New Order bar. Commit d0defcc. |
| CC-85 | refueler-io | Magic link email, first full sim run. Commits 17ecb40, 306a587. |
| Onboarding-A | refueler-io | Merchant onboarding flow + handover copy v3. ✅ Closed. |
| Design-A | refueler-io | Two merchant handover docs. Commit f0157ef. ✅ Closed. |
| **Block-5 Close** | refueler-io | Block 5 review. Go-live pressure removed. Sim stages ratified. BRIDGE v4.2. ✅ Closed. |
| Pass-0 | refueler-pass | Founding scope. Two-credential-class model locked. |
| Pass-0b | refueler-pass, refueler-io, refueler-share, refueler-legend | BRIDGE v3.7. |
| Pass-1 | refueler-pass | Bitcoin Events × Pass × Merchant. PASS-MASTER.md v2.0. |

---

## Active action items (Rajesh)

- Push `refueler-app` dev branch
- Disconnect `share.refueler.io` from Cloudflare Pages
- Upgrade Supabase to Pro when first real merchant goes live
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume
- Send Mapbox coordinate accuracy email (drafted CC-84, in drafts)
- Visit Apple Store — iPad 10.9″ portrait layout check (non-blocking)
- Provide Lightning address for Raj's Steakhouse for payment sim (Stage 3)
- football-data.org API key held by Rajesh — ready for Events intelligence layer session
- **[Pass]** Solicitor briefing brief to draft before appointment
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29) before v2 build
- **[Pass]** P1 spike: issuance timing-correlation resistance
- **[Pass]** Solicitor P1: GDPR controllership mapping
- **[Merchant terminal]** S-23 + S-24: bundle into one Sonnet session — next after schema migration
- **[Merchant terminal]** Schema migration: 4 cols on `venue_partners` — next counted session
- **[All products]** Privacy page update queued
- **[All products]** Docs ↔ UI sync rule active from Design-A
- **[Planning]** TDP-A/B/C: after Stage 3 sim passes, before Menu Management v1

---

## NumoPay fork — context

**Base:** `cashubtc/Numo` v1.8. **Fork:** `rajesh-taylor/numo-fork` v1.6 — clean, no changes.
**Timing:** NumoPay-A after TDP-C.
**Competitive angle:** No dedicated hardware vs Square KDS. Tablet they already own.

---

*"Nothing stops this train."*
