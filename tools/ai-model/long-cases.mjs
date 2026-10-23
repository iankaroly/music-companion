// Synthetic oversize prompts: the real facts of one question repeated until the
// prompt is N characters, to find where the context window gives out.
//   node tools/ai-model/long-cases.mjs out.json
import { writeFileSync } from 'node:fs';
import { runCase } from '../../tests/ai-eval/run.mjs';
import { QUESTIONS } from '../../tests/ai-eval/questions.js';
import { instructionsFor, promptFor } from '../../src/ai/assistant.js';

const q = QUESTIONS.find((x) => x.q === 'how was my last take');
const r = runCase(q);
const base = r.facts;
const cases = [];
for (const [i, target] of [1500, 3000, 6000, 9000, 12000, 16000, 24000].entries()) {
  const facts = [];
  let n = 0;
  while (n < target) { const f = base[facts.length % base.length]; facts.push(f); n += f.length + 3; }
  cases.push({ id: i, target, instructions: instructionsFor(r.intents), prompt: promptFor(q.q, facts) });
}
writeFileSync(process.argv[2] ?? 'long.json', JSON.stringify(cases));
console.log(cases.map((c) => `${c.target}->${c.prompt.length + c.instructions.length}`).join(' '));
