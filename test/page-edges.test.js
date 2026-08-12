import { describe, it, expect } from 'vitest';
import { findPage, homography, through, rectFor } from '../src/analysis/page-edges.js';

// A photograph, as luma: a dark table with a bright quadrilateral of paper on
// it, tilted the way a phone held over a book tilts it.
function photograph(w, h, quad, { table = 40, paper = 220, ink = true } = {}) {
  const luma = new Float32Array(w * h);
  const inside = (x, y) => {
    let hits = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      if ((a[1] > y) !== (b[1] > y)
        && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hits++;
    }
    return hits % 2 === 1;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let value = table;
      if (inside(x + 0.5, y + 0.5)) {
        value = paper;
        // staves, so the paper is not a flat white slab
        if (ink && y % 9 === 0 && x > 8 && x < w - 8) value = 60;
      }
      luma[y * w + x] = value;
    }
  }
  return luma;
}

const W = 160;
const H = 210;
const TILTED = [[14, 20], [146, 12], [150, 196], [10, 190]];

describe('finding the sheet of paper', () => {
  it('finds a tilted page on a dark table, corners in reading order', () => {
    const quad = findPage(photograph(W, H, TILTED), W, H);
    expect(quad).not.toBeNull();
    const [tl, tr, br, bl] = quad.map(([x, y]) => [x * W, y * H]);
    expect(tl[0]).toBeLessThan(tr[0]);
    expect(bl[0]).toBeLessThan(br[0]);
    expect(tl[1]).toBeLessThan(bl[1]);
    // and within a few pixels of where the paper actually is
    for (const [i, corner] of [tl, tr, br, bl].entries()) {
      expect(Math.hypot(corner[0] - TILTED[i][0], corner[1] - TILTED[i][1])).toBeLessThan(9);
    }
  });

  it('refuses a frame with no page in it', () => {
    const luma = new Float32Array(W * H).fill(40);
    expect(findPage(luma, W, H)).toBeNull();
  });

  it('refuses two pages of an open book rather than warping both', () => {
    // Left page mostly out of frame, right page in it: one bright region whose
    // corners describe a shape no sheet of paper has.
    const luma = photograph(W, H, [[0, 30], [150, 14], [152, 198], [70, 205]]);
    expect(findPage(luma, W, H)).toBeNull();
  });

  it('refuses a photograph that is already nothing but paper', () => {
    const luma = photograph(W, H, [[0, 0], [W, 0], [W, H], [0, H]]);
    expect(findPage(luma, W, H)).toBeNull();
  });
});

describe('pulling the page square', () => {
  const rect = [[0, 0], [100, 0], [100, 140], [0, 140]];
  const quad = [[20, 30], [180, 10], [190, 240], [10, 220]];

  it('sends the corners of the rectangle to the corners of the page', () => {
    const h = homography(rect, quad);
    expect(h).not.toBeNull();
    for (const [i, corner] of rect.entries()) {
      const [x, y] = through(h, corner[0], corner[1]);
      expect(x).toBeCloseTo(quad[i][0], 6);
      expect(y).toBeCloseTo(quad[i][1], 6);
    }
  });

  it('keeps straight lines straight', () => {
    const h = homography(rect, quad);
    // Three points along one edge of the rectangle stay in line on the page.
    const points = [0, 0.5, 1].map((t) => through(h, t * 100, 70));
    const [a, b, c] = points;
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    expect(area).toBeLessThan(1e-6);
  });

  it('sizes the page from the average of each pair of opposite edges', () => {
    // A page photographed square-on: the answer is simply its own size.
    const square = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.6], [0.1, 0.6]];
    const size = rectFor(square, 1000, 1000);
    expect(size.width).toBe(800);
    expect(size.height).toBe(500);
  });

  it('refuses a degenerate quadrilateral instead of dividing by zero', () => {
    const flat = [[0, 0], [0, 0], [0, 0], [0, 0]];
    expect(homography(rect, flat)).toBeNull();
  });
});
