# refueler-mcp-spec-v2.md — locked MCP architecture

> **Session:** Share-MCP-Opus-2 · 10 Sep 2026 · Opus · planning + architecture, no code
> **Status:** locked spec. Complete replacement for `refueler-mcp-spec-v1.md`.
> Load alongside `CLAUDE.md`, `Share-Master-Context.md`, `share-sessions.md`.
> **Supersedes:** v1 in full, and the MCP stubs in `CLAUDE.md` §API feature gates.
> Tool names unchanged; contracts, payment model, and Worker contracts now locked.

---

## 0. Honesty banner — read this before quoting anything from this file

This document designs an MCP integration and the Worker contracts behind it.
Almost none of it is live yet. What is true on 10 Sep 2026, versus what this file
merely *specifies*:

| Thing | State on 10 Sep 2026 |
|---|---|
| API tier (HMAC auth, `POST /api/v1/credential/issue`, receipts, webhooks) | **Built** (SW block, pre-deploy pending SW9) |
| Identity-rail credit pool (KV quota, decrement) | **Built as a bare pool** — monthly allocation + reset + overage ceiling are **specified here, not yet built** (SW-MCP-W2) |
| `GET /api/v1/capabilities` emitting the **locked** schema in §7.1 | **Not yet** — endpoint exists but does not emit this shape (SW-MCP-W1) |
| Daily reference-rate KV + admin rate panel (§7.3) | **Not built** (SW-MCP-W1) |
| `personal_api` plan value + Personal Sovereign API path | **Designed only** (this session; SW-MCP-W2) |
| Anonymous-rail credit-block issuance (`X-Cashu-Token`) | **Endpoint coded, not in production** — no live keyset issues credits to buy; gates on B7 (Lightning) |
| Lightning top-up (buy a credit block) | **Not shipped** — B7, node not yet provisioned |
| MCP server (any of the four tools) | **Does not exist.** This file is its blueprint. |
| Filename fix (D-1) — filename out of the Worker's sight | **Not built.** Until SW-MCP-4 ships, **the Worker still sees the filename.** Scope every trust claim accordingly (§3.3). |
| Agent-to-agent standing inbox (`refueler_receive`) | **Designed only** — gates on Silent Drop shipping |
| BOLT12 / inline agent payment | **B9+ forward commitment** — documented, never built |

> **Merkle / MMR / SMT integrity design:** see `merkle-spec-v1.md` (repo root, B9-Opus · 12 Sep 2026) — the two-roots distinction there governs every integrity claim in this spec.

**`rails_available` today is `["identity"]`, not `["identity","anonymous"]`.** The
anonymous rail appears in that array only when B7/NB-4 make credit-block issuance
live. Do not let the illustrative arrays elsewhere in this file imply otherwise.

**Forbidden phrasing (locked, carried + extended):** never "proof of delivery"
(use **collection receipt**); never "zero-knowledge" as a headline; never
"military-grade"; never "end-to-end file integrity" (only **chunk integrity** is
verified today — BLAKE3 per ciphertext chunk; full Merkle-root verification is
blocked until B9); never "sats", "ecash", or "tokens" in any user-facing string
(use **credits** / **Share credits**); never place identity-rail and anonymous-rail
pricing in direct comparison. The MCP server runs **in the agent's trust domain**
and handles **ciphertext only** — invariant, not preference. Refueler never hosts a
plaintext endpoint.

---

## 1. Vocabulary discipline (O-11) — read once, apply everywhere

The terminology ban is a discipline about **strings a human reads verbatim**, not
about internal precision. The line is drawn here so future sessions maintain it.

**User-facing (credits only — never sats / ecash / tokens):**
- Every field in an MCP tool's **output schema** that the agent narrates to the
  user, and every field carrying a monetary figure. All such fields use the
  `_credits` suffix (`cost_credits`, `remaining_credits`, `shortfall_credits`,
  `allocation_credits`).
- The `instructions`, `dashboard_url`, and any prose string inside an envelope the
  agent may surface.
- Pitch copy (§5), the website, and anything shown in the Claude conversation.

**Internal-facing (precise terms permitted — sats, ecash, Cashu, NUT-XX, blinded,
capability-atom, keyset):**
- The `GET /api/v1/capabilities` **JSON contract** (§7.1). It speaks *credits* to
  the outside and declares `credit_unit: "sat"` so a technical reader knows a
  credit settles as one sat. It never emits the word "sat" in a value.
- Tool **implementation notes** (how a tool talks to endpoints, blinding, BDHKE,
  `X-Cashu-Token`, double-spend).
- Payment-architecture mechanics (§2), trust-boundary mechanics (§3), the honesty
  banner's technical table, and the Worker-contract appendix (§7).

**The credit ↔ sat mapping (internal, load-bearing): `1 credit = 1 sat`.** This is
why 50,000 credits ≈ 490 GB at rate card v1.0 (100 credits/GB, minus per-transfer
overhead), and why the anonymous rail — which spends sat-denominated Cashu — maps
1:1 onto "credits" with no fudge. Treasury and rate-card maths use sats; the human
sees credits; the two are the same integer.

---

## 2. Tool Contracts

Four tools, locked by name in `CLAUDE.md`: `refueler_capabilities`,
`refueler_send_file`, `refueler_check_transfer`, `refueler_quote` (+ the included
`refueler_balance`, §2.6). Each ships the day its backing product is live.

Backing endpoints (all in the SW-block Worker, `api.share.refueler.io`):

- `GET  /api/v1/capabilities` — capability + rate-card discovery (unauthenticated, free). **Contract locked in §7.1.**
- `GET  /api/v1/auth/ping` — HMAC auth check; returns caller rail + quota.
- `POST /api/v1/credential/issue` — HMAC-auth; spends 1 credit (identity) or one capability-atom credit (anonymous); returns a blind-signed upload credential bound to a fresh `uuid`.
- `PUT  /upload/{uuid}/{NNNN}` — chunk upload; chunk `0000` carries manifest headers.
- `GET  /api/v1/receipt/{uuid}/acceptance` and `/collection` — HMAC-auth; pull stored signed receipt.

