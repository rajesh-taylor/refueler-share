# refueler-share — Session 2 Prompt
# BUILD SESSION — architecture is locked, outputs are code and config

## Files to upload to this chat (all four required)
1. claude.md (v4.7) — project DNA and locked decisions
2. Refueler_MasterContext_CC64.md — full operational context
3. refueler-share/README.md — repo README
4. refueler-share/SESSIONS.md — updated with Session 1 entry

## Session context

This is Session 2 of refueler-share build. Session 1 was architecture planning only —
no code was written. All architecture is now locked. Do not relitigate any decision
marked locked. Do not produce unrequested reference documents alongside code deliverables
(rule 4l from claude.md).

## What was locked in Session 1 (not in the uploaded files)

### Free tier capacity
4GB per transfer. NOT 6GB (the README currently states 6GB — correct this in the first
commit of this session). Doubles Smash's 2GB free tier. 6GB is a future marketing option.

### Token lifetime rules (locked Session 1)
- Token lifetime equals link expiry date set at upload time. The link is the only
  credential gate.
- Downloads use HTTP Range requests. Worker validates link on every chunk request via
  manifest.expiry_timestamp.
- In-progress transfers are not interrupted by expiry: Worker checks
  manifest.download_initiated_at — if download started before expiry, remaining chunks
  are served. Grace period only applies to transfers already in progress.
- Session-scoped tokens deferred pending A/B speed test results post-MVP.

### Upload credential storage (locked Session 1)
- Browser memory only. Never localStorage, never sessionStorage, never transmitted
  to analytics or logging.
- Free tier has no cross-session resume (credential lost on page close).
- Resume within a single browser session is supported via BLAKE3 tree-check.

### Contractor upload link (locked Session 1)
- Option A: NUT-11 P2SH with URL-fragment private key. Confirmed.
- Option B: bearer token in fragment. Fallback only if browser signing is unavailable.
- Option C: server-mediated relay. Dropped.

### Browser dev tools sanitisation (locked Session 1)
- Console: zero sensitive values logged in production builds. No AES keys, credential
  proofs, BLAKE3 hashes, or chunk UUIDs.
- AES-GCM session key lives in URL fragment only. Never in network requests.
  After extraction, immediately call history.replaceState to strip fragment from URL bar.
- NUT-00 credential in Authorization header is single-use. NUT-07 melt fires on first
  Worker acceptance. Replay attack on a captured credential fails immediately.

### Cap enforcement timing (locked Session 1)
- Worker returns remaining allocation in the upload credential response.
- Browser checks file size against remaining allocation immediately on file selection,
  before any chunk processing begins.
- If file exceeds remaining allocation: show warning on file selection, not mid-upload.
  State what is available and what the file needs. Offer upgrade path.

### Payment model — Creative Premium and Production Max (locked Session 1)
- Monthly and yearly plans. Yearly = 10 months price (2 months free).
- Payment page: two cards (Monthly / Yearly), price prominent, feature list minimal.
- Stripe Checkout for card and Apple Pay. Lightning BOLT11 also available.
- No upsells, no comparison tables on the payment page. Two clicks from tier selection
  to receipt.

### Expiry UX — Creative Premium and Production Max (locked Session 1)
- Expiry selector requires a deliberate user choice — no default selected.
- Below selector: "This cannot be changed after the link is created." Plain text,
  small weight, not a warning modal.

### Email delivery of share link (locked Session 1)
- Free tier: no email capability (no email address collected). Full stop.
- Paid tiers: share link (containing AES key in fragment) must never be transmitted
  via email. Email is not a safe channel for a decryption key.
- Paid tier dashboard: stores transfer UUID only. User copies the full share link
  from their dashboard. Dashboard does not reconstruct the fragment (AES key) —
  if the user lost the link, the file is inaccessible.
- This is a privacy advantage over Smash, not a missing feature. Copy should
  articulate it as such.

