# merkle-spec-v1.md — refueler-share Merkle / MMR / SMT design lock

> **Session:** B9-Opus · 12 Sep 2026 · Opus · architecture + design, no code produced
> **Status:** locked spec. All seven decisions (D-1…D-7) resolved in-session.
> Load alongside `CLAUDE.md`, `Share-Master-Context.md`, `share-sessions.md`, `REFUELER-BRIDGE.md` (v9.3+).
> **Supersedes:** the forward notes in `REFUELER-BRIDGE.md` §Merkle tree primitives — those become "see `merkle-spec-v1.md`".
> **Overrides:** the CLAUDE.md constraint *"no BLAKE3 root in any receipt field — Merkle verification blocked until B9"* — narrowly, and only once B9-3 ships. See §2.

---

## 0. Honesty banner — read this before quoting anything from this file

This document designs Merkle-root verification, Merkle Mountain Ranges (MMR), Sparse
Merkle Trees (SMT), and a ZK boundary. **Almost none of it is live.** What is true on
12 Sep 2026, versus what this file merely *specifies*:

| Thing | State on 12 Sep 2026 |
|---|---|
| BLAKE3 **chunk-level** integrity on upload (400 on mismatch) | **Live** (S34, audited S42e) |
| OTS existence-proof relay (`POST /timestamp/submit`) | **Live** (TH-1) |
| Per-chunk ciphertext BLAKE3 hashes computed and verified on upload | **Live** — but **not persisted as an ordered array**; verified transiently |
| **Merkle root** assembled from stored chunk hashes and checked on download | **Not built.** Primary B9 build target (B9-1…B9-3) |
| `merkle_root` in `manifest.json` + `{uuid}/hashes` sidecar object | **Not built** (B9-2) |
| Download-time verify-then-flush + 409 on mismatch | **Not built** (B9-3) |
| `merkle_root` / `verified` fields in receipts | **Not built, and barred until B9-3 is green** (B9-4) |
| Reverse MMR (policyholder-owned payment history) | **Design only.** Thought experiment, not a product (B9-5/B9-6) |
| MMR published root via OTS relay | **Design only, opt-in** (B9-6) |
| SMT public exclusion proof for double-spend | **Design only.** Complement, not replacement; no build slot without a design partner |
| ZK Merkle proofs (Pass membership, B2B batch compliance) | **Whitepaper §Future work.** No build slot |

**Permanently banned phrases (carried + extended):** never *"end-to-end file integrity"*
(say **chunk integrity** today; **ciphertext storage integrity** after B9-3; end-to-end is
the *recipient's* plaintext check, never the Worker's); never *"proof of delivery"* (use
**collection receipt**); never *"zero-knowledge"* as a headline; never *"military-grade"*;
never *"audit-certified"*; never *"smart contract"* for what is in fact OTS Bitcoin anchoring
(§4).

**The load-bearing distinction this whole file rests on — two roots, never conflate:**

- **Ciphertext-chunk Merkle root** (`merkle_root`, new). Over the per-chunk BLAKE3 digests
  of the **stored ciphertext**. The **Worker can verify this** because the Worker sees
  ciphertext. Attests: *the encrypted object collected equals the encrypted object stored.*
- **Plaintext BLAKE3 root** (`blake3PlaintextRoot`, exists — TH-2). Over the **plaintext**.
  Client-side only; **never enters the Worker; never enters a receipt.** The **recipient**
  recomputes it after decrypt and compares against the value in the share-link fragment.
  This — and only this — is the honest **end-to-end** integrity check.

The Worker's Merkle verification is a *storage-integrity* defence. End-to-end integrity is a
*recipient-side* check the Worker never participates in and cannot forge. Every claim in this
file is scoped to that line.

---

## 1. D-1 — Tree construction (LOCKED)

Binary Merkle tree over `N` BLAKE3 chunk digests, where leaf `i` = the BLAKE3-256 digest of
the **stored ciphertext** of chunk `i` (nonce ‖ ciphertext ‖ GCM tag, exactly the bytes in
`{uuid}/{iiii}`).

- **Node hash: BLAKE3.** Keeps BLAKE3 in its lane (three hashes, three jobs). No new primitive.
- **Domain separation (RFC 6962 style, defeats the leaf/node ambiguity attack):**
  - `leaf_hash  = BLAKE3(0x00 ‖ chunk_ciphertext_digest_i)`
  - `node_hash  = BLAKE3(0x01 ‖ left ‖ right)`
