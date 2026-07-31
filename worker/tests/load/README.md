# Load tests — refueler-share

k6 load test suite for the Cloudflare Worker. Four scripts covering the three
principal traffic types: credential issuance, upload, and download. Plus one
mixed-realistic baseline for alpha go/no-go (B11).

Current target: `wrangler dev --local` (local workerd). Thresholds are
local-tuned (`p(95)<500ms`). They tighten to `<150ms` when the B9 staging
environment exists and `BASE_URL` is pointed at it.

---

## Prerequisites

- Node 20+ (for `preissue-credentials.mjs`, `preload-transfers.mjs`,
  `start-mock.mjs`)
- k6 installed: `brew install k6` or https://k6.io/docs/get-started/installation/
- wrangler installed in the worker package: `cd worker && npm install`
- secp256k1 available: `cd worker && npm install` covers it

---

## Startup order — mandatory

**Never start wrangler before the mock.** If wrangler starts first, `SUPABASE_URL`
in `.dev.vars` still points at real Supabase, which local workerd cannot reach.
The mock patches `.dev.vars` first, so wrangler picks up the mock URL on boot.

```
Terminal 1   node worker/tests/load/start-mock.mjs
             (wait for "✓ Supabase mock running" before continuing)

Terminal 2   cd worker && npx wrangler dev --local --port 8787

Terminal 3   (data prep — see per-script instructions below)

Terminal 4   k6 run worker/tests/load/<script>.js
```

Ctrl+C Terminal 1 to stop the mock and restore `.dev.vars`. Ctrl+C Terminal 2
to stop wrangler. Do this between test runs to clear KV state.

---

## Scripts

### credential-burst.js

Rate limit validation for `POST /credential/issue` (10 req/60s per IP).

**Data prep:** none — this script issues credentials directly.

```
k6 run worker/tests/load/credential-burst.js
```

**What it proves:** The KV-backed sliding window holds at the 10/60s boundary
under concurrency. 429s are returned cleanly (no 5xx). The `http_req_failed`
threshold excludes tagged 429s.

---

### concurrent-transfers.js

50 VU concurrent uploads. 20 chunks × 50 VUs = 1,000 chunk PUTs.

**Data prep:**

```
node worker/tests/load/preissue-credentials.mjs
```

Writes `worker/tests/load/credentials.json`. Credentials are single-use —
re-run between k6 runs. Do not delay between prep and k6 run; credentials
have expiry.

```
k6 run worker/tests/load/concurrent-transfers.js
```

**What it proves:** BLAKE3 verify latency under concurrent load. KV byte-counter
accuracy (±1 byte). No credential cross-contamination between VUs. Each VU
injects a unique `CF-Connecting-IP` to give it its own rate-limit bucket.

---

### download-saturation.js

Two-scenario download stress test: distributed (each VU its own IP) and hammer
(all VUs share one IP, collapsing onto a single rate-limit bucket).

**Data prep:**

```
node worker/tests/load/preissue-credentials.mjs
node worker/tests/load/preload-transfers.mjs
```

Writes `worker/tests/load/transfers.json`. Transfers persist in local workerd
KV/R2 state between runs (until wrangler is restarted). No need to re-run
`preload-transfers.mjs` unless you restart wrangler.

```
k6 run worker/tests/load/download-saturation.js
```

**What it proves:** Bearer verification cost under sustained GETs (public
transfers — no bearer required). R2 proxy behaviour under 30 concurrent GETs.
Hammer scenario confirms 429s appear near the 300/60s ceiling and are tagged
correctly, not counted as failures.

**Scenarios:** `distributed_download` runs for 30s; `hammer_single_ip` starts
at 35s (5s gap) and runs for 30s. Total runtime ~65s.

---

### mixed-realistic.js

70% download / 25% upload / 5% credential issuance. 40 VUs for 60 seconds.
The alpha go/no-go baseline (B11).

**Data prep (both required):**

```
node worker/tests/load/preissue-credentials.mjs
node worker/tests/load/preload-transfers.mjs
```

```
k6 run worker/tests/load/mixed-realistic.js
```

**What it proves:** The system handles realistic traffic shapes without
degradation. VU allocation is by VU index: 1–28 download, 29–38 upload,
39–40 credential issue. Each VU has its own IP.

**Threshold rationale (alpha gate):** If `mixed_hard_failures > 0`, there is
a correctness regression — a 4xx or 5xx where none was expected. If
`mixed_download_latency_ms{p(95)} > 500ms` on local workerd, something is
wrong at the R2 proxy layer. Upload latency includes BLAKE3 verify cost,
hence the 600ms ceiling.

---

## Data files

| File | Produced by | Consumed by |
|------|------------|-------------|
| `credentials.json` | `preissue-credentials.mjs` | `concurrent-transfers.js`, `mixed-realistic.js` |
| `transfers.json` | `preload-transfers.mjs` | `download-saturation.js`, `mixed-realistic.js` |

Both files are `.gitignore`d — they contain live credentials and UUIDs.
Re-generate before each test run if wrangler has been restarted.

---

## Thresholds

| Metric | Local threshold | B9 staging threshold |
|--------|----------------|---------------------|
| `chunk_upload_latency_ms` p(95) | < 500ms | < 150ms |
| `chunk_download_latency_ms` p(95) | < 500ms | < 150ms |
| `mixed_download_latency_ms` p(95) | < 500ms | < 150ms |
| `mixed_upload_latency_ms` p(95) | < 600ms | < 200ms |
| `mixed_credential_latency_ms` p(95) | < 400ms | < 150ms |
| `chunks_failed_hard` | count == 0 | count == 0 |
| `mixed_hard_failures` | count == 0 | count == 0 |
| `http_req_failed{expected_response:true}` | rate < 1% | rate < 1% |
| `byte_counter_mismatches` | count == 0 | count == 0 |

429s are not failures. Every script tags expected 429s with
`responseCallback: http.expectedStatuses(200, 429)` and counts them
separately via custom metrics (`chunksRateLimited`, `rateLimitedTotal`).

---

## Reading a k6 result

After each run, k6 prints a summary. Look for:

- ✓ / ✗ on each threshold — ✗ means investigate before alpha
- `chunks_failed_hard` or `mixed_hard_failures` count > 0 — correctness issue
- `body_integrity_fails` > 0 — R2 returning empty bodies under load (real bug)
- `chunks_rate_limited` or `mixed_rate_limited` high in distributed scenarios —
  IP isolation may have broken; check the `CF-Connecting-IP` injection

The AE dashboard on `share.refueler.io/admin` shows the server-side view of
the same window. Discrepancy between k6 latency and AE p95 is itself a signal
(network overhead, wrangler proxy cost, etc.).

---

## Running against B9 staging

```
BASE_URL=https://refueler-share-staging.rt-fc4.workers.dev \
  k6 run worker/tests/load/mixed-realistic.js
```

No `start-mock.mjs` needed — staging uses the real Supabase project (staging
schema, not production). No `preissue-credentials.mjs` needed if you pass
`--env SKIP_PREISSUE=true` and point at a pre-seeded credentials file. See
B9 staging planning session for the full setup.

---

*"Nothing stops this train."*
