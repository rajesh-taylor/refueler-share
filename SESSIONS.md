## Session 2 — Build: Worker scaffold, frontend, Supabase migration (11 July 2026)

**Type:** Build session. Code output. Commit all deliverables.

**Branch:** `session-2-build` (merge to main after local review)

### Completed

**README correction (priority 1):**
- Free tier cap corrected: 6 GB → **4 GB** (Skint Tog row and prose references)
- Licence corrected: MIT → **Apache 2.0** (was wrong from initialisation — CC-64 carry-forward)
- Economics section removed (should have been stripped in CC-64)
- Status copy updated to reflect Session 2 in progress

**Supabase migration applied (priority 2):**
- Table: `spent_tokens` — `serial TEXT PRIMARY KEY`, `melted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- RLS enabled. No client policies created. Worker service_role key only.
- Verified post-apply via `execute_sql` — schema confirmed correct.
- Migration name: `create_spent_tokens_refueler_share`

**Cloudflare Worker scaffold (priority 3):**
Three endpoints built:

- `POST /credential/issue` — Turnstile validation (free tier) + NUT-00 blind sig issuance.
  Returns `signed_point`, `mint_pubkey`, `allocation_bytes`.
- `PUT /upload/{uuid}/{chunk-index}` — First chunk: credential verify (NUT-00), double-spend
  check (Supabase), cap enforcement, BLAKE3 hash verify, manifest write, chunk write, NUT-07
  melt. Subsequent chunks: manifest existence check, expiry check, BLAKE3 verify, chunk write.
- `GET /download/{uuid}/{chunk-index}` — Manifest expiry check with in-progress grace period,
  `download_initiated_at` recording on first chunk, R2 proxy. HTTP Range header support.

Files: `worker/src/index.js`, `worker/src/nut00.js`, `worker/src/turnstile.js`,
`worker/src/manifest.js`, `worker/src/blake3.js`, `worker/wrangler.toml`, `worker/package.json`

Worker secrets required (set via `wrangler secret put`):
- `MINT_PRIVATE_KEY` — secp256k1 hex private key (32 bytes). Generate: `openssl rand -hex 32`
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret key
- `SUPABASE_URL` — `https://tihgvdokeofnjxjkenmm.supabase.co`
- `SUPABASE_SERVICE_KEY` — service_role JWT

**BLAKE3 WASM integration (priority 4):**
- Worker side: `worker/src/blake3.js` — wraps `blake3-wasm` package. `verifyChunkHash()` and
  `chunkHash()` with constant-time comparison.
- Frontend side: loaded dynamically from `esm.sh/blake3-wasm@2.1.5/browser`.
  Chunk-level hashes computed client-side; rolling root hash feeds `X-Blake3-Root` header.
- `tokenSerial()` in `nut00.js` uses BLAKE3 instance when available, SHA-256 fallback in dev.

**Frontend (priority 5):**
`frontend/index.html` — single file, no build step required.

- Drag-and-drop zone (dominant)
- Pre-upload info card: "No account. No email. No history." — dismissible, session-scoped only
- Progress states: Generating key → Chunking → Encrypting → Credentialling → Uploading → Done
- Share link panel: prominent, one-click copy, QR code (qrcode.js via cdnjs)
- Cap warning on file selection if file exceeds tier cap — shown before any processing
- Expiry selector: paid tiers only, no default, hard-choice UX, immutability note
- AES-GCM session key in URL fragment — `history.replaceState` strips it from URL bar immediately
  after link construction (never in browser history, never in network requests)
- NUT-00 client: `hashToCurve`, `generateBlindedCredential`, `unblindSignature`
- Branding: Carbon `#1A1A1A` base, Gold `#C8A96E`, Satoshi headings, DM Sans body, IBM Plex Mono
- Turnstile: invisible widget, executes on file selection, `onTurnstileSuccess` callback

**R2 lifecycle rules (priority 6):**
`docs/r2-lifecycle.md` — Wrangler commands to apply both rules:
- Rule 1: `AbortIncompleteMultipartUpload` after 24h (entire bucket)
- Rule 2: Expiry backstop at 92 days

### Session 2 — Pre-commit checklist

- [ ] Generate `MINT_PRIVATE_KEY`: `openssl rand -hex 32` — set via `wrangler secret put MINT_PRIVATE_KEY`
- [ ] Replace Turnstile sitekey placeholder in `frontend/index.html` with real key
- [ ] Update `WORKER_URL` in `frontend/index.html` after first `wrangler deploy`
- [ ] Create R2 buckets: `wrangler r2 bucket create refueler-share-prod` and `refueler-share-dev`
- [ ] Apply R2 lifecycle rules (see `docs/r2-lifecycle.md`)
- [ ] `npm install` in `worker/` then `wrangler deploy`
- [ ] Verify deployed Worker URL, test `/credential/issue` with curl

