# B8-spec-v1.md — refueler-share NUT-11 Mode 2 (Locke) design lock

> **Session:** B8-Opus · 13 Sep 2026 · Opus · architecture + design, no code produced
> **Status:** locked spec. Seven decisions (D-1…D-7) resolved in-session.
> Load alongside `CLAUDE.md`, `Share-Master-Context.md`, `share-sessions.md`, `REFUELER-BRIDGE.md` (v9.5+), `merkle-spec-v1.md`.
> **Supersedes:** the forward notes in `REFUELER-BRIDGE.md` §Locke — that section becomes "see `B8-spec-v1.md`".
> **Refines (does not contradict):** the BRIDGE §Locke phrase *"secure enclave storage"* — narrowed to a technically honest storage model (§2, D-2). secp256k1 does **not** live in the Apple Secure Enclave; the SE is P-256-only.
> **Signs off:** Pass **SD3** (Harbourmaster auth). SD3 could not be built before this document existed. It now can.

---

## 0. Honesty banner — read this before quoting anything from this file

This document designs NUT-11 **Mode 2** (P2PK keypair-binding) and the **Locke** object — the
credential-as-key that gates the Harbourmaster dashboard and, later, receiver-bound Silent Drop
collection. **None of it is live.** What is true on 13 Sep 2026, versus what this file merely
*specifies*:

| Thing | State on 13 Sep 2026 |
|---|---|
| NUT-11 **Mode 1** passphrase gate (`hashSecret()`, bare SHA-256, in the manifest) | **Live** (S3, parity-checked SW-MCP-2) |
| BDHKE proof verification against the mint pubkey set (`worker/src/nut11.js`) | **Live** |
| Supabase atomic double-spend guard (`spent_tokens` INSERT-on-serial) | **Live** |
| `@noble/secp256k1` present in Worker + `frontend/crypto.js` | **Live** (already imported) |
| Mode 2 **Schnorr witness verification** (`schnorr.verify`, BIP-340, x-only key) | **Not built.** B8-1/B8-2 |
| The **Locke** object (Deed→HKDF→secp256k1 keypair, passkey-wrapped) | **Not built.** B8-1/B8-3 |
| Harbourmaster **challenge-response login** (KV pubkey set, one-shot challenge) | **Not built.** B8-3 |
| Locke **multi-device / recovery / revocation** | **Not built.** B8-4 |
| Frontend Locke client + MCP `signCredential()` | **Not built.** B8-5 |

**Everything in B8 is design-only until the build sessions ship.** Do not describe Mode 2, the
Locke, "keypair-bound credentials", or "verifiable agent identity" as live capabilities in any
copy, README, pitch, or `capabilities` response until the backing session is green.

**Banned phrases (carried + extended):** never *"end-to-end file integrity"* (unchanged — that is
the recipient's plaintext check, never the Worker's); never *"proof of delivery"*; never
*"zero-knowledge"* as a headline; never *"military-grade"*; never *"audit-certified"*; never
*"smart contract"* for OTS anchoring. **New for B8:** never say a secp256k1 Locke key lives *in the
Secure Enclave* (the SE is P-256-only — see D-2); never call Mode 2 "anonymous membership" (that is
NUT-22, B10 — §1); never claim the Worker "cannot inject a pubkey" (it holds the KV — the honest
claim is that an injected key is useless and detectable, §4).

**Two-roots invariant carry (the reason this file was told to load `merkle-spec-v1.md`).** B8 touches
`worker/src/nut11.js`. It is confirmed here that Mode 2 introduces **no new route for plaintext into
the Worker**: Mode 2 operates on the proof's `secret` (a P2PK condition — a pubkey and a nonce) and
its `witness` (a signature), plus the Locke KV (hex pubkeys) and login challenges (random bytes).
**None of these carries file plaintext or the plaintext `blake3PlaintextRoot`.** The plaintext root
remains client/recipient-side only, permanently barred from the Worker. B8 does not weaken that line.

---

## 1. Scope (D-boundary — read before anything else)

