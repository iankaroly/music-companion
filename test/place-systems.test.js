// Placing each system of a page in a take, by shape alone.
//
// No note is ever named here. A clef moves every note by the same amount and
// changes no direction, so a page read in the wrong clef has the same shape as
// the page in the right one — which is the whole reason this route exists
// beside the one that reads pitches.

import { describe, it, expect } from 'vitest';
import { placeSystems, scaleOf, diatonicOf } from '../src/analysis/scan-align.js';
import { guessedAnchors, mergeAnchors } from '../src/analysis/bar-map.js';

// A line of music as the page reader gives it: steps, which are staff
// positions and not pitches.
const heads = (steps) => steps.map((step, i) => ({ step, x: i / steps.length }));
// …and the same line played: a step through a major scale, so a written third
// is four semitones and the two vocabularies bucket at the same place.
const SCALE = [0, 2, 4, 5, 7, 9, 11];
const midiOf = (step) => 48 + Math.floor(step / 7) * 12 + SCALE[((step % 7) + 7) % 7];
const played = (steps, from = 0, beat = 0.5) => steps.map((step, i) => ({
  midi: midiOf(step), start: from + i * beat, end: from + i * beat + beat * 0.9,
}));

// Three systems that do not resemble each other AND DO NOT REPEAT THEMSELVES.
//
// The second half of that is the part worth writing down. The first version of
// these was hand-written as a rising line, a falling one and a zig-zag, and
// every one of them was the same four-move cell nine times over — so a
// sixteen-move window matched in nine places within the system itself and all
// three were refused for want of a margin. That is the reader being right: a
// figure repeated nine times cannot say where in the take it is. Real music
// does it too, which is why the Bach Prélude is the hardest page in the corpus.
// A seeded walk gives a line with the same character and no periodicity.
const walkOf = (seed, length) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = [];
  let at = 14;
  for (let i = 0; i < length; i += 1) {
    out.push(at);
    const move = next();
    const size = move < 0.55 ? 1 : (move < 0.85 ? 2 : 4);
    at += (next() < 0.5 ? -size : size);
    at = Math.max(0, Math.min(30, at));
  }
  return out;
};
const RISING = walkOf(11, 36);
const FALLING = walkOf(29, 36);
const ZIGZAG = walkOf(97, 36);

describe('placing a system in a take', () => {
  const systems = [heads(RISING), heads(FALLING), heads(ZIGZAG)];
  const take = [
    ...played(RISING, 4),
    ...played(FALLING, 4 + RISING.length * 0.5),
    ...played(ZIGZAG, 4 + (RISING.length + FALLING.length) * 0.5),
  ];

  it('finds each system where it was actually played', () => {
    const out = placeSystems(systems, take);
    expect(out.map((one) => one.sure)).toEqual([true, true, true]);
    expect(out[0].time).toBeCloseTo(4, 5);
    expect(out[1].time).toBeCloseTo(4 + RISING.length * 0.5, 5);
    expect(out[2].time).toBeCloseTo(4 + (RISING.length + FALLING.length) * 0.5, 5);
  });

  // THE POINT OF THE WHOLE ROUTE. A clef read wrong moves every note by the
  // same amount; a key read wrong moves some of them by a semitone. Neither
  // changes which way the line went, so neither may change the answer.
  it('is unmoved when the whole take is transposed', () => {
    const moved = take.map((n) => ({ ...n, midi: n.midi - 9 }));
    const out = placeSystems(systems, moved);
    expect(out.map((one) => one.sure)).toEqual([true, true, true]);
    expect(out[1].time).toBeCloseTo(4 + RISING.length * 0.5, 5);
  });

  const wants = [4, 4 + RISING.length * 0.5, 4 + (RISING.length + FALLING.length) * 0.5];

  // WHAT IS ASSERTED HERE AND WHAT IS NOT. These tests hold the code to the
  // thing that must never fail — a placement is either right or refused — and
  // not to HOW MANY it places. Three seeded walks are a small and adversarial
  // page: any two random lines resemble each other somewhere, so the margin
  // between the right place and the next one is thin by construction, and
  // tuning the thresholds until three synthetic systems all place would be
  // tuning away the caution that keeps a real page safe. How much of a page
  // gets placed is measured on REAL pages by `npm run scan:guess` — 7 systems
  // of 10 on the Mozart at a tenth of the notes dropped, 4 of 10 on the Bach,
  // and no wrong anchor on either.
  it('survives the notes a real take leaves out and plays wrong', () => {
    const spoiled = take
      .filter((_, i) => i % 12 !== 3)
      .map((n, i) => (i % 20 === 5 ? { ...n, midi: n.midi + 3 } : n));
    const out = placeSystems(systems, spoiled);
    expect(out.filter((one) => one.sure).length).toBeGreaterThanOrEqual(1);
    for (const one of out.filter((p) => p.sure)) {
      expect(Math.abs(one.time - wants[one.system])).toBeLessThan(2);
    }
  });

  // WHERE IT STOPS, AND WHAT IT DOES THERE — the limit written down rather than
  // discovered. Past about a fifth of the notes gone it places little, and the
  // thing that matters is that what it does place is still right: a refusal
  // leaves the map running straight across, and a wrong anchor bends it.
  it('gives up rather than guessing when the take is badly broken', () => {
    const wrecked = take
      .filter((_, i) => i % 3 !== 0)
      .map((n, i) => (i % 4 === 1 ? { ...n, midi: n.midi + 5 } : n));
    const out = placeSystems(systems, wrecked);
    for (const one of out.filter((p) => p.sure)) {
      expect(Math.abs(one.time - wants[one.system])).toBeLessThan(2);
    }
  });

  it('refuses a system with too few noteheads to say anything', () => {
    const out = placeSystems([heads([0, 2, 4])], take);
    expect(out[0].sure).toBe(false);
    expect(out[0].why).toMatch(/too few noteheads/);
  });

  it('refuses when what was played is nothing like the page', () => {
    const noise = played(Array.from({ length: 36 }, (_, i) => (i * 5) % 11), 4);
    const out = placeSystems([heads(RISING)], noise);
    expect(out[0].sure).toBe(false);
  });

  // A WRONG ANCHOR IS WORSE THAN NO ANCHOR, because the map is straight lines
  // drawn through them and one out of order drags the stretches either side.
  it('refuses a system that would have to be played out of order', () => {
    // The same figure twice on the page, played once: the second copy can only
    // match where the first one did, and both cannot be right.
    const twice = [heads(RISING), heads(RISING), heads(FALLING)];
    const once = [...played(RISING, 4), ...played(FALLING, 4 + RISING.length * 0.5)];
    const out = placeSystems(twice, once);
    const sure = out.filter((one) => one.sure).map((one) => one.time);
    expect(sure.every((t, i) => i === 0 || t > sure[i - 1])).toBe(true);
  });
});

