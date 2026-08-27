// A SYSTEM REFUSED FOR AMBIGUITY, RESCUED BY THE ARITHMETIC OF THE PAGE.
//
// `placeSystems` refuses a system whose shape matched two places and neither
// won — "this system looks the same as somewhere else in the take". That is a
// statement about the shape and about nothing else, and the page knows the one
// thing the shape cannot: how much music is printed before this system. Only
// one of the two places has the right amount of playing in front of it.
//
// WHY THIS IS WORTH A TEST OF ITS OWN, rather than trusting the corpus run.
// `npm run scan:guess` was taught to print what each refusal threw away, and
// the answer is that the refusals are two different populations wearing the
// same numbers:
//
//   seed  system  score  margin   its own guess was
//     11     4     0.78   0.10     0.41s out      right, and refusing it cost 5.05s
//      7     9     0.77   0.10   113.28s out      wrong, and refusing it saved the map
//
// 0.78/0.10 is right to four tenths of a second and 0.77/0.10 is wrong by
// nearly two minutes. No threshold on score or margin can tell those apart —
// they ARE the same numbers — so the second witness is the only thing that can,
// and this holds it down where a corpus average would not notice it break.
import { describe, it, expect } from 'vitest';
import { placeSystems } from '../src/analysis/scan-align.js';

// A page whose systems are long enough to be placed, built from a walk so the
// shapes differ, plus a take played straight down it.
function page(systemCount, per) {
  let step = 0;
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const systems = [];
  const steps = [];
  for (let s = 0; s < systemCount; s += 1) {
    const heads = [];
    for (let i = 0; i < per; i += 1) {
      step += Math.round((rnd() - 0.5) * 5);
      step = Math.max(-4, Math.min(12, step));
      heads.push({ step, x: i / per });
      steps.push(step);
    }
    systems.push(heads);
  }
  return { systems, steps };
}

// The take: every notehead played in order, a step turned into a semitone
// through a major scale, so the two vocabularies line up the way they do in
// real playing. Nothing under test sees this mapping.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const toMidi = (step) => 48 + 12 * Math.floor(step / 7) + MAJOR[((step % 7) + 7) % 7];
const takeOf = (steps) => steps.map((step, i) => ({ midi: toMidi(step), start: i * 0.5 }));

describe('placing the systems of a page in a take', () => {
  const { systems, steps } = page(6, 24);
  const played = takeOf(steps);

  it('places a page played straight through, and says where each system began', () => {
    const out = placeSystems(systems, played);
    const sure = out.filter((one) => one.sure);
    expect(sure.length).toBeGreaterThanOrEqual(4);
    // Each placed system begins where its own noteheads begin in the take.
    for (const one of sure) {
      if (one.system >= systems.length) continue;   // the end marker
      expect(Math.abs(one.at - one.system * 24)).toBeLessThan(6);
    }
  });

  it('carries what a refusal threw away, so a gate can be judged', () => {
    // Every entry has a best guess whether or not it was believed — that field
    // is what `scan:guess` prints and what the rescue below reads. Before it
    // existed the guess died on the line that refused it and nothing could ask
    // whether the refusal had been right.
    const out = placeSystems(systems, played);
    for (const one of out) {
      if (one.system >= systems.length) continue;
      expect(Number.isFinite(one.bestAt)).toBe(true);
    }
  });

  it('does not rescue a guess that lands where the page says it cannot', () => {
    // The rescue admits a refusal whose own guess sits on the line the
    // confident placements agree on. A page with almost no music before it
    // cannot begin two hundred notes into the take, and no score the shape
    // reports may talk the map into believing that it does.
    const out = placeSystems(systems, played);
    for (const one of out) {
      if (!one.sure || one.system >= systems.length) continue;
      // Whatever route put it there — shape or rescue — it has to sit on the
      // arithmetic: a system with N noteheads before it begins near note N.
      expect(Math.abs(one.at - one.system * 24)).toBeLessThan(24);
    }
  });
});
