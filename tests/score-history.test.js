import { describe, test, expect } from 'vitest';
import { takeStats, compareTakes, takeHistory } from '../src/analysis/score-history.js';

// Attempts as alignScore hands them over, with a timing report alongside.
function attempt(id, measure, cents, { deviationMs = 0, played = true } = {}) {
  return {
    scoreNoteId: id,
    pass: 0,
    verdict: played ? 'match' : 'missed',
    score: { id, midi: 60, measure, onsetBeats: 0, durBeats: 1 },
    played: played ? { midi: 60, cents, start: measure, end: measure + 0.4 } : null,
    deviationMs,
  };
}

const TAKE = [
  attempt('a', 1, 2), attempt('b', 1, -4),
  attempt('c', 2, 20), attempt('d', 2, -30),
];

const timingFor = (list) => ({
  perNote: list.map((a) => ({
    scoreNoteId: a.scoreNoteId,
    deviationMs: a.played ? a.deviationMs : null,
    verdict: !a.played ? 'missed' : 'on',
  })),
});

describe('takeStats', () => {
  test('summarises a take note by note', () => {
    const stats = takeStats(TAKE, timingFor(TAKE));
    expect(stats.noteCount).toBe(4);
    expect(stats.played).toBe(4);
    expect(stats.absMeanCents).toBeCloseTo((2 + 4 + 20 + 30) / 4, 6);
    expect(stats.perNote.map((n) => n.scoreNoteId)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('notes that never sounded are counted as missed, not as in tune', () => {
    const take = [...TAKE, attempt('e', 3, 0, { played: false })];
    const stats = takeStats(take, timingFor(take));
    expect(stats.noteCount).toBe(5);
    expect(stats.played).toBe(4);
    expect(stats.missed).toBe(1);
    expect(stats.absMeanCents).toBeCloseTo(14, 6); // the four that sounded
  });

  test('the tempo it was measured against travels with it', () => {
    expect(takeStats(TAKE, timingFor(TAKE), { targetBpm: 104 }).targetBpm).toBe(104);
    expect(takeStats(TAKE, timingFor(TAKE)).targetBpm).toBeNull();
  });

  test('a take with nothing played is nothing to store', () => {
    expect(takeStats([], null)).toBeNull();
    expect(takeStats([attempt('a', 1, 0, { played: false })], null)).toBeNull();
  });
});

describe('compareTakes', () => {
  const before = { absMeanCents: 20, meanAbsMs: 60, targetBpm: null, perNote: [
    { scoreNoteId: 'c', cents: 20, deviationMs: 10 },
    { scoreNoteId: 'd', cents: -30, deviationMs: 0 },
    { scoreNoteId: 'e', cents: 6, deviationMs: 0 },
  ] };

  test('says how much better or worse, overall and per note', () => {
    const now = { absMeanCents: 12, meanAbsMs: 40, targetBpm: null, perNote: [
      { scoreNoteId: 'c', cents: 4, deviationMs: 5 },
      { scoreNoteId: 'd', cents: -28, deviationMs: 0 },
      { scoreNoteId: 'e', cents: 14, deviationMs: 0 },
    ] };
    const diff = compareTakes(now, before);
    expect(diff.centsDelta).toBeCloseTo(-8, 6);
    expect(diff.improved).toBe(true);
    const byId = new Map(diff.perNote.map((n) => [n.scoreNoteId, n]));
    expect(byId.get('c').delta).toBeCloseTo(-16, 6);
    expect(byId.get('c').verdict).toBe('better');
    expect(byId.get('d').verdict).toBe('same');   // 30 → 28 is noise
    expect(byId.get('e').verdict).toBe('worse');  // 6 → 14
    expect(diff.better).toBe(1);
    expect(diff.worse).toBe(1);
  });

  test('a note with no counterpart last time is left out', () => {
    const now = { absMeanCents: 10, targetBpm: null, perNote: [
      { scoreNoteId: 'c', cents: 4 }, { scoreNoteId: 'zz', cents: 50 },
    ] };
    expect(compareTakes(now, before).perNote.map((n) => n.scoreNoteId)).toEqual(['c']);
  });

  test('timing is only compared when both were measured the same way', () => {
    const own = { absMeanCents: 10, meanAbsMs: 20, targetBpm: null, perNote: [] };
    const against = { absMeanCents: 10, meanAbsMs: 90, targetBpm: 104, perNote: [] };
    expect(compareTakes(against, own).msDelta).toBeNull();
    expect(compareTakes(own, own).msDelta).toBeCloseTo(0, 6);
    expect(compareTakes(against, { ...against, meanAbsMs: 60 }).msDelta).toBeCloseTo(30, 6);
  });

  test('nothing to compare against is not a comparison', () => {
    expect(compareTakes({ absMeanCents: 5, perNote: [] }, null)).toBeNull();
  });
});

describe('takeHistory', () => {
  const records = [
    { date: 300, scoreStats: { absMeanCents: 12 } },
    { date: 100, scoreStats: { absMeanCents: 22 } },
    { date: 200, scoreStats: { absMeanCents: 18 } },
  ];

  test('puts the takes in order and measures the whole journey', () => {
    const history = takeHistory(records);
    expect(history.takes.map((t) => t.date)).toEqual([100, 200, 300]);
    expect(history.series).toEqual([22, 18, 12]);
    expect(history.first).toBe(22);
    expect(history.latest).toBe(12);
    expect(history.best).toBe(12);
    expect(history.sinceFirst).toBeCloseTo(-10, 6);
    expect(history.sinceLast).toBeCloseTo(-6, 6);
  });

  test('takes with no score stats are not part of the history', () => {
    const history = takeHistory([...records, { date: 400 }]);
    expect(history.takes).toHaveLength(3);
  });

  test('one take has a latest but nothing to compare it with', () => {
    const history = takeHistory([records[0]]);
    expect(history.latest).toBe(12);
    expect(history.sinceLast).toBeNull();
  });

  test('no takes at all is an empty history, not a crash', () => {
    expect(takeHistory([]).takes).toEqual([]);
    expect(takeHistory([]).latest).toBeNull();
  });
});
