import { describe, test, expect } from 'vitest';
import { temperamentOffsetCents } from '../src/analysis/temperaments.js';

describe('temperamentOffsetCents', () => {
  test('equal temperament is always zero', () => {
    for (let pc = 0; pc < 12; pc++) {
      expect(temperamentOffsetCents('equal', 0, 60 + pc)).toBe(0);
    }
  });

  test('just intonation: the major third is 13.7 cents flat of equal', () => {
    // root C (pc 0), note E (midi 64)
    expect(temperamentOffsetCents('just', 0, 64)).toBeCloseTo(-13.7, 1);
  });

  test('just intonation: the fifth is 2 cents sharp of equal', () => {
    expect(temperamentOffsetCents('just', 0, 67)).toBeCloseTo(2.0, 1);
  });

  test('pythagorean: the major third is 7.8 cents sharp of equal', () => {
    expect(temperamentOffsetCents('pythagorean', 0, 64)).toBeCloseTo(7.8, 1);
  });

  test('offsets follow the root: E is pure (0) when E itself is the root', () => {
    expect(temperamentOffsetCents('just', 4, 64)).toBe(0);
  });
});
