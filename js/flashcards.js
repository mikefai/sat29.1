/* Flashcards for the vocabulary and usage patterns in the SAT mock exam.
   Spaced repetition uses five Leitner boxes. Progress is saved in this browser only.
   Cards you missed on the exam are found by matching each card's source question against your saved answers. */
(() => {
  'use strict';

  const S = window.SAT_SCORING;
  const STATE_KEY = 'sat-mock-v1';
  const CARD_KEY = 'sat-mock-cards';
  const VOCAB_KEY = 'sat-mock-vocab';
  const DAY = 86400000;
  const BOX_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 }; // days until a card returns after landing in that box
  const root = document.getElementById('cards');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  let manifest = null, defs = {}, cards = [], progress = {}, examState = { modules: {} };
  let mode = 'due', shuffle = true, tab = 'study', search = '';
  let queue = [], pos = 0, flipped = false, reviewed = 0, gotIt = 0;

  /* ---------------- Data ---------------- */
  async function boot() {
    try {
      if (window.SAT_DATA) {
        manifest = window.SAT_DATA.manifest;
        defs = window.SAT_DATA.modules;
        cards = (window.SAT_DATA.flashcards || {}).cards || [];
      } else {
        manifest = await (await fetch('data/manifest.json')).json();
        for (const e of manifest.modules.filter((m) => m.status === 'ready')) defs[e.id] = await (await fetch(e.file)).json();
        cards = (await (await fetch('data/flashcards.json')).json()).cards;
      }
    } catch (e) {
      root.innerHTML = `<p class="warn">Could not load the deck (${esc(e.message)}). Serve the folder with a local web server or run node tools/build-bundle.mjs.</p>`;
      return;
    }
    progress = read(CARD_KEY, {});
    examState = read(STATE_KEY, { modules: {} });
    if (!examState.modules) examState.modules = {};
    // Words the learner added on the report page become cards too.
    read(VOCAB_KEY, []).forEach((v, i) => {
      cards.push({ id: `mine-${i}-${v.word}`, word: v.word, pos: '', def: v.note || 'Your own note: add a meaning on the report page.', ex: '', cat: 'Your words', src: [], role: '', note: '' });
    });
    markMissed();
    buildQueue();
    render();
  }

  const moduleLabel = (id) => (manifest.modules.find((m) => m.id === id) || { label: id }).label;

  // A card counts as missed if a question it is tied to was answered wrongly or left blank.
  function markMissed() {
    cards.forEach((c) => {
      c.missed = false;
      (c.src || []).forEach((ref) => {
        const [mid, n] = ref.split(':');
        const def = defs[mid], st = examState.modules[mid];
        if (!def || !st || st.status !== 'done') return;
        const q = def.questions[Number(n) - 1];
        if (!q) return;
        const a = st.answers[q.n];
        if (S.isCorrect(q, a)) return;
        const chosen = a != null && q.choices ? String(q.choices[a] || '').toLowerCase() : '';
        if (c.role === 'answer' || c.role === '' || chosen === c.word.toLowerCase()) c.missed = true;
      });
    });
  }

  const box = (c) => (progress[c.id] ? progress[c.id].box : 0);
  const isDue = (c) => !progress[c.id] || progress[c.id].due <= Date.now();

  function categories() { return [...new Set(cards.map((c) => c.cat))]; }

  function pool() {
    if (mode === 'due') return cards.filter(isDue);
    if (mode === 'missed') return cards.filter((c) => c.missed);
    if (mode === 'all') return cards.slice();
    return cards.filter((c) => c.cat === mode);
  }

  function buildQueue() {
    const p = pool();
    if (shuffle) for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    queue = p.map((c) => c.id);
    pos = 0; flipped = false; reviewed = 0; gotIt = 0;
  }

  const byId = (id) => cards.find((c) => c.id === id);

  /* ---------------- Rendering ---------------- */
  function stats() {
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    cards.forEach((c) => { counts[box(c)]++; });
    const learned = counts[4] + counts[5];
    return `<div class="score-row fc-stats">
      <div class="stat"><div class="k">Cards</div><div class="v">${cards.length}</div></div>
      <div class="stat"><div class="k">Due now</div><div class="v">${cards.filter(isDue).length}</div></div>
      <div class="stat"><div class="k">Missed on exam</div><div class="v">${cards.filter((c) => c.missed).length}</div></div>
      <div class="stat"><div class="k">Learned (box 4–5)</div><div class="v">${learned}</div><div class="review-meta">${Math.round((100 * learned) / cards.length)}% of the deck</div></div>
    </div>`;
  }

  function deckButtons() {
    const items = [['due', `Due (${cards.filter(isDue).length})`], ['missed', `Missed on exam (${cards.filter((c) => c.missed).length})`], ['all', `All (${cards.length})`]]
      .concat(categories().map((c) => [c, `${c} (${cards.filter((x) => x.cat === c).length})`]));
    return `<div class="review-toolbar" role="group" aria-label="Choose a deck">
      ${items.map(([k, l]) => `<button class="tab" data-mode="${esc(k)}" aria-pressed="${mode === k}">${esc(l)}</button>`).join('')}
      <label class="setting-row" style="margin-left:auto"><input type="checkbox" id="shuffle" ${shuffle ? 'checked' : ''}> Shuffle</label>
    </div>`;
  }

  function cardHtml() {
    if (!queue.length) {
      return `<div class="fc-empty"><h2>Nothing to study here</h2>
        <p>${mode === 'due' ? 'No cards are due right now. Choose “All” to keep practising, or come back later.' : mode === 'missed' ? 'No missed words yet. Finish a Reading and Writing module and this deck fills in automatically.' : 'This deck is empty.'}</p></div>`;
    }
    if (pos >= queue.length) {
      return `<div class="fc-empty"><h2>Session complete</h2>
        <p>You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'} and marked ${gotIt} as known.</p>
        <p><button class="btn btn-primary" data-action="restart">Study again</button></p></div>`;
    }
    const c = byId(queue[pos]);
    const src = (c.src || []).map((r) => { const [m, n] = r.split(':'); return `${moduleLabel(m)}, Q${n}`; }).join('; ');
    const canSpeak = 'speechSynthesis' in window && c.pos !== 'usage';
    return `<div class="fc-progress"><div class="bar"><i style="width:${(pos / queue.length) * 100}%"></i></div>
        <span class="review-meta">Card ${pos + 1} of ${queue.length}</span></div>
      <button class="fc-card${flipped ? ' flipped' : ''}" data-action="flip" aria-label="${flipped ? 'Showing the answer. Press to hide.' : 'Press to show the answer.'}">
        <span class="fc-tags">${esc(c.cat)}${c.role === 'answer' ? ' · correct answer on the exam' : c.role === 'distractor' ? ' · answer choice on the exam' : ''}${c.missed ? ' · <b>missed</b>' : ''}</span>
        ${flipped ? `<span class="fc-back">
            <span class="fc-word-sm">${esc(c.word)} <i>${esc(c.pos)}</i></span>
            <span class="fc-def">${esc(c.def)}</span>
            ${c.ex ? `<span class="fc-ex">“${esc(c.ex)}”</span>` : ''}
            ${c.note ? `<span class="fc-note">${esc(c.note)}</span>` : ''}
            ${src ? `<span class="fc-src">Tested in ${esc(src)}</span>` : ''}
          </span>`
          : `<span class="fc-front"><span class="fc-word">${esc(c.word)}</span><span class="fc-pos">${esc(c.pos)}</span></span>`}
      </button>
      <div class="fc-actions">
        ${canSpeak ? '<button class="btn btn-sm" data-action="speak" aria-label="Hear the word">🔊 Hear it</button>' : ''}
        <button class="btn" data-action="flip">${flipped ? 'Hide answer' : 'Show answer'} <kbd>Space</kbd></button>
        ${flipped ? `<button class="btn" data-action="again">Again <kbd>1</kbd></button><button class="btn btn-primary" data-action="know">Got it <kbd>2</kbd></button>` : ''}
      </div>
      <p class="review-meta fc-help">Box ${box(c) || 'new'} of 5. “Got it” moves a card up a box so it returns later. “Again” sends it back to box 1.</p>`;
  }

  function browseHtml() {
    const q = search.trim().toLowerCase();
    const list = cards.filter((c) => !q || c.word.toLowerCase().includes(q) || c.def.toLowerCase().includes(q));
    return `<input id="fcSearch" class="fc-search" type="search" placeholder="Search words and meanings" value="${esc(search)}" aria-label="Search cards">
      <table class="data"><thead><tr><th>Word</th><th>Meaning</th><th>Deck</th><th>Box</th></tr></thead><tbody>
      ${list.map((c) => `<tr><td><b>${esc(c.word)}</b> <span class="review-meta">${esc(c.pos)}</span>${c.missed ? ' <span class="chip progress">missed</span>' : ''}</td><td>${esc(c.def)}</td><td>${esc(c.cat)}</td><td>${box(c) || '–'}</td></tr>`).join('')}
      </tbody></table><p class="review-meta">${list.length} card${list.length === 1 ? '' : 's'}</p>`;
  }

  function render() {
    root.innerHTML = `
      <header class="report-head no-print">
        <a class="btn btn-sm" href="index.html">← Back to the exam</a>
        <a class="btn btn-sm" href="report.html">Score report</a>
        <h1>Flashcards</h1>
        <p class="review-meta">Every word tested in the two Reading and Writing modules (right answers and tempting wrong ones), the hard words from the passages, and usage patterns that trip up learners.</p>
      </header>
      ${stats()}
      <nav class="tabs" role="tablist" aria-label="Flashcard views">
        <button class="tab" data-tab="study" aria-pressed="${tab === 'study'}">Study</button>
        <button class="tab" data-tab="browse" aria-pressed="${tab === 'browse'}">Browse all</button>
      </nav>
      ${tab === 'study' ? `${deckButtons()}<section id="cardArea" aria-live="polite">${cardHtml()}</section>
        <p><button class="btn btn-sm btn-ghost" data-action="reset">Reset flashcard progress</button></p>` : `<section>${browseHtml()}</section>`}`;
    const s = document.getElementById('fcSearch');
    if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  /* ---------------- Actions ---------------- */
  function rate(known) {
    const c = byId(queue[pos]);
    const cur = progress[c.id] ? progress[c.id].box : 0;
    // A first-time "Got it" lands in box 2; each later "Got it" moves up one box; "Again" returns to box 1.
    const newBox = known ? (cur === 0 ? 2 : Math.min(5, cur + 1)) : 1;
    progress[c.id] = { box: newBox, due: Date.now() + BOX_DAYS[newBox] * DAY };
    write(CARD_KEY, progress);
    reviewed++;
    if (known) gotIt++; else queue.push(c.id); // missed cards come back at the end of this session
    pos++;
    flipped = false;
    render();
  }

  function speak() {
    const c = byId(queue[pos]);
    if (!c || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(c.word.replace(/\s*\(.*\)/, ''));
    u.lang = 'en-GB';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab],[data-mode],[data-action]');
    if (!t) return;
    if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
    if (t.dataset.mode) { mode = t.dataset.mode; buildQueue(); render(); return; }
    switch (t.dataset.action) {
      case 'flip': flipped = !flipped; render(); break;
      case 'know': rate(true); break;
      case 'again': rate(false); break;
      case 'speak': speak(); break;
      case 'restart': buildQueue(); render(); break;
      case 'reset':
        if (window.confirm('Reset all flashcard progress in this browser?')) { progress = {}; write(CARD_KEY, progress); buildQueue(); render(); }
        break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'shuffle') { shuffle = e.target.checked; buildQueue(); render(); }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'fcSearch') { search = e.target.value; render(); }
  });

  document.addEventListener('keydown', (e) => {
    if (tab !== 'study' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (pos >= queue.length) return;
    if (e.key === ' ' || e.key === 'Enter') { if (e.target.closest && e.target.closest('button') && e.key === 'Enter') return; e.preventDefault(); flipped = !flipped; render(); }
    else if (flipped && e.key === '1') rate(false);
    else if (flipped && e.key === '2') rate(true);
  });

  boot();
})();