- **Padding: none. RFC 6962 unbalanced tree.** For odd node counts at any level, the last node
  is **promoted unchanged** to the next level. Bitcoin-style duplicate-last-leaf is **rejected**
  (CVE-2012-2459 malleability). Zero-pad rejected (ambiguous). `N` (= `chunk_count`) is committed
  in the manifest, which closes the residual ambiguity.
- **Leaf ordering: sequential chunk index, big-endian** — identical convention to the existing
  4-byte BE `uint32` AAD (`DataView.setUint32(0, i, false)`) and the `{uuid}/{0000}` R2 key.
- **Computed both client-side and server-side:**
  - **Client, at upload** = authoritative. The client computes `merkle_root`; it is the root of
    truth and is written into `manifest.json`.
  - **Worker, at download** = verification only. The Worker *reconstructs* the root from stored
    hashes and compares. The Worker never mints the authoritative root (a fresh Worker-computed
    root over tampered data would self-certify — worthless).
- **Interoperability constraint satisfied:** a third party given only `[chunk_ciphertext_digest_0…N-1]`
  and `N` reproduces `merkle_root` exactly. Domain tags fixed (`0x00`/`0x01`), unbalanced-promotion
  rule fixed, big-endian order fixed, BLAKE3 node hash fixed. No proprietary step.

**Version string:** `tree_algo: "rfc6962-unbalanced-blake3-v1"`. Pinned. Any change is a new version,
never an in-place edit.

---

## 2. D-2 — Root placement (LOCKED: both) + explicit override

- **`manifest.json` gains:** `merkle_root` (base64url of 32 bytes), `chunk_count` (exists),
  `tree_algo` (§1). This is the Worker's verification input.
- **Receipts gain (once B9-3 is green — not before):**
  - Acceptance receipt (`cargo.accepted`): `merkle_root`. Attests *"we hold N chunks totalling B
    bytes, committing to this ciphertext root."*
  - Collection receipt (`cargo.discharged`): `merkle_root` **and** `verified: true|false` — the
    result of the Worker's download-time reconstruction (§3).
- **Fragment (`r` field) — recommended, flagged, not hard-locked here.** Adding the ciphertext
  root to the share-link fragment lets the recipient detect a Worker that rewrote the manifest.
  Cheap (one 32-byte base64url field beside `{v,k,n,s}`). **Owner of fragment grammar = SW-MCP-4;
  confirm `r` there before shipping** rather than mutating the grammar unilaterally in B9.

**Explicit override of the standing constraint.** `CLAUDE.md` and `share-sessions.md` §SW carry
*"DO NOT add BLAKE3 root to any receipt field — Merkle verification blocked until B9."* This
decision **lifts that constraint narrowly**:

- Lifted **only** for the **ciphertext-chunk `merkle_root`**, and **only** once the download-time
  reconstruction path (B9-3) is live and green. Until B9-3 ships, receipts carry no root.
- **Not lifted** for the **plaintext `blake3PlaintextRoot`**, which remains **permanently barred**
  from every receipt and from the Worker. Putting a plaintext root in a receipt would falsely
  imply the Worker verified plaintext. That prohibition is now *permanent*, not "until B9".

So the do-not-retry does not disappear — it **splits**: ciphertext root allowed post-B9-3;
plaintext root barred forever.

**Rationale (both):** manifest root = live-path working copy (verification). Receipt root = client
keepsake evidence, re-checkable months later. Different audiences, different lifetimes — same
discipline as the SW5 manifest-vs-receipt split.

---

## 3. D-3 — Worker reassembly verification path (LOCKED)

**Where chunk hashes live (decision):** today they are received per-chunk on upload and verified
transiently — **not** stored as a reconstructable array. B9-2 adds a **sidecar R2 object
`{uuid}/hashes`**: the raw concatenation of the `N` 32-byte ciphertext digests, in chunk order.
One object, one GET. The manifest holds only `merkle_root` + `chunk_count` + `tree_algo`.

