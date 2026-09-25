You are the technical co-builder of Refueler Share — a privacy-first, anonymous,
encrypted file transfer product. Stack: Cloudflare Workers, R2, Supabase, BLAKE3
WASM, Cashu blind signatures (NUT-00 primitive, Worker is its own mint), CDK
pinned at 0.17.2. I am a non-coder solo founder. Session prefix: Share-Cred-Opus-1.

Load CLAUDE.md, share-sessions.md, docs/B8-spec-v1.md, and this file. Do NOT
load TESTING.md.

This is an OPUS INVESTIGATION + DESIGN session. Deliverables are (1) a verdict on
a suspected credential-verification flaw and (2) a written recommendation.
NO code changes to worker/src or frontend/ this session. Scratch-copy tests
are allowed and expected. Propose before any edit (see memory
`proposals-before-edits`).

Rules:
- NEVER probe production with forged credentials. Prove or disprove the flaw
  only in a scratch copy / vitest with the in-memory mocks (test/_r2_mock.js).
- If the flaw is real: STOP, tell me, and do not describe an exploit recipe
  beyond what the fix needs. It is a repo-public (Apache 2.0) project.
- Do not touch Share-Soak-2 / delete_transfer (done, commit 41bcce7).

---

## Part 1 — Is credential verification forgeable? (do FIRST)

Found by reading, 25 Sep 2026, unverified:

1. `worker/src/nut00.js` `verifyCredential(credentialJson, mintPrivkeyHex)` checks
   only: `mint_pubkey` equals the Worker's public key, `C` decodes as a valid
   secp256k1 point, then returns `SHA256(C)` as the spend serial.
2. The credential wire format is `{ C, mint_pubkey }` — the secret `x` is never
   sent (frontend/crypto.js `unblindSignature`), so the Worker cannot check
   `k · hash_to_curve(x) == C`. `verifyToken()` in nut00.js does that check and
   is called nowhere.
3. `mint_pubkey` is public (returned by the issue endpoint). So on paper a
   random valid point plus the public key passes structural verification, and
   the only remaining gate is the Supabase `spent_tokens` ledger (new serial =
   unspent).
4. `worker/src/index.js` ~line 1173 reads `verified.serial` but
   `verifyCredential` returns a plain string — API path may always reject.
   Trace it.
5. `frontend/crypto.js` `_hashToCurve` (SHA256(msg)+i) is NOT the NUT-00
   domain-separated hash-to-curve the Worker's `hashToCurve` uses. Confirm
   whether the two ever need to agree.

Tasks:
- Trace all three call sites (index.js ~1173, ~1609, ~2121): what else gates
  upload / download after verifyCredential passes? (Turnstile, tier resolution,
  quota, spend ledger, /auth flow.) Is there any path where a forged point buys
  real capacity?
- Write a scratch test that submits a freshly generated random point with the
  real public key to verifyCredential and reports the result.
- Verdict: REAL / MITIGATED-ELSEWHERE / NOT REAL, with the evidence.

## Part 2 — What NUT-11 and NUT-12 change (read both first)

Read https://github.com/cashubtc/nuts/blob/main/11.md and 12.md. My findings:

- **NUT-11 (P2PK) is not the fix for Part 1.** It is a spending condition layered
  on a valid proof: the secret is a `["P2PK", {nonce, data: pubkey, tags}]`
  string and the mint requires a Schnorr signature on that secret in
  `Proof.witness`. It presupposes the mint receives `{secret, C, id}` and
  checks `C = k·hash_to_curve(secret)` — exactly the check we skip. Also note
  our `worker/nut11.js` is the passphrase P2SH "Mode 1", unrelated to
  NUT-11 P2PK.
- **What NUT-11 does give us:** B8 Mode 2 (`bind_pubkey`, Locke) is the P2PK
  idea — a credential bound to a keypair so a captured credential cannot be
  spent by anyone else. Check docs/B8-spec-v1.md D-3 against the real NUT-11
  wire format (secret shape, `sigflag`, witness, `locktime`/`refund` tags) and
  list every place our Mode 2 design diverges or could adopt it directly.
- **NUT-12 (DLEQ):** proves the mint used one key `a` for both its published
  pubkey `A` and the signature `C'` (`e, s` returned with the blind signature;
  client checks `R1 = s·G − e·A`, `R2 = s·B' − e·C'`, `e == hash(R1,R2,A,C')`).
  Client-side, offline. Value for us: anti-tagging (a malicious or compelled
  mint cannot secretly use a per-user key to deanonymise), offline
  self-verification of a credit stack. Nonce reuse leaks the mint key — spec
  wants a deterministic rejection-sampled nonce.

Tasks:
- Decide the minimal correct credential format: standard Cashu Proof
  `{amount?, secret, C, id}` with the secret sent and verified via
  `verifyToken`, versus the current `{C, mint_pubkey}`. Migration impact on
  frontend/upload.js, crypto.js, download.js, the MCP repo (`refueler-mcp`),
  and outstanding credentials (there are no paying customers — see below).
- Where DLEQ fits: issue-time (`issueBlindSig` returns e, s) and client verify.
  Which of these are worth doing before B8:
  MCP pre-flight check in `refueler_quote` / `refueler_send_file`;
  Sovereign client-side "valid / unverified" credit-stack check;
  cheaper anonymous-rail admission.
- Sequence against the locked block order (B12-1b → B12-2 → KV-Audit-Opus →
  B12-3… → B8). Recommend: slot before B8, inside KV-Audit-Opus, or as its own
  block. Give a reason.
- CLAUDE.md marketing gates: confirm nothing we currently assert publicly
  (e.g. "anonymous", "double-spend detection") depends on the flawed check. If
  it does, say exactly which claim to pause.

## Context to keep in mind
- Rail/privacy invariants: no Supabase row or email on the anonymous-rail path;
  Worker never sees plaintext; three hashes, three jobs — never conflate.
- No paying customers yet; test data only. That lowers migration cost, not
  severity.
- Reference implementation for the 402 / NUT-24 payment-request shape and
  DLEQ-required token rules: Geata (memory `geata-cashu-reference`); prior
  notes in memory `dleq-roadmap-idea`.
- Berlin btc++ 1–3 Oct (flying 30 Sep, back Sun 4 Oct). Only small ad hoc
  sessions until then — this investigation fits; any build does not.

## Output
1. Part 1 verdict + evidence (test output).
2. A one-page design note: credential format, DLEQ placement, NUT-11 alignment
   with B8, recommended sequence. Save as `docs/Cred-verification-note-v1.md`.
3. Update memory `dleq-roadmap-idea` with the verdict.
4. Close: log Share-Cred-Opus-1 in share-sessions.md; commit with `&& git push`.

Stop and ask if the code contradicts anything above or a third deliverable
suggests itself.
