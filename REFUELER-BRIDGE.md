# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 3.4 | **Created:** 28 July 2026 | **Updated:** Merchant-Sats-C · 11 Aug 2026
> Lives in `refueler-share/` (root), `refueler-io/docs/`, and `refueler-legend/` (root). Committed to each at every block close.
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant POS + Numo terminal (Fenchurch St line cafés and restaurants) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · Consumer app (React Native, Blink Lightning)

**North star (internal only):** *Come for privacy, stay for Bitcoin.*

**Local paths:** Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/` · Share: `/Users/rajeshtaylor/Documents/refueler-share/` · Legend: `/Users/rajeshtaylor/Documents/refueler-legend/`

**GitHub:** `github.com/rajesh-taylor`

---

## Repo boundary rule

> **If a browser requests it at `refueler.io`, it lives in `refueler-io`. Worker infrastructure and backend logic live in `refueler-share` or `refueler-legend`.**

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
| Pass nav integration | Pass-A/B planning docs, Pass MASTER.md |
| Pass Wallet card UI (app Pass tab — consumer-facing) | Varops logic, token state management, Cashu upgrade path |

**Cross-repo session log rule:** Any session touching both repos gets one cross-reference line in each log.

---

## Subdomain policy — locked CSS-1a

All products on `refueler.io/[product]/`. No new subdomains without documented technical constraint.

`share.refueler.io` migrated → `refueler.io/share/`. **Action required (Rajesh):** disconnect `share.refueler.io` from `refueler-share` Cloudflare Pages project, then delete/disable.

**Cloudflare Share:** Worker `refueler-share.rt-fc4.workers.dev` v`7a0183e1`. CORS: `https://refueler.io` + `https://share.refueler.io` (keep until Pages project retired). Turnstile: 2 hostnames. KV: upgrade to Paid ($5/month) before production.

---

## Navigation — locked CSS-7b

### Main site (`nav.njk`): Share · Legend · Notes · Editorial · Support · Privacy · pill
### Share nav (`share-nav.njk`): Plans · Notes · Support · Privacy · pill. Status footer-only.
### Legend nav: Wordmark · theme pill only. Carbon default.

**Footers stamp (all surfaces):** `© 2026 Refueler Ltd (incorporating) · refueler.io`
Main site footer links: Privacy · Support. Share footer: Privacy · Support · Status · Plans · Legend. Legend footer: Privacy · Support · Share.

**Homepage capability block** (links activate when homepage lock lifts, one month from CC-79):
Encrypted transfers → `/share/` · Bitcoin explorer → `/legend/` · Lightning payments → unlinked until Pass live.

**Product nav sequence:** When Pass live: Legend · Share · Pass. At four products: `Products ▾` grouping.

---

## Merchant terminal — locked decisions

**Auth flow:** Magic link → `/command-centre/` → role resolved via `merchant_users.user_id` (email lookup deprecated CC-82) → redirect to role destination.

**ROLE_DESTINATIONS:** merchant/franchise_branch/independent_owner → `/merchant/` · franchise_hq → `/franchise/` · admin → `/dev/` · investor → `/investor/`

**PIN gate:** `tablet-ui` div hidden until staff PIN accepted. Revealed by `onStaffAuthenticated()`. Known ~1 frame flash (S-1) — fix queued.

**Merchant nav (queued CC-83):** Queue/Ops mode as explicit two-state pill. Venue name centred (from `venue_partners.name`). Logo space allocated. `venue_partners.logo_url` column to be added.

**Mapbox:** Franchise dashboard venue map only. Not rendered on single-venue merchant tablet.

**Test/sim account:** `steakhouse@rajeshtaylor.com` · Raj's Steakhouse · 10 Trinity Square EC3N 4AJ · independent_owner · staff PIN 1234 · owner PIN 8888 · venue_id `c476df85` · **primary simulation entity**

---

## Merchant payment architecture — locked Merchant-Sats-A/B · 2026-08-11