- **Rejected:** hashes inline in the manifest (1,280 × 32 B ≈ 40 KB raw, ~55 KB base64 — collides
  with the locked 64 KB `safeGetManifest()` ceiling for large files). **Rejected:** hashes in KV
  (duplicates R2, value-size pressure). **Rejected:** per-chunk R2 metadata (forces N HEADs).

**Verification sequence (download-token redemption, before byte 0):**

1. Read manifest → `merkle_root`, `chunk_count`, `tree_algo`.
2. Single `GET {uuid}/hashes`. If length ≠ `chunk_count × 32` → 409 `integrity_failed`.
3. Reconstruct root in memory from the sidecar (§1). If ≠ manifest `merkle_root` → 409.
4. **Serve with verify-then-flush per chunk:** read chunk `i`, recompute BLAKE3, compare to
   sidecar entry `i`, **flush only on match**; on mismatch abort the stream with 409, log AE,
   **do not** auto-destroy (mismatch may be attack or bit-rot — preserve for investigation, while
   honouring the `date-seal.ots.enc` load-bearing deletion invariant separately).
5. On a fully-verified discharge, set collection-receipt `verified: true`.

**Performance — the 1,280-reads fear is misplaced.** Root reconstruction reads **one** sidecar
object, not N chunk objects. Body integrity is verified **inline with serving** (you hash the
bytes you were already reading). First-byte latency = one manifest read + one small sidecar GET +
first chunk fetch-and-hash — sub-second for a 10 GB / ~1,280-chunk file. No mitigation required
beyond the sidecar design itself.

**Partial verification (spot-check):** permitted **only** as a named background bit-rot canary that
samples R2 out-of-band. It **never** sets `verified: true` and **never** backs any integrity claim.
Full reconstruction + full inline body verification is the *only* honest basis for `verified`.

---

## 4. D-4 — MMR architecture (LOCKED)

Reverse MMR = the policyholder holds their own Merkle Mountain Range of payment events; leaves
encrypted to their own key; only *proofs of patterns* are ever disclosed.

- **On-device by default. Published root is opt-in.** The accumulator lives on the policyholder's
  device; nothing is published unless they choose to prove.
- **Published root anchors via the existing Share OTS relay — not a smart contract.** An MMR root is
  a 32-byte digest; anchoring `SHA-256(mmr_root ‖ nonce)` through `POST /timestamp/submit` is
  structurally identical to the existing file existence proof. **No new anchoring primitive.**
  Periodic anchoring (per leaf-batch, or monthly) yields a chain of anchored roots proving the
  accumulator grew append-only and each state predates its Bitcoin block.
- **"Smart contract" framing retired as inaccurate.** Public-facing language: *"anchored to Bitcoin"*
  (honest) or, in a room where "Bitcoin" closes doors, *"anchored to a public, tamper-evident
  timestamping layer"* (honest euphemism — it *is* one). We do **not** call OTS a smart contract.
  A bespoke EVM anchor for a specific counterparty is whitepaper §Future work, not the default.
- **Leaf encryption: AES-256-GCM, locally-held key — confirmed.** Web Crypto, reusing the Share AAD
  convention (leaf index as 4-byte BE AAD). Key derived from the policyholder's Deed/seed
  (BIP-39 → HKDF → per-MMR AES key), on-device, never transmitted. Note: selective-disclosure proofs
  are over the Merkle path + commitments, **not** over decrypted leaves — AES-GCM protects
  content-at-rest and any published form; it is not the disclosure mechanism.

---

## 5. D-5 — SMT for double-spend (LOCKED: complement, not replace, not B9)

- **Supabase `spent_tokens` stays the operational spend guard.** Atomic INSERT-on-serial (unique PK)
  is race-safe, low-latency, and load-bearing. KV counter remains rejected (race). An SMT does not
  improve the live-path arbiter.
- **SMT is an optional public-verifiability layer, published periodically** (a spent-set commitment
  root, anchored via OTS), **never** the live arbiter. What it adds that Supabase can't: a
  customer/regulator verifies *"this serial was never double-spent"* without trusting the operator.
  What Supabase does that the SMT can't cheaply: sub-millisecond race-safe rejection at spend time.
- **Migration milestone: none in B9, none in B10.** Gated on a **concrete commercial pull** — a
  client who needs the public exclusion proof. Until then: whitepaper §Future work.