> **Route correction (carried):** live route regex is `(acceptance|collection)` —
> not `accepted`. Webhook *event* names are `cargo.accepted` / `cargo.discharged`;
> do not confuse the event name with the pull-endpoint path segment.

### 2.1 `refueler_capabilities`

Discovery. Cheap, unauthenticated, free. Called first so the agent never promises
what the server can't honour. Binds to the **locked** response in §7.1.

**Input:** `{ "detail": "summary" | "full" }` (optional, default `"summary"`). No auth, no spend.

**Output (success):** the §7.1 payload. The agent gates all later behaviour on
`features` and `rails_available` — e.g. it will not offer an anonymous send unless
`rails_available` contains `"anonymous"`.

**Output (errors):**

| Case | Shape |
|---|---|
| Rate limited | `{ "error": "rate_limited", "retry_after_s": <n> }` (HTTP 429) |
| Network / server | `{ "error": "capabilities_unavailable", "detail": <string> }` — tool degrades to last-known-good cached card and says so |

**Endpoint sequence:** `GET /api/v1/capabilities` → return. One call, no auth.

**User sees:** nothing, usually — this runs silently before a send. If asked
directly, the agent narrates live features in prose and is explicit about what is
designed-but-not-live.

### 2.2 `refueler_quote`

Tells the user what a transfer costs **before** any spend, and whether the current
relationship can afford it. No spend, no upload — the "402-prevention" tool.

**Input:**
```
{
  "size_bytes": <integer>,          // required, > 0
  "permanent_record": <boolean>,    // optional, default false
  "rail": "identity" | "anonymous"  // optional; defaults to the configured credential's rail
}
```

**Output (success):**
```
{
  "rate_card_version": "v1.0",
  "cost_credits": <integer>,
  "cost_gbp_reference": <number> | null,   // daily reference rate only; null if rate stale/absent; labelled "today's reference rate"
  "rail": "identity" | "anonymous",
  "affordable": <boolean>,
  "balance": {
    "kind": "credit_pool" | "local_credits",
    "remaining_credits": <integer> | null   // identity: from auth/ping; anonymous: counted locally; null if unknown
  }
}
```

**Cost formula (rate card v1.0, locked):**
`cost_credits = 10 (transfer) + ceil(size_bytes / 1_000_000_000) × 100 (per GB) [+ 20 if permanent_record]`.
Computed **locally** from the cached capabilities card — no Worker call to price.
GBP is the **daily reference rate** only (§7.3), always labelled "today's reference
rate", never live spot. If the reference rate is stale or absent, `cost_gbp_reference`
is `null` and the agent quotes credits with no £ figure.

**Output (errors):**

| Case | Shape |
|---|---|
| `size_bytes` missing/invalid | `{ "error": "invalid_input", "detail": "size_bytes must be a positive integer" }` |
| Auth check failed (identity balance) | `{ "error": "auth_failed", "detail": <string> }` — quote still returns `cost_credits`; `balance.remaining_credits: null` |

**Endpoint sequence:** (identity) `GET /api/v1/auth/ping` for `remaining_credits`;
compute cost locally; (anonymous) count local credits, no Worker call.

**User sees:** one line — *"This 1.4 GB transfer costs ~210 credits (≈ £0.12 at
today's reference rate). Your pool has ~4,800 credits — plenty."* No table unless
comparing options.

### 2.3 `refueler_send_file`

The core tool. **Encryption happens inside this tool, in the agent's process.** The
Worker receives ciphertext chunks only. Returns a share URL whose fragment carries
the AES-GCM key, the **real filename**, and `seal_nonce` if permanent record — the
fragment is never transmitted to the Worker (§7.2 fragment grammar).

**Input:**
```
{
  "file_path": <string>,              // required — local path in the agent's trust domain
  "recipient_hint": <string>,         // optional — agent's own prose only, never sent
  "passphrase": <string>,             // optional — enables NUT-11 P2SH access gating (recommended A→external)
  "destroy_after_download": <boolean>,// optional — "destroy after download" (locked UI vocabulary)
  "available_from": <unix_secs>,      // optional — tidal window open (paid tiers)
  "available_until": <unix_secs>,     // optional — tidal window close (paid tiers)
  "permanent_record": <boolean>,      // optional — Bitcoin-anchored existence proof (Sovereign/API opt-in)
  "transfer_ref": <string>            // optional — client attribution, ≤128 chars, logged to AE only
}
```

**Output (success):**
```
{
  "uuid": <uuid>,
  "share_url": "https://share.refueler.io/#<fragment>",   // fragment = key + filename (+ seal_nonce); NEVER sent to Worker
  "passphrase_required": <boolean>,
  "expires_at": <unix_secs>,
  "size_bytes": <integer>,
  "cost_credits": <integer>,          // what this send actually spent
  "collection_receipt_available": true
}
```

**Output (errors):**

| Case | Worker status | Envelope |
|---|---|---|
| Payment required, identity pool exhausted **and** overage ceiling reached | 402 | `{ "error": "payment_required", "code": "overage_ceiling", "remaining_credits": 0, "payment": <§2.5> }` |
| Payment required, Personal API pool exhausted (hard stop, no overage) | 402 | `{ "error": "payment_required", "code": "quota_exhausted", "remaining_credits": 0, "payment": <§2.5> }` |
| Payment required, account cancelled and period ended | 402 | `{ "error": "payment_required", "code": "account_cancelled", "payment": <§2.5> }` |
| Payment required, anonymous stack empty / credit invalid | 402 / 400 | `{ "error": "payment_required", "code": "credit_invalid", "payment": <§2.5> }` |
| Auth failed (bad HMAC / sign key) | 401 | `{ "error": "auth_failed", "detail": <string> }` |
| MIME denied (execution-capable denylist) | 415 | `{ "error": "file_type_denied", "detail": <mime> }` |
| Missing required manifest headers (internal bug) | 400 | `{ "error": "upload_rejected", "detail": <string> }` |
| Chunk hash mismatch (BLAKE3) | 400 | `{ "error": "integrity_failed", "chunk": <n> }` — retries the chunk, then aborts |
| Transfer already complete on resume | 409 | `{ "error": "already_complete", "uuid": <uuid> }` |