**What B8 is.** NUT-11 **Mode 2**: Cashu proofs bound to a secp256k1 keypair (P2PK). Spending a
Mode 2 proof requires a valid Schnorr signature from the holder of the committed key. In its full
form this is the **Locke** — a shared primitive across **Share** (upload-credential binding; later,
receiver-bound Silent Drop collection) and **Pass** (Harbourmaster login, SD3). The design is locked
**once, here, for both products.**

**What B8 is *not* — four boundaries, none to be conflated:**

- **Mode 2 ≠ Mode 1.** Mode 1 is the passphrase-hash P2SH gate: `hashSecret()` = bare
  `SHA-256(utf8(passphrase))`, carried in the manifest as `p2sh_secret_hash` / `X-P2SH-Secret-Hash`.
  A bearer token, no keypair. **Mode 1 is untouched by B8** and the two gates are independent and may
  coexist on one transfer (§5, D-5).
- **Mode 2 ≠ NUT-22.** NUT-22 is blind authentication / membership-anonymity — *"a member of the
  authorised set, and the verifier cannot tell which."* Mode 2 is keypair-binding — *"only the holder
  of key K can spend."* **Orthogonal.** NUT-22 is B10. (Correction locked Share-127; carried in
  BRIDGE §PR #421.) Do not let a future session collapse them.
- **Mode 2 ≠ nutroot (NUT-10 v3).** nutroot gives programmable spending conditions
  (`threshold`/`after`/`hashlock`) on **v3 keysets**. NUT-11 is explicitly scoped to **pre-v3
  secp256k1 keysets**. Mode 2 stays on pre-v3 keysets; it does not require, and must not wait on,
  the v3 protocol. nutroot is a later, separate track (B12+).
- **Mode 2 ≠ integrity work.** Mode 2 is authentication/authorisation. It is not Merkle-root
  verification (B9), not ML-KEM (B10), not any "end-to-end" claim.

**No scope creep.** B8 delivers: Schnorr Mode 2 verification in the Worker; the Locke object and its
lifecycle; the Harbourmaster challenge-response auth that SD3 depends on; and the MCP crypto
extension. It does **not** deliver Silent Drop itself (SD-block), Lightning issuance (B7/NB-4), or
FROST social recovery (B12). Those are gated elsewhere and merely *forward-noted* here.

---

## 2. Key generation and storage (LOCKED)

### D-1 — Key generation (LOCKED)

- **Library: `@noble/secp256k1` v2, throughout.** Already present in `worker/src/nut11.js` and
  `frontend/crypto.js`. **Never** Web Crypto native for secp256k1 — Web Crypto exposes only
  P-256/P-384/P-521. (Do-not-retry, §9.)
- **Ephemeral Share upload keypairs** (the consumer/agent path where a Mode 2 proof is bound for a
  single upload): fresh per credential via `secp256k1.utils.randomPrivateKey()`. Session-scoped,
  discarded after spend. Not persisted anywhere.
- **The Locke keypair is derived from the Deed via HKDF (not BIP-32).**
  One Lightning payment → one **Deed** (BIP-39, 24 words) → one **primary Locke** (secp256k1):
  1. `seed = BIP39_seed(mnemonic, passphrase="")` (64 bytes, PBKDF2-HMAC-SHA512, per BIP-39).
  2. `okm = HKDF-SHA256(ikm=seed, salt=utf8("refueler.locke.v1"), info=utf8("locke_keypair"), L=32)`.
  3. **Reduce to a valid scalar (mandatory — you cannot hand raw HKDF bytes to the curve).** Read
     `okm` big-endian as integer `d`. If `1 ≤ d < n` (curve order), accept. Otherwise re-derive
     deterministically with `info=utf8("locke_keypair." + counter)`, `counter = 1, 2, …`, until valid.
     Rejection probability ≈ 2⁻¹²⁸ — effectively never — but the counter path is specified so the
     **same Deed always yields the same Locke** even in the astronomically unlikely reject case.
  4. `locke_priv = d`; `locke_pub = compressed secp256k1 point` (33 bytes, `02`/`03` prefix).

  **Rationale for HKDF over BIP-32:** consistent with the Deed→HKDF derivation B9-Opus already
  locked for the MMR AES key; single-purpose (we need exactly one auth key, not an HD tree); no
  derivation-path registration; already available via `@noble/hashes`. The Locke is an *auth* key,
  not a spending key — third-party-wallet portability is a non-goal. If a first-party Refueler app
  ever wants portable derivation, that is a versioned future decision (`refueler.locke.v2`), not a
  reason to carry BIP-32 machinery now.

