import { describe, test, expect } from 'vitest';
import {
  combScore, combPeaks, trackCombs, fillMissedStaves, stavesToLines, beamMask, realStaff,
  dropDoubledHeads, clefHere,
} from '../src/analysis/scan-read.js';
import { pitchOf } from '../src/analysis/scan-notes.js';

// A strip's profile: for each row, the fraction of that strip's columns that
// are inked. A stave is five inked rows with clear gaps between them.
function staffProfile({ height = 200, top = 50, step = 12, ink = 1 } = {}) {
  const p = new Float32Array(height);
  for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = ink;
  return p;
}

function pageProfile({ height = 600, tops = [50, 250, 450], step = 12 } = {}) {
  const p = new Float32Array(height);
  for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
  return p;
}

describe('combScore', () => {
  test('a five-line grid at the right place and spacing scores high', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBeCloseTo(1, 5);
  });

  test('the same grid half a space out scores nothing', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 56, 12)).toBeLessThan(0.3);
  });

  test('a solid black band does not answer: the gaps must be clear', () => {
    const p = new Float32Array(200).fill(1);
    expect(combScore(p, 50, 12)).toBeCloseTo(0, 5);
  });

  test('four lines of five still score well — the point of the comb', () => {
    const p = staffProfile({ top: 50, step: 12 });
    p[Math.round(50 + 2 * 12)] = 0;          // the middle line is lost to a beam
    expect(combScore(p, 50, 12)).toBeGreaterThan(0.75);
  });

  test('a comb that runs off the page is not a comb', () => {
    const p = staffProfile({ height: 60, top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBe(-1);
    expect(combScore(p, -4, 12)).toBe(-1);
  });
});

describe('combPeaks', () => {
  test('one peak per stave, in reading order', () => {
    const found = combPeaks(pageProfile(), 12);
    expect(found.map((c) => c.y0)).toEqual([50, 250, 450]);
  });

  test('a stave is found once, not at every offset that partly fits', () => {
    // Without a wide enough suppression window, a comb locks onto lines 2-5
    // plus a ledger line and reports a second stave a few spaces away.
    const found = combPeaks(pageProfile({ tops: [50] }), 12);
    expect(found).toHaveLength(1);
  });

  test('the spacing is refined, not assumed', () => {
    const found = combPeaks(pageProfile({ tops: [50], step: 13 }), 12);
    expect(found).toHaveLength(1);
    expect(found[0].step).toBeCloseTo(13, 1);
  });

  test('ink that is not a grid is not a stave', () => {
    // Deliberately NOT a periodic texture. Ink on every third row is a grid,
    // and the comb says so — rightly, because the refined spacing can land on
    // a multiple of it. That case cannot arise on a page: pageScale measures
    // the commonest run of white, so a texture that regular would BE the
    // page's spacing and the comb would be looking for it at its own period.
    // What has to be rejected is ink with no vertical structure at all.
    const noise = (amplitude) => {
      const p = new Float32Array(600);
      let seed = 7;
      for (let y = 0; y < 600; y++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        p[y] = (seed / 2147483648) * amplitude;
      }
      return p;
    };
    // Paper texture and print show-through, which is what a blank margin
    // actually looks like: nothing to find.
    expect(combPeaks(noise(0.15), 12)).toHaveLength(0);

    // And the limit, written down rather than hidden: heavy random ink CAN
    // answer, because the best of thirteen spacings over six hundred offsets
    // beats the floor by chance. It answers weakly, and it answers in a
    // different place in every strip — which is why trackCombs makes a stave
    // cross half the page before it believes in it.
    for (const c of combPeaks(noise(0.6), 12)) expect(c.score).toBeLessThan(0.6);
  });
});

// One stave, sagging gently across the page the way a photographed one does.
function sagging(strips = 40, from = 100, drop = 8) {
  return Array.from({ length: strips }, (_, s) => [
    { y0: from + (drop * s) / strips, step: 12, score: 1 },
  ]);
}

