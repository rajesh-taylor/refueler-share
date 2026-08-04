# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 2.0 | **Created:** 28 July 2026 | **Updated:** CC-79 · 5 Aug 2026
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

**The Coldcard/Coinkite moment (August 2026):** A serious entropy bug was discovered in Coldcard MK3 seed generation. Weak entropy means the keyspace is dramatically smaller than it should be — brute-force attacks on MK3 wallets are viable right now. Affected users need to check whether their addresses have been swept. But the moment you type your address into Mempool.space or Blockstream.info, you've told that server exactly which addresses you're worried about — handing a complete briefing to anyone monitoring those queries. Legend is the correct tool for this moment: private address monitoring, no metadata leak, no third-party knowledge of what you're checking. This is a genuine product-market fit moment. Article 14 should be written with this context in mind. The opening line is locked: "Every time you look up a Bitcoin address on a public block explorer, you're telling that server exactly what you own and what you're watching. Here's what we built instead, and why it matters for our clients."

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
- Carbon (dark): `--bg: #1A1A1A` · `--surface: #26282C` · `--surface-raised: #2E3035`

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
- Nav background: solid — no backdrop-filter or blur on any surface. `--nav-bg` is `#F5F0E8` (Paper) and `#1A1A1A` (Carbon).
- Note cards (Notes section): border-only in Carbon (transparent background). Surface tint in Paper only.

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
| *"Built for jurisdictions that have laws. And lawyers."* | Share API / paid plans page | CC-77 |
| *"Lightning payments — Tap and go. Sats or card, your call."* | Share paid plans / upgrade page | CC-77 |

These lines are not available for homepage or general marketing use. Do not repurpose.

**Homepage copy (locked CC-79):**
- Overline: *Privacy Infrastructure · London*
- Headline: *Your transaction / is nobody else's / business.* *(three forced lines — "business." alone on line 3)*
- Accent column: *Est. 2026 · vertical rule · REFUELER* *(gold, right of headline)*
- Subhead: *Privacy isn't a feature. It's the architecture.* *(DM Sans 300, full --fg, no hairline above)*
- Capability block:
  - Encrypted transfers / *The server is blind, so is the till.*
  - Bitcoin explorer / *Your search history is showing.*
  - Lightning payments / *Tap and go. Sats or card, your call.*

"Fiat or Bitcoin — privacy included." retired from homepage CC-79 — doesn't represent Share or Legend. Belongs on product pages only.
Headline font changed CC-79: Cormorant Garamond 600 — replaces DM Sans 300. Loaded in `src/index.njk` only, not global.
Subhead: DM Sans 300 roman, full `var(--fg)` — no italic, no hairline above, reads as next sentence after headline.
Hairline between headline and subhead removed — subhead flows as continuation, not new section.
Accent column: Est. 2026 / vertical rule / REFUELER in gold. Replace with Companies House reg number on incorporation.

---

## Legend — copy locked CC-78

**Homepage capability block (locked):**
- Label: *Bitcoin explorer*
- Descriptor: *Your search history is showing.*

Rationale: creates the itch without revealing it. Non-bitcoiner reads it as a general privacy statement. Pleb reads it and knows exactly what their Mempool query log means. The reveal happens on the Legend index page.

**Legend index page (locked):**
- Headline: *Bitcoin, privately.* (locked CC-77)
- Opening line: *Buys non-KYC Bitcoin, then logs every address ever searched...*

Rationale: the irony lands instantly for the target audience. No explanation needed. Pairs with the homepage hook — the homepage planted the seed, the Legend page detonates it.

**Discarded candidates (do not resurrect):**
- "Your queries don't leave a record." — too explanatory, loses the hook quality
- "Check your addresses. We won't remember that you did." — too long for capability descriptor
- "Look up what you need. Nothing is logged." — too plain
- "The privacy gap you didn't know you had." — too vague
- "We can't see what you're watching. Neither can anyone else." — better as mid-page feature claim, not opener

---

## Notes — article seeds (logged CC-78)

These article concepts emerged from CC-78 planning discussion. Add to `notes-articles-list.md` in `refueler-share/` at next Share session.

