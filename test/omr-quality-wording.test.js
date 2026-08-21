import { describe, it, expect } from 'vitest';
import { sayQuality } from '../src/analysis/omr-client.js';

// "only 21% of bars add up" was read as "it found 21% of the notes" — a
// different and much worse claim, and an easy mistake to make with a small
// percentage sitting next to a note count. The sentence has to be about beats
// in a bar, in those words, or it will be read as coverage of the page again.
describe('what the quality line claims', () => {
  const line = (rhythmScore, measures = 40, notes = 300) =>
    sayQuality({ quality: { measures, notes, rhythmScore }, pages: { read: 1, failed: 0 } });

  it('counts the bars that do not hold their beats, rather than a bare percentage', () => {
    const said = line(0.21);
    expect(said).toContain('300 notes');
    expect(said).toContain('wrong number of beats');
    expect(said).toMatch(/32 of 40 bars/);      // 79% of 40, rounded
    expect(said).not.toMatch(/\d+% of bars/);
  });

  it('says so plainly when the rhythm is sound', () => {
    expect(line(0.95)).toContain('every bar holds the right number of beats');
  });

  it('still leads with what was found', () => {
    expect(line(0.5, 12, 96).startsWith('12 bars, 96 notes')).toBe(true);
  });
});
