import { describe, test, expect } from 'vitest';
import { fillGaps } from '../src/store/db.js';

// What a score remembers about its own pages — where the music sits on each one
// and how big each one is — and why losing it costs twenty seconds.
//
// Those measurements are written by two different things: the pass that runs
// when a part is imported, and the reader itself when it opens a part that pass
// never finished. Both read the row, await, and write it back, so either can
// finish second, and a whole-array write from the loser is how a measured score
// silently becomes an unmeasured one again.

describe('filling in what a score knows about its pages', () => {
  test('a page already measured is never re-written', () => {
    const known = [{ x: 0.1 }, { x: 0.2 }];
    expect(fillGaps(known, [{ x: 9 }, { x: 9 }])).toEqual(known);
  });

  test('a gap is filled', () => {
    expect(fillGaps([{ x: 0.1 }, null], [null, { x: 0.2 }]))
      .toEqual([{ x: 0.1 }, { x: 0.2 }]);
  });

  test('an interrupted pass keeps the pages it got to', () => {
    // Four of twenty-seven pages read, then the app was closed. Those four are
    // the whole point: without this they were thrown away and measured again,
    // every time, forever.
    const partial = fillGaps(null, [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }]);
    expect(partial).toHaveLength(4);
    // …and the next pass carries on from there rather than starting over.
    const rest = fillGaps(partial, [null, null, null, null, { x: 5 }]);
    expect(rest[0]).toEqual({ x: 1 });
    expect(rest[4]).toEqual({ x: 5 });
  });

  test('a writer that measured nothing leaves what is there alone', () => {
    const known = [{ x: 0.1 }];
    expect(fillGaps(known, null)).toEqual(known);
    expect(fillGaps(known, undefined)).toEqual(known);
  });

  test('a slower writer cannot undo a faster one', () => {
    // The reader wrote crops for every page while the import pass was still on
    // page three. The import pass then finishes and writes its own, shorter,
    // partly-null array. Nothing may be lost.
    const fromReader = fillGaps(null, [{ x: 1 }, { x: 2 }, { x: 3 }]);
    const after = fillGaps(fromReader, [{ x: 1 }, null, null]);
    expect(after).toEqual([{ x: 1 }, { x: 2 }, { x: 3 }]);
  });

  test('nothing measured at all stays nothing, rather than an empty array', () => {
    expect(fillGaps(null, null)).toBe(null);
    expect(fillGaps(null, [])).toBe(null);
  });

  test('"looked at, and there was nothing to find" is written down as an answer', () => {
    // A scan of something that is not music has no staves on any page. That is
    // a fact about the part, not a pass that failed, and it has to be told
    // apart from never having looked — or the part is read end to end again on
    // every launch to be told the same thing.
    const none = fillGaps(null, [null, null, null]);
    expect(none).toHaveLength(3);
    expect(none.every((one) => one === null)).toBe(true);
    // …and a later pass that DOES make something out still gets to say so.
    expect(fillGaps(none, [null, { staves: [1] }, null])[1]).toEqual({ staves: [1] });
  });
});
