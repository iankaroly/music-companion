// THE STRETCHES THE MAP IS ONLY RUNNING ACROSS.
//
// "I can't even get the bars to sync perfectly, so why would someone want to
// click on a bar and have the audio playing not be from that bar?" — and the
// honest answer turned out to be a measurement rather than an argument.
// `npm run scan:guess` on a photographed page: between the anchors a bar press
// lands a median of 0.78s from the truth, which is about one note of a
// forty-note system. The worst answers on the page were 3.91s and 3.40s, and
// BOTH were on systems the matcher had explicitly refused to place.
//
// The errors are not spread over the page. They are stacked on the few
// stretches the app declined to place, and the app has always known which ones
// those were — `guessedAnchors` filtered the refusals out and dropped them on
// the floor. These two functions are what keeps them, so a bar inside such a
// stretch can be drawn differently and a press in one can say what it is
// answering from.
import { describe, it, expect } from 'vitest';
import { unplacedSystems, isGuessedAt } from '../src/analysis/bar-map.js';

// What placeSystems hands back: one entry a system, `sure` either way.
const placed = (system, time) => ({ system, at: 10 * system, time, sure: true, why: '' });
const refused = (system, why) => ({ system, at: -1, time: null, sure: false, why });

describe('the systems nothing could place', () => {
  it('keeps the refusals, which guessedAnchors throws away', () => {
    const out = unplacedSystems([
      placed(0, 0), refused(1, 'this system looks the same as somewhere else in the take'),
      placed(2, 30), refused(3, 'what was played does not follow the shape of this system'),
    ]);
    expect(out.map((one) => one.at)).toEqual([1, 3]);
    expect(out[0].why).toMatch(/looks the same/);
  });

  it('says nothing about a page where every system was placed', () => {
    expect(unplacedSystems([placed(0, 0), placed(1, 10)])).toEqual([]);
  });

  it('survives being handed nothing at all', () => {
    expect(unplacedSystems(null)).toEqual([]);
    expect(unplacedSystems([null, undefined])).toEqual([]);
  });
});

describe('is this place in the piece a guess', () => {
  // Anchors at systems 0, 2 and 6. System 4 could not be placed, so everything
  // between the anchors at 2 and 6 is interpolated across it.
  const anchors = [{ at: 0, time: 0 }, { at: 2, time: 30 }, { at: 6, time: 90 }];
  const unplaced = [{ at: 4, why: 'nope' }];

  it('is true inside the stretch the refusal sits in', () => {
    expect(isGuessedAt(anchors, unplaced, 3)).toBe(true);
    expect(isGuessedAt(anchors, unplaced, 4)).toBe(true);
    expect(isGuessedAt(anchors, unplaced, 5.5)).toBe(true);
  });

  it('is false where two anchors sit either side with nothing between them', () => {
    expect(isGuessedAt(anchors, unplaced, 0.5)).toBe(false);
    expect(isGuessedAt(anchors, unplaced, 1.9)).toBe(false);
  });

  it('is false at an anchor itself, which is the one place the map is exact', () => {
    // At a mark the map does not interpolate — `timeOfBar` returns that second
    // outright — so a bar sitting ON an anchor is not a guess even when the
    // stretch above it is one. Standing on the anchor at 2 with the gap at 4.
    expect(isGuessedAt(anchors, unplaced, 2)).toBe(false);
    expect(isGuessedAt(anchors, unplaced, 6)).toBe(false);
  });

  it('says no rather than yes when there is no map to have a gap in', () => {
    // Fewer than two anchors is not a map at all; `timeOfBar` returns null and
    // nothing is being interpolated, so nothing is being guessed across.
    expect(isGuessedAt([{ at: 0, time: 0 }], unplaced, 3)).toBe(false);
    expect(isGuessedAt([], unplaced, 3)).toBe(false);
  });

  it('says no past the ends, which is a different problem with its own name', () => {
    // Outside the outermost anchors the map EXTRAPOLATES. That is where its
    // other bad answers live and `reachTheEnds` is what addresses it; calling
    // it a guessed stretch would blur two faults into one word.
    expect(isGuessedAt(anchors, [{ at: 9, why: 'nope' }], 8)).toBe(false);
  });

  it('takes nothing on faith', () => {
    expect(isGuessedAt(anchors, [], 3)).toBe(false);
    expect(isGuessedAt(anchors, null, 3)).toBe(false);
    expect(isGuessedAt(anchors, unplaced, NaN)).toBe(false);
  });
});
