# Share-Master-Context — refueler-share
> **Version:** 9.12 | **Last updated:** Share-Upload-3 · 6 Oct 2026
> Load alongside `CLAUDE.md` and `share-sessions.md` at every session start.
 
---
 
## Stack
 
| Layer | Technology |
|-------|-----------| 
| Worker | Cloudflare Workers — `wrangler deploy` |
| Worker URL | `https://refueler-share.rt-fc4.workers.dev` |
| Storage | Cloudflare R2 — `refueler-share-prod` / `refueler-share-dev` |
| Ledger | Supabase `tihgvdokeofnjxjkenmm` — `spent_tokens`, `subscribers`, `double_spend_attempts` |
| Frontend | Eleventy 3.x — `src/` → `frontend/` (canonical `refueler-share/frontend/`, mirror `refueler-io/src/share/assets/`) · Local: `/Users/rajeshtaylor/Documents/refueler.io` |
| Subdomain | `refueler.io/share/` → `refueler-io.pages.dev` |
| Crypto | AES-GCM (Web Crypto), BLAKE3 WASM (browser local bundle + Worker WASM), secp256k1 (@noble v2) |
| Payments (fiat) | Stripe — live mode, GBP, embedded Payment Element |
| Payments (sats) | LNbits on Hetzner CAX21 (B7+) — `LNBITS_API_KEY` / `LNBITS_URL` |
 
---
 
## Supabase
 
Project: `tihgvdokeofnjxjkenmm`
 
| Table | Key columns | Notes |
|-------|-------------|-------|
| `spent_tokens` | `serial TEXT PK`, `melted_at TIMESTAMPTZ` | RLS deny-all |
| `subscribers` | `stripe_customer_id TEXT PK`, `email`, `tier`, `status`, `current_period_end`, `cancelled_at` | RLS deny-all · index on email |
| `double_spend_attempts` | `id BIGSERIAL PK`, `serial`, `uuid`, `attempted_at` | RLS deny-all · fire-and-forget on 409 |
 
Count pattern: `Prefer: count=exact` + `Range: 0-0` → parse total from `Content-Range: 0-0/TOTAL`.

**Planned (B12-SR — not built):** `quota_accounts`, `quota_reservations` (B12-3) · `auth_tokens`, `auth_sessions`, `chartered_orgs` (B12-4a). All RLS deny-all, service-role RPCs only. Registered rail only — never a row for Bearer (incl. Bearer-rail Chartered).
 
---
 
## Cloudflare resources
 
| Resource | Value |
|----------|-------|
| Worker | `refueler-share` |
| R2 buckets | `refueler-share-prod`, `refueler-share-dev` |
| KV | `refueler-share-kv` · id `5b1dca6a8f06423f98d0bbc4286e2968` · binding `STATUS_KV` |
| AE dataset | `share_events` · binding `AE` |
| Pages | `refueler.io/share/` → `refueler-io.pages.dev` |
| Turnstile | Sitekey `0x4AAAAAAD0N7GlHlCRuWITr` · Managed widget (visible only) |
 
Worker secrets (all set): `MINT_PRIVATE_KEY`, `TURNSTILE_SECRET_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `STRIPE_SECRET_KEY` (sk_live_...ZehD),
`STRIPE_WEBHOOK_SECRET` (rotated 21 Jul), `ADMIN_KEY`,
`CF_ACCOUNT_ID` (fc4f3e5aeebe483677d14185daf544f5), `CF_AE_TOKEN` (Account Analytics Read).
`WEBHOOK_SIGNING_MASTER_KEY` (SW4a, stateless webhook signing master). Do not rotate without cause.

**Planned secrets (B12-SR §B — NOT yet set; the build session that first needs each one sets it):** `QUOTA_REF_KEY` (naming root — never rotate without a migration session) · `SHARE_SEAL_KEY_1` + var `SHARE_SEAL_CURRENT="1"` (sealing root, replaces proposed `ORG_DOCK_KEY`) · `TEST_CRED_KEY` · `UPLOAD_SESSION_KEY` (only if the live session token isn't already a Worker-secret MAC) · `AUTH_PEPPER` · email-provider key (B12-4a).
 
**Cloudflare Workers Paid ($5/mo)** — required for verified-download CPU (pure-JS BLAKE3 over 32 MiB chunks). `[limits] cpu_ms = 300000` in worker/wrangler.toml. $6 billing budget alert active. Standing infra cost as of Share-6-5c (22 Sep 2026).
 
---
 
## Stripe — live mode
 
| Product | Price ID | Lookup key | Amount | Status |
|---------|----------|------------|--------|--------|
| Citizen monthly | `price_1Ts7vIGlctwiB9U3kb3NCLue` | `share-max-monthly` | £24/mo | ✅ Active |
| Citizen 3-month | `price_1TyzMLGlctwiB9U3cA31BOQc` | `share-max-3month` | £72/3mo | ✅ Active |
| Citizen yearly | `price_1TyzNaGlctwiB9U3T8uV4UIW` | `share-max-yearly` | £288/yr | ✅ Active |
 
**Tier rename complete Share-Brand-Opus-1:** Pro Bono (free). Citizen (paid, Registered rail, Stripe). Sovereign (paid, Bearer rail, Lightning). Chartered (commercial API/MCP). Product ID: `prod_Urre2e3PQgr5Uq`. Price IDs and lookup keys unchanged.
**Chartered tier:** invoiced manually via Stripe invoice template. No subscription price object — off-repo.
**Personal API (£49/mo):** unlisted Stripe price, managed manually. Not on public pricing page.
 
Webhook: `https://refueler-share.rt-fc4.workers.dev/webhook/stripe` · `we_1Ts8epGlctwiB9U3dXT8XBac`
Portal: configured · redirect to `https://refueler.io/share/upgrade.html`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
 
