import { describe, test, expect } from 'vitest';
import { alignScale, bestAlignment, tempoStats, avgAbsCents } from '../src/analysis/scoring.js';
import { buildScale } from '../src/analysis/scales.js';

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

describe('bestAlignment', () => {
  const toNotes = (midis) => midis.map((m, i) => ({ midi: m, cents: 0, start: i * 0.5, end: i * 0.5 + 0.4 }));

  test('detects the register: a D major scale played from D4 reports tonic D4', () => {
    const notes = toNotes(buildScale({ tonic: 'D4', type: 'major', octaves: 1 }));
    const best = bestAlignment({ key: 'D', type: 'major', octaves: 1 }, notes);
    expect(best.tonic).toBe('D4');
    expect(best.matched).toBe(15);
  });

  test('the same scale an octave lower reports tonic D2', () => {
    const notes = toNotes(buildScale({ tonic: 'D2', type: 'major', octaves: 1 }));
    const best = bestAlignment({ key: 'D', type: 'major', octaves: 1 }, notes);
    expect(best.tonic).toBe('D2');
  });

  test('a partial run still picks the register of what was played', () => {
    const notes = toNotes(buildScale({ tonic: 'A3', type: 'major', octaves: 1 }).slice(0, 5));
    const best = bestAlignment({ key: 'A', type: 'major', octaves: 1 }, notes);
    expect(best.tonic).toBe('A3');
    expect(best.matched).toBe(5);
  });

  test('no notes yields null', () => {
    expect(bestAlignment({ key: 'D', type: 'major', octaves: 1 }, [])).toBeNull();
  });
});

describe('avgAbsCents', () => {
  test('averages absolute cents over played degrees only', () => {
    const degrees = [
      { played: { cents: 10 } },
      { played: { cents: -20 } },
      { played: null },
      { played: { cents: 0 } },
    ];
    expect(avgAbsCents(degrees)).toBeCloseTo(10, 5);
  });

  test('returns null when nothing was played', () => {
    expect(avgAbsCents([{ played: null }])).toBeNull();
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
