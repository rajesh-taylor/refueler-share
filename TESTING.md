# TESTING.md — refueler-share
> **Version:** v0.9 | **Created:** S63 · 27 July 2026 | **Updated:** Integration-Repair-1 · 28 Oct 2026
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

Two suites, run separately (Vitest 4):

- **Main suite** — `worker/test/` (54 files, 1,125 passing), `cd worker && npm test`. Runs inside workerd via `@cloudflare/vitest-plugin`. Pure logic plus handlers against in-memory KV/R2. The old `worker/tests/unit/` files (`destroy.test.js`, `webhook_reg.test.js`) were stale copies of what `test/` now covers and were removed at Integration-Repair-1.
- **Integration suite** — `worker/tests/integration/` (3 files, 68 passing), `cd worker && npm run test:integration`. Real HTTP against `wrangler dev --local` (§3).

**Integration suites:**

| Suite | Tests | Covers |
|-------|-------|--------|
| `round-trip.test.js` | 6 | Two-part upload → finalise → byte-identical verified download (`X-Integrity: ciphertext-storage-verified`); finalise refusals (incomplete, stray chunk → `wrong_size`); stored bytes ≠ committed hash → 409 `integrity_failed`; password transfer (unlock 401/200, token exp ≥ expiry); double-spend (same UUID 409, spent proof under another valid UUID → ledger 409) |
| `security.test.js` | 36 | Rate limits (issue 10/60, initiate 20/60, per IP); commitment binds UUID and tier; forged proof 401; Turnstile nonce replay; `X-Transfer-UUID` validation, UUID-in-path 404, `missing_part`; free cap 413 / at-cap 200 / 8-day expiry 400 / chunk-count mismatch 400 / scheduling 403; Stripe webhook auth (6); recipient DELETE 200/401/403/410; consumed state blocks unlock, download, meta; tidal gate on unlock (425/410) |
| `tg-round-trip.test.js` | 26 | Destroy-after-download: last part served destroys the transfer (open + password, 2-part), `/confirm` 409/401/403/410/404/`destroyed:false`; owner DELETE (admin key, wrong key 401, every part 410, repeat 410, unknown 404); tidal windows on download (425/200/410, both bounds, meta); DELETE auth boundaries |

**Original seams — all closed (S64–S72):**

1. **R2 and KV behaviour** — closed S64.
2. **BLAKE3 WASM in the CF runtime** — closed S64.
3. **The credential→upload chain** — closed S64.
4. **Stripe webhook → Supabase** — closed S71/S72.
5. **HTTP routing** — closed S64–S66.

---

## 3. Integration test harness

**Built at S64. Runs against `wrangler dev --local` (Option B — locked).** Local workerd with local R2/KV simulation: real runtime semantics, no cloud spend, no production data risk.

### Configuration

- `worker/vitest.config.integration.js` — `include: ['tests/integration/**/*.test.js']`, one file at a time. Never part of `npm test`. (Until 28 Oct it used `testMatch`, which Vitest ignores, so it ran every test file.)
- `tests/integration/helpers/wrangler-lifecycle.js` (globalSetup) starts the Supabase mock, writes `.wrangler-test-state/integration.env`, boots `wrangler dev --local --port=8788 --persist-to=.wrangler-test-state --env-file=…`, polls `/status`.
- **`worker/.dev.vars` is never read or written.** With `--env-file`, wrangler doesn't load it. The run's vars file is all fresh random keys (admin, mint, commitment, session, MAC, seal, Stripe webhook secret), the mock `SUPABASE_URL`, Cloudflare's published Turnstile test secret (siteverify passes any token, so the Worker's real verify and nonce code runs), and placeholder R2 S3 values for the presigner (never contacted).
- wrangler runs in its own process group. Teardown and Ctrl-C kill the group. After a hard crash, the next run stops the leftover one (pid file, only if port 8788 still answers).
- Values the tests need (`workerUrl`, `persistDir`, `envFile`, `adminKey`, `stripeWebhookSecret`) cross into the test processes by `provide`/`inject` only.

### HTTP client helper — `worker/tests/integration/client.js`