> Note the identity-API 402 is now `overage_ceiling`, **not** `quota_exhausted`.
> Under the allocation model (§2.4/§7.4) exhaustion of the monthly allocation no
> longer stops a firm — it meters into overage. Only the overage *ceiling* stops it.

**Endpoint sequence (the E2E send):**

1. **Local, in agent trust domain:** read file → chunk at 8 MiB → generate AES-GCM
   session key (`crypto.getRandomValues`) → encrypt each chunk (AAD = 4-byte
   big-endian chunk index) → BLAKE3-hash each ciphertext chunk + roll the root. If
   `permanent_record`, capture the BLAKE3 **plaintext** root and generate a 16-byte
   `seal_nonce`. **Nothing has touched the network yet.**
2. Generate a NUT-00 blinded message locally.
3. `POST /api/v1/credential/issue` with HMAC headers + (anonymous) `X-Cashu-Token`.
   **This is the only spend.** On 402 → return the `payment_required` envelope (§2.5)
   and stop — no chunk has uploaded, no partial spend.
4. Unblind locally → `credential`.
5. For each chunk `i`: `PUT /upload/{uuid}/{NNNN}`. Chunk `0000` carries manifest
   headers: `X-Cashu-Credential`, `X-Credential-Commitment`, `X-Issued-Tier`,
   `X-Total-Chunks`, `X-Total-Bytes`, `X-Expiry-Timestamp`,
   **`X-File-Name: "encrypted-payload"` (constant placeholder — real name is in the
   fragment, see D-1/§7.2)**, `X-Blake3-Root`; per-chunk `X-Blake3-Chunk-Hash`;
   optional `X-P2SH-Secret-Hash` (from `passphrase`, see §4.B), `X-Destroy-After-Download`,
   `X-Available-From`, `X-Available-Until`; API-tier `X-Api-Live-Key` + `X-Transfer-Ref`.
6. Manifest auto-written by the Worker after the final chunk. No separate manifest PUT.
7. Assemble `share_url` locally: base URL + `#` + fragment (§7.2: AES key + real
   filename + `seal_nonce` if permanent record). Return.

**User sees:** a short progress line, the share link, and — if a passphrase was set
— an explicit instruction to send the passphrase **by a separate channel**. Example:
*"Sent. Link: https://share.refueler.io/#… — expires in 7 days. Give the recipient
this passphrase on a separate channel: `<passphrase>`. I'll have a collection
receipt once they download it."*

### 2.4 Identity-rail allocation, restated for the tool

The identity-API pool is no longer a bare decrementing balance. It is a **monthly
allocation with a hard reset** (full mechanics locked in §7.4):

- **Included:** 50,000 credits/month (identity-API, £99/mo) — resets each billing
  period, **unused credits expire** (no rollover).
- **Overage (identity-API only):** past the allocation, sends meter at rate card
  v1.0 into `overage_credits` up to an **overage ceiling** (default 50,000 overage
  credits/period; per-client at onboarding). The transfer proceeds; realistic
  overage is pennies. Only the ceiling produces a 402 (`overage_ceiling`).
- **Personal API (£49/mo, 10,000 credits/month):** **hard stop** at allocation —
  no overage. Exhaustion returns 402 `quota_exhausted`. Individuals never get a
  surprise overage bill.
- **Anonymous rail:** no allocation, no reset, no server balance — the balance *is*
  the client-held stack (§2.6, §3).

`refueler_quote` / `refueler_balance` read `remaining_credits` and, for identity,
`period_end` so the agent can warn before a reset boundary or a ceiling.

### 2.5 The `payment_required` envelope (MCP-level)

```
{
  "error": "payment_required",
  "code": "overage_ceiling" | "quota_exhausted" | "account_cancelled" | "credit_invalid",
  "rail": "identity" | "anonymous",
  "shortfall_credits": <integer>,
  "payment": {
    "method": "out_of_band_v1",
    "instructions": "identity: request a credit top-up (or wait for your monthly reset) from your Refueler account. anonymous: buy a credit block on the dashboard and add the credits to this MCP's local config.",
    "dashboard_url": "https://refueler.io/share/",
    "offer": null            // reserved for BOLT12 offer — B9+, always null in v1
  }
}
```

`payment.offer` is **reserved now, populated never in v1** — the seam through which
BOLT12/phoenixd inline payment lands at B9+. The credit-issuance contract already
accepts arbitrary-amount pay-then-mint, so no schema break is needed. **Document,
do not build.** Every user-facing string here is in credits — no sats, no ecash.

### 2.6 Included / evaluated tools

| Tool | Decision | Rationale |
|---|---|---|
| `refueler_balance` | **Include (v1)** | Identity: `auth/ping` returns `remaining_credits` (+ `allocation_credits`, `period_end`) — a real server answer, `kind: "credit_pool"`, `server_blind: false`. Anonymous: counts the **local credit stack**, `kind: "local_credits"`, `server_blind: true` — the server is blind to it. Locked user copy (O-4/decision 9): *"You hold ~<N> credits locally — the server can't see this balance."* / *"Your pool has ~<N> credits left this period (resets <date>)."* Overlaps `quote.balance` but keep both: `balance` = "how much do I have", `quote` = "what will this cost." |
| `refueler_receive` | **Defer (v2)** | A standing receive link with no prior send is a Silent Drop inbox. SD-block not shipped; gates on B8 + NB-4. Reserve the name. |
| `refueler_status` | **Fold in** | Per-transfer status is what `refueler_check_transfer` answers via receipts + derived `state`. No separate status endpoint; do not ship as a distinct tool. |

