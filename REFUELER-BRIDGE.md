# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 2.4 | **Created:** 28 July 2026 | **Updated:** M-2 · 8 Aug 2026
> Lives in `refueler-share`, `refueler-io` (docs/), and `refueler-legend` repos. Committed to each.
> Updated at every block close. Attach to any Claude Project to establish shared context.
> This file is the handshake between Projects — not a substitute for repo-specific context files.

---

## What Refueler is

Refueler is a suite of Bitcoin-native products built by Rajesh Taylor (solo founder, London).
The wider ecosystem includes a merchant POS (`refueler.io`), a mint, and several experimental repos.
Products in active development: **Refueler Share** (file transfer, live at `refueler.io/share/`) and **Legend** (private chain explorer, post-B9).

**Local paths:**
- Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/`
- Share: `/Users/rajeshtaylor/Documents/refueler-share/`
- Legend / multi-core: `/Users/rajeshtaylor/Documents/refueler-legend/`

**GitHub:** `github.com/rajesh-taylor`

**Subdomain policy (locked CSS-1a):** All products live at `refueler.io/[product]/`. No new subdomains without a documented technical constraint. `share.refueler.io` migrated to `refueler.io/share/` in M-2. Legend stays at `refueler.io/legend/`. Domain authority consolidates on `refueler.io`.

---

## What Refueler Share is

Anonymous, encrypted peer-to-peer file transfer. No account. No identity. The server stores encrypted noise and cannot read file content or identify users.

**The one-line positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."

**URL:** `refueler.io/share/` *(live — M-2 complete)*
**Legacy URL:** `share.refueler.io` — still resolves until M-3 retires the Pages project
**Repo:** `rajesh-taylor/refueler-share` (Apache 2.0, public)

**Two-axis category definition (locked AP-7):**
Refueler Share is the only architecture that solves both failures simultaneously:
1. **The recipient problem** — the transfer survives the sender closing their laptop; it survives the recipient being on a plane. Every synchronous P2P tool fails this by design.
2. **The compulsion problem** — there is nothing to hand over, not because we'd refuse, but because we never had it. Every storing service with server-side keys fails this by design.

**The core technical claim (honest scope):**
- Files are AES-GCM encrypted client-side. The encryption key lives in the URL fragment — never transmitted to the server.
- Every chunk is BLAKE3-hashed and verified server-side. The server confirms integrity without reading content.
- Access is gated by Cashu NUT-00 blind signatures — anonymous credentials the mint cannot link to issuance. The server is blind. The till is also blind.
- No account required. Free tier: 4 GB, 7-day expiry. Paid tiers via Stripe (identified) or Lightning (pseudonymous).

**What it is not:**
- Not zero-knowledge in the metadata sense — file sizes, chunk counts, and timestamps are visible to the operator. Published honestly.
- Lightning payments are pseudonymous, not anonymous (Blink internal correlation possible — documented).
- No independent security audit yet. Target: B9 (cryptographic design review) → B11 (scoped pentest, findings published).

---

## What Legend is

**Legend** is a privacy-first Bitcoin block explorer and chain analytics tool built on a fork of Esplora (Blockstream, MIT licensed). It lives in `refueler-legend`.

**The problem it solves:** Every query to a public block explorer (Mempool.space, Blockstream.info) tells that server exactly which addresses and transactions you're watching. This is a structural metadata leak that affects everyone from individual Bitcoiners to family offices managing significant holdings. No existing explorer is architected to prevent it.

**URL:** `refueler.io/legend` (not a separate domain — domain authority consolidates on main domain)
**Licence:** MIT. Open source. Self-hosting available — "don't trust us, read the code."
**Prerequisite:** Lightning node live at B9. Do not start before B9 operational.

**Legend page layout (locked CSS-1a):** Wordmark, input field, tagline only above results. No green credential dot (removed — no semantic meaning until canary system is designed). No Silent Payments card (removed — feature not yet live). No below-fold three-column block (removed — turns a tool into a pitch; leaks competitive detail). Results render below input in the cleared space.

**Legend theme default (locked CSS-1a):** `getCookie('rs-theme') || 'carbon'` on the Legend template only. Carbon at rest for new visitors — narrows attention onto the query input. Cookie wins for returning visitors with an existing preference.

### What Legend does that nobody else does

**Privacy-first query architecture:**
- Own infrastructure — no query metadata leaks to Blockstream, Mempool.space, or any third party
- Ephemeral query sessions — no session persistence, no cookie tracking, no client correlation across queries
- Tor-native API for Enterprise — client IP never reaches the server
- PIR-inspired sharding (three dedicated nodes across two providers and two legal jurisdictions, fixed cost regardless of client count) — no single node sees the complete query; client reassembles locally. A world first for production Bitcoin chain data.

**Cashu query credentials — the Cashu model applied to chain queries:**
- Query budgets issued as Cashu blind signature tokens — same blind-signature infrastructure as Share
- Server cannot reconstruct a client's query history across sessions — structurally impossible, not a policy promise
- Free tier: 10 Legend queries earned per Share upload, 50/day cap
- Paid Share tiers: 50 queries per upload, uncapped daily
- Enterprise: unlimited, PIR-sharded, Tor-native, NUT-11 P2PK-bound credentials

**Proof-of-query receipts:**
- Blind receipt issued per query — cryptographic proof the query was processed without linking receipt to query content
- Client can verify they received N responses without revealing what they asked
- Useful for compliance-conscious enterprise clients and family offices demonstrating unloggable query behaviour to their legal team

**Silent Payments native (BIP-352):**
- First block explorer to display Silent Payments static addresses and derived outputs correctly
- Requires scanning every block — public explorers do not support this

**Modern analysis layer (beyond Mempool/Esplora legacy tooling):**
- UTXO age and provenance scoring — for compliance professionals understanding what they're receiving, without third-party analytics logging the query
- Lightning channel correlation — on-chain channel opens/closes correlated with own node data, privately
- Payment path reconstruction for own transactions — credential-gated, never revealed to operator
- Family office tooling: track BTC movements, flag suspicious activity, generate private reports

### Who Legend serves — the full stack, not just enterprise

**Plebs first.** The free tier (10 queries per Share upload, or 50/day standalone) gives every Bitcoiner a private alternative to Mempool.space for basic lookups. No account. No tracking. Privacy is not a luxury — it is the default.

**Lightning and Cashu wallet users.** Lightning nodes open and close channels on-chain. Those events are queryable. Legend gives Lightning wallet users (Mutiny, Phoenix, Breez, Zeus, Sparrow) a private way to track their own channel activity without revealing their node's footprint to a public explorer. Potential partnership: Sparrow Wallet (Craig Raw, post-B9) — already supports custom Esplora endpoints; Legend is API-compatible out of the box.

**Family offices (UK and US).** A family office managing significant Bitcoin holdings needs to track movements, verify receipt of payments, and monitor for suspicious activity — without broadcasting which addresses they watch to a public explorer. The compliance reporting layer (UTXO provenance scoring, movement history for credentialed addresses) maps directly to what a family office's legal team needs.

**The Coldcard/Coinkite moment (August 2026):** A serious entropy bug was discovered in Coldcard MK3 seed generation. Weak entropy means the keyspace is dramatically smaller than it should be — brute-force attacks on MK3 wallets are viable right now. Affected users need to check whether their addresses have been swept. But the moment you type your address into Mempool.space or Blockstream.info, you've told that server exactly which addresses you're worried about — handing a complete briefing to anyone monitoring those queries. Legend is the correct tool for this moment: private address monitoring, no metadata leak, no third-party knowledge of what you're checking. This is a genuine product-market fit moment. Article 14 should be written with this context in mind. The opening line is locked: "Every time you look up a Bitcoin address on a public block explorer, you're telling that server exactly what you own and what you're watching. Here's what we built instead, and why it matters for our clients."

### Business model

- Free: unlimited queries. No account. No payment. No rate limit. Funded by Enterprise cross-subsidy — the free tier is the proof the architecture works, not the product.
- Enterprise (family office): £1,500/month (v1) → £2,500/month (v2: Tor API, Double Ratchet, ML-KEM-768) → £3,500/month (v2+: dedicated node isolation). Invite-only at v1, capped at five clients. Full detail in `legend-enterprise-pricing.md`.
- Merchant add-on: £250/month per business entity, sold only into the existing Refueler POS merchant base. Never bundled with POS.
- Estate reports: £50 per block-height balance statement (v2), £150 full verified estate report (v3).
- Open source: self-hosting encouraged. Enterprise value lives in the institutional wrapper — FROST key management, warrant canaries, geographic jurisdiction distribution, SLA, compliance pack, named contact — not in closed code.

**Infrastructure cost:** ~€360/month (two Hetzner AX52 nodes in Germany and Finland; one FlokiNET dedicated node in Iceland). One Enterprise contract covers the infrastructure cost many times over. Full cost model in `legend-economics.md`.

**Traffic and cost model:** Free access is rate-limited by Cashu credentials. Enterprise revenue subsidises infrastructure before free tier scales. Sequence: Enterprise infrastructure first → open source → article 14 → free tier as proof of concept → Enterprise conversion. Legend does not open as a free unlimited public explorer until business model is proven.

---

## Design system — canonical tokens

All Refueler surfaces share these tokens. Divergences are bugs.

**Backgrounds (CSS-1a updated):**
- Paper (light): `--bg: #E8E2D8` · `--surface: #DAD4CA` · `--surface-raised: #D0C9BE`
- Carbon (dark): `--bg: #1A1A1A` · `--surface: #26282C` · `--surface-raised: #2E3035`

