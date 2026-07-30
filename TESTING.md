# TESTING.md — refueler-share
> **Version:** v0.3 | **Created:** S63 · 27 July 2026 | **Updated:** AP-3a · 30 July 2026
> Canonical testing architecture for `rajesh-taylor/refueler-share`.
> Referenced in investor due diligence and cited in the B9 security whitepaper.

---

## 1. Overview

This document is the single source of truth for how refueler-share is tested: what is covered today, what is not, and the plan to close every gap block by block through public beta (B12) and beyond.

**When to load:** at the start of any session touching unit tests, integration tests, load tests, CI, the staging environment, or the B9 security whitepaper. Do not load by default — this is reference material, not working memory.

**Relationship to other context files:**

| File | Role |
|------|------|
| `CLAUDE.md` | Repo identity, architectural locks, session hygiene rules |
| `Share-Master-Context.md` | Stack, roadmap, current state, do-not-retry ledger |
| `share-sessions.md` | Session-by-session build log |
| `TESTING.md` (this file) | Testing architecture — what is proven, how, and what remains |

Nothing in this document overrides an architectural lock in `CLAUDE.md`. Where a test reveals that a lock is wrong, the lock is amended first, then the test.

---

## 2. Current test suite

**178 unit tests passing across 6 Vitest suites** (Vitest 2, `worker/tests/unit/`):

| Suite | Tests | Covers |
|-------|-------|--------|
| `ratelimit.test.js` | 18 | KV-backed sliding window logic, limit boundaries, per-endpoint configs, `{ limited }` return shape |
| `manifest.test.js` | 25 | Manifest schema validation, 64 KB ceiling, expiry windows, `safeGetManifest` guards |
| `nut00.test.js` | 30 | Full BDHKE round-trip, blinding privacy guarantee (same secret + different r → same C), `verifyCredential`, `tokenSerial`, error paths |
| `blake3.test.js` | 27 | Hash correctness against `@noble/hashes/blake3` reference, input validation, constant-time comparison, null-guard error handling |
| `turnstile.test.js` | 34 | Input guards, CF success/failure paths, HTTP errors, malformed JSON, fail-closed behaviour |
| `stripe.test.js` | 44 | HMAC-SHA256 webhook signature verification, ±300s replay window, body tampering detection, checkout customer find-or-create, tier routing across all 6 live lookup keys (monthly, 3-month, yearly × 2 tiers) |

**Honest assessment — what these tests prove:** the pure logic of each module is correct in isolation. Signature maths, hash comparison, rate limit arithmetic, webhook verification, and input validation all behave as specified when their dependencies are mocked.

**What they do not prove — the seams:**

1. **R2 and KV behaviour.** Every CF primitive is mocked. Eventual consistency of KV, R2 conditional writes, 64 KB manifest reads against real storage — untested.
2. **BLAKE3 WASM in the CF runtime.** Unit tests substitute `@noble/hashes/blake3` for the WASM module. The actual `worker/blake3-wasm/` bundle instantiating and verifying inside workerd — untested.
3. **The credential→upload chain.** NUT-00 issuance, melt (NUT-07), and chunk upload are each tested alone. The full sequence — Turnstile → `/credential/issue` → melt on first chunk → tier cap enforcement — has never run end-to-end under test.
4. **Stripe webhook → Supabase.** Signature verification is proven; the resulting upsert into `subscribers` (with `?on_conflict=stripe_customer_id`) is not exercised against anything.
5. **HTTP routing.** `index.js` route dispatch, CORS, auth header extraction, and the `timed()` wrapper have zero coverage. A route regression would pass all 178 tests.

These five seams are exactly what the integration harness (§3) exists to close.

---

## 3. Integration test harness

**Built at S64. Runs against `wrangler dev --local` (Option B — locked).** Local workerd with local R2/KV simulation: real runtime semantics, no cloud spend, no production data risk.

### Configuration

- `worker/vitest.config.integration.js` — separate config from unit tests. Integration tests never run in the default `npm test` path; invoked explicitly via `npm run test:integration`.
- Setup file boots `wrangler dev --local --persist-to=.wrangler-test-state` as a child process, polls `/status` until ready, tears down after the suite.
- Env: dev bucket bindings only. `SUPABASE_URL` points at a mock HTTP server (see fixtures) — integration tests never touch the live Supabase project.

### HTTP client helper — `worker/tests/integration/client.js`

Thin fetch wrapper against the local Worker:

