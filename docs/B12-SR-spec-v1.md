# B12-SR-spec-v1 — Security review of B12-spec-v1.1
> **Session:** Share-B12-SR (Opus, security review + design, no code) · 24 Sep 2026
> **Reviews:** `docs/B12-spec-v1.1.md` · builds on `docs/B8-spec-v1.md`, `Share-6-spec-v1.md`
> **Status key:** 🔒 LOCKED · 🟡 PROVISIONAL (Rajesh) · ⚠️ FLAW FOUND (design changes, amendment listed in §A)
> **Executes from:** §C. Sonnet sessions B12-3 → B12-6 read §C first, then the S-section they build.
> **All seven items locked in this session.** No continuation session required.

---

## 0. Verdict on one screen

| Item | Verdict | The one-line why |
|---|---|---|
| S1 Quota bypass | ⚠️ 5 flaws, all fixed | Presigned URLs don't bound object **size** — a 1-chunk reservation can park ~5 GiB per object. Plus: bound lives in KV, latch isn't atomic, reconcile overwrites live updates, client picks the UUID. |
| S2 Test-credential bypass | ⚠️ 1 flaw, fixed | The bypass is authorised by a **KV flag** — and KV is compromised by assumption. Forge the flag, get free, invisible uploads. |
| S3 Linkage at rest | ⚠️ 2 flaws, fixed | (a) Raw `quota_ref` in manifests lets anyone who received *one* link find the sender's other transfers after an R2 leak. (b) `org_dock` as one KV value loses concurrent writes — which can resurrect a DAD'd entry, i.e. a DAD label by accident. |
| S4 Lodgement ref | ⚠️ 1 flaw, fixed | 6 chars can collide; strike-off is irreversible. Humans read the 6 chars; the server acts on a 128-bit handle. |
| S5 Aggregate differencing | ⚠️ tightened | Hourly whole-GiB is a per-transfer size meter for quiet orgs. Daily 5 % bands instead. The "<3" floor is theatre (the list shows every row) — dropped. |
| S6 Registered-rail auth | 🔒 designed | Magic link + Supabase session store (KV can't hold anything whose forgery grants access). Plus: Bearer principals never get magic links — they get the B8 Locke. |
| S7 Sovereign portability | ⚠️ 1 gap, fixed | "The Deed survives a lost device" is only true if the encrypted ledger lives somewhere off the device. Refueler must not hold it. Deed **+ backup file** is the honest mechanism. |

Six findings reach beyond the seven items (§1). Two of them bite **today**, not post-build (X4, and the Pro Bono half of S1-F1) — flagged for a small pre-Berlin session if the week allows.

---

## 1. Cross-cutting findings

**X1. "KV is compromised" means read *and* write, for anything that grants access.** 🔒
The invariant has been applied to confidentiality ("no raw secrets in KV"). It must also cover integrity: any KV value whose *forgery* grants access, lifts a limit, or selects a privileged branch is either MAC'd under a Worker secret or moved to Supabase. Applied in S1 (upload-session bound), S2 (test flag), S3 (sealed `org_dock`), S6 (sessions). Out-of-scope records with the same shape are listed in §D.

**X2. Chartered can be Bearer-rail. B12 assumes it can't.** ⚠️
Brand-Opus-1: Chartered = "Registered **or** Bearer". B12 §1.2/§1.4/§3.5/§4.6 give every Chartered org a Supabase quota row, an `org_dock`, and a magic-link admin email. For a Bearer-rail Chartered org that is a Supabase row on the anonymous-rail API credential path — a locked DO NOT. Fix: **§0.1 extends to Bearer-rail Chartered.** No `quota_accounts` row, no `org_dock`, no `quota_ref` in manifests; the meter is its credit balance plus per-transfer cap plus expiry. Its Harbourmaster, when built, is device-held (like Sovereign Chambers) and any server state it later needs is gated by the B8 Locke. B12-3/B12-5 build **Registered-rail Chartered only**. Moot until `rails_available` includes Bearer, but must not be built into a corner.

**X3. "Harbourmaster" is triple-booked.** ⚠️ (security lock 🔒 · naming 🟡)
BRIDGE: the internal live-transfer view inside Navy Office. B8 / Silent Drop: the Quay owner who logs in with a Locke. B12: the Chartered org-admin surface. B8 locks "Harbourmaster login = Locke challenge-response, no email"; B12 §4.6 gives the Chartered org admin a magic link. Both are right for *their* principal, which is the point: **authentication follows the rail, never the surface name.** Registered principals → magic link (S6). Bearer principals → Locke (B8 §4). A magic link is never offered to a Bearer principal. Naming clean-up (BRIDGE lines ~225/864) is a 🟡 docs task for Rajesh — but a Sonnet session reading "Harbourmaster login" in B8 while building B12-5 will wire the wrong thing, so resolve before B12-5.

**X4. `dock_index:{uuid}` stores `size_bytes` today.** ⚠️
Dash-2 enrichment writes `size_bytes` and `rail` into KV. That is plaintext size persisted in the compromised store — the exact thing the invariant bans and the thing B12 §1.3 is designed to avoid. Fix: drop `size_bytes` from `dock_index` (Navy Office already displays aggregates only; derive from `total_chunks` if anything needs a number). Belongs in **B12-1** (already touching `dock_index`), pre-Berlin.

**X5. Chambers shares an origin with everything else on refueler.io.** ⚠️ (principle 🔒 · hostname 🟡)
The Sovereign ledger lives in IndexedDB; the Citizen session acts via credentialed fetch. Both are only as safe as the XSS-resistance of the **whole origin** — which also serves Notes articles, marketing pages and the Navy Office admin page. Fix: the Share app (lodge page + Chambers, which must share an origin because receipts are written at lodge time) moves to a **dedicated origin serving nothing else**, with a strict CSP (§S6.8). Hostname is Rajesh's call (e.g. `app.share.refueler.io`); must land before B12-4 ships the Sovereign ledger. `refueler.io/share/chambers/` becomes a redirect.

**X6. Client-chosen UUID at initiate.** ⚠️
`POST /upload/{uuid}/initiate` takes the UUID from the client. A recipient knows the UUID of every transfer they receive. Build must prove initiate is **create-if-absent** on the manifest (R2 conditional put); otherwise re-initiating over a live transfer or a tombstone resets manifest and quota accounting. Precondition test for B12-3; if it fails, fix before any quota code.

---

## S1. Quota bypass vectors (§1.6–1.8)

### Findings

**S1-F1 ⚠️ Presigned PUT URLs bound the key, not the size.** Share-6 D-5 signs `host` only. Each URL for `{uuid}/{iiii}` accepts any body up to R2's single-PUT ceiling (~5 GiB). Quota counts chunks, so a 1-chunk reservation can hold ~160× its quota. Also applies to Pro Bono **today** (no quota, but free credentials and a 4 GiB cap that isn't a cap).