- **London B2B applications** (legal single-use document tokens, broker quote tokens, property
  reference tokens): **whitepaper §Future work / commercial exploration, not near-term build.**
  Credible positioning, each needs a design partner. Strongest wedge = the **legal single-use
  document access token** (clearest pain, clearest buyer, DocuSign-audit-trail replacement) — pursue
  that first *if* a partner appears.

---

## 6. D-6 — ZK proof scope (LOCKED boundary)

**Boundary rule.** ZK earns a build slot only when **all three** hold: (a) the use case requires
hiding *which* member of a set satisfied a predicate; (b) **no existing Cashu protocol primitive**
(NUT-22 blind auth; nutroot `threshold`) already expresses it; (c) a concrete buyer is committed.
Everything else is whitepaper §Future work.

**In scope (justifies the complexity — but design-gated, buyer-gated):**
- **Pass ticketing** — prove valid-ticket-set membership without revealing which ticket. *Prefer
  NUT-22 blind authentication* ("member of the authorised set, cannot tell which", ~B10) over a
  bespoke ZK-Merkle circuit; fall to bespoke ZK only if NUT-22 cannot express it.
- **Share B2B batch compliance proof** — systematic delivery to every counterparty before a deadline,
  zero operational detail revealed. Genuine ZK use case. But MMR + signed receipts (§7) is the MVP;
  ZK is the mature upgrade, not ahead of a buyer.
- **Legend + Share due-diligence proof** — same shape: MMR leaf is the MVP, ZK is the upgrade.

**Out of scope (simpler primitive is sufficient — locked):**
- **Consumer transfer history** → standard MMR proof. ZK adds nothing the consumer needs.
- **Double-spend** → SMT exclusion proof (§5), not ZK.

---

## 7. D-7 — Whitepaper claim language (LOCKED — exact sentences)

**7.1 File integrity today (chunk-level BLAKE3):**
> "Every encrypted chunk is verified on upload against a BLAKE3 hash supplied by the client; the
> Worker rejects any chunk whose bytes do not match its declared hash (HTTP 400). This guarantees
> chunk-level integrity of the stored ciphertext. It does not, on its own, prove that the complete
> file is intact end-to-end — that guarantee arrives with Merkle-root verification."

**7.2 After Merkle-root verification ships (B9):**
> "At download the Worker reconstructs a Merkle root from the stored per-chunk ciphertext hashes and
> verifies each served chunk against it before release; a mismatch aborts the transfer (HTTP 409) and
> nothing is served. This proves that the encrypted object collected is byte-identical to the encrypted
> object stored. End-to-end integrity of the *decrypted* file is verified independently by the recipient,
> who recomputes the plaintext BLAKE3 root and compares it against the value carried in the share link —
> a check the Refueler Worker never participates in and cannot forge."

**7.3 Policyholder MMR model (honest scope — no regulatory or legal claim):**
> "A policyholder can accumulate their own payment history as a Merkle Mountain Range held on their
> device, each leaf encrypted to a key only they hold, and disclose to a third party a proof of a
> pattern — for example, a run of consecutive on-time payments — without revealing the underlying
> transactions, counterparties, or amounts. Refueler provides the transfer and sealing infrastructure
> for such proofs; it is not the issuer of the underlying data, does not vouch for its accuracy, and
> makes no representation that any particular proof satisfies a given underwriting, lending, or
> regulatory requirement."

**7.4 "Proof of due diligence" for the compliance market — VALIDATED WITH A REQUIRED QUALIFIER.**
The claim as loosely stated ("travel-rule compliance") is an **overclaim** and must be re-scoped.
FATF Recommendation 16 (the travel rule) concerns *transmitting* originator/beneficiary information
between institutions — not proving to a regulator that a check occurred. The defensible claim is a
*record-keeping / audit-evidence* claim, which maps to **FCA SYSC 6.3** (financial-crime systems &
controls) and **MLR 2017 reg. 40** (record-keeping), and sits *adjacent to* — not on — the travel rule.
Locked sentence:
> "Refueler Share can produce tamper-evident, independently-timestamped evidence that a due-diligence
> check was carried out on a given date and produced a specific (sealed) result — a record-keeping and
> audit aid that supports a firm's obligations under the Money Laundering Regulations 2017 and FCA
> SYSC 6.3 to monitor and retain records. It does not perform the underlying check, does not assess its
> adequacy, and is not, by itself, compliance with the FATF travel rule (Recommendation 16), which
> concerns the transmission of counterparty information between institutions rather than proof that a
> check occurred."

