# share-sessions.md — refueler-share

---

## Sessions 1–26 — compact log (B1 + B2)

| # | Date | Commit | Summary |
|---|------|--------|---------|
| 1 | 10 Jul | — | Architecture planning: token lifetime, upload model, NUT-11 P2SH, storage spec |
| 2 | 11 Jul | `session-2-build` | Worker scaffold (3 endpoints), `frontend/index.html`, Supabase `spent_tokens` |
| 3 | 11 Jul | `172a2e0` | NUT-11 Mode 1 passphrase gating (`nut11.js`, `manifest.js`) |
| 4 | 11 Jul | `42180c1` | Stripe products + prices (live GBP), webhook, `subscribers` table, R2 buckets |
| 5 | 12 Jul | `9a5fdc1` | Turnstile widget, all 6 secrets set, Pages project, `share.refueler.io` live |
| 6 | 12 Jul | `458bc99` | `STRIPE_WEBHOOK_SECRET` rotated (exposed in git) |
| 7 | 12 Jul | `3b9a9aa` | Visible Turnstile widget (invisible mode broke Safari ITP) |
| 8 | 12 Jul | `0369dc8` | blake3-wasm local bundle (`frontend/blake3/`, force-committed) — CDN broken |
| 9–10 | 13 Jul | (grouped) | secp256k1 v2 API fix (`secp.ProjectivePoint`), R2 binding `BUCKET`, SHA-256 passphrase hash |
| 11 | 13 Jul | `e50b58c`+`ec0c325` | Decrypt stall fixed, filename preservation. Full upload/download flow ✓ |
| 12 | 13 Jul | — | Stripe Customer Portal, `/subscription/portal`, R2 lifecycle rules |
| 13 | 14 Jul | — | `upgrade.html` rebuild: Paper/Carbon tokens, Stripe remount |
| 14–15 | 14 Jul | `f52b55f` | Eleventy 3.x scaffold: `src/` → `frontend/`, partials. B1 complete. |
| 16 | 14 Jul | grouped | KV status system: `refueler-share-kv` (binding `STATUS_KV`), `GET /status`, `POST /admin/status`, maintenance banner (`sessionStorage` dismiss) |
| 17 | 14 Jul | grouped | `src/status.njk`: ops + crypto integrity sections, 60s auto-refresh, banner-linked only |
| 18 | 14 Jul | grouped | AE dataset `share_events` (binding `AE`), `logEvent()` helper, `timed()` router wrapper |
| 19 | 14 Jul | grouped | `/admin/metrics`: MRR, subscribers_by_tier, paid_total, churn MTD. RLS deny-all on ledger tables. `cancelled_at` added to `subscribers` |
| 20 | 14 Jul | grouped | `double_spend_attempts` table, `credential_uniqueness_rate` metric |
| 21 | 14 Jul | grouped | `frontend/admin/dashboard.html` scaffold: password gate, live metric cards, 60s refresh |
| 19-plan | 14 Jul | — | Roadmap S19–S120 drafted. Critical chains recorded in Share-Master-Context.md |
| 22 | 15 Jul | `d1bcb5a`+`f36e385` | `GET /admin/ae-metrics`: AE SQL proxy, CF_AE_TOKEN scoped. CORS `X-Admin-Key` fix. |
| 23 | 15 Jul | `a4bc625` | AE SQL column syntax fix (`double1`/`blob1` not array syntax). p95/p99 latency + error rate cards. |
| 24 | 15 Jul | `5be5811` | `GET /admin/snapshot`, System Summary dashboard section (6 metric tiles) |
| 25 | 15 Jul | `fc6cba9`+`99afaaa` | Free-to-paid conversion rate, dashboard restructure |
| 26 | 15 Jul | — | B2 close. 10/13 metrics live. Context files updated to v2.1. |

**Permanent do-not-retry (B1–B2):**
- blake3-wasm CDN (esm.sh/unpkg) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand; `lifecycle get` → `lifecycle list`
- AE SQL: use `double1`/`blob1` column names, not `doubles[N]`/`blob[N]` array syntax
- DO NOT await `env.AE.writeDataPoint()` — fire-and-forget
- DO NOT call AE SQL API from Worker — proxy via `/admin/ae-metrics` only
- DO NOT use KV counter for double-spend tracking — race condition; Supabase table only
- `spatial_ref_sys` RLS is false — PostGIS system table, leave alone
- `sessionStorage` only for banner dismiss (not localStorage)
- DO NOT add `/status` to nav — banner-linked only