### Core principle (ADR-MS-1)
Refueler is an orchestrator and attribution layer, never a custodian or intermediary. Consumer sats settle directly to the merchant's own wallet. Consumer fiat is processed by a licensed third party (Stripe for card; merchant's own acquirer for Numo walk-in). Blink float holds only Refueler's own received revenue — never consumer funds in transit. Model A permanently excluded.

### Commission (ADR-MS-2)
App-attributed orders only. Real-time fiat off-session Stripe charge (stored PaymentMethod + off-session PaymentIntent) on Lightning settlement confirmation. Rate recorded in `orders.commission_pct` at payment time (`merchant_billing.commission_rate` is the source). No Stripe Connect.

### Commission rate (ADR-MS-15)
4–8% of order value. Varies by merchant and franchise. Annual agreement renewal may alter. `merchant_billing.commission_rate` + `rate_effective_from` for audit trail. Historical orders retain original rate.

### Merchant billing (ADR-MS-16)
`merchant_billing` table separate from `venue_partners`. Stores `stripe_customer_id`, `has_default_pm`, `billing_status`, `delinquent_since`, `commission_rate`, `rate_effective_from`. Card data never in Supabase — Stripe-side.

### Commission retry (ADR-MS-17)
`charge-commission` Edge Function. Per-minute pg_cron. Up to 3 attempts, exponential backoff. After 3 fails: delinquent flag on `commission_charges` + `merchant_billing` + dev console alert.

### Loyalty stamps (ADR-MS-3 + ADR-MS-12 + ADR-MS-13)
Closed-loop, non-monetary Cashu ecash tokens. Cannot convert to sats or fiat. No FCA grey area.

**Multi-programme:** Up to 3 active stamp programmes per venue. Supports concurrent promotions (café by day / wine bar by evening use case). Programme selection: pre-order = customer selects in app; walk-in = time-window auto-assign → staff select → category tag (long-term). Max 3 enforced by DB trigger + application layer.

**Stamp track scaffolded Block 8, live pending `refueler-mint` deployment.** No interim identity-linked DB counter.

**Competitive research item:** Verify whether Square/Toast/KDS offer multi-programme concurrent stamps. Likely differentiator.

### Sats reward (ADR-MS-11 + ADR-MS-19–28)
LNURL-withdraw pull model. On settlement, Refueler creates a one-time Blink LNURL-withdraw token. Customer claims from their own wallet. Float debited on successful claim only. No Lightning address ever stored — ADR-4b honoured. `reward_payouts` table: token + lifecycle state only.

**Token expiry:** 7 days. Static date display. Unclaimed sats never destroyed — float never debited under pull model (ADR-MS-25).

**`orders.reward_status`:** Mirror column (`none|claimable|paused|claimed|expired|declined`). App's single read surface. Piggybacks existing per-order Realtime subscription. No new channel.

**`NO_WALLET` path → Pass Wallet card (ADR-MS-26):** Customers without a Lightning wallet receive the LNURL token as a card in the Pass tab. Front face: QR + amount. Single-use bearer instrument — any Lightning wallet can scan and claim. Reverse face: Refueler product referral surface (ADR-MS-27). No forwarding UX — screenshot-and-send is the natural gesture. Interim (before Pass tab exists): recovery-banner-only path.

**Cashu upgrade (ADR-MS-28):** When `refueler-mint` live, Pass Wallet card upgrades to Cashu NUT-00 token. Enables offline spend, transfer without QR, gifting via string. Float debited at issuance (not claim) — NUT-07 expiry sweep mandatory. **Sats must never be destroyed — standing constraint across all reward infrastructure.**

### Float (ADR-MS-18)
Refueler's own sats revenue only. Manual top-up by Rajesh. Low-water alert via pg_cron every 5 min → dev console tile + email. `float_config` + `float_ledger` admin-only.

### Walk-in commission trigger (ADR-MS-14)
Flows 3 & 4 (app walk-in fiat/Lightning): staff Accept action on tablet creates `commission_charges` row. Nightly reconciliation (02:00 UTC) flags attributed orders with no charge row within 24h. Gaming risk managed by merchant agreement.

