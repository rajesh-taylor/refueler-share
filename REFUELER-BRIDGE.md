# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 1.5 | **Created:** 28 July 2026 | **Updated:** CC-74 · 4 Aug 2026
> Lives in `refueler-share`, `refueler-io` (docs/), and `refueler-legend` repos. Committed to each.
> Updated at every block close. Attach to any Claude Project to establish shared context.
> This file is the handshake between Projects — not a substitute for repo-specific context files.

---

## What Refueler is

Refueler is a suite of Bitcoin-native products built by Rajesh Taylor (solo founder, London).
The wider ecosystem includes a merchant POS (`refueler.io`), a mint, and several experimental repos.
Products in active development: **Refueler Share** (file transfer) and **Legend** (private chain explorer, post-B9).

**Local paths:**
- Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/`
- Share: `/Users/rajeshtaylor/Documents/refueler-share/`
- Legend / multi-core: `/Users/rajeshtaylor/Documents/refueler-legend/`

**GitHub:** `github.com/rajesh-taylor`

---

## What Refueler Share is

Anonymous, encrypted peer-to-peer file transfer. No account. No identity. The server stores encrypted noise and cannot read file content or identify users.

**The one-line positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."

**Two-axis category definition (locked AP-7):**
Refueler Share is the only architecture that solves both failures simultaneously:
1. **The recipient problem** — the transfer survives the sender closing their laptop; it survives the recipient being on a plane. Every synchronous P2P tool fails this by design.
2. **The compulsion problem** — there is nothing to hand over, not because we'd refuse, but because we never had it. Every storing service with server-side keys fails this by design.

**The core technical claim (honest scope):**
- Files are AES-GCM encrypted client-side. The encryption key lives in the URL fragment — never transmitted to the server.
- Every chunk is BLAKE3-hashed and verified server-side. The server confirms integrity without reading content.
- Access is gated by Cashu NUT-00 blind signatures — anonymous credentials the mint cannot link to issuance. The server is blind. The till is also blind.
- No account required. Free tier: 4 GB, 7-day expiry. Paid tiers via Stripe (identified) or Lightning (pseudonymous).

**Live at:** `share.refueler.io`
**Repo:** `rajesh-taylor/refueler-share` (Apache 2.0, public)

**What it is not:**
- Not zero-knowledge in the metadata sense — file sizes, chunk counts, and timestamps are visible to the operator. Published honestly.
- Lightning payments are pseudonymous, not anonymous (Blink internal correlation possible — documented).
- No independent security audit yet. Target: B9 (cryptographic design review) → B11 (scoped pentest, findings published).

---

## What Legend is

**Legend** is a privacy-first Bitcoin block explorer and chain analytics tool built on a fork of Esplora (Blockstream, MIT licensed). It lives in `refueler-legend`.

**The problem it solves:** Every query to a public block explorer (Mempool.space, Blockstream.info) tells that server exactly which addresses and transactions you're watching. This is a structural metadata leak that affects everyone from individual Bitcoiners to family offices managing significant holdings. No existing explorer is architected to prevent it.

**URL:** `refueler.io/legend` (not a separate domain — domain authority consolidates on main domain)
**Licence:** Apache 2.0. Open source. Self-hosting available — "don't trust us, read the code."
**Prerequisite:** Lightning node live at B9. Do not start before B9 operational.

### What Legend does that nobody else does

**Privacy-first query architecture:**
- Own infrastructure — no query metadata leaks to Blockstream, Mempool.space, or any third party
- Ephemeral query sessions — no session persistence, no cookie tracking, no client correlation across queries
- Tor-native API for Enterprise — client IP never reaches the server
- PIR-inspired sharding (3-5 Hetzner nodes, fixed cost regardless of client count) — no single node sees the complete query; client reassembles locally. A world first for production Bitcoin chain data.

**Cashu query credentials — the Cashu model applied to chain queries:**
- Query budgets issued as Cashu blind signature tokens — same infrastructure as Share
- Server cannot reconstruct a client's query history across sessions — structurally impossible, not a policy promise
- Free tier: 10 Legend queries earned per Share upload, 50/day cap
- Paid Share tiers: 50 queries per upload, uncapped daily
- Enterprise: unlimited, PIR-sharded, Tor-native

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

**The Coldcard/Coinkite moment (August 2026):** The breach exposed customer shipping addresses and potentially wallet addresses. Anyone who purchased a Coldcard has reason to believe their Bitcoin addresses may be known to the attacker. Checking whether those addresses have been swept on a public explorer tells Mempool.space exactly which addresses you're worried about — compounding the privacy loss. Legend is the correct tool for this scenario: private address monitoring, no metadata leak, no third-party knowledge of what you're watching. This is a genuine product-market fit moment. Article 14 should be written with this context in mind. The opening line is locked: "Every time you look up a Bitcoin address on a public block explorer, you're telling that server exactly what you own and what you're watching. Here's what we built instead, and why it matters for our clients."

### Business model

- Free: 10 queries per Share upload or 50/day standalone. No account required.
- Paid Share subscribers: 50 queries per upload, uncapped daily, included in Creative Premium and above.
- Enterprise: unlimited, full PIR stack, Tor API, Silent Payments scanning, family office reporting, self-hosting option with setup and support contract.
- Open source: self-hosting encouraged. Enterprise value lives in the Cashu credential integration, Silent Payments scanning layer, and managed infrastructure — not in closed code.

**Traffic and cost model:** Free access is rate-limited by Cashu credentials. Enterprise revenue subsidises infrastructure before free tier scales. Sequence: Enterprise infrastructure first → open source → article 14 → free tier as proof of concept → Enterprise conversion. Legend does not open as a free unlimited public explorer until business model is proven.

---

## Design system — canonical tokens

All Refueler surfaces share these tokens. Divergences are bugs.

**Backgrounds:**
- Paper (light): `--bg: #F5F0E8` · `--surface: #EDEAE4` · `--surface-raised: #E4E1DA`
- Carbon (dark): `--bg: #1E1F22` · `--surface: #26282C` · `--surface-raised: #2E3035`

