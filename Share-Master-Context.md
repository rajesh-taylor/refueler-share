# Share-Master-Context — refueler-share
> **Version:** 9.13 | **Last updated:** Share-Progress-1 · 7 Oct 2026
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
| `api_keys` | `key_hash BYTEA PK` (SHA-256 live key), `sign_key_hash`, `org_account_id`, `rail`, `sandbox`, `active`, `grace_until`, `expires_at`, `label` | KV-Fix-2 · RLS deny-all, no grants · functions only (`api_key_*`) |
| `api_credit_pools` | `org_account_id UUID PK`, `plan`, `allocation`, `remaining`, `overage_*`, `period_*` (unix secs), `status` | KV-Fix-2 · atomic `api_credits_spend` / `_refund` · SQL in `supabase/migrations/` |
 
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
- HMAC-SHA256 over `method + path + timestamp + body_hash`. Webhook whsec: v2 since API-Repair-1 — HKDF over org + `created_at`, tag `refueler.share.whsec.v2` (the v1 `refueler.webhook.v1.sign` construction is retired; no live clients had it).
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
 
- DO NOT keep an API key, client record or credit balance in KV, and DO NOT fall back to KV when Supabase is down (503). *(KV-Fix-2; the old "fire-and-forget KV quota write-back" rule is retired — `api_credits_spend` is awaited.)*
- DO NOT change `applyQuotaSpend` (`quota.js`) without the same change to SQL `api_credits_spend` — they are one rule in two places.
- DO NOT route a webhook, receipt or DLQ retry from KV, a header or `dock_index` — the client comes from the manifest's sealed `cref_ct` (or the MAC'd receipt record after a DAD tombstone). DO NOT re-add `X-Api-Live-Key`. *(API-Repair-1)*
- DO NOT test webhooks through a `trycloudflare.com` quick tunnel from this Mac — Mullvad blocks port 7844 and the edge answers 530. Use `bin/lib/wh-sink.mjs` (named tunnel, `--protocol http2`, `cloudflared` excluded in Mullvad split tunnelling). *(API-Repair-1)*
- DO NOT reset a cancelled account on lazy period rollover — cancellation gate runs before reset
- DO NOT use `blake3` npm package — `@noble/hashes/blake3.js` only
- DO NOT import `@noble/hashes/blake3` without `.js` extension
- DO NOT generate `description: ...` placeholder stubs in JS — syntax errors
- DO NOT present `index.js` edits without full repo path — `refueler-mcp/src/index.js` ≠ `refueler-share/worker/src/index.js`
- DO NOT run `npm publish` in a session — dry-run only; Rajesh publishes manually
- DO NOT re-chase "finalise rejects the opaque session token (HMAC)" — false; `finalise.js` byte-compares vs KV like `handleUploadUrls`; fresh uploads finalise 200. Live-verified 20–21 Sep.
- **B12-SR (24 Sep 2026) — do-not-retry** (the other B12-SR locks live in CLAUDE.md):
  - DO NOT let any KV value authorise access, lift a limit, or select a privileged branch unless it is MAC'd under a Worker secret. KV is compromised for **write** as well as read (X1). Audited KV-Audit-Opus (8 Oct, `docs/KV-Audit-v1.md`): fixes in KV-Fix-1a/1b, KV-Fix-2, API-Repair-1; B8 Locke set → B8-Opus.
  - DO NOT persist `size_bytes` in `dock_index` (X4 — fixed in B12-1).
- DO NOT re-chase "Worker omits CORS on `/download`" — false; `index.js` wraps every download response (+500 catch) in `addCors`, OPTIONS → 204+CORS. curl confirmed ACAO on the "failing" chunk. Browser-side "CORS/503" download failures were **Brave** + intermittent 503s on the custom hostname before 6-6b (a 503 carries no CORS header); Safari downloads cleanly.
---
 
## Current state
 