describe('trackCombs', () => {
  test('a stave that crosses the page is one stave, sampled per strip', () => {
    const staves = trackCombs(sagging(), 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0).toHaveLength(40);
    expect(staves[0].y0[0]).toBeCloseTo(100, 1);
    expect(staves[0].y0[39]).toBeCloseTo(107.8, 1);
  });

  test('a gap of a few strips is carried across, not a second stave', () => {
    const perStrip = sagging();
    perStrip[10] = [];
    perStrip[11] = [];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0[10]).toBeGreaterThan(100);
    expect(staves[0].y0[10]).toBeLessThan(108);
  });

  test('something that answers in a corner only is not a stave', () => {
    const perStrip = sagging();
    for (let s = 0; s < 5; s++) perStrip[s] = [...perStrip[s], { y0: 300, step: 12, score: 1 }];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
  });

  test('two staves stay two staves, top first', () => {
    const perStrip = sagging().map((c, s) => [...c, { y0: 300 + s * 0.1, score: 1, step: 12 }]);
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(2);
    expect(staves[0].y0[0]).toBeLessThan(staves[1].y0[0]);
  });

  // A SCRAP MUST NOT SET THE BAR FOR THE PAGE. How much like a stave a curve
  // has to look is measured against the best curve on the page, and if that
  // "best" is allowed to come from a two-strip fragment the very next test
  // throws away — a bracket, a black chord, the frame of a photograph — then a
  // page of honest staves can be deleted in its entirety. Six staves at 0.52
  // beside one scrap at 0.95: 0.52 < 0.95 * 0.6, every stave goes, trackCombs
  // returns nothing, fillMissedStaves bails below three and readPage hands back
  // null. The page reads as blank paper, which is the worst answer this reader
  // has.
  test('a two-strip scrap does not delete the whole page', () => {
    const perStrip = Array.from({ length: 40 }, () => []);
    for (let s = 0; s < 40; s++) {
      for (let i = 0; i < 6; i++) perStrip[s].push({ y0: 100 + i * 160, step: 12, score: 0.52 });
    }
    perStrip[0].push({ y0: 1200, step: 12, score: 0.95 });
    perStrip[1].push({ y0: 1200, step: 12, score: 0.95 });
    expect(trackCombs(perStrip, 12)).toHaveLength(6);
  });

  // AND THE BAR HAS A FLOOR UNDER IT. A system printed faint among crisp ones
  // scores well below three fifths of the best and is a stave all the same;
  // below three staves fillMissedStaves cannot put it back, and a two-system
  // page is exactly the close-up the camera scanner produces.
  test('one faint system among crisp ones is still a system', () => {
    const perStrip = Array.from({ length: 40 }, (_, s) => [
      { y0: 100, step: 12, score: 0.94 },
      { y0: 260 + s * 0.05, step: 12, score: 0.47 },
    ]);
    expect(trackCombs(perStrip, 12)).toHaveLength(2);
  });

  // The floor is not a licence: the top-edge blur artefact this rule was written
  // for reads 0.40 over half the page, and it still goes.
  test('the edge artefact is still thrown away', () => {
    const perStrip = Array.from({ length: 40 }, (_, s) => [
      { y0: 100, step: 12, score: 0.92 },
      { y0: 260 + s * 0.05, step: 12, score: 0.92 },
      ...(s < 22 ? [{ y0: 900, step: 12, score: 0.4 }] : []),
    ]);
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(2);
    expect(staves.every((st) => st.y0[0] < 400)).toBe(true);
  });
});

// A page of evenly spaced systems, as profiles, one per strip.
function pageStrips({ strips = 40, tops = [100, 260, 420, 580], step = 12, height = 800 } = {}) {
  return Array.from({ length: strips }, () => {
    const p = new Float32Array(height);
    for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
    return p;
  });
}

