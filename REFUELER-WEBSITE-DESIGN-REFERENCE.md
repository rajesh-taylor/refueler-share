# REFUELER-WEBSITE-DESIGN-REFERENCE.md
> **Produced:** CSS-1 · 2026-08-08 · Opus planning session (uncounted)
> **Status:** Source of truth for CSS-2 → CSS-6. Read in full before touching any CSS.
> **Scope:** The three web surfaces — `refueler.io` (main site + editorial + notes + legend shell), `share.refueler.io` (Share), and the Legend product surface. Does **not** cover the React Native app, the Numo merchant terminal, or the Command Centre HTML tools — those have their own token conventions.
> **Method:** Every statement below is cross-referenced against the *live* files on `main` (pulled 2026-08-08), not against cached context. Where a governing document and the live file disagree, both are quoted and the item is flagged **DECISION NEEDED**.

Governing documents cross-referenced: `claude.md` (Project DNA v4.9), `REFUELER-BRIDGE.md` (v2.2), `Refueler_MasterContext_IO_CC80.md`.
Live files pulled:
- `refueler-io/src/assets/css/global.css`
- `refueler-io/src/assets/css/home.css`
- `refueler-io/src/assets/css/legend.css`
- `refueler-io/src/notes/notes.css`
- `refueler-io/src/_includes/head.njk`
- `refueler-share/frontend/share-tokens.css`

---

## 0. The one-paragraph summary

Fonts are consistent everywhere and locked. The token *values* are consistent where they're used, but the token *architecture* is not: `global.css` ships two parallel naming systems (`--fg*` and `--text-*`), and different pages depend on different ones — `legend.css` on `--fg`, `notes.css` on `--text-primary`. Two pages that are marked "clean" (`notes.css`, `legend.css`) still carry their own `:root` blocks. Share runs a separate but broadly parallel token file with heavier borders, a single 6px radius, and several off-palette status colours. Four items are genuine contradictions between the DNA/BRIDGE/MasterContext documents and need a founder decision before rationalisation begins. Everything below is the detail.

---

## 1. Theme model (read this first)

| Property | Value | Source (live) |
|---|---|---|
| Default theme (public web) | **Paper** | `head.njk` L63 `applyTheme(getCookie('rs-theme') || 'paper')`; `global.css` `:root` is Paper |
| Alternate theme | Carbon, applied as override | `global.css` `[data-theme="carbon"]` |
| Detection | `document.documentElement.dataset.theme === 'carbon'` — **only** | all files; never `classList.contains` / `html.carbon-mode` |
| Persistence | cookie `rs-theme`, scoped `.refueler.io`, 30-day rolling, `SameSite=Lax` | `head.njk` L42–44 |
| Applied | before first paint, in `head.njk` inline script | `head.njk` L36–65 |
| Toggle | `window.toggleTheme` global, wired to nav pill `onclick` | `head.njk` L57 |

> **Note the split with the app/terminal surfaces.** Per `claude.md` §2, **Carbon is the default on the app/mobile and all Command Centre surfaces; Paper is the default only on the public website and editorial.** The web files above correctly ship Paper-default. This is *not* a bug — it is the intended split. See Conflict C-2 for where MasterContext contradicts it on the homepage specifically.

---

## 2. Colour — canonical token values (web surfaces)

These are the values in live `global.css`. Treat this table as canonical for `refueler.io`. Share divergences are catalogued in §8.