### 2.7 `refueler_check_transfer`

Pulls stored HMAC-signed receipts. **Collection receipt** (never "proof of
delivery") confirms the ciphertext was *served* to a downloader — it does not prove
human receipt, authorship, or truth.

**Input:** `{ "uuid": <uuid>, "type": "acceptance" | "collection" | "both" }` (default `"both"`).

**Output (success):**
```
{
  "uuid": <uuid>,
  "acceptance": { "receipt": <json>, "sig": <hmac_hex> } | null,
  "collection": { "receipt": <json>, "sig": <hmac_hex> } | null,
  "state": "uploaded" | "collected" | "expired" | "unknown"
}
```
`collection: null` means "not yet collected" — an honest not-yet, never an error.

**Output (errors):** `auth_failed`; `not_found` (7-day receipt TTL); `rate_limited`.

**User sees:** *"Collected — signed collection receipt timestamped 14:22 UTC."* or
*"Not collected yet; the link is live until Thursday."* Never "delivered".

---

## 3. Payment Architecture

### 3.1 The two rails, restated for agents

- **Identity rail** — a server-held recovering credit pool keyed to the HMAC
  credentials (`api_quota_{sha256(rfs_live_key)}` in KV). Monthly allocation, hard
  reset, metered overage (identity-API) or hard stop (Personal API). Recoverable,
  invoiceable, auditable. **The demoable rail today.**
- **Anonymous rail** — a **client-held stack of blind-signed capability-atom
  credits** (ecash — *internal term only*; user-facing is "credits stored locally").
  The MCP server holds the stack locally in the agent's trust domain. Each send
  presents one credit via `X-Cashu-Token`; the Worker verifies against the API
  keyset, double-spend-checks, marks spent, issues the credential. **The server
  never holds the balance — the balance is the stack.** Credit *issuance* gates on B7.

### 3.2 How an agent spends without friction

- **Identity rail:** the pool is pre-funded out-of-band; the agent calls
  `credential/issue`; the decrement is invisible. `refueler_balance` / `refueler_quote`
  warn before the pool runs dry or a period rolls. Zero inline friction. **v1 happy path.**
- **Anonymous rail:** the human tops up out-of-band (buys a credit block via
  Lightning on the dashboard — **B7**) and places the credits into the MCP server's
  local config (**files always placed manually by the operator — never a `cp` from
  Claude**). The agent spends one credit per send; when the stack is thin it surfaces
  a top-up prompt but cannot itself buy more in v1.

### 3.3 What the Worker can see — and never see

**Can see:** ciphertext chunks; per-chunk and root **BLAKE3 hashes** (of ciphertext);
byte counts; `uuid`; credential `commitment`; `expiry`; the declared Content-Type at
the upload boundary (checked against an execution-capable denylist, **never stored**);
the `X-P2SH-Secret-Hash` (a hash, not the passphrase); API-tier `rfs_live_` handle +
`transfer_ref`.

**Never sees:** plaintext bytes; the AES-GCM key; the passphrase; the `seal_nonce` or
plaintext BLAKE3 root (client-side only); on the anonymous rail, any identity, email,
or Supabase row (invariant).

**Filename — the D-1 caveat, scoped to build state:**
- **Today (pre-SW-MCP-4):** `X-File-Name` reaches the Worker in plaintext and is
  stored in the manifest. **The filename is visible to the Worker.** The only correct
  claim is *"the Worker holds ciphertext and metadata including the filename."*
- **After SW-MCP-4 (D-1 fix, Option B — §7.2):** the send tool and the consumer
  frontend send a **constant placeholder** `X-File-Name`, and carry the real filename
  in the URL fragment. **The Worker never sees the filename — not even ciphertext.**
  The claim upgrades to *"the Worker holds ciphertext and size/hash metadata, and
  never the filename."* Do not make the stronger claim until SW-MCP-4 has shipped
  **and** the consumer patch is deployed.

### 3.4 Why this is legally defensible for cross-company transfer

The readable artefact only ever exists inside each company's own trust domain, so
Refueler is a **blind byte-relay**: it cannot produce plaintext under compulsion
because it never held the key; on the anonymous rail there is no identity to disclose.
An architectural property, not a policy promise — which is what makes it defensible.
State it as *"we cannot read your files, and on the anonymous rail we do not know who
you are"* — scoped by the filename caveat above until D-1 lands.

---

## 4. Use Case Matrix

### A. Solo Claude user → external recipient (no Claude/MCP)

Sender's agent runs `refueler_send_file` (identity rail). Encryption + chunking
local; ciphertext to R2; returns `share_url` with key **and filename** in the
fragment. Recipient opens the link **in a browser** — the Share web frontend
decrypts client-side and saves under the fragment-carried filename. If a passphrase
was set (recommended here), the agent tells the user to pass it to the recipient on
a separate channel. Acceptance receipt immediately; collection receipt on download.
**Fully buildable on v1.**

### B. Two Claude users, different companies, agent-to-agent

**v1 reality:** this is scenario A with a machine recipient. The sender's agent
produces `share_url` (fragment = key + filename) and, if gated, the P2SH secret-hash;
those go to the recipient's agent through the channel the two parties already share;
the recipient's agent fetches ciphertext and decrypts locally using the fragment.
There is **no standing inbox** in v1 — the recipient cannot publish "send to me"
without a link first existing. A true standing inbox is `refueler_receive` / Silent
Drop — **v2, gate: SD provisioning live.** Say so plainly.

**Agent-to-agent passphrase protocol (O-5 / decision 10 — locked):**
1. The sending agent computes, **locally**, the exact value the Worker expects as
   `X-P2SH-Secret-Hash` — i.e. the output of the same `hashSecret()` construction the
   frontend uses (SHA-256-based per the repo lock). It never transmits the
   human-readable passphrase.
2. It sends that hash to the receiving agent **on a channel separate from the
   `share_url`** — never in the same message as the link. (The fragment already
   carries the decryption key; the passphrase-hash is a *second factor* the Worker
   enforces at download. Bundling both in one message defeats the point.)
3. The receiving agent presents the same hash to unlock the download, then uses the
   fragment key to decrypt.

> **Parity requirement (build, SW-MCP-2):** the MCP's local hash **must** be
> byte-identical to `hashSecret()` in `nut11.js`. Decision 10's "SHA-256 of the
> passphrase" is exact **only if** `hashSecret()` is bare `SHA-256(utf8(passphrase))`
> with no domain tag or salt. If it carries a domain separator, the MCP must
> replicate that construction exactly. Verify against `nut11.js` before shipping —
> do not assume bare SHA-256.

With the D-1 fix live, in Use Case B the Worker sees **neither** the filename **nor**
the passphrase — both travel only in the client-only channel.

### C. Firm wants agent / MCP access (O-2 — RESOLVED, locked decision 7)

**Sovereign Teams stays UI-only. `Sovereign ⊅ API` is locked, and the MCP tools are
API-tier only** — so "a Teams subscriber sends via MCP from the shared pool" is **not
buildable and not offered.** The coherent resolution:

> A firm that wants agent or MCP access takes a **separate API credential
> relationship** alongside (or instead of) Teams — two products, one customer. **The
> firm runs its own MCP server**, which handles internal credit distribution across
> its people and agents. **Refueler sees one API key and one credit pool** — never the
> firm's internal seat structure. This keeps `Sovereign ⊅ API` intact (Sovereign
> Teams remains a UI product) while giving firms a clean, auditable agent path.