### D-2 — Key storage (LOCKED — three surfaces, one honest storage model)

- **Share upload keypairs (consumer/agent):** in-memory only, session-scoped, discarded after spend.
  Never persisted. (Unchanged rule; the general case.)
- **MCP path:** in-memory in the agent process only. No browser, no enclave. The operator's config
  supplies nothing here — the ephemeral upload key is generated per send and dropped. (Confirmed.)
- **Locke — the documented exception to "credentials in browser memory only" — stated honestly:**
  - **Native app (future — iOS/Android):** the secp256k1 Locke private key lives in the platform
    **Keychain / Keystore**, biometric-gated, non-exportable. **Not the Apple Secure Enclave hardware
    element** — the SE natively supports **P-256 only** and cannot hold a secp256k1 key. Saying
    "secp256k1 in the Secure Enclave" would be false; do not.
  - **Browser (Harbourmaster web — the SD3 surface):** the secp256k1 Locke key is stored
    **encrypted at rest** in IndexedDB, the wrapping key derived from a platform passkey via the
    **WebAuthn PRF extension** (`prf`), so the plaintext Locke key exists only in memory during a
    session and is hardware/passkey-gated at rest. Where WebAuthn PRF is unavailable, fall back to
    **Deed-passphrase-wrapped** storage with the security scope stated plainly to the user. **Never
    store the raw Locke private key as plaintext in any browser storage** (XSS-exfiltratable).
  - **Recovery anchor:** the **Deed** (offline, on the recovery sheet) re-derives the primary Locke
    deterministically (D-1). The Deed is written at onboarding and **not retained in app storage**.

**This refines, not contradicts, BRIDGE §Locke.** The key remains hardware/passkey-gated and never
sits in browser plaintext. We are only being precise about *which* hardware, because the honest
claim matters more than the impressive one.

---

## 3. Worker verification path (LOCKED)

### D-3 — Mode 2 verification (LOCKED: wire format, scheme, check order)

**Witness wire format — NUT-11 verbatim, nothing bespoke.** The proof carries
`witness` as a JSON-serialised string of `{ "signatures": ["<hex sig>"] }`. Parse, do not invent.

**Secret format — NUT-11 P2PK verbatim.** The proof's `secret` is the JSON string of
`[kind, {nonce, data, tags}]` where `kind = "P2PK"`, `data` = the 33-byte compressed pubkey (hex)
that must sign, `nonce` = 32 random bytes (hex) preventing secret collision, and `tags` = optional
`[key, value…]` pairs (`sigflag`, `n_sigs`, `pubkeys`, `locktime`, `refund`). B8 uses the single-key
form; multisig/locktime tags are parsed-and-rejected-if-present until a session needs them.

**Signature scheme — Schnorr, BIP-340.** NUT-11 Mode 2 signs with BIP-340 Schnorr on secp256k1.
`@noble/secp256k1` v2 exposes `schnorr.verify()` — **no new dependency.**

**The x-only wrinkle (bake in, do not trip on it).** The P2PK pubkey in `data` is 33-byte
compressed, but BIP-340 verification is **x-only** (32 bytes). The Worker **drops the parity/prefix
byte** before `schnorr.verify(sig, msg, xonly_pubkey)`. This is a genuine gotcha and a required step.

**Message construction — pinned against reference vectors, not guessed.** The signed message is the
proof's `secret` string as specified by NUT-11. Whether the exact preimage is the raw string or its
SHA-256 is a **byte-level detail B8-1 pins against `cashu-ts` / nutshell reference test vectors
before any Worker wiring.** We match a known-good implementation; we do not guess a preimage. (Same
discipline as the `hashSecret()` parity check at SW-MCP-2.)

**Check order — LOCKED: `sig → BDHKE → double-spend`.** Both local validity checks run before the
Supabase atomic INSERT (the network call, and the point of no return). Never commit a spend until the
token is proven both correctly witnessed *and* mint-signed; never trouble the ledger for a proof that
fails locally. Exact sequence at credential redemption, before any state mutation:

1. **Schnorr witness verify** (local CPU). Parse `secret` → extract `data` pubkey → x-only →
   `schnorr.verify(witness.signatures[0], msg, xonly)`. Fail → `400 invalid_witness`. *(Fail fast on
   the new Mode-2 gate.)*
2. **BDHKE proof verify** against the mint pubkey set (local CPU). Unchanged from Mode 1. Fail →
   `400 invalid_proof`.
3. **Supabase atomic double-spend** — INSERT-on-serial into `spent_tokens` (network; the spend
   commit). Conflict (409) → already spent; fire-and-forget log to `double_spend_attempts`, return
   the double-spend error. Success → proceed to issue the credential / grant the action.

**Mode 1 coexistence.** If the transfer also carries a Mode 1 passphrase gate, that check is
**independent** and lives where it always has (manifest `p2sh_secret_hash` vs the presented
`X-P2SH-Secret-Hash`). It is neither replaced nor sequenced into the above — it gates a different
thing (transfer access) than the Mode 2 credential (spend authorisation). See §5.

---

## 4. Locke object lifecycle (LOCKED — the SD3 primitive)

**Locke = the credential-as-key that unlocks the Harbourmaster dashboard.** NUT-11 Mode 2 P2PK in
full form. Operational name (a Locke, not a lock) and philosophical (John Locke, consent). Both
readings intended.

### D-4 — Lifecycle (LOCKED)

**Derivation roles — resolving "each device holds its own Locke" against deterministic derivation.**
The Deed derives **exactly one** deterministic keypair, the **primary Locke** (= the recovery Locke,
D-1). Additional devices do **not** re-derive from the Deed (you never type the 24-word Deed into a
second device — that defeats offline recovery). Instead:

- **Onboarding (device 0):** generate Deed → derive `primary Locke` (deterministic) → store its
  private key per D-2 → register `pubkey_primary` in the KV set → **also** record `pubkey_primary` in
  an **immutable recovery anchor** (below).
- **Devices 2…N:** each generates a **fresh random** keypair in its own enclave/passkey store. It is
  authorised by an *existing* Locke's signature (add-device flow, below). The KV set therefore holds
  N distinct pubkeys — "each device holds its own Locke" holds exactly.

**KV schema (`STATUS_KV`):**

- `locke_pubkeys_{harbour_uuid}` → authorised set (mutable):
  ```json
  { "v": 1, "pubkeys": [
    { "pubkey": "<hex33>", "role": "primary" | "device",
      "label": "…", "added_at": <unix>, "authorised_by": "<hex33>" | "deed" }
  ] }
  ```
- `locke_primary_pubkey_{harbour_uuid}` → `"<hex33>"` — **immutable recovery anchor**, written once at
  onboarding. Separate from the mutable set so that removing the primary from the active set never
  erases the recovery path.
- `login_challenge_{harbour_uuid}_{challenge_id}` → `{ "challenge": "<hex32>", "exp": <unix> }` — TTL
  ≈ 60 s, single-use (deleted on verify).

**Challenge-response login (no password, no email):**

1. `POST /harbour/login/challenge` `{ harbour_uuid }` → Worker generates 32 bytes via
   `crypto.getRandomValues`, stores `login_challenge_*` (≈60 s TTL), returns `{ challenge_id, challenge }`.
2. Client computes `msg = SHA-256(utf8("refueler.locke.login.v1") ‖ utf8(harbour_uuid) ‖ challenge_bytes)`
   and `sig = schnorr.sign(msg, locke_priv)`.
3. `POST /harbour/login/verify` `{ harbour_uuid, challenge_id, pubkey, signature }`.
4. Worker: load challenge (reject if missing/expired) → **delete it (single-use)** → load
   `locke_pubkeys_{harbour_uuid}` → reject if `pubkey ∉ set` → recompute `msg` →
   `schnorr.verify(signature, msg, xonly(pubkey))` → on success issue a short-lived
   dashboard session per the existing session model.

The **domain tag** `refueler.locke.login.v1` binds the signature to the login purpose: a login sig
can never be replayed as a Cashu spend (Mode 2 signs the proof `secret`, a different message) or as a
device authorisation (different tag, below). One-shot KV challenge prevents replay.