### Paper (default)
| Token | Value | Notes |
|---|---|---|
| `--carbon` | `#1A1A1A` | raw brand constant |
| `--paper` | `#F5F0E8` | raw brand constant |
| `--bg` | `var(--paper)` | page background |
| `--fg` | `var(--carbon)` | body text (primary system) |
| `--fg-muted` | `#5A5550` | |
| `--fg-subtle` | `#9A9590` | |
| `--border` | `rgba(26,26,26,0.12)` | |
| `--nav-bg` | `#F5F0E8` | solid — no blur |
| `--input-bg` | `#FFFFFF` | |
| `--input-border` | `rgba(26,26,26,0.18)` | |
| `--divider-color` | `rgba(26,26,26,0.14)` | |
| `--metric-block-bg` | `rgba(26,26,26,0.04)` | |
| `--submit-bg` / `--submit-fg` | `var(--carbon)` / `var(--paper)` | |
| `--surface` | `#EDEAE4` | BRIDGE surface token |
| `--surface-raised` | `#E4E1DA` | |
| `--text-primary` | `#3D3A36` | **second parallel system** |
| `--text-secondary` | `#5A5751` | |
| `--text-tertiary` | `#9A948D` | |
| `--accent` | `#C8A96E` | gold — brand chrome, never CTA |
| `--accent-hover` | `#E0C48A` | |
| `--accent-action` | `#D4690A` | CTA orange (Paper). Defined, **not consumed** in live CSS. |

### Carbon (override)
| Token | Value | Notes |
|---|---|---|
| `--bg` | `var(--carbon)` | |
| `--fg` | `var(--paper)` | |
| `--fg-muted` | `#B0AAA2` | |
| `--fg-subtle` | `#6A6560` | |
| `--border` | `rgba(245,240,232,0.10)` | |
| `--nav-bg` | `#1A1A1A` | solid |
| `--input-bg` | `#252525` | |
| `--input-border` | `rgba(245,240,232,0.18)` | |
| `--surface` | `#26282C` | |
| `--surface-raised` | `#2E3035` | |
| `--text-primary` | `#E4E2DC` | |
| `--text-secondary` | `#8A8680` | |
| `--text-tertiary` | `#5A5751` | |
| `--accent` | `#C8A96E` | |
| `--accent-hover` | `#E0C48A` | |
| `--accent-action` | `#F5820A` | ⚠️ **DECISION NEEDED** — see C-1 |

### Named brand colours (from DNA/BRIDGE, not all present as tokens)
| Name | Hex | Usage | Present as token? |
|---|---|---|---|
| Carbon | `#1A1A1A` | dark bg / dark fg | yes |
| Paper | `#F5F0E8` | light bg / light fg | yes |
| Gold | `#C8A96E` | chrome, inset-rule, dividers, blockquote — **never a primary CTA** | yes (`--accent`) |
| Gold hover | `#E0C48A` | | yes |
| CTA orange (Paper) | `#D4690A` | consumer CTA only | yes (`--accent-action`) |
| CTA orange (Carbon) | `#F5820A` | consumer CTA only *(disputed)* | yes (`--accent-action`) ⚠️ C-1 |
| Warn (Paper) | `#B87333` | status / warm CTA | **no** — not a web token |
| Warn (Carbon) | `#C8943A` | status / warm CTA | **no** on web; Share has `--c-amber: #C8943A` |
| Danger | `#E05252` | destructive only | **no** on web; Share has `--c-red: #E05252` |
| Credential-status green | `#1E8A4A` | Legend cred dot — operational status, **not** premium | hardcoded in `legend.css` L138 |

**Canonical hex lock (repeat, because drift keeps happening):** Carbon is `#1A1A1A`. Paper is `#F5F0E8`. The values `#1E1F22` and `#F7F4EF` are **wrong** and must never appear. `EDITORIAL-MASTER.md` predates this lock and its token values are wrong — do not copy from it.

---

## 3. Typography — locked

Loaded globally in `head.njk` L23–25: **DM Sans** (300–700, incl. italic), **IBM Plex Mono** (400, 500), **Satoshi** (400, 500, 600, 700 via Fontshare). Page-specific display faces are loaded in the page's own `.njk`, never in `head.njk` or `global.css`.