*Paper updated CSS-1a from `#F5F0E8` to `#E8E2D8` (quality laid paper / Middle Temple ivory — eases extended reading sessions for legal and family office users). Surface tokens adjusted proportionally.*

**Input fields (CSS-1a):**
- Paper: `#CCC7BE` (recessed well — cooler and more grey than background, not white)
- Carbon: `#252525` (unchanged — correct as-is)

**Text:**
- Paper: `--fg: #1A1A1A` · `--fg-muted: #5A5550` · `--fg-subtle: #9A9590`
- Carbon: `--fg: #F5F0E8` · `--fg-muted: #B0AAA2` · `--fg-subtle: #6A6560`

*Token naming: `--fg*` is the canonical primary system. `--text-primary/secondary/tertiary` are aliases pointing to `--fg*` values. Migration of `notes.css` from `--text-*` to `--fg*` happens in CSS-6.*

**Borders:**
- Paper: `--border: rgba(26,26,26,0.12)` · `--border-mid: #B8B2A8` · `--inset-rule: var(--border)`
- Carbon: `--border: rgba(245,240,232,0.10)` · `--border-mid: #4A4D52` · `--inset-rule: var(--border)`

**`--inset-rule` gold scope (CSS-1a — CC-74 lock superseded):**
Gold `--inset-rule` (`#C8A96E`) is valid **only** as an inline element style on `h2` dividers and blockquotes inside editorial and Notes article body content. It is **never** a token applied to nav borders, footer borders, card borders, or any chrome on any surface. Carbon `--inset-rule` is `var(--border)` — not gold globally. The CC-74 decision to set `--inset-rule: #C8A96E` in Carbon globally is superseded. Rationale: gold trim confirmed visually overdone in CSS-1a review across Share and Legend.

