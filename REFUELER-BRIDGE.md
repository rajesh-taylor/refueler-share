# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 6.1 | **Created:** 28 July 2026 | **Updated:** Opus-3b · 2026-08-31
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), `refueler-pass/` (root), and `numo-fork/` (root).
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant terminal (Fenchurch St line cafés and restaurants — tablet, counter/kitchen, landscape) · **Relay** (`io.refueler.merchant`, formerly NumoPay fork — in-venue order entry, Android phone, floor/waiter staff, portrait) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · **Refill** (consumer app, React Native, LNbits Lightning — commuter pre-orders + Legend + Pass)

**Product names locked CC-103:** Floor staff Android app = Relay ("Relay by Refueler"). Consumer app = Refill. Both names tie to the Refueler ecosystem without requiring explanation.

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
| NumoPay fork | `numo-fork` (cashubtc/Numo v1.8 base) | Waiter/floor staff | Android phone, portrait |
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

**Dual-repo asset sync (SYNC-1 · 31 Aug 2026):** `share.js`, `share.css`, `share-tokens.css`, `status.css`, `fflate.min.js`, `qr-creator.min.js`, `blake3/` exist in both repos. **`refueler-share/frontend/` is canonical.** `refueler.io/src/share/assets/` is the mirror. Mirror copies carry a `GENERATED FILE` header — never edit them directly. Sync tool: `bin/sync-share.sh` in `refueler-share`. Run after every edit to any shared asset. `plans.css` is io-only and excluded from sync.

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
- **Proxy pickup credential** (logged CC-96) — bearer or named authorisation for delegated order collection. 6-digit code or NFC tap. Pass primitive, not a stamp primitive.

### NumoPay fork boundary
| `refueler-io` | `numo-fork` |
|---|---|
| Merchant terminal receives pre-orders from consumer app via Supabase | In-venue order entry, floor staff payment processing |
| Supabase shared schema — `orders`, `merchant_orders`, `venue_partners` | Android app code, NumoPay-specific UI, item catalogue (local → Supabase in NumoPay-A) |

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

**Theme persistence:** `rs-theme` cookie (web, `.refueler.io`, 30-day rolling) · `rfTheme` localStorage (terminal only).
**Abolished:** `#F5820A` orange · `#F7F4EF` (stale Paper) · `#1E1F22` (stale Carbon) · `backdrop-filter` · `localStorage` for web theme · `rfTheme` on web · `--accent-action`

**NumoPay Android theming (NumoPay-A agenda):** Carbon token set maps to Android `res/values/themes.xml`, `colors.xml`, `dimens.xml`. `Theme.Numo` to be reskinned to Refueler Carbon. CSS does not apply — Android XML resources only.

---

## Terminal design philosophy — locked CC-96

**Keystone:** The terminal is an arrival instrument, not an order-management system. Its job is to tell a craftsperson when their customer is about to walk in. If a surface does not help the merchant know who is coming, serve them well, or run their own shop on their own terms, it does not belong on this terminal.

**Register test:** It should behave like a good maître d' — present when needed, invisible when not, never flustered, always a half-step ahead, working for the merchant rather than the other way round.

**The terminal gets quieter and clearer under load, not louder.**

**Sidebar:** Removed CC-97. Darwin promoted to horizon strip. 340px reclaimed for queue. Mapbox dependency removal deferred TDP-C.

**Horizon strip — slot-based arrival-intelligence primitive (locked CC-96, built CC-97):**
`HORIZON_TENANTS = ['rail']`. Dispatches to `renderRailTenant()`. Fixture tenant stub present. Pass tenant is a comment only. Strip mirrored to Owner tab via `_mirrorHorizonToOwner()` — no extra fetch. Darwin/fixtures UI toggle deferred to CC-98 / Events intelligence layer session.

**Payment architecture — locked CC-97:**
`create-order` v10 uses LNURL-pay. Invoices go to `venue_partners.lightning_address` directly. Refueler's Blink account is never in the consumer→merchant path. Blink float = Refueler operating sats only (reward payouts). Fiat commission → Stripe → bank account (Revolut Business recommended).

**Owner tab (behind Owner PIN gate):**
- Stats, horizon strip (mirrored), Lightning address (display + change flow via `update-lightning-address` EF v1), on-chain address (display + privacy nudge), sign out.
- On-chain address changes are `[R]` (dashboard-only) permanently for now.
- Legend Owner tab integration (embedded balance/tx panel) — dedicated session, post-B9 when Legend API is live.

**Lightning address change flow (live CC-98):**
- Owner PIN re-auth → overlay → save via `update-lightning-address` v1 Edge Function.
- Function verifies Owner PIN server-side (bcrypt), validates LNURL reachability (fail-closed, 5s timeout), writes via service_role, post-write verifies (rule 4j).
- After any address change: AM or Rajesh sends 21 sats from ops wallet to confirm receipt. Logged in crypto ops ledger.
- Rate limit: 5 attempts / 5 minutes per user (in-memory).

**Stamps:** Silent, passive issuance. Trigger: FULFILLED (READY status). `✦` glyph settles on tile. Plumbing-agnostic: same visual for LNURL-withdraw (v1) and Cashu NUT-00 (v2). Stamp metrics: reserved in Owner tab. Not built until Block 8 / post-mint.

---

## NumoPay fork — architecture decisions (NumoPay-A, CC-99)

**ADR:** `numo-fork/NUMO-PAY-A-ADR.md` and `refueler-io/docs/NUMO-PAY-A-ADR.md`

**Base:** cashubtc/Numo v1.8. **Package:** `io.refueler.merchant`. **Fork:** `rajesh-taylor/numo-fork`. Hardening phases 1–3: complete. Hard fork: permanent.

