import { describe, it, expect } from 'vitest';
import {
  findPage, findPages, coverageOf, quadsMoved, homography, through, rectFor,
  aimedPage,
} from '../src/analysis/page-edges.js';

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

// Several sheets in one frame, with music printed on them at a size that goes
// with the PAGE rather than with the picture — which is what a camera does, and
// what makes ink a problem close up and no problem at all at arm's length.
function photographOf(w, h, quads, { table = 40, paper = 220, fold = null } = {}) {
  const luma = new Float32Array(w * h).fill(table);
  for (const quad of quads) {
    const xs = quad.map((p) => p[0]);
    const ys = quad.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const pw = Math.max(...xs) - left;
    const ph = Math.max(...ys) - top;
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
    const space = ph / 44;
    const thick = Math.max(1, Math.round(ph / 110));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const u = (x - left) / pw;
        const v = (y - top) / ph;
        let value = paper;
        const line = Math.round((y - top) / space);
        const onStaff = Math.abs((y - top) - line * space) < thick / 2 && line % 8 < 5 && line > 3;
        if (onStaff && u > 0.1 && u < 0.9) value = 45;
        // a beamed group and a title: solid ink, wider than any closing kernel
        if (v > 0.03 && v < 0.06 && u > 0.25 && u < 0.75) value = 50;
        if (v > 0.3 && v < 0.34 && u > 0.4 && u < 0.6) value = 50;
        luma[y * w + x] = value;
      }
    }
  }
  // The fold of a book: a dark line down the middle, as wide and as deep as
  // asked for. Bright enough and it is a crease the paper survives; dark enough
  // and it cuts the picture into two sheets.
  if (fold) {
    for (let y = fold.top; y < fold.bottom; y++) {
      for (let x = Math.round(fold.at - fold.wide / 2); x < Math.round(fold.at + fold.wide / 2); x++) {
        if (x >= 0 && x < w) luma[y * w + x] = fold.value;
      }
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

  it('refuses half a page hanging off the edge of the frame', () => {
    // One bright region whose corners describe a shape no sheet of paper has.
    const luma = photograph(W, H, [[0, 30], [150, 14], [152, 198], [70, 205]]);
    expect(findPage(luma, W, H)).toBeNull();
  });

  it('refuses a photograph that is already nothing but paper', () => {
    const luma = photograph(W, H, [[0, 0], [W, 0], [W, H], [0, H]]);
    expect(findPage(luma, W, H)).toBeNull();
  });

  // The bug this was written for: the outline only came up with the phone held
  // far enough away that the page was a small bright slab in the middle of the
  // frame, so what got kept was a page at a fraction of the resolution the
  // camera was holding. Close up, the ink is thick enough to cut the bright
  // region into strips, and a page whose corners sit near the picture's own was
  // thrown away as "already nothing but paper".
  it('finds a page held close enough to nearly fill the frame', () => {
    const margin = 0.02;
    const quad = [
      [W * margin, H * margin], [W * (1 - margin), H * margin],
      [W * (1 - margin), H * (1 - margin)], [W * margin, H * (1 - margin)],
    ];
    const found = findPages(photographOf(W, H, [quad]), W, H);
    expect(found).toHaveLength(1);
    expect(coverageOf(found)).toBeGreaterThan(0.85);
  });

  it('finds a page with heavy ink on it, which a close-up page has', () => {
    const quad = [[10, 14], [150, 14], [150, 196], [10, 196]];
    const found = findPages(photographOf(W, H, [quad]), W, H);
    expect(found).toHaveLength(1);
    const [tl, , br] = found[0].map(([x, y]) => [x * W, y * H]);
    expect(Math.hypot(tl[0] - 10, tl[1] - 14)).toBeLessThan(9);
    expect(Math.hypot(br[0] - 150, br[1] - 196)).toBeLessThan(9);
  });

  it('says how much of the frame the page fills, so a distant one can be named', () => {
    const near = findPages(photographOf(W, H, [[[8, 10], [152, 10], [152, 200], [8, 200]]]), W, H);
    const far = findPages(photographOf(W, H, [[[46, 58], [114, 58], [114, 152], [46, 152]]]), W, H);
    expect(coverageOf(near)).toBeGreaterThan(0.75);
    expect(coverageOf(far)).toBeLessThan(0.3);
  });
});

