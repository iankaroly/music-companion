import { describe, test, expect } from 'vitest';
import {
  passageRange, passageAttempt, comparePassages, passageHistory,
} from '../src/analysis/score-passages.js';

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
  attempt('e', 3, 6), attempt('f', 3, 40),
];

const timingFor = (list) => ({
  perNote: list.map((a) => ({
    scoreNoteId: a.scoreNoteId,
    deviationMs: a.played ? a.deviationMs : null,
    verdict: !a.played ? 'missed' : Math.abs(a.deviationMs) <= 50 ? 'on' : a.deviationMs > 0 ? 'late' : 'early',
  })),
});

describe('passageRange', () => {
  test('takes the notes inside a bar range, inclusive at both ends', () => {
    expect(passageRange(TAKE, 2, 3).map((a) => a.scoreNoteId)).toEqual(['c', 'd', 'e', 'f']);
    expect(passageRange(TAKE, 1, 1).map((a) => a.scoreNoteId)).toEqual(['a', 'b']);
  });

  test('a range with nothing in it is empty rather than an error', () => {
    expect(passageRange(TAKE, 9, 12)).toEqual([]);
  });

  test('the bars can be given the wrong way round', () => {
    expect(passageRange(TAKE, 3, 2).map((a) => a.scoreNoteId)).toEqual(['c', 'd', 'e', 'f']);
  });
});

describe('passageAttempt', () => {
  test('summarises one attempt at the bars, note by note', () => {
    const stats = passageAttempt(TAKE, timingFor(TAKE), 2, 3);
    expect(stats.fromMeasure).toBe(2);
    expect(stats.toMeasure).toBe(3);
    expect(stats.noteCount).toBe(4);
    expect(stats.absMeanCents).toBeCloseTo((20 + 30 + 6 + 40) / 4, 6);
    expect(stats.perNote.map((n) => n.scoreNoteId)).toEqual(['c', 'd', 'e', 'f']);
    expect(stats.perNote[0].cents).toBe(20);
  });

  test('notes that never sounded are counted as missed, not as in tune', () => {
    const take = [...TAKE, attempt('g', 3, 0, { played: false })];
    const stats = passageAttempt(take, timingFor(take), 3, 3);
    expect(stats.noteCount).toBe(3);
    expect(stats.played).toBe(2);
    expect(stats.missed).toBe(1);
    expect(stats.absMeanCents).toBeCloseTo(23, 6); // 6 and 40 only
  });

  test('bars with nothing played give nothing to store', () => {
    expect(passageAttempt(TAKE, timingFor(TAKE), 9, 10)).toBeNull();
  });
});

describe('comparePassages', () => {
  const before = { absMeanCents: 20, meanAbsMs: 60, perNote: [
    { scoreNoteId: 'c', cents: 20, deviationMs: 10 },
    { scoreNoteId: 'd', cents: -30, deviationMs: 0 },
    { scoreNoteId: 'e', cents: 6, deviationMs: 0 },
  ] };

  test('says how much better or worse, overall and per note', () => {
    const now = { absMeanCents: 12, meanAbsMs: 40, perNote: [
      { scoreNoteId: 'c', cents: 4, deviationMs: 5 },
      { scoreNoteId: 'd', cents: -28, deviationMs: 0 },
      { scoreNoteId: 'e', cents: 14, deviationMs: 0 },
    ] };
    const diff = comparePassages(now, before);
    expect(diff.centsDelta).toBeCloseTo(-8, 6); // 8 cents closer on average
    expect(diff.improved).toBe(true);
    const byId = new Map(diff.perNote.map((n) => [n.scoreNoteId, n]));
    expect(byId.get('c').delta).toBeCloseTo(-16, 6);  // 20 off → 4 off
    expect(byId.get('c').verdict).toBe('better');
    expect(byId.get('d').verdict).toBe('same');       // 30 → 28 is noise
    expect(byId.get('e').verdict).toBe('worse');      // 6 → 14
  });

  test('a note that has no counterpart last time is left out of the comparison', () => {
    const now = { absMeanCents: 10, meanAbsMs: 10, perNote: [
      { scoreNoteId: 'c', cents: 4, deviationMs: 0 },
      { scoreNoteId: 'zz', cents: 50, deviationMs: 0 },
    ] };
    const diff = comparePassages(now, before);
    expect(diff.perNote.map((n) => n.scoreNoteId)).toEqual(['c']);
  });

  test('timing is only compared when both were measured the same way', () => {
    // Against a target the deviation is from a fixed grid; without one it is
    // from the player's own pulse. Subtracting one from the other invents a
    // change that never happened.
    const own = { absMeanCents: 10, meanAbsMs: 20, targetBpm: null, perNote: [] };
    const against = { absMeanCents: 10, meanAbsMs: 90, targetBpm: 100, perNote: [] };
    expect(comparePassages(against, own).msDelta).toBeNull();
    expect(comparePassages(own, own).msDelta).toBeCloseTo(0, 6);
    expect(comparePassages(against, { ...against, meanAbsMs: 60 }).msDelta).toBeCloseTo(30, 6);
  });

  test('nothing to compare against is not a comparison', () => {
    expect(comparePassages({ absMeanCents: 5, perNote: [] }, null)).toBeNull();
  });
});

describe('passageHistory', () => {
  const records = [
    { date: 300, stats: { absMeanCents: 12, noteCount: 4 } },
    { date: 100, stats: { absMeanCents: 22, noteCount: 4 } },
    { date: 200, stats: { absMeanCents: 18, noteCount: 4 } },
  ];

  test('puts the attempts in order and measures the whole journey', () => {
    const history = passageHistory(records);
    expect(history.attempts.map((a) => a.date)).toEqual([100, 200, 300]);
    expect(history.series).toEqual([22, 18, 12]);
    expect(history.first).toBe(22);
    expect(history.latest).toBe(12);
    expect(history.sinceFirst).toBeCloseTo(-10, 6);
    expect(history.sinceLast).toBeCloseTo(-6, 6);
    expect(history.best).toBe(12);
  });

  test('one attempt has a latest but nothing to compare it with', () => {
    const history = passageHistory([records[0]]);
    expect(history.latest).toBe(12);
    expect(history.sinceLast).toBeNull();
    expect(history.sinceFirst).toBeNull();
  });

  test('no attempts at all is an empty history, not a crash', () => {
    expect(passageHistory([]).attempts).toEqual([]);
    expect(passageHistory([]).latest).toBeNull();
  });
});