**Governing decision:** NumoPay is a Supabase-backed order-entry terminal. It holds no funds and processes no payments of its own. The entire Cashu wallet ceremony, `CashuWalletManager`, `AutoWithdrawManager`, NFC HCE, and CDK dependency are deleted.

**CDK return condition:** Block 8 / Pass floor-device redemption only. Must pin to stable `cdk-android:0.17.2` matching `refueler-mint` (lock 4s). `-rc.1` must never ship to a real merchant device.

**Auth:** Supabase magic link once → EncryptedSharedPreferences JWT → `verify-pin` v2 EF at shift-start → 30-min local grant. `FLAG_KEEP_SCREEN_ON`. No mid-shift re-auth. 12h JWT (43200s).

**Payment routing:** Lightning walk-in → `create-order` EF → LNURL-pay to `venue_partners.lightning_address` → QR on device → Realtime poll for confirmation. Cash/card walk-in → record-only insert, `status: 'confirmed'` immediately. No Cashu melt.

**Android theming:** `Theme.Refueler` replaces `Theme.Numo`. Carbon always-on. Status colours protected: Pending `#C8A96E` · In Prep `#7899D4` · Ready `#3DCA7A`.

---

## Lightning provider — RESOLVED (Opus-2 · 29 Aug 2026)

> **RESOLVED:** provider locked to **LNbits-on-Hetzner (phoenixd-backed)** for all Refueler projects. Node bootstrap = NB-series pre-B7. Blink dead (UK custodial discontinued Aug 31 2026). Boltz dead (suspended Aug 3 2026). Voltage eliminated. Strike eliminated.

---

## Ops wallet — RESOLVED (S73b / NB-1 · 29 Aug 2026)

LNbits Ops wallet on Hetzner Instance A. Replaces Blink ops wallet entirely. Created at NB-3. Admin key offline. Share wallet at B7-S74 (invoice/read key only). Pass wallet at Pass-A. Float ~£300 sats, 3-month review. Liquidation: phoenixd splice-out → Sparrow bech32.

---

## Incident response — locked Sim-Close

**Protocol:** `INCIDENT-PROTOCOL.md` in `refueler-io/docs/`. **Internal:** Signal. **External:** Tuta `hello@refueler.io`. **Public:** `refueler.io/status/` only. Core rule: Internal → contain → public.

---

## Merchant handover documents — locked Design-A

Files in `refueler-io/docs/`: `merchant-onboarding-v1.html`, `merchant-venue-keys-v1.html`, `merchant-onboarding-process-v1.html`, `INCIDENT-PROTOCOL.md`. **Docs ↔ UI sync rule (active):** confirm currency at every block close touching terminal UI.

---

## Sim-Close — DECLARED COMPLETE (2026-08-17)

Pre-merchant gate list: G-1 ✅ CLEARED CC-97 · G-2 (hard blocker): Menu Management v1, after TDP-C · G-3: iPad physical check, before first real merchant · G-4 ✅ Hardening-A · G-5 ✅ S-26 FK.

---

## Legend — post-B9 scope additions (locked CC-103 planning · 20 Aug 2026)

**Legend is a block explorer. Not a charting tool, not a news aggregator, not a price terminal.** Every feature tested against: does this help a user understand the chain privately, without logging, without a custodian?

**Verified estate report (v3):** Contextual metrics pages: supply position vs 21M cap, power law at generation time (Burger methodology), 4/8/12-year return windows vs gold/S&P/gilts, EO 6102 note.

**Haiku chain-state helper (paid tier, post-B9):** Plain English explanation of Legend findings — last movement, holding period, KYC exchange interaction history, power law context. No investment advice. Nothing persists.

**Sparrow Wallet (Phase 8):** Esplora-compatible endpoint → one URL paste. Distribution channel and trust signal.

**What Legend never becomes:** news section · live price terminal · portfolio tracker · social layer · comparison tool with third-party price feeds.

---

## Share — platform notes

**Safari upload ceiling:** ~1.5 GB real-world on current in-memory path. Do not headline large-file capability on Safari.

---

## Share — Silent Drop (locked AD-HOC · 27 Aug 2026, confirmed Opus-2)

**What it is:** A static, permanent inbox address that allows any sender to deliver encrypted files to the inbox holder without either party needing an account, and without Refueler being able to link senders to recipients or to each other.

**Tier:** Production Max only. Lightning-only by architectural necessity. No Creative Premium lite version. The boundary is qualitative: send-focused tier vs standing-receive tier. No Stripe object for this feature (would attach identity).

**Name:** "Silent Drop" is the candidate. Not locked until copy is live. No Stripe objects until name is final. Two tidy-up sessions precede SD-block: S89 (tier naming + name lock, no Stripe objects) → S90 (Stripe price objects for Stripe-rail tiers only).

**Mechanics:** Opaque KV inbox ID · byte counter cap · pause mode · address rotation (24h grace) · per-transfer TTL via R2 lifecycle rules · no sender names/IPs/file names stored.

**BOLT12-inspired Option A (locked):** Cloudflare Worker as blinded relay over HTTPS; secp256k1 blinded paths. Buildable on existing infrastructure. No Lightning node required for this feature.

**SD-block placement (locked Opus-2):** `NB → B7 → SYNC-1 → RU1/RU2 → HQ → SD-block → SW`. Journalist hero copy gated until B9 (blinded-relay review + VPN scoping). Incident-response tabletop must complete before SD-block launch.

**Competitive framing:** The correlation problem — can a recipient maintain a permanent public receive-point such that no two transfers (same or different senders) can be linked? Every existing mechanism fails a clause. Silent Drop does not.