| Role | Family | Weight | Where used | Loaded |
|---|---|---|---|---|
| Heading / wordmark / labels / metric values | `'Satoshi', 'DM Sans', sans-serif` | 600 (chrome), 700 (Legend wordmark/metrics) | nav, footer, card titles, eyebrows, Legend chrome | global |
| Body / UI | `'DM Sans', sans-serif` | 300 default; 400/500/600 hierarchy | everything | global |
| Editorial / notes body, table cells, inset-card body | `'Source Serif 4', Georgia, serif` | 300 / 400 | `/notes/` article + card body, standfirsts, CTA text | **page-level** (referenced in `notes.css` as `--font-serif`; must be linked by the notes template) |
| Telemetry / codes / data / table cells | `'IBM Plex Mono', monospace` | 400 / 500 | timestamps, codes, Legend query input, data tables | global |
| Homepage headline **only** | `'Cormorant Garamond', Georgia, serif` | 600 | homepage `<h1>` | **`src/index.njk` only** (locked CC-79) |

Font-alias tokens exist in two places and should be unified in rationalisation:
- `legend.css` `:root`: `--font-heading`, `--font-sans`, `--font-mono`
- `notes.css` `:root`: `--font-heading`, `--font-serif`, `--font-sans`, `--font-mono`
- `share-tokens.css` `:root`: `--display`, `--heading`, `--sans`, `--serif`, `--mono`
- `global.css`: **no font aliases** — uses literal family strings inline.

> Gap G-3: four files, three different alias vocabularies for the same five faces. Pick one set in CSS-3.

---

## 4. Structural tokens

| Property | `global.css` (canonical, matches BRIDGE) | `share-tokens.css` (live) | BRIDGE says |
|---|---|---|---|
| Card radius | `--radius-card: 10px` | `--radius: 6px` (all radii) | 10px |
| Button radius | `--radius-btn: 8px` | `--radius: 6px` | 8px |
| Modal radius | `--radius-modal: 12px` | `--radius: 6px` | 12px |
| Border weight | `--border-weight: 0.5px` | `1px` (hardcoded on header/footer/nav/cards) | 0.5px throughout |
| Theme transition | `--theme-transition: 0.35s` | `0.35s` (hardcoded) | 0.35s |

> Divergence D-1: Share ships 1px borders and a single 6px radius. `refueler.io` matches BRIDGE (0.5px, 10/8/12). Not a bug per se — Share was built as its own surface — but it is a *visible* inconsistency between the two domains a user crosses via the shared nav.

---

## 5. Locked copy registry

Copy is not available for reassignment. Home copy is locked for one month from CC-79 (no iteration without a formal session decision).

### Homepage (`refueler.io/`) — locked CC-79
| Slot | Text | Face |
|---|---|---|
| Overline | `Privacy Infrastructure · London` | Satoshi 500, gold `#C8A96E !important` |
| Headline | `Your transaction / is nobody else's / business.` (three forced `<br>` lines) | Cormorant Garamond 600 |
| Subhead | `Privacy isn't a feature. It's the architecture.` | DM Sans 300, full `--fg`, in `.home-subhead-band` div |
| Capability 1 | **Encrypted transfers** — *The server is blind, so is the till.* | Satoshi label / DM Sans desc |
| Capability 2 | **Bitcoin explorer** — *Your search history is showing.* | " |
| Capability 3 | **Lightning payments** — *Tap and go. Sats or card, your call.* | " |

- Accent column (`Est. 2026 / rule / REFUELER`) **removed** CC-79 (grid broke live). Revisit with Companies House reg number.
- `"Fiat or Bitcoin — privacy included."` **retired** from homepage CC-79 — product pages only.

### Legend index (`refueler.io/legend`) — locked CC-77/78
| Slot | Text |
|---|---|
| Headline | `Bitcoin, privately.` *(reserved for Legend index exclusively)* |
| Opening | `Buys non-KYC Bitcoin, then logs every address ever searched…` |
| Homepage capability label→page reveal | label `Bitcoin explorer` / descriptor `Your search history is showing.` |

Discarded Legend candidates (do **not** resurrect): "Your queries don't leave a record." / "Check your addresses. We won't remember that you did." / "Look up what you need. Nothing is logged." / "The privacy gap you didn't know you had." / "We can't see what you're watching. Neither can anyone else." (the last is permitted only as a mid-page feature claim, never the opener).

