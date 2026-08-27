# REFUELER-BRIDGE.md — Refueler cross-project context
> **Version:** 5.1 | **Created:** 28 July 2026 | **Updated:** AD-HOC · 2026-08-27
> Lives in `refueler-share/` (root), `refueler-io/docs/`, `refueler-legend/` (root), `refueler-pass/` (root), and `numo-fork/` (root).
> This file is the handshake between Projects — not a substitute for repo-specific context files.
> Higher MasterContext version number always wins on divergence.

---

## What Refueler is

Refueler is a suite of Bitcoin-native privacy products built by Rajesh Taylor (solo founder, London). Operating within UK jurisdictional law. Not a fintech product. Not a loyalty app.

**Products:** Share (anonymous encrypted file transfer, live at `refueler.io/share/`) · Legend (privacy-first Bitcoin block explorer, post-B9) · Merchant terminal (Fenchurch St line cafés and restaurants — tablet, counter/kitchen, landscape) · **Relay** (`io.refueler.merchant`, formerly NumoPay fork — in-venue order entry, Android phone, floor/waiter staff, portrait) · Refueler Pass (Lightning-native ticketing and venue access — own repo + Claude project) · **Refill** (consumer app, React Native, Blink Lightning — commuter pre-orders + Legend + Pass)

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
- After any address change: AM or Rajesh sends 21 sats from Blink ops wallet to confirm receipt. Logged in crypto ops ledger.
- Rate limit: 5 attempts / 5 minutes per user (in-memory).

**Stamps:**
- Silent, passive issuance. Trigger: FULFILLED (READY status). `✦` glyph settles on tile.
- Plumbing-agnostic: same visual for LNURL-withdraw (v1) and Cashu NUT-00 (v2).
- Stamp metrics: reserved in Owner tab. Not built until Block 8 / post-mint.

---

## NumoPay fork — architecture decisions (NumoPay-A, CC-99)

**ADR:** `numo-fork/NUMO-PAY-A-ADR.md` and `refueler-io/docs/NUMO-PAY-A-ADR.md`

**Base:** cashubtc/Numo v1.8. **Package:** `io.refueler.merchant`. **Fork:** `rajesh-taylor/numo-fork`.
**Hardening phases 1–3:** complete. **Hard fork:** permanent — no merge path back to upstream.

**Governing decision (locked NumoPay-A):** NumoPay is a Supabase-backed order-entry terminal. It holds no funds and processes no payments of its own. The entire Cashu wallet ceremony, `CashuWalletManager`, `AutoWithdrawManager`, NFC HCE, and CDK dependency are deleted.

**CDK return condition:** Block 8 / Pass floor-device redemption only. Must pin to stable `cdk-android:0.17.2` matching `refueler-mint` (lock 4s). `-rc.1` must never ship to a real merchant device.

**Auth (locked):** Supabase magic link once (AM-assisted) → EncryptedSharedPreferences JWT → `verify-pin` v2 EF at shift-start → 30-min local grant. `FLAG_KEEP_SCREEN_ON`. No mid-shift re-auth. 12h JWT (43200s).

**Payment routing (locked):** Lightning walk-in → `create-order` EF → LNURL-pay to `venue_partners.lightning_address` → QR on device → Realtime poll for confirmation. Cash/card walk-in → record-only insert, `status: 'confirmed'` immediately. No Cashu melt.

**Item catalogue (locked):** `merchant_menu_items` via PostgREST, read-only on floor device. `BitcoinPriceWorker` retained for indicative GBP→sats display. Write side on tablet terminal / Menu Management v1.

**Noun/verb/handle (locked):** Order code (`RF-XXXX`) is the universal join key. `origin` field on `merchant_orders`: `'preorder'` (consumer app) · `'floor'` (NumoPay). DDL pending at NumoPay-B.

**Android theming (locked):** `Theme.Refueler` replaces `Theme.Numo`. Carbon always-on. Status colours protected: Pending `#C8A96E` · In Prep `#7899D4` · Ready `#3DCA7A`.

**Build sequence:** NumoPay-B (auth scaffold, CDK removal, theming) → NumoPay-C (catalogue, payment flows, history). Both Sonnet counted.

