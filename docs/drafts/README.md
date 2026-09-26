# docs/drafts — ideas on file, not specs

Nothing here is locked, live, or approved copy. Not mirrored, not deployed.

Plans-page files share one artifact: https://claude.ai/artifact/TQAzGcWVuQy4VA4gTbmf4X. Artifact version N = draft vN (v0 file = version 1). Each file is an artifact-page fragment (no `<html>` wrapper); open via the artifact link or its version history.

| File | Session | What it is |
|---|---|---|
| `plans-page-agents-first-v0.html` | Share-MCP-Chat-1 · 26 Sep 2026 | Plans-page A/B mockup (artifact version 1). **Rajesh prefers B (Agents first).** Abolished tokens (see notes). |
| `plans-page-agents-first-v2.html` | Share-Plans-Draft-2 · 26 Sep 2026 | Legal-register experiment (artifact version 2). Register first as a ruled schedule, status by type weight, no chips. **Rejected:** read more legal but didn't work for the first readers, who are technical staff at legal firms. Kept for reference. |
| `plans-page-agents-first-v3.html` | Share-Plans-Draft-2 · 26 Sep 2026 | **Current** (artifact version 3). v0 layout B with `global.css` tokens: code box in the hero, register with status chips (retuned from `--success`/`--warn`/`--accent`), Citizen + Sovereign as two shaded columns under "One plan. Choose your rail: Registered or Bearer.", MCP tools + sandbox + credits, personal agent key (Proposed), "For IT and procurement" block, footnote notes * † ‡ §. Paper/Carbon pill; viewer dark mode → Carbon. For mark-up after Berlin. |

## Plans page B — notes for the post-Berlin rewrite (after B12-4a)

- **Decided (26 Sep):** code box in the hero, register straight after it. Chips stay. Rail wording is "One plan. Choose your rail: Registered or Bearer." Don't say "identity rail" in public copy: it's the internal name for the Registered rail only.
- **Colours:** v0 used the abolished `DESIGN-TOKENS.md` values (`#F7F4EF` / `#1E1F22`, orange action). The canonical source is `refueler.io/src/assets/css/global.css` (Paper `#E8E2D8` / Carbon `#1A1917`, primary button = `--submit-bg`). `DESIGN-TOKENS.md` and `share-tokens.css` are both stale.
- **Register lesson from v2:** a legal register for this page comes from the words and the tier names, not from removing colour. Status must scan at a glance.
- **Copy:** trim words; Rajesh will mark up. Keep the Live / In build / Coming / Proposed tags until the features actually ship.
- **Pro Bono × agents:** undecided — a free agent send path, or no agent access on Pro Bono at all.
- **Credits worked examples** use an illustrative v2 draft rate (10/transfer + 1 credit per 32 MiB block per week held). Not a price. Replace with whatever Pricing-v2-Opus locks.
- **Personal agent key** is shown as "Proposed" — it conflicts with the locked `Sovereign ⊅ API`; needs an Opus decision before public copy.

## Held back from v3 — add when the gating work lands

From the advisor pass (MCP consultant · IT head and procurement · fintech/heritage branding), 26 Sep 2026.

| Item | Why it's out | Add when |
|---|---|---|
| MCP config snippet (install + key/env/sandbox) | Package `@refueler/mcp-server` not yet on npm | After the manual `npm publish` (SW-MCP-8) |
| Per-tool status for the four MCP tools | Each tool ships the day its backing product is live; v3 marks the whole server In build | As each backing product goes live; anonymous-rail send after SW-MCP-7 (B7/NB-4) |
| Named sub-processors (Cloudflare, Stripe, Supabase) and data region | R2 location unconfirmed; a sub-processor list is close to a legal statement | After confirming the R2 location and a legal read |
| Monthly credit allocations and overage ceiling (Chartered) | Numbers wait on the rate card | Pricing-v2-Opus |
| Agent daily spend ceiling as a Chartered feature | Tied to allocation and overage design | Pricing-v2-Opus |
| "DPA on request" | Locked only for the unlisted Personal API path | Decide whether it applies to all of Chartered |
| Security summary / review pack link | No document exists yet | When written; wording must respect the "not audited" rule |
| "We never see the file name" | Depends on fragment grammar v1 (D-1) being live on both consumer and MCP paths | Verify SW-MCP-4 is shipped end-to-end, then add to "What we hold" |
| Team seats as a feature | Sovereign Teams not sized | SW-Teams-1 |
| Real site nav in the header copy | Mockup shows wordmark + theme pill only, to avoid inventing nav | At the build session, from refueler.io's header partial |
| Satoshi in wordmark and pill | Not on Google Fonts; draft falls back to DM Sans | Automatic on refueler.io |
