import { describe, test, expect } from 'vitest';
import { aggregateTendencies, dailyScores, pickDrills, weeklyReport, pieceProgress } from '../src/analysis/coach.js';

const session = (date, notes) => ({
  date,
  noteStats: notes.map(([midi, name, cents]) => ({ midi, name, cents })),
});

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date(2026, 6, 20, 12).getTime(); // local noon avoids midnight edges

describe('aggregateTendencies', () => {
  test('groups by midi across sessions and averages cents', () => {
    const rows = aggregateTendencies([
      session(T0, [[57, 'A3', 10], [57, 'A3', 20]]),
      session(T0 + DAY, [[57, 'A3', 12]]),
    ], { minCount: 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0].midi).toBe(57);
    expect(rows[0].count).toBe(3);
    expect(rows[0].meanCents).toBeCloseTo(14, 5);
  });

  test('drops notes with fewer samples than minCount', () => {
    const rows = aggregateTendencies([
      session(T0, [[57, 'A3', 10], [57, 'A3', 8], [57, 'A3', 9], [60, 'C4', -30]]),
    ], { minCount: 3 });
    expect(rows.map((r) => r.midi)).toEqual([57]);
  });

  test('verdicts: sharp past +6, flat past -6, centered between', () => {
    const rows = aggregateTendencies([
      session(T0, [
        [50, 'D3', 12], [50, 'D3', 10], [50, 'D3', 14],
        [52, 'E3', -9], [52, 'E3', -11], [52, 'E3', -10],
        [55, 'G3', 2], [55, 'G3', -3], [55, 'G3', 1],
      ]),
    ]);
    const byMidi = Object.fromEntries(rows.map((r) => [r.midi, r.verdict]));
    expect(byMidi[50]).toBe('sharp');
    expect(byMidi[52]).toBe('flat');
    expect(byMidi[55]).toBe('centered');
  });

  test('mixed sharp/flat cancels in mean but not in absMean', () => {
    const [row] = aggregateTendencies([
      session(T0, [[57, 'A3', 20], [57, 'A3', -20], [57, 'A3', 20], [57, 'A3', -20]]),
    ]);
    expect(row.meanCents).toBeCloseTo(0, 5);
    expect(row.absMeanCents).toBeCloseTo(20, 5);
    expect(row.verdict).toBe('centered');
  });

  test('sorts high notes first', () => {
    const rows = aggregateTendencies([
      session(T0, [
        [50, 'D3', 1], [50, 'D3', 1], [50, 'D3', 1],
        [62, 'D4', 1], [62, 'D4', 1], [62, 'D4', 1],
      ]),
    ]);
    expect(rows.map((r) => r.midi)).toEqual([62, 50]);
  });
});

describe('dailyScores', () => {
  test('one point per day, mean of |cents|', () => {
    const days = dailyScores([
      session(T0, [[57, 'A3', 10], [57, 'A3', -30]]),
      session(T0 + 2 * 60 * 60 * 1000, [[57, 'A3', 20]]), // same day, later take
      session(T0 + DAY, [[57, 'A3', -5]]),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0].absMean).toBeCloseTo(20, 5);
    expect(days[0].noteCount).toBe(3);
    expect(days[1].absMean).toBeCloseTo(5, 5);
  });

  test('days come back in chronological order', () => {
    const days = dailyScores([
      session(T0 + DAY, [[57, 'A3', 5]]),
      session(T0, [[57, 'A3', 5]]),
    ]);
    expect(days[0].day < days[1].day).toBe(true);
  });
});

describe('weeklyReport', () => {
  test('splits this week from last and note-weights the averages', () => {
    const r = weeklyReport([
      session(T0, [[57, 'A3', 10], [57, 'A3', 20]]),          // today: avg 15 over 2
      session(T0 - 2 * DAY, [[57, 'A3', 30]]),                 // this week
      session(T0 - 9 * DAY, [[57, 'A3', 40], [57, 'A3', 40]]), // last week
    ], T0);
    expect(r.daysPracticed).toBe(2);
    expect(r.noteCount).toBe(3);
    expect(r.avgError).toBeCloseTo(20, 5); // (10+20+30)/3
    expect(r.prevAvgError).toBeCloseTo(40, 5);
  });

  test('no practice at all → null averages, zero streak', () => {
    const r = weeklyReport([], T0);
    expect(r.avgError).toBeNull();
    expect(r.prevAvgError).toBeNull();
    expect(r.streak).toBe(0);
    expect(r.daysPracticed).toBe(0);
  });

  test('streak counts consecutive days back from today', () => {
    const r = weeklyReport([
      session(T0, [[57, 'A3', 5]]),
      session(T0 - DAY, [[57, 'A3', 5]]),
      session(T0 - 2 * DAY, [[57, 'A3', 5]]),
      session(T0 - 4 * DAY, [[57, 'A3', 5]]), // gap at -3 breaks it
    ], T0);
    expect(r.streak).toBe(3);
  });

  test('a day off today does not break the streak yet', () => {
    const r = weeklyReport([
      session(T0 - DAY, [[57, 'A3', 5]]),
      session(T0 - 2 * DAY, [[57, 'A3', 5]]),
    ], T0);
    expect(r.streak).toBe(2);
  });
});

describe('pieceProgress', () => {
  const named = (date, name, notes) => ({ ...session(date, notes), name });

  test('groups takes by case-insensitive name, unnamed takes excluded', () => {
    const pieces = pieceProgress([
      named(T0, 'Bach Prelude', [[57, 'A3', 20]]),
      named(T0 - DAY, 'bach prelude', [[57, 'A3', 10]]),
      session(T0, [[57, 'A3', 50]]), // unnamed
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].takes).toHaveLength(2);
    expect(pieces[0].latest).toBeCloseTo(20, 5);
  });

  test('delta is latest minus first (negative = improving)', () => {
    const [p] = pieceProgress([
      named(T0 - 2 * DAY, 'Scale', [[57, 'A3', 30]]),
      named(T0, 'Scale', [[57, 'A3', 12]]),
    ]);
    expect(p.delta).toBeCloseTo(-18, 5);
  });

  test('single-take pieces have no delta; most recent piece first', () => {
    const pieces = pieceProgress([
      named(T0 - 5 * DAY, 'Old piece', [[57, 'A3', 10]]),
      named(T0, 'New piece', [[57, 'A3', 10]]),
    ]);
    expect(pieces.map((p) => p.name)).toEqual(['New piece', 'Old piece']);
    expect(pieces[0].delta).toBeNull();
  });
});

describe('pickDrills', () => {
  const tendencies = aggregateTendencies([
    session(T0, [
      [50, 'D3', 20], [50, 'D3', 22], [50, 'D3', 18],
      [52, 'E3', -30], [52, 'E3', -32], [52, 'E3', -28],
      [55, 'G3', 8], [55, 'G3', 7], [55, 'G3', 9],
      [57, 'A3', 1], [57, 'A3', 0], [57, 'A3', -1],
    ]),
  ]);

  test('picks the strongest habits, worst first, skipping centered notes', () => {
    const drills = pickDrills(tendencies, 3);
    expect(drills.map((d) => d.midi)).toEqual([52, 50, 55]);
  });

  test('caps at n', () => {
    expect(pickDrills(tendencies, 1).map((d) => d.midi)).toEqual([52]);
  });

  test('empty when everything is centered', () => {
    const centered = aggregateTendencies([
      session(T0, [[57, 'A3', 1], [57, 'A3', 2], [57, 'A3', 0]]),
    ]);
    expect(pickDrills(centered)).toEqual([]);
  });
});
