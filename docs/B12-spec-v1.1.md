# B12-spec-v1.1 — Storage, Quota, Surfaces & Billing
> **Session:** Share-B12 (Opus, design only) · 24 Sep 2026 · v1.1 amended same day from Rajesh's review notes
> **v1.1 changes:** §0.2, §0.4, §1.1, §1.6, §3.3, §3.5, §4.2, §4.5, §5.1, §5.3, §7 (P1/P3/P8 resolved; S3 revised; S7 added)
> **Status key:** 🔒 LOCKED · 🟡 PROVISIONAL (Rajesh to confirm) · 🛡 SECURITY REVIEW REQUIRED before build
> **Executes from:** §7 Decision summary. Sonnet build sessions read §7 first, then the section they're building.

---

## 0. Findings that reshape the brief (read first)

Three things surfaced while holding the brief against the locked invariants. Each changes the design, not the invariant.

**0.1 Sovereign cannot have a server-side storage quota.** 🔒
Bearer rail = no Supabase row, no identity at any layer. A per-account storage counter means binding every Sovereign transfer to one server-side key — that *is* an identity, just wearing a false moustache. Sovereign's quota is therefore **its token balance**: the credential already meters lodgements (spent per transfer), and expiry ceilings bound occupancy. No aggregate occupancy counter exists for Bearer. This is the honest version of "pseudonymous".

**0.2 Citizen vs Sovereign has no *feature* differentiation — it has a *state-location* differentiation.** 🔒
Master Context: "same price and feature set; the rail is a privacy choice." So §4 does not invent paywalled features. The difference is where Chambers' state lives: Citizen = server-side (sign in anywhere); Sovereign = device-only (nothing to subpoena). The memory line "Citizen → Sovereign → Chartered" as an upgrade ladder is **superseded**: the ladder is Pro Bono → {Citizen | Sovereign} → Chartered, and Citizen ↔ Sovereign is a rail switch. 🔒 Confirmed v1.1. The website plans/upgrade pages explain the rails; Chartered clients who need identity are handled by an AM.
Parity is **today's** state, not a promise: Bearer-only features are expected later (the Bearer layer enables things the Registered layer can't). Build nothing that assumes permanent parity. 🔒

**0.3 The DAD path must clear the org transfer index.** 🔒
Today `dock_index` is not cleared on consumer DAD (ages out on TTL). Tolerable for Navy Office; **fatal for Harbourmaster**, where a DAD'd transfer lingering as Active/Expired while a manually-deleted one vanishes *is* a DAD label by another name. Harbourmaster's index is cleared on every sender/consumer deletion path. See §3.4 and §6.

**0.4 Chambers has no authentication yet.** 🛡
Neither Chambers nor Harbourmaster can ship without a sign-in model for the Registered rail. This is first-time security design, not wiring. Scoped in §4.6, flagged for its own review.
Sovereign has **no sign-in at all** — nothing of theirs lives on the server. What they need is **portability** of the device-held ledger, designed in §4.2 and reviewed as S7. 🔒

---

## 1. Per-org quota model

### 1.1 What "quota" means 🔒
- **Quota = occupancy**: storage held right now (live transfers not yet deleted/purged).
- **Credits = throughput**: spent per lodgement under the rate card (10/transfer, 100/GB). Chartered/API only.
- Two meters, never merged in UI, API, or schema. A full quota blocks *new* lodgements; zero credits blocks *new* lodgements. Different CTA for each.

**AM script (plain English, locked for client conversations):** 🔒
> *"Credits are postage: you spend them each time you send. Capacity is the size of your post room: how much can sit waiting to be collected at once. Run out of postage and you can't send; fill the post room and you can't send more until something's collected or expires."*

### 1.2 Who has a quota 🔒
| Tier | Internal key | Occupancy quota | Keyed by |
|---|---|---|---|
| Pro Bono | `free` | None per-account. Per-transfer `FREE_CAP` only. Global free-pool signal in Navy Office. | — |
| Citizen | `paid_registered` | Yes — account-of-one | `quota_ref` |
| Sovereign | `paid_bearer` | **No** — token balance is the meter (§0.1) | — |
| Chartered | `chartered` | Yes — per org, contract-set | `quota_ref` |

