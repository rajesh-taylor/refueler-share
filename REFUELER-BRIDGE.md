# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 3.9 | **Created:** 28 July 2026 | **Updated:** CC-85 · 14 Aug 2026
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
| Admin dashboard pages `src/share/admin/` | Admin Worker endpoints, `Share-Master-Context.md`, `share-sessions.md` |
| Notes articles at `refueler.io/notes/` | `notes-articles-list.md` (editorial planning, load on demand) |

### Legend boundary
| `refueler-io` | `refueler-legend` |
|---|---|
| Legend Eleventy shell at `refueler.io/legend/` | Node infrastructure, FROST key management |
| `legend.css` (layout only) | `MASTER.md`, `legend-node-plan.md`, `legend-economics.md`, `legend-incident-protocol.md` |
| Legend wordmark + theme pill wiring | `legend-scope.md`, `legend-design-spec.md`, `legend-ux-language.md`, `legend-enterprise-pricing.md` |
| Articles 14/15/16 when published | PIR sharding layer, Tor API, Silent Payments scanner code, CryptoRoadmap files |

### Pass boundary
| `refueler-io` | `refueler-pass` |
|---|---|
| Pass shell at `refueler.io/pass/` (when live) | All Pass product logic, ticketing backend, credential engine |
| Pass nav integration | `PASS-MASTER.md`, `claude.md`, `SESSIONS-pass.md` — planning corpus |
| Pass Wallet card UI (app Pass tab — consumer-facing) | Cashu NUT implementation direction, varops logic, token state management |
| Consumer-app Pass tab (reward card front/reverse face display) | Cashu upgrade path spec (LNURL-withdraw → NUT-00), NUT-07 expiry sweep logic |
| | Two-credential-class architecture: access credentials (bearer + bound) and reward tokens |
| | Events × Pass × Merchant arc: post-scan entitlement, attendance credential, offer brokering |
| | Attendance credential blind-issued at gate; per-offer single-use sub-tokens (NUT-29) keep cross-merchant redemptions unlinkable. Commission keyed on offer-contract + merchant + event, never credential secret. |
| | UK legal exposure log (`pass-legal.md` — to follow) |

**Pass credential classes — governing distinction (do not conflate):**
- **Access credential** — non-monetary, closed-loop, no melt path. Bearer (transferable ticket, NUT-00) or bound (non-transferable access card, NUT-11 P2PK). Lives in `refueler-pass`.
- **Reward token** — monetary, spendable sats. LNURL-withdraw (v1) → Cashu NUT-00 (v2, post-mint). Card UI lives in `refueler-io` consumer app Pass tab; token logic lives in `refueler-pass`.

**Pass version gating:** v1 on Block 8. v2 on `refueler-mint` live + Events session + Pass-A. v2 is scoped correctly, not imminent.

### NumoPay fork boundary (new — CC-83)
| `refueler-io` | `numo-fork` |
|---|---|
| Merchant terminal receives orders from NumoPay via Supabase | In-house order entry, payment processing, menu management |
| Supabase shared schema — `orders`, `merchant_orders`, `venue_partners` | Android app code, NumoPay-specific UI |
| Darwin intelligence (horizon strip) — terminal only | Floor/waiter UI — phone only |

**Cross-repo session log rule:** Any session touching both repos gets one cross-reference line in each log.

---

## Supabase — shared backend

**Project:** `tihgvdokeofnjxjkenmm`
**All DDL via `apply_migration` only. `execute_sql` read-only. RLS on every table — no exceptions.**

### Schema state (post-CC-82, pre-CC-83b)
Key tables: `venue_partners` · `merchant_users` · `orders` · `merchant_orders` · `stamp_programmes` · `merchant_billing`

**Pending CC-83b migrations:**
- Drop `partners_public_read` policy (security — `qual: true` exposed entire table publicly)
- Add `venue_partners.logo_url TEXT`
- Add `venue_partners.pin_bg_url TEXT`
- Add `venue_partners.stamp_feature_enabled BOOLEAN DEFAULT false`
- Add `orders.commission_status TEXT`
- Add `orders.reward_status TEXT`
- Delete orphan `merchant_users` row (venue_id NULL, role independent_owner)

