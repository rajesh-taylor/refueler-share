# Share-6-spec-v1.md — refueler-share large-upload direct-to-R2 architecture lock

> **Session:** Share-6-Opus · 16 Sep 2026 · Opus · architecture + design, no code produced
> **Status:** locked spec. Six decisions (D-1…D-6) resolved in-session.
> Load alongside `CLAUDE.md`, `Share-Master-Context.md`, `share-sessions.md`, `merkle-spec-v1.md`, `B8-spec-v1.md`, `DESIGN-TOKENS.md`.
> **Supersedes:** the Share-5 log entries **SHARE-503** and the "Option A (bigger chunks)" note — both closed here (§0, §1).
> **Depends on (pulls forward):** `merkle-spec-v1.md` §9 **B9-1** (tree construction) and **B9-3** (download verification). The direct-to-R2 cutover cannot ship its integrity story without them — see §4 and §9. This is the load-bearing correction of the session brief.
> **BRIDGE bump:** v9.5 → v9.6 (add §Large-upload → "see `Share-6-spec-v1.md`").

---

## 0. Honesty banner — read this before quoting anything from this file

This document designs the migration of the upload path **off the Worker edge and directly to R2** via presigned S3 URLs. **None of it is live on 16 Sep 2026.** What is true today versus what this file *specifies*:

| Thing | State on 16 Sep 2026 |
|---|---|
| Sequential 8 MB chunk PUT → Worker → R2 (`env.BUCKET.put`) | **Live.** The path that broke in Share-5. |
| SHARE-503 (CF-for-SaaS 503 under chunk burst) | **Live bug.** Interim fix = consumer `WORKER_URL` reverted to `workers.dev`. **This spec's design removes the root cause.** |
| `NotReadableError` at ~108 chunks (in-RAM blob, stale FileReader) | **Live fragility.** Removed by per-chunk read-encrypt-dispatch (§3). |
| Direct browser→R2 presigned PUT | **Not built.** Share-6-1/6-2. |
| `merkle_root` + `{uuid}/hashes` sidecar written at finalise | **Not built.** Share-6-3 (delivers B9-1 tree fn + B9-2 sidecar). |
| Download-time verify-then-flush + 409 (B9-3) | **Not built.** Share-6-5. **This is the integrity gate for the consumer cutover.** |

