# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 6.9 | **Created:** 28 July 2026 | **Updated:** AD-HOC · 2026-09-04
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

**Dual-repo asset sync (SYNC-1 · 31 Aug 2026):** `share.js`, `share.css`, `share-tokens.css`, `status.css`, `fflate.min.js`, `qr-creator.min.js`, `blake3/` exist in both repos. **`refueler-share/frontend/` is canonical.** `refueler.io/src/share/assets/` is the mirror. Mirror copies carry a `GENERATED FILE` header — never edit them directly. Sync tool: `bin/sync-share.sh` in `refueler-share` (**path: `bin/sync-share.sh`**, not repo root). Run after every edit to any shared asset. `plans.css` is io-only and excluded from sync.

**Share index.njk locked rules (HQ2 · 2 Sep 2026) — three values that must never revert:**
- `permalink: /share/index.html` — never `/index.html` (conflicts with site root `src/index.njk`)
- CSS href: `/share/assets/share.css` — never `/share.css` (CSS lives at `/share/assets/`, not root)
- `activePage: "share"` — never `""` (nav conditionals for PLANS/STATUS depend on this)

**After placing any version of `refueler-io/src/share/index.njk`, always run this sed pass:**
```bash
sed -i '' 's/activePage: ""/activePage: "share"/' /Users/rajeshtaylor/Documents/refueler.io/src/share/index.njk && sed -i '' 's|href="/share.css"|href="/share/assets/share.css"|' /Users/rajeshtaylor/Documents/refueler.io/src/share/index.njk && sed -i '' 's|permalink: /index.html|permalink: /share/index.html|' /Users/rajeshtaylor/Documents/refueler.io/src/share/index.njk
```
Never place a Claude-generated `index.njk` without running this pass. Template changes (*.njk) go to `refueler-io/src/share/` only — never `refueler-share/src/`.

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
- **Access credential** — non-monetary, closed-loop, no melt path. Bearer (NUT-00) or bound (NUT-11 P2PK). UI: "your Pass".
- **Reward token** — monetary, spendable sats. LNURL-withdraw (v1) → Cashu NUT-00 (v2, post-mint). UI: "a Pass" (same surface name; the architecture distinguishes, the user does not need to). Whitepaper: "reward token" as plain technical noun.
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

**Stamps:** Silent, passive issuance. Trigger: FULFILLED (READY status). `✦` glyph settles on tile. Plumbing-agnostic: same visual for LNURL-withdraw (v1) and Cashu NUT-00 (v2). Stamp metrics: reserved in Owner tab. Not built until Block 8 / post-mint. The issued instrument is **a Note** (locked Merchant-Vocab-1).

---

## NumoPay fork — architecture decisions (NumoPay-A, CC-99)

**ADR:** `numo-fork/NUMO-PAY-A-ADR.md` and `refueler-io/docs/NUMO-PAY-A-ADR.md`

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
| **Opus-3a · 1 Sep 2026** | all repos | **Liberty mint reconciliation — both provisional names resolved.** Pass mint: **Jewel Tower** (locked). Jewel Tower held Edward III's Privy Wardrobe (treasure → reward tokens, live melt path) and later housed Weights & Measures standards (standardisation → access credentials). Mixed-melt mint; name holds both functions. Black Rod rotation co-locates at Westminster. Legend mint: **Guildhall** (locked). Chamberlain's Court at Guildhall admits individuals to the Freedom of the City (c.1237, living tradition) — access-grant semantics, no value held, correct for a no-melt mint. Deep ledger / record-keeping function moves explicitly to St Paul's / Triforium. Silent Ceremony rotation co-locates at Guildhall. **Temple Treasury retired completely** — no product use, no ops use. "the Temple treasury" retained as three lowercase words in whitepaper §Historical prior art only; strongest as invisible prose, not a named concept. Melt-hygiene mnemonic: settlement-flavoured names (Jewel Tower, the Exchange) on melt mints; admission-flavoured names (Royal Mint, Guildhall) on no-melt mints. Four Liberties mint column fully locked. BRIDGE v6.2. |
| **Pass-Vocab-1 · 1 Sep 2026** | all repos | **Pass geographic vocabulary locked — three unnamed things named.** Reward token UI name: **a Pass** (product name, normie-legible, literally correct — the Jewel Tower issues Passes). Live melt path event: **Redemption** (primary: Westminster Abbey coronation ritual — the Lord President redeems the Sword of Offering with newly minted coin, a formal financial act with a named sequence; secondary/backup: HM Treasury gilt redemption — repaying and cancelling a debt instrument, wiping the liability from the balance sheet; both Westminster-rooted, one word). Integrity verification metaphor: **Trial of the Pyx** (locked for whitepaper §BLAKE3 integrity + §Historical prior art + closed-door pitch; internal name for the integrity test suite). Access credential has no new geographic name — plain language in docs; "your Pass" in UI. Vocabulary matrix updated. BRIDGE v6.3. |
| **Merchant-Vocab-1 · 1 Sep 2026** | all repos | **Merchant geographic vocabulary locked — three unnamed things named.** Reward stamp instrument: **a Note** (normie-legible, pre-Bank-of-England provenance — Royal Exchange merchants issued promissory notes before 1694; EIC scrip noted as whitepaper provenance sentence, not a named term). Live melt path event: **Clearance** ("Your Note has cleared" — the Exchange was where bills were cleared; LCH direct descendant). Venue stamp vs settlement token distinction: no second noun — both are a Note throughout the lifecycle; architecture distinguishes accrual state from cleared state internally. Mint name **the Exchange** locked (was provisional). Constitutional line: Westminster *passes* laws → Temple *keeps the record* → the Exchange *issues Notes* → Notes *clear* at the Exchange → the Tower *moves the cargo*. BRIDGE v6.4. |
| **S89 · 3 Sep 2026** | all repos | **Tier rename locked.** Free → Citizen. Creative Premium retired (no live subscribers — archive Stripe price objects at S90). Production Max → Sovereign. Crown retires to brand/institutional vocabulary only. Rail model: both rails at Sovereign; identity-free features gated by Lightning rail, not tier. BRIDGE v6.8. |
| **AD-HOC · 4 Sep 2026** | all repos | **EIC promoted to named villain** (whitepaper/closed-door only). Muscovy Company provenance clause added (first joint-stock entity, 1555; extraterritorial jurisdiction; Muscovite Street geography). Freedom of the City / impressment locked for §Compulsion argument — Freeman's credential as NUT-11 P2PK precedent; tightens Guildhall geography. St. Peter ad Vincula locked as whitepaper prose texture only (ad Vincula / in chains; Mint and chapel sharing the same walled ground). City Wall / Posterns locked as prose texture — postern as the architectural precedent for inconspicuous sanctioned passage; Aldgate / Fenchurch Street connection noted. The Tower walk locked as opening geography paragraph candidate. BRIDGE v6.9. |
| **AP-10 · 3 Sep 2026** | refueler-share + all repos | Roadmap resequenced (no Hetzner required for TG-block, TH-session, SW, B8). Traitor's Gate feature locked: internal/whitepaper vocabulary only; UI = "Destroy after download"; tidal window system (four settings); tier gating (core = all tiers, temporal control = paid only); UX confirmation gate (user-triggered deletion post-download). Tower Hill / OpenTimestamps scoped: 2–3 Opus sessions covering Share + Pass + Legend `.ots` use cases. Execution Dock locked: Harbourmaster dashboard card, 48h Three Tides grace, no fee mechanism, sender-facing only. Dragon status vocabulary locked: presence-based operational status, distinct from Raven (absence-based legal signal). Editorial atoms locked: Pileus quote, Three Guineas, Pepys quote, Penn/Bushel's Case, JQA at All Hallows, Cibber frieze/Monument, EIC private intelligence, Tower Subway. Beating of the Bounds reserved for B9 audit + article. BRIDGE v6.7. |

