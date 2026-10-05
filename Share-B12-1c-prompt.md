You are the technical co-builder of Refueler Share — a privacy-first,
anonymous, encrypted file transfer product. Stack: Cloudflare Workers,
R2, Supabase, BLAKE3 WASM, Cashu (NUT-11 P2PK). I am a non-coder solo
founder. Session prefix: Share-B12-1c.

SONNET BUILD session. Design is locked in `docs/B12-SR-spec-v1.md` §S1.1
(as amended in Part 4 below). Do not redesign; if the code contradicts this
prompt, stop and tell me.

Written 5 Oct 2026 at the close of Share-B12-1b. Runs immediately after
B12-1b; Cred-Fix-2 follows.

---

## Where B12-1b left things (commit `d4d167e`, deploy `0d2f94d9`)

- `npm test` clean (621 passed).
- `r2_presign.js`: `presign(key, { contentLength })` — optional. Omitted =
  host-only URL, byte-identical to before (pinned test). With it, signs
  `content-length;host`.
- **R2 gate passed live:** URL signed for 16 B → 17 B 403 · chunked
  17 B / 1 MiB / 64 MiB 403 · 16 B 200 · nothing written on the failures.
  Do not re-run the gate; it is done.
- `/initiate` and `/urls` still mint host-only URLs. Nothing in production
  signs a size yet. That is this session.

## Decisions already made (Rajesh, 5 Oct)

- **`total_bytes` stays in the manifest this session.** The receiver needs
  the size. Moving the exact size into the URL fragment is its own session
  (**Share-Size-1**, after Cred-Fix-2). Do not touch `total_bytes`,
  `/meta`, `download.js` or `fragment.js` here.
- **The tail URL is always returned separately** as `tail_url`, never inside
  `urls`, for every transfer size (one-chunk files included). One shape,
  no special cases.
- **Frontend ships BEFORE the Worker.** Old frontend + new Worker breaks
  every upload (old code expects the tail in `urls` and asks `/urls` for
  it). New frontend must work against both the current Worker and the new
  one.

---

## Part 0 — test gate

`cd worker && npm test` clean on unmodified `main`. If it won't start:
`rm -rf node_modules && npm ci`, then again. Do not continue until clean.

## Step 0 — read before code