**Banned phrases carry unchanged** (from `merkle-spec-v1.md` §0 and `B8-spec-v1.md` §0): never *"end-to-end file integrity"* (Worker sees **ciphertext storage integrity** only; end-to-end is the recipient's plaintext check); never *"proof of delivery"*; never *"zero-knowledge"* as a headline; never *"military-grade"*; never *"smart contract"* for OTS anchoring. **New for Share-6:** never say the browser-to-R2 leg is *"verified in transit by the Worker"* — under this design the Worker is **not in the transfer path** and verifies **nothing** on upload (§4). Do not describe direct-to-R2 as live in any copy until Share-6-6 signs off.

**The correction this file exists to make.** The session brief states integrity *"already"* shifts to download-time reconstruction *"(already how the B9 download sequence works)."* It is **not built** — B9-3 is design-locked in `merkle-spec-v1.md` §9 but has no code. Removing the Worker from the upload path **deletes the only live integrity check** (the 400-on-mismatch at chunk N) and there is **nothing behind it yet**. The direct-to-R2 cutover therefore **hard-depends on building B9-3 first or in the same block** (§4, §9). This is not a re-litigation of the approach — it is the sequencing the approach requires.

---

## 1. Scope and the settled approach (D-boundary)

**Settled (not re-opened):** browser encrypts each part and PUTs it **direct to R2's S3 endpoint** via a **presigned URL**. The Worker **initiates and finalises only** and is untouched during transfer. The R2 **Workers binding `uploadPart` is rejected** for the upload path (it routes browser→Worker→R2, reintroducing SHARE-503). ✔ All of this holds.

**The one HOW this session must resolve — and it is not the same question the brief thought it was.** "Presigned S3 URLs, browser PUTs each part direct" has **two realisations**, and a **locked upstream spec forces the choice**:

- **B-multipart (S3 `CreateMultipartUpload` → presigned `UploadPart` ×N → `CompleteMultipartUpload`).** `Complete` concatenates the parts into **one object**. That **directly contradicts `merkle-spec-v1.md` §1**, which defines the Merkle leaf as *"the BLAKE3-256 digest of the stored ciphertext of chunk i … exactly the bytes in `{uuid}/{iiii}`"* — i.e. **one addressable R2 object per chunk**. It also contradicts the B9-3 download sequence, which is specced as per-chunk verify-then-flush over `{uuid}/{iiii}` objects. Choosing multipart silently breaks two locked designs and forces a rewrite of the already-locked B9 download path.
- **B-object (presigned `PutObject` per chunk to `{uuid}/{iiii}`).** ✅ **Chosen.** Each 32 MiB encrypted chunk is PUT direct to its own R2 object at key `{uuid}/{iiii}`. This is squarely inside the settled approach ("presigned S3 URLs, browser PUTs each part direct"), and it **preserves every downstream locked invariant**: the `{uuid}/{iiii}` layout (`merkle-spec-v1.md` §1), the B9-3 per-chunk download sequence, the resume-by-object-HEAD path, and the existing `/download/{uuid}/{iiii}` handler (**unchanged**). There is **no `CompleteMultipartUpload` call** — "finalise" is a Worker POST that writes the manifest + sidecar (§3).

**Why this is not re-litigating.** The brief's CRITICAL block settles *"presigned S3 URLs vs Worker binding uploadPart."* Both realisations above use presigned S3 URLs, not the binding. The multipart-vs-object detail is an implementation HOW, and `merkle-spec-v1.md` §1 already answers it. B-object is the layout-preserving realisation of the settled approach.

**Consequence for the 10,000-part cap:** the 10k limit is an **S3-multipart** constraint. B-object has no such hard cap. We nonetheless keep **32 MiB parts and treat 10,000 as an advisory object-count ceiling** (§2) — it keeps object counts sane and keeps the door open to switch to B-multipart later without re-sizing. The **`AbortIncompleteMultipartUpload` 24h lifecycle rule** (`wrangler.toml`) applies only to multipart and is inert under B-object; it is **replaced by the 92-day expiration backstop plus an explicit orphan sweep** (§9, Share-6-6).

---

## 2. D-1 — Part size (LOCKED: 32 MiB, uniform across all tiers)

- **Part size = 32 MiB = 33,554,432 bytes of plaintext.** One part = one AES-GCM chunk. Stored object = ciphertext ‖ 16-byte GCM tag = plaintext + 16 B. Uniform across **all** tiers — part size is **never** branched by tier (§5 handles tier ceilings via a single guard, not a per-tier part policy).
- **Against the advisory 10,000-object ceiling:**

  | Tier ceiling | Bytes | Parts @ 32 MiB | Headroom to 10k |
  |---|---|---|---|
  | Pro Bono (free) — 4 GiB | 4,294,967,296 | **128** | — |
  | Citizen / Sovereign — 100 GiB | 107,374,182,400 | **3,200** | — |
  | Chartered — 250 GiB | 268,435,456,000 | **8,000** | **2,000 (20%)** |

- **5 MiB S3 minimum:** 32 MiB clears it 6.4×; irrelevant under B-object (no minimum for `PutObject`), but preserved so a future B-multipart switch is legal. Final part may be < 32 MiB (fine).
- **Request-count win, independent of the direct path:** 8 MiB → 32 MiB cuts object/PUT count **4×** (250 GiB: 8,000 vs 32,000). Fewer dispatches is itself part of why the Share-5 fragility eases.
- **Change:** `frontend/crypto.js` `CHUNK_SIZE` 8 MiB → 32 MiB (`33_554_432`). The Worker's `CHUNK_SIZE_MAX` guard no longer gates uploads (Worker is out of the path) but remains for any legacy route.

---

## 3. D-2 — Upload flow (LOCKED: initiate → per-part direct PUT → finalise)

Three Worker touchpoints, none carrying file bytes:

**① `POST /upload/{uuid}/initiate`** (replaces the current chunk-0 header block)
Body carries what chunk-0 headers carry today. Worker, in order:
1. Verify the unblinded **Cashu** credential (Mode 1 path, unchanged) and the UUID-commitment (`X-Credential-Commitment` logic, unchanged).
2. **Size-cap guard** against `total_bytes` using **`resolvedTier` (live Supabase)** — never `issued_tier` (architecture-invariant). 413 on breach (§5).
3. **Spend** the credential (Supabase `spent_tokens` INSERT) — **once, here** (satisfies *"Cashu verified on INITIATE only, not per-part"*).
4. `createManifest({… status: uploading, upload_complete:false, chunks_received:[] …})`; apply tidal / destroy-after-download / P2SH / API-tier fields (all moved up from chunk-0); `file_name` stays the constant `"encrypted-payload"` (D-1 filename invariant — real name in fragment only).
5. Mint an **upload-session token** (short-lived HMAC over `uuid‖commitment`, KV-TTL to expiry) and the **first batch** of presigned `PutObject` URLs (§6).
Returns `{ uuid, session_token, urls:[{index, url, expires}], batch_next }`.

**② Per-part: browser → R2 direct** (Worker untouched)
For each chunk `i`: lazily `slice(i*32MiB, …)` off disk (single file) or off the in-RAM zip Blob (folder, §6/§7) → `FileReader` reads **that slice only** (a fresh reader per part, released immediately — this is the `NotReadableError` fix) → AES-GCM encrypt with **AAD = 4-byte BE uint32 of `i`** (§8) → BLAKE3-hash the ciphertext locally (merkle leaf `i`) → `PUT` the ciphertext to the presigned URL for `{uuid}/{iiii}` → read `ETag` from the response as the R2 ACK. Retry budget = Share-5's (6 attempts; 2/5/15/30/60 s). IDB per-chunk state written on each ACK (unchanged shape). When a batch runs out, `POST /upload/{uuid}/urls {from,count}` (auth: session token) for the next batch (§6).

**③ `POST /upload/{uuid}/finalise`** (auth: session token)
Body: `{ merkle_root (b64url 32B), chunk_count, hashes (b64url of 32·N concat), + tidal/PR fields if deferred }`. Worker:
1. Validate `hashes.length === 32 · chunk_count`; **HEAD** each `{uuid}/{iiii}` for existence + size (cheap completeness check — this is what `CompleteMultipartUpload` gave us for free; the Worker still reads **no bodies**).
2. Write `{uuid}/hashes` sidecar (raw 32-byte concat, chunk order — `merkle-spec-v1.md` §1/§2).
3. Set `manifest.merkle_root`, `tree_algo:"rfc6962-unbalanced-blake3-v1"`, `chunk_count`, `upload_complete:true`; `putManifest`.
4. API-tier: emit `cargo.accepted` receipt (moved here from chunk-0 `putManifest`).
Returns `{ ok:true }`. **The browser writing `merkle_root` + the hashes blob at finalise is the confirmation the brief asked for.** ✔

**Header → phase migration** (was: all on chunk-0 PUT):

| Field | Now travels on |
|---|---|
| Cashu credential, commitment, issued_tier, total_chunks, total_bytes, expiry, P2SH hash, tidal, destroy-after-download, transfer-ref, api-live-key, `X-File-Name:"encrypted-payload"` | **initiate** |
| ciphertext body, per-chunk BLAKE3 (local only) | **direct PUT** (no Worker) |
| `merkle_root`, hashes blob, chunk_count | **finalise** (known only after all chunks hashed) |

---

## 4. D-3 — Integrity reconciliation (LOCKED, and the honest gap)

**What is lost.** Today the Worker recomputes BLAKE3 over each chunk body and returns **400 on mismatch** (`verifyChunkHash`, live). Under B-object the **Worker never sees a part on upload** — this check is **structurally gone**. There is no way to keep it without putting the Worker back in the path (SHARE-503). Stated plainly, not dropped.

**Where integrity goes.** Entirely to **download-time reconstruction** — the `merkle-spec-v1.md` §3 / B9-3 sequence: `GET {uuid}/hashes` → reconstruct the RFC-6962-unbalanced-BLAKE3 root → compare `manifest.merkle_root` → **verify-then-flush each chunk, 409 on any mismatch.** The browser writes both inputs (root in manifest, hashes in sidecar) at **finalise** (§3③), so the data exists for the Worker to verify on the way out.

**The gap the brief missed — and the resulting hard rule.** B9-3 is **not built**. If direct-to-R2 shipped today, uploads would have **no** upload-time check **and no** download-time check — integrity would rest only on (i) the browser trusting its own pre-PUT hash and (ii) R2/TLS transport durability (optionally hardened with an S3 `Content-MD5` per PUT). That window is unacceptable for the honesty banner. Therefore:

> **CUTOVER GATE (locked):** consumer traffic is **not** switched to the direct-to-R2 path until **Share-6-5 (B9-3 download verification) is green.** Share-6-3 writes the sidecar + root from day one so the data is present; Share-6-5 turns on the verification that makes it mean something; Share-6-6 flips the consumer `WORKER_URL`. Until then, uploads stay on the current Worker path.

**Interim `Content-MD5` (optional, recommended):** have the browser send `Content-MD5` on each presigned PUT so R2 rejects a corrupted-in-transit part at write time. This is transport integrity (MD5, not our BLAKE3 canon) and does **not** substitute for B9-3 — it just narrows the pre-B9-3 window. Decide at Share-6-2.

**Leaf definition note (non-normative phrasing fix):** `merkle-spec-v1.md` §1 writes the leaf as *"nonce ‖ ciphertext ‖ GCM tag"*. The **live** encrypt path stores only `ciphertext ‖ tag` (the session IV lives in the fragment, not prepended per object). The **operative** clause — *"exactly the bytes in `{uuid}/{iiii}`"* — is what binds, and it is preserved: **leaf `i` = BLAKE3 over exactly the stored bytes of `{uuid}/{iiii}`.** The per-chunk-nonce question (and the pre-existing single-session-IV reuse across chunks) is **out of scope here** and flagged for a dedicated crypto session — do **not** "fix" the IV scheme inside the multipart work.

---

## 5. D-4 — Cashu at initiate + the size-cap guard (LOCKED)

- **Verify + spend once, at initiate** (§3①). No per-part credential work. ✔ invariant.
- **Two-layer cap, one guard each side:**
  - **Browser (UX only):** before initiate, read the tier from the credential's `issued_tier`; if `file/zip size > tier ceiling`, block with the copy below. Never the real gate.
  - **Worker (the real gate):** at initiate, resolve tier **live from Supabase (`resolvedTier`)** and reject `total_bytes > TIER_CAPS[resolvedTier]` with 413. **`issued_tier` must never gate the cap** (architecture-invariant). Cap enforcement thus **moves from chunk-0 to initiate** (the Worker no longer sees cumulative bytes flow).
- **Ceilings:** Pro Bono 4 GiB · Citizen/Sovereign 100 GiB · Chartered 250 GiB.
- **Over-cap copy (Carbon/Paper, brand vocabulary):**
  - Free → `"This transfer is {size}. Pro Bono transfers are capped at 4 GB. Enrol as a Citizen or Sovereign to lodge up to 100 GB."`
  - Paid consumer → `"This transfer is {size}. Citizen and Sovereign transfers are capped at 100 GB. Chartered access lodges up to 250 GB — get in touch."`
  - Chartered → `"This transfer is {size}. The maximum single transfer is 250 GB. Split it into separate transfers."`

---

## 6. D-5 — Presigned URL expiry, batching, and R2 CORS (LOCKED)

- **Presigning availability:** R2's S3 API supports SigV4 presigned URLs on **all plans**, signed in the Worker with an **R2 API token** (Access Key ID + Secret Access Key held as Worker secrets — **never KV**, per invariant). Endpoint: `https://<CF_ACCOUNT_ID>.r2.cloudflarestorage.com/refueler-share-prod`. The **secret never leaves the Worker**; the browser receives only the signed URL.
- **Signer:** recommend **`aws4fetch`** (`AwsClient.sign(url,{aws:{signQuery:true}})`, ~zero transitive deps, Worker-proven). Dependency-free alternative: hand-rolled SigV4. **Founder decision — see chat.**
- **Expiry = 6 days (518,400 s).** SigV4's hard `X-Amz-Expires` cap is 7 days; 6 days covers a 250 GB upload on a slow line (~55 h at 10 Mbps) with clock-skew margin and stays under the cap.
- **Batching = 256 URLs per batch.** Minting 8,000 URLs up front bloats the initiate response (~5 MB) — rejected. First batch ships in the initiate response; subsequent batches via `POST /upload/{uuid}/urls {from,count}` authed by the **upload-session token** (NOT by re-verifying/re-spending Cashu — that is initiate-only). Uploads ≤ 256 parts (≤ 8 GiB) get all URLs at initiate.
- **Threat note:** a presigned PUT URL grants write to one object key for its window. Mitigation: unguessable v4 UUID, session-token-gated batches, and B9-3 download verify (409) catching any tamper. State, don't over-claim.
- **R2 CORS — new config step (Share-6-2).** Allow the `refueler.io` origin (+ WL origins) to PUT direct. Keep signed headers minimal (`host` only) so the browser sends just `Content-Type`/`Content-Length` and preflight stays trivial. Rules:
  ```json
  [{ "AllowedOrigins": ["https://refueler.io"],
     "AllowedMethods": ["PUT"],
     "AllowedHeaders": ["content-type","content-md5"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 3600 }]
  ```
  (Add each live WL origin from `wl_config.js` as they onboard.)

---

## 7. D-6 — Resume (single files) + folder RAM cap (LOCKED)

- **Single-file resume — preserved.** IDB record shape unchanged. Resume = existing RU2c re-credential (Turnstile-bypassed; Worker HEADs `{uuid}/0000` to prove a partial exists) → request presigned URLs for the **missing indices only** → re-slice the **same file lazily off disk** from the resume index (no RAM blob). ✔ invariant "resume path (IDB) must still work for single files."
- **Folders remain RAM-bound — explicitly accepted, capped.** No disk file exists for a folder (browser can't stream a zip to disk cross-Safari). Design: folder → fflate streaming `Zip`/`ZipPassThrough` into **one in-RAM Blob** → then treat **exactly** as a single file (lazy 32 MiB slices, fresh FileReader per slice). This removes the *stale-FileReader-over-15-min* root cause even for folders (no reader outlives one chunk); the residual risk is pure RAM pressure from the blob, **bounded by a cap**.
  - **Folder cap = 2 GiB zipped** (the Share-5 failure appeared at ~1.1–1.3 GB in RAM; 2 GiB is bounded headroom). **Founder: confirm the number.** Over cap → `"This folder is {size} zipped. Folders are held in memory during upload and capped at 2 GB. Zip it yourself and lodge the .zip as a single file — single files stream from disk with no size limit beyond your tier ceiling."`
  - **FOLDER-RESUME** stays the accepted interim from `areas/refueler-share.md`: folder-originated transfers **auto-discard** on resume with the logged message. True folder-resume (re-zip + skip sent) is **not** solved here.

---

## 8. AAD / index mapping reconciliation (LOCKED — the footgun is dissolved)

The brief flags *"part-number ↔ AAD index mapping."* Under **B-object there is no S3 part number.** The object index `i` in `{uuid}/{iiii}`, the AES-GCM **AAD** (`DataView.setUint32(0, i, false)`), and the **Merkle leaf order** are **one and the same `i` — 0-indexed, big-endian, end to end.** No `+1` anywhere. (Had we chosen B-multipart, `partNumber = i+1` while `AAD = i` — a live off-by-one hazard. Avoiding it is a further point for B-object.) Do **not** reintroduce a 1-indexed part number.

---

## 9. Share-6 build-session plan

| Session | Label | Scope | Repo | Prerequisite |
|---|---|---|---|---|
| **Share-6-1** | Presigning + initiate | R2 API token secrets; SigV4 presigner (`aws4fetch` or hand-rolled) in Worker; `POST /upload/{uuid}/initiate` (Cashu verify+spend moved here, size-cap guard via `resolvedTier`, manifest create, first URL batch + session token); `POST /upload/{uuid}/urls` batch endpoint. Unit tests: presign shape/expiry, commitment binding, session-token auth. | refueler-share | Share-6-Opus (this) |
| **Share-6-2** | R2 CORS + direct-PUT loop | Bucket CORS (§6); rewrite `frontend/upload.js` chunk loop to lazy-slice → fresh-FileReader → encrypt → BLAKE3 → **direct presigned PUT** → ETag ACK; retry/backoff (Share-5 budget); IDB per-chunk state; `CHUNK_SIZE` 8→32 MiB; optional `Content-MD5`. | refueler-share | Share-6-1 |
| **Share-6-3** | Finalise + sidecar (**pulls B9-1**) | `POST /upload/{uuid}/finalise` (validate hashes vs `chunk_count`, HEAD completeness, write `{uuid}/hashes`, set `merkle_root`/`tree_algo`, `upload_complete`, tidal/PR/receipt). Browser computes RFC-6962-unbalanced-BLAKE3 `merkle_root` (**this is B9-1's tree fn — built here**) + hashes blob and POSTs. | refueler-share | Share-6-2 · (B9-1 folded in) |
| **Share-6-4** | Resume + folder cap | Single-file resume via re-credential + missing-index presign; folder → in-RAM zip Blob → lazy path; folder-resume auto-discard; folder cap + size-cap over-cap copy. | refueler-share | Share-6-2 |
| **Share-6-5** | Download verification (**delivers B9-3**) | `GET {uuid}/hashes` → reconstruct root → compare `merkle_root` → verify-then-flush per chunk → **409**. Wired into `/download`. **The integrity gate for cutover.** | refueler-share | Share-6-3 |
| **Share-6-6** | Audit + cutover | Orphan-object sweep (replaces AbortIncompleteMultipartUpload rule); interim-window sign-off; **flip consumer `WORKER_URL` to direct path** (closes SHARE-503); regression (resume, tidal, DAD, passphrase, API receipts); Safari 15-min soak; 250 GB soak. **Share-6 close.** | refueler-share | Share-6-4, Share-6-5 |

**Buffer pool (2):** `Share-6-2b` (Safari / cross-browser direct-PUT + CORS preflight) · `Share-6-5b` (verify-then-flush edge cases, partial-sidecar).

**Ordering note.** `6-1 → 6-2 → 6-3` is the spine; `6-4` runs parallel to `6-3`. **`6-5` gates the cutover** — do **not** move consumer traffic to direct-PUT before `6-5` is green (§4). `6-3` folds B9-1 forward (small pure fn); if `merkle-spec-v1.md` §9 B9 is scheduled independently, B9-1/B9-2/B9-3 are **subsumed** by Share-6-3/6-5 and B9's plan starts at B9-4.

---

## 10. Do-not-retry (Share-6-Opus additions)

- DO NOT use the R2 Workers binding `uploadPart` (or any `env.BUCKET.put` from the browser path) for uploads — it routes through the Worker and reintroduces SHARE-503.
- DO NOT use S3 `CompleteMultipartUpload` — it collapses parts into one object and breaks `merkle-spec-v1.md` §1 (`{uuid}/{iiii}` per-chunk leaf) and the B9-3 per-chunk download path. Presigned **`PutObject` per chunk** only.
- DO NOT ship the consumer cutover before B9-3 (Share-6-5) is green — the Worker upload-time 400-check is gone and download-time verify is the only replacement.
- DO NOT gate the tier cap on `issued_tier` — resolve live from Supabase (`resolvedTier`) at initiate.
- DO NOT re-verify or re-spend the Cashu credential per part or per URL batch — verify+spend once at initiate; batches use the session token.
- DO NOT put the R2 secret access key in KV or in a presigned URL — Worker secret only; the URL carries a SigV4 signature, not the key.
- DO NOT prepend the batch/part number as `i+1` anywhere — `i` is 0-indexed end-to-end (object key = AAD = Merkle leaf).
- DO NOT "fix" the single-session-IV / per-chunk-nonce scheme inside this work — flagged for a crypto session; the leaf binds to *exactly the stored bytes*.
- DO NOT attempt true folder-resume — folder auto-discard is the accepted interim; folders stay RAM-bound under the 2 GB cap.
- DO NOT set `X-Amz-Expires` above 7 days (SigV4 hard cap) — 6 days is the lock.

---

*"Nothing stops this train."*