**Sales / spec wording (locked):** *"Sovereign Teams is a shared-pool web product for
people. Agent and MCP access is a separate API relationship: you run the MCP server in
your own infrastructure, distribute credits internally however you like, and Refueler
sees a single key and a single pool."* Do not put Teams pricing and API pricing in
direct comparison (different pages, different buyers).

### D. API client's agent — programmatic, identity rail, webhook receipt

The fully-supported v1 path. Agent holds HMAC creds + a funded pool. Send via
`refueler_send_file`; issuance decrements the allocation (then meters into overage for
identity-API). Chunk upload carries `X-Api-Live-Key` + `X-Transfer-Ref`. The client's
registered webhook fires `cargo.accepted` at manifest-write and `cargo.discharged` at
collection, each signed `X-Refueler-Signature: t=…,v1=…`. Webhooks are **notification,
never control flow** — the transfer completes whether or not the endpoint is up; the
DLQ retries daily. `refueler_check_transfer` is the pull fallback. **Fully buildable
on v1.**

### E. Personal Sovereign API (unlisted — O-7, new)

A technically-minded Sovereign individual who wants MCP/API access takes the
**unlisted Personal API path** — not on the public pricing page, discoverable only by
asking or via an AM conversation. Same credential structure as the identity-rail API;
billed by card (Stripe), identity rail. Pricing/allocation locked in §7.5. In use it
is Use Case D with a smaller allocation, a hard stop instead of overage, no webhook,
and no AM. **Designed; requires the `personal_api` plan value (SW-MCP-W2).**

---

## 5. Pitch Copy

Anthropic marketplace pitch **removed entirely** (scrapped, decision 2). Honesty
banner (what's live vs designed) is retained above.

### 5.1 Teams pitch — two sentences (23 September event)

> Refueler Share is Bitcoin-native encrypted file transfer where our server only ever
> holds ciphertext — we cannot read your files, and on the anonymous rail we never
> learn who you are. Your team shares one prepaid pool and one bill, every chunk is
> verified with BLAKE3, and access is granted by cryptographic capability rather than
> accounts and passwords.

*(Honest: Teams is a UI product; no MCP claim is made here. No "sats", no "ecash", no
"tokens", no "zero-knowledge", no "military-grade", no "proof of delivery".)*

### 5.2 Direct / developer pitch — one paragraph (refueler.io + AM conversations)

> Refueler Share gives an agent a privacy-first file-transfer capability that runs
> entirely in the agent's own trust domain: files are chunked, encrypted, and
> BLAKE3-hashed locally before anything touches the network, so the Refueler Worker
> relays ciphertext it cannot read and — on the anonymous rail — cannot tie to an
> identity. The v1 toolset (`refueler_capabilities`, `refueler_quote`,
> `refueler_send_file`, `refueler_check_transfer`) lets an agent price a transfer,
> send a file to any recipient with a browser, and pull a signed collection receipt
> when it's collected, paying from a prepaid pool of Share credits. You run the server
> yourself — it's an open-source npm package under Apache 2.0, so your team can audit
> exactly what it does, and Refueler never sees your keys or your plaintext. Standing
> agent-to-agent inboxes and inline Lightning payment are on the roadmap, not in this
> release — what ships is the send path, honestly scoped.

*(Honest: MCP server does not exist yet; anonymous-rail credit purchase gates on B7;
standing inbox gates on Silent Drop. "Credits", never "sats/ecash/tokens".)*

---

## 6. Build Sequence

### 6.0 Sequence placement (confirmed)

`SW9 → SW-MCP → B8 → NB-2/NB-4 → B7 → SD-block`. The **SW-MCP block sits immediately
after SW9**; B8 (NUT-11 Mode 2) follows. Two nuances stated plainly:
- The MCP block's **B7-gated tail** (SW-MCP-7 anonymous send, and any anonymous
  feature) completes **later**, when B7/NB-4 land — it does not block B8. Everything
  else in the block ships before B8.
