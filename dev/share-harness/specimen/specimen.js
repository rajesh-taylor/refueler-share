// Share design specimen — local only. Clones each screen into its frames, switches theme,
// and measures contrast of each colour role against the page ground (WCAG 2.x formula).
(() => {
  const root = document.documentElement;

  document.querySelectorAll('.frame[data-screen]').forEach(frame => {
    const tpl = document.getElementById(frame.dataset.screen);
    frame.appendChild(tpl.content.cloneNode(true));
    frame.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));   // ids are per template, not per clone
    if (frame.hasAttribute('data-closed')) {                                   // arrival state: options closed
      frame.querySelectorAll('.switch input').forEach(i => { i.checked = false; });
      frame.querySelectorAll('.input.pw, .input.pw + small').forEach(el => el.remove());
    }
    if (frame.hasAttribute('data-fold')) {
      const fold = document.createElement('div');
      fold.className = 'fold';
      fold.innerHTML = '<span>fold · 375 × 667</span>';
      frame.appendChild(fold);
    }
  });

  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

  function measure() {
    const bg = rgb(getComputedStyle(document.body).backgroundColor);
    document.querySelectorAll('.sp-sw').forEach(sw => {
      const probe = sw.querySelector('i');
      probe.style.background = `var(${sw.dataset.var})`;
      const c = rgb(getComputedStyle(probe).backgroundColor);
      const r = ratio(c, bg);
      const min = Number(sw.dataset.min || 4.5);
      sw.querySelector('code').textContent = `${hex(c)} · ${r.toFixed(2)} : 1 ${r >= min ? '✓' : '✗'}`;
    });
  }

  function setTheme(t) {
    if (t === 'carbon') root.dataset.theme = 'carbon'; else delete root.dataset.theme;
    document.querySelectorAll('[data-set-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setTheme === t)));
    document.querySelectorAll('.app-head small').forEach(s => { s.textContent = t === 'carbon' ? 'Carbon' : 'Paper'; });
    measure();
  }

  document.querySelectorAll('[data-set-theme]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.setTheme)));
  setTheme('carbon');
})();