- `client.issueCredential(turnstileToken)` → parsed credential
- `client.uploadChunk(uuid, index, bytes, headers)` → response
- `client.putManifest(uuid, manifest)` / `client.auth(uuid, passphrase)` / `client.downloadChunk(uuid, index, bearer)`
- Every method returns `{ status, headers, body }` — assertions stay in tests, not the client.

### Clean state between tests

`--persist-to` a throwaway directory, wiped in `beforeEach` via a test-only reset. Because production code must not contain test hooks, state reset is done by deleting the persist directory and using fresh UUIDs per test — UUID namespacing gives isolation without a reset endpoint.

### Core test designs

**Full upload→download round-trip (`round-trip.test.js`):**

1. Issue credential (mocked Turnstile verify — fixture returns success). Assert: valid NUT-00 credential, Worker-generated UUID present.
2. AES-GCM encrypt a 3-chunk test payload client-side in the test (Web Crypto in Node 20+). Compute BLAKE3 hash per chunk.
3. PUT chunks 0–2 with correct hashes and AAD (`DataView.setUint32`). Assert: 200 each; chunk 0 passes MIME gate with `application/octet-stream`.
4. PUT manifest. Assert: 200, manifest readable via meta path with `total_chunks` present.
5. GET each chunk. Assert: 200, bytes identical to uploaded ciphertext.
6. Decrypt and reassemble. Assert: plaintext matches original — proving the Worker stored noise without corruption.
7. Negative: PUT a chunk with a deliberately wrong declared BLAKE3 hash. Assert: 400 (the S34 integrity claim, exercised against real WASM in workerd).

**Passphrase-protected variant:** same flow with `p2sh_secret_hash` in the manifest. Assert: `/download` without bearer → 401; `/auth` with wrong passphrase → 401; correct passphrase → bearer token with `exp === manifest.expiry_timestamp` (S58 fix, regression-locked); download with bearer → 200.

**Double-spend rejection:** issue one credential, complete first-chunk melt, attempt a second upload with the same credential. Assert: rejection, and the mock Supabase server records both the `spent_tokens` insert and the `double_spend_attempts` fire-and-forget write.

**Planning session required — none.** S64 architecture was locked at S63. Build proceeds directly.

---

## 4. Fixture factory architecture

**Location: `worker/tests/integration/fixtures/` — locked.**

Rationale: fixtures are shared between Vitest integration tests and k6 load scripts. k6 runs its own JS runtime (not Node) and cannot import Vitest-specific code. Therefore:

- Fixture files are **pure ESM with zero imports from vitest, node built-ins, or CF types**. Plain functions and data.
- Anything Vitest-specific (mocks, `vi.fn`) lives in the test files or a `helpers/` sibling directory — never in `fixtures/`.

### Factories needed now (S64–S66)

| Factory | Produces |
|---------|----------|
| `credential.js` | Valid/expired/malformed NUT-00 credential payloads; blinding helpers |
| `chunks.js` | Deterministic pseudo-random chunk bytes + matching BLAKE3 hashes; wrong-hash variants |
| `manifest.js` | Valid manifests per tier; oversize (>64 KB); expired; passphrase-protected |
| `turnstile-mock.js` | Mock verify server responses (success, expired, already-used) |
| `supabase-mock.js` | In-memory HTTP server implementing the PostgREST subset the Worker uses (upsert with on_conflict, count headers, 409 on duplicate serial) |
| `stripe-events.js` | Signed webhook payloads for all 3 subscribed event types, with valid/invalid/stale signatures |

### Future blocks

- B7: `lightning.js` — Blink callback payloads, payment-hash KV entries, invoice fixtures
- B8: `keypair.js` — NUT-11 Mode 2 keypairs, challenge-response transcripts
- B9: `lnurl.js` — LNURL-withdraw callback fixtures
- B10: `mlkem-vectors.js` — ML-KEM known-answer test vectors

---

## 5. Security regression suite

**`worker/tests/integration/security.test.js` — foundation at S66b (buffer session).** Every closed vulnerability from B4 becomes a permanent executable regression test. This file is the machine-checkable half of the B9 whitepaper: the whitepaper claims it, this file proves it on every CI run.

### Claim → test mapping

