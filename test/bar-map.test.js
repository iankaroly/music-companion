// The bars a scan can be played from, and the moment each one sounded.
//
// This is the half of "click a bar, hear that moment" that does not need a
// browser: rectangles out of a page reading, and a straight line between the
// bars somebody marked. Nothing here reads a note, and that is the point — the
// route through pitches breaks on a misread clef, and a rectangle has no clef.

import { describe, it, expect } from 'vitest';
import {
  barsInReadingOrder, barAtPoint, timeOfBar, barAtTime, placeAtTime, tidyAnchors, sayMap,
  evenAnchors,
} from '../src/analysis/bar-map.js';

// A page as `readPages` measures one: staves down the page, each with the
// barlines the reader found and the notes it circled, all in 0-1 terms.
const stave = (top, bars, headXs) => ({
  top,
  bottom: top + 0.1,
  space: 0.01,
  bars,
  heads: headXs.map((x) => ({ x })),
});

describe('the bars on a scan', () => {
  it('cuts each system at its barlines and bounds it by its own music', () => {
    const layout = [{ staves: [stave(0.1, [0.4, 0.7], [0.12, 0.5, 0.85])] }];
    const bars = barsInReadingOrder(layout);
    expect(bars).toHaveLength(3);
    // The outer edges come from the notes, let out a little; the inner ones are
    // the barlines exactly.
    expect(bars[0].left).toBeLessThan(0.12);
    expect(bars[0].right).toBeCloseTo(0.4, 5);
    expect(bars[1].left).toBeCloseTo(0.4, 5);
    expect(bars[2].right).toBeGreaterThan(0.85);
    expect(bars.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('numbers them down the page and on through the next one', () => {
    const layout = [
      { staves: [stave(0.1, [0.5], [0.2, 0.8]), stave(0.4, [0.5], [0.2, 0.8])] },
      { staves: [stave(0.1, [0.5], [0.2, 0.8])] },
    ];
    const bars = barsInReadingOrder(layout);
    expect(bars.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(bars.map((b) => b.page)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(bars.map((b) => b.stave)).toEqual([0, 0, 1, 1, 0, 0]);
  });

  // A BARLINE AT THE EDGE OF THE MUSIC IS THE EDGE, not a bar of its own. The
  // reader finds the line at the end of a system as readily as the ones inside
  // it, and counting that as a divider leaves a sliver with nothing in it —
  // which a tap can land in, and which then plays the wrong moment.
  it('does not make a bar out of the line at the end of a system', () => {
    const layout = [{ staves: [stave(0.1, [0.1, 0.5, 0.9], [0.12, 0.5, 0.88])] }];
    expect(barsInReadingOrder(layout)).toHaveLength(2);
  });

  it('leaves out a system with nothing on it', () => {
    const layout = [{ staves: [stave(0.1, [], []), stave(0.4, [0.5], [0.2, 0.8])] }];
    expect(barsInReadingOrder(layout).every((b) => b.stave === 1)).toBe(true);
  });

  it('finds the bar under a finger, and the nearest one just outside it', () => {
    const layout = [{ staves: [stave(0.1, [0.5], [0.2, 0.8])] }];
    const bars = barsInReadingOrder(layout);
    expect(barAtPoint(bars, 0, 0.3, 0.15)).toBe(0);
    expect(barAtPoint(bars, 0, 0.7, 0.15)).toBe(1);
    // A tap in the gap under the stave still means the bar above it.
    expect(barAtPoint(bars, 0, 0.3, 0.23)).toBe(0);
    // …and one on the other side of the page means nothing.
    expect(barAtPoint(bars, 0, 0.3, 0.9)).toBe(-1);
    expect(barAtPoint(bars, 1, 0.3, 0.15)).toBe(-1);
  });
});

describe('the moment a place in the piece was played', () => {
  // A page of three systems, two boxes in each, so a position is a system plus
  // how far across it the box starts.
  const layout = [{
    staves: [stave(0.1, [0.5], [0.2, 0.8]), stave(0.4, [0.5], [0.2, 0.8]),
      stave(0.7, [0.5], [0.2, 0.8])],
  }];
  const bars = barsInReadingOrder(layout);

  it('counts a system as one, however many boxes it was cut into', () => {
    expect(bars.map((b) => Math.floor(b.at))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(bars[0].at).toBeCloseTo(0, 3);
    expect(bars[1].at).toBeCloseTo(0.5, 1);
    expect(bars[2].at).toBeCloseTo(1, 3);
  });

  // THE REASON THE MAP RUNS ON POSITION. A stem read as a barline cuts one
  // printed bar into three, which happens on four of the ten systems of the
  // real page this was built against. Those slivers must not make their system
  // take three times as long to play as the identical one beside it.
  it('is unmoved by a system cut into more boxes than it has bars', () => {
    const clean = barsInReadingOrder([{ staves: [stave(0.1, [0.5], [0.2, 0.8])] }]);
    const sliced = barsInReadingOrder([{
      staves: [stave(0.1, [0.3, 0.4, 0.5], [0.2, 0.8])],
    }]);
    // Six boxes or two, the system still spans 0 to 1 and its last box still
    // starts where the music's last stretch starts.
    expect(clean.at(-1).to).toBeCloseTo(1, 3);
    expect(sliced.at(-1).to).toBeCloseTo(1, 3);
    expect(sliced.length).toBeGreaterThan(clean.length);
  });

  it('says nothing at all until two places have been marked', () => {
    expect(timeOfBar([], 3)).toBe(null);
    expect(timeOfBar([{ at: 0, time: 1 }], 3)).toBe(null);
    expect(placeAtTime([{ at: 0, time: 1 }], 4)).toBe(null);
  });

  it('runs a straight line between the places that were marked', () => {
    const anchors = [{ at: 0, time: 2 }, { at: 10, time: 22 }];
    expect(timeOfBar(anchors, 0)).toBeCloseTo(2, 6);
    expect(timeOfBar(anchors, 5)).toBeCloseTo(12, 6);
    expect(timeOfBar(anchors, 10)).toBeCloseTo(22, 6);
    expect(placeAtTime(anchors, 12)).toBeCloseTo(5, 6);
  });

  it('takes a bar and reads its own position', () => {
    const anchors = [{ at: 0, time: 0 }, { at: 3, time: 30 }];
    expect(timeOfBar(anchors, bars[0])).toBeCloseTo(0, 6);
    expect(timeOfBar(anchors, bars[2])).toBeCloseTo(10, 6);
    expect(timeOfBar(anchors, bars[4])).toBeCloseTo(20, 6);
  });

  it('bends at every anchor, so a passage that dragged stays put', () => {
    const anchors = [{ at: 0, time: 0 }, { at: 10, time: 20 }, { at: 15, time: 40 }];
    expect(timeOfBar(anchors, 5)).toBeCloseTo(10, 6);
    expect(timeOfBar(anchors, 12)).toBeCloseTo(28, 6);
    expect(placeAtTime(anchors, 30)).toBeCloseTo(12.5, 6);
  });

  it('carries the nearest pair’s speed on past the ends', () => {
    const anchors = [{ at: 4, time: 10 }, { at: 8, time: 18 }];   // 2s a system
    expect(timeOfBar(anchors, 2)).toBeCloseTo(6, 6);
    expect(timeOfBar(anchors, 10)).toBeCloseTo(22, 6);
    // …and never before the recording started.
    expect(timeOfBar([{ at: 4, time: 1 }, { at: 8, time: 3 }], 0)).toBe(0);
  });

  it('finds the box a moment of the recording is in, for a light that follows', () => {
    const anchors = [{ at: 0, time: 0 }, { at: 3, time: 30 }];
    expect(barAtTime(bars, anchors, 0)).toBe(0);
    expect(barAtTime(bars, anchors, 7)).toBe(1);      // second half of system 1
    expect(barAtTime(bars, anchors, 12)).toBe(2);     // system 2
    expect(barAtTime(bars, [], 12)).toBe(-1);
  });

  it('keeps one mark to a place, the later one winning', () => {
    const tidy = tidyAnchors([
      { at: 5, time: 9 }, { at: 0, time: 1 }, { at: 5, time: 11 }, { at: NaN, time: 3 },
    ]);
    expect(tidy).toEqual([{ at: 0, time: 1 }, { at: 5, time: 11 }]);
  });

  it('says how much of the map is known and how much is a guess', () => {
    // A COUNT, not an instruction. The empty case used to read "play the take
    // and tap the bar you are hearing"; the strip's own button says that.
    expect(sayMap([], bars)).toBe('nothing marked yet');
    expect(sayMap([{ at: 0, time: 0 }], bars)).toMatch(/one place marked/);
    expect(sayMap([{ at: 0, time: 0 }, { at: 2, time: 8 }], bars))
      .toBe('2 places marked, 2.0 of 3 systems between them');
    expect(sayMap([{ at: 0, time: 0 }, { at: 9, time: 60 }], bars))
      .toMatch(/longest gap is 9.0 systems/);
  });
});


// THE TAKE SPREAD EVENLY ACROSS THE PAGE — the map that needs no taps.
//
// "as soon as you hear the first note to the last note that you hear, you
// divide that amount of time by how many bars there are."
describe('spreading a take evenly over the page', () => {
  const page = {
    staves: [
      stave(0.1, [0.1, 0.5, 0.9], [0.15, 0.3, 0.6, 0.8]),
      stave(0.4, [0.1, 0.5, 0.9], [0.15, 0.3, 0.6, 0.8]),
    ],
  };
  const bars = barsInReadingOrder([page]);
  const played = (times) => times.map(([start, end]) => ({ start, end }));

  it('pins the first note to the start of the page and the last to the end', () => {
    const anchors = evenAnchors(bars, played([[4, 4.5], [10, 10.5], [24, 25]]));
    expect(anchors).toHaveLength(2);
    expect(anchors[0].at).toBeCloseTo(bars[0].at, 6);
    expect(anchors[0].time).toBeCloseTo(4, 6);
    expect(anchors[1].at).toBeCloseTo(bars.at(-1).to, 6);
    expect(anchors[1].time).toBeCloseTo(25, 6);
  });

  it('gives the middle of the page the middle of the take', () => {
    const anchors = evenAnchors(bars, played([[0, 0.5], [30, 31]]));
    const half = (bars[0].at + bars.at(-1).to) / 2;
    expect(timeOfBar(anchors, half)).toBeCloseTo(15.5, 1);
  });

  // A bar takes its share of the time in proportion to how much of the PAGE it
  // occupies, not to how many boxes there are — see the note on evenAnchors.
  // Here every box is a quarter of the two systems, so the third box starts
  // half way through.
  it('shares the time out by where a bar sits, not by counting boxes', () => {
    const anchors = evenAnchors(bars, played([[0, 0], [40, 40]]));
    expect(bars).toHaveLength(4);
    expect(timeOfBar(anchors, bars[2])).toBeCloseTo(20, 1);
  });

  it('says nothing when there is nothing to spread', () => {
    expect(evenAnchors(bars, [])).toEqual([]);
    expect(evenAnchors(bars, played([[3, 3.2]]))).toEqual([]);
    // A take a second long is not a page of music, and spreading it would put
    // every bar within a few hundredths of every other.
    expect(evenAnchors(bars, played([[3, 3.2], [3.6, 3.8]]))).toEqual([]);
    expect(evenAnchors([], played([[0, 1], [30, 31]]))).toEqual([]);
  });
});