---

## Share × Lightning — node infrastructure (locked Opus-2 · 29 Aug 2026; runbook locked S73b / NB-1)

**Hetzner CAX21 (€5.77/mo base).** Software: phoenixd + LNbits (Docker + PostgreSQL) + cloudflared + Tor (per-service .onions).

**NB-series runbook:** NB-1 (runbook locked, no server) · NB-2 (provision + OS hardening + phoenixd, STOP for seed write) · NB-3 (LNbits + Ops wallet + tunnel + invoice round-trip) · NB-4 (Tor .onions + hardening review) · NB-5 (refueler-io project — EF secrets, Blink scrub, Share wallet NOT here).

**Wallet structure:** Ops (NB-3, admin key) · Share (B7-S74, invoice/read key only) · Pass (Pass-A).

**Extension policy:** none at bootstrap. Earn each extension at the session that needs it. Never: Cashu extension, TPoS, Shop, SatsPay, Boltz, Nostr extensions.

**API layering:** All automation → LNbits REST only. phoenixd reached only by LNbits (funding source) + Rajesh (admin/liquidation). Never exposed on Cloudflare Tunnel.

**Phoenixd → LND trigger:** sustained ≥£10k/mo × 3 months + named operator committed to channel ops; OR ACINQ discontinues/changes terms. Not a current blocker.

**Instance topology:** Instance A = Share + Pass (NB-series) · Instance B = Legend (post-B9) · Instance C = SimpleX SMP (B9, own box). Each failure domain isolated.

---

## Cashu protocol — NUT-00 v3 and NUT-10 v3 Nutroot secrets (AD-HOC · 27 Aug 2026)

**NUT-00 v3 (BLS12-381):** B10+ consideration for Share. Not urgent through B9.

**NUT-10 v3 Nutroot secrets:** Taproot-style spending conditions. Leaf types: `threshold(k, [pubkeys])` · `after(timestamp)` · `hashlock(preimage_hash)`.

**Share priority:** HIGH. B12 FROST gets a proper interoperable Cashu foundation. B9 whitepaper §Future work must reference Nutroot secrets — supersedes NUT-29 framing.

**Pass priority:** VERY HIGH. Pass v2 should be built on this foundation. "The policy is the credential."

---

## Pass × Nutroot secrets — use case set (locked AD-HOC · 27 Aug 2026)

`threshold`: event entry with shared custody · corporate allocation · family passes · press accreditation.
`after`: early access windows · multi-day festival daily activation · refund window embargo · season ticket renewal.
`hashlock`: proxy pickup · conditional staff access · merchandise redemption · collaborative gifting.

**Most novel combinations:** FROST threshold + Nutroot threshold leaf (private members events, no list in any database) · timelock + hashlock (talk-slot access) · threshold + timelock (board meeting quorum gate).

---

## Share × Legend — distress integration (locked Multi-[n] · 22 Aug 2026)

Share is the correct transmission channel for Legend's Merkle-verified Chain Trace Report. "Send privately" button alongside "Download PDF." Unique encrypted link; decryption key never leaves user's device. Solicitor/GDPR angle: removes professional indemnity exposure without requiring technical knowledge from either party.

---

## Pass × Legend — address watch notification layer (locked Multi-[n] · 22 Aug 2026)

Legend issues a Cashu bearer watch credential when a user registers an address watch. Credential stored in Pass. When watched address moves, Legend marks credential as triggered. User sees quiet alert in Pass. No address/amount in notification body — signal only.

---

## Recovery Coordination Layer — v3 candidate (locked Multi-[n] · 22 Aug 2026)