### Numo (ADR-MS-4)
Standard merchant hardware recommendation. Scenario A (app present): attribution + commission + reward. Scenario B (no app): merchant's own Lightning address / Silent Payments, configured in owner-only terminal view. Scenario B anticipated to become dominant as Bitcoin adoption grows.

### The seven payment flows (ADR-MS-5)
1. App pre-order, Lightning — consumer → merchant wallet, commission charged real-time
2. App pre-order, fiat (Block 8) — Stripe processes, commission charged, reward offered (sats or stamp)
3. App walk-in, fiat — staff accept triggers commission charge
4. App walk-in, Lightning — same commission trigger as Flow 3
5. Numo walk-in, no app, fiat — merchant's own acquirer, Refueler invisible
6. Numo walk-in, no app, Lightning — merchant's own wallet direct, Refueler invisible
7. Legend merchant add-on — £250/mo SaaS, no payment flow

### Reward choice UI
Presented inline on settlement screen. Options: Claim [X] sats (LNURL-withdraw) / [Programme Name] stamp card (if active) / Skip. Edge cases handled gracefully — see MasterContext ADR-MS-11 and Merchant-Sats-C spec for full detail.

### Node three-way lock (ADR-MS-6)
1. Legend indexer (post-B9) — chain indexing only, no payments
2. Merchant settlement (optional, long-term) — merchant's own money, merchant's own node
3. Refueler treasury sweep — own operating capital, Blink → Silent Payment → cold storage

Forbidden fourth (Refueler node between consumer and merchant) = Model A. Permanently excluded. Stage 3 sim node = Legend node — same box.

### Pass initial scope (ADR-MS-7 + ADR-MS-26–28)
Own repo (`rajesh-taylor/refueler-pass`) and Claude project. QR/NFC credential (Refueler app or Apple/Google Wallet for non-app guests). Conditional entitlement post-scan. Fountain/LNURL streaming opt-in in-app. Inherits ADR-MS-1.

**Pass Wallet card** is a first-class Pass-A feature: LNURL-withdraw bearer card in the Pass tab. Varops instrument alongside the stamp token. Cashu upgrade scoped in Session A. Card reverse face is the primary acquisition surface for new users arriving via a gifted reward. Legend mobile UX (clean vs mempool.space density) is the retention pitch for those users once in the app.

Full scope in Pass-A (extended thinking on). Pass-B: venue hire, Fountain detail, sats-on-first-drink.

### BOLT12 (ADR-MS-8)
Roadmap only. Not beta or Block 9.

### Flywheel (ADR-MS-9)
```
Desktop:  Share ──────────────────────────────────► Legend
          Pass  ──────────────────────────────────► Legend
Mobile:   App + Pass ───────────────────────────────► Legend
In-venue: Numo ──► Merchant dashboard ──────────────► Legend
                                         "Come for privacy,
                                          stay for Bitcoin"
```

### Legal caveat (ADR-MS-10 — permanently logged)
Four points for UK payments solicitor sign-off before real-merchant go-live: (i) Lightning invoice generation as payment initiation; (ii) commission-on-attribution as platform fee not merchant acquiring; (iii) Numo fiat via merchant's own acquirer; (iv) Cashu stamp non-monetary closed-loop classification. Brief lawyer to confirm architecture, not assess open risk.

---

## Simulation discipline — locked Block-5 Review

No real merchant clients until all four sim stages pass Sim-Close review.

| Stage | Scope | Gate |
|---|---|---|
| 1 | Tablet fully wired: order state machine, order correction flow, refund handling, DB + financial screen repercussions | Can staff run a full shift without Rajesh touching the DB? |
| 2 | Franchise screen wired alongside; independent→franchise migration tested | Does franchise view reconcile with tablet? Does migration path work? |
| 3 | Self-custodial Lightning node replaces Blink custodial for consumer payment settlement | B9-gated — deferred |
| 4 | Printed handover document physically in hand; full onboard sim using doc + email only; stamp programme configured by owner | Can a manager onboard and run tablet with no verbal guidance? |