**Accent:**
- Gold (brand chrome, never CTA): `--accent: #C8A96E` · `--accent-hover: #E0C48A`
- **No CTA orange.** `--accent-action` is abolished. `#F5820A` and `#D4690A` do not exist in this codebase. Do not use. Do not define. Do not propose. This supersedes any prior reference to orange CTA tokens in any version of this document.

**Never:** gold as a primary CTA. Never orange anywhere.

**Card body text (locked CSS-1a):**
DM Sans 400, `line-height: 1.7`, `color: var(--fg)`. Not muted, not weight 300. The card surface provides visual softening — the text inside does not retreat further. Reference: Share status page card treatment.

**Typography:**
- `--font-heading / --heading: 'Satoshi', 'DM Sans', sans-serif` — metric values, wordmark, key labels (600/700)
- `--font-sans / --sans: 'DM Sans', sans-serif` — UI, body copy (300/400/500)
- `--font-serif / --serif: 'Source Serif 4', Georgia, serif` — long-form, editorial, `/notes/` body (300/400)
- `--font-mono / --mono: 'IBM Plex Mono', monospace` — timestamps, codes, data, table cells (400/500)
- Homepage headline only: `'Cormorant Garamond', Georgia, serif` 600 — loaded in `src/index.njk` only, never global

