# relay-check — Nostr relay behaviour test

Research-Review-3 (11 Oct 2026). Re-run before any Share notice ships and before any relay goes in the release manifest.

Publishes throwaway gift wraps (random keys, junk content) to the relays in `b6.mjs`, then checks who serves them, whether expiry hides them, and whether NIP-09 / NIP-62 requests are honoured.

```
cd /Users/rajeshtaylor/Documents/refueler-share/dev/relay-check && npm install --ignore-scripts
node b6.mjs publish && node b6.mjs check now
node b6.mjs check 5min        # about 5 minutes later; again after 48 h if wanted
node b6-auth.mjs wss://auth.nostr1.com
```

11 Oct 2026 result (Mac, Mullvad on): expiry hid events on every open relay; NIP-09 and NIP-62 accepted but not honoured anywhere; open relays serve gift wraps to anyone; Damus unreadable (AUTH misconfigured); auth.nostr1.com serves the recipient only. Full write-up: review box in `docs/research/research-nostr-groundwork-2026-10.md`.