Every endpoint helper returns `{ status, headers, body }`; assertions stay in tests. Test files call `client.init({...inject()})` in `beforeAll` and `client.close()` in `afterAll`.
- `issueCredential({ ip, tier, turnstileToken })` — BDHKE, then `body.proof` = the v2 `X-Cashu-Credential` (`{id: keyset_id, amount: 1, secret, C}`)
- `initiateHeaders(cred, opts)` / `initiate(headers)` — `POST /upload/initiate` (password, destroy-after-download, availability, overrides for negative tests)
- `makeChunks(totalBytes)` / `putChunks(uuid, chunks)` / `finaliseBody(chunks)` / `finalise(uuid, token, body)` — chunk bytes are random stand-in ciphertext at the exact signed sizes. **Presigned R2 URLs can't reach a local Worker**, so `putChunks` writes them into the same local bucket via wrangler's `getPlatformProxy` (same persist dir). Everything else is the real Worker.
- `upload(opts)` — all of the above, throws on any non-200
- `patchManifest(uuid, fn)` — sets stored states no free upload can reach (tidal windows)
- `getMeta`, `unlock`, `downloadChunk` (`X-Part`), `confirmTransfer`, `deleteTransfer`, `ownerDeleteTransfer` (`inject('adminKey')`, no default), `post`
- The transfer UUID is only ever in `X-Transfer-UUID` (UUID-Out-Of-Path-1; `bin/check-no-uuid-path.mjs` covers these files).

### Not covered here

Citizen (signed-in, paid) and Chartered (HMAC) initiates. They need a session or API client and are covered in `test/` and by `dev/stripe-sandbox/` (`docs/Stripe-Sandbox-Checklist.md`).

---

## 4. Fixture factory architecture

**Location: `worker/tests/integration/fixtures/` — locked.**

Fixtures are shared between Vitest integration tests and k6 load scripts. k6 runs its own JS runtime — fixture files are **pure ESM with zero imports from vitest, node built-ins, or CF types**.

### Factories

| Factory | Produces |
|---------|----------|
| `credential.js` | Valid/expired/malformed NUT-00 credential payloads; blinding helpers |
| `chunks.js` | Deterministic pseudo-random chunk bytes + matching BLAKE3 hashes; wrong-hash variants |
| `manifest.js` | Valid manifests per tier; oversize (>64 KB); expired; passphrase-protected |
| `turnstile-mock.js` | Mock verify server responses (success, expired, already-used) |
| `supabase-mock.js` | In-memory HTTP server implementing PostgREST subset the Worker uses |
| `stripe-events.js` | Signed webhook payloads for all 3 subscribed event types |

### Future blocks

- B7: `lightning.js` — LNbits callback payloads, payment-hash KV entries, invoice fixtures (stub present; wired at B7)
- SW: `webhooks.js` — signed event payloads, valid/invalid/stale `rfs_whsec_` signatures, dead-letter KV entries (stub present; handler integration tests deferred to SW9a)
- B8: `keypair.js` — NUT-11 Mode 2 keypairs, challenge-response transcripts
- B9: `lnurl.js` — LNURL-withdraw callback fixtures
- B10: `mlkem-vectors.js` — ML-KEM known-answer test vectors

---

## 5. Security regression suite

**`worker/tests/integration/security.test.js`** — every closed vulnerability from B4 is a permanent executable regression test. This file is the machine-checkable half of the B9 whitepaper.

### Claim → test mapping