describe('the anchors those placements become', () => {
  it('turns a placed system into an anchor at that system’s position', () => {
    const anchors = guessedAnchors([
      { system: 0, time: 4, sure: true, score: 0.9 },
      { system: 1, time: null, sure: false, score: 0.2 },
      { system: 2, time: 22, sure: true, score: 0.8 },
    ]);
    expect(anchors).toEqual([
      { at: 0, time: 4, guessed: true, score: 0.9 },
      { at: 2, time: 22, guessed: true, score: 0.8 },
    ]);
  });

  // A TAP BEATS A GUESS, and it beats the guesses BETWEEN two taps as well —
  // two taps say what the tempo did across that stretch, and a guess inside it
  // that disagrees would bend the line away from what somebody heard.
  it('lets a tap win over a guess at the same place and between two', () => {
    const guessed = [
      { at: 0, time: 4 }, { at: 1, time: 40 }, { at: 2, time: 22 }, { at: 3, time: 30 },
    ];
    const hand = [{ at: 1, time: 13 }, { at: 2, time: 21 }];
    expect(mergeAnchors(hand, guessed)).toEqual([
      { at: 0, time: 4 }, { at: 1, time: 13 }, { at: 2, time: 21 }, { at: 3, time: 30 },
    ]);
  });

  it('uses the guesses alone when nobody has tapped', () => {
    const guessed = [{ at: 0, time: 4 }, { at: 2, time: 22 }];
    expect(mergeAnchors([], guessed)).toEqual(guessed);
  });
});

// READING THE TAKE IN THE PAGE'S OWN UNITS.
//
// Five buckets — up or down, step or leap — is what makes the match survive not
// knowing the clef, and on a page that repeats a figure it is too coarse: the
// Bach Prélude's bar 1 goes a fifth then a third and bar 2 a fifth then a
// fourth, and in five buckets those are the same seven symbols. The take says
// what scale it is in, and with that a played note becomes a degree — which is
// a staff position, the same kind of number the page reader measures.
describe('reading a take in degrees', () => {
  const inScale = (tonic, degrees) => degrees.map((d, i) => ({
    midi: 48 + tonic + Math.floor(d / 7) * 12 + SCALE[((d % 7) + 7) % 7],
    start: i * 0.4,
    end: i * 0.4 + 0.3,
  }));

  it('finds the scale most of the playing is in', () => {
    // Two octaves of G major, which is 7 as a pitch class.
    const notes = inScale(7, Array.from({ length: 30 }, (_, i) => i % 15));
    expect(scaleOf(notes)).toBe(7);
  });

  it('refuses when the playing is spread over everything', () => {
    const notes = Array.from({ length: 48 }, (_, i) => ({
      midi: 48 + i, start: i * 0.3, end: i * 0.3 + 0.2,
    }));
    expect(scaleOf(notes)).toBe(null);
  });

  it('says nothing about a take too short to have a scale', () => {
    expect(scaleOf([{ midi: 60, start: 0, end: 1 }])).toBe(null);
    expect(scaleOf([])).toBe(null);
  });

  it('turns a note into the staff position a reader would write it on', () => {
    // In C, middle C is the tonic; the notes above it climb one position each.
    expect(diatonicOf(60, 0) + 1).toBe(diatonicOf(62, 0));      // C to D
    expect(diatonicOf(62, 0) + 1).toBe(diatonicOf(64, 0));      // D to E
    expect(diatonicOf(64, 0) + 1).toBe(diatonicOf(65, 0));      // E to F, a semitone
    expect(diatonicOf(72, 0) - diatonicOf(60, 0)).toBe(7);      // an octave is seven
    // …and a note under the tonic belongs to the octave below.
    expect(diatonicOf(59, 0)).toBe(diatonicOf(60, 0) - 1);
  });

  // The whole reason for doing it this way: a clef shifts every position by the
  // same amount, and the comparison is of differences, so it cannot notice.
  it('is still unmoved by a take played in the wrong octave', () => {
    const systems = [heads(RISING), heads(FALLING), heads(ZIGZAG)];
    const take = [
      ...played(RISING, 4),
      ...played(FALLING, 4 + RISING.length * 0.5),
      ...played(ZIGZAG, 4 + (RISING.length + FALLING.length) * 0.5),
    ];
    const down = take.map((n) => ({ ...n, midi: n.midi - 12 }));
    const out = placeSystems(systems, down);
    expect(out.map((one) => one.sure)).toEqual([true, true, true]);
  });
});