---

## Sessions 27–29 — B3 Stripe test coverage (16–20 July 2026)

| # | Commit | Summary |
|---|--------|---------|
| 27 | `5f3cb8e` | Stripe CLI installed. 4 test prices created. Root cause of `client_secret` mismatch identified: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation pattern confirmed. 4242 card flow ✓. Webhook handler extended with `customer.subscription.created`. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated to `sk_live_...ZehD`. Portal `resource_missing` confirmed correct (no active sub). Cancellation code-complete. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
- DO NOT `decodeURIComponent` Stripe `client_secret` — already decoded
- DO NOT attempt Customer Portal without active subscription — Stripe returns `resource_missing`
- 4242 card is test-mode only — never works in live mode

**B3 gap (deferred to B11):** Full cancel → webhook → Supabase loop requires a real live subscriber. `cus_UtlpRELAdcZXk2` has no active subscription.

---

## Sessions 34–52 — B4 Security hardening + B5 Design full pass

| # | Commit | Summary |
|---|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. `verifyChunkHash()` live. Integrity gap closed. |
| S35-e | `95a12b4` | Paid tiers greyed out (soft launch). Uncounted. |
| S35 | `ab01388` | AAD overflow fix — `DataView.setUint32(0,i,false)` into 4-byte buffer. |
| S36 | `b877c76` | KV-backed rate limiting: `ratelimit.js`, 3 endpoints, 429s logged to AE. |
| S36b | `0cc4de9` | `/log/error` endpoint + `reportError()` helper. 6 capture points. |
| S36c | `2db7b08` | Dashboard legibility pass. Snapshot strip. Paper/Carbon cookie. Modal stubs. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell, row 3 3-cell. `client_errors_24h` stub. |
| S38 | `20da7d4` | `client_errors_24h` AE query. 3 rogue secrets deleted. Wrangler 4.112. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10 MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0 (6 types). 415 + AE log on miss. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a | `c8a57a42` | `handleLogError` fix. Filename sanitisation. 64 KB manifest cap. Chunk + expiry guards. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting. Chunk count defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. `waitForTurnstile` fix. |
| S42d | `0b32e69` | Turnstile nonce binding. Safari polling fallback. Wrangler 4.113. |
| S42e | — | Full B4 audit. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | DESIGN-TOKENS.md v1.0 applied to index, upgrade, status pages. |
| S44 | `b15f407` | Dashboard design pass I: sidebar, token alignment, Satoshi figures, 4 latency cards. |
| S45 | `7187e41` | Dashboard design pass II: 240px sidebar, gold wordmark, farming card. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, focus trap. CSS+JS extracted to dashboard.css/js. |
| S46b | `023dfcc` | Modal polish: formatBytes, zero=green, datasource banner, × close. smokeTest 27 pass. |
| S47a | `63eb253` | FREE_EXPIRY fixed (5d→7d). Progress smooth. QR retina. Cap nudge. status.njk editorial. |
| S47b | `d8faf0f` | QR 200px SVG (qr-creator). 2-col button grid. Serif integrity notes. Ghost back links. |
| S47c | `cb7a925` | Receiver landing page. USP A/B test (Variant A/B, sessionStorage, AE logging). |
| S47d | `3eb4ec4` | QR guard. Drop zone single-file rejection. Colophon. Footer subdomain-only. Turnstile theme. |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme` scoped to `.refueler.io`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Pipeline depth 2. Per-chunk retry 1s/2s/4s. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. Brand token aliases in shared-styles. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. 3 CSS-only additions. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). |
| S52 | — | `TIER_EXPIRY_SECONDS.free` 5d→7d. `--heading` alias. Lightning ops plan. Context v4.0. B5 closed. |

---


## Sessions 53–72a — B6 Testing infrastructure + folder upload

| # | Commit | Summary |
|---|--------|---------|
| S53 | `b1d9855`+`ca1260c` | Folder upload I. fflate 0.8.2, client-side zip, zip progress UI. fflate bare `Uint8Array` fix (macOS). |
| S54 | `c732abf` | Folder upload II. `sanitisePath`, depth limit 20, file count cap 500 warn/2000 hard stop, memory pressure warning. |
| S55 | — | Folder upload III. Receiver UX: folder icon, zip-as-is decision locked, `rc-folder-note`. |
| S56 | `6cf711d`+`7735787` | Folder upload smoke test. fflate + qr-creator self-hosted. Drop zone fix. Full round-trip ✓. |
| S57 | — | Bearer TTL investigation. 900s hardcoded exp fatal for large transfers. Root cause identified. |
| S58 | `f94a158` | Bearer TTL fix. Token exp = `manifest.expiry_timestamp`. Smoke test ✓. |
| S59 | — | Buffer. Skipped — S58 clean. |
| S60 | `e59305c` | Unit tests I. Vitest 2 harness. ratelimit + manifest. 43 passing. |
| S61 | — | Unit tests II. nut00 BDHKE + blake3. 100 passing. blake3.js null-guard fix. |
| S62 | — | Unit tests III. turnstile + stripe. 178 passing across 6 suites. |
| S63 | — | Testing infra review I. Integration harness designed. TESTING.md created. |
| S64 | `def77b5` | Integration tests I. wrangler dev --local harness. Full BDHKE in client.js. 181 passing. |
| S65 | `8dc8dce` | Security regression suite I. Rate limits, UUID binding, nonce binding. 188 passing. |
| S66 | `344e32d` | Security regression suite II. MIME, UUID validation, chunk bounds, tier cap. 207 passing / 8 suites. |
| S67 | — | Testing infra review II. k6 architecture locked. TESTING.md discrepancies flagged. |
| S68 | `53d24ee` | Load tests I. credential-burst + concurrent-transfers. chunks.js hash table pre-computed. All thresholds green. |
| S69 | `38c60e5` | Load tests II. download-saturation + mixed-realistic + preload-transfers.mjs + README. All thresholds green. |
| S70 | `731b571` | CI pipeline I. GitHub Actions Level 1 green. stripe-events.js Web Crypto. ESLint flat config. |
| S71 | `93b2b86` | CI pipeline II + Lightning admin toggle + Stripe webhook security tests. 211 passing / 1 skipped. |
| S72 | `319225f` | Stripe webhook provide/inject fix. Valid-sig test un-skipped. 212 passing / 0 skipped. |
| S72a | — | B6 close. Snag sweep. TESTING.md v0.5. Context trim. B7 brief. B6 formally closed. |

**B6 snag disposition (S72a):**
- Resolved by removal: X-Email header (AP-2 decision). TESTING.md fixes (S71/S72).
- → B7 buffer (S87): status tile for admin dashboard.
- → B9: manifest-field minimalism audit; UUID/fragment entropy pre-audit.
- → B13: receiver page nav; nav snag (Upgrade link on refueler.io).
- → B11: QR logo centre.
- Open: REFUELER-BRIDGE.md — commit to `refueler-io` when /notes/ session opens that repo.

**B6 do-not-retry (permanent):**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — bare `new Uint8Array(buf)` only.
- DO NOT load fflate or qr-creator from cdnjs — self-hosted only (`frontend/`).
- DO NOT put file inputs inside the drop zone hit area — JS-triggered only.
- DO NOT hardcode 900s TTL for download tokens — pass `manifest.expiry_timestamp`.
- DO NOT call `client.putManifest()` in integration tests — manifest auto-written after final chunk.
- DO NOT send `X-P2SH-Secret-Hash` in a separate manifest PUT — must be chunk 0 upload header.
- DO NOT start Supabase mock in the test file — lifecycle owns it.
- DO NOT use a dummy blinded message in `issueCredential` test helper — real BDHKE unblinding required.
- DO NOT use `ProjectivePoint.subtract()` — noble v2. Use `.add(point.negate())`.

---

## B6 notes — competitor/privacy analysis (M-series)

**Rationale:** Buffer sessions available + genuine strategic value before btc++ Berlin and B13 go-to-market block. Three focused sessions using a pre-planned prompt dropped into Opus. Output feeds B13 positioning, btc++ pitch, and the B9 whitepaper §Privacy comparison.

**M-01 — Privacy-native peers (Proton Drive, Tresorit, Internxt):**
- How do they handle encryption at rest vs in transit vs zero-knowledge?
- Where does the key live? Who can see it? Under what legal compulsion?
- What metadata do they collect? (filenames, access times, IP addresses)
- Security audit posture: have they published audit reports? Which firms? How old?
- Honest assessment of their claims vs actual architecture.

**M-02 — File transfer peers (WeTransfer, Smash, Wormhole, OnionShare):**
- What actually happens to a file after upload? Storage duration, deletion guarantees.
- Do any offer client-side encryption? What's the key model?
- Payment anonymity: do any take Lightning or crypto? Do any offer anonymous access?
- What GDPR/compliance language do they use and what does it actually mean?
- OnionShare: what does a Tor-based model give that a Cloudflare Workers model doesn't?

**M-03 — Architectural inspiration (Bitmail EHL, Nostr file hosting, Blossom protocol):**
- Bitmail's Encrypted Hashlink concept: content hash as delivery receipt on a blockchain ledger. What's the threat model difference vs Refueler's KV manifest approach?
- Nostr NIP-96 file storage: how do relay-based storage models handle anonymity?
- Blossom (BUD-01/03): content-addressed blob storage over HTTP. Overlap with BLAKE3 content addressing in Refueler?
- What does decentralisation buy vs what does Cloudflare's edge buy? Honest comparison.

**Session format:** Plan the prompt in a dedicated mini-session → run in Opus → summarise findings back into `Share-Master-Context.md` §Competitive intelligence (new section, B13 scope) at S72 or in a standalone M-series commit outside the numbered sessions.

---

## M-series — Competitive & architectural intelligence (outside repo, not version-controlled)

Labelled M-01/M-02 (merged from planned M-01/M-02/M-03 — M-01/M-02 merged per S67 decision).
Output files live at `/Users/rajeshtaylor/Documents/`. Not committed to any repo.
Feeds: B9 whitepaper §Competitive context + §Design rationale + §Alternatives considered + §Threat model. B13 go-to-market. btc++ Berlin pitch.

| # | Date | File | Summary |
|---|------|------|---------|
| M-01 | 28 Jul | `COMPETITIVE-INTEL.md` | Privacy & security analysis: Proton Drive, Tresorit, Wormhole, OnionShare, WeTransfer, Smash, SwissTransfer. 7-dimension comparison across all products. Grounded in Securitum Proton Drive audit (Oct 2021, Michał Bentkowski). Key findings: Proton accepts on-chain BTC — do not claim "no competitor offers anonymous payment". Anonymity spectrum: WeTransfer/Smash/SwissTransfer → Tresorit/Proton → Wormhole → **Refueler Share** → OnionShare. Positioning: "professional-grade anonymity where only one side needs to be sophisticated." B13 wedges: vs WeTransfer (ML-terms/content access), vs SwissTransfer ("jurisdiction is not architecture"), vs Proton ("no account to correlate; payment is blinded"), vs OnionShare ("close your laptop; transfer survives"). Two `/notes/` article titles confirmed: "What a subpoena gets from seven file transfer services" · "Why our till is blind." |
| M-02 | 28 Jul | `ARCHITECTURAL-INSPIRATION.md` | Decentralised protocol analysis: Bitmail EHL, Nostr NIP-96 (effectively deprecated → Blossom), Blossom BUD-01/BUD-04. Key findings: (1) Bitmail EHL solves non-repudiation — our anti-product. Decline chain-anchoring. (2) NIP-96 deprecated; say "Blossom" at Berlin. (3) BUD mirroring is BUD-04 not BUD-03 (BUD-03 = user server list). (4) "Pseudonymous is not unlinkable" — the Berlin line. (5) Cashu whitepaper paragraph drafted verbatim. (6) btc++ "why not Blossom?" answer ready to rehearse. (7) Blossom metadata-minimalism benchmark → manifest-field audit added to S72 snag sweep. Decline table: chain anchoring, blockchain ledger, Nostr relay manifest, content-addressed read interface, BUD-04 mirroring (defer B10), NIP-98 keypair auth. |

**Do-not-say (from M-01):** "No competitor offers anonymous payment" — false. Proton accepts on-chain Bitcoin and cash by post.
**Do-not-use framing (from M-01):** "Swiss-grade privacy", "zero-knowledge" as headline, "military-grade encryption", "anonymous payments."
**Whitepaper framing that is genuinely ours (M-01):** "The server is blind and so is the till." Blind-signature credentials as the third leg — nobody detaches payment from usage. Open-source verifiability of a hosted service. Honest-metadata table (sizes/timing visible, published voluntarily). Executable evidence trail.

---

## B7 session plan — Lightning/Blink + anonymous paid tier

**Block principle:** No session holds more than one architecturally complex piece of work.
M difficulty = 2 sessions (a/b). L difficulty = 3 sessions (a/b/c). S = 1 session.
Buffer consumed only if genuinely needed — reviewed at S83a.

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S73 | Lightning infra I-a | Worker secrets set (`BLINK_API_KEY`, `BLINK_WALLET_ID`). `worker/src/lightning.js` scaffold. `createInvoice()` stub. `LIGHTNING_BACKEND` env var abstraction. | M |
| S73a | Lightning infra I-b | `createBlinkInvoice()` implementation. `lnInvoiceCreate` GraphQL call. Response parsing. Unit smoke test: curl → invoice returned. | M |
| S74 | Lightning infra II-a | `POST /webhook/lightning` endpoint. KV payment tracking schema: `{ paymentHash, tier, period, created_at, expires_at, settled: false }` — 25h TTL. | M |
| S74a | Lightning infra II-b | Dedup logic: second webhook call finds `settled: true`, returns 200 silently. `getBlinkInvoiceStatus()` polling fallback. Smoke test: curl invoice → fake webhook → KV settled flag confirmed. | M |
| S75 | Credential issuance I-a | On settled webhook: resolve `{ tier, period }` from KV. Issue Cashu credential via NUT-00 path with tier-appropriate capacity. | L |
| S75a | Credential issuance I-b | Write credential to short-lived KV slot keyed by `paymentHash` (10 min TTL). `GET /subscription/lightning/credential?hash=` poll endpoint. | L |
| S75b | Credential issuance I-c | Tier cap wiring for Lightning credentials (no X-Email — credential-based enforcement design). Error states: expired invoice, already-redeemed hash. Smoke test full chain. | L |
| S76 | Frontend Lightning flow I-a | `src/upgrade.njk`: Lightning tier cards enabled. `POST /subscription/lightning` wired. Paper/Carbon tokens throughout. | M |
| S76a | Frontend Lightning flow I-b | QR display (qr-creator, same pattern as share flow). BOLT11 copy button. Rate display (GBP + sats equivalent, "rate locked 24h" copy). Polling for credential on payment hash. | M |
| S77 | Frontend Lightning flow II-a | Credential receipt → browser memory. Upload flow unlocks paid tier cap on credential receipt. | M |
| S77a | Frontend Lightning flow II-b | Error states: expired invoice UI, already-redeemed UI, payment timeout (24h). Full frontend smoke test both Paper and Carbon. | M |
| S78 | GBP/sats pricing display | Blink `btcPrice` query wired in Worker at invoice creation. Rate stored in KV entry alongside hash. Displayed on frontend: "£12 = ~82,400 sats (rate at time of invoice)." | S |
| S79 | Payment privacy table I | `src/_data/payment_privacy.json` created. Schema: array of rows, each with `label`, `stripe`, `lightning`, `paynym` fields. Stripe and Lightning columns populated. PayNym column: "Coming soon" placeholder throughout. | S |
| S79a | Payment privacy table II | Eleventy partial `src/_includes/payment-privacy-table.njk` renders JSON. Collapsible section added to `src/upgrade.njk`. Paper/Carbon tokens. Blink correlation row explicit. Full build + visual check. | S |
| S80 | Dashboard Lightning cards I-a | `frontend/admin/dashboard.html`: new Lightning section. Lightning confirmation latency card (p95, live — KV `invoice_created_at` vs `webhook_received_at`). AE logging for latency datapoint added to `/webhook/lightning` handler. | M |
| S80a | Dashboard Lightning cards I-b | Four stub cards (greyed, labelled): webhook delivery rate (needs LNbits), webhook signature failures (needs LNbits), routing fee income MTD (needs own node), channel liquidity health (needs own node). CSS: greyed state, "available at B9" tooltip. | M |
| S81 | KV Lightning admin toggle | Dashboard toggle card: `lightning_available: true/false/blink`. `POST /admin/status` extended. Upgrade page reads flag — Lightning option hidden when `false`. Graceful degradation copy. Smoke test both states. | S |
| S82 | Paid tier activation I-a | Re-enable Creative Premium + Production Max cards (greyed since S35-e). Stripe path smoke test: checkout → webhook → Supabase row → tier enforced. | M |
| S82a | Paid tier activation I-b | Lightning path smoke test: invoice → pay (test wallet) → credential issued → tier enforced → upload cap active. Both payment paths confirmed live. | M |
| S83 | B7 security audit I-a | Full security review Lightning flow: invoice expiry handling, KV race conditions, credential farming via Lightning path, double-issuance attack vectors. | M |
| S83a | B7 security audit I-b | Webhook replay attack surface. Any findings from S83 fixed and retested. Marketing claim rulings updated — Lightning pseudonymity claims audited. | M |
| S84 | LNbits planning I | Read `lnbits/lnbits` repo. Map keep/strip/brand decisions. Extension shortlist: LNURLp, LNURLw, Boltcard. Webhook signing spec. Dashboard metrics enabled by signing logged. No code this session. | S |
| S85 | LNbits planning II | Skinning scope: which templates, which tokens, effort estimate. LNURL-withdraw gift architecture design. NUT-20 binding spec. Session output: locked decisions list for B9. No code this session. | S |
| S86 | LNURL-withdraw gift architecture | Design document: Cashu credential as LNURL-withdraw payload. Wallet compatibility matrix (Zeus, Phoenix, Blink, Breez). Gift flow UX spec. B9 session scope locked. | S |
| S87 | B7 close | Snag sweep. Context files updated. §Lightning infrastructure finalised. B8 brief. Rajesh B9 background tasks listed. Buffer review. | S |

**Buffer pool (5 sessions):**
- S75c — credential issuance complexity overrun
- S76b — frontend Lightning flow overrun
- S83b — security audit findings requiring additional fixes
- S84a — LNbits planning scope larger than expected
- S87a — B7 close sweep overrun

**Background work for Rajesh during B7:**
1. Complete pre-B7 checklist (see Share-Master-Context.md §B7 notes) before S73 starts.
2. Read LNbits repo before S84: `https://github.com/lnbits/lnbits`
3. Hetzner account setup (no VPS yet — just have login ready for B9): `https://hetzner.com`
4. Test Lightning wallet for payment testing: Blink app on a second device, or Phoenix wallet.
5. 2 GB test file if not already done: `dd if=/dev/urandom of=/tmp/testfile.bin bs=1m count=2048`


