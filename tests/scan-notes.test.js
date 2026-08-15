import { describe, test, expect } from 'vitest';
import { pitchOf, BOTTOM_LINE } from '../src/analysis/scan-notes.js';
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
    expect(pitchOf(0, 'tenor', NONE).degree).toBe(3); // tenor is F
  });
});