**Article: The browsing history problem**
*Audience:* lawyers, family offices, journalists, compliance professionals.
*Angle:* A Mempool or Esplora query log is extraordinarily valuable to the right buyer. Every query is timestamped and IP-tagged. Aggregate enough of them and you can reconstruct which addresses a person monitors, transaction timing relative to query time, session clustering (addresses queried together are probably related), and behavioural patterns. Chain analysis firms don't just work on-chain — off-chain behavioural signals dramatically improve clustering confidence. A Mempool query log handed to Chainalysis cross-references on-chain clusters with real IP addresses and timestamps. For hackers: a stolen query log is pre-attack reconnaissance delivered voluntarily by the victim. For insurers: query logs are actuarial data the policyholder never consented to share — UK insurers taking on BTC custody risk will want this data. Legend is the answer before it becomes the problem.
*Opening line candidate:* "Every address you look up on a public block explorer goes into a log you've never seen and cannot delete."

**Article: Family offices, UK merchants, and the Bitcoin address problem**
*Audience:* family offices (UK and US), UK merchants now holding BTC on the books, compliance professionals.
*Angle:* Family offices need to verify receipts, monitor addresses, and track movements for compliance — without broadcasting which addresses they watch to a third party whose query logs could surface in discovery, be subpoenaed, or be sold after an acquisition. UK merchants checking incoming payments are mapping their customer base and transaction volume with every query — a competitor, an insurer, or HMRC with a data request to the explorer operator could reconstruct their Bitcoin revenue picture. The compliance workflow (address monitoring, movement history, UTXO provenance) is the same whether you're a family office or a café in Limehouse. The metadata leak is identical. Legend solves both.
*Opening line candidate:* "Your accountant doesn't send your bank statements to a third party every time they check your balance. Your Bitcoin explorer does."

**Article: The Coldcard entropy bug — what to do and how to check privately**
*Audience:* Coldcard MK3 users, hardware wallet holders, security-conscious Bitcoiners.
*Angle:* The MK3 entropy bug means the keyspace for affected seed phrases is dramatically smaller than users assumed — brute-force is viable. The natural instinct is to check whether your addresses have been swept. But checking on a public explorer compounds the problem: you've now told Mempool.space exactly which addresses you're monitoring, at exactly the moment those addresses are at risk. The correct procedure: check privately, sweep to a new wallet generated on unaffected hardware, verify the sweep privately. Legend is the tool for steps 1 and 3.
*Note:* Time-sensitive. Publish as close to the bug disclosure as possible. Do not wait for B9 — if Legend is not live, the article can reference the architecture and link to the waitlist.

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
CSS architecture complete (CC-75): `share-tokens.css` is single token source. Theme toggle confirmed working live on index, upgrade, and status pages (CC-76 verification).
Known issue: `ReferenceError: share is not defined` on upgrade page — pre-existing, carry to Share project.

**`refueler-io`:** `/notes/` live. Article 1 published. Articles 2–14 planned.
CSS architecture partially complete. `global.css` owns all tokens for notes, support, privacy, editorial index, legend, homepage. Theme carries correctly on those pages.
Homepage redesigned CC-79 (commit `f34a944`): Cormorant Garamond 600 headline, banded layout, overline + accent column, new subhead copy. `home.css` fully rewritten. `src/index.njk` rewritten. Mobile auth deep-link handler retained.
Two editorial articles migrated CC-79 (commit `553313f`): `the-city-worker` + `nothing-to-collect-nothing-to-hide` — `:root` token blocks stripped, wrong hex values removed.
Remaining unmigrated pages (CC-80): `looks-done-isnt-done` + `the-float` — same `:root` issue. After CC-80 all pages share one token system and colour divergence is permanently resolved.

**`refueler-legend` (Legend):** Shell live at `refueler.io/legend`. No query logic yet. Starts post-B9.

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

### refueler-legend — cross-project sign-off ✅ Closed CC-74

Legend page Paper/Carbon confirmed working. `global.css` loads correctly from `/legend/` route.
`legend.css` stripped to layout only — no token overrides.
Multi-8 (first query flow) can proceed.

### refueler-share — CSS architecture ✅ Closed CC-75

`share-tokens.css` is the single token source for all Share pages. Loaded via `head.njk` on every Eleventy page, linked externally from `frontend/index.html`. No Share page defines its own `:root` token block. Theme toggle confirmed working live on all three pages (CC-76).

### refueler-io — homepage ✅ Closed CC-78

`src/index.njk` migrated. `home.css` created. Tokens stripped. `head.njk` added. `rs-theme` cookie. `backdrop-filter` removed. CC-77/78 copy live. Sign-in panel removed. Mobile auth deep-link handler retained. Commit `f267602`.

### refueler-io — editorial articles ⚠️ Partial — CC-80 pending

**Problem:** Four editorial articles had inline `<style>` `:root` blocks with wrong hex values (`#1E1F22`, `#F7F4EF`). Causes colour divergence.

