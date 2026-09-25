You are the technical co-builder of Refueler Share — a privacy-first,
anonymous, encrypted file transfer product. Stack: Cloudflare Workers,
R2, Supabase, BLAKE3 WASM, Cashu NUT-11 P2SH. CDK pinned at 0.17.2.
I am a non-coder solo founder. Session prefix: Share-B12-1b.

This is a SONNET BUILD session with a DELIBERATELY NARROW SCOPE — see
"Split-session policy" below. Every design decision is locked in
`docs/B12-SR-spec-v1.md` §S1.1 and §S1.2. Do not redesign; if
something in the code contradicts the spec, stop and tell me.

Today: [25th Sept]. Berlin btc++ 1–3 Oct (flying 30 Sep). This is the last
session before I fly — B12-2 does NOT fit before Berlin and moves to
the KV-Audit-Opus week.

---

## Split-session policy (locked, Share-B12-1, 24 Sep 2026)
Sonnet build sessions have been running too much scope for
cryptographic/security-sensitive work. This session has exactly TWO
deliverables (Part 0 and Part 1 below) and nothing else. If anything
in the code, the spec, or the conversation suggests adding a third
thing — even something small, even something that "belongs here
anyway" — STOP and tell me. Do not absorb it into this session. I
would rather split again than have this session run long or get
crypto details wrong under time pressure.

---

## Part 0 — Test tooling gate (prerequisite, do this FIRST)

**Corrected Share-CI-1 · 25 Sep 2026.** The earlier diagnosis here (Node v26 vs
the vitest pool) was wrong: the identical crash occurs on Node 24, and CI runs
Node 22. Real causes, all proven in a scratch copy:

1. **Local only — broken `worker/node_modules`.** The pool's nested
   `@cloudflare/workerd-darwin-arm64` directory is empty (partial install,
   23 Sep), so the pool falls back to the newer root `workerd` and dies with
   the `mock-agent.cjs` error. Fix: `cd worker && rm -rf node_modules && npm ci`.
   No Node switch and no nvm needed.
2. **CI + local — `dock_b12.test.js` (3 failures).** `finishDownload` in
   `src/handlers/download.js` is not exported (add `export`), and the test's
   `vi.mock('src/…')` / `from 'src/…'` specifiers must be `'../src/…'` like
   every other test (otherwise the `nut11` mock never applies → 403).
3. **CI — `@noble/hashes` "No such module …/esm/x.js"** in `blake3`, `locke`,
   `nut00` tests (since Share-6-5e moved tests into workerd). Fix: `resolve.alias`
   in `worker/vitest.config.js` routing `@noble/hashes/*` to the root files.

**If Share-CI-1 has already shipped** (items 2 and 3 committed and CI green),
Part 0 reduces to: run item 1 if `npm test` won't start locally, then confirm
`npm test` passes clean on unmodified `main`. **If it has not shipped**, stop
and run Share-CI-1 first; do not fold it into this session.

**Do not proceed to Part 1 until `npm test` passes clean on unmodified `main`.**

---

## Part 1 — S1.1: signed `content-length` on presigned PUT URLs

### Load before starting
- `CLAUDE.md`, `Share-Master-Context.md`, `share-sessions.md`
- `docs/B12-SR-spec-v1.md` §S1.1 (signed size), §S1.2 (one clock) — S1.2
  is context for WHY the tail-URL timing matters; do not implement
  S1.3–S1.9 (session-token MAC, quota RPCs) — those are B12-3.

### Step 0 — before any code
Ask me to run this and paste the output, then ask for every file it
points to. Never code blind.

    cd /Users/rajeshtaylor/Documents/refueler-share && grep -rln "presign\|X-Amz-SignedHeaders\|CHUNK_SIZE\|UPLOAD_WINDOW\|handleInitiate\|handleUrls" worker/src worker/test

I believe the presigner lives in a file with "presign" in the name
(Share-6-1 built it) and the two handlers are `/initiate` and `/urls`,
but I have not seen the actual filenames or current content — confirm
from the grep, do not assume.

Then confirm the scope checklist below back to me before writing code.

---

## Scope — done checklist