FROST-based private coordination for mass-compromise events. Each victim's FROST key share generated independently on their own device. Threshold k-of-n co-sign a collective claim document. Individual Merkle proofs are sealed components — verifiable by trustee/court, not in the public filing. UC-9 Opus session required before any build planning.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| CC-84 through CC-103 | refueler-io, Supabase, numo-fork | See previous BRIDGE versions for detail. All complete. |
| Pass-0 / Pass-1 | refueler-pass | Founding scope. Two-credential-class model locked. |
| **Multi-[n]** | refueler-legend, refueler-share, refueler-pass, refueler-io | Share×Legend distress integration. Pass×Legend address watch. Recovery Coordination Layer v3. BRIDGE v5.0. |
| **AD-HOC · 27 Aug 2026** | refueler-share, refueler-pass | Silent Drop spec + Stripe vs Lightning tier split + BOLT12-inspired Option A + NUT-00 v3 + NUT-10 v3 Nutroot secrets + Pass×Nutroot use cases. BRIDGE v5.1. |
| **S73 · 28 Aug 2026** | refueler-share | Blink checklist. Blink discontinuing UK custodial Aug 31. BRIDGE v5.2. |
| **pre-Opus-2 · 28 Aug 2026** | all repos | Lightning provider locked: LNbits on Hetzner. Boltz dead. BRIDGE v5.3. |
| **Opus-2 · 29 Aug 2026** | refueler-share + all repos | B7 resequenced. NB-series. phoenixd confirmed. Instance topology. SD-block placement. SYNC-1 inserted. BRIDGE v5.4. |
| **S73b / NB-1 · 29 Aug 2026** | refueler-share | Node bootstrap runbook locked. 5-phase NB-series. Wallet structure. Extension policy. API layering. Backup strategy. BRIDGE v5.5. |
| **SYNC-1 · 31 Aug 2026** | refueler-share, refueler.io | Dual-repo asset sync resolved. Canonical: `refueler-share/frontend/`. Mirror: `refueler.io/src/share/assets/`. Sync tool: `bin/sync-share.sh`. GENERATED headers stamped in mirror. Zero dual-homing found in other repos. Embedded git repos (`refueler-app`, `terminals/numo-fork`) cleaned from `refueler.io`. BRIDGE v5.6. |
| **AP-BRAND · 31 Aug 2026** | all repos | Brand vocabulary locked. London Thames geography canonical. Silent Drop product decisions locked. Harbourmaster dashboard spec. Merchant-issues-Quays feature named. Notification architecture (no email, ever). Two authentication paths. Dr Chen→Dr Okafor case study locked. Raven replaces canary. Legend under Tower of London. Tower Bridge tier metaphor. Port Authority replaces "mint" in product contexts. Quay/Key and Locke/Lock double-meanings confirmed. Westminster geography reserved for future products. BRIDGE v5.7. |
| **AP-ARCH · 31 Aug 2026** | all repos | Three Liberties governance model locked. Three independent mints, seeds, Ravens. Port Authority (Share) · Guildhall (Pass) · Tower of London geography (Legend, mint name TBD Opus-3). Raven = warrant canaries only; mint health = status page plain language. Ceremony of the Keys = keyset rotation only. Locke = credential-as-object, P2PK bound, Deed recovery, passkey storage exception. Vocabulary matrix locked (four deployment contexts). Templar prior art argument locked for whitepaper. Reserved geography catalogued. Opus-3 scope defined. BRIDGE v5.8. |
| **Opus-3 · 31 Aug 2026** | all repos | **Geographic reshuffle — four Liberties made literal, west to east.** Share → Tower of London + **Royal Mint** (mint). Pass → Westminster + Black Rod. Legend → City of London / Temple (Guildhall + St Paul's). Merchant → Royal Exchange + the Exchange. Port Authority repurposed → admission-control layer (denylist + rate-limit gate). Rotation ceremonies split per-Liberty: Warder/Ceremony of the Keys (Share) · Black Rod (Pass) · Silent Ceremony (Legend, confirmed) · The Proclamation / Common Crier (Merchant). Legend St Paul's landmarks: Whispering Gallery (metadata leak, w/ Temple of Mithras) · Triforium (deep ledger) · floating staircase (Merkle, WP+presentation only). St Paul's dome metaphor retired. Bank of England → whitepaper foil (use with care). Royal Exchange → Merchant home (the Exchange mint). Temple → unowned (Cashu spiritual home / Templar headwater / Legend brand ground). Status page: "Royal Mint: operational" replaces "Port Authority". Constitutional line updated to four stations west-to-east. BRIDGE v5.9. |
| **Opus-3b · 31 Aug 2026** | all repos | Fourth rotation ceremony named: **The Proclamation** (Royal Exchange / Merchant), read by the Common Crier (optional colour). Platform whitepaper section outline locked — argument flow + geography placement, four Liberties, honest-claims boundary. Raven metaphor (canary→Raven etymology) locked for whitepaper §5. Raven governance extended to four Liberties. Rotation-ceremony admin changelog template + whitepaper §Key lifecycle language locked (four ceremonies). Constitutional line confirmed: Westminster → Temple → Royal Exchange → Tower. VPN recommendation locked (Mullvad named, multi-hop noted). "The pilgrim's society" held as future proper noun. Pass + Merchant vocabulary session flagged as a small Sonnet session (geographic terms for reward tokens / live melt path). BRIDGE v6.1. |

---

## Active action items (Rajesh)

- **[Lightning — ALL projects] LNbits on Hetzner CAX21 LOCKED.** Next: NB-2 (provision + phoenixd + Cloudflare Tunnel — refueler-share project).
- **[All products] Remove all Blink references** from merchant handover docs, Worker secrets, and config files. Replace `BLINK_API_KEY` / `BLINK_SHARE_API_KEY` with `LNBITS_URL` / `LNBITS_API_KEY`. Execute at NB-5 for refueler-io; at B7-S74 for Share Worker.
- **[Share] Push BRIDGE v6.1** to `numo-fork/` root, `refueler-legend/`, `refueler-pass/` root, `refueler-io/docs/` — after Opus-3b commit confirmed.
- **[Share] Run `bin/sync-share.sh`** after every edit to any shared frontend asset.
- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant).
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns (Ops wallet created at NB-3).
- Upgrade Supabase to Pro at first real merchant.
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume.
- Rotate Anthropic API key before csuite briefing reuse.
- Football-data.org API key held by Rajesh — ready for Events intelligence layer session.
- Commission rate planning conversation before first real merchant.
- **[All products] Opus-3a — Liberty mint reconciliation.** Pass mint/issuer name (Westminster / Jewel Tower — provisional). Legend mint/issuer name (Temple Treasury — provisional, Guildhall as geographic brand partner). Confirm before B9.
- **[Pass + Merchant] Geographic vocabulary session** — small Sonnet or Opus session to name geographic terms for reward tokens and live melt path in Pass (Westminster) and Merchant (Royal Exchange). No build dependency — but must complete before B9 whitepaper §§12/14 are drafted.
- **[Pass]** Solicitor briefing brief to draft before appointment.
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29 → Nutroot) before v2 build.
- **[All products]** Remove all Blink ops wallet references from merchant handover docs before first real merchant.
- **[Legend]** UC-9 Opus session — Recovery Coordination Layer. Load: CLAUDE.md · SESSIONS.md · MASTER.md · legend-use-cases.md.

---

## Relay (numo-fork) — context

