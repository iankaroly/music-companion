import { describe, test, it, expect } from 'vitest';
import { pitchOf, BOTTOM_LINE } from '../src/analysis/scan-notes.js';
import { notesInOrder } from '../src/analysis/scan-read.js';
import { keyFromCount } from '../src/analysis/scan-key.js';

const NONE = keyFromCount(0, 'sharp');

describe('pitchOf', () => {
  test('step 0 in bass clef is the G below the bass stave', () => {
    expect(pitchOf(0, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass);
  });

  test('a step up is one DEGREE, not one semitone', () => {
    expect(pitchOf(1, 'bass', NONE).midi).toBe(45); // G2 -> A2, a tone
    expect(pitchOf(2, 'bass', NONE).midi).toBe(47); // A2 -> B2, a tone
    expect(pitchOf(3, 'bass', NONE).midi).toBe(48); // B2 -> C3, a SEMITONE
  });

  test('seven steps is an octave', () => {
    expect(pitchOf(7, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass + 12);
    expect(pitchOf(14, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass + 24);
  });

  test('a step below the bottom line still reads', () => {
    expect(pitchOf(-1, 'bass', NONE).midi).toBe(41); // F2
    expect(pitchOf(-7, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass - 12);
  });

  test('each clef names its own bottom line', () => {
    expect(pitchOf(0, 'tenor', NONE).midi).toBe(BOTTOM_LINE.tenor);
    expect(pitchOf(0, 'treble', NONE).midi).toBe(BOTTOM_LINE.treble);
  });

  // A clef does NOT preserve the interval pattern measured from the bottom
  // line, and an earlier version of this test asserted that it does. It cannot:
  // the bass stave starts on G, so its first step is G-A, a tone; the treble
  // starts on E, so its first step is E-F, a semitone. What survives a clef is
  // the DIRECTION of each move, which is all scan-align.js ever claimed and all
  // it could work from without knowing the clef.
  test('what a clef preserves is direction, not interval size', () => {
    const steps = [0, 2, 5, 3, 6, 1];
    const moves = (clef) => steps.slice(1).map((s, i) => Math.sign(
      pitchOf(s, clef, NONE).midi - pitchOf(steps[i], clef, NONE).midi,
    ));
    expect(moves('treble')).toEqual(moves('bass'));
    expect(moves('tenor')).toEqual(moves('bass'));
  });

  test('but the interval pattern genuinely differs, which is why a clef must be read', () => {
    const shape = (clef) => [0, 1, 2, 3]
      .map((s) => pitchOf(s, clef, NONE).midi - pitchOf(0, clef, NONE).midi);
    expect(shape('bass')).toEqual([0, 2, 4, 5]); // G A B C
    expect(shape('treble')).toEqual([0, 1, 3, 5]); // E F G A
  });

  test('two sharps raises every F and C by a semitone', () => {
    const twoSharps = keyFromCount(2, 'sharp');
    expect(pitchOf(6, 'bass', NONE).midi).toBe(53); // F3
    expect(pitchOf(6, 'bass', twoSharps).midi).toBe(54); // F#3
    expect(pitchOf(1, 'bass', twoSharps).midi).toBe(45); // A2, untouched
  });

  test('an unreadable clef or key refuses rather than assuming', () => {
    expect(pitchOf(0, null, NONE)).toBeNull();
    expect(pitchOf(0, 'alto', NONE)).toBeNull();
    expect(pitchOf(0, 'treble', null)).toBeNull();
    expect(pitchOf(null, 'bass', NONE)).toBeNull();
  });

  test('the degree comes back with the pitch', () => {
    expect(pitchOf(0, 'bass', NONE).degree).toBe(4); // bottom line of bass is G
    expect(pitchOf(0, 'treble', NONE).degree).toBe(2); // treble is E
    expect(pitchOf(0, 'tenor', NONE).degree).toBe(1); // tenor is D
  });

  // THE ONE NOTE A TENOR CLEF ACTUALLY NAMES, which is the check that would
  // have caught the two-degree error this test file used to assert. A C-clef in
  // tenor position puts middle C on the FOURTH line, and the fourth line is
  // step 6 — lines stand at steps 0, 2, 4, 6 and 8. So this is not a fact about
  // the table, it is the definition of the clef, and the table has to follow it.
  //
  // The bottom line then follows by counting down: D3 F3 A3 C4 E4. It read F3
  // for both numbers, so every note on a tenor page came out a third high — and
  // in scan-key.js the same error read a lone sharp standing on D as F sharp,
  // which is the commonest signature there is and therefore the one nobody
  // would question.
  test('a tenor clef puts middle C on the fourth line, which is step 6', () => {
    expect(pitchOf(6, 'tenor', NONE).midi).toBe(60);
    expect(pitchOf(6, 'tenor', NONE).degree).toBe(0); // C
    expect(BOTTOM_LINE.tenor).toBe(50); // D3, four degrees below it
    // …and F3 is the SECOND line, step 2, which is what the old table put on
    // the bottom one.
    expect(pitchOf(2, 'tenor', NONE).midi).toBe(53);
  });
});

// The wiring, not the arithmetic. pitchOf has been correct for a while and
// notesInOrder did not call it: every note came out of the reader as a POSITION
// with a clef and a key sitting unused beside it. These pin the join.
describe('notesInOrder names the note', () => {
  const page = (clef, key, steps) => ({
    key,
    staves: [{
      clef,
      clefConfidence: 1,
      key,
      keyConfidence: 1,
      bars: [],
      heads: steps.map((step, i) => ({ x: 0.1 * (i + 1), y: 0.5, step, beats: 1, beams: 0, via: 'shape' })),
    }],
  });
  const oneSharp = keyFromCount(1, 'sharp');

  it('reads the bottom line of each clef', () => {
    expect(notesInOrder(page('bass', oneSharp, [0]))[0].midi).toBe(43);    // G2
    expect(notesInOrder(page('treble', oneSharp, [0]))[0].midi).toBe(64);  // E4
    expect(notesInOrder(page('tenor', oneSharp, [0]))[0].midi).toBe(50);   // D3
  });

  it('applies the key signature — one sharp makes the F below bass G an F sharp', () => {
    // Step -1 in bass clef is the F below the bottom line: F2 is 41, F#2 is 42.
    expect(notesInOrder(page('bass', keyFromCount(0, 'sharp'), [-1]))[0].midi).toBe(41);
    expect(notesInOrder(page('bass', oneSharp, [-1]))[0].midi).toBe(42);
  });

  it('propagates null rather than assuming a clef', () => {
    // A cello part is in bass clef most of the time, and "most of the time" is
    // what turns the other times into confident verdicts a sixth out.
    const n = notesInOrder(page(null, oneSharp, [0, 4]));
    expect(n.map((x) => x.midi)).toEqual([null, null]);
  });

  it('prefers the PAGE key to a single system that could not read one', () => {
    const p = page('bass', null, [-1]);
    p.key = oneSharp;                       // the page agreed; this system did not
    expect(notesInOrder(p)[0].midi).toBe(42);
  });
});
