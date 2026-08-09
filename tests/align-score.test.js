import { describe, test, expect } from 'vitest';
import { alignScore } from '../src/analysis/align-score.js';

// C major, one note a beat.
function scoreNotes(midis, { pass = 0, from = 0 } = {}) {
  return midis.map((midi, i) => ({
    id: `n${from + i}`,
    midi,
    onsetBeats: from + i,
    durBeats: 1,
    measure: Math.floor((from + i) / 4) + 1,
    pass,
  }));
}

function playedNotes(midis, { start = 0, step = 0.5 } = {}) {
  return midis.map((midi, i) => ({
    midi,
    cents: 0,
    start: start + i * step,
    end: start + i * step + step * 0.8,
  }));
}

const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

function verdicts(result) {
  return result.attempts.map((a) => a.verdict);
}

describe('alignScore', () => {
  test('a clean run matches every note in order', () => {
    const score = scoreNotes(SCALE);
    const result = alignScore(playedNotes(SCALE), score);
    expect(result.matched).toBe(8);
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
    expect(result.attempts.map((a) => a.played.midi)).toEqual(SCALE);
    expect(result.attempts.map((a) => a.scoreNoteId)).toEqual(score.map((n) => n.id));
  });

  test('the played note is carried through so the page can be coloured', () => {
    const played = playedNotes(SCALE).map((n, i) => ({ ...n, cents: i * 3 }));
    const result = alignScore(played, scoreNotes(SCALE));
    expect(result.attempts.map((a) => a.played.cents)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });

  test('a wrong note is reported on the note it was meant to be', () => {
    const played = playedNotes([60, 62, 63, 65, 67, 69, 71, 72]);
    const result = alignScore(played, scoreNotes(SCALE));
    expect(verdicts(result)).toEqual(['match', 'match', 'wrong', 'match', 'match', 'match', 'match', 'match']);
    expect(result.attempts[2].played.midi).toBe(63);
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
  });

  test('an octave slip is its own verdict, not a wrong note', () => {
    const played = playedNotes([60, 62, 76, 65, 67, 69, 71, 72]);
    const result = alignScore(played, scoreNotes(SCALE));
    expect(result.attempts[2].verdict).toBe('octave');
  });

  test('a skipped note is missed and the rest still line up', () => {
    const played = playedNotes([60, 62, 65, 67, 69, 71, 72]);
    const result = alignScore(played, scoreNotes(SCALE));
    expect(verdicts(result)).toEqual(['match', 'match', 'missed', 'match', 'match', 'match', 'match', 'match']);
    expect(result.attempts[2].played).toBeNull();
    expect(result.missed).toBe(1);
    expect(result.matched).toBe(7);
  });

  test('a stray squeak is left out rather than shifting everything after it', () => {
    const played = playedNotes([60, 62, 64, 88, 65, 67, 69, 71, 72]);
    const result = alignScore(played, scoreNotes(SCALE));
    expect(verdicts(result)).toEqual(Array(8).fill('match'));
    expect(result.extra).toBe(1);
    expect(result.extras[0].midi).toBe(88);
  });

  test('a false start plays the opening twice and the score is still matched once', () => {
    const played = playedNotes([60, 62, 60, 62, 64, 65, 67, 69, 71, 72]);
    const result = alignScore(played, scoreNotes(SCALE));
    expect(result.matched).toBe(8);
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(2);
  });

  test('stopping half way leaves the rest missed, not mangled', () => {
    const result = alignScore(playedNotes([60, 62, 64, 65]), scoreNotes(SCALE));
    expect(verdicts(result)).toEqual(['match', 'match', 'match', 'match', 'missed', 'missed', 'missed', 'missed']);
    expect(result.matched).toBe(4);
  });

  test('an empty take misses everything and crashes nothing', () => {
    const result = alignScore([], scoreNotes(SCALE));
    expect(result.matched).toBe(0);
    expect(result.missed).toBe(8);
    expect(verdicts(result)).toEqual(Array(8).fill('missed'));
  });

  test('a take with no score to match against is refused', () => {
    expect(() => alignScore(playedNotes(SCALE), [])).toThrow(/no notes/i);
  });
});

describe('alignScore — repeats', () => {
  const REPEATED = [...scoreNotes([60, 62], { pass: 0 }), ...scoreNotes([60, 62], { pass: 1, from: 2 })];

  test('taking the repeat matches both passes', () => {
    const result = alignScore(playedNotes([60, 62, 60, 62]), REPEATED);
    expect(verdicts(result)).toEqual(['match', 'match', 'match', 'match']);
    expect(result.attempts.map((a) => a.pass)).toEqual([0, 0, 1, 1]);
  });

  test('skipping the repeat is not the same as missing the notes', () => {
    const result = alignScore(playedNotes([60, 62]), REPEATED);
    expect(verdicts(result)).toEqual(['match', 'match', 'not-taken', 'not-taken']);
    expect(result.missed).toBe(0);
    expect(result.matched).toBe(2);
  });

  test('a repeat played but fumbled is still counted as taken', () => {
    const result = alignScore(playedNotes([60, 62, 60, 63]), REPEATED);
    expect(verdicts(result)).toEqual(['match', 'match', 'match', 'wrong']);
    expect(result.missed).toBe(0);
  });
});

describe('alignScore — at practice length', () => {
  // This project has been caught once already by testing at demo length: every
  // take was 8-16 s until someone recorded ten minutes and the report opened at
  // 10 fps. A movement with the repeats expanded, played through, is thousands
  // of notes against thousands of notes, and this runs on a phone the moment
  // Stop is pressed.
  test('a movement-length take aligns correctly and quickly', () => {
    const N = 3000;
    const score = Array.from({ length: N }, (_, i) => ({
      id: `n${i}`, midi: 55 + (i % 24), onsetBeats: i, durBeats: 1, measure: (i >> 2) + 1, pass: 0,
    }));
    const played = score.map((n) => ({ midi: n.midi, cents: 0, start: n.onsetBeats * 0.4, end: n.onsetBeats * 0.4 + 0.3 }));
    played[1500] = { ...played[1500], midi: played[1500].midi + 1 }; // one wrong note, deep in
    played.splice(2000, 1); // and one skipped

    const started = performance.now();
    const result = alignScore(played, score);
    const elapsed = performance.now() - started;

    expect(result.attempts[1500].verdict).toBe('wrong');
    expect(result.attempts[2000].verdict).toBe('missed');
    expect(result.matched).toBe(N - 1);
    expect(result.extra).toBe(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('alignScore — attempts on the page', () => {
  test('both passes of a repeated notehead are grouped under one id', () => {
    const score = [
      { id: 'a', midi: 60, onsetBeats: 0, durBeats: 1, measure: 1, pass: 0 },
      { id: 'a', midi: 60, onsetBeats: 1, durBeats: 1, measure: 1, pass: 1 },
    ];
    const result = alignScore(playedNotes([60, 61]), score);
    const byId = result.byNote.get('a');
    expect(byId).toHaveLength(2);
    expect(byId.map((a) => a.verdict)).toEqual(['match', 'wrong']);
    expect(result.latest.get('a').verdict).toBe('wrong');
  });
});
