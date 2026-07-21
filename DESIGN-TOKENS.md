# DESIGN-TOKENS.md — Refueler
> **Version:** 1.0 | **Extracted:** Planning session · 21 July 2026
> Canonical token reference for all Refueler surfaces.
> Source of record: `merchant-tablet-styles.css` + `dev-console.html`.
> All repos must converge to these values. Divergences are bugs, not decisions.

---

## Colour tokens

### Backgrounds

| Token | Paper | Carbon |
|-------|-------|--------|
| `--bg` | `#F7F4EF` | `#1E1F22` |
| `--surface` | `#EDEAE4` | `#26282C` |
| `--surface-raised` | `#E4E1DA` | `#2E3035` |

### Text

| Token | Paper | Carbon |
|-------|-------|--------|
| `--text-primary` | `#3D3A36` | `#E4E2DC` |
| `--text-secondary` | `#5A5751` | `#8A8680` |
| `--text-tertiary` | `#9A948D` | `#5A5751` |

### Borders & rules

| Token | Paper | Carbon |
|-------|-------|--------|
| `--border` | `#D6D1C8` | `#35373B` |
| `--border-mid` | `#B8B2A8` | `#4A4D52` |
| `--inset-rule` | `var(--border)` | `#C8A96E` |

### Accent

| Token | Paper | Carbon | Notes |
|-------|-------|--------|-------|
| `--accent` | `#C8A96E` | `#C8A96E` | Warm gold. Brand chrome, borders, highlights. Same both themes. |
| `--accent-hover` | `#E0C48A` | `#E0C48A` | Gold hover state. |
| `--accent-action` | `#D4690A` | `#F5820A` | CTA orange. Primary buttons, upgrade CTAs only. |

### Status colours

| Token | Paper | Carbon |
|-------|-------|--------|
| `--c-green` | `#1C7C4A` | `#3DCA7A` |
| `--c-green-bg` | `#EBF7F0` | `#0D2B1A` |
| `--c-amber` | `#B85C00` | `#E8A23A` |
| `--c-amber-bg` | `#FEF3E6` | `#2B1D08` |
| `--c-red` | `#C0392B` | `#E05050` |
| `--c-red-bg` | `#FDF0EE` | `#2B1010` |
| `--warn` | `#B87333` | `#C8943A` |

### Special surfaces

| Token | Value | Notes |
|-------|-------|-------|
| Horizon band bg | `#1A1A1A` | Hardcoded. Always Carbon regardless of theme. |
| Console bg | `#111316` | Dev/debug surfaces only. |
| Console text | `#C8FFD4` | Dev/debug surfaces only. |

---

## Typography

### Font stack

| Role | Family | Weights | Usage |
|------|--------|---------|-------|
| Heading / figures | `Satoshi` → fallback `DM Sans` | 700 | Metric values, wordmark, key labels |
| UI / body | `DM Sans` | 300, 400, 500 | All interface copy, body text |
| Editorial / serif | `Source Serif 4` | 300, 400 | Long-form, editorial moments |
| Mono / data | `IBM Plex Mono` | 400, 500 | Timestamps, codes, data readouts, nav labels |

### Font load order (Bunny Fonts preferred for privacy; Google Fonts acceptable)

```html
<!-- Bunny Fonts -->
<link rel="preconnect" href="https://fonts.bunny.net">
<link href="https://fonts.bunny.net/css?family=ibm-plex-mono:400,500|source-serif-4:300,400&display=swap" rel="stylesheet">

<!-- Fontshare (Satoshi) -->
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" rel="stylesheet">

<!-- Google Fonts (DM Sans) -->
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&display=swap" rel="stylesheet">
```

### CSS variables

```css
--mono:    'IBM Plex Mono', monospace;
--sans:    'DM Sans', sans-serif;
--serif:   'Source Serif 4', Georgia, serif;
--heading: 'Satoshi', 'DM Sans', sans-serif;
```

---

## Structural tokens

| Token | Value | Notes |
|-------|-------|-------|
| Border weight | `0.5px` | Throughout. No 1px borders except auth card top accent. |
| Card radius | `10px` | All cards. |
| Button radius | `8px` | Primary and ghost buttons. |
| Chip / badge radius | `3px–4px` | Small inline elements. |
| Modal radius | `12px` | Overlay panels. |
| Button hover transition | `0.15s ease` | |
| Theme toggle transition | `0.35s` | Simultaneous on all token properties. |
| Body transition | `background 0.35s, color 0.35s` | |

---

## CSS implementation pattern

```css
/* ─── Paper (default) ─── */
:root {
  --bg:             #F7F4EF;
  --surface:        #EDEAE4;
  --surface-raised: #E4E1DA;
  --text-primary:   #3D3A36;
  --text-secondary: #5A5751;
  --text-tertiary:  #9A948D;
  --border:         #D6D1C8;
  --border-mid:     #B8B2A8;
  --inset-rule:     var(--border);
  --accent:         #C8A96E;
  --accent-hover:   #E0C48A;
  --accent-action:  #D4690A;
  --c-green:        #1C7C4A;
  --c-green-bg:     #EBF7F0;
  --c-amber:        #B85C00;
  --c-amber-bg:     #FEF3E6;
  --c-red:          #C0392B;
  --c-red-bg:       #FDF0EE;
  --warn:           #B87333;
  --mono:    'IBM Plex Mono', monospace;
  --sans:    'DM Sans', sans-serif;
  --serif:   'Source Serif 4', Georgia, serif;
  --heading: 'Satoshi', 'DM Sans', sans-serif;
}

/* ─── Carbon ─── */
[data-theme="carbon"] {
  --bg:             #1E1F22;
  --surface:        #26282C;
  --surface-raised: #2E3035;
  --text-primary:   #E4E2DC;
  --text-secondary: #8A8680;
  --text-tertiary:  #5A5751;
  --border:         #35373B;
  --border-mid:     #4A4D52;
  --inset-rule:     #C8A96E;
  --accent-action:  #F5820A;
  --c-green:        #3DCA7A;
  --c-green-bg:     #0D2B1A;
  --c-amber:        #E8A23A;
  --c-amber-bg:     #2B1D08;
  --c-red:          #E05050;
  --c-red-bg:       #2B1010;
  --warn:           #C8943A;
  /* --accent, --accent-hover, --mono, --sans, --serif, --heading: unchanged */
}
```

---

## Known divergences — refueler-share (fix in S45)

| Surface | Current value | Correct value | Token |
|---------|--------------|---------------|-------|
| Paper bg | `#F5F0E8` | `#F7F4EF` | `--bg` |
| Carbon bg | `#1A1A1A` | `#1E1F22` | `--bg` |
| `--surface-raised` | missing | add | new token |
| IBM Plex Mono | not loaded | add to font stack | `--mono` |
| Gold accent | not declared | `#C8A96E` | `--accent` |

These are noted. Do not fix before S45 — the token alignment session.

---

## Accent colour usage guide

| Colour | Token | Use on |
|--------|-------|--------|
| Gold `#C8A96E` | `--accent` | Brand chrome, border highlights, venue badges, inset rules (Carbon), Beck node dots, active states on internal tools |
| Orange `#F5820A` / `#D4690A` | `--accent-action` | Primary CTAs, upgrade buttons, payment triggers — consumer-facing surfaces only |

**Never use orange on internal/admin surfaces (dashboard, dev console, merchant tablet). Never use gold as a primary CTA on consumer surfaces.**

---

*"Nothing stops this train."*
