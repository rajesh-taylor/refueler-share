# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 4.5 | **Created:** 28 July 2026 | **Updated:** TDP-philosophy · CC-96 · 2026-08-18
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), and `refueler-pass/` (root). Committed to each at every block close.
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
- **Proxy pickup credential** (logged CC-96) — bearer or named authorisation for delegated order collection. 6-digit code or NFC tap. Pass primitive, not a stamp primitive. Use cases: gift/refer-a-friend, delegated pickup, pub rounds. Log against Pass-A scope and Bitcoin Events × Pass × Merchant arc.

### NumoPay fork boundary
| `refueler-io` | `numo-fork` |
|---|---|
| Merchant terminal receives orders from NumoPay via Supabase | In-house order entry, payment processing, menu management |
| Supabase shared schema — `orders`, `merchant_orders`, `venue_partners` | Android app code, NumoPay-specific UI |

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
**Theme persistence:** `rs-theme` cookie, `.refueler.io`, 30-day rolling. Never localStorage.
**Abolished:** `#F5820A` orange · `#F7F4EF` (stale Paper) · `#1E1F22` (stale Carbon) · `backdrop-filter` · `localStorage` theme · `rfTheme` · `--accent-action`

---

## Terminal design philosophy — locked CC-96

**Keystone:** The terminal is an arrival instrument, not an order-management system. Its job is to tell a craftsperson when their customer is about to walk in. If a surface does not help the merchant know who is coming, serve them well, or run their own shop on their own terms, it does not belong on this terminal.

**Register test:** It should behave like a good maître d' — present when needed, invisible when not, never flustered, always a half-step ahead, working for the merchant rather than the other way round.

**The terminal gets quieter and clearer under load, not louder.**

**Sidebar:** Removed. Darwin promoted to horizon strip. 340px reclaimed for queue.

**Horizon strip — slot-based arrival-intelligence primitive:**
Not a Darwin component. Tenants provisioned at venue setup by `mapbox_place_id` proximity:
- Darwin/rail (Fenchurch St corridor and station-adjacent venues)
- Fixtures (football-data.org, venues near stadia)
- Both (venues in both catchments — two rows or two segments)
- Pass (future tenant — pending its own Opus design session(s) before integration)

TDP-B builds the slot primitive. The fixture tenant is stubbed. Pass is a comment only.

**Stamps:**
- Silent, passive issuance. Trigger: FULFILLED (READY status). Not paid.
- Calm glyph settles onto tile on completion. No merchant action required.
- Plumbing-agnostic: same visual for LNURL-withdraw (v1) and Cashu NUT-00 (v2). The mint swap is a backend event; must never surface as a merchant-facing change.
- Stamp metrics: privacy-preserving aggregates (not individual tracking). Reserved in Owner tab. Not built until Block 8 / post-mint.

**Accessibility principles (six, not WCAG):**
1. Legible at two feet without spectacles. Identifier ≥18px floor.
2. Status never colour alone — always word + position.
3. Nothing critical depends on hearing.
4. No motion that demands. No urgency timers.
5. Generous targets, forgiving taps.
6. The terminal never implies the merchant is late.

---

## Incident response — locked Sim-Close

**Protocol:** `INCIDENT-PROTOCOL.md` in `refueler-io/docs/`. Ecosystem-wide. Version 1.0, 2026-08-17.
**Relationship to `legend-incident-protocol.md`:** INCIDENT-PROTOCOL.md is the ecosystem parent.
**Internal channel:** Signal. **External (merchants):** Tuta `hello@refueler.io`. **Public:** `refueler.io/status/` only.
**Core rule:** Internal → contain → public. Never announce on the channel attackers are watching.

---

## Merchant handover documents — locked Design-A

**Files committed to `refueler-io/docs/`:**
- `merchant-onboarding-v1.html` — User Guide, 6 A4 pages (commit `f0157ef`)
- `merchant-venue-keys-v1.html` — Venue Keys card, 1 A4 page (commit `f0157ef`)
- `merchant-onboarding-process-v1.html` — Internal process doc (commit `a5cc342`)
- `INCIDENT-PROTOCOL.md` — Ecosystem-wide incident response (Sim-Close)

**Docs ↔ UI sync rule (active):** Confirm currency at every block close touching terminal UI.

---

## Sim-Close — DECLARED COMPLETE (2026-08-17)

Pre-merchant gate list:
- **G-1** (hard blocker): merchant settlement wiring. TDP-B gate item.
- **G-2** (hard blocker): Menu Management v1. After TDP-B.
- **G-3**: iPad physical check. Before first real merchant.
- **G-4**: ✅ Hardening-A — cleared CC-94.
- **G-5**: ✅ S-26 FK — cleared CC-94.

---

## Share — platform notes (logged Block-5 Close · 2026-08-16)

**Pay-per-use API (planning — pre-AD-2):** Metered API for professional photographers and legal. Recipient flywheel: download page is a growth asset. Full plan in a dedicated Share API planning session.

**Safari upload ceiling:** ~1.5 GB real-world ceiling on current in-memory upload path. Fix: chunked streaming encryption. Do not headline large-file capability on Safari.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| CC-83b | refueler-io, Supabase | Production code: migrations, nav HTML/CSS/JS |
| CC-84 | refueler-io, Supabase | Portrait layout, walk-in overlay. Commit d0defcc. |
| CC-85 | refueler-io | Magic link email, first full sim run. Commits 17ecb40, 306a587. |
| Onboarding-A | refueler-io | Merchant onboarding flow + handover copy v3. ✅ Closed. |
| Design-A | refueler-io | Two merchant handover docs. Commit f0157ef. ✅ Closed. |
| **Block-5 Close** | refueler-io | Block 5 review. Sim stages ratified. BRIDGE v4.2. ✅ Closed. |
| **CC-92** | refueler-io, Supabase | Stage 3 payment sim PASSED. ✅ Closed. |
| **Sim-Close** | refueler-io | Formal sign-off. INCIDENT-PROTOCOL.md. BRIDGE v4.3. ✅ Closed. |
| **CC-94 / Hardening-A** | refueler-io, Supabase | Six migrations. G-4, G-5 cleared. BRIDGE v4.3. ✅ Closed. |
| **CC-95 / TDP-A** | refueler-io | Terminal audit. Eight drift findings. S-27 added. BRIDGE v4.4. ✅ Closed. |
| **CC-96 / TDP-philosophy** | refueler-io | Design philosophy locked. Keystone. Sidebar removed. Strip promoted. Stamp architecture locked. Proxy pickup credential logged. BRIDGE v4.5. ✅ Closed. |
| Pass-0 | refueler-pass | Founding scope. Two-credential-class model locked. |
| Pass-1 | refueler-pass | Bitcoin Events × Pass × Merchant. PASS-MASTER.md v2.0. |

---

## Active action items (Rajesh)

- Push `refueler-app` dev branch ← CA-1 prerequisite
- Disconnect `share.refueler.io` from Cloudflare Pages
- Push BRIDGE v4.5 to `refueler-share/`, `refueler-legend/`, `refueler-pass/` root and `refueler-io/docs/`
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

**Base:** `cashubtc/Numo` v1.8. **Fork:** `rajesh-taylor/numo-fork` v1.6 — clean, no changes.
**Timing:** NumoPay-A after TDP-C.

---

*"Nothing stops this train."*
