// Bundles data/manifest.json and every ready module JSON into data/bundle.js
// so index.html works when opened straight from disk (file:// blocks fetch()).
// Usage: node tools/build-bundle.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'data', 'manifest.json'), 'utf8'));
const modules = {};

for (const entry of manifest.modules) {
  if (entry.status !== 'ready') continue;
  const path = join(root, entry.file);
  if (!existsSync(path)) throw new Error(`Manifest lists ${entry.file} as ready but the file is missing.`);
  const mod = JSON.parse(readFileSync(path, 'utf8'));

  // Validate so a typo in a hand-written question fails the build, not the exam.
  mod.questions.forEach((q, i) => {
    const where = `${entry.id} question ${i + 1}`;
    if (q.n !== i + 1) throw new Error(`${where}: n is ${q.n}, expected ${i + 1}`);
    if (!['EASY', 'MEDIUM', 'HARD'].includes(q.difficulty)) throw new Error(`${where}: bad difficulty`);
    if (!q.explanation) throw new Error(`${where}: missing explanation`);
    if (q.type === 'grid') {
      if (!Array.isArray(q.nums) || !q.nums.length || q.nums.some((n) => typeof n !== 'number' || Number.isNaN(n))) throw new Error(`${where}: grid needs numeric "nums"`);
      if (!q.display) throw new Error(`${where}: grid needs "display"`);
    } else {
      if (!Array.isArray(q.choices) || q.choices.length !== 4) throw new Error(`${where}: needs exactly 4 choices`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) throw new Error(`${where}: answer must be 0-3`);
      if (!Array.isArray(q.why) || q.why.length !== 4) throw new Error(`${where}: needs 4 "why" entries`);
      if (!/^Correct\./.test(q.why[q.answer])) throw new Error(`${where}: why[${q.answer}] should start with "Correct."`);
      q.why.forEach((w, k) => {
        if (k !== q.answer && /^Correct\./.test(w)) throw new Error(`${where}: why[${k}] wrongly marked Correct.`);
      });
    }
  });
  if (mod.questions.length !== entry.questionCount) {
    throw new Error(`${entry.id}: manifest says ${entry.questionCount} questions, file has ${mod.questions.length}`);
  }
  modules[entry.id] = mod;
}

writeFileSync(join(root, 'data', 'bundle.js'), `window.SAT_DATA = ${JSON.stringify({ manifest, modules })};\n`);
console.log(`Bundled ${Object.keys(modules).length} module(s): ${Object.keys(modules).join(', ')}`);
