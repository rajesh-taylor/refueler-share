/**
 * refueler-badge.js
 * Embeds a "Powered by Refueler Share" pill into any element carrying
 * the [data-refueler-badge] attribute.
 *
 * Mount:
 *   <div data-refueler-badge></div>
 *   <script type="module" src="/share/assets/refueler-badge.js"></script>
 *
 * Variants (attribute value):
 *   data-refueler-badge            → wordmark + tech pill (default)
 *   data-refueler-badge="compact"  → tech pill only
 *
 * Theme: reads document.documentElement.dataset.theme === 'carbon'
 *        and reacts to changes via MutationObserver (no page reload needed).
 *
 * Zero external dependencies. Uses CSS custom properties from share-tokens.css
 * where available; falls back to hard-coded Paper/Carbon values if the token
 * sheet is absent (i.e. third-party host). Self-contained.
 */

const HREF = 'https://refueler.io/share/';

/* ── Inline styles ───────────────────────────────────────────────────────────
   Written as a template so the badge carries its own styles even on a host
   that doesn't load share-tokens.css. We reference CSS custom properties
   where the host likely has them (share pages); hard-code the fallback.
   ────────────────────────────────────────────────────────────────────────── */
const STYLE = `
  .rfb-root {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--display, 'DM Sans', system-ui, sans-serif);
    text-decoration: none;
    color: inherit;
  }
  .rfb-root:hover .rfb-pill { opacity: 0.8; }
  .rfb-root:hover .rfb-label { opacity: 1; }

  .rfb-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.45;
    transition: opacity 0.2s;
    white-space: nowrap;
  }

  .rfb-pill {
    display: inline-flex;
    align-items: center;
    gap: 0;
    border-radius: 100px;
    border: 1px solid var(--border, rgba(26,26,26,0.14));
    overflow: hidden;
    transition: opacity 0.2s, border-color 0.2s;
  }

  .rfb-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-family: var(--mono, 'IBM Plex Mono', 'Courier New', monospace);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    white-space: nowrap;
    border-right: 1px solid var(--border, rgba(26,26,26,0.14));
    color: var(--fg-muted, #5A5550);
    background: var(--card-bg, rgba(26,26,26,0.04));
    transition: color 0.2s, background 0.2s, border-color 0.2s;
  }
  .rfb-chip:last-child { border-right: none; }

  .rfb-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .rfb-dot-blake3  { background: #6B7280; }
  .rfb-dot-cashu   { background: var(--gold, #C8A96E); }
  .rfb-dot-bitcoin { background: #F7931A; }

  /* Carbon overrides — applied when [data-rfb-carbon] is on the root element */
  [data-rfb-carbon] .rfb-chip {
    color: var(--fg-muted, #B0AAA2);
    background: var(--card-bg, rgba(245,240,232,0.04));
    border-right-color: var(--border, rgba(245,240,232,0.10));
  }
  [data-rfb-carbon] .rfb-pill {
    border-color: var(--border, rgba(245,240,232,0.14));
  }
`;

/* ── Badge HTML ──────────────────────────────────────────────────────────────  */
function buildBadge(variant) {
  const showLabel = variant !== 'compact';

  return `
    <a class="rfb-root" href="${HREF}" target="_blank" rel="noopener noreferrer"
       aria-label="Powered by Refueler Share — anonymous encrypted file transfer">
      ${showLabel ? `<span class="rfb-label">Powered by Refueler Share</span>` : ''}
      <span class="rfb-pill" role="img" aria-hidden="true">
        <span class="rfb-chip">
          <span class="rfb-dot rfb-dot-blake3"></span>BLAKE3
        </span>
        <span class="rfb-chip">
          <span class="rfb-dot rfb-dot-cashu"></span>Cashu
        </span>
        <span class="rfb-chip">
          <span class="rfb-dot rfb-dot-bitcoin"></span>Bitcoin
        </span>
      </span>
    </a>
  `;
}

/* ── Mount ───────────────────────────────────────────────────────────────────  */
function isCarbonMode() {
  return document.documentElement.dataset.theme === 'carbon';
}

function applyTheme(root) {
  if (isCarbonMode()) {
    root.setAttribute('data-rfb-carbon', '');
  } else {
    root.removeAttribute('data-rfb-carbon');
  }
}

function mountBadge(el) {
  if (el._rfbMounted) return;
  el._rfbMounted = true;

  const variant = (el.getAttribute('data-refueler-badge') || '').trim() || 'default';

  // Shadow DOM: scoped styles, no token bleed either direction
  const shadow = el.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  shadow.appendChild(styleEl);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildBadge(variant);
  shadow.appendChild(wrapper);

  // Expose the inner root for theme toggling
  const innerRoot = shadow.querySelector('.rfb-root');
  if (!innerRoot) return;

  applyTheme(innerRoot);

  // React to theme changes on <html data-theme="carbon">
  const themeObserver = new MutationObserver(() => applyTheme(innerRoot));
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

function mountAll() {
  document.querySelectorAll('[data-refueler-badge]').forEach(mountBadge);
}

/* ── Entry ───────────────────────────────────────────────────────────────────  */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountAll);
} else {
  mountAll();
}

// Pick up badges added dynamically after load (e.g. white-label SPAs)
const docObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.hasAttribute('data-refueler-badge')) mountBadge(node);
      node.querySelectorAll?.('[data-refueler-badge]').forEach(mountBadge);
    }
  }
});
docObserver.observe(document.body, { childList: true, subtree: true });
