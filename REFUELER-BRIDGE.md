# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 3.0 | **Created:** 28 July 2026 | **Updated:** CC-82 · 10 Aug 2026
> Lives in `refueler-share/` (root), `refueler-io/docs/`, and `refueler-legend/` (root). Committed to each at every block close.
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant POS (Fenchurch St line cafés and restaurants) · Refueler Pass (ticketing, in planning)

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
| Admin dashboard pages `src/share/admin/` (pending AD-1) | Admin Worker endpoints, `Share-Master-Context.md`, `share-sessions.md` |
| Notes articles at `refueler.io/notes/` | `notes-articles-list.md` (editorial planning, load on demand) |

### Legend boundary
| `refueler-io` | `refueler-legend` |
|---|---|
| Legend Eleventy shell at `refueler.io/legend/` | Node infrastructure, FROST key management |
| `legend.css` (layout only) | `MASTER.md`, `legend-node-plan.md`, `legend-economics.md`, `legend-incident-protocol.md` |
| Legend wordmark + theme pill wiring | `legend-scope.md`, `legend-design-spec.md`, `legend-ux-language.md`, `legend-enterprise-pricing.md` |
| Articles 14/15/16 when published | PIR sharding layer, Tor API, Silent Payments scanner code, CryptoRoadmap files |

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

## Merchant terminal — locked decisions (CC-82)

**Auth flow:** Magic link → `/command-centre/` → role resolved via `merchant_users.user_id` (email lookup deprecated CC-82) → redirect to role destination.

**ROLE_DESTINATIONS:** merchant/franchise_branch/independent_owner → `/merchant/` · franchise_hq → `/franchise/` · admin → `/dev/` · investor → `/investor/`

**PIN gate:** `tablet-ui` div hidden until staff PIN accepted. Revealed by `onStaffAuthenticated()`. Known ~1 frame flash (S-1) — fix queued.

**Merchant nav (queued CC-83):** Queue/Ops mode as explicit two-state pill. Venue name centred (from `venue_partners.name`). Logo space allocated. `venue_partners.logo_url` column to be added.

**Mapbox:** Franchise dashboard venue map only. Not rendered on single-venue merchant tablet.

**Test account:** `steakhouse@rajeshtaylor.com` · Raj's Steakhouse · 10 Trinity Square EC3N 4AJ · independent_owner · staff PIN 1234 · owner PIN 8888 · venue_id `c476df85`

---

## Paid account architecture — locked CSS-1b

Mullvad-style: 24-word BIP39 mnemonic, client-side only, never transmitted. Server stores derived public key + `paid_until`. Accounts are per-product, not pooled. Lightning only for anonymous top-up. Cashu tokens are credentials (access/quota), not payment instruments — closed-loop, non-monetary.

**Enterprise:** M-of-N FROST multi-sig for key-person departure protection. Standard tiers single-key.

**Receiver-pays-to-extend:** Off by default. Three UI states. Dedicated planning session before build.

**`honest_metadata.json`:** Public at `refueler.io/_data/honest_metadata.json`. Machine-readable operator visibility record. Contractual exhibit for Legend Enterprise.

**Cashu NUTs in scope:** NUT-00 blind auth · NUT-11 P2PK · NUT-13+09 deterministic restore · NUT-07 state check · NUT-14 HTLC (receiver-pays candidate). NUT-29 parked.

## Refueler IP honesty standard — locked platform principle

Every Refueler product, current and future, inherits this baseline without exception.

- **No product claims anonymity where IP is visible.** Free-tier standard HTTPS exposes
  the client IP to the server. This is documented honestly on every product surface where
  it is true. "Anonymous" is never used where "pseudonymous" or "IP-visible" is the reality.
- **All products recommend Tor Browser for high-sensitivity use** where relevant to the
  product context. This recommendation appears in-product (not only in documentation).
  A privacy product that buries the Tor recommendation in a FAQ is not being honest.
