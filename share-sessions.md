# share-sessions.md — refueler-share
> Renamed from SESSIONS.md. Reference updated in CLAUDE.md.

---

## Sessions 1–15 — compact log

| # | Date | Type | Commit | Summary |
|---|------|------|--------|---------|
| 1 | 10 Jul | Planning | — | Architecture: token lifetime, upload model, NUT-11 P2SH, storage spec |
| 2 | 11 Jul | Build | `session-2-build` | Worker scaffold (3 endpoints), `frontend/index.html`, Supabase `spent_tokens` migration |
| 3 | 11 Jul | Build | `172a2e0` | NUT-11 Mode 1 passphrase gating (`nut11.js`, `manifest.js`), nav alignment |
| 4 | 11 Jul | Build | `42180c1` | Stripe products + prices (live, GBP), webhook, `subscribers` table, R2 buckets, Worker deployed |
| 5 | 12 Jul | Build | `9a5fdc1` | Turnstile widget, all 6 secrets set, Pages project, `share.refueler.io` CNAME live |
| 6 | 12 Jul | Debug | `458bc99` | `STRIPE_WEBHOOK_SECRET` rotated (exposed in git), smoke test stalled at Turnstile |
| 7 | 12 Jul | Debug | `3b9a9aa` | Visible Turnstile widget replacing invisible mode (Safari ITP fix) |
| 8 | 12 Jul | Debug | `0369dc8` | blake3-wasm local bundle (`frontend/blake3/`, force-committed), CDN confirmed broken |
| 9 | 13 Jul | Debug | (with S10) | `@noble/secp256k1` v2 API fix (`secp.ProjectivePoint`), `verifyChunkHash` → passthrough |
| 10 | 13 Jul | Debug | (with S9) | R2 binding `BUCKET`, credential `JSON.parse()`, CORS on catch, passphrase hash → SHA-256 |
| 11 | 13 Jul | Debug | `e50b58c`+`ec0c325` | Decrypt stall fixed (`startDownload` refactor), filename preservation. Full flow ✓ |
| 12 | 13 Jul | Infra | — | Stripe Customer Portal + Worker `/subscription/portal`, R2 lifecycle rules (both buckets) |
| 13 | 14 Jul | Design | — | `upgrade.html` full rebuild: Paper/Carbon tokens, Stripe remount, WORKER_URL fix |
| 14 | 14 Jul | Build | `f52b55f` | Eleventy 3.x scaffold: `src/` → `frontend/`, partials, `index.njk`, `upgrade.njk` |
| 15 | 14 Jul | Build | — | Block 1 completion (absorbed into S14 commit) |

**Do not retry (permanent):**
- blake3-wasm CDN (esm.sh 404, unpkg CORS blocked) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand
- `wrangler r2 bucket lifecycle get` — command is `list`

---

## Sessions 16–17 — KV status system + status page (14 July 2026)

**Commits:** grouped

**S16 — KV status system + maintenance banner:**
- KV namespace `refueler-share-kv` created (id `5b1dca6a8f06423f98d0bbc4286e2968`), binding `STATUS_KV`
- `GET /status` — reads `status:current` KV key, falls back to `{ state: 'operational' }`
- `POST /admin/status` — `X-Admin-Key` protected, merges partial patch
- `ADMIN_KEY` Worker secret set ✓
- Maintenance banner: sticky, dismissible via `sessionStorage`, polls `/status` on load
- Status schema: `{ state, message, maintenance: { scheduled_at, duration_minutes, description }, incidents[], updated_at }`

**S17 — `src/status.njk`:**
- Two-section page: ops layer (state card, maintenance window, incident list) + cryptographic integrity layer (6 cards)
- Auto-refresh 60s. Fetch failure → degraded state, never blocks UI
- No nav link — banner-linked only (`/status.html`)

**Do not retry:**
- DO NOT use `localStorage` for banner dismiss — `sessionStorage` only
- DO NOT add `status` to nav partial

**Files changed:** `worker/wrangler.toml`, `worker/src/index.js`, `src/_includes/shared-styles.njk`, `src/_includes/head.njk`, `src/_includes/nav.njk`, `src/status.njk`

---

## Session 18 — Analytics Engine instrumentation (14 July 2026)

**Commit:** pending (grouped with S19–S21)

**Completed:**
- AE dataset `share_events` declared in `wrangler.toml` (binding `AE`) — created on first write, no dashboard setup
- `logEvent(env, opts)` helper: `blobs[endpoint, tier, error_msg]` · `doubles[latency_ms, status_code, chunk_index, total_chunks, total_bytes]` · `indexes[endpoint]`
- `timed(endpoint, handler, logExtra)` router wrapper — measures latency, calls `logEvent` on success and throw
- All endpoints covered. `upload` logs tier + chunk metadata on chunk 0 only. `download` fires additional `download_tier` event on chunk 0.

