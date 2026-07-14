# SESSIONS.md — refueler-share

---

## Sessions 1–15 — compact log

| # | Date | Type | Commit | Summary |
|---|------|------|--------|---------|
| 1 | 10 Jul | Planning | — | Architecture: token lifetime, upload model, NUT-11 P2SH, storage spec |
| 2 | 11 Jul | Build | `session-2-build` | Worker scaffold (3 endpoints), `frontend/index.html`, Supabase `spent_tokens` migration, README fixes |
| 3 | 11 Jul | Build | `172a2e0` | NUT-11 Mode 1 passphrase gating (`nut11.js`, `manifest.js`), nav alignment |
| 4 | 11 Jul | Build | `42180c1` | Stripe products + prices (live, GBP), webhook, `subscribers` table, R2 buckets, Worker deployed, `upgrade.html` |
| 5 | 12 Jul | Build+Deploy | `9a5fdc1` | Turnstile widget, all 6 secrets set, Pages project, `share.refueler.io` CNAME live |
| 6 | 12 Jul | Debug | `458bc99` | `STRIPE_WEBHOOK_SECRET` rotated (exposed in git), smoke test stalled at Turnstile |
| 7 | 12 Jul | Debug | `3b9a9aa` | Visible Turnstile widget replacing invisible mode (Safari ITP fix) |
| 8 | 12 Jul | Debug | `0369dc8` | blake3-wasm local bundle (`frontend/blake3/`, force-committed), CDN confirmed broken, `TURNSTILE_SECRET_KEY` corrected |
| 9 | 13 Jul | Debug | (with S10) | `@noble/secp256k1` v2 API fix (`secp.ProjectivePoint`), `verifyChunkHash` → passthrough |
| 10 | 13 Jul | Debug | (with S9) | R2 binding `BUCKET`, credential `JSON.parse()`, CORS on catch, passphrase hash → SHA-256 |
| 11 | 13 Jul | Debug | `e50b58c`+`ec0c325` | Decrypt stall fixed (`startDownload` refactor), filename preservation end-to-end. Full flow ✓ |
| 12 | 13 Jul | Infra | (post-S11) | Stripe Customer Portal configured + Worker `/subscription/portal`, R2 lifecycle rules (both buckets) |
| 13 | 14 Jul | Design | S13 commit | `upgrade.html` full rebuild vs BRANDING.md: Paper/Carbon tokens, Stripe remount, WORKER_URL fix |
| 14 | 14 Jul | Build | `f52b55f` | Eleventy 3.x scaffold: `src/` → `frontend/`, partials, `index.njk`, `upgrade.njk`. Pages build config updated |
| 15 | 14 Jul | Build | — | Session 15 (no separate entry in prior SESSIONS.md — absorbed into Block 1 completion) |

**Do not retry (cross-session):**
- blake3-wasm CDN (esm.sh 404, unpkg CORS blocked) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand
- `wrangler r2 bucket lifecycle get` — command is `list`

---

## Session 16 — KV status system + maintenance banner (14 July 2026)

**Type:** Build session.
**Commit:** pending (grouped with S17)

### Completed

- KV namespace created: `refueler-share-kv` (id `5b1dca6a8f06423f98d0bbc4286e2968`)
- `wrangler.toml`: `[[kv_namespaces]]` binding `STATUS_KV` added
- Worker: `GET /status` endpoint — reads `status:current` KV key, falls back to `{ state: 'operational' }`
- Worker: `POST /admin/status` endpoint — `X-Admin-Key` protected, merges partial patch into existing state
- `ADMIN_KEY` Worker secret set ✓
- `shared-styles.njk`: maintenance banner CSS — sticky, dismissible, hidden by default
- `head.njk` / `nav.njk`: banner fetch logic — polls `/status` on load, reveals banner if `state !== 'operational'` or `maintenance` present, "View status →" link, `sessionStorage` dismiss
- Status state schema: `{ state, message, maintenance: { scheduled_at, duration_minutes, description }, incidents[], updated_at }`

### Do not retry

- DO NOT use `localStorage` for banner dismiss — `sessionStorage` only

### Files changed

- `worker/wrangler.toml` — KV binding
- `worker/src/index.js` — GET /status, POST /admin/status handlers
- `src/_includes/shared-styles.njk` — banner CSS
- `src/_includes/head.njk` — banner fetch + reveal logic
- `src/_includes/nav.njk` — banner element

---

## Session 17 — status.njk (14 July 2026)

**Type:** Build session.
**Commit:** pending

### Completed

- `src/status.njk` built — two-section status page:
  - **Ops layer**: state card (operational / degraded / maintenance), maintenance window block, incident list
  - **Cryptographic integrity layer**: 6 cards — zero-knowledge guarantee, anonymous auth (NUT-00), chunk integrity (BLAKE3), passphrase gating (NUT-11 Mode 1), server-side chunk verification gap (amber, honest disclosure), storage ephemerality (R2 lifecycle)