**Sim-Close:** Up to two Opus uncounted sessions. Formally sign off all stages. Real merchant go-live decision made here.

---

## Paid account architecture — locked CSS-1b

Mullvad-style: 24-word BIP39 mnemonic, client-side only, never transmitted. Server stores derived public key + `paid_until`. Accounts are per-product, not pooled. Lightning only for anonymous top-up. Cashu tokens are credentials (access/quota), not payment instruments — closed-loop, non-monetary.

**Enterprise:** M-of-N FROST multi-sig for key-person departure protection. Standard tiers single-key.

**Receiver-pays-to-extend:** Off by default. Dedicated planning session before build.

**`honest_metadata.json`:** Public at `refueler.io/_data/honest_metadata.json`. Machine-readable operator visibility record. Contractual exhibit for Legend Enterprise.

**Cashu NUTs in scope:**

| NUT | Purpose | Scope |
|---|---|---|
| NUT-00 | Blind issuance | Block 8 (stamps scaffolded; live when mint deployed) |
| NUT-07 | State check — double-spend prevention | Block 8 (scaffolded; live when mint deployed) |
| NUT-11 | P2PK binding | Probably never — contradicts IP honesty standard |
| NUT-13+09 | Deterministic restore — device-loss recovery | Post-mint |
| NUT-14 | HTLC — receiver-pays candidate | Post-mint |
| NUT-29 | Parked | — |

---

## Refueler IP honesty standard — locked platform principle

Every Refueler product, current and future, inherits this baseline without exception.

- **No product claims anonymity where IP is visible.** Free-tier standard HTTPS exposes the client IP to the server. Documented honestly on every product surface where true.
- **All products recommend Tor Browser for high-sensitivity use** where relevant. This recommendation appears in-product, not only in documentation.
- **All products plan OHTTP (RFC 9458) or equivalent as the v2 structural fix** for free-tier IP exposure where technically feasible.
- **No product retrofits honesty.** This standard applies at design time, before architecture is locked.

*Established: Adversarial-1 · 11 Aug 2026.*

---

## What Refueler Share is

Anonymous encrypted peer-to-peer file transfer. AES-GCM client-side, key in URL fragment, never transmitted. BLAKE3 chunk integrity server-side. Cashu NUT-00 blind signature access gate.

**Admin dashboard:** Live at `refueler.io/share/admin/dashboard`. Subdomain migration complete (AD-1 ✅). Left-hand panel wiring and card drill-downs are separate build work — tracked as AD-2.

**Positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."
**Two-axis lock (AP-7):** Recipient problem (survives sender closing laptop) + Compulsion problem (nothing to hand over).
**Free tier:** 4 GB, 7-day expiry. Paid: Stripe (identified) or Lightning (pseudonymous).
**Honest scope:** Not zero-knowledge on metadata. Lightning pseudonymous not anonymous. No audit yet (target B9 design review → B11 pentest, findings published).
**Known limitation:** Safari ~1.5 GB+ constraint — chunked streaming encryption in B-series roadmap.

---

## What Legend is

Privacy-first Bitcoin block explorer on BLAKE3-accelerated Esplora fork, ARM-optimised. **Does not start before B9. No exceptions.**

**Shell:** `refueler.io/legend/` live. No query logic yet.
**Locked phrase:** *"Chainalysis works for the observer. Legend works for the owner."* — Article 14/15, investor/conference only. Never UI copy.

### Node topology — locked Legend-7B
FROST 3-of-4 across nodes A–D. Node E chain-only cold standby.

| Node | Provider | Location | Jurisdiction |
|---|---|---|---|
| A | Hetzner | Falkenstein, DE | Germany |
| B | Frantech/BuyVM | Luxembourg | Luxembourg |
| C | FlokiNET | Reykjavik, IS | Iceland |
| D | OVHcloud NA | Canada | Canada |
| E | Infomaniak | Geneva, CH | Switzerland |

US nodes rejected (CLOUD Act). Cost ~€673/month (~£566 ex-VAT). Storage: 2×1 TB NVMe min (2×2 TB preferred). Chain+index ~1.65 TB Aug 2026. Storage upgrade: Q4 2027.