**API-Repair-1 ✓ (9 Oct 2026) — webhooks and receipts work, routed from the R2 manifest (sealed `cref_ct` → org → MAC'd `wh_config_{orgtag}`), never KV; Chartered initiate HMAC-only (P3/F2 closed); receipts v2 owner-only (F4); DLQ MAC'd + R2 re-check (P4); URL re-validated per send (P5). Deploys `48476e56` → `8aa38636` → `1d7a9e2a` (capabilities `webhook`/`receipts` true after the live test). Live ✓ Mullvad on via `bin/api-repair-1-live-check.mjs` + named tunnel `wh-sink.refueler.io`. New secret `SHARE_SEAL_KEY_1`. Next: **X3 naming + Share-JS-Split-2 (one session) → Share-Soak-4 (→ Share-DL-Spike if a day is free) → B12-3 → B12-4a.**
 
| Block | Commit | Summary |
|-------|--------|---------| 
| Safari-Slow-Link-1 ✓ | deploy `5312c5fa` · ships `9568045`, `f60bcb2` (refueler.io `69a56ef`) | Verify-then-stream download (no part held in the Worker), `DL_IN_FLIGHT` 2, early `/meta` + modulepreload + lazy upload code. `worker/test/slow-link-1.test.js` 12. |
| MCP-Fix-1 ✓ | `refueler-mcp` · refueler-share: capabilities + spec | MCP send on the direct-to-R2 path, link format v2, 32 MiB parts, 2 in flight, Merkle root at finalise; `@cashu/cashu-ts` 4.11.0 pinned to match Worker + vendor script; GB band → GiB; `max_transfer_bytes` = `CHARTERED_CAP_BYTES` (deployed with KV-Fix-2). 245 MCP tests. |
| KV-Fix-2 ✓ | deploy `a47404a6` | API keys + credit pools → Supabase (migration in `supabase/migrations/`), atomic spend, 60 s revocation, admin api-client routes, sandbox refused at issue, KV API/sandbox keys deleted, runbook v1.1. `worker/test/kv_fix_2.test.js` 25. |
| API-Repair-1 ✓ | deploys `48476e56`, `8aa38636`, `1d7a9e2a` · `refueler-mcp` (initiate signed) | `seal.js` (shared seal helper, KAT) + `cref_ct`; HMAC'd Chartered initiate (admin soak credentials keep their bypass); webhook/DLQ/receipt routing by org, all MAC'd; receipts v2 signed with the client's whsec; `cargo.accepted` at finalise, `transfer.confirmed` after DAD; hostname cron from `WL_CONFIGS`. `worker/test/api_repair_1.test.js` 32; 730 Worker tests per file. |
 
---
 
## Roadmap
 
| Order | Block / Session | Hetzner? | Notes |
|---|---|---|---|
| 1–10 | B1–SW block ✓ | ❌ | Complete. |
| 11 | SW-MCP block ✓ | ❌ | Complete. SW-MCP-7 anonymous tail gates on B7. |
| 11a | **B12 post-Berlin start** — B12-1c (S1.1 build), Share-Size-1, B12-2 (B12-1 ✓, B12-1b ✓ gate) | ❌ | B12-1c ✓ (frontend) → B12-1d ✓ (Worker) → Cred-Fix-2a ✓ → Cred-Fix-2b ✓ → Share-Size-1 ✓ → Share-Upload-2 ✓ (B1) → Share-Upload-3 ✓ (B2 1–4) → Share-Upload-4 ✓ (F-11 + Try again) → Share-Upload-5 ✓ (zip, Cloudflare) → Share-Upload-6 ✓ → Share-Crypto-Opus-1 ✓ → Share-Crypto-1 ✓ → Share-Upload-7 ✓ → Share-Progress-1 ✓ → Share-Folder-Resume-1 ✓ → B12-2 ✓ → **KV-Audit-Opus**. |
| 11b | **Security foundations** — KV-Audit-Opus ✓ → KV-Fix-1a ✓ → KV-Fix-1b ✓ (S2 test credential) → MCP-Fix-1 ✓ → KV-Fix-2 ✓ (API keys + credits → Supabase; precondition of B12-3) · X3 naming · X5 dedicated app origin. B8 Locke-set MAC → B8-Opus. **API-Repair-1 ✓** (webhooks/receipts from R2, HMAC'd Chartered initiate). | ❌ | `docs/KV-Audit-v1.md` §5. Before B8 build. |
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
| 16a | **Served-code integrity** (Integrity-Opus → build) | ✅ | Closes the served-JS gap: a compelled or compromised host could serve altered JS that leaks keys for *future* uploads. Reproducible frontend builds + published hashes, SRI on every module, strict CSP (builds on X5, `docs/Share-CSP-1-notes.md`), signed collector/CLI as the no-browser route. Hashes later anchored in the transparency log (B9 MMR via the OTS relay). Added ad hoc 7 Oct 2026. Before the whitepaper and any audit-grant pitch. |
| 17 | B9 build (B9-1…B9-8) | — | Design locked B9-Opus. Build sessions in `merkle-spec-v1.md` §9. |
| 18 | B10+ | — | ML-KEM + NUT-22 + Verkle forward. |
| 19 | **OHTTP for control calls** (OHTTP-Opus → build) | ✅ | Oblivious HTTP (RFC 9458) for the small calls (credential issue, initiate, meta, finalise, urls): the relay sees the IP but not the request; Cloudflare sees the request but not the IP. Third-party relays preferred (bitcoin community already runs them for Payjoin v2 / BIP77); Hetzner relay as fallback. Bulk chunks stay direct; copy tells users to use VPN multihop. Presigned chunk URLs still carry the UUID, so OHTTP alone does not unlink a chunk-fetching IP (needs opaque chunk paths or the VPN). Silent Drop senders first (may lack a VPN, may be in distress). Turnstile/rate limits must never block VPN or Tor users. Agreed ad hoc 7 Oct 2026. |
| 20 | **Multi-provider erasure coding** (design Opus, after B9) | — | After encryption, shard each chunk k-of-n (e.g. 2-of-3) across R2, Hetzner storage and self-hosted nodes: any one provider can be lost; no provider holds a whole ciphertext; one jurisdiction's order yields incomplete shards. ~1.5× storage. Hard parts: deletion latch + DAD across every provider, shard layer in the Merkle spec, fail closed on missing shards. Pairs with a self-hostable Share node. Prior art: Tahoe-LAFS. Agreed ad hoc 7 Oct 2026. |
 
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
- **Share-Upload-2 additions — status after Share-Progress-1 (7 Oct):** 1, 2, 10 + iOS folder name done or closed in **Share-Upload-6**; 11 ✅ Share-Progress-1; 5, 7, 8 ✅ **Share-Upload-7** (`c78cc9d`). F-11 + Try again ✅ Share-Upload-4 (`2fb1b30`).
  3. Download % at ~half → **download track with F-22** (Rajesh, 6 Oct).
  5. `admin/test-upload.html` esm.sh (= F-25) ✅ Share-Upload-7 (+ `noble-secp256k1.js` removed). Left: it prints "4/53 chunks passed" when the verify count exceeds the chunk count (count `verifyIndices.length`) — fold into the next admin-page touch.
  10. "Preparing" 0 % — measured Share-Upload-6: issue 0.64 s + initiate 1.48 s + first-part encrypt 0.56 s, then the first 32 MiB lands before the bar moves → shown by Share-Progress-1. **`/initiate` speed-up** (own Worker session, tests): manifest put + session KV put + presign can run together after the Supabase spend (≈0.3–0.5 s).
  11. Progress + one-box resume ✅ **Share-Progress-1** (7 Oct). Left: link → receiver card takes several seconds in Safari, and the iPhone 97 MB folder 5–10 s before anything shows — measure first (Network timeline, fresh tab, Mullvad on), own small session. Same session: iPhone upload looked stalled for seconds after ~49 % (110 MB, Wi-Fi + Mullvad, Share-Folder-Resume-1 live test) — measure uplink speed vs how iOS Safari reports `upload.onprogress` (lumpy?) before changing anything. Watch-face A/B for bar + readout (Plex Mono figures, minute-track ticks, hand tip) → with the brand work.
  12. Folder resume ✅ **Share-Folder-Resume-1** (S-031, `a783656`). Left: drag the folder back in to resume (desktop only, ≈30–45 min; reuse `readDirectoryEntry` → `_resumeFolder`) — with the slow-link session.
- **Safari page crash on refresh mid-upload (Share-Upload-6):** "This web page was reloaded because a problem occurred" after ⌘R during a 404 MB upload; record survived, resume worked; Rajesh has seen it a few times. Cause unknown (WebKit teardown of a page with a 32 MiB PUT in flight?) → watch; look with the DL track memory work. (End-of-download `/log/error` = the dead A/B ping, removed B12-2.)
- **Write-once chunks** → KV-Audit-Opus / B12-3: also sign `If-None-Match: *` into presigned PUTs so R2 refuses to overwrite an existing chunk (closes "holder of a leaked URL overwrites a chunk with same-size junk for 6 days" → download 409 / DoS, never disclosure). Needs a live R2 gate (like B12-1b) and `upload.js` treating 412 as success on resume retries (saves the re-upload).
- **Test-Harness-1** (small): combined `npm test` failed locally 5 Oct (workerd runtimes ETIMEDOUT / refused on 127.0.0.1). **Cause: Mullvad VPN** — with it disconnected the suite is clean (639 passed, 10 s); CI (Node 22) green throughout. Local network sharing was already on, so it is not that setting — workaround: disconnect Mullvad while running the suite (or run files singly). Not code. Still open: under `singleWorker: true`, `delete_resume` + `dock_b12` bearer-delete tests fail from cross-file state (pre-existing). Also remove unused `MIME_DENYLIST` (Share-MIME-1).
- **Refresh mid-download** (Share-Folder-Resume-1 live test, 8 Oct; Rajesh agreed): the receiver wipes the link from the address bar once the key is read (`download.js` `history.replaceState`, by design: the key never stays in the bar or history), so a refresh lands on "Send a file." Show "A download was interrupted. Paste the link again to restart." — remember only that a download was running (e.g. `sessionStorage`, no uuid, no key), never the link. Small; with the download track (11c′) or Share-Receiver-3.
- **Share-JS-Split-2** (≈1.5 h, after MCP-Fix-1, before the next big upload feature; decided Share-Folder-Resume-1, 8 Oct): `upload.js` ~1,700 lines, `download.js` ~900, `crypto.js` ~700 (holds progress helpers and, since Share-Folder-Resume-1, the folder zip — neither is crypto). Moves only, no behaviour change: `crypto.js` → `crypto.js` + `progress.js` + `zip.js`; `upload.js` → `upload.js` + `resume.js` + `folder.js`. Each new file goes into `bin/lib/share-mirror.sh` the same session; harness pass + one ship. Also: `dev/share-harness/build.sh` still seds `_DIRECT_RETRY_DELAYS`, gone since Share-Progress-1 (`RETRY_DELAYS_MS` in `crypto.js`), so harness retries take ~2 min — fix there.

**Added Cred-Fix-2b (5 Oct 2026):**
- **Ship never deletes from the mirror** (Share-Upload-7): `ship-frontend.sh` stages only listed paths, so a file dropped from `share-mirror.sh` stays in refueler.io until a direct `git rm` there (done for `noble-secp256k1.js`, `8fb9ac2`). Small `bin/` fix: stage removals of files no longer listed, or fail on a "mirror-only file" warning that isn't in `SM_MIRROR_ONLY`.
- **cashu-ts upgrades:** bump `worker/package.json` and `bin/vendor-cashu/package.json` together, then `bin/vendor-cashu.sh` + ship + deploy. Browser and Worker must run the same version.
- **DLEQ key pin** (B7/B8, anonymous rail): the browser checks the DLEQ proof against the key in the same response, not a pinned key (Rajesh, 5 Oct). Pin when credentials are bought separately from transfers.

**Added KV-Audit-Opus (8 Oct 2026)** — full list `docs/KV-Audit-v1.md` §3, §6:
- **Decided (Rajesh, 8 Oct):** 1a → 1b → MCP-Fix-1 → KV-Fix-2 → API-Repair-1 · revoked API key ≤ 60 s · live `api_client_` is a test (delete, don't migrate) · Chartered promises the Pro Bono cap until B12-4a (KV-Fix-1a) · **at KV-Fix-2 close: revoke/re-scope every Cloudflare API token with Workers KV Storage:Edit** (`wrangler login` stays).
- **API webhooks + receipts ✓ fixed (API-Repair-1, 9 Oct)** — live-tested, capabilities true again. Carried: `transfer.timestamp_submitted` is unit-tested only (timestamp route refuses tier `free`, which every initiate resolves to until B12-4a — retest then); `/api/v1/keys/rotate` would change the key hash only, not the org-keyed webhook config (good).
- **Tidy for the external-audit prep:** `worker/tests/unit/` is an old dir vitest never runs; 15 dead imports in `worker/src/index.js`; `index.js` ~1,780 lines (router vs handlers split).
- **`ONBOARDING-RUNBOOK.md` Step 3/4 are wrong** (record the Worker can't authenticate; wrong header) → rewritten in KV-Fix-2 around `POST /admin/api-client`.
- **Write-once chunks** (item below) → B12-3 with the session-token MAC. **250 GB Chartered claims ✓ corrected (MCP-Fix-1, 8 Oct):** `refueler-mcp-spec-v2.md` §7.1 (both copies) and the `capabilities.test.js` fixture now carry `max_transfer_bytes: 4294967296` = `CHARTERED_CAP_BYTES`; the Worker emits that field (needs deploy); the MCP README's receipt/webhook claims are marked not-live until API-Repair-1. **Carried:** `Share-Brand-Terminology.md` Chartered row at B12-4a.

**Added Share-Size-1 (6 Oct 2026):**
- **`/meta` hard-null** (tiny Worker session, from 13 Oct): `total_bytes: null` for every manifest. First check R2 for any manifest still carrying `total_bytes` with a future expiry (soak/test transfers may outlive 7 days). Then drop the `/meta` fallback in `download.js`.

**Added Share-Crypto-1 (7 Oct 2026):**
- **Remove old link format support on or after 12 Jan 2027** (v0/v1 links; small frontend session; brief off-repo). The MCP send tool makes only v2 from MCP-Fix-1 ✓, so the removal touches receivers only.

**Added MCP-Fix-1 (8 Oct 2026, Rajesh — after btc++ talks on Ark / Bark / Wavelength / fuzzing):**
- **Rail-Opus-1 — Ark / Wavelength evaluation. GATED BEFORE NB-2** (Opus, design only). NB-2 is the first recurring cost and the point of no return on "we run a Lightning node", so this is decided before it, not after. Wavelength (Lightning Labs, July 2026) is an Ark client + on-chain wallet with Lightning via Loop swaps, built for **agentic payments** — the same direction as the MCP work. Share is a **payee**, so the real B7 burden is inbound liquidity, and an Ark-style receive needs no channels. **The test is the one that eliminated Voltage:** a third party must never see user payment metadata. Two axes to separate explicitly in writing: (a) **treasury flow** — funding the node from a licensed exchange, Loop swap flow, LSP channel-level visibility. Acceptable: Refueler is a UK company and never claimed to be anonymous itself. (b) **user flow** — per-transfer payment metadata. Not acceptable to any third party, ever. Note phoenixd puts ACINQ in the position of sole peer with broad channel-level sight; that is (a), not (b), but it is written down, not assumed. Rajesh is content to use Loop swaps for agentic payments. Compliance detail → solicitor + MLRO, never on-repo ([[legal-review-status]]).
- **Fuzz-1 — fuzzing harnesses, then CI forever** (one bounded session; Sonnet). **Enforced, not remembered** — a monthly rota lapses the way commit-without-push did. Targets: the v2 fragment parser (strict parse must throw, never fall back to a legacy raw key), `/initiate` header parsing, the finalise body, `X-Test-Credential` (`testcred.js`). Property-based over a corpus; a crash is a red build. Raised because the btc++ fuzzing people made it look cheap, and it is.
- **Transparency-log design note — MMR + OTS** (Opus, design only; **after the B12 block**, does not jump B12). `merkle-spec-v1.md` already has MMR roots anchoring through the Share OTS relay, never a "smart contract". Security people at btc++ were impressed by the `.ots` use for file-transfer logging, so this is the thread with outside validation behind it. Honest scope stays: proves bytes existed on or before a block date; not authorship, not truth, not delivery.
- **MCP release article** (Notes). To accompany the eventual npm publish — not before docs are ready for users arriving from directories and GitHub. Angle (Rajesh's call, mine is the first): the OTS / transparency-log story, which is what security reviewers actually reacted to, rather than "we use OpenTimestamps". Editorial voice rules in CLAUDE.md apply — one punchy line maximum, let the tables persuade.
- **Statechain key handover: acknowledged as a trap, not a plan.** Spark/Mercury transfer a key with an operator who cannot steal and must delete its old share. For a *file* that protects future access only — the previous holder may already have downloaded and decrypted the bytes, and plaintext cannot be un-seen. If a re-assignable transfer is ever built, it ships with that sentence attached, like "ciphertext storage integrity ≠ end-to-end".
- **Unilateral exit is the gap Ark names.** Ark and Spark both guarantee the user gets their money out if the operator vanishes. Share has none: if Refueler disappears, the recipient loses the file. The OTS seal proves the bytes existed; it does not hand anyone the bytes. Strongest argument yet for the self-hostable node already on the roadmap.

**Added Share-Upload-2 (6 Oct 2026) — receiver page, agreed by Rajesh (order of value); A/B mock iterations first, then a download-side session:**
1. **"How this worked"** — quiet link under the ledger on the ready card *and* the finished screen, opens three lines: encrypted in the sender's browser before upload · the key was in your link and never sent to Refueler · (DAD only) the stored copy is now deleted. Facts on request, not a tagline (R-4 holds).
2. **Notes card unboxed** — hairline rule above the label instead of a box, so it reads as editorial, not an ad slot; the send line stays last.
3. **"Received" ledger row** on the finished screen — exact local date + time, labelled as the recipient's clock; nothing new reaches the Worker.

**Added Share-Upload-2 (6 Oct 2026):**
- **F-27 scroll ✓ Share-Upload-3** — Rajesh eyeballs it over a week of tests. Turnstile theme follows Carbon/Paper ✅ `fa3b2a1` (full width kept; height fixed at 65 px by Cloudflare). Download stop copy "Download failed. Please try again." is pre-redesign → download track (F-22) / Share-Receiver-3.
- **Share-Receiver-3 (own session, A/B brand mock rounds, Rajesh supplies references):** the three receiver items above, plus **link previews in mail apps** (Tutamail shows title + domain + R icon only; check Gmail, Apple Mail, Outlook, Proton, Signal/WhatsApp). One static preview for every link, DAD or not (the server can't know, and must not tell a mail provider which links are one-shot); a quiet `og:image` card + `og:description` **"A file sent with Refueler Share."** (Rajesh, 6 Oct: no "Open the link…" line, it reads like spam); the "works once" message belongs in the sender's own words (link-ready line). Invariant to keep: a page load never starts a download (mail scanners and preview bots open links). Also the receiver password input is 15 px (iOS zooms) → 16 px.
- **iOS folder picking** works via long-press in Files; "or a folder" stays on iOS (Rajesh).

**Ideas, parked (no build slot):**
- **S-039/S-040/S-096** `@handle.share` vanity handles / Chartered namespaces: a handle puts transfers "on the register", so Registered/Chartered only; squatting, routing and directory-leak questions open. Not in BRIDGE yet.
- **S-081** Recipient declaration at link creation: one person (keypair, ≤3 devices) / team (shared secret, counter) / one-time. UI says "access key". Overlaps B8 Mode 2.
- **S-098** Sovereign size obfuscation: pad the last chunk to a full 32 MiB. Needs an architecture + cost session first.
- **S-103** `cdk-dart` as a future mobile client.

**Resolved on import (repo wins):**
- **S-065** Lodge/Collect register stays for internal/whitepaper use; UI copy uses plain words (R-3 "Download", "lodged" dropped).
- **S-142** Harbourmaster = Chartered client surface at reduced resolution (B12 spec), never in the public menu. BRIDGE v9.6 "Navy Office view" wording is stale → next BRIDGE bump.
 
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
- **SW4-Opus:** Webhook signing: Option B (stateless, derived, never stored). `whsec_hash` removed. BRIDGE v8.8. (Derivation v2 at API-Repair-1: org-keyed HKDF.)
- **Share-MCP-Opus-2:** Capabilities endpoint locked (§7.1). Daily reference-rate KV locked. Monthly allocation + lazy reset locked. Personal API (£49/mo, 10k credits, `personal_api`, hard stop). D-1 filename fix: Option B, fragment grammar v1. Terminology: "credits" everywhere user-facing.
- **B9-Opus:** Merkle/MMR/SMT/ZK design locked. Full spec: `merkle-spec-v1.md`. Two-roots distinction permanent. RFC 6962 unbalanced BLAKE3 tree. Sidecar `{uuid}/hashes`. MLRO flag on due-diligence proof framing. BRIDGE v9.4.
- **B8-Opus:** NUT-11 Mode 2 (Locke) design locked. Full spec: `B8-spec-v1.md`. Deed→Locke HKDF derivation (scalar reject-sampled); Schnorr BIP-340 x-only verify; check order sig→BDHKE→double-spend; Locke KV challenge-response (SD3 primitive); `hashSecret()` unchanged/independent; CDK stays 0.17.2; builds direct in refueler-share (ecash-lab Mode 2 flag retired). BRIDGE v9.5.
- **Share-Dash-2 (18 Sep 2026):** Surface naming locked — **Navy Office** (admin/ops, Pepys/Seething Lane mnemonic), **Chambers** (Citizen/Sovereign account area — already theirs), **Custom House** (Chartered API/MCP, reserved — additive on upgrade, not a move), **Harbourmaster** (Execution Dock view inside Navy Office). `handleFinalise` folded to `handlers/finalise.js` with dock enrichment (size_bytes · rail · merkle_root stored, response-withheld until Share-6-5). Three new handlers: `client_errors_kv.js` · `api_stats.js` · `news_events.js`. `by_rail` `none` → renders as "Pro Bono" in dashboard (carry to Dash-3). sandbox_to_live stubbed honestly — wire when first Chartered client onboarded (add `live_at` to `sandbox_meta_` record). BRIDGE v9.6.
- **Share-B12 (24 Sep 2026):** Quota = occupancy (32 MiB chunks), credits = throughput, never merged. Supabase `reserve_quota` RPC at initiate, R2 manifests as truth, nightly reconcile. Harbourmaster = Chartered section set inside one Chambers build. PURGED status. Stripe Customer Portal is the only invoice surface. Full spec: `docs/B12-spec-v1.1.md`.
- **Share-B12-SR (24 Sep 2026):** Security review. Signed `content-length` on presigned URLs; one 6-day `UPLOAD_WINDOW` clock; bound in the session-token MAC; R2 conditional-put deletion latch; optimistic-concurrency reconcile; MAC'd test credentials; sealed `qref_ct` in manifests; per-entry sealed `org_dock` under `SHARE_SEAL_KEY_<kid>`; 128-bit lodgement handles; Harbourmaster shows daily 5 % bands; magic-link + Supabase sessions + `__Host-` cookie + CSRF for Registered rail only; Sovereign portability = Deed + user-held backup file / QR pairing with 6-digit check, Refueler never holds the blob. Cross-cutting X1–X6 (KV write-compromise, Bearer-rail Chartered, Harbourmaster naming, `dock_index` size leak, shared origin, client-chosen UUID). Full spec: `B12-SR-spec-v1.md` (root).
- **Share-B10-2 (24 Sep 2026):** Dashboard design decisions locked — see §User-facing dashboard design decisions above. Single-build progressive-unlock model for Chambers/Harbourmaster. Storage & Billing / Capacity scoping deferred to dedicated Opus session. BRIDGE v9.7.

*"Nothing stops this train."*

**Added B12-2 (8 Oct 2026):**
- **Navy-Office-Design-Opus → Navy-Office-Design-1** (Rajesh): bring the Share page's calm look to Navy Office — its fonts and Paper/Carbon tokens, a side panel that switches sections (Overview · Errors · Storage & Billing · API · Execution Dock) instead of one long wall of cards, room for a "deck" feel. Design session first, then build. Name stays **Execution Dock** (Rajesh, 8 Oct). **Folded in (Rajesh, 9 Oct): Growth Signal chart** — titled axes (credentials left, BTC/GBP right) with gridlines, compact Cloudflare-style tooltip, 24h/7d/30d/90d tabs (24h admin-only, never in client aggregates), four line colours checked in Paper and Carbon with the `dataviz` validator; bug: BTC/GBP drawn solid gold, legend says dashed grey. **Cache:** `/share/admin/*` gets the zone's 4 h browser TTL (B12-2 live check ran old JS on new HTML until ⌥⌘R) → Share-Cache-1 Cache Rule now covers `/share/admin/` ✅ (Rajesh, 8 Oct; live `max-age=0`). **Cache Reserve: no** — Pages has no egress to save, Share assets are `max-age=0` by design, and a persistent cache must never hold transfer bytes (DAD/expiry deletion promise).
- **Storage & Billing next pieces:** Soak line (`Soak: N live · X GiB`) once test transfers are marked by the MAC'd `X-Test-Credential` (B12-SR A8); self-cleared / purged weekly counts with `cargo.cleared` (B12 §2.4); capacity pressure, Chartered orgs and Citizen distribution light up with B12-3 quota accounts. Budget `R2_BUDGET_GIB` lives in `worker/wrangler.toml`; R2 price constants in `navy-office.js`.
- **KV error log** is still one key, read-modify-write, 500 entries (best effort). If real 4xx volume grows, per-entry keys or sample (see `client_errors_kv.js` header).
