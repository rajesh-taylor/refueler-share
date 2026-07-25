# share-sessions.md — refueler-share

---

## Sessions 1–26 — compact log (B1 + B2)

| # | Date | Commit | Summary |
|---|------|--------|---------|
| 1 | 10 Jul | — | Architecture planning: token lifetime, upload model, NUT-11 P2SH, storage spec |
| 2 | 11 Jul | `session-2-build` | Worker scaffold (3 endpoints), `frontend/index.html`, Supabase `spent_tokens` |
| 3 | 11 Jul | `172a2e0` | NUT-11 Mode 1 passphrase gating (`nut11.js`, `manifest.js`) |
| 4 | 11 Jul | `42180c1` | Stripe products + prices (live GBP), webhook, `subscribers` table, R2 buckets |
| 5 | 12 Jul | `9a5fdc1` | Turnstile widget, all 6 secrets set, Pages project, `share.refueler.io` live |
| 6 | 12 Jul | `458bc99` | `STRIPE_WEBHOOK_SECRET` rotated (exposed in git) |
| 7 | 12 Jul | `3b9a9aa` | Visible Turnstile widget (invisible mode broke Safari ITP) |
| 8 | 12 Jul | `0369dc8` | blake3-wasm local bundle (`frontend/blake3/`, force-committed) — CDN broken |
| 9–10 | 13 Jul | (grouped) | secp256k1 v2 API fix (`secp.ProjectivePoint`), R2 binding `BUCKET`, SHA-256 passphrase hash |
| 11 | 13 Jul | `e50b58c`+`ec0c325` | Decrypt stall fixed, filename preservation. Full upload/download flow ✓ |
| 12 | 13 Jul | — | Stripe Customer Portal, `/subscription/portal`, R2 lifecycle rules |
| 13 | 14 Jul | — | `upgrade.html` rebuild: Paper/Carbon tokens, Stripe remount |
| 14–15 | 14 Jul | `f52b55f` | Eleventy 3.x scaffold: `src/` → `frontend/`, partials. B1 complete. |
| 16 | 14 Jul | grouped | KV status system: `refueler-share-kv` (binding `STATUS_KV`), `GET /status`, `POST /admin/status`, maintenance banner (`sessionStorage` dismiss) |
| 17 | 14 Jul | grouped | `src/status.njk`: ops + crypto integrity sections, 60s auto-refresh, banner-linked only |
| 18 | 14 Jul | grouped | AE dataset `share_events` (binding `AE`), `logEvent()` helper, `timed()` router wrapper |
| 19 | 14 Jul | grouped | `/admin/metrics`: MRR, subscribers_by_tier, paid_total, churn MTD. RLS deny-all on ledger tables. `cancelled_at` added to `subscribers` |
| 20 | 14 Jul | grouped | `double_spend_attempts` table, `credential_uniqueness_rate` metric |
| 21 | 14 Jul | grouped | `frontend/admin/dashboard.html` scaffold: password gate, live metric cards, 60s refresh |
| 19-plan | 14 Jul | — | Roadmap S19–S120 drafted. Critical chains recorded in Share-Master-Context.md |
| 22 | 15 Jul | `d1bcb5a`+`f36e385` | `GET /admin/ae-metrics`: AE SQL proxy, CF_AE_TOKEN scoped. CORS `X-Admin-Key` fix. |
| 23 | 15 Jul | `a4bc625` | AE SQL column syntax fix (`double1`/`blob1` not array syntax). p95/p99 latency + error rate cards. |
| 24 | 15 Jul | `5be5811` | `GET /admin/snapshot`, System Summary dashboard section (6 metric tiles) |
| 25 | 15 Jul | `fc6cba9`+`99afaaa` | Free-to-paid conversion rate, dashboard restructure |
| 26 | 15 Jul | — | B2 close. 10/13 metrics live. Context files updated to v2.1. |

**Permanent do-not-retry (B1–B2):**
- blake3-wasm CDN (esm.sh/unpkg) — local bundle only
- Invisible Turnstile — visible managed widget only
- `secp.Point` — removed in noble v2, use `secp.ProjectivePoint`
- `binding = "R2"` in wrangler.toml — must be `BUCKET`
- BLAKE3 for passphrase hash — must be SHA-256
- `wrangler r2 bucket lifecycle set --rule` inline JSON — use `add` subcommand; `lifecycle get` → `lifecycle list`
- AE SQL: use `double1`/`blob1` column names, not `doubles[N]`/`blob[N]` array syntax
- DO NOT await `env.AE.writeDataPoint()` — fire-and-forget
- DO NOT call AE SQL API from Worker — proxy via `/admin/ae-metrics` only
- DO NOT use KV counter for double-spend tracking — race condition; Supabase table only
- `spatial_ref_sys` RLS is false — PostGIS system table, leave alone
- `sessionStorage` only for banner dismiss (not localStorage)
- DO NOT add `/status` to nav — banner-linked only

---

## Sessions 27–29 — B3 Stripe test coverage (16–20 July 2026)