### Pre-upload user guidance (locked Session 1)
- Slim persistent info card at top of upload interface (not a blocking modal).
- Appears on first load. Dismissible with X. Does not reappear in the same session.
- Copy register: "No account. No email. No history. This link is your file — if it
  is lost, the file is gone with it."
- Must be visible before the user drags anything in. Sets expectations early.

### Production Max — recipient identity gate UX (locked Session 1)
- Never use the phrase "public key" in the UI. Non-technical users will not engage.
- UI copy: "Lock this download to a specific recipient."
- The mechanism beneath is NUT-11 P2SH Mode 2 keypair challenge-response, but
  the user sees "access key" not "public key."

### NUT-11 P2SH downloader identity model (locked Session 1)
Mode 1 — pre-shared secret (Creative Premium, optional):
- Browser generates random 32-byte secret. Worker stores BLAKE3 hash (not secret).
- Share link: {uuid}#{base64url(aes-key)}.{base64url(p2sh-secret)}
- Worker timing-safe comparison of presented secret hash against manifest.p2sh_secret_hash.

Mode 2 — keypair challenge-response (Production Max, default):
- Worker issues 32-byte nonce (60s TTL). Browser signs with recipient private key.
- Worker verifies against manifest.p2sh_public_key. Returns encrypted AES key.
- Browser unwraps AES key locally. Private key never transmitted.
- UI term: "access key" not "public key."

### Storage layer configuration (locked Session 1)
Bucket: refueler-share-prod (production), refueler-share-dev (A/B test)
Namespace: UUID only. No user prefix. No identity linkage.
Direct R2 URL exposure: none. Worker proxies all R2 access.

Chunk key format:
  {transfer-uuid}/{chunk-index-zero-padded-4-digits}
  Example: a1b2c3d4-e5f6-7890-abcd-ef1234567890/0000

Manifest at:
  {transfer-uuid}/manifest.json

Manifest structure (v1):
{
  "version": 1,
  "transfer_uuid": "...",
  "tier": "free | creative_premium | production_max",
  "chunk_count": 42,
  "total_bytes": 2097152000,
  "blake3_root_hash": "...",
  "created_at": 1751654400,
  "expiry_timestamp": 1752086400,
  "download_initiated_at": null,
  "p2sh_mode": null,
  "p2sh_secret_hash": null,
  "p2sh_public_key": null,
  "aes_key_encrypted": null,
  "ml_kem_enabled": false
}

R2 lifecycle rules:
1. AbortIncompleteMultipartUpload after 24 hours (entire bucket, no prefix filter)
2. Expiration at 92 days (backstop only — Worker enforces expiry at application
   layer. 92 = 90-day Production Max max + 2-day buffer.)

Supabase: spent_tokens table only (serial, melted_at). No file metadata, no UUIDs,
no user identity. Supabase is the double-spend prevention layer and nothing else.

### A/B speed test spec (locked Session 1 — run post-MVP, not before build)
Bucket: refueler-share-dev
File sizes: 1GB / 10GB / 50GB / 100GB
Connections: 500 Mbps studio fibre / 100 Mbps home broadband / 30 Mbps 4G
Measure: actual transfer time per size/connection combination. Derive P95.
Purpose: validate or replace interim token lifetime rules. Run before Production Max
launch, not before MVP.

## Session 2 build targets

Priority order:

1. Correct README.md: 6GB → 4GB on free tier (Skint Tog row in tier table and
   any prose references)

2. Supabase migration: spent_tokens table
   - serial TEXT PRIMARY KEY
   - melted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - RLS: no reads from client. Worker service key only.
   Apply via Supabase MCP apply_migration. Verify with execute_sql after.

3. Cloudflare Worker scaffold — three endpoints to build this session:
   a. POST /credential/issue — Turnstile validation + NUT-00 blind sig issuance
   b. PUT /upload/{uuid}/{chunk-index} — credential verification, NUT-07 melt,
      R2 write, cap enforcement
   c. GET /download/{uuid}/{chunk-index} — manifest expiry check,
      download_initiated_at logic, R2 proxy

