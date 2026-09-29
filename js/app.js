/* Digital SAT mock exam engine.
   Loads modules described in data/manifest.json, runs a timed, focus-oriented test,
   and shows a scored review with explanations. No build step or local dependencies.
   Math modules add grid-in answers, a Desmos calculator panel and a formula reference sheet. */
(() => {
  'use strict';

  const STORE_KEY = 'sat-mock-v1';
  const LETTERS = ['A', 'B', 'C', 'D'];
  // Desmos publishes this key for evaluation use. Replace it with your own key for anything public.
  const DESMOS_SRC = 'https://www.desmos.com/api/v1.9/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6';
  const app = document.getElementById('app');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  /* ---------------- Helpers ---------------- */
  const isMath = (def) => def.section === 'Math';
  // Modules flagged "rich" carry trusted HTML (superscripts, fractions) in prompt, choices and explanations.
  const txt = (def, s) => (def && def.rich ? String(s) : esc(s));

  function parseGrid(s) {
    s = String(s).trim().replace(/\s+/g, '').replace(/[−–]/g, '-');
    if (!s) return NaN;
    let m = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
    if (m) return parseFloat(m[2]) === 0 ? NaN : parseFloat(m[1]) / parseFloat(m[2]);
    if (/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return parseFloat(s);
    return NaN;
  }

  function isCorrect(q, a) {
    if (a == null) return false;
    if (q.type === 'grid') {
      const v = parseGrid(a);
      if (Number.isNaN(v)) return false;
      return q.nums.some((n) => Math.abs(v - n) <= (q.tol || 0) + 1e-9);
    }
    return a === q.answer;
  }

  /* ---------------- State ---------------- */
  const data = { manifest: null, modules: {} };
  let state = loadState();
  let session = null; // active test: { entry, def, st, visitStart, last, tick, saveCount }
  let reviewFilter = 'all';
  let lastResult = null;
  let calc = null; // Desmos calculator instance, kept alive across questions

  function defaultSettings() {
    return { timed: true, showTimer: true, elimination: true, showLabels: true, theme: 'auto' };
  }

  function loadState() {
    const base = { settings: defaultSettings(), modules: {} };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { settings: { ...base.settings, ...(p.settings || {}) }, modules: p.modules || {} };
      }
    } catch (e) { /* storage unavailable: run without persistence */ }
    return base;
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  const ms = (id) => state.modules[id];

  function moduleNumber(entry) {
    let n = 0;
    for (const m of data.manifest.modules) {
      if (m.section === entry.section) n++;
      if (m.id === entry.id) return n;
    }
    return n;
  }

  /* ---------------- Data loading ---------------- */
  async function getModule(entry) {
    if (data.modules[entry.id]) return data.modules[entry.id];
    const res = await fetch(entry.file);
    if (!res.ok) throw new Error(`Could not load ${entry.file} (${res.status})`);
    const json = await res.json();
    data.modules[entry.id] = json;
    return json;
  }

  async function boot() {
    applyTheme();
    try {
      if (window.SAT_DATA) {
        data.manifest = window.SAT_DATA.manifest;
        data.modules = { ...window.SAT_DATA.modules };
      } else {
        const res = await fetch('data/manifest.json');
        data.manifest = await res.json();
      }
    } catch (e) {
      app.innerHTML = `<main class="center-card"><h1>Could not load exam data</h1>
        <p>Open this folder with a local web server (for example <code>npx serve</code> or <code>python -m http.server</code>),
        or run <code>node tools/build-bundle.mjs</code> so the exam also works when opened directly from disk.</p>
        <p class="review-meta">${esc(e.message)}</p></main>`;
      return;
    }
    renderHome();
  }

  /* ---------------- Home ---------------- */
  function renderHome() {
    stopTimer();
    hideCalc();
    session = null;
    const m = data.manifest;
    const s = state.settings;
    const cards = m.modules.map((entry) => {
      const st = ms(entry.id);
      const ready = entry.status === 'ready';
      let chip = '<span class="chip pending">Not yet generated</span>';
      let actions = '<button class="btn" disabled>Locked</button>';
      if (ready && !st) {
        chip = '<span class="chip">Not started</span>';
        actions = `<button class="btn btn-primary" data-action="start" data-id="${entry.id}">Begin module</button>`;
      } else if (ready && st.status === 'active') {
        chip = `<span class="chip progress">In progress · ${st.timed ? fmt(st.remaining) + ' left' : 'untimed'}</span>`;
        actions = `<button class="btn btn-primary" data-action="resume" data-id="${entry.id}">Resume</button>
                   <button class="btn" data-action="retake" data-id="${entry.id}">Restart</button>`;
      } else if (ready && st.status === 'done') {
        const def = data.modules[entry.id];
        const c = def ? def.questions.filter((q) => isCorrect(q, st.answers[q.n])).length : '?';
        chip = `<span class="chip done">Completed · ${c}/${entry.questionCount}</span>`;
        actions = `<button class="btn btn-primary" data-action="results" data-id="${entry.id}">View results</button>
                   <button class="btn" data-action="retake" data-id="${entry.id}">Retake</button>`;
      }
      return `<li class="module-card ${ready ? '' : 'locked'}">
        <div>
          <h3>${esc(entry.label)}</h3>
          <p>${esc(entry.note || '')}</p>
          <div class="module-meta"><span class="chip">${entry.minutes} min</span><span class="chip">${entry.questionCount} questions</span>${chip}</div>
        </div>
        <div class="card-actions">${actions}</div>
      </li>`;
    }).join('');

    app.innerHTML = `<div class="screen scroll"><main class="home">
      <h1>${esc(m.examTitle)}</h1>
      <p class="edition">${esc(m.edition)}</p>
      <div class="callout"><strong>Difficulty calibration.</strong> ${esc(m.difficultyNote)}
        Modules are generated one at a time, so complete a module, take your break, then ask for the next.</div>
      <ul class="module-list">${cards}</ul>
      <div class="callout"><strong>Score report and analysis.</strong> Scoring guide (raw to scaled), post-test analysis and a printable pacing card.
        Fills in automatically as you finish modules. <a href="report.html">Open the report →</a></div>
      <div class="callout"><strong>Vocabulary flashcards.</strong> Every word tested in the exam, the hard words from the passages, and usage patterns.
        Spaced repetition, plus a deck of the words you missed. <a href="flashcards.html">Open the flashcards →</a></div>
      <section class="settings" aria-label="Settings">
        <h2>Settings</h2>
        <label class="setting-row"><input type="checkbox" data-setting="timed" ${s.timed ? 'checked' : ''}> Timed mode (applies when you start a module)</label>
        <label class="setting-row"><input type="checkbox" data-setting="showLabels" ${s.showLabels ? 'checked' : ''}> Show domain, skill and difficulty labels during the test (turn off for exam realism)</label>
        <label class="setting-row"><input type="checkbox" data-setting="elimination" ${s.elimination ? 'checked' : ''}> Show answer cross-out buttons</label>
        <label class="setting-row">Theme
          <select data-setting="theme" aria-label="Theme">
            <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Match my device</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </label>
        <ul class="tips">
          <li><kbd>A</kbd>–<kbd>D</kbd> or <kbd>1</kbd>–<kbd>4</kbd> choose an answer, click it again to clear it.</li>
          <li><kbd>←</kbd> <kbd>→</kbd> move between questions, <kbd>F</kbd> marks for review, <kbd>N</kbd> opens the question navigator.</li>
          <li>Math modules include a Desmos graphing calculator (needs an internet connection) and a formula reference sheet.</li>
          <li>Your progress is saved in this browser. The timer only runs while a module is open.</li>
        </ul>
        <p style="margin:14px 0 0"><button class="btn btn-sm btn-ghost" data-action="resetall">Erase all saved progress</button></p>
      </section>
    </main></div>`;
  }

  /* ---------------- Stimulus renderers ---------------- */
  function tableHtml(t) {
    return `<div class="table-wrap"><table class="data"><caption>${esc(t.caption || '')}</caption>
      <thead><tr>${t.headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  }

  function chartHtml(c) {
    const W = 560, H = 340, m = { l: 54, r: 16, t: 20, b: 66 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const peak = Math.max(...c.series.flatMap((s) => s.values));
    const step = peak <= 40 ? 10 : 20;
    const max = Math.ceil(peak / step) * step;
    const y = (v) => m.t + ph - (v / max) * ph;
    const gw = pw / c.categories.length;
    const bw = (gw * 0.72) / c.series.length;
    let svg = '';
    for (let t = 0; t <= max; t += step) {
      svg += `<line class="grid-line" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/>`;
      svg += `<text class="axis-text" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    c.categories.forEach((cat, ci) => {
      const gx = m.l + ci * gw + gw * 0.14;
      c.series.forEach((s, si) => {
        const v = s.values[ci];
        const x = gx + si * bw;
        svg += `<rect class="s${si}" x="${x}" y="${y(v)}" width="${bw - 3}" height="${(v / max) * ph}" rx="2"/>`;
        svg += `<text class="axis-text" x="${x + (bw - 3) / 2}" y="${y(v) - 5}" text-anchor="middle">${v}%</text>`;
      });
      const words = cat.split(' ');
      const half = Math.ceil(words.length / 2);
      const lines = [words.slice(0, half).join(' '), words.slice(half).join(' ')].filter(Boolean);
      lines.forEach((ln, li) => {
        svg += `<text class="axis-text" x="${m.l + ci * gw + gw / 2}" y="${H - m.b + 20 + li * 15}" text-anchor="middle">${esc(ln)}</text>`;
      });
    });
    svg += `<text class="axis-text" transform="rotate(-90)" x="${-(m.t + ph / 2)}" y="14" text-anchor="middle">${esc(c.yLabel || '')}</text>`;
    const alt = `${c.title}. ` + c.categories.map((cat, i) => `${cat}: ` + c.series.map((s) => `${s.name} ${s.values[i]}%`).join(', ')).join('; ');
    return `<figure class="chart" style="margin:18px 0">
      <div class="chart-title">${esc(c.title)}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(alt)}">${svg}</svg>
      <div class="legend-row">${c.series.map((s, i) => `<span><i class="swatch s${i}" style="background:${i === 0 ? '#7d8f88' : 'var(--accent)'}"></i>${esc(s.name)}</span>`).join('')}</div>
    </figure>`;
  }

  function stimulusHtml(q, def) {
    let h = '';
    if (q.passage) h += `<div class="passage${isMath(def) ? ' math-passage' : ''}">${q.passage}</div>`;
    if (q.table) h += tableHtml(q.table);
    if (q.chart) h += chartHtml(q.chart);
    return h;
  }

  /* ---------------- Test flow ---------------- */
  function launch(id, mode) {
    const entry = data.manifest.modules.find((m) => m.id === id);
    if (!entry) return;
    getModule(entry).then((def) => {
      if (mode === 'start' || mode === 'retake') {
        state.modules[id] = {
          status: 'active', answers: {}, flags: {}, elims: {}, times: {}, calc: {}, current: 1,
          remaining: def.minutes * 60, timed: state.settings.timed, startedAt: Date.now(),
        };
        save();
      }
      const st = ms(id);
      if (mode === 'results' && st && st.status === 'done') { renderResults(entry, def); return; }
      if (!st) return;
      st.calc = st.calc || {};
      session = { entry, def, st, visitStart: performance.now(), last: Date.now(), tick: null, saveCount: 0 };
      renderTest();
      startTimer();
    }).catch((e) => { app.insertAdjacentHTML('afterbegin', `<p class="warn" style="padding:12px 24px">${esc(e.message)}</p>`); });
  }

  function startTimer() {
    stopTimer();
    if (!session) return;
    session.last = Date.now();
    session.tick = setInterval(() => {
      if (!session) return;
      const now = Date.now();
      const dt = (now - session.last) / 1000;
      session.last = now;
      const st = session.st;
      if (st.timed) {
        st.remaining = Math.max(0, st.remaining - dt);
        updateTimerEl();
        if (st.remaining <= 0) { submitModule(true); return; }
      }
      session.saveCount++;
      if (session.saveCount % 5 === 0) { commitVisit(); save(); }
    }, 1000);
  }

  function stopTimer() {
    if (session && session.tick) { clearInterval(session.tick); session.tick = null; }
  }

  function updateTimerEl() {
    const el = document.getElementById('timer');
    if (!el || !session) return;
    const st = session.st;
    if (!st.timed) { el.textContent = 'Untimed'; el.classList.remove('low'); return; }
    el.textContent = state.settings.showTimer ? fmt(st.remaining) : '––:––';
    el.classList.toggle('low', st.remaining < 300);
    const tg = document.getElementById('timerToggle');
    if (tg) tg.textContent = state.settings.showTimer ? 'Hide' : 'Show';
  }

  function commitVisit() {
    if (!session) return;
    const now = performance.now();
    const q = session.st.current;
    session.st.times[q] = (session.st.times[q] || 0) + (now - session.visitStart) / 1000;
    session.visitStart = now;
  }

  function goto(n) {
    const total = session.def.questions.length;
    if (n < 1 || n > total) return;
    commitVisit();
    session.st.current = n;
    save();
    renderTest();
  }

  function answerAreaHtml(q, st, def) {
    if (q.type === 'grid') {
      const v = st.answers[q.n] == null ? '' : String(st.answers[q.n]);
      return `<div class="grid-answer">
        <label for="gridInput" class="q-prompt" style="margin-bottom:8px;display:block">Enter your answer</label>
        <input id="gridInput" type="text" inputmode="text" autocomplete="off" spellcheck="false" maxlength="8" value="${esc(v)}" aria-describedby="gridHelp">
        <p class="review-meta" id="gridHelp">Enter a whole number, decimal or fraction (for example 12, −3.5 or 7/4). Answer preview: <strong id="gridPreview"></strong></p>
      </div>`;
    }
    const s = state.settings;
    const choices = q.choices.map((c, i) => {
      const elim = (st.elims[q.n] || []).includes(i);
      return `<li class="choice-row">
        <button class="choice${elim ? ' eliminated' : ''}" role="radio" aria-checked="${st.answers[q.n] === i}" data-action="choose" data-i="${i}">
          <span class="letter">${LETTERS[i]}</span><span class="text">${txt(def, c)}</span>
        </button>
        <button class="elim-btn" data-action="elim" data-i="${i}" aria-pressed="${elim}" aria-label="Cross out choice ${LETTERS[i]}" title="Cross out">⊘</button>
      </li>`;
    }).join('');
    return `<ul class="choices${s.elimination ? '' : ' no-elim'}" role="radiogroup" aria-label="Answer choices">${choices}</ul>`;
  }

  function gridPreviewText(v) {
    const n = parseGrid(v);
    if (String(v).trim() === '') return '';
    return Number.isNaN(n) ? 'not a valid number' : String(Math.round(n * 1e6) / 1e6);
  }

  function renderTest() {
    const { entry, def, st } = session;
    const q = def.questions[st.current - 1];
    const total = def.questions.length;
    const math = isMath(def);
    const s = state.settings;
    const labels = s.showLabels
      ? `<span class="review-meta">${esc(q.domain)} · ${esc(q.skill)}</span><span class="tag ${q.difficulty}">${q.difficulty}</span>${q.intl ? `<span class="chip progress" title="${esc(q.intl)}">International pattern</span>` : ''}${q.multi ? '<span class="chip progress" title="Multi-step problem built for the Desmos calculator">Desmos multi-step</span>' : ''}` : '';
    const stim = stimulusHtml(q, def);
    const promptHtml = `<p class="q-prompt${math ? ' math-stem' : ''}">${txt(def, q.prompt)}</p>`;
    // Math: stem and any figure/table on the left, answers on the right. R&W: passage left, prompt and choices right.
    const leftHtml = math ? stim + promptHtml : stim;
    const rightHtml = math ? '' : promptHtml;
    const hasLeft = math || !!stim;

    app.innerHTML = `<div class="screen" data-screen="test">
      <header class="topbar">
        <div class="title">${esc(entry.section)}<small>Module ${moduleNumber(entry)}</small></div>
        <div class="timer-wrap">
          <div class="timer" id="timer" role="timer" aria-live="off"></div>
          ${st.timed ? '<button class="timer-toggle" id="timerToggle" data-action="toggleTimer"></button>' : ''}
        </div>
        <div class="right">
          ${math ? '<button class="btn btn-sm" data-action="calc-toggle" aria-controls="calcPanel">Calculator</button><button class="btn btn-sm" data-action="ref-open">Reference</button>' : ''}
          <button class="btn btn-sm btn-ghost" data-action="exit">Save &amp; exit</button>
        </div>
      </header>
      <div class="workspace${hasLeft ? '' : ' single'}">
        <section class="pane pane-passage" aria-label="${math ? 'Problem' : 'Passage and data'}">${leftHtml}</section>
        <section class="pane pane-question${s.elimination ? '' : ' no-elim'}" aria-label="${math ? 'Answer' : 'Question'}">
          <div class="q-head">
            <span class="q-num">${q.n}</span>
            <button class="flag-btn" data-action="flag" aria-pressed="${!!st.flags[q.n]}">⚑ Mark for review</button>
            ${labels}
          </div>
          ${rightHtml}
          ${answerAreaHtml(q, st, def)}
        </section>
      </div>
      <footer class="bottombar">
        <div class="left">${st.timed ? '' : 'Untimed practice'}</div>
        <button class="nav-pill" data-action="nav-open" aria-haspopup="dialog">Question ${q.n} of ${total} ▴</button>
        <div class="right">
          <button class="btn btn-sm" data-action="prev" ${q.n === 1 ? 'disabled' : ''}>Back</button>
          <button class="btn btn-sm btn-primary" data-action="${q.n === total ? 'nav-open' : 'next'}">${q.n === total ? 'Review' : 'Next'}</button>
        </div>
      </footer>
    </div>`;
    updateTimerEl();
    const gp = document.getElementById('gridPreview');
    if (gp) gp.textContent = gridPreviewText(st.answers[q.n] || '');
    if (math) positionCalc(); else hideCalc();
  }

  function paintChoices() {
    const { def, st } = session;
    const q = def.questions[st.current - 1];
    document.querySelectorAll('.choice').forEach((el, i) => {
      el.setAttribute('aria-checked', String(st.answers[q.n] === i));
      el.classList.toggle('eliminated', (st.elims[q.n] || []).includes(i));
    });
    document.querySelectorAll('.elim-btn').forEach((el, i) => el.setAttribute('aria-pressed', String((st.elims[q.n] || []).includes(i))));
    const f = document.querySelector('.flag-btn');
    if (f) f.setAttribute('aria-pressed', String(!!st.flags[q.n]));
  }

  function choose(i) {
    const { def, st } = session;
    const q = def.questions[st.current - 1];
    if (q.type === 'grid' || i < 0 || i >= q.choices.length) return;
    if (st.answers[q.n] === i) delete st.answers[q.n]; else st.answers[q.n] = i;
    save();
    paintChoices();
  }

  function toggleElim(i) {
    const { def, st } = session;
    const q = def.questions[st.current - 1];
    const set = new Set(st.elims[q.n] || []);
    if (set.has(i)) set.delete(i); else set.add(i);
    st.elims[q.n] = [...set];
    save();
    paintChoices();
  }

  function toggleFlag() {
    const { def, st } = session;
    const q = def.questions[st.current - 1];
    if (st.flags[q.n]) delete st.flags[q.n]; else st.flags[q.n] = true;
    save();
    paintChoices();
  }

  /* ---------------- Calculator and reference sheet ---------------- */
  function calcPanel() {
    let el = document.getElementById('calcPanel');
    if (!el) {
      el = document.createElement('aside');
      el.id = 'calcPanel';
      el.className = 'calc-panel hidden';
      el.setAttribute('aria-label', 'Desmos graphing calculator');
      el.innerHTML = `<div class="calc-head"><strong>Desmos graphing calculator</strong>
        <button class="btn btn-sm" data-action="calc-close">Hide</button></div><div id="calcHost" class="calc-host"></div>`;
      document.body.appendChild(el);
    }
    return el;
  }

  function positionCalc() { /* panel is fixed via CSS; nothing to measure */ }

  function hideCalc() {
    const el = document.getElementById('calcPanel');
    if (el) el.classList.add('hidden');
  }

  function ensureDesmos() {
    if (window.Desmos) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = DESMOS_SRC;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Desmos could not be loaded'));
      document.head.appendChild(s);
    });
  }

  function toggleCalc() {
    const el = calcPanel();
    if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (session) {
      const q = session.st.current;
      session.st.calc[q] = (session.st.calc[q] || 0) + 1;
      save();
    }
    if (calc) { calc.resize(); return; }
    const host = document.getElementById('calcHost');
    host.textContent = 'Loading calculator…';
    ensureDesmos().then(() => {
      host.textContent = '';
      calc = window.Desmos.GraphingCalculator(host, { keypad: true, expressions: true, settingsMenu: false, zoomButtons: true });
    }).catch(() => {
      host.innerHTML = '<p style="padding:16px">The calculator needs an internet connection. You can also open <a href="https://www.desmos.com/calculator" target="_blank" rel="noopener">desmos.com/calculator</a> in another tab and use it there.</p>';
    });
  }

  function openRef() {
    closeRef();
    const el = document.createElement('div');
    el.className = 'overlay';
    el.id = 'refOverlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Reference sheet">
      <h2>Reference sheet</h2>
      <p class="sub">Formulas you may use. Not every formula you need is listed, so learn the rest.</p>
      <ul class="ref-list">
        <li>Circle: area = π<i>r</i><sup>2</sup>, circumference = 2π<i>r</i></li>
        <li>Rectangle: area = <i>ℓw</i></li>
        <li>Triangle: area = ½<i>bh</i></li>
        <li>Right triangle: <i>a</i><sup>2</sup> + <i>b</i><sup>2</sup> = <i>c</i><sup>2</sup></li>
        <li>Special right triangles: 30°-60°-90° has sides <i>x</i>, <i>x</i>√3, 2<i>x</i>; 45°-45°-90° has sides <i>s</i>, <i>s</i>, <i>s</i>√2</li>
        <li>Rectangular prism: volume = <i>ℓwh</i></li>
        <li>Cylinder: volume = π<i>r</i><sup>2</sup><i>h</i></li>
        <li>Sphere: volume = <sup>4</sup>⁄<sub>3</sub>π<i>r</i><sup>3</sup></li>
        <li>Cone: volume = <sup>1</sup>⁄<sub>3</sub>π<i>r</i><sup>2</sup><i>h</i></li>
        <li>Pyramid: volume = <sup>1</sup>⁄<sub>3</sub><i>ℓwh</i></li>
        <li>The sum of the angles in a triangle is 180°. A full circle is 360° or 2π radians.</li>
      </ul>
      <div class="modal-actions"><button class="btn btn-primary" data-action="ref-close">Close</button></div>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('button').focus();
  }

  function closeRef() {
    const el = document.getElementById('refOverlay');
    if (el) el.remove();
  }

  /* ---------------- Navigator / submit ---------------- */
  function openNav(confirm) {
    closeNav();
    const { def, st } = session;
    const total = def.questions.length;
    const unanswered = def.questions.filter((q) => st.answers[q.n] == null).length;
    const flagged = def.questions.filter((q) => st.flags[q.n]).length;
    const cells = def.questions.map((q) => {
      const cls = ['qcell'];
      if (st.answers[q.n] != null) cls.push('answered');
      if (q.n === st.current) cls.push('current');
      return `<button class="${cls.join(' ')}" data-action="nav-go" data-n="${q.n}" aria-label="Question ${q.n}${st.answers[q.n] != null ? ', answered' : ', unanswered'}${st.flags[q.n] ? ', marked for review' : ''}">${q.n}${st.flags[q.n] ? '<span class="pin">⚑</span>' : ''}</button>`;
    }).join('');
    const body = confirm
      ? `<h2>Submit this module?</h2>
         <p class="sub">${unanswered ? `<span class="warn">${unanswered} unanswered.</span> ` : 'All questions answered. '}${flagged ? `${flagged} marked for review. ` : ''}You cannot come back to this module after submitting.</p>
         <div class="modal-actions">
           <button class="btn" data-action="nav-open">Keep working</button>
           <button class="btn btn-primary" data-action="submit">Submit module</button>
         </div>`
      : `<h2>${esc(session.entry.label)}</h2>
         <p class="sub">${unanswered} unanswered · ${flagged} marked for review · ${total} total</p>
         <div class="legend"><span><i class="qcell answered" style="display:inline-block;width:18px;height:18px"></i>Answered</span>
           <span><i class="qcell" style="display:inline-block;width:18px;height:18px"></i>Unanswered</span><span>⚑ Marked for review</span></div>
         <div class="grid">${cells}</div>
         <div class="modal-actions">
           <button class="btn" data-action="nav-close">Close</button>
           <button class="btn btn-primary" data-action="submit-ask">Submit module…</button>
         </div>`;
    const el = document.createElement('div');
    el.className = 'overlay';
    el.id = 'navOverlay';
    el.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Question navigator">${body}</div>`;
    document.body.appendChild(el);
    const first = el.querySelector('.qcell.current, .btn-primary');
    if (first) first.focus();
  }

  function closeNav() {
    const el = document.getElementById('navOverlay');
    if (el) el.remove();
  }

  function submitModule(auto) {
    if (!session) return;
    commitVisit();
    stopTimer();
    const st = session.st;
    st.status = 'done';
    st.submittedAt = Date.now();
    st.autoSubmitted = !!auto;
    save();
    closeNav();
    closeRef();
    hideCalc();
    const { entry, def } = session;
    session = null;
    renderResults(entry, def);
  }

  /* ---------------- Results & review ---------------- */
  function tally(def, st, key) {
    const out = {};
    def.questions.forEach((q) => {
      const k = typeof key === 'function' ? key(q) : q[key];
      out[k] = out[k] || { c: 0, t: 0 };
      out[k].t++;
      if (isCorrect(q, st.answers[q.n])) out[k].c++;
    });
    return out;
  }

  function barRows(map, order) {
    const keys = order || Object.keys(map);
    return keys.filter((k) => map[k]).map((k) => {
      const { c, t } = map[k];
      return `<div class="bar-row"><span>${esc(k)}</span><div class="bar" role="img" aria-label="${c} of ${t} correct"><i style="width:${(c / t) * 100}%"></i></div><span>${c}/${t}</span></div>`;
    }).join('');
  }

  function renderResults(entry, def) {
    stopTimer();
    hideCalc();
    session = null;
    const st = ms(entry.id);
    const total = def.questions.length;
    const correct = def.questions.filter((q) => isCorrect(q, st.answers[q.n])).length;
    const answered = def.questions.filter((q) => st.answers[q.n] != null).length;
    const spent = Object.values(st.times).reduce((a, b) => a + b, 0);
    const allowed = def.minutes * 60;
    const num = moduleNumber(entry);
    const list = data.manifest.modules;
    const next = list[list.findIndex((m) => m.id === entry.id) + 1];
    const nextLabel = next ? (next.section === entry.section ? `Module ${moduleNumber(next)}` : `${next.section} Module ${moduleNumber(next)}`) : null;
    const intlQs = def.questions.filter((q) => q.intl);
    const intlCorrect = intlQs.filter((q) => isCorrect(q, st.answers[q.n])).length;
    const extra = [];
    if (intlQs.length) {
      extra.push(`<div class="stat"><div class="k">International-pattern items</div><div class="v">${intlCorrect}/${intlQs.length}</div>
         <div class="review-meta">Questions built around common learner errors.</div></div>`);
    }
    if (isMath(def)) {
      const opens = Object.values(st.calc || {}).reduce((a, b) => a + b, 0);
      const qs = Object.keys(st.calc || {}).length;
      extra.push(`<div class="stat"><div class="k">Calculator opens</div><div class="v">${opens}</div>
         <div class="review-meta">On ${qs} of ${total} questions.</div></div>`);
    }
    const hasGrid = def.questions.some((q) => q.type === 'grid');
    const typeBars = hasGrid
      ? `<h2 class="section-title">By question type</h2><div class="bars">${barRows(tally(def, st, (q) => (q.type === 'grid' ? 'Grid-in' : 'Multiple choice')))}</div>` : '';

    app.innerHTML = `<div class="screen scroll"><main class="center-card">
      <div class="break-banner" role="status">
        <div class="rule">--- END OF MODULE ${num} ---</div>
        <p>${next && nextLabel
          ? `Take your scheduled break. Type <code>'continue'</code> in the chat when ready for ${esc(nextLabel)}.`
          : 'You have finished every module. Ask for the scoring guide, analysis framework and pacing card.'}</p>
        ${st.autoSubmitted ? '<p class="warn">Time expired, so this module was submitted automatically.</p>' : ''}
      </div>
      <h1 style="font-family:var(--serif);margin:0 0 4px">${esc(entry.label)}: results</h1>
      <div class="score-row" style="margin-top:16px">
        <div class="stat"><div class="k">Raw score</div><div class="v">${correct}/${total}</div></div>
        <div class="stat"><div class="k">Answered</div><div class="v">${answered}/${total}</div></div>
        <div class="stat"><div class="k">Time used</div><div class="v">${fmt(spent)}</div><div class="review-meta">of ${fmt(allowed)}${st.timed ? '' : ' (untimed)'}</div></div>
        ${extra.join('')}
      </div>
      <h2 class="section-title">By domain</h2>
      <div class="bars">${barRows(tally(def, st, 'domain'))}</div>
      <h2 class="section-title">By difficulty tag</h2>
      <div class="bars">${barRows(tally(def, st, 'difficulty'), ['EASY', 'MEDIUM', 'HARD'])}</div>
      ${typeBars}
      <h2 class="section-title">By skill</h2>
      <div class="bars">${barRows(tally(def, st, 'skill'))}</div>
      <h2 class="section-title">Question review</h2>
      <div class="review-toolbar" role="group" aria-label="Filter">
        ${[['all', 'All'], ['incorrect', 'Incorrect'], ['blank', 'Unanswered'], ['flagged', 'Marked'], ['slow', 'Over target time']]
          .map(([k, l]) => `<button class="tab" data-action="filter" data-f="${k}" aria-pressed="${reviewFilter === k}">${l}</button>`).join('')}
      </div>
      <div id="reviewList"></div>
      <div class="continue-box">
        ${next && nextLabel
          ? `<strong>Next:</strong> take your break, then type <code>continue</code> in the chat to generate ${esc(nextLabel)}.`
          : '<strong>All modules complete.</strong>'}
      </div>
      <p style="margin-top:24px"><button class="btn" data-action="home">Back to modules</button></p>
    </main></div>`;
    lastResult = { entry, def };
    paintReview(def, st);
    window.scrollTo(0, 0);
    const sc = document.querySelector('.screen.scroll');
    if (sc) sc.scrollTop = 0;
  }

  function paintReview(def, st) {
    const box = document.getElementById('reviewList');
    if (!box) return;
    const items = def.questions.filter((q) => {
      const a = st.answers[q.n];
      const t = st.times[q.n] || 0;
      switch (reviewFilter) {
        case 'incorrect': return a != null && !isCorrect(q, a);
        case 'blank': return a == null;
        case 'flagged': return !!st.flags[q.n];
        case 'slow': return t > q.targetSec * 1.25;
        default: return true;
      }
    });
    box.innerHTML = items.length ? items.map((q) => reviewItemHtml(q, st, def)).join('') : '<p class="review-meta">Nothing matches this filter.</p>';
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === reviewFilter)));
  }

  function reviewItemHtml(q, st, def) {
    const a = st.answers[q.n];
    const ok = isCorrect(q, a);
    const status = a == null ? 'blank' : (ok ? 'correct' : 'incorrect');
    const statusLabel = { blank: 'Unanswered', correct: 'Correct', incorrect: 'Incorrect' }[status];
    const t = st.times[q.n] || 0;
    const over = t > q.targetSec * 1.25;
    const used = (st.calc && st.calc[q.n]) || 0;
    let answerHtml;
    if (q.type === 'grid') {
      answerHtml = `<div class="review-choice is-answer"><span class="lt">✓</span><div><div>Correct answer: <strong>${esc(q.display)}</strong></div></div></div>
        <div class="review-choice${ok ? ' is-answer' : ' is-yours'}"><span class="lt">→</span><div>Your answer: <strong>${a == null ? 'none' : esc(a)}</strong></div></div>`;
    } else {
      answerHtml = q.choices.map((c, i) => `<div class="review-choice${i === q.answer ? ' is-answer' : ''}${i === a ? ' is-yours' : ''}">
        <span class="lt">${LETTERS[i]}</span>
        <div><div>${txt(def, c)}${i === a ? ' <em class="review-meta">(your answer)</em>' : ''}</div><div class="why">${txt(def, q.why[i])}</div></div>
      </div>`).join('');
    }
    const explainLabel = isMath(def) ? 'Step-by-step solution.' : 'Key explanation.';
    return `<article class="review-item ${status}" id="r${q.n}">
      <div class="review-head">
        <span class="q-num">${q.n}</span><span class="tag ${q.difficulty}">${q.difficulty}</span>
        <span class="review-meta">${esc(q.domain)} · ${esc(q.skill)}</span>
        <span class="chip ${status === 'correct' ? 'done' : ''}">${statusLabel}</span>
        ${st.flags[q.n] ? '<span class="chip progress">⚑ Marked</span>' : ''}
        ${q.intl ? `<span class="chip progress">International pattern: ${esc(q.intl)}</span>` : ''}
        ${q.multi ? '<span class="chip progress">Desmos multi-step</span>' : ''}
        ${isMath(def) ? `<span class="chip">${used ? `Calculator opened ${used}×` : 'Calculator not used'}</span>` : ''}
      </div>
      <details><summary class="review-meta" style="cursor:pointer">Show ${isMath(def) ? 'figure and data' : 'passage and data'}</summary><div class="review-passage">${stimulusHtml(q, def)}</div></details>
      <p class="q-prompt" style="margin-top:12px">${txt(def, q.prompt)}</p>
      ${answerHtml}
      <div class="explain"><strong>${explainLabel}</strong> ${txt(def, q.explanation)}</div>
      ${q.desmosTip ? `<div class="explain"><strong>Desmos tip.</strong> ${txt(def, q.desmosTip)}</div>` : ''}
      <p class="timing">⏱ Target: ${q.targetSec} seconds · You spent ${Math.round(t)} seconds ${over ? '<span class="over">(over target)</span>' : ''}</p>
    </article>`;
  }

  /* ---------------- Events ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action;
    const i = Number(el.dataset.i);
    switch (a) {
      case 'start': case 'resume': case 'results': launch(el.dataset.id, a); break;
      case 'retake':
        if (window.confirm('This erases your saved answers for this module. Continue?')) launch(el.dataset.id, 'retake');
        break;
      case 'choose': choose(i); break;
      case 'elim': toggleElim(i); break;
      case 'flag': toggleFlag(); break;
      case 'prev': goto(session.st.current - 1); break;
      case 'next': goto(session.st.current + 1); break;
      case 'nav-open': openNav(false); break;
      case 'nav-close': closeNav(); break;
      case 'nav-go': { const n = Number(el.dataset.n); closeNav(); goto(n); break; }
      case 'submit-ask': openNav(true); break;
      case 'submit': submitModule(false); break;
      case 'calc-toggle': toggleCalc(); break;
      case 'calc-close': hideCalc(); break;
      case 'ref-open': openRef(); break;
      case 'ref-close': closeRef(); break;
      case 'toggleTimer': state.settings.showTimer = !state.settings.showTimer; save(); updateTimerEl(); break;
      case 'exit': commitVisit(); save(); renderHome(); break;
      case 'home': renderHome(); break;
      case 'filter':
        reviewFilter = el.dataset.f;
        if (lastResult) paintReview(lastResult.def, ms(lastResult.entry.id));
        break;
      case 'resetall':
        if (window.confirm('Erase all saved answers and progress in this browser?')) { state = { settings: state.settings, modules: {} }; save(); renderHome(); }
        break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting]');
    if (!el) return;
    const k = el.dataset.setting;
    state.settings[k] = el.type === 'checkbox' ? el.checked : el.value;
    save();
    if (k === 'theme') applyTheme();
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!session || el.id !== 'gridInput') return;
    const cleaned = el.value.replace(/[−–]/g, '-').replace(/[^0-9./-]/g, '');
    if (cleaned !== el.value) el.value = cleaned;
    const q = session.def.questions[session.st.current - 1];
    if (cleaned.trim()) session.st.answers[q.n] = cleaned.trim(); else delete session.st.answers[q.n];
    save();
    const gp = document.getElementById('gridPreview');
    if (gp) gp.textContent = gridPreviewText(cleaned);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeNav(); closeRef(); return; }
    if (!session || document.getElementById('navOverlay') || document.getElementById('refOverlay')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.closest && e.target.closest('#calcPanel'))) return;
    const k = e.key.toLowerCase();
    if (['a', 'b', 'c', 'd'].includes(k)) choose(k.charCodeAt(0) - 97);
    else if (['1', '2', '3', '4'].includes(k)) choose(Number(k) - 1);
    else if (k === 'arrowright') goto(session.st.current + 1);
    else if (k === 'arrowleft') goto(session.st.current - 1);
    else if (k === 'f') toggleFlag();
    else if (k === 'n') openNav(false);
  });

  window.addEventListener('beforeunload', () => { if (session) { commitVisit(); save(); } });

  boot();
})();
