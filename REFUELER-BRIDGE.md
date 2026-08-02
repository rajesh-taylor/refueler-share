# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 1.1 | **Created:** 28 July 2026 | **Updated:** AP-7 ad-hoc · 2 Aug 2026
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

**`/notes/`** — SEO-targeted technical content for professional buyers. Higher cadence.
Audiences: lawyers, journalists, accountants, Bitcoin-adjacent professionals, legal/human rights workers.
Register: authoritative, precise, dry wit permitted. Shorter sentences than editorial.
Index: card grid (title, one-sentence description, date, read time). Each article its own URL.
Articles live on `refueler.io/notes/[slug]/` — domain authority consolidates on main domain.

**Do not publish Share-specific articles on `share.refueler.io`** — all content on `refueler.io`.

**`/notes/` articles — current pipeline (full detail in `notes-articles-list.md`):**

| # | Title (short) | Status |
|---|--------------|--------|
| 1 | Subpoena table | Live — iteration open from 5 Aug |
| 2 | Client files / inbox | Planned |
| 3 | Metadata value | Planned |
| 4 | Blind vs secure server | Planned — btc++ Berlin warm-up |
| 5 | Jurisdiction vs architecture | Planned |
| 6 | Anonymous payment option | Unlocks after B7 |
| 7 | Journalists and file transfer | Planned — Susie intro first |
| 8 | PI insurer risk | After SW block |
| 9 | After the link expires | Anytime |
| 10 | Case study (video editor) | Last — needs real user |
| 11 | API / white-label notes | After SW block |
| 12 | API technical integration / Nostr auth | After SW block |
| 13 | Transmitting evidence when your witness cannot travel | Planned — legal/human rights audience |

**Article 13 note:** Covers confined witnesses, endangered sources, asylum cases, ICC evidence, human rights documentation. Recorded video works today on Share — encrypted chunks, fragment URL as key, server blind. Range request support (post-B9) enables streaming without full download first. This article may embed a video player demonstrating the use case (see §Video player in /notes/).

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

## Video player in /notes/ and founder S1 modal

### /notes/ article video player

Articles (particularly article 13) may embed a video player in a modal or inline section.
Architecture:

- Video file stored in a dedicated R2 bucket on the `refueler.io` side (separate from Share's transfer R2).
- Worker generates a signed, time-limited R2 URL per request — prevents hotlinking and direct download via URL.
- HTML5 `<video>` tag renders the stream. Cloudflare edge delivers at full line speed — R2 + CF edge is effectively a CDN with zero egress fees. 1080p plays cleanly.
- Download blocker: CSS `pointer-events` on the video element + JS `contextmenu` and `dragstart` intercepts. Prevents casual download-and-reshare. Does not stop screen recording — intent, not technical certainty.
- Paper/Carbon tokens throughout the modal. `modal radius: 12px`. No external video platform dependencies (no YouTube, no Vimeo — own infrastructure only, consistent with Share's values).

**Use case for article 13:** a short produced demonstration of the witness/confined-testimony scenario. "Here is what it looks like when a barrister receives a recorded statement from a client who cannot travel." 90 seconds. More persuasive than prose for a legal audience.

**Build scope:** B9 or B13 depending on priority. Does not block any article from publishing — the article works without the video. Video is enhancement, not dependency.

### Founder S1 incident video modal

During an S1 incident, the status page (`/status`) displays a pre-recorded video statement from Rajesh alongside the KV-backed incident panel. Architecture is identical to the article video player above.

**Purpose:** removes the "who speaks for the company" ambiguity under pressure. A named founder on camera, factual and calm, stating what is known and what is being done, is the response Coldcard did not give. It is also faster to consume than a text statement for users checking the status page in distress.

**Pre-record template:** filmed at B9 alongside the tabletop simulation. Low production value is fine — honest and fast is the requirement. Broad template:

> "I'm Rajesh Taylor, the founder of Refueler Share. At [time] today we identified [one sentence]. Here is what we know. Here is what we don't know yet. Here is what we're doing in the next two hours. I'll update this page at [specific time]."

**Key properties:**
- Stored in R2, served via signed URL from the Worker. Not uploaded to any third-party platform.
- Displayed only when `incident_active` KV key is set to S1 severity. Hidden otherwise.
- Sits alongside the text incident panel, not instead of it. Text remains for screen readers and low-bandwidth connections.
- sessionStorage does not dismiss it during an S1 — the video and panel are persistent until the incident is resolved.

**Build scope:** B9, same session as the status page incident dashboard panel.

---

## Competitive positioning — locked findings (M-series, July 2026)

**Anonymity spectrum** (weakest→strongest, hosted services): WeTransfer/Smash/SwissTransfer → Tresorit/Proton Drive → Wormhole → **Refueler Share** → OnionShare.

**Key differentiator:** Cashu blind signatures decouple payment, credential, and usage — three events nobody can join, including the operator. Keypair auth (Nostr/Blossom) is pseudonymous; Cashu is unlinkable. "Pseudonymous is not unlinkable."

**Wedge statements:**
- vs WeTransfer: "A server that can read your files is a server whose terms about your files matter. Ours stores noise."
- vs SwissTransfer: "Jurisdiction is not architecture."
- vs Proton Drive: "No account to correlate. The payment itself is blinded."
- vs OnionShare: "Close your laptop. The transfer survives."
- vs DashBeam / synchronous P2P: "The transfer survives your client being on a plane." (Do not name DashBeam publicly.)

**B9 whitepaper framing (ours, not used by competitors):** "The server is blind and so is the till."

---

## Current build status

**`refueler-share`:** B6 complete (S72a). B7 next — S73 opens after pre-B7 checklist complete.
212 tests passing across 8 suites. Lightning/Blink payment (B7) not yet built. Paid tier cards greyed out until B7 complete.

**`refueler-io`:** `/notes/` section live. Article 1 published, iteration open from 5 Aug. Articles 2–13 planned — see `notes-articles-list.md` in `refueler-share/` for full detail.

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

---

*"Nothing stops this train."*