describe('fillMissedStaves', () => {
  test('a system missed in the middle is put back', () => {
    const profiles = pageStrips();                       // four systems on the page
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );                                                   // …but the reader saw three
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled).toHaveLength(4);
    expect(filled[1].y0[0]).toBeCloseTo(260, 0);
  });

  test('a system missed at the foot of the page is put back', () => {
    const profiles = pageStrips();
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => c.y0 < 500)), 12,
    );
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled.map((s) => Math.round(s.y0[0]))).toEqual([100, 260, 420, 580]);
  });

  test('nothing is invented where the page has no ink', () => {
    // Three real systems and blank paper below them: prediction must not
    // manufacture a fourth out of an empty margin.
    const profiles = pageStrips({ tops: [100, 260, 420], height: 800 });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(3);
  });

  test('fewer than three staves is not a rhythm worth extrapolating', () => {
    const profiles = pageStrips({ tops: [100, 260] });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(2);
  });

  // THE BAR IS THE PAGE'S OWN, and these four pin what that buys and what it
  // must never cost. The failure they exist for is the title block: on both
  // Mozart pages the prediction runs one system ABOVE the first real one and
  // lands on the printed heading, where a fixed floor of 0.05 is thirteen times
  // below the faintest honest stave on the same photograph.
  test('a faint smear where a system is predicted is refused', () => {
    // Four real systems, and a fifth position below them carrying a tenth of
    // the response — the strength of printed type, not of a stave.
    const profiles = pageStrips({ tops: [100, 260, 420, 580], height: 900 });
    for (const p of profiles) for (let k = 0; k < 5; k++) p[Math.round(740 + k * 12)] = 0.1;
    const found = trackCombs(profiles.map((prof) => combPeaks(prof, 12)), 12);
    expect(found).toHaveLength(4);
    // The smear is exactly what the old fixed floor could not see: it answers
    // twice as loudly as 0.05 asks, and a fifth of what this page's own staves
    // answer is 0.20.
    expect(combScore(profiles[0], 740, 12)).toBeGreaterThan(0.05);
    expect(combScore(profiles[0], 740, 12)).toBeLessThan(0.20);
    expect(combScore(profiles[0], 100, 12)).toBeCloseTo(1, 5);
    expect(fillMissedStaves(found, profiles, 12, { floor: 0.05 })).toHaveLength(4);
  });

  test('a system faint by the standards of its OWN page is still rescued', () => {
    // This is what fillMissedStaves is for and the bar must not break it: the
    // whole photograph is weak, so the missed system is weak too, and the ratio
    // is what decides rather than the absolute level.
    const profiles = Array.from({ length: 40 }, () => {
      const p = new Float32Array(800);
      for (const top of [100, 260, 420, 580]) for (let k = 0; k < 5; k++) p[Math.round(top + k * 12)] = 0.35;
      return p;
    });
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );
    expect(found).toHaveLength(3);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(4);
  });

  test('the bar only ever rises: a page whose own staves are weak keeps the floor', () => {
    // One-directional by construction. If the page's own quartile came out
    // below `floor`, taking it would ADMIT more than the old code did — the one
    // direction this change is not allowed to move in.
    // A weak page: its own staves score 0.35, so a fifth of that is 0.07 — well
    // UNDER the 0.5 asked for here. The answer is still 0.5 and the system is
    // still refused, because the two are combined with `Math.max`.
    const profiles = Array.from({ length: 40 }, () => {
      const p = new Float32Array(800);
      for (const top of [100, 260, 420, 580]) for (let k = 0; k < 5; k++) p[Math.round(top + k * 12)] = 0.35;
      return p;
    });
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );
    expect(found).toHaveLength(3);
    expect(fillMissedStaves(found, profiles, 12, { floor: 0.5 })).toHaveLength(3);
  });

  test('the strong page still puts a real missed system back', () => {
    // The rescue in the first test of this block, re-asserted after the bar:
    // a real system scores what its neighbours score, so a fifth of their low
    // quartile is nowhere near it.
    const profiles = pageStrips();
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled).toHaveLength(4);
    expect(filled[1].y0[0]).toBeCloseTo(260, 0);
  });
});