---
 
## Lightning infrastructure (B7)
 
**Provider: LNbits on Hetzner CAX21. Locked pre-Opus-2.** Blink dead. Voltage/Strike eliminated.
 
**Stack on Instance A (Share+Pass):** phoenixd → LNbits → cloudflared tunnel → Tor (.onion for LNbits admin + phoenixd transport).
 
**Phoenixd → LND trigger:** ≥£10k/mo Lightning receipts sustained 3 consecutive months AND named operator committed OR ACINQ discontinues phoenixd.
 
**Payment flow (B7):** Frontend → `POST /subscription/lightning` → LNbits BOLT11 → KV 25h TTL → QR → user pays → LNbits webhook → authenticated GET re-verify → Cashu credential → KV 10-min TTL → frontend polls credential endpoint. No Supabase row. No identity.
 
**Privacy model:** Lightning payer = payment hash + amount + tier only. Honest claim: "pseudonymous." DO NOT claim "anonymous."
 
**DO NOT add a Supabase row or email field to the Lightning credential path** — load-bearing for Silent Drop and anonymous API rail.
 
---
 
## Locked architecture decisions
 
**Crypto layers (never conflate):**
- BLAKE3 = chunk integrity. Browser: `frontend/blake3/`. Worker: `worker/blake3-wasm/` via `blake3_worker.js`. 400 on mismatch.
- Cashu = anonymous auth (NUT-00/07/11). No monetary usage. No external mint.
- Passphrase hash = SHA-256 only. Stored as `p2sh_secret_hash` in manifest.
- AES-GCM session key lives in URL fragment only — never in requests, never in logs.
- AAD per chunk: 4-byte big-endian uint32 via `DataView.setUint32(0, i, false)`.
**Two roots, never conflated (B9-Opus · 12 Sep 2026):**
- `merkle_root` = ciphertext-chunk Merkle root. Worker-verifiable. Written to manifest at upload; reconstructed by Worker at download. Storage integrity only.
- `blake3PlaintextRoot` = plaintext root. Recipient-side only. Never in manifest. Never in Worker. Never in any receipt. Permanent ban.
**Merkle tree (locked B9-Opus):**
- RFC 6962 unbalanced, domain-separated (`0x00` leaf / `0x01` node), BLAKE3 node hash, big-endian leaf order. `tree_algo: "rfc6962-unbalanced-blake3-v1"`. `chunk_count` committed.
- Chunk hashes: R2 sidecar `{uuid}/hashes` (raw 32-byte concat per chunk). Never inline in manifest.
- Download sequence: `GET {uuid}/hashes` → reconstruct root → compare manifest `merkle_root` → verify-then-flush each chunk → 409 on any mismatch.
**Storage:** R2 binding `BUCKET`. KV binding `STATUS_KV`. Chunk key: `{uuid}/{0000}`. Manifest key: `{uuid}/manifest.json`. Hashes sidecar: `{uuid}/hashes`. `safeGetManifest()` enforces 64 KB ceiling.
 
**Frontend:**
- Five modules, all `type="module"`: `share.js` · `crypto.js` · `upload.js` · `download.js` · `timestamp.js`
- `refueler-share/frontend/` is canonical. Mirror: `refueler-io/src/share/assets/`. Sync: `bin/sync-share.sh`.
- DO NOT collapse back into a single file. DO NOT edit the mirror directly.
**CF for SaaS (SW1 · 8 Sep 2026):**
- Fallback origin: `fallback.share.refueler.io`. Custom hostname: `api.share.refueler.io`.
- hostname_id: `d1d04abe-854c-48a0-8afe-bca47dfb0c3b`. ssl_id: `a3bd125f-f48c-4226-9e7c-d26e77fbaa90`.
- API token: `refueler-share-saas` (Zone → SSL and Certificates → Edit, scoped to `refueler.io`).
- `wl_config.js` is the host-lookup module — add new client hostnames to `WL_CONFIGS` there.
**HMAC auth (SW block):**
- Three credentials: `rfs_live_{32b base58}` (identification) + `rfs_sign_{32b base58}` (request integrity) + `rfs_whsec_{32b base58}` (webhook signing, API tier only).
- HMAC-SHA256 over `method + path + timestamp + body_hash`. SIGN_DOMAIN_TAG = `refueler.webhook.v1.sign` — never revert.
- Test credentials use `rfs_test_` prefix — never `rfs_live_` or `rfs_sign_` in test files.
- Rotation: `POST /api/v1/keys/rotate` (24h grace). One keypair per commercial relationship.
**D-1 filename fix (Option B, locked SW-MCP-4):**
- Fragment grammar v1: `base64url(JSON.stringify({ v:1, k:"<AES key>", n:"<filename>", s:"<seal_nonce>" }))`.
- `X-File-Name: "encrypted-payload"` (constant placeholder) to Worker. Real filename in fragment only.
- **Pre-SW-MCP-4:** Worker sees filename in manifest. Scope trust claims accordingly.
- **Post-SW-MCP-4:** Worker sees neither filename nor passphrase.
---
 
