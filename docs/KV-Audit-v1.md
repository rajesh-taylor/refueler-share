# KV-Audit-v1 — every STATUS_KV key against B12-SR X1
> **Session:** KV-Audit-Opus (Opus, design only, no code) · 8 Oct 2026
> **Rule audited:** B12-SR X1 — KV is compromised for **write** as well as read. No KV value may authorise access, lift a limit or select a privileged branch unless it is MAC'd under a Worker secret (or moved to Supabase).
> **Scope:** every `env.STATUS_KV` call in `worker/src` (the only KV binding), plus the pages that render KV-sourced data. Live KV census (key names only) on 8 Oct: 107 keys, 13 prefixes in use.
> **Status key:** 🔒 LOCKED · 🟡 Rajesh's call · ⚠️ live today
> **Attack detail** for live, unfixed items is kept off this public repo (`refueler-share-private/KV-Audit-v1-detail.md`) until KV-Fix-1 and API-Repair-1 ship — same practice as the GCM-IV note.

---

## 0. Verdict on one screen

| | Count | Prefixes |
|---|---|---|
| **Fine** — display, cache, notification-only, or a guard whose loss is harmless | 11 | `dock_index` (display), `hostname_health:latest`, `admin:client_errors_log`, `admin:news_events`, `btc:price:gbp(:last)`, `btc_ref_rate:current` (until it prices anything), `receipt_discharged_guard`, `receipt_*` (signed), `tt_nonce`, `rl` (courtesy throttle), `status:current` (once rendered safely) |
| **MAC it** | 5 | `test_credential` (→ S2 header), `upload_session` (→ S1.3 token), `root_verified`, `wh_config_`, `wh_dlq_` |
| **Move to Supabase** | 3 families | `api_client_`, `api_quota_`, `sandbox_client_` / `sandbox_quota_` / `sandbox_meta_` |
| **Delete** | 2 | `lightning:invoice`, `lightning:credential` (dormant code; B7 rebuilds) · `dock_index.api_key_hash` read (nothing writes it) |

Four findings bite **today**, not post-build: the status page renders one KV field unescaped on the Share origin ⚠️; the test-credential flag also skips the expiry ceiling ⚠️; the API credit pool debited at initiate is chosen by an unauthenticated header; and API webhooks and receipts never fire although capabilities advertises them. Fixes are small and sit in **KV-Fix-1a/1b** (now) and **API-Repair-1** (before the first Chartered client).

The B12-SR "live offenders" list is confirmed and extended: `test_credential` ✓, `api_quota_*` ✓, the `rfs_live_ → org` mapping (it is `api_client_*`; there is no org field yet) ✓. The B8 Locke pubkey set is not in KV yet — it is a B8 spec amendment.

---

## 1. The test, sharpened 🔒

X1 asked one question. It needs three, because a MAC stops only the first:

1. **Forge** — can a KV writer create a value that grants, lifts or branches? → **MAC it** (binding the KV key name inside the MAC, so a valid value can't be moved to another key).
2. **Roll back** — can replaying a genuine older value do it (pre-revocation record, higher balance, unspent flag)? → MAC doesn't help. **Supabase** (or R2 with `etagMatches`).
3. **Delete** — does removing the value loosen something (spent flag, rate counter, revocation)? → MAC doesn't help. **Supabase**, or accept it and say why the gate isn't load-bearing.

Display data passes all three, but is **untrusted text wherever it is rendered** (§3 F1).

**Who writes KV in practice:** a Cloudflare dashboard session, `wrangler` logged in on the Mac, any Cloudflare API token with *Workers KV Storage:Edit* (the onboarding runbook tells you to make one — §3 F5), Cloudflare under compulsion. The token is the most likely real-world vector.

---

## 2. The table

Grants = authorises access · lifts a limit · picks a privileged branch. "Lands in" = the fix session.

| Prefix (live count 8 Oct) | Written by | Read by | Grants? | Verdict | Lands in |
|---|---|---|---|---|---|
| `api_client_{sha256(live)}` (1) | Onboarding runbook (manual Cloudflare API PUT — no code path) | `requireApiAuth` (every API route), `auth_ping` | **Yes — it *is* API authentication** (`sign_key_hash`, `active`, `rail`, `tier`). Forge = become a client; roll back = revive a revoked key. | **Supabase** (identity rail). Anonymous-rail record: MAC'd + deploy-time revocation list, designed at B7 (no Supabase row on that rail). | **KV-Fix-2** (before B12-3) |
| `api_quota_{sha256(live)}` (0) | Admin provision / cancel; spend write-back on API issue and initiate | Issue, initiate, capabilities, auth_ping, api-stats | **Yes — credit balance.** Roll back = refill. Also last-write-wins: concurrent issues overspend. | **Supabase**, atomic spend RPC | **KV-Fix-2** |
| `sandbox_client_` / `_quota_` / `_meta_` (5/1/5) | Admin activate / reset; sandbox spend | Sandbox status / spend; API issue (sandbox branch) | Yes (sandbox auth + test-credit limit; sandbox issue mints on the production consumer mint key) | **Supabase**, same table as `api_client_` with a `sandbox` flag | **KV-Fix-2** |
| `test_credential:{uuid}` (19) ⚠️ | `POST /admin/test-credential` | `handleInitiate` | **Yes — privileged branch:** skips spend, tier cap **and expiry ceiling**. B12-SR S2 + one addition. | **MAC** — S2 exactly (`X-Test-Credential`, `TEST_CRED_KEY`); KV keeps only the single-use flag | **KV-Fix-1b** (pulled forward from B12-3 item 7) |
| `upload_session:{uuid}` (20) | Initiate | `/urls`, finalise (deleted at finalise) | **Yes** — presigned URLs + finalise. Stored raw (a KV *reader* can use it). | **MAC** — S1.3 token; KV holds `BLAKE3(token)` + spent flag only | **B12-3** item 1 (as planned). Finalise refusing `upload_complete:true` → **KV-Fix-1a** |
| `root_verified:{uuid}` (11) | Download (first chunk) | Download (every chunk) | Branch: skips root reconstruction. Low today; at B9-4 `verified` must rest on a real reconstruction. | **MAC** — value = `HMAC(K_rootv, tag ‖ 0x00 ‖ uuid16 ‖ merkle_root32)`, so a stale flag also fails if the root changes | **KV-Fix-1a** |
| `dock_index:{uuid}` (40) | Initiate; finalise (rail, merkle_root); confirm (collected); sweep (purged_at); every delete path removes it | Navy Office Execution Dock (display); `findApiKeyHashForUuid` (webhook routing) | Display: **no**. The routing read: `api_key_hash` is **never written** by any path, so it is dead — but if forged it would route one transfer's events to another client. | **Fine (display only).** Delete the `api_key_hash` read; routing moves to the R2 manifest (§4) | **API-Repair-1** |
| `receipt_{uuid}_{type}` | `emitReceipt` | `GET /api/v1/receipt/…` | No — receipts are signed with the client's whsec; a forged one fails the client's check | **Fine** — say "verify the sig" in the API docs. Separate bug: the pull has no ownership check | **API-Repair-1** |
| `receipt_discharged_guard:{uuid}` | Download (last chunk) | Same | No — forging suppresses one notification | **Fine** | — |
| `wh_config_{sha256(live)}` | Webhook register / delete | Delivery, receipts, hostname-health cron, webhook status | Not access, but forged URL redirects a client's notifications (URL rules checked only at registration) | **MAC** (key hash ‖ created_at ‖ url) **+ re-validate URL at delivery** | **API-Repair-1** |
| `wh_dlq_{hash}_{uuid}_{ts}` | Failed delivery | Cron retry | **Yes, in effect:** the retry signs whatever event/uuid the value holds with the client's real whsec | **MAC** + retry re-checks the event against R2 state | **API-Repair-1** |
| `rl:{endpoint}:{ip}` | `checkRateLimit` | Same | Lifts a limit — but a MAC can't stop deletion, and no rate limit is the only gate (Turnstile, credential spend, admin key are). One semi-exception: `auth_uuid` (passphrase guesses) — moot while passphrase hashes are bare SHA-256 in R2. | **Fine, by rule:** a KV counter is a courtesy throttle, never a security gate. Raw IP at rest ≤ 70 s → keyed pseudonym (`AUTH_PEPPER`) | **B12-4a** (already planned) |
| `tt_nonce:{sha256(token)}` | Consumer issue | Same | Delete → Turnstile replay; Cloudflare's siteverify already refuses duplicates | **Fine** (belt and braces) | — |
| `lightning:invoice:{hash}` / `lightning:credential:{hash}` (0) | `createInvoice`; unauthenticated `/webhook/lightning` | Status, webhook | Yes on paper (`settled` decides issuance), but dormant: no `LNBITS_*` secrets set, and the credential key is never read | **Delete** the routes and code. B7 rebuilds: settlement confirmed server-side with LNbits, never from KV state | **KV-Fix-1a** |
| `status:current` (1) ⚠️ | `POST /admin/status` (admin key) | Public `GET /status` → Share banner, refueler.io status / plans / upgrade pages | No — but one field reaches HTML unescaped on the Share origin (detail private) | **Fine once rendered safely:** whitelist the incident shape on write, serve only known fields, escape everywhere | **KV-Fix-1a** (Worker + refueler.io `status.njk`) |
| `hostname_health:latest` (1) | Cron | Navy Office | No (escaped) | **Fine** | — |
| `admin:client_errors_log` (1) | Router, every ≥ 400 | Navy Office | No (escaped). `path` can carry a UUID → UUID + time + status kept 90 days | **Fine (display only, after B12-2).** Optional: write `{uuid}` in place of UUIDs | KV-Fix-1a (optional) |
| `admin:news_events` (1) | Admin | Navy Office growth chart | No (escaped) | **Fine** | — |
| `btc:price:gbp`, `btc:price:gbp:last` | Admin price fetch | Navy Office chart | No | **Fine** | — |
| `btc_ref_rate:current` (1) | Admin / cron | Capabilities (advisory only) | No today. **The day a price is computed from it** (B7 invoices, Pricing-v2 credit blocks) a forged rate is a discount, and the ±20 % guard anchors on the stored value. | **Fine now; MAC or recompute before it prices anything** | **B7 / Pricing-v2** gate |

**Not in KV (yet) — keep it that way:**
- **B8 Locke pubkey set** (`locke_pubkeys_{harbour_uuid}`, B8 §4): spec only. Amend B8-spec so the set is MAC'd (the B12-SR §A cross-spec note). → **B8-Opus**.
- **`org_dock`** (B12-5): sealed per S3(b) — already correct by spec.
- **`rfs_live_ → org` mapping**: does not exist; `api_client_` has no org field. B12-3 must take `org_account_id` from the Supabase `api_keys` row KV-Fix-2 creates. **KV-Fix-2 is a precondition of B12-3.**

---

## 3. Found in passing (not KV-write, same blast radius)

| # | Finding | Severity | Lands in |
|---|---|---|---|
| F1 | ⚠️ A KV-sourced field reaches HTML unescaped on a refueler.io page that shares the Share app's origin. | High | KV-Fix-1a |
| F2 | Chartered initiate takes the API pool to debit from a plain header, with no HMAC; leaving it out skips the transfer debit. The raw `rfs_live_` key is then stored in the R2 manifest. | Medium (no live client) | API-Repair-1 |
| F3 | API webhooks (`transfer.confirmed`, `transfer.timestamp_submitted`) and receipts (`cargo.discharged`) never fire: nothing writes `api_key_hash` into `dock_index`. `cargo.accepted` was never added to finalise (known since Share-Size-1). Capabilities advertises `webhook: true`, `receipts: true`. | Medium (claim vs reality) | KV-Fix-1a sets both `false`; API-Repair-1 repairs |
| F4 | Receipt pull checks HMAC auth but not that the receipt belongs to the caller. | Low | API-Repair-1 |
| F5 | `ONBOARDING-RUNBOOK.md` Step 3 writes `api_client_{client_ref}` with no `sign_key_hash` and `plan` instead of `tier` — the Worker can't authenticate that record — and needs a Cloudflare token with KV:Edit on a laptop (an X1 write vector). Step 4 sends `X-Api-Key`, which the Worker doesn't read. | Medium (process) | KV-Fix-2 replaces Step 3 with an admin endpoint; revoke the token |
| F6 | Sandbox credential issue looks unreachable (`requireApiAuth` reads `api_client_`; sandbox activation writes `sandbox_client_`), and when reachable it signs on the production consumer mint key. **Unverified — check first in KV-Fix-2.** | Low | KV-Fix-2 |
| F7 | Admin key compared with `!==` in most admin handlers (S2.4 wants `timingSafeEqual`; sandbox already does it). | Low | KV-Fix-1a (one `requireAdmin()` helper) |
| F8 | `auth_ping` gates on literal `record.tier !== 'api'` (CLAUDE.md: use `isCharteredTier`). | Tidy | KV-Fix-2 |
| F9 | Every initiate resolves tier `free`, so an API-tier transfer is capped at the free cap although API issue returns `allocation_bytes` 250 GB. Intended until B12-4a for consumers; for Chartered it contradicts the response. | 🟡 question | B12-3 |
| F10 | Passphrase hash is bare SHA-256 in the manifest (already flagged for SW-MCP-2). Noted because it makes the `auth_uuid` rate limit decorative against anyone with R2 read. | Known | SW-MCP-2 / B8 |

---

## 4. Designs the fix sessions build

### 4.1 One new secret 🔒
`KV_MAC_KEY` — 32 random bytes, base64, `wrangler secret put` from `worker/`. Root for every MAC'd KV value. Per-purpose keys by HKDF-SHA256 (encryption rule, global CLAUDE.md):
`K_p = HKDF(KV_MAC_KEY, salt = empty, info = utf8("refueler.share.kvmac.<purpose>.v1") ‖ 0x00, 32)`, purposes `rootv`, `whcfg`, `whdlq` (later `apiclient-anon` at B7).
MAC input follows the B12-SR encoding rule: `utf8(tag) ‖ 0x00 ‖ fixed-length binary fields (uuid 16 B, key hash 32 B, BE integers) ‖ variable-length field last`. The KV key's own identifier is always inside the MAC. Stored as `{ v: 1, …fields, mac: b64url }`; verify with `timingSafeEqual`; any failure → treat as absent (never an error that reveals the branch). `TEST_CRED_KEY` stays its own secret (S2 lock). Rotation: any time; MAC'd values re-written lazily, unverifiable ones treated as absent (root re-verified, webhook re-registered — acceptable pre-launch).

### 4.2 KV-Fix-2 — API keys and credits to Supabase 🔒 (shape) · 🟡 (cache TTL)
- **`api_keys`**: `key_hash bytea(32) PK` (SHA-256 of `rfs_live_`), `sign_key_hash bytea(32)`, `org_account_id uuid` (stable, never key-derived — B12-SR A2), `rail text check (rail = 'identity')`, `sandbox bool`, `active bool`, `grace_until timestamptz null` (rotation), `created_at`, `updated_at`. RLS deny-all; service role only.
- **`api_credit_pools`** (one per `org_account_id`): the `api_quota_` schema as columns (`plan`, `allocation`, `remaining`, `overage_credits`, `overage_ceiling`, `period_start`, `period_end`, `status`) with CHECKs `remaining ≥ 0`, `overage_credits ≥ 0`.
- **`spend_api_credits(org, cost)`** `plpgsql`, `SECURITY DEFINER`, `EXECUTE` revoked from `anon`/`authenticated`: lazy period reset + plan rules (exactly `applyQuotaSpend`) in one conditional `UPDATE … RETURNING`. Row lock closes the overspend race. Spend at initiate stays *after* the Cashu spend INSERT (refund on failure) — the same order as today.
- **This retires a do-not-retry line:** "DO NOT write quota write-back synchronously — fire-and-forget KV put" (Master Context). The atomic RPC is the write; it is awaited.
- **Auth lookups:** one Supabase read per API request. 🟡 An in-isolate memory cache (never KV) of ≤ 60 s is allowed; revocation then takes ≤ 60 s.
- **Onboarding:** `POST /admin/api-client` (admin key, `requireAdmin`) generates the keys, writes `api_keys` + pool, returns the keys once. Replaces runbook Step 3; Rajesh then revokes the KV:Edit token. Admin quota provision/cancel move onto the pool table.
- **Migration:** read the 1 live `api_client_` value first (whose is it? test or real) — then write its row, delete the KV key. `sandbox_*` → rows with `sandbox = true`; sandbox credits in the pool table. Anonymous rail: still closed (503) — nothing to migrate.
- **Unblocks B12-3:** `quota_ref = H(QUOTA_REF_KEY, org_account_id)` comes from the authenticated row.

### 4.3 API-Repair-1 — webhooks and receipts that work, without KV routing 🔒
- Manifest stops carrying the raw `api_live_key`. It carries **`cref_ct`**: `org_account_id` sealed under `SHARE_SEAL_KEY_<kid>` (the `qref_ct` construction, purpose tag `refueler.share.cref.v1`), stripped by the tombstone like `qref_ct`.
- Delivery, receipts and the DLQ look up the client from the manifest (R2, the ground truth) → `api_keys` → `wh_config_`. `findApiKeyHashForUuid` and `dock_index.api_key_hash` go.
- `cargo.accepted` emitted at finalise. `wh_config_` and `wh_dlq_` MAC'd (§4.1); URL re-validated at every delivery; DLQ retry re-checks the event against the manifest.
- Chartered initiate is HMAC-authenticated; the pool is the authenticated org's; an unauthenticated Chartered-tier credential is refused.
- Receipt pull: 404 unless the manifest's sealed client is the caller.
- Capabilities flips `webhook` / `receipts` back to `true` only when a live test shows each event arriving.

---

## 5. What Sonnet builds — by session

**KV-Fix-1a** (Sonnet, ~1 session, now; Worker + refueler.io `status.njk`, a refueler.io-owned file, not mirrored)
1. Status page: the rendering fix in the private note (P1); `/admin/status` validates the incident shape; `/status` serves known fields only. Live check as the private note describes.
2. `requireAdmin()` with `timingSafeEqual`, used by every admin handler (one call site per route; grep in the session log).
3. Finalise → 409 when `manifest.upload_complete === true`.
4. `root_verified` → MAC'd value (§4.1); old `'1'` values treated as absent.
5. Delete Lightning create / status / webhook routes, `lightning.js`, `lightning-routes.js` and their tests (B7 rebuilds).
6. Capabilities: `webhook: false`, `receipts: false` until API-Repair-1. **Chartered size promise = Pro Bono cap until B12-4a** (Rajesh, 8 Oct; B12-4a is ≥ 6 sessions away): API issue `allocation_bytes` and capabilities `max_file_size_gb` report the `free` cap that initiate actually enforces, read from the same constant — never a second literal.
7. Optional: client-error log writes `{uuid}` in place of UUIDs in `path`.
New secret `KV_MAC_KEY`.

**KV-Fix-1b** (Sonnet, small; Worker + `admin/test-upload.html`, which is mirrored → `ship-frontend.sh`)
B12-SR S2 in full, including the proof-obligation matrix and AE `admin.testcred.issued`. New secret `TEST_CRED_KEY`. After deploy: the 19 old `test_credential:*` keys are inert; let them expire. The Navy Office soak line stays with B12-3.

**KV-Fix-2** (Sonnet, ~1–2 sessions, before B12-3) — §4.2. First task: confirm F6 and read the live `api_client_` record.

**API-Repair-1** (Sonnet, before the first Chartered client; after KV-Fix-2 and B12-3's sealing code, since `cref_ct` reuses it) — §4.3.

**Unchanged, confirmed:** B12-3 item 1 (session token MAC) also adds the *write-once chunks* backlog item (`If-None-Match: *` signed into presigned PUTs) — same code, same session. B12-4a pseudonymises `rl:` keys. B8-Opus adds the Locke-set MAC. B7 rebuilds Lightning on LNbits-verified settlement and MACs or recomputes `btc_ref_rate` before it prices anything.

---

## 6. Rajesh's decisions (8 Oct 2026)
1. **Order:** KV-Fix-1a → KV-Fix-1b → MCP-Fix-1 → KV-Fix-2 → API-Repair-1. 🔒
2. **Revoked API key works for at most 60 s** (in-isolate cache TTL). 🔒
3. **The live `api_client_` record is a test** — no paying clients on any tier. KV-Fix-2 deletes it rather than migrating it. 🔒
4. **F9:** Chartered promises the Pro Bono cap until B12-4a (KV-Fix-1a item 6). Revisit if B12-4a comes within 3 sessions. 🔒
5. **Cloudflare tokens with Workers KV Storage:Edit:** at the KV-Fix-2 close, list the account's API tokens; revoke any with KV:Edit (or re-scope to drop it). Onboarding then needs no KV access at all. `wrangler login` on the Mac stays (deploys need it); it is the remaining KV-write path, covered by Cloudflare account security. 🔒

*Twenty prefixes in, eleven fine; every other one has a session.*