| # | Commit | Summary |
|---|--------|---------|
| 27 | `5f3cb8e` | Stripe CLI installed. 4 test prices created. Root cause of `client_secret` mismatch identified: `checkout/sessions ui_mode:embedded` incompatible with `stripe.elements()` |
| 28 | `5f3cb8e` | Direct Subscription creation pattern confirmed. 4242 card flow ✓. Webhook handler extended with `customer.subscription.created`. |
| 29 | `5d8c1ea` | `STRIPE_SECRET_KEY` rotated to `sk_live_...ZehD`. Portal `resource_missing` confirmed correct (no active sub). Cancellation code-complete. **B3 closed.** |

**B3 do-not-retry:**
- DO NOT use `checkout/sessions ui_mode:embedded` — use direct Subscription + `expand[0]=latest_invoice.payment_intent`
- DO NOT `decodeURIComponent` Stripe `client_secret` — already decoded
- DO NOT attempt Customer Portal without active subscription — Stripe returns `resource_missing`
- 4242 card is test-mode only — never works in live mode

**B3 gap (deferred to B11):** Full cancel → webhook → Supabase loop requires a real live subscriber. `cus_UtlpRELAdcZXk2` has no active subscription.

---

## Sessions 34–53 — B4 Security hardening + B5 Design full pass

| # | Commit | Summary |
|---|--------|---------|
| S34 | `7738450f` | BLAKE3 WASM in Worker. `verifyChunkHash()` live. Integrity gap closed. |
| S35-e | `95a12b4` | Paid tiers greyed out (soft launch). Uncounted. |
| S35 | `ab01388` | AAD overflow fix — `DataView.setUint32(0,i,false)` into 4-byte buffer. |
| S36 | `b877c76` | KV-backed rate limiting: `ratelimit.js`, 3 endpoints, 429s logged to AE. |
| S36b | `0cc4de9` | `/log/error` endpoint + `reportError()` helper. 6 capture points. |
| S36c | `2db7b08` | Dashboard legibility pass. Snapshot strip. Paper/Carbon cookie. Modal stubs. |
| S37 | `7684118` | Dashboard: Satoshi figures, row 2 6-cell, row 3 3-cell. `client_errors_24h` stub. |
| S38 | `20da7d4` | `client_errors_24h` AE query. 3 rogue secrets deleted. Wrangler 4.112. |
| S39 | `ab4fc98` | Server-side tier enforcement. 10 MB chunk cap. KV byte counter. |
| S40 | `c6f1a7a` | MIME denylist gate on chunk 0 (6 types). 415 + AE log on miss. |
| S41 | `b2a4ba0` | UUID validation (RFC 4122). Chunk bounds check. |
| S42a | `c8a57a42` | `handleLogError` fix. Filename sanitisation. 64 KB manifest cap. Chunk + expiry guards. |
| S42b | `18d85351` | Per-UUID auth rate limit. Download rate limiting. Chunk count defence. |
| S42c | `c053cbc` | UUID-bound credential issuance. Worker generates UUID. `waitForTurnstile` fix. |
| S42d | `0b32e69` | Turnstile nonce binding. Safari polling fallback. Wrangler 4.113. |
| S42e | — | Full B4 audit. Marketing claim rulings. UK regulatory language. B5 handoff. |
| S43 | `5c54802` | DESIGN-TOKENS.md v1.0 applied to index, upgrade, status pages. |
| S44 | `b15f407` | Dashboard design pass I: sidebar, token alignment, Satoshi figures, 4 latency cards. |
| S45 | `7187e41` | Dashboard design pass II: 240px sidebar, gold wordmark, farming card. |
| S46a | `bbf271a` | Modal build I: 14 modal keys, skeleton, focus trap. CSS+JS extracted to dashboard.css/js. |
| S46b | `023dfcc` | Modal polish: formatBytes, zero=green, datasource banner, × close. smokeTest 27 pass. |
| S47a | `63eb253` | FREE_EXPIRY fixed. Progress smooth. QR retina. Cap nudge. status.njk editorial. |
| S47b | `d8faf0f` | QR 200px SVG (qr-creator). 2-col button grid. Serif integrity notes. Ghost back links. |
| S47c | `cb7a925` | Receiver landing page. USP A/B test (Variant A/B, sessionStorage, AE logging). |
| S47d | `3eb4ec4` | QR guard. Drop zone single-file rejection. Colophon. Footer subdomain-only. Turnstile theme. |
| S48 | `0761f4c` | Maintenance modal. Theme cookie `rs-theme` scoped to `.refueler.io`. No FOUC. |
| S48a | `0152aae` | FSAA streaming download. Pipeline depth 2. Per-chunk retry 1s/2s/4s. Blob fallback. |
| S49a | `3598a65` | Carbon gold edging. `--inset-rule` throughout. Brand token aliases in shared-styles. |
| S50 | `e3a4407` | Serif audit. 3 correct usages confirmed. 3 CSS-only additions. |
| S51 | `c182036` | File extraction: `frontend/share.css` (367L), `frontend/share.js` (899L), `frontend/upgrade.css` (419L). |
| S52 | — | `TIER_EXPIRY_SECONDS.free` 5d→7d. `--heading` alias. Lightning ops plan. Context v4.0. B5 closed. |
| S53 | `ca1260c` | Folder upload I: fflate 0.8.2, drag+drop + picker, zip progress card, bare Uint8Array fix. |