describe('stavesToLines', () => {
  test('five lines a step apart, in the shape the head finder takes', () => {
    const strips = 40;
    const y0 = new Float32Array(strips).fill(100);
    const step = new Float32Array(strips).fill(12);
    const [staff] = stavesToLines([{ y0, step }], strips);
    expect(staff.lines).toHaveLength(5);
    expect(staff.lines[0].at[0]).toBeCloseTo(100, 5);
    expect(staff.lines[4].at[0]).toBeCloseTo(148, 5);
    expect(staff.lines[2].mid).toBeCloseTo(124, 5);
    expect(staff.space).toBeCloseTo(12, 5);
  });

  test('a sagging stave sags on every line together', () => {
    const strips = 40;
    const y0 = Float32Array.from({ length: strips }, (_, s) => 100 + s * 0.2);
    const step = new Float32Array(strips).fill(12);
    const [staff] = stavesToLines([{ y0, step }], strips);
    for (let k = 0; k < 5; k++) {
      expect(staff.lines[k].at[39] - staff.lines[k].at[0]).toBeCloseTo(7.8, 1);
    }
  });
});

// A page 120×60: one horizontal beam 5px thick, with a notehead hanging off it.
function beamAndHead() {
  const w = 120;
  const h = 60;
  const ink = new Uint8Array(w * h);
  const set = (x, y) => { ink[y * w + x] = 1; };
  for (let x = 10; x < 100; x++) for (let y = 20; y < 25; y++) set(x, y);   // beam
  for (let x = 55; x < 70; x++) {                                           // head
    for (let y = 25; y < 37; y++) {
      if (((x - 62) / 7) ** 2 + ((y - 31) / 6) ** 2 <= 1) set(x, y);
    }
  }
  return { ink, w, h };
}

describe('beamMask', () => {
  test('the beam goes', () => {
    const { ink, w, h } = beamAndHead();
    const body = beamMask(ink, w, h, 12);
    expect(body[22 * w + 20]).toBe(0);
    expect(body[22 * w + 90]).toBe(0);
  });

  test('the notehead stays', () => {
    const { ink, w, h } = beamAndHead();
    const body = beamMask(ink, w, h, 12);
    expect(body[31 * w + 62]).toBe(1);
    let left = 0;
    for (let y = 25; y < 37; y++) for (let x = 55; x < 70; x++) left += body[y * w + x];
    expect(left).toBeGreaterThan(90);        // the head is essentially untouched
  });

  test('a notehead on its own is never mistaken for a beam', () => {
    const w = 60;
    const h = 40;
    const ink = new Uint8Array(w * h);
    for (let x = 20; x < 35; x++) {
      for (let y = 14; y < 26; y++) {
        if (((x - 27) / 7) ** 2 + ((y - 20) / 6) ** 2 <= 1) ink[y * w + x] = 1;
      }
    }
    const body = beamMask(ink, w, h, 12);
    expect([...body].reduce((a, b) => a + b, 0)).toBe([...ink].reduce((a, b) => a + b, 0));
  });

  test('a merged double beam goes as one, because it measures itself', () => {
    // Two 4px beams with a 3px gap, blurred into one 11px bar — the case a
    // fixed thickness cut could not survive.
    const w = 120;
    const h = 60;
    const ink = new Uint8Array(w * h);
    for (let x = 10; x < 100; x++) for (let y = 20; y < 31; y++) ink[y * w + x] = 1;
    const body = beamMask(ink, w, h, 12);
    expect(body[25 * w + 55]).toBe(0);
  });
});

describe('realStaff', () => {
  test('a staff with noteheads is real', () => {
    expect(realStaff({ heads: [{ x: 0.1 }], bars: [] })).toBe(true);
  });

  test('a staff with only barlines is real — a bar of rests is still a bar', () => {
    expect(realStaff({ heads: [], bars: [0.1, 0.9] })).toBe(true);
  });

  test('a staff with neither is the gradient, not a stave', () => {
    expect(realStaff({ heads: [], bars: [] })).toBe(false);
  });

  test('missing fields are not a stave', () => {
    expect(realStaff({})).toBe(false);
    expect(realStaff(null)).toBe(false);
  });
});

// A stave as `dropDoubledHeads` needs it: five flat lines a space apart, at a
// given top, replicated across all forty strips. `w` is 400 so strip 10 covers
// x = 100 to 110 and the arithmetic in the test is readable.
function staveAt(top, space = 14, strips = 40) {
  const at = (y) => new Array(strips).fill(y);
  return {
    staff: {
      space,
      lines: [0, 1, 2, 3, 4].map((k) => ({ at: at(top + k * space) })),
    },
    heads: [],
  };
}