---

## Active action items (Rajesh)

- **[Lightning — ALL projects] LNbits on Hetzner CAX21 LOCKED.** Next: NB-2 (provision + phoenixd + Cloudflare Tunnel — refueler-share project).
- **[All products] Remove all Blink references** from merchant handover docs, Worker secrets, and config files. Replace `BLINK_API_KEY` / `BLINK_SHARE_API_KEY` with `LNBITS_URL` / `LNBITS_API_KEY`. Execute at NB-5 for refueler-io; at B7-S74 for Share Worker.
- **[Share] Run `bin/sync-share.sh`** after every edit to any shared frontend asset.
- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant).
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns (Ops wallet created at NB-3).
- Upgrade Supabase to Pro at first real merchant.
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume.
- Rotate Anthropic API key before csuite briefing reuse.
- Football-data.org API key held by Rajesh — ready for Events intelligence layer session.
- Commission rate planning conversation before first real merchant.
- **[Pass + Merchant] Geographic vocabulary — COMPLETE · 1 Sep 2026.** Pass-Vocab-1 + Merchant-Vocab-1 both locked. All four Liberties fully named.
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

## Refueler brand vocabulary — London geography (locked AP-BRAND · 31 Aug 2026; extended Opus-3 + Opus-3b + Pass-Vocab-1 + Merchant-Vocab-1 + AP-10)

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
| **Dragon** | The operational status indicator — presence-based system health signal, distinct from Raven (absence-based legal warrant canary). "The Dragon holds" = all systems operational. "The Dragon sleeps" = degraded / partial outage. "The Dragon has fallen" = critical failure or maintenance. The Dragon is the wall; the Raven is the alarm. Internal vocabulary and status page only. Never conflated with City of London boundary bollard dragons. | Internal / status page |
| **Traitor's Gate** | Internal/whitepaper vocabulary for the Destroy after download feature and its tidal window system. UI label: "Destroy after download." The Gate is the mechanism; the user is not the traitor. The name refers to the water gate through which the accused arrived — one way in, no way back. Never in product-facing copy. Whitepaper + closed-door only. | Internal / whitepaper |
| **Tidal Window** | The temporal access control system built on Traitor's Gate. Four settings: (1) Destroy after download [all tiers]; (2) Close tide — auto-delete at precise datetime [paid tiers]; (3) Open tide — available from datetime [paid tiers]; (4) Combined tidal window — from + until + destroy [paid tiers]. Enforced at Worker via manifest fields `available_from_timestamp` + `available_until_timestamp`. | Whitepaper / docs |
| **Execution Dock** | The uncollected-transfer queue in the Harbourmaster dashboard. Transfers expired without collection enter a 48-hour grace window (Three Tides) before R2 deletion executes. Amber state in dashboard. Sender-facing only — recipient never sees this designation. No fee mechanism: extend means re-upload on free tier; paid tier expiry windows make this less common. Named for Execution Dock, Wapping, where pirates were left until three tides had washed over them. | Harbourmaster dashboard / internal |
| **Three Tides** | The 48-hour grace period at Execution Dock before R2 deletion. Named for the historic sentence at Execution Dock: bodies left until three tides washed over them (~36–48 hours). | Internal / dashboard |
| **Beating of the Bounds** | Reserved for: (1) the B9 security audit — a formal walk of every system boundary, endpoint, rate limit, and cryptographic claim; (2) an article on boundary knowledge as embodied memory (the City boundary existed only in the memory of those who had walked it — the key has the same property). Not a feature name. | Whitepaper / article |
| **Tower of London** | Brand geography home of **Share**. Every locked Share term has a real address here: Royal Mint (inside the walls 500 years), Port of London Authority (Tower Hill), the harbour lexicon (Pool of London), Tower Bridge, the Ravens, and the Warder's nightly Ceremony of the Keys. The tightest product-to-place fit of the four. | Share product |
| **Tower Bridge** | Tier differentiator visual metaphor — the bridge raises for large vessels (Sovereign / Business). Citizen passes under. Sovereign navigates the Thames with skill. Not a UI label; lives in design language and copy tone. | Design / copy |
| **Westminster** | Brand geography home of **Pass**. The Palace of Westminster *passes* laws — permits, who may do what and when. Rotation ceremony: Black Rod (State Opening). | Pass product |
| **Temple** | Brand geography home of **Legend** — and the unowned headwater of the Templar prior-art argument (Cashu spiritual home). Legend stands at the origin. The record-keeper on the origin ground. Rotation ceremony: Silent Ceremony. | Legend product / whitepaper |
| **Royal Exchange** | Brand geography home of **Merchant** — the first purpose-built commercial exchange in England. Where trade is settled, not where cargo moves or rules are made. Mint: the Exchange (locked). Rotation ceremony: The Proclamation. | Merchant product |
| **Guildhall** | The City's record-house (Guildhall Library, London's civic archive) — paired with St Paul's as Legend's geographic brand context. "Consult the record." | Legend product / whitepaper |
| **Whispering Gallery** | Metadata-leak metaphor (Legend, St Paul's). A whisper you believe private travels the whole dome and is heard on the far side — exactly what querying a public block explorer does to a "private" lookup. Pairs with Temple of Mithras. Powers Legend Article 14. | Professional / whitepaper |
| **Triforium / Trinity Library** | The deep ledger / records archive (Legend, St Paul's) — the hidden 1709 library. The historical chain data you consult. | Whitepaper / docs |
| **Floating staircase** | Merkle tree / parent-hash structure (Legend, St Paul's geometric staircase) — each step self-supporting on the one below. **Whitepaper and closed-door presentation only — too technical for client copy.** | Whitepaper / presentation |
| **a Pass** | The reward token (spendable sat ecash) issued by the Jewel Tower. UI name only — the same surface name covers access credentials and reward tokens; the architecture distinguishes them. 95% of users need one word, not two. "The Jewel Tower issued you a Pass." | UI / product |
| **Redemption** | The live melt path event for Pass — the act of presenting a Pass (reward token) and receiving sats. Primary provenance: Westminster Abbey coronation ritual (the Lord President redeems the Sword of Offering from the Dean with newly minted coin — a formal financial act with a named sequence, step 3 of the Coronation Ritual of Redemption). Secondary/backup provenance: HM Treasury gilt redemption (repaying capital, cancelling the instrument, wiping the liability from the balance sheet). Both Westminster-rooted. One word. | Whitepaper / docs / professional copy |
| **Trial of the Pyx** | The annual judicial ceremony (since 1248) testing Royal Mint coin output for fineness before a High Court judge — held in the Pyx Chamber at Westminster Abbey (prior to 1870), administered by the Worshipful Company of Goldsmiths. Standard plates released only on a warrant from the Chancellor of the Exchequer. Isaac Newton appeared before it in 1696. **Refueler mapping:** BLAKE3 chunk integrity verification — every token issued by the mint is tested against a known standard before being trusted, as every coin from the Royal Mint was tested before being trusted. The mint cannot issue debased coin undetected; the Worker cannot store corrupted data undetected. Same architecture, 800 years apart. **Internal name candidate** for the integrity test suite. | Whitepaper §BLAKE3 integrity + §Historical prior art · closed-door pitch · internal ops |
| **a Note** | The reward stamp instrument issued by the Exchange — the Merchant equivalent of "a Pass". The Exchange issues Notes; Notes accumulate silently per fulfilled order (`✦` glyph); Notes clear at the Exchange. Pre-Bank-of-England provenance: Royal Exchange merchants issued promissory notes before the Bank existed (1694). The instrument belongs to the Exchange, not the Bank. Whitepaper provenance sentence: "the Exchange issued scrip; the Exchange still does." | UI / product / professional copy / whitepaper |
| **Clearance** | The live melt path event at the Exchange — the moment a Note is presented and value received. "Your Note has cleared." The Exchange was the venue where bills were cleared — presented, verified, paid. LCH (London Clearing House) is its direct descendant. Completely distinct from Redemption (Pass). | UI / product / professional copy / whitepaper |

### Retired terms (do not use)
- **Drop Berth** — ward incident form. Retired.
- **Pontoon** — card game. Retired.
- **Port** — too much existing technical meaning (ports, port forwarding). Retired.
- **Pier** — functionally weaker than Quay. Reserved at most.
- **Marina** — too recreational for the professional register. Retired.
- **Warrant** — considered and rejected as reward token name. In UK register immediately implies arrest warrant. Wrong register for a good night out.
- **Chit** — considered for Merchant instrument. Rejected: too close to an unprintable word. Retired.
- **Bill** — considered for Merchant instrument. Rejected: UK register reads Parliament first; Parliament collision with Pass geography. Retired.
- **Scrip** — considered for Merchant instrument. Strong EIC provenance. Retained as whitepaper provenance sentence only ("the Exchange issued scrip; the Exchange still does") — not a named term in the matrix.

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
              └── Dragon (operational status indicator — presence-based)
              └── Traitor's Gate (internal: Destroy after download + Tidal Window system)
              └── Execution Dock (Harbourmaster dashboard: uncollected transfer queue)

Refueler Pass  ·  home: Westminster
  └── Jewel Tower (Pass mint — issues Passes, holds live melt path)
        └── a Pass (the issued instrument — access credential or reward token, same UI name)
        └── Redemption (the live melt event — Pass presented, sats received, instrument cancelled)
        └── Trial of the Pyx (BLAKE3 integrity metaphor — whitepaper + internal only)
        └── Black Rod (keyset rotation — State Opening)
        └── Raven (Pass's warrant canary — 2–3 mirrors)

Refueler Legend  ·  home: Temple (Guildhall + St Paul's as brand geography)
  └── Whispering Gallery (metadata-leak) · Triforium (deep ledger) · Floating staircase (Merkle)
        └── Silent Ceremony (keyset rotation)
        └── Raven (Legend's warrant canary — 5–6 mirrors)

Refueler Merchant  ·  home: Royal Exchange
  └── the Exchange (Merchant's Cashu mint — settlement + reward stamps, live melt path)
        └── a Note (the issued instrument — reward stamp, accrues per fulfilled order)
        └── Clearance (the live melt event — Note presented, value received, instrument cleared)
        └── The Proclamation (keyset rotation — read by the Common Crier)
        └── Raven (Merchant's warrant canary — 2–3 mirrors)
```

### Resolved — AP-ARCH · 31 Aug 2026; Opus-3 · 31 Aug 2026; Opus-3b · 31 Aug 2026; Opus-3a · 1 Sep 2026; Pass-Vocab-1 · 1 Sep 2026; Merchant-Vocab-1 · 1 Sep 2026; AP-10 · 3 Sep 2026
Four separate mints. Four independent seeds. No shared mint, no shared keyset across products. Pass vocabulary complete. Merchant vocabulary complete. All four Liberties fully named. Dragon vocabulary locked. Traitor's Gate internal vocabulary locked.

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
- **Sovereign** — up to 10 named Quays. Harbourmaster dashboard. SimpleX or polling notification.
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
| Westminster | Pass | Access credentials + reward tokens (both surface as "a Pass") | Mixed — reward tokens have live melt path (Redemption) | **Jewel Tower** (locked Opus-3a) |
| Temple (Guildhall + St Paul's) | Legend | Address watch credentials | No — signal-only, no melt path | **Guildhall** (locked Opus-3a) — deep ledger at St Paul's/Triforium |
| Royal Exchange | Merchant | Settlement Notes + venue stamps | Yes — live melt path (Clearance), venue settlement | **the Exchange** (locked Merchant-Vocab-1) |

**Why four, not one mint with four keysets:** a shared mint is a shared failure domain, a shared compulsion surface, and a shared database that *can* correlate events across products. Separate mints remove the ability, not merely the intention. Melt-hygiene axis: Pass and Merchant carry live melt paths; Share and Legend must never melt; the same process must not hold both properties.

**Server topology:** Instance A (Share + Pass) · Instance B (Legend, post-B9) · Instance C (SimpleX SMP, B9). Four mint processes across three instances as builds arrive. Each instance: separate processes, separate databases, separate ports.

---

## Raven governance (locked AP-ARCH · 31 Aug 2026; extended Opus-3b · 31 Aug 2026)

**Ravens are warrant canaries only.** One Raven per Liberty — four Ravens total. Separate legal statements, separately signed, separately dated, on their respective product pages.

**The metaphor:** the traditional warrant canary dies to signal danger — a one-time, unrepeatable signal. Refueler uses Ravens instead: by statute, there must be at least six Ravens at the Tower of London, or the Tower — and with it, the kingdom — falls. The Raven does not die. It is simply absent. And its absence is continuous, compounding, and impossible to hide. A Refueler Raven must be renewed on a fixed schedule; failure to renew is the signal. For the whitepaper, this etymology is stated once, briefly, in §5.

**The Dragon is not the Raven.** The Dragon signals operational status — presence-based, continuous, about infrastructure health. The Raven signals legal status — absence-based, one-time, about compulsion and compromise. These two signals cover different threat surfaces, must never share vocabulary, display surface, or ambiguity. Raven = legal alarm. Dragon = operational wall.

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

## Vocabulary matrix (locked AP-ARCH · 31 Aug 2026; updated Pass-Vocab-1 + Merchant-Vocab-1 · 1 Sep 2026; AP-10 · 3 Sep 2026)

| Term | Website / UI | Professional copy | Whitepaper / docs | Closed door / internal |
|---|---|---|---|---|
| Silent Drop | ✓ | ✓ | ✓ | ✓ |
| Lighthouse | ✓ | ✓ | ✓ | ✓ |
| Harbourmaster | ✓ | ✓ | ✓ | ✓ |
| Quay | ✓ | ✓ | ✓ | ✓ |
| a Pass (reward token / access credential) | ✓ (UI name) | ✓ | ✓ | ✓ |
| a Note (Merchant reward stamp) | ✓ (UI name) | ✓ | ✓ | ✓ |
| Clearance (Merchant melt event) | ✓ | ✓ | ✓ | ✓ |
| Cargo | — | — | ✓ (API/webhooks) | ✓ |
| Royal Mint | — | ✓ (Share mint) | ✓ | ✓ |
| Port Authority | — | — | ✓ (admission-control layer) | ✓ |
| Dragon | — | — | — | ✓ (status indicator) |
| Execution Dock | — | — | ✓ | ✓ (dashboard card) |
| Three Tides | — | — | — | ✓ |
| Traitor's Gate | — | — | ✓ (feature internal name) | ✓ |
| Tidal Window | — | — | ✓ | ✓ |
| Beating of the Bounds | — | — | ✓ (WP + article) | ✓ |
| The Pileus | — | — | ✓ (WP preamble) | ✓ |
| Tower of London | — | ✓ (Share brand) | ✓ | ✓ |
| Westminster | — | ✓ (Pass brand) | ✓ | ✓ |
| Temple | — | ✓ (Legend brand) | ✓ | ✓ |
| Guildhall | — | ✓ (Legend geographic context) | ✓ | ✓ |
| Royal Exchange | — | ✓ (Merchant brand) | ✓ | ✓ |
| the Exchange | — | ✓ (Merchant mint) | ✓ | ✓ |
| Whispering Gallery | — | ✓ (metadata leak) | ✓ | ✓ |
| Triforium / Trinity Library | — | — | ✓ (deep ledger) | ✓ |
| Floating staircase | — | — | ✓ (Merkle — WP + presentation only) | ✓ |
| Redemption | — | ✓ (Pass melt event) | ✓ | ✓ |
| Trial of the Pyx | — | — | ✓ (BLAKE3 integrity + historical prior art) | ✓ (internal test suite name) |
| Jewel Tower | — | ✓ (Pass mint) | ✓ | ✓ |
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
| Traitors Gate | — | — | ✓ (WP — feature context) | ✓ (internal only) |
| White Tower | — | — | — | ✓ (held) |
| Shakespeare's Globe | — | — | — | ✓ (re-credential metaphor, pitch) |
| Temple of Mithras | — | — | ✓ (metadata argument) | ✓ |
| Fleet Street | — | ✓ (editorial voice) | ✓ | ✓ |
| Bank of England | — | — | ✓ (the foil — use with care) | ✓ |
| Cleopatra's Needle | — | — | — | ✓ (held — attestation monument) |
| Pall Mall | — | — | — | ✓ (held — Enterprise register) |

**Rule:** if a term is not in the Website/UI column, it does not appear on `refueler.io` outside of the whitepaper and notes articles. Harbourmaster, Quay, "a Pass", "a Note", and "Clearance" are the only geography/product terms that have passed the website test.

---

## The Templar prior art argument (locked AP-ARCH · 31 Aug 2026)

For use in whitepaper §Historical prior art and closed-door pitches. Not for website copy.

The Knights Templar invented the letter of credit at Temple Church, London, circa 1150. A pilgrim deposited gold at the London preceptory, received a credential (a document, a bearer instrument, encrypted and verifiable), travelled to Jerusalem, presented the credential, received equivalent value. The gold never moved. The *information about the gold* moved — in verifiable form, across jurisdictions with no common sovereign, designed for adversarial interception conditions.

**This is Cashu. Not a metaphor for Cashu. Cashu, described in 1150.**

The blind signature is the letter. The mint is the Temple treasury. The bearer is the pilgrim. The receiving preceptory is the download endpoint.

The lineage: Templar letter of credit (c.1150) → Venetian bill of exchange → Chaumian blind signature (1982) → Cashu (2022) → Refueler (2026).

**Legend's home is Temple.** The record-keeper stands on the origin ground. The Templar argument and the product that keeps the record share the same geography — this is not a coincidence and should be noted in the whitepaper without over-explaining it.

**"The pilgrim's society"** — held as a future proper noun for the constituency of Refueler users. Heavy Anglo-American connotations, silent power. Do not use until the naming is ready.

**Use in whitepaper:** §Historical prior art (Templar lineage + Trial of the Pyx lineage), §Privacy model (Temple of Mithras + Whispering Gallery), §Permission model (City sovereignty — each Harbourmaster holds equivalent sovereignty over their own Liberty; Temple Bar as the gate), §BLAKE3 integrity (Trial of the Pyx).

---

## Editorial vocabulary and article reference material (locked AP-10 · 3 Sep 2026)

Locked editorial atoms for whitepaper, articles, and presentations. None of these appear in product-facing UI copy unless specified.

| Atom | Content | Use |
|---|---|---|
| **Pileus quote** | "Liberty holds the pileus but does not wear it. Freedom is offered. It must be chosen." The pileus — Roman freed-slave hat, symbol of manumission — is held out by Liberty in Cibber's Monument frieze, not worn. Offered, not imposed. | Whitepaper preamble and Four Liberties section. |
| **Pepys execution quote** | *"I went to see Major General Harrison Hung Drawn and Quartered. He was looking as cheerful as any man could in that condition."* — Samuel Pepys, 13 October 1660. Plaque outside the Hung Drawn & Quartered pub, Great Tower Street. Harrison was a Fifth Monarchist who had signed Charles I's death warrant. Pepys went to watch and recorded it with complete equanimity. | Brand voice reference. The register: English, dry, unflappable in the presence of something technically gruesome. Whitepaper / talks / btc++ Berlin. |
| **Three Guineas** | Lord Balmerino tipped his executioner three guineas (22-carat gold, £1.05 each, 8.3g) at Tower Hill on 18 August 1746, before kneeling on the wrong side of the block, correcting himself, and giving the signal. His execution reportedly took three blows. £22,744 at 2026 purchasing power. Chain: guinea (1663) → pound (1816) → decimalised (1971) → Nixon/Bretton Woods (same year, August 1971) → Bitcoin. | Article 6 lede (anonymous payment). The guinea survived 153 years before the state ended it. |
| **Pepys's cheese** | On 1 September 1666 Pepys buried "my Parmazan cheese as well as my wine and some other things" in a pit in his garden at the Navy Office, Seething Lane, to protect them from the approaching Great Fire. He believed obscurity protected his records (Shelton's tachygraphy shorthand). His diary was deciphered in 1819 by John Smith — working from the manuscripts for three years without realising a key to the shorthand was on the same library shelf. **Fact-check required:** the Four Seasons / Ten Trinity Square renovation claim is unverified — the Navy Office was on Seething Lane (~300m from Ten Trinity Square). Use the Seething Lane burial only. | Article on security through obscurity (Pepys, 1665) vs cryptographic security (today). "Pepys buried his cheese because he trusted the ground more than the street. We bury your files in cryptography for the same reason." |
| **Penn / Bushel's Case** | William Penn baptised at All Hallows by the Tower, 1644. Penn-Mead trial, 1670 — jury refused to convict despite the judge threatening them with starvation and imprisonment. Established jury independence as a constitutional principle (Bushel's Case). "You cannot compel conscience." Penn founded Pennsylvania. | Whitepaper preamble / compulsion argument. "What no court could extract from Penn's jury, our architecture makes architecturally impossible." |
| **JQA at All Hallows** | John Quincy Adams (6th US President) married at All Hallows by the Tower in 1797, while serving as US Minister to the Netherlands. Son of John Adams (2nd President) — one of only two father-son presidential pairs in US history. Both exceptional correspondents and diarists. JQA kept 51 volumes. | American audience presentations. btc++ Berlin (October 2026). |
| **Cibber frieze / Monument** | The Monument west frieze designed by Robert Hooke FRS in consultation with Wren (Hooke's credit understated). Sculpted by Caius Gabriel Cibber (released daily from debtors' prison to sculpt, returning each night). Liberty holds the pileus — not wears it. Masonic symbols in frieze (square and compass in Architecture's hand). Monument sits on Candlewick/Bridge Ward boundary. Monument height = distance to Pudding Lane bakery origin (202ft). Shaft housed a zenith telescope. Six people have jumped from it (more than the Great Fire's confirmed fatalities of six). | Whitepaper Four Liberties section. Monument is in Candlewick Ward — Merchant territory (fire was mercantile catastrophe, rebuilding a mercantile act). Never claimed as Share territory. |
| **EIC — the named villain** | East India Company (chartered 1600, East India House, Leadenhall Street, ~600m from Tower). Own army 260,000 men at peak — twice the British Army. Cipher dispatches London-India not readable by Crown. All EIC goods declared at Custom House, adjacent to Tower. The model was inherited from the Muscovy Company, chartered 1555 — the first English joint-stock entity, whose agents in Moscow operated under their own laws, exempt from Russian jurisdiction; Muscovite Street, a five-minute walk from Leadenhall, still carries the name. The EIC refined the template: a private surveillance and compulsion apparatus, incorporated, with directors who could be summoned, operating from a fixed address. That is the architecture Refueler is structurally opposed to. **The villain is not a foreign power or a criminal. It is a company. Chartered. Legal. With paperwork.** The horror is that it happened incrementally, institutionally — until it had an army twice the size of the state's and the state came to it for information. Refueler removes the address. There is nobody to summon. | Whitepaper §Compulsion argument (the named villain); closed-door pitches; btc++ Berlin. Never in product UI or marketing copy. The contrast line: "The EIC had an address. We don't. The EIC had directors. We don't. The EIC declared at Custom House. The Royal Mint is blind." |
| **Tower Subway** | Opened August 1870, north entrance at Petty Wales. First subterranean tunnel under Thames. Cable-hauled single carriage, 12 passengers max. Fares: 1d first class, ½d second. Closed within 4 months (unreliable). Converted to pedestrian use — 1 million/year at ½d. Superseded by Tower Bridge (1894, free). Original entrance demolished 1926; stumpy brick tower replacement visible. Oral history from former Tiger Tavern (now Starbucks) barman: tunnel from the Tower itself ran to that corner — used by Elizabeth I and Yeoman Warders. **Oral history, not documented fact.** | Legend brand narrative: hidden infrastructure beneath the visible surface. "There are things moving under this city that don't appear on the map." |
| **Beating of the Bounds** | Ancient ceremony where parish boundaries were physically walked, with willow wands used to strike boundary markers. Required because boundaries existed only in the memory of those who had walked them — before maps, there was no other record. The City of London still performs it. | B9 security audit framing (walk every system boundary). Article: boundary knowledge as embodied memory — the key has the same property. You either have it or you don't. |
| **Freedom of the City / impressment** | The Freedom of the City of London, granted at Guildhall since c.1237, conferred exemption from the press gang. A Freeman could not be seized and forced into naval or military service against his will. The legal mechanism was a credential — issued by the Guildhall Chamberlain's Court, presented at the moment of compulsion, that the press gang was required to honour. This is NUT-11 P2PK in 1650: a credential bound to a person, resistant to state compulsion by architecture rather than by policy. Trade without toll is the secondary privilege — Freeman could move value through the City gates without paying. Both privileges derive from the same instrument: a credential that changes what the state can do to you. | Whitepaper §Compulsion argument and §Permission model. Pairs with Penn/Bushel's Case (conscience) and the EIC villain arc (the institution that had no such constraint). Tightens the Guildhall geography: Guildhall doesn't merely keep records — it issues the credential that protects you from the state. |
| **St. Peter ad Vincula** | The Chapel Royal inside the Tower of London walls. "Ad Vincula" — in chains. Founded before 1241. Anne Boleyn, Catherine Howard, and Thomas More are buried here. The chapel of the chained, inside the walls, serving those who cannot leave. Its maintenance was funded for centuries partly by annual payments from the Royal Mint to its workmen — the Mint's monetary infrastructure and the chapel of the imprisoned sharing the same walled ground. | Whitepaper prose texture for §Share / Tower of London section only. One sentence, not a named term. "Inside the same walls where the Mint struck coin, the chapel of the chained stood — ad Vincula, in chains. The Royal Mint is blind. The chapel is not our concern." Never in product UI. |
| **The City Wall / Posterns** | The Roman and medieval wall of London defined the boundary of the City's jurisdiction for over a millennium. Its gates — Aldgate, Bishopsgate, Moorgate, Cripplegate, Aldersgate, Newgate, Ludgate — were the only official entry points, monitored, tolled, controlled. But the wall also had posterns: secondary gates, deliberately placed in concealed locations, allowing inconspicuous entrance and exit. Smaller. Less visible. Defensible. Officially sanctioned but not the primary surveillance surface. The road network of modern London still follows the lines of those gates — the infrastructure of control is still legible in the street plan. But the posterns are gone, and only the names remain. Aldgate leads to Fenchurch Street. | Whitepaper §Architecture. The Aldgate / Fenchurch Street connection is available as one closing line in the whitepaper geography paragraph — the wall's gate for Essex and East Anglia led to what is now Fenchurch Street station. The Refueler corridor begins where the Roman gate stood. Postern = the mechanism Refueler provides: a sanctioned but inconspicuous path that was always there, just not the one the gate-keepers watched. Never a named product term — prose texture only. |
| **The Tower walk** | A single paragraph of whitepaper geography — one walk from Fenchurch Street station to the Tower — passes: Muscovite Street (Muscovy Company, 1555), St. Olave Hart Street (Pepys's parish church), All Hallows by the Tower (Penn baptised 1644, JQA married 1797), Crutched Friars (dissolved 1538, site repurposed by commerce), Cooper's Row (barrel-makers, Thames trade infrastructure), Custom House (where EIC declared all goods), and arrives at the Tower walls where the Royal Mint operated for 500 years and St. Peter ad Vincula stands. Every name on that walk is already in the Refueler universe. The EIC was at Leadenhall, five minutes north. This is not a list — it is a walk. One paragraph, no footnotes. | Whitepaper opening geography paragraph if one is used. Sets the reader in the corridor before the argument begins. Draft when whitepaper §1 is being written. |

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
| Traitors Gate | Water gate entrance to the Tower. Prisoners arrived by barge timed to high tide. The gate opened at high water only — the tidal window was non-negotiable. One way in, no way back. Name retrospective — many who entered (More, Boleyn, Raleigh) were not traitors. | **Internal/whitepaper vocabulary for the Destroy after download feature and Tidal Window system.** Never in product-facing copy. "The Gate is the mechanism; the user is not the traitor." In closed-door pitch: "the email inbox was always a Traitors Gate." |
| Monument (Candlewick Ward) | Designed by Hooke, consultation by Wren. Cibber frieze: Liberty holds pileus. Masonic programme. Stands on Candlewick/Bridge Ward boundary. Height = distance to Pudding Lane. | **Merchant territory** (fire was mercantile catastrophe, rebuilding mercantile act). Pileus quote locked for whitepaper. Never Share territory. |
| Execution Dock (Wapping foreshore) | Pirates hanged at the low water mark, left for Three Tides (~48h). Prisoners occupied the jurisdictional gap between land and maritime law. Last execution 1830. Captain Kidd, 1701. | **Execution Dock**: Harbourmaster dashboard card for uncollected-transfer queue. Three Tides = 48h grace. The word "Wapping" not used in copy (poor local reputation, means marshy place). |
| Three city-states | London (finance), Washington (military), Vatican (religion) | International scale — available when Refueler operates across jurisdictions. Whitepaper future work gesture only. |
| Mark Lane / Tower Hill station | Original 1884 Metropolitan District Railway station (renamed Tower Hill). Old terracotta surface building still visible at Tower Hill / Byward Street corner. New Tower Hill station opened 1967, ~100m west. Original tunnels' current use undocumented publicly. | Legend article: infrastructure persisting beneath the visible city. Urban exploration record exists but not verified. |

---

## Upstream protocol monitoring — Cashu

> Added: 2026-09-03. Review at B8 design lock and Pass planning session.

### PR #371 — NUT-00: BLS12-381 (v3 protocol)
**Author:** robwoodgate · **Status:** Open → `cashubtc:main` · **CDK PR:** cdk#2194 (POC)

Adds BLS12-381 pairing-based BDHKE as the v3 Cashu blind-signature protocol (keyset version byte `02`). Legacy `00`/`01` secp256k1 keysets unchanged — wire shape (`BlindedMessage`, `BlindSignature`, `Proof`) unaffected. Key deltas:
- Verification shifts from DLEQ to pairing equality: `e(C, G2) == e(Y, K)`
- NUT-12 DLEQ scoped to secp256k1 keysets only — v3 proofs carry no `dleq`
- Deterministic weighted batch verification via Fiat-Shamir transcript — significant throughput gain at POS/Pass issuance scale
- NUT-13 blinding factors use rejection sampling against `BLS_FR_ORDER`

**Cross-product impact:**
- **Merchant:** Batch verification efficiency directly benefits high-frequency POS proof validation.
- **Pass:** Bulk event credential issuance benefits from weighted batch verification.
- **Share:** No immediate impact. CDK pinned at 0.17.2 — do not unpin until stable release ships v3 support (est. 6–12 months post-merge).

**Action:** Monitor merge. Do not upgrade CDK until a stable release ships v3. Flag at B8 design session.

---

### PR #421 — NUT-10: Nutroot secrets (v3 keysets)
**Author:** robwoodgate · **Status:** Open, stacked on #371 · **CDK PR:** cdk#2433 (POC)

Gives Cashu tokens programmable spending conditions expressed as a Taproot-inspired Merkle tree of declarative condition leaves. Named **nutroot** (not taproot — commits structure only, none of Bitcoin's validation rules). Three leaf types: `threshold` (M-of-N), `after` (timelock), `hashlock`. No opcodes, no stack, no interpreter. Tree shape is deterministic from leaf count. Every v3 input signs a shared transaction transcript enabling atomic batch operations.

**Critical scoping:** NUT-11 and NUT-14 are explicitly scoped to pre-v3 keysets. NUT-22 BATs (Blind Authentication Tokens) are the v3 equivalent of NUT-11 Mode 2 — a `02` BAT signs a full request transcript (method + target + body hash).

**Cross-product impact:**

| Product | Application | Priority |
|---|---|---|
| **Pass** | `threshold` (M-of-N entry, e.g. VIP+standard), `after` (time-gated access windows), `hashlock` (QR redemption gate = reveal preimage). Atomic batch issuance for event cohorts via transaction transcript. | High — design Pass architecture around nutroot leaves, not custom logic |
| **Merchant** | NUT-18/26 delta: nutroot payment request option `(k, l, b)` in `creqB` under TLV `0x0b`. Conditional POS settlement (threshold: merchant confirm + customer spend; after: expiry). NUT-28 positional sender slots enable merchant attribution with customer privacy intact. | High — Note/Clearance model maps cleanly |
| **Share** | `threshold` leaves replace planned FROST complexity for B12 M-of-N credential issuance. `after` leaves are the native primitive for "recovery window / pay-to-extend" (B9 §Future work). NUT-22 BATs may supersede NUT-11 Mode 2 planned implementation — **review NUT-22 spec before B8 design session is locked.** | Medium — NUT-11 Mode 1 unaffected |

**Action:** Pass architecture planning session should treat nutroot `threshold`/`after`/`hashlock` as the foundational primitive. Re-read NUT-22 before B8 design lock. Target merge monitoring: Q4 2026 (author's pace + two independent POC implementations already passing shared test vectors suggest near-ready).

---

### cashu-vpn — reference architecture (not integration target)
**Author:** robwoodgate · **Repo:** github.com/robwoodgate/cashu-vpn · **Licence:** MIT

Sells short-lived WireGuard VPN access for Cashu ecash. Architecturally relevant as independent confirmation that Refueler's payment pattern is correct:
- BIP32 xpub fresh-key-per-sale (mint cannot link purchases across sessions) — same unlinkability model as Share's credential issuance
- Offline NUT-11 P2PK proof verification against cached mint pubkeys — no per-sale mint call (same pattern as Share worker)
- Non-custodial: server holds watch-only xpub only; locked receipts claimed offline via `sweep:remote`

**Not an integration target for Share.** Running Refueler-operated exit infrastructure moves the IP trust problem rather than solving it — Hetzner box would see user real IP AND Share traffic pattern. This is strictly worse than the current model. Correct recommendation remains: Mullvad (multi-hop) in B9 whitepaper. Share users tunnel their own VPN before hitting Share.

**robwoodgate** is the author of PR #371, #421, cashu-vpn, and multiple CDK PRs. South-east England based. The most active contributor to Cashu's cryptographic layer currently. Worth cultivating as an ecosystem contact — potential whitepaper reviewer, Pass architecture feedback, btc++ Berlin.

*"Nothing stops this train."*