Read (you have repo access — read them yourself, don't ask me to paste):
- `worker/src/r2_presign.js`, `worker/src/sweep_rules.js` (lines 1–63)
- `worker/src/index.js` lines ~1490–1990 (`handleInitiate`,
  `handleUploadUrls`, `handleAdminR2PresignTest`) and the finalise route
  (~line 345)
- `worker/src/handlers/finalise.js`
- `frontend/upload.js` — fresh path (~880–960), `_fetchNextUrlBatch`
  (~697), `_putChunkDirect` (~730), resume path (~1130–1290), IDB
  resume-record save (~948)
- `worker/src/share/admin/test-upload.html` (~310–530)
- `worker/test/share-6-1.test.js`, `share-6-3a.test.js`, `_r2_mock.js`

Then confirm the checklist back to me before any code.

---

## Part 1 — frontend, tolerant of both Worker shapes (ship first)

1. **`upload.js` fresh path:** if the initiate response has `tail_url`,
   use it for index `N−1` and fetch `/urls` batches for full indices only
   (`0…N−2`). If it doesn't (current Worker), behave exactly as today.
2. **`upload.js` resume:** save `tail_url` (url + expires) in the IDB
   resume record at initiate. On resume, if the tail chunk is still to
   upload, use the stored `tail_url` — never ask `/urls` for index `N−1`.
   A record from the new Worker without a stored `tail_url` cannot finish
   → clear it and say "start a new upload" (same pattern as the existing
   incomplete-record message). Old-shape records keep working until the
   Worker deploys.
3. **`test-upload.html`:** same tail handling.
4. PUT bodies stay `ArrayBuffer`/`Uint8Array`/`Blob` so the browser sets
   `Content-Length` itself (it's a forbidden header — don't set it). Never
   a `ReadableStream` body.
5. `node --check` every JS file. Ship with
   `bin/ship-frontend.sh "message"` — must end `✓ SHIPPED`. Then one
   Safari upload + download on https://refueler.io/share/ against the
   CURRENT Worker (proves nothing regressed). Re-check upload mode after
   any receiver-side change (index.njk is both modes).

**Split point:** if Part 1 runs long, stop here. Parts 2–4 become B12-1d.

## Part 2 — Worker (deploy only after Part 1 is shipped)

1. **`/initiate`:**
   - Reject (400) unless `totalChunks === ceil(totalBytes / CHUNK_SIZE)`.
     Without this the tail length can be ≤ 0 or > `CHUNK_SIZE`.
   - Full indices `0…N−2`: `contentLength = CHUNK_SIZE + 16`.
   - Tail index `N−1`: `contentLength = (totalBytes − (N−1)·CHUNK_SIZE) + 16`,
     returned as `tail_url: { index, url, expires }`. Never in `urls`.
   - `urls` / `batch_next` cover full indices only.
   - Use `CHUNK_SIZE` + `CHUNK_TAG_BYTES` from `sweep_rules.js`.
     `index.js` also has `PART_SIZE_BYTES = 33_554_432` — add a test that
     they agree; do not refactor the duplicate away (out of scope).
2. **`/urls`:** `from ≥ N−1` → 400. Clamp `count` so it never reaches
   `N−1`. Full-size `contentLength` on every URL.
3. **Finalise exact-size check** (after the existing completeness check):
   capture `obj.size` in `listBasedCompleteness` (R2 `list()` returns it),
   run `wrongSizeSegments` from `sweep_rules.js`. Any hit → 409
   `{ error: 'wrong_size', segments }` and queue those objects for deletion
   with `ctx.waitUntil` (DAD pattern) — never inline.
   **`handleFinalise(request, env, uuid)` has no `ctx` today** — adding it
   (and passing it at `index.js` ~345) is a signature change: flag it to me
   with a one-line diff before applying.
4. **Do not** write `total_bytes`, `size_bytes` or any tail length anywhere
   new. `total_bytes` already in the manifest stays as is (Share-Size-1).

## Part 3 — tests (`npm test` from `worker/`, all green)

- Full-chunk URL signs `CHUNK_SIZE + 16`.
- Tail URL signs the right remainder (1-chunk file, exact multiple of
  `CHUNK_SIZE`, ragged tail) and comes only from `/initiate`.
- `/initiate` 400s on a `totalChunks`/`totalBytes` mismatch.
- `/urls` 400s for `from = N−1`; a batch ending at the tail stops at `N−2`.
- Finalise 409s on a wrong-size full chunk and on an oversize tail; queues
  deletion via `waitUntil`; writes no new size field.
- `CHUNK_SIZE` and `PART_SIZE_BYTES` agree.

Then `npm run deploy` from `worker/`.

## Part 4 — live verify + spec wording

1. Safari on https://refueler.io/share/: a small file (1 chunk), a ~100 MB
   file (ragged tail), and a resume (interrupt mid-upload, reload,
   resume). Each must download and open. Receiver card shows name, size,
   expiry.
2. Over 256 chunks (> 8 GiB) via `admin/test-upload.html` with a test
   credential — confirms `tail_url` outside the first batch.
3. Wrong-size PUT on a real issued URL → 403 (give me the curl one-liner).
4. Amend `docs/B12-SR-spec-v1.md` §S1.1 with a dated note (Share-B12-1c,
   Rajesh-approved 5 Oct): the signature bounds the tail object's size;
   it does not hide the file size. `total_bytes` remains in the manifest
   until Share-Size-1, and R2 object sizes reveal the ciphertext size to
   the storage operator regardless.

## Out of scope

- Share-Size-1 (size into the URL fragment), size padding (logged idea).
- S1.2 `UPLOAD_WINDOW` unification, S1.3 session-token MAC, quota RPCs — B12-3.
- `dock_index`, sweeps, DAD — B12-1.
- Navy Office — B12-2, run in the refueler-io project.
- NutPub `LESSONS.md` — its own session before Cred-Fix-2.

## Session rules

- Confirm the checklist, then code. Propose before editing; scratch-test
  where useful.
- Flag any new `export` or signature change before applying.
- `node --check` every JS file.
- Worker deploy: `npm run deploy` from `worker/`. Frontend: only
  `bin/ship-frontend.sh`.
- Rajesh commits: give him the command, always `&& git push`.
- Close: update `share-sessions.md` + `Share-Master-Context.md`.