**Go-live conditions:** (a) B9 live; (b) five provider quotes confirmed; (c) UK legal sorted; (d) Legend prototype live at `refueler.io/legend/` for Enterprise demo.

**Note:** The Legend/B9 node also serves as the Stage 3 sim node for self-custodial consumer Lightning settlement. One node, two purposes.

### Business model
- **Free:** unlimited, no account, funded by Enterprise cross-subsidy
- **Enterprise:** £1,500/mo (v1) → £2,500/mo (v2: Tor, Double Ratchet, ML-KEM-768) → £3,500/mo (v2+: dedicated node isolation). Invite-only at v1, capped 5 clients.
- **Merchant add-on:** £250/mo per entity (existing POS base only). Price held — free tier as goodwill but never discounted from list.
- **Estate reports:** £50 block-height balance (v2) · £150 full verified (v3)

*Note: `legend-enterprise-pricing.md` break-even uses old €450/mo base — update floor to ~£566/mo at next Legend session.*

---

## Design system — canonical tokens

Web surfaces share these. App/terminal: Carbon always default, not togglable.

**Paper:** `--bg: #E8E2D8` · `--surface: #DAD4CA` · `--surface-raised: #D0C9BE` · `--fg: #1A1A1A` · `--fg-muted: #5A5550` · `--fg-subtle: #9A9590` · `--border: rgba(26,26,26,0.12)` · `--border-mid: #B8B2A8` · input: `#CCC7BE`

**Carbon:** `--bg: #1A1A1A` · `--surface: #26282C` · `--surface-raised: #2E3035` · `--fg: #F5F0E8` · `--fg-muted: #B0AAA2` · `--fg-subtle: #6A6560` · `--border: rgba(245,240,232,0.10)` · `--border-mid: #4A4D52` · input: `#252525`

**Accent:** `--accent: #C8A96E` · `--accent-hover: #E0C48A` · **No CTA orange. `--accent-action` abolished.**
**Warn:** `--warn: #B87333` (Paper) / `#C8943A` (Carbon) · **Danger:** `--danger: #E05252`
**`--inset-rule: var(--border)`** neutral in both themes. Gold only on article-body `h2` dividers and blockquotes.
**Card body text:** DM Sans 400, `line-height: 1.7`, `color: var(--fg)`.

**Typography:**
- `--font-heading: 'Satoshi', 'DM Sans', sans-serif` (600/700)
- `--font-sans: 'DM Sans', sans-serif` (300/400/500)
- `--font-serif: 'Source Serif 4', Georgia, serif` (300/400)
- `--font-mono: 'IBM Plex Mono', monospace` (400/500)
- Homepage headline only: Cormorant Garamond 600 in `src/index.njk`

**Structural:** Border `0.5px`. Radii: card `10px`, btn `8px`, modal `12px`. Transition `0.35s`. No `backdrop-filter`.

**Theme defaults:** Web → Paper (`getCookie('rs-theme') || 'paper'`). Legend only → Carbon (`|| 'carbon'`). Cookie `rs-theme` scoped `.refueler.io`, 30-day, `SameSite=Lax`. Detection: `dataset.theme === 'carbon'` only.

**Abolished — never use:** `#1E1F22` · `#F7F4EF` · `#F5F0E8` (old Paper) · `#F5820A` · `#D4690A` · `rfTheme` · `html.carbon-mode` · localStorage for theme

---

## CSS architecture rules — locked

1. One token file per domain owns all tokens. No page defines its own `:root`.
2. `head.njk` is the single theme-script owner. Page CSS is layout-only.
3. No `backdrop-filter`. No inline CSS/JS in Nunjucks templates.
4. `var(--accent)` fails on `<p>` — use `#C8A96E !important`.
5. `home-` prefix on all homepage classes. Page-specific fonts in `.njk` only.
6. Claude-produced `index.njk` files carry a section prefix; renamed on placement.

---

## Locked copy

