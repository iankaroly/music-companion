// Writes the cases the Swift harness feeds to the real on-device model.
//
//   node tools/ai-model/export-cases.mjs out.json
//
// Every answerable question of the three eval sets (questions.js, heldout.js,
// musicality-questions.js), run through the real router and fact builder, with
// the instructions and prompt exactly as src/ai/assistant.js builds them NOW.
// So tuning the prompt means editing assistant.js and re-running this; the Swift
// side never contains a prompt of its own.
//
// The split: sorted by a hash of the question text, every third question is
// SEALED (split "held"), the rest are "tune". The hash, not the file order, so
// adding a question never moves another one across the line. Nobody reads the
// sealed replies while tuning; score.mjs prints only their counts until --reveal.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { runCase } from '../../tests/ai-eval/run.mjs';
import { QUESTIONS } from '../../tests/ai-eval/questions.js';
import { HELDOUT } from '../../tests/ai-eval/heldout.js';
import { MUSICALITY_QUESTIONS } from '../../tests/ai-eval/musicality-questions.js';
import { instructionsFor, promptFor } from '../../src/ai/assistant.js';

const sets = { dev: QUESTIONS, heldout: HELDOUT, shaping: MUSICALITY_QUESTIONS };
const seen = new Set();
const pool = [];
for (const [set, qs] of Object.entries(sets)) {
  for (const q of qs) {
    if (q.scope !== 'answer') continue;
    const key = `${q.lib}|${q.q}`;
    if (seen.has(key)) continue; // the same words on the same library are one question
    seen.add(key);
    pool.push({ set, q, key, h: createHash('sha1').update(key).digest('hex') });
  }
}
pool.sort((a, b) => (a.h < b.h ? -1 : 1));

// A question whose facts span several takes is never sent to the model (see
// modelMaySpeak in assistant.js), so it has no reply to score. Its id is kept
// (ids are positions in the hash order, so they do not move) and it goes to a
// second file, <out>.code.json, so the count of questions routed away is read
// off the same pool the model cases come from.
const all = pool.map((p, i) => ({ p, i, r: runCase(p.q) }));
const cases = all.filter(({ r }) => r.routed === 'model').map(({ p, i, r }) => {
  return {
    id: i,
    set: p.set,
    split: i % 3 === 0 ? 'held' : 'tune',
    lib: p.q.lib,
    question: p.q.q,
    intents: r.intents,
    takeCount: r.takeIds.length,
    takesInFacts: r.takesInFacts,
    facts: r.facts,
    instructions: instructionsFor(r.intents),
    prompt: promptFor(p.q.q, r.facts),
  };
});
const out = process.argv[2] ?? 'cases.json';
writeFileSync(out, JSON.stringify(cases, null, 1));
const code = all.filter(({ r }) => r.routed === 'code').map(({ p, i, r }) => ({ id: i, set: p.set, split: i % 3 === 0 ? 'held' : 'tune', lib: p.q.lib, question: p.q.q, intents: r.intents, takesInFacts: r.takesInFacts }));
writeFileSync(out.replace(/\.json$/, '') + '.code.json', JSON.stringify(code, null, 1));
const n = (s) => cases.filter((c) => c.split === s).length;
console.log(`${all.length} answerable questions: ${cases.length} go to the model (${n('tune')} tune, ${n('held')} held), ${code.length} are answered by code alone. longest prompt ${Math.max(...cases.map((c) => c.prompt.length + c.instructions.length))} chars`);
