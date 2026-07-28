# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 1.0 | **Created:** 28 July 2026
> Lives in both `refueler-share` and `refueler-io` repos. Committed to each.
> Updated at every block close. Attach to any Claude Project to establish shared context.
> This file is the handshake between Projects — not a substitute for repo-specific context files.

---

## What Refueler is

Refueler is a suite of Bitcoin-native products built by Rajesh Taylor (solo founder, London).
The wider ecosystem includes a merchant POS (`refueler.io`), a mint, and several experimental repos.
The product in active development is **Refueler Share**.

**Local paths:**
- Main site + POS: `/Users/rajeshtaylor/Documents/refueler-io/`
- Share: `/Users/rajeshtaylor/Documents/refueler-share/`

**GitHub:** `github.com/rajesh-taylor`

---

## What Refueler Share is

Anonymous, encrypted peer-to-peer file transfer. No account. No identity. The server stores encrypted noise and cannot read file content or identify users.

**The one-line positioning:** "Professional-grade anonymity where only one side needs to be sophisticated."

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

## Design system — canonical tokens

All Refueler surfaces share these tokens. Divergences are bugs.

**Backgrounds:**
- Paper (light): `--bg: #F7F4EF` · `--surface: #EDEAE4` · `--surface-raised: #E4E1DA`
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

**`/editorial/`** — Investor/partner long-form. Curated, slow, considered. Existing articles live here.
Example: `refueler.io/editorial/looks-done-isnt-done`

**`/notes/`** — NEW. SEO-targeted technical content for professional buyers. Higher cadence.
Audiences: lawyers, journalists, accountants, Bitcoin-adjacent professionals.
Register: authoritative, precise, dry wit permitted. Shorter sentences than editorial.
Index: card grid (title, one-sentence description, date, read time). Each article its own URL.
Articles live on `refueler.io/notes/[slug]/` — domain authority consolidates on main domain.

**Do not publish Share-specific articles on `share.refueler.io`** — all content on `refueler.io`.

**`/notes/` articles planned:**
1. "What a subpoena gets from seven file transfer services" — publish immediately (no product dependency)
2. "Why our till is blind" — publish after B7 Lightning is live (article references Lightning payment)

---

## Writing style — `/notes/`

- First sentence is the most interesting thing in the piece. No throat-clearing.
- One idea per paragraph. Short paragraphs.
- Precision over completeness. Say the true thing simply.
- Dry wit from the gap between marketing claims and reality — let the gap do the work, don't point at it.
- Never: "military-grade", "zero-knowledge" as a headline, "Swiss-grade privacy", "anonymous payments" (Proton accepts BTC/cash — this claim is false).
- Always: honest about what the operator *can* see (sizes, timing, edge IPs). State it before anyone asks.
- Source Serif 4 for body. IBM Plex Mono for data, table cells, any inline technical values.

---

## Competitive positioning — locked findings (M-series, July 2026)

**Anonymity spectrum** (weakest→strongest, hosted services): WeTransfer/Smash/SwissTransfer → Tresorit/Proton Drive → Wormhole → **Refueler Share** → OnionShare.

**Key differentiator:** Cashu blind signatures decouple payment, credential, and usage — three events nobody can join, including the operator. Keypair auth (Nostr/Blossom) is pseudonymous; Cashu is unlinkable. "Pseudonymous is not unlinkable."

**Wedge statements:**
- vs WeTransfer: "A server that can read your files is a server whose terms about your files matter. Ours stores noise."
- vs SwissTransfer: "Jurisdiction is not architecture."
- vs Proton Drive: "No account to correlate. The payment itself is blinded."
- vs OnionShare: "Close your laptop. The transfer survives."

**B9 whitepaper framing (ours, not used by competitors):** "The server is blind and so is the till."

---

## Current build status

**`refueler-share`:** Block 6 (B6) in progress — S68 (k6 load tests) is next session.
207 tests passing across 8 suites. Integration harness complete against `wrangler dev --local`.
Lightning/Blink payment (B7) not yet built. Paid tier cards greyed out until B7 complete.

**`refueler-io`:** `/notes/` section being built now. Article 1 ready to publish.
Nav integration required (add `/notes/` entry to shared top nav).

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

---

*"Nothing stops this train."*
