# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 2.9 | **Created:** 28 July 2026 | **Updated:** CC-81 · 10 Aug 2026
> Lives in `refueler-share/` (root), `refueler-io/docs/`, and `refueler-legend/` (root). Committed to each.
> Updated at every block close. Attach to any Claude Project to establish shared context.
> This file is the handshake between Projects — not a substitute for repo-specific context files.

---

## What Refueler is

Refueler is a suite of Bitcoin-native products built by Rajesh Taylor (solo founder, London).
Products in active development: **Refueler Share** (anonymous encrypted file transfer, live at `refueler.io/share/`) and **Legend** (privacy-first Bitcoin block explorer, post-B9). A merchant POS app for the Fenchurch St line and a ticketing product (Refueler Pass, working name) are in the build queue.

**Local paths:**
- Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/`
- Share: `/Users/rajeshtaylor/Documents/refueler-share/`
- Legend: `/Users/rajeshtaylor/Documents/refueler-legend/`

**GitHub:** `github.com/rajesh-taylor`

---

## Repo boundary rule — read this first

> **If a browser requests it at `refueler.io`, it lives in `refueler-io`. If it runs on Cloudflare Workers or is backend infrastructure, it lives in `refueler-share` or `refueler-legend` respectively.**

### Share boundary

| Belongs in `refueler-io` | Belongs in `refueler-share` |
|---|---|
| All Nunjucks templates at `refueler.io/share/*` | Cloudflare Worker (`worker/src/index.js`) |
| `share-nav.njk`, `share-footer.njk` | Worker tests, `wrangler.toml` |
| `share-tokens.css` (staging — merges into `global.css` at CSS-4) | BLAKE3 source and build tooling |
| `share.js`, `blake3/` (client-side) | `Share-Master-Context.md`, `share-sessions.md` |
| Admin dashboard pages (`src/share/admin/`) — **pending migration AD-1** | Admin Worker endpoints (`/admin/metrics`, `/admin/ae-metrics`, `/admin/snapshot`) |
| Notes articles published at `refueler.io/notes/` | `notes-articles-list.md` (editorial planning, load on demand) |
| `REFUELER-WEBSITE-DESIGN-REFERENCE.md` canonical copy in `refueler-io/docs/` | Reference copy of `REFUELER-WEBSITE-DESIGN-REFERENCE.md` (kept for Share session context) |

### Legend boundary

| Belongs in `refueler-io` | Belongs in `refueler-legend` |
|---|---|
| Legend Eleventy shell at `refueler.io/legend/` (post-B9) | Node infrastructure, FROST key management |
| `legend.css` — layout only, no `:root` block (CSS-6 migration target) | `legend-node-plan.md`, `legend-economics.md`, `legend-incident-protocol.md` |
| Legend sub-nav strip (future SN-1/SN-2) | `legend-scope.md`, `legend-design-spec.md`, `legend-ux-language.md` |
| Legend wordmark, theme pill wiring in `head.njk` | `legend-enterprise-pricing.md`, `MASTER.md` |
| Article 14, 15, 16 when published at `refueler.io/notes/` | PIR sharding layer, Tor API, Silent Payments scanner code |
| | CryptoRoadmap research files |

**Cross-repo session log rule:** Any session touching both repos gets one cross-reference line in each log. Format: `"[what changed] — see [session-id] in [other-repo] SESSIONS file."` Higher MasterContext version number always wins on divergence.

---

## Subdomain policy — locked CSS-1a

**`refueler.io` is the canonical domain for all products.** Every product lives at `refueler.io/[product]/`.

`share.refueler.io` migrated to `refueler.io/share/` — Block M complete.

**Action required (Rajesh — Cloudflare dashboard):** Disconnect `share.refueler.io` custom domain from `refueler-share` Pages project, then delete or disable that Pages project.

**No future product gets a subdomain** without a documented technical constraint. Legend at `refueler.io/legend/`. Pass (when built) at `refueler.io/pass/`.

**Cloudflare infrastructure (Share):**
- Worker: `refueler-share.rt-fc4.workers.dev` (version `7a0183e1`). CORS accepts `https://refueler.io` and `https://share.refueler.io` (keep until Pages project retired).
- Turnstile widget: 2 hostnames — `refueler.io` + `share.refueler.io`.
- Cloudflare Workers KV free tier (1,000 writes/day) — upgrade to Paid ($5/month) before production volume.

---

## Navigation architecture — locked CSS-1b · 9 Aug 2026

### Main site nav (`nav.njk`)
Wordmark: `Refueler` → `/`

| # | Label | href | activePage key |
|---|---|---|---|
| 1 | Legend | `/legend/` | `legend` |
| 2 | Share | `/share/` | `share` |
| 3 | Notes | `/notes/` | `notes` |
| 4 | Editorial | `/editorial/` | `editorial` |
| 5 | Privacy | `/privacy/` | `privacy` |
| — | Paper / Carbon pill | `toggleTheme()` | — |

### Share nav (`share-nav.njk`)
Wordmark: `Refueler` → `/` · `Share` → `/share/`
All hrefs relative (absolute `https://refueler.io/...` URLs are legacy — fix to relative in next Share nav touch).

| # | Label | href | activePage key |
|---|---|---|---|
| 1 | Notes | `/notes/` | `notes` |
| 2 | Plans | `/share/plans/` | `plans` |
| — | Paper / Carbon pill | `toggleTheme()` | — |

Support moves to footer. Account link (`/share/account/`) added here between Notes and Plans when paid accounts go live — not before.

### Share product sub-nav strip (future — SN-1/SN-2)
Horizontal strip, product-scoped, visually subordinate to main nav.

| # | Label | href | Visibility |
|---|---|---|---|
| 1 | Upload | `/share/` | Always |
| 2 | Account | `/share/account/` | Authenticated users only |
| 3 | Plans | `/share/plans/` | Always |
| 4 | Status | `/share/status/` | Always |

Strip background: one shade off surface token (slightly darker on Paper, slightly lighter on Carbon). Same pattern applied to Legend and Pass when their sub-navs are built.

### Legend nav
Wordmark: `Refueler` → `/` · `Legend` → `/legend/`
Theme pill only. No link list. Carbon default (`getCookie('rs-theme') || 'carbon'`). Account link (`/legend/account/`) added post-B9 when credential access exists — not before.

### Footers — universal stamp and links

**Stamp (all surfaces):** `© 2026 Refueler Ltd (incorporating) · refueler.io`

| Surface | Links |
|---|---|
| Main site | Privacy `/privacy/` · Support `/support/` |
| Share | Privacy `/privacy/` · Support `/support/` · Status `/share/status/` · Plans `/share/plans/` · Legend `/legend/` |
| Legend | Privacy `/privacy/` · Support `/support/` · Share `/share/` |

### Homepage capability block (implement when homepage lock lifts, one month from CC-79)

| Label | Links to | Descriptor |
|---|---|---|
| Encrypted transfers | `/share/` | *The server is blind, so is the till.* |
| Bitcoin explorer | `/legend/` | *Your search history is showing.* |
| Lightning payments | No target yet — unlinked | *Tap and go. Sats or card, your call.* |

When Refueler Pass is live, Pass replaces Lightning payments in this block.

### Product nav sequencing
- Pre-merchant-app live: `Legend · Share · Pass` once Pass exists
- At four products: introduce `Products ▾` grouping

---

## Paid account architecture — decisions locked CSS-1b

**Identity model:** Mullvad-style. No email, no username, no password. Account number is a 24-word BIP39 mnemonic generated entirely client-side via `crypto.getRandomValues()`. Displayed once. Never transmitted. Server stores only the derived public key and `paid_until`.

**Standard path:** 24-word account key, generated in-browser. "Write it down. Lose it, start a new account."

**Advanced path:** "Generate with physical dice" — links to a brief page on the Refueler domain. Label is "Generate with physical dice." The trust argument: open-source generation code, zero network traffic during generation (verifiable in browser dev tools), physical dice means the mint never touches generation.

**Accounts are per-product, not pooled.** Share has its own account. Legend paid tier will have its own. Pass will have its own. Products may be incorporated as separate entities under the Refueler holding company. The account architecture supports this — separate credentials, separate `paid_until` records, no cross-product balance sheet.

**Enterprise multi-sig account management.** For Legend Enterprise and Share API tiers, account actions (cancel subscription, rotate credentials, export data) can require M-of-N authorisation from named keyholders — a FROST multi-sig arrangement consistent with the node signing architecture. Prevents a single departing employee from unilaterally ending an Enterprise account. Standard paid tiers (individual, small team) are single-key. Enterprise multi-sig spec to be designed in a dedicated Legend Enterprise planning session.

**Payment:** Lightning (Blink BOLT11) only for anonymous account top-up. Stripe remains for the identified sender tier on Share. Cashu tokens from the Refueler mint are credentials (access tokens, quota proofs), not payment instruments — the mint is closed-loop and non-monetary.

**Receiver-pays-to-extend:** Download page shows extend option when sender has enabled it at upload time. Default: off. When enabled by sender: recipient sees extend option with honest single-line explanation (contributes toward server costs). Three UI states: sender disabled (option never shown) / sender enabled (shown with explanation) / sender's paid tier includes it automatically. UX design to be scoped in a dedicated planning session before build. Not a default feature of the free tier.

**`honest_metadata.json`:** Public at `refueler.io/_data/honest_metadata.json`. The machine-readable, dated record of exactly what the operator can see. Point paying clients to it proactively — in account dashboard onboarding and in response to any privacy enquiry. For Legend Enterprise it becomes a contractual exhibit: here is the precise metadata footprint, verifiable by hash. Articles 3 and 4 in the Notes pipeline embed it directly.

**NUT-29 (Batched Minting):** Parked. Relevant only for Enterprise multi-product bundle scenario. Not in scope until that tier is designed.

**Cashu NUT primitives in scope for account/credential system:**
- Blind auth NUTs — anonymous credentials gating API access without server linking sessions
- NUT-11 (P2PK) — lock credential to account pubkey
- NUT-13 + NUT-09 (deterministic secrets + restore) — "restore from words" flow
- NUT-07 (state check) — verify credential unspent before gating upload
- NUT-14 (HTLC) — conditional unlock tied to payment preimage (receiver-pays-to-extend candidate)

---

## What Refueler Share is

Anonymous, encrypted peer-to-peer file transfer. No account. No identity. The server stores encrypted noise and cannot read file content or identify users.

**The one-line positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."

**URL:** `refueler.io/share/` *(live — Block M complete)*
**Legacy URL:** `share.refueler.io` — still resolves until Pages project retired
**Repo:** `rajesh-taylor/refueler-share` (Apache 2.0, public)

**Two-axis category definition (locked AP-7):**
1. **The recipient problem** — the transfer survives the sender closing their laptop and the recipient being on a plane. Every synchronous P2P tool fails this by design.
2. **The compulsion problem** — there is nothing to hand over, not because we'd refuse, but because we never had it. Every storing service with server-side keys fails this by design.

**The core technical claim (honest scope):**
- Files AES-GCM encrypted client-side. Encryption key lives in the URL fragment — never transmitted.
- Every chunk BLAKE3-hashed and verified server-side. Integrity confirmed without reading content.
- Access gated by Cashu NUT-00 blind signatures — anonymous credentials the mint cannot link to issuance.
- Free tier: 4 GB, 7-day expiry. Paid tiers via Stripe (identified) or Lightning (pseudonymous).

**What it is not:**
- Not zero-knowledge in the metadata sense — file sizes, chunk counts, and timestamps visible to operator. Published honestly in `honest_metadata.json`.
- Lightning payments are pseudonymous, not anonymous (Blink internal correlation possible — documented).
- No independent security audit yet. Target: B9 (cryptographic design review) → B11 (scoped pentest, findings published).

**Known limitations:**
- Safari large file limitation (~1.5 GB+) — client-side AES-GCM memory constraint. Fix: chunked streaming encryption (Share B-series roadmap).

**`/share/upgrade/` renamed to `/share/plans/`** (locked CSS-1b). Files: `upgrade.css` → `plans.css`, `upgrade.html` → `plans.html`, Nunjucks template renamed. Redirect `/share/upgrade/` → `/share/plans/` in `_headers`. Fix in next Share page build session.

---

## Share — admin dashboard

**Current state:** `refueler-share/frontend/admin/` — `dashboard.html`, `dashboard.css`, `dashboard.js`. Sidebar layout, Carbon default, password-gated via `X-Admin-Key` header to Worker. Several sidebar sections are stubs (Upload latency, Transfers, Subscribers, Maintenance mode, Rate limits).

**Known drift:** Dashboard uses `theme=` cookie and `setTheme()` — not the canonical `rs-theme` cookie / `document.documentElement.dataset.theme` pattern. Fix in migration session.

**Migration plan (AD-1):** Move frontend files to `refueler-io` at `src/share/admin/`. Serves at `refueler.io/share/admin/`. Apply current design tokens from `share-tokens.css`. Fix theme cookie to `rs-theme`. Wire stub sections where Worker endpoints already exist. Worker endpoints stay in `refueler-share`. Password (`X-Admin-Key`) unchanged.

---

## What Legend is

Privacy-first Bitcoin block explorer built on a BLAKE3-accelerated Esplora fork, optimised for ARM architecture. Two complementary scopes: (1) the ARM/Raspberry Pi indexer fork; (2) the Legend privacy layer on top. Lives at `refueler.io/legend/` post-B9. **Does not start before B9 Lightning node is live. No exceptions.**

**Licence:** MIT (matches upstream esplora/electrs).
**Shell live** at `refueler.io/legend/`. No query logic yet.

**Legend theme default (locked CSS-1a):** `getCookie('rs-theme') || 'carbon'` on Legend template only.
**Legend page layout (locked CSS-1a):** Wordmark, input field, tagline only above results. No green credential dot. No Silent Payments card. No below-fold three-column block.

**Locked phrase (coined Multi-5):** *"Chainalysis works for the observer. Legend works for the owner."* — use in Article 14, Article 15, and any investor or conference presentation. Never in UI copy.

### Node infrastructure (locked Legend-7/7B · 7 Aug 2026)

Five nodes, five independent legal frameworks. FROST 3-of-4 threshold signing across nodes A–D. Node E is chain-only cold standby (no FROST share, no Esplora index at launch — chain continuously synced so Esplora index build is the only remaining step when E is activated).

| Node | Provider | Location | Jurisdiction |
|---|---|---|---|
| A | Hetzner | Falkenstein, DE | Germany |
| B | Frantech/BuyVM | Luxembourg | Luxembourg |
| C | FlokiNET | Reykjavik, IS | Iceland |
| D | OVHcloud NA | Canada | Canada |
| E | Infomaniak | Geneva, CH | Switzerland |

**US nodes explicitly rejected.** CLOUD Act 2018 allows US-headquartered providers to be compelled to produce data stored anywhere globally.

**Infrastructure cost:** ~€673/month planning estimate (~£566/month ex-VAT). Five dedicated nodes across five jurisdictions and three continents. Confirmed quotes pending provider replies (expected 10–11 Aug 2026). One Enterprise client at the v1 floor (£1,500/month) covers ~2.6 years of infrastructure cost.

**Storage spec:** 2×1 TB NVMe minimum, 2×2 TB preferred. Chain + index total August 2026: ~1.65 TB. Storage upgrade window: target Q4 2027.

**FROST 3-of-4:** Signing requires 3 of 4 full participants (nodes A–D). Sub-quorum states and operator procedures documented in `legend-incident-protocol.md` v1.1. Confirm 3-of-4 threshold and test ceremony before first node goes live with query traffic (`frost-secp256k1` crate supports configurable thresholds).

**Architecture principle:** No gateway node ever. Browser talks to nodes directly. A gateway is a surveillance point with extra steps.

**Bitcoin Knots over Bitcoin Core on all nodes.** BIP110 policy, RBF disabled.

**Go-live conditions:** (a) B9 live on Share; (b) all five provider quote replies confirmed; (c) UK legal sorted; (d) Legend design prototype live at `refueler.io/legend` for Enterprise demo. Prototype costs nothing beyond existing hosting — static shell, no live nodes required for demo.

### Privacy query architecture

- Ephemeral query sessions — no session persistence, no client correlation across queries
- PIR-inspired sharding: no single node sees the complete query; client reassembles locally
- Tor-native API for Enterprise tier
- Silent Payments (BIP-352) native — first explorer to display SP static addresses and derived outputs correctly
- v1 privacy claim: collusion-resistant query splitting with blind credential unlinkability. Not PIR, not ZK. Use precise language.

### Query credential model (locked CLAUDE.md / Multi-4)

**Free tier: unlimited queries at v1 launch. No account. No rate limit. No friction at distress moment.** Free access is not gated by Share uploads or tokens. This is the architectural proof the system works — funded by Enterprise cross-subsidy.

Enterprise: unlimited queries, PIR-sharded, Tor-native, NUT-11 P2PK-bound credentials.

No token-gating on the free tier. The Share-gives-Legend-tokens model is superseded and abolished.

### Proof-of-query receipts

Blind receipt per query. Client verifies N responses without revealing query content. Compliance-facing for family offices and legal teams demonstrating unloggable query behaviour.

### The Coldcard MK3 moment (August 2026)

Entropy bug in MK3 seed generation makes brute-force attacks viable. Affected users need private address monitoring without broadcasting their concerns to a public explorer. Legend is the correct tool. Article 14 addresses this — opening line locked: *"Every time you look up a Bitcoin address on a public block explorer, you're telling that server exactly what you own and what you're watching. Here's what we built instead, and why it matters for our clients."*

### Business model

- **Free:** unlimited queries. No account. No payment. No rate limit. Funded by Enterprise cross-subsidy.
- **Enterprise (family office):** £1,500/month (v1) → £2,500/month (v2: Tor API, Double Ratchet, ML-KEM-768) → £3,500/month (v2+: dedicated node isolation). Invite-only at v1, capped at five clients. Enterprise multi-sig account management (M-of-N FROST arrangement) for key-person departure protection.
- **Merchant add-on:** £250/month per business entity. Sold into existing Refueler POS merchant base only.
- **Estate reports:** £50 per block-height balance statement (v2). £150 full verified estate report (v3).

*Carry-forward from Legend-7B: `legend-enterprise-pricing.md` break-even figures use old €450/month base. Update minimum contract floor from ~£385/month to ~£566/month at next session touching that file.*

### Legend — detail files (in `refueler-legend/`)

| File | Contents |
|---|---|
| `MASTER.md` | Single-load summary of all nine harness files. Load alongside `CLAUDE.md` + `SESSIONS.md` in every build session. |
| `legend-node-plan.md` | Node topology v1.2, provider specs, FROST architecture, warm standby procedure |
| `legend-economics.md` | Five-node cost model (figures pending confirmed quotes) |
| `legend-incident-protocol.md` | Incident runbook v1.1 — eight sections, FROST re-keying, attack simulations, pre-signed statements |
| `legend-scope.md` | Feature scope by version (v1 → v3+) |
| `legend-design-spec.md` | Status page spec, privacy modes, CSS tokens |
| `legend-ux-language.md` | Copy register, 50 locked strings, voice/register rules |
| `legend-enterprise-pricing.md` | Enterprise tier pricing model (break-even update pending) |

### CryptoRoadmap block (target: January 2027)
Six sessions (3 Opus + 3 Sonnet) covering: primitives audit (Ristretto255, FROST, Checklist PIR), transport and scanning layer (ML-KEM-768, Double Ratchet, FMD), ZK architecture (Bulletproofs+, estate/lending use case). Runs after Phase 1 working explorer is live. Before any v2 build session touches PIR or ZK layers.

---

## Design system — canonical tokens

All Refueler web surfaces share these tokens. App/terminal surfaces have their own convention (Carbon always default, not togglable).

### Backgrounds (CSS-1a)
- **Paper:** `--bg: #E8E2D8` · `--surface: #DAD4CA` · `--surface-raised: #D0C9BE`
- **Carbon:** `--bg: #1A1A1A` · `--surface: #26282C` · `--surface-raised: #2E3035`

*Paper updated CSS-1a from `#F5F0E8` to `#E8E2D8`.*

### Input fields (CSS-1a)
- Paper: `#CCC7BE` (recessed well) · Carbon: `#252525`

### Text
- Paper: `--fg: #1A1A1A` · `--fg-muted: #5A5550` · `--fg-subtle: #9A9590`
- Carbon: `--fg: #F5F0E8` · `--fg-muted: #B0AAA2` · `--fg-subtle: #6A6560`

*`--fg*` is the canonical primary system. `--text-primary/secondary/tertiary` are aliases. Migration of `notes.css` from `--text-*` to `--fg*` in CSS-6.*

### Borders
- Paper: `--border: rgba(26,26,26,0.12)` · `--border-mid: #B8B2A8` · `--inset-rule: var(--border)`
- Carbon: `--border: rgba(245,240,232,0.10)` · `--border-mid: #4A4D52` · `--inset-rule: var(--border)`

### `--inset-rule` gold scope (CSS-1a)
Gold `#C8A96E` valid **only** as inline element style on `h2` dividers and blockquotes inside article body content. Never on chrome of any kind.

### Accent
- `--accent: #C8A96E` · `--accent-hover: #E0C48A`
- **No CTA orange. `--accent-action` abolished. `#F5820A` and `#D4690A` do not exist in this codebase.**

### Card body text (locked CSS-1a)
DM Sans 400, `line-height: 1.7`, `color: var(--fg)`. Not muted, not weight 300.

### Typography
- `--font-heading: 'Satoshi', 'DM Sans', sans-serif` — wordmark, labels, metric values (600/700)
- `--font-sans: 'DM Sans', sans-serif` — UI, body copy (300/400/500)
- `--font-serif: 'Source Serif 4', Georgia, serif` — editorial, `/notes/` body (300/400)
- `--font-mono: 'IBM Plex Mono', monospace` — timestamps, codes, data (400/500)
- Homepage headline only: `'Cormorant Garamond', Georgia, serif` 600 — `src/index.njk` only, never global

### Structural
- Border weight: `0.5px`. Card radius: `10px`. Button radius: `8px`. Modal radius: `12px`.
- Theme transition: `0.35s`. No `backdrop-filter` or blur on any surface.
- Detection: `document.documentElement.dataset.theme === 'carbon'` only. Never `classList.contains`.

### Theme defaults
- All web surfaces: Paper default (`getCookie('rs-theme') || 'paper'`)
- **Legend template only:** Carbon default (`getCookie('rs-theme') || 'carbon'`)
- App / Command Centre / terminal: Carbon always

### Theme persistence
Cookie `rs-theme` scoped to `.refueler.io` (30-day rolling, `SameSite=Lax`).

### Stale / abolished — never use
`#1E1F22` · `#F7F4EF` · `#F5F0E8` (old Paper) · `#F5820A` · `#D4690A` · `rfTheme` · `html.carbon-mode` · `localStorage` for theme

---

## CSS architecture rules — locked

1. One token file per domain owns all tokens. No page defines its own `:root` block.
2. Every page loads domain token file (via `head.njk`) before any other CSS. Page CSS is layout-only.
3. `head.njk` is the single theme-script owner per domain.
4. No `backdrop-filter` / frosted glass on any surface.
5. `var(--accent)` fails on `<p>` tags — use `#C8A96E !important` until CSS-6.
6. Homepage classes all `home-` prefixed. Do not touch outside a formal decision.
7. Page-specific display fonts load in the page `.njk` only.
8. No inline CSS/JS in Nunjucks templates.
9. Claude-produced `index.njk` files carry a section prefix (e.g. `home-index.njk`); renamed on placement.

---

## Content architecture — refueler.io

- **`/editorial/`** — Investor/partner long-form. Curated, slow, considered.
- **`/notes/`** — SEO-targeted technical content for professional buyers. Pipeline in `notes-articles-list.md` in `refueler-share/` (load on demand).
- **`/legend/`** — Legend product surface. Post-B9.
- **`/share/`** — Share product surface. Live.

---

## Writing style — `/notes/`

- First sentence is the most interesting thing. No throat-clearing.
- One idea per paragraph. Precision over completeness.
- Dry wit from the gap between marketing claims and reality.
- Byline: Rajesh Taylor (personal, named).
- Source Serif 4 for body. IBM Plex Mono for data and inline technical values.
- Never: "military-grade", "zero-knowledge" as headline, "Swiss-grade privacy", "anonymous payments", "audit-certified", "security-audited", "end-to-end file integrity", "C2C".
- Always: honest about what the operator can see. State it before anyone asks.

---

## Locked copy — do not reassign

| Line | Assigned to | Locked |
|---|---|---|
| *"Bitcoin, privately."* | Legend index page headline | CC-77 |
| *"Built for jurisdictions that have laws. And lawyers."* | Share plans page | CC-77 |
| *"Lightning payments — Tap and go. Sats or card, your call."* | Share plans page | CC-77 |
| *"Chainalysis works for the observer. Legend works for the owner."* | Article 14, Article 15, investor/conference materials only — never UI copy | Multi-5 |

**Homepage copy (locked CC-79, one month from CC-79):**
- Overline: *Privacy Infrastructure · London* *(gold `#C8A96E !important`)*
- Headline: *Your transaction / is nobody else's / business.* *(Cormorant Garamond 600, three forced `<br>` lines)*
- Subhead: *Privacy isn't a feature. It's the architecture.* *(DM Sans 300, full `--fg`, in `.home-subhead-band`)*
- Capability: Encrypted transfers / Bitcoin explorer / Lightning payments (labels link when lock lifts)

*"Fiat or Bitcoin — privacy included."* retired from homepage CC-79. Product pages only.

**Legend copy (locked CC-77/78):**
- Homepage capability label: *Bitcoin explorer* · Descriptor: *Your search history is showing.*
- Legend index headline: *Bitcoin, privately.*
- Legend index opening: *Buys non-KYC Bitcoin, then logs every address ever searched...*

*Note: "are you leaving address queries on file?" — queued for review in a future Legend Project session. Do not change until that session resolves it.*

**Never-say list (all copy):**
"military-grade" · "zero-knowledge" as headline · "Swiss-grade privacy" · "anonymous payments" · "audit-certified" / "security-audited" (blocked until B11) · "end-to-end file integrity" · "C2C" / "c2c" · "PIR" without the qualifier "inspired" (v1 is collusion-resistant query splitting, not true PIR) · "secure" for a degraded mode (say "reduced") · "no logs" without the structural qualifier

**North star (internal only — never render):** *"Come for privacy, stay for Bitcoin."*

---

## Upcoming product — Refueler Pass (working name)

Anonymous, fraud-resistant ticketing using Cashu NUT primitives. No repo yet. Sequencing: Pass becomes Block 3 (ahead of merchant app and POS going live), sits in main nav at position 3.

---

## Competitive positioning — locked

**Anonymity spectrum:** WeTransfer/Smash/SwissTransfer → Tresorit/Proton Drive → Wormhole → **Refueler Share** → OnionShare.

**Wedge statements:**
- vs WeTransfer: "A server that can read your files is a server whose terms about your files matter. Ours stores noise."
- vs SwissTransfer: "Jurisdiction is not architecture."
- vs Proton Drive: "No account to correlate. The payment itself is blinded."
- vs OnionShare: "Close your laptop. The transfer survives."
- vs Mempool/Blockstream: "We can't see what you're watching. Neither can anyone else."

---

## Key rules that apply everywhere

- `var(--accent)` fails on `<p>` — use `#C8A96E !important` until CSS-6
- Cookie `rs-theme` scoped to `.refueler.io` for cross-domain theme persistence
- No inline CSS/JS in Nunjucks templates
- `showSaveFilePicker()` must fire synchronously from a user gesture
- No localStorage for credentials — browser memory only
- Legend does not start before B9. No exceptions.
- `#F5820A` and `#D4690A` do not exist in this codebase. Orange is abolished.
- Paper is `#E8E2D8`. Carbon is `#1A1A1A`. All other background values are wrong.
- `--inset-rule` gold is article body content only — never chrome.
- No subdomains — `refueler.io/[product]/` always.
- No external video platforms — R2 + Worker signed URL only.
- Admin dashboard auth: `X-Admin-Key` header. Theme: `rs-theme` cookie, `dataset.theme`. Never `rfTheme`.
- Sats display: always `toLocaleString()` (5,284 sats — never 5.2k).
- Routing fee: gross sats | routing fee | net sats. Unknown: "fee: pending".
- Fenchurch St line — never "C2C".

---

## Support and contact

- `support@refueler.io` — user-facing support. Page: `refueler.io/support/`.
- `privacy@refueler.io` — data protection only. Page: `refueler.io/privacy/`.

---

## Current build status

**`refueler-share`:** Block M complete. `refueler.io/share/` live. 212 tests passing. Worker `7a0183e1`. Admin dashboard frontend migration to `refueler-io` pending (AD-1). `/share/upgrade/` → `/share/plans/` rename fixed in CSS-7 (cap-warning nudge href). Quote emails sent to five Legend node providers; replies expected 10–11 Aug 2026.

**`refueler-io`:** Homepage locked (CC-79, one month). All four editorial articles migrated. `/notes/` live, Article 1 published. Share live at `refueler.io/share/`. **CSS rationalisation track complete (CSS-2 through CSS-7).** All page CSS files clean — no `:root` blocks. `global.css` single token source. Share upload/download design resolved. **Block 3 complete (CC-81).** All operator tools moved from repo root into `src/[slug]/index.html` — served via Eleventy at `/franchise/`, `/merchant/`, `/command-centre/`, `/dev/`, `/investor/`. Franchise dashboard: RPC data layer (`franchise_dashboard_summary` SECURITY DEFINER), update policy + column-guard trigger, cross-browser magic link auth fixed. Next: CC-82 Block 5 merchant onboarding.

**`refueler-legend`:** Shell live at `refueler.io/legend/`. No query logic. Five-node topology locked (Legend-7B). Provider quotes pending. Build starts post-B9.

---

## Cross-project actions — status

| Action | Status |
|---|---|
| refueler-io — AP-7 | ✅ Closed CC-72/CC-74 |
| refueler-legend — cross-project sign-off | ✅ Closed CC-74 |
| refueler-share — CSS architecture | ✅ Closed CC-75 |
| refueler-io — homepage | ✅ Closed CC-78 |
| refueler-io — editorial articles | ✅ Closed CC-80 |
| refueler-share — Block M (M-1 → M-3) | ✅ Closed — Share canonical at refueler.io/share/ |
| refueler-io — CSS-1b nav architecture | ✅ Closed — this document |
| **refueler-io — Block 3 franchise dashboard** | ✅ Closed CC-81 |
| **AD-1 — admin dashboard migration** | 🟡 Queued — `refueler-share/frontend/admin/` → `refueler-io/src/share/admin/` |
| ~~refueler-io — CSS-2 through CSS-7~~ | ✅ Closed — CSS track complete |
| **SN-1/SN-2 — Share sub-nav strip** | 🟡 After CSS track |
| **PA-series — Paid account (multi-phase Opus planning)** | 🟡 Queued |
| **Legend — provider quote replies** | 🟡 Expected 10–11 Aug 2026 |
| **Legend — Enterprise multi-sig account spec** | 🟡 Dedicated planning session |
| **Receiver-pays-to-extend UX** | 🟡 Dedicated planning session before build |
| refueler-share — retire share.refueler.io Pages project | 🟡 Rajesh — Cloudflare dashboard |
| Cloudflare Workers → Paid plan | 🟡 Before production volume |
| New Anthropic API key | 🟡 Before csuite briefing reuse |
| legend-enterprise-pricing.md break-even update | 🟡 Next Legend session touching that file |

---

## Session history — major milestones

| Session | Key outcome |
|---|---|
| CC-74 | Global CSS migration. Token lock. Orange abolished. |
| CC-75/76 | Share CSS complete. `share-tokens.css` locked. |
| CC-77 | Legend copy locked. North star locked. |
| CC-78 | Homepage and Legend index copy locked. |
| CC-79 | Homepage redesign live. Cormorant Garamond. `home-` prefix. |
| CC-80 | Nav fix. Editorial `:root` strip. All four articles migrated. |
| Legend-5 | `MASTER.md` v1.0. CryptoRoadmap block scoped. |
| Legend-6 | `legend-incident-protocol.md` v1.0. Licence corrected MIT. |
| Legend-7 | `legend-node-plan.md` v1.1. Five-node topology. FROST 3-of-4. |
| Legend-7B | Five provider quotes dispatched. Node topology finalised. Cost ~€673/month. |
| CSS-1 | `REFUELER-WEBSITE-DESIGN-REFERENCE.md` produced. |
| CSS-1a | Paper updated to `#E8E2D8`. Orange abolished. `--inset-rule` gold scope narrowed. |
| M-1/M-2/M-3 | Share migrated to `refueler.io/share/`. Block M closed. |
| CSS-1b | Nav architecture locked. Repo boundary rule. Paid account architecture. BRIDGE v2.6. |
| CSS-2/CSS-3 | global.css audit complete. CSS-3 blueprint produced. Token rulings locked. |
| CSS-4 | New `global.css` implemented. `share-tokens.css` merged. Font aliases unified. commit `2cbc496`. |
| CSS-5 | Full-site verification. Legend layout removal (credential dot, below-fold block). BRIDGE v2.7. |
| CSS-6 | All page CSS `:root` blocks stripped. `analytics.js` rfTheme fixed. Legend tagline updated. |
| CSS-7 | Share upload complete hierarchy, receiver trust line, colophon border fixed, download progress detail. CSS track complete. BRIDGE v2.8. |
| CC-81 | Block 3 closed. Franchise dashboard RPC data layer. Operator tools into `src/`. Cross-browser auth fix. BRIDGE v2.9. |

---

*"Nothing stops this train."*
