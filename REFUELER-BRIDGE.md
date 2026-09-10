# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 9.0 | **Created:** 28 July 2026 | **Updated:** SW7-Opus · 2026-09-10
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), `refueler-pass/` (root), and `numo-fork/` (root).
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant terminal (Fenchurch St line cafés and restaurants — tablet, counter/kitchen, landscape) · **Relay** (`io.refueler.merchant`, formerly NumoPay fork — in-venue order entry, Android phone, floor/waiter staff, portrait) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · **Refill** (consumer app, React Native, LNbits Lightning — commuter pre-orders + Legend + Pass)

**Product names locked CC-103:** Floor staff Android app = Relay ("Relay by Refueler"). Consumer app = Refill.

**North star (internal only):** *Come for privacy, stay for Bitcoin.*

**Merchant profile (locked TDP-A):** Small, family-run independent businesses — cafés, coffee shops, delis, local restaurants. Community relationships, care over throughput. Not multi-national franchises. Not competing with Square/Toast/Lightspeed. First merchants likely in Essex (Southend, Leigh-on-Sea, Westcliff) before London corridor.

**Local paths:** Main site + POS: `/Users/rajeshtaylor/Documents/refueler.io/` · Share: `/Users/rajeshtaylor/Documents/refueler-share/` · Legend: `/Users/rajeshtaylor/Documents/refueler-legend/` · NumoPay fork: `/Users/rajeshtaylor/Documents/refueler.io/terminals/numo-fork/` · Pass: `/Users/rajeshtaylor/Documents/refueler-pass/`

**GitHub:** `github.com/rajesh-taylor`

**Order flow (CC-83):** Consumer app places order → merchant terminal receives → Relay handles in-venue fulfilment and payment.

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

**`index.njk` is synced by `bin/sync-share.sh`** — run it after any template change.
The script patches the four repo-specific values (permalink, activePage, CSS href, asset
paths) automatically and verifies the three HQ2 invariants on every run. Do not apply
manual sed patches to `refueler.io/src/share/index.njk` — the script owns that file.

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

**ADR:** `numo-fork/NUMO-PAY-A-ADR.md` and `refueler-io/docs/NUMO-PAY-A-ADR.md`

**Relay build state (CC-103):** BUILD SUCCESSFUL. Commit `54b15de`. Installed on Pixel 9a. Next: Web-Touch-1 → Icon-B (Relay app icon, Android only). S-numo-v31 (numo_navy refs) pending.

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

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| **TH-Opus-2 · 6 Sep 2026** | all repos | **Tower Hill — Legend price locked. Cross-product entitlement architecture locked. Legend native verifier design locked. Pass timestamping pattern locked. Monument / ti-fectar introduced.** See §TH-Opus-2 decisions below. BRIDGE v8.0. |
| **TH-0 · 6 Sep 2026** | refueler-share | **OTS bundle spike — javascript-opentimestamps killed (601 KB gzipped, no fetch path). Hand-rolled approach confirmed GO.** Calendars reachable (2/2 from host; Cloudflare egress to confirm at TH-1 start). Committed-value construction: `SHA-256(blake3_root \|\| url_fragment_nonce)`. Share×Pass×Legend three-product proof-of-receipt primitive identified. BRIDGE v8.1. |
| **SW-Opus-1 · 7 Sep 2026** | all repos | **Platform API + white-label architecture locked.** Three-tier model (Citizen / Sovereign / API). Model B (platform credit pool). Rail model extended to API tier. MCP v1 tools locked. BOLT12 B9+ forward commitment. See §SW-Opus-1 decisions. BRIDGE v8.3. |
| **SW-Opus-2 · 7 Sep 2026** | all repos | **Unit economics, rate-card v1.0, GBP invoicing policy, credit blocks, margin model, treasury policy, Sovereign Teams structure, GTM reframe, rate-card notification wording.** See §SW-Opus-2 decisions. BRIDGE v8.4. |
| **SW-Opus-3 · 7 Sep 2026** | all repos | **Identity-API access fee locked (£99 flat / £249 Professional defined-not-built). DPA mandatory by default. GDPR framing narrowed. AM role defined. Four-surface pre-payment disclosure wording locked.** See §SW-Opus-3 decisions. BRIDGE v8.5. |
| **SW4-Opus · 8 Sep 2026** | all repos | **Webhook signing key architecture locked. Option B (stateless HMAC derivation) chosen. `WEBHOOK_SIGNING_MASTER_KEY` new Worker secret. `whsec_hash` removed from `wh_config_` KV schema. Dead-letter schema locked. SW4-patch required before SW4a. SW5-Opus gate: receipt verifier audience decision mandatory before SW5 builds.** See §SW4-Opus decisions. BRIDGE v8.8. |
| **Share-127 · 8 Sep 2026** | refueler-share | **NUT-22/NUT-24 Teams open items scoped. NUT-22 clear-auth = net-new infrastructure; scope in own Opus before any Teams block. NUT-24-alone may enter SW scope on anonymous API rail — decide at SW-scoping session. Full decisions: `nut22-nut24-two-header-decisions.md`.** BRIDGE v8.6. |
| **Pass-Vocab-2 · 8 Sep 2026** | refueler-pass (vocabulary) | **Westminster vocabulary lock — five locations: St James's Square (organiser set / keyholder privacy), The Citadel (Deed / cold-storage recovery), Admiralty Arch (NUT-11 presentation threshold / tier gate), Buxton Memorial Fountain (architectural abolition of surveillance category / compulsion argument), Supreme Court UK (independent verifier / Legend separation / Miller II × Raven canary). Trinity House confirmed Share geography. All five: whitepaper + closed-door only.** BRIDGE v8.7. |
| **SW5-Opus · 9 Sep 2026** | all repos | **Receipt verifier architecture locked. Symmetric HMAC chosen over Ed25519 — asymmetric evidence stays with OTS/Legend. Per-product master key, namespaced domain tag convention (`refueler.{product}.{artefact}.v{n}`) adopted as ecosystem-wide signing standard. Receipt schema locked: `receipt_type: "acceptance"\|"collection"`, `event: "cargo.accepted"\|"cargo.discharged"`. Detached `sig`, no replay window. `cargo.in_bond` reserved-not-built for Execution Dock / Three Tides 48h grace. South-bank geography reserved: Greenwich Observatory (authoritative time / timestamping primitive), The Clink (compulsion surface / Liberty-that-is-a-gaol), Deptford (shipbuilder's yard / API + white-label build layer). London Stone on Cannon Street reserved (the civic anchor / the record that survived). See §SW5-Opus decisions.** BRIDGE v8.9. |
| **SW7-Opus · 10 Sep 2026** | refueler-share | **Per-client onboarding runbook locked. AM runbook: in-repo sanitised template (`ONBOARDING-RUNBOOK.md`), off-repo per-client instances. Disclosure email wording finalised (both rails); `[recovery credential]` → "Deed" (anon) / omitted (anon-API no-Deed policy); `[anonymous standing-receive]` → "anonymous standing-receive inboxes". Rail gate: Worker-enforced by credential type + explicit `rail: "identity"` KV field; no mutation endpoint; change = re-onboarding. Physical credential delivery: wax seal, company stationery, monospace 8-char grouped keys + BLAKE3 fingerprint + QR; identity rail only. Anonymous-rail key delivery: client self-provisions from dashboard (v2); v1 physical delivery. No Deed for anonymous-API clients — credential is the key, rotation (`POST /api/v1/keys/rotate`, 24h grace) is the recovery mechanism for compromise; total loss = account loss, stated plainly. Smoke test: `refueler-smoke.txt` provided, synthetic cargo only; sandbox non-anonymous advisory formalised. MCP manifest locked: 3 v1 tools (`refueler_capabilities` / `refueler_send_file` / `refueler_check_transfer`); `refueler_quote` folded into `refueler_capabilities` response; standalone `refueler_quote` / `refueler_balance` deferred to B9+ (BOLT12 agent payment). Three-audience doc structure locked (principal / IT / agent). Ciphertext-only invariant restated. Surface/suppress field lists locked. `rfs_test_` credentials sufficient for sandbox MCP — no dedicated MCP test mode; `refueler_capabilities` returns `environment: "sandbox"` as guard. Client operational security template added for anonymous-rail clients without existing key management procedure. Transition flow (identity → anon): planned capability, build when SD ships; 60-day receive-only grace, billing stops day 0 of wind-down, no new uploads, anon rail live from day 1; documented in runbook as planned-capability section. Silent Drop confirmed anonymous rail only. Grace-period billing corrected: identity billing stops on declaration date, wind-down window at no charge. Four security gaps closed: one-time secret delivery via dashboard show-once; sandbox non-anonymous advisory; production keypair provenance; smoke test cargo policy. `refueler-smoke.txt` added to repo root. `DISCLOSURE-TEMPLATES.md` added to repo root. `MCP-MANIFEST.md` added to repo root.** BRIDGE v9.0. |

---

## Active action items (Rajesh)

- **[Lightning — ALL projects] LNbits on Hetzner CAX21 LOCKED.** Next: NB-2 (provision + phoenixd + Cloudflare Tunnel — refueler-share project).
- **[All products] Remove all Blink references** from merchant handover docs, Worker secrets, and config files. Replace `BLINK_API_KEY` / `BLINK_SHARE_API_KEY` with `LNBITS_URL` / `LNBITS_API_KEY`. Execute at NB-5 for refueler-io; at B7-S74 for Share Worker. Remaining: Worker secrets + `LIGHTNING_STATE_LABELS` display text in `dashboard.js` (update at B7-S74 when node live).
- **[Share] Run `bin/sync-share.sh`** after every edit to any shared frontend asset.
- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant).
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns (Ops wallet created at NB-3).
- Upgrade Supabase to Pro at first real merchant.
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume.
- Rotate Anthropic API key before csuite briefing reuse.
- Football-data.org API key held by Rajesh — ready for Events intelligence layer session.
- Commission rate planning conversation before first real merchant.
- **[Pass + Merchant] Geographic vocabulary — COMPLETE.** Pass-Vocab-1 + Merchant-Vocab-1 locked 1 Sep 2026. Pass-Vocab-2 locked 8 Sep 2026. Full Westminster vocabulary now in BRIDGE.
- **[Pass]** Solicitor briefing brief to draft before appointment.
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29 → Nutroot) before v2 build.
- **[All products]** Remove all Blink ops wallet references from merchant handover docs before first real merchant.
- **[Legend]** UC-9 Opus session — Recovery Coordination Layer. Load: CLAUDE.md · SESSIONS.md · MASTER.md · legend-use-cases.md.
- **[Legend] Create Stripe product/price objects for Legend: £50/mo + £480/yr** — at Legend subscription flow build session.
- **[Share] Add `LEGEND_ENTITLEMENT_PUBKEY` Worker secret** — at Legend cross-product entitlement build session (post-Legend subscription flow live).
- **[Share / AM] Accountant-arrival disclosure.** Add to identity-rail initial-call talking points and follow-up email: principal must declare rail before sharing payment details with accounts team. Fiat payment arriving after rail is locked does not flip the rail — but creates a paper trail pointing at an anonymous-intent service. Decision sequencing is the privacy protection.
- **[All products / Legend] Legend node costs.** When Legend infrastructure is scoped: attribute a share of node operating costs to Share and Pass, both of which depend on Legend for OTS verification and block queries. Accounting convention for margin model — resolve at Legend scoping Opus.
- **[Legend / pricing] Pleb-Bitcoiner design principle.** Free tier must be genuinely useful, not a nag screen. Sovereign tier priced for Bitcoin conviction, not compliance budget. API is where commercial weight sits. Lock formally at Legend planning session.
- **[Share] Engage solicitor for standard Art. 28 DPA addendum** before first identity-API client. Priority review items: §4 (no-uptime SLA) and §5 (DPA). Client-paper review (bespoke DPA) is a Professional-band service, not included at £99.
- **[Share vocabulary track] API/MCP whitepaper atom descriptors.** `refueler_capabilities` / `refueler_quote` / `refueler_balance` need London-register naming before B9 whitepaper. Not urgent — allocate at a naming session.