describe('dropDoubledHeads', () => {
  // The bug this exists for: system 2's high ledger note is 1.5 spaces above
  // its own stave and 7 spaces below the one before it, and both staves' search
  // bands reach it. Two staves 13 spaces apart, the head at y = 217.
  const twoSystems = () => [staveAt(49), staveAt(49 + 14 * 13)];

  test('one piece of ink reported by two staves goes to the nearer one', () => {
    const [A, B] = twoSystems();
    A.heads = [{ x: 100, y: 217 }];
    B.heads = [{ x: 100, y: 217 }];
    dropDoubledHeads([A, B], 400);
    expect(A.heads).toHaveLength(0);
    expect(B.heads).toEqual([{ x: 100, y: 217 }]);
  });

  test('…and the same the other way up: ink below system 1 stays with system 1', () => {
    const [A, B] = twoSystems();
    // Two spaces BELOW A's bottom line (y = 105), far above B's top (231).
    A.heads = [{ x: 100, y: 133 }];
    B.heads = [{ x: 100, y: 133 }];
    dropDoubledHeads([A, B], 400);
    expect(A.heads).toEqual([{ x: 100, y: 133 }]);
    expect(B.heads).toHaveLength(0);
  });

  test('a head between its own five lines always wins — it scores zero outside', () => {
    const [A, B] = twoSystems();
    A.heads = [{ x: 100, y: 80 }];
    B.heads = [{ x: 100, y: 80 }];
    dropDoubledHeads([A, B], 400);
    expect(A.heads).toHaveLength(1);
    expect(B.heads).toHaveLength(0);
  });

  test('two different notes are not one piece of ink, however close the staves', () => {
    const [A, B] = twoSystems();
    A.heads = [{ x: 100, y: 217 }];
    B.heads = [{ x: 140, y: 217 }];   // nearly three spaces apart in x
    dropDoubledHeads([A, B], 400);
    expect(A.heads).toHaveLength(1);
    expect(B.heads).toHaveLength(1);
  });

  test('a chord in thirds keeps every head — the rule never looks inside one stave', () => {
    const A = staveAt(49);
    A.heads = [{ x: 100, y: 91 }, { x: 100, y: 98 }, { x: 100, y: 105 }];
    dropDoubledHeads([A], 400);
    expect(A.heads).toHaveLength(3);
  });

  test('two staves that OVERLAP are one system found twice, and are left alone', () => {
    // photo10: staves 30px apart where the real system gap is 157. Both
    // descriptions are the same five lines, so "nearer" names nothing.
    const A = staveAt(65, 9.7);
    const B = staveAt(95, 9.7);
    A.heads = [{ x: 100, y: 120 }];
    B.heads = [{ x: 100, y: 120 }];
    dropDoubledHeads([A, B], 400);
    expect(A.heads).toHaveLength(1);
    expect(B.heads).toHaveLength(1);
  });

  test('no head is ever invented, and the count can only fall by the doubles', () => {
    const [A, B] = twoSystems();
    A.heads = [{ x: 100, y: 217 }, { x: 200, y: 80 }];
    B.heads = [{ x: 100, y: 217 }, { x: 300, y: 300 }];
    const before = A.heads.length + B.heads.length;
    dropDoubledHeads([A, B], 400);
    expect(A.heads.length + B.heads.length).toBe(before - 1);
  });

  test('one stave on the page is never touched', () => {
    const A = staveAt(49);
    A.heads = [{ x: 100, y: 217 }];
    expect(dropDoubledHeads([A], 400)[0].heads).toHaveLength(1);
  });
});