| Claim (whitepaper §) | Origin | Test name | What it proves |
|----------------------|--------|-----------|----------------|
| Server-side BLAKE3 chunk integrity | S34 | `rejects chunk with mismatched BLAKE3 hash (400)` | Malicious client cannot store data under a false hash |
| AAD overflow closed | S35 | `accepts chunk index 256+ with 4-byte AAD` | `DataView.setUint32` AAD; the `Uint8Array([i])` overflow cannot recur |
| Double-spend rejection | S20/B4 | `rejects reuse of melted credential; logs attempt` | Supabase serial ledger blocks replay; attempt is recorded |
| Credential farming defence | S42c/S42d | `rejects credential for foreign UUID` · `rejects reused Turnstile nonce` | UUID binding + nonce binding close cross-transfer farming |
| Rate limit enforcement | S36/S42b | `returns 429 at limit+1 on credential_issue` (and per-endpoint variants) | KV limits hold at exact boundaries; 429s emitted |
| MIME denylist | S40 | `rejects denylisted Content-Type on chunk 0 (415)` · `ignores gate on chunk >0` | Execution-capable types blocked at declared-intent boundary, chunk-0 scope respected |
| UUID validation | S41 | `rejects non-RFC4122 UUID in upload path` | Path traversal / key-forgery via malformed UUIDs closed |
| Chunk bounds | S41/S42b | `rejects chunk index beyond declared total` | Storage-stuffing beyond manifest bounds closed |
| Bearer token scope | S58 | `bearer token exp equals manifest expiry; expired token rejected` | Token lifetime bound to transfer, not hardcoded |

Rule: **no security fix ships in future blocks without a row added to this table and a test added to this file.** The table is copied verbatim into whitepaper §Evidence at B9.

---

## 6. k6 load testing

**S68–S69. k6 chosen (locked).**

**Planning session required — "S68-plan: k6 architecture"** (uncounted). Load profiles, thresholds, and the local-vs-staging target decision are consequential enough to lock before code. The notes below are the starting position for that session, not final.

### Relationship to the integration harness

k6 scripts live in `worker/tests/load/` and import chunk/credential factories from `worker/tests/integration/fixtures/` directly — this is why fixtures are runtime-agnostic (§4). One definition of "a valid upload" shared by correctness tests and load tests.

### Draft load profiles

| Profile | Shape | Validates |
|---------|-------|-----------|
| Credential issuance burst | Ramp to the 10/60s limit, then 3× over | Rate limiter holds under concurrency; 429s clean, no KV races |
| 50 concurrent transfers | 50 VUs, full upload of 20-chunk transfers | Chunk throughput, BLAKE3 verify latency under load, KV byte-counter accuracy |
| Download saturation | Sustained GETs approaching 300/60s | Bearer verification cost, R2 proxy behaviour |
| Mixed realistic | 70% download / 25% upload / 5% credential | Baseline for alpha go/no-go (B11) |

### Targets

- S68–S69 run against `wrangler dev --local` — validates logic under concurrency, not real edge latency.
- Real-latency load runs move to **staging** (§8) once it exists at B9; production is never load-tested.

### k6 metrics vs AE

k6 captures the **client side**: request latency distributions, error rates, throughput per VU, threshold pass/fail. AE already captures the **server side**: per-endpoint p95/p99, 429s, error events. A load run is read as a pair — k6 report + AE dashboard over the same window. k6 does not duplicate AE; discrepancy between the two is itself a finding.

---

## 7. CI/CD maturity levels

| Level | Sessions | Gate |
|-------|----------|------|
| **Level 1** | S70–S71 (B6) | On every push: Eleventy build check, `wrangler deploy --dry-run`, lint, full unit suite. Red = do not deploy. |
| **Level 2** | B7–B8 | Integration suite (wrangler dev --local inside GitHub Actions) as a **pre-deploy gate**, including `security.test.js`. Lightning and NUT-11 Mode 2 work lands only behind a green integration run. |
| **Level 3** | B9–B10 | Deploy to staging → automated smoke test (credential → upload → download against staging) → JSON reporter results POSTed to Worker KV → dashboard card (§9). Manual promote to production. |

Workflows live in `.github/workflows/`. Secrets required at Level 1: none beyond a CF API token for dry-run. Level 3 adds staging deploy credentials and `ADMIN_KEY` for the KV POST.

---

## 8. Staging environment

**B9 scope. `refueler-share-staging` Worker + `refueler-share-dev` R2 + a dedicated staging KV namespace.**

**Planning session required — "B9-plan: staging environment"** (uncounted). Dual use raises questions (data retention on a demo box, Turnstile keys, Supabase separation) that must be locked before build.

### Configuration deltas from production