| Claim (whitepaper §) | Origin | Test name | What it proves |
|----------------------|--------|-----------|----------------|
| Storage integrity (ciphertext-chunk merkle) | S34 → Share-6 | `finalise refuses wrong chunk hashes and a missing chunk` — `round-trip.test.js` | Stored bytes that don't match the finalised hashes are refused at download (409 `integrity_failed`); an incomplete upload can't finalise |
| Double-spend rejection | S20/B4 | `a spent proof under a second, valid UUID + commitment hits the spend ledger (409)` — `round-trip.test.js` | Supabase serial ledger blocks replay |
| Credential farming defence | S42c/S42d | `rejects credential for foreign UUID` · `rejects reused Turnstile nonce` | UUID binding + nonce binding close cross-transfer farming |
| Rate limit enforcement | S36/S42b | `returns 429 at limit+1 on credential_issue` | KV limits hold at exact boundaries; 429s emitted |
| UUID validation | S41 → UUID-Out-Of-Path-1 | `rejects "…" → 400 missing_transfer_id` · `a UUID in the path is not a route (404)` | Malformed UUIDs refused; the UUID never travels in a path |
| Chunk bounds | S41/S42b → B12-1d | `a chunk beyond the declared count is refused at finalise (409 wrong_size)` — `round-trip.test.js` | Storage-stuffing beyond manifest bounds closed |
| Bearer token scope | S58 | `bearer token exp equals manifest expiry; expired token rejected` | Token lifetime bound to transfer, not hardcoded |
| Stripe webhook auth | S71/S72 | `tampered signature → 401` · `stale timestamp → 401` · `missing header → 401` · `empty body → 401` · `valid signature → 200` | Webhook auth enforced in real Worker route; all five tests passing |

| HMAC API request authentication | SW2/SW4 | *(integration test deferred to SW9a)* | API requests signed with HMAC-SHA256 over method+path+timestamp+body_hash; replay window ±300s |
| Webhook signing — stateless HMAC derivation | SW4-patch | `test/webhook_reg.test.js` — `deriveWhsec` suite | `rfs_whsec_` derived from master key + apiKeyHash + created_at; never stored; rotation salt confirmed |
| Webhook URL validation — private IP / localhost rejection | SW4 | `test/webhook_reg.test.js` — `validateWebhookUrl` suite | RFC1918, loopback, link-local, unspecified ranges rejected; non-HTTPS rejected |
| Sandbox credential isolation | SW6 | *(integration test deferred to SW9a)* | `rfs_test_` keypairs draw from sandbox pool only; never touch production quota |

**Known test gaps (SW block — resolve at SW9a):**
- HMAC auth boundary integration test (valid/invalid/replayed signatures against real Worker)
- Quota 402 integration test (exhausted pool → 402 `quota_exhausted`)
- Webhook delivery retry + dead-letter creation integration test
- Key-rotation grace window integration test
- Sandbox smoke path integration test
- Hostname health check — no automated test coverage; manual verification only (cron fires at 03:00 UTC daily, result readable at `GET /admin/hostname-health`)

Rule: **no security fix ships in future blocks without a row added to this table and a test added to this file.**

---

## 6. k6 load testing

**S68–S69. k6 chosen (locked).**

**Load test startup order (S68 pattern — locked):** mock first (`start-mock.mjs`), then `wrangler dev --local --port 8787`, then k6.

### Draft load profiles

| Profile | Shape | Validates |
|---------|-------|-----------|
| Credential issuance burst | Ramp to 10/60s limit, then 3× over | Rate limiter holds under concurrency |
| 50 concurrent transfers | 50 VUs, full upload of 20-chunk transfers | Chunk throughput, BLAKE3 verify latency, KV byte-counter accuracy |
| Download saturation | Sustained GETs approaching 300/60s | Bearer verification cost, R2 proxy behaviour |
| Mixed realistic | 70% download / 25% upload / 5% credential | Baseline for alpha go/no-go (B11) |

### Targets

- S68–S69: `wrangler dev --local` — validates logic under concurrency.
- Real-latency runs move to staging (§8) at B9. Tighten thresholds to <150ms at staging.
- Production is never load-tested.

---

## 7. CI/CD maturity levels

| Level | Sessions | Gate |
|-------|----------|------|
| **Level 1** | S70–S71 (B6) · Vuln-Watch-1 | On every push: Eleventy build check, `wrangler deploy --dry-run`, lint, full unit suite; `npm audit --omit=dev` (high/critical blocks), vendored-code hashes + OSV (`bin/check-vendored.mjs`), route inventory vs `docs/ROUTES.md` (`bin/route-inventory.mjs --check`). Red = do not deploy. |
| **Level 2** | B7–B8 | Integration suite (wrangler dev --local inside GitHub Actions) as pre-deploy gate, including `security.test.js`. |
| **Level 3** | B9–B10 | Deploy to staging → automated smoke test → JSON reporter results POSTed to Worker KV → dashboard card. Manual promote to production. |

