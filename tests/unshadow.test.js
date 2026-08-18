// What the lighting pass does to a photograph of a page.
//
// A player asked for what Scanner Pro does: "makes the page brighter and
// eliminating shadows". These hold it to that AND to the thing it must not do —
// a page of music is not a document to be pushed to two tones, because a
// pencilled fingering that comes back looking like print is a lie about
// somebody's own page.
import { describe, it, expect } from 'vitest';
import { unshadow } from '../src/analysis/unshadow.js';

const W = 240;
const H = 320;

// A page: cream paper, black print, a grey pencil mark, and a lamp on the left
// so the right-hand side falls into shadow.
function photograph({ shadow = 0.55 } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, v) => {
    const at = (y * W + x) * 4;
    data[at] = v * 1.0;
    data[at + 1] = v * 0.97;
    data[at + 2] = v * 0.9;
    data[at + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lamp = 1 - (1 - shadow) * (x / W);       // bright left, dark right
      let v = 214;                                    // cream paper
      if (y % 24 === 0 && x > 12 && x < W - 12) v = 40;   // staff lines: print
      if (y % 24 === 12 && x % 30 < 8) v = 132;           // a pencil mark
      put(x, y, v * lamp);
    }
  }
  return data;
}

const lumaAt = (data, x, y) => {
  const at = (y * W + x) * 4;
  return data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114;
};

describe('the lighting pass on a photographed page', () => {
  it('takes the paper to white on both sides of a shadow', () => {
    const data = unshadow(photograph(), W, H);
    // Paper, well away from any line, in the lit half and the shadowed half.
    const lit = lumaAt(data, 40, 6);
    const dark = lumaAt(data, W - 40, 6);
    expect(lit).toBeGreaterThan(235);
    expect(dark).toBeGreaterThan(235);
    // …and the two halves match, which is what "no shadow" means.
    expect(Math.abs(lit - dark)).toBeLessThan(12);
  });

  it('leaves the print dark', () => {
    const data = unshadow(photograph(), W, H);
    expect(lumaAt(data, 60, 24)).toBeLessThan(90);
    expect(lumaAt(data, W - 60, 24)).toBeLessThan(90);
  });

  it('keeps a pencil mark lighter than the print and darker than the paper', () => {
    const data = unshadow(photograph(), W, H);
    const pencil = lumaAt(data, 61, 36);
    const print = lumaAt(data, 60, 24);
    const paper = lumaAt(data, 40, 6);
    expect(pencil).toBeGreaterThan(print + 20);
    expect(pencil).toBeLessThan(paper - 20);
  });

  it('does not whiten a heavily inked passage', () => {
    // A solid black band the width of the page — a blur wide enough to find the
    // lighting follows this down, and a ratio taken against it would call the
    // ink paper.
    const data = photograph();
    for (let y = 120; y < 190; y++) {
      for (let x = 20; x < W - 20; x++) {
        const at = (y * W + x) * 4;
        data[at] = 30; data[at + 1] = 30; data[at + 2] = 30; data[at + 3] = 255;
      }
    }
    unshadow(data, W, H);
    expect(lumaAt(data, W / 2, 155)).toBeLessThan(110);
  });
});