**Text:**
- Paper: `--text-primary: #3D3A36` · `--text-secondary: #5A5751` · `--text-tertiary: #9A948D`
- Carbon: `--text-primary: #E4E2DC` · `--text-secondary: #8A8680` · `--text-tertiary: #5A5751`

**Borders:**
- Paper: `--border: #D6D1C8` · `--border-mid: #B8B2A8` · `--inset-rule: var(--border)`
- Carbon: `--border: #35373B` · `--border-mid: #4A4D52` · `--inset-rule: #C8A96E`

**Accent:**
- Gold (brand chrome, never CTA): `--accent: #C8A96E` · `--accent-hover: #E0C48A`
- Orange (CTA only, consumer surfaces): Paper `--accent-action: #D4690A` · Carbon `--accent-action: #F5820A`

**Never:** orange on internal/admin surfaces. Never gold as a primary CTA.

**Typography:**
- `--heading: 'Satoshi', 'DM Sans', sans-serif` — metric values, wordmark, key labels (700)
- `--sans: 'DM Sans', sans-serif` — UI, body copy (300/400/500)
- `--serif: 'Source Serif 4', Georgia, serif` — long-form, editorial, `/notes/` body (300/400)
- `--mono: 'IBM Plex Mono', monospace` — timestamps, codes, data, table cells (400/500)

**Structural:**
- Border weight: `0.5px` throughout. Card radius: `10px`. Button radius: `8px`. Modal radius: `12px`.
- Theme toggle transition: `0.35s` simultaneous on all token properties.
- Theme detection: always `dataset.theme === 'carbon'`. Never `classList.contains('carbon-mode')`.

**Theme persistence:** cookie `rs-theme` scoped to `.refueler.io` (set on both domains).

---

## Content architecture — refueler.io

**`/editorial/`** — Investor/partner long-form. Curated, slow, considered.

**`/notes/`** — SEO-targeted technical content for professional buyers. Higher cadence.
Audiences: lawyers, journalists, accountants, Bitcoin-adjacent professionals, legal/human rights workers, family offices.
Full pipeline in `notes-articles-list.md` in `refueler-share/`.

**`/legend/`** — Legend product surface. Post-B9.

**Do not publish Share or Legend articles on subdomains** — all content on `refueler.io`.

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

**`refueler-io`:** `/notes/` live. Article 1 published, iteration open from 5 Aug. Articles 2–14 planned.
Legend shell live at `refueler.io/legend` (Multi-7). Nav updated: App → Legend. `src/assets` passthrough added to Eleventy config.
Pending: shared nav/footer CSS extraction (see Cross-project actions below).

**`refueler-legend` (Legend):** Phase 1 open (Multi-7). Shell and SPA mount live in `refueler-io`. No query logic yet. Next: Multi-8 — first query flow.

---

## Key rules that apply everywhere

- Theme detection: `dataset.theme === 'carbon'` only. Never `classList.contains`.
- Cookie `rs-theme` scoped to `.refueler.io` for cross-domain theme persistence.
- No inline CSS/JS in Nunjucks templates — external files only.
- `showSaveFilePicker()` must fire synchronously from a user gesture.
- No localStorage for credentials — browser memory only.
- Do not claim "audit-certified" or "security-audited" — blocked until B11 pentest published.
- Do not claim "anonymous payment" — Proton accepts BTC/cash, claim is false.
- Do not claim "end-to-end file integrity" — only server-side chunk integrity is verified today.
- No external video platforms (YouTube, Vimeo) — R2 + Worker signed URL only.
- Legend does not start before B9 Lightning node is live. No exceptions.

---

## Cross-project actions — pending

These items span two projects and must be actioned in the project indicated.
Do not close the relevant session without confirming each item is resolved.

### refueler-io — AP-7 actions ✅ Closed CC-72/CC-74

