// ── frontend/progress.js — retries and calm progress (Share-Progress-1) ──────
// Moved out of crypto.js at Share-JS-Split-2 (9 Oct 2026). No behaviour change.
// One rule for both pages: retry waits, the steady bar, the words under it.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Progress and retries — one rule for both pages (Share-Progress-1)
// ─────────────────────────────────────────────────────────────────────────────
// Waits between tries of one part, upload and both download paths. No wait is
// longer than 10 s (the page counts it down); about 2 min of trying in all.
export const RETRY_DELAYS_MS = [2000, 5000, 10000, 10000, 10000, 10000, 10000,
                                10000, 10000, 10000, 10000, 10000, 10000];   // 13 waits, 14 tries, 127 s

// Waits `ms`, calling onTick(seconds left) once a second. Ends early when the
// browser says it's back online.
export function waitForRetry(ms, onTick) {
  return new Promise(resolve => {
    const end = Date.now() + ms;
    let timer;
    const done = () => { clearInterval(timer); window.removeEventListener('online', done); resolve(); };
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) return done();
      if (onTick) onTick(Math.ceil(left / 1000));
    };
    window.addEventListener('online', done);
    timer = setInterval(tick, 1000);
    tick();
  });
}

// "about 40 s left" · "about 3 min left" · "about 1 h 10 min left" (10 s steps)
export function timeLeftText(seconds) {
  if (!(seconds >= 0) || !isFinite(seconds)) return '';
  if (seconds < 50) return `about ${Math.max(10, Math.ceil(seconds / 10) * 10)} s left`;
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `about ${mins} min left`;
  return `about ${Math.floor(mins / 60)} h ${mins % 60} min left`;
}

// Speed over the last 10 s; nothing until 5 s of bytes to judge it on. A step
// back (a part starting again) starts the measurement again; so does reset(),
// called when a try starts after a wait, so the wait doesn't count as slow bytes.
// A figure is held for 2 s so the line doesn't keep changing length.
export function makeRateMeter(windowMs = 10_000, settleMs = 5_000, holdMs = 2_000) {
  let samples = [], held = '', heldAt = 0;
  const reset = () => { samples = []; held = ''; };
  return {
    reset,
    rate(now = performance.now()) {   // bytes a second over the window; 0 until known
      if (samples.length < 2) return 0;
      const first = samples[0], last = samples[samples.length - 1];
      return last.t > first.t ? Math.max(0, (last.b - first.b) / ((last.t - first.t) / 1000)) : 0;
    },
    add(bytes, now = performance.now()) {
      const last = samples[samples.length - 1];
      if (last && bytes < last.b) reset();
      samples.push({ t: now, b: bytes });
      while (samples.length > 2 && now - samples[1].t > windowMs) samples.shift();
    },
    left(remaining, now = performance.now()) {
      if (held && now - heldAt < holdMs) return held;
      if (samples.length < 2) return '';
      const first = samples[0], last = samples[samples.length - 1];
      if (now - first.t < settleMs) return '';
      const rate = (last.b - first.b) / ((last.t - first.t) / 1000);
      held = rate > 0 ? timeLeftText(remaining / rate) : '';
      heldAt = now;
      return held;
    },
  };
}

// "362 MB of 404 MB" · "1.2 GB of 3.8 GB" — both in the total's unit, whole MB, so
// the words under the bar change calmly (Share-Progress-1).
export function progressBytesText(done, total) {
  const [a, b] = _progressBytes(done, total);
  return `${a} of ${b}`;
}
function _progressBytes(done, total) {
  const [unit, div, dp] = total >= 1024 ** 3 ? ['GB', 1024 ** 3, 1] : total >= 1024 ** 2 ? ['MB', 1024 ** 2, 0] : ['KB', 1024, 0];
  const f = b => (Math.min(Math.max(b, 0), total) / div).toFixed(dp);
  return [`${f(done)} ${unit}`, `${f(total)} ${unit}`];
}

// Sets an element's words with a soft fade (share.css .rx-fade), only when they change.
export function setCalmText(el, text) {
  if (!el || (el.textContent === text && !el.dataset.words)) return;
  delete el.dataset.words;
  _fadeTo(el, text);
}
function _fadeTo(el, text) {
  el.textContent = text;
  el.classList.remove('rx-fade');
  void el.offsetWidth;   // restart the fade
  el.classList.add('rx-fade');
}

// "362 MB of 404 MB · about 40 s left" where only what changed fades: the amount
// sent, and the time left. " of 404 MB" stays still (Rajesh, 7 Oct).
export function setProgressWords(el, done, total, left) {
  if (!el) return;
  if (!el.dataset.words) {
    el.textContent = '';
    el.classList.remove('rx-fade');
    el.append(document.createElement('span'), document.createTextNode(''), document.createElement('span'));
    el.dataset.words = '1';
  }
  const [doneEl, ofText, leftEl] = el.childNodes;
  const [a, b] = _progressBytes(done, total);
  if (doneEl.textContent !== a) _fadeTo(doneEl, a);
  ofText.textContent = ` of ${b}`;
  const l = left ? ` · ${left}` : '';
  if (leftEl.textContent !== l) _fadeTo(leftEl, l);
}

// The bar, the % and the words under it, calm (Share-Progress-1, Rajesh 7 Oct).
// Bytes arrive in bursts (a 32 MiB part at a time); the figure shown climbs at the
// measured speed instead, never past the bytes that have really moved, and catches
// a burst up over about 2 s. A real stall slows it, then stops it. A step back (a
// part starting again) shows at once. render(shownBytes, words) runs every tickMs;
// `words` is true at most every textMs (the byte figure), with the time left
// changing at most every leftMs. set() starts it, stop() ends it.
export function makeSteadyProgress(total, render, { tickMs = 100, textMs = 2000, leftMs = 5000 } = {}) {
  const meter = makeRateMeter(10_000, 5_000, leftMs);
  let actual = 0, shown = 0, last = 0, textAt = -Infinity, timer = null;
  const tick = () => {
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    shown = Math.min(actual, shown + dt * Math.max(meter.rate(now), (actual - shown) / 2));
    const words = now - textAt >= textMs;
    if (words) textAt = now;
    render(shown, words);
  };
  return {
    set(bytes) {
      if (bytes < actual) { shown = Math.min(shown, bytes); textAt = -Infinity; }
      actual = bytes;
      meter.add(bytes);
      if (!timer) {   // first bytes: the words keep the step they're on for 0.5 s, then the figure
        shown = bytes; last = performance.now(); textAt = last - textMs + 500;
        timer = setInterval(tick, tickMs); tick();
      }
    },
    left()   { return meter.left(total - actual); },
    reset()  { meter.reset(); },
    redraw() { textAt = -Infinity; if (timer) tick(); },
    stop()   { clearInterval(timer); timer = null; },
  };
}
