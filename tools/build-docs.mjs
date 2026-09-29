// Generates docs/scoring-guide.md, docs/analysis-framework.md and docs/pacing-card.md from the same
// scoring model and target times the app uses, so the documents can never disagree with the exam.
// Usage: node tools/build-docs.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = createRequire(import.meta.url)(join(root, 'js', 'scoring.js'));
const manifest = JSON.parse(readFileSync(join(root, 'data', 'manifest.json'), 'utf8'));
const ready = manifest.modules.filter((m) => m.status === 'ready');
const defs = Object.fromEntries(ready.map((m) => [m.id, JSON.parse(readFileSync(join(root, m.file), 'utf8'))]));
mkdirSync(join(root, 'docs'), { recursive: true });

const rangeRows = (k) => S.ranges(k).map((r) => `| ${r.from === r.to ? r.from : `${r.from}–${r.to}`} | ${r.scaled} |`).join('\n');

const scoring = `# Scoring guide

Each section is scored out of **800**: Reading and Writing (54 questions over two modules) and Math (44 questions over two modules).
The total is the sum, from **400 to 1600**.

> **Read this first.** The College Board does not publish its conversion tables, and real scores also depend on which adaptive
> Module 2 a student receives. The tables below are an **estimate built for this mock**. Every item here is harder than an
> official item, so each raw score is mapped roughly **30 to 70 points higher** than an official form would map it. Use them to
> track progress between mocks, not as a prediction of an official score.

## Reading and Writing (raw out of 54)

| Raw score | Estimated scaled |
| --- | --- |
${rangeRows('rw')}

## Math (raw out of 44)

| Raw score | Estimated scaled |
| --- | --- |
${rangeRows('math')}

## Score bands

| Section score | Descriptor |
| --- | --- |
| 750–800 | Elite |
| 700–740 | Very strong |
| 650–690 | Strong |
| 600–640 | Solid |
| 550–590 | Developing (upper) |
| 500–540 | Developing |
| 200–490 | Foundation |

## How to use it

1. Add your Module 1 and Module 2 raw scores for each section (the report page does this automatically).
2. Look up each section in the tables and add the two scaled scores for your estimated total.
3. Compare across mocks: a rise of 30 or more points on the same scale is a real improvement.
`;

const analysis = `# Post-test analysis framework

The live version of this framework is on \`report.html\`. It fills in automatically from your saved answers and timings.
Use this page as the method behind it.

## 1. Timing audit
For every module, compare time used with the target time per question.
- Average seconds per question against the target.
- Number of questions more than 25% over target, and the five biggest time sinks.
- Verdict: ran out of time, finished with more than 5 minutes spare, or healthy pacing.

## 2. Error pattern classification
Every missed question falls into one of four categories, decided by time spent:

| Category | Rule | Fix |
| --- | --- | --- |
| Unanswered | Left blank | Pacing and a guessing rule: never leave blanks |
| Rushed | Wrong in under 50% of target time | Re-read the question last; verify before moving on |
| Overthought | Wrong after over 150% of target time | Two-minute cap, flag and return |
| Skill or concept gap | Wrong at a normal pace | Study the method, redo the question cold in 3 days |

International-pattern items (near-synonyms, prepositions, countable and uncountable nouns, punctuation after verbs,
"on the contrary" versus "by contrast") are reported separately.

## 3. Stamina check
- Accuracy in the first, middle and last third of each module.
- Time against target in the first versus last third.
- Module 1 versus Module 2 accuracy in each section. A drop of 15 points or more points to fatigue or a pacing problem.

## 4. Desmos utilization
- Calculator opens, and on how many questions.
- Accuracy with versus without the calculator.
- The three multi-step Desmos items in Math Module 2 (Q10, Q11, Q17): were they solved, and was the calculator opened?
- Missed opportunities: questions with a Desmos tip that were missed without opening the calculator.

## 5. Vocabulary gap log
- Every Words in Context question you missed, with the meaning of both the correct word and the word you chose.
- A glossary of every word tested in the two Reading and Writing modules.
- A personal list (saved in the browser) for words you meet elsewhere.

## 6. Next session priority
Weak skills are ranked by a weighted score (3 per wrong, 2 per blank, 1 per correct-but-slow). The top five each get a specific
action. Suggested plan: three 45-minute sessions in a week, then a timed mixed set of 10 questions, then retest.
`;

const rules = [
  ['Reading and Writing', 'Aim for about 70 seconds per question. Read the question before the passage for structure and purpose items. Never spend more than 2 minutes on one item: flag it and move on.'],
  ['Math', 'Aim for about 95 seconds per question on average. Graph first in Desmos whenever the algebra will take longer than 30 seconds.'],
  ['Every module', 'Answer every question. There is no penalty for guessing. In the last 2 minutes, fill blanks and check flagged items only.'],
];
const pacing = `# Pacing reference card

Checkpoints leave a **2:00 review buffer** and spread the remaining time in proportion to each question's target time.
If you are more than 1:30 behind at a checkpoint, skip the next hard question and flag it.

| Module | Length | Checkpoint | Be at question | Time used by then | Time left |
| --- | --- | --- | --- | --- | --- |
${ready.map((m) => S.checkpoints(defs[m.id].questions, m.minutes).map((c, i) => `| ${i === 0 ? `**${m.label}**` : ''} | ${i === 0 ? `${m.minutes} min, ${m.questionCount} Q` : ''} | ${['25%', '50%', '75%', 'Finish'][i]} | Q${c.question} | ${c.elapsed} | ${c.remaining} |`).join('\n')).join('\n')}

## Rules

| Rule | Detail |
| --- | --- |
${rules.map((r) => `| **${r[0]}** | ${r[1]} |`).join('\n')}
`;

writeFileSync(join(root, 'docs', 'scoring-guide.md'), scoring);
writeFileSync(join(root, 'docs', 'analysis-framework.md'), analysis);
writeFileSync(join(root, 'docs', 'pacing-card.md'), pacing);
console.log('Wrote docs/scoring-guide.md, docs/analysis-framework.md, docs/pacing-card.md');