**Structural:**
- Border weight: `0.5px` throughout. Card radius: `10px`. Button radius: `8px`. Modal radius: `12px`.
- Theme toggle transition: `0.35s` simultaneous on all token properties.
- Theme detection: always `dataset.theme === 'carbon'`. Never `classList.contains('carbon-mode')`.
- Nav background: solid — no backdrop-filter or blur on any surface. `--nav-bg` is `#E8E2D8` (Paper) and `#1A1A1A` (Carbon).
- Note cards (Notes section): border-only in Carbon (transparent background). Surface tint in Paper only.

**Theme defaults:**
- All web surfaces: Paper default on page load (`getCookie('rs-theme') || 'paper'`).
- Legend template only: Carbon default (`getCookie('rs-theme') || 'carbon'`). Cookie wins for returning visitors.
- App / Command Centre / merchant terminal: Carbon always (separate from web cookie system).

**Theme persistence:** cookie `rs-theme` scoped to `.refueler.io` (30-day rolling, `SameSite=Lax`).

---

## Content architecture — refueler.io

**`/editorial/`** — Investor/partner long-form. Curated, slow, considered.

**`/notes/`** — SEO-targeted technical content for professional buyers. Higher cadence.
Audiences: lawyers, journalists, accountants, Bitcoin-adjacent professionals, legal/human rights workers, family offices.
Full pipeline in `notes-articles-list.md` in `refueler-share/`.

**`/legend/`** — Legend product surface. Post-B9.

**`/share/`** — Share product surface. Live as of M-2.

**All content on `refueler.io`.** No product content on subdomains.

---

## Writing style — `/notes/`

- First sentence is the most interesting thing in the piece. No throat-clearing.
- One idea per paragraph. Short paragraphs.
- Precision over completeness. Say the true thing simply.
- Dry wit from the gap between marketing claims and reality — let the gap do the work, don't point at it.
- Never: "military-grade", "zero-knowledge" as a headline, "Swiss-grade privacy", "anonymous payments".
- Always: honest about what the operator *can* see. State it before anyone asks.
- Source Serif 4 for body. IBM Plex Mono for data, table cells, any inline technical values.

---

## Video player in /notes/ and founder S1 modal

**Article video player:** R2 bucket → Worker signed URL → HTML5 `<video>` → Cloudflare edge at 1080p.
Download blocker via CSS + JS. No external platforms. Build scope: B9 or B13.

**Founder S1 modal:** Pre-recorded statement on `/status` during S1 incidents. R2 + signed URL.
Displayed only when `incident_active` KV = S1. Not sessionStorage-dismissible. Pre-record at B9 tabletop.

---

## Mission north star — internal only, never copy

> *"They come for privacy, they stay and then fall in love with Bitcoin."*

Every product decision, onboarding choice, and copy line across all repos is tested against this. If it accelerates that journey, ship it. If it doesn't, cut it.

**Ecosystem positioning (locked CC-77):** Refueler sits at the intersection of fiat and Bitcoin rails. Users choose their rail transaction by transaction. Refueler does not force, convert, or evangelise — it builds the infrastructure where both work, privately. The normie comes for privacy. Bitcoin does the rest.

---

## Upcoming product — Refueler Pass (working name)

Anonymous, fraud-resistant ticketing using Cashu NUT primitives. Same architectural principle as Share: blind credential issuance, offline-capable, no secondary market leakage. The ticket is a Cashu token. No repo yet. Name may change. Do not build copy or architecture around this name — note for ecosystem context only.

---

## Locked copy — do not reassign

| Line | Assigned to | Locked |
|---|---|---|
| *"Bitcoin, privately."* | Legend index page headline | CC-77 |
| *"Built for jurisdictions that have laws. And lawyers."* | Share plans/API page | CC-77 |
| *"Lightning payments — Tap and go. Sats or card, your call."* | Share plans page | CC-77 |

These lines are not available for homepage or general marketing use. Do not repurpose.