Quota limits are pricing: **Rajesh sets the numbers**. 🟡 Stored per account, not hardcoded; tier default applied at account creation, superadmin can override per Chartered org.

### 1.3 Unit 🔒
**Chunks (32 MiB), not bytes.** Quota, usage and reservations are integer chunk counts. Display converts to GiB.
Why: credit-back on deletion reads `manifest.total_chunks` (already persisted for Merkle) — no plaintext size ever needs persisting. This keeps the pending "drop `total_bytes` from manifest" privacy win intact and makes it cheaper to finish.

### 1.4 `quota_ref` 🔒
- `quota_ref = HMAC-SHA256(QUOTA_REF_KEY, account_id)`, domain tag `refueler.share.quotaref.v1`. New Worker secret `QUOTA_REF_KEY`. Never stored in KV raw alongside `account_id`.
- `account_id` = `stripe_customer_id` (Citizen) or the org identifier behind the `rfs_live_` keypair (Chartered).
- Supabase stores `quota_ref` only in quota tables — no email, no Stripe ID. The join to identity is recomputed, not stored.
- Written into the manifest for Registered/Chartered transfers **only**. Never for Bearer. 🛡 (linkage under R2 compromise — acceptable on a rail that already has identity; confirm in review.)

### 1.5 Where it lives — hybrid, with R2 as truth 🔒
| Store | Holds | Role |
|---|---|---|
| **Supabase** `quota_accounts` | `quota_ref PK, kind ('registered'\|'chartered'), limit_chunks, used_chunks, reserved_chunks, updated_at` | Enforcement counter (atomic) |
| **Supabase** `quota_reservations` | `session_hash PK (BLAKE3 of upload session token), quota_ref, chunks, expires_at` | In-flight uploads |
| **R2 manifests** | `total_chunks`, `quota_ref` | **Ground truth** |
| **KV** | nothing quota-related | KV is compromised by assumption; not an enforcement store |

Supabase counter is a cache of R2 truth. Nightly reconcile (§1.8) corrects drift. RLS deny-all on both tables, as house style.

### 1.6 Enforcement at initiate — reserve, then bound 🔒 🛡
1. `handleInitiate` resolves **`resolved_tier` live** (never `issued_tier`) and `quota_ref`.
2. Declared `total_bytes` (transient — used here, never persisted) → `need = ceil(total_bytes / CHUNK_SIZE)`.
3. Single atomic Supabase RPC `reserve_quota(quota_ref, need, session_hash, ttl)`:
   `UPDATE … SET reserved_chunks = reserved_chunks + need WHERE quota_ref = $1 AND used_chunks + reserved_chunks + need <= limit_chunks RETURNING …` + insert reservation row, in one transaction. No row returned → reject.