// WHICH CLEF NAMES THIS NOTE.
//
// The stave's own reading until the first mid-system change, then whichever
// change was last printed at or before the note. Pinned as a decision rather
// than left to a reading of the loop: on an engraved page with a C-clef printed
// halfway through each system, twenty-four of forty-eight notes came back a
// ninth wrong — the step right on every one — because the pitch was named from
// `staff.clef` alone. See findClefChanges.
describe('clefHere', () => {
  const stave = (changes) => ({ clef: 'bass', clefConfidence: 0.8, clefChanges: changes });

  test('a stave with no change answers its own clef everywhere', () => {
    const s = stave([]);
    expect(clefHere(s, 0.1).clef).toBe('bass');
    expect(clefHere(s, 0.9).clef).toBe('bass');
    expect(clefHere(s, 0.9).clefConfidence).toBe(0.8);
  });

  test('a change governs from where it is printed to the end of the system', () => {
    const s = stave([{ x: 0.5, clef: 'tenor', confidence: 0.9 }]);
    expect(clefHere(s, 0.49).clef).toBe('bass');
    expect(clefHere(s, 0.5).clef).toBe('tenor');
    expect(clefHere(s, 0.99).clef).toBe('tenor');
    expect(clefHere(s, 0.6).clefConfidence).toBe(0.9);
  });

  test('two changes on one system each govern their own stretch', () => {
    // What a cello part does: up into tenor for a phrase, back down to bass.
    const s = stave([
      { x: 0.3, clef: 'tenor', confidence: 0.9 },
      { x: 0.7, clef: 'alto', confidence: 0.8 },
    ]);
    expect(clefHere(s, 0.2).clef).toBe('bass');
    expect(clefHere(s, 0.4).clef).toBe('tenor');
    expect(clefHere(s, 0.8).clef).toBe('alto');
  });

  test('a stave whose own clef was refused stays refused before the change', () => {
    // Null is propagated and never defaulted — the rule everywhere else in this
    // reader — and a change does not retroactively name what came before it.
    const s = { clef: null, clefConfidence: 0, clefChanges: [{ x: 0.5, clef: 'tenor', confidence: 1 }] };
    expect(clefHere(s, 0.2).clef).toBeNull();
    expect(clefHere(s, 0.6).clef).toBe('tenor');
  });

  test('a stave with nothing on it at all does not throw', () => {
    expect(clefHere(undefined, 0.5).clef).toBeNull();
    expect(clefHere({}, 0.5).clef).toBeNull();
  });
});

// The arithmetic a C-clef found mid-system feeds. ALTO was added with
// findClefChanges: the same scan that finds a tenor C-clef finds an alto one,
// and detecting a glyph and then refusing to name it would be a bug wearing the
// clothes of caution. This table has been written wrong twice in this project,
// both times for a C-clef, so it is checked the only way that works — against
// the one note the clef names.
describe('a C-clef names one line, and that settles the stave', () => {
  const NONE = { alter: [0, 0, 0, 0, 0, 0, 0] };

  test('tenor puts middle C on the fourth line and alto on the third', () => {
    expect(pitchOf(6, 'tenor', NONE).midi).toBe(60);
    expect(pitchOf(4, 'alto', NONE).midi).toBe(60);
  });

  test('the four clefs are a third apart in the order they name their lines', () => {
    // Bottom line: bass G2, tenor D3, alto F3, treble E4.
    expect(pitchOf(0, 'bass', NONE).midi).toBe(43);
    expect(pitchOf(0, 'tenor', NONE).midi).toBe(50);
    expect(pitchOf(0, 'alto', NONE).midi).toBe(53);
    expect(pitchOf(0, 'treble', NONE).midi).toBe(64);
  });

  test('an alto page reads a third above the same steps in tenor, everywhere', () => {
    // A THIRD IS NOT A FIXED NUMBER OF SEMITONES, which is the whole reason
    // pitchOf carries a degree table instead of multiplying. The first draft of
    // this test asserted a constant 3 and failed on the steps where the third
    // is major. What IS constant is the DEGREE: two letters apart, always.
    for (const step of [-4, 0, 3, 6, 9, 12]) {
      const gap = pitchOf(step, 'alto', NONE).midi - pitchOf(step, 'tenor', NONE).midi;
      expect(gap === 3 || gap === 4).toBe(true);
      const a = pitchOf(step, 'alto', NONE).degree;
      const t = pitchOf(step, 'tenor', NONE).degree;
      expect(((a - t) % 7 + 7) % 7).toBe(2);
    }
  });

  test('a clef nobody read still names nothing', () => {
    expect(pitchOf(0, null, NONE)).toBeNull();
    expect(pitchOf(0, 'alto', null)).toBeNull();
  });
});