**Homepage copy (locked CC-79):**
- Overline: *Privacy Infrastructure · London*
- Headline: *Your transaction / is nobody else's / business.* *(three forced lines — "business." alone on line 3)*
- Subhead: *Privacy isn't a feature. It's the architecture.* *(DM Sans 300, full --fg, no hairline above)*
- Capability block:
  - Encrypted transfers / *The server is blind, so is the till.*
  - Bitcoin explorer / *Your search history is showing.*
  - Lightning payments / *Tap and go. Sats or card, your call.*

"Fiat or Bitcoin — privacy included." retired from homepage CC-79. Product pages only.
Headline font: Cormorant Garamond 600. Loaded in `src/index.njk` only, not global.
Accent column (Est. 2026 / rule / REFUELER): removed CC-79 — replace with Companies House reg on incorporation.
Homepage locked one month from CC-79. No iteration without a formal session decision.

---

## Legend — copy locked CC-78

**Homepage capability block (locked):**
- Label: *Bitcoin explorer*
- Descriptor: *Your search history is showing.*

**Legend index page (locked):**
- Headline: *Bitcoin, privately.* (locked CC-77)
- Opening line: *Buys non-KYC Bitcoin, then logs every address ever searched...*

**Discarded candidates (do not resurrect):**
- "Your queries don't leave a record." — too explanatory
- "Check your addresses. We won't remember that you did." — too long
- "Look up what you need. Nothing is logged." — too plain
- "The privacy gap you didn't know you had." — too vague
- "We can't see what you're watching. Neither can anyone else." — mid-page feature claim only, never opener

---

## Notes — article seeds (logged CC-78)

Add to `notes-articles-list.md` in `refueler-share/` at next Share session.

**Article: The browsing history problem**
*Audience:* lawyers, family offices, journalists, compliance professionals.
*Opening line candidate:* "Every address you look up on a public block explorer goes into a log you've never seen and cannot delete."

**Article: Family offices, UK merchants, and the Bitcoin address problem**
*Audience:* family offices (UK and US), UK merchants now holding BTC on the books, compliance professionals.
*Opening line candidate:* "Your accountant doesn't send your bank statements to a third party every time they check your balance. Your Bitcoin explorer does."

**Article: The Coldcard entropy bug — what to do and how to check privately**
*Audience:* Coldcard MK3 users, hardware wallet holders, security-conscious Bitcoiners.
*Note:* Time-sensitive. Publish close to bug disclosure. If Legend not live, reference architecture and link to waitlist.

---

## Competitive positioning — locked findings

**Anonymity spectrum:** WeTransfer/Smash/SwissTransfer → Tresorit/Proton Drive → Wormhole → **Refueler Share** → OnionShare.

**Wedge statements:**
- vs WeTransfer: "A server that can read your files is a server whose terms about your files matter. Ours stores noise."
- vs SwissTransfer: "Jurisdiction is not architecture."
- vs Proton Drive: "No account to correlate. The payment itself is blinded."
- vs OnionShare: "Close your laptop. The transfer survives."
- vs synchronous P2P: "The transfer survives your client being on a plane."
- vs Mempool/Blockstream: "We can't see what you're watching. Neither can anyone else."

**B9 whitepaper framing:** "The server is blind and so is the till."

---

## Current build status

**`refueler-share`:** B6 complete (S72a). B7 opens imminently. 212 tests passing across 8 suites.
Confirmed Eleventy (`@11ty/eleventy ^3.0.0`). Migrated to `refueler.io/share/` in M-2.
Cloudflare: `refueler-share` Pages project still serving `share.refueler.io` — retire after M-3. Worker (`refueler-share.rt-fc4.workers.dev`, version `af37c80b`) CORS updated to accept `https://refueler.io`.
Known issue: `ReferenceError: share is not defined` on upgrade page — pre-existing, carry through to M-3.
Outstanding M-3: Stripe return URLs in Worker (lines 1052, 1053, 1117 of `worker/src/index.js`) still point to `share.refueler.io/upgrade`. Fix in M-3.

