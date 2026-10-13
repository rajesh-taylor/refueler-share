// Share design specimen — local only. Clones each screen into its frames, switches theme,
// stage and dial, measures contrast of each colour role against the page ground (WCAG 2.x
// formula), and runs the Part 2 demos: motion verbs, haptics, QR, progress variants.
(() => {
  const root = document.documentElement;
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const reduced = () => root.classList.contains('rm') || matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Frames: header + screen, account state (§10–§11) ─────────────────────
  const ACCOUNT = {
    citizen: { head: 'Citizen', val: 'Citizen', btn: '', note: '63 GB free' },
    // 'without' frame = proposal: the 100 GB is full, Pro Bono offered as a way through (wording open)
    without: { head: 'Citizen', val: 'Citizen', btn: 'Send this one free, up to 4 GB', note: 'Your 100 GB is full.' },
    out:     { head: 'Sign in' },
    none:    { head: '' },
  };
  function drawAccount(frame) {
    const a = ACCOUNT[frame.dataset.account] || ACCOUNT.none;
    const head = frame.querySelector('.acct');
    if (head) head.textContent = a.head;
    const row = frame.querySelector('.acct-row');
    if (!row || !a.val) return;
    row.querySelector('.acct-val').textContent = a.val;
    const btn = row.querySelector('.acct-btn');
    btn.textContent = a.btn;
    btn.hidden = !a.btn;
    row.querySelector('.acct-note').textContent = a.note;
  }

  $$('.frame[data-screen]').forEach(frame => {
    if (!frame.hasAttribute('data-nohead')) frame.appendChild($('#app-head').content.cloneNode(true));
    frame.appendChild(document.getElementById(frame.dataset.screen).content.cloneNode(true));
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
    drawAccount(frame);
  });

  $$('[data-noop]').forEach(a => a.addEventListener('click', e => e.preventDefault()));

  // ── Motion helpers (§7) ──────────────────────────────────────────────────
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function fadeIn(el) { if (el) restart(el, 'fade'); }
  function fadeTo(el, text) { if (el.textContent === text) return; el.textContent = text; fadeIn(el); }

  function arrive(sheet) {                       // lines settle 170 ms apart, button last, once
    const kids = [...sheet.children];
    kids.forEach((k, i) => { k.style.animationDelay = `${i * 170}ms`; });
    restart(sheet, 'arrive');
    setTimeout(() => { sheet.classList.remove('arrive'); kids.forEach(k => { k.style.animationDelay = ''; }); },
      kids.length * 170 + 600);
  }
  $$('[data-replay]').forEach(b => b.addEventListener('click', () => arrive(document.getElementById(b.dataset.replay))));
  arrive($('#m-arrive'));

  const sw = $('#m-settle-sw'), swField = $('#m-settle-field');
  sw.addEventListener('change', () => { swField.hidden = !sw.checked; if (sw.checked) restart(swField, 'settle'); });

  // Fade the changed figure: amount every 2 s, time left every 5 s.
  const fadeEl = $('#m-fade'), [fAmt, , fLeft] = fadeEl.childNodes;
  let fGB = 1.2, fSec = 50, fTick = 0;
  setInterval(() => {
    fTick += 2; fGB = fGB >= 3.1 ? 0.2 : fGB + 0.1;
    fadeTo(fAmt, `${fGB.toFixed(1)} GB`);
    if (fTick % 10 === 0) { fSec = fSec <= 10 ? 70 : fSec - 10; fadeTo(fLeft, ` · about ${fSec} s left`); }
  }, 2000);

  // Press + Copied; the optional 10 ms copy tick (§8).
  $$('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const word = b.querySelector('span');
    if (b.dataset.copied) return;
    b.dataset.copied = '1';
    fadeTo(word, 'Copied');
    setTimeout(() => { fadeTo(word, 'Copy link'); delete b.dataset.copied; }, 2000);
    if (b.hasAttribute('data-haptic')) {
      const out = $('#h-result');
      if (!('vibrate' in navigator)) out.textContent = 'No vibration in this browser. Safari never has it.';
      else if (reduced()) out.textContent = 'Reduced motion is on, so no tick (proposed rule).';
      else out.textContent = navigator.vibrate(10) ? 'Ticked: 10 ms, once.' : 'The browser refused the tick.';
    }
  }));

  // ── QR (§9): the live page's drawing rule, dark on paper in both themes ──
  if (typeof QrCreator !== 'undefined') {
    const cv = $('#c-qr');
    const opts = { text: 'https://share.refueler.io/?uuid=00000000-0000-4000-8000-000000000000#sample-only', radius: 0, ecLevel: 'M', quiet: 0 };
    const probe = document.createElement('canvas');
    QrCreator.render({ ...opts, fill: '#000', background: '#fff', size: 1000 }, probe);
    const line = probe.getContext('2d').getImageData(0, 2, 1000, 1).data;
    let run = 0;
    while (run < 1000 && line[run * 4] < 128) run++;
    const units = 17 + 4 * Math.round((1000 * 7 / run - 17) / 4) + 8;
    const mod = Math.max(2, Math.floor(200 / units)), side = units * mod;
    const dpr = Math.max(1, Math.round(devicePixelRatio || 1));
    cv.style.width = cv.style.height = side + 'px';
    QrCreator.render({ ...opts, quiet: 4, fill: '#1A1917', background: '#F5F0E8', size: side * dpr }, cv);
  }

  // ── Progress variants (§12): one simulated 3.2 GB upload, live cadence ───
  const GiB = 1024 ** 3, MiB = 1024 ** 2, TOTAL = 3.2 * GiB;
  const progs = [...$$('.prog')].map(p => {
    p.appendChild($('#prog').content.cloneNode(true));
    return { n: p.querySelector('.n'), bar: p.querySelector('.ptrack b'), d: p.querySelector('.d'),
             of: p.querySelector('.of'), l: p.querySelector('.l') };
  });
  const leftText = s => s < 50 ? `about ${Math.max(10, Math.ceil(s / 10) * 10)} s left`
                               : `about ${Math.max(1, Math.round(s / 60))} min left`;
  let shown = 0, t0 = performance.now(), last = t0, wordsAt = -Infinity, leftAt = -Infinity, hold = 0;
  progs.forEach(p => { p.of.textContent = ' of 3.2 GB'; });
  setInterval(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const rate = 45 * MiB * (1 + 0.12 * Math.sin((now - t0) / 7000));        // a little drift, never jumps
    if (shown >= TOTAL) { if ((hold += dt) > 3) { shown = 0; hold = 0; wordsAt = leftAt = -Infinity; } }
    else shown = Math.min(TOTAL, shown + rate * dt);
    const pct = shown / TOTAL * 100, words = now - wordsAt >= 2000, left = now - leftAt >= 5000 && now - t0 > 5000;
    if (words) wordsAt = now;
    if (left) leftAt = now;
    progs.forEach(p => {
      p.n.textContent = String(Math.round(pct));
      p.bar.style.width = pct.toFixed(1) + '%';
      if (words) fadeTo(p.d, `${(shown / GiB).toFixed(1)} GB`);
      if (left) fadeTo(p.l, shown >= TOTAL ? '' : ` · ${leftText((TOTAL - shown) / rate)}`);
    });
  }, 100);

  // ── Contrast readout ─────────────────────────────────────────────────────
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

  function measure() {
    const bg = rgb(getComputedStyle(root).backgroundColor);
    $$('.sp-sw').forEach(sw => {
      const probe = sw.querySelector('i');
      probe.style.background = `var(${sw.dataset.var})`;
      const c = rgb(getComputedStyle(probe).backgroundColor);
      const r = ratio(c, bg);
      const min = Number(sw.dataset.min || 4.5);
      sw.querySelector('code').textContent = `${hex(c)} · ${r.toFixed(2)} : 1 ${r >= min ? '✓' : '✗'}`;
    });
  }

  // ── Controls: theme, stage, dial, dither, reduced motion ────────────────
  const state = { theme: 'carbon', dial: 1, dither: true };   // decided 13 Oct: Carbon Dial 1 % + dither
  let noise = null;
  function noiseUrl() {            // ±1 code value of grain, to break up banding
    if (noise) return noise;
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d'), img = x.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.round(Math.random() * 5);          // alpha 0–5 of 255
    }
    x.putImageData(img, 0, 0);
    return (noise = `url(${c.toDataURL()})`);
  }
  function drawDial() {
    // Lift = mix toward white at the centre: 1 % ≈ +2 code values, 2 % ≈ +5. Carbon only.
    const lift = { 1: '#1C1B19', 2: '#1F1E1C' }[state.dial];
    let img = 'none';
    if (state.theme === 'carbon' && lift) {
      img = `radial-gradient(ellipse 75% 65% at 50% 38%, ${lift} 0%, #1A1917 100%)`;
      if (state.dither) img = `${noiseUrl()}, ${img}`;
    }
    root.style.setProperty('--dial-img', img);
  }
  function press(group, attr, value) {
    $$(`[${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(value))));
  }

  function setTheme(t) {
    state.theme = t;
    if (t === 'carbon') root.dataset.theme = 'carbon'; else delete root.dataset.theme;
    press(null, 'data-set-theme', t);
    $$('.theme-name').forEach(s => { s.textContent = t === 'carbon' ? 'Carbon' : 'Paper'; });
    drawDial();
    measure();
  }
  $$('[data-set-theme]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.setTheme)));
  $$('[data-set-stage]').forEach(b => b.addEventListener('click', () => {
    press(null, 'data-set-stage', b.dataset.setStage);
    $$('.chip').forEach(c => { c.textContent = b.dataset.setStage; });
  }));
  $$('[data-set-dial]').forEach(b => b.addEventListener('click', () => {
    state.dial = Number(b.dataset.setDial);
    press(null, 'data-set-dial', state.dial);
    drawDial();
  }));
  $$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.toggle === 'rm') root.classList.toggle('rm', on);
    if (b.dataset.toggle === 'dither') { state.dither = on; drawDial(); }
  }));
  setTheme('carbon');
})();
