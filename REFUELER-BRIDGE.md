# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 5.7 | **Created:** 28 July 2026 | **Updated:** AP-BRAND · 2026-08-31
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

---

## Active action items (Rajesh)

- **[Lightning — ALL projects] LNbits on Hetzner CAX21 LOCKED.** Next: NB-2 (provision + phoenixd + Cloudflare Tunnel — refueler-share project).
- **[All products] Remove all Blink references** from merchant handover docs, Worker secrets, and config files. Replace `BLINK_API_KEY` / `BLINK_SHARE_API_KEY` with `LNBITS_URL` / `LNBITS_API_KEY`. Execute at NB-5 for refueler-io; at B7-S74 for Share Worker.
- **[Share] Push BRIDGE v5.6** to `numo-fork/` root, `refueler-legend/`, `refueler-pass/` root, `refueler-io/docs/` — after SYNC-1 commit confirmed.
- **[Share] Run `bin/sync-share.sh`** after every edit to any shared frontend asset.
- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant).
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns (Ops wallet created at NB-3).
- Upgrade Supabase to Pro at first real merchant.
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume.
- Rotate Anthropic API key before csuite briefing reuse.
- Football-data.org API key held by Rajesh — ready for Events intelligence layer session.
- Commission rate planning conversation before first real merchant.
- **[Legend]** UC-9 Opus session — Recovery Coordination Layer. Load: CLAUDE.md · SESSIONS.md · MASTER.md · legend-use-cases.md.
- **[All products]** Opus session — multiple Cashu mint naming convention. If Share (Port Authority), Pass credential mint, and Legend watch credential mint are all separate issuers, resolve governance/naming before B9. Westminster geography reserved for this conversation.
- **[Pass]** Solicitor briefing brief to draft before appointment.
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29 → Nutroot) before v2 build.
- **[All products]** Remove all Blink ops wallet references from merchant handover docs before first real merchant.

---

## Relay (numo-fork) — context

**Name locked CC-103:** Relay ("Relay by Refueler"). Floor/waiter staff. Android phone, portrait.
**Base:** cashubtc/Numo v1.8. **Fork:** `rajesh-taylor/numo-fork`. Package: `io.refueler.merchant`. Hardening phases 1–3 complete.
**Build state (CC-103):** BUILD SUCCESSFUL. Commit `54b15de`. Installed on Pixel 9a.
**Next:** Web-Touch-1 → Icon-B (Relay app icon, Android only). S-numo-v31 (numo_navy refs) pending.

---

## Refueler brand vocabulary — London geography (locked AP-BRAND · 31 Aug 2026)

The Refueler product ecosystem is anchored in London geography — specifically the Thames corridor from the Pool of London eastward. This is not decorative: it reflects where Refueler is built, by a Londoner, and the institutions drawn on (Port of London Authority, Royal Mint, Tower of London, Tower Bridge) performed real historical versions of what these products do. The vocabulary is coherent, earned, and novel in both senses of the word.

### Canonical term map

| Term | Technical reality | Audience |
|---|---|---|
| **Silent Drop** | The transfer mechanism — the act and the link. Untouchable. | Everyone |
| **Lighthouse** | The permanent Silent Drop intake URL — always on, guides senders in without revealing the recipient | Everyone |
| **Port Authority** | The Cashu mint — issues credentials, governs movement, observes events, holds no cargo content. Renamed from "mint" in product-facing contexts. | Product / whitepaper |
| **Royal Mint** | The Cashu blind-signature issuance layer specifically | Whitepaper / docs only |
| **Quay** | A named individual intake point issued to a specific client or sender. Quay/Key double-meaning: a bitcoiner reads one, a consultant reads the other. | Professional users |
| **Harbourmaster** | The admin dashboard — the account holder who controls their drops, views the receipt ledger, manages Quays | Everyone |
| **Cargo** | The encrypted file bundle in transit. Used in API event names (`cargo_received`), webhook payloads, and developer docs. Not used in patient-facing or professional UI copy — use "documents" there. | Docs / API / webhooks |
| **Locke** | The credential-as-key mechanism — presented to access Harbourmaster. Locke/Lock double-meaning. Named in whitepaper and docs; not necessarily surfaced to end users. | Whitepaper / docs |
| **Raven** | The warrant canary system — replaces "canary" across all products. Ravens signal safety by presence, not by dying. Absence = compromise signal. Architecturally more accurate than the canary metaphor. | Whitepaper / docs / public |
| **Tower of London** | Brand geography home of Legend — the block explorer as ledger, the Tower as the place where the kingdom's records were kept. Ravens live at the Tower. | Legend product |
| **Tower Bridge** | Tier differentiator visual metaphor — the bridge raises for large vessels (Production Max / Business). Free tier passes under. Creative Premium navigates the Thames with skill. Not a UI label; lives in design language and copy tone. | Design / copy |

### Retired terms (do not use)
- **Drop Berth** — ward incident form. Retired.
- **Pontoon** — card game. Retired.
- **Port** — too much existing technical meaning (ports, port forwarding). Retired.
- **Pier** — functionally weaker than Quay. Reserved at most.
- **Marina** — too recreational for the professional register. Retired.

### Product vocabulary hierarchy

```
Refueler Share
  └── Silent Drop (the mechanism)
        └── Lighthouse (the permanent intake link)
        └── Quay (named per-client intake point)
        └── Harbourmaster (admin dashboard + receipt ledger)
              └── Port Authority (Cashu mint — governs movement)
              └── Royal Mint (blind signature layer)
              └── Locke (credential-as-key for Harbourmaster access)

Refueler Legend
  └── Tower of London (brand geography)
        └── Raven (warrant canary system)
```

