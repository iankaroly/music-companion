import { describe, test, expect } from 'vitest';
import { combScore, combPeaks } from '../src/analysis/scan-read.js';

// A strip's profile: for each row, the fraction of that strip's columns that
// are inked. A stave is five inked rows with clear gaps between them.
function staffProfile({ height = 200, top = 50, step = 12, ink = 1 } = {}) {
  const p = new Float32Array(height);
  for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = ink;
  return p;
}

function pageProfile({ height = 600, tops = [50, 250, 450], step = 12 } = {}) {
  const p = new Float32Array(height);
  for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
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

describe('combPeaks', () => {
  test('one peak per stave, in reading order', () => {
    const found = combPeaks(pageProfile(), 12);
    expect(found.map((c) => c.y0)).toEqual([50, 250, 450]);
  });

  test('a stave is found once, not at every offset that partly fits', () => {
    // Without a wide enough suppression window, a comb locks onto lines 2-5
    // plus a ledger line and reports a second stave a few spaces away.
    const found = combPeaks(pageProfile({ tops: [50] }), 12);
    expect(found).toHaveLength(1);
  });

  test('the spacing is refined, not assumed', () => {
    const found = combPeaks(pageProfile({ tops: [50], step: 13 }), 12);
    expect(found).toHaveLength(1);
    expect(found[0].step).toBeCloseTo(13, 1);
  });

  test('ink that is not a grid is not a stave', () => {
    // Deliberately NOT a periodic texture. Ink on every third row is a grid,
    // and the comb says so — rightly, because the refined spacing can land on
    // a multiple of it. That case cannot arise on a page: pageScale measures
    // the commonest run of white, so a texture that regular would BE the
    // page's spacing and the comb would be looking for it at its own period.
    // What has to be rejected is ink with no vertical structure at all.
    const noise = (amplitude) => {
      const p = new Float32Array(600);
      let seed = 7;
      for (let y = 0; y < 600; y++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        p[y] = (seed / 2147483648) * amplitude;
      }
      return p;
    };
    // Paper texture and print show-through, which is what a blank margin
    // actually looks like: nothing to find.
    expect(combPeaks(noise(0.15), 12)).toHaveLength(0);

    // And the limit, written down rather than hidden: heavy random ink CAN
    // answer, because the best of thirteen spacings over six hundred offsets
    // beats the floor by chance. It answers weakly, and it answers in a
    // different place in every strip — which is why trackCombs makes a stave
    // cross half the page before it believes in it.
    for (const c of combPeaks(noise(0.6), 12)) expect(c.score).toBeLessThan(0.6);
  });
});