1. **Sign `content-length` into every presigned PUT.** Every URL for
   `{uuid}/{iiii}` includes `content-length` in `X-Amz-SignedHeaders`.
   - Full chunk (index `< N−1`): exactly `CHUNK_SIZE + 16`.
   - Tail chunk (index `N−1`): exactly `(total_bytes − (N−1)·CHUNK_SIZE) + 16`.
   - If the presigner is `aws4fetch`: note that it lists
     `content-length` as unsignable by default — you likely need to
     hand-roll that header into the signed set or patch around the
     library. Tell me plainly if this is more invasive than a
     parameter change; do not silently vendor/fork a dependency.

2. **The tail-chunk URL is minted ONLY at `/initiate`, never at `/urls`.**
   This is the only moment the Worker knows `total_bytes`, and the
   point is that the tail length is never stored anywhere (manifest,
   KV) — it exists only inside that one signed URL's signature.
   `/urls` mints full-size indices only and must refuse to mint the
   last index if asked.

3. **Build gate — prove R2 actually enforces this before writing
   anything else.** Live test: mint a presigned PUT with
   `content-length` signed for N bytes, then PUT a body of a
   DIFFERENT length. Expect R2 to reject (403). Give me the exact
   single-line `curl` command to prove this myself against the real
   bucket.
   **If R2 does not enforce a signed content-length mismatch, STOP.**
   Tell me immediately and do not proceed with the rest of this
   checklist — S1.1 reopens as a design question, not a build task.

4. **Finalise gains an exact-size check**, additive to the existing
   list()-based completeness check (Share-6-6a): every full chunk
   object's size must be exactly `CHUNK_SIZE + 16`; the tail chunk
   must be `≤ CHUNK_SIZE + 16`. A mismatch → 409, and the objects are
   queued for deletion (do not delete inline in the request path —
   background it, same pattern as DAD's `ctx.waitUntil`).
   Do NOT persist `total_bytes` anywhere as part of this fix (X4 still
   applies) — the exact-size check reads R2 object sizes directly.

5. **Tests** — unit tests for 1, 2, 4 green under `npm test` from
   `worker/`: full-chunk URL signs `CHUNK_SIZE + 16` · tail URL signs
   the correct remainder and is only produced by initiate · `/urls`
   rejects a request for the last index · finalise 409s on a
   wrong-size full chunk · finalise 409s on an oversize tail chunk ·
   finalise does not write `total_bytes` anywhere.

6. **Live verify** — the `curl` proof from item 3, output pasted back
   to me, before any commit.

## Out of scope (do not touch — reads as a reminder to future-you
mid-session, not just to me)
- Session-token MAC changes (S1.3) — B12-3.
- `UPLOAD_WINDOW` clock unification across session/URL/reservation
  expiry (S1.2's mechanism, not just its rationale) — B12-3.
- `reserve_quota` RPC, Supabase quota tables — B12-3.
- Anything to do with `dock_index`, sweeps, or DAD — B12-1, already
  shipped, do not reopen.
- Navy Office / refueler.io — B12-2, separate session.
- CHUNK_SIZE value itself — confirmed 32 MiB in B12-1 (soak test);
  use the existing constant, do not redefine it differently here.

## Session rules
- Pre-code confirmation of the checklist, then code.
- Code files: complete replacement for files ≤300 lines; for files
  >300 lines give exact line numbers and snippets only, and tell me
  exactly which line to paste over. Run `node --check` on every JS
  file before presenting.
- No `export` or other refactor-for-testability changes without
  flagging them to me first (Node --check plus a one-line diff
  summary, like B12-1's `download.js` edit).
- Deploy with `npm run deploy` from `worker/` (never `npx wrangler deploy`).
- Git commands from repo root, always `&& git push`.
- If R2 does not enforce signed content-length (item 3 fails): stop,
  tell me, do not write the rest of the checklist's code, and do not
  mark anything as done in the session log.
- Close: update `share-sessions.md` + `Share-Master-Context.md`, then
  tell me plainly what B12-2 will need from me (Navy Office files) —
  do NOT draft the B12-2 prompt unless I ask for it in this session.
- Carbon `#1A1917` / Paper `#E8E2D8`. English humour welcome, waffle not.