- The **23-Sep demo needs neither SW-MCP-W2 (allocation/reset) nor the overage
  ceiling** — a manually pre-funded pool suffices. W2 can land after the demo,
  shortening the critical path.

### 6.1 Minimum viable MCP demo for 23 September (identity rail, pre-funded pool)

Genuinely live post-SW9 + SW-MCP-W1:
- `refueler_capabilities` — real `GET /api/v1/capabilities` (locked shape).
- `refueler_quote` — local rate-card maths + `auth/ping` for pool balance.
- `refueler_send_file` — **real** local encryption + chunk upload → **real**
  `share_url` that decrypts in a real browser.
- `refueler_check_transfer` — real acceptance + collection receipts.

A truthful end-to-end live demo. **On stage, say:** the anonymous rail and Lightning
top-up are designed and coming, not shown live; the filename fix ships in SW-MCP-4.

### 6.2 What gates on B7, what builds before

- **Before B7:** the whole MCP scaffold; local encryption/chunking/BLAKE3 module;
  all four tools on the **identity rail**; capabilities + quote; receipts; the
  `payment_required` envelope with `offer: null`; the D-1 filename fix.
- **Gates on B7 (NB-4):** anonymous-rail credit-block top-up, therefore live
  anonymous-rail sends through the MCP.
- **Gates on B9+:** inline agent payment (`payment.offer` populated).
- **Gates on SD:** `refueler_receive` standing inbox / true agent-to-agent.

### 6.3 Session plan — SW-MCP block

Two **Worker-contract** sessions land first (they implement §7), then the MCP client
sessions. "Split early, never overload."

| Session | Scope | Gate |
|---|---|---|
| **SW-MCP-W1** | **Worker:** emit the locked `GET /api/v1/capabilities` shape (§7.1); implement the daily reference-rate KV (`btc_ref_rate:current`, §7.3) with Tier-1 manual override + 3am CoinGecko fallback cron + ±20% guard; admin-dashboard rate panel. | SW9 deployed |
| **SW-MCP-W2** | **Worker:** monthly allocation + lazy reset (§7.4); identity-API overage ceiling; Personal-API hard stop; `personal_api` plan value in the KV client record + quota record shape (§7.5); cancellation semantics (§7.4). | SW-MCP-W1 |
| **SW-MCP-1** | MCP server scaffold in agent trust domain; transport + config; local key/credit storage model; `refueler_capabilities` wired to the now-correct endpoint. | SW-MCP-W1 |
| **SW-MCP-2** | Local crypto module: chunk → AES-GCM → BLAKE3 → blinded; **parity with `frontend/upload.js` + `crypto.js`**; **fragment-format v1 helper (§7.2 assemble/parse), shared with the consumer patch**; **`hashSecret()` parity check (§4.B)**; unit tests. | SW-MCP-1 |
| **SW-MCP-3** | `refueler_quote` + `refueler_balance` (identity via `auth/ping`; anonymous local count); rate-card cache + degrade; credits vocabulary. | SW-MCP-2 |
| **SW-MCP-4** | `refueler_send_file` E2E, identity rail; full error matrix incl. `payment_required`/`overage_ceiling`; **D-1 filename fix (Option B, §7.2) shipped for BOTH the MCP send tool AND the consumer frontend** (`upload.js` assemble + `download.js` parse + `crypto.js` fragment helpers, synced via `bin/sync-share.sh`). | SW-MCP-2 (overage semantics: SW-MCP-W2) |
| **SW-MCP-5** | `refueler_check_transfer` (acceptance/collection); state derivation; optional single re-check. | SW-MCP-4 |
| **SW-MCP-6** | 23-Sep demo hardening: scripted happy path, failure-mode rehearsal, on-stage honesty script. | SW-MCP-5 |
| **SW-MCP-7** | Anonymous-rail send through the MCP (credit-block spend). | **B7 / NB-4** |
| **SW-MCP-8** | Distribution: **npm package**, Apache 2.0, operator installs into own infrastructure; config via local `.env`/secrets manager — **never a `cp` from Claude**; trust-boundary README ("this server runs in your infrastructure; Refueler never sees your keys or plaintext"). **No Anthropic marketplace.** | SW-MCP-5 |

---

## 7. Worker contracts locked this session (build reference)

Everything a build session needs in one place. §7.1 is the capabilities contract;
§7.2 the fragment/filename fix; §7.3 the reference-rate KV; §7.4 the allocation/reset
mechanics; §7.5 the Personal API path.

### 7.1 `GET /api/v1/capabilities` — locked response (O-6)

Unauthenticated, free. `Cache-Control: public, max-age=60` (rate freshness within
60s is fine for a *reference* display; consumers judge staleness from the embedded
`last_updated` + `stale`). Two version fields: `schema_version` (bump on shape change)
and `rate_card_version` (bump on price change).

```
{
  "service": "refueler-share",
  "schema_version": "cap.v1",
  "rate_card_version": "v1.0",
  "credit_unit": "sat",                       // 1 credit == 1 sat, internal canonical unit
  "rails_available": ["identity"],            // LIVE state — "anonymous" appears only post-B7/NB-4
  "features": {
    "send_file": true,
    "collection_receipt": true,
    "permanent_record": true,                 // Sovereign/API opt-in
    "agent_to_agent_inbox": false,            // gates on Silent Drop
    "inline_payment": false                   // gates on B9+
  },
  "rate_card": {                              // integers are CREDITS (== sats); never emit "sat" in a value
    "transfer": 10,
    "per_gb": 100,
    "permanent_record": 20,
    "capability_discovery": 0,
    "ots_webhook": 0
  },
  "daily_reference_rate": {                   // display only; see §7.3. null-able as a block if absent
    "gbp_per_btc": 89000,                     // ILLUSTRATIVE — actual value is whatever KV last held
    "source": "manual",                       // manual | auto_coingecko | node
    "last_updated": 1757500000,               // unix secs
    "stale": false                            // derived: now - last_updated > tier threshold
  },
  "limits": {
    "max_transfer_bytes": 250000000000,       // 250 GB (decimal, aligned to the ÷1e9 cost formula) — API-tier per-transfer cap
    "chunk_bytes": 8388608,                   // 8 MiB recommended chunk size
    "max_chunk_bytes": 10485760               // 10 MiB server hard cap (S39)
  }
}
```

