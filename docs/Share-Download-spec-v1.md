# Share-Download-spec-v1.md — large downloads (100–250 GB) for paid tiers

> **Session:** Share-Download-Opus · 27 Sep 2026 · Opus · design only, no Worker or frontend code
> **Status:** **Decisions D-1…D-9 approved by Rajesh, 27 Sep 2026 (all as recommended; D-2 clarified — see §9).** Spike S-1/S-2/S-3 results may still reopen §2.2.
> Load alongside `CLAUDE.md`, `docs/Share-6-spec-v1.md` (upload + B9-3 download verify), `merkle-spec-v1.md` §3, `docs/B12-SR-spec-v1.md` (X1 KV rule).
> **Scope:** the recipient side of a 100 GiB (Citizen/Sovereign) or 250 GiB (Chartered) transfer: browser save path, resume, destroy-after-download (DAD) interaction, pre-download guidance, the collector (CLI / MCP `refueler_fetch`), and the soak harness needed to test it for real.

---

## 0. Honesty banner — what is true on 27 Sep 2026

| Thing | State (verified by reading code on 27 Sep unless marked) |
|---|---|
| Chromium (Chrome/Edge/Brave) download | `showSaveFilePicker` → `createWritable()` → decrypt and write chunk by chunk (`frontend/download.js` `_startDownloadStream`). Sequential, one chunk prefetched. 4 attempts per chunk (1/2/4 s back-off), then the whole download aborts. |
| Safari / Firefox download | Blob fallback (`_startDownload`): every ciphertext chunk kept in an array, then every plaintext chunk in a second array, then one `Blob`. **Needs about 2× the file size in RAM.** No size cap, no warning. **This already bites Pro Bono:** a 4 GiB transfer needs about 8 GiB of browser memory. |
| Download resume | **None** on any path. A failed chunk after retries throws the whole download away. |
| Full 100 GiB download | **Never run in a browser.** Soaks sampled 5 chunks. Part 1 of this session runs the first full *server-side* download (random bytes, no decrypt). See §0.1. |
| Worker verified path | Per-chunk BLAKE3 verify-then-flush; ≤128 chunks buffered and 409 on mismatch; >128 chunks streamed and the connection is cut on mismatch (Share-6-5a). Range requests → 416. |
| DAD trigger | `finishDownload` starts `destroyTransfer` as soon as the **last chunk's response object is created** (Share-B11-1, refactored Share-DAD-2). |
| Recipient plaintext check | `blake3PlaintextRoot` is computed at upload (permanent record only). **The download path does not recompute it.** Per-chunk AES-GCM tags (with the chunk index as AAD) catch tampering *within* a chunk; nothing on the recipient side catches a transfer truncated by a lying `total_chunks`. |

**Banned phrases carry unchanged:** never "end-to-end file integrity", "proof of delivery", "verified in transit". The Worker's check is **ciphertext storage integrity**. The recipient's check is AES-GCM per chunk (plus the plaintext root, once §7.4 is wired).

### 0.1 Part 1 — raw 100 GiB download of `3a4d8828-6812-4eb9-9b5d-e31b60c72fac`

Script: `worker/scripts/soak-download.mjs` (proposed; scratch-tested against a fault-injecting mock — 409, 503, 429, mid-body abort, kill-and-resume, altered sidecar hash, DAD-armed refusal — all behaved). **Result ✓ (27 Sep 2026, 13:25–15:02 UTC, home line → USB APFS SSD):** 3,200/3,200 chunks, 100.00 GiB (107,374,182,400 B) in 97.2 min, **17.6 MiB/s** average, concurrency 4. `X-Integrity: ciphertext-storage-verified` on **all 3,200**. 0 × 409, 0 × 429, 0 × 5xx, 0 stream aborts, 0 short bodies, 0 local-hash mismatches. **1 retry:** chunk 2746 stalled with no bytes for 300 s (client timeout), then succeeded (88 s). Local Merkle root = manifest `merkle_root` (`MBOwdiqu…fu4Q`) — every byte on disk matches what the uploader committed. Transfer not deleted (`/meta` 200 after). Server half of a 100 GiB verified download: **proven**. Browser half and decrypt: untested (§8).

