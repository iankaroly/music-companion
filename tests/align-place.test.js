// WHERE ON THE PAGE THE TAKE IS PLACED — the bug a user reported, held down.
//
// "I would click on a note that was out of tune, and it would play audio from a
// different part of the music." A ring is drawn on the notehead the aligner
// chose and pressing it plays that note's own moment of the recording, so a
// take placed in the wrong PART of the page is exactly that complaint.
//
// It happened because the alignment was global: every notehead had to be
// consumed, so the ones before the take and after it were deleted at the same
// total cost wherever the take sat, every placement tied, and the tie-break
// took the earliest. These pages repeat their pitches the way music does, which
// is what makes the tie possible at all — with 100 different pitches there is
// only one place a take can go and the bug cannot be reproduced.
import { describe, it, expect } from 'vitest';
import { alignScore } from '../src/analysis/align-score.js';

// Real music repeats its pitches, which is what lets a take slide: the same
// ten notes can be matched, in order, in several places on the page.
const seq = (() => {
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  return Array.from({ length: 100 }, (_, i) => ({
    id: `s${i}`, midi: 48 + Math.floor(rnd() * 8), onsetBeats: i, durBeats: 1, measure: 1,
  }));
})();

const takeFrom = (at, n, extra = []) => [
  ...Array.from({ length: n }, (_, i) => ({ midi: seq[at + i].midi, start: i * 0.25, end: i * 0.25 + 0.2 })),
  ...extra,
];

describe('where a take of a long page is placed', () => {
  it('lands where it was played', () => {
    const played = takeFrom(50, 12);
    const { attempts } = alignScore(played, seq);
    expect(attempts.findIndex((a) => a?.played === played[0])).toBe(50);
  });

  it('…and still does when the last thing on it is a squeak', () => {
    const played = takeFrom(50, 12, [{ midi: 20, start: 3.2, end: 3.3 }]);
    const { attempts } = alignScore(played, seq);
    expect(attempts.findIndex((a) => a?.played === played[0])).toBe(50);
  });

  it('…and when it starts with one', () => {
    const played = [{ midi: 20, start: 0, end: 0.1 }, ...takeFrom(50, 12)];
    const { attempts } = alignScore(played, seq);
    expect(attempts.findIndex((a) => a?.played === played[1])).toBe(50);
  });
});
