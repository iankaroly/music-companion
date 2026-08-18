import { describe, it, expect } from 'vitest';
import { pairNotes, headsOf } from '../src/ui/scan-view.js';
import { keyFromCount } from '../src/analysis/scan-key.js';
import { semitonesForStep, fitPitches } from '../src/analysis/scan-pitch.js';

// A page of music, as the reader would have measured it: a notehead's position
// on the stave, its page, its stave and its bar.
const PART = (() => {
  const out = [];
  let at = 0;
  let seed = 8675309;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 120; i++) {
    const r = next();
    const move = r < 0.1 ? 0 : (r < 0.55 ? 1 : (r < 0.85 ? 2 : 4));
    at += next() < 0.5 ? -move : move;
    at = Math.max(-6, Math.min(12, at));
    out.push(at);
  }
  return out;
})();

const heads = PART.map((step, i) => ({
  step, x: (i % 8) / 8, y: 0.5,
  page: Math.floor(i / 40), staff: Math.floor(i / 8) % 5, bar: i % 4,
}));

// Playing the page: the written position becomes a pitch through one offset,
// which is what a clef is.
const BASE = 43;                       // the bottom line of a bass stave
const play = (steps, from = 0) => steps.map((step, i) => ({
  midi: BASE + semitonesForStep(step), start: (from + i) * 0.25, end: (from + i) * 0.25 + 0.2, cents: 0,
}));

// A PAGE WHOSE PITCHES COULD NOT BE READ NOW PLACES NOTHING, and these five
// tests used to assert the opposite.
//
// What they asserted was that the contour route — findStart, then fitPitches,
// then either the aligner or counting off — puts note k on notehead k through a
// skipped note, an extra one and a repeated bar. On THIS page it does, because
// this page is a perfect list of steps with no head missing, no head invented
// and every played pitch exact.
//
// A real page is not that, and when somebody finally measured it the route was
// wrong far more often than right. `npm run scan:align -- --unpriced` strips
// the pitch off every head, which is what a page whose clef or key would not
// read hands the pairing, and scores which notehead each played note landed on
// over 32 studies and 128 takes: 130 notes on the right head, 307 on the WRONG
// one. Its own confidence cannot separate the two — at a fit agreement of 0.6
// it is 27 right against 37 wrong — so there is no threshold to hide behind.
//
// A ring on a notehead is a claim that a moment of the recording belongs there,
// and a user reported exactly what that costs: pressing a note played back a
// different part of the music. So the route refuses, and these tests hold it to
// the refusal. The pitch route below is unchanged and is the one that works.
describe('a page whose pitches could not be read', () => {
  it('refuses to put a take on it, however clean the take is', () => {
    const played = play(PART.slice(0, 40));
    const { marks, placed, readPitch } = pairNotes(heads, played);
    expect(readPitch).toBe(false);
    expect(placed).toBe(false);
    expect(marks).toHaveLength(0);
  });

  it('says which of the two things went wrong', () => {
    const { why } = pairNotes(heads, play(PART.slice(0, 40)));
    expect(why).toMatch(/clef/);
    const nothing = Array.from({ length: 30 }, (_, i) => ({
      midi: 40 + ((i * 7) % 13), start: i * 0.25, end: i * 0.25 + 0.2, cents: 0,
    }));
    // A take that cannot even be located keeps findStart's own reason rather
    // than being told the clef is at fault.
    expect(pairNotes(heads, nothing).why).not.toMatch(/clef/);
  });

  it('refuses a take that is not this music', () => {
    const nothing = Array.from({ length: 30 }, (_, i) => ({
      midi: 40 + ((i * 7) % 13), start: i * 0.25, end: i * 0.25 + 0.2, cents: 0,
    }));
    const { placed, marks } = pairNotes(heads, nothing);
    expect(placed).toBe(false);
    expect(marks).toHaveLength(0);
  });

  it('refuses a page with no positions on it at all', () => {
    const blind = heads.map(({ step, ...rest }) => rest);
    const { placed } = pairNotes(blind, play(PART.slice(0, 40)));
    expect(placed).toBe(false);
  });

  // The fit itself still works and is still tested: it is the PLACEMENT built
  // on top of it that was not good enough, and scan-pitch.js is used elsewhere.
  it('can still fit the one unknown a clef represents', () => {
    const fit = fitPitches(heads, play(PART.slice(0, 40)), 0);
    expect(fit.base).toBe(BASE);
    expect(fit.agreement).toBeGreaterThan(0.95);
  });
});