**Lesson for Share-DL-1:** browser `fetch()` has no timeout either. A chunk that stalls silently would hang the download forever. Add a per-chunk stall timeout (no bytes for N seconds → abort + retry) to the §2.1 loop.

### 0.2 Findings from code reading (not tested live)

- **F-1 · DAD fires before the tail chunk is served (>128-chunk transfers).** In the streaming verified path, `finishDownload` is called with the not-yet-read stream, so `destroyTransfer` starts (in `waitUntil`) while the last chunk is still being read from R2 and hashed. Consequences: (a) if the tail chunk fails verification, the transfer is deleted anyway — contradicting `merkle-spec-v1.md` §3 step 4 ("do not auto-destroy on mismatch"); (b) if the recipient's connection drops during the tail, the transfer is already gone and they cannot retry; (c) the batch delete races the in-flight R2 read of that same object (R2 behaviour on delete-during-read is not documented; unknown). Small files (≤128 chunks) verify before `finishDownload`, so (a) doesn't apply to them, but (b) does.
- **F-2 · Integrity failures on large files show the wrong error.** *(Closed server-side, Safari-Slow-Link-1 · 8 Oct 2026: every part now verifies before its first byte, so a mismatch is a clean 409 at any size. A body cut by the network is still retried as before.)* On >128-chunk transfers a mismatch cuts the body mid-stream. The browser's `arrayBuffer()` then rejects with a network `TypeError`, which the FSAA path treats as retryable. After retries it says "Download failed after several attempts" instead of the integrity screen. A short (not empty) body would reach AES-GCM and show "Decryption failed". The truncation guard only checks for `byteLength === 0`. The fix is to check exact length: ciphertext chunk = plaintext chunk + 16 B, and the tail length is derivable from `total_bytes`.
- **F-3 · Retry budget too small for 100 GB.** Four attempts over about 7 s per chunk means a 30-second Wi-Fi drop kills a 6-hour download.

---

## 1. Design goals

1. **No browser holds the file in memory.** Peak RAM stays in the low hundreds of MiB whatever the size.
2. **The recipient chooses the drive.** In every supported path, and the copy says how.
3. **A dropped connection doesn't cost the whole download.** Inside a session on every path. Across sessions (crash, reboot, lid closed) on the collector. See §4 for why not in browsers.
4. **DAD never deletes a transfer the recipient hasn't fully received**, and never deletes on an integrity failure.
5. **No new server state.** Resume is client-held. No KV (B12-SR X1), no Supabase row, and nothing added to the Worker's knowledge of who downloaded what.

---

## 2. Browser save paths

### 2.1 Chromium: keep FSAA, harden it

`showSaveFilePicker` stays. The user picks any drive in the system save dialog. Changes:

- **Ordered parallel fetch:** 3 chunks in flight, decrypt and write strictly in index order. The reorder buffer is at most 3 × 32 MiB. The **tail chunk is fetched only after every earlier chunk is written** (DAD rule, §5).
- **Exact-length check** per chunk (F-2): mismatch → the integrity screen, not "retry".
- **Stall timeout:** abort and retry a chunk that receives no bytes for 120 s (Part 1 saw one 300 s silent stall in 3,200).
- **Longer retry budget:** 6 attempts (2/5/15/30/60 s, the Share-5 upload budget), then **pause and wait** (§4.1) instead of aborting.
- **Error classes kept apart:** network (pause and wait), 409 or cut body (integrity screen, no retry), 410 (link inactive), write failure (the drive: "The drive you're saving to stopped responding or is full"), decrypt failure (wrong key or corrupted).