**S1-F2 ⚠️ Presigned URLs outlive the transfer.** URLs stay valid for 6 days. Finalise, then self-DAD or owner-delete (credit-back fires), then re-PUT through the still-valid URLs: objects reappear under a tombstoned UUID with no quota holding them. The orphan sweep's "orphan_chunks never deleted" rule means they sit until the 92-day lifecycle backstop.

**S1-F3 ⚠️ The `/urls` bound must not live in KV.** If "reserved chunks" or `total_chunks` is read from a KV session record, a KV-write attacker lifts it (X1).

**S1-F4 ⚠️ The credit-back latch isn't atomic.** B12 §1.8 concedes KV double-fire and relies on reconcile. There's a better latch available: R2's conditional put.

**S1-F5 ⚠️ Reconcile-by-overwrite loses live updates.** A reconcile that snapshots at T₀ and overwrites at T₁ erases every finalise and release between them. Nightly, silently, forever.

### Decisions

**S1.1 Size is signed into every URL.** 🔒
- Every presigned PUT includes `content-length` in `X-Amz-SignedHeaders`. Index `i < N−1`: `CHUNK_SIZE + 16` exactly. Index `N−1`: `(total_bytes − (N−1)·CHUNK_SIZE) + 16`.
- **The last-chunk URL is minted at initiate and returned in the initiate response**, whatever the batch. This is the only moment the Worker knows `total_bytes`, so nothing about the tail length is ever stored — the "no plaintext size persisted" invariant holds. `/urls` only ever mints full-size indices.
- **Build gate (B12-3, first task):** prove R2 rejects a presigned PUT whose body length differs from the signed value (expect 403). If the presigner is `aws4fetch`, note it lists `content-length` as unsignable — hand-roll that header or patch. **If R2 does not enforce, B12-3 stops and this item reopens.** Do not ship quota on unbounded objects.
- Finalise keeps its HEAD sweep and additionally requires **exact** object sizes (full chunks exact, tail ≤ `CHUNK_SIZE + 16`). Mismatch → 409, objects queued for deletion.

**S1.2 One clock for session, URLs and reservation.** 🔒
- `UPLOAD_WINDOW = 6 days` from initiate. Session token expiry = reservation `expires_at` = initiate + `UPLOAD_WINDOW`. Every presigned URL's expiry = `min(now + 6 d, session_exp)`.
- After `session_exp` no PUT can land and no finalise can succeed, so releasing the reservation is provably safe. This is what makes "in-flight transfers never fail on quota" (§1.9) true: a reservation cannot expire under a live upload.

**S1.3 The bound lives in the MAC, not in KV.** 🔒
- Session token = `v1.<session_exp>.<total_chunks>.<mac>`, `mac = HMAC-SHA256(UPLOAD_SESSION_KEY, "refueler.share.upsession.v1" ‖ 0x00 ‖ uuid16 ‖ commitment ‖ u32be(total_chunks) ‖ u64be(session_exp))`. `/urls` reads the bound from the verified token.
- KV holds only `BLAKE3(token)` + spent flag (single-use at finalise). A forged KV record gets nothing without the MAC.
- **Build check:** Share-6 specified "short-lived HMAC over uuid‖commitment" — confirm what key the live token uses. If it's already a Worker-secret MAC, extend its input; if it's random bytes compared in KV, replace it. `UPLOAD_SESSION_KEY` is only a new secret in the second case.

**S1.4 The Worker derives chunk counts; clients declare nothing twice.** 🔒
- `total_bytes` must be `Number.isSafeInteger` and `> 0`. `need = ceil(total_bytes / CHUNK_SIZE)`. If the client also sends `total_chunks`, it must equal `need` → else 400. `manifest.total_chunks := need`.
- `/urls` refuses any index `≥ need`. Finalise requires `hashes.length === need`.
- `quota_ref` is **always** computed server-side from an authenticated principal (Chambers session for Citizen, verified `rfs_live_` HMAC for Chartered). No request field can name one.

**S1.5 Initiate order.** 🔒
`local credential checks (BDHKE, commitment) → tier cap on resolved_tier → reserve_quota → spend credential (spent_tokens INSERT) → create-if-absent manifest → mint URLs`.
- Reserve before spend: reservation is reversible, spend isn't. Spend fails (409 double-spend) → release reservation in the same request.
- Worker dies between reserve and spend → reservation expires at `session_exp`. Bounded, in our favour.
- Manifest create fails (exists) → 409, release reservation. (Credential already spent — correct: it was spent against an illegitimate UUID choice; X6.)

**S1.6 `reserve_quota` RPC hardening.** 🔒
- One `plpgsql` function, one transaction: conditional `UPDATE … WHERE used_chunks + reserved_chunks + $need <= limit_chunks RETURNING` + reservation `INSERT`. Postgres row lock serialises concurrent initiates on one account — the race is closed by construction. Never SELECT-then-UPDATE.
- Guards inside the function **and** as table CHECKs: `need > 0`, `need ≤ MAX_TRANSFER_CHUNKS` (8,000), `used_chunks ≥ 0`, `reserved_chunks ≥ 0`. A negative `need` would otherwise *inflate* quota.
- `SECURITY DEFINER`, `EXECUTE` revoked from `anon`/`authenticated`; service role only. RLS deny-all on both tables.

**S1.7 Finalise conversion is idempotent.** 🔒
- `finalise_quota(session_hash, chunks)`: `DELETE FROM quota_reservations WHERE session_hash = $1 RETURNING …`, then move chunks reserved → used. No row returned → no-op. A retried finalise can't double-convert.
- On RPC error: finalise still returns 200 (B12 §1.7 stands) and retries the RPC ×3 in `ctx.waitUntil` (2/5/15 s).

**S1.8 The latch is an R2 conditional write.** 🔒
- Every deletion path (DAD, owner-delete, strike-off, grace sweep, orphan sweep) latches on **the manifest object**: read → if already consumed, stop → else `put` with `onlyIf: { etagMatches }`. `put` returns `null` → another path won → no credit-back. Wherever the `consumed:true` guard lives today, it moves to this conditional write.
- Double credit-back becomes impossible rather than improbable. Reconcile stays as the safety net, not the mechanism.
- **Build gate:** unit test two concurrent latch attempts on one manifest → exactly one proceeds.

