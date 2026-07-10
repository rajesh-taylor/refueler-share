# R2 Lifecycle Rules — refueler-share

Two rules applied to `refueler-share-prod` (and mirrored to `refueler-share-dev`).

The Worker enforces expiry at the application layer via `manifest.expiry_timestamp`.
These R2 rules are the cleanup backstop — they handle objects that are never re-requested
after their expiry window closes.

---

## Rule 1 — Abort incomplete multipart uploads (24 hours)

Cleans up partial chunk uploads that were abandoned (browser closed mid-transfer,
network failure before the final chunk, etc.). Applies to the entire bucket — no prefix filter.

```
wrangler r2 bucket lifecycle set refueler-share-prod --rule '{"id":"abort-incomplete-multipart","status":"Enabled","filter":{},"abortIncompleteMultipartUpload":{"daysAfterInitiation":1}}'
```

For the dev bucket:
```
wrangler r2 bucket lifecycle set refueler-share-dev --rule '{"id":"abort-incomplete-multipart","status":"Enabled","filter":{},"abortIncompleteMultipartUpload":{"daysAfterInitiation":1}}'
```

---

## Rule 2 — Object expiry backstop (92 days)

Deletes all objects that have not been requested for 92 days.
92 = Production Max maximum link duration (90 days) + 2-day buffer.

Free tier links expire at 5 days — these objects will be deleted by the Worker on next access
attempt (returns 410). The R2 rule provides a hard deletion backstop for objects
no one ever re-requests.

```
wrangler r2 bucket lifecycle set refueler-share-prod --rule '{"id":"expiry-backstop","status":"Enabled","filter":{},"expiration":{"days":92}}'
```

For the dev bucket:
```
wrangler r2 bucket lifecycle set refueler-share-dev --rule '{"id":"expiry-backstop","status":"Enabled","filter":{},"expiration":{"days":92}}'
```

---

## Verify rules are applied

```
wrangler r2 bucket lifecycle get refueler-share-prod
```

Expected output:
```json
{
  "rules": [
    {
      "id": "abort-incomplete-multipart",
      "status": "Enabled",
      "abortIncompleteMultipartUpload": { "daysAfterInitiation": 1 }
    },
    {
      "id": "expiry-backstop",
      "status": "Enabled",
      "expiration": { "days": 92 }
    }
  ]
}
```

---

## Notes

- Rules are applied via Wrangler CLI, not Terraform. Wrangler is the single source of truth for R2 config.
- Bucket creation: `wrangler r2 bucket create refueler-share-prod` and `wrangler r2 bucket create refueler-share-dev`
- Direct R2 URL exposure: none. The Worker proxies all R2 access. The bucket is never public-facing.
- Worker binding name: `R2` — matches `wrangler.toml` binding.