---

## 8. Staging environment

**B9 scope. `refueler-share-staging` Worker + `refueler-share-dev` R2 + dedicated staging KV namespace.**

**Planning session required — "B9-plan: staging environment"** (uncounted).

### Configuration deltas from production

| Concern | Production | Staging |
|---------|-----------|---------|
| R2 | `refueler-share-prod` | `refueler-share-dev`, aggressive lifecycle expiry (1 day) |
| Supabase | `tihgvdokeofnjxjkenmm` | Separate free-tier project or schema |
| Stripe | Live keys | Test keys only |
| Lightning | LNbits live | LNbits test/regtest path per B9 planning |
| Turnstile | Production sitekey | Separate sitekey or test-mode always-pass key |
| Secrets | Production set | Fully parallel set — zero shared secrets |

### Dual use: demo environment

Staging doubles as the demonstration target for BlackMagic Design outreach and btc++ Berlin (early October 2026). CI deploys to staging pause during flagged demo freeze (simple KV flag).

---

## 9. Incident response testing — B9 scope

**Goal:** be the world gold standard for incident response in privacy-critical infrastructure. Test the plan before you need it.

### Severity tier definitions

| Tier | Description | Response target | Public ack target |
|------|-------------|----------------|-------------------|
| S1 | Active data exposure or cryptographic compromise | 30 minutes | 2 hours |
| S2 | Service degradation or suspected breach under investigation | 4 hours | 4 hours |
| S3 | Operational issues, no privacy impact | Standard | Status page update |

### Pre-written S1 template (draft — refine at B9)

```
Status: [INVESTIGATING / CONFIRMED] — [one-sentence description]
Declared at: [timestamp UTC]

What we know: [honest, even if incomplete]
What we don't know yet: [explicit — no false certainty]
What we are doing in the next 2 hours: [specific actions]
Next update: [specific time, not "soon"]

Free tier users: we cannot notify you individually because we hold no identity data. This is by design. Your files are encrypted noise on our servers — we cannot read them and neither can anyone who accesses our storage.

Paid users: if your email is affected, we will contact you directly at [email].
```

### Status page incident dashboard — B9 build

**Homepage:** small persistent modal (bottom-right corner) showing current operational status. Colours: green (all clear) / amber (degraded) / red (active incident). Click → `/status` full page.

**Status page incident panel:**
- S1: full-width red border, auto-refreshes every 60s, cannot be dismissed.
- S2: amber, auto-refreshes, dismissible after reading.
- S3: standard informational card, sessionStorage dismiss.
- Panel fields: severity tier · declared at · last updated · summary (one sentence) · current actions · next update time (countdown timer).

**KV schema extension:**
```json
{
  "incident_active": {
    "severity": "S1|S2|S3",
    "declared_at": "2026-08-01T00:00:00Z",
    "updated_at": "2026-08-01T00:30:00Z",
    "summary": "One sentence, honest.",
    "actions": "What we are doing right now.",
    "next_update": "2026-08-01T02:00:00Z"
  }
}
```
Null value = no active incident. Admin sets via `POST /admin/status` with `incident` field. Existing `STATUS_KV` binding — no new infrastructure.

### Tabletop simulation — run before alpha

Questions to answer in the exercise:
1. Who has access to post to the status page at 3am? Is the `ADMIN_KEY` accessible without the dev laptop?
2. Decision tree: notify users before or after full scope is understood? (Answer: before, with explicit "we don't yet know X" — silence compounds damage.)
3. UK GDPR Article 33: confirm 72hr ICO notification process. Identify who files the report.
4. Enterprise client notification via SimpleX: is the group set up and tested before the incident?
5. Free tier: draft the positive framing ("no identity data held") and confirm it's accurate for current architecture.

### What makes Share's position strong in a breach

