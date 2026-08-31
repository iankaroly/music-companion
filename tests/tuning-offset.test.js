// WHERE THE INSTRUMENT IS SITTING, and when the app may say so.
//
// The complaint: "the app would say it's an A, but it's actually an A#.
// Everything seemed to be a half step too low." Nothing was broken — naming a
// pitch means rounding to the nearest semitone, and an instrument 51 cents flat
// is nearer the note below, so every name moves down together while the cents
// beside each one look immaculate. What was missing is the app noticing.
//
// The danger in noticing is telling a struggling player their tuner is wrong,
// so the gate is held down here as hard as the answer is.
import { describe, it, expect } from 'vitest';
import { tuningOffset, sayTuningOffset } from '../src/analysis/tuning-offset.js';

// Playing that is steady, at a chosen distance from the app's A. `cents` is
// what the app writes down, which is always folded into ±50 — that fold is the
// renaming, and the estimator has to survive it.
const fold = (c) => { let x = c; while (x < -50) x += 100; while (x >= 50) x -= 100; return x; };
function playing(offset, wobble, count = 60, seed = 5) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;
  return Array.from({ length: count }, () => ({ cents: fold(offset + rnd() * wobble) }));
}

describe('finding the instrument in the playing', () => {
  it('finds an offset the fold has already hidden', () => {
    // 55¢ flat: every reading has been renamed, and the plain mean of the
    // written cents is near +11 rather than -55. The circular mean is not
    // fooled — it lands on +45, which IS -55 on a circle of one semitone and is
    // the only answer available: after the fold, 55 flat and 45 sharp are the
    // same readings note for note. See sayTuningOffset.
    const out = tuningOffset(playing(-55, 8));
    expect(out.tightness).toBeGreaterThan(0.9);
    expect(Math.abs(out.cents - 45)).toBeLessThan(6);
  });

  it('finds a small one, and a sharp one', () => {
    expect(tuningOffset(playing(-24, 8)).cents).toBeCloseTo(-24, -1);
    expect(tuningOffset(playing(+31, 8)).cents).toBeCloseTo(31, -1);
  });

  it('reports steady playing as tight, whatever the offset', () => {
    // Shifting the instrument moves the offset and must leave the tightness
    // alone — that is the whole basis for telling the two faults apart.
    const near = tuningOffset(playing(-3, 10));
    const far = tuningOffset(playing(-47, 10));
    expect(Math.abs(near.tightness - far.tightness)).toBeLessThan(0.1);
  });

  it('reports scattered playing as loose', () => {
    expect(tuningOffset(playing(0, 60)).tightness).toBeLessThan(0.45);
    expect(tuningOffset(playing(-40, 90)).tightness).toBeLessThan(0.45);
  });

  it('says nothing about a handful of notes', () => {
    expect(tuningOffset(playing(-55, 5, 6))).toBe(null);
    expect(tuningOffset([])).toBe(null);
    expect(tuningOffset(null)).toBe(null);
  });
});

describe('when it is allowed to say so', () => {
  it('says a direction only while the fold has left one', () => {
    const said = sayTuningOffset(tuningOffset(playing(-28, 8)));
    expect(said).toMatch(/28¢ below A440/);
    expect(said).toMatch(/A of about 43[0-9]/);
  });

  it('REFUSES a direction past the halfway line, where it cannot know one', () => {
    // A flute 55¢ flat and one 45¢ sharp write down identical readings. Saying
    // "above" to the flat one would point at the opposite of the problem, so
    // near the line it says only what it knows: about half a semitone off, and
    // the names have moved.
    const flat = sayTuningOffset(tuningOffset(playing(-55, 8)));
    const sharp = sayTuningOffset(tuningOffset(playing(45, 8)));
    expect(flat).toMatch(/half a semitone from A440/);
    expect(flat).toMatch(/names on this take may be a semitone out/);
    expect(flat).not.toMatch(/above|below/);
    expect(sharp).toBe(flat);          // they are the same take, and it says so
  });

  it('does NOT say it to somebody who is simply struggling', () => {
    // The failure that would matter: scattered playing is not a wrong tuner,
    // and being told it is would be both wrong and discouraging.
    expect(sayTuningOffset(tuningOffset(playing(0, 60)))).toBe(null);
    expect(sayTuningOffset(tuningOffset(playing(-45, 80)))).toBe(null);
  });

  it('does NOT say it for a few cents, which is a player playing', () => {
    expect(sayTuningOffset(tuningOffset(playing(-6, 8)))).toBe(null);
    expect(sayTuningOffset(tuningOffset(playing(9, 8)))).toBe(null);
  });

  it('leaves out the semitone warning well below the boundary', () => {
    const said = sayTuningOffset(tuningOffset(playing(-25, 8)));
    expect(said).toMatch(/below A440/);
    expect(said).not.toMatch(/semitone/);
  });

  it('counts from the A the take was measured against, not from 440', () => {
    const said = sayTuningOffset(tuningOffset(playing(-30, 8)), 415);
    expect(said).toMatch(/below A415/);
  });

  it('says nothing when there is nothing', () => {
    expect(sayTuningOffset(null)).toBe(null);
  });
});
