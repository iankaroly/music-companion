// Prints the facts of the ten pairing scenarios (tests/ai-pairing-fixtures.mjs).
import { factsOf } from '../../tests/ai-pairing-fixtures.mjs';

const spec = { etude: ['summary'], collision: ['summary'], flat: ['summary'], scored: ['worst'], nobars: ['worst'], one_pitch: ['worst'], toned: ['tone'], paced: ['tempo'], clean: ['summary'], habit1: ['habits'] };
for (const [k, i] of Object.entries(spec)) {
  console.log(`## ${k} ${i}`);
  for (const f of factsOf(k, i).facts) console.log(`   ${f}`);
}