---

## Sessions 53–72+ — B6 Testing infrastructure + folder upload

**Block principle:** No session holds more than one architecturally complex piece of work.
Split early rather than overstuff. Testing infra reviewed every 4 sessions (S63, S67) — buffer
consumed only if genuinely needed, not by default.

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S43 ✅ | Token alignment | DESIGN-TOKENS.md applied to index, upgrade, status. | S |
| S44 ✅ | Dashboard design pass I | Sidebar layout, token alignment, Satoshi figures, 4 latency cards. | M |
| S45 ✅ | Dashboard design pass II | Sidebar 240px, gold wordmark, farming card, editorial line. | M |
| S46a ✅ | Modal build I | 14 modal keys, skeleton, n/a states, sparkline stub, focus trap. CSS+JS extracted. | L |
| S46b ✅ | Modal build II | formatBytes, zero=green, datasource banner, × close, modal-active ring. smokeTest 27 pass. | M |
| S47a ✅ | Upload/download UX I | FREE_EXPIRY, progress smooth, QR retina, upgrade nudge, status editorial. | S |
| S47b ✅ | QR + polish | QR 200px SVG (qr-creator), 2-col button grid, serif integrity notes, ghost back links. | S |
| S47c | Receiver landing page | Info card on link open: filename, size, expiry, passphrase indicator, Download button. Replaces auto-trigger. Pure frontend. | M |
| S47d | Receiver snag + single-file UX | Snag sweep from S47c. Drop zone explicit single-file-only rejection. | S |
| S48 | Maintenance notification + theme persistence | KV modal on index.html + Paper/Carbon cookie scoped to `.refueler.io`. Privacy copy update. | S |
| S49a ✅ | Carbon gold edging + brand sweep | `--inset-rule` throughout Carbon. Token aliases fixed in shared-styles.njk. | S |
| S50 ✅ | Serif audit | --serif audit across all 3 pages. 3 correct usages confirmed. 3 additions: info card copy, upgrade subline, payment note. CSS-only. | S |
| S51 | File extraction | Extract index.njk CSS→frontend/share.css, JS→frontend/share.js. Extract upgrade.njk CSS→frontend/upgrade.css. Matches admin/dashboard pattern. | M |
| S52 | B5 close | Snag sweep, QR logo snag note, context files, version 4.0, B6 brief. | S |

---

### S47a — Upload/download UX + copy audit
**Commits:** `dbcf54f` → `1daeac9` → `63eb253` · 23 July 2026