## AP-series — Architectural planning sessions (uncounted)

| # | Date | Summary |
|---|------|---------|
| AP-0 | 29 Jul | Ad-hoc strategy. Article pipeline (12 titles). API/white-label planning item. Mullvad payment decoupling. Client dashboard scoped (firm-scoped, privacy-intact). IT handover doc confirmed. API pricing model direction set. Susie/BHODL contacts logged. |
| AP-1 | 29 Jul | /notes/ article pipeline locked. Articles 2–5 structures confirmed. Byline: Rajesh Taylor. notes-articles-list.md created. Article 1 iteration decisions locked, one-week hold. REFUELER-BRIDGE.md prompt drafted for refueler-io project chat. |
| AP-2 | 30 Jul | API architecture planning. Auth: HMAC signing (rfs_live_ + rfs_sign_ keypair). Credential issuance on behalf of end users (transfer_ref opaque to Refueler). Stripe decoupling: subscribers = billing ledger only, X-Email dropped. Renewal: credentials stack, no credit lost, re-issue on demand. Dashboard: hosted, AE-backed, no identity data. All decisions locked for AP-3. |
| AP-3 | 30 Jul | White-label implementation planning. Custom hostname flow (CF for SaaS, wl.share.refueler.io). Badge config via KV. IT handover doc structure locked. Five-tier structure locked. Pricing cadence 1/3/12 months, no discounts. Stripe updated: 4 new prices, 2 archived. |
| AP-3a | 30 Jul | Webhook spec locked (4 events, rfs_whsec_, waitUntil retry + dead-letter, notification-not-control-flow). Single API key + rotation locked — sub-keys declined, transfer_ref handles attribution. OEM positioning paragraph drafted (verbatim, Berlin-ready). SW block created: 12 core + 2 buffer, runs post-S87. CLAUDE.md, Share-Master-Context.md, share-sessions.md, TESTING.md, notes-articles-list.md all updated. |

