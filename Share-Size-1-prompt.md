# Share-Size-1 — session prompt

> Written 5 Oct 2026 at the close of Cred-Fix-2b (commit `52919d9`, Worker deploy `a5ac4f5d`).
> Follows: Cred-Fix-2b ✓ → **Share-Size-1** → Share-Upload-2 → B12-2 (refueler-io session) → KV-Audit-Opus.
> MCP-Fix-1 opens the MCP work, week of 12 Oct.
> Model: Sonnet build. Investigation + proposal first; Worker and frontend changes only after a yes.
> Trigger phrase from Rajesh: "lets start Share-Size-1 work please".

You are the technical co-builder of Refueler Share. Rajesh is a non-coder solo founder.
Session prefix: **Share-Size-1**.

**Load:** `CLAUDE.md`, `share-sessions.md` from Share-B12-1b onwards (incl. Cred-Fix-2b),
`docs/B12-SR-spec-v1.md` §S1.1 (the dated Share-B12-1c/1d note), `refueler-mcp-spec-v2.md`
(fragment grammar v1 + receipts), `docs/Share-Download-spec-v1.md` (D-9), memories
`size-privacy-ideas`, `proposals-before-edits`, `share-page-two-modes`, `safari-top-priority`,
`mullvad-breaks-tests`, `share-receiver-1-decisions`. Do NOT load TESTING.md.

Propose before edits: show plan + diff summary, get a yes, then apply. Flag every new `export`,
signature change, new mirrored file, new request header, fragment-grammar change, and any change to an
API response shape (receipts, `/meta`, webhooks are contracts).

---

## Goal

The exact file size travels in the URL fragment (Wormhole-style "encrypted offer") and stops being
stored in the manifest or served by the unauthenticated `GET /meta/{uuid}`. Today anyone holding
only the UUID (it is in the query string, so link previewers, logs and history see it) can fetch
`/meta` and learn the exact size.

## Honest scope — state this to Rajesh before building

Share-Size-1 **reduces where the size is stored and served**. It does **not** hide the size:
- The Worker still sees `X-Total-Bytes` at `/initiate`: it checks the tier cap, computes API cost
  and signs the tail URL for its exact length (B12-1d). Transient, not stored.
- R2 object sizes reveal ciphertext size (plaintext + 16 B per chunk) to the storage operator.
- `total_chunks` in `/meta` (and the manifest) still gives the size to within 32 MiB.
- Padding (Padmé) is a separate Opus question (Padding-Opus, roadmap 11d″) — not this session.
Never write "size is hidden" in any copy or comment.

## Step 0

1. `cd worker && npm test` — expect **642 passed / 29 skipped**. Loopback/module errors → Mullvad off.
2. `curl -s https://api.share.refueler.io/meta/{uuid}` on a live test transfer — confirm the field
   names before coding against them (CLAUDE.md rule).
3. Inventory every reader and writer of the size. Known so far (verify, don't trust):
   - **Worker writes:** `manifest.js` `total_bytes` (from `/initiate`, `index.js` ~1725).
   - **Worker serves:** `/meta` `total_bytes` (`index.js` ~1380).
   - **Worker other uses:** Analytics Engine `double5` (`index.js` ~93, `handlers/download.js` ~109/149)
     feeds Navy Office "Data stored (90d)" (`handlers/admin.js` ~300); receipts `size_bytes`
     (`receipts.js`, `handlers/download.js` ~355 — an **API contract**, check MCP spec); API cost
     `computeTransferCost(totalBytes)` at initiate (keep — transient).
   - **Frontend:** `download.js` ~135 **tombstone detection uses `meta.total_bytes == null`** (trap:
     dropping the field would make every live link look deleted); ~194 receiver card + done screen
     size; ~385/519 download progress denominators.
   - **Fragment:** `frontend/fragment.js` grammar v1 `{ v, k, i, n, s }`; `upload.js` builds the link.
   - **MCP:** `refueler-mcp` parses the same fragment grammar and may read `/meta` — check, don't change
     (MCP-Fix-1 owns that repo).
4. Re-read `frontend/fragment.js`, `upload.js` (link assembly), `download.js` (meta + fragment use).
5. Confirm the plan below back to Rajesh, with the inventory and the decisions marked ❓.

## Proposed shape (confirm, then build)

- **Fragment grammar v1 gains an optional size field** (e.g. `z`: decimal plaintext byte count). It
  stays v1 if the field is optional and old links still parse; flag if you think it needs `v: 2`.
  Folder transfers: size of the zip as sent.
- **Receiver:** size comes from the fragment; falls back to `/meta` only for links made before this
  ships (❓ how long to keep the fallback — until those links expire, max 90 days?). Damaged/missing
  `z` must not break download (progress falls back to chunk-based).
- **Tombstone detection** in `download.js` moves off `total_bytes` (use `total_chunks` /
  `expiry_timestamp`, or the 410 the Worker already returns since Share-DAD-2).
- **Worker:** stop writing `total_bytes` to new manifests; `/meta` returns `total_bytes: null` (keep
  the key, or drop it ❓ — keeping it null is the safer contract). Existing manifests: leave or strip ❓.
- **Receipts `size_bytes`:** ❓ Rajesh's call — keep (API clients asked for it; derived at initiate and
  never stored?) or drop. Must not be read from the manifest after this.
- **Analytics Engine `double5`:** ❓ keep logging the size (aggregate, 90-day) or bucket it. Changing it
  changes the Navy Office card — a refueler-io follow-up if so.
- Keep: `X-Total-Bytes` at `/initiate`, cap check, tail-URL signing, `total_chunks` (needed to download).

## Build and ship (after the yes)

- Order: **frontend first** (reads size from the fragment, tolerant of `/meta` with or without
  `total_bytes`) via `bin/ship-frontend.sh` → Safari gates → **then** the Worker stops writing/serving
  it → full suite → `npm run deploy` (Rajesh's yes) → Safari again. Same two-step as B12-1c/1d and
  Cred-Fix-2a/2b, so no window where live links lose their size.
- `node --check` every touched JS file; scratch-test `fragment.js` round trips (old links without `z`,
  new links, folder links, permanent-record links with `s`).
- Tests: `/meta` no `total_bytes` for new transfers; manifest has no `total_bytes`; receipts per the
  decision; tombstone detection unchanged in behaviour.
- **Safari live** (`safari-top-priority`, `share-page-two-modes`):
  - single file with password + DAD — receiver card shows the right size, link dead on second use
  - ~100 MB file — progress runs to 100 % on the right total
  - folder link — size shown
  - a link created **before** the ship still shows its size (fallback)
  - `curl /meta/{new uuid}` → no size
  - upload page with no fragment unchanged

## Close

- `docs/B12-SR-spec-v1.md` §S1.1 note: `total_bytes` no longer stored/served (dated), honest-scope
  wording kept.
- CLAUDE.md: only if a locked decision changes (fragment grammar line).
- README "What a breach exposes" table: "File sizes" row → chunk count + R2 object sizes still held
  (do not claim sizes are hidden).
- `share-sessions.md` entry; `Share-Master-Context.md` current state; memory `size-privacy-ideas`.
- Rajesh commits: give the command, always `&& git push`.

## Out of scope

Padding / Padmé, PAKE short codes, Nostr delivery, `refueler-mcp` changes (MCP-Fix-1),
Share-Upload-2 items, B12-2/B12-3 quota, the unused `noble-secp256k1.js` cleanup.