| Concern | Production | Staging |
|---------|-----------|---------|
| R2 | `refueler-share-prod` | `refueler-share-dev`, aggressive lifecycle expiry (1 day) |
| Supabase | `tihgvdokeofnjxjkenmm` | Separate free-tier project or schema — staging never writes production ledger |
| Stripe | Live keys | Test keys only |
| Lightning | Blink live | Blink test/regtest path per B9 planning |
| Turnstile | Production sitekey | Separate sitekey, or test-mode always-pass key for CI smoke |
| Secrets | Production set | Fully parallel set — zero shared secrets |

### Dual use: demo environment

Staging doubles as the demonstration target for **BlackMagic Design outreach** and **btc++ Berlin** (early October 2026). A demo is a full-stack transfer on real edge infrastructure without touching production data or metrics. Consequence: staging must be presentable (same frontend build, Paper/Carbon intact) and stable during demo windows — CI deploys to staging pause during a flagged demo freeze (simple KV flag, checked by the workflow).

### CI integration

Level 3 pipeline: merge → deploy staging → smoke test → results to KV → manual production promote. Staging is the only environment CI ever deploys to automatically.

---

## 9. Dashboard integration

**B10–B11 scope.** Flow:

```
Vitest JSON reporter → GitHub Actions step → POST /admin/test-results (X-Admin-Key)
  → STATUS_KV key `test_results_latest` → dashboard card (60s refresh)
```

### Card contents

- Last run timestamp + commit short-hash
- Pass/fail counts per suite (unit / integration / security)
- **Names of failing tests** — a failing security regression is displayed by name, not as a count
- Staging smoke test status (Level 3)

### "System health" unified view

The test card sits alongside existing operational metrics (AE error rates, p95/p99 latency, 429 counts) in a single dashboard section answering one question: *is the system behaving as proven?* Left column: what CI proved at last deploy. Right column: what production is doing now. Divergence between the two is the alerting signal that matters.

New endpoint required: `POST /admin/test-results` (X-Admin-Key, KV write, ~20 lines) — scheduled with the dashboard test card at B11.

---

## 10. Whitepaper evidence trail

The B9 whitepaper makes integrity claims; this section is the audit path from each claim to executable proof. **Structure: claim → test file → test name → what it proves.** Written so a technical auditor can verify claims without reading the production codebase — run the suite, read the assertions.

| # | Claim | Test file | Test name(s) | What it proves |
|---|-------|-----------|--------------|----------------|
| 1 | Every uploaded chunk is BLAKE3-verified server-side; mismatches rejected | `unit/blake3.test.js` + `integration/security.test.js` | `verifyChunkHash matches reference implementation` · `rejects chunk with mismatched BLAKE3 hash (400)` | Hash function correctness against an independent implementation, and enforcement in the real Worker runtime |
| 2 | NUT-00 blind signatures are cryptographically correct and unlinkable | `unit/nut00.test.js` | `full BDHKE round-trip verifies` · `same secret with different blinding factors yields same C` | Signature validity and the blinding privacy guarantee — the mint cannot link issuance to redemption |
| 3 | A credential cannot be spent twice | `integration/security.test.js` | `rejects reuse of melted credential; logs attempt` | Supabase serial ledger enforces single-use; attempts are recorded |
| 4 | All public endpoints are rate-limited | `unit/ratelimit.test.js` + `integration/security.test.js` | boundary tests per endpoint · `returns 429 at limit+1` | Limits hold at exact boundaries under the real KV path |
| 5 | Credentials are bound to a Worker-generated UUID | `integration/security.test.js` | `rejects credential for foreign UUID` | Cross-transfer credential farming is closed without identity linkage |
| 6 | Execution-capable uploads are refused at the boundary | `integration/security.test.js` | `rejects denylisted Content-Type on chunk 0 (415)` | Declared-intent MIME gate enforced, correctly scoped to chunk 0 |
| 7 | Webhook payloads are authenticated and replay-protected | `unit/stripe.test.js` | `rejects invalid HMAC signature` · `rejects timestamp outside ±300s` | Stripe events cannot be forged or replayed |

**Scope honesty (mirrors CLAUDE.md marketing rulings):** this trail proves server-side *chunk* integrity, not end-to-end file integrity — full Merkle root verification is unimplemented until B9 and no test claims otherwise. Rows are added for NUT-11 Mode 2 (B8), Merkle verification (B9), and ML-KEM (B10) when those tests exist — never before.

---

## 11. Per-block harness extension plan

Target cost per block: **half a session** of test-harness work, budgeted inside the block's existing sessions.

