import { describe, test, expect } from 'vitest';
import { scoreTiming } from '../src/analysis/score-timing.js';

// A run of quarter notes played at an exact tempo, as the aligner would hand
// them over: score note beats paired with when they actually sounded.
function attempts(count, timeAt, { beatStep = 1 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    scoreNoteId: `n${i}`,
    pass: 0,
    verdict: 'match',
    score: { id: `n${i}`, midi: 60, onsetBeats: i * beatStep, durBeats: beatStep, measure: Math.floor(i / 4) + 1 },
    played: { midi: 60, cents: 0, start: timeAt(i), end: timeAt(i) + 0.4 },
  }));
}

const steady = (spb) => (i) => i * spb;

describe('scoreTiming', () => {
  test('an exact performance reads its tempo back', () => {
    const result = scoreTiming(attempts(16, steady(0.5)));
    expect(result.bpm).toBeCloseTo(120, 6);
    expect(result.perNote.every((n) => n.verdict === 'on')).toBe(true);
    expect(Math.max(...result.perNote.map((n) => Math.abs(n.deviationMs)))).toBeLessThan(1);
  });

  test('half the tempo is half the tempo', () => {
    expect(scoreTiming(attempts(8, steady(1))).bpm).toBeCloseTo(60, 6);
  });

  test('one late note is late and its neighbours are not', () => {
    const late = attempts(16, (i) => i * 0.5 + (i === 8 ? 0.2 : 0));
    const result = scoreTiming(late);
    expect(result.perNote[8].verdict).toBe('late');
    expect(result.perNote[8].deviationMs).toBeCloseTo(200, 0);
    expect(result.perNote.filter((n) => n.verdict !== 'on')).toHaveLength(1);
  });

  test('one rushed note is early', () => {
    const result = scoreTiming(attempts(16, (i) => i * 0.5 - (i === 5 ? 0.15 : 0)));
    expect(result.perNote[5].verdict).toBe('early');
    expect(result.perNote[5].deviationMs).toBeCloseTo(-150, 0);
  });

  test('a note held too long shows in the next note, not this one', () => {
    // Everything after note 4 arrives a beat-fraction late: that is one late
    // entry, not eleven.
    const result = scoreTiming(attempts(16, (i) => i * 0.5 + (i > 4 ? 0.18 : 0)));
    expect(result.perNote[5].verdict).toBe('late');
    expect(result.perNote.filter((n) => n.verdict === 'late')).toHaveLength(1);
  });

  test('a phrase that moves and stays moved is measured from where it landed', () => {
    // Come in late at note 8 and carry on from there: one late entry, and the
    // seven notes after it are played correctly relative to it.
    const result = scoreTiming(attempts(16, (i) => i * 0.5 + (i >= 8 ? 0.2 : 0)));
    expect(result.perNote[8].verdict).toBe('late');
    expect(result.perNote[8].deviationMs).toBeCloseTo(200, 0);
    expect(result.perNote.slice(9).every((n) => n.verdict === 'on')).toBe(true);
    expect(result.perNote.filter((n) => n.verdict === 'late')).toHaveLength(1);
  });

  test('a steady accelerando is one tempo change, not fifty late notes', () => {
    // 0.6 s a beat shortening to 0.4 across the take.
    let t = 0;
    const times = [];
    for (let i = 0; i < 24; i++) {
      times.push(t);
      t += 0.6 - (0.2 * i) / 23;
    }
    const result = scoreTiming(attempts(24, (i) => times[i]));
    expect(result.perNote.filter((n) => n.verdict !== 'on').length).toBeLessThanOrEqual(2);
    expect(result.curve[0].bpm).toBeLessThan(result.curve[result.curve.length - 1].bpm);
    expect(result.driftBpm).toBeGreaterThan(20);
  });

  test('missed notes have no timing and do not sink the fit', () => {
    const all = attempts(16, steady(0.5));
    all[6] = { ...all[6], verdict: 'missed', played: null };
    const result = scoreTiming(all);
    expect(result.bpm).toBeCloseTo(120, 6);
    expect(result.perNote[6].deviationMs).toBeNull();
    expect(result.perNote[6].verdict).toBe('missed');
  });

  test('a pause in the middle does not become the tempo', () => {
    const result = scoreTiming(attempts(20, (i) => i * 0.5 + (i >= 10 ? 6 : 0)));
    expect(result.bpm).toBeCloseTo(120, 4);
  });

  test('the tolerance is what counts as on the beat', () => {
    const nudged = attempts(16, (i) => i * 0.5 + (i === 8 ? 0.06 : 0));
    expect(scoreTiming(nudged).perNote[8].verdict).toBe('late');
    expect(scoreTiming(nudged, { toleranceMs: 100 }).perNote[8].verdict).toBe('on');
  });

  test('too little to read a tempo from says so rather than inventing one', () => {
    expect(scoreTiming(attempts(1, steady(0.5))).bpm).toBeNull();
    expect(scoreTiming([]).bpm).toBeNull();
    expect(scoreTiming([]).perNote).toEqual([]);
  });

  test('the worst notes come back ranked so the panel has something to point at', () => {
    const result = scoreTiming(attempts(16, (i) => i * 0.5 + (i === 3 ? 0.3 : i === 9 ? -0.2 : 0)));
    expect(result.worst.map((n) => n.index)).toEqual([3, 9]);
    expect(result.worst[0].deviationMs).toBeCloseTo(300, 0);
  });
});