**Name locked CC-103:** Relay ("Relay by Refueler"). Floor/waiter staff. Android phone, portrait.
**Base:** cashubtc/Numo v1.8. **Fork:** `rajesh-taylor/numo-fork`. Package: `io.refueler.merchant`. Hardening phases 1–3 complete.
**Build state (CC-103):** BUILD SUCCESSFUL. Commit `54b15de`. Installed on Pixel 9a.
**Next:** Web-Touch-1 → Icon-B (Relay app icon, Android only). S-numo-v31 (numo_navy refs) pending.

---

## Refueler brand vocabulary — London geography (locked AP-BRAND · 31 Aug 2026; extended Opus-3 + Opus-3b)

The Refueler product ecosystem is anchored in London geography — specifically the Thames corridor from Westminster eastward to the Pool of London. This is not decorative: it reflects where Refueler is built, by a Londoner, and the institutions drawn on performed real historical versions of what these products do. The vocabulary is coherent, earned, and novel in both senses of the word.

### Canonical term map

| Term | Technical reality | Audience |
|---|---|---|
| **Silent Drop** | The transfer mechanism — the act and the link. Untouchable. | Everyone |
| **Lighthouse** | The permanent Silent Drop intake URL — always on, guides senders in without revealing the recipient | Everyone |
| **Royal Mint** | Share's Cashu mint — issues credentials, governs movement, observes events, holds no cargo content. The Royal Mint operated inside the Tower walls for ~500 years; the pun lands at the technical level (a Cashu *mint*). Signal-only / no melt path stated separately in properties. | Product / whitepaper |
| **Port Authority** | The admission-control layer at the upload boundary — Content-Type denylist + rate-limiting gate. Every transfer passes it, as every vessel passed the Port of London Authority to enter the Pool. An authority that controls what enters, not an issuer. | Docs / internal |
| **Quay** | A named individual intake point issued to a specific client or sender. Quay/Key double-meaning: a bitcoiner reads one, a consultant reads the other. | Professional users |
| **Harbourmaster** | The admin dashboard — the account holder who controls their drops, views the receipt ledger, manages Quays | Everyone |
| **Cargo** | The encrypted file bundle in transit. Used in API event names (`cargo_received`), webhook payloads, and developer docs. Not used in patient-facing or professional UI copy — use "documents" there. | Docs / API / webhooks |
| **Locke** | The credential-as-key mechanism — presented to access Harbourmaster. Locke/Lock double-meaning. Named in whitepaper and docs; not necessarily surfaced to end users. | Whitepaper / docs |
| **Raven** | The warrant canary system — replaces "canary" across all products. Ravens signal safety by presence, not by dying. Absence = compromise signal. Architecturally more accurate than the canary metaphor. One Raven per Liberty — four total. | Whitepaper / docs / public |
| **Tower of London** | Brand geography home of **Share**. Every locked Share term has a real address here: Royal Mint (inside the walls 500 years), Port of London Authority (Tower Hill), the harbour lexicon (Pool of London), Tower Bridge, the Ravens, and the Warder's nightly Ceremony of the Keys. The tightest product-to-place fit of the four. | Share product |
| **Tower Bridge** | Tier differentiator visual metaphor — the bridge raises for large vessels (Production Max / Business). Free tier passes under. Creative Premium navigates the Thames with skill. Not a UI label; lives in design language and copy tone. | Design / copy |
| **Westminster** | Brand geography home of **Pass**. The Palace of Westminster *passes* laws — permits, who may do what and when. Rotation ceremony: Black Rod (State Opening). | Pass product |
| **Temple** | Brand geography home of **Legend** — and the unowned headwater of the Templar prior-art argument (Cashu spiritual home). Legend stands at the origin. The record-keeper on the origin ground. Rotation ceremony: Silent Ceremony. | Legend product / whitepaper |
| **Royal Exchange** | Brand geography home of **Merchant** — the first purpose-built commercial exchange in England. Where trade is settled, not where cargo moves or rules are made. Mint: the Exchange. Rotation ceremony: The Proclamation. | Merchant product |
| **Guildhall** | The City's record-house (Guildhall Library, London's civic archive) — paired with St Paul's as Legend's geographic brand context. "Consult the record." | Legend product / whitepaper |
| **Whispering Gallery** | Metadata-leak metaphor (Legend, St Paul's). A whisper you believe private travels the whole dome and is heard on the far side — exactly what querying a public block explorer does to a "private" lookup. Pairs with Temple of Mithras. Powers Legend Article 14. | Professional / whitepaper |
| **Triforium / Trinity Library** | The deep ledger / records archive (Legend, St Paul's) — the hidden 1709 library. The historical chain data you consult. | Whitepaper / docs |
| **Floating staircase** | Merkle tree / parent-hash structure (Legend, St Paul's geometric staircase) — each step self-supporting on the one below. **Whitepaper and closed-door presentation only — too technical for client copy.** | Whitepaper / presentation |

### Retired terms (do not use)
- **Drop Berth** — ward incident form. Retired.
- **Pontoon** — card game. Retired.
- **Port** — too much existing technical meaning (ports, port forwarding). Retired.
- **Pier** — functionally weaker than Quay. Reserved at most.
- **Marina** — too recreational for the professional register. Retired.

### Product vocabulary hierarchy

```
Refueler Share  ·  home: Tower of London
  └── Silent Drop (the mechanism)
        └── Lighthouse (the permanent intake link)
        └── Quay (named per-client intake point)
        └── Harbourmaster (admin dashboard + receipt ledger)
              └── Royal Mint (Share's Cashu mint — capability tokens, no melt path)
              └── Port Authority (admission-control layer — denylist + rate-limit gate)
              └── Locke (credential-as-key for Harbourmaster access)
              └── Warder · Ceremony of the Keys (keyset rotation)
              └── Raven (Share's warrant canary — 2–3 mirrors)

Refueler Pass  ·  home: Westminster
  └── [vocabulary session pending — geographic terms for reward tokens + live melt path]
        └── Black Rod (keyset rotation — State Opening)
        └── Raven (Pass's warrant canary — 2–3 mirrors)

Refueler Legend  ·  home: Temple (Guildhall + St Paul's as brand geography)
  └── Whispering Gallery (metadata-leak) · Triforium (deep ledger) · Floating staircase (Merkle)
        └── Silent Ceremony (keyset rotation)
        └── Raven (Legend's warrant canary — 5–6 mirrors)

Refueler Merchant  ·  home: Royal Exchange
  └── the Exchange (Merchant's Cashu mint — settlement + reward stamps, live melt path)
  └── [vocabulary session pending — geographic terms for settlement tokens + live melt path]
        └── The Proclamation (keyset rotation — read by the Common Crier)
        └── Raven (Merchant's warrant canary — 2–3 mirrors)
```

### Resolved — AP-ARCH · 31 Aug 2026; Opus-3 · 31 Aug 2026; Opus-3b · 31 Aug 2026
Four separate mints. Four independent seeds. No shared mint, no shared keyset across products. See §The four Liberties below.

---

## Silent Drop — product decisions (locked AP-BRAND · 31 Aug 2026)

### Notification architecture
**Email notifications: permanently out.** An email address linked to a Silent Drop intake is a list. No email notification tier exists at any plan level. This is a feature, not a limitation — state it plainly in copy.

**Notification methods by user type:**

| User type | Notification method |
|---|---|
| Bitcoin-native / high privacy | SimpleX message from self-hosted SMP relay (Instance C, B9) |
| Professional / Stripe user | Time-coordinated polling — scheduled check-in agreed with sender out of band |
| Developer / API (Business tier) | Webhook to their own endpoint — they handle notification |

**Notification triggers (two distinct events):**
- **Cargo arrived** — credential presented at upload completion. The Royal Mint observes this event. Fires immediately.
- **Cargo retrieved** — Harbourmaster has opened and downloaded the cargo. Fires on first retrieval.

### Harbourmaster authentication (two paths, matching payment rails)
- **Lightning subscriber** — Cashu credential *is* the login. Locke credential presented = Harbourmaster access granted. No email, no password, no TOTP.
- **Stripe subscriber** — email / password / TOTP. Conventional and appropriate; Stripe has already identified them.

### Landing page ownership
Refueler owns and controls all Silent Drop landing pages. No exceptions. Same model as Stripe hosted payment pages.

### Merchant-issues-Quays feature (named, not yet built)
**Tier placement:**
- **Production Max** — up to 10 named Quays. Harbourmaster dashboard. SimpleX or polling notification.
- **Business / API** — unlimited Quays, programmatic issuance, webhook on cargo events, custom hostname, audit log export.

### Harbourmaster receipt ledger
The dashboard is a receipt ledger first. Each row: Quay label (never sender identity) · cargo arrived · cargo retrieved · expiry · renew prompt.

---

## Silent Drop — vertical targeting and case studies (locked AP-BRAND · 31 Aug 2026)

### Primary vertical: healthcare private practice
Target profile: Private GPs, consultant psychiatrists, clinical psychologists, medical negligence expert witnesses, Harley Street consultants. Not NHS procurement. Not hospital IT departments.

### Secondary vertical: Bitcoin-native professional
Family offices, private wealth managers, OTC desk operators, multi-sig keyholders.

### Canonical case study
**Dr Sarah Chen → Dr James Okafor.** GP (Marylebone) refers patient to consultant psychiatrist (Harley Street). Full psychiatric history, medication records, safeguarding note. Dr Okafor's Lighthouse link in his referral instruction footer. Dr Chen uploads encrypted. ICO-defensible. GMC-appropriate.

---

## The four Liberties — mint governance model (locked AP-ARCH · 31 Aug 2026; extended Opus-3 · 31 Aug 2026)

A **Liberty** in London is a zone with its own jurisdiction where ordinary authority does not reach. Each Refueler Cashu mint is a Liberty: self-governing, separately seeded, separately operated, answerable to no shared authority above it.

**Constitutional principle:** four mints, four independent seeds, four Ravens (warrant canaries), four separate databases. No shared process, no shared seed material, no shared failure domain. Isolation goes all the way to the seed.

**The four Liberties — literal, not metaphorical.** Four real self-governing jurisdictions of London, west to east:

**Westminster makes the rules (Pass) → Temple keeps the record and the origin (Legend) → the Royal Exchange settles the trade (Merchant) → the Tower moves the cargo across the water (Share).**

| Liberty (home) | Product | Credential type | Monetary? | Mint / issuer |
|---|---|---|---|---|
| Tower of London | Share | Upload credentials, Harbourmaster Lockes | No — capability tokens only, no melt path | **Royal Mint** (locked Opus-3) |
| Westminster | Pass | Access credentials + reward tokens (spendable sats) | Mixed — reward tokens have live melt path | TBD — Opus-3a |
| Temple (Guildhall + St Paul's) | Legend | Address watch credentials | No — signal-only, no melt path | TBD — Opus-3a (Temple Treasury provisional) |
| Royal Exchange | Merchant | Settlement tokens + venue stamps | Yes — live melt path, venue settlement | **the Exchange** (provisional) |

**Why four, not one mint with four keysets:** a shared mint is a shared failure domain, a shared compulsion surface, and a shared database that *can* correlate events across products. Separate mints remove the ability, not merely the intention. Melt-hygiene axis: Pass and Merchant carry live melt paths; Share and Legend must never melt; the same process must not hold both properties.

**Server topology:** Instance A (Share + Pass) · Instance B (Legend, post-B9) · Instance C (SimpleX SMP, B9). Four mint processes across three instances as builds arrive. Each instance: separate processes, separate databases, separate ports.

---

## Raven governance (locked AP-ARCH · 31 Aug 2026; extended Opus-3b · 31 Aug 2026)

**Ravens are warrant canaries only.** One Raven per Liberty — four Ravens total. Separate legal statements, separately signed, separately dated, on their respective product pages.

**The metaphor:** the traditional warrant canary dies to signal danger — a one-time, unrepeatable signal. Refueler uses Ravens instead: by statute, there must be at least six Ravens at the Tower of London, or the Tower — and with it, the kingdom — falls. The Raven does not die. It is simply absent. And its absence is continuous, compounding, and impossible to hide. A Refueler Raven must be renewed on a fixed schedule; failure to renew is the signal. For the whitepaper, this etymology is stated once, briefly, in §5.

| Product | Raven statement | Mirrors |
|---|---|---|
| Share (Tower / Royal Mint) | No compulsion, no logging beyond stated, no backdoor | 2–3 |
| Pass (Westminster) | As above, Pass-scoped | 2–3 |
| Legend (Temple) | As above, Legend-scoped | 5–6 (distributed explorer architecture) |
| Merchant (Royal Exchange) | As above; scoped to merchant settlement + venue data — no order content logged beyond stated, no compelled backdoor into the Exchange mint | 2–3 |

**What Ravens are not:** service health indicators. Mint availability and infrastructure status live on `refueler.io/status/` as plain language — "Royal Mint: operational." No Raven metaphor. No shared vocabulary with the warrant canary system.

**Raven governance rule:** absence of a Raven signals legal compulsion. Absence of a status indicator signals infrastructure. These two signals must never share vocabulary, display surface, or ambiguity.

---

## Keyset rotation ceremonies (locked AP-ARCH · 31 Aug 2026; per-Liberty extended Opus-3 + Opus-3b · 31 Aug 2026)

**Meaning: keyset rotation only.** When a Liberty rotates its active keyset — generating new keypairs, publishing the new keyset, retiring the old — it performs its rotation ceremony. Announced in advance. Consequential for outstanding credentials (grace period). Periodic and predictable. **Never a login flow.**

| Liberty | Rotation ceremony | Actor | Historical basis |
|---|---|---|---|
| Share (Tower) | **Ceremony of the Keys** | the **Warder** | Nightly at the Tower for 700+ years, interrupted twice. |
| Pass (Westminster) | **Black Rod** | Black Rod | The State Opening — door is slammed and reopened; the rotation is the rite itself. |
| Legend (Temple) | **Silent Ceremony** | — | The near-wordless annual handover of the office of Lord Mayor. Keyset changes hands in near silence, announced but not explained. |
| Merchant (Royal Exchange) | **The Proclamation** | the **Common Crier** *(optional colour)* | Accession proclamation read from the steps of the Exchange. Old authority retired, new declared, continuity preserved. Public, formal, non-negotiable once read. |

**Usage by context (all four):**

| Context | Usage |
|---|---|
| Whitepaper / developer docs | "[Ceremony] — keyset rotation event, announced N days in advance, outstanding credentials remain valid for grace period" |
| Admin changelog | "[Ceremony] performed — new keyset active, previous keyset retired" |
| Product UI | Plain language only — "Active keyset updated" |
| Login | Never referenced. Authentication is plain-language challenge-response. |

---

## Locke — credential object (locked AP-ARCH · 31 Aug 2026)

**Locke is an object (and a person), not a process.** A Locke is the credential-as-object held by the Harbourmaster — it requires unlocking with a key. NUT-11 Mode 2 (P2PK bound credential). Private key never leaves the device. Authentication = nonce issued by dashboard, signed by device, pubkey verified against authorised set.

**Temple Bar** = the gate where the Locke is presented. *"At Temple Bar, the Harbourmaster presents their Locke. The dashboard issues a nonce. The device signs. The gate opens."*

**Multi-device:** account holds a set of authorised pubkeys. Each device holds its own Locke. Add a device: present valid existing Locke, authorise new pubkey, mint new Locke. Remove: drop pubkey from set.

**Recovery:** Primary — the Deed (recovery Locke, offline keypair, generated at onboarding). Firm path — FROST social recovery (B12). Informed cliff: loss of all devices without the Deed = loss of access. Stated plainly at onboarding.

**Key storage exception:** Locke private keys stored in platform passkey / secure enclave. Documented exception to credentials-in-browser-memory-only rule. Applies to Locke only.

**Locke is separate from the subscription credential.** Subscription = entitlement. Locke = access. Two separate objects from one payment event.

---

## Vocabulary matrix (locked AP-ARCH · 31 Aug 2026)

| Term | Website / UI | Professional copy | Whitepaper / docs | Closed door / internal |
|---|---|---|---|---|
| Silent Drop | ✓ | ✓ | ✓ | ✓ |
| Lighthouse | ✓ | ✓ | ✓ | ✓ |
| Harbourmaster | ✓ | ✓ | ✓ | ✓ |
| Quay | ✓ | ✓ | ✓ | ✓ |
| Cargo | — | — | ✓ (API/webhooks) | ✓ |
| Royal Mint | — | ✓ (Share mint) | ✓ | ✓ |
| Port Authority | — | — | ✓ (admission-control layer) | ✓ |
| Tower of London | — | ✓ (Share brand) | ✓ | ✓ |
| Westminster | — | ✓ (Pass brand) | ✓ | ✓ |
| Temple | — | ✓ (Legend brand) | ✓ | ✓ |
| Guildhall | — | ✓ (Legend geographic context) | ✓ | ✓ |
| Royal Exchange | — | ✓ (Merchant brand) | ✓ | ✓ |
| Whispering Gallery | — | ✓ (metadata leak) | ✓ | ✓ |
| Triforium / Trinity Library | — | — | ✓ (deep ledger) | ✓ |
| Floating staircase | — | — | ✓ (Merkle — WP + presentation only) | ✓ |
| Locke | — | — | ✓ | ✓ |
| Ceremony of the Keys | — | — | ✓ (Share rotation) | ✓ |
| Black Rod | — | — | ✓ (Pass rotation) | ✓ |
| Silent Ceremony | — | — | ✓ (Legend rotation) | ✓ |
| The Proclamation | — | — | ✓ (Merchant rotation) | ✓ |
| Warder | — | — | ✓ | ✓ |
| Common Crier | — | — | — | ✓ (colour only) |
| Raven | — | ✓ (warrant canary ref) | ✓ | ✓ |
| The four Liberties | — | — | ✓ | ✓ |
| Temple Bar | — | — | ✓ | ✓ |
| Tower Bridge | — | ✓ (tier metaphor) | — | ✓ |
| Traitors Gate | — | — | — | ✓ (pitch only) |
| White Tower | — | — | — | ✓ (held) |
| Shakespeare's Globe | — | — | — | ✓ (re-credential metaphor, pitch) |
| Temple of Mithras | — | — | ✓ (metadata argument) | ✓ |
| Fleet Street | — | ✓ (editorial voice) | ✓ | ✓ |
| Bank of England | — | — | ✓ (the foil — use with care) | ✓ |
| Cleopatra's Needle | — | — | — | ✓ (held — attestation monument) |
| Pall Mall | — | — | — | ✓ (held — Enterprise register) |

**Rule:** if a term is not in the Website/UI column, it does not appear on `refueler.io` outside of the whitepaper and notes articles. Harbourmaster and Quay are the only geography terms that have passed the website test.

---

## The Templar prior art argument (locked AP-ARCH · 31 Aug 2026)

For use in whitepaper §Historical prior art and closed-door pitches. Not for website copy.

The Knights Templar invented the letter of credit at Temple Church, London, circa 1150. A pilgrim deposited gold at the London preceptory, received a credential (a document, a bearer instrument, encrypted and verifiable), travelled to Jerusalem, presented the credential, received equivalent value. The gold never moved. The *information about the gold* moved — in verifiable form, across jurisdictions with no common sovereign, designed for adversarial interception conditions.

**This is Cashu. Not a metaphor for Cashu. Cashu, described in 1150.**

The blind signature is the letter. The mint is the Temple treasury. The bearer is the pilgrim. The receiving preceptory is the download endpoint.

The lineage: Templar letter of credit (c.1150) → Venetian bill of exchange → Chaumian blind signature (1982) → Cashu (2022) → Refueler (2026).

**Legend's home is Temple.** The record-keeper stands on the origin ground. The Templar argument and the product that keeps the record share the same geography — this is not a coincidence and should be noted in the whitepaper without over-explaining it.

**"The pilgrim's society"** — held as a future proper noun for the constituency of Refueler users. Heavy Anglo-American connotations, silent power. Do not use until the naming is ready.

**Use in whitepaper:** §Historical prior art (Templar lineage), §Privacy model (Temple of Mithras + Whispering Gallery), §Permission model (City sovereignty — each Harbourmaster holds equivalent sovereignty over their own Liberty; Temple Bar as the gate).

---

## Reserved geography — held for future use

| Location | Properties | Candidate use |
|---|---|---|
| Cleopatra's Needle | Permanent, monumental, predates London, arrived by sea, points at nothing | Public attestation monument — B9 whitepaper anchor, or permanent hash reference. Not the Lighthouse. |
| White Tower | Oldest structure, everything built around it, foundational | Foundational primitive — BLAKE3, or R2 storage layer. Held. |
| Shakespeare's Globe | Burned, faithfully rebuilt, same play same stage | Re-credentialed Pass token — internal mental model, closed-door pitch for credential renewal |
| Pall Mall | Private members clubs, no sign, introduced by a member, no advertising | Enterprise tier register. Hold until Enterprise naming session. |
| Temple | Real London liberty, letter-of-credit origin (Templar, c.1150), Temple Bar boundary | **Legend's home and the unowned Cashu headwater.** The spiritual home of Cashu and the neutral Templar prior-art origin — kept ownerless as a brand anchor so the origin story belongs to all four products, not one. Legend's mint takes a name from within this geography (Temple Treasury — provisional). |
| Bank of England | Independent within the system, cannot be audited by Treasury, *the* central monetary authority | **The foil / antithesis** — the establishment monetary institution Refueler defines itself against. Whitepaper §monetary distinction only, handled with care. Never a mint. |
| Somerset House | National records, Revenue, cultural space | Held lightly — revenue association undermines privacy message |
| Fleet Street | Information channel, Temple Bar to Ludgate Hill, editors decided what ran | Editorial voice — notes articles, the /notes/ pipeline |
| Traitors Gate | Watergate entrance, prisoners taken silently by river, public excluded | Closed-door only — "the email inbox was always a Traitors Gate." Never product copy. |
| Three city-states | London (finance), Washington (military), Vatican (religion) | International scale — available when Refueler operates across jurisdictions. Whitepaper future work gesture only. |

---

*"Nothing stops this train."*