**1. Extract shared nav and footer CSS.** ✅ Done CC-72.
`src/assets/css/global.css` created. All nav, footer, brand tokens, and reset extracted.
Loaded via `head.njk` `<link>` on every page. `src/index.njk` inline styles redundant.

**2. Fix theme detection.** ✅ Done CC-72/CC-73/CC-74.
All pages now use `rs-theme` cookie + `dataset.theme` only.
`localStorage`, `rfTheme`, and `classList.add('carbon-mode')` fully removed
from `head.njk`, `editorial/index.njk`, `privacy/index.njk`, `support/index.njk`,
and `share/frontend/index.html`. CSS selectors use `[data-theme="carbon"]` throughout.

**3. Rotate the Anthropic API key.** ✅ Done CC-72.
Key disabled. `refueler_csuite_briefing_v2_4.html` cleaned — placeholder in place.
New key must be generated and stored outside any repo before csuite briefing is reused.

### refueler-legend — cross-project sign-off ⚠️ Partially open

Legend page still rendering white in Paper mode after CC-74 CSS fixes.
Suspect `global.css` path not resolving from `/legend/` route on Cloudflare Pages,
or a Cloudflare cache issue. First action of next Legend session: verify via
browser devtools network tab that `/assets/css/global.css` loads on `/legend/`.
Multi-8 (first query flow) gated until this is confirmed green.

---

## AP-8 — Nav, theme, and support fixes · 4 Aug 2026

**Repos touched:** `refueler-io`, `refueler-share`

### What was done

**`refueler-io` — `src/_includes/nav.njk`:**
- Fixed hardcoded `"Legend"` breadcrumb default. Wordmark breadcrumb (`/ SECTION`) now only renders when a page explicitly passes `wordmarkSection` in its frontmatter. Pages that omit it (homepage, support, privacy, editorial, notes) show a clean `REFUELER` wordmark with no slash.
- Legend page already passes `wordmarkSection: "Legend"` — unaffected.
- Any future product page should pass its own `wordmarkSection` value.

**`refueler-io` — `src/support/index.njk`:**
- `privacy@refueler.io` replaced with `support@refueler.io` throughout (body copy, contact panel, footer email link). `privacy@` retained as a secondary option in the contact panel body — correct for GDPR queries.
- Inset blockquote rewritten: removed app-specific "missed order / reward" copy. Now generic across all Refueler products.
- "What can I raise?" list items 1 and 2 genericised — previously named app-specific scenarios.
- Inline theme script updated: `localStorage` + `classList.add('carbon-mode')` replaced with `rs-theme` cookie scoped to `.refueler.io` + `dataset.theme` attribute. Consistent with CC-72 pattern across the rest of the site.
- Footer email link updated to `support@refueler.io`.

**`refueler-share` — `src/_includes/nav.njk`:**
- Removed: App, Editorial, Privacy links (wrong domain, wrong audience for Share).
- Added: Notes (`refueler.io/notes/`), Support (`refueler.io/support/`).
- Kept: Upgrade (`/upgrade.html` — Share-specific, correct home), theme pill.
- Wordmark stays `REFUELER / SHARE`.
- Legend deliberately omitted — not fully live, adding a link now is premature.

**`refueler-share` — `src/_includes/head.njk`:**
- Theme script rewritten: `localStorage` + `rfTheme` key replaced with `rs-theme` cookie scoped to `.refueler.io` (30-day rolling, `SameSite=Lax`).
- `classList` pattern removed entirely. `dataset.theme` attribute only — `[data-theme="carbon"]` CSS selector.
- `window.toggleTheme` exposed as global for nav pill `onclick`.
- Cross-domain theme persistence now works between `refueler.io` and `share.refueler.io` — visitor toggling on either domain carries their preference to the other.

### Nav architecture decision — locked AP-8

**Main site (`refueler.io`):** Ecosystem nav. Carries Legend, Editorial, Notes, Privacy, theme pill. No Upgrade link — Upgrade is Share-specific.

**Share (`share.refueler.io`):** Product nav. Notes, Upgrade, Support, theme pill. No Editorial, no Privacy (footer only on Share — correct for a legal document). Status in Share footer only.

### Required updates — Share project

**`Share-Master-Context.md` must record:**
- `head.njk` theme script: `localStorage`/`rfTheme` → `rs-theme` cookie, `.refueler.io` scoped, `dataset.theme` only
- `nav.njk` link set: Notes, Upgrade, Support, theme pill. App/Editorial/Privacy removed.
- Theme persistence: cross-domain between `refueler.io` and `share.refueler.io` via `rs-theme` cookie — confirmed working AP-8

**`share-sessions.md` must record:**
- AP-8 session entry: nav rewrite + head.njk theme script rewrite. Committed to `refueler-share` main.
- Files changed: `src/_includes/nav.njk`, `src/_includes/head.njk`
- No Eleventy collection changes. No CSS changes. No JS changes.

---

*"Nothing stops this train."*