4. Reject = **HTTP 402**, body `{ error: "quota_exceeded" }` plus the caller's *own* held/limit in GiB (it's their account; not a leak). Distinct from the per-transfer cap error. 🟡 (402 is fitting; it's the one status code that means "pay up" without being rude about it.)
5. **Bound**: `/urls` refuses any chunk index `≥ reserved chunks`; `/finalise` refuses if `manifest.total_chunks > reserved`. This closes the under-declare-then-over-upload bypass. 🛡 Build session must first verify whether `/urls` already bounds to `total_chunks` from initiate.

Why Supabase RPC, not KV or Durable Objects: KV has no compare-and-set (race = over-allocation); DOs aren't built yet (backlog). Initiate already calls Supabase for tier resolution, so one extra round-trip, same hop. **REVISIT when the Durable Objects rate-limiter lands** — a DO per `quota_ref` may be the more elegant enforcement. (Logged in memory and Master Context.)

### 1.7 Usage tracking — at finalise, reconciled lazily 🔒
- **Finalise**: move `total_chunks` from reserved → used; release `reserved - total_chunks` surplus; delete reservation row. Fire-and-forget is **not** acceptable here (it's enforcement) — but a failure must not fail the finalise the user already paid for: on RPC error, finalise succeeds and reconcile fixes it. 🔒
- **Per-chunk tracking: rejected.** Hundreds of Supabase writes per transfer for a number the reservation already bounds.
- **Abandoned uploads**: reservation row expires with the upload session; reconcile releases it.

### 1.8 Credit-back on deletion 🔒
Every deletion path releases `manifest.total_chunks` against `quota_ref`, **exactly once**, gated on the transition that writes the tombstone:
- DAD (consumer, via `finishDownload`)
- Owner delete / Harbourmaster strike-off
- Grace sweep / orphan sweep purge (§6)

The existing `consumed:true` guard write is the once-only latch: credit-back fires only on the call that sets it. KV isn't atomic, so a double-fire is theoretically possible → **nightly reconcile at 03:00** (same cron) recomputes `used_chunks` per `quota_ref` from live manifests and `reserved_chunks` from unexpired reservation rows, and overwrites. Drift can therefore exist for < 24 h and only in the user's favour or ours by a transfer's width. 🟡 Reconcile cost (R2 list + manifest reads) fine at current scale; revisit at ~100k live transfers.

DAD and manual delete call the **same** release function with the **same** arguments. No path-specific parameter reaches Supabase. 🔒

### 1.9 Grace & edge cases 🔒
- **Transfer in progress when quota is hit**: impossible by construction — it already holds its reservation. Quota only ever blocks *new* initiates.
- **Quota lowered below usage** (superadmin edit, downgrade): existing transfers untouched; new initiates blocked until usage drops. No early deletion, ever.
- **Subscription cancelled/lapsed**: effective limit → 0 for new initiates; live transfers run to their expiry. Consistent with "cancellation gate runs before lazy reset".
- **Test credentials (Share-Admin-1)**: bypass quota entirely, tagged `soak`, excluded from every Navy Office aggregate. 🛡 confirm the admin-gated bypass cannot be reached by a non-admin credential.

---

## 2. Navy Office — Storage & Billing panel

### 2.1 Signals 🔒
| Card | Content | Granularity |
|---|---|---|
| **Fleet occupancy** | Total held (GiB) across R2, split Pro Bono / Registered / Chartered / Bearer | Aggregate |
| **Capacity pressure** | "N accounts approaching quota" · "M at limit" | Counts only |
| **Chartered orgs** | Table: org handle · quota · held · % · live-transfer count · renewal date | Per org, handle only |
| **Citizen distribution** | Histogram of utilisation buckets (0–25 / 25–50 / 50–80 / 80–95 / 95+) | No per-account rows |
| **Sovereign** | Live-transfer count + held GiB (aggregate from manifests with no `quota_ref`) | Aggregate |
| **Self-cleared this week** | Count of transfers deleted before expiry | Single number (+ optional tier split) |
| **Purged this week** | Count of transfers removed by sweep | Single number |

No per-transfer size. No UUIDs. No Citizen rows. 🔒

### 2.2 Anonymised but actionable 🔒
- **Org handle** = `ORG-` + first 4 bytes (hex, uppercase) of `HMAC(QUOTA_REF_KEY, "handle" ‖ quota_ref)`. Stable, meaningless, shoulder-surf-safe.
- Harbourmaster shows the org its own handle ("Quote ORG-7F3A when contacting us"). The *org* supplies the link between name and handle; Navy Office never displays names. Rajesh already knows Chartered clients by contract — the point is the panel itself stays screenshot-safe.
- The only action in the Chartered table is **Adjust quota** (writes `limit_chunks`). No "contact", no "nudge", no drill-down to transfers. 🔒

### 2.3 Capacity pressure indicator 🟡
- Thresholds: **approaching ≥ 80%**, **at limit ≥ 95%** of `limit_chunks` (used + reserved).
- Display: one line in the Storage & Billing card, amber for approaching, red for at-limit, count only. Replaces the "17 need a nudge" badge. 🔒
- Purpose: infrastructure planning (R2 growth, cost). Not outreach. 🔒
- Plus a **fleet-level** line: total held vs a Rajesh-set R2 budget figure — the thing that actually costs money.

### 2.4 Self-cleared metric 🔒
- One AE event, `cargo.cleared`, emitted by **both** DAD and owner-delete paths, identical payload: no UUID, no `quota_ref`, no path marker. Optional blob: tier bucket.
- Surfaces as a single weekly number in Storage & Billing. "Storage is cycling" signal. Build: future session (not blocking B12 build order).

### 2.5 Execution Dock (Navy Office placeholder) 🔒
Stays in Navy Office until Harbourmaster ships, gains the PURGED status (§6), then is **removed** from Navy Office in the Harbourmaster build session.

---

## 3. Harbourmaster (org admin surface)

### 3.1 Shape 🔒
Harbourmaster is the Chartered-unlocked section set **inside the single Chambers build** (§4.1), not a separate app. The name labels the sidebar group an org admin sees. Custom House (API keys, webhooks, credit usage) remains reserved and additive.

### 3.2 What an org admin sees 🔒
- Org handle, contract quota, held (aggregate), live-transfer count, credit balance, renewal date.
- Transfer list (§3.4).
- Capacity CTA (§3.3), Billing (§5).

### 3.3 Capacity panel 🔒 (thresholds 🟡)
- Bar: held vs quota. At ≥ 80% → CTA appears; at ≥ 95% → CTA becomes primary.
- **Thresholds are per-org settings** (`warn_pct`, `limit_pct` on `quota_accounts`), defaulting to 80/95, agreed with each client at onboarding and monitored through their first 3 months. Adjustable by superadmin in Navy Office. 🔒
- CTA text: "Increase capacity" → contact route with org handle prefilled (Chartered quota is contract-set; no self-serve). Separate credits CTA: "Top up credits" when credits < a Rajesh-set floor.
- **Differencing mitigation** 🛡: held figure is an **hourly snapshot**, rounded **up to whole GiB**; live-transfer count shows "fewer than 3" below 3. Honest note for review: an admin watching the aggregate move across one lodgement can still infer its rough size. The org is the data controller under the DPA; residual risk accepted provisionally, not waved away.

### 3.4 Transfer list — safe fields 🔒
| Field | Shown | Notes |
|---|---|---|
| Lodgement ref | ✅ | `LR-` + 6 chars of `HMAC(per-org key, uuid)`, domain `refueler.share.lodgeref.v1`. Unlinkable across orgs, useless outside this org, **not** the UUID |
| Lodged (date) | ✅ | |
| Expires | ✅ | Retained as audit trail after purge |
| Status | ✅ | **Active · Expired · Purged** only |
| Size | ❌ | Invariant |
| Sender / user | ❌ | No per-user detail |
| Rail | ❌ | |
| Collected / download count | ❌ | Read-receipt = surveillance |
| DAD flag | ❌ | Absence is the signal |

Action: **Strike off** (owner-delete). Client sends the lodgement ref; server resolves ref → UUID inside that org's index only. UUIDs never leave the Worker in Harbourmaster responses. 🔒

### 3.5 Org index 🔒
- New KV key `org_dock:{quota_ref}` (separate from global `dock_index`). Entry: `{ lodge_ref, uuid, lodged_at, expires_at, purged_at? }`. **No `size_bytes`, no `rail`.**
- Written at finalise; **removed** on DAD and owner-delete/strike-off (both paths, same call — §0.3); **marked** `purged_at` by sweep; ages out on TTL (expiry + grace + display window 🟡 7 days).
- **UUID stored encrypted, not raw** (lead proposal, 🛡 S3): `uuid_ct = AES-GCM(ORG_DOCK_KEY, uuid)`, AAD = `quota_ref` ‖ domain tag `refueler.share.orgdock.v1`, fresh 96-bit nonce per entry. New Worker secret `ORG_DOCK_KEY`. A KV leak alone reveals nothing; an attacker needs KV **and** the secret. AAD binding means an entry can't be replayed into another org's index. Cost: one decrypt per strike-off. Fallback if SR rejects it: raw UUID as in v1.

### 3.6 Execution Dock migration path 🔒
1. Now: Navy Office Execution Dock + PURGED status (B12-1).
2. Harbourmaster build: `org_dock` index populated going forward; list reads it.
3. Same session: Execution Dock removed from Navy Office; Navy Office keeps aggregates only.
4. Pre-existing transfers age out naturally — no backfill.

---

## 4. Chambers (Citizen / Sovereign)

### 4.1 Single build 🔒
One app at `/share/chambers/` (refueler.io repo). Sections render from an **`entitlements`** object returned by the Worker, derived from `resolved_tier` via `worker/src/tiers.js`. Frontend never reasons about tier *names* — display names are render-time only. 🔒

### 4.2 Citizen vs Sovereign 🔒
| | Citizen (Registered) | Sovereign (Bearer) |
|---|---|---|
| Features, caps, price | Identical | Identical |
| Sign-in | Email magic link (§4.6) | **None** — nothing to sign into |
| Transfer list | Server-side, any device | **Device-only**: lodgement receipts kept in browser IndexedDB at lodge time |
| Own per-transfer size | ✅ (it's their file) | ✅ from local receipt |
| Capacity | Server quota bar | Token balance from local wallet |
| Billing history | Stripe portal | Local Lightning receipts (payment hash · amount · tier) |
| Lose the device | Sign in elsewhere | History gone. By design. Copy must say so plainly. |

Sovereign Chambers is the privacy feature: "In camera — your ledger lives on your device."

**Sovereign portability — user's choice of three** 🔒 (mechanics 🛡 S7):
1. **B8 Deed** — ledger encrypted under a key HKDF-derived from the Deed (own domain tag, independent of the Deed→Locke derivation). Whoever holds the Deed holds the Chambers. **The only option that survives a lost device.**
2. **Signal QR pairing** — linked-device style: new device shows a QR; old device sends the encrypted ledger blob through the user's own Signal. Never touches Refueler.
3. **SimpleX QR pairing** — same mechanism, SimpleX channel.

Options 2–3 link a second device while the first still exists; they cannot rescue a lost one. UI copy must say so plainly. Nostr considered and dropped (a persistent npub is the false moustache again).

### 4.3 Chartered sections — visible but locked 🔒
- Locked clusters: **Organisation · Team · Capacity (org) · Custom House (API & MCP)**.
- Render: skeleton cards with **illustrative placeholder content only** — the Worker returns no org data for a non-entitled caller, ever. Opacity reduced, `--text-tertiary` labels, single lock glyph + "Chartered" tag per cluster (not per card), **one** CTA per cluster.
- No hover-reveal, no fake numbers that look real.

### 4.4 Capacity CTA 🔒 (thresholds 🟡)
- Citizen: ≥ 80% of quota → inline banner in Capacity card, `--accent-action` text-link weight, not a button slab. ≥ 95% → button. Links to `/share/plans/` (also fixes CAP-WARNING-LINK).
- Sovereign: token balance ≤ 1 lodgement's worth → same banner, links to Lightning top-up.
- Tone: noticeable, not a shop window. One CTA visible at a time.

### 4.5 Progressive unlock 🔒
- Tier change lands via existing Stripe webhook → `subscribers` → next `entitlements` fetch re-resolves live. No client-cached tier beyond the page session.
- Unlock is additive: same URL, same layout, locked clusters populate. Custom House appears as an extra section, not a move.
- Downgrade: clusters re-lock; data retained server-side per contract, not deleted on UI state.
- **Sovereign → Personal API/MCP (Bearer)**: unlock is credential-held, not server-state. Custom House in device-only Chambers switches on when a valid API credential is present locally (NUT-24 `u="api"` ecash path, pending O8). No account created. Pricing deferred to its own scoping + Opus session (§7). 🔒 mechanism · 🟡 pricing

### 4.6 Authentication (Registered rail only) 🛡
Provisional shape for the review, not for build:
- Email magic link (email already held for Citizen), single-use, 15-minute token stored as BLAKE3 hash (house rule).
- Session: `HttpOnly; Secure; SameSite=Strict` cookie, short TTL, server-side session record keyed by hash. CSRF token on state-changing calls (strike-off, portal session).
- No passwords. No third-party identity providers.
- Chartered org admin uses the same mechanism against the org's registered admin email.
- Needs its own Opus security session before any Chambers build (first-time auth design).

---

## 5. Billing integration

### 5.1 What each surface shows 🔒
| | Chambers — Citizen | Chambers — Sovereign | Harbourmaster — Chartered |
|---|---|---|---|
| Plan | Citizen · monthly/3-month/yearly | Sovereign · credential validity | Chartered · contract |
| Status / renewal | From `subscribers` | From local credential | Renewal date (Supabase, superadmin-set) |
| Invoices & receipts | **Stripe Customer Portal** | Local Lightning receipts | **Stripe Customer Portal** (manual invoices appear there) |
| Payment method / cancel | Stripe portal | n/a — buy again | Stripe portal / contact |
| Credits | — | — | Balance + top-up history from existing credit ledger |

Personal API/MCP on the Bearer rail follows the **Sovereign** column: local receipts, no portal, no identity. 🔒

### 5.2 Invoice surface 🔒
**Build none.** Stripe Customer Portal is the invoice/receipt surface for everyone with a Stripe customer. Worker endpoint `POST /billing/portal` (authenticated session only) creates a portal session and returns the URL. 🛡 in the §4.6 review. `stripe_sub.js` remains the subscription source of truth.

### 5.3 Upgrade flow 🔒
| From → To | Starts | Lands |
|---|---|---|
| Pro Bono → Citizen/Sovereign | Cap warning, `/share/plans/` | Stripe Checkout / Lightning → Chambers (first visit = magic-link prompt for Citizen; local ledger init for Sovereign) |
| Citizen/Sovereign → Chartered | Locked-cluster CTA in Chambers | Contact route (manual invoice, no self-serve). Unlock on contract activation. |
| Citizen ↔ Sovereign | Plans page | Rail switch, not an upgrade (§0.2). Copy must not call it one. |
| Sovereign → Personal API/MCP (Bearer) | Locked Custom House cluster in Chambers | Lightning purchase → API credential stored locally → Custom House unlocks. For solo operators connecting their own agents. Pricing 🟡 pending session. |

### 5.4 Prerequisite 🔒
`/upgrade` is broken (UPGRADE-CSS). All new CTAs target `/share/plans/`. `/upgrade` should 301 there.

---

## 6. PURGED status

### 6.1 State model 🔒
| Status | Condition | Source |
|---|---|---|
| **Active** | `now < expires_at`, objects present | index entry |
| **Expired** | `now ≥ expires_at`, inside Three Tides grace, objects present | index entry |
| **Purged** | Sweep has deleted the R2 objects | `purged_at` on index entry |
| *(absent)* | DAD or owner-delete / strike-off | entry **removed** |

### 6.2 What triggers PURGED 🔒
Any sweep (grace sweep or orphan sweep, `dry_run=false`) that deletes an expired transfer's objects writes `purged_at` onto `dock_index:{uuid}` and `org_dock:{quota_ref}` entries. Dry runs write nothing. Orphan uploads that were never finalised have no index entry → nothing to mark.

### 6.3 Tombstone 🔒
`consumed:true + consumed_at` is **sufficient and unchanged**. The purge path writes the same tombstone shape as DAD, deliberately indistinguishable to anyone reading the tombstone (recipient sees 410 either way). The Purged/absent distinction lives **only on index entries**, and index entries for DAD are removed — so no surface can tell DAD from manual delete. `date-seal.ots.enc` deleted on purge like every other path (existing invariant). Quota credit-back fires on the tombstone transition (§1.8).

### 6.4 Audit trail 🔒
Expires column retains the original expiry date after purge. Confirmed. Purged entries display for a short window 🟡 (7 days) then age out on TTL.

### 6.5 Required change to current behaviour 🔒
DAD (`finishDownload` destruction sequence) gains step 7: remove `dock_index:{uuid}` (and, once it exists, the `org_dock` entry). Owner-delete already removes it. This makes Navy Office consistent with the Harbourmaster invariant today rather than leaving a trap for later.

---

## 7. Decision summary (executable)

### Locked 🔒
1. Quota = occupancy; credits = throughput. Two meters, never merged.
2. Occupancy quota exists for Citizen (account-of-one) and Chartered (org) only. Sovereign's meter is token balance. Pro Bono: per-transfer cap only.
3. Unit = 32 MiB chunks; credit-back reads `manifest.total_chunks`. No plaintext size persisted.
4. `quota_ref = HMAC(QUOTA_REF_KEY, account_id)`, tag `refueler.share.quotaref.v1`. In manifest for Registered/Chartered only.
5. Supabase `quota_accounts` + `quota_reservations`, RLS deny-all; atomic `reserve_quota` RPC at initiate using `resolved_tier`.
6. Over-quota at initiate → 402 `quota_exceeded`. In-flight transfers never fail on quota.
7. `/urls` bounds chunk indices to the reservation; `/finalise` rejects over-reservation.
8. Finalise converts reserved → used; RPC failure does not fail finalise.
9. Every deletion path releases quota once, latched on the tombstone write; DAD and manual delete call the same release with the same args.
10. Nightly 03:00 reconcile recomputes used/reserved from R2 + reservation rows.
11. Lowered quota / cancellation blocks new lodgements only; never early-deletes.
12. Test credentials bypass quota and are excluded from all aggregates.
13. Navy Office Storage & Billing: fleet occupancy, capacity-pressure counts, Chartered table by `ORG-xxxx` handle, Citizen histogram, Sovereign aggregate, self-cleared + purged weekly counts. Only action: Adjust quota.
14. "17 need a nudge" badge removed; replaced by capacity-pressure line.
15. `cargo.cleared` AE event, identical payload from DAD and owner-delete.
16. Harbourmaster = Chartered section set inside the single Chambers build at `/share/chambers/`.
17. Harbourmaster list: lodgement ref (HMAC, not UUID), lodged, expires, status. No size, sender, rail, collection, DAD.
18. Strike-off by lodgement ref, resolved server-side within the org's index; UUIDs never returned.
19. New KV `org_dock:{quota_ref}`; no size/rail; removed on DAD + owner-delete; marked on purge.
20. Execution Dock leaves Navy Office in the Harbourmaster build session. No backfill.
21. Chambers renders from Worker `entitlements` derived from `resolved_tier`; display names render-time only.
22. Citizen/Sovereign feature parity; Citizen state server-side, Sovereign state device-only (IndexedDB).
23. Locked Chartered clusters show placeholder content only; Worker returns no org data to non-entitled callers.
24. All CTAs → `/share/plans/`; `/upgrade` 301s there.
25. Stripe Customer Portal is the only invoice/receipt surface; Sovereign receipts are local.
26. Chartered upgrade is contact-led, not self-serve.
27. Status set Active / Expired / Purged; DAD and delete = absence.
28. Tombstone unchanged (`consumed:true + consumed_at`); purge writes the same shape; Purged lives on index entries only.
29. DAD destruction sequence gains: remove `dock_index:{uuid}` (+ `org_dock` entry when it exists).
30. All new surfaces: Paper/Carbon via `data-theme` + existing theme mechanism in `global.css`; `--accent-action` for CTAs only.
31. Tier ladder: Pro Bono → {Citizen | Sovereign} → Chartered; Citizen ↔ Sovereign is a rail switch. Parity is current, not permanent.
32. Colours: **Carbon `--bg #1A1917`, Paper `--bg #E8E2D8`** (live `refueler.io/assets/css/global.css`). DESIGN-TOKENS.md to be updated to match (docs-only task).
33. Sovereign portability: Deed / Signal QR / SimpleX QR, user's choice. No Sovereign sign-in.
34. Capacity thresholds per-org, defaults 80/95, set at onboarding, reviewed over first 3 months.
35. Sovereign → Personal API/MCP unlock is credential-held; Custom House lights up locally.
36. `org_dock` UUIDs encrypted under `ORG_DOCK_KEY` (pending S3 confirmation).

### Provisional 🟡 (Rajesh)
- P2. Quota limits per tier and the credits floor for the top-up CTA (pricing — your call).
- P3. ~~Thresholds~~ → resolved: per-org settings, defaults 80/95 (§3.3).
- P4. HTTP 402 for `quota_exceeded`.
- P5. Purged display window (7 days).
- P6. Harbourmaster rounding (hourly snapshot, whole GiB, "<3" floor).
- P7. Sovereign local-ledger export/import (future).
- ~~P1, P8~~ resolved v1.1 (see Locked 31–33).
- P9. Pricing for Sovereign → Personal API/MCP (Bearer), incl. £24/mo cannibalisation arithmetic — separate scoping session, then Opus.

### Security review required before build 🛡
- S1. Quota bypass vectors: under-declare at initiate, `/urls` index bounds, finalise check, reservation expiry, concurrent initiates racing one account.
- S2. Test-credential quota bypass reachable only via ADMIN_KEY path.
- S3. `quota_ref` in manifest (R2 linkage) + **encrypted `org_dock` UUID** lead proposal (§3.5): key handling, nonce, AAD, rotation.
- S4. Lodgement-ref derivation and per-org key handling (cross-org unlinkability).
- S5. Harbourmaster aggregate differencing (residual size inference).
- S6. Chambers/Harbourmaster auth: magic link, session cookie, CSRF, `/billing/portal` endpoint.
- S7. Sovereign portability: Deed-derived ledger key, QR pairing protocol (key exchange, blob format, replay, what the QR reveals if photographed).
- **S1–S7 → one Opus session, Share-B12-SR** (prompt: `Share-B12-SR-prompt.md`). Billing portal work may split to a further Opus session if SR runs long.

### Build order
| Session | Scope | Model | Blocked by | Pre-Berlin? |
|---|---|---|---|---|
| B12-1 | PURGED status on sweeps + DAD clears `dock_index` (§6) | Sonnet | — | ✅ |
| B12-2 | Navy Office Storage & Billing shell: fleet occupancy, Sovereign/Pro Bono aggregates, badge replacement | Sonnet | — | ✅ (quota cards stubbed "no accounts yet") |
| B12-SR | Security review S1–S7 | Opus | — | 🟡 if time |
| B12-3 | Supabase quota tables + RPC; initiate/urls/finalise enforcement; deletion credit-back; reconcile cron | Sonnet | SR, P2 | ❌ post-Berlin |
| B12-4 | Chambers shell + entitlements + locked clusters + Sovereign local ledger + portability | Sonnet | SR | ❌ |
| B12-5 | Harbourmaster: `org_dock`, list, strike-off, capacity; Execution Dock removed from Navy Office | Sonnet | B12-3, B12-4 | ❌ |
| B12-6 | Billing: portal endpoint, plans CTA wiring, `/upgrade` 301 | Sonnet | SR | ❌ |
| — | DESIGN-TOKENS.md colour update (#1A1917 / #E8E2D8) | Sonnet | — | ✅ trivial |
| Pricing-scope → Pricing-Opus | Sovereign → Personal Bearer API/MCP pricing (P9) | Sonnet scoping, then Opus | — | ❌ after build block |
| later | `cargo.cleared` AE event + self-cleared card | Sonnet | — | — |

*Fly on the 30th with B12-1 and B12-2 shipped and the rest locked on paper. Nothing stops this train; it merely waits politely at signals.*
