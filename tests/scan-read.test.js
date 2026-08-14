import { describe, test, expect } from 'vitest';
import { combScore } from '../src/analysis/scan-read.js';

// A strip's profile: for each row, the fraction of that strip's columns that
// are inked. A stave is five inked rows with clear gaps between them.
function staffProfile({ height = 200, top = 50, step = 12, ink = 1 } = {}) {
  const p = new Float32Array(height);
  for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = ink;
  return p;
}

describe('combScore', () => {
  test('a five-line grid at the right place and spacing scores high', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBeCloseTo(1, 5);
  });

  test('the same grid half a space out scores nothing', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 56, 12)).toBeLessThan(0.3);
  });

  test('a solid black band does not answer: the gaps must be clear', () => {
    const p = new Float32Array(200).fill(1);
    expect(combScore(p, 50, 12)).toBeCloseTo(0, 5);
  });

  test('four lines of five still score well — the point of the comb', () => {
    const p = staffProfile({ top: 50, step: 12 });
    p[Math.round(50 + 2 * 12)] = 0;          // the middle line is lost to a beam
    expect(combScore(p, 50, 12)).toBeGreaterThan(0.75);
  });

  test('a comb that runs off the page is not a comb', () => {
    const p = staffProfile({ height: 60, top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBe(-1);
    expect(combScore(p, -4, 12)).toBe(-1);
  });
});