**Status:**
- CC-79 ✅ `the-city-worker` + `nothing-to-collect` — `:root` blocks stripped. Commit `553313f`.
- CC-80 ⚠️ `looks-done-isnt-done` + `the-float` — pending. Read live files first before touching.

**Rule locked CC-76:** Editorial articles may keep widget/layout CSS inline. They must never define a `:root` token block.

---

## CC-74 — Global CSS migration completion · 4 Aug 2026

**Repos touched:** `refueler-io`, `refueler-share`, `refueler-legend`

### What was done

**`refueler-io`:**
- `legend.css` stripped to layout only — was overriding `global.css` with wrong token values
- `editorial.css`, `support.css`, `privacy.css` created — all page-specific layout extracted from inline `<style>` blocks
- Inline `<style>` and body-level theme `<script>` removed from `editorial/index.njk`, `privacy/index.njk`, `support/index.njk`
- `notes.js` theme migrated from `localStorage`/`rfTheme` to `rs-theme` cookie
- Carbon background standardised to `#1A1A1A` in `notes.css` (was `#1E1F22`)
- BRIDGE `--bg` Carbon token updated to `#1A1A1A` across all three repos

**`refueler-share`:**
- `upgrade.css` `html.carbon-mode` selector → `[data-theme="carbon"]`
- `frontend/index.html` three conflicting theme scripts → one clean `rs-theme` cookie script
- `frontend/index.html` inline `<style>` Carbon selector: `html.carbon-mode` → `[data-theme="carbon"]`
- `frontend/index.html` wordmark `href` fixed: `https://refueler.io/` → `/`
- `src/_includes/nav.njk` wordmark `href` fixed: `https://refueler.io/` → `/`

**Additional CSS fixes (same session):**
- `global.css` — backdrop-filter and -webkit-backdrop-filter removed. `--nav-bg` made solid: `#F5F0E8` Paper, `#1A1A1A` Carbon. No frosted glass on any Refueler surface.
- `legend.css` — `.legend-cred-icon` background changed from `var(--accent)` (gold) to `#1E8A4A` (green). Credential dot should indicate operational status, not earned/premium state.
- `notes.css` — `.note-card` background transparent in Carbon via `[data-theme="carbon"]` override. Paper retains `var(--surface)` tint. Hover in Carbon: border lift only, no background flash.

### Locked rules added CC-74

- **Carbon background:** `#1A1A1A` canonical on all surfaces. `#1E1F22` is wrong.
- **Paper background:** `#F5F0E8` canonical on all surfaces. `#F7F4EF` is wrong.
- **No backdrop-filter / frosted glass:** Banned on all Refueler surfaces. Nav backgrounds are solid. `global.css` and `share-tokens.css` must never include `backdrop-filter`.
- **No body theme scripts:** `head.njk` is the single theme script owner on each domain.
- **No inline `:root` blocks:** Page CSS files define layout only. Token file owns all tokens.
- **Index.njk naming:** Files produced by Claude named with section prefix (e.g. `legend-index.njk`) to prevent upload collisions. Real names on disk.

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

## CC-75/76 — Share CSS complete, refueler-io divergence diagnosed · 4 Aug 2026

**Repos touched:** `refueler-share`, `refueler-io`

### CC-75 — Share CSS architecture

- `share-tokens.css` created as single token source for all Share pages
- `head.njk` (Share) updated to load `share-tokens.css` via `<link>` on every Eleventy page
- `frontend/index.html` updated to link `share-tokens.css` externally — inline `<style>` block removed
- `upgrade.css` stripped to layout only — no `:root` block
- `status.css` created — layout only, no `:root` block
- Theme toggle confirmed working on index, upgrade, status (CC-76 live verification)

### CC-76 — Live verification and divergence diagnosis

- Full source audit of refueler.io and share.refueler.io confirmed
- Colour divergence root cause identified: homepage and editorial articles have own token blocks with wrong hex values
- Session plan CC-77–82 locked (see refueler-io MasterContext)

### Locked rules added CC-75/76

- **No Share page may define its own `:root` token block** — `share-tokens.css` is the single source
- **Editorial articles may keep widget/layout CSS inline — never a `:root` token block**
- **Every new page on any Refueler domain must load the domain token file before any other code** (`head.njk` on refueler.io and share.refueler.io; equivalent on any future domain)
- **EDITORIAL-MASTER.md CSS token values are wrong** — that file predates the CC-74 hex lock. Never use `#1E1F22` or `#F7F4EF`. Canonical values: Carbon `#1A1A1A`, Paper `#F5F0E8`.

---

*"Nothing stops this train."*