**Multi-device — add:**
1. New device generates a fresh keypair; displays `pubkey_new` (QR / deep-link).
2. An existing authorised device computes
   `msg = SHA-256(utf8("refueler.locke.authorise.v1") ‖ utf8(harbour_uuid) ‖ pubkey_new_bytes)` and
   `sig = schnorr.sign(msg, existing_locke_priv)`.
3. `POST /harbour/device/authorise` `{ harbour_uuid, new_pubkey, authorising_pubkey, signature }`.
4. Worker: `authorising_pubkey ∈ set` → verify sig over `msg` → append
   `{ pubkey: new_pubkey, role: "device", authorised_by: authorising_pubkey, added_at }`.

**Multi-device — remove / revoke.** `POST /harbour/device/revoke`, signed by an authorised Locke
(domain tag `refueler.locke.revoke.v1`), removes a pubkey from the set. Refueler-side admin removal is
the **compulsion surface** (below).

**Recovery (all devices lost).** Re-derive the primary Locke from the Deed (D-1) → `pubkey_primary`.
If still in the active set, sign a normal login challenge and you are in; then prune the lost devices'
pubkeys. If the primary was removed, `POST /harbour/recover` with a challenge signed by the
Deed-derived primary key → Worker verifies against the **immutable** `locke_primary_pubkey_{uuid}`
anchor → re-adds `pubkey_primary`. This endpoint is rate-limited and accepts **only** the recorded
primary key. **Informed cliff:** loss of all devices *and* the Deed = loss of access. Stated plainly
at onboarding. (FROST social recovery is the firm-path upgrade, B12 — forward note only.)

**Compulsion surface — honest framing.** Refueler holds the KV, so the precise, defensible claim is:
- **Removal** (denial of access) is the real compulsion surface. Refueler can drop a pubkey from the
  set under legal compulsion.
- **Injection** is *technically possible but useless*: an injected Refueler-controlled pubkey cannot
  decrypt cargo (the AES key is in the URL fragment the Worker never sees), cannot impersonate an
  existing Harbourmaster (their private key is never held), and appears in the Harbourmaster's own
  device list as an unrecognised key — **detectable**. Do **not** claim "the Worker cannot inject a
  pubkey." Claim what is true: an injected key gains nothing and is visible.

**Locke ≠ subscription credential.** Subscription = entitlement. Locke = access. Two objects from one
payment event. (Carried from BRIDGE §Locke.)

---

## 5. `hashSecret()` and P2SH — Mode 1 vs Mode 2 (LOCKED boundary)

### D-5 — The two gates are independent and may coexist (LOCKED)

- **Mode 1 `hashSecret()` is unchanged by B8.** Bare `SHA-256(utf8(passphrase))`, no domain tag,
  parity-confirmed at SW-MCP-2. It lives in the **manifest** (`p2sh_secret_hash`) and is presented as
  `X-P2SH-Secret-Hash`. **No future session may "upgrade" or domain-tag it while wiring Mode 2** —
  the two are different features that happen to share the word "secret".
- **Mode 2 secret is a structured P2PK condition,** not a passphrase hash: `["P2PK", {nonce, data,
  tags}]` in the **proof** (§3). Different field, different object, different location.
- **Coexistence is independent, not composable.** A transfer may carry **both** a Mode 1 passphrase
  gate (manifest) **and** a Mode 2 keypair-bound credential (proof). They are checked separately and
  gate different things: Mode 1 gates *access to the transfer*; Mode 2 gates *authorisation to spend
  the credential / perform the action*. Neither implies nor requires the other. This already holds in
  the current architecture (passphrase hash in the manifest; credential separate) — B8 preserves it.
- **MCP crypto extension surface (locked).** `refueler-mcp/src/crypto.js` keeps `hashSecret()` at
  confirmed parity, **untouched**. B8 adds *separate* functions: `deriveLockeFromDeed(mnemonic)`,
  `signCredential(privateKey, message)`, `verifyCredential(pubkey, signature, message)`. New surface,
  no collision with the passphrase path.

---

## 6. CDK upgrade decision (LOCKED)

