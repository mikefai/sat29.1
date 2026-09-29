/* Score report and post-test analysis. Reads results saved by js/app.js (localStorage "sat-mock-v1")
   and renders: scoring guide, post-test analysis framework, and a printable pacing card. */
(() => {
  'use strict';

  const S = window.SAT_SCORING;
  const STORE_KEY = 'sat-mock-v1';
  const VOCAB_KEY = 'sat-mock-vocab';
  const root = document.getElementById('report');

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const fmt = S.fmt;

  let manifest = null;
  let defs = {};
  let state = { settings: {}, modules: {} };

  const ACTIONS = {
    'Words in Context': 'Test each unfamiliar word by writing your own sentence with it. Review the Vocabulary Gap Log daily, 10 words at a time, and always predict a word before reading the choices.',
    'Text Structure and Purpose': 'Before reading the choices, label each sentence’s job in 3 to 5 words (claim, example, contrast, result). Then match the label pattern to the answer.',
    'Cross-Text Connections': 'Summarize each text’s claim in one line, then ask what the second author would say about the first author’s evidence, not just the conclusion.',
    'Central Ideas and Details': 'Reject choices that are true but too narrow, too broad, or that overstate a hedge such as “may” or “suggests”.',
    'Command of Evidence (Textual)': 'Break the claim into its parts and demand evidence for every part. Answers that support only half the claim are the usual trap.',
    'Command of Evidence (Quantitative)': 'Read the axis labels and units first, then verify every number in your chosen choice against the graph or table before selecting it.',
    'Inferences': 'Choose the answer that must be true given only the passage. Underline the numbers and conditions the conclusion depends on.',
    'Boundaries': 'Test each boundary by asking whether both sides are complete sentences. Then apply the rule: semicolon or full stop between two, no punctuation between a verb and its object.',
    'Form, Structure, and Sense': 'Find the true subject or antecedent first, cross out prepositional phrases, then check tense, number and modifier placement.',
    'Transitions': 'State the relationship between the two sentences in your own words (contrast, cause, example, concession) before looking at the transition words.',
    'Rhetorical Synthesis': 'Underline the goal, tick each requirement it contains, and eliminate any choice with a fact that is not in the notes or that mixes facts together.',
  };
  const DOMAIN_ACTIONS = {
    'Algebra': 'Rebuild each missed problem from a blank page. For word problems, define variables in writing before forming any equation, and check the answer in the original statement.',
    'Advanced Math': 'Practise the structure moves (factoring, completing the square, discriminant) and always check for extraneous solutions. Use Desmos to confirm every algebraic answer.',
    'Problem-Solving and Data Analysis': 'Restate what the question asks in your own words (which group, which percent of what), and check whether it is asking about a sample, a population, or a cause.',
    'Geometry and Trigonometry': 'Draw and label every figure, write the formula before substituting, and watch for radius versus diameter and degrees versus radians.',
    'Craft and Structure': 'Work on vocabulary in context and on naming the function of each sentence.',
    'Information and Ideas': 'Practise evidence matching: tie every claim to its exact supporting detail.',
    'Standard English Conventions': 'Drill one rule per session with 10 questions and explain each answer aloud.',
    'Expression of Ideas': 'Practise reading for the goal of the sentence and rejecting unsupported additions.',
  };
  const actionFor = (q) => ACTIONS[q.skill] || DOMAIN_ACTIONS[q.domain] || 'Review the explanations for the questions you missed and redo them cold in three days.';

  /* ---------------- Data ---------------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const p = JSON.parse(raw); return { settings: p.settings || {}, modules: p.modules || {} }; }
    } catch (e) { /* ignore */ }
    return { settings: {}, modules: {} };
  }

  function loadVocab() {
    try { return JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveVocab(list) {
    try { localStorage.setItem(VOCAB_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  async function boot() {
    try {
      if (window.SAT_DATA) {
        manifest = window.SAT_DATA.manifest;
        defs = window.SAT_DATA.modules;
      } else {
        manifest = await (await fetch('data/manifest.json')).json();
        for (const e of manifest.modules.filter((m) => m.status === 'ready')) defs[e.id] = await (await fetch(e.file)).json();
      }
    } catch (e) {
      root.innerHTML = `<p class="warn">Could not load exam data (${esc(e.message)}). Serve the folder with a local web server or run node tools/build-bundle.mjs.</p>`;
      return;
    }
    state = loadState();
    render();
  }

  // Everything derived from one completed module.
  function info(entry) {
    const def = defs[entry.id];
    const st = state.modules[entry.id];
    if (!def || !st || st.status !== 'done') return null;
    const rows = def.questions.map((q) => {
      const a = st.answers[q.n];
      const t = st.times[q.n] || 0;
      return { q, a, ok: S.isCorrect(q, a), blank: a == null, t, ratio: t / q.targetSec, calc: (st.calc && st.calc[q.n]) || 0 };
    });
    const correct = rows.filter((r) => r.ok).length;
    const spent = rows.reduce((s, r) => s + r.t, 0);
    return { entry, def, st, rows, correct, total: rows.length, spent, allowed: def.minutes * 60 };
  }

  const kind = (entry) => (entry.section === 'Math' ? 'math' : 'rw');

  /* ---------------- Sections ---------------- */
  function overview(infos) {
    const out = [];
    let totalEst = 0, complete = true;
    for (const k of ['rw', 'math']) {
      const list = infos.filter((i) => kind(i.entry) === k);
      const label = k === 'rw' ? 'Reading and Writing' : 'Math';
      if (!list.length) { out.push(`<div class="stat"><div class="k">${label}</div><div class="v">–</div><div class="review-meta">No completed modules yet.</div></div>`); complete = false; continue; }
      const correct = list.reduce((s, i) => s + i.correct, 0);
      const answered = list.reduce((s, i) => s + i.total, 0);
      const full = list.length === 2;
      const raw = full ? correct : (correct / answered) * S.TOTALS[k];
      const sc = S.scaled(k, raw);
      totalEst += sc;
      if (!full) complete = false;
      out.push(`<div class="stat"><div class="k">${label}</div><div class="v">${sc}</div>
        <div class="review-meta">${correct}/${answered} correct${full ? '' : ' · projected from one module'} · ${esc(S.band(sc))}</div></div>`);
    }
    if (infos.length) {
      out.unshift(`<div class="stat"><div class="k">Estimated total</div><div class="v">${complete ? totalEst : '~' + totalEst}</div>
        <div class="review-meta">${complete ? 'Both sections complete.' : 'Partial: finish all modules for a full estimate.'}</div></div>`);
    }
    return out.join('');
  }

  function scoringGuide() {
    const rangeTable = (k, title, total) => `<div>
      <h3>${title} <span class="review-meta">(raw out of ${total})</span></h3>
      <table class="data conv"><thead><tr><th scope="col">Raw score</th><th scope="col">Estimated scaled</th></tr></thead><tbody>
      ${S.ranges(k).map((r) => `<tr><td>${r.from === r.to ? r.from : `${r.from}–${r.to}`}</td><td>${r.scaled}</td></tr>`).join('')}
      </tbody></table></div>`;
    const bands = [['750–800', 'Elite'], ['700–740', 'Very strong'], ['650–690', 'Strong'], ['600–640', 'Solid'], ['550–590', 'Developing (upper)'], ['500–540', 'Developing'], ['200–490', 'Foundation']];
    return `<p>Each section is scored out of <b>800</b>: Reading and Writing (54 questions across two modules) and Math (44 questions across two modules). Your total is the sum, from <b>400 to 1600</b>.</p>
      <div class="callout"><strong>Read this before trusting the numbers.</strong> The College Board does not publish its conversion tables, and real scores also depend on
        which adaptive Module 2 a student receives. This table is an <b>estimate built for this mock</b>. Because every item here is harder than an official item,
        each raw score is mapped roughly <b>30 to 70 points higher</b> than an official form would map it. Use it for tracking progress between mocks, not as a prediction of your official score.</div>
      <div class="conv-grid">${rangeTable('rw', 'Reading and Writing', 54)}${rangeTable('math', 'Math', 44)}</div>
      <h3>Score bands</h3>
      <table class="data"><thead><tr><th>Section score</th><th>Descriptor</th></tr></thead><tbody>${bands.map((b) => `<tr><td>${b[0]}</td><td>${b[1]}</td></tr>`).join('')}</tbody></table>
      <details><summary class="review-meta" style="cursor:pointer">Show every raw score</summary>
        <div class="conv-grid">${['rw', 'math'].map((k) => `<table class="data conv"><thead><tr><th>${k === 'rw' ? 'R&amp;W raw' : 'Math raw'}</th><th>Scaled</th></tr></thead><tbody>${S.table(k).map((r) => `<tr><td>${r.raw}</td><td>${r.scaled}</td></tr>`).join('')}</tbody></table>`).join('')}</div>
      </details>`;
  }

  function timingAudit(infos) {
    if (!infos.length) return '<p class="review-meta">Complete a module to see your timing audit.</p>';
    return infos.map((i) => {
      const over = i.rows.filter((r) => r.t > r.q.targetSec * 1.25);
      const targetSum = i.rows.reduce((s, r) => s + r.q.targetSec, 0);
      const worst = [...i.rows].sort((a, b) => (b.t - b.q.targetSec) - (a.t - a.q.targetSec)).slice(0, 5);
      const left = i.allowed - i.spent;
      const verdict = i.st.autoSubmitted ? 'Ran out of time: pacing was too slow.'
        : left > 300 ? `Finished with ${fmt(left)} to spare. Consider using spare time to re-check flagged questions.`
          : left < 90 ? 'Very little buffer left. Aim to reach each checkpoint on the pacing card.'
            : 'Healthy pacing with a small review buffer.';
      return `<h3>${esc(i.entry.label)}</h3>
        <div class="score-row">
          <div class="stat"><div class="k">Time used</div><div class="v">${fmt(i.spent)}</div><div class="review-meta">of ${fmt(i.allowed)}</div></div>
          <div class="stat"><div class="k">Average per question</div><div class="v">${Math.round(i.spent / i.total)}s</div><div class="review-meta">target ${Math.round(targetSum / i.total)}s</div></div>
          <div class="stat"><div class="k">Over target time</div><div class="v">${over.length}</div><div class="review-meta">more than 25% over</div></div>
          <div class="stat"><div class="k">Unanswered</div><div class="v">${i.rows.filter((r) => r.blank).length}</div></div>
        </div>
        <p>${esc(verdict)}</p>
        <table class="data"><thead><tr><th>Biggest time sinks</th><th>Skill</th><th>Spent</th><th>Target</th><th>Result</th></tr></thead><tbody>
        ${worst.map((r) => `<tr><td>Q${r.q.n}</td><td>${esc(r.q.skill)}</td><td>${Math.round(r.t)}s</td><td>${r.q.targetSec}s</td><td>${r.blank ? 'Blank' : r.ok ? 'Correct' : 'Wrong'}</td></tr>`).join('')}
        </tbody></table>`;
    }).join('');
  }

  function classify(r) {
    if (r.blank) return 'Unanswered';
    if (r.ratio < 0.5) return 'Rushed';
    if (r.ratio > 1.5) return 'Overthought';
    return 'Skill or concept gap';
  }

  function errorPatterns(infos) {
    const misses = infos.flatMap((i) => i.rows.filter((r) => !r.ok).map((r) => ({ ...r, mod: i.entry.label, cat: classify(r) })));
    if (!infos.length) return '<p class="review-meta">Complete a module to see your error patterns.</p>';
    if (!misses.length) return '<p>No missed questions. Nothing to classify.</p>';
    const cats = {};
    misses.forEach((m) => { cats[m.cat] = (cats[m.cat] || 0) + 1; });
    const meaning = {
      'Unanswered': 'Skipped or out of time. Fix with pacing and a rule for guessing.',
      'Rushed': 'Wrong in under half the target time. Slow down on the last read of the question and verify.',
      'Overthought': 'Wrong after more than 1.5 times the target time. Set a 2-minute cap, flag, and return.',
      'Skill or concept gap': 'Wrong at a normal pace, so the method or knowledge is missing. Study these first.',
    };
    const intl = misses.filter((m) => m.q.intl);
    return `<table class="data"><thead><tr><th>Category</th><th>Count</th><th>What it means</th></tr></thead><tbody>
      ${Object.keys(meaning).filter((k) => cats[k]).map((k) => `<tr><td>${k}</td><td>${cats[k]}</td><td>${meaning[k]}</td></tr>`).join('')}</tbody></table>
      ${intl.length ? `<p><b>International-pattern items missed (${intl.length}):</b> ${intl.map((m) => `Q${m.q.n} (${esc(m.q.intl)})`).join('; ')}.</p>` : ''}
      <details open><summary class="review-meta" style="cursor:pointer">Every missed question</summary>
      <table class="data"><thead><tr><th>Module</th><th>Q</th><th>Skill</th><th>Difficulty</th><th>Category</th></tr></thead><tbody>
      ${misses.map((m) => `<tr><td>${esc(m.mod)}</td><td>${m.q.n}</td><td>${esc(m.q.skill)}</td><td>${m.q.difficulty}</td><td>${m.cat}</td></tr>`).join('')}</tbody></table></details>`;
  }

  function staminaCheck(infos) {
    if (!infos.length) return '<p class="review-meta">Complete a module to see your stamina check.</p>';
    const rows = infos.map((i) => {
      const n = i.total, third = Math.ceil(n / 3);
      const parts = [i.rows.slice(0, third), i.rows.slice(third, 2 * third), i.rows.slice(2 * third)];
      const acc = parts.map((p) => pct(p.filter((r) => r.ok).length, p.length));
      const tr = (p) => { const t = p.reduce((s, r) => s + r.t, 0), g = p.reduce((s, r) => s + r.q.targetSec, 0); return g ? Math.round((100 * t) / g) : 0; };
      const drop = acc[0] - acc[2];
      return `<tr><td>${esc(i.entry.label)}</td><td>${acc[0]}%</td><td>${acc[1]}%</td><td>${acc[2]}%</td><td>${tr(parts[0])}% → ${tr(parts[2])}%</td><td>${drop >= 20 ? 'Fades late' : drop <= -20 ? 'Slow starter' : 'Steady'}</td></tr>`;
    }).join('');
    const notes = [];
    for (const k of ['rw', 'math']) {
      const a = infos.find((i) => kind(i.entry) === k && i.entry.id.endsWith('1'));
      const b = infos.find((i) => kind(i.entry) === k && i.entry.id.endsWith('2'));
      if (a && b) {
        const d = pct(a.correct, a.total) - pct(b.correct, b.total);
        notes.push(`${k === 'rw' ? 'Reading and Writing' : 'Math'}: Module 1 ${pct(a.correct, a.total)}% versus Module 2 ${pct(b.correct, b.total)}%. ${d >= 15 ? 'A drop of 15 points or more suggests fatigue, or that Module 2 was harder for you. Check timing in the last third.' : 'No large drop between modules.'}`);
      }
    }
    return `<table class="data"><thead><tr><th>Module</th><th>Accuracy first third</th><th>Middle third</th><th>Last third</th><th>Time vs target (first → last third)</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
      ${notes.length ? `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  }

  function desmosUse(infos) {
    const list = infos.filter((i) => kind(i.entry) === 'math');
    if (!list.length) return '<p class="review-meta">Complete a Math module to see how you used the calculator.</p>';
    return list.map((i) => {
      const used = i.rows.filter((r) => r.calc > 0);
      const not = i.rows.filter((r) => r.calc === 0);
      const acc = (a) => (a.length ? pct(a.filter((r) => r.ok).length, a.length) + '%' : '–');
      const multi = i.rows.filter((r) => r.q.multi);
      const missed = i.rows.filter((r) => !r.ok && r.calc === 0 && (r.q.multi || r.q.desmosTip));
      return `<h3>${esc(i.entry.label)}</h3>
        <div class="score-row">
          <div class="stat"><div class="k">Calculator opens</div><div class="v">${i.rows.reduce((s, r) => s + r.calc, 0)}</div><div class="review-meta">on ${used.length} of ${i.total} questions</div></div>
          <div class="stat"><div class="k">Accuracy with calculator</div><div class="v">${acc(used)}</div></div>
          <div class="stat"><div class="k">Accuracy without</div><div class="v">${acc(not)}</div></div>
          ${multi.length ? `<div class="stat"><div class="k">Desmos multi-step items</div><div class="v">${multi.filter((r) => r.ok).length}/${multi.length}</div><div class="review-meta">correct · opened on ${multi.filter((r) => r.calc).length}</div></div>` : ''}
        </div>
        ${missed.length ? `<p><b>Missed Desmos opportunities:</b> ${missed.map((r) => `Q${r.q.n} (${esc(r.q.skill)})`).join('; ')}. You missed these without opening the calculator, and each has a Desmos tip in the review.</p>` : '<p>No missed questions that clearly called for the calculator.</p>'}
        <p class="review-meta">Habit to build: graph first for any equation you cannot solve by hand in 30 seconds, then confirm your algebra against the graph.</p>`;
    }).join('');
  }

  function vocabLog(infos) {
    const rwDefs = manifest.modules.filter((m) => m.section !== 'Math' && defs[m.id]);
    const words = [];
    rwDefs.forEach((m) => {
      const inf = infos.find((i) => i.entry.id === m.id);
      defs[m.id].questions.filter((q) => q.skill === 'Words in Context').forEach((q) => {
        const row = inf && inf.rows[q.n - 1];
        q.choices.forEach((c, i) => {
          words.push({ word: c, meaning: strip(q.why[i]).replace(/^Correct\.\s*/, ''), correct: i === q.answer, missed: !!(row && !row.ok && (row.a === i || i === q.answer)), chosen: !!(row && row.a === i && !row.ok), mod: m.label, n: q.n });
        });
      });
    });
    const missedWords = words.filter((w) => w.missed);
    const custom = loadVocab();
    const table = (list) => `<table class="data"><thead><tr><th>Word</th><th>Meaning in context</th><th>Source</th></tr></thead><tbody>
      ${list.map((w) => `<tr><td><b>${esc(w.word)}</b>${w.correct ? ' ✓' : ''}${w.chosen ? ' (you chose)' : ''}</td><td>${esc(w.meaning)}</td><td>${esc(w.mod)} Q${w.n}</td></tr>`).join('')}</tbody></table>`;
    return `<h3>From questions you missed</h3>
      ${missedWords.length ? table(missedWords) : '<p class="review-meta">No missed Words in Context questions yet.</p>'}
      <h3>Your own words</h3>
      <form id="vocabForm" class="vocab-form">
        <input id="vocabWord" placeholder="Word" aria-label="Word" required>
        <input id="vocabNote" placeholder="Meaning or your own sentence" aria-label="Meaning or note">
        <button class="btn btn-sm btn-primary" type="submit">Add</button>
      </form>
      <ul id="vocabList" class="vocab-list">${custom.map((v, i) => `<li><b>${esc(v.word)}</b>: ${esc(v.note || '')} <button class="btn btn-sm btn-ghost" data-del="${i}" aria-label="Remove ${esc(v.word)}">Remove</button></li>`).join('') || '<li class="review-meta">Nothing added yet. Saved in this browser.</li>'}</ul>
      <details><summary class="review-meta" style="cursor:pointer">Full glossary from this exam (${words.length} words)</summary>${table(words)}</details>`;
  }

  function priorities(infos) {
    if (!infos.length) return '<p class="review-meta">Complete a module to get a study plan.</p>';
    const map = {};
    infos.forEach((i) => i.rows.forEach((r) => {
      const key = `${i.entry.section}|${r.q.skill}`;
      const m = map[key] = map[key] || { section: i.entry.section, skill: r.q.skill, q: r.q, wrong: 0, blank: 0, slow: 0, total: 0 };
      m.total++;
      if (r.blank) m.blank++; else if (!r.ok) m.wrong++;
      if (r.ok && r.ratio > 1.25) m.slow++;
    }));
    const ranked = Object.values(map).map((m) => ({ ...m, score: 3 * m.wrong + 2 * m.blank + m.slow })).filter((m) => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    if (!ranked.length) return '<p>No weak spots found in the completed modules. Move to a harder practice set or a full official practice test.</p>';
    return `<ol class="priority">${ranked.map((m) => `<li><b>${esc(m.skill)}</b> <span class="review-meta">(${esc(m.section)} · ${m.wrong} wrong, ${m.blank} blank, ${m.slow} correct but slow, of ${m.total})</span>
      <div>${esc(actionFor(m.q))}</div></li>`).join('')}</ol>
      <p class="review-meta">Plan: 3 sessions this week, 45 minutes each. Session 1 targets priority 1 and 2, session 2 priority 3 and 4, session 3 priority 5 plus a timed 10-question mixed set. Redo every missed question cold after three days.</p>`;
  }

  function pacingCard() {
    const mods = manifest.modules.filter((m) => defs[m.id]);
    const tips = [
      ['Reading and Writing', 'Aim for about 70 seconds per question. Read the question before the passage for structure and purpose items. Never spend more than 2 minutes on one item: flag it and move on.'],
      ['Math', 'Aim for about 95 seconds per question on average, faster on the first half so hard items get more time. Graph first in Desmos whenever the algebra will take longer than 30 seconds.'],
      ['Every module', 'Answer every question. There is no penalty for guessing. In the last 2 minutes, fill any blanks and check flagged items only.'],
    ];
    return `<div id="pacingCard">
      <h3>Pacing reference card</h3>
      <p class="review-meta">Checkpoints leave a 2:00 review buffer and spread the remaining time in proportion to each question’s target time.</p>
      <table class="data pace"><thead><tr><th>Module</th><th>Length</th><th>Checkpoint</th><th>Be at question</th><th>Time used by then</th><th>Time left</th></tr></thead><tbody>
      ${mods.map((m) => S.checkpoints(defs[m.id].questions, m.minutes).map((c, idx) => `<tr>${idx === 0 ? `<td rowspan="4"><b>${esc(m.label)}</b></td><td rowspan="4">${m.minutes} min · ${m.questionCount} Q</td>` : ''}<td>${['25%', '50%', '75%', 'Finish'][idx]}</td><td>Q${c.question}</td><td>${c.elapsed}</td><td>${c.remaining}</td></tr>`).join('')).join('')}
      </tbody></table>
      <table class="data"><thead><tr><th>Rule</th><th>Detail</th></tr></thead><tbody>${tips.map((t) => `<tr><td><b>${t[0]}</b></td><td>${t[1]}</td></tr>`).join('')}</tbody></table>
      <p class="review-meta">If you are more than 1:30 behind at a checkpoint, skip the next hard question and flag it.</p>
    </div>
    <p class="no-print"><button class="btn btn-primary" id="printCard">Print this card</button></p>`;
  }

  /* ---------------- Render ---------------- */
  function render() {
    const infos = manifest.modules.map(info).filter(Boolean);
    const done = infos.length;
    root.innerHTML = `
      <header class="report-head no-print">
        <a class="btn btn-sm" href="index.html">← Back to the exam</a>
        <h1>Score report and analysis</h1>
        <p class="review-meta">${done ? `${done} of ${manifest.modules.filter((m) => m.status === 'ready').length} modules completed. Numbers update as you finish modules.` : 'No completed modules yet. Finish a module to fill in the analysis. The scoring guide and pacing card work now.'}</p>
      </header>
      <nav class="tabs no-print" role="tablist" aria-label="Report sections">
        ${[['score', 'Scoring guide'], ['analysis', 'Post-test analysis'], ['pacing', 'Pacing card']].map(([k, l], i) => `<button class="tab" role="tab" data-tab="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}
      </nav>
      <section class="panel" id="panel-score">
        <div class="score-row">${overview(infos)}</div>
        <h2>Scoring guide</h2>${scoringGuide()}
      </section>
      <section class="panel hidden" id="panel-analysis">
        <h2>Post-test analysis framework</h2>
        <details open><summary><h3 class="inline">1. Timing audit</h3></summary>${timingAudit(infos)}</details>
        <details open><summary><h3 class="inline">2. Error pattern classification</h3></summary>${errorPatterns(infos)}</details>
        <details open><summary><h3 class="inline">3. Stamina check</h3></summary>${staminaCheck(infos)}</details>
        <details open><summary><h3 class="inline">4. Desmos utilization</h3></summary>${desmosUse(infos)}</details>
        <details open><summary><h3 class="inline">5. Vocabulary gap log</h3></summary>${vocabLog(infos)}</details>
        <details open><summary><h3 class="inline">6. Next session priority</h3></summary>${priorities(infos)}</details>
      </section>
      <section class="panel hidden" id="panel-pacing">${pacingCard()}</section>`;
    show(sessionTab);
  }

  let sessionTab = 'score';
  function show(tab) {
    sessionTab = tab;
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('hidden', p.id !== `panel-${tab}`));
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  }

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { show(tab.dataset.tab); return; }
    if (e.target.id === 'printCard') {
      document.body.classList.add('print-pacing');
      window.print();
      document.body.classList.remove('print-pacing');
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const list = loadVocab();
      list.splice(Number(del.dataset.del), 1);
      saveVocab(list);
      render();
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'vocabForm') return;
    e.preventDefault();
    const word = document.getElementById('vocabWord').value.trim();
    const note = document.getElementById('vocabNote').value.trim();
    if (!word) return;
    const list = loadVocab();
    list.push({ word, note });
    saveVocab(list);
    sessionTab = 'analysis';
    render();
  });

  boot();
})();
