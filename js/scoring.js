/* Scoring and pacing helpers shared by report.html (browser) and tools/build-docs.mjs (Node).
   IMPORTANT: the raw-to-scaled conversion below is an ESTIMATE for this mock. Official College Board
   conversions are not published and depend on the adaptive form. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SAT_SCORING = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Raw questions per section across both modules.
  const TOTALS = { rw: 54, math: 44 };

  // Anchor points: fraction correct -> scaled score. Because every item in this mock is harder than an
  // official item, each anchor sits roughly 30 to 70 points above where an official form would place it.
  const ANCHORS = [
    [0, 200], [0.1, 270], [0.2, 340], [0.3, 410], [0.4, 470], [0.5, 540],
    [0.6, 600], [0.7, 660], [0.8, 720], [0.9, 770], [0.95, 790], [1, 800],
  ];

  function scaled(section, raw) {
    const total = TOTALS[section];
    const p = Math.min(1, Math.max(0, raw / total));
    let v = 800;
    for (let i = 1; i < ANCHORS.length; i++) {
      const [p0, s0] = ANCHORS[i - 1];
      const [p1, s1] = ANCHORS[i];
      if (p <= p1) { v = s0 + ((p - p0) / (p1 - p0)) * (s1 - s0); break; }
    }
    return Math.min(800, Math.max(200, Math.round(v / 10) * 10));
  }

  function table(section) {
    const rows = [];
    for (let raw = 0; raw <= TOTALS[section]; raw++) rows.push({ raw, scaled: scaled(section, raw) });
    return rows;
  }

  // Collapse the table into ranges of raw scores that share a scaled score.
  function ranges(section) {
    const out = [];
    table(section).forEach(({ raw, scaled: s }) => {
      const last = out[out.length - 1];
      if (last && last.scaled === s) last.to = raw; else out.push({ from: raw, to: raw, scaled: s });
    });
    return out;
  }

  function band(score) {
    if (score >= 750) return 'Elite';
    if (score >= 700) return 'Very strong';
    if (score >= 650) return 'Strong';
    if (score >= 600) return 'Solid';
    if (score >= 550) return 'Developing (upper)';
    if (score >= 500) return 'Developing';
    return 'Foundation';
  }

  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  // Checkpoints leave a review buffer at the end and spread the remaining time in proportion to target times.
  function checkpoints(questions, minutes, buffer) {
    const bufferSec = buffer == null ? 120 : buffer;
    const total = minutes * 60;
    const usable = total - bufferSec;
    const targetSum = questions.reduce((a, q) => a + q.targetSec, 0);
    const scale = usable / targetSum;
    const n = questions.length;
    const cum = [0];
    questions.forEach((q, i) => cum.push(cum[i] + q.targetSec * scale));
    return [0.25, 0.5, 0.75, 1].map((f) => {
      const k = Math.round(f * n);
      return { fraction: f, question: k, elapsedSec: cum[k], remainingSec: total - cum[k], elapsed: fmt(cum[k]), remaining: fmt(total - cum[k]) };
    });
  }

  function parseGrid(s) {
    s = String(s).trim().replace(/\s+/g, '').replace(/[−–]/g, '-');
    if (!s) return NaN;
    const m = s.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
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

  return { TOTALS, ANCHORS, scaled, table, ranges, band, checkpoints, parseGrid, isCorrect, fmt };
}));