4. BLAKE3 WASM module integration into Worker (chunk fingerprint verification
   on upload — confirms client-computed hash matches received bytes)

5. Frontend: single-page HTML5 upload interface
   - Drag-and-drop zone (dominant)
   - Pre-upload info card (no account / no email / no history copy)
   - Progress states: chunking → encrypting → uploading → done
   - Share link display: prominent, one-click copy, QR code
   - Expiry selector (Creative Premium and above): no default, hard-choice UX,
     "cannot be changed" reminder line
   - Cap warning on file selection if file exceeds remaining allocation
   - Branding consistent with refueler.io: Carbon base, Satoshi headings,
     DM Sans body, IBM Plex Mono for data values, Gold #C8A96E accents

6. R2 lifecycle rules configuration (document the Wrangler commands to apply them)

## What is NOT in scope for Session 2
- NUT-11 P2SH download gating (Mode 1 or Mode 2) — Session 3
- Contractor upload link flow — Session 3
- ML-KEM PQC key wrapping — Production Max Phase 2, deferred
- Payment integration (Stripe / Lightning) — Session 3
- share.refueler.io domain config and Cloudflare Pages routing — Session 3
- Dashboard for paid tiers — Session 3
- CONTRIBUTING.md — end of August across all repos

## Tiers reference (corrected)

| Tier | Price | Cap | Link expiry |
|------|-------|-----|-------------|
| Skint Tog | Free | 4 GB per transfer | 5 days, no extension |
| Creative Premium | £12/mo or £120/yr | 100 GB per transfer | User-set: 1 / 7 / 30 days |
| Production Max | £24/mo or £240/yr | 250 GB per transfer | User-set: 1 / 7 / 30 / 90 days |
| Enterprise | Contact | Unlimited | Custom |

## NUT protocol scope for Session 2 build
- NUT-00: blind sig issuance (Worker signing key — never logged, never exposed)
- NUT-07: token melt on upload completion (spent_tokens insert)
- NUT-04 and NUT-11: Session 3

## Reminders from claude.md
- verify_jwt: false explicit on every Edge Function deploy (external-facing)
- curl: always single-line, real key inlined, no backslash continuations
- apply_migration for all DDL — never raw execute_sql for schema changes
- Never trust a function's own success response — always verify state directly
- 4l: deliver only requested artifacts, no unrequested reference documents

### Production Max — recipient mode model (locked Session 1 addendum)

Three recipient modes, selected at link creation after expiry selector:

Mode: one_person
- NUT-11 Mode 2 keypair challenge-response
- Same private key permitted up to 3 device downloads (max_downloads_per_key: 3)
- 4th attempt from same key refused with specific message

Mode: team
- NUT-11 Mode 1 shared secret in fragment + redemption counter
- Sender declares download allowance: 2 / 5 / 10 / 20 / custom up to 50
- manifest.max_redemptions set at creation. Immutable after manifest written.
- manifest.redemption_count incremented atomically per download initiation
- R2 conditional writes (ETag matching) prevent race conditions
- Download page shows: "N of M downloads remaining"
- Download page note: "Each device download uses one allowance."
- Allowance exhausted response: specific message, not generic 403

Mode: one_time
- max_redemptions: 1. Link void after first successful complete download.
- Response on second attempt: "This link has already been used."

Manifest additions:
  "recipient_mode": "one_person | team | one_time"
  "max_redemptions": N
  "redemption_count": 0
  "max_downloads_per_key": 3

UI copy:
- Recipient mode selector: one card per mode, plain-language description
- Never use "public key" in UI. Use "access key."
- Mode: one_person label: "One person — access key required, up to 3 device downloads"
- Mode: team label: "A specific team — shared link, set download allowance"
- Mode: one_time label: "One-time only — link void after first download"