**Do not retry:**
- DO NOT use pre-existing dataset ID — AE datasets created on first write
- DO NOT await `env.AE.writeDataPoint()` — synchronous, fire-and-forget
- DO NOT log `logEvent` inside `handleDownload` per-chunk — chunk-0 only

**Files changed:** `worker/src/index.js`, `worker/wrangler.toml`

---

## Sessions 19–21 — Supabase aggregation + crypto metrics + dashboard scaffold (14 July 2026)

**Commits:** pending (grouped)

**S19 — Supabase aggregation layer (`GET /admin/metrics`):**
- RLS deny-all policies added to `spent_tokens` + `subscribers` (was triggering Supabase security advisor alert)
- `cancelled_at TIMESTAMPTZ` added to `subscribers`
- `upsertSubscriber()` updated — writes `cancelled_at` on `customer.subscription.deleted`
- `GET /admin/metrics` (X-Admin-Key): MRR (floor), `subscribers_by_tier`, `paid_total`, churn rate MTD, `cancelled_mtd`
- Honest `_note` fields on every approximation

**S20 — R2 + crypto metrics:**
- Supabase table `double_spend_attempts` (`id`, `serial`, `uuid`, `attempted_at`) — RLS deny-all
- `handleUpload`: fire-and-forget write to `double_spend_attempts` on every 409
- `/admin/metrics` extended: `credential_uniqueness_rate` = `totalMelts / (totalMelts + totalAttempts)` via Supabase `Prefer: count=exact` header pattern. Metrics 3/5/6 stubbed null with AE SQL notes.
- refueler-ecash-lab flagged for NUT-11 Mode 2 / B8–B10 experimentation

**S21 — Dev dashboard scaffold:**
- `frontend/admin/dashboard.html` — self-contained, no build step
- Password gate: `sessionStorage`, probe-verified against `/admin/metrics`
- Live cards: MRR, paid total, churn MTD, tier breakdown, credential uniqueness rate
- Deferred cards: ZK rate (B4), credential issuances (S22), R2 bytes (S22/B4), chunk retrieval (S22)
- Auto-refresh 60s with countdown. 401 mid-session clears key + reloads.

**Do not retry:**
- DO NOT call Cloudflare AE SQL API from Worker — external REST API only, proxy via `/admin/ae-metrics`
- DO NOT use `service_role` key in RLS policies — bypasses RLS by design
- DO NOT use KV counter for double-spend tracking — race condition. Supabase table only.
- DO NOT await `double_spend_attempts` write — fire-and-forget only
- `spatial_ref_sys` RLS is `false` — PostGIS system table, leave alone

**Files changed:** `worker/src/index.js`, `frontend/admin/dashboard.html`, Supabase migrations: `rls_policies_and_cancelled_at`, `double_spend_attempts`

---

## Session 19-plan — Roadmap planning S19–S120 (14 July 2026)

**Type:** Planning session (uncounted).

- Full S19–S120 roadmap drafted: 82 core build sessions (B2–B12) + 20 buffer (S101–S120)
- Roadmap recorded in `Share-Master-Context.md` §Roadmap
- Critical chains: S34→S42→S78 (integrity) · S18→S24→S66 (dashboard) · S51→S58→S94 (CI) · S62→S64 (anon paid tier)
- Stripe test card: **4242 4242 4242 4242**

---

## Session 22 — AE SQL API integration (15 July 2026)

**Commit:** d1bcb5a + f36e385 (CORS fix)

**Completed:**
- `GET /admin/ae-metrics` — X-Admin-Key protected, proxies AE SQL server-side (CF_AE_TOKEN never touches browser)
- Secrets set: `CF_ACCOUNT_ID` (`fc4f3e5aeebe483677d14185daf544f5`) + `CF_AE_TOKEN` (scoped `Account Analytics > Read`)
- Three parallel AE queries via `Promise.allSettled`: credential issuances by tier (30d), R2 bytes uploaded (90d), chunk retrieval success rate (24h)
- `X-Admin-Key` added to CORS `Access-Control-Allow-Headers` — was silently blocking browser fetches
- Dashboard wired to `/admin/ae-metrics`

**Do not retry:**
- DO NOT reuse broad agent token for `CF_AE_TOKEN` — scoped read only
- DO NOT forget `X-Admin-Key` in CORS allowed headers

**Files changed:** `worker/src/index.js`, `frontend/admin/dashboard.html`

---

## Session 23 — AE SQL column syntax fix + latency + error rate (15 July 2026)

**Commit:** a4bc625

**Completed:**
- Fixed AE SQL 422: `doubles[N]`/`blob[N]` array syntax → named columns `double1`–`double5`, `blob1`–`blob3`
- Two new AE queries: p95/p99 latency per endpoint (24h) + 5xx error rate per endpoint (24h)
- Dashboard operational section un-deferred: p95/p99 latency /upload, p95/p99 latency /download, aggregate error rate
- Colour thresholds: latency green <200ms / amber <500ms / red over · error rate green 0% / amber <1% / red over