### Open question for Opus session
If Refueler has more than one non-monetary Cashu mint (e.g. Pass credential mint, Legend watch credential mint, Silent Drop Port Authority mint), does each mint get its own Port Authority identity or do they share one? The naming convention and governance model need resolving before B9 builds multiple credential issuers. Westminster geography (City of Westminster, Whitehall, Parliament) may provide vocabulary for future products beyond the Thames corridor.

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
- **Cargo arrived** — credential presented at upload completion. Port Authority observes this event. Fires immediately. Relevant for single-drop users expecting one important delivery.
- **Cargo retrieved** — Harbourmaster has opened and downloaded the cargo. Fires on first retrieval. Relevant for multi-Quay Harbourmasters who need to know a specific client has delivered, or confirm a recipient has collected.

### Harbourmaster authentication (two paths, matching payment rails)
- **Lightning subscriber** — Cashu credential *is* the login. Locke credential presented = Harbourmaster access granted. No email, no password, no TOTP. Credential expires and renews with subscription.
- **Stripe subscriber** — email / password / TOTP. Conventional and appropriate; Stripe has already identified them. TOTP is good practice at this level.

### Landing page ownership
Refueler owns and controls all Silent Drop landing pages. No exceptions. The Harbourmaster provides: name, practice/organisation name, optional logo or headshot, optional one-line instruction. Refueler controls: layout, typography, design tokens, trust signals, Refueler attribution, "Powered by Refueler Share" link. Same model as Stripe hosted payment pages. Doctors do not get to add award banners.

### Merchant-issues-Quays feature (named, not yet built)
A Harbourmaster issues named Quays to individual clients — each client gets a dedicated intake point, the Harbourmaster sees which Quay has received cargo without seeing the cargo content. Receipt ledger shows: Quay label, issued date, cargo arrived timestamp, retrieved timestamp, expiry. No sender identity at any row.

**Tier placement:**
- **Production Max** — up to 10 named Quays. Harbourmaster dashboard. SimpleX or polling notification.
- **Business / API** — unlimited Quays, programmatic issuance, webhook on cargo events, custom hostname, audit log export.

API differentiators are: programmatic issuance at volume, webhook callbacks, custom hostname (appears on firm's own domain), audit log export. Storage capacity is not the differentiator.

### Harbourmaster receipt ledger
The dashboard is a receipt ledger first. Each row: Quay label (never sender identity) · cargo arrived · cargo retrieved · expiry · renew prompt. A GP can show this log to the ICO as evidence of a documented, controlled referral intake process. Retention as a product loop: expiring Quays prompt renewal from within the dashboard.

---

## Silent Drop — vertical targeting and case studies (locked AP-BRAND · 31 Aug 2026)

### Primary vertical: healthcare private practice
**Rationale:** Legal is crowded with well-funded incumbents (Egress, Mimecast, Tresorit enterprise). Healthcare has the same acute pain, worse data hygiene track record, more chaotic procurement, and ISO 27001 is not required for private practice — only for NHS contracts and enterprise procurement. A solo GP or Harley Street consultant makes their own tooling decisions. Every NHS data breach is a free news cycle.

**Target profile:** Private GPs, consultant psychiatrists, clinical psychologists, medical negligence expert witnesses, Harley Street consultants running their own books. Not NHS procurement. Not hospital IT departments.

### Secondary vertical: Bitcoin-native professional
Family offices, private wealth managers, OTC desk operators, multi-sig keyholders. Warmest immediate audience — already privacy-conscious, technically literate, no procurement committee, will try a £24/month tool on their own card.

**Specific use case — multi-sig key compromise:** A keyholder suspects one of their keys is compromised. During the window between suspicion and rotation, they need to communicate with other keyholders without using any channel that may also be compromised. Email is out. Signal leaves metadata. Silent Drop leaves nothing. Partnership angle: Casa (customer success, not CTO — Lopp would build his own).

**Specific use case — post-cold-wallet attack:** Victim needs to communicate new wallet addresses to family office, accountant, estate solicitor without broadcasting across potentially compromised infrastructure. Silent Drop link held by the family office. Client uses it once. No interception surface.

### Canonical case study (locked AP-BRAND · 31 Aug 2026)
**Dr Sarah Chen → Dr James Okafor.** GP (Marylebone private practice) refers a patient with complex psychiatric presentation to a consultant psychiatrist (Harley Street). Referral bundle: full psychiatric history, medication records, safeguarding note, clinical observations. Currently transits email. Should not. Dr Okafor's Lighthouse link sits in his standard referral instruction email footer. Dr Chen clicks, sees a clean Refueler-controlled landing page (Dr Okafor's name, GMC number, one-line instruction), uploads encrypted. Dr Okafor retrieves from Harbourmaster. Transfer expires after 30 days. No patient consent to third-party tech required (clinician-to-clinician). ICO-defensible. GMC-appropriate. Both parties have audit trail.

**Why this case study:** Two regulated professionals. Genuine legal consequence of breach. Workflow that currently happens badly every day. Maps to every professional-to-professional referral context across healthcare.

---

## Session log addition

| Session | Repos touched | Notes |
|---|---|---|
| **AP-BRAND · 31 Aug 2026** | all repos | Brand vocabulary locked. London Thames geography canonical. Silent Drop product decisions locked. Harbourmaster dashboard spec. Merchant-issues-Quays feature named. Notification architecture (no email, ever). Two authentication paths. Dr Chen→Dr Okafor case study locked. Raven replaces canary. Legend under Tower of London. Tower Bridge tier metaphor. Port Authority replaces "mint" in product contexts. Quay/Key and Locke/Lock double-meanings confirmed. Westminster geography reserved for future products. BRIDGE v5.7. |


---

*"Nothing stops this train."*
