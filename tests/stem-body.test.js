import { describe, test, expect } from 'vitest';
import { bodyAcross } from '../src/analysis/scan-read.js';

// A NOTEHEAD HAS A BODY; A STEM CROSSING A STAFF LINE HAS ONLY THE TWO STROKES
// IT IS MADE OF. This is the test that tells them apart, and it exists because
// every one of the 251 circles that `scan:bars-believed` found standing on
// nothing was the second thing wearing the first thing's ring.
//
// Both pictures are drawn at two staff spaces — ten pixels and six — because
// that is where the question is really asked: at a phone's six-pixel space the
// two shapes are four pixels across and three, and the whole point of the
// constant beside STEM_BODY is that it does NOT fire down there rather than
// firing and taking real notes with it.

// A staff of five printed lines, and whatever else the caller draws on it.
function page(space, draw) {
  const w = space * 30;
  const h = space * 14;
  const ink = new Uint8Array(w * h);
  const thick = Math.max(1, Math.round(space * 0.1));
  const top = Math.round(space * 4);
  const lines = [];
  for (let k = 0; k < 5; k++) {
    const y = top + k * space;
    lines.push({ at: [y, y, y, y], mid: y });
    for (let dy = 0; dy < thick; dy++) {
      for (let x = 0; x < w; x++) ink[(y + dy) * w + x] = 1;
    }
  }
  const put = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) ink[y * w + x] = 1; };
  draw(put, { top, space, thick, w, h });
  return { ink, w, h, staff: { lines }, stripW: w / 4 };
}

// A stem, running the height of the stave and past it, and nothing else.
const stem = (cx) => (put, { top, space, thick }) => {
  for (let y = top - space * 2; y < top + space * 6; y++) {
    for (let dx = 0; dx < Math.max(1, Math.round(thick)); dx++) put(cx + dx, y);
  }
};

// The same stem WITH its notehead: a filled ellipse a little over a space wide.
const stemAndHead = (cx, cy) => (put, ctx) => {
  stem(cx)(put, ctx);
  const { space } = ctx;
  const rx = space * 0.62;
  const ry = space * 0.5;
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) put(cx + dx, cy + dy);
    }
  }
};

describe('bodyAcross — what the stem pass proposed a ring on', () => {
  for (const space of [10, 6]) {
    test(`a notehead sitting in a SPACE has a body, at a ${space}px space`, () => {
      const cx = Math.round(space * 12);
      const cy = Math.round(space * 4 + space * 2.5);
      const p = page(space, (put, ctx) => stemAndHead(cx, cy)(put, ctx));
      expect(bodyAcross(p.ink, p.w, p.h, p.staff, p.stripW, space, cx, cy))
        .toBeGreaterThan(0.6);
    });
  }

  test('a notehead sitting ON a staff line has one too, at a 10px space', () => {
    const space = 10;
    const cx = Math.round(space * 12);
    const cy = Math.round(space * 4 + space * 2);
    const p = page(space, (put, ctx) => stemAndHead(cx, cy)(put, ctx));
    expect(bodyAcross(p.ink, p.w, p.h, p.staff, p.stripW, space, cx, cy))
      .toBeGreaterThan(0.6);
  });

  // The place a bare stem crosses a line, which is the whole reason the
  // constant exists.
  test('the place a bare stem crosses a staff line has none, at a 10px space', () => {
    const space = 10;
    const cx = Math.round(space * 12);
    const p = page(space, stem(cx));
    const cy = Math.round(space * 4 + space * 2);
    expect(bodyAcross(p.ink, p.w, p.h, p.staff, p.stripW, space, cx, cy))
      .toBeLessThan(0.15);
  });

  // AND THE HONEST HALF, which the first draft of this file asserted the
  // opposite of and was wrong about: at the six-pixel staff space a phone scan
  // actually delivers, a REAL notehead standing on a line reports almost no
  // body either — the head is four pixels tall and the line's own ink run eats
  // it. The two shapes are not separable down there by this or any other bound,
  // and STEM_BODY is set BELOW what a real head scores there on purpose, so the
  // test is inert on a phone scan rather than rejecting real notes on one.
  // `npm run scan:import` is byte-identical with the test in and out, and this
  // is why. If anyone raises the constant, this is the test that will say what
  // it costs.
  test('at a 6px space neither shape has one, so the test must not fire there', () => {
    const space = 6;
    const cx = Math.round(space * 12);
    const cy = Math.round(space * 4 + space * 2);
    const head = page(space, (put, ctx) => stemAndHead(cx, cy)(put, ctx));
    const cross = page(space, stem(cx));
    const onHead = bodyAcross(head.ink, head.w, head.h, head.staff, head.stripW, space, cx, cy);
    const onCross = bodyAcross(cross.ink, cross.w, cross.h, cross.staff, cross.stripW, space, cx, cy);
    // A real head scores barely a sixth of a space, and the constant is under
    // it — so the head survives.
    expect(onHead).toBeLessThan(0.3);
    expect(onHead).toBeGreaterThanOrEqual(0.15);
    // …and the crossing is not far enough below it to be told apart.
    expect(Math.abs(onHead - onCross)).toBeLessThan(0.2);
  });

  test('a bare stem AWAY from any line has none either', () => {
    const space = 10;
    const cx = Math.round(space * 12);
    const p = page(space, stem(cx));
    const cy = Math.round(space * 4 + space * 2.5);
    expect(bodyAcross(p.ink, p.w, p.h, p.staff, p.stripW, space, cx, cy))
      .toBeLessThan(0.15);
  });
});
