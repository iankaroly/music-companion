import { describe, it, expect } from 'vitest';
import { bandsOfPage } from '../src/ui/bands.js';

// A photographed page: ten systems down it, the margins already trimmed off by
// the crop. Coordinates are fractions of the CROPPED page, which is what the
// page reader works in.
const PAGE = {
  crop: { x: 0.06, y: 0.05, w: 0.88, h: 0.9 },
  size: { w: 3024, h: 4032 },
  staves: Array.from({ length: 10 }, (_, i) => ({
    top: 0.02 + i * 0.098,
    bottom: 0.02 + i * 0.098 + 0.07,
  })),
};

const shape = (rect) => (rect.w * PAGE.crop.w * PAGE.size.w)
  / (rect.h * PAGE.crop.h * PAGE.size.h);

// Every part of a staff, as a range that must never be cut through.
const insideAStaff = (y) => PAGE.staves.some((staff) => y > staff.top + 0.004 && y < staff.bottom - 0.004);

describe('laying a scanned page on a screen', () => {
  it('shows the page whole when the paper is the shape of the screen', () => {
    const bands = bandsOfPage({ ...PAGE, target: shape({ x: 0, y: 0, w: 1, h: 1 }) });
    expect(bands).toHaveLength(1);
    expect(bands[0].y).toBeLessThanOrEqual(0);
    expect(bands[0].y + bands[0].h).toBeGreaterThanOrEqual(1);
  });

  it('splits a tall page for a wide screen, and fills it', () => {
    const target = 1.33;
    const bands = bandsOfPage({ ...PAGE, target });
    expect(bands.length).toBeGreaterThan(1);
    for (const band of bands) {
      // Each band comes out within a few percent of the screen's own shape,
      // which is what "no white above or below" means in numbers.
      expect(Math.abs(shape(band) - target) / target).toBeLessThan(0.06);
    }
  });

  it('never cuts through a system', () => {
    for (const target of [1.33, 1.6, 2.1]) {
      const bands = bandsOfPage({ ...PAGE, target });
      for (const band of bands.slice(1)) expect(insideAStaff(band.y)).toBe(false);
      for (const band of bands.slice(0, -1)) expect(insideAStaff(band.y + band.h)).toBe(false);
    }
  });

  it('keeps the systems in the order they were photographed, with none missed', () => {
    const bands = bandsOfPage({ ...PAGE, target: 1.6 });
    for (const [i, band] of bands.entries()) {
      if (i === 0) continue;
      // Each band picks up where the one before it left off — at worst
      // overlapping into the same empty gap, never skipping a strip of paper.
      expect(band.y).toBeLessThanOrEqual(bands[i - 1].y + bands[i - 1].h + 0.001);
      expect(band.y).toBeGreaterThan(bands[i - 1].y);
    }
    expect(bands.at(-1).y + bands.at(-1).h).toBeGreaterThanOrEqual(1);
  });

  it('shows a page it could not read as one whole page', () => {
    const bands = bandsOfPage({ ...PAGE, staves: [], target: 1.6 });
    expect(bands).toHaveLength(1);
  });

  it('asks for more bands as the reading size goes up', () => {
    const one = bandsOfPage({ ...PAGE, target: 1.33, zoom: 1 }).length;
    const big = bandsOfPage({ ...PAGE, target: 1.33, zoom: 2 }).length;
    expect(big).toBeGreaterThan(one);
  });

  it('never asks for more bands than there are gaps to cut at', () => {
    const staves = PAGE.staves.slice(0, 3);
    const bands = bandsOfPage({ ...PAGE, staves, target: 4, zoom: 2.4 });
    expect(bands.length).toBeLessThanOrEqual(staves.length - 1);
  });

  it('takes the margin back rather than leaving the music in a white frame', () => {
    // A screen wider than the music: the band should reach out past the crop,
    // into the paper either side, instead of stopping at the last notehead.
    const bands = bandsOfPage({ ...PAGE, target: 2.4 });
    expect(bands.some((band) => band.x < 0 || band.x + band.w > 1)).toBe(true);
    // …and never past the edge of the photograph itself.
    for (const band of bands) {
      expect(band.x).toBeGreaterThanOrEqual(-PAGE.crop.x / PAGE.crop.w - 1e-9);
      expect(band.x + band.w).toBeLessThanOrEqual((1 - PAGE.crop.x) / PAGE.crop.w + 1e-9);
    }
  });
});