### D-6 — Stay pinned at CDK 0.17.2 for B8 (LOCKED)

**The Worker does not use CDK as a library.** BDHKE is implemented directly in
`worker/src/nut11.js`; Mode 2 adds `schnorr.verify()` from `@noble/secp256k1` (already present). The
CDK pin governs mint-side tooling, **not** the Worker's verification path.

Assessing 0.18.0 (released Sep 2026) against B8 specifically:
- **NUT-12 deterministic DLEQ nonces + test vectors** — *favourable as a cross-check reference* for
  Mode 2, but not a dependency. B8-1 pins its own vectors (§3); we may consult the CDK vectors, we do
  not import them.
- **NUT-20 deterministic quote signing keys** — a note for the B8/B9 whitepaper, no Worker impact.
- **`cdk-lnbits` backend removed** — irrelevant; the Worker calls LNbits REST directly.
- **`MintKeys`/`MintKeyPair`/`MintKeySet` no longer `Serialize`** — security hardening, no Worker-side
  impact.

**Decision:** stay on **0.17.2**. Nothing on the Worker's Mode 2 path touches CDK, so the upgrade
buys B8 nothing. **Review trigger:** re-assess the pin when 0.18+ ships a feature we actually consume
(the BOLT12 forward-commitment at B9+, or a stable v3 keyset release) — not before.

---

## 7. Cross-product forward notes

### D-7 — Build locus: direct in `refueler-share`, retire the ecash-lab flag for Mode 2 (LOCKED)

B8 builds **directly in `refueler-share`**, B9-style: **B8-1** does pure-fn + Schnorr/HKDF/
challenge-response **test vectors in-repo**, then the verified functions wire into
`worker/src/nut11.js` (+ a new `worker/src/locke.js`), `frontend/crypto.js`, and
`refueler-mcp/src/crypto.js`. Rationale: no new dependency (noble already present); the primitive is
small; the parity harness (Worker ⇄ frontend ⇄ MCP) must live in-repo regardless; and a solo builder
juggling a second production repo is friction the lab was never meant to add.

**`refueler-ecash-lab`: the Mode 2 flag is retired.** The CLAUDE.md deferred-experiment entry pointed
the lab at "NUT-11 Mode 2 **and** ML-KEM". Mode 2 comes home to `refueler-share`. **The lab is
reserved for ML-KEM (B10)**, where the novelty and dependency risk genuinely justify isolation.

