// Harness stand-in for Cloudflare Turnstile. ?ts=click makes it ask for a click; ?ts=slow passes after 4 s.
(function () {
  const mode = new URLSearchParams(location.search).get('ts') || 'pass';
  let n = 0;
  window.turnstile = {
    render(el, o) {
      const id = 'ts' + (++n);
      const box = document.createElement('div');
      box.style.cssText = 'height:65px;border:1px dashed currentColor;opacity:.6;display:flex;align-items:center;padding:0 16px;font:14px sans-serif;cursor:pointer;width:100%;box-sizing:border-box';
      const pass = () => { box.textContent = '✓ Success! (stub)'; o.callback && o.callback('stub-token-' + id); };
      if (mode === 'click') {
        o['before-interactive-callback'] && o['before-interactive-callback']();
        box.textContent = '☐ Verify you are human (stub)'; box.onclick = pass; el.appendChild(box);
      } else {
        if (o.appearance !== 'interaction-only') { box.textContent = 'Verifying… (stub)'; el.appendChild(box); }
        setTimeout(pass, mode === 'slow' ? 4000 : 600);
      }
      return id;
    },
    remove() {}, reset() {}, getResponse() { return null; },
  };
  if (typeof window.onTurnstileLoad === 'function') window.onTurnstileLoad();
})();