### RLS policy state
- `venue_partners`: `merchant_select_own_venue` covers merchant/franchise_branch/independent_owner. `franchise_hq_select_own_group_venues` covers franchise HQ. `admin_full_access_venue_partners` covers admin. `partners_public_read` (DROP in CC-83b — security fix).
- `merchant_orders`: merchant/independent_owner reads own venue only.
- `orders`: RLS enabled.

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
- Logo state: 32×32px square logo · divider · "MERCHANT TERMINAL"
- Right: QUEUE·OPS·OWNER merged pill (42px, OWNER gold tint) · separator · PAPER·CARBON pill

### Horizon strip
- Always dark `#1A1A1A` · 64px height
- Station name: IBM Plex Mono 15px `#E4E2DC` · ETA: gold · counts: `#A8A4A0` uniform
- Urgency via background tint only (no gold on numbers)

### Order tiles
- `[ID] · [items]` single line · status badge right only · larger text and badge boxes
- PENDING gold · IN PREP blue `#7899D4` · READY green `#3DCA7A`

### Portrait layout (CC-84)
- Option 2: sidebar stacks above main as horizontal-scroll card strip. CSS-only.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track |
| CC-66 | refueler-io, Supabase | Schema hardening |
| CC-69 | refueler-io, refueler-app, Supabase | Consumer app ↔ terminal connection |
| CC-81 | refueler-io, Supabase | Franchise dashboard |
| CC-82 | refueler-io, Supabase | Block 5 pre-work, test env, E2E |
| CC-83 | refueler-io (design only) | Terminal nav/UI design locked — no schema changes |
| CC-83b | refueler-io, Supabase | Production code: migrations, nav HTML/CSS/JS |
| **CC-84** | refueler-io, Supabase | Portrait layout (S-16), walk-in overlay, New Order bar, cc84_walkin_schema migration, steakhouse coords. Commit d0defcc. |
| **CC-85** | refueler-io | Branded magic link email, first full sim run. Commits 17ecb40, 306a587. |
| **Onboarding-A (next)** | refueler-io | Merchant onboarding flow + printed handover document. Opus uncounted. |
| **Pass-0** | refueler-pass | Founding scope session. PASS-MASTER.md v1.0, claude.md v1.0, SESSIONS-pass.md produced. Two-credential-class model locked. Events × Pass × Merchant arc established. |
| **Pass-0b** | refueler-pass, refueler-io, refueler-share, refueler-legend | Housekeeping: BRIDGE v3.7 (Pass boundary added), SESSIONS-pass.md updated, claude.md updated. BRIDGE committed to all four repos. |
| **Pass-1** | refueler-pass | Bitcoin Events × Pass × Merchant. PASS-MASTER.md v2.0: GDPR map, per-audience pitch, redemption data-flow audit, cross-merchant sub-token fix (P0 spike), credential data model, Fedimint/Madeira mechanics. claude.md v1.2, SESSIONS-pass updated. |

---

## Active action items (Rajesh)

- Push `refueler-app` dev branch: fix PAT placeholder in remote URL, push dev branch
- Disconnect `share.refueler.io` custom domain from Cloudflare Pages, delete/disable project
- Upgrade Supabase to Pro when first real merchant goes live — realtime order polling will push egress beyond free tier limit
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume
- Send Mapbox coordinate accuracy email (drafted CC-84, in drafts)
- Test portrait layout on physical tablet; visit Apple Store (iPad 10.9" primary target)
- football-data.org API key held by Rajesh — ready for Events intelligence layer session
- **[Pass]** Solicitor briefing brief to draft before appointment — touting law, refunds vs unlinkability, AML on primary sale (bundle with ecosystem lawyer session)
- **[Pass]** New P0 spike: cross-merchant redemption unlinkability — per-offer single-use sub-tokens (NUT-29) — before any v2 build begins.
- **[Pass]** New P1 spike: issuance timing-correlation resistance.
- **[Pass]** New solicitor P1: GDPR controllership mapping — purchase record controller, credential outside personal-data perimeter, singling-out in organiser's hands.

---

## NumoPay fork — context (new CC-83)

**Base:** `cashubtc/Numo` v1.8 — Lightning/Cashu, menu download, webhooks, Minibits wallet tested by Rajesh.
**Fork:** `rajesh-taylor/numo-fork` v1.6 — clean, no changes. Local only.
**Timing:** NumoPay-A planning session after Block 5 sim-close.
**BitChat research:** Bluetooth mesh sync for offline resilience — log for NumoPay-A.
**Competitive angle:** No dedicated hardware vs Square KDS (£599+ hardware + subscription). Tablet they already own. Family-run business positioning.

---

*"Nothing stops this train."*
