import { describe, it, expect } from 'vitest';
import { retuneNotes, centreHz } from '../src/analysis/tuning-offset.js';

// A note is written down as the nearest name and a distance from it in cents,
// both measured against the A the app was set to. Judged against another A
// the same sound sits somewhere else: 441 instead of 440 is 3.9 cents, and a
// note that was 2 cents sharp of A4 at 440 is 1.9 cents flat of it at 441.
describe('retuneNotes', () => {
  const at440 = [
    { start: 0, end: 1, midi: 69, name: 'A4', cents: 2 },
    { start: 1, end: 2, midi: 60, name: 'C4', cents: -48 },
    { start: 2, end: 3, midi: 72, name: 'C5', cents: 49, chord: true },
  ];

  it('moves every note by the same amount and keeps everything else', () => {
    const at441 = retuneNotes(at440, 440, 441);
    const shift = 1200 * Math.log2(440 / 441);
    expect(at441[0].cents).toBeCloseTo(2 + shift, 6);
    expect(at441[0].midi).toBe(69);
    expect(at441[0].name).toBe('A4');
    expect(at441[2].chord).toBe(true);
    expect(at441[0].start).toBe(0);
    expect(at441).not.toBe(at440);
  });

  it('renames a note that crosses the halfway line', () => {
    // 49 cents sharp of C5 at 440 is past halfway to C#5 once the reference
    // drops: judged against 436 Hz everything reads 15.8 cents sharper.
    const down = retuneNotes(at440, 440, 436);
    expect(down[2].midi).toBe(73);
    expect(down[2].name).toBe('C#5');
    expect(down[2].cents).toBeCloseTo(49 + 1200 * Math.log2(440 / 436) - 100, 6);
    // …and back again is where it started.
    const back = retuneNotes(down, 436, 440);
    expect(back[2].midi).toBe(72);
    expect(back[2].cents).toBeCloseTo(49, 6);
  });

  it('is a no-op for the same reference', () => {
    expect(retuneNotes(at440, 440, 440)).toEqual(at440);
  });

  it('leaves a note with no cents alone', () => {
    const odd = [{ start: 0, end: 1, midi: 69, name: 'A4' }];
    expect(retuneNotes(odd, 440, 441)).toEqual(odd);
  });
});

describe('centreHz', () => {
  it('turns the tuning offset back into the A the playing was centred on', () => {
    expect(centreHz(440, 0)).toBe(440);
    expect(centreHz(440, 3.93)).toBeCloseTo(441, 2);
    expect(centreHz(442, -7.85)).toBeCloseTo(440, 2);
  });
});
