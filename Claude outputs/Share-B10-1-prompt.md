# Share-B10-1 Session Prompt

You are the technical co-builder of **refueler-share**: privacy-first anonymous encrypted file transfer. I am a non-technical solo founder. Read the project docs before doing anything — especially `Share-Master-Context.md`, `share-sessions.md`, `CLAUDE.md`, and `DESIGN-TOKENS.md`.

**Session: Share-B10-1**

## Context

All B9 bugs are fixed and committed (DAD-BUG, CAP-WARNING-LINK, PHOENIXD-TOGGLE). A 100 GiB soak test (3,200 × 32 MiB, 8 parallel) is running — do not touch orphan sweep until I confirm it passed.

## This session: B10 Navy Office dashboard

Work through the punch list below in order. Provide exact terminal commands with full paths. Single-line curl only. No unrequested documentation. Always write produced files to `/mnt/user-data/outputs/` so I can download and manually place them.

### Punch list (priority order)

**1. `GET /admin/btc-price` Worker endpoint**
- Proxy CoinGecko `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp`
- KV cache key `btc:price:gbp`, TTL 600–900 s (10–15 min)
- Returns `{ price_gbp: number, cached_at: unix_timestamp }`
- Admin-key gated

**2. `GET /admin/growth-snapshot` Worker endpoint**
- Query Analytics Engine for cumulative user counts by tier (Free / Paid / API)
- Returns time-series data for D/W/M/Y ranges
- Admin-key gated

**3. Growth Signal card redesign (frontend)**
- Replace manual-entry form with auto-populated time-series line graph
- Three lines: Free (gold) / Paid (green) / API (amber)
- BTC/GBP right Y-axis overlay (from btc-price endpoint)
- D/W/M/Y toggle (in-memory, default Month)
- Manual annotations retained as vertical tick-mark overlays (date + label + note)

**4. Dashboard card fixes**
- Client Errors (Worker 90d): remove empty `Message` column
- Client Errors (Browser 24h): hide Browser column rows where Unknown / add tooltip noting UA data only from Aug 2026
- Client Errors (Browser 24h): fix `receiver_ab_downloaded` — currently routed to `/log/error`, should use AE `logEvent()` (B7 snag S93–S95)
- API & MCP card: relabel 6,307 headline (it counts ALL requests including 6,300 Pro Bono) — add Pro Bono sub-line, filter to Registered+Bearer for headline
- Credential Issuances: replace trend placeholder stub with real daily AE line graph

## Stack reminders

- Worker deploy: `npm run deploy` from `worker/` only — never `npx wrangler deploy`
- `crypto.getRandomValues()` hard cap 65,536 bytes per call — loop for larger buffers
- Do not claim "end-to-end file integrity" anywhere
- No plaintext root in Worker, no `verified:true` on receipts
- Carbon (#1A1A1A) / Paper (#F5F0E8) design system, Paper/Carbon toggle
- CDK pinned at 0.17.2

## When soak test passes (I will confirm in this session)

Run orphan sweep:
```
curl -X DELETE "https://api.share.refueler.io/admin/orphan-sweep?dry_run=false" -H "X-Admin-Key: <key>"
```
