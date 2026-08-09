import { describe, test, expect } from 'vitest';
import { reconcile } from '../src/analysis/score-map.js';

// Our parser and the engraver read the same file independently, and they
// disagree on purpose: we drop chord members, skip second voices, collapse
// ties and give grace notes no duration. Matching the two lists by position
// would therefore put annotations on the wrong noteheads the moment a score
// contains any of those — which is every real score. So they are matched by
// what the notes ARE.

const parsed = (measure, beatInMeasure, midi, id = `${measure}-${beatInMeasure}-${midi}`) =>
  ({ id, measure, beatInMeasure, midi });

const engraved = (measure, beatInMeasure, midi, ref) =>
  ({ measure, beatInMeasure, midi, ref });

describe('reconcile', () => {
  test('matches notes by where and what they are, not by position', () => {
    const score = [parsed(1, 0, 60), parsed(1, 1, 62), parsed(2, 0, 64)];
    const page = [
      engraved(1, 0, 60, 'a'), engraved(1, 0, 48, 'chord-member'),
      engraved(1, 1, 62, 'b'), engraved(2, 0, 64, 'c'),
    ];
    const { map, ok, unmatched } = reconcile(score, page);
    expect(ok).toBe(true);
    expect(unmatched).toEqual([]);
    expect([...map.values()].map((g) => g.ref)).toEqual(['a', 'b', 'c']);
  });

  test('an extra voice on the page does not steal a match', () => {
    const score = [parsed(1, 0, 72)];
    const page = [engraved(1, 0, 48, 'lower-voice'), engraved(1, 0, 72, 'ours')];
    expect(reconcile(score, page).map.get(score[0].id).ref).toBe('ours');
  });

  test('both passes of a repeat share the one notehead', () => {
    const score = [
      { id: 'x', measure: 1, beatInMeasure: 0, midi: 60, pass: 0 },
      { id: 'x', measure: 1, beatInMeasure: 0, midi: 60, pass: 1 },
    ];
    const { map, ok } = reconcile(score, [engraved(1, 0, 60, 'a')]);
    expect(ok).toBe(true);
    expect(map.size).toBe(1);
    expect(map.get('x').ref).toBe('a');
  });

  test('two of the same note in a bar are told apart by their beat', () => {
    const score = [parsed(1, 0, 60, 'first'), parsed(1, 2, 60, 'second')];
    const page = [engraved(1, 2, 60, 'later'), engraved(1, 0, 60, 'earlier')];
    const { map } = reconcile(score, page);
    expect(map.get('first').ref).toBe('earlier');
    expect(map.get('second').ref).toBe('later');
  });

  test('beats that differ only by rounding still match', () => {
    const score = [parsed(1, 1 / 3, 60, 'triplet')];
    const page = [engraved(1, 0.33333333333, 60, 'a')];
    expect(reconcile(score, page).map.get('triplet').ref).toBe('a');
  });

  test('a note the page has no notehead for is reported, not guessed at', () => {
    const score = [parsed(1, 0, 60, 'here'), parsed(9, 0, 99, 'nowhere')];
    const { map, ok, unmatched } = reconcile(score, [engraved(1, 0, 60, 'a')]);
    expect(ok).toBe(false);
    expect(unmatched).toEqual(['nowhere']);
    expect(map.has('nowhere')).toBe(false);
    expect(map.get('here').ref).toBe('a');
  });

  test('one notehead is never claimed by two different notes', () => {
    const score = [parsed(1, 0, 60, 'one'), parsed(1, 0, 60, 'two')];
    const { map, ok, unmatched } = reconcile(score, [engraved(1, 0, 60, 'a')]);
    expect(map.get('one').ref).toBe('a');
    expect(ok).toBe(false);
    expect(unmatched).toEqual(['two']);
  });

  test('nothing to match against is a clean failure', () => {
    expect(reconcile([parsed(1, 0, 60, 'x')], []).ok).toBe(false);
    expect(reconcile([], [engraved(1, 0, 60, 'a')]).ok).toBe(true);
  });
});