---

## Ops wallet — locked CC-98

**Blink ops wallet ("Refueler Ops"):** Second BTC wallet under same Blink account, separate from treasury (`fd2357fe`). Used exclusively for onboarding test payments, Lightning address confirmation (21-sat sends), and support call testing. Top-ups logged as business expense in Refueler Crypto Ops Ledger (sats + GBP equivalent at time of transfer).

**AM access model (current):** Rajesh holds wallet. AM requests top-up; Rajesh transfers internally (Blink → Blink, instant, no fee). AM never uses personal wallet for Refueler business.

**Long-term (Staff Management v1):** Separate Blink account for AM, small dedicated balance, funded by internal transfer. Ops wallet balance monitoring via dev console (add wallet ID to `blink-balance` EF) when volume justifies it.

**Single-provider risk:** Both wallets affected if Blink is down. Accepted for pre-merchant phase. Review at Block 8 planning when reward payouts are live in anger.

---

## Incident response — locked Sim-Close

**Protocol:** `INCIDENT-PROTOCOL.md` in `refueler-io/docs/`.
**Internal channel:** Signal. **External (merchants):** Tuta `hello@refueler.io`. **Public:** `refueler.io/status/` only.
**Core rule:** Internal → contain → public.

---

## Merchant handover documents — locked Design-A

Files in `refueler-io/docs/`: `merchant-onboarding-v1.html`, `merchant-venue-keys-v1.html`, `merchant-onboarding-process-v1.html`, `INCIDENT-PROTOCOL.md`.

**Docs ↔ UI sync rule (active):** confirm currency at every block close touching terminal UI.

**September User Guide update (flagged CC-98):**
- Add Lightning address change section: after any change, AM sends 21-sat confirmation from Blink ops wallet. Log in crypto ops ledger.
- Add anti-phishing panel: "Refueler will never send a link you didn't request."
- On-chain address changes are support-only (`[R]`).
- AM onboarding checklist: log 21-sat confirmation send in onboarding expense record.

---

## Sim-Close — DECLARED COMPLETE (2026-08-17)

Pre-merchant gate list:
- **G-1** ✅ CLEARED CC-97 — LNURL-pay, `create-order` v10.
- **G-2** (hard blocker): Menu Management v1. After TDP-C.
- **G-3**: iPad physical check. Before first real merchant.
- **G-4** ✅ Hardening-A — cleared CC-94.
- **G-5** ✅ S-26 FK — cleared CC-94.

---

## Legend — post-B9 scope additions (locked CC-103 planning · 20 Aug 2026)

**Legend is a block explorer. Not a charting tool, not a news aggregator, not a price terminal.** No live price charting in the UI. No news section. Every feature is tested against: does this help a user understand the chain privately, without logging, without a custodian?