| Line | Surface | Locked |
|---|---|---|
| *"Bitcoin, privately."* | Legend index headline | CC-77 |
| *"Built for jurisdictions that have laws. And lawyers."* | Share plans page | CC-77 |
| *"Chainalysis works for the observer. Legend works for the owner."* | Article 14/15, investor/conference only | Multi-5 |
| *"Your transaction / is nobody else's / business."* | Homepage headline | CC-79 |
| *"Privacy isn't a feature. It's the architecture."* | Homepage subhead | CC-79 |

**Never-say list:** "military-grade" · "zero-knowledge" as headline · "Swiss-grade privacy" · "anonymous payments" · "audit-certified"/"security-audited" (blocked until B11) · "end-to-end file integrity" · "C2C"/"c2c" · "PIR" without "inspired" qualifier · "secure" for degraded mode · "no logs" without structural qualifier

---

## Key rules everywhere

- Fenchurch St line — never "C2C"
- Sats: always `toLocaleString()` (5,284 sats, never 5.2k)
- Fee display: gross sats | routing fee | net sats. Unknown: "fee: pending"
- `showSaveFilePicker()` must fire synchronously from user gesture
- No localStorage for credentials — browser memory only
- No external video platforms — R2 + Worker signed URL only
- `refueler.io/[product]/` always — no subdomains
- Legend does not start before B9. No exceptions.
- All DDL via `apply_migration` only. `execute_sql` read-only.
- `verify_jwt: false` explicit on every external-facing Edge Function deploy

---

## Content architecture

- **`/editorial/`** — Investor/partner long-form. Curated, slow, considered.
- **`/notes/`** — SEO-targeted technical content for professional buyers. First sentence is the most interesting thing. Dry wit. Byline: Rajesh Taylor. Source Serif 4 body, IBM Plex Mono for data.
- **`/legend/`** — Product surface. Post-B9.
- **`/share/`** — Product surface. Live.
- **`/pass/`** — Product surface. Post Pass-A/B planning.

---

## Support

`support@refueler.io` · `privacy@refueler.io` (GDPR only)

---

## Current build status

**`refueler-share`:** Block M complete. `refueler.io/share/` live. Admin dashboard live (AD-1 ✅). Panel wiring and card drill-downs pending (AD-2).

**`refueler-io`:** Homepage locked (one month from CC-79). CSS rationalisation track complete. Block 3 complete CC-81. **Block 5 in progress:** test merchant E2E confirmed CC-82. CC-83 next (snag fixes + nav redesign + Block 8 pre-req schema migrations including `orders.reward_status`). Payment architecture locked Merchant-Sats-A. Reward + commission architecture locked Merchant-Sats-B. Reward choice UI spec locked Merchant-Sats-C (ADR-MS-19–28). Pass Wallet card scoped for Pass-A.

**`refueler-legend`:** Shell live at `refueler.io/legend/`. No query logic. Five-node topology locked (Legend-7B). Provider quotes pending. Build starts post-B9.

**`refueler-pass`:** Own repo and Claude project. Initial scope locked ADR-MS-7. Pass-A/B sessions after Block 8.

**`refueler-mint`:** Repo established. No production code. Session A (CDK mint architecture) queued — includes multi-franchise keyset partitioning design. `refueler-ecash-lab` (local only) will serve as CDK + Orchard GUI testing environment.

---

## Cross-project actions