> ⚑ **Flag (not legal advice — Opus is not a solicitor):** an MLRO or compliance counsel must confirm
> this mapping before it appears in any sales or marketing copy.

**7.5 Open Banking (PSD2) as MMR leaf content — SELF-ASSERTED ONLY; bank-signed leaves needed for
"verified".**
> "Open Banking (PSD2) data is sufficient to build a *self-asserted*, tamper-evident, timestamped
> payment-history proof: it demonstrates that the policyholder committed to these payment events at a
> known time and has not altered them since. It is not equivalent to a bank-attested record — the
> verifier cannot independently check a bank signature on each leaf — so any claim that the history is
> *bank-verified* requires bank-signed leaves, which PSD2 access does not by itself provide."

> ⚑ **Flag (not legal advice):** whether self-asserted Open Banking leaves are evidentially sufficient
> for a given insurance/lending decision is for the counterparty's underwriting and legal teams; a
> solicitor should confirm evidential standing before any "verified" language is published.

---

## 8. Use-case matrix (five verticals)

| # | Vertical | Concrete use case | Primitive | Framing (gets you in the room) | Today | After B9 | Future work |
|---|----------|-------------------|-----------|-------------------------------|-------|----------|-------------|
| 1 | Insurance (UK) | Payment-regularity proof for underwriting | Reverse MMR, policyholder-owned; OTS-anchored root (opt-in) | "Data minimisation in practice" (GDPR Art. 5(1)(c)); "your payment history belongs to you, not Experian" | Nothing live | On-device MMR + OTS anchor demoable | Health (payment regularity w/o diagnosis) + travel (w/o destinations) = **§Future work**; bank-signed leaves for "verified" |
| 2 | Legal (UK, SRA) | Proof a due-diligence check occurred (counterparty wallet screen) | Legend+Share signed MMR leaf; SMT exclusion proof for single-use doc token | "Precision compliance — answers the question asked, nothing more" | Server-blind transfer live | Signed-receipt MMR leaf demoable | SMT single-use doc token = §Future work; ZK batch proof = §Future work |
| 3 | Travel & ticketing | Lost-ticket recovery (mate vouches at the door); anonymous set-membership entry | Nutroot `threshold` (2-of-2, B12); NUT-22 blind auth for membership | "Your mate can vouch for you at the door" | Nothing live | Nothing (gates on B12/PR #421) | Airline ancillary (upgrades as credentials) = **§Future work** |
| 4 | Bitcoin banks / lenders | Creditworthiness from Lightning payment regularity | Reverse MMR leaves from Refill/POS/Open Banking | "A more accurate signal with lower fraud surface" | Nothing live | On-device MMR demoable | Data *depth* is the gate, not crypto (see §9) |
| 5 | Finance / accountancy (London B2B) | Batch compliance proof — systematic delivery before deadline, zero operational detail | Transfer MMR + signed receipts (MVP); ZK batch proof (mature) | "Your transfer history is your audit trail, and only you hold it" | Signed receipts live (SW5) | MMR over receipts demoable | ZK batch proof = §Future work; FCA mapping = SYSC 6.3 / MLR reg. 40, **not** travel rule |

**Vertical sub-questions, answered:**

- **V1 health/travel insurance** → §Future work. Same MMR primitive, different data sources and
  regulatory surfaces; v1 is the general payment-regularity proof only.
- **V2 SRA client confidentiality** → **strengthens** the solicitor's position (the Worker cannot read
  client material — a positive for SRA confidentiality). **Managed risk / caveat:** the solicitor
  remains the data controller and cannot outsource controller obligations to a blind processor; a blind
  Worker also cannot assist recovery or supervision. It is a claim *and* a DPA line — flag for the DPA.