## Dashboard surface naming (locked Share-Dash-2 · 18 Sep 2026)
 
| Surface | Who | Notes |
|---------|-----|-------|
| Navy Office | Superadmin (Rajesh) | Full ops dashboard — all transfers, all orgs, all metrics |
| Chambers | Citizen / Sovereign | Account page — Harbourmaster layout, Chartered sections visible but locked/greyed |
| Custom House | Chartered API/MCP | Reserved — additive on upgrade, not a move |
| Harbourmaster | Chartered org admin | Full org dashboard — aggregate storage, org transfers, quota management |
 
---
 
## User-facing dashboard design decisions (locked Share-B10-2 · 24 Sep 2026)
 
**Execution Dock (admin view — Navy Office):**
- Columns: UUID (truncated), Tier (display name), Status (Active/Expired only), Created, Expires
- No per-transfer size (privacy liability — aggregate only, per org)
- No Collected at (read-receipt = surveillance)
- No cross-user visibility
- Tier display mapping: `free`→Pro Bono, `creative`→Citizen, `max`→Sovereign, `api`→API/MCP
**Storage & Billing (Navy Office sidebar — SOON):**
- Named "Storage & Billing" in Navy Office sidebar, under OVERVIEW
- Shows aggregate storage per org (anonymised org ID, not user UUIDs)
- Quota per org vs used, active transfer count per org, tier breakdown, nudge signals
- Separate panel — do not conflate with Growth Signal (acquisition vs operational health)
- Growth Signal remains as-is
**Harbourmaster (Chartered org admin — future build):**
- Named "Capacity" in Harbourmaster sidebar
- Aggregate storage used vs quota (org-scoped only — no per-user detail, no UUIDs)
- Active transfer count, quota CTA when approaching limit
- No per-transfer size, no tier breakdown (all Chartered), no user identification
**Pro Bono — no account surface. Stateless by design.**
- No login, no dashboard, no account page
- Token + link only — the privacy model requires no persistent state
- Path to account: Citizen (Stripe + email)
**Citizen / Sovereign — Chambers (account page):**
- Full Harbourmaster layout
- Chartered-only sections (org management, team, Capacity) visible but locked/greyed
- Single build, progressive unlock model — seamless upgrade path to Chartered
- Individual users see their own per-transfer file size (it's their file)
- No Collected at, no Download count, no Rail visibility
**Chartered — full Harbourmaster, everything unlocked.**

**⚠️ Naming collision (B12-SR X3, unresolved 🟡):** "Harbourmaster" means three things — BRIDGE: internal live-transfer view inside Navy Office; B8/Silent Drop: the Quay owner who logs in with a Locke; B12: the Chartered org-admin surface. **Auth follows the rail, never the surface name:** Registered principals → magic link (B12-SR S6); Bearer principals → Locke (B8 §4). Resolve naming before B12-5.
**Bearer-rail Chartered (B12-SR X2):** follows Sovereign — no quota row, no `org_dock`, device-held Harbourmaster. Inherits every Bearer feature.
 
**UUID as identifier — privacy principle:**
- Superadmin (Navy Office) can see UUIDs but must not relay them to org admins to identify users
- Org admins do not see UUIDs — capacity management is aggregate only
- If an org needs more storage: contact superadmin → increase org quota. No per-user identification.
**Storage & Billing / Capacity scoping:**
- Requires dedicated Opus session(s) before build
- Harbourmaster / local admin build parked — not in current roadmap block
---
 
## Known broken / do not retry
 
See `CLAUDE.md` §Known broken for the full authoritative list. Key items not duplicated in CLAUDE.md:
 
- DO NOT write quota write-back synchronously — fire-and-forget KV put
- DO NOT reset a cancelled account on lazy period rollover — cancellation gate runs before reset
- DO NOT use `blake3` npm package — `@noble/hashes/blake3.js` only
- DO NOT import `@noble/hashes/blake3` without `.js` extension
- DO NOT generate `description: ...` placeholder stubs in JS — syntax errors
- DO NOT present `index.js` edits without full repo path — `refueler-mcp/src/index.js` ≠ `refueler-share/worker/src/index.js`
- DO NOT run `npm publish` in a session — dry-run only; Rajesh publishes manually
- DO NOT re-chase "finalise rejects the opaque session token (HMAC)" — false; `finalise.js` byte-compares vs KV like `handleUploadUrls`; fresh uploads finalise 200. Live-verified 20–21 Sep.
- **B12-SR (24 Sep 2026) — do-not-retry** (the other B12-SR locks live in CLAUDE.md):
  - DO NOT let any KV value authorise access, lift a limit, or select a privileged branch unless it is MAC'd under a Worker secret. KV is compromised for **write** as well as read (X1). Live offenders pending the KV audit: `test_credential:{uuid}` flag, `api_quota_*`, the `rfs_live_` → org mapping, B8 Locke pubkey set.
  - DO NOT persist `size_bytes` in `dock_index` (X4 — fixed in B12-1).
- DO NOT re-chase "Worker omits CORS on `/download`" — false; `index.js` wraps every download response (+500 catch) in `addCors`, OPTIONS → 204+CORS. curl confirmed ACAO on the "failing" chunk. Browser-side "CORS/503" download failures were **Brave** + intermittent 503s on the custom hostname before 6-6b (a 503 carries no CORS header); Safari downloads cleanly.
---
 
## Current state
 
**Share-Upload-3 ✓ (6 Oct 2026) — upload page B2 items 1–4 (`4bb3fde`, `627c0d0`): sheet top into view on every view change (F-27), Cloudflare check out of sight unless it needs a click + "Checking…" auto-start + single-use token (U-10), "Choose another" keeps the check (U-11), whole-page drop (U-8); extras `bf0512a`: resume picker opens inside the click (Safari two-click), deps warmed early, QR caption. Safari desktop resume check + iPhone retest in a fresh tab outstanding (first test ran pre-ship code). Next: Share-Upload-4 (F-11 errors + Try again, Part C) → Share-Progress-1 (upload + download progress, mock first) → Share-Folder-Resume-1 (S-031) → B12-2 (refueler-io session) → KV-Audit-Opus; MCP-Fix-1 week of 12 Oct; `/meta` hard-null from 13 Oct. Share-Receiver-3 (receiver A/B brand mock + link previews) as its own session.**
 
| Block | Commit | Summary |
|-------|--------|---------| 
| Share-B12 ✓ | `cc14d21` | Storage/quota/surfaces/billing design locked — `docs/B12-spec-v1.1.md`. |
| Share-B12-SR ✓ | `4564730` | Security review — `B12-SR-spec-v1.md` (root). Amends B12 A1–A18. |
| B12-1b ✓ | deploy `0d2f94d9` | Test gate green; R2 proven to enforce signed `content-length` (403 on mismatch, plain and chunked). Optional `contentLength` in presigner. S1.1 build split to B12-1c. |
| B12-1c ✓ | `413b714` | Frontend half of S1.1: `tail_url` handling in `upload.js` (fresh + resume, `tailUrl` in IDB) and `test-upload.html` (+16 B bodies, 32 MiB locked). Worker half → B12-1d. |
| B12-1d ✓ | deploy `1c6c7985` | Worker half of S1.1: signed `content-length` on `/initiate` + `/urls`, `tail_url` every N, chunk/byte-count 400, finalise `wrong_size` 409 + `waitUntil` delete. 639 tests. Live: wrong-size PUT → 403; 8.5 GiB / 272 chunks finalised, R2 chunks exactly 33,554,448 B. |
| Cred-Fix-2a ✓ | deploy `4c9730b2` | Credential format v2 accepted (`verifyProofV2`, `@cashu/cashu-ts` 4.11.0 pinned), `keyset_id` + `dleq` at issue, anonymous-rail API issuance explicit 503 until B7. 659 tests incl. official NUT-00/02/12 vectors. v1 removal → 2b. |
| Cred-Fix-2b ✓ | `ca3972c` · deploy `a5ac4f5d` | Browser sends credential format v2 (vendored cashu-ts, DLEQ checked); Worker refuses v1. 642 tests. |
| Share-Size-1 ✓ | `27582c7` · deploy `69a99b89` | Exact size in the fragment (`z`); no `total_bytes` in new manifests; `/meta` null for new; receipts `size_bytes: null`; AE `double5` 0. 646 tests. |
| Share-Upload-2 ✓ | refueler.io `580135c` · `565efd9` | Share sub-menu (`sections.js` + `section-nav.njk`); upload page B1 (open sheet + slip, §1 copy, bytes progress, QR canvas, F-23 `share-early.js`, F-6 tokens). Preview harness `dev/share-harness/`. B2 → Share-Upload-3. |
| Share-Upload-3 ✓ | `4bb3fde` · `627c0d0` | B2 1–4: F-27 scroll, U-10 hidden check + "Checking…", U-11 keep the check, U-8 whole-page drop. `bf0512a`: resume picker before any await, `loadDeps()` warmed, QR caption. `initTurnstile`/`renderTurnstile` no longer exported. F-11 + Part C → Share-Upload-4. |
 
---
 
## Roadmap
 
| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1–10 | B1–SW block ✓ | ❌ | Complete. |
| 11 | SW-MCP block ✓ | ❌ | Complete. SW-MCP-7 anonymous tail gates on B7. |
| 11a | **B12 post-Berlin start** — B12-1c (S1.1 build), Share-Size-1, B12-2 (B12-1 ✓, B12-1b ✓ gate) | ❌ | B12-1c ✓ (frontend) → B12-1d ✓ (Worker) → Cred-Fix-2a ✓ → Cred-Fix-2b ✓ → Share-Size-1 ✓ → Share-Upload-2 ✓ (B1) → Share-Upload-3 ✓ (B2 1–4) → Share-Upload-4 (F-11 + Part C) → Share-Progress-1 → Share-Folder-Resume-1 → B12-2 (run in refueler-io) → KV-Audit-Opus. |
| 11b | **Security foundations** — KV-Audit-Opus (+ B8 Locke-set MAC amendment) → KV fixes · X3 naming · X5 dedicated app origin | ❌ | First week after Berlin. Before B8 build. |
| 11c | **B12 Registered rail** — B12-3 quota · B12-4a auth · B12-4b Chambers · B12-6 billing (+ UPGRADE-CSS / legacy `/upgrade.html`; CAP-WARNING-LINK ✓ Cleanup-1, DAD-ERROR-TEXT ✓ DAD-1) · B12-Audit (Opus) | ❌ | ~3 weeks post-Berlin incl. 11b. |
| 11c′ | **Large-download track** — Soak-4 → DL-Spike → DL-W1 → DL-1 / DL-2 → DL-3 (shared with MCP `refueler_fetch`) → DL-Soak | ❌ | First block after the Now list (Rajesh, 5 Oct; README "Next" #1). Safari/Firefox streaming download, no whole-file RAM copy. Spec `docs/Share-Download-spec-v1.md`. DL-Soak green before paid cards open (D-7). Ahead of B8. |
| 11d | B12-5 Harbourmaster | ❌ | When a Chartered client is in sight. |
| 11d′ | **Pricing-v2-Opus** (1–2 sessions) → plans-page rewrite | ❌ | Rate card v2: holding time + per-32 MiB billing, GBP↔credits, credit blocks, Pro Bono × agents, personal agent key vs `Sovereign ⊅ API`. Plans rewrite after B12-4a from `docs/drafts/` (draft B). Agents/MCP first. Log: Share-MCP-Chat-1. |
| 11d″ | **Padding-Opus** (design + planning, no build slot yet) | ❌ | Size padding (e.g. Padmé buckets) so R2 sees a size band, not an exact size. Open: everyone-light vs paid-stronger (paid-only padding marks the sender as a customer), storage cost, interaction with per-32 MiB API billing. Also scope a Wormhole-style short-code mode (PAKE) as a possible paid feature — async storage makes short codes harder than in Wormhole. Raised Share-B12-1b. |
| 11d‴ | **Receipt size opt-in** (only if a Chartered client asks) | ❌ | Share-Size-1 (6 Oct 2026) stops storing the exact size; receipt `size_bytes` is `null`. If a Chartered client asks for it: per-transfer opt-in, **off by default**, identity rail only, size written only into that transfer's signed receipt — never the manifest or `/meta`, never the anonymous rail. Note the receipt sits in KV 7 days, so opting in re-stores the size there. Agreed by Rajesh, Share-Size-1. Not built. |
| 11e | B12-4c Sovereign ledger + portability | ✅ | Needs B8-1 (Deed derivation) + B7 live. Runs alongside SD-block. |
| 12 | B8-Opus → B8 build — NUT-11 Mode 2 | ❌ | Pure cryptography on existing Worker. B8-Opus first. |
| — | **Hetzner commitment point** | ✅ | NB-2 provision. First new recurring cost. |
| 13 | NB-2 → NB-4 — node bootstrap | ✅ | Provision, test, declare live. |
| 14 | B7 Lightning (S74–S86+) | ✅ | Full Lightning block with node live. Session plan: `docs/B7-SD-plan.md`. |
| 15 | SD-block — Silent Drop | ✅ | Sovereign (Bearer rail) + Lightning-only. Full Locke (B8) required. Session plan + SD do-not-retry: `docs/B7-SD-plan.md`. |
| 16 | Article pipeline | ✅ | Unlocks after NB-4. Article-Rewrite-1 ("What a subpoena gets") brief: `docs/Article-Rewrite-1-brief.md` — not gated on NB-4. |
| 17 | B9 build (B9-1…B9-8) | — | Design locked B9-Opus. Build sessions in `merkle-spec-v1.md` §9. |
| 18 | B10+ | — | ML-KEM + NUT-22 + Verkle forward. |
 
---

## Backlog imported from desktop-chat memory (Share-Cleanup-1 · 28 Sep 2026)

Swept against the repo on import; only items not already done or recorded elsewhere are listed (S-numbers = the export file, kept off-repo). Memory-only items, medium confidence.

**Open — slot into the named session:**
- **S-004** Retune `VERIFY_INLINE_CHUNK_THRESHOLD` (128) after the large-download work → Share-DL track.
- **S-095** Question: move ciphertext verification off the download hot path (verify at finalise + background sweep) if WASM isn't enough → Share-DL / B9 build.
- **S-019** Spec a client self-serve transfer status check (own transfer, own token) for "my transfer isn't downloading" → with B12-4b Chambers / B12-5 Harbourmaster.
- **S-025** Whitepaper "honest scope": the operator never sees the real filename (Worker gets `encrypted-payload`; name lives in the fragment) → `docs/WHITEPAPER-OUTLINE.md` at B9-4.
- **S-030** refueler.io `command-centre` still uses `localStorage` `rfTheme`, not the `rs-theme` cookie → low, any refueler.io tidy.
- **S-041** Speed benchmark (1/4/10/25/50 GB; fibre / broadband / 4G / rural) against WeTransfer, Smash, SwissTransfer → after the Share-DL track; possible Notes article.
- **S-045** Homepage/landing copy speaks to WeTransfer and Smash users → homepage design session.
- **Repo bloat (found 28 Sep):** 200 Rust build files under `worker/blake3-wasm-src/target/` are tracked in git. Untrack them and gitignore `target/` (keep the vendored `worker/blake3-wasm/` output) → any small tidy session.

**Added Share-B12-1d (5 Oct 2026):**
- **Share-Upload-2 additions — status after Share-Upload-3 (6 Oct):** → **Share-Upload-4** unless marked. Also F-11 (B2 item 5: every upload failure → "Stopped" with §1 copy; same-tab "Try again" reuses the held file; a failed check needs a fresh token, and the reset widget may be waiting for a click inside the hidden options card).
  1. Resume: button takes 3–6 s to appear after refresh *(still open — time it in Safari)*; file picker needs two clicks (Safari desktop) *(✅ fix shipped `bf0512a`, picker opens before any await; Rajesh to confirm in Safari)*. Likely cause: `resumeUpload` awaits (`loadDeps`, …) before `input.click()`, so the click loses user activation — open the picker first.
  2. Resume: pause while sent chunks are re-hashed — *partly done (B1: "Checking what was already sent · X of Y")*; speed-up still open.
  3. Download % at ~half → **download track with F-22** (Rajesh, 6 Oct).
  4. Upload progress incl. setup stages — ✅ B1 (bytes-based, "X MB of Y MB").
  5. `admin/test-upload.html` esm.sh (= F-25) → use hosted `noble-blake3.js` + `cashu-crypto.js` `blindMessage`, then delete `noble-secp256k1.js` from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in the same ship.
  6. 14 `sourceMappingURL` lines in `frontend/blake3/esm/*` **and** 14 in `src/blake3/` → strip at vendor/copy time.
  7. `test-upload.html` stats refresh per chunk (keep the 100-chunk log line).
  8. `test-upload.html` header comment stale ("NEVER add to sync-share.sh", "NEVER commit to the public mirror").
  9. Finalise 409 `wrong_size` → F-11 error states (Share-Upload-4).
  10. Fresh upload sits at "Preparing" 0 % for a moment before bytes move (Rajesh, Safari desktop, 6 Oct; 4.7 MB folder). Likely `loadDeps()` (BLAKE3 WASM + bundles, fetched on the first click) + `/credential/issue` + `/initiate` round trips; the bar counts bytes only. Warm `loadDeps()` on file chosen / resume card ✅ shipped `bf0512a`; if a pause remains it's the `/credential/issue` + `/initiate` round trips — measure.
  11. **Progress (Rajesh, 6 Oct — "looks hung"):** upload bar moves per finished 32 MiB chunk (fetch has no upload progress; 160 MB = 20 % jumps, ~6 s each); download the same (F-22). Real byte progress is possible both ways (XHR `upload.onprogress`; `res.body.getReader()`) → **Share-Progress-1** (design pass + build, both pages) — **after Share-Upload-4, before B12-2 (Rajesh, 6 Oct)**. Same test: two chunk PUTs failed with no status after ~3 s, retried OK (Mullvad was off all session — network or code, not VPN); console 401 on a long URL (probably Turnstile's Private Access Token probe, harmless in Safari) — confirm in Share-Upload-4.
  12. **Folders can't resume** (by design; S-031). Many large videos → zip is `level: 6` (wasted CPU on video); **Decided (Rajesh, 6 Oct):** store-only zip (`level: 0`, fixed entry order + timestamps → identical bytes every time) in Share-Upload-4; **Share-Folder-Resume-1** (S-031: re-pick the folder, re-zip to the same bytes, check sent parts, carry on) after Share-Progress-1.
- **Write-once chunks** → KV-Audit-Opus / B12-3: also sign `If-None-Match: *` into presigned PUTs so R2 refuses to overwrite an existing chunk (closes "holder of a leaked URL overwrites a chunk with same-size junk for 6 days" → download 409 / DoS, never disclosure). Needs a live R2 gate (like B12-1b) and `upload.js` treating 412 as success on resume retries (saves the re-upload).
- **Test-Harness-1** (small): combined `npm test` failed locally 5 Oct (workerd runtimes ETIMEDOUT / refused on 127.0.0.1). **Cause: Mullvad VPN** — with it disconnected the suite is clean (639 passed, 10 s); CI (Node 22) green throughout. Local network sharing was already on, so it is not that setting — workaround: disconnect Mullvad while running the suite (or run files singly). Not code. Still open: under `singleWorker: true`, `delete_resume` + `dock_b12` bearer-delete tests fail from cross-file state (pre-existing). Also remove unused `MIME_DENYLIST` (Share-MIME-1).

**Added Cred-Fix-2b (5 Oct 2026):**
- **Vendor cleanup** (small, both repos): `frontend/noble-secp256k1.js` is no longer imported (credentials use `frontend/cashu-crypto.js`). Remove it from `frontend/`, `SM_VENDOR` and refueler.io `src/share/assets/` in one ship — the sync never deletes from the mirror.
- **cashu-ts upgrades:** bump `worker/package.json` and `bin/vendor-cashu/package.json` together, then `bin/vendor-cashu.sh` + ship + deploy. Browser and Worker must run the same version.
- **DLEQ key pin** (B7/B8, anonymous rail): the browser checks the DLEQ proof against the key in the same response, not a pinned key (Rajesh, 5 Oct). Pin when credentials are bought separately from transfers.

**Added Share-Size-1 (6 Oct 2026):**
- **`/meta` hard-null** (tiny Worker session, from 13 Oct): `total_bytes: null` for every manifest. First check R2 for any manifest still carrying `total_bytes` with a future expiry (soak/test transfers may outlive 7 days). Then drop the `/meta` fallback in `download.js`.
- **MCP-Fix-1:** send tool adds `z` to the fragment (consumer grammar, `refueler-mcp-spec-v2.md` §7.2).
- **Acceptance receipt never emitted:** `index.js` says `cargo.accepted` moved to `/finalise`, but `finalise.js` never emits it — only `cargo.discharged` is sent. Contradicts MCP spec (acceptance immediately). → MCP-Fix-1 or the next API session.
- **Navy Office "R2 bytes uploaded (90d)" is dead:** it sums `double5` on `upload` AE events, which stopped at Share-6-6b (Worker-relay path retired). Replace (e.g. R2 bucket metrics) or remove → refueler-io.

**Added Share-Upload-2 (6 Oct 2026) — receiver page, agreed by Rajesh (order of value); A/B mock iterations first, then a download-side session:**
1. **"How this worked"** — quiet link under the ledger on the ready card *and* the finished screen, opens three lines: encrypted in the sender's browser before upload · the key was in your link and never sent to Refueler · (DAD only) the stored copy is now deleted. Facts on request, not a tagline (R-4 holds).
2. **Notes card unboxed** — hairline rule above the label instead of a box, so it reads as editorial, not an ad slot; the send line stays last.
3. **"Received" ledger row** on the finished screen — exact local date + time, labelled as the recipient's clock; nothing new reaches the Worker.

**Added Share-Upload-2 (6 Oct 2026):**
- **F-27 scroll ✓ Share-Upload-3** — Rajesh eyeballs it over a week of tests. Turnstile theme is fixed when first drawn (a later Carbon/Paper switch keeps the old colours; only visible when Cloudflare asks) — tiny, fold into Share-Upload-4 if free.
- **Share-Receiver-3 (own session, A/B brand mock rounds, Rajesh supplies references):** the three receiver items above, plus **link previews in mail apps** (Tutamail shows title + domain + R icon only; check Gmail, Apple Mail, Outlook, Proton, Signal/WhatsApp). One static preview for every link, DAD or not (the server can't know, and must not tell a mail provider which links are one-shot); a quiet `og:image` card + `og:description` **"A file sent with Refueler Share."** (Rajesh, 6 Oct: no "Open the link…" line, it reads like spam); the "works once" message belongs in the sender's own words (link-ready line). Invariant to keep: a page load never starts a download (mail scanners and preview bots open links). Also the receiver password input is 15 px (iOS zooms) → 16 px.
- **iOS folder picking** works via long-press in Files; "or a folder" stays on iOS (Rajesh).

**Ideas, parked (no build slot):**
- **S-039/S-040/S-096** `@handle.share` vanity handles / Chartered namespaces: a handle puts transfers "on the register", so Registered/Chartered only; squatting, routing and directory-leak questions open. Not in BRIDGE yet.
- **S-081** Recipient declaration at link creation: one person (keypair, ≤3 devices) / team (shared secret, counter) / one-time. UI says "access key". Overlaps B8 Mode 2.
- **S-098** Sovereign size obfuscation: pad the last chunk to a full 32 MiB. Needs an architecture + cost session first.
- **S-031** True folder resume → build slot Share-Folder-Resume-1 (after Share-Progress-1; store-only zip lands first in Share-Upload-4).
- **S-103** `cdk-dart` as a future mobile client.

**Resolved on import (repo wins):**
- **S-065** Lodge/Collect register stays for internal/whitepaper use; UI copy uses plain words (R-3 "Download", "lodged" dropped).
- **S-052** Sovereign portability via Signal/SimpleX QR: superseded by B12-SR QR pairing with a 6-digit check code.
- **S-142** Harbourmaster = Chartered client surface at reduced resolution (B12 spec), never in the public menu. BRIDGE v9.6 "Navy Office view" wording is stale → next BRIDGE bump.
- **S-120** Live Plans page prices yearly = 12 × monthly (no discount): the July £120/£240 table is dead.
- **S-028** Brave theme cookie, **S-029** phoenixd toggle: resolved (Rajesh, 28 Sep).
 
---
 
## Brand terminology — locked Share-Brand-Opus-1 (11 Sep 2026)
 
| Tier | Internal key | Rail (user-facing) | Payment |
|------|-------------|-------------------|---------| 
| Pro Bono | `free` | — | Public good |
| Citizen | `paid_registered` | Registered | Stripe — GBP |
| Sovereign | `paid_bearer` | Bearer | Lightning — sats |
| Chartered | `chartered` | Registered or Bearer | Stripe / invoice, or Lightning |
 
**Code reality:** live tier strings: `free`/`creative`/`max` (Stripe axis) + `'api'` (Chartered). `TIERS.CHARTERED === 'api'` — wire rename deferred. `worker/src/tiers.js` is single source of truth for logic keys.
 
**Citizen and Sovereign are the same price and feature set.** The rail is a privacy choice, not a tier upgrade.
 
**Vocabulary (sealed):** Lodge/Lodged · Collect/Collection · Sealed/Under seal · Struck off · In camera · Enrolment · Chambers · Freehold/Leasehold · Conduit. Full rationale: `docs/Share-Brand-Terminology.md`.
 
---
 
## SW-Opus decisions — compact summary
 
- **SW-Opus-1:** Four-tier model. Rail model. Model B credit pool. API v1/v2/forward-commitment. MCP v1 tools. Sandbox. BRIDGE v8.3.
- **SW-Opus-2:** Rate card v1.0 (10/transfer, 100/GB, 20/permanent-record). 1 credit = 1 sat. Credit blocks 10k/50k/200k/custom. £99/mo identity-API. BRIDGE v8.4.
- **SW-Opus-3:** DPA mandatory by default. Four-surface disclosure wording. GDPR framing. BRIDGE v8.5.
- **SW4-Opus:** Webhook signing: Option B (stateless HMAC). `whsec_hash` removed. SIGN_DOMAIN_TAG = `refueler.webhook.v1.sign`. BRIDGE v8.8.
- **Share-MCP-Opus-2:** Capabilities endpoint locked (§7.1). Daily reference-rate KV locked. Monthly allocation + lazy reset locked. Personal API (£49/mo, 10k credits, `personal_api`, hard stop). D-1 filename fix: Option B, fragment grammar v1. Terminology: "credits" everywhere user-facing.
- **B9-Opus:** Merkle/MMR/SMT/ZK design locked. Full spec: `merkle-spec-v1.md`. Two-roots distinction permanent. RFC 6962 unbalanced BLAKE3 tree. Sidecar `{uuid}/hashes`. MLRO flag on due-diligence proof framing. BRIDGE v9.4.
- **B8-Opus:** NUT-11 Mode 2 (Locke) design locked. Full spec: `B8-spec-v1.md`. Deed→Locke HKDF derivation (scalar reject-sampled); Schnorr BIP-340 x-only verify; check order sig→BDHKE→double-spend; Locke KV challenge-response (SD3 primitive); `hashSecret()` unchanged/independent; CDK stays 0.17.2; builds direct in refueler-share (ecash-lab Mode 2 flag retired). BRIDGE v9.5.
- **Share-Dash-2 (18 Sep 2026):** Surface naming locked — **Navy Office** (admin/ops, Pepys/Seething Lane mnemonic), **Chambers** (Citizen/Sovereign account area — already theirs), **Custom House** (Chartered API/MCP, reserved — additive on upgrade, not a move), **Harbourmaster** (Execution Dock view inside Navy Office). `handleFinalise` folded to `handlers/finalise.js` with dock enrichment (size_bytes · rail · merkle_root stored, response-withheld until Share-6-5). Three new handlers: `client_errors_kv.js` · `api_stats.js` · `news_events.js`. `by_rail` `none` → renders as "Pro Bono" in dashboard (carry to Dash-3). sandbox_to_live stubbed honestly — wire when first Chartered client onboarded (add `live_at` to `sandbox_meta_` record). BRIDGE v9.6.
- **Share-B12 (24 Sep 2026):** Quota = occupancy (32 MiB chunks), credits = throughput, never merged. Supabase `reserve_quota` RPC at initiate, R2 manifests as truth, nightly reconcile. Harbourmaster = Chartered section set inside one Chambers build. PURGED status. Stripe Customer Portal is the only invoice surface. Full spec: `docs/B12-spec-v1.1.md`.
- **Share-B12-SR (24 Sep 2026):** Security review. Signed `content-length` on presigned URLs; one 6-day `UPLOAD_WINDOW` clock; bound in the session-token MAC; R2 conditional-put deletion latch; optimistic-concurrency reconcile; MAC'd test credentials; sealed `qref_ct` in manifests; per-entry sealed `org_dock` under `SHARE_SEAL_KEY_<kid>`; 128-bit lodgement handles; Harbourmaster shows daily 5 % bands; magic-link + Supabase sessions + `__Host-` cookie + CSRF for Registered rail only; Sovereign portability = Deed + user-held backup file / QR pairing with 6-digit check, Refueler never holds the blob. Cross-cutting X1–X6 (KV write-compromise, Bearer-rail Chartered, Harbourmaster naming, `dock_index` size leak, shared origin, client-chosen UUID). Full spec: `B12-SR-spec-v1.md` (root).
- **Share-B10-2 (24 Sep 2026):** Dashboard design decisions locked — see §User-facing dashboard design decisions above. Single-build progressive-unlock model for Chambers/Harbourmaster. Storage & Billing / Capacity scoping deferred to dedicated Opus session. BRIDGE v9.7.

*"Nothing stops this train."*