### Share — locked CC-77
| Line | Home |
|---|---|
| `Built for jurisdictions that have laws. And lawyers.` | Share API / paid plans page |
| `Lightning payments — Tap and go. Sats or card, your call.` | Share paid plans / upgrade page |
| Positioning | `Professional-grade anonymity where only one side needs to be sophisticated.` |
| B9 whitepaper framing | `The server is blind and so is the till.` |

### Reserved / internal — never copy
- North star (**internal only, never rendered**): `They come for privacy, they stay and then fall in love with Bitcoin.`
- Ecosystem tagline: `Nothing stops this train.` (doc footer signature; not marketing copy)

### Never-say list (applies to all web copy)
"military-grade" · "zero-knowledge" as a headline · "Swiss-grade privacy" · "anonymous payments"/"anonymous payment" · "audit-certified"/"security-audited" (blocked until B11 pentest published) · "end-to-end file integrity" (only server-side chunk integrity is verified today) · "C2C"/"c2c" (always "Fenchurch St line").

---

## 6. CSS architecture rules — locked

1. **Token ownership.** One token file per domain owns *all* tokens: `global.css` on `refueler.io`, `share-tokens.css` on `share.refueler.io`. No page defines its own `:root` token block. *(Currently violated — see §7.)*
2. **Load order.** Every page loads its domain token file (via `head.njk`) before any other CSS. Page CSS is layout-only.
3. **No body-level theme scripts.** `head.njk` is the single theme-script owner per domain.
4. **No `backdrop-filter` / frosted glass on any surface.** Nav and cards are solid. *(One survivor — see D-3.)*
5. **Cascade caveat (the CC-79 lesson).** `global.css` body sets `color: var(--fg)`, which cascades into every `p`, `h1`, `span`. A page-level colour override on those elements needs either `!important` or a prefixed class to win. **`var(--accent)` will not override the body cascade on `<p>`** — use hardcoded `#C8A96E !important` for gold on `p` until the cascade is fixed in rationalisation.
6. **Prefixing.** Homepage classes are all `home-` prefixed as cascade defence. Locked — do not touch `home-*` in home.css outside a formal decision.
7. **Font loading.** Page-specific display fonts load in the page `.njk` only.
8. **No inline CSS/JS in Nunjucks templates** — external files only.
9. **Index.njk naming.** Claude-produced `index.njk` files carry a section prefix (e.g. `home-index.njk`); real name applied on placement. When several are uploaded for review, one at a time — same filename overwrites in context.

---

## 7. Per-file responsibility map — declared vs. actual

| File | Should own | Actually contains (live) | Verdict |
|---|---|---|---|
| `global.css` | all tokens, reset, nav, footer | ✅ tokens + reset + nav + footer. **But** ships two parallel token systems (`--fg*` and `--text-*`) in one `:root`. | Clean-ish. Dual system is the core rationalisation target. |
| `home.css` | homepage layout, `home-` prefixed | ✅ layout only, no `:root`, all `home-` prefixed. Heavy `!important` use (cascade defence). | Clean. `!important` to be stripped in CSS-6 once cascade is fixed. |
| `legend.css` | Legend layout only | ⚠️ layout **plus a `:root` block** (L9–20) defining `--font-heading/-sans/-mono`, `--border-mid`, `--inset-rule`, and a `[data-theme="carbon"]` override of the same. Does **not** redefine base tokens. | **Not clean** (soft). Move font aliases + border-mid/inset-rule to `global.css`. |
| `notes.css` | notes layout only | ❌ **full `:root` token block** (L8–52) + own reset + duplicate nav/footer/theme-pill. Body text runs on `--text-primary`, not `--fg`. Border hexes are solid (`#D6D1C8` Paper, `#35373B` Carbon) vs global's `rgba()` values. | **Not clean.** Largest CSS-2/CSS-6 item. |
| `share-tokens.css` | all Share tokens, reset, nav, footer, shared components | ✅ single token source for Share. Heavier borders (1px), single 6px radius, off-palette status/utility colours. | Clean *as a token file*, but diverges from BRIDGE structural + palette locks (§4, §8). |
| `head.njk` | meta, fonts, global.css link, theme script | ✅ correct. Loads DM Sans + IBM Plex Mono + Satoshi only (correct — serif/display are page-level). | Clean. |