**S1.9 Reconcile uses optimistic concurrency.** 🔒
- Run at 03:00, computing `used` from live manifests (`upload_complete:true`, not consumed, not soak) per `quota_ref`.
- Write: `UPDATE quota_accounts SET used_chunks = $computed, reconciled_at = now() WHERE quota_ref = $1 AND updated_at <= $T0`. Row touched after T₀ → skip tonight, catch tomorrow.
- `reserved_chunks` recomputed atomically in SQL from unexpired reservation rows; expired rows deleted in the same transaction.
- Reconcile emits one AE counter of corrected accounts and total drift (no identifiers). A non-zero night is a bug report, not a Tuesday.

**S1.10 Sweep rules (amends the orphan-sweep lock).** 🔒
- Chunk objects under a **tombstoned** UUID are always deletable (no upload can be in flight on a consumed transfer). Closes S1-F2.
- Orphan chunks with no finalised manifest and `uploaded` older than `UPLOAD_WINDOW + 1 day` are deletable (every URL that could write them has expired). Replaces "orphan_chunks never deleted".
- Any object whose size ≠ its expected size is deletable immediately (legit PUTs are exact under S1.1).
- Worst case for resurrection griefing is now: signed-length objects, for at most `UPLOAD_WINDOW` + one sweep cycle.

**S1.11 Reservation DoS inside an org.** 🟡
An org member with the API key can over-declare and hold org quota for up to 6 days. It's an insider burning their own org's capacity, bounded by the 250 GiB per-transfer cap. Mitigation: max concurrent reservations per `quota_ref` (Rajesh sets, suggest 20) and Harbourmaster shows "in flight" as its own banded figure. Not a privacy issue; a courtesy.

### Tolerable drift — the honest statement
- Double credit-back: **impossible** (S1.8).
- Missed credit-back (release RPC failed after the latch): over-count, **user's disfavour**, ≤ 24 h.
- Missed finalise conversion (Supabase down at finalise + 3 retries failed): the transfer counts as reserved *and* (after reconcile) used, **user's disfavour**, until `session_exp` (≤ 6 days). Rare, bounded, visible in the reconcile counter.
- **No identified path drifts in the user's favour.** B12 §1.8's "< 24 h, either direction" is replaced by this.

### Tests B12-3 must show green
Signed-length rejection (live R2) · last-chunk URL only from initiate · `/urls` index ≥ need → 4xx · forged KV session record → 401 · concurrent initiates at limit−1 → exactly one 201 · negative/NaN/unsafe `total_bytes` → 400 · finalise twice → single conversion · concurrent latch → single credit-back · re-initiate on existing/tombstoned UUID → 409 · reconcile skips a row touched mid-run.

---

## S2. Test-credential quota bypass (§1.9)

### Finding ⚠️
Share-Admin-1: `POST /admin/test-credential` (admin-key gated) writes `test_credential:{uuid}` to KV; `handleInitiate` sees the flag and skips tier resolution, expiry ceiling, BDHKE and spend. The admin gate protects *issuance*. The *bypass* is authorised by a KV value. Under X1 a KV writer mints unlimited, unpaid, quota-free uploads — and because soak transfers are excluded from aggregates, they'd be **invisible** in Navy Office. The prompt asked to prove no non-admin credential reaches that branch; as built, it can't be proved, because no credential is needed at all.

### Decisions 🔒
1. **The bypass is selected by one thing only:** a header `X-Test-Credential: v1.<uuid>.<cap_chunks>.<exp>.<mac>`, `mac = HMAC-SHA256(TEST_CRED_KEY, "refueler.share.testcred.v1" ‖ 0x00 ‖ uuid16 ‖ u32be(cap_chunks) ‖ u64be(exp))`. Minted only by `POST /admin/test-credential`. New secret `TEST_CRED_KEY` (never derived from `ADMIN_KEY`, which travels in headers and shell history).
2. **All of** these must hold, else fall through to the normal paid path (never an error that reveals the branch exists): MAC valid (constant-time compare) · `exp` ≤ 24 h from issue and not passed · `cap_chunks ≤ 8,000` (code constant, not config) · uuid in token = uuid in path · **no manifest exists** for the UUID (R2, not KV) · KV single-use flag not yet set.
3. No tier value, credential field, query param or other header selects the branch. `soak`/`test` are never `TIERS` members. Build proves one call site with a grep in the session log.
4. `ADMIN_KEY` comparison on `/admin/*` uses `crypto.subtle.timingSafeEqual`. `/admin/test-credential` is rate-limited and emits AE `admin.testcred.issued` (count only).
5. Soak transfers are excluded from **product** aggregates but **shown on their own line** in Navy Office (`Soak: N live · X GiB`). A forged soak transfer is then visible rather than hidden. Manifest carries `soak:true`; no `quota_ref`.

### Proof obligation (B12-3 test matrix)
No header · malformed · wrong MAC · expired · valid token for another UUID · replay after first initiate · KV flag present without header · valid token + existing manifest · `ADMIN_KEY` pasted as the header · tier `soak` in the credential. **All** → normal path (or its ordinary 4xx). Only a fresh, valid, unexpired, matching token reaches the bypass.

---

## S3. Linkage at rest (§1.4, §3.5)

### S3(a) `quota_ref` in manifests ⚠️ → seal it
**Why raw isn't acceptable even on an identity rail.** The test is person ↔ transfer *they did not choose to reveal*. A Citizen chose to be known to Refueler — not to their recipients. Every recipient holds one UUID (it's in the link). With an R2 dump, raw `quota_ref` turns one UUID into the sender's full lodgement history: count, dates, chunk sizes. That's a link the sender never chose, handed to someone who isn't Refueler.