- **All products plan OHTTP (RFC 9458) or equivalent as the v2 structural fix** for free-tier
  IP exposure where technically feasible. OHTTP gives users IP privacy without requiring
  them to install anything — the oblivious relay sees IP-not-content, the server sees
  content-not-IP. This is the correct architectural answer, not a UX workaround.
- **No product retrofits honesty.** This standard applies at design time, before architecture
  is locked. Competitors whose products were not designed with IP honesty in mind cannot
  add it without admitting what they previously obscured. This is a durable competitive
  advantage — it compounds with every product Refueler ships.

Applies to: Share (live) · Legend (in build) · Pass (in planning) · Merchant terminal ·
Ticketing · all future products.

*Established: Adversarial-1 · 11 Aug 2026. Informed by `legend-threat-model.md` findings
on free-tier IP exposure. Same root problem identified in Share — no file transfer product
currently tells its users to use Tor. Refueler does.*

---

## What Refueler Share is

Anonymous encrypted peer-to-peer file transfer. AES-GCM client-side, key in URL fragment, never transmitted. BLAKE3 chunk integrity server-side. Cashu NUT-00 blind signature access gate.

**Positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."
**Two-axis lock (AP-7):** Recipient problem (survives sender closing laptop) + Compulsion problem (nothing to hand over).
**Free tier:** 4 GB, 7-day expiry. Paid: Stripe (identified) or Lightning (pseudonymous).
**Honest scope:** Not zero-knowledge on metadata (sizes/timestamps visible to operator — in `honest_metadata.json`). Lightning pseudonymous not anonymous. No audit yet (target B9 design review → B11 pentest, findings published).
**Known limitation:** Safari ~1.5 GB+ constraint — chunked streaming encryption in B-series roadmap.

**Admin dashboard (AD-1 pending):** `refueler-share/frontend/admin/` → migrate to `refueler-io/src/share/admin/`. Fix theme cookie (`rfTheme` → `rs-theme`/`dataset.theme`).

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

No gateway node ever. Browser talks to nodes directly. Bitcoin Knots on all nodes. BIP110 policy, RBF disabled.

### Query architecture
Ephemeral sessions. PIR-inspired sharding — no single node sees complete query. Tor-native API (Enterprise). Silent Payments (BIP-352) native — first explorer. v1 claim: collusion-resistant query splitting with blind credential unlinkability. Not true PIR, not ZK — use precise language.

### Credentials
Free tier: unlimited queries, no account, no rate limit, no friction. Funded by Enterprise cross-subsidy. Enterprise: NUT-11 P2PK-bound, PIR-sharded, Tor-native. No token-gating on free tier.

Blind receipt per query — compliance-facing for family offices.

### Business model
- **Free:** unlimited, no account, funded by Enterprise
- **Enterprise:** £1,500/mo (v1) → £2,500/mo (v2: Tor, Double Ratchet, ML-KEM-768) → £3,500/mo (v2+: dedicated node isolation). Invite-only at v1, capped 5 clients.
- **Merchant add-on:** £250/mo per entity (existing POS base only)
- **Estate reports:** £50 block-height balance (v2) · £150 full verified (v3)

*Note: `legend-enterprise-pricing.md` break-even uses old €450/mo base — update floor to ~£566/mo at next Legend session.*

### Legend detail files (in `refueler-legend/`)
`MASTER.md` · `legend-node-plan.md` · `legend-economics.md` · `legend-incident-protocol.md` v1.1 · `legend-scope.md` · `legend-design-spec.md` · `legend-ux-language.md` · `legend-enterprise-pricing.md`

**CryptoRoadmap:** 6 sessions (3 Opus + 3 Sonnet). Target January 2027. After Phase 1 working explorer. Before any v2 PIR/ZK build.

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
- **`/notes/`** — SEO-targeted technical content for professional buyers. First sentence is the most interesting thing. Dry wit. Byline: Rajesh Taylor. Source Serif 4 body, IBM Plex Mono for data. Never: military-grade, C2C, anonymous payments, audit-certified.
- **`/legend/`** — Product surface. Post-B9.
- **`/share/`** — Product surface. Live.