| Block | Harness additions | Where |
|-------|-------------------|-------|
| B7 | Blink webhook fixture (callback payloads, double-fire dedup case), payment-hash KV fixture, credential poll helper on `client.js`; security rows: webhook replay, double-issuance | S83/S83a audit sessions |
| SW | `webhooks.js` fixture (signed event payloads, valid/invalid/stale `rfs_whsec_` signatures, dead-letter KV entries). Integration tests: HMAC auth boundary (valid/tampered/missing/stale), quota 402 enforcement, `wl_config` fail-safe (`badge: true` on missing key), key-rotation 24h grace window, webhook delivery retry sequence, dead-letter creation. Whitepaper row: "API requests are HMAC-authenticated and replay-protected." | SW2/SW4 build sessions + SW9 close |
| B8 | Keypair fixture, NUT-11 Mode 2 challenge-response integration test; security row: keypair auth cannot be bypassed via Mode 1 path | Inside B8 build sessions |
| B9 | Mock LNURL callback server fixture, LNURL-withdraw credential delivery round-trip test; Merkle verification tests + whitepaper rows | Dedicated: whitepaper evidence assembly |
| B10 | ML-KEM known-answer vectors, key-wrapping round-trip; chaos test foundation (§12) | Inside B10 spike |
| B11 | Alpha smoke script (production-safe read-only checks), dashboard test card + `/admin/test-results` endpoint | S119+ |

---

## 12. Long-horizon architecture (12–24 months)

Not scheduled — recorded so near-term decisions do not foreclose them.

- **Contract tests (Pact or similar):** once the API surface stabilises post-B12, frontend↔Worker contract tests replace some integration coverage and protect external integrators (enterprise, B10+). Premature before the Lightning endpoints settle.
- **Chaos / fault injection:** scripted failure of each dependency — KV read errors (must fail open on nonce, closed on Turnstile), R2 unavailability, Supabase down (log-and-continue on melt ledger), Blink outage (Fallback 1/2 within target windows). The graceful-degradation claims in Share-Master-Context.md become tests. Foundation at B10.
- **Multi-region considerations:** Workers are already global; the risks are KV eventual-consistency windows on rate limits and R2 single-region latency. If R2 multi-region lands, chunk-key placement tests follow.
- **"Audit-certified" requirements:** the currently blocked marketing claim needs — a third-party audit engagement, this evidence trail as the auditor's map, reproducible test runs from a clean clone (CI Level 3), coverage reporting on all crypto-path code, and chaos tests for every documented failure mode. This document plus a green Level 3 pipeline is the entry ticket, not the certificate.

---

## 13. File map

Current and planned. Confirmed correct against the S63 design, with additions: `helpers/` (Vitest-only utilities kept out of the k6-shared fixtures directory), `vitest.config.integration.js`, named workflow files, and the k6 script names.

```
refueler-share/
  TESTING.md                          ← this file
  worker/
    vitest.config.js                  ← unit config (current)
    vitest.config.integration.js      ← S64
    tests/
      unit/                           ← current, 178 passing
        ratelimit.test.js
        manifest.test.js
        nut00.test.js
        blake3.test.js
        turnstile.test.js
        stripe.test.js
        kv-mock.js                    ← unit-only mock (current)
      integration/                    ← S64+
        client.js                     ← HTTP client helper
        round-trip.test.js            ← S64
        security.test.js              ← S66b foundation
        fixtures/                     ← shared with k6 — pure ESM, no vitest/node imports
          credential.js
          chunks.js
          manifest.js
          turnstile-mock.js
          supabase-mock.js
          stripe-events.js
          lightning.js                ← B7
          webhooks.js                 ← SW4 (signed event payloads, valid/invalid/stale signatures, dead-letter entries)
          keypair.js                  ← B8
          lnurl.js                    ← B9
          mlkem-vectors.js            ← B10
        helpers/                      ← Vitest-only utilities (mock servers boot, wrangler lifecycle)
          wrangler-lifecycle.js
      load/                           ← S68–S69
        credential-burst.js
        concurrent-transfers.js
        download-saturation.js
        mixed-realistic.js
  .github/
    workflows/
      ci.yml                          ← S70–S71, Level 1
      integration.yml                 ← B7–B8, Level 2
      staging-deploy.yml              ← B9+, Level 3
```

One structural correction to the S63 draft: `kv-mock.js` stays in `unit/` (it already exists there and is Vitest-specific); it must **not** migrate into `fixtures/`, which is reserved for runtime-agnostic code.

---

Load this file at the start of any session touching tests, CI, load testing, or the security whitepaper.

*"Nothing stops this train."*