**What "clean" should mean going forward (proposed for CSS-3):** a page CSS file contains *no* `:root` block of any kind — not base tokens, not font aliases, not border/inset helpers. Everything token-shaped lives in the domain token file. Under that definition, both `legend.css` and `notes.css` currently fail, contradicting MasterContext's "✅ Clean" marks.

---

## 8. Share-specific palette & structural drift (catalogue for CSS-2)

All live in `share-tokens.css`. None are on the canonical web palette:

| Item | Value | Canonical equivalent | Note |
|---|---|---|---|
| `--gold-dim` | `#9E8050` | none | Share-only gold variant |
| `.cap-warn` | `#D97706` | Warn Paper `#B87333` / Carbon `#C8943A` | off-palette amber |
| `.success-txt` | `#27AE60` | none defined | off-palette green |
| `.danger-txt` | `#C0392B` | Danger `#E05252` (= `--c-red`) | class ignores its own token |
| status-banner maintenance | `#C8951` mix… `#C8A951` | Warn Carbon `#C8943A` | near-miss gold |
| status-banner degraded | `#C0392B` | Danger `#E05252` | off-palette red |
| `--c-amber` / `--c-red` | `#C8943A` / `#E05252` | ✅ match Warn-Carbon / Danger | these two are correct; the utility classes above bypass them |

Borders: 1px throughout (BRIDGE: 0.5px). Radius: single 6px (BRIDGE: 10/8/12). Header/footer border uses `--inset-rule` (= `--border`, or gold in Carbon) at 1px.

> These are all *Share-local* decisions that were never reconciled to BRIDGE. CSS-2 should decide per-item: promote to canonical, or bring Share into line. Not urgent for `refueler.io` rationalisation, but must be logged so Share doesn't get "fixed" by accident during a global pass.

---

## 9. Legend — design decisions (from BRIDGE + live `legend.css`)

**Product/design substance (BRIDGE — not in CSS):**
- **Enterprise pricing tiers:** £1,500/mo (v1) → £2,500/mo (v2: Tor API, Double Ratchet, ML-KEM-768) → £3,500/mo (v2+: dedicated node isolation). Invite-only at v1, capped at five clients. Detail in `legend-enterprise-pricing.md`.
- **Merchant add-on:** £250/mo per entity, sold only into existing POS merchant base, never bundled.
- **Estate reports:** £50 block-height balance statement (v2); £150 full verified estate report (v3).
- **Free tier:** unlimited queries, no account, no rate limit — funded by Enterprise cross-subsidy; opens only after the model is proven, not at launch.
- **Query credential UI:** query budgets are Cashu blind-signature tokens (same infra as Share). Free: 10 queries per Share upload, 50/day cap. Paid Share: 50/upload, uncapped. Enterprise: unlimited, NUT-11 P2PK-bound.
- **Proof-of-query receipts:** blind receipt per query; client verifies N responses without revealing query content. A compliance-facing display concept — surface it as verifiable, unlinkable receipts.
- **PIR-inspired sharding:** three dedicated nodes, two providers, two jurisdictions; no single node sees the full query; client reassembles locally. Present as an architecture guarantee, not a policy promise ("structurally impossible", not "we won't").
- **Silent Payments (BIP-352):** first explorer to display SP static addresses and derived outputs correctly. Requires full-block scanning — a genuine differentiator to surface prominently.
- **Prerequisite:** Lightning node live at B9. Legend does not start before B9. No exceptions.