**The `.crswap` facts the copy must respect:**
- Chrome writes to `<name>.crswap` in the **same folder** and renames it on `close()`. The target drive needs **the full file size free**, 1×, not 2×. Nothing appears under the real name until the very end.
- On `abort()` or tab close the swap file is deleted. After a browser crash a stray `.crswap` can be left behind. The copy should say it is safe to delete.
- On `close()` Chrome may run its download safety checks over the whole file before renaming it. **Unmeasured at 100 GB, and on a USB drive it could take minutes** → spike item S-3. The UI needs a "Finishing — your browser is checking the file" state, so nobody closes the tab at 100 %.

### 2.2 Safari / Firefox: service-worker streaming download (replaces the blob)

Neither browser has `showSaveFilePicker` (Safari has only the private origin file system; Firefox's position is negative). The proven cross-browser pattern (StreamSaver-style):

1. The page fetches, verifies and decrypts chunks exactly as in 2.1 (same ordered-parallel loop, same error classes).
2. Plaintext is handed to a **same-origin service worker** through a `MessageChannel` (transferable streams where available).
3. A hidden iframe navigates to a one-off URL, e.g. `/share/assets/dl/<random>`. The SW answers it with `new Response(stream, { headers: { 'Content-Disposition': 'attachment; filename*=UTF-8''<name>', 'Content-Length': <plaintext size> } })`.
4. The **browser's own download manager** writes it to disk. It shows progress and ETA (thanks to `Content-Length`) and saves wherever the browser's download setting says.

Constraints and guards:
- **Where the SW lives:** `sw.js` served under `/share/assets/` with scope `/share/assets/dl/`. It stays inside the existing Cache Rule path, needs no `Service-Worker-Allowed` header, and is a new mirrored file → add it to `bin/lib/share-mirror.sh` in the same session.
- **Never navigate before the SW is proven live.** refueler.io answers a missing path with **200 + the homepage** (CLAUDE.md), so an uncontrolled navigation would "download" an HTML page named like the file. Guard: registration active **and** a ping/pong round-trip over the channel, else fall back (2.3).
- **Keep-alive:** Firefox stops idle service workers after ~30 s. The page pings the SW every 10 s for the whole transfer.
- **Choosing the drive:** Safari → Settings → General → *File download location* → *Ask for each download*. Firefox → Settings → *Always ask you where to save files*. Not shown on the receiver card (§6, Rajesh 27 Sep): large-file senders' recipients are expected to have this set up. Covered by support/help copy instead.
- **Trust boundary unchanged:** the SW is our own same-origin code. The key never leaves the page and the SW sees only plaintext the page already holds. No Refueler server sees plaintext.
- **Unverified, spike before build (S-1, S-2):** that Safari (macOS, and iOS/iPadOS separately) honours `Content-Disposition` on a SW-streamed response at 100 GB; that neither download manager times out a body that stalls for minutes during a pause; that Firefox private windows have service workers at all.

### 2.3 Last-resort fallback (no FSAA, no working SW)

Keep the blob path, but **cap it at 1 GiB**, and have it decrypt as it goes (plaintext only, about 1× the file in RAM instead of today's 2×). Above the cap, show "This browser can't save a file this size safely" and point to Chrome/Edge or the collector (§7).

**Who lands here:** only browsers with neither FSAA nor a working service worker. Mainstream Chrome, Edge, Brave, Safari and Firefox all have service workers, so this is in-app browsers (links tapped inside Instagram, Facebook, LinkedIn or some messengers), possibly Firefox private windows (unverified, S-2), and very old browsers. The fix for the common case is "Open in Safari / Chrome".

**Rule (D-2):** the sender can't know the recipient's browser, so the **receiver card detects the capability before any download starts** and says what to do. A recipient must never find out at 99 %. Pro Bono stays at 4 GiB; the cap is not lowered to fit the fallback.

### 2.4 Phones and tablets

iOS/iPadOS Safari has little RAM and the Files hand-off is unknown at this size. Proposal: above 4 GiB on iOS/iPadOS, show "Open this link on a computer" until spike S-2 shows otherwise (D-8). Android Chrome has no `showSaveFilePicker`, so it takes the SW path. Same spike.

---

## 3. Throughput and staying awake (browser)

- **Screen Wake Lock** (`navigator.wakeLock.request('screen')`, in all three engines) for the length of the download. Copy: "Keep this tab open. Your screen stays on until the download finishes."
- **Background tabs:** Chrome slows timers in tabs hidden for 5+ minutes to once a minute. Fetches carry on, but back-off sleeps stretch. Acceptable; say "keep this tab open", not "keep it in front".
- **Expected times** (for copy, with the collector as the alternative): 100 GiB takes about 2 h 25 m at 100 Mbit/s, 30 m at 500 Mbit/s, and 7 h at 30 Mbit/s. Show an ETA from measured speed after the first ~10 chunks, not a guess up front.

---

## 4. Resume

### 4.1 Inside a session (every path): pause and wait

After the per-chunk retry budget runs out on a **network-class** error, the download **pauses**. It keeps the open writable (FSAA) or the open SW stream, shows "Connection lost — waiting to reconnect (62.4 of 100 GB saved)", and resumes on the `online` event or a "Try now" button. It never throws away what was written while the tab stays open. Integrity, 410 and write errors never pause; they end the download.

### 4.2 Across sessions (crash, reboot, closed tab)

**Browsers: not in v1 (recommended; D-3).** Why:
- **Chromium FSAA:** until `close()`, the bytes live in the `.crswap`, which is discarded when the tab dies. Nothing survives to resume from. Checkpointing (periodic `close()` then `createWritable({ keepExistingData: true })`) makes the browser **copy the whole existing file into a new swap file** at every checkpoint (per the File System Access spec). That means 2× space and hours on exFAT/NTFS externals. APFS cloning *might* make it free, but that is unverified (S-3), and it wouldn't help Windows users.
- **Safari/Firefox:** a SW-streamed download can't be appended to later. The only durable browser store is the origin private file system, which always lives on the **internal** disk. Staging 250 GB there and then exporting it needs 2× internal space and breaks goal 2.

**Collector: yes, full resume.** It has the mechanism Part 1's script already proves. Each chunk is verified, written at its offset, `fsync`'d, *then* recorded in a local progress file. Re-running continues from the gaps. Resume state is **client-only**: no Worker change, no KV. The key is **never** written to the progress file; the recipient supplies the link again.

**Browser copy on an interrupted large download:** "The download stopped. Nothing has been deleted from Refueler — you can start again from this link. For transfers this size, the Refueler collector can pick up where it left off." (For DAD transfers this is only true because of §5.)

---

## 5. DAD × large downloads

**Rule D-DAD-1 (all clients: browser, collector, MCP):** fetch the **tail chunk last**, only after every other chunk is verified, decrypted (where applicable) and written. Parallel fetchers must hold the tail back. Resume must never fetch the tail first.

**Rule D-DAD-2 (Worker, fixes F-1):** start `destroyTransfer` only **after the tail chunk's verified body has been fully handed to the runtime**, never when its response is created, and **never** if its verification fails:
- **Streaming path (>128 chunks):** trigger from `makeVerifyingStream` after `verifyChunkBody` passes and just before `controller.close()`. On mismatch → no trigger (keeps the evidence, per `merkle-spec-v1.md` §3.4). If the client disconnects mid-tail, the stream is cancelled → no trigger → the recipient can re-fetch the tail.
- **Buffered path (≤128 chunks):** wrap the verified bytes in a one-pull stream and trigger on its close, so both paths behave the same.
- Residual window: the Worker has finished sending the tail, but the last bytes never arrive or the recipient's machine dies before writing them. Up to 32 MiB of tail, a few hundred milliseconds. Accepted and stated, not engineered around.

**Rejected:** a grace period for re-fetching the tail after deletion starts, or reinstating a recipient "confirm". Either reopens "once downloaded, the recipient cannot download again" (Share-DAD-2 copy, live). With D-DAD-2 the remaining window is small enough not to justify that.

**Copy impact:** the live DAD notice stays true. Add to the pre-download dialog, for DAD transfers over 4 GiB: "If the download stops before the end, the transfer is not deleted — you can start again."

---

## 6. Receiver card (decided by Rajesh, 27 Sep 2026: one card, no panel, no dialog)

**No separate large-file panel.** The card's size line is the cue: recipients judge free space and get a drive ready from "100.0 GB". Most senders move 25 MB–4 GB; paid senders of large files have a pro setup. No free-space, FAT32 or per-browser copy on the card.

**The delete-after-download dialog ("Download" / "Not now") is removed.** Its message moves onto the card as one line, and Download starts at once:

> Encrypted file · Show name
> Size 100.0 GB · Expires **Sat 3 Oct, 15:25** (recipient's local time), with "in 6 days" underneath, muted
> *Deleted after download. The link works once.*  ← delete-after-download transfers only
> [ Download ]

**One card for every transfer:** the delete-after-download line appears only when the sender armed it; otherwise the card is the same without it. **Expiry leads with the exact local date and time** (the hard stop — downloads end at that second); the countdown sits underneath, smaller, recomputed on every open and refreshed each minute while the page is open, switching to hours on the last day (Rajesh, 27 Sep). Today's code computes it once at load and never refreshes.

Acceptable because deletion only begins once the file has fully arrived (§5, D-DAD-2). Supersedes the Share-DAD-2 calm dialog. Mock: canvas artifact "Share receiver + homepage" (A = now, B = one card).

**Still shown (not a panel):** the §2.3 capability message when the browser can't save a file this size, and on iOS/iPadOS above 4 GiB (D-8), before any download starts. Chromium: if `createWritable()` fails (read-only NTFS on a Mac, permissions), say so in those words, not "Could not open the save location".

---

## 7. The collector: CLI + MCP `refueler_fetch`

**Where it fits:** the recommended path above the collector threshold, the only path with cross-session resume, and the path for agents. It sits beside the browser as an alternative; nothing is forced on anyone.

**One code base, two front doors (D-5):**
- `refueler_fetch(share_url, out_dir)`: MCP tool in `refueler-mcp` (already on file from Share-MCP-Chat-1: free, keyless, runs in the agent's trust domain, a funnel).
- `refueler-collect`: a `bin` in the same npm package (`npx @refueler/mcp-server collect`), for people.
- Both share one transport module grown from `worker/scripts/soak-download.mjs`: ordered-tail pool, exact-length check, `X-Integrity` read, 409 / cut body treated as an integrity failure, AES-GCM decrypt with AAD = chunk index, offset writes + `fsync` + progress file, free-space (`statfs`) and file system checks before starting (refuse FAT32 over 4 GiB; refuse NTFS-on-macOS as read-only), `Retry-After` on 429.

**Key handling rules (new, load-bearing):**
- The share URL carries the key in its fragment. **The CLI never takes it as a command-line argument** (that would leave it in shell history and in `ps`). It reads it from a prompt, stdin, or the clipboard.
- The key is never written to the progress file, the log or any temp file. Resume asks for the link again.
- The MCP invariant holds: decryption happens in the agent's trust domain. Refueler serves ciphertext only.
- Passphrase transfers: the collector does the `/auth/{uuid}` exchange like the browser and holds the download token in memory only.

**Distribution caveat:** `npx` needs Node, which is fine for agents and IT staff and not for a typical recipient. A signed single-file binary (macOS notarisation needs the Apple Developer programme) is a later step, not v1. **MCP-Fix-1 must land before any npm publish** (standing rule).

---

## 8. Soak harness for a real encrypted large browser test (post-Berlin)

**The gap:** consumer uploads are capped at Pro Bono's 4 GB until B12-4a, and `test-upload.html` / `soak-headless.mjs` upload unencrypted random bytes with no share link. No real 100 GiB browser download can be tested today.

**Proposal: `soak-headless.mjs --encrypt` (Share-Soak-4):**
> **Built Share-Soak-4 (9 Oct 2026), with changes:** link format **v2** (derived part key, counter nonce + last flag — no IV), plaintext from SHAKE256 (seed in the link filename), admin key from env. `--dad` / `--passphrase` deferred to DL-W1 / DL-Soak. See `worker/scripts/soak-*.mjs` headers.
- Encrypt exactly as `frontend/upload.js` does: AES-256-GCM, session key + IV, AAD = 4-byte big-endian chunk index, stored object = plaintext chunk + 16 B tag. `X-Total-Bytes` = **plaintext** size. Finalise hashes and the Merkle root cover the **ciphertext** (two-roots rule).
- **Deterministic plaintext:** chunk *i* = keystream from a seed (e.g. BLAKE3 XOF of `seed ‖ i`). Nothing is stored, and the downloaded file can be checked byte for byte by regenerating it. Log the plaintext BLAKE3 of the whole file too.
- **Emits a real v1 share link** (`?uuid=…#<fragment>`, same grammar as `upload.js`/`fragment.js`, with IV and filename), written to a `0600` file on the Mac, **never to the log**.
- Flags: `--gib`, `--dad` (arms destroy-after-download, to test D-DAD-2 at scale), `--passphrase`.
- Uses whatever test-credential path is live then (the B12-SR S2 MAC'd `X-Test-Credential` if B12-1b has landed).
- **`soak-download.mjs --decrypt`** reads the link from stdin and regenerates the expected plaintext → becomes the collector's transport prototype (§7).

**Then the real test matrix (Share-DL-Soak):** a 100 GiB encrypted transfer downloaded in (a) Safari via SW to an external APFS SSD, (b) Firefox via SW, (c) Chrome FSAA to an external exFAT drive (time `close()`), (d) the collector with a forced mid-run kill and resume, (e) a DAD transfer via the collector with a tail-chunk disconnect (D-DAD-2). Repeat (c) and (d) at 250 GiB with the postponed 250 GiB soak.

---

## 9. Decisions — approved by Rajesh, 27 Sep 2026 (all as recommended)

**D-2 discussion (27 Sep):** Rajesh asked whether a 1 GiB cap is a product killer and whether Pro Bono should drop to 1 GiB so every browser works. Answer: no. The cap applies only to the §2.3 group (no FSAA and no service worker), mainstream browsers stream, and the receiver card warns before download. The real risk is spike S-1/S-2 (SW streaming in Safari/Firefox); if it fails, the fallback is the 1× blob plus the collector, not a lower tier cap. Agent recipients (`refueler_fetch`) have no browser limit at all.


| # | Decision | Recommendation |
|---|---|---|
| D-1 | Safari/Firefox large downloads via a service-worker stream (replacing the RAM blob) | **Yes**, gated on spike S-1/S-2 |
| D-2 | Blob fallback cap when neither FSAA nor SW works | **1 GiB** |
| D-3 | Cross-session resume in browsers | **Not in v1.** In-session pause-and-wait in browsers; full resume in the collector |
| D-4 | DAD: tail fetched last (all clients) + Worker deletes only after the verified tail is fully sent (F-1) | **Yes.** Small Worker change; no grace period, no confirm step |
| D-5 | Collector = MCP `refueler_fetch` + `refueler-collect` CLI in one package | **Yes.** Link via prompt/stdin, never argv |
| D-6 | Size at which the collector is offered | **20 GiB** (offered, not forced; on the capability message and help pages, not the card, per §6) |
| D-7 | Paid cards stay "Coming Soon" until Share-DL-Soak is green | **Yes**, a launch gate alongside B12-4a / B12-6 |
| D-8 | iOS/iPadOS above 4 GiB | "Open this link on a computer" until S-2 says otherwise |
| D-9 | Fragment carries the chunk count (or plaintext root) so a recipient detects a truncated transfer (§0 last row) | **Raise at the fragment-grammar owner (SW-MCP-4 lineage)**, not decided here |

---

## 10. Session plan: before the paid cards go live

Paid cards go live after **B12-4a** (auth) and **B12-6** (billing). Download work is mostly independent of B12 code (frontend, scripts, `refueler-mcp`), so it runs alongside it:

| Session | Model | Scope | Repo | Slot / prerequisite |
|---|---|---|---|---|
| **Share-Soak-4 ✓** | Sonnet | `soak-headless --encrypt` + link output; `soak-download --decrypt`; commit `soak-download.mjs` | refueler-share | Week 1 post-Berlin, after B12-1b (test-credential path) |
| **Share-DL-Spike** | Sonnet | Scratch page (not shipped): SW stream in Safari macOS/iOS + Firefox (S-1, S-2); Chrome `close()` timing + `keepExistingData` on APFS/exFAT externals (S-3). 5 GiB, then 100 GiB | scratch + refueler-share | After Soak-4 |
| **Share-DL-W1** | Sonnet | Worker: D-DAD-2 (tail trigger on verified stream close, both paths), tests incl. mismatch-on-tail keeps the transfer | refueler-share (Worker deploy) | After B12-1b; before B12-3 touches `delete_transfer.js` |
| **Share-DL-1** | Sonnet | Frontend: ordered parallel fetch + tail-last, exact-length check (F-2), 6-attempt budget + pause-and-wait (F-3), error classes, wake lock, SW download for Safari/Firefox, blob cap | refueler-share → `ship-frontend.sh` | After the spike; week 2–3, parallel to B12-4a |
| **Share-DL-2** | Sonnet | Frontend: one receiver card (§6: DAD line on the card, dialog removed), capability message, iOS gate, collector pointer on the capability message | refueler-share → `ship-frontend.sh` | With or after DL-1 |
| **Share-DL-3** | Sonnet | `refueler-mcp`: shared transport, `refueler_fetch`, `refueler-collect` bin | refueler-mcp | After MCP-Fix-1; parallel to B12-4b |
| **Share-DL-Soak** | Sonnet + Rajesh | §8 matrix at 100 GiB, then 250 GiB with the postponed 250 GiB soak | — | **Before B12-6 opens the paid cards (D-7)** |

Buffer: 1 (`Share-DL-1b`, cross-browser fallout). No Opus needed after this session unless the spike kills the SW approach (then a short Opus to re-scope Safari/Firefox to "collector above N GiB").

---

## 11. Do-not-retry (proposed)

- DO NOT assemble a whole download in memory (Blob/array) above the blob cap. Stream to the FSAA writable or the SW.
- DO NOT fetch the tail chunk before every other chunk is written, on any client (DAD).
- DO NOT trigger DAD destruction from response creation. Only after the verified tail body is fully enqueued, and never on a verify failure.
- DO NOT navigate to the SW download URL until the SW has answered a ping (refueler.io returns 200 + the homepage for unknown paths).
- DO NOT persist the AES key or the share URL for download resume (IDB, progress file, logs). The recipient re-supplies the link.
- DO NOT take the share URL as a CLI argument (shell history, `ps`).
- DO NOT add Worker/KV state for download resume. Resume is client-held.
- DO NOT treat a mid-body cut or a short body on the verified path as a retryable network error. It is an integrity failure.
- DO NOT promise a browser download "resumes". It pauses and waits while the tab is open; only the collector resumes.

---

*"Nothing stops this train."*