- Free tier: no identity data held, no notification obligation, positive architectural narrative.
- All tiers: server stores encrypted noise. Even full R2 exposure yields ciphertext only — keys live in URL fragments, never on server.
- What can be exposed: file sizes, transfer timestamps, payment hashes (Lightning). These are disclosed voluntarily in `honest_metadata.json` already.
- What cannot be exposed by design: file contents, sender/recipient identity (free tier), decryption keys.

The incident response plan is also a marketing asset: a company that has rehearsed a breach scenario and published its response protocol before needing it is demonstrably more trustworthy than one that goes silent for 48 hours. Clients will find this reassuring, not alarming.

---

## 10. Dashboard integration

**B10–B11 scope.** Flow:

```
Vitest JSON reporter → GitHub Actions step → POST /admin/test-results (X-Admin-Key)
  → STATUS_KV key `test_results_latest` → dashboard card (60s refresh)
```

### Card contents

- Last run timestamp + commit short-hash
- Pass/fail counts per suite (unit / integration / security)
- Names of failing tests — a failing security regression is displayed by name
- Staging smoke test status (Level 3)

New endpoint required: `POST /admin/test-results` — scheduled with the dashboard test card at B11.

---

## 11. Whitepaper evidence trail

| # | Claim | Test file | Test name(s) | What it proves |
|---|-------|-----------|--------------|----------------|
| 1 | Every uploaded chunk is BLAKE3-verified server-side; mismatches rejected | `unit/blake3.test.js` + `integration/security.test.js` | `verifyChunkHash matches reference implementation` · `rejects chunk with mismatched BLAKE3 hash (400)` | Hash function correctness + enforcement in real Worker runtime |
| 2 | NUT-00 blind signatures are cryptographically correct and unlinkable | `unit/nut00.test.js` | `full BDHKE round-trip verifies` · `same secret with different blinding factors yields same C` | Signature validity and blinding privacy guarantee |
| 3 | A credential cannot be spent twice | `integration/security.test.js` | `rejects reuse of melted credential; logs attempt` | Supabase serial ledger enforces single-use |
| 4 | All public endpoints are rate-limited | `unit/ratelimit.test.js` + `integration/security.test.js` | boundary tests per endpoint · `returns 429 at limit+1` | Limits hold at exact boundaries under real KV path |
| 5 | Credentials are bound to a Worker-generated UUID | `integration/security.test.js` | `rejects credential for foreign UUID` | Cross-transfer credential farming is closed |
| 6 | *(retired Share-MIME-1, 16 Oct 2026: no upload-time file-type check; the Worker never learns the type. The recipient's browser notes a program after download.)* | — | — | — |
| 7 | Webhook payloads are authenticated and replay-protected | `unit/stripe.test.js` + `integration/security.test.js` | all five Stripe webhook auth tests | Forge and replay rejected; positive case proven in real Worker |
| 8 | Incident response plan exists and has been rehearsed | `docs/incident-response.md` + tabletop simulation log | tabletop simulation completed pre-alpha | Response protocol exists, is known, and has been tested before being needed |
| 9 | Destroy-after-download transfers are permanently consumed after recipient confirmation | `integration/tg-round-trip.test.js` | `POST /confirm returns 200 and destroyed: true` · `re-download after confirm returns 410` · `second POST /confirm returns 410 (already consumed)` | Tombstone gate enforced end-to-end in real Worker runtime; consumed state is permanent |
| 10 | Tidal windows are enforced server-side; Citizen tier cannot schedule availability | `integration/tg-round-trip.test.js` | `returns 425 when available_from is in the future` · `returns 410 when available_until has elapsed` · `Citizen tier — tidal headers rejected with 403 at upload` | Time-gating and tier gate hold at real Worker boundary |

| 11 | Webhook signing keys are derived statelessly and rotation-salted | `test/webhook_reg.test.js` | `deriveWhsec` determinism · `different created_at → different output` | Same master key + same API key + different `created_at` yields a different `rfs_whsec_` — re-registration automatically rotates the signing key |
| 12 | Webhook endpoint URL validation rejects private/loopback addresses | `test/webhook_reg.test.js` | `validateWebhookUrl` suite (21 cases) | RFC1918, loopback, link-local, unspecified ranges, HTTP, localhost all rejected; client cannot register an internal delivery target |

**Scope honesty:** this trail proves server-side *chunk* integrity, not end-to-end file integrity — full Merkle root verification unimplemented until B9. Rows added for NUT-11 Mode 2 (B8), Merkle (B9), ML-KEM (B10), HMAC API auth (SW) when tests exist — never before.

---

## 12. Per-block harness extension plan

| Block | Harness additions | Where |
|-------|-------------------|-------|
| TG-block | `destroy.test.js` unit suite (64 tests). `tg-round-trip.test.js` integration suite (16 tests). `scripts/tg-smoke.sh` production smoke. Whitepaper rows 9–10. `client.js` TG methods: `confirmTransfer`, `deleteTransfer`, `ownerDeleteTransfer`. | S-TG-5 |
| B7 | LNbits webhook fixture, payment-hash KV fixture, credential poll helper; security rows: webhook replay, double-issuance | S83/S83a |
| SW (partial ✓) | `webhook_reg.test.js` unit suite (50 tests) — SW9. `webhooks.js` fixture stub — SW4. **Deferred to SW9a:** HMAC auth boundary integration test, quota 402, `wl_config` fail-safe, key-rotation grace window, webhook delivery retry + dead-letter. Whitepaper rows 11–12 added SW9. | SW4/SW9 + SW9a |
| B8 | Keypair fixture, NUT-11 Mode 2 challenge-response integration test; security row: keypair auth cannot be bypassed via Mode 1 | Inside B8 build sessions |
| B9 | Mock LNURL callback fixture, LNURL-withdraw credential delivery round-trip; Merkle verification tests; incident response plan docs + tabletop simulation; `incident_active` KV integration test (set/clear/panel render) | Dedicated whitepaper + incident response sessions |
| B10 | ML-KEM known-answer vectors, key-wrapping round-trip; chaos test foundation | Inside B10 spike |
| B11 | Alpha smoke script, dashboard test card + `/admin/test-results` endpoint | S119+ |

---

## 13. Long-horizon architecture

- **Contract tests:** once API surface stabilises post-B12, frontend↔Worker contract tests protect external integrators.
- **Chaos / fault injection:** scripted failure of each dependency. The graceful-degradation claims become tests. Foundation at B10.
- **Incident simulation automation:** scripted S1/S2/S3 scenario runs that verify the status page panel renders correctly, the KV schema is correct, and the admin endpoint accepts the incident payload. Can be added as a B9 integration test.
- **"Audit-certified" requirements:** third-party audit engagement requires this evidence trail, reproducible test runs from a clean clone (CI Level 3), coverage reporting on all crypto-path code, and chaos tests for every documented failure mode.

---

## 14. File map

```
refueler-share/
  TESTING.md                          ← this file
  scripts/
    tg-smoke.sh                       ← S-TG-5 production smoke (10 boundary checks)
  docs/
    r2-lifecycle.md
    incident-response.md              ← B9 (S1 template, tabletop log, channel order)
  worker/
    vitest.config.js                  ← unit config
    vitest.config.integration.js      ← S64
    tests/
      unit/                           ← 242 passing
        ratelimit.test.js
        manifest.test.js
        nut00.test.js
        blake3.test.js
        turnstile.test.js
        stripe.test.js
        destroy.test.js               ← S-TG-2 (64 tests)
        webhook_reg.test.js           ← SW9 (50 tests)
        kv-mock.js
      integration/                    ← S64+
        client.js
        round-trip.test.js
        security.test.js
        tg-round-trip.test.js         ← S-TG-5 (16 tests)
        fixtures/                     ← shared with k6 — pure ESM, no vitest/node imports
          credential.js
          chunks.js
          manifest.js
          turnstile-mock.js
          supabase-mock.js
          stripe-events.js
          lightning.js                ← B7
          webhooks.js                 ← SW4
          keypair.js                  ← B8
          lnurl.js                    ← B9
          mlkem-vectors.js            ← B10
        helpers/
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

---

Load this file at the start of any session touching tests, CI, load testing, or the security whitepaper.

*"Nothing stops this train."*