**Live CSS specifics (`legend.css`):**
- SPA mount max-width 860px; mono query input (`--font-mono`), sans placeholder, focus border → `--border-mid`.
- Batch button uses gold `--accent` → `--accent-hover` on hover, hidden until `.visible`.
- **Credential status dot is green `#1E8A4A`** — signals *operational status*, not earned/premium state. Do not switch it to gold (locked CC-74).
- Legend wordmark: Satoshi 700, 1.75rem.
- `:root` font aliases + `--border-mid`/`--inset-rule` present here (to be migrated — §7).

---

## 10. Share — design decisions (from BRIDGE)

- **Anonymity spectrum positioning (locked):** WeTransfer/Smash/SwissTransfer → Tresorit/Proton Drive → Wormhole → **Refueler Share** → OnionShare. Share sits one step short of OnionShare, deliberately — "only one side needs to be sophisticated."
- **Two-axis category (locked AP-7):** solves the *recipient problem* (transfer survives sender closing laptop / recipient on a plane) and the *compulsion problem* (nothing to hand over — never had it) simultaneously.
- **Capability display (honest scope — must be stated before anyone asks):**
  - AES-GCM client-side; key lives in URL fragment, never transmitted.
  - Every chunk BLAKE3-hashed, verified server-side without reading content.
  - Access gated by Cashu NUT-00 blind signatures — "the server is blind, the till is also blind."
  - Free tier: 4 GB, 7-day expiry. Paid via Stripe (identified) or Lightning (pseudonymous).
- **Honesty constraints (must appear, must not be overstated):** not zero-knowledge in the metadata sense (sizes, chunk counts, timestamps visible to operator); Lightning is pseudonymous not anonymous (Blink correlation possible); no independent audit yet (target B9 design review → B11 pentest, findings published).
- **Wedge lines** (per competitor) are in BRIDGE §Competitive positioning — use verbatim where a comparison is drawn.
- **Upgrade page:** carries `Lightning payments — Tap and go. Sats or card, your call.` and `Built for jurisdictions that have laws. And lawyers.` Known live bug carried to the Share project: `ReferenceError: share is not defined` on the upgrade page (pre-existing).
- **BLAKE3 / Cashu layer lock (4o):** BLAKE3 = internal indexing + chunk verification. Cashu blind signatures = anonymous auth. Distinct layers — never conflate in copy or code.

---

## 11. Conflicts & gaps — DECISION NEEDED before CSS-2

Each item quotes the disagreeing sources. **None resolved here.** These are for the founder to rule on; the ruling becomes the CSS-3 blueprint input.

### C-1 — Orange `#F5820A`: abolished or canonical Carbon CTA? ⚠️ **DECISION NEEDED**
- `claude.md` §2: *"Orange | ABOLISHED | `#F5820A` does not exist in this codebase. Do not use. Do not propose."*
- `REFUELER-BRIDGE.md` §Design system: *"Orange (CTA only, consumer surfaces): … Carbon `--accent-action: #F5820A`."*
- `MasterContext` — **contradicts itself**: locked decisions say *"Orange (#F5820A) abolished"*, while the canonical token table lists *"CTA: … Carbon `--accent-action: #F5820A`."*
- **Live:** `global.css` L67 defines `--accent-action: #F5820A` (Carbon) and L34 `#D4690A` (Paper). **Neither is consumed anywhere in the live CSS** — defined but unused.
- Also note: `#D4690A` (Paper CTA orange) is equally orange and is *not* named in any abolition — only `#F5820A` is.
- **Options:** (a) honour abolition — delete both `--accent-action` tokens, CTAs use gold/fg; (b) honour BRIDGE — keep orange as consumer-CTA-only, and correct `claude.md`; (c) keep tokens defined but formally forbidden from use. **Recommend deciding before CSS-4** so the new `global.css` doesn't re-ship a forbidden token.