---

## SW block session plan — white-label + API build (post-B7)

**Block principle:** Runs immediately after S87 (B7 close). No code before SW1.
SW block is separate from B7 — do not append SW sessions to B7.
B8 renumbers after SW close (SW9).

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| SW1 | CF for SaaS setup | One-time: SaaS enablement on refueler.io zone. Fallback origin `wl.share.refueler.io`. Worker route `wl.share.refueler.io/*` added to wrangler.toml. Smoke: `GET /status` via wl hostname returns 200. | S |
| SW2 | API auth I | `worker/src/api_auth.js` — HMAC-SHA256 verify over `method+path+timestamp+body_hash`, ±300s window, key lookup from KV. Unit tests in same session. | M |
| SW2a | API auth II | `POST /api/v1/credential/issue` + `api_quota_{key_id}` KV enforcement (402 on exhaustion). AE logging of `transfer_ref` as `blob1`. `POST /api/v1/keys/rotate` with 24h grace window. | M |
| SW3 | Badge + /wl/config | `GET /wl/config` — reads `wl_config_{hostname}` by Host header. `Cache-Control: max-age=3600`. Fail-safe: no KV record → `{ badge: true }`. Badge component in Paper/Carbon, links to `share.refueler.io`. | S |
| SW4 | Webhooks I | `worker/src/webhooks.js`. Registration: `POST /api/v1/webhooks` (max 3, HTTPS only, no IP literals) → `{ webhook_id, whsec }`. `GET /api/v1/webhooks` list. `DELETE /api/v1/webhooks/{id}`. `wh_config_{api_key_id}` KV schema. `rfs_whsec_` issuance — shown once. | M |
| SW4a | Webhooks II | Delivery via `ctx.waitUntil`: immediate → +5s → +25s, 10s timeout. Non-2xx or timeout = failure. After 3rd failure: dead-letter `wh_dead_{api_key_id}_{event_id}` (7-day TTL) + AE log (`blob1=api_key_id, blob2=event_type, blob3=outcome, double1=latency_ms`). Daily cron retries dead-letter once. | M |
| SW5 | Client dashboard I | `frontend/dashboard-client/` scaffold. API-key auth. Transfers table from AE via `GET /api/v1/transfers?api_key_id={id}&from={ISO}&to={ISO}&transfer_ref={optional}`. Paper/Carbon tokens. | M |
| SW5a | Client dashboard II | Capability gating by tier (Prod Max / Business / Enterprise). Webhook monitoring card: AE-sourced delivery rate 24h/7d, last failure timestamp + HTTP status, dead-letter count (from KV). Hostname health card. | M |
| SW6 | Onboarding flow | Per-client admin runbook. Steps: CF custom-hostname API call → keypair + whsec issue → `wl_config_{hostname}` KV write → activation poll + smoke test `GET /status` on client hostname. Single-line curl commands throughout. | S |
| SW7 | IT handover PDF | Two-page branded PDF. Paper theme: bg `#F7F4EF`, gold accent `#C8A96E`, IBM Plex Mono for DNS block, Source Serif 4 body. Three substitution fields: hostname, IT contact name, date. Sections: what this is / DNS record / what happens next / how to test (3 checks) / two failure modes / ongoing / support path (support@refueler.io) / footer: what we never see. Built once, generated per client. | S |
| SW8 | Daily cron | `[triggers] crons` in wrangler.toml. Scheduled handler: (1) poll each `wl_config_*` hostname's `/status` → AE log → dashboard health card amber/green; (2) retry `wh_dead_*` KV entries once. | S |
| SW9 | SW close | Full smoke test both API and white-label paths. TESTING.md SW additions. Context files trim pass. B8 brief. Buffer review. | S |

**Buffer pool (2 sessions):**
- SW2b — auth implementation overrun
- SW5b — client dashboard overrun

*"Nothing stops this train."*