---

## Refueler brand vocabulary — London geography (locked AP-BRAND · 31 Aug 2026; extended Opus-3 + Opus-3b + Pass-Vocab-1 + Merchant-Vocab-1 + AP-10 + TH-Opus-2 + Pass-Vocab-2 + SW5-Opus)

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
| **Cargo** | The encrypted file bundle in transit. Used in API event names (`cargo.accepted` / `cargo.discharged` / `cargo.in_bond` reserved), webhook payloads, and developer docs. Not used in patient-facing or professional UI copy — use "documents" there. | Docs / API / webhooks |
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
| **The Monument — ti-fectar** | The Monument to the Great Fire of London (Candlewick / Bridge Ward boundary). Designed by Hooke, consultation by Wren. Simultaneously: a memorial, a zenith telescope, and a ward boundary marker — three functions, one structure, invisible to the casual observer. **Whitepaper / closed-door use only**: the platform metaphor for the Refueler ecosystem as a whole — four products, one coherent structure, each doing a different thing in plain sight. "The Monument was built to stand at a ward boundary, function as a scientific instrument, and serve as a memorial — simultaneously, invisibly. The Liberties were designed the same way." Pairs with the Pileus quote. Geography credit: Candlewick Ward = Merchant territory — the fire was a mercantile catastrophe, the rebuilding a mercantile act. The Monument belongs to the Exchange, not to Share. The Cibber frieze (Liberty holds the pileus) is already locked as whitepaper preamble. | Whitepaper §Four Liberties / platform structure · closed-door pitch — never product UI, never website copy |
| **St James's Square** | A private garden in the centre of Westminster, maintained for keyholders only — no announcement is made of who holds one. Surrounded by institutions dealing in intelligence and strategic analysis (Chatham House, The London Library, East India Club). The central garden is invisible to those without the key; so is the keyholder list. **Refueler mapping:** the organiser's credential set in Pass — who has been issued a Pass, who has not, is a decision made inside the garden. Presentation reveals nothing about the issuer or the other keyholders. "St James's Square does not announce its members. Neither does the Jewel Tower." Whitepaper §permission model; closed-door framing for enterprise Pass organiser set management. | Whitepaper / closed-door |
| **The Citadel (Horseguards Road)** | The WWII Admiralty bombproof communications bunker, completed 1941 — six-foot concrete walls, self-contained power and water, integrated with the Cabinet War Rooms by tunnel. Still operational (MOD). Covered in Boston ivy since construction: planted to soften its appearance, maintained ever since, quietly impenetrable on the most-walked route between Parliament and Trafalgar Square, unremarkable to almost everyone who passes it. **Refueler mapping:** the Deed and cold-storage recovery architecture. Designed to survive everything that destroys normal infrastructure — a server failure, a key compromise, a compulsion event. Printed on paper, held by you, outside any system that can be seized. "If everything else falls, the Deed holds." The Citadel is ivy-covered and unmarked. The Deed is a piece of paper. Both are hardened. Forward: The Citadel earns a professional-copy column entry once Pass is live and the Deed is explained to clients — the phrase does the work. | Whitepaper §recovery architecture / closed-door — never product UI |
| **Admiralty Arch** | The 1912 ceremonial gateway between The Mall and Trafalgar Square. Three arches: the central, largest arch is sealed except for State processions — it opens for the sovereign's passage and closes again. The left and right arches carry ordinary traffic. Hidden detail: a stone nose at nose-height in the right arch wall, placed by an unknown sculptor — widely understood as a joke on Napoleon, there since 1912, noticed by almost no one. **Refueler mapping:** the NUT-11 P2PK credential presentation threshold — the gate that opens for the right key and holds for any other. Citizen-tier passes through the side arches; the central arch is sealed to all but the Sovereign credential. The nose: a reminder that the architecture can contain a joke visible only to those who know to look. Reserve the nose for the whitepaper as a footnote — the kind of detail that rewards the careful reader. Whitepaper §permission model / credential verification. | Whitepaper / closed-door |
| **Buxton Memorial Fountain** | Gothic Revival drinking fountain, Victoria Tower Gardens, yards from the Houses of Parliament. Commissioned 1865 by Charles Buxton to commemorate the 1834 Slavery Abolition Act and the work of his father Thomas Fowell Buxton and William Wilberforce. Eight carved panels of British monarchs — the reigns in which successive liberties were established. The 1834 Act did not merely restrict the ownership of persons; it removed the legal category under which such ownership had been possible. Parliament passed the law here; the memorial stands here; the architecture the law created cannot be undone by passing another law, because the category has gone. **Refueler mapping:** the architectural abolition of the surveillance data category. Ecash does not merely make tracking harder — it removes the data structure that makes surveillance possible. Not privacy as policy (reversible); privacy as architecture (not reversible). The Deed, once issued, has no back door to legislate against. Pairs with Penn/Bushel's Case (conscience) in whitepaper §compulsion argument. | Whitepaper §compulsion / closed-door — never product UI |
| **Greenwich Observatory** | The Prime Meridian — the point from which the world agreed what time it is. Established 1675 by Charles II at Flamsteed's proposal; the 1884 International Meridian Conference fixed it as the world reference for longitude and time. Every time zone is an offset from this south-bank hilltop. **Refueler mapping:** the timestamping primitive's conceptual anchor — not the Tower Hill act of sealing (that is Share's territory), but the prior idea: authoritative time itself. "Before the seal, there must be a meridian." The Observatory is where the clock starts; the Tower is where it is applied. Whitepaper §timestamping / closed-door only. | Whitepaper / closed-door |
| **The Clink (Liberty of the Clink, Southwark)** | One of the ancient Liberties of Southwark — a jurisdiction outside the City's reach, on the south bank. Owned by the Bishops of Winchester, who licensed the stews (brothels) and maintained the Clink prison within the same Liberty. A Liberty that held a gaol: the most honest map of the compulsion problem. You are outside the City's walls; you are not beyond all reach. **Refueler mapping:** the single compulsion surface — KV pubkey revocation. Refueler holds the authorised pubkey set and could be compelled to modify it. It cannot impersonate a Harbourmaster or decrypt cargo, but it holds the one gate. "The Liberty of the Clink was a Liberty that held a prison. We state this plainly." Named in whitepaper §threat model only. Never in product copy. | Whitepaper / closed-door |
| **Deptford Royal Dockyard** | Henry VIII's royal dockyard, established 1513, where the ships of the English fleet were built — not where cargo moved. Drake was knighted aboard the Golden Hind here in 1581. The dockyard created the capacity to trade; the Pool moved the cargo. The shipbuilder's yard is upstream of the exchange. **Refueler mapping:** the API and white-label layer (the SW-block). API clients don't carry cargo — they build the instruments that do. "Deptford built the fleet. Refueler's API builds the fleet that carries your cargo." Closed-door / whitepaper §API architecture only. | Whitepaper / closed-door |
| **London Stone (Cannon Street, EC4)** | A limestone block, origin Roman (believed milliarium — the central marker from which all road distances across Britannia were measured), set into the wall of 111 Cannon Street. Mentioned since at least the 12th century. Survived the Great Fire and the Blitz. Jack Cade struck it with his staff in 1450 and declared himself Lord of the City. The stone does not move. Everything is measured from it. **Refueler mapping:** the civic anchor — the fixed reference point beneath all measurement. Paired with Cleopatra's Needle (the Needle predates the city; the Stone anchors it). Where the Needle says "permanence", the Stone says "origin." Together in whitepaper §permanence: two objects that neither the Fire nor the bombs moved. Closed-door / whitepaper only. | Whitepaper / closed-door |
| **Supreme Court UK** | Established 2009 in the former Middlesex Guildhall, Parliament Square. Separated from Parliament by the Constitutional Reform Act 2005 — previously the final court of appeal sat inside the House of Lords, meaning the legislature was also the highest judicial authority. The separation was architectural: one institution moved across the square. Justices wear suits, not wigs — ceremony does not confer authority; the reasoning does. The court cannot strike down primary legislation but can rule on the limits of executive power — as in Miller II, finding that prorogation to avoid Parliamentary scrutiny was unlawful. The architecture of the state resisted compulsion by the executive. **Refueler mapping:** Legend as the independent verifier. A verifier housed inside the product it verifies is no verifier. Legend is architecturally separated from Share (the issuer), as the Supreme Court is separated from Parliament (the lawmaker). Miller II maps to the Raven canary: an architectural signal that cannot be faked, and that the state cannot suppress without the absence itself becoming the signal. "Legend verifies what Share issued. They are separate by design — as all final arbiters must be." | Whitepaper §verifier architecture / closed-door |

---

## Vocabulary matrix (locked AP-ARCH · 31 Aug 2026; updated Pass-Vocab-1 + Merchant-Vocab-1 · 1 Sep 2026; AP-10 · 3 Sep 2026; TH-Opus-2 · 6 Sep 2026; Pass-Vocab-2 · 8 Sep 2026; SW5-Opus · 9 Sep 2026)

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
| **Monument / ti-fectar** | — | — | ✓ (platform structure metaphor — WP §Four Liberties) | ✓ (closed-door pitch) |
| St James's Square | — | — | ✓ (WP §permission model) | ✓ (organiser set — closed-door) |
| The Citadel (Horseguards Rd) | — | — | ✓ (WP §recovery architecture) | ✓ (Deed / cold-storage framing) |
| Admiralty Arch | — | — | ✓ (WP §permission model / credential verification) | ✓ (tier threshold — closed-door) |
| Buxton Memorial Fountain | — | — | ✓ (WP §compulsion argument) | ✓ (closed-door only) |
| Supreme Court UK | — | — | ✓ (WP §verifier architecture) | ✓ (closed-door) |
| Greenwich Observatory | — | — | ✓ (WP §timestamping — authoritative time) | ✓ (held — closed-door) |
| The Clink (Liberty of the Clink) | — | — | ✓ (WP §compulsion surface / §threat model) | ✓ (held — closed-door) |
| Deptford Royal Dockyard | — | — | ✓ (WP §API layer) | ✓ (held — closed-door) |
| London Stone (Cannon Street) | — | — | ✓ (WP §permanence / §anchoring) | ✓ (held — alongside Cleopatra's Needle) |

**Rule:** if a term is not in the Website/UI column, it does not appear on `refueler.io` outside of the whitepaper and notes articles. Harbourmaster, Quay, "a Pass", "a Note", and "Clearance" are the only geography/product terms that have passed the website test.

---

## Four Liberties — product mint map (fully locked)

| Liberty | Product | Mint | Rotation | Melt path |
|---|---|---|---|---|
| **Westminster** | Pass | Jewel Tower | Black Rod | Redemption |
| **Temple** | Legend | Guildhall | Silent Ceremony | No melt (access only) |
| **Royal Exchange** | Merchant | the Exchange | The Proclamation | Clearance |
| **Tower of London** | Share | Royal Mint | Ceremony of the Keys | No melt (access only) |

**Constitutional line (west to east):** Westminster *passes* laws → Temple *keeps the record* → the Exchange *issues Notes* → Notes *clear* at the Exchange → the Tower *moves the cargo*.

**The Monument** stands at the ward boundary between the Exchange and the Tower — it sees both. The platform metaphor, not a fifth Liberty.

---

## Templar prior art argument (locked AP-ARCH · 31 Aug 2026)

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
| **EIC as villain** | East India Company — the original surveillance-as-business-model. Extraterritorial jurisdiction, private army, monopoly on information as much as trade. Leadenhall Street (HQ) is five minutes north of the Tower. The four Liberties are where the monopoly's reach was limited. Named villain in whitepaper and closed-door pitch only — never product copy. | Whitepaper §compulsion / §historical. Closed-door pitch framing. |
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
| Temple | Real London liberty, letter-of-credit origin (Templar, c.1150), Temple Bar boundary | **Legend's home and the unowned Cashu headwater.** The spiritual home of Cashu and the neutral Templar prior-art origin — kept ownerless as a brand anchor so the origin story belongs to all four products, not one. Legend's mint takes a name from within this geography (Guildhall — locked). |
| Bank of England | Independent within the system, cannot be audited by Treasury, *the* central monetary authority | **The foil / antithesis** — the establishment monetary institution Refueler defines itself against. Whitepaper §monetary distinction only, handled with care. Never a mint. |
| Somerset House | National records, Revenue, cultural space | Held lightly — revenue association undermines privacy message |
| Fleet Street | Information channel, Temple Bar to Ludgate Hill, editors decided what ran | Editorial voice — notes articles, the /notes/ pipeline |
| Traitors Gate | Water gate entrance to the Tower. Prisoners arrived by barge timed to high tide. The gate opened at high water only — the tidal window was non-negotiable. One way in, no way back. Name retrospective — many who entered (More, Boleyn, Raleigh) were not traitors. | **Internal/whitepaper vocabulary for the Destroy after download feature and Tidal Window system.** Never in product-facing copy. "The Gate is the mechanism; the user is not the traitor." In closed-door pitch: "the email inbox was always a Traitors Gate." |
| Monument (Candlewick Ward) | Designed by Hooke, consultation by Wren. Cibber frieze: Liberty holds pileus. Masonic programme. Stands on Candlewick/Bridge Ward boundary. Height = distance to Pudding Lane. Ti-fectar: simultaneously memorial, zenith telescope, ward boundary marker. | **Merchant territory** (fire was mercantile catastrophe, rebuilding mercantile act). **Platform metaphor** for the ecosystem: four functions, one structure. Pileus quote locked for whitepaper. Never Share territory. Never a UI term. Whitepaper + closed-door only. |
| Execution Dock (Wapping foreshore) | Pirates hanged at the low water mark, left for Three Tides (~48h). Prisoners occupied the jurisdictional gap between land and maritime law. Last execution 1830. Captain Kidd, 1701. | **Execution Dock**: Harbourmaster dashboard card for uncollected-transfer queue. Three Tides = 48h grace. The word "Wapping" not used in copy (poor local reputation, means marshy place). |
| Three city-states | London (finance), Washington (military), Vatican (religion) | International scale — available when Refueler operates across jurisdictions. Whitepaper future work gesture only. |
| Mark Lane / Tower Hill station | Original 1884 Metropolitan District Railway station (renamed Tower Hill). Old terracotta surface building still visible at Tower Hill / Byward Street corner. New Tower Hill station opened 1967, ~100m west. Original tunnels' current use undocumented publicly. | Legend article: infrastructure persisting beneath the visible city. Urban exploration record exists but not verified. |
| **Greenwich Observatory** | The Prime Meridian — the point from which the world agreed what time it is. All longitude and all authoritative time reference from this single fixed point on the south bank. The Observatory is the source; the Tower does the stamping. **Reserved south-bank.** | Whitepaper §timestamping primitive. Not the Tower Hill act of sealing — the prior concept: authoritative time itself. "Before the seal, there must be a meridian." Closed-door / whitepaper only. |
| **The Clink (Liberty of the Clink, Southwark)** | The Liberty of the Clink was a real Liberty of Southwark — and it contained a prison. Owned by the Bishops of Winchester, who also licensed the brothels in the same Liberty. A jurisdiction that was simultaneously a Liberty and a gaol; the Bishop extracted rent from both. The Clink is a prison in a Liberty, on the south bank, outside the City's reach — and it is the one place in the Refueler geography where the state's reach does extend inward. **Reserved south-bank.** | Whitepaper §threat model / §compulsion surface. Maps to the single compulsion surface: KV pubkey revocation. Refueler holds it, could be compelled to modify it. "The Liberty of the Clink was a Liberty that held a prison. The one compulsion surface is named accordingly." Closed-door / whitepaper only. Never in product UI. |
| **Deptford Royal Dockyard** | Henry VIII's royal dockyard at Deptford, established 1513 — the yard where the ships of the English fleet were designed and built, not where cargo moved. Drake was knighted by Elizabeth I aboard the Golden Hind at Deptford, 1581. The dockyard built the vessels; the Pool of London moved the cargo. The shipbuilder's yard is where the capacity to trade was created, upstream of the exchange. **Reserved south-bank.** | Whitepaper §API and white-label layer. The SW-block in product geography — API clients don't carry cargo, they build the ships that do. "The dockyard at Deptford built the fleet. The API builds the instruments." Closed-door / whitepaper only. Not a product name. |
| **London Stone (Cannon Street, EC4)** | A limestone block now set into the wall of 111 Cannon Street — believed to be a milliarium, the Roman central marker from which distances across Britannia were measured. Mentioned in records since at least the 12th century. Survived the Great Fire; survived the Blitz. Jack Cade struck it with his staff in 1450 and declared himself "Lord of this City." The stone does not move. Distances are measured from it. It predates almost everything around it and has no moving parts. **Reserved south-bank adjacent (Cannon Street, north bank — but the south-bank session prompted it).** | Whitepaper §permanence / §anchoring primitive. Not the OTS seal (which proves *when*) — the prior concept: the fixed point from which everything else is measured. The civic anchor. "Before any transfer is measured, there must be a stone." Candidate: whitepaper preamble alongside Cleopatra's Needle (the two permanent, pre-civic, immovable reference objects in the London corpus). Closed-door / whitepaper only. |

---

## Silent Drop — architecture locked (S88 · 4 Sep 2026)

Full product decisions in BRIDGE §Silent Drop — product decisions (AP-BRAND). This section adds the architectural locks confirmed at S88.

### Intake layer
- **Opaque token per Quay.** Lighthouse URL carries a random opaque string. Worker maps it → KV inbox key internally. Sender sees nothing linkable. No stable identifier visible at any layer or any network position.
- **Cargo UUID isolation.** Cargo UUID generated separately at the Lighthouse layer — never reuse the upload credential UUID in any sender-visible response. Prevents UUID-correlation attack across layers.
- **Quota side-channel prevention.** `GET /inbox/{token}` returns a consistent response shape regardless of quota state. Quota errors deferred to upload attempt only — no 402 at intake check.

### KV schema (no Supabase — invariant)
- `quay_token_{opaque}` → `{ harbourmaster_id, quay_label, expiry, execution_dock, storage_used }`
- `cargo_{uuid}` → `{ quay_token, arrived_at, retrieved: false, expiry }` — UUID is Lighthouse-layer generated
- Quay index per Harbourmaster in KV. No Supabase row. No email. Ever.

### Deed (recovery sheet)
- One Deed per Harbourmaster. One BIP-39 12-word mnemonic. One keypair. Covers Locke + all Quays.
- Keypair and mnemonic generated from the same `crypto.getRandomValues()` call. Never Math.random(). Never separate entropy sources.
- UI name: "recovery sheet." Whitepaper vocabulary: "the Deed." Precedent: Tutamail printed recovery sheet (privacy-circle-familiar pattern).
- Stripe Sovereign users also receive a recovery sheet (parallel onboarding flow) — offline backup independent of Stripe's recovery path.
- No copy button. Confirm checkbox before proceeding.

### Quay dashboard design principle (locked S88)
Primary Quay (first created): long expiry, Execution Dock off by default, visual anchor in dashboard.
Ad-hoc Quays 2–10: 30-day expiry, Execution Dock on by default.
Defaults teach the mental model (permanent intake + disposable per-case Quays) without explanatory copy. Storage bar per-Quay + total shown on login. Storage reclaimed shown on Execution Dock close.

### Compulsion surface (whitepaper §threat model)
KV authorised pubkey set is the one compulsion surface: Refueler holds it, could be compelled to modify it, cannot impersonate a Harbourmaster. State explicitly in Share Raven and in whitepaper §threat model. Not in product copy.

### Notification at SD launch
Polling (professional users) + Business webhook (`cargo.accepted` / `cargo.discharged`, `rfs_whsec_` signed, receipt schema per SW5-Opus). SimpleX stub card in Harbourmaster dashboard, greyed, "available at B9." SimpleX arrives at B9 (Instance C).

### Payment-layer threat model (confirmed S88)

| Layer | State | Whitepaper treatment |
|---|---|---|
| Application | Fully blinded — opaque tokens, UUID isolation, no metadata | State as product claim |
| Payment | Subscription decouples from cargo. One payment/period. Amount = tier, not file size. | State explicitly as privacy property |
| Network | Mullvad multi-hop recommended | B9 copy |
| Payment graph | Pseudonymous — node-level observer sees payment arrived | BOLT12 blinded paths — §Future work |
| PTLCs | Inherit when phoenixd/LND supports — no build session | B9 whitepaper §Future work, one sentence |
| Payjoin v2 | Liquidation sweep ops note (Sparrow native) — not a product feature | NB-4 ops runbook |
| Submarine swaps | Not applicable to Share payment layer | Flagged for Pass liquidation privacy post-B9 |

### SD-block launch gate
Friend-group soft launch: founder + 2–3 close contacts, 7-day observation window, before public Sovereign access. Mid-block privacy + security audit at SD4b. Final audit at SD7a. Both mandatory, not optional.

---

## Refill — homescreen design principle (noted S88)

**Concept (not yet locked — hold for Refill app scoping session):** Four equal rectangles on the Refill homescreen — Pass, Legend, Share, Refill. Products illuminate as they ship; unbuilt ones are visually present but dimmed (lower contrast, not hidden, not "coming soon" badged). User sees the shape of the whole ecosystem from day one. As each product ships, it comes alive.

This is a stronger story than revealing products sequentially — it tells the user they are early. Carry as a founding constraint into the Refill app scoping session. Do not impose on SD-block or any current build sessions.

---

## SW-Opus-1 decisions — locked 7 Sep 2026

### Platform model

**Three tiers: Citizen / Sovereign / API.** Business and Enterprise demolished entirely. API tier IS the business tier — no separate label.

**Sovereign** ships in two SKUs:
- **Sovereign** — single-seat, UI-only, no API.
- **Sovereign Teams** — N-seat, shared pool, one bill, UI-only, no API. Build: SW-Teams-1 (cross-product Opus in `refueler.io` project — not a Share-only session).

**API ⊃ UI** (one-directional): API key holder may also use the web interface. **Sovereign ⊅ API**: Sovereign subscribers never get API access.

**API tier is invoiceable** — preserves PO/invoice path for firms that cannot pay by card or Lightning.

### Rail model extended to API tier

Identity rail (Stripe/invoice) and anonymous rail (Lightning/prepaid sats) are mutually exclusive per credential relationship — same physics as the consumer tier split.

- **Identity rail:** recoverable credentials, invoice, DPA, accounts-payable-friendly. No identity-free features. No anonymous Silent Drop provisioning.
- **Anonymous rail:** unlocks Silent Drop provisioning and anonymous machine-to-machine primitives. No recovery beyond the Deed, no invoice (an invoice is an identity artefact).
- **Rail is declared by the client's principal at onboarding** — not inferred from how payment happened. Payment habit can never silently reconfigure the product.
- **DO NOT add Supabase row or email field to anonymous-rail API credentials** — same invariant as Lightning consumer path.

**Mandatory pre-payment disclosure** of both irreversibles (aimed at principal, before AP handoff): identity rail forecloses identity-free features; anonymous rail has no recovery and prepaid balance loss is permanent. Disclosure appears in: user agreement, initial call/meeting, email, and website — four surfaces.

### Pricing model

**Model B (platform credit pool).** Models A and C rejected — neither survives the anonymous rail.

**Two substrates, one rate card:**
- Identity rail: server-held recovering ledger, auditable, invoiceable, optional itemised view.
- Anonymous rail: client-held bearer Cashu credit tokens (blind-signed, unlinkable, non-recoverable). Balance is a stack of ecash — not a server record. Losing the token stack = losing the balance, permanently.

**Rate card versioned** (v1.0, v1.1…): action → sat cost per product. Product cost rises → new rate-card version for that product only; credit value unchanged.

**Term protection is an identity-rail feature.** Annual prepay locked at purchase-version for 12 months; monthly gets 30 days' notice. Anonymous rail: current rate card always.

### API features — v1 (buildable on current stack, ships in SW block)

- `GET /api/v1/capabilities` — tier, rail, feature set, current rate-card version. Build first.
- OTS-confirmation webhook — fires on `timestamp_state: pending → complete`. HMAC-signed via `rfs_whsec_` (Option B derivation — see §SW4-Opus decisions). Signing construction locked SW4-Opus.
- Acceptance receipts + collection receipts. **"Proof of delivery" retired as a phrase — unprovable, never claim it.**

### API features — v2 (each with explicit gate)

| Feature | Gate |
|---|---|
| Silent Drop provisioning via API | SD-block shipped (Hetzner) |
| Agent-to-agent transfers | SD provisioning live |
| Verifiable agent identity (NUT-11 Mode 2) | B8 — `bind_pubkey` field reserved in voucher now |
| Batch credential issuance | Pass API (Q4) |
| Composable receipts | v1 if free off credit-token work, else v2 |

### API features — forward commitments (document, do not build)

**Policy-encoded transfers** via the Nutroot three-product flow (gates: Nutroot PR #421 merge + B8 + Pass + B12). There is no honest Worker-side version — the Worker never holds keys. The policy is encoded in Pass Nutroot leaves, Legend verifies the block condition, the leaf satisfies. Document; do not fake.

**Transfer chaining:** research direction. Not committed.

### MCP v1 tool list

| Tool | Purpose | Status |
|---|---|---|
| `refueler_capabilities` | Capability discovery — first call any agent makes | v1, build when API ships |
| `refueler_send_file` | Encrypt and upload — runs in agent's trust domain, ciphertext only | v1 |
| `refueler_check_transfer` | Poll transfer status | v1 |
| `refueler_quote` | Action cost + current balance | v1 |

Remaining tools (inbox, timestamp verify, Pass issuance, Legend query) locked as contracts; each ships the day its backing product comes online.

**MCP architectural constraint (invariant):** MCP server runs in the agent's trust domain and handles ciphertext only. Never a Refueler-hosted plaintext endpoint.

**Whitepaper naming:** `refueler_capabilities`, `refueler_quote`/`refueler_balance` need London-register atom descriptors. Vocabulary track item — not urgent.

### BOLT12 / MCP agent payment — B9+ forward commitment

phoenixd already supports BOLT12 — no new infrastructure. SW constraints that must not foreclose this:
1. Credit-issuance contract accepts arbitrary-amount pay-then-mint (not blocks-only).
2. MCP response envelope can carry `payment_required` + offer field without breaking change.

### Sandbox spec

Credential-limited, no time cap. Model-B test-credits; both rails walkable with real HMAC. `rfs_test_`-prefixed keys (never `rfs_live_` or `rfs_sign_` in test files — GitHub scanner). Non-anonymous by design (observable for debugging) — "do not send real cargo to the sandbox" stated plainly in the sandbox itself.

---

## SW-Opus-2 decisions — locked 7 Sep 2026

### Rate card v1.0

| Action | Product | Sat cost |
|---|---|---|
| File transfer — base | Share | 10 / transfer |
| File transfer — volume | Share | +100 / GB |
| Permanent record (OTS anchor) | Share | 20 / transfer |
| OTS confirmation webhook | Share | 0 (bundled — never gate a notification on a transfer already paid for) |
| Legend private query | Legend | 10 / lookup |
| Pass credential issuance | Pass | 50 / credential |
| Capability discovery (`GET /capabilities`) | All | 0 (free — discovery must never be gated) |

**Reference peg:** v1.0 issued at £50k BTC reference. Stated on the rate card.

**Rate-card governance (locked):**
- Mandatory review when 30-day trailing average BTC/GBP crosses a checkpoint.
- First review trigger: **£100k BTC**. Subsequent: each doubling (£200k, £400k…) or halving (£30k, £20k…).
- At review: if the GBP-equivalent of flagship actions has drifted >±40% from the issue-date band, publish a new version.
- Direction of drift determines direction of revision: BTC appreciation → sat cost cut (credit stretches further, early holders rewarded); BTC crash → sat cost rise (abuse friction maintained).
- Rate-card re-versioning does **not** break the anonymous rail's "no term lock" rule — current card always applies. Identity-rail term-locked clients are unaffected until their term expires.

### GBP invoicing on identity rail

Sat costs are the internal accounting unit. The GBP figure on an identity-rail invoice is derived once, at rate-card-version publication, using a fixed reference rate Refueler sets — never live spot. The client never sees a sat figure and never carries BTC volatility. Annual terms lock that GBP figure for 12 months; monthly gets 30 days' notice. This is costless to give: all identity-rail costs are GBP, all identity-rail revenue is GBP, no conversion exposure exists.

### Credit block sizes (anonymous rail)

**Contract:** accepts arbitrary-amount pay-then-mint above a 10,000-sat dust floor. BOLT12 forward-commitment invariant — blocks cannot be enforced in the contract.
**Dust floor:** 10,000 sats minimum top-up. Applies to top-up only, not per-action spend.
**v1 UI presets:** 10k · 50k · 200k sats + Custom (≥10k). Arbitrary amounts accepted.

### Margin model

Identity-rail API tier: **access fee of £99/mo minimum** (covers DPA, invoice, AM relationship, support overhead), with metered usage layered above. Metered-only is not viable for identity-rail — usage at typical law-firm/clinic volume (£10–15/mo metered) cannot sustain the commercial relationship. Access fee is the real revenue; metering captures genuine heavy users.

Anonymous rail: pure prepaid-metered, no access fee, no relationship by design.

**Contribution margin estimates (£40/mo fixed platform cost):**
- 10 identity-rail API @ £99 access + light metered: ~£1,030/mo
- 50 anonymous-rail API @ ~£25 credit avg: ~£1,190/mo
- 100 Sovereign single-seat @ £24: ~£2,300/mo

**Break-even:** Hetzner = one anonymous top-up. All fixed costs = two Sovereign subs.
**First meaningful milestone: £1k MRR** (~40 Sovereign subs or 10 identity-API clients).

### Treasury / volatility policy (locked)

- Identity rail → GBP in, GBP costs out. No conversion, no exposure.
- Anonymous rail + Lightning Sovereign → sats held in phoenixd, swept to cold storage (Sparrow, Payjoin v2) only when balance exceeds ops reserve.
- GBP revenue (even 2 Sovereign subs) covers all GBP platform costs — never liquidate sats to pay opex.
- Each sweep = CGT disposal event under current UK treatment. Review with crypto accountant regularly.
- No fixed sweep %, no mandatory liquidation schedule. Sweeps are treasury moves only.

### Sovereign Teams — structure locked, build deferred to cross-product Opus

**Storage:** shared 100 GB pool per firm (not per-seat). Storage packs sold separately for genuine volume.
**Seat definition:** one Locke keypair + one Sovereign entitlement per seat, all under one firm Stripe customer. Flat seats under one firm account for v1.
**Pricing bands (UI-only, no API):**

| SKU | Seats | Price/mo | Effective/seat |
|---|---|---|---|
| Teams S | up to 5 | £49 | £9.80 |
| Teams M | up to 10 | £89 | £8.90 |
| Teams L | up to 20 | £169 | £8.45 |
| Beyond 20 | — | API / custom | — |

1/3/12 cadence at identical per-month rate (Mullvad rule holds). Annual benefit = term-lock, not discount.
**Stripe:** separate price objects per band (share-teams-s-monthly etc.), not a quantity field.
**Build session:** SW-Teams-1 — scoped in a **cross-product Opus in the `refueler.io` project**, not a Share-only session. Seat/delegation is a cross-product primitive (same shape as Pass organiser → cohort, Merchant owner → staff tills, Legend firm → shared sub). Share Teams is its first consumer. Master-Locke-issues-sub-Lockes deferred to B12 (nutroot `threshold` leaves).

### GTM reframe — HNW + accountant

"Family office" (US term) dropped. UK reframe: **Bitcoin-native high-net-worth individuals and their accountants.** The accountant is both the sensitive-document counterparty and the warm-intro vector. Use case: "send this to my accountant privately" — one person's financial privacy end to end. Legend + Share bundle (£50/mo carries Share entitlement). Positioning stays closed-door — not on the website, not in the public whitepaper section. Outreach: warm intro only, via BHODL co-founder or Bitcoin-policy contacts. First outreach = a real Silent Drop link, not a deck.

### Rate-card update notification wording (locked)

**Identity rail** (user agreement, invoice, website, call):
> "Your pricing is fixed for the length of your term. Monthly plans receive at least 30 days' written notice of any rate-card change before it takes effect; annual plans are locked to the rate-card version in force on the day you subscribe, for the full twelve months."

**Anonymous rail** (credit-purchase surface — also discharges bearer/non-recoverable disclosure):
> "Top up your credit and spend as you go. It's held by you, not in a recoverable account. If you lose it, we can't refund it. Buy what you plan to use soon."

---

## SW-Opus-3 decisions — locked 7 Sep 2026

### Identity-API access fee

**Flat £99/month at launch.** Covers: named account contact; email support (business hours, async, best-effort — not a hotline); itemised dashboard access; DPA addendum (standard, default, not opt-in); capability discovery (free per rate card); OTS-confirmation webhook (free, bundled). One invoice line in normal operation. Metered sat usage is an abuse ceiling, not a billing mechanism — at v1.0 prices, realistic identity-rail clients (law firm, GP clinic) generate <£3/month metered equivalent; treat identity-rail revenue as access-fee-only for planning purposes.

**Professional £249/month** — defined, not built. Activates when a real client requests: priority support, custom webhook retry policy, additional AM time, or review of client's own bespoke DPA paper. No second Stripe object until a client pulls it into existence. Both prices subject to upward review as Legend node infrastructure costs are attributed across products.

**Invoicing cadence:** access fee monthly in advance + metered reconciliation on same invoice monthly in arrears. One invoice, two possible line items. Second line reads £0.00 for essentially all v1 clients.

**Annual rate-card lock:** identical per-month rate (Mullvad rule), 12-month rate-card version lock. Term protection is identity-rail feature; monthly gets 30 days' notice. Anonymous rail: current card always.

### DPA

**Mandatory by default for every identity-rail API client.** Not opt-in, not self-certified. Refueler provides a short standard Art. 28 addendum (controller-to-processor or processor-to-sub-processor depending on role). Signable via DocuSign or wet ink. Client-paper review (bespoke DPA) is a Professional-band service — not included at £99.

**Solicitor must draft standard addendum before first identity-API client.** Priority review items: §4 (no-uptime SLA) and §5 (DPA). Engage before first Business-tier client.

### GDPR framing — anonymous rail (narrowed from "outside GDPR")

> On the anonymous rail Refueler establishes no identity, no account, no email, and no database row for the client, and enters no controller-processor relationship — so no Art. 28 DPA counterparty exists and none is required. Refueler's only GDPR footprint on this rail is as controller of minimal service metadata (IP, file size, chunk count, timestamps) under its own privacy notice, on a legitimate-interest basis (security/abuse prevention), minimally retained. Users wanting to remove IP from that footprint tunnel their own VPN — the standing Mullvad recommendation.

Use this wording in the user agreement and whitepaper threat model. Not "outside UK GDPR."

### AM role

**Who:** Rajesh for first 3–6 months. Presented under founder's name — not dressed as a team. "Your account contact is the founder" is a trust feature for sensitive-data clients.

**Scope:** onboarding call; rail-declaration sign-off; DPA coordination; security-incident notification (AM is the named human who delivers breach notification); Raven canary explanation at onboarding (client understands absence = compromise); quarterly usage review; rate-card change notification.

**Out of scope explicitly:** uptime SLA, 24/7 availability. Async, business-hours, best-effort. Guards §4.

**In agreement:** AM function named ("each identity-API client has a named account contact"). Personal name delivered privately at onboarding — not on the public website.

### Pre-payment disclosure wording — locked (both rails, four surfaces)

Bracketed placeholders slot at SW7: `[recovery credential]` and `[anonymous standing-receive]`.
"Ecash" never appears in client-facing copy. Use: "signed digital tokens held by you."

#### Identity rail

**User agreement (legal register)**
> The identity rail provides a recoverable account, invoiced billing in pounds sterling, and a data-processing agreement. In exchange, it does not provide Refueler's identity-free capabilities, including [anonymous standing-receive] and anonymous machine-to-machine transfer, which by design require the absence of any account. The rail is declared once by the client's principal at onboarding and is not inferred from, or altered by, the method by which any invoice is subsequently settled.

**Website (public)**
> The identity rail gives you a recoverable account, an invoice, and a data-processing agreement — everything a firm's finance and compliance teams need. It cannot offer our identity-free features, which only exist where there is no account to recover.

**Initial call/meeting (talking points)**
> — If your accounts team will ever need to pay an invoice, the identity rail is the only rail that works for them — and it forecloses the anonymous features. Decide the rail before the accountant enters the picture, not after.
> — Identity rail = recovery, invoicing, DPA; you give up the identity-free features.
> — It's a one-way door set at onboarding. Nothing about how you pay later can change it.
> — Whoever pays the invoice mustn't be the one who decides the rail.

**Follow-up email**
> To confirm the point from our call: choosing the identity rail gives you a recoverable account, invoiced billing, and a DPA, and means you won't have access to our identity-free features (such as [anonymous standing-receive]). This is a deliberate one-way choice made by you at onboarding — it isn't set by how the invoice is later paid, so it's worth deciding it consciously now rather than letting a payment method decide it for you.
>
> One thing worth sorting before you share our details with your finance team: if they'll ever need to raise a purchase order or pay by bank transfer, the identity rail is the one that supports that — and it's worth knowing that choice forecloses the anonymous features. The rail is set at onboarding, not by how the first invoice gets paid. Better to have that conversation now than when accounts payable is already holding the bank details.

#### Anonymous rail

**User agreement (legal register)**
> The anonymous rail establishes no account, no identity record, and no invoiced relationship. Access depends solely on client-held credentials; there is no recovery mechanism beyond the [recovery credential] the client retains, and its loss is permanent. Prepaid balance is held by the client in the form of signed digital tokens — it is not a balance in a recoverable account held by Refueler, and its loss is an irreversible loss of that balance with no refund possible. The rail is declared once by the client's principal at onboarding.

**Website (public)**
> The anonymous rail has no account and no invoice — access and balance live only where you keep them. If you lose your credentials, there is no recovery and no refund, by design.

**Initial call/meeting (talking points)**
> — No account means no recovery: if you lose your [recovery credential], we cannot restore access — there's no back door, which is the point.
> — Your credit is held by you as digital tokens, not kept in an account with us; lose them and the balance is gone, no refund.
> — Buy credit you plan to use soon.
> — This rail unlocks the identity-free features; it's your choice, not your finance team's.

**Follow-up email**
> Confirming the two things we can't undo on the anonymous rail: there is no account, so if you lose your [recovery credential] we cannot recover your access; and your prepaid credit is held by you, not kept as a recoverable balance with us, so losing it is permanent and cannot be refunded. These aren't defects — they're the absence of the very records that would otherwise compromise your anonymity — but they mean the rail is worth choosing deliberately, and topping up only what you'll use soon.

### Sat economics — identity-rail planning principle (locked)

At rate-card v1.0 (£50k BTC reference peg): 1 sat = £0.00050. Metered usage for realistic identity-rail clients (law firm / GP clinic doing hundreds of transfers/month) generates <£3/month equivalent. **Plan identity-rail revenue as access-fee-only.** Sat allowance functions as an abuse ceiling, not a billing meter. Both rails have a 402 backstop: anonymous rail burns prepaid tokens; identity rail hits a generous sat ceiling with AM follow-up.

**Salary target reference (founder planning only):** £150k/yr (≈2.1 BTC at September 2026 price) requires approximately: 130 identity-API clients at £99, or 20 API + 300 Sovereign + 100 Legend subscriptions. 18–24 month target on conservative trajectory. Legend entitlement-includes-Share bundle is load-bearing in this model.

### SW build block — confirmed ready

No open architectural blockers for SW1–SW9. SW7 inputs (DPA wording, four-surface disclosure, rail-declaration gate) locked in this session. Sandbox spec (SW6) unchanged from SW-Opus-1. IT handover PDF session dropped by intent — folded into SW7 onboarding flow. SW-Teams-1 correctly scoped to refueler.io project as cross-product Opus — not part of SW1–SW9. SW1 prompt confirmed ready to run.

---

## SW4-Opus decisions — locked 8 Sep 2026

### Webhook signing key architecture

**Chosen: Option B — stateless HMAC derivation from master secret. No signing key material ever touches KV.**

Options evaluated: A (encrypt whsec in KV with master), B (derive statelessly), C (reuse rfs_sign_), D (verify endpoint). A rejected: persists secret-bearing ciphertext in a store treated as permanently compromised; graceful-rotation advantage applies only to precautionary rotation of a notification-only key — not worth the posture cost. C rejected: Worker never holds raw `rfs_sign_`; client-absent delivery and retry cannot sign — hard rejection. D rejected: is Option B with an unnecessary client-round-trip verification endpoint bolted on; no benefit, clear costs.

**Derivation:**
```
whsec = HMAC-SHA256(
  key     = WEBHOOK_SIGNING_MASTER_KEY,
  message = "refueler.webhook.v1" + "\n" + rfs_live_key + "\n" + created_at
)
```
Encoded base58, prefixed `rfs_whsec_`. Issued once at POST `/api/v1/webhook/register`. Re-derived statelessly at every SW4a delivery and SW4b cron retry. Never stored in any form. `created_at` (from `wh_config_` KV record) acts as rotation salt — `DELETE` → re-register produces a genuinely different whsec.

**New Worker secret:** `WEBHOOK_SIGNING_MASTER_KEY` (32 bytes hex, `wrangler secret put`). Rotation is fleet-disruptive (all clients must re-register) — generate strong, store in Cloudflare secrets, do not rotate without cause.

**`wh_config_` KV schema (final):**
- Active record (TTL 2y): `{ url, created_at, active: true }`
- Tombstone after DELETE (TTL 7d): `{ url, created_at, active: false, deleted_at }`
- `whsec_hash` field **removed** — no verification role under Option B.

**Outbound signing construction (locked):**
- Header: `X-Refueler-Signature: t={unix_secs},v1={hmac_hex}`
- Also: `X-Refueler-Event: {event_type}` · `X-Refueler-Delivery: {delivery_id}`
- Signed payload: `t + "." + raw_json_body`
- HMAC: `HMAC-SHA256(UTF-8(rfs_whsec_string), UTF-8(signed_payload))`
- Client replay window: reject if `abs(now - t) > 300s`, then constant-time compare

Deliberate divergence from `api_auth.js` canonical string (which hashes the body first): outbound webhook payloads are small server-controlled JSON; Stripe-compatible construction lets integrators use existing verifier libraries unmodified. Both constructions are correct for their context.

**Dead-letter KV record (SW4b):**
- Key: `wh_dlq_{delivery_id}` (random UUID — never keyed by client identity), TTL 7d
- Value: `{ live_key, created_at, url, event_type, delivery_id, payload (unsigned raw JSON), attempts, first_failed_at, next_retry_at }`
- Payload stored unsigned; re-signed with fresh `t` at each retry (keeps client's 300s window tight even on day-7 retry)
- `live_key` in KV value is a documented exception to SW2c (SW2c addressed KV key *names* and passive log leakage; values are opaque blobs, not indexed or logged; `rfs_live_` is the client's semi-public handle, not a secret)

**SW4-patch required before SW4a:** remove `whsec_hash` from KV writes in `webhook_reg.js`; replace random-whsec generation with Option B derivation; scrub 5 comment lines that say "BLAKE3" when code uses `sha256Hex`. Confirm zero live whsec recipients before patch lands.

**SW5-Opus gate: CLEARED (9 Sep 2026).** Receipt verifier audience decided — see §SW5-Opus decisions. SW5 build may proceed.

---

## SW5-Opus decisions — locked 9 Sep 2026

### Receipt verifier architecture

**Chosen: symmetric HMAC reusing `rfs_whsec_`. Ed25519 / published Worker key rejected.**

Ed25519 was rejected on three grounds: (1) asymmetric evidence is already provided by OTS/Legend (the chain + an architecturally-separated verifier) — a second independently-verifiable Refueler-signed primitive competes with that and muddies which artefact is the real evidence; (2) a publicly-checkable, non-repudiable collection receipt is a stronger claim than we can honestly make and smuggles back the banned "proof of delivery" framing in cryptographic dress; (3) it manufactures attestation surface hostile to the anonymous rail — a published Worker key signing collection events with recipient-associated metadata is worse for unlinkability than a private HMAC only the client can read.

Both rails (`rfs_whsec_` already held by anonymous-rail clients, derived identity-free) behave identically. No Supabase row. No PII in any receipt. Same invariant as the Lightning credential path — locked here permanently.

### Ecosystem-wide signing convention (all products)

**Standard:** symmetric HMAC, per-product master key, namespaced domain tag.

```
refueler.{product}.{artefact}.v{n}
```

Examples: `refueler.receipt.v1` (Share receipts) · `refueler.webhook.v1` (Share webhooks) · `refueler.pass.receipt.v1` (Pass, when built) · `refueler.legend.confirm.v1` (Legend, when built).

**Rule: no shared `WEBHOOK_SIGNING_MASTER_KEY` across products.** Each product Worker holds its own master. One product's key compromise cannot forge another product's signatures. Same discipline as the OTS relay — same stateless pattern, deployed per-product.

### Receipt signing construction

```
receipt_sig = HMAC-SHA256(
  key = UTF-8(rfs_whsec_string),
  msg = UTF-8("refueler.receipt.v1\n") || <raw bytes of the "receipt" member exactly as serialised>
)
```

- **Detached `sig` field.** No `t`. No replay window. The receipt is a keepsake the client re-checks months later, long after any webhook delivery window is dead.
- **Webhook envelope sig unchanged** (SW4a construction): `X-Refueler-Signature: t=…,v1=…` over `t + "." + raw_body`. Transport auth and receipt auth are separate concerns.
- **Stable across retries.** Receipt sig is computed once at issuance, stored in the DLQ payload unsigned (per SW4b pattern), re-delivered with the same sig on cron retry. Client dedup works on the sig. Envelope `t` changes per delivery; receipt `sig` never does.

### Receipt wire schema

**Acceptance receipt (`cargo.accepted`):**
```json
{
  "receipt": {
    "receipt_version": "refueler.receipt.v1",
    "receipt_type": "acceptance",
    "event": "cargo.accepted",
    "live_key": "rfs_live_…",
    "uuid": "…",
    "transfer_ref": "client-ref-or-null",
    "size_bytes": 0,
    "chunk_count": 0,
    "issued_at": 0,
    "accepted_at": 0,
    "expiry_timestamp": 0
  },
  "sig": "v1=<hmac_hex>"
}
```

**Collection receipt (`cargo.discharged`):**
```json
{
  "receipt": {
    "receipt_version": "refueler.receipt.v1",
    "receipt_type": "collection",
    "event": "cargo.discharged",
    "live_key": "rfs_live_…",
    "uuid": "…",
    "transfer_ref": "client-ref-or-null",
    "size_bytes": 0,
    "chunk_count": 0,
    "issued_at": 0,
    "collected_at": 0
  },
  "sig": "v1=<hmac_hex>"
}
```

### Field discipline (load-bearing)

- **No BLAKE3 root in any receipt.** Merkle root verification blocked until B9. `chunk_count` + `size_bytes` only. An acceptance receipt attests "we hold N chunks totalling B bytes" — never "the file is intact end-to-end."
- **No recipient metadata — ever.** No IP, no UA, nothing about who collected. A receipt goes to the sender; recipient metadata in it is a surveillance instrument. AE may log it; receipts never carry it.
- **Fires once.** Acceptance: at manifest-write transition (a 409 resume-of-complete does not re-emit). Collection: at first complete download co-located with `pending_destruction` transition — subsequent re-downloads emit nothing (re-download count is a behavioural side-channel back to the sender).

### Event vocabulary (wire events vs client nouns)

| Wire event | Client noun | Notes |
|---|---|---|
| `cargo.accepted` | "acceptance receipt" | Emitted at upload-complete / manifest-write |
| `cargo.discharged` | "collection receipt" | Emitted at first complete download / `pending_destruction` flip |
| `cargo.in_bond` | — | **Reserved-not-built.** Natural home: Execution Dock / Three Tides 48h grace — "in the warehouse, clock ticking." Credit-exhaustion-accept-then-hold rejected (abuse surface); refuse-at-door is the locked policy. Reserve the string; home decided at quota session. |

**"Discharged" not "collected":** describes only the Worker's action (released from the hold) — zero claim about who picked it up or whether a human ever saw it. Consistent with the honest-scope line. Legal double-meaning (a duty discharged) sits beside Locke and Deed.

**Honest-scope string (dev docs and SDK):** *"'Discharged' means the download endpoint served the complete object at this time. It does not identify who collected it, nor prove that any person received or opened the contents."*

### Build pattern (inherits SW4b discipline)

- `emitReceipt(env, ctx, …)` — live path, returns void, wired via `ctx.waitUntil`. Receipts are notification, never control flow.
- `buildSignedReceipt(env, fields)` — pure, returns signed receipt object. Used by authenticated `GET` pull endpoint, by `emitReceipt`, and by any future cron re-emit. Returns a value, no side-effects.
- Delivery reuses `wh_config_{apiKeyHash}` KV lookup for `url` + `created_at` (needed to re-derive `rfs_whsec_`). No new index. No new secret.

### Do-not-retry (SW5 additions)

- Never Ed25519, never a published Worker key for receipts
- Never Supabase row on the receipt path
- Never recipient metadata (IP, UA, network) in any receipt field
- Never re-emit a collection receipt on re-download — one emission per transfer
- Never omit `cargo.in_bond` string from the reserved-events list when adding future event types

---

## TH-Opus-2 decisions — locked 6 Sep 2026; pricing updated 6 Sep 2026

### Legend pricing (locked — starting price, will reprice upward before Legend goes live)

| Plan | Price | Notes |
|---|---|---|
| **Legend free** | £0 | Public block explorer surface. Private-query layer, native verifier, Share entitlement — all behind paywall. |
| **Legend paid (monthly)** | **£50/mo** | Private-query layer + native OTS verifier + Sovereign Share entitlement (100 GB, no API). |
| **Legend paid (annual)** | **£600/yr** | Twelve months at the monthly rate. No discount framing, no savings framing — this is the annual price. Per no-discount-ever rule. |

**Rationale (locked):** Legend priced as the senior product that includes Share, not Share with an explorer bolt-on. The private-query layer, native verifier, BOLT12 primitives (B9+), and OTS primitives (TH-series) justify significant daylight above Sovereign (£24/mo). £50/mo is a starting price — it will only increase as features are added before Legend goes live. Legend infrastructure (Hetzner node, full Bitcoin node, block scanning) carries real running costs that justify future price increases. Sovereign Share subscribers do not receive Legend access — the entitlement is one-directional only (Legend → Share).

### Cross-product entitlement architecture (locked)

**Model: one signed bearer voucher, two issuance triggers.**

When a Legend subscription settles (Stripe rail or Lightning rail), Legend issues a signed bearer entitlement voucher:

```json
{
  "product_origin": "legend",
  "tier": "sovereign",
  "cap_gb": 100,
  "api": false,
  "period_end": "<unix_timestamp>",
  "voucher_id": "<random>",
  "bind_pubkey": null,
  "sig": "<Legend issuer secp256k1 signature>"
}
```

**Share-side acceptance (locked):**
- Worker secret: `LEGEND_ENTITLEMENT_PUBKEY` — Legend's issuer public key.
- At Share credential-issue path: verify sig against `LEGEND_ENTITLEMENT_PUBKEY`, check `period_end > now()`, check `product_origin === 'legend'`.
- **Hard clamp regardless of voucher fields:** any voucher with `product_origin: 'legend'` is clamped to 100 GB cap and `api: false` on the Share side. A buggy or compromised Legend issuer cannot escalate to Business/API tier by signing a rogue voucher. Defence in depth.
- On valid voucher: mint Sovereign transfer credential exactly as Stripe/Lightning path — downstream flow unchanged.

**Rail-agnostic by design:**
- Stripe rail: Legend re-issues voucher on `customer.subscription.updated` / portal re-fetch.
- Lightning rail: credential stored in browser memory (same model as Share Lightning credentials). Deed recovery (B8 Locke) is the recovery path.
- Share implements one acceptance path — it does not know or care which rail Legend used.

**Identity invariant preserved:** voucher rides in browser memory only. No Supabase row. No email field. Load-bearing for Silent Drop — do not break.

**Blast radius mitigation:**
- Period-boxing: `period_end` is the hard expiry. A leaked voucher has one billing cycle of blast radius at most.
- Future binding (B8): once Locke / NUT-11 Mode 2 exists, the voucher grows its `bind_pubkey` field — token becomes useless without the keypair. Format carries the field now (null) to avoid a breaking format change at B8. Do not implement binding in the current build.

**No per-voucher byte counter:** this reintroduces transfer-linkability. Accepted trade-off: one billing cycle of theoretical sharing for a privacy-preserving credential model.

**Build dependency:** Legend must have a subscription flow before the Share-side acceptor has anything to accept. Format and clamp are locked now and buildable in Share independently. The acceptor is dormant until `LEGEND_ENTITLEMENT_PUBKEY` is set as a Worker secret.

**Rotation:** Legend issuer key rotation follows the same discipline as API key rotation — `POST /api/v1/keys/rotate` equivalent, 24h grace window. Share Worker secret updated at rotation.

### Legend native verifier design (locked)

**Principle:** verification is client-side in Legend throughout — the file never leaves the browser at any step.

**Verification flow (post-TH-1):**
1. Recipient imports three items from the downloaded bundle: the decrypted file (or content hash), the nonce, and the raw `.ots` proof.
2. Legend recomputes the committed value (nonced SHA-256 digest — exact construction locked at TH-0/TH-1).
3. Parses the `.ots` Merkle path to the Bitcoin attestation.
4. Confirms the attested block against **Legend's own block data** — no third-party explorer, no public calendar server call at this step.
5. Reports: *"These exact bytes existed on or before block [N] — [date]. Verified against Legend. This does not prove authorship, delivery, or that the contents are true."* Honest scope stated in UI, every time.

**Two states:**
- **Complete:** block seal shown as above.
- **Pending:** *"Submitted [time], awaiting Bitcoin confirmation — typically a few hours."* Upgrade offered through Legend's own blind relay (same `/timestamp/upgrade` opaque-byte pattern as Share Worker) — never by having the browser hit a public calendar directly.

**Share surface:** on a transfer carrying a date seal, the download UI shows *"Verify this date seal in Legend →"*. Handoff is manual — recipient downloads bundle and imports into Legend. No automatic cross-product file transmission. Manual handoff keeps bytes local.

**No verify view in Share v1.** Legend is the sole verifier at launch.

### Pass credential issuance timestamping (locked)

**What gets stamped (locked):**
- **Keyset / epoch seal (default for events):** Pass seals a commitment to the issuance keyset when a batch is minted. Keyset public keys are already public (NUT-01/02) — zero privacy loss, scale-free. Proves every credential in the batch existed by date Y. One seal per batch, not per holder.
- **Per-credential seal (opt-in, high-value one-offs):** for single authorisations, estate documents, board resolutions issued as Pass credentials — mirrors Share's per-transfer Sovereign opt-in exactly.

**Legend verifies Pass seals** using the same flow as Share seals. Westminster issues, Temple verifies, Tower stamps — one verifier, three sources.

**OTS relay architecture (locked):**
- **Product-agnostic relay, deployed per-product.** Each product's Worker carries its own `/timestamp/submit` + `/timestamp/upgrade`. Share's relay and Pass's relay are separate deployments of the same stateless pattern.
- The relay sees only opaque nonced 32-byte SHA-256 digests — cannot distinguish a Share digest from a Pass one by design.
- No runtime cross-product relay calls. Products remain independently deployable.
- Build once in Share (TH-1), document the pattern, propagate to Pass Worker at Pass timestamp build session.

### Composes with Nutroot (forward note)

The keyset epoch seal composes naturally with Nutroot (NUT-10 v3 PR #421): timestamping an epoch seals *when the spending conditions were fixed*, making them un-backdatable. Design to compose when Nutroot ships — do not take a dependency on it.

---

## Share × Pass × Legend — Nutroot hashlock forward note (TH-0 · 6 Sep 2026)

**Status: not a build item. B8/B12 territory, gates on Nutroot PR #421 merge + NUT-11 Mode 2 live.**

The OTS committed value chosen at TH-1 — `SHA-256(blake3_root || url_fragment_nonce)` — is structurally identical to a Nutroot `hashlock` leaf preimage. This is the correct design revealing itself from three directions: privacy (opaque to non-URL-holders), integrity (BLAKE3 root composes with OTS into one receipt), and interoperability (preimage shape matches Nutroot hashlock).

**The three-product proof-of-receipt flow:**

1. **Share** stamps the transfer: computes `commitment = SHA-256(blake3_root || url_fragment_nonce)`, submits to OTS calendar via Worker relay, stores pending `.ots` in R2. Also issues a Pass credential (Nutroot token) with two leaves:
   - `hashlock` leaf: lock = `SHA-256(commitment)`. Spendable only by whoever reveals `commitment` itself.
   - `after` leaf: minimum Bitcoin block height for confirmation (e.g. current tip + ~6 blocks ≈ 1 hour forward).

2. **Legend** verifies the OTS proof. When the Bitcoin block seal is confirmed, Legend has traversed the Merkle path from `commitment` to the attested block. It returns the `commitment` value to the credential holder (who already knows it — it's derived from their file + URL). The `hashlock` is satisfied. The `after` leaf is satisfied once the block height is met.

3. **Pass** accepts the credential with both leaves satisfied and executes whatever the policy specifies: unlock a document vault, release a payment, grant access, countersign a certificate. The Refill app surfaces the credential state to the holder — locked until Legend confirms, then unlocked.

**The concrete use case:** a barrister sends a settlement agreement via Share. The OTS proof is issued as a Pass credential with policy encoded in Nutroot leaves: binding only if the counterparty demonstrates receipt before the settlement deadline block height. No notary. No DocuSign. Verified against Bitcoin. Westminster passes it. Temple verifies it. The Tower stamped it. Three products, one flow, no intermediary.

**Why this matters for TH-1:** the committed value construction `SHA-256(blake3_root || url_fragment_nonce)` must not be changed after TH-1 without re-evaluating this entire flow. The construction is load-bearing for all three products.

**Build dependency chain:** TH-1 locks the preimage shape → B8 builds NUT-11 Mode 2 (Locke) → Pass planning session (Q4 2026) designs Nutroot credential with hashlock using this preimage shape → B12 builds FROST + Nutroot → three-product flow becomes operational.

**Whitepaper treatment (B9):** §Future work. One paragraph. Do not claim it is built. State the primitive and the dependency chain honestly.

**Do not raise this in Pass planning session without first confirming Nutroot PR #421 status.** If Nutroot has not merged by Q4 Pass planning, the hashlock leaf is theoretical — note it, do not design around it.

---

## Locke — credential-as-key design (locked AP-ARCH · 31 Aug 2026)

**Locke is the name of the mechanism and the object** — the credential that unlocks the Harbourmaster dashboard. NUT-11 Mode 2 P2PK in its full form (B8). The name is operational: it is a Locke (not a lock), and it is a Locke (John, philosopher of consent — "no one can be put out of his estate, and subjected to the political power of another, without his own consent"). Both readings are correct.

**Locke lifecycle:**
- **Issued:** at Harbourmaster onboarding. One Lightning payment → one Deed (BIP-39 mnemonic) → one Locke (secp256k1 keypair, secure enclave storage on device).
- **Presented:** at every Harbourmaster login. Challenge-response (NUT-11 Mode 2). No password. No email.
- **Rotated:** on device change, Deed recovery, or voluntary rotation. Old Locke retired; new Locke authorised against the KV pubkey set.
- **Revoked:** Refueler can remove a pubkey from the KV authorised set — this is the one compulsion surface. Cannot impersonate a Harbourmaster. Cannot decrypt cargo. The cargo key is in the URL fragment, which Refueler never sees.

**Multi-device:** account holds a set of authorised pubkeys. Each device holds its own Locke. Add a device: present valid existing Locke, authorise new pubkey, mint new Locke. Remove: drop pubkey from set.

**Recovery:** Primary — the Deed (recovery Locke, offline keypair, generated at onboarding). Firm path — FROST social recovery (B12). Informed cliff: loss of all devices without the Deed = loss of access. Stated plainly at onboarding.

**Key storage exception:** Locke private keys stored in platform passkey / secure enclave. Documented exception to credentials-in-browser-memory-only rule. Applies to Locke only.

**Locke is separate from the subscription credential.** Subscription = entitlement. Locke = access. Two separate objects from one payment event.

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
**CDK 0.18.0 released (Sep 2026).** Key changes relevant to Refueler: (1) `cdk-lnbits` first-class backend removed — no impact, Worker calls LNbits REST directly and does not use CDK as a payment backend. (2) NUT-12 deterministic DLEQ nonces landed with test vectors — favourable for B8 NUT-11 Mode 2. (3) NUT-20 deterministic quote signing keys — note for B8/B9 whitepaper. (4) NUT-25 BOLT12 offer descriptions landed — our B9+ forward commitment is now in a stable CDK release. (5) Mint private-key containers (`MintKeys`, `MintKeyPair`, `MintKeySet`) no longer implement `Serialize` — good security hardening, no impact on Worker-side usage. CDK pin remains 0.17.2 until B8 scoping session decides upgrade path.

---

### PR #421 — NUT-10: Nutroot secrets (v3 keysets)
**Author:** robwoodgate · **Status:** Open, stacked on #371 · **CDK PR:** cdk#2433 (POC)

Gives Cashu tokens programmable spending conditions expressed as a Taproot-inspired Merkle tree of declarative condition leaves. Named **nutroot** (not taproot — commits structure only, none of Bitcoin's validation rules). Three leaf types: `threshold` (M-of-N), `after` (timelock), `hashlock`. No opcodes, no stack, no interpreter. Tree shape is deterministic from leaf count. Every v3 input signs a shared transaction transcript enabling atomic batch operations.

**Critical scoping:** NUT-11 and NUT-14 are explicitly scoped to pre-v3 keysets. NUT-22 and NUT-11 Mode 2 are NOT interchangeable — they solve orthogonal problems. Mode 2 (P2PK keypair-binding): "only the holder of key K can spend this credential" — anti-theft, delegation, the Locke object, receiver-bound Silent Drop collection; keep on B8 slate. NUT-22 (blind authentication): "only a member of the authorised set, and I cannot tell which" — membership gating with in-set anonymity; Teams/Legend/Pass capability, ~B10. The transcript-signing property referenced in earlier notes belongs to nutroot v3 batch operations, not to NUT-22 BATs as specified. (Correction locked Share-127.)

**Cross-product impact:**

| Product | Application | Priority |
|---|---|---|
| **Pass** | `threshold` (M-of-N entry, e.g. VIP+standard), `after` (time-gated access windows), `hashlock` (QR redemption gate = reveal preimage). Atomic batch issuance for event cohorts via transaction transcript. Keyset epoch timestamping composes with nutroot: sealing *when the spending conditions were fixed* makes them un-backdatable. **Hashlock preimage candidate: `SHA-256(blake3_root \|\| url_fragment_nonce)` from Share OTS committed value — see §Share×Pass×Legend forward note.** | High — design Pass architecture around nutroot leaves, not custom logic |
| **Merchant** | NUT-18/26 delta: nutroot payment request option `(k, l, b)` in `creqB` under TLV `0x0b`. Conditional POS settlement (threshold: merchant confirm + customer spend; after: expiry). NUT-28 positional sender slots enable merchant attribution with customer privacy intact. | High — Note/Clearance model maps cleanly |
| **Share** | `threshold` leaves replace planned FROST complexity for B12 M-of-N credential issuance. `after` leaves are the native primitive for "recovery window / pay-to-extend" (B9 §Future work). NUT-22 does NOT supersede NUT-11 Mode 2 — orthogonal concerns (membership-anonymity vs keypair-binding); Mode 2 stays on B8 slate. NUT-24 (`u = "api"`, never `sat`) is the standardised form of Share's already-locked 402 backstop; regulatory hinge: `api` unit = capability redemption, `sat` unit = money transmission. NUT-24-alone may enter SW scope ahead of full Teams two-header combo — decide at SW-scoping session. Full decisions: `nut22-nut24-two-header-decisions.md` (Share-127). | Medium — NUT-11 Mode 1 unaffected |

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