**Verified estate report (v3) — contextual metrics pages added:**
The £150 full report gains a contextual section generated at report creation time. Point-in-time signed document, FT Lex register. Includes: supply position vs 21M cap (from Legend's own chain scan), power law at generation time (Burger methodology, cited), 4/8/12-year return windows vs gold/S&P/gilts (data API called at generation, cited), EO 6102 note (one factual paragraph on historical gold confiscation precedent and what cryptographic self-custody changes). Data API is a separate scoping session — not live UI charting. Legend stays a block explorer.

**Haiku chain-state helper (paid tier, post-B9):**
Paid clients get a Claude Haiku integration that explains what Legend found — in plain English, without logging the query, without projecting prices. Explains: last movement, holding period, KYC exchange interaction history, power law context, Silent Payments and Payjoin flags. Does not give investment advice. Query goes user → Legend indexer → Haiku → response. Nothing persists.

**Non-bitcoiner audience:**
The finance-professional-gold-bug profile is a formal target for paid tiers alongside Bitcoin-native family offices. Four metrics move this profile: (1) supply audit — verify 21M independently; (2) power law — physicist's entry point; (3) return windows — Alex's own methodology applied to a new asset; (4) EO 6102 — closes the gold trapdoor. Estate report and Haiku are the tools. Legend makes no investment claims.

**Sparrow Wallet (Phase 8):**
Esplora-compatible endpoint → one URL paste for Sparrow users. Distribution channel and trust signal. Do not build before Phase 2 privacy architecture is stable.

**What Legend never becomes:** news section · live price terminal · portfolio tracker requiring account creation · social layer · comparison tool with third-party price feeds in the UI.

---

## Share — platform notes

**Pay-per-use API (planning — pre-AD-2):** Metered API for professional photographers and legal. Full plan in a dedicated Share API planning session.
**Safari upload ceiling:** ~1.5 GB real-world ceiling on current in-memory upload path. Do not headline large-file capability on Safari.

---

## Share — Silent Inbox (locked AD-HOC · 27 Aug 2026)

**Product name locked:** Silent Inbox.
**Tagline:** "A permanent, private link where anyone can send you files — without either of you leaving a trace."

**What it is:** A static, permanent inbox address that allows any sender to deliver encrypted files to the inbox holder without either party needing an account, and without Refueler being able to link senders to recipients or to each other.

**Tier placement:**
- Production Max — entry point for the full Silent Inbox feature set.
- Creative Premium — lighter version: smaller storage cap, shorter TTL per transfer.
- Free tier — no Silent Inbox.

**Mechanics:**
- Inbox ID is an opaque random string in KV — it is an accounting unit, not an identity. No email, no name, no account attached.
- Byte counter per inbox ID enforced in KV before credential issuance — sender gets 402 if cap is reached.
- Pause/vacation mode: KV flag `inbox_paused_{inbox_id}` — when set, credential issuance returns 503 with user-facing copy, sender informed to try again later.
- Address rotation: inbox holder generates a new inbox ID; old ID remains active for 24-hour grace period, then KV entry expires. Sender who visited the link before rotation still completes their upload. Sender who visits after expiry receives a clean "this link is no longer active" response.
- Per-transfer TTL enforced via R2 lifecycle rules scoped to the inbox key prefix — files auto-delete at TTL regardless of whether they were downloaded.

**Dashboard for inbox holder (Production Max):**
QR code · copy link · pause toggle · rotate button · storage bar (bytes used / cap) · transfer list showing: size, timestamp, expiry countdown, download status. No sender names. No file names. No sender IP. Nothing that links two transfers to the same sender.

**Stripe vs Lightning tier split (locked AD-HOC · 27 Aug 2026):**
- Lightning path gets Silent Inbox. Stripe path does not.
- Framing: architectural honesty, not a restriction. The Stripe path collects name and card details — Silent Inbox cannot make its privacy promise when the account has an identity attached.
- Upgrade page copy locked: *"Both paths unlock the same transfer capacity. Lightning doesn't collect your identity — which means some account features aren't available, and some privacy features are."*
- Payment comparison table columns: Name / Email / Record / Refund / Privacy — Stripe vs Lightning.
- Zero-sat invoice concern resolved: Lightning users pay real sat amount for tier purchase. No zero-sat invoices anywhere in the flow.

**BOLT12-inspired static offer as the underlying primitive (locked AD-HOC · 27 Aug 2026):**
The Silent Inbox is architecturally the Share implementation of a BOLT12-style static offer address. Strip the sats from the BOLT12 offer ceremony and what remains is a reusable, privacy-preserving, authenticated request channel where neither party reveals network identity and each interaction is unlinkable.

Implementation decision locked — **Option A:** borrow BOLT12 cryptography, not the Lightning network. Cloudflare Worker acts as blinded relay over HTTPS; secp256k1 blinded paths. Buildable on existing Cloudflare + Worker infrastructure. No Lightning node required for this feature. No zero-sat invoice UX problem for users. Option B (real BOLT12 zero-amount invoices, requires B9 node) noted as architecturally cleaner but gated on node provisioning and introduces user-facing complexity that is not justified for Share's professional audience.

**Journalist use case (canonical):** Journalist publishes one QR or link. Any source sends documents indefinitely. Each upload is unlinkable to every other. No correlation between senders. Journalist's network identity never revealed. This is the cleanest public articulation of the two-axis category definition applied to a real workflow.

**Network privacy:** Mullvad VPN recommendation covers Share's threat model without requiring onion routing infrastructure. Cloudflare's global edge + Mullvad handles the network layer. No Share-operated onion routing required.

**Pass standing invitation credentials (related primitive):**
The same BOLT12-inspired static offer mechanism supports Pass standing invitation credentials — a venue publishes a standing pass offer; authorised holders (enforced by Nutroot threshold leaf, see below) contact it periodically and receive a fresh single-use admission credential for that event instance. Combine with Nutroot `after` leaf for time-window enforcement. Member list committed cryptographically, not in a database.

---

## Share × Lightning — B9 node infrastructure (locked AD-HOC · 27 Aug 2026)

**Hetzner node selected:** CAX21 (€5.77/mo, 8GB RAM, 80GB NVMe).
**Software:** LND + Neutrino mode. Not pruned bitcoind — Neutrino syncs in 4–8 hours, pruned bitcoind takes days and requires more storage.
**Co-located services on Share node:** LND instance + SimpleX SMP server + Tor hidden service.
**Tor latency:** not a concern — the node handles signalling only, not file transfer. File bytes travel Cloudflare edge; only Lightning payment signals touch the node.

**Instance separation rule (locked):**
Share Lightning node and Legend Lightning node must run on separate Hetzner instances. A single fatal error — kernel panic, disk failure, misconfiguration — must not take both products' payment rails offline simultaneously.
- Share node: CAX21, B9 scope.
- Legend node: separate CAX21, provisioned when Legend build begins (post-B9).
- SimpleX SMP server co-located with Share node only. Its failure is lower severity than the payment rail and does not justify a separate instance.

**Upgrade trigger for Share node:** when Lightning payment volume requires dedicated resources, move to CX32 or larger. Decision at that point whether SimpleX migrates or stays.

**Blink account for B7:** Separate Blink account for Share (`rt+share@rajeshtaylor.com`), API key `refueler-share-b7` with READ + RECEIVE scopes. This is the B7 payment backend — the Hetzner node is B9 scope. Do not conflate.

---

## Cashu protocol — NUT-00 v3 and NUT-10 v3 Nutroot secrets (AD-HOC · 27 Aug 2026)

**Source:** Cashu dev call 36, 27 Aug 2026. Both items are draft PRs — neither merged. Author: robwoodgate. Reviewer: calle. Monitor `cashubtc/nuts` repo.

**NUT-00 v3 — BLS12-381 pairing-based blind signatures (PR #371):**
Adds a pairing-friendly curve enabling batch verification of multiple blind signatures in a single operation. Useful for Share at scale (bulk credential verification). Assessment: B10+ consideration for Share. Not urgent — existing NUT-00 BDHKE is correct and sufficient through B9.

**NUT-10 v3 — Nutroot secrets (PR #421):**
Taproot-style spending conditions. A credential's spending condition is a Merkle tree of policy leaves. Key-path spend uses the aggregate key (privacy-preserving by default — observer cannot distinguish a key-path spend from an ordinary credential presentation). Script-path spend reveals only the specific leaf being satisfied, not the full policy tree.

Leaf types:
- `threshold(k, [pubkeys])` — M-of-N co-signatories required.
- `after(timestamp)` — credential is unspendable before this time.
- `hashlock(preimage_hash)` — credential is unspendable without the preimage.

**Assessment for Share:** HIGH priority. The FROST threshold signatures planned for B12 get a proper interoperable Cashu foundation from Nutroot rather than bespoke implementation. B9 whitepaper §Future work should reference Nutroot secrets as the direction — supersedes the NUT-29 framing in current roadmap.

**Assessment for Pass:** VERY HIGH priority. Timelock, hashlock, and M-of-N multisig at the token level — cleaner than rolling bespoke spending conditions per use case. This is the foundation Pass v2 should be built on.

**Supersedes:** NUT-29 framing in B9 whitepaper §Future work. Update all references at B9 planning.

---

## Pass × Nutroot secrets — use case set (locked AD-HOC · 27 Aug 2026)

**Key framing:** "The policy is the credential." Access conditions are cryptographic, not database entries. Cannot be subpoenaed, queried, or breached at the list level. Luma cannot do this — Luma's access control is a row in a database.

**Use cases by leaf type:**

`threshold(k, [pubkeys])`:
- Event entry with shared custody (anti-touting): ticket valid only when holder + venue co-sign. Prevents resale to parties who wouldn't pass the co-sign check.
- Corporate ticket allocation: CFO + EA must both present credentials for a block booking to activate.
- Family/group passes: 2-of-4 household members can claim entry — useful for season tickets.
- Press accreditation: editor + journalist must co-sign access for press-only areas.

`after(timestamp)`:
- Early access windows enforced cryptographically — no database flag to flip, no admin override possible.
- Multi-day festival daily activation: credential unlocks each morning, cannot be used the day before.
- Refund window embargo: credential is non-transferable until refund window closes (timestamp-gated).
- Season ticket renewal cliff: credential expires at end of season, renewal issues a new credential.
- Venue handover: operational credential for staff becomes valid only after a specific handover time.

`hashlock(preimage_hash)`:
- Proxy pickup: interoperable replacement for bespoke Pass proxy credential. Holder gives preimage to proxy; proxy presents credential + preimage. Original holder's anonymity preserved.
- Conditional staff access: production manager holds preimage, releases it on day-of-event to unlock backstage credentials.
- Merchandise redemption on purchase proof: preimage is embedded in purchase confirmation; present at merch desk to unlock credential.
- Collaborative gifting: multiple people contribute to a gift; preimage released when funding threshold met.

**Combinations assessed as most novel:**
- FROST threshold + Nutroot threshold leaf: private members events where no individual holds a complete key. The member list is a FROST key set; admission requires a threshold of key-share holders to co-sign. No list in a database. No admin with override access.
- Timelock + hashlock: conference talk access — speaker releases preimage at the start of their talk. Attendees with the credential + preimage get access for that slot only.
- Threshold + timelock: board meeting quorum gate — credential requires 3-of-5 signing keys AND is only valid after the scheduled meeting time. Combines identity threshold with time enforcement.

**Priority framing:** FROST combinations and "the policy is the credential" are the headline differentiation versus Luma and every existing ticketing platform. This is the Pass v2 thesis.

---

## Share × Legend — distress integration (locked Multi-[n] · 22 Aug 2026)

**The use case:** A distressed Bitcoin user generates a Chain Trace Report on Legend
(Merkle-verified PDF: every address, movement, hop, legal-standard timestamp, block
height verification). That document is sensitive. Emailing it passes it through servers
subject to subpoena, data breach, and IT monitoring. Share is the correct and only
appropriate transmission channel.

**Why this is the clearest real-world Share use case yet articulated:**
Every other Share use case is somewhat abstract — "accountants, solicitors, GDPR."
This one is visceral. A distressed Bitcoiner at 3am, funds potentially swept, trying
to send sensitive chain evidence to their lawyer without leaving a trail. The vendor
breach guarantee (Share's server never holds keys; breach exposes nothing useful) maps
directly onto the threat model of a user who has already suffered one compromise.

**Integration model (v2):**
- "Send privately" button appears alongside "Download PDF" on Chain Trace Report screen
- Share upload happens in background; user never navigates away from Legend
- Unique encrypted link generated; decryption key never leaves the user's device
- Link can be sent via any channel (WhatsApp, SMS, email) safely — plaintext never
  touches those servers
- Recipient (solicitor, trustee, law enforcement liaison) clicks link, file decrypts
  in their browser; no Share account required for recipient
- Link expires 72 hours by default

**Plain English copy (locked):**
> "Your report contains sensitive information — every address and movement we traced.
> Sending it by email means it passes through servers you don't control.
>
> Send privately instead: we encrypt it so only your recipient can open it.
> Not even we can read it once it's sent. The link expires in 72 hours.
>
> Copy the link below and send it however you like — text, email, Signal."

**Solicitor/GDPR angle (B2B pitch inside the B2C moment):**
Share protects the professional's indemnity liability, not just the user's privacy.
A solicitor receiving an unencrypted PDF of a client's full Bitcoin address history
via Gmail has a GDPR and professional indemnity exposure. Share removes that exposure
without requiring any technical knowledge from either party.

**Article cross-reference:** Article 24 is simultaneously the strongest Legend article
and the strongest Share article not yet written. Coordinate publication.

---

## Pass × Legend — address watch notification layer (locked Multi-[n] · 22 Aug 2026)

**The use case:** A user registers an address watch on Legend. They need to be alerted
if the address moves — potentially with only minutes to act before funds are swept.
Email requires storing an address. Nostr requires a running client. Pass is already
on their phone and already holds Cashu credentials daily.

**Integration model (v2):**
- Legend issues a Cashu bearer watch credential (same blind architecture as query
  credentials) when a user registers an address watch
- Credential stored in Pass — no email address stored, no Nostr client required
- When watched address moves, Legend marks the credential as triggered
- User sees quiet alert in Pass during normal daily use (tickets, stamps, offers):
  *"Your watched address has activity. Open Legend now."*
- No address and no amount in the notification body — signal only

**Layered by user sophistication:**
- Non-technical user: Pass notification sufficient — already in the app, one tap to Legend
- Technical Bitcoiner: Nostr DM as additional parallel layer
- Fallback for all users: Cashu polling token — check on demand, blinded so Legend
  cannot link watch registration to the poll, works from any browser

**Privacy advantage over email:**
Pass notifications do not appear in corporate IT security logs. No signal to any
monitoring infrastructure that a Bitcoin address is being watched. This matters
especially for professional users (solicitors, family office staff) operating on
monitored networks.

**Why this fits Pass's mission exactly:**
This is Pass doing what it was designed to do — daily credential interactions requiring
no Bitcoin knowledge, building Cashu familiarity at scale, plugging directly into
Legend as a notification and presentation layer. The use case writes directly from
the Pass top-of-funnel definition in this file.

**Pass credential class for address watch:** Access credential variant — non-monetary,
closed-loop, no melt path, triggered state replaces presented state. New credential
subtype to be defined in Pass planning session.

---

## Recovery Coordination Layer — v3 candidate (locked Multi-[n] · 22 Aug 2026)

**What it is:** A FROST-based private coordination mechanism for mass-compromise events
(exchange collapse, hardware wallet supply chain attack, RNG vulnerability) where
multiple victims need to assert collective claims without revealing individual holdings
to each other, to Legend, or to the public filing record.

**Flagged as genuinely novel** — nothing comparable exists in the Bitcoin ecosystem.
Hoseki and similar tools provide individual proof-of-ownership. No tool provides
threshold-signed collective claim coordination with sealed individual components.

**The problem it solves — the Mt. Gox precedent:**
Large-scale Bitcoin theft produces hundreds or thousands of victims with identical
forensic needs: chain trace, legal documentation, collective claim filing. Individual
filings in insolvency proceedings are public documents — name, amount, and identity
attached. Mt. Gox creditors spent a decade filing spreadsheets. Individually-identified
creditors became targets for scammers and social engineering. A collective filing
mechanism that keeps individual amounts sealed while proving the aggregate claim to
a trustee or court would have changed their situation materially.

**The mechanism:**
- Each victim generates a FROST key share independently on their own device
- No victim holds any other victim's share at any point
- Elected representatives (threshold k of n) co-sign a collective claim document
- Document states collective total; individual Merkle proofs are sealed components —
  verifiable by trustee/court against the chain, not visible in the public filing
- Legend produces each victim's individual Merkle-verified chain trace receipt
- No Legend node sees the complete picture — coordination is structurally trustless
- Share transmits each victim's sealed component to the coordination point privately

**The dead drop analogy (internal framing):**
Each agent deposits their intelligence package separately, in separate locations. The
handler assembles the composite picture. No agent knows what any other agent deposited.
The composite is presented to the minister. If one agent is compromised, the others
are not exposed — and the composite remains valid if the threshold was met.

**Sovereign-scale extension — the El Salvador model:**
At current Bitcoin price trajectories, a national Bitcoin reserve loss is a fiscal
event with geopolitical consequences: IMF/World Bank re-engagement, loss of
Bitcoin-native resident community confidence, political consequences for the Bitcoin
legal tender framework. El Salvador's declared purchase programme (~1 BTC/day as of
2026) makes this scenario material rather than theoretical.

Legend's Recovery Coordination Layer is the protocol a national Bitcoin office should
have in place *before* they need it — not as a reactive tool but as a pre-adopted
standard of fiscal prudence. "Legend-compliant recovery protocols" as a standard a
national Bitcoin office adopts proactively is a fundamentally different product
conversation from post-compromise recovery tooling.

A Bitcoin treasury that does not have Legend-compatible recovery protocols in place
is operating below the standard of care. This framing — proactive standard, not
reactive tool — puts Legend in the same conversation as custody standards, not just
explorer tools. UC-9 Opus session to develop this fully.

**Scope boundary (what Legend provides vs what it points to):**
- Legend provides: chain trace, Merkle receipts, FROST threshold infrastructure,
  Share-based private transmission of sealed components
- Legend does not provide: legal advice, trustee liaison, filing service, diplomatic
  or intergovernmental coordination
- IMF and World Bank have no framework for Bitcoin reserve loss — Legend is not a
  policy institution; it provides the cryptographic and documentation layer only

**Version assignment:**
- v1: Distress Mode — plain-language address query, immediate answer, no friction
- v2: Chain Trace Report — Merkle-verified PDF, Share integration for private transmission
- v2: Address Watch — Cashu credential, Pass notification layer, Nostr parallel
- v3: Recovery Coordination Layer — FROST collective claim, sealed individual components,
  sovereign-scale architecture
- Dependency: FROST DKG ceremony implementation (scheduled post-node-provider confirmation)

**UC-9 Opus session:** Required before any build planning on this layer. Session prompt
in SESSIONS.md. Load: CLAUDE.md · SESSIONS.md · MASTER.md · legend-use-cases.md.

---

## Session references — cross-repo

| Session | Repos touched | Notes |
|---|---|---|
| CSS-4 through CSS-7b | refueler-io | CSS rationalisation track — complete |
| CC-84 | refueler-io, Supabase | Portrait layout, walk-in overlay. Commit d0defcc. |
| CC-85 | refueler-io | Magic link email, first full sim run. |
| Design-A | refueler-io | Two merchant handover docs. ✅ Closed. |
| **Block-5 Close** | refueler-io | Block 5 review. Sim stages ratified. ✅ Closed. |
| **CC-92** | refueler-io, Supabase | Stage 3 payment simulation PASSED. ✅ Closed. |
| **Sim-Close** | refueler-io | Formal sign-off. INCIDENT-PROTOCOL.md. ✅ Closed. |
| **CC-94 / Hardening-A** | refueler-io, Supabase | Six migrations. G-4, G-5 cleared. ✅ Closed. |
| **CC-95 / TDP-A** | refueler-io | Terminal audit. Eight drift findings. S-27 added. ✅ Closed. |
| **CC-96 / TDP-philosophy** | refueler-io | Design philosophy locked. Sidebar removed. Strip promoted. ✅ Closed. |
| **CC-97 / TDP-B** | refueler-io, Supabase | Terminal redesign. G-1 cleared. S-27 deployed. ✅ Closed. |
| **CC-98 / TDP-C** | refueler-io, Supabase, numo-fork | `update-lightning-address` v1 deployed. NumoPay alignment. BRIDGE v4.7. ✅ Closed. |
| **CC-99 / NumoPay-A** | numo-fork | ADR locked. Hard fork confirmed. ✅ Closed. |
| **CC-100 / NumoPay-B** | numo-fork | Auth scaffold, CDK removal, Carbon theming. ✅ Closed. |
| **CC-101 / NumoPay-C** | numo-fork | Catalogue, payment flows, history. Commit `def2883`. ✅ Closed. |
| **CC-102** | numo-fork | Build fix partial. S-NumoC-2 open. Owner tab not started. |
| **CC-103** | refueler-io, Supabase, numo-fork | Build fix. Darwin RLS. Owner tab enrichment. Warm carbon. Product naming (Relay/Refill). BRIDGE v4.9. ✅ Closed. |
| **CC-103 planning** | refueler-legend | Legend post-B9 scope: Haiku helper, estate report contextual metrics, non-bitcoiner audience, Sparrow. Logged. |
| Pass-0 | refueler-pass | Founding scope. Two-credential-class model locked. |
| Pass-1 | refueler-pass | Bitcoin Events × Pass × Merchant. PASS-MASTER.md v2.0. |
| **Multi-[n]** | refueler-legend, refueler-share, refueler-pass, refueler-io | Share×Legend distress integration locked. Pass×Legend address watch locked. Recovery Coordination Layer v3 candidate. Article 24 scoped. UC-9 session prompt produced. BRIDGE v5.0. |
| **AD-HOC · 27 Aug 2026** | refueler-share, refueler-pass | Silent Inbox product name + full spec locked. Stripe vs Lightning tier split locked. Hetzner CAX21 node selected (LND + Neutrino + SimpleX SMP + Tor). Instance separation rule locked. NUT-00 v3 + NUT-10 v3 Nutroot secrets logged from Cashu dev call 36. Pass × Nutroot use case set locked. BOLT12-inspired static offer as Silent Inbox primitive locked (Option A). BRIDGE v5.1. |

---

## Active action items (Rajesh)

- **Open Revolut Business account** ← Stripe fiat commission payout destination (before first real merchant)
- **Open Blink ops wallet ("Refueler Ops")** ← second BTC wallet in Blink mobile app
- **Create Refueler Crypto Ops Ledger** ← sats + GBP equivalent columns
- **Push BRIDGE v5.1** to `numo-fork/` root, `refueler-share/`, `refueler-legend/`, `refueler-pass/` root, `refueler-io/docs/`
- Add test `onchain_address` to Raj's Steakhouse in Supabase dashboard
- Push `refueler-app` dev branch ← CA-1 prerequisite
- Disconnect `share.refueler.io` from Cloudflare Pages
- Upgrade Supabase to Pro at first real merchant
- Upgrade Cloudflare Workers to Paid ($5/month) before production volume
- Send Mapbox coordinate accuracy email (in drafts)
- Rotate Anthropic API key before csuite briefing reuse
- Football-data.org API key held by Rajesh — ready for Events intelligence layer session
- Commission rate planning conversation before first real merchant
- **[Legend]** Legend planning session — family estate planning, miniscript/multisig, Silent Payments, Payjoin, CoinJoin — for those who have used privacy tools AND those who haven't. Sparrow Wallet integration path. Scoped post-B9.
- **[Legend]** UC-9 Opus session — Recovery Coordination Layer + sovereign Bitcoin exposure scenario (El Salvador model). Session prompt in SESSIONS.md. Load: CLAUDE.md · SESSIONS.md · MASTER.md · legend-use-cases.md.
- **[Pass]** Solicitor briefing brief to draft before appointment
- **[Pass]** P0 spike: cross-merchant redemption unlinkability (NUT-29) before v2 build
- **[Pass]** P1 spike: issuance timing-correlation resistance
- **[Pass]** Define address watch credential subtype — Access credential variant, non-monetary, triggered state. Dedicate to Pass planning session.
- **[All products]** Privacy page update queued
- **[All products]** Docs ↔ UI sync rule active from Design-A

---

## Relay (numo-fork) — context

**Name locked CC-103:** Relay ("Relay by Refueler"). Floor/waiter staff. Android phone, portrait.
**Base:** cashubtc/Numo v1.8. **Fork:** `rajesh-taylor/numo-fork`. Package: `io.refueler.merchant`. Hardening phases 1–3 complete.
**Build state (CC-103):** BUILD SUCCESSFUL. Commit `54b15de`. Installed on Pixel 9a.
**ADR:** `numo-fork/NUMO-PAY-A-ADR.md` · `refueler-io/docs/NUMO-PAY-A-ADR.md`
**Next:** Web-Touch-1 → Icon-B (Relay app icon, Android only). S-numo-v31 (numo_navy refs) pending.

---

*"Nothing stops this train."*
