// Harness stand-in for Cloudflare Turnstile. ?ts=click makes it ask for a click; ?ts=slow passes
// after 4 s; ?ts=fail fails the first check (error-callback) and passes after reset().
(function () {
  const mode = new URLSearchParams(location.search).get('ts') || 'pass';
  let n = 0, failed = false;
  const widgets = {};
  function run(id) {
    const { el, o } = widgets[id];
    el.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'height:65px;border:1px dashed currentColor;opacity:.6;display:flex;align-items:center;padding:0 16px;font:14px sans-serif;cursor:pointer;width:100%;box-sizing:border-box';
    const pass = () => { box.textContent = '✓ Success! (stub)'; o.callback && o.callback('stub-token-' + id + '-' + Date.now()); };
    if (mode === 'click') {
      o['before-interactive-callback'] && o['before-interactive-callback']();
      box.textContent = '☐ Verify you are human (stub)'; box.onclick = pass; el.appendChild(box);
    } else if (mode === 'fail' && !failed) {
      failed = true;
      setTimeout(() => o['error-callback'] && o['error-callback']('stub-error'), 2500);
    } else {
      if (o.appearance !== 'interaction-only') { box.textContent = 'Verifying… (stub)'; el.appendChild(box); }
      setTimeout(pass, mode === 'slow' ? 4000 : 600);
    }
  }
  window.turnstile = {
    render(el, o) { const id = 'ts' + (++n); widgets[id] = { el, o }; run(id); return id; },
    reset(id) { if (widgets[id]) run(id); },
    remove(id) { delete widgets[id]; },
    getResponse() { return null; },
  };
})();