**Pass / SD3 dependency (explicit).** Locke is the Harbourmaster login primitive. **SD3 could not be
built until this document was signed off.** It now can: SD3 consumes §4 verbatim (challenge-response
login, KV schema, multi-device, recovery). Any change to the Locke construction is a change to SD3's
auth model and must re-open this spec, not be made ad hoc in an SD session. Receiver-bound Silent Drop
collection (a *receiver's* Locke binding the collection credential) is a **Mode 2 application** —
forward-noted for the SD-block, gated on SD + NB-4, not built in B8.

**NUT-22 boundary (restated, load-bearing).** NUT-22 (blind authentication / membership-anonymity,
B10) is **not** NUT-11 Mode 2 (keypair-binding, B8). Orthogonal problems: *"which member cannot be
told"* vs *"only key K can spend"*. Do not conflate them in any session, doc, or pitch. (Share-127
correction; BRIDGE §PR #421.)

---

## 8. B8 build sequence

| Session | Label | Scope | Repo | Prerequisite |
|---------|-------|-------|------|--------------|
| **B8-1** | Crypto primitives + vectors | BIP-340 Schnorr verify (x-only from 33-byte P2PK `data`); P2PK `secret`/`witness` parse; HKDF Deed→Locke derivation + scalar reject-sampling; login/authorise/revoke message constructors (domain-tagged). **Pure fns + test vectors pinned against `cashu-ts`/nutshell.** Mirror pure fns into `frontend/crypto.js` + `refueler-mcp/src/crypto.js`. No endpoints, no wiring. | refueler-share (+ mcp) | B8-Opus (this) |
| **B8-2** | Worker Mode 2 verify | Wire `sig → BDHKE → double-spend` into the credential-spend path (`worker/src/nut11.js`/`index.js`). Witness parse, x-only verify, Mode 1 coexistence untouched. Full 4xx/409 error matrix. Unit tests. | refueler-share | B8-1 |
| **B8-3** | Locke login + KV | `POST /harbour/login/challenge` + `/harbour/login/verify`; KV schemas (`locke_pubkeys_*`, `locke_primary_pubkey_*`, `login_challenge_*`); one-shot TTL challenge; session issuance. **This is the SD3 primitive.** Unit tests. | refueler-share | B8-1 |
| **B8-4** | Multi-device + recovery | `/harbour/device/authorise`, `/harbour/device/revoke`, `/harbour/recover`; immutable recovery anchor; Refueler-side revocation (compulsion surface) admin path; rate limits. Unit tests. | refueler-share | B8-3 |
| **B8-5** | Frontend Locke + MCP sign | Harbourmaster Locke module (WebAuthn-PRF-wrapped keygen/storage, challenge-response login UI in Carbon/Paper, add-device QR, Deed recovery UI). MCP `signCredential`/`verifyCredential`/`deriveLockeFromDeed` (in-memory). Parity via `bin/sync-share.sh`. | refueler-share (+ mcp) | B8-3, B8-4 |
| **B8-6** | Audit + close | Replay (challenge reuse), cross-protocol sig reuse (domain-tag coverage), device-auth abuse, recovery abuse, Mode 1/Mode 2 coexistence regression, x-only parity, HKDF determinism + reject path. Context-file trim pass (B-close discipline). **B8 close.** | refueler-share | B8-2…B8-5 |

**Buffer pool (2):** `B8-2b` (Worker verify edge cases / vector mismatches) · `B8-5b` (browser
WebAuthn-PRF availability + cross-browser enclave fallbacks).

**Ordering note.** B8-2 (spend verify) and B8-3 (Locke login) both depend only on B8-1 and may be
taken in either order; B8-3→B8-4→B8-5 is the Locke spine that SD3 waits on.

---

## 9. Do-not-retry (B8-Opus additions)

- DO NOT use Web Crypto native for secp256k1 — Web Crypto is P-256/384/521 only. `@noble/secp256k1`
  throughout (Worker, frontend, MCP).
- DO NOT hand raw HKDF output to the curve as a private key — reduce/reject-sample to `1 ≤ d < n`
  (deterministic counter path, D-1).
- DO NOT use BIP-32 for the Locke — HKDF from the Deed, `salt="refueler.locke.v1"`, is the lock.
- DO NOT verify BIP-340 Schnorr against the 33-byte compressed pubkey — drop the parity byte,
  verify x-only.
- DO NOT guess the NUT-11 signed-message preimage — pin it against `cashu-ts`/nutshell vectors at
  B8-1 before any Worker wiring.
- DO NOT reorder the checks — `sig → BDHKE → double-spend`. The Supabase INSERT (spend commit) is
  always last; never mark a token spent before both local checks pass.
- DO NOT touch `hashSecret()` while wiring Mode 2 — bare SHA-256, Mode 1, independent. Different
  feature, same word.
- DO NOT reuse a login signature elsewhere — domain-tag every Locke message
  (`login.v1`/`authorise.v1`/`revoke.v1`); challenges are 32-byte, one-shot, KV-TTL'd.
- DO NOT claim a secp256k1 key lives in the Apple Secure Enclave — the SE is P-256-only. Locke keys
  are Keychain/Keystore-gated (native) or WebAuthn-PRF-wrapped (browser); never browser plaintext.
- DO NOT claim "the Worker cannot inject a Locke pubkey" — it holds the KV. The honest claim: an
  injected key can't decrypt cargo, can't impersonate, and is visible in the device list.
- DO NOT conflate Mode 2 (keypair-binding, B8) with NUT-22 (membership-anonymity, B10) or nutroot
  (v3 programmable conditions, B12+).
- DO NOT route file plaintext or `blake3PlaintextRoot` through any Mode 2 path — Mode 2 sees pubkeys,
  nonces, signatures, and challenges only. The plaintext-root ban is permanent.
- DO NOT confuse `refueler-mcp/src/crypto.js` with `worker/src/nut11.js` — full repo path on every
  edit.

---

*"Nothing stops this train."*