| Action | Status |
|---|---|
| **Refueler IP honesty standard** | ✅ Locked — Adversarial-1 · 11 Aug 2026 |
| **Merchant payment architecture** | ✅ Locked — Merchant-Sats-A · 11 Aug 2026 |
| **Reward + commission architecture** | ✅ Locked — Merchant-Sats-B · 11 Aug 2026 |
| refueler-io — CSS track (CSS-2 → CSS-7b) | ✅ Complete |
| refueler-share — Block M | ✅ Complete |
| refueler-io — Block 3 franchise dashboard | ✅ CC-81 |
| **AD-1 — Share admin dashboard migration** | ✅ Complete |
| **AD-2 — Share admin dashboard panel wiring + card drill-downs** | 🟡 Queued |
| **refueler-io — Block 5 merchant onboarding** | 🔵 In progress — CC-83/84/85 |
| **Merchant-Sats-C — reward choice UI spec** | ✅ Complete — ADR-MS-19–28 locked |
| **Simulation discipline** | ✅ Locked — 4 stages, Sim-Close gates go-live |
| **Onboarding-A — flow design + printed handover doc** | 🟡 Queued |
| **Magic link email branding (S-9)** | 🟡 CC-85 |
| **Sim-Close — formal sign-off all 4 stages** | 🟡 Up to 2 Opus uncounted sessions |
| **Block 8 — Fiat→sats rewards + stamp scaffold** | 🟡 Promoted — next after Block 5 |
| **Session A — CDK mint architecture (refueler-mint)** | 🟡 After Block 8 — includes multi-franchise keyset partitioning |
| **Session B — stamp lifecycle + FCA compliance** | 🟡 After Session A |
| **Pass-A** | 🟡 After Block 8. Pass Wallet card first-class (ADR-MS-26–28). Extended thinking on. |
| **Pass-B** | 🟡 After Pass-A. Venue hire, Fountain, sats-on-first-drink. |
| **Lawyer briefing prep** | 🟡 Short Opus session before appointment |
| **SN-1/SN-2 — Share sub-nav strip** | 🟡 Post CSS track |
| **PA-series — Paid account planning** | 🟡 Queued |
| **Legend — provider quote replies** | 🟡 Expected |
| **Legend — Enterprise multi-sig account spec** | 🟡 Dedicated planning session |
| **Receiver-pays-to-extend UX** | 🟡 Dedicated planning session before build |
| **legend-enterprise-pricing.md break-even update** | 🟡 Next Legend session |
| **Competitive check: Square/Toast/KDS multi-programme stamps** | 🟡 Research item — likely differentiator if absent |
| refueler-share — retire share.refueler.io Pages project | 🟡 Rajesh — Cloudflare dashboard |
| Cloudflare Workers → Paid plan | 🟡 Before production volume |
| New Anthropic API key | 🟡 Before csuite briefing reuse |
| Block 9 | ⚪ Deferred post Block 8 |

---

## Session history — major milestones

| Session | Key outcome |
|---|---|
| CC-79 | Homepage redesign live. Cormorant Garamond. `home-` prefix. |
| CC-80 | Nav fix. Editorial `:root` strip. All four articles migrated. |
| CSS-1a | Paper → `#E8E2D8`. Orange abolished. `--inset-rule` gold scope narrowed. |
| M-1/M-2/M-3 | Share migrated to `refueler.io/share/`. Block M closed. |
| CSS-7/7b | Share design complete. Nav reordered. CSS track complete. |
| CC-81 | Block 3 closed. Franchise dashboard RPC. Operator tools into `src/`. |
| CC-82 | Block 5 partial. Test merchant E2E confirmed. PIN gate fix. Nav auth fix. |
| Block-5 Review | Sim discipline locked. 4 stages defined. AD-1 complete. AD-2 added. Block 8 promoted. S-13 deleted. 550 allocation confirmed. |
| Adversarial-1 | IP honesty standard locked across all products. |
| Merchant-Sats-A | Payment architecture locked. ADR-MS-1–10. Seven flows. Pass initial scope. Flywheel confirmed. Legal caveat logged. BRIDGE v3.2. |
| **Merchant-Sats-B** | Reward + commission architecture locked. ADR-MS-11–18. LNURL-withdraw pull model. Multi-programme stamps. Block 8 pre-req schema. Stripe shape. Walk-in trigger. Float mechanics. BRIDGE v3.3. |
| **Merchant-Sats-C** | **Reward choice UI spec locked. ADR-MS-19–28. Pass Wallet card scoped as first-class Pass-A feature. Sats non-destruction guarantee. Cashu upgrade direction locked. `orders.reward_status` column. Stamp read path RLS. 7-day expiry. BRIDGE v3.4.** |

---

*"Nothing stops this train."*