- State card uses CSS `color-mix()` tinted backgrounds + pulsing dot animation for degraded and maintenance states
- Incident list: severity badge, resolved badge, timeline, per-update log — sorted most-recent-first
- Maintenance window block: hidden when `maintenance: null`, revealed with formatted datetime + duration
- All user-facing strings HTML-escaped before render
- Auto-refresh every 60 s
- Fetch failure path: Worker unreachable → degraded state card + error note, never blocks UI
- Eleventy front matter: `permalink: /status.html`, `activePage: ""`
- No nav link — status page is banner-linked only

### Do not retry

- DO NOT add `status` to nav partial — banner-linked only
- DO NOT use `localStorage` for dismiss — `sessionStorage` only

### Files changed

- `src/status.njk` — new file

---

## Session 18 — Analytics Engine instrumentation (14 July 2026)

**Type:** Build session.
**Commit:** pending

### Completed

- Analytics Engine dataset `share_events` declared in `wrangler.toml` (binding `AE`)
  - Dataset created automatically on first `writeDataPoint` — no Cloudflare Dashboard setup required
- `logEvent(env, opts)` helper added to `index.js`:
  - **blobs[0]**: endpoint name (`upload`, `download`, `credential_issue`, `auth`, `download_tier`, etc.)
  - **blobs[1]**: tier (`free` / `creative` / `max`)
  - **blobs[2]**: error message (empty string on success)
  - **doubles[0]**: latency_ms (float, `performance.now()` delta)
  - **doubles[1]**: HTTP status code
  - **doubles[2]**: chunk_index (-1 for non-chunk endpoints)
  - **doubles[3]**: total_chunks (chunk 0 upload only, else 0)
  - **doubles[4]**: total_bytes (chunk 0 upload only, else 0)
  - **indexes[0]**: endpoint (enables fast `GROUP BY` in AE SQL)
  - Non-fatal: `if (!env.AE) return` guards local dev; write errors are caught and logged, never bubble
- `timed(endpoint, handler, logExtra)` wrapper in the router — wraps every handler call, measures `performance.now()` delta, calls `logEvent` on both success and throw paths
- Every endpoint covered: `status`, `admin_status`, `credential_issue`, `upload`, `auth`, `download`, `webhook_stripe`, `subscription_checkout`, `subscription_status`, `subscription_portal`
- `upload` logs: tier (from `X-Tier` header), chunkIndex, totalChunks + totalBytes on chunk 0 only
- `credential_issue` logs: tier (from cloned request body)
- `download` additional `download_tier` event on chunk 0: tier + totalChunks + totalBytes from manifest (only place tier is known for downloads)
- Top-level `catch` block also calls `logEvent` with `endpoint: 'unhandled'`
- 404 path logs `endpoint: 'unknown'`

### Metrics now capturable via AE SQL API

```sql
-- p95/p99 latency per endpoint (rolling 24h)
SELECT blob1 AS endpoint,
       quantilesMerge(0.95)(doubles[0]) AS p95_ms,
       quantilesMerge(0.99)(doubles[0]) AS p99_ms
FROM share_events
WHERE timestamp > now() - INTERVAL '1' DAY
GROUP BY endpoint;

-- Error rate per endpoint
SELECT blob1 AS endpoint,
       countIf(doubles[1] >= 500) / count() AS error_rate
FROM share_events
WHERE timestamp > now() - INTERVAL '1' DAY
GROUP BY endpoint;

-- Transfer volume by tier (uploads, chunk 0 only)
SELECT blob2 AS tier,
       count() AS uploads,
       sum(doubles[4]) AS total_bytes
FROM share_events
WHERE blob1 = 'upload' AND doubles[2] = 0
GROUP BY tier;

-- Credential issuance count by tier
SELECT blob2 AS tier, count() AS issued
FROM share_events
WHERE blob1 = 'credential_issue'
GROUP BY tier;
```

### Do not retry

- DO NOT use `[[analytics_engine_datasets]]` with a pre-existing dataset ID — AE datasets are created on first write, no ID needed
- DO NOT await `env.AE.writeDataPoint()` — it is synchronous (fire-and-forget)
- DO NOT put `logEvent` calls inside `handleDownload` for every chunk — tier logging is chunk-0 only (`download_tier` event), latency per-chunk comes from the router `timed()` wrapper

### Files changed

- `worker/src/index.js` — `logEvent` helper + `timed` router wrapper + `download_tier` event in `handleDownload`
- `worker/wrangler.toml` — `[[analytics_engine_datasets]]` binding `AE`, dataset `share_events`

---

## Session 19 — Supabase aggregation layer (14 July 2026)

**Type:** Build session (Block 2 — Instrumentation completion).
**Commit:** pending

### Completed

