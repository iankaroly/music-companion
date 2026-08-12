import { describe, it, expect } from 'vitest';
import {
  moveCorner, moveEdge, edgeMidpoints, handleAt, isSane, area, WHOLE_FRAME,
} from '../src/analysis/crop-geometry.js';

// A page, roughly square in the frame, the way the finder hands it over:
// top-left, top-right, bottom-right, bottom-left.
const page = [[0.1, 0.1], [0.9, 0.12], [0.88, 0.9], [0.12, 0.88]];

describe('dragging a corner', () => {
  it('moves the one that was dragged and nothing else', () => {
    const moved = moveCorner(page, 0, 0.2, 0.15);
    expect(moved[0]).toEqual([0.2, 0.15]);
    expect(moved.slice(1)).toEqual(page.slice(1));
  });

  it('keeps a corner inside the photograph', () => {
    expect(moveCorner(page, 1, 1.4, -0.3)[1]).toEqual([1, 0]);
  });

  // A corner dragged past its neighbours folds the page into a bow tie, and the
  // transform that squares it up would map the picture inside out.
  it('refuses a drag that would fold the page over itself', () => {
    const folded = moveCorner(page, 0, 0.95, 0.95);
    expect(folded).toEqual(page);
  });

  // Pulling one corner in tight is a legitimate crop — a trapezoid is what a
  // page photographed at an angle IS — so only folding and vanishing are
  // refused, not narrowness.
  it('allows a hard perspective crop', () => {
    expect(moveCorner(page, 0, 0.7, 0.11)[0]).toEqual([0.7, 0.11]);
  });
});

describe('dragging an edge', () => {
  it('takes both of its corners with it', () => {
    const moved = moveEdge(page, 0, 0, 0.1);   // the top edge, pulled down
    expect(moved[0][0]).toBeCloseTo(0.1, 5);
    expect(moved[0][1]).toBeCloseTo(0.2, 5);
    expect(moved[1][0]).toBeCloseTo(0.9, 5);
    expect(moved[1][1]).toBeCloseTo(0.22, 5);
    expect(moved[2]).toEqual(page[2]);
    expect(moved[3]).toEqual(page[3]);
  });

  it('wraps round to the last edge, which joins the last corner to the first', () => {
    const moved = moveEdge(page, 3, 0.05, 0);
    expect(moved[3][0]).toBeCloseTo(0.17, 5);
    expect(moved[0][0]).toBeCloseTo(0.15, 5);
  });

  // Dragged to the far side, an edge stops at the edge of the photograph
  // rather than passing through the opposite one — so the worst a heavy drag
  // can do is leave a thin strip, never a folded page.
  it('stops at the edge of the picture instead of crossing over', () => {
    const shoved = moveEdge(page, 0, 0, 0.95);
    expect(shoved[0][1]).toBe(1);
    expect(shoved[1][1]).toBe(1);
    expect(isSane(shoved)).toBe(true);
  });
});

describe('finding the handle under a finger', () => {
  it('takes the corner when a finger is on one', () => {
    expect(handleAt(page, 0.105, 0.105, 0.04)).toEqual({ kind: 'corner', index: 0 });
  });

  it('takes the edge when a finger is between two corners', () => {
    const [mid] = edgeMidpoints(page);
    expect(handleAt(page, mid[0], mid[1], 0.04)).toEqual({ kind: 'edge', index: 0 });
  });

  // The corner handles sit on the ends of the edges; a tap on one must not be
  // read as a tap on the other.
  it('prefers the corner where the two overlap', () => {
    const generous = handleAt(page, 0.1, 0.1, 0.6);
    expect(generous.kind).toBe('corner');
  });

  it('says nothing when the finger is on the paper itself', () => {
    expect(handleAt(page, 0.5, 0.5, 0.04)).toBeNull();
  });
});

describe('what counts as a page at all', () => {
  it('accepts the whole photograph', () => {
    expect(isSane(WHOLE_FRAME)).toBe(true);
    expect(area(WHOLE_FRAME)).toBeCloseTo(1, 6);
  });

  it('rejects a bow tie', () => {
    expect(isSane([[0, 0], [1, 0], [0, 1], [1, 1]])).toBe(false);
  });

  it('rejects a crop too small to read anything off', () => {
    expect(isSane([[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]])).toBe(false);
  });

  it('rejects nonsense', () => {
    expect(isSane(null)).toBe(false);
    expect(isSane([[0, 0], [1, 0], [1, 1]])).toBe(false);
    expect(isSane([[0, 0], [1, 0], [1, NaN], [0, 1]])).toBe(false);
  });
});
