// How many of the written mispairing lies the guard catches, and whether the
// honest twins still pass.
//
//   node tools/ai-model/pairing-lies.mjs [--show] [--reveal-held]
//
// Held lies print only their count unless --reveal-held is passed.
import { LIES, HONEST } from '../../tests/ai-pairing-lies.mjs';
import { factsOf } from '../../tests/ai-pairing-fixtures.mjs';
import { checkReply } from '../../src/ai/guard.js';

const INTENT = { etude: ['summary'], collision: ['summary'], flat: ['summary'], scored: ['worst'], nobars: ['worst'], one_pitch: ['worst'], toned: ['tone'], paced: ['tempo'], clean: ['summary'], habit1: ['habits'] };
const show = process.argv.includes('--show');
const reveal = process.argv.includes('--reveal-held');

function verdict(s, text) {
  const f = factsOf(s, INTENT[s]);
  return checkReply(text, f.facts, 'how was my last take', { takeCount: 1, slots: f.slots });
}

const tally = { tune: [0, 0], held: [0, 0] };
for (const l of LIES) {
  const v = verdict(l.s, l.t);
  const half = l.held ? 'held' : 'tune';
  tally[half][1] += 1;
  if (!v.ok) tally[half][0] += 1;
  if (show && (!l.held || reveal)) console.log(`${v.ok ? 'PASSED (miss)' : 'caught       '} [${l.s}/${l.n}] ${l.t}${v.ok ? '' : `  <- ${v.problems.map((p) => `${p.kind}:${p.text}`).join(' | ')}`}`);
}
console.log(`lies caught: tune ${tally.tune[0]}/${tally.tune[1]}${reveal ? `, held ${tally.held[0]}/${tally.held[1]}` : ` (held half sealed: ${tally.held[1]} lies)`}`);
let fine = 0;
for (const h of HONEST) {
  const v = verdict(h.s, h.t);
  if (v.ok) fine += 1;
  else console.log(`FALSE REJECT [${h.s}] ${h.t}  <- ${v.problems.map((p) => `${p.kind}:${p.text}`).join(' | ')}`);
}
console.log(`honest twins passing: ${fine}/${HONEST.length}`);