### Not completed this session (carry to Session 3)

- NUT-11 P2SH download gating (Mode 1 + Mode 2)
- Contractor upload link flow
- Payment integration (Stripe / Lightning)
- `share.refueler.io` domain config + Cloudflare Pages routing
- Dashboard for paid tiers
- ML-KEM PQC key wrapping (Production Max Phase 2)

### Files produced this session

- `README.md` (corrected)
- `worker/wrangler.toml`
- `worker/package.json`
- `worker/src/index.js`
- `worker/src/nut00.js`
- `worker/src/blake3.js`
- `worker/src/turnstile.js`
- `worker/src/manifest.js`
- `frontend/index.html`
- `docs/r2-lifecycle.md`
- `SESSIONS.md` (this file)
- `Share-Master-Context.md` (new — see project root)

---

## Session 1 — Architecture Planning (10 July 2026)

**Type:** Planning only. No build output. No commits.

**Objectives:** Resolve token lifetime rules, produce anonymous auth flow spec,
contractor upload link spec, NUT-11 P2SH downloader identity model,
storage layer config spec.

### Completed

**Token lifetime rules (resolved):**
- Token lifetime = link expiry date set at upload time. The link is the only credential gate.
- Downloads use HTTP Range requests. Worker validates link on every chunk request.
- In-progress transfers are not interrupted by expiry: Worker checks
  `manifest.download_initiated_at` — if download started before expiry, remaining
  chunks are served (grace period logic).
- Session-scoped tokens deferred pending A/B speed test results.

**A/B speed test spec (produced):**
- Test bucket: `refueler-share-dev`
- File sizes: 1GB / 10GB / 50GB / 100GB
- Connection profiles: 500 Mbps studio fibre / 100 Mbps home broadband / 30 Mbps 4G
- Measure: actual transfer time per size/connection. Derive P95. Use to validate or
  replace interim token lifetime rules.
- Run before Production Max launch, not before MVP.

**Upload credential storage model (confirmed):**
- Browser memory only. Never localStorage, never sessionStorage.
- Lost on page close (free tier has no cross-session resume).

**Contractor upload link option selection:**
- Option A confirmed: NUT-11 P2SH with URL-fragment private key.
- Option B (bearer token) retained as fallback if browser signing support is absent.
- Option C (server-mediated relay) dropped.

**Anonymous auth flow spec (produced):**
- Free tier: Turnstile → NUT-00 blind sig → AES-GCM client-side → R2 via Worker →
  NUT-07 melt → UUID+fragment share link.
- Creative Premium: payment (Stripe/Lightning) → NUT-04 mint → NUT-11 credentialled
  upload → user-set expiry → optional NUT-11 P2SH download gate.
- Production Max: same as Creative Premium + ML-KEM AES key wrapping +
  NUT-11 P2SH download gate as default.

**Contractor upload link flow spec (produced):**
- Client generates P2SH keypair in browser. Worker issues NUT-11 P2SH upload token
  locked to public key. Client constructs link with private key in fragment.
  Contractor signs upload proof locally. Worker verifies P2SH signature.
  NUT-07 melt on completion. Single-use enforced. Counts against client's allocation.

**NUT-11 P2SH downloader identity model (produced):**
- Mode 1 (Creative Premium optional): pre-shared secret in URL fragment.
  Worker stores BLAKE3 hash of secret. Timing-safe comparison on download.
- Mode 2 (Production Max default): keypair challenge-response. Worker issues nonce.
  Recipient signs with private key in browser. Worker verifies against manifest
  public key. AES key wrapped under recipient's public key in manifest (not in fragment).

**Storage layer config spec (produced):**
- Single R2 bucket: `refueler-share-prod`.
- Chunk key format: `{transfer-uuid}/{chunk-index-0000}`.
- Manifest at `{transfer-uuid}/manifest.json` — authoritative transfer state.
- Supabase: spent-token ledger only (`spent_tokens`). No file metadata.
- R2 lifecycle rule 1: abort incomplete multipart after 24h.
- R2 lifecycle rule 2: object expiry backstop at 92 days.
- Worker is primary expiry gate via `manifest.expiry_timestamp` check.

### Files uploaded this session

- `claude.md` (v4.7)
- `Refueler_MasterContext_CC64.md`
- `REFUELER_SHARE_SESSION_1.md`
- `refueler-share/README.md`