**Decision** 🔒
- Manifests carry `qref_ct`, not `quota_ref`: `{ v:1, k:<kid>, n:<b64url 12B>, c:<b64url ct‖tag> }`, AES-256-GCM under `K = HKDF-SHA256(ikm = SHARE_SEAL_KEY_<kid>, salt = "refueler.share.seal.v1", info = "manifest.qref")`, AAD = `"refueler.share.manifest.qref.v1" ‖ 0x00 ‖ uuid16 ‖ kid`. Fresh random nonce per write.
- Credit-back and reconcile decrypt it (one decrypt per deletion; reconcile reads every manifest anyway).
- **Tombstones strip `qref_ct`** on every deletion path, identically (keeps §6.3's "same shape" and minimises what outlives the transfer).
- Exposure now: R2 alone → nothing about accounts. R2 + Worker secrets → full link (accepted: that's Refueler, and the rail says so).
- 🟡 Field *presence* reveals "Registered/Chartered" vs not. Harmless if the manifest already carries tier/rail fields (it almost certainly does); build confirms. If the manifest is otherwise rail-blind, Bearer manifests carry a same-size dummy.

### S3(b) `org_dock` — lead proposal refined ⚠️
**Flaw 1 — lost updates can forge a DAD label.** "One KV key per org holding entries" is read-modify-write on a store with no compare-and-set. Two finalises race → one entry vanishes. A removal races a write → a DAD'd entry comes back, never gets `purged_at` (no objects left to purge), and sits as *Expired* until TTL while manually-deleted transfers vanish. That's precisely the §0.3 invariant, broken by a race.
**Flaw 2 — encrypting only the UUID leaves the join keys.** `quota_ref` in the KV key and plaintext `lodged_at`/`expires_at` join straight to R2 manifests under a combined leak.
**Flaw 3 — AAD must bind the entry, not just the org.** With AAD = `quota_ref` only, a KV writer can swap two entries *within* an org; strike-off of A then deletes B. Irreversibly.

**Decisions** 🔒
- **One KV key per entry:** `org_dock:{dock_id}:{lodge_handle}`.
  - `dock_id = b64url(HMAC-SHA256(QUOTA_REF_KEY, "refueler.share.dockid.v1" ‖ 0x00 ‖ quota_ref)[0..16])` — no raw `quota_ref` in KV.
  - `lodge_handle` per S4. Deterministic from the UUID, so DAD/delete removes the entry without scanning.
- **Whole entry sealed**, stored as the KV value *and* KV metadata (≤ 1 KiB, so one `list` returns the page without N `get`s): `{ v:1, k:<kid>, n, c }`.
  - Plaintext: `{ uuid, lodged_on:"YYYY-MM-DD", expires_at, purged_at? }` (+ `chunks` for account-of-one docks only — §S3(c)).
  - Key: `HKDF-SHA256(ikm = SHARE_SEAL_KEY_<kid>, salt = "refueler.share.seal.v1", info = "orgdock" ‖ 0x00 ‖ quota_ref)` — a per-dock subkey, derived per request, never stored.
  - AAD: `"refueler.share.orgdock.v1" ‖ 0x00 ‖ quota_ref ‖ lodge_handle16 ‖ kid`. Binds org, entry and key generation.
  - Nonce: fresh random 96-bit per write (re-seal on every mutation). Per-dock subkeys keep counts far below any GCM nonce bound.
- **KV expiration** = `expires_at + 48 h grace + 7 d display`, **rounded up to the next 00:00 UTC, +1 day**. KV expiration is visible to a KV reader; to-the-second expiry would be a join key to R2.
- **Single secret with a key-ID, not per-org secrets.** `SHARE_SEAL_KEY_1` replaces the proposed `ORG_DOCK_KEY` (it now also seals manifests). Current generation named by a non-secret var `SHARE_SEAL_CURRENT = "1"` in `wrangler.toml`.
- **Rotation without re-encrypting live entries:** add `SHARE_SEAL_KEY_2`, flip `SHARE_SEAL_CURRENT`. New writes use 2; reads pick by `k`; any entry touched is re-sealed under 2 (lazy). Retire key 1 after `max(EXPIRY_WINDOWS) + 9 days` — every entry and manifest sealed under it has aged out. No bulk job.
- **Decrypt failure:** fail closed. Strike-off → 409 `entry_unreadable`, no fallback. List view → entry omitted. Both emit AE `seal.decrypt_fail` (counter, no identifiers) and Navy Office shows it red — a non-zero count means tampering or a key-config error, and either is urgent.
- **Fallback to raw UUID (v1): rejected.** The sealed design costs one HKDF and a few µs of AES per request.

**Sweep interaction** 🔒: a sweep writes `purged_at` **only** on entries for transfers where *that sweep run* won the S1.8 latch. Any other state (already consumed) → delete the entry. Absence stays the only signal DAD and manual delete share.

### S3(c) Citizen's server-side list (gap in §4.2) 🔒
B12 gives Citizens a server-side transfer list but no index. Use the same construction, keyed by the Citizen's `quota_ref` — an "account dock". The only schema difference: account docks carry `chunks` (Citizens see their own size, derived as `chunks × 32 MiB`, never stored bytes). **Chartered entries never contain a `chunks` field** — not "don't render it", *don't have it*.

---

## S4. Lodgement-ref derivation (§3.4)

**Finding ⚠️** 6 characters is a display length, not an identifier length. At a few thousand entries per org, collisions become plausible; strike-off is irreversible; "resolve ref within the org's index" would then pick one of two transfers.

**Decisions** 🔒
- `lodge_handle = HMAC-SHA256(QUOTA_REF_KEY, "refueler.share.lodgeref.v1" ‖ 0x00 ‖ quota_ref ‖ uuid16)[0..16]` — 128 bits.
- **Per-org key source: none stored.** Per-org separation comes from binding `quota_ref` into the message under the naming root; for a PRF that is equivalent to a per-org derived key, with one fewer thing to manage.
- **Display** `LR-` + first 30 bits in Crockford base32 (6 chars, no I/L/O/U). Humans read it, quote it, search the list with it.
- **Actions use the full handle** (b64url, 22 chars) in the request body. Strike-off looks up exactly one KV key inside the session's `dock_id`. No prefix matching, ever. Display collisions are cosmetic; dates sit alongside in the list.
- **Cross-org unlinkability:** a UUID belongs to one org; outputs for different `quota_ref`s are independent; without `QUOTA_REF_KEY` nothing maps back to a UUID. An org admin holding a UUID (say, from a link they received) cannot compute its handle.
- **Never rotate `QUOTA_REF_KEY`** without a migration session: it renames quota rows, org handles, dock IDs and every lodgement ref at once.
- **Handle derivation for `ORG-xxxx`** re-tagged: `HMAC(QUOTA_REF_KEY, "refueler.share.orghandle.v1" ‖ 0x00 ‖ quota_ref)` (was the bare prefix `"handle"`). Uniqueness checked at org creation (32 bits; fine for Chartered volumes).
- **Encoding rule for every HMAC/HKDF input in this spec:** `utf8(tag) ‖ 0x00 ‖ fixed-length binary fields`, UUID as 16 raw bytes, `quota_ref` as 32 raw bytes, integers big-endian. Variable-length fields only in last position.

---

## S5. Harbourmaster aggregate differencing (§3.3)

**Finding ⚠️** Hourly whole-GiB rounding is a size meter for any org lodging a few transfers a day: watch the figure, read the list, subtract. The list already shows every lodgement (so the "<3" floor hides nothing it doesn't already show — theatre, and honest claims only). The org being data controller under the DPA doesn't change Refueler's own locked rule: no per-transfer size on this surface.

**Rejected:** noise (repeated observations average it out unless it's sticky, and sticky noise is just a worse band); longer snapshots alone (quiet orgs stay exact).

**Decisions**
- **Held is shown as a band of quota**, floored to **5 % steps**, bar filled to the band. Absolute quota shown; absolute held is not. 🔒 mechanism · 🟡 band width (5 % default; for quotas under ~200 GiB Rajesh may prefer 10 %).
- **Snapshot daily at 03:00**, after reconcile (so it's also the most accurate figure of the day). 🔒
- **Capacity CTA** (80/95) computed from the same daily snapshot, not live. 🔒
- **"Fewer than 3" floor dropped.** 🔒 (supersedes P6's third clause)
- **List dates are day-granular** (`lodged_on`, expiry date). Stored that way too for `lodged_on` (S3(b)). 🔒
- **402 `quota_exceeded` body** (B12 §1.6 step 4): Citizen gets exact held/limit (it's theirs). **Chartered callers get the band**, same as Harbourmaster — otherwise every org API client has an exact meter at the one moment it matters. 🔒
- "In flight" (reserved) shown as its own band. 🔒
- **Residual, stated honestly:** in a quiet org, a transfer large enough to cross a band boundary reveals "someone lodged something at least that big that day". With 5 % of a 1 TiB quota ≈ 51 GiB, that's a coarse signal about the org's own staff, held by the org. Accepted.

---

## S6. Registered-rail auth — Chambers & Harbourmaster (§4.6, §5.2)

**Scope** 🔒: Citizens and **Registered-rail** Chartered org admins. Bearer principals (Sovereign, Bearer-rail Chartered, Silent Drop Quay owners) never receive a magic link (X2, X3).

### S6.1 Principals
- Citizen → `subscribers` row (email already held). Principal ref = `stripe_customer_id`.
- Chartered org admin → new Supabase table `chartered_orgs (org_account_id PK, stripe_customer_id, admin_email, created_at)`, RLS deny-all. One admin email per org in v1. 🔒 (column detail 🟡 for build)
- Chartered `account_id` for `quota_ref` = **`org_account_id`, a stable ID assigned at onboarding** — never derived from the `rfs_live_` key, which rotates. 🔒
- An email that is both a Citizen and an org admin gets one email with two links, one per principal. Tokens bind to exactly one principal. 🔒

### S6.2 Magic-link request — `POST /auth/magic { email }` 🔒
- Turnstile required.
- **Response is always `202 {"ok":true}`, sent before any lookup.** Lookup, token mint and send run in `ctx.waitUntil`. Same body, same status, same timing whether or not the email exists → no enumeration by response or clock.
- Unknown email: send nothing (no "you don't have an account" mail — that's a spam cannon aimed at strangers).
- Rate limits via the existing limiter: per IP 5/15 min · per principal 3/hour · global ceiling with alarm. 🔒 existence · 🟡 numbers.
- **Any KV key derived from an email or IP uses BLAKE3 keyed mode** under `AUTH_PEPPER` (`BLAKE3-keyed(AUTH_PEPPER, "refueler.share.rl.v1" ‖ 0x00 ‖ input)`). Unkeyed hashes of low-entropy inputs are a dictionary lookup under X1. House rule clarified: **BLAKE3 unkeyed for high-entropy secrets (tokens, session IDs); BLAKE3 keyed for low-entropy identifiers.**

### S6.3 The token 🔒
- 32 bytes CSPRNG (256 bits). Stored as `BLAKE3(token)` in Supabase `auth_tokens (token_hash PK, principal_kind, principal_ref, expires_at, used_at)`, RLS deny-all.
- **TTL 15 minutes. Single use**, consumed atomically: `UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING principal_*`.
- **The link carries the token in the fragment:** `https://<chambers-origin>/chambers/signin#t=<b64url>`. Never a query string (server logs, Referer). The page shows **one button — "Enter Chambers"** — and only a click POSTs `{ token }` to `/auth/verify`, then `history.replaceState` strips the fragment. Corporate link-scanners that pre-fetch URLs therefore can't burn the single-use token, and those that run JS still don't click.
- Email: plain text, no tracking pixel, no images, states the 15-minute expiry and "if you didn't ask for this, ignore it".
- 🟡 **Email provider is a new processor** (it learns the address and sign-in times). Choose in B12-4a; DPA and privacy-page line required; API key becomes a Worker secret.

### S6.4 Session store — Supabase, not KV 🔒
KV-write compromise would let an attacker insert a session hash and walk in as anyone (X1). Supabase already holds Registered identity; it gives atomic single-use and "sign out everywhere" in one query.
- `auth_sessions (session_hash PK, principal_kind, principal_ref, created_at, last_seen_at, idle_expires_at, absolute_expires_at)`, RLS deny-all.
- **No IP, no user-agent, no location stored.** `last_seen_at` to the minute.
- Session ID: 32 bytes CSPRNG, stored as `BLAKE3(id)`.

### S6.5 The cookie 🔒
`__Host-rfs_session=<b64url id>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=<absolute TTL>`
- Set by the API host only (host-only, no `Domain`, as `__Host-` requires). Never set or accepted on `workers.dev`.
- Chambers origin and API host must be **same-site** (both under `refueler.io`) so Strict cookies travel on credentialed fetch.

| | Idle | Absolute |
|---|---|---|
| Citizen | 60 min | 24 h |
| Chartered org admin | 30 min | 8 h |

Fresh session ID at every sign-in (no fixation surface — no pre-auth session exists). Max 10 live sessions per principal; oldest evicted. 🔒 TTLs · 🟡 the session cap.

### S6.6 CSRF and CORS 🔒
- Every state-changing call (strike-off, `/billing/portal`, sign-out, sign-out-everywhere) requires **all three**: session cookie · `X-CSRF` header · `Origin` exactly equal to the Chambers origin.
- `X-CSRF = b64url(BLAKE3-keyed(AUTH_PEPPER, "refueler.share.csrf.v1" ‖ 0x00 ‖ session_id))` — derived, not stored; returned in the JSON of `GET /chambers/session`, held in page memory only. Add `X-CSRF` to `corsHeaders()` Allow-Headers (the standing CORS gotcha).
- **Credentialed CORS:** `Access-Control-Allow-Credentials: true` only with `Access-Control-Allow-Origin` = the exact Chambers origin. The `localhost` echo added in Share-Admin-1 **must never be combined with Allow-Credentials** — otherwise any page served on the user's own machine can read their Chambers.
- GETs are side-effect free. Data GETs are protected by SameSite + CORS.

### S6.7 Sign-out, revocation, account changes 🔒
- Sign-out: delete the row, expire the cookie. "Sign out everywhere": delete all rows for the principal.
- Superadmin revocation: delete rows for the principal (SQL; Navy Office has no per-account view, by design).
- Org admin email changed by superadmin → all that principal's sessions deleted.
- Subscription cancelled → session survives, entitlements re-resolve live and clusters re-lock (B12 §4.5 unchanged).
- Strike-off: one at a time (no bulk), 30/session/hour. Limits the blast radius of a stolen session to an afternoon's patience rather than an org's archive.

### S6.8 Page hardening 🔒
- Chambers served from the dedicated app origin (X5) with a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' <api-host>; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Turnstile's host allowed only on the sign-in page. No inline script, no third-party script anywhere else.
- Session secrets never reach `console.log`; Worker logs never print cookies or tokens.

### S6.9 `POST /billing/portal` 🔒
- Session + CSRF + Origin. Creates a Stripe Customer Portal session for the principal's own `stripe_customer_id` (Citizen) or the org's (org admin). Returns `{ url }`.
- **`return_url` is fixed server-side** (Chambers billing section). Never taken from the request — no open redirect.
- **Stripe portal configuration: email editing disabled.** Otherwise a stolen session changes the account email and the next magic link goes to the thief. Email changes go through the AM/support in v1.
- Portal redirect currently points at the broken `upgrade.html` — repoint to Chambers in the same session.
- Rate limit 10/session/hour.

### S6.10 Citizen initiate — precondition for B12-3 ⚠️
Nothing in the spec set documents how `handleInitiate` maps a Citizen upload to its `subscribers` row today (the blind credential alone can't). **B12-3 task 0:** read the code and write down the mapping. If it trusts any client-supplied identifier (email, customer ID, anything unproven), then quota — and `resolved_tier` itself — can be charged to someone else, and Citizen initiate must be authenticated by the S6 session. B12-3 then depends on B12-4a.

---

## S7. Sovereign portability — no sign-in (§4.2)

### Finding ⚠️ — where does the Deed-encrypted ledger live?
"Deed survives a lost device" needs the ciphertext somewhere *other* than the lost device. The obvious answer — Refueler stores the opaque blob under a Deed-derived locator — is rejected 🔒: every backup write is timestamped next to the manifest writes of the same browser session, so over weeks the server clusters a Sovereign's transfers under one locator. That's §0.1's false moustache, wearing a better coat. **Refueler never holds a Chambers blob, in any form.**

So: **the Deed is the key; the user keeps the box.** A backup file (or a message to themselves) plus the Deed restores Chambers on a new device.

### S7.1 What the ledger holds 🔒
- Lodgement receipts: `uuid`, `lodged_on`, `expires_at`, `chunks` (size shown as `chunks × 32 MiB`), tier, any owner-delete capability the live owner-delete path uses.
- Lightning receipts: payment hash, amount, tier. **Never** the preimage.
- Unspent credentials (the token balance) and any local API credential (B12 §4.5).
- **Never the share link fragment** (the AES key) by default. Ledger compromise ≠ cargo compromise. 🟡 an opt-in "keep my links" later, with its own copy.
- Tombstones: IDs of receipts the user deleted locally.

### S7.2 At rest on the device 🔒
Encrypted in IndexedDB under a **non-extractable** WebCrypto AES-GCM key. Where WebAuthn PRF exists, that key is wrapped per B8 D-2 (passkey tap to open Chambers). Honest scope: this defeats someone copying the browser profile; it does not defeat XSS on the origin — which is why X5 exists.

### S7.3 One blob format, two key modes, any transport 🔒
```
blob   = "RFSL" ‖ u8 version(1) ‖ u16be header_len ‖ header(JSON) ‖ nonce(12) ‖ ct‖tag
header = { v:1, mode:"backup"|"pair", created_at, eph_pub:<hex33>, pair_id?:<hex8> }
AAD    = everything before the nonce
body   = JSON { receipts[], tombstones[], credentials[]?, seq }, padded to the next 4 KiB
text   = "rfsl1." + base64url(blob)       (paste form)
```
- **ECIES on secp256k1** via `@noble/secp256k1` (already a dependency — no new curve library): sender generates ephemeral key → ECDH with recipient pub → `HKDF-SHA256(shared, salt = "refueler.share.chambers.v1", info = mode)` → AES-256-GCM. Fresh ephemeral per blob, random nonce.
- Padding to 4 KiB so a blob sitting in a chat history doesn't announce how many transfers you've made.
- Unknown major version → refuse with "this backup needs a newer Chambers". Unknown fields in a known version → ignored.
- Transports: download file · Web Share API (Signal, SimpleX, anything the OS offers) · copy/paste text. Signal and SimpleX are named in the UI as suggested channels; mechanically they're identical, and Refueler can't tell which you used. Neutral filename (`ledger-2026-09-24.bin`). 🔒

### S7.4 Mode "backup" — the Deed 🔒
- `backup_priv` derived from the Deed exactly as B8 D-1 derives the Locke, with its own tags: `okm = HKDF-SHA256(ikm = BIP39_seed(Deed), salt = "refueler.share.chambers.v1", info = "ledger_backup_key")`, scalar reject-sampled with the `".<counter>"` suffix path. **Independent of Deed→Locke** (different salt and info on the same seed; neither key tells you anything about the other).
- **The device stores only `backup_pub`**, written at enrolment while the Deed is on screen. Backups are encrypted *to* it. So the device can make backups but can't read them — an old backup in someone's cloud folder stays shut even against a thief who has the device's storage (older backups can hold receipts the device has since pruned).
- Restore: type the Deed on the new device → derive `backup_priv` → open the file → merge (S7.6) → discard the Deed from memory. Consistent with B8: the Deed is typed only for recovery.
- Backups are offered after each lodgement and weekly; never automatic uploads anywhere.

### S7.5 Mode "pair" — QR for a second device 🔒
1. **New device** makes an ephemeral keypair, keeps the private half in memory, shows a QR of
   `https://<chambers-origin>/chambers/pair#p=<eph_pub>.<pair_id>.<exp>` (fragment: nothing reaches a server). Expiry 10 minutes.
2. **Old device** scans it (camera in-page, or the phone's own camera opens the URL), encrypts the ledger to `eph_pub`, and shows a **6-digit check code** = first 4 bytes of `SHA-256("refueler.share.pair.sas.v1" ‖ 0x00 ‖ eph_pub_new ‖ eph_pub_old)` read as `u32be`, `mod 1,000,000`, zero-padded to 6 digits.
3. User sends the blob to themselves via Signal/SimpleX/file.
4. **New device** opens it, recomputes the code, and imports **only after the user confirms the code matches the one on the old device.** Then deletes its ephemeral key. One use, then useless.

**What a photographed QR reveals:** an ephemeral public key and a random pair ID. No ledger, no identity, no account (there is none). An attacker holding it can try to push a forged ledger to the new device — the check code stops that (they never see the old device's key). After one import or ten minutes, the QR is dead. A blob left in chat history can't be opened by anyone, ever, once the ephemeral key is gone.

**Does the pairing key share a KDF root with the Deed?** No. 🔒 Pairing is pure ephemeral ECDH; the new device may not have the Deed and must never be asked for it just to pair.

**Credentials don't copy, they move.** 🔒 Pairing copies receipts by default. Moving the token balance is an explicit action; the sending device deletes the credentials once the blob is created. (If a user bypasses this and both devices spend the same token, the Supabase double-spend guard returns 409 — money is safe, only the balance display was wrong.)

### S7.6 Replay and stale-ledger merge 🔒
- Receipts are **immutable** and keyed by ID (UUID for lodgements, payment hash for payments). Deletion is a tombstone ID, never an edit.
- Merge = union of receipts ∪ union of tombstones; visible = receipts − tombstones. Commutative, idempotent. Importing a week-old backup, or the same blob twice, can add nothing wrong and remove nothing — a stale ledger can't resurrect what you deleted.
- Same ID, different content → keep the existing, log locally. Credentials: set union; spent ones fall out on first 409.
- Local pruning of expired lodgement receipts 🟡 (suggest expiry + 30 days); Lightning receipts kept 🟡 (suggest 2 years, for the user's own accounts).

### S7.7 UI copy (plain English, Carbon `#1A1917` / Paper `#E8E2D8`) 🔒 meaning · 🟡 wording
- **Chambers header:** *"In camera. Your Chambers lives on this device — not with us."*
- **Pairing screen:** *"This copies your Chambers to a second device while you still have the first. It can't rescue a lost one."*
- **Check code:** *"Only continue if this code matches the one on your other device."*
- **Backup screen:** *"Your recovery sheet is the key. This file is the box. Keep them in different places — you need both to restore."*
- **Lost-device warning (enrolment, one screen, confirm checkbox):** *"If you lose this device, only your recovery sheet and a backup file can bring your Chambers back. A QR code can't. We can't either — we never had a copy."*
- **Backup offer after lodging:** *"Chambers changed. Save a fresh backup?"*

---

## A. Amendments to B12-spec-v1.1

| # | § | Change |
|---|---|---|
| A1 | §0.1, §1.2 | Bearer-rail Chartered follows §0.1: no quota row, no `org_dock`, no `qref_ct`. B12-3/5 build Registered-rail Chartered only. (X2) |
| A2 | §1.4 | Manifest carries sealed `qref_ct`, not raw `quota_ref` (S3(a)). Chartered `account_id` = stable `org_account_id`, never key-derived. Tombstones strip `qref_ct`. |
| A3 | §1.5 | R2 truth table: `qref_ct` replaces `quota_ref`. |
| A4 | §1.6 | Signed `content-length` on every URL; tail URL minted at initiate only; `UPLOAD_WINDOW` aligns session/URL/reservation; bound carried in the session-token MAC; `need` Worker-derived; initiate order `checks → cap → reserve → spend → create-if-absent`; RPC guards + CHECKs; `quota_ref` server-derived only. (S1.1–S1.6) |
| A5 | §1.6 step 4 | 402 body: exact figures for Citizen, **band** for Chartered. (S5) |
| A6 | §1.7 | Conversion idempotent via `DELETE … RETURNING`; 3× `waitUntil` retry. (S1.7) |
| A7 | §1.8 | Latch = R2 conditional put on the manifest; reconcile uses `updated_at` optimistic concurrency; drift statement replaced (S1 "Tolerable drift"). |
| A8 | §1.9 | Test bypass selected only by MAC'd `X-Test-Credential`; soak shown on its own Navy Office line, not hidden. (S2) |
| A9 | §2.1 | Sovereign aggregate computed from the **tier** field, not "no `quota_ref`" (which also catches Pro Bono and soak). |
| A10 | §2.2 | Org handle tag → `refueler.share.orghandle.v1`; uniqueness check at creation. |
| A11 | §3.3 | Daily 5 % bands; CTA from daily snapshot; "<3" floor removed; day-granular dates. (S5) |
| A12 | §3.4 | Strike-off by 128-bit `lodge_handle`; `LR-` + 6 Crockford chars is display only. (S4) |
| A13 | §3.5 | `org_dock:{dock_id}:{lodge_handle}` per-entry keys; whole entry sealed under `SHARE_SEAL_KEY_<kid>` per-dock subkey; AAD binds org + entry + kid; rounded KV expiration; sweep marks `purged_at` only on its own latch. Locked item 36 resolved: **sealed, and more than the UUID.** |
| A14 | §4.2 | Citizen list = account dock (same construction, `chunks` field for account-of-one only). Sovereign Deed option = Deed + backup file; Refueler never stores a Chambers blob. Copy per S7.7. |
| A15 | §4.1, §4.6 | Share app (lodge + Chambers) on a dedicated origin with strict CSP (X5, hostname 🟡). Auth per S6; Bearer principals never get magic links; Stripe portal email editing disabled. |
| A16 | §6.2 / orphan sweep lock | Sweep deletes chunks under tombstoned UUIDs, orphan chunks older than `UPLOAD_WINDOW + 1 day`, and wrong-size objects. Supersedes "orphan_chunks never deleted". (S1.10) |
| A17 | §6.5 / Dash-2 | `dock_index` drops `size_bytes`. (X4) |
| A18 | §7 build order | B12-4 splits: **B12-4a** auth (S6), **B12-4b** Chambers shell + entitlements, **B12-4c** Sovereign ledger + portability. B12-3 may depend on B12-4a (S6.10). |

**Cross-spec (not B12's to amend — flagged for its owner):**
- **B8 §4** — `locke_pubkeys_{harbour_uuid}` is an authorisation set in KV. Under X1 a third party (not just Refueler under compulsion) could inject a pubkey and sign in. Recommend the set carries a MAC under a Worker secret so KV-write alone injects nothing; the honest compulsion claim ("Refueler could, it gains nothing, it's visible") is unchanged. Per B8's own rule this reopens B8-spec, not an SD session.
- **BRIDGE** — "Harbourmaster" definitions (X3).
- **Share-6 D-5** — signed headers now include `content-length` (S1.1).

---

## B. New Worker secrets

All 32 random bytes, base64. Generated and set in the build session that first needs them; that session confirms the exact `wrangler secret put` form against `worker/package.json` (the deploy-targets-the-wrong-Worker trap applies to secrets too). Never in KV, never in the repo, never in chat.

| Secret | Purpose | Rotation | First needed |
|---|---|---|---|
| `QUOTA_REF_KEY` | Naming root: `quota_ref`, `ORG-` handle, `dock_id`, `lodge_handle` | **Never** without a migration session | B12-3 |
| `SHARE_SEAL_KEY_1` | Sealing root: `org_dock` entries, manifest `qref_ct` (replaces proposed `ORG_DOCK_KEY`) | By adding `_2` + flipping `SHARE_SEAL_CURRENT`; lazy re-seal | B12-3 |
| `TEST_CRED_KEY` | MAC on soak test credentials | Any time (invalidates unissued tests only) | B12-3 |
| `UPLOAD_SESSION_KEY` | **Only if** the live session token isn't already a Worker-secret MAC (S1.3) | Any time between uploads (in-flight sessions fail) | B12-3 |
| `AUTH_PEPPER` | BLAKE3-keyed pseudonyms (rate-limit keys), CSRF derivation | Any time (signs everyone out of CSRF; they refresh) | B12-4a |
| email provider key | Magic-link sending (provider 🟡) | Per provider | B12-4a |

Non-secret var: `SHARE_SEAL_CURRENT = "1"` in `worker/wrangler.toml`.

---

## C. Decision summary — what Sonnet builds

### B12-1 (pre-Berlin, existing scope) — add
1. `dock_index` stops writing `size_bytes`. (X4)
2. Sweep rules S1.10 (tombstoned-UUID chunks, orphan chunks > 7 days, wrong-size objects).
3. Sweep writes `purged_at` only when that run won the latch; otherwise removes the entry. (S3(b))

*Optional pre-Berlin B12-1b (if the week allows):* S1.1 signed `content-length` + tail URL at initiate. Closes the live Pro Bono size hole. Otherwise first post-Berlin.

### B12-3 — quota
0. Document Citizen initiate → `subscribers` mapping (S6.10). Prove initiate is create-if-absent (X6). Prove R2 enforces signed `content-length` (S1.1). **Any of the three failing stops the session.**
1. Session token: MAC carries `total_chunks` + `session_exp` (S1.3); `UPLOAD_WINDOW = 6 d` everywhere (S1.2).
2. Initiate: Worker-derived `need`, input validation, order per S1.5, `reserve_quota` RPC per S1.6, `quota_ref` from authenticated principal only.
3. `/urls`: bound from token; full-size signed URLs only.
4. Finalise: exact-size HEAD check; `finalise_quota` idempotent + `waitUntil` retry (S1.7); manifest gets `qref_ct` (S3(a)).
5. Deletion: R2 conditional-put latch on all five paths, one release function, same args; tombstone strips `qref_ct`.
6. Reconcile: optimistic concurrency, SQL-side reserved recompute, AE drift counter (S1.9).
7. Test credential: `X-Test-Credential` MAC path per S2; soak line in Navy Office.
8. Chartered: Registered-rail only (X2); `account_id = org_account_id`; 402 band for Chartered.
9. Test matrices S1 + S2 green.

### B12-4a — auth (new)
S6 in full: `/auth/magic`, `/auth/verify`, `/chambers/session`, sign-out(-everywhere); Supabase `auth_tokens`, `auth_sessions`, `chartered_orgs`; `__Host-` cookie; CSRF + Origin + exact credentialed CORS; dedicated origin + CSP (X5); email provider.

### B12-4b — Chambers shell
Entitlements from `resolved_tier` per request; account dock for Citizen list; locked clusters return no org data.

### B12-4c — Sovereign ledger + portability
S7 in full. **First task:** pure functions + pinned vectors (Deed→`backup_pub` with the BIP-39 all-`abandon`…`art` test mnemonic; ECIES round-trip; SAS code) reproduced in two implementations before any UI.

### B12-5 — Harbourmaster
`org_dock` per S3(b)/S4; list via one `list` call with metadata; strike-off by handle inside the session's `dock_id`; bands per S5; `seal.decrypt_fail` in Navy Office. Resolve X3 naming first.

### B12-6 — billing
`/billing/portal` per S6.9; portal config: email editing off, redirect to Chambers; plans CTA wiring; `/upgrade` 301.

---

## D. Residual risks — stated honestly

1. **Registered rail is linkable by Refueler, by design.** With Supabase + `QUOTA_REF_KEY` + `SHARE_SEAL_KEY`, Refueler (or whoever compels it) links every Citizen and Registered-Chartered transfer to its account. Sealing protects against leaks, not against us. The rail's name already says so.
2. **Worker secret compromise collapses S3/S4.** Everything above assumes secrets hold. They're the crown jewels; treat Cloudflare account access accordingly.
3. **Combined KV + R2 leak** still reveals per-org entry *counts* and day-granular expiry clustering. No account identity, no UUID↔org mapping.
4. **Band crossings** in a quiet org hint that one large transfer happened that day (S5).
5. **Drift** in the user's disfavour: ≤ 24 h (missed credit-back), ≤ 6 days (Supabase outage at finalise).
6. **Presigned-URL resurrection** until the next sweep: signed-length objects, ≤ `UPLOAD_WINDOW` + one cycle. Until S1.1 ships, **today's** Pro Bono path allows ~5 GiB per chunk object for up to 92 days — a cost-griefing hole, not a privacy one.
7. **Magic link = the email account.** Whoever controls the inbox controls Chambers. The email provider sees addresses and sign-in times.
8. **Sovereign ledger = origin XSS resistance + device security.** An unlocked device, or script running on the app origin, reads it.
9. **Deed + backup file** in the same hands = full ledger including unspent credentials. The copy tells people to keep them apart; people will keep them together.
10. **Messengers** know a file moved between your own devices, not what's in it. A seized phone's chat history shows a padded, unopenable blob.
11. **Other KV records that grant access** (outside B12, same X1 flaw, not fixed here): `api_quota_{sha256(rfs_live_key)}` (credit allocations), the `rfs_live_ → org` mapping (must be MAC'd or moved **before B12-3 relies on it for `quota_ref`**), B8's Locke pubkey set. Recommend one audit session.
12. **R2 write compromise** controls quota truth (reconcile trusts manifests). R2 is ground truth by design; if it's writable by an attacker, quota is the least of it.

---

## E. Rajesh's 🟡 list
1. App origin hostname (X5).
2. "Harbourmaster" naming clean-up across BRIDGE/B8 (X3).
3. Band width for small Chartered quotas (S5).
4. Max concurrent reservations per org (S1.11).
5. Magic-link rate-limit numbers and session cap (S6).
6. Email provider (S6.3).
7. Sovereign local pruning windows; opt-in "keep my links" (S7).
8. Whether to squeeze B12-1b in before 30 Sep.
9. Commission the B8 Locke-set MAC amendment + KV-authorisation audit (§D.11).

*Seven items in, seven locked, nobody's train delayed. The signals were red for good reasons; they're green now.*
