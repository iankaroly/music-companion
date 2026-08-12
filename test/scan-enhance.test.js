import { describe, it, expect } from 'vitest';
import { unshadow } from '../src/analysis/unshadow.js';

// A page as a phone sees it: white paper with a staff line across it, lit from
// the left so the right-hand side falls away into shadow.
function photograph(w, h, { inkRow = 40, inkValue = 60 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 230 on the lit side down to about 90 in the far corner
      const lighting = 1 - 0.6 * (x / w);
      const paper = 230 * lighting;
      const value = y === inkRow ? inkValue * lighting : paper;
      const at = (y * w + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return data;
}

const W = 120;
const H = 120;
const luma = (data, x, y) => data[(y * W + x) * 4];

describe('taking the shadows out of a scan', () => {
  it('brings the shadowed side of the paper up to the lit side', () => {
    const data = photograph(W, H);
    const before = { lit: luma(data, 8, 8), dark: luma(data, W - 8, 8) };
    expect(before.dark).toBeLessThan(before.lit * 0.7);   // the shadow is real
    unshadow(data, W, H);
    const lit = luma(data, 8, 8);
    const dark = luma(data, W - 8, 8);
    expect(Math.abs(lit - dark)).toBeLessThan(lit * 0.12);
  });

  it('leaves the music no darker than it was photographed', () => {
    const data = photograph(W, H);
    const before = luma(data, 20, 40);
    unshadow(data, W, H);
    const after = luma(data, 20, 40);
    // The ink may be lifted with the paper around it — it must never be pushed
    // down towards black, which is what "enhancing" a scan usually means and
    // what turns a pencilled fingering into print.
    expect(after).toBeGreaterThanOrEqual(before - 1);
  });

  it('keeps the ink darker than the paper it sits on', () => {
    const data = photograph(W, H);
    unshadow(data, W, H);
    expect(luma(data, 20, 40)).toBeLessThan(luma(data, 20, 20) * 0.6);
  });

  it('does not blow a dark photograph out to white', () => {
    const data = photograph(W, H);
    unshadow(data, W, H);
    for (let i = 0; i < W * H; i++) {
      expect(Number.isFinite(data[i * 4])).toBe(true);
    }
    // The staff line is still a staff line, not a white gap.
    expect(luma(data, 60, 40)).toBeLessThan(200);
  });
});