- RLS deny-all policies added to `spent_tokens` and `subscribers` — explicit `RESTRICTIVE` policies for `anon` and `authenticated` roles. RLS was already enabled; missing policies were triggering Supabase security advisor critical alert. `service_role` (Worker) bypasses RLS — zero functional impact.
- `cancelled_at TIMESTAMPTZ` column added to `subscribers` via MCP migration.
- `upsertSubscriber()` — new `cancelledAt` parameter; written to `cancelled_at` on `customer.subscription.deleted` Stripe event.
- `GET /admin/metrics` — new `X-Admin-Key` protected endpoint:
  - **MRR (GBP)** — sum of monthly-equivalent floor prices for active paid subscribers (creative: £12, max: £24). Conservative floor — yearly subscribers under-counted; accurate interval-aware MRR deferred to dashboard layer (S22).
  - **`subscribers_by_tier`** — `{ free, creative, max }` active counts.
  - **`paid_total`** — active creative + max count.
  - **Churn rate MTD** — `cancelled_mtd ÷ active_start_of_month_approx` as %. Approximation: active_now + cancelled_mtd. Under-counts if subscriber signed up and cancelled within same calendar month.
  - **`cancelled_mtd`** — raw cancellation count since start of current calendar month.
  - **`credential_issuances: null`** — AE SQL API not callable from Worker binding; computed in dashboard layer (S22).
  - Honest `_note` fields embedded in JSON response for every approximation.
- Router: `admin_metrics` added to `timed()` wrapper.

### Do not retry

- DO NOT attempt to call Cloudflare AE SQL API from within the Worker — it is an external REST API requiring an account token, not a Worker binding. `credential_issuances` stays `null` until S22.
- DO NOT use `service_role` key in RLS policies — it bypasses RLS by design, no policy needed.
- `spatial_ref_sys` RLS is `false` — PostGIS system table, not ours, leave alone.

### Files changed

- `worker/src/index.js` — `handleAdminMetrics`, updated `upsertSubscriber`, router route
- Supabase migration `rls_policies_and_cancelled_at` — applied via MCP

---

## Session 19 — Roadmap planning S19–S120 (14 July 2026)

**Type:** Planning session (uncounted — does not consume a build session number).
**Commit:** pending

### Completed

- Full S19–S120 roadmap drafted: 82 core build sessions across Blocks 2–12, buffer S101–S120 (20 sessions)
- Planning sessions are uncounted by convention — next build session is **S19**
- Roadmap recorded in full in `Share-Master-Context.md` §Roadmap (v1.6)
- `CLAUDE.md` §Session queue updated to reference roadmap location
- Block order rationale: instrumentation first (data from day one) → Stripe test coverage → security hardening (BLAKE3 WASM unblocks integrity claims) → design → testing infra → Lightning → Mode 2 → docs → enterprise → beta → launch

### Block summary

| Block | Sessions | Scope |
|---|---|---|
| B2 Instrumentation completion | S19–S26 | Supabase aggregation, R2 + crypto metrics, /admin/metrics, dev dashboard, investor snapshot, 13-metric smoke test |
| B3 Stripe test coverage | S27–S33 | 4242 card, webhook replay, cancellation, portal, failed payment/dunning, edge cases |
| B4 Security hardening | S34–S42 | BLAKE3 Worker WASM, AAD ≥256 fix, rate limiting, CSP, audits, integrity gap card → green |
| B5 Design full pass | S43–S50 | Progress bar, Turnstile placement, QR/copy, FREE_EXPIRY, theme cookie, shared nav, brand audit |
| B6 Testing infra | S51–S58 | Vitest workers pool, unit tests, integration harness, Playwright E2E, GitHub Actions CI |
| B7 Lightning/Blink | S59–S68 | Invoice endpoint, settlement, credential-on-settlement, anonymous paid tier, Lightning tab, real-sats E2E |
| B8 NUT-11 Mode 2 | S69–S76 | Keypair challenge-response, manifest v2, Prod Max gating, tests |
| B9 Documentation | S77–S82 | README, security whitepaper (unblocked by S42), API docs, help/FAQ, ToS/privacy |
| B10 Enterprise groundwork | S83–S90 | Org/seat schema, custom caps, Stripe invoicing, admin provisioning, ML-KEM spike |
| B11 Beta prep | S91–S98 | Week 0 alpha, load test, incident runbook, onboarding, feedback loop, go/no-go |
| B12 Launch | S99–S100 | Public beta launch + stabilization |
| Buffer | S101–S120 | Unallocated — drawn on block overrun, logged here immediately |

### Critical dependency chains

- S34→S35→S37→S42→S78 — BLAKE3 Worker WASM → integrity claims → whitepaper (longest lead-time chain)
- S18→S22→S24→S49/S66 — instrumentation → dashboard → brand + settlement metric
- S51→S55→S58→S94 — test infra → CI → load test
- S62→S63→S64 — Lightning settlement → anonymous paid tier (highest design risk in plan)

### Do not retry

- Stripe test card is **4242 4242 4242 4242** — not 4444
- DO NOT number planning sessions — they are uncounted by convention

### Files changed

- `SESSIONS.md` — this entry
- `Share-Master-Context.md` — v1.6, §Roadmap added, §Current state updated
- `CLAUDE.md` — §Session queue updated

---

*Next build session: **S19 — Supabase aggregation layer** (Block 2)*
*Attach: worker/src/index.js, worker/wrangler.toml, CLAUDE.md, Share-Master-Context.md, SESSIONS.md*