---

## Support

`support@refueler.io` · `privacy@refueler.io` (GDPR only)

---

## Current build status

**`refueler-share`:** Block M complete. `refueler.io/share/` live. 212 tests passing. Worker `7a0183e1`. Admin dashboard migration (AD-1) pending. Legend node provider quotes pending (expected 10–11 Aug 2026).

**`refueler-io`:** Homepage locked (one month from CC-79). All four editorial articles migrated. CSS rationalisation track complete (CSS-2 → CSS-7b). All page CSS clean. Block 3 (franchise dashboard) complete CC-81. **Block 5 in progress (CC-82):** test merchant E2E confirmed — Raj's Steakhouse, steakhouse@rajeshtaylor.com, independent_owner, PINs set, Darwin live, all views working. Snag list S-1 to S-9 active. Next: Block-5 Review (Opus) then CC-83.

**`refueler-legend`:** Shell live at `refueler.io/legend/`. No query logic. Five-node topology locked (Legend-7B). Provider quotes pending. Build starts post-B9.

---

## Cross-project actions

| Action | Status |
|---|---|
| **Refueler IP honesty standard** | ✅ Locked platform principle — Adversarial-1 · 11 Aug 2026 |
| refueler-io — CSS track (CSS-2 → CSS-7b) | ✅ Complete |
| refueler-share — Block M | ✅ Complete |
| refueler-io — Block 3 franchise dashboard | ✅ CC-81 |
| **refueler-io — Block 5 merchant onboarding** | 🔵 In progress — CC-82/83/84 |
| **Onboarding-A — flow design + printed handover doc** | 🟡 Queued Opus uncounted |
| **Magic link email branding** | 🟡 Before first real merchant onboard |
| **AD-1 — Share admin dashboard migration** | 🟡 Queued |
| **SN-1/SN-2 — Share sub-nav strip** | 🟡 Post CSS track |
| **PA-series — Paid account planning** | 🟡 Queued |
| **Legend — provider quote replies** | 🟡 Expected 10–11 Aug 2026 |
| **Legend — Enterprise multi-sig account spec** | 🟡 Dedicated planning session |
| **Receiver-pays-to-extend UX** | 🟡 Dedicated planning session before build |
| **legend-enterprise-pricing.md break-even update** | 🟡 Next Legend session |
| refueler-share — retire share.refueler.io Pages project | 🟡 Rajesh — Cloudflare dashboard |
| Cloudflare Workers → Paid plan | 🟡 Before production volume |
| New Anthropic API key | 🟡 Before csuite briefing reuse |

---

## Session history — major milestones

| Session | Key outcome |
|---|---|
| CC-74 | Global CSS migration. Token lock. Orange abolished. |
| CC-75/76 | Share CSS complete. `share-tokens.css` locked. |
| CC-77/78 | Legend + homepage copy locked. |
| CC-79 | Homepage redesign live. Cormorant Garamond. `home-` prefix. |
| CC-80 | Nav fix. Editorial `:root` strip. All four articles migrated. |
| CSS-1a | Paper → `#E8E2D8`. Orange abolished. `--inset-rule` gold scope narrowed. |
| M-1/M-2/M-3 | Share migrated to `refueler.io/share/`. Block M closed. |
| CSS-1b | Nav architecture locked. Repo boundary rule. Paid account architecture. |
| CSS-4 | New `global.css`. `share-tokens.css` merged. Font aliases unified. commit `2cbc496`. |
| CSS-5 | Full-site verification. Legend layout removal. |
| CSS-6 | All page CSS `:root` blocks stripped. `analytics.js` rfTheme fixed. |
| CSS-7/7b | Share design complete. QR removed. Nav reordered. CSS track complete. |
| CC-81 | Block 3 closed. Franchise dashboard RPC. Operator tools into `src/`. |
| CC-82 | Block 5 partial. Test merchant E2E confirmed. PIN gate fix. Nav auth fix. BRIDGE v3.0. |

---

*"Nothing stops this train."*
