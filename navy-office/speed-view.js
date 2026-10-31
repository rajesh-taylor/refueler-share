/* speed-view.js — Navy Office · Speed (Speed-View-Opus · 17 Oct 2026; was a table, Share-Release-1c).
 *
 * Draws refueler-share-private/speed/summary.json (dev/speed/speed.mjs --summarise; schema 2, or the
 * older schema 1) and, if dropped with it, speed/places.md (Rajesh's own key: "L1 = home, Wi-Fi").
 * Both are read in this page with FileReader: nothing is fetched, sent or kept. Close the tab and
 * they are gone.
 *
 * Written for the strict CSP on /share/admin/*: no inline handlers, no HTML strings — every value
 * from a file goes in through textContent, setAttribute or CSSOM (element.style), never innerHTML.
 * Two colours: ink and gold. Gold = Safari's engine (WebKit) or Share; ⚑ = a rise over 20 %.
 */
'use strict';

const SpeedView = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const ENGINES = ['webkit', 'chromium', 'firefox', 'brave'];
  const ENGINE_NAME = { webkit: 'WebKit', chromium: 'Chromium', firefox: 'Firefox', brave: 'Brave' };
  const ENGINE_NOTE = { webkit: 'Safari’s engine' };
  const PAGES = ['/', '/signin/'];
  const PAGE_NAME = { '/': 'Upload page', '/signin/': 'Sign-in' };
  const LABELS = ['vpn-off', 'vpn-on-daita'];   // "VPN on" always means Mullvad multihop + DAITA
  const LABEL_NAME = { 'vpn-off': 'VPN off', 'vpn-on-daita': 'VPN on' };
  const METRIC_NAME = { ready: 'Ready', fcp: 'First paint', lcp: 'Largest paint' };
  const DASH = { webkit: null, chromium: null, firefox: '6 4', brave: '1 4' };
  const RISE = 0.2;
  const REPO = '/Users/rajeshtaylor/Documents/refueler-share';
  const MAX_BYTES = 5 << 20;

  // ── small DOM helpers (no HTML strings anywhere) ─────────────────────────────────────────
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  function S(tag, attrs = {}, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
    for (const c of kids.flat()) if (c != null) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const ms = (x) => (num(x) == null ? '—' : Math.round(x).toLocaleString('en-GB'));
  const secs = (x) => (num(x) == null ? '—' : `${(x / 1000).toFixed(2)} s`);
  const pct = (x) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(Math.round(x * 100))} %`;
  const words = (n) => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][n] ?? String(n);

  // ── time: weeks start Monday, London time ────────────────────────────────────────────────
  const ymd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  function weekOf(iso) {
    const d = new Date(`${ymd(iso)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  const weekName = (w) => `w/c ${new Date(`${w}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  const when = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });

  // ── input: every field picked and checked one by one ────────────────────────────────────
  const PLACE = /^[A-Z][0-9]{1,2}$/;
  const RELEASE = /^(app-)?[0-9a-f]{7,40}$/;
  const LABEL = /^[a-z0-9-]{1,24}$/;
  const KEYS = ['ttfb', 'fcp', 'lcp', 'dcl', 'ready', 'requests', 'bytes'];
  const metrics = (m, keys) => Object.fromEntries(keys.map((k) => [k, num(m?.[k])]));
  const str = (x, re) => (typeof x === 'string' && re.test(x) ? x : null);
  function cond(c) {
    if (!c || typeof c !== 'object') return null;
    return {
      down_mbps: num(c.down_mbps), up_mbps: num(c.up_mbps), rpm: num(c.rpm),
      link: str(c.link, /^(wifi|ethernet|iphone|other)$/), power: str(c.power, /^(ac|battery)$/),
      vpn: str(c.vpn, /^(off|on|multihop|daita|multihop\+daita)$/), exit_city: str(c.exit_city, /^[\p{L}][\p{L} .'-]{0,39}$/u),
    };
  }
  function cleanRun(r) {
    if (!r || typeof r.when !== 'string' || Number.isNaN(Date.parse(r.when))) return null;
    const results = {};
    for (const e of ENGINES) {
      const pages = r.results?.[e];
      if (!pages || typeof pages !== 'object') continue;
      results[e] = {};
      for (const p of PAGES) if (pages[p]) results[e][p] = metrics(pages[p], KEYS);
    }
    return {
      when: r.when, release: str(r.release, RELEASE), label: str(r.label, LABEL), place: str(r.place, PLACE),
      note: typeof r.note === 'string' ? r.note.slice(0, 140) : null, kind: r.kind === 'weekly' ? 'weekly' : null,
      cond: cond(r.cond), results,
    };
  }
  function cleanCacheAb(a) {
    if (!a || typeof a.when !== 'string' || Number.isNaN(Date.parse(a.when)) || !a.targets) return null;
    const targets = {};
    for (const t of ['local-today', 'local-immutable', 'tunnel-today', 'tunnel-immutable', 'live-today']) {
      if (!a.targets[t]) continue;
      targets[t] = {};
      for (const e of ENGINES) if (a.targets[t][e]) targets[t][e] = metrics(a.targets[t][e], ['cold_ready', 'warm_ready', 'rechecked']);
    }
    return { when: a.when, label: str(a.label, LABEL), release: str(a.release, RELEASE), warm: num(a.warm), cond: cond(a.cond), targets };
  }
  function load(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('not a summary.json');
    let runs;
    if (raw.schema === 1 && Array.isArray(raw.rows)) {
      const by = new Map();
      for (const row of raw.rows) {
        if (!row || typeof row.when !== 'string' || !ENGINES.includes(row.engine) || !PAGES.includes(row.page)) continue;
        if (!by.has(row.when)) by.set(row.when, { when: row.when, release: row.release, label: row.label, place: row.place, note: row.note, cond: row.cond, results: {} });
        (by.get(row.when).results[row.engine] ??= {})[row.page] = row.median;
      }
      runs = [...by.values()];
    } else if (raw.schema === 2 && Array.isArray(raw.runs)) runs = raw.runs;
    else throw new Error('this page reads summary.json schema 1 or 2');
    const competitors = (raw.schema === 2 && Array.isArray(raw.competitors) ? raw.competitors : []).map((c) => {
      if (!c || typeof c.name !== 'string' || Number.isNaN(Date.parse(c.when))) return null;
      const results = {};
      for (const e of ENGINES) if (c.results?.[e]) results[e] = metrics(c.results[e], ['fcp', 'lcp', 'ready', 'requests']);
      return { name: c.name.slice(0, 40), when: c.when, place: str(c.place, PLACE), label: str(c.label, LABEL), results };
    }).filter(Boolean);
    return {
      generated: typeof raw.generated === 'string' ? raw.generated : null,
      runs: runs.map(cleanRun).filter(Boolean).sort((a, b) => a.when.localeCompare(b.when)),
      competitors,
      cacheAb: (raw.schema === 2 && Array.isArray(raw.cache_ab) ? raw.cache_ab : []).map(cleanCacheAb).filter(Boolean),
    };
  }
  // places.md: Rajesh's own key. Lines like "L1 = home, Wi-Fi, desk" (also "L1: …", "L1 — …", "- L1 = …").
  function parsePlaces(text) {
    const names = {};
    for (const line of String(text).split('\n')) {
      const m = /^\s*(?:[-*]\s*)?\**([A-Z][0-9]{1,2})\**\s*(?:=|:|—|–|-)\s*(.+?)\s*$/.exec(line);
      if (m) names[m[1]] = m[2].replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 60);
    }
    return names;
  }
  // Reads the dropped / picked files: one summary.json, optionally places.md. Resolves { data?, names?, errors }.
  async function readFiles(fileList) {
    const out = { errors: [] };
    for (const f of [...fileList].slice(0, 4)) {
      if (f.size > MAX_BYTES) { out.errors.push(`${f.name}: over 5 MB`); continue; }
      const text = await f.text();
      if (/\.md$|\.txt$/i.test(f.name)) { out.names = parsePlaces(text); out.placesFile = f.name; continue; }
      try { out.data = load(JSON.parse(text)); out.summaryFile = f.name; }
      catch (e) { out.errors.push(`${f.name}: ${e.message}`); }
    }
    return out;
  }

  // ── selection rules ──────────────────────────────────────────────────────────────────────
  // A week's value for a place + VPN state: its --weekly run if there is one, else its latest run.
  function weekRun(runs, place, label, week) {
    const c = runs.filter((r) => r.place === place && r.label === label && weekOf(r.when) === week);
    const w = c.filter((r) => r.kind === 'weekly');
    return (w.length ? w : c).at(-1) || null;
  }
  const weeksFor = (runs, place) => [...new Set(runs.filter((r) => r.place === place && LABELS.includes(r.label)).map((r) => weekOf(r.when)))].sort();
  const placesOf = (runs) => [...new Set(runs.map((r) => r.place).filter(Boolean))].sort();
  function prevRun(runs, place, label, week) {
    for (const w of weeksFor(runs, place).filter((x) => x < week).reverse()) { const r = weekRun(runs, place, label, w); if (r) return r; }
    return null;
  }
  function niceMax(v) {
    for (const s of [100, 200, 250, 500, 1000, 2000, 2500, 5000]) if (v / s <= 5) return { max: Math.ceil(v / s) * s, step: s };
    return { max: Math.ceil(v / 10000) * 10000, step: 10000 };
  }

  // ── pieces ───────────────────────────────────────────────────────────────────────────────
  function seg(name, options, value, onChange) {
    return el('div', { class: 'sv-seg', role: 'group', 'aria-label': name },
      options.map(([v, label]) => el('button', { type: 'button', class: 'sv-seg-btn', 'aria-pressed': String(v === value), onclick: () => onChange(v), text: label })));
  }
  function select(name, options, value, onChange) {
    return el('label', { class: 'sv-field' }, el('span', { class: 'sv-field-k', text: name }),
      el('select', { class: 'sv-select', onchange: (e) => onChange(e.target.value) },
        options.map(([v, label]) => el('option', { value: v, selected: v === value, text: label }))));
  }
  const headline = (text) => el('p', { class: 'sv-headline', text });
  function condLine(run) {
    const c = run.cond || {};
    const bits = [];
    if (c.down_mbps != null) bits.push(`${Math.round(c.down_mbps)}↓ / ${Math.round(c.up_mbps)}↑ Mbps`);
    if (c.rpm != null) bits.push(`${c.rpm} RPM`);
    if (c.link) bits.push({ wifi: 'Wi-Fi', ethernet: 'Ethernet', iphone: 'iPhone', other: 'other link' }[c.link]);
    if (c.power) bits.push(c.power === 'ac' ? 'on mains' : 'on battery');
    if (c.vpn && c.vpn !== 'off') bits.push(`Mullvad${c.exit_city ? `, exit ${c.exit_city}` : ''}`);
    return el('div', { class: 'sv-cond' },
      el('span', { class: 'sv-cond-k', text: LABEL_NAME[run.label] || run.label || '—' }),
      el('span', { class: 'sv-cond-v', text: [when(run.when), run.release ? `release ${run.release}` : null, ...bits].filter(Boolean).join('  ·  ') }),
      run.note ? el('span', { class: 'sv-cond-note', text: `“${run.note}”` }) : null);
  }

  // Tooltip: one per view, placed with CSSOM.
  let tip = null;
  function showTip(host, x, y, lines) {
    if (!tip) tip = el('div', { class: 'sv-tip', role: 'status' });
    if (tip.parentNode !== host) host.append(tip);
    tip.replaceChildren(...lines.map(([k, v, strong]) => el('div', { class: `sv-tip-row${strong ? ' sv-tip-strong' : ''}` }, el('span', { text: k }), el('span', { text: v }))));
    tip.hidden = false;
    const r = host.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(x - r.left + 14, 0), r.width - tip.offsetWidth)}px`;
    tip.style.top = `${y - r.top + 14}px`;
  }
  const hideTip = () => { if (tip) tip.hidden = true; };
  function hoverable(node, host, lines) {
    node.setAttribute('tabindex', '0');
    node.addEventListener('mousemove', (ev) => showTip(host, ev.clientX, ev.clientY, lines()));
    node.addEventListener('mouseleave', hideTip);
    node.addEventListener('focus', () => { const b = node.getBoundingClientRect(); showTip(host, b.left + b.width * 0.55, b.top + 4, lines()); });
    node.addEventListener('blur', hideTip);
  }

  // Full view: one piece at a time in a <dialog>; ← / → (or the arrow buttons) step through its
  // siblings — the four This week charts, the two Trend charts, the four engines in Share vs others.
  // Esc, Close or a click outside shuts it.
  function fullView(slides, start = 0) {
    return el('button', {
      type: 'button', class: 'sv-full-btn', 'aria-haspopup': 'dialog', text: 'Full view ↗',
      onclick: () => {
        let i = start;
        const title = el('h2', { class: 'sv-dialog-title' });
        const count = el('span', { class: 'sv-dialog-count' });
        const body = el('div', { class: 'sv-dialog-body' });
        const step = (d) => { i = (i + d + slides.length) % slides.length; show(); };
        const nav = slides.length > 1 ? [
          el('button', { type: 'button', class: 'sv-dialog-nav', 'aria-label': 'Previous chart', onclick: () => step(-1), text: '←' }),
          count,
          el('button', { type: 'button', class: 'sv-dialog-nav', 'aria-label': 'Next chart', onclick: () => step(1), text: '→' }),
        ] : [];
        const box = el('dialog', { class: 'sv-dialog' },
          el('div', { class: 'sv-dialog-head' }, title,
            el('div', { class: 'sv-dialog-tools' }, nav,
              el('button', { type: 'button', class: 'sv-dialog-close', onclick: () => box.close(), text: 'Close' }))),
          body);
        function show() {
          hideTip();
          title.textContent = slides[i].title;
          count.textContent = `${i + 1} of ${slides.length}`;
          box.setAttribute('aria-label', slides[i].title);
          body.replaceChildren(slides[i].build(true));
        }
        box.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight' && slides.length > 1) { e.preventDefault(); step(1); }
          if (e.key === 'ArrowLeft' && slides.length > 1) { e.preventDefault(); step(-1); }
        });
        box.addEventListener('close', () => { hideTip(); box.remove(); });
        box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
        document.body.append(box);
        show();
        box.showModal();
      },
    });
  }

  // Bars: one row per item. bar = main value; optional tick = second value (last week / first paint).
  function bars({ rows, max, aria, tickName, host }) {
    const scale = el('span', { class: 'sv-rank-scale', 'aria-hidden': 'true' }, [0, 0.5, 1].map((f) => {
      const t = el('span', { class: 'sv-rank-tick', text: (max * f).toLocaleString('en-GB') }); t.style.left = `${f * 100}%`; return t;
    }));
    const list = el('div', { class: 'sv-bars', role: 'table', 'aria-label': aria },
      el('div', { class: 'sv-bars-row sv-bars-head', role: 'row' },
        el('span', { role: 'columnheader', text: '' }), el('span', { role: 'columnheader' }, scale),
        el('span', { role: 'columnheader', class: 'sv-n', text: 'ms' }), el('span', { role: 'columnheader', class: 'sv-n', text: tickName || '' })),
      rows.map((r) => {
        const bar = el('span', { class: 'sv-bar' });
        bar.style.width = `${Math.min(100, ((r.value ?? 0) / max) * 100)}%`;
        let tick = null;
        if (num(r.tick) != null) { tick = el('span', { class: 'sv-bar-tick' }); tick.style.left = `${Math.min(100, (r.tick / max) * 100)}%`; }
        const row = el('div', { class: `sv-bars-row${r.gold ? ' sv-gold' : ''}`, role: 'row' },
          el('span', { role: 'cell', class: 'sv-bars-name' }, el('span', { text: r.name }), r.note ? el('span', { class: 'sv-bars-note', text: r.note }) : null),
          el('span', { role: 'cell', class: 'sv-bars-track' }, bar, tick),
          el('span', { role: 'cell', class: 'sv-n sv-bars-v', text: ms(r.value) }),
          el('span', { role: 'cell', class: `sv-n sv-bars-x${r.rise ? ' sv-rise' : ''}`, text: r.extra ?? '' }));
        if (r.tip) hoverable(row, host(), r.tip);
        return row;
      }));
    return list;
  }

  // Line chart: weeks along x, a line per engine.
  function lineChart(title, weeks, series, big) {
    const W = big ? 900 : 452, H = big ? 420 : 232, L = 44, R = 74, T = 14, B = 28;
    const iw = W - L - R, ih = H - T - B;
    const all = series.flatMap((s) => s.points).filter((v) => num(v) != null);
    const { max, step } = niceMax(Math.max(100, ...all) * 1.08);
    const x = (i) => L + (weeks.length === 1 ? iw / 2 : (i / (weeks.length - 1)) * iw);
    const y = (v) => T + ih - (v / max) * ih;
    const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sv-chart', role: 'img', 'aria-label': `${title}. Lines: ${series.map((s) => s.name).join(', ')}. Numbers below.` });
    for (let v = 0; v <= max; v += step) {
      svg.append(S('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'sv-axis' : 'sv-gridline' }));
      svg.append(S('text', { x: L - 6, y: y(v) + 3, class: 'sv-tick', 'text-anchor': 'end' }, v.toLocaleString('en-GB')));
    }
    const every = Math.ceil(weeks.length / (big ? 12 : 6));
    weeks.forEach((w, i) => {
      const last = i === weeks.length - 1;
      if (last || (i % every === 0 && weeks.length - 1 - i >= every)) svg.append(S('text', { x: x(i), y: H - 8, class: 'sv-tick', 'text-anchor': 'middle' }, weekName(w).slice(4)));
    });
    const ends = [];
    for (const s of series) {
      const pts = s.points.map((v, i) => [i, v]).filter(([, v]) => num(v) != null);
      if (pts.length > 1) svg.append(S('path', { d: pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), class: `sv-line sv-line-${s.key}`, 'stroke-dasharray': DASH[s.key] }));
      for (const [i, v] of pts) svg.append(S('circle', { cx: x(i), cy: y(v), r: 4, class: `sv-mark sv-mark-${s.key}` }));
      if (pts.length) { const [i, v] = pts.at(-1); ends.push({ s, x: x(i), y: y(v) }); }
    }
    ends.sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 12) ends[k].y = ends[k - 1].y + 12;
    for (const e of ends) svg.append(S('text', { x: e.x + 9, y: e.y + 3.5, class: `sv-endlabel sv-endlabel-${e.s.key}` }, e.s.name));
    const cross = S('line', { y1: T, y2: T + ih, class: 'sv-cross', visibility: 'hidden' });
    const hit = S('rect', { x: L - 10, y: T, width: iw + 20, height: ih, class: 'sv-hit' });
    svg.append(cross, hit);
    const fig = el('figure', { class: `sv-figure${big ? ' sv-figure-big' : ''}` });
    hit.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = weeks.length === 1 ? 0 : Math.max(0, Math.min(weeks.length - 1, Math.round(((px - L) / iw) * (weeks.length - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      showTip(fig, ev.clientX, ev.clientY, [[weekName(weeks[i]), '', true], ...series.map((s) => [s.name, num(s.points[i]) == null ? '—' : `${ms(s.points[i])} ms`])]);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    fig.append(el('figcaption', { class: 'sv-figtitle', text: title }), svg,
      el('details', { class: 'sv-numbers', open: big || null }, el('summary', { text: 'Numbers' }),
        el('table', { class: 'sv-mini' },
          el('thead', {}, el('tr', {}, el('th', { text: '' }), series.map((s) => el('th', { scope: 'col', text: s.name })))),
          el('tbody', {}, weeks.map((w, i) => el('tr', {}, el('th', { scope: 'row', text: weekName(w) }), series.map((s) => el('td', { text: ms(s.points[i]) }))))))));
    return fig;
  }
  function legend() {
    return el('div', { class: 'sv-legend', 'aria-hidden': 'true' }, ENGINES.map((e) => {
      const s = S('svg', { viewBox: '0 0 22 8', class: 'sv-legend-swatch' });
      s.append(S('line', { x1: 1, x2: 21, y1: 4, y2: 4, class: `sv-line sv-line-${e}`, 'stroke-dasharray': DASH[e] }));
      return el('span', { class: 'sv-legend-item' }, s, el('span', { text: ENGINE_NAME[e] }));
    }));
  }

  // ── the view ─────────────────────────────────────────────────────────────────────────────
  function mount(root, data, names = {}) {
    const st = { tab: 'week', wk: 0, place: null, week: null, vpn: 'vpn-off', metric: 'ready', page: '/', engine: 'webkit', others: false, cvpn: 'vpn-off', copied: null };
    const placed = data.runs.filter((r) => r.place && LABELS.includes(r.label));
    const places = placesOf(placed);
    st.place = places.includes('L1') ? 'L1' : places[0] || null;
    const placeName = (p) => (names[p] ? `${p} · ${names[p]}` : p);
    const TABS = [['week', 'This week'], ['trend', 'Trend'], ['places', 'Places'], ['others', 'Share vs others'], ['cache', 'Caching (D2)']];
    const runStrip = el('div', { class: 'sv-run' });
    const tabBar = el('div', { class: 'sv-tabs', role: 'tablist', 'aria-label': 'Speed views' });
    const body = el('div', { class: 'sv-body', role: 'tabpanel' });
    root.replaceChildren(runStrip, tabBar, body);
    const set = (k) => (v) => { st[k] = v; draw(); };

    function drawRun() {
      const code = st.place || 'L1';
      const cmds = [
        ['Weekly · VPN off, then on', `cd ${REPO} && node dev/speed/speed.mjs --weekly --place=${code}`],
        ['Monthly · with the other sites', `cd ${REPO} && node dev/speed/speed.mjs --weekly --with-others --place=${code}`],
        ['One run · Mullvad as it is now', `cd ${REPO} && node dev/speed/speed.mjs --place=${code}`],
      ];
      runStrip.replaceChildren(
        el('div', { class: 'sv-run-head' },
          el('span', { class: 'sv-field-k', text: 'Run from Terminal.app' }),
          el('span', { class: 'sv-run-hint', text: 'It asks you to switch Mullvad on halfway, then shows summary.json in Finder: drag it here.' })),
        el('div', { class: 'sv-run-cmds' }, cmds.map(([label, cmd], i) => el('div', { class: 'sv-run-cmd' },
          el('span', { class: 'sv-run-label', text: label }),
          el('code', { class: 'sv-run-code', text: cmd }),
          el('button', {
            type: 'button', class: 'sv-copy', text: st.copied === i ? 'Copied' : 'Copy',
            onclick: async (e) => {
              try { await navigator.clipboard.writeText(cmd); }
              catch { const sel = getSelection(); sel.selectAllChildren(e.target.previousSibling); return; }
              st.copied = i; drawRun(); setTimeout(() => { st.copied = null; drawRun(); }, 1800);
            },
          })))));
    }
    function draw() {
      drawRun();
      tabBar.replaceChildren(...TABS.map(([k, label]) => el('button', {
        type: 'button', role: 'tab', class: 'sv-tab', 'aria-selected': String(st.tab === k), text: label,
        onclick: () => { st.tab = k; draw(); },
      })));
      hideTip();
      body.replaceChildren(...({ week, trend, places: placesTab, others, cache })[st.tab]().filter(Boolean));
    }
    const noPlace = () => [headline('No run with a place code yet. Copy the weekly command above and run it in Terminal.app.')];
    const placeSelect = () => select('Place', places.map((p) => [p, placeName(p)]), st.place, set('place'));

    // This week: four panels (page × VPN), a bar per engine; tick = last week.
    function week() {
      if (!st.place) return [...noPlace(), earlier()];
      const weeks = weeksFor(placed, st.place);
      const wk = weeks.includes(st.week) ? st.week : weeks.at(-1);
      const cur = {}, prev = {};
      for (const l of LABELS) { cur[l] = weekRun(placed, st.place, l, wk); prev[l] = prevRun(placed, st.place, l, wk); }
      const prevWeek = LABELS.map((l) => prev[l]).find(Boolean);
      const rises = [];
      for (const p of PAGES) for (const l of LABELS) for (const e of ENGINES) {
        const a = prev[l]?.results?.[e]?.[p]?.ready, b = cur[l]?.results?.[e]?.[p]?.ready;
        if (num(a) && num(b) != null && (b - a) / a > RISE) rises.push(`${ENGINE_NAME[e]} · ${PAGE_NAME[p]} · ${LABEL_NAME[l]} ${pct((b - a) / a)}`);
      }
      const w0 = cur['vpn-off']?.results?.webkit?.['/']?.ready, w1 = cur['vpn-on-daita']?.results?.webkit?.['/']?.ready;
      const head = `Upload page on Safari’s engine: ready in ${secs(w0)} with the VPN off, ${secs(w1)} with it on. ${rises.length ? `${words(rises.length)} rise${rises.length > 1 ? 's' : ''} over 20 % on the week before: ${rises.join('; ')}.` : prevWeek ? 'Nothing rose more than 20 % on the week before.' : 'First week here, so nothing to compare yet.'}`;
      const all = [];
      for (const l of LABELS) for (const p of PAGES) for (const e of ENGINES) all.push(cur[l]?.results?.[e]?.[p]?.ready, prev[l]?.results?.[e]?.[p]?.ready);
      const { max } = niceMax(Math.max(100, ...all.filter((v) => num(v) != null)) * 1.04);
      // Four charts — page × VPN — one per sub-tab; Full view steps through all four with ← / →.
      const COMBOS = PAGES.flatMap((p) => LABELS.map((l) => [p, l]));
      const comboName = ([p, l]) => `${PAGE_NAME[p]} · ${LABEL_NAME[l]}`;
      const chart = ([p, l], big) => {
        const panel = el('section', { class: `sv-panel${big ? ' sv-panel-big' : ''}`, 'aria-label': comboName([p, l]) });
        panel.append(cur[l] ? bars({
          max, aria: `${comboName([p, l])}, ready in ms`, tickName: 'week before', host: () => panel,
          rows: ENGINES.map((e) => {
            const m = cur[l].results?.[e]?.[p] || {};
            const was = prev[l]?.results?.[e]?.[p]?.ready;
            const d = num(was) && num(m.ready) != null ? (m.ready - was) / was : null;
            return {
              name: ENGINE_NAME[e], gold: e === 'webkit', value: m.ready, tick: was,
              extra: d == null ? '' : `${d > RISE ? '⚑ ' : ''}${pct(d)}`, rise: d != null && d > RISE,
              tip: () => [[`${ENGINE_NAME[e]} · ${comboName([p, l])}`, '', true], ['Ready', `${ms(m.ready)} ms`], ['First paint', `${ms(m.fcp)} ms`], ['Largest paint', `${ms(m.lcp)} ms`], ['Requests', ms(m.requests)], ['Week before', num(was) == null ? '—' : `${ms(was)} ms`]],
            };
          }),
        }) : el('p', { class: 'sv-quiet', text: `No ${LABEL_NAME[l]} run this week.` }));
        return panel;
      };
      const k = Math.min(st.wk, COMBOS.length - 1);
      const subtabs = el('div', { class: 'sv-subtabs', role: 'tablist', 'aria-label': 'Chart' },
        COMBOS.map((c, i) => el('button', { type: 'button', role: 'tab', class: 'sv-subtab', 'aria-selected': String(i === k), text: comboName(c), onclick: () => { st.wk = i; draw(); } })));
      const slides = COMBOS.map((c) => ({ title: `${comboName(c)} · ${placeName(st.place)} · ${weekName(wk)}`, build: (big) => chart(c, big) }));
      const others = data.runs.filter((r) => r.place === st.place && weekOf(r.when) === wk && !LABELS.some((l) => cur[l] === r));
      return [
        headline(head),
        el('div', { class: 'sv-controls' },
          placeSelect(),
          select('Week', weeks.slice().reverse().map((w) => [w, weekName(w)]), wk, set('week')),
          el('span', { class: 'sv-controls-note', text: prevWeek ? `Tick = ${weekName(weekOf(prevWeek.when))}` : '' })),
        el('div', { class: 'sv-conds' }, LABELS.map((l) => cur[l]).filter(Boolean).map(condLine)),
        subtabs,
        chart(COMBOS[k], false),
        el('div', { class: 'sv-under' },
          el('p', { class: 'sv-note', text: 'Ready = the page’s load event, in milliseconds, median of 5 cold loads. The thin mark is the week before. Gold = Safari’s engine. Hover a row for paints and requests; in Full view, ← and → step through the four charts.' }),
          fullView(slides, k)),
        others.length ? el('p', { class: 'sv-quiet', text: `Also this week: ${others.map((r) => `${when(r.when)} ${LABEL_NAME[r.label] || r.label || ''}${r.note ? ` “${r.note}”` : ''}`).join(' · ')}` }) : null,
        earlier(),
      ];
    }

    function earlier() {
      const old = data.runs.filter((r) => !r.place && LABELS.includes(r.label));
      if (!old.length) return null;
      return el('details', { class: 'sv-earlier' },
        el('summary', { text: `Earlier runs without a place code (${old.length})` }),
        el('table', { class: 'sv-mini sv-mini-wide' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Run' }), PAGES.flatMap((p) => ENGINES.map((e) => el('th', { scope: 'col', text: `${PAGE_NAME[p] === 'Upload page' ? 'Upload' : 'Sign-in'} ${ENGINE_NAME[e]}` }))))),
          el('tbody', {}, old.slice().reverse().map((r) => el('tr', {}, el('th', { scope: 'row', text: `${when(r.when)} · ${LABEL_NAME[r.label]}` }),
            PAGES.flatMap((p) => ENGINES.map((e) => el('td', { text: ms(r.results?.[e]?.[p]?.ready) }))))))));
    }

    function trend() {
      if (!st.place) return noPlace();
      const weeks = weeksFor(placed, st.place);
      const pts = (p, e) => weeks.map((w) => weekRun(placed, st.place, st.vpn, w)?.results?.[e]?.[p]?.[st.metric] ?? null);
      const chart = (p, big) => lineChart(`${PAGE_NAME[p]} · ${METRIC_NAME[st.metric]}, ms · ${LABEL_NAME[st.vpn]}`, weeks, ENGINES.map((e) => ({ key: e, name: ENGINE_NAME[e], points: pts(p, e) })), big);
      const wk = pts('/', 'webkit').map((v, i) => [weeks[i], v]).filter(([, v]) => num(v) != null);
      const head = wk.length > 1
        ? `Upload page on Safari’s engine, ${LABEL_NAME[st.vpn]}: ${METRIC_NAME[st.metric].toLowerCase()} ${secs(wk.at(-1)[1])} this week, ${secs(wk[0][1])} ${weekName(wk[0][0]).replace('w/c', 'in the week of')}.`
        : 'One week so far. Lines start with the second weekly run.';
      return [
        headline(head),
        el('div', { class: 'sv-controls' }, placeSelect(),
          seg('VPN', LABELS.map((l) => [l, LABEL_NAME[l]]), st.vpn, set('vpn')),
          seg('Measure', Object.entries(METRIC_NAME), st.metric, set('metric'))),
        legend(),
        el('div', { class: 'sv-charts' }, PAGES.map((p, i) => el('div', { class: 'sv-chart-cell' }, chart(p, false),
          fullView(PAGES.map((q) => ({ title: `${PAGE_NAME[q]} · ${METRIC_NAME[st.metric]} · ${placeName(st.place)} · ${LABEL_NAME[st.vpn]}`, build: () => el('div', {}, legend(), chart(q, true)) })), i)))),
        el('p', { class: 'sv-note', text: 'One point per week: the week’s --weekly run, or its latest run if there was none. Hover for the week’s figures; Numbers opens them as a table.' }),
      ];
    }

    function placesTab() {
      if (!places.length) return noPlace();
      const rows = places.map((pl) => { const w = weeksFor(placed, pl).at(-1); return { pl, w, r: weekRun(placed, pl, st.vpn, w) }; });
      const best = {};
      for (const e of ENGINES) for (const { pl, r } of rows) { const v = r?.results?.[e]?.[st.page]?.ready; if (num(v) != null && (best[e] == null || v < best[e][1])) best[e] = [pl, v]; }
      return [
        headline(places.length === 1 ? `One place so far: ${placeName(places[0])}. Run the weekly command somewhere else to compare.` : `${words(places.length)} places, each at its latest week. Same code, different networks.`),
        el('div', { class: 'sv-controls' },
          seg('Page', PAGES.map((p) => [p, PAGE_NAME[p]]), st.page, set('page')),
          seg('VPN', LABELS.map((l) => [l, LABEL_NAME[l]]), st.vpn, set('vpn'))),
        el('div', { class: 'sv-frame' }, el('table', { class: 'sv-grid' },
          el('thead', {}, el('tr', {},
            el('th', { scope: 'col', text: 'Place' }), el('th', { scope: 'col', text: 'Week' }), el('th', { scope: 'col', class: 'sv-n', text: 'Down / up' }), el('th', { scope: 'col', class: 'sv-n', text: 'RPM' }),
            ENGINES.map((e) => el('th', { scope: 'col', class: 'sv-n', text: ENGINE_NAME[e] })))),
          el('tbody', {}, rows.map(({ pl, w, r }) => el('tr', {},
            el('th', { scope: 'row', class: 'sv-engine' }, el('span', { text: pl }), names[pl] ? el('span', { class: 'sv-engine-note', text: names[pl] }) : null),
            el('td', { class: 'sv-dim', text: r ? weekName(w) : `${weekName(w)} · no ${LABEL_NAME[st.vpn]} run` }),
            el('td', { class: 'sv-n', text: r?.cond?.down_mbps != null ? `${Math.round(r.cond.down_mbps)} / ${Math.round(r.cond.up_mbps)} Mbps` : '—' }),
            el('td', { class: 'sv-n', text: r?.cond?.rpm != null ? String(r.cond.rpm) : '—' }),
            ENGINES.map((e) => { const fast = places.length > 1 && best[e]?.[0] === pl; return el('td', { class: 'sv-n' }, fast ? el('span', { class: 'sv-fast-mark', title: 'fastest place for this engine' }) : null, ms(r?.results?.[e]?.[st.page]?.ready)); })))))),
        el('p', { class: 'sv-note', text: 'Ready, ms. If every engine is slower at one place by about the same share, and its down/up and RPM are lower, that’s the network. If one engine or one page moves on its own, look at the code: check the release under This week.' }),
      ];
    }

    function others() {
      const compPlaces = [...new Set(data.competitors.map((c) => c.place).filter(Boolean))];
      const pl = compPlaces.includes(st.place) ? st.place : compPlaces[0] || st.place;
      const wk = weeksFor(placed, pl).at(-1);
      const share = pl ? weekRun(placed, pl, st.cvpn, wk) : null;
      const controls = el('div', { class: 'sv-controls' },
        seg('VPN', LABELS.map((l) => [l, LABEL_NAME[l]]), st.cvpn, set('cvpn')),
        seg('Engine', ENGINES.map((e) => [e, ENGINE_NAME[e]]), st.engine, set('engine')),
        el('button', { type: 'button', class: 'sv-toggle', 'aria-pressed': String(st.others), onclick: () => { st.others = !st.others; draw(); }, text: st.others ? 'Hide the other sites' : 'Show the other sites' }));
      if (!share) return [headline(`No Share run at ${pl || 'any place'} with the ${LABEL_NAME[st.cvpn]}.`), controls];
      const m = share.results?.[st.engine]?.['/'] || {};
      const near = data.competitors.filter((c) => c.place === pl && c.label === st.cvpn && Math.abs(Date.parse(c.when) - Date.parse(share.when)) <= 90 * 60e3 && c.results[st.engine]);
      const ranked = [{ name: 'Share', share: true, m, when: share.when }, ...near.map((c) => ({ name: c.name, m: c.results[st.engine], when: c.when }))]
        .sort((a, b) => (a.m.lcp ?? a.m.fcp ?? 1e9) - (b.m.lcp ?? b.m.fcp ?? 1e9));  // for the headline
      const rank = ranked.findIndex((r) => r.share) + 1;
      const head = st.others && near.length
        ? `Share’s upload page comes ${rank} of ${ranked.length} by largest paint on ${ENGINE_NAME[st.engine]}, ${LABEL_NAME[st.cvpn]}: ${secs(m.lcp)}.`
        : `Share at ${pl}, ${weekName(wk)}: the upload page paints in ${secs(m.fcp)} on ${ENGINE_NAME[st.engine]}, ${LABEL_NAME[st.cvpn]}.`;
      const out = [headline(head), controls,
        el('div', { class: 'sv-hero' },
          el('div', { class: 'sv-hero-k', text: `Share at ${pl}, ${weekName(wk)} · ${LABEL_NAME[st.cvpn]} · ${ENGINE_NAME[st.engine]}${ENGINE_NOTE[st.engine] ? ` (${ENGINE_NOTE[st.engine]})` : ''} · upload page` }),
          el('div', { class: 'sv-hero-row' },
            [['First paint', m.fcp, ' ms'], ['Largest paint', m.lcp, ' ms'], ['Ready', m.ready, ' ms'], ['Requests', m.requests, '']].map(([k, v, u]) => el('div', { class: 'sv-hero-cell' },
              el('div', { class: 'sv-hero-v' }, el('span', { text: ms(v) }), u ? el('span', { class: 'sv-unit', text: u }) : null),
              el('div', { class: 'sv-hero-l', text: k })))),
          el('div', { class: 'sv-hero-when', text: `${when(share.when)} · release ${share.release ?? '?'}` }))];
      if (!st.others) return out;
      if (!near.length) return [...out, el('p', { class: 'sv-quiet', text: 'No run of the other sites alongside this Share run (same place and VPN, within 90 minutes). The monthly command measures them straight after Share.' })];
      // One ranked list per engine; Full view steps through the four engines with ← / →.
      const rankFor = (eng) => [{ name: 'Share', share: true, m: share.results?.[eng]?.['/'] || {}, when: share.when },
        ...near.filter((c) => c.results[eng]).map((c) => ({ name: c.name, m: c.results[eng], when: c.when }))]
        .sort((a, b) => (a.m.lcp ?? a.m.fcp ?? 1e9) - (b.m.lcp ?? b.m.fcp ?? 1e9));
      const list = (eng, big) => {
        const rows = rankFor(eng);
        const { max } = niceMax(Math.max(100, ...rows.map((r) => Math.max(r.m.lcp ?? 0, r.m.fcp ?? 0))) * 1.02);
        const wrap = el('div', { class: `sv-frame sv-frame-pad${big ? ' sv-big' : ''}` });
        wrap.append(bars({
          max, aria: `Largest paint, ranked, ${ENGINE_NAME[eng]}`, tickName: 'first paint', host: () => wrap,
          rows: rows.map((r, i) => ({
            name: `${i + 1}  ${r.name}`, gold: r.share, value: r.m.lcp ?? r.m.fcp, tick: r.m.fcp, extra: ms(r.m.fcp),
            tip: () => [[r.name, '', true], ['First paint', `${ms(r.m.fcp)} ms`], ['Largest paint', r.m.lcp == null ? 'not reported' : `${ms(r.m.lcp)} ms`], ['Ready', `${ms(r.m.ready)} ms`], ['Requests', ms(r.m.requests)], ['Measured', hhmm(r.when)]],
          })),
        }));
        return wrap;
      };
      const span = near.map((c) => c.when).sort();
      out.push(list(st.engine, false), el('div', { class: 'sv-under' },
        el('p', { class: 'sv-note', text: `Bar = largest paint, ms; the thin mark is first paint. Their public landing pages against our app’s upload page, so not like for like: theirs are marketing pages, ours is the app itself. Same Mac, place and VPN; Share at ${hhmm(share.when)}, the others ${hhmm(span[0])}–${hhmm(span.at(-1))}. Sizes left out: other sites’ byte counts undercount. For the table with an investor, never for publishing.` }),
        fullView(ENGINES.map((eng) => ({ title: `Share vs others · ${pl} · ${ENGINE_NAME[eng]} · ${LABEL_NAME[st.cvpn]}`, build: (big) => list(eng, big) })), ENGINES.indexOf(st.engine))));
      return out;
    }

    function cache() {
      return [
        headline('Decided 17 Oct (D2): no long-term caching of the app’s files until Block B, when WEBCAT checks every file on fetch. Run the test again only if that changes.'),
        el('div', { class: 'sv-frame' }, el('table', { class: 'sv-grid sv-cache' },
          el('caption', { class: 'sv-cap', text: 'Plan §9 · 17 Oct 2026 · release app-4298abd19b · L1 · a return visit, ready, median of 5' }),
          el('thead', {}, el('tr', {}, ['Engine', 'Files rechecked, today → immutable', 'Live today, VPN off', 'Tunnel, today → immutable, VPN off', 'Live today, VPN on', 'Tunnel, today → immutable, VPN on'].map((h, i) => el('th', { scope: 'col', class: i ? 'sv-n' : null, text: h })))),
          el('tbody', {}, [
            ['Chromium', '33 → 1', '230 ms', '267 → 114 ms', '368 ms', '516 → 178 ms'],
            ['WebKit', '34 → 2', '469 ms', '484 → 365 ms', '565 ms', '620 → 493 ms'],
            ['Firefox', '33 → 1', '197 ms', '291 → 169 ms', '447 ms', '552 → 201 ms'],
            ['Brave', '35 → 2', '216 ms', '303 → 120 ms', '331 ms', '461 → 181 ms'],
          ].map((r) => el('tr', {}, el('th', { scope: 'row', class: 'sv-engine', text: r[0] }), r.slice(1).map((v) => el('td', { class: 'sv-n', text: v }))))))),
        el('p', { class: 'sv-note', text: 'What it showed: long-term caching would cut a return visit from about 33 rechecks to 1–2 and save roughly 0.1–0.15 s with the VPN off, 0.25–0.35 s with it on (WebKit about 0.12 s). First visits gain nothing, and most visitors are receivers opening one link once. Run it again when Block B lands, when a release adds many more files, or if you’re thinking of changing the caching headers.' }),
        data.cacheAb.length ? el('details', { class: 'sv-earlier' }, el('summary', { text: `Raw runs (${data.cacheAb.length})` }),
          el('div', { class: 'sv-cache-cols' }, data.cacheAb.map((f) => {
            const g = (t, e, k) => f.targets[t]?.[e]?.[k] ?? null;
            return el('div', { class: 'sv-cache-file' },
              el('div', { class: 'sv-cond' }, el('span', { class: 'sv-cond-k', text: LABEL_NAME[f.label] || f.label || '—' }),
                el('span', { class: 'sv-cond-v', text: `${when(f.when)} · ${f.release ?? '?'}${f.cond?.down_mbps != null ? ` · ${Math.round(f.cond.down_mbps)}↓ / ${Math.round(f.cond.up_mbps)}↑ Mbps · ${f.cond.rpm} RPM` : ''}` })),
              el('table', { class: 'sv-mini sv-mini-wide' },
                el('thead', {}, el('tr', {}, ['', 'Localhost', 'Tunnel', 'Live', 'Rechecks'].map((h) => el('th', { scope: 'col', text: h })))),
                el('tbody', {}, ENGINES.filter((e) => f.targets['local-today']?.[e]).map((e) => el('tr', {},
                  el('th', { scope: 'row', text: ENGINE_NAME[e] }),
                  el('td', { text: `${ms(g('local-today', e, 'warm_ready'))} → ${ms(g('local-immutable', e, 'warm_ready'))}` }),
                  el('td', { text: `${ms(g('tunnel-today', e, 'warm_ready'))} → ${ms(g('tunnel-immutable', e, 'warm_ready'))}` }),
                  el('td', { text: ms(g('live-today', e, 'warm_ready')) }),
                  el('td', { text: `${g('tunnel-today', e, 'rechecked') ?? '—'} → ${g('tunnel-immutable', e, 'rechecked') ?? '—'}` }))))));
          }))) : null,
      ];
    }

    draw();
  }

  return { load, mount, readFiles, parsePlaces, weekOf, weekRun };
})();

if (typeof module !== 'undefined') module.exports = SpeedView;
