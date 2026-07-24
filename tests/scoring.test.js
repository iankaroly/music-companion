import { describe, test, expect } from 'vitest';
import { alignScale, tempoStats } from '../src/analysis/scoring.js';

function played(midi, cents, start) {
  return { midi, cents, start, end: start + 0.4 };
}

const EXPECTED = [50, 52, 54, 55, 57]; // start of D major

describe('alignScale', () => {
  test('a perfect run matches every degree with its cents', () => {
    const notes = EXPECTED.map((m, i) => played(m, i - 2, i * 0.5));
    const { degrees, matched, missed } = alignScale(EXPECTED, notes);
    expect(matched).toBe(5);
    expect(missed).toBe(0);
    expect(degrees.map((d) => d.played?.cents)).toEqual([-2, -1, 0, 1, 2]);
    expect(degrees[0].name).toBe('D3');
  });

  test('a skipped degree is marked missed and later degrees still align', () => {
    const notes = [played(50, 0, 0), played(54, 5, 0.5), played(55, 0, 1), played(57, 0, 1.5)];
    const { degrees, matched, missed } = alignScale(EXPECTED, notes);
    expect(missed).toBe(1);
    expect(matched).toBe(4);
    expect(degrees[1].played).toBeNull();
    expect(degrees[2].played.cents).toBe(5);
  });

  test('a re-bowed repeat of the same degree does not consume the next one', () => {
    const notes = [played(50, 0, 0), played(50, 3, 0.5), played(52, 0, 1), played(54, 0, 1.5)];
    const { degrees, matched } = alignScale(EXPECTED, notes);
    expect(matched).toBe(3);
    expect(degrees[1].played.cents).toBe(0);
  });

  test('a stray note matching neither current nor next degree is ignored', () => {
    const notes = [played(50, 0, 0), played(74, 0, 0.5), played(52, 0, 1)];
    const { matched, missed } = alignScale(EXPECTED, notes);
    expect(matched).toBe(2);
    expect(missed).toBe(3); // remaining unplayed degrees count as missed
  });
});

describe('tempoStats', () => {
  test('even 0.5s onsets read as 120 notes/min, high evenness, no drift', () => {
    const onsets = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];
    const s = tempoStats(onsets);
    expect(s.bpm).toBeCloseTo(120, 0);
    expect(s.evenness).toBeGreaterThan(0.95);
    expect(Math.abs(s.drift)).toBeLessThan(0.05);
  });

  test('accelerating onsets report negative drift (rushing)', () => {
    const onsets = [0, 0.6, 1.15, 1.65, 2.1, 2.5, 2.85, 3.15, 3.4];
    const s = tempoStats(onsets);
    expect(s.drift).toBeLessThan(-0.1);
  });

  test('fewer than three onsets yields null stats', () => {
    expect(tempoStats([0, 0.5])).toBeNull();
  });
});