Notes locked:
- **`rails_available` reflects live state**, not aspiration. Ship `["identity"]`; add
  `"anonymous"` only when credit-block issuance is live.
- The endpoint exposes **only** the floating `daily_reference_rate`. The **fixed GBP
  invoicing peg (£50k, frozen at rate-card publication)** is a back-office constant,
  **not** on this endpoint — keeping the two GBP numbers from ever being conflated.
- Corrected from v1: `max_transfer_bytes` is decimal GB (250,000,000,000), matching
  the cost formula's `÷ 1_000_000_000`. v1 mixed GiB here with decimal-GB pricing.

### 7.2 Fragment grammar + filename fix (D-1 / O-10 — Option B locked)

**Decision: Option B — real filename in the URL fragment; opaque placeholder to the
Worker.** Chosen over A (filename inside the encrypted payload) and C (ciphertext
filename in the manifest) because:
1. The fragment is *already* the client-only channel that never reaches the Worker —
   B extends an existing invariant instead of inventing a new one. "Everything the
   Worker must never see lives in the fragment" becomes one teachable rule.
2. Smallest blast radius: no change to chunk plaintext framing, **no entanglement
   with the BLAKE3 plaintext root / permanent-record commitment**, no streaming-download
   header parsing. (Option A would have folded the filename into plaintext and thus
   into the permanent-record hash — avoided.)
3. Strongest honest claim: the Worker sees **no filename at all**, not even ciphertext.
4. The "fragment gets longer" cost is negligible — filenames are a few hundred bytes;
   fragments are never sent to a server and have no practical length limit.

**Fragment grammar v1 (locked):** a single opaque, versioned, base64url-encoded JSON
blob.
```
fragment = base64url( utf8( JSON.stringify({
  "v": 1,
  "k": "<base64url of the raw AES-GCM key bytes>",
  "n": "<real filename, a plain JSON string — JSON handles unicode>",
  "s": "<base64url of the 16-byte seal_nonce>"   // present ONLY for permanent-record transfers
}) ) )
```
- **Send / upload (MCP send tool AND consumer `upload.js`):** build the blob above;
  send `X-File-Name: "encrypted-payload"` (a **constant** placeholder — not random;
  random only adds entropy the Worker would log for no gain) to the Worker. The
  manifest stores the placeholder.
- **Download / decrypt (consumer `download.js`, and any future MCP receive):**
  base64url-decode → `JSON.parse` → read `k`, `n`, `s`. Decrypt with `k`; save under
  `n`; **never** trust the Worker's stored `X-File-Name`.
- **Legacy links:** during the ≤90-day window before all pre-fix links expire,
  `download.js` attempts new-format parse first (base64url→JSON with `v`); on failure
  it falls back to the legacy raw-key fragment path. Remove the fallback once the
  longest possible legacy link (90-day) has expired.
- **MIME/denylist unaffected:** the execution-capable denylist checks the declared
  **Content-Type** at the upload boundary, not the filename extension — moving the
  filename out of the Worker's sight changes nothing there.
- **Applies to both surfaces in the same session (decision 11):** SW-MCP-4 ships the
  MCP send tool and the consumer patch together; sync shared assets via
  `bin/sync-share.sh`.

### 7.3 Daily reference-rate KV (O-8 — locked)

**Key:** `btc_ref_rate:current` in `STATUS_KV` (colon-`current` pattern, matching
`hostname_health:latest`).

**Value:**
```
{
  "gbp_per_btc": 89000,          // integer GBP per 1 BTC
  "source": "manual",            // manual | auto_coingecko | node
  "last_updated": 1757500000,    // unix secs
  "set_by": "admin:rajesh",      // manual: admin label; auto: "cron"; node: "price_feed"
  "previous": 88000              // display sugar for the admin panel; the ±20% guard compares against the live value at write time, not this
}
```

**TTL: none (persistent key).** A TTL here is a footgun — losing the rate is worse
than serving a marked-stale one. **Staleness is derived** from `last_updated`, not
from key existence. (Tier-1 threshold: `stale = now - last_updated > 26h`, so a single
missed 3am cron does not instantly flag; Tier-2: `> 30min`. Thresholds are build
knobs; these are the proposed defaults.)

**Two tiers, one schema:**
- **Tier 1 (pre-node):** admin manual override at any time. If no manual update in
  24h, a **3am cron** fetches CoinGecko and writes. **±20% guard:** reject a candidate
  more than ±20% from the current stored value; log to AE; leave last-good in place.
- **Tier 2 (post-node, B7+):** **15-minute cron** from the node price feed; manual
  override stays; CoinGecko becomes the fallback if the node is unreachable. Only the
  cron cadence and `source` values change — the schema is identical.

**Served vs shown:**
- **Capabilities endpoint serves:** `{ gbp_per_btc, source, last_updated, stale }`
  (no `set_by`, no `previous` — minimise public surface).
- **Admin dashboard shows:** current rate, source, `last_updated` (human time),
  `set_by`, `previous`, staleness, plus a manual-override input and a "fetch now"
  action.

**Failure mode (CoinGecko unreachable **and** no manual override in 24h):** the record
persists with its last-good value and goes `stale: true` past the threshold.
Capabilities keeps serving last-good, flagged stale; the tool still shows credits but
drops or caveats the £ figure. **Credits are the unit of account; GBP is only ever a
reference display — a stale rate degrades a nicety, never billing, and never blocks a
transfer.** If the key is somehow absent entirely (cold start), capabilities emits
`daily_reference_rate: null` and the tool shows credits with no £ figure. Never invent
a rate.

