# docs/drafts — ideas on file, not specs

Nothing here is locked, live, or approved copy. Not mirrored, not deployed.

| File | Session | What it is |
|---|---|---|
| `plans-page-agents-first-v0.html` | Share-MCP-Chat-1 · 26 Sep 2026 | Plans-page A/B mockup (artifact https://claude.ai/artifact/TQAzGcWVuQy4VA4gTbmf4X). **Rajesh prefers B (Agents first).** Artifact-page fragment (no `<html>` wrapper); open via the artifact link. |

## Plans page B — notes for the post-Berlin rewrite (after B12-4a)

- **Order:** move "The register" (tier table) to the top; put the `refueler_send_file` code snippet **below** the register, with the credits + agent sections.
- **Colours are wrong for Share:** the draft used canonical `DESIGN-TOKENS.md` (`#F7F4EF` / `#1E1F22`) and followed the OS theme. Live Share uses `share-tokens.css` (Paper `#F5F0E8` / Carbon `#1A1A1A`) with the site's own Paper/Carbon toggle (`data-theme="carbon"`). Use the live tokens and the site's theme toggle; the canonical-vs-live divergence is still open in `DESIGN-TOKENS.md`.
- **Copy:** trim words; Rajesh will mark up. Keep the Live / In build / Coming / Proposed tags until the features actually ship.
- **Pro Bono × agents:** undecided — a free agent send path, or no agent access on Pro Bono at all.
- **Credits worked examples** use an illustrative v2 draft rate (10/transfer + 1 credit per 32 MiB block per week held). Not a price. Replace with whatever Pricing-v2-Opus locks.
- **Personal agent key** is shown as "Proposed" — it conflicts with the locked `Sovereign ⊅ API`; needs an Opus decision before public copy.