- `FREE_EXPIRY` constant fixed: `5 * 24 * 60 * 60` → `7 * 24 * 60 * 60`. Now matches UI "1 / 7 day expiry" and Worker `EXPIRY_WINDOWS.free`.
- Progress bar smooth finish: chunks complete at 95%, `setStage('Finalising', 98)` → 80ms → `setStage('Done', 100)` + "Transfer complete" label → 700ms hold → `progressCard` hidden → share panel appears. Eliminates 15%→100% jump.
- QR retina fix: renders at `128 × devicePixelRatio` (capped 3×) physical pixels; CSS display stays 128px. `isDark` detection switched from `classList.contains('carbon-mode')` to `dataset.theme === 'carbon'`. QR colours updated to design tokens (`#E4E2DC`/`#3D3A36`).
- `showSharePanel`: `progressCard.classList.add('hidden')` moved into upload flow above the call — avoids double-hide.
- Cap warning + upgrade nudge: "This file is over the 4 GB free limit." + "Creative Premium supports transfers up to 100 GB — see plans →" linking to `/upgrade.html`. Orange `--accent-action` link. `.upgrade-nudge-link` CSS added.
- Tier/expiry copy audit: `upgrade.njk` was already correct. No drift elsewhere.
- `status.njk` fix: `{% include "shared-styles.njk" %}` was missing — caused unstyled cards, dead Paper/Carbon toggle, phantom "Scheduled Maintenance" heading. One line added.
- `status.njk` editorial pass: section renamed "How it works". Six cards rewritten with human-first values (✓ Encrypted in your browser, ✓ Transfers can't be linked to you, ✓ Files arrive intact, ✓ Optional passphrase lock, ✓ Files delete themselves, ✓ Abuse prevention). Technical labels demoted to secondary `integrity-card-label` text. Known-gap card removed (closed S34). State labels plain English ("Refueler Share is running normally" / "Something is wrong — we're looking into it"). Fetch error softened — no raw JS error string shown to user.
- `integrity-card-value` lifted to `1rem` / `font-weight: 600`. `integrity-card-note` lifted to `13px` / `line-height: 1.6`. Cards now readable.
- `← Back to Refueler Share` link added above hero headline. IBM Plex Mono 11px, muted, links to `/index.html`.
- WOFF2 parsing warning noted (Bunny/Fontshare font CDN) — cosmetic, flag for B5 close sweep.

**Do not retry:**
- DO NOT use `classList.contains('carbon-mode')` for theme detection in status or any page — use `dataset.theme === 'carbon'`.
- DO NOT omit `{% include "shared-styles.njk" %}` from any Eleventy page — without it all CSS variables, `.hidden`, and Paper/Carbon toggle JS are absent.

**S47a snag list (carry into S47b):**
1. QR display size too small — not scannable at arm's length. Lift CSS display size to ~200px.
2. QR Carbon contrast poor — use near-white on near-black (`#F7F4EF` on `#111316`).
3. Button layout — Copy link + New upload should be full-width 2-column grid matching link box width, not loose left-aligned row.
4. `integrity-card-note` font — switch to Source Serif 4 300 weight, 14px, line-height 1.7. DM Sans reads as helper text; serif gives editorial authority appropriate to this content.
5. Back link — restyle as ghost button: `border: 0.5px solid var(--border-mid)`, `border-radius: 8px`, `padding: 6px 12px`, full `--text-primary` colour, 12px mono. Current muted link too discreet for a user who needs a clear escape route.
6. `upgrade.njk` — no route back to `share.refueler.io/index.html`. Same nav problem as status page. Fix in S47b.

---

### S47b — QR library swap + share panel polish
**Commits:** `b98bcd8` → `d8faf0f` · 23 July 2026

- QR CSS display size lifted 128px → 200px. Carbon colours corrected to `#F7F4EF` on `#111316` for maximum scanner contrast.
- Button layout: Copy link + New upload converted from `flex-row` to `.share-btn-row` — `display: grid; grid-template-columns: 1fr 1fr; width: 100%`. Both buttons full-width, matching link box above.
- `integrity-card-note` on `status.njk`: switched to `var(--serif)` (Source Serif 4) 14px weight-300 line-height 1.7.
- Back link on `status.njk`: restyled from muted mono text link to ghost button (`border: 0.5px solid var(--border-mid)`, `border-radius: 8px`, `padding: 6px 12px`, `--text-primary`, hover gets `--accent` border + `--surface` background).
- Back-nav added to `upgrade.njk`: same `.upgrade-back-link` ghost button pattern above `.page-header`, links to `/index.html`.
- QR library swapped: `qrcodejs` (canvas, blurs at retina) → `qr-creator` (SVG, mathematically sharp at any DPR). CDN: `cdnjs.cloudflare.com/ajax/libs/qr-creator/1.0.0/qr-creator.min.js`. `QrCreator.render({ text, radius: 0, ecLevel: 'M', fill, background, size: 200 }, svgEl)`. CSS updated: `#qr-wrap svg { width: 200px; height: 200px; }` — no `!important` canvas override needed.

### S47c — Receiver landing page + A/B USP test
**Commits:** `cb7a925` → trim commit · 24 July 2026

- Receiver card confirmed: filename, size, expiry, passphrase badge. No auto-download.
- USP copy block below Download button: Source Serif 4 weight 300, 16px/1.75, gold left border `3px solid var(--accent)`, `--text-secondary`.
- Variant A (architectural, 3 lines): "Reading your files is not technically possible for us…"
- Variant B (human, 3 lines — trimmed after review): "This link expires and deletes itself…"
- 50/50 split via `Math.random()`, stored `rs-usp-variant` in `sessionStorage`. Private-mode fallback: assign without storing.
- `logReceiverEvent()` helper — fires to `/log/error` (context `receiver_ab`), two events: `receiver_ab_shown` + `receiver_ab_downloaded` with variant label.
- USP block hidden on download completion (both FSAA and Blob paths). Colophon takes over.
- Pages deploy failed first attempt (Cloudflare API rate limit code 971, transient). Retry succeeded.
- Full flow smoke-tested: upload → share → receiver card → passphrase → FSAA picker → complete → colophon. ✓

### S47d — QR fix, receiver sign-off, drop zone, footer, Turnstile
**Commits:** `242444d` → `01d31bc` → `8496539` → `1749c34` → `f1efbc8` → `3eb4ec4` · 23 July 2026

- QR race fixed: `qr-creator` moved from `extraHead` to blocking `<script>` immediately before `<script type="module">`. Dynamic load guard added to `showSharePanel` — if `QrCreator` absent on `window`, injects script tag and renders on load. QR deferred indefinitely as non-priority.
- Drop zone multi-file rejection: `drop` handler checks `files.length > 1` before `handleFileSelection`. Amber `--c-amber` message inline below drop zone. Cleared on valid single-file drop or file input change.
- Post-download sign-off (colophon): shown after download completes. Single line — Source Serif 4 weight 400, 18px/17px mobile, `--text-secondary`, gold left border `3px solid var(--accent)`, `margin-top: 7.2rem` (4 line gaps). "Part of the Refueler ecosystem · Your data. Your rules. · refueler.io". No horizontal rule. `dl-detail` hidden at completion — sign-off is the sole completion signal.
- Footer: `src/_includes/footer.njk` — removed App, Editorial, Privacy main-domain links. Status + Upgrade only (both subdomain). Affects index, status, upgrade pages.
- Turnstile: explicit `theme: isDarkMode ? 'dark' : 'light'` based on `document.documentElement.dataset.theme`. `.turnstile-wrap` left-aligned (`justify-content: flex-start`).

**Do not retry:**
- DO NOT use `classList.contains('carbon-mode')` for theme detection anywhere — use `dataset.theme === 'carbon'`.
- DO NOT add main-domain links to `footer.njk` — subdomain footer is Status + Upgrade only.
- DO NOT auto-trigger download on share link open — receiver landing page (S47c) replaces this.

**B5 resequencing (23 July 2026):**
- Principle adopted: finish upload→share→receive loop end-to-end before further polish. Test early, don't build untested surfaces.
- New sequence: S47c (receiver landing page) → S47d (receiver snag + single-file UX) → S48 (maintenance + theme persistence) → S49 (gold edging + brand sweep) → S52 (B5 close).
- Folder upload (fflate client-side zip) moved to B6: S53 (build I) + S54 (build II) + S55 (test + snag).
- Session count is a guide, not a constraint. Add sessions as needed.

**Open snags logged this session:**
- QR logo centre (Refueler mark in QR quiet zone): requires canvas compositing or library support — deferred to S52 snag note.
- Drop zone currently accepts multiple files silently — explicit rejection with message needed (S47d).
- Auto-download on link open: receiver lands immediately in download, no consent, no file info shown. Fixed in S47c.

**Do not retry:**
- DO NOT use `qrcodejs` — canvas blur at retina is unfixable. Use `qr-creator` (SVG).
- DO NOT use `new QRCode(el, opts)` API — use `QrCreator.render(opts, svgEl)`.
- DO NOT implement multi-file manifest for folder upload — client-side zip via fflate is the locked approach.

---

### S48 — Maintenance modal + theme cookie persistence
**Commit:** `0761f4c`

- `formatMaintenanceText(status)` extracted as shared function from banner IIFE — reused by both banner and modal, no duplication.
- `showMaintenanceModal(status)` added to `src/index.njk`: full-viewport overlay (z-index 200, rgba 0.72 backdrop), 480px card, `border-top: 3px solid var(--gold)`, `border-radius: 12px`, design tokens. "Got it" dismiss button (`.btn.btn-primary.btn-full`). `sessionStorage` key `rs-maint-modal-dismissed` — independent of banner's `rs-banner-dismissed`. Idempotent.
- Modal skips in download mode (fragment contains `uuid=` + `key=`). Modal fires on `state === 'maintenance'` only — degraded stays banner-only.
- `src/_includes/shared-styles.njk`: two `<script>` blocks added before `<style>`. (1) Synchronous cookie-read: reads `rs-theme` cookie → localStorage `theme` → system `prefers-color-scheme`. Applies `html.carbon-mode` + `data-theme` before paint — no FOUC. (2) Delegated click listener on `document`: fires on `.theme-pill` click, writes `rs-theme` cookie (`domain=.refueler.io; path=/; max-age=31536000; SameSite=Lax`) + localStorage. Keeps `data-theme` in sync.
- `footer.njk` — no change (no "no cookies" language present).

**Do not retry:**
- DO NOT add `Secure` flag to `rs-theme` cookie explicitly — Cloudflare enforces HTTPS.
- DO NOT fail-closed on cookie read error — `getCookie` returns null, falls back to localStorage then system pref.
- DO NOT show maintenance modal in download mode — receiver fragment must never be blocked.

---
### S48a — FSAA streaming download
**Commits:** `f8cfac0` → `da9b9cd` → `0152aae`

- `startDownloadStream()`: FSAA path, pipeline depth 2 (chunk N+1 fetched concurrently while chunk N decrypts+writes), max 2 chunks resident in memory regardless of file size.
- `startDownloadGated()`: capability gate — `typeof showSaveFilePicker !== 'undefined'`, no UA sniffing. `showSaveFilePicker` called first within gesture before any await. AbortError restores receiver card silently. Unexpected picker error falls through to Blob.
- Per-chunk retry: 3 attempts, 1s/2s/4s backoff. Hard abort on 400/401/410. `writable.abort()` on failure — privacy comment referencing B9 whitepaper on both call sites.
- `startDownload()` retained as Blob fallback, updated to accept `meta` param and use `meta.total_chunks` as loop bound.
- Capability warning (`.dl-compat-warn`): amber >300 MB, red >1 GB. Appears on receiver card before Download click. Design tokens throughout.
- Fix: `total_chunks` added to `handleMeta` response (Worker line 882). Was missing — caused "Transfer metadata is incomplete" error on first test.
- Fix: `types: []` in `showSaveFilePicker` call — suppresses macOS `.com` extension warning.

### S49a — Carbon gold edging + brand sweep
**Commits:** `12fa05f` → `3598a65` · 25 July 2026

- `--inset-rule` token added to `shared-styles.njk`: Paper resolves to `var(--border)` (rgba near-invisible), Carbon resolves to `var(--gold)` (#C8A96E). No-op in Paper — all visual changes are Carbon-only.
- Nav `border-bottom` + footer `border-top` → `var(--inset-rule)`. Consistent hairline weight across all chrome.
- Status page `.section-header border-bottom` → `var(--inset-rule)`. Gold section dividers in Carbon.
- Integrity cards: `border-left: 0.5px solid var(--inset-rule)`. 2px tuned to 0.5px hairline on visual review — matches nav/footer weight, content leads not chrome.
- Upgrade page: payment tabs container `border-bottom` + `.manage-divider border-top` → `var(--inset-rule)`.
- Brand sweep — token aliases added to `shared-styles.njk` (were consumed by pages but never declared, silently failing or falling back):
  - `--serif: 'Source Serif 4', Georgia, serif`
  - `--accent: var(--gold)` (with Carbon override unchanged — same value)
  - `--text-primary: var(--fg)`, `--text-secondary: var(--fg-muted)` (DESIGN-TOKENS.md naming used by status + upgrade back-links)
  - `--border-mid: rgba(26,26,26,0.22)` / Carbon: `rgba(245,240,232,0.22)`
  - `--surface: rgba(26,26,26,0.04)` / Carbon: `rgba(245,240,232,0.04)`
- Maintenance modal `border-top: var(--gold)` → `var(--accent)` (tokenised, same value).
- Brand sweep finding: `--display` (shared-styles) vs `--heading` (DESIGN-TOKENS.md) — both point to Satoshi stack. Cosmetic divergence. Log for S52 sweep.
- Brand sweep finding: orange `--accent-action` exists in Share DESIGN-TOKENS.md but is abolished in BRANDING.md. Intentional divergence — DESIGN-TOKENS.md governs Share; orange is permitted on consumer CTA surfaces only. No action.

**Do not retry:**
- DO NOT use `border-left: 2px` on integrity cards — visual review confirmed 0.5px is correct weight.

### S50 — Source Serif 4 editorial moments audit
**Commit:** `e3a4407`

- Full --serif audit across index.njk, status.njk, upgrade.njk.
- Confirmed correct existing usage: `.dl-signoff-secondary` (colophon), `.usp-text` (receiver A/B block), `.integrity-card-note` (status How it works).
- No wrong-register serif usage found anywhere.
- Three CSS-only additions:
  - `index.njk`: `.info-card > span` body copy → `var(--serif)` 300 14px/1.7
  - `upgrade.njk`: `.page-header p` subline → `var(--serif)` 300
  - `upgrade.njk`: `.payment-note` reassurance copy → `var(--serif)` 300
- "Already a subscriber?" lookup label confirmed correct in sans — instructional UI, not editorial.
- No Worker changes. No wrangler deploy.

### S51 — File extraction
**Commit:** `c182036`

- `frontend/share.css` (367 lines) — all inline CSS extracted from `src/index.njk`.
- `frontend/share.js` (899 lines) — all `<script type="module">` content extracted from `src/index.njk`. Loaded as `<script type="module" src="/share.js"></script>`.
- `frontend/upgrade.css` (419 lines) — all inline CSS extracted from `src/upgrade.njk`.
- `src/index.njk` reduced from 1,582 → 280 lines. `<link rel="stylesheet" href="/share.css">` added to `extraHead`. Banner/modal inline scripts and HTML structure unchanged.
- `src/upgrade.njk` reduced from 944 → 525 lines. `<link rel="stylesheet" href="/upgrade.css">` added to `extraHead` alongside Stripe script. Upgrade JS stays inline (332 lines — manageable, no extraction needed).
- Static assets served directly from `frontend/` (Eleventy output dir) — no `.eleventy.js` changes needed. Matches `admin/dashboard.css + dashboard.js` pattern.
- Eleventy build clean: 3 files, 0.06s. Pages deploy via git push.
- Smoke test: upload (passphrase enabled) → receiver card → password unlock → download. All correct. USP variant A rendered, gold left rule, 6 days remaining. ✓
- `window.onTurnstileLoad` potential module-scope issue noted and confirmed non-issue in practice — callback assigned to `window` explicitly.

**Do not retry:**
- DO NOT edit inline CSS/JS in `src/index.njk` or `src/upgrade.njk` — edit `frontend/share.css`, `frontend/share.js`, `frontend/upgrade.css` only.
- DO NOT put `share.js` as a regular script — must remain `type="module"` (scoped deps, top-level await support).


### S52 — B5 close sweep
**Commit:** TBD

- `worker/src/manifest.js` `TIER_EXPIRY_SECONDS.free` corrected: `5 * 24 * 60 * 60` → `7 * 24 * 60 * 60`.
  Now matches `EXPIRY_WINDOWS.free` in `index.js` and UI "1 / 7 day expiry". Snag logged S47a, resolved here.
- `src/_includes/shared-styles.njk`: `--heading` token alias added alongside `--display` (both point to
  Satoshi stack). Resolves cosmetic divergence between shared-styles (`--display`) and DESIGN-TOKENS.md
  (`--heading`) flagged S49a.
- WOFF2 parsing warning (Bunny/Fontshare CDN): confirmed cosmetic browser console noise. No action needed.
- QR logo centre (Refueler mark in QR quiet zone): deferred. Requires canvas compositing or `qr-creator`
  fork. Revisit B11 prep if time allows.
- Lightning ops plan documented (see Share-Master-Context.md §Lightning infrastructure). Blink primary →
  LNbits Tier 2 on 2-of-3 trigger. Two fallbacks with time targets. Written for investor/legal review.
  Full text to land in B9 whitepaper §Operations.
- Admin dashboard Lightning toggle scoped to B6: KV flag `lightning_available`, dashboard toggle card,
  graceful degradation on upgrade page. Enables Fallback 1 + 2 without a code deploy.
- B6 scope locked: 20 core sessions + 10 buffer (testing infra, reviewed every 4 sessions) +
  2–3 bearer token TTL buffer. See B6 session plan below.
- Context files bumped: `Share-Master-Context.md` → v4.0, `CLAUDE.md` → v1.3.
- **B5 formally complete.**

**Do not retry:**
- DO NOT set `TIER_EXPIRY_SECONDS.free` to 5 days — canonical value is 7 days everywhere.
- DO NOT use `--display` as the sole heading token — `--heading` is the DESIGN-TOKENS.md name;
  both must be declared in shared-styles.njk.

### S53 — Folder upload I
**Commits:** `b1d9855` (folder upload) · `ca1260c` (fflate fix)

- fflate 0.8.2 loaded as blocking CDN script (`cdnjs.cloudflare.com`) before `share.js` module.
- Hidden `<input webkitdirectory multiple>` added to drop zone. "📁 Upload folder" ghost button triggers it.
- Folder drag-drop: `webkitGetAsEntry().isDirectory` detection routes to `handleFolderDrop()` via FileSystem API.
- `readDirectoryEntry()`: batched `createReader.readEntries()` loop — handles >100 entries per dir correctly.
- `handleFolderFiles()`: strips top-level folder name from `webkitRelativePath` — `ProjectFiles/assets/hero.jpg` → `assets/hero.jpg` inside zip. Zip named `ProjectFiles.zip`.
- `zipAndSelect()`: reads files into memory, builds fflate `fileMap`, calls `fflate.zip()` async callback, synthesises `File` object, hands to `handleFileSelection()` unchanged.
- Zip progress card (`#zip-progress-card`): gold bar, file count detail, hides when zip complete, existing upload progress card takes over.
- Zero Worker changes. `application/zip` passes MIME denylist gate.
- **Fix `ca1260c`:** `[new Uint8Array(buf), { level: 0 }]` → bare `new Uint8Array(buf)`. fflate `level:0` writes DEFLATED-with-zero-compression entries; macOS Archive Utility rejects as "unsupported format". Bare Uint8Array = default level-6 DEFLATE, universally compatible. End-to-end smoke test passed: folder → zip → encrypt → upload → download → decrypt → macOS extracts cleanly. ✓

**Do not retry:**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — macOS Archive Utility rejects. Bare `Uint8Array` only.
- DO NOT use `webkitGetAsEntry` result without `.isDirectory` check — files and dirs both return entries.

---

## Sessions 53–72+ — B6 Testing infrastructure + folder upload

**Block principle:** No session holds more than one architecturally complex piece of work.
Split early rather than overstuff. Testing infra reviewed every 4 sessions (S63, S67) — buffer
consumed only if genuinely needed, not by default.

---

### S54 — Folder upload II: edge cases + robustness
**Commit:** TBD · `frontend/share.js` only · no Worker changes

**Delivered:**
- `sanitiseSegment(seg)` + `sanitisePath(rel)` helpers: strip null bytes, control chars, bidi overrides; drop `..`/`.` traversal; truncate segments to 200 bytes. Applied to both drag-drop and picker paths. Mirrors Worker S42a filename sanitisation.
- `readDirectoryEntry` depth limit: `depth` parameter added, throws user-facing `Error` at > 20 levels. Surfaced directly in `handleFolderDrop` error handler.
- `FOLDER_MAX_DEPTH = 20` · `FOLDER_WARN_FILES = 500` · `FOLDER_MAX_FILES = 2000` constants.
- Empty folder guard: both paths show explicit amber message rather than silent skip.
- File count cap: > 2000 → hard stop with manual zip instruction. > 500 → amber non-blocking warning.
- Memory pressure warning: `entries.reduce` over `file.size` before reads. > 500 MB → amber non-blocking warning in `zipAndSelect`.
- `fflate` availability guard: both entry points check `typeof fflate === 'undefined'` and show actionable message.
- Context files compacted: `share-sessions.md` < 500L, `Share-Master-Context.md` < 350L.

**Do not retry:**
- DO NOT use `[new Uint8Array(buf), { level: 0 }]` in fflate 0.8.x — bare `Uint8Array` only (macOS zip compat).
- DO NOT pass explicit `depth=0` to initial `readDirectoryEntry(directoryEntry)` call — default `undefined` resolves to 0 correctly.

---

### S55 — Folder upload receiver UX
**Commit:** TBD · `frontend/share.js`, `frontend/share.css`, `src/index.njk` · no Worker changes

**Decisions locked this session:**
- **Delivery: zip as-is.** Receiver downloads the zip and unzips themselves.
  Auto-unzip on receiver side not implemented: requires fflate on the receiver page,
  full decrypted zip in browser memory before entry extraction, and directory tree
  reconstruction from the zip central directory. Same memory footprint concern as
  client-side zip with no benefit over native OS unzip. Decision permanent unless
  explicitly revisited in B7+.
- **Error states:** Generic `showDownloadError` messages (decryption failure, HTTP error)
  are correct for folder transfers. A corrupted zip is indistinguishable from a
  corrupted file at the AES-GCM decrypt layer — the decryption error is the right
  signal. No folder-specific error message needed.

**Delivered:**
- `id="rc-file-icon"` added to icon span in receiver card HTML (`index.njk`).
- Filename wrapped in `<div>` alongside new `<div class="rc-folder-note hidden" id="rc-folder-note">`.
- `rcFileIcon` + `rcFolderNote` DOM refs added to `share.js`.
- In `enterDownloadMode`, after setting `rcFileName.textContent`: detect `.zip` extension
  via `fileName.toLowerCase().endsWith('.zip')`. If true: set icon to 📁, remove `hidden`
  from `rc-folder-note`.
- `.rc-folder-note` CSS: IBM Plex Mono 11px, `--text-secondary`, `margin-top: 4px`.
- Upload path unchanged — no awareness of "this is a folder zip" needed there.

**Do not retry:**
- DO NOT auto-unzip on receiver side — see delivery decision above.
- DO NOT add a folder-specific decrypt error message — AES-GCM error is the correct signal.

---

| Session | Label | Scope | Size |
|---------|-------|-------|------|
| S53 | Folder upload I | fflate integration, client-side zip, zip progress UI, single blob → existing upload flow | M |
| S54 | Folder upload II | Streaming large folders, edge cases (empty dirs, deep nesting, 1000+ files, special chars) | M |
| S55 | TBD | Folder upload III: receiver UX — folder icon (📁), zip-as-is delivery decision, "Compressed folder" note, error states confirmed. |
| S56 | Folder upload test | Photographer folder end-to-end: upload → share → receive → unzip. Off snags. | S |
| S57 | Bearer TTL — investigation | Measure token lifetime vs large-transfer duration. Document the gap. | S |
| S58 | Bearer TTL — fix | Extend TTL or mid-stream 401 re-auth prompt. Decision at S57. | M |
| S59 | Bearer TTL — buffer | Consumed only if S58 has outstanding issues. | S |
| S60 | Worker unit tests I | Miniflare/Workers test runtime setup. `ratelimit.js` + `manifest.js` coverage. | M |
| S61 | Worker unit tests II | `nut00.js` blind sig tests. `blake3.js` hash verification. | M |
| S62 | Worker unit tests III | `turnstile.js`, `stripe.js` handler stubs. Edge case coverage. | M |
| S63 | Testing infra review I | 4-session checkpoint: assess buffer need. Integration test harness design. | S |
| S64 | Integration tests I | Full upload→download round-trip in test harness against dev Worker. | L |
| S65 | Integration tests II | Passphrase gate, rate limit enforcement, credential farming defence. | M |
| S66 | Integration tests III | MIME denylist, UUID validation, chunk bounds, tier cap enforcement. | M |
| S67 | Testing infra review II | 4-session checkpoint. Load test design. | S |
| S68 | Load test I | k6 setup, credential issue + upload synthetic load. KV rate limit validation. | M |
| S69 | Load test II | Download load, concurrent transfers, KV timing edge cases. | M |
| S70 | CI pipeline I | GitHub Actions: Eleventy build check, wrangler dry-run deploy, lint. | S |
| S71 | CI pipeline II | Test runner in CI. Fail-fast on Worker unit test regression. Lightning toggle card. | S |
| S72 | B6 close | Snag sweep, context files v5.0, B7 brief. Lightning backend confirmed. | S |

**Buffer pool:**
- S60b, S61b, S62b, S64b — testing infra (10 sessions total, reviewed S63 + S67)
- S57b, S58b — bearer token TTL (2–3 sessions)

**Background work for Rajesh during B6:**
1. Competitor analysis — WeTransfer, SwissTransfer, Smash, Wormhole, OnionShare.
   For each: max file size · expiry · encryption model · pricing · anonymous use · Lightning/Bitcoin.
   Feeds B13 and btc++ Berlin pitch.
2. 2 GB test file: `dd if=/dev/urandom of=/tmp/testfile.bin bs=1m count=2048`
   Used S57–S58 for bearer TTL investigation and large-transfer smoke tests.
3. Blink API key: create account + generate key if not already done. Needed at B7 start.
4. btc++ Berlin abstract: draft one paragraph if considering presenting. Claude can help.

*"Nothing stops this train."*