// An open book is the way music actually arrives at a scanner, and two pages
// warped onto one rectangle is a page bent down the middle that no reader can
// follow. Both pages, separately, or it is not worth doing.
describe('an open book', () => {
  const LEFT = [[8, 22], [76, 22], [76, 190], [8, 190]];
  const RIGHT = [[84, 22], [152, 22], [152, 190], [84, 190]];

  it('finds both pages when the fold is dark enough to part them', () => {
    const luma = photographOf(W, H, [LEFT, RIGHT]);
    const found = findPages(luma, W, H);
    expect(found).toHaveLength(2);
    const [left, right] = found;
    expect(left[0][0]).toBeLessThan(right[0][0]);          // left page first
    expect(left[1][0] * W).toBeLessThan(84);               // and it stops at the fold
    expect(right[0][0] * W).toBeGreaterThan(76);
  });

  it('finds both pages when the fold is only a crease', () => {
    // One sheet of paper across the frame with a soft dark seam down it: the
    // book is flat enough that the bright region never comes apart.
    const spread = [[8, 50], [152, 50], [152, 160], [8, 160]];
    const luma = photographOf(W, H, [spread], {
      fold: { at: 80, wide: 6, top: 50, bottom: 160, value: 170 },
    });
    const found = findPages(luma, W, H);
    expect(found).toHaveLength(2);
    const [left, right] = found;
    expect(left[1][0] * W).toBeGreaterThan(70);
    expect(left[1][0] * W).toBeLessThan(90);
    expect(right[0][0] * W).toBeCloseTo(left[1][0] * W, 0);
  });

  it('keeps one wide page in one piece when there is no fold in it', () => {
    const wide = [[8, 40], [152, 40], [152, 168], [8, 168]];
    expect(findPages(photographOf(W, H, [wide]), W, H)).toHaveLength(1);
  });

  // A spread is twice as wide as it is tall and a phone's frame is not, so a
  // book held as close as the frame allows still covers much less of it than a
  // single page does. The scanner's shutter waits for a fraction of the frame to
  // be filled before it lights, and this is what a book can actually offer it:
  // an open spread across almost the whole width of a tall phone frame.
  it('fills enough of a tall frame for the shutter to light on a book', () => {
    const w = 120;
    const h = 260;
    const luma = photographOf(w, h, [
      [[6, 90], [57, 90], [57, 167], [6, 167]],
      [[63, 90], [114, 90], [114, 167], [63, 167]],
    ]);
    const found = findPages(luma, w, h);
    expect(found).toHaveLength(2);
    // FILL_FRAME * FILL_SPREAD in src/ui/scanner.js
    expect(coverageOf(found)).toBeGreaterThan(0.225);
  });

  it('will not hand a spread to a caller that can only keep one page', () => {
    expect(findPage(photographOf(W, H, [LEFT, RIGHT]), W, H)).toBeNull();
  });
});

// The complaint these were written for, in the user's words: the blue outline
// "lights up covering a lot more than just the sheet". A bright thing is not a
// page unless there is music printed on it, and the paper stops where the
// surface under it changes — not where the biggest bright blob does.
describe('stopping at the sheet', () => {
  it('leaves a bright slab with nothing printed on it alone', () => {
    const page = [[8, 20], [80, 20], [80, 190], [8, 190]];
    const luma = photographOf(W, H, [page]);
    // a lit wall down the other side of the frame: bright, blank, and nearly as
    // big as the page
    for (let y = 12; y < 198; y++) {
      for (let x = 100; x < 154; x++) luma[y * W + x] = 210;
    }
    const found = findPages(luma, W, H);
    expect(found).toHaveLength(1);
    expect(found[0][1][0] * W).toBeLessThan(96);
  });

  it('stops at the paper rather than running onto a desk of nearly the same tone', () => {
    // A page on a desk a shade darker than it is: one bright region, no edge to
    // speak of, and the whole frame comes back as "paper" without the ink to
    // say where the sheet is.
    const page = [[26, 30], [134, 30], [134, 180], [26, 180]];
    const luma = photographOf(W, H, [page], { table: 196, paper: 226 });
    const found = findPages(luma, W, H);
    expect(found).toHaveLength(1);
    const [tl, , br] = found[0].map(([x, y]) => [x * W, y * H]);
    expect(tl[0]).toBeGreaterThan(14);
    expect(br[0]).toBeLessThan(148);
    expect(tl[1]).toBeGreaterThan(16);
    expect(br[1]).toBeLessThan(196);
  });
});

// One sheet at a time: over an open book the scanner fills in ONE page — the
// one the phone is pointed at — and keeps that one when the shutter goes.
describe('the page being aimed at', () => {
  const LEFT_PAGE = [[0.05, 0.1], [0.45, 0.1], [0.45, 0.9], [0.05, 0.9]];
  const RIGHT_PAGE = [[0.55, 0.1], [0.95, 0.1], [0.95, 0.9], [0.55, 0.9]];

  it('takes the page the middle of the picture is over', () => {
    expect(aimedPage([LEFT_PAGE, RIGHT_PAGE], [0.25, 0.5])).toBe(0);
    expect(aimedPage([LEFT_PAGE, RIGHT_PAGE], [0.75, 0.5])).toBe(1);
  });

  it('takes the nearest page when the middle falls in the gutter', () => {
    expect(aimedPage([LEFT_PAGE, RIGHT_PAGE], [0.49, 0.5])).toBe(0);
    expect(aimedPage([LEFT_PAGE, RIGHT_PAGE], [0.51, 0.5])).toBe(1);
  });

  it('is the only page there is when there is one', () => {
    expect(aimedPage([RIGHT_PAGE])).toBe(0);
    expect(aimedPage([])).toBe(-1);
  });
});

// Whether the page is being held still, asked of the page rather than of the
// picture. The picture's own frame-to-frame difference grows with how much of
// the frame the paper fills — the same hand-shake reads three times as big with
// the phone close — so the shutter used to light up only at arm's length.
describe('holding it still', () => {
  const page = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  const nudged = page.map(([x, y]) => [x + 0.004, y]);
  const shifted = page.map(([x, y]) => [x + 0.09, y]);

  it('calls a page that has barely moved still, however big it is in frame', () => {
    expect(quadsMoved([page], [nudged])).toBeLessThan(0.02);
  });

  it('calls a page that swung across the frame moved', () => {
    expect(quadsMoved([page], [shifted])).toBeGreaterThan(0.05);
  });

  it('is not settled when there was nothing before, or when a page appeared', () => {
    expect(quadsMoved([page], null)).toBe(Infinity);
    expect(quadsMoved([page, page], [page])).toBe(Infinity);
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
