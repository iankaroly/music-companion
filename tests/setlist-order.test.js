import { describe, test, expect } from 'vitest';
import { setMoveTo } from '../src/store/db.js';

// A PIECE CANNOT MOVE PAST THE END OF THE PROGRAMME, AND MUST NOT BE ASKED TO.
//
// The ⋯ menu on a piece offered "Earlier in the programme" on the first piece
// and "Later" on the last. Both computed an index off the end, the caller's
// guard swallowed it, and the menu closed on a programme that had not changed
// without saying anything. The menu now asks this before drawing a row, and
// the move asks it again as its backstop, so a missing row and a refused move
// can never disagree.

describe('where a piece in a programme can move', () => {
  test('the middle of three can go both ways', () => {
    expect(setMoveTo(1, -1, 3)).toBe(0);
    expect(setMoveTo(1, 1, 3)).toBe(2);
  });

  test('the first has nothing earlier and the last has nothing later', () => {
    expect(setMoveTo(0, -1, 3)).toBe(null);
    expect(setMoveTo(2, 1, 3)).toBe(null);
    // …and the moves they CAN make are still there, which is the half a check
    // for "no row" would pass by hiding both.
    expect(setMoveTo(0, 1, 3)).toBe(1);
    expect(setMoveTo(2, -1, 3)).toBe(1);
  });

  test('a programme of one piece cannot move it at all', () => {
    expect(setMoveTo(0, -1, 1)).toBe(null);
    expect(setMoveTo(0, 1, 1)).toBe(null);
  });

  test('a position that is no longer in the programme names no place', () => {
    // The row's position is captured when the shelf is drawn. A piece taken
    // out from somewhere else leaves a handler holding an index past the end,
    // and it must refuse rather than swap with `undefined`.
    expect(setMoveTo(3, -1, 3)).toBe(null);
    expect(setMoveTo(-1, 1, 3)).toBe(null);
    expect(setMoveTo(0, -1, 0)).toBe(null);
  });
});