**Do not retry:**
- DO NOT use `doubles[N]` or `blob[N]` array syntax in AE SQL — use `double1`, `blob1` etc.

**Files changed:** `worker/src/index.js`, `frontend/admin/dashboard.html`

---

## Session 24 — /admin/snapshot endpoint + System Summary dashboard card (15 July 2026)

**Commit:** 5be5811

**Completed:**
- `handleAdminMetrics` refactored → delegates to `fetchMetricsData(env)` (plain object, not Response)
- `handleAdminAeMetrics` refactored → delegates to `fetchAeMetricsData(env)` (same pattern)
- `GET /admin/snapshot` — X-Admin-Key protected, calls both data functions in parallel, returns 6-field blob: `generated_at`, `mrr_gbp`, `paid_subscribers`, `credential_uniqueness_rate`, `p95_upload_latency_ms`, `p95_download_latency_ms`, `worker_error_rate`. No new queries.
- Dashboard: Investor Snapshot section (renamed System Summary in B5) with 6 metric tiles, colour coding, Copy JSON button, `generated_at` timestamp

**Do not retry:**
- DO NOT call `handleAdminMetrics`/`handleAdminAeMetrics` from snapshot — use inner data functions directly

**Dashboard design snag list (B5 — do not build in B2):**
- Rename "Investor Snapshot" → "System Summary"
- Satoshi font for all labels + values (Bunny Fonts)
- Increase all font sizes — readable at a glance on MacBook
- Copy JSON button → bottom-right of System Summary card
- Split p95/p99 latency → 4 separate cards (p95 upload, p99 upload, p95 download, p99 download)
- Sub-text minimum 13px
- Full editorial treatment (Paper/Carbon toggle, Source Serif 4) — review after Satoshi lands

**Files changed:** `worker/src/index.js`, `frontend/admin/dashboard.html`


## Session 25 — Free-to-paid conversion rate + dashboard restructure (15 July 2026)

**Commits:** S25 `fc6cba9` (worker + dashboard) · S25b `99afaaa` (dashboard restructure)

---

## Session 26 — Block 2 close (15 July 2026)

**Type:** Admin/handoff (no code changes)

**Completed:**
- Share-Master-Context.md updated to v2.1 (current state, 13-metric status, deferred latent items)
- share-sessions.md S26 entry added
- B3 scope confirmed (S27–S33 — Stripe test coverage)
- S27 opening prompt written

**Block 2 final state:** 10 of 13 metrics live. 3 metric IDs deferred (2 items: ZK/BLAKE3 → B4, Lightning mix → B7). No regressions.

**Do not retry:** nothing new this session.

---

*Next: **S27 — B3 Stripe test coverage begins***
*Attach: worker/src/index.js, worker/wrangler.toml, CLAUDE.md, Share-Master-Context.md, share-sessions.md*

**Completed:**
- `handleAdminMetrics` now calls `fetchAeMetricsData(env)` in parallel (same pattern as snapshot — no extra round-trip cost vs prior single-query path)
- `free_to_paid_conversion_rate` added to `/admin/metrics` response: `paid_total / total_credential_issuances_30d × 100`. Null-safe — falls back with AE error as note if AE query fails.
- `free_to_paid_conversion_issuances_30d` (denominator) and honest `_note` (snapshot rate caveat, true cohort deferred to B9) also returned.
- Dashboard: "Business Growth" section removed. Lightning vs Stripe mix deferred card moved into Revenue & Subscribers. Free-to-paid conversion merged into Paid subscribers card — free tier pill removed, conversion rate + issuance count rendered as sub-line below creative/max pills.
- `smokeTest()` console function added to dashboard — logs all 13 metrics with ✅/⏸/❌ and pass/deferred/fail tally.

**13-metric status at Block 2 close:**
- ✅ Live: 2 (token melt), 4 (credential uniqueness), 5 (R2 bytes), 6 (chunk retrieval), 7 (p95 latency), 8 (p99 latency), 9 (error rate), 11 (conversion), 12 (MRR), 13 (churn) — 10 metrics
- ⏸ Deferred: 1/3 (ZK/BLAKE3 — B4), 10 (Lightning mix — B7) — 2 metrics (mapped to 3 metric IDs)

**Do not retry:**
- DO NOT call `handleAdminMetrics`/`handleAdminAeMetrics` from conversion path — use inner data functions + parallel fetch
- DO NOT show free tier in paid subscribers pill breakdown — filter `t !== 'free'`

**Files changed:** `worker/src/index.js`, `frontend/admin/dashboard.html`
---

*Next: **S25 — free-to-paid conversion rate + 13-metric smoke test (Block 2)***
*Attach: worker/src/index.js, frontend/admin/dashboard.html, CLAUDE.md, Share-Master-Context.md, share-sessions.md*