- **V3 airline ancillary** → §Future work. Credible concept; needs an airline partner + Pass live.
- **V4 snowball timeline (frank):** infrastructure-ready 2026–27; first design partner (a Bitcoin-native
  lender) *plausibly* 2027; the mainstream trigger (a CRA breach, ICO enforcement on excessive
  underwriting data, or a challenger insurer differentiating on MMR) is **unpredictable — 2027 or
  2030**. Build the primitive cheaply, keep it whitepaper-stated, do **not** stake the roadmap on
  adoption timing. What a Bitcoin-native lender actually needs: a *verifiable behavioural signal*
  (Lightning regularity, sats-accumulation consistency), which the primitive produces — **but** the
  data sources need 18–24 months of leaves to carry evidential weight, and that depth does not exist
  today. The gate is data depth, not cryptography.
- **V5 FCA mapping** → the due-diligence-proof claim speaks to **SYSC 6.3** and **MLR 2017 reg. 40**,
  sits **adjacent to** MAR/COBS (not those), and does **not** map to the travel rule. Reframe as
  "audit evidence / record-keeping aid," not "compliance." Flag for MLRO confirmation.

---

## 9. B9 (Merkle block) session plan

| Session | Label | Scope | Repo | Prerequisite |
|---------|-------|-------|------|--------------|
| B9-1 | Tree construction | RFC 6962 unbalanced BLAKE3 tree, domain-separated. Worker + browser parity (identical root from identical hashes). Pure fn + vectors. | refueler-share | B9-Opus (this) |
| B9-2 | Root storage | `merkle_root` + `tree_algo` in manifest; `{uuid}/hashes` sidecar written at manifest-write. | refueler-share | B9-1 |
| B9-3 | Download verification | Sidecar-root check + verify-then-flush per chunk + 409 on mismatch. **Primary honesty target.** | refueler-share | B9-2 |
| B9-4 | Receipt upgrade | `merkle_root` on acceptance; `merkle_root` + `verified` on collection. Overrides SW5 field discipline (ciphertext root only). | refueler-share | **B9-3 green** |
| B9-5 | MMR on-device | Share consumer transfer MMR: leaf = event, AES-256-GCM leaf encryption, on-device accumulator, selective-disclosure proof. | refueler-share | B9-1…B9-3 |
| B9-6 | MMR published root (opt-in) | Anchor `SHA-256(mmr_root ‖ nonce)` via OTS relay; append-only anchor chain. | refueler-share | B9-5 |
| B9-7 | SMT public-verifiability | **Conditional / forward.** Only if a design partner commits; else stays §Future work per D-5. | refueler-share | Commercial pull |
| B9-8 | Whitepaper §Integrity | §7 claim language verbatim; two-roots explainer; honest scope; renders in Carbon/Paper tokens. | refueler-share | B9-3 (B9-4 ideally) |

**Buffer pool (3):** B9-2b · B9-3c · B9-5b.

---

## 10. Do-not-retry (B9-Opus additions)

- DO NOT conflate the **ciphertext-chunk Merkle root** with the **plaintext BLAKE3 root**. Worker
  verifies the former; recipient verifies the latter; they are different values with different scopes.
- DO NOT put `blake3PlaintextRoot` in any receipt or send it to the Worker — permanent, not "until B9".
- DO NOT pad the tree (duplicate-last-leaf = CVE-2012-2459; zero-pad = ambiguous). RFC 6962 unbalanced
  promotion only; `chunk_count` committed.
- DO NOT hash tree nodes without domain separation (`0x00` leaf / `0x01` node) — ambiguity attack.
- DO NOT store the chunk-hash array inline in the manifest — collides with the 64 KB `safeGetManifest()`
  ceiling on large files. Sidecar `{uuid}/hashes` only.
- DO NOT base a `verified: true` receipt on a spot-check — full reconstruction + full inline body
  verification only. Spot-check is a background canary that never touches a receipt.
- DO NOT call OTS anchoring a "smart contract." Anchor MMR roots via the Share OTS relay; say
  "Bitcoin-anchored" or "public timestamping layer".
- DO NOT let Supabase's spend guard be replaced by an SMT. SMT is a periodic public-verifiability layer,
  never the live arbiter.
- DO NOT claim "travel-rule compliance" for the due-diligence proof — it is record-keeping evidence
  (SYSC 6.3 / MLR reg. 40), MLRO to confirm.
- DO NOT hand-roll a ZK circuit where NUT-22 blind auth or a nutroot `threshold` leaf already expresses
  the requirement.

---

*"Nothing stops this train."*
