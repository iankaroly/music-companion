import { describe, test, expect } from 'vitest';
import {
  combScore, combPeaks, trackCombs, fillMissedStaves,
} from '../src/analysis/scan-read.js';

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

// One stave, sagging gently across the page the way a photographed one does.
function sagging(strips = 40, from = 100, drop = 8) {
  return Array.from({ length: strips }, (_, s) => [
    { y0: from + (drop * s) / strips, step: 12, score: 1 },
  ]);
}

describe('trackCombs', () => {
  test('a stave that crosses the page is one stave, sampled per strip', () => {
    const staves = trackCombs(sagging(), 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0).toHaveLength(40);
    expect(staves[0].y0[0]).toBeCloseTo(100, 1);
    expect(staves[0].y0[39]).toBeCloseTo(107.8, 1);
  });

  test('a gap of a few strips is carried across, not a second stave', () => {
    const perStrip = sagging();
    perStrip[10] = [];
    perStrip[11] = [];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0[10]).toBeGreaterThan(100);
    expect(staves[0].y0[10]).toBeLessThan(108);
  });

  test('something that answers in a corner only is not a stave', () => {
    const perStrip = sagging();
    for (let s = 0; s < 5; s++) perStrip[s] = [...perStrip[s], { y0: 300, step: 12, score: 1 }];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
  });

  test('two staves stay two staves, top first', () => {
    const perStrip = sagging().map((c, s) => [...c, { y0: 300 + s * 0.1, step: 12, score: 1 }]);
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(2);
    expect(staves[0].y0[0]).toBeLessThan(staves[1].y0[0]);
  });
});

// A page of evenly spaced systems, as profiles, one per strip.
function pageStrips({ strips = 40, tops = [100, 260, 420, 580], step = 12, height = 800 } = {}) {
  return Array.from({ length: strips }, () => {
    const p = new Float32Array(height);
    for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
    return p;
  });
}

describe('fillMissedStaves', () => {
  test('a system missed in the middle is put back', () => {
    const profiles = pageStrips();                       // four systems on the page
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );                                                   // …but the reader saw three
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled).toHaveLength(4);
    expect(filled[1].y0[0]).toBeCloseTo(260, 0);
  });

  test('a system missed at the foot of the page is put back', () => {
    const profiles = pageStrips();
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => c.y0 < 500)), 12,
    );
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled.map((s) => Math.round(s.y0[0]))).toEqual([100, 260, 420, 580]);
  });

  test('nothing is invented where the page has no ink', () => {
    // Three real systems and blank paper below them: prediction must not
    // manufacture a fourth out of an empty margin.
    const profiles = pageStrips({ tops: [100, 260, 420], height: 800 });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(3);
  });

  test('fewer than three staves is not a rhythm worth extrapolating', () => {
    const profiles = pageStrips({ tops: [100, 260] });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(2);
  });
});