### C-2 — Homepage default: Paper or Carbon? ⚠️ **DECISION NEEDED**
- `MasterContext` homepage block: *"Carbon default. Banded layout."*
- `BRIDGE` / `claude.md`: website + editorial default to **Paper**; Carbon is default only on app/terminal.
- **Live:** `head.njk` L63 defaults to **Paper**; `global.css` `:root` is Paper. Homepage ships Paper-default.
- **Assessment:** the live site and two of three docs agree on Paper. MasterContext's "Carbon default" line appears to be the outlier and likely wants correcting to "Paper default (Carbon on toggle)". Low-risk, but the doc should not stay contradictory. **Recommend correcting MasterContext**, no code change.

### C-3 — `notes.css` marked "clean" but carries a full token system ⚠️ **DECISION NEEDED (scope)**
- `MasterContext` CSS table: `src/notes/notes.css` — *"✅ Clean"*.
- **Live:** full `:root` token block (L8–52), own reset, duplicate nav/footer/theme-pill, body on `--text-primary`, solid-hex borders diverging from global's `rgba()`.
- **Impact:** notes pages are effectively a second design system. Any global token change won't reach them; borders already render differently.
- **Recommend:** treat notes.css migration as an explicit CSS-6 deliverable (strip `:root`, delete duplicated nav/footer, repoint body to whichever naming system survives C-4). Flag that this will need visual re-verification of every notes/article page in Paper **and** Carbon.

### C-4 — Dual token naming system, both in active use ⚠️ **DECISION NEEDED (naming)**
- `MasterContext`: *"global.css has both `--fg/--fg-muted/--fg-subtle` AND `--text-primary/--text-secondary/--text-tertiary` — two parallel systems. Only one should survive."*
- **Live, refined finding:** they are not merely parallel-and-unused. `legend.css`, `home.css`, `global.css` chrome all consume `--fg*`. `notes.css` consumes `--text-*` for body text. `share-tokens.css` aliases `--text-primary: var(--fg)` (bridges both). So **choosing a winner forces a rewrite of whichever pages use the loser.**
- **Recommend:** pick `--fg*` as the survivor (it's the majority + the body cascade already uses it), alias `--text-*` → `--fg*` during transition, migrate notes.css last. Decide the *name* in CSS-3, execute in CSS-4/CSS-6.

### Lower-severity divergences (log, decide in-track — no founder gate required)
- **D-1 — Share structural drift:** 1px borders + 6px radius vs BRIDGE 0.5px / 10-8-12. Reconcile or formally exempt Share (§4).
- **D-2 — `legend.css` `:root`:** font aliases + `--border-mid`/`--inset-rule` should move to `global.css` (§7).
- **D-3 — `backdrop-filter` survivor:** `notes.css` L494–495 `.modal-overlay { backdrop-filter: blur(4px) }` contradicts the "no backdrop-filter on any surface" lock. Confirm whether a modal scrim is exempt or must go.
- **D-4 — Share off-palette status/utility colours:** `#D97706`, `#27AE60`, `#C0392B`, `#9E8050`, `#C8A951` (§8). Reconcile to Warn/Danger tokens or promote formally.
- **G-3 — Font-alias vocabulary fragmentation:** four files, three alias sets for five faces (§3). Unify in CSS-3.
- **G-5 — Warn/Danger not tokenised on web:** `refueler.io` has no `--warn`/`--danger` tokens; Share does (`--c-amber`, `--c-red`). If web ever needs status colour, it'll hardcode. Consider adding to canonical set in CSS-3.

---

## 12. Pre-work checklist handed to CSS-2

- [ ] Founder ruling on C-1 (orange), C-2 (homepage default), C-3 (notes scope), C-4 (naming winner).
- [ ] CSS-2 audits with **this file** as the baseline; findings report only, no changes.
- [ ] Confirm no additional page CSS files exist beyond the six reviewed (editorial.css, support.css, privacy.css were listed in MasterContext but not pulled this session — CSS-2 must read them live; they are candidates for the same `:root`/dual-token issues).
- [ ] Every conclusion here is against `main` as of 2026-08-08 — CSS-2 re-pulls live before acting.

---

*"Nothing stops this train."*