### 7.4 Monthly credit allocation + reset (O-9 — locked)

**Key:** `api_quota_{sha256(rfs_live_key)}` in `STATUS_KV`.

**Value:**
```
{
  "plan": "identity_api",        // identity_api | personal_api  (anonymous rail has no record of this kind)
  "allocation": 50000,           // monthly included credits for this plan
  "remaining": 50000,            // decremented per issue; reset to allocation at rollover
  "overage_credits": 0,          // credits spent above allocation this period (identity_api only)
  "overage_ceiling": 50000,      // hard abuse ceiling; identity_api only; per-client at onboarding
  "period_start": 1757000000,    // unix secs — current period opened
  "period_end": 1759678400,      // unix secs — next reset boundary (billing anniversary)
  "status": "active",            // active | cancelled
  "updated_at": 1757500000
}
```

**Reset mechanism: lazy, on next `credential/issue` — no cron.** On each issue:
1. If `now >= period_end`: roll the period — `remaining = allocation`,
   `overage_credits = 0`, `period_start = period_end`, `period_end += 1 month`
   (billing anniversary, not calendar month — a mid-month signup gets a clean full
   first period). This is the **hard reset**: **unused credits expire, no rollover.**
2. Then apply this issue:
   - `identity_api`: if `remaining >= cost`, decrement. Else spend the remainder to 0
     and add the shortfall to `overage_credits`. If `overage_credits > overage_ceiling`
     → **402 `overage_ceiling`**, no issue.
   - `personal_api`: if `remaining >= cost`, decrement. Else → **402 `quota_exhausted`**
     (hard stop, no overage).

Lazy reset fits the existing KV model (no Durable Objects / D1 / Queues), handles
per-client anniversaries for free, and has no thundering-herd. It accepts KV's
last-write-wins for the quota (the race-critical path is double-spend, which already
lives in Supabase — unchanged).

**Cancellation (decision 5 — locked, two flavours):**
- **Cancel-at-period-end (default, Stripe portal behaviour):** set `status: "cancelled"`;
  **do not zero `remaining`** — the paid period runs to `period_end`, then does **not**
  reset. After `period_end`: `remaining = 0`, no allocation, `credential/issue` → 402
  `account_cancelled`.
- **Immediate cancellation (admin-initiated: abuse / refund):** `status: "cancelled"`,
  `remaining = 0` at once → 402 `account_cancelled` immediately.
- **In every case:** already-issued transfers **persist until their own
  `expiry_timestamp`** regardless of account status. A 90-day link issued before
  cancellation stays valid to its expiry. This is **explicit policy**, enforced at the
  transfer/manifest layer, independent of the quota record — not assumed behaviour.

### 7.5 Personal Sovereign API path (O-7 — locked)

Unlisted; discoverable only by asking or via an AM conversation. Not on the public
pricing page. Identity rail; billed by card (Stripe).

| Attribute | Personal API (locked) |
|---|---|
| **Price** | **£49/mo** (between Sovereign £24 and identity-API £99). Sits clearly above Sovereign, preserving `Sovereign ⊅ API` price-enforcement. |
| **Included allocation** | **10,000 credits/month** (≈ 98 GB at rate card v1.0) — same order of magnitude as Sovereign's 100 GB feel, delivered via API/MCP. Hard monthly reset (§7.4). |
| **Overage** | **None — hard stop** at allocation (402 `quota_exhausted`). Individuals never get a surprise overage bill. |
| **Credentials** | `rfs_live_` + `rfs_sign_` — same structure as identity-rail API. |
| **Tools** | Full v1 toolset: capabilities, quote, balance, send, check. Permanent-record opt-in included (Sovereign-adjacent). |
| **Webhooks (`rfs_whsec_`)** | **Not included** — poll receipts via `refueler_check_transfer`. Keeps the support surface small; differentiates from full API. |
| **Account Manager** | **No** — self-serve only. |
| **DPA** | **Not default** — available on request (an individual is rarely a data controller at scale). Contrast: identity-API firms get DPA mandatory by default. |
| **Invoice / PO path** | **No** — card (Stripe) or, if they later move to the anonymous rail, that's a *separate* relationship. Personal API itself is identity-rail/card. |
| **Billing** | Unlisted Stripe price (card, monthly), managed like the API tier — off-repo. |
| **KV plan value** | **`personal_api`** — recognised by the credential-issuance quota logic (§7.4). Requires a Worker change → **SW-MCP-W2**. |

> Cosmetic note: £49 equals the Teams-S band figure. Immaterial — different SKU,
> different page, different buyer, never compared. Flagged so no one is surprised by
> the coincidence.

---

## 8. Open decisions after this session

**No further Opus session is required before the SW-MCP block builds.** O-6…O-11 are
locked above; D-1 and O-2 are resolved. What remains is build-time detail:

| Item | Where | Nature |
|---|---|---|
| `hashSecret()` construction parity (bare SHA-256 vs domain-tagged) | SW-MCP-2 | Verify against `nut11.js`; replicate exactly. Build check, not a design decision. |
| Overage-ceiling default value (proposed 50,000 overage credits/period) | SW-MCP-W2 / onboarding | Commercial knob; per-client at onboarding. Default proposed; Rajesh sign-off at onboarding, not an Opus session. |
| Staleness thresholds (Tier-1 26h, Tier-2 30min) and capabilities `max-age` (60s) | SW-MCP-W1 | Proposed defaults; tune in build. |
| Legacy-fragment fallback removal date | post-SW-MCP-4 | Remove once the longest legacy (90-day) link has expired. |
| Anonymous-rail credit-block purchase UX through the MCP | SW-MCP-7 | Gates on B7/NB-4; design when the node is live. |

---

*Locked at Share-MCP-Opus-2. No code produced. "Nothing stops this train."*
