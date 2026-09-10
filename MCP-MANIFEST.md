# MCP-MANIFEST.md — Refueler Share MCP server
> Version: 1.0 | Created: SW7 · 10 Sep 2026
> Three audiences: principal (what it does), IT team (how to configure),
> agent (tool descriptions and parameter schemas).
> Architectural invariant: MCP server runs in the agent's trust domain.
> Handles ciphertext only. Never a Refueler-hosted plaintext endpoint.

---

## For the principal — what this does

Refueler Share can be used by your AI agents and automated systems to send and
track encrypted file transfers, without those files passing through any server
in readable form.

The encryption happens entirely within your own environment — on your machine,
your server, your agent's compute. Refueler receives only the encrypted result.
We cannot read your files. We cannot be compelled to hand them over in readable
form because we do not have them.

Your agents can:
- Send an encrypted file to a recipient and receive a share link
- Check whether a transfer has been collected
- Query their available credit and the current cost of actions

What your agents cannot do via this interface:
- Decrypt or read any file (the key lives in the share link fragment, which
  Refueler never sees)
- Exceed your credit balance (the API returns a clear error before attempting)
- Access any other client's transfers

---

## For the IT team — how to configure

The MCP server is a piece of software you deploy and run in your own environment.
It is not hosted by Refueler. It calls the Refueler Share API on your behalf,
using credentials you supply.

**What the MCP server does:**
- Accepts plaintext files from your agent
- Encrypts them locally (AES-GCM, key derived in your environment)
- Sends only the ciphertext to `api.share.refueler.io`
- Returns the share link (including the decryption key in the URL fragment)
  to your agent

**What the MCP server never does:**
- Send plaintext file content to Refueler
- Store credentials anywhere other than the environment variables you configure
- Open any inbound port (outbound to `api.share.refueler.io` only)

**Environment variables required:**

```
REFUELER_API_KEY=rfs_live_...
REFUELER_SIGN_KEY=rfs_sign_...
REFUELER_BASE_URL=https://api.share.refueler.io   # or sandbox URL
```

For sandbox testing, supply your `rfs_test_` credentials. The `refueler_capabilities`
tool will return `"environment": "sandbox"` — confirm this before sending any
real cargo.

**Network egress:** outbound HTTPS to `api.share.refueler.io` on port 443 only.
No other egress required.

**Webhook secret:** if you have registered a webhook endpoint, also set:
```
REFUELER_WEBHOOK_SECRET=rfs_whsec_...
```
This is used to verify inbound webhook signatures, not for outbound calls.

---

## For the agent — tool descriptions and parameter schemas

### `refueler_capabilities`

**Description:**
Report this client's Refueler Share tier, rail, available features, current
rate-card version, environment (live or sandbox), and available balance.
Call this before any transfer to confirm the environment and available credit.
A sandbox environment will return `"environment": "sandbox"` — do not send real
cargo in sandbox.

**Parameters:** none

**Returns:**
```json
{
  "environment": "live | sandbox",
  "rail": "identity | anonymous",
  "tier": "api",
  "rate_card_version": "v1.0",
  "features": ["capability_discovery", "ots_webhook", "receipts"],
  "balance_sats": 48200,
  "balance_display": "48,200 sat (approx. £24.10 at v1.0 reference rate)",
  "quote": {
    "transfer_base_sats": 10,
    "transfer_per_gb_sats": 100,
    "permanent_record_sats": 20,
    "capability_discovery_sats": 0
  }
}
```

**Suppressed:** `apiKeyHash`, raw credential values, R2 internals, AE fields,
rate-limit counters, dead-letter queue state.

---

### `refueler_send_file`

**Description:**
Encrypt a file locally and upload the ciphertext to Refueler Share.
Encryption happens entirely within this environment — Refueler never receives
the file or the decryption key. Returns a share link. The decryption key is
in the URL fragment and must be transmitted to the recipient by a separate channel.

**Parameters:**
```json
{
  "file": {
    "type": "bytes",
    "description": "File content as bytes. Encrypted locally before transmission.",
    "required": true
  },
  "filename": {
    "type": "string",
    "description": "Original filename including extension.",
    "required": true
  },
  "expiry_hours": {
    "type": "integer",
    "description": "Transfer expiry in hours from now. Default: 168 (7 days). Maximum: 720 (30 days).",
    "required": false
  },
  "permanent_record": {
    "type": "boolean",
    "description": "If true, anchor a Bitcoin-timestamped existence proof for this transfer. Costs an additional 20 sat. Does not affect privacy — the proof is of bytes existing, not of content or identity.",
    "required": false,
    "default": false
  }
}
```

**Returns:**
```json
{
  "transfer_id": "uuid",
  "share_url": "https://refueler.io/share/#fragment...",
  "expires_at": 1234567890,
  "sat_cost": 10,
  "balance_remaining_sats": 48190,
  "receipt_url": "https://api.share.refueler.io/api/v1/receipt/{uuid}/accepted"
}
```

**Note:** `share_url` includes the decryption key in the fragment. The fragment
is never sent to Refueler. Transmit the full URL to your recipient via a secure
channel of your choice.

**Suppressed:** R2 chunk keys, manifest internals, BLAKE3 root (Merkle
verification not yet complete — see whitepaper §Future work), passphrase internals.

---

### `refueler_check_transfer`

**Description:**
Return the current status of a transfer by its ID: awaiting collection, collected,
expired, or scheduled for destruction. Includes acceptance and collection receipts
where issued.

**Parameters:**
```json
{
  "transfer_id": {
    "type": "string",
    "description": "The transfer UUID returned by refueler_send_file.",
    "required": true
  }
}
```

**Returns:**
```json
{
  "transfer_id": "uuid",
  "status": "awaiting_collection | collected | expired | scheduled_for_destruction",
  "created_at": 1234567890,
  "expires_at": 1234567890,
  "receipts": {
    "accepted": true,
    "collected": false,
    "accepted_url": "https://api.share.refueler.io/api/v1/receipt/{uuid}/accepted",
    "collected_url": null
  }
}
```

**Suppressed:** `pending_destruction` raw flag, AE fields, Worker stack traces
(mapped to clean error strings), recipient metadata (architecture never holds it).

---

## Honest scope — what to state in any client-facing MCP documentation

- The MCP server is open source and auditable. Clients may review its encryption
  implementation.
- "Private, not anonymous" on the identity rail: Refueler holds your API credentials
  and can associate transfer metadata with your account. File content remains encrypted.
- "Anonymous" on the anonymous rail: Refueler holds no account, no email, no identity
  record. Transfer metadata (size, timing, chunk count) is retained minimally under
  Refueler's privacy notice for security purposes. Users requiring removal of IP from
  that footprint should tunnel their own VPN.
- Do not claim "end-to-end integrity" until the B9 Merkle audit is complete.
- Do not claim "proof of delivery" — Refueler issues acceptance receipts and
  collection receipts. Delivery is unprovable.