// Placed by the aligner, on pitches the PAGE read for itself.
//
// The route above asks two questions in the wrong order: findStart guesses
// where the take began from the shape of the line alone, then fitPitches works
// out the clef from the take that has just been placed. Neither can check the
// other. With a clef read off the paper there is nothing to guess.
describe('pairing on pitches read off the page', () => {
  const LINE = [43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];

  const readHeads = (midis) => midis.map((midi, i) => ({
    midi, step: i, page: 0, space: 0.01, x: 0.05 + (i % 10) * 0.09, y: 0.5,
  }));
  const play = (midis) => midis.map((midi, i) => ({ midi, cents: 0, start: i * 0.5 }));

  it('places a take that starts halfway down the page, halfway down the page', () => {
    const result = pairNotes(readHeads(LINE), play(LINE.slice(9)));
    expect(result.readPitch).toBe(true);
    expect(result.placed).toBe(true);
    expect(result.marks[0].midi).toBe(LINE[9]);
  });

  it('a spurious notehead costs one note, not the rest of the take', () => {
    // The failure that broke the old route: one invented head shifted every
    // pairing after it, with no way to resync. Edit distance pays 1.0 once.
    const withExtra = [...LINE.slice(0, 5), 99, ...LINE.slice(5)];
    const result = pairNotes(readHeads(withExtra), play(LINE));
    expect(result.placed).toBe(true);
    expect(result.marks.at(-1).midi).toBe(LINE.at(-1));
  });

  it('a missed notehead does not shift the rest either', () => {
    const missing = [...LINE.slice(0, 6), ...LINE.slice(7)];
    const result = pairNotes(readHeads(missing), play(LINE));
    expect(result.placed).toBe(true);
    expect(result.marks.at(-1).midi).toBe(LINE.at(-1));
  });

  it('heads with no readable pitch fall back to the old route rather than refusing', () => {
    const noPitch = readHeads(LINE).map((h) => ({ ...h, midi: null, step: h.step }));
    const result = pairNotes(noPitch, play(LINE));
    expect(result.readPitch).toBe(false);
  });
});

// The reference the aligner is handed is the pitch THE PAGE READ.
//
// headsOf used to re-price every head with `pitchOf(step, clef, NO_KEY)`, so a
// page in two sharps handed the aligner a reference a semitone out on every F
// and C — see the comment on headsOf and `npm run scan:align`, which measures
// what that cost. These two tests are the guard: one that the signature reaches
// the reference at all, and one that an unread key is still unknown and not C.
describe('the reference handed to the aligner carries the page it was read off', () => {
  // A page as readPage returns it: one bass stave, no barlines, three heads —
  // the bottom line G2, the F below it, and the C above the F.
  const pageIn = (key) => ({
    space: 0.01,
    key,
    staves: [{
      clef: 'bass',
      clefConfidence: 0.9,
      clefChanges: [],
      bars: [],
      key,
      keyConfidence: 0.8,
      heads: [
        { x: 0.2, y: 0.5, step: 0 },    // G2
        { x: 0.4, y: 0.5, step: -1 },   // F2 — sharpened by anything from 1 sharp
        { x: 0.6, y: 0.5, step: 3 },    // C3 — sharpened by two
      ],
    }],
  });

  it('sharpens the F and the C on a page in two sharps', () => {
    const heads = headsOf([pageIn(keyFromCount(2, 'sharp'))]);
    expect(heads.map((h) => h.midi)).toEqual([43, 42, 49]);
  });

  it('leaves them alone on a page read as bare C major', () => {
    // kind 'none' is a READING — agreeNoKey found the place a signature is
    // printed to be empty on every system — and is not the same thing as null.
    const heads = headsOf([pageIn({ ...keyFromCount(0, 'sharp'), kind: 'none' })]);
    expect(heads.map((h) => h.midi)).toEqual([43, 41, 48]);
  });

  it('gives every head a null pitch when the key could not be read at all', () => {
    const heads = headsOf([pageIn(null)]);
    // NAMED: nothing. A key nobody read cannot name a note (rule 5).
    expect(heads.map((h) => h.midi)).toEqual([null, null, null]);
    // MATCHED: still possible. The clef alone tells one notehead from its
    // neighbour, which is all the aligner needs, so the page keeps the pitch
    // route instead of falling to the contour one — which puts 70% of its
    // marks on the wrong notehead (npm run scan:align -- --unpriced).
    expect(heads.every((h) => Number.isFinite(h.matchMidi))).toBe(true);
    const paired = pairNotes(heads, [
      { midi: 43, cents: 0, start: 0 }, { midi: 41, cents: 0, start: 0.5 },
    ]);
    expect(paired.readPitch).toBe(true);
    // …and not one of its marks claims to know what the note was.
    expect(paired.marks.every((m) => m.verdict === 'unpriced')).toBe(true);
  });
});
