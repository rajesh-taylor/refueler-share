# Cred-verification-note-v1 — upload credential verification

> Published Cred-Fix-2b · 5 Oct 2026, once the fix was live. Trimmed from a private working note
> (Share-Cred-Opus-1 · 25 Sep 2026). Worker deploys `f7dfbe40` (Cred-Fix-1), `4c9730b2` (Cred-Fix-2a),
> `a5ac4f5d` (Cred-Fix-2b); frontend `ca3972c`.

## What was wrong

Every Share upload is authorised by a Cashu blind-signature credential: the browser blinds a secret,
the Worker signs it, the browser unblinds it and presents it at `POST /upload/:uuid/initiate`, where
it is spent once.

Until Cred-Fix-2 the Worker checked that the presented credential was **well formed**, not that the
Worker had **signed** it. The standard Cashu check — `k · hash_to_curve(secret) == C` — needs the
secret, and the old credential format did not carry one. The function that does the real check
existed but had no caller. The browser also used a non-standard hash-to-curve, so turning the check
on in the Worker alone would have broken every real upload.

**Scope.** Free-tier capacity only: one free transfer per accepted credential, without the bot check.
Tier, size cap and expiry never came from the credential, so paid capacity was never reachable.
Encryption is client-side, so no file content, key or download was ever exposed. Found in an internal
review on 25 Sep 2026.

## What changed

**Cred-Fix-1 (26 Sep 2026)** bounded it the next day: the per-transfer commitment the Worker issues
with each credential is now an HMAC under a Worker secret (`COMMITMENT_KEY`, fails closed), so
`/initiate` only accepts a `(uuid, commitment)` pair the Worker itself issued — which needs the bot
check or an authenticated API call. The same session removed an `X-Email` tier lookup and a resume
branch that could mint credentials without the bot check.

**Cred-Fix-2 (5 Oct 2026)** fixed the verification itself:

- **Credential format v2 is a standard Cashu proof** `{ id, amount: 1, secret, C }`. The secret is a
  64-hex string; its UTF-8 bytes go into NUT-00 `hash_to_curve`. `id` is the NUT-02 keyset id of the
  signing key (unit `"auth"`, non-monetary).
- **The Worker verifies `k · Y == C`** (`verifyProofV2`, compressed bytes, constant-time compare)
  and spends serial `hex(Y)` (NUT-07 convention). Unknown fields are refused. Format v1 is refused
  with `401`, nothing spent.
- **The issue response carries a NUT-12 DLEQ proof** (deterministic nonce), and the browser checks it
  before unblinding. The key is not pinned in the browser: the check proves the signature matches the
  key sent with it. Pinning matters once credentials are bought separately from transfers
  (anonymous rail, B7/B8).
- **No hand-rolled curve maths on either side.** Worker and browser both use `@cashu/cashu-ts` 4.11.0;
  the browser copy is a reproducible vendored bundle (`frontend/cashu-crypto.js`, built by
  `bin/vendor-cashu.sh` from a pinned lockfile). Official NUT-00 / NUT-02 / NUT-12 test vectors are
  pinned in `worker/test/credential-v2.test.js`. Because the proofs are standard, moving to a
  dedicated Cashu mint later is a keyset migration, not a format change.

## What blinding does and does not give you

On the consumer upload path the Worker issues the transfer UUID in the same response as the blind
signature and sees that UUID again at `/initiate`, so issue and upload are linkable by design.
Share's anonymity today comes from having **no account, no email and no identity** — not from the
blind signature. Copy must never credit blinding for unlinkability. Unlinkability from blinding
arrives only when credentials are bought separately from the transfer they pay for (anonymous rail).

## Still open

- **MCP send tool** (`refueler-mcp`): not yet on credential format v2 or the direct-to-R2 upload path.
  The package is unpublished until MCP-Fix-1 ships.
- **Lightning-paid issuance** (B7): placeholder only, not live; it will take a real client blinded
  message.
- **Admin test credentials**: separate path, hardened under B12-SR S2.
- **Client DLEQ key pinning**: with the anonymous rail (B7/B8).