**`refueler-io`:** `/notes/` live. Article 1 published. Articles 2–14 planned.
Homepage redesigned CC-79. All four editorial articles migrated CC-79/80. Nav pages restored CC-80.
Share live at `refueler.io/share/` — M-2 complete. M-3 verification next. CSS rationalisation track (CSS-1b, CSS-2 through CSS-6) follows M-3.

**`refueler-legend` (Legend):** Shell live at `refueler.io/legend`. No query logic yet. Starts post-B9.

---

## Key rules that apply everywhere

- Theme detection: `dataset.theme === 'carbon'` only. Never `classList.contains`.
- `var(--accent)` fails on `<p>` tags — use `#C8A96E !important` for gold on `p` elements until CSS rationalisation complete.
- All new homepage classes prefixed `home-` — CSS cascade defence.
- Cookie `rs-theme` scoped to `.refueler.io` for cross-domain theme persistence.
- No inline CSS/JS in Nunjucks templates — external files only.
- `showSaveFilePicker()` must fire synchronously from a user gesture.
- No localStorage for credentials — browser memory only.
- Do not claim "audit-certified" or "security-audited" — blocked until B11 pentest published.
- Do not claim "anonymous payment" — Proton accepts BTC/cash, claim is false.
- Do not claim "end-to-end file integrity" — only server-side chunk integrity is verified today.
- No external video platforms (YouTube, Vimeo) — R2 + Worker signed URL only.
- Legend does not start before B9 Lightning node is live. No exceptions.
- **`#F5820A` and `#D4690A` do not exist in this codebase.** Orange is abolished.
- **Paper is `#E8E2D8`. Carbon is `#1A1A1A`.** All other background values are wrong.
- **`--inset-rule` gold is article content only** — never chrome.
- **No subdomains for new products** — `refueler.io/[product]/` always.

---

## Cross-project actions — status

### refueler-io — AP-7 ✅ Closed CC-72/CC-74
### refueler-legend — cross-project sign-off ✅ Closed CC-74
### refueler-share — CSS architecture ✅ Closed CC-75
### refueler-io — homepage ✅ Closed CC-78
### refueler-io — editorial articles ✅ Closed CC-80
### refueler-share — Block M migration (M-1, M-2) ✅ M-1 + M-2 closed

### refueler-share — Block M migration (M-3) 🟡 Next
Verify `refueler.io/share/` end-to-end. Fix Stripe return URLs in Worker. Fix Plans active state. Retire `refueler-share` Pages project. See SESSIONS for M-3 opening prompt.

### refueler-io — CSS rationalisation track 🟡 After M-3
CSS-1b (nav architecture, Opus) → CSS-2 through CSS-6. See SESSIONS file for full sequence and opening prompts.

---

## CC-74 — Global CSS migration completion · 4 Aug 2026

*(History preserved — see previous BRIDGE versions for full detail.)*

Key locked rules from CC-74 still in force:
- Carbon background: `#1A1A1A`. Paper background: `#E8E2D8` *(updated CSS-1a)*.
- No backdrop-filter / frosted glass on any surface.
- No body theme scripts — `head.njk` is the single owner.
- No inline `:root` blocks on any page.
- Index.njk naming: section-prefixed when produced by Claude.

CC-74 `--inset-rule: #C8A96E` Carbon global rule **superseded by CSS-1a.** See Design system above.

---

## AP-8 — Nav, theme, and support fixes · 4 Aug 2026

*(History preserved.)*

Nav architecture from AP-8 is superseded by CSS-1b output (pending). The AP-8 nav decisions for the subdomain (`share.refueler.io`) are moot post Block M migration.

---

## CC-75/76 — Share CSS complete · 4 Aug 2026

*(History preserved.)*

`share-tokens.css` single token source confirmed. Post Block M, `share-tokens.css` merges into `global.css` and Share pages load via the shared `head.njk`. Currently staging as `src/share/assets/share-tokens.css` in `refueler-io`.

---

## M-2 — Share migration execution · 8 Aug 2026

`refueler.io/share/` live. Commits `213798d`, `8abf0c5`, `e577379`. Worker redeployed `af37c80b`. Turnstile `refueler.io` hostname added. Share nav/footer as `src/_includes/share-nav.njk` and `src/_includes/share-footer.njk`. Main site nav updated with Share link.

---

*"Nothing stops this train."*
