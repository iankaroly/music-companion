// A practice session, cut into the goes it is made of.
//
// Everything else that joins a page to a recording assumes time moves forward
// through the music once. Practice does not: you play a passage, stop, play it
// again, go back four bars, start from the top. These are the invariants that
// keep that legible — and the one that matters most is that a bar is never
// offered a go that never played it.

import { describe, it, expect } from 'vitest';
import {
  runsIn, placeRuns, goesAt, barAtTimeInRuns, sayRuns,
  samePassage, compareGoes, sayComparison,
} from '../src/analysis/practice-runs.js';
import { barsInReadingOrder } from '../src/analysis/bar-map.js';

const SCALE = [0, 2, 4, 5, 7, 9, 11];
const midiOf = (step) => 48 + Math.floor(step / 7) * 12 + SCALE[((step % 7) + 7) % 7];

// Three systems that do not resemble each other and do not repeat themselves —
// see place-systems.test.js for why a hand-written line will not do.
const walkOf = (seed, length) => {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out = [];
  let at = 14;
  for (let i = 0; i < length; i += 1) {
    out.push(at);
    const move = next();
    const size = move < 0.55 ? 1 : (move < 0.85 ? 2 : 4);
    at += (next() < 0.5 ? -size : size);
    at = Math.max(0, Math.min(30, at));
  }
  return out;
};
const LINES = [walkOf(11, 36), walkOf(29, 36), walkOf(97, 36)];
const systems = LINES.map((steps) => steps.map((step, i) => ({ step, x: i / steps.length })));
const layout = [{
  staves: LINES.map((steps, i) => ({
    top: 0.05 + i * 0.3,
    bottom: 0.05 + i * 0.3 + 0.2,
    space: 0.01,
    bars: [0.5],
    heads: steps.map((step, k) => ({ step, x: k / steps.length })),
  })),
}];

/** Play systems `from` to `to`, starting at `at`, and hand back when it ended. */
const playGo = (into, from, to, at, beat = 0.4) => {
  let t = at;
  for (let s = from; s <= to; s += 1) {
    for (const head of systems[s]) {
      into.push({ midi: midiOf(head.step), start: t, end: t + beat * 0.9 });
      t += beat;
    }
  }
  return t;
};

describe('cutting a take into goes', () => {
  it('splits it at the silences and nowhere else', () => {
    const notes = [];
    let t = playGo(notes, 0, 0, 2);
    t = playGo(notes, 1, 1, t + 4);            // a long think
    playGo(notes, 2, 2, t + 3);
    const runs = runsIn(notes);
    expect(runs).toHaveLength(3);
    expect(runs[0].from).toBeCloseTo(2, 5);
    expect(runs.every((one) => one.to > one.from)).toBe(true);
  });

  it('does not cut a phrase at a breath', () => {
    const notes = [];
    const t = playGo(notes, 0, 0, 2);
    playGo(notes, 1, 1, t + 0.9);              // barely a pause
    expect(runsIn(notes)).toHaveLength(1);
  });

  it('has nothing to say about an empty take', () => {
    expect(runsIn([])).toEqual([]);
    expect(runsIn(null)).toEqual([]);
    expect(sayRuns([])).toMatch(/could be found/);
  });
});

describe('placing each go on the page', () => {
  // A session: the second system four times, then all three, then the second
  // once more — which is what practising one awkward line looks like.
  const notes = [];
  let t = 3;
  const goes = [];
  for (const [from, to] of [[1, 1], [1, 1], [1, 1], [0, 2], [1, 1]]) {
    const started = t;
    t = playGo(notes, from, to, t);
    goes.push({ from, to, start: started, end: t });
    t += 3.5;
  }
  const runs = placeRuns(systems, notes).filter((one) => one.sure);
  const bars = barsInReadingOrder(layout);

  it('finds a go for each stretch of playing', () => {
    expect(runs.length).toBeGreaterThanOrEqual(4);
  });

  it('puts each go where that music actually is on the page', () => {
    for (const run of runs) {
      const mine = goes.find((one) => run.from >= one.start - 0.6 && run.from <= one.end);
      expect(mine).toBeTruthy();
      expect(Math.abs(run.at - mine.from)).toBeLessThan(0.8);
    }
  });

  // THE INVARIANT THIS WHOLE MODEL EXISTS FOR. A bar must never be offered a go
  // that did not play it: pressing it would then play a moment of the recording
  // that is somewhere else entirely, which is worse than offering nothing.
  it('never offers a bar a go that never played it', () => {
    for (const bar of bars) {
      const system = Math.floor(bar.at + 1e-9);
      for (const { run } of goesAt(runs, bar)) {
        const mine = goes.find((one) => run.from >= one.start - 0.6 && run.from <= one.end);
        expect(mine).toBeTruthy();
        expect(system).toBeGreaterThanOrEqual(mine.from);
        expect(system).toBeLessThanOrEqual(mine.to);
      }
    }
  });

  it('offers the practised line more goes than the ones around it', () => {
    const at = (system) => {
      const bar = bars.find((one) => Math.floor(one.at + 1e-9) === system);
      return goesAt(runs, bar).length;
    };
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(1)).toBeGreaterThan(at(2));
  });

  it('hands the goes back in the order they were played, latest last', () => {
    const bar = bars.find((one) => Math.floor(one.at + 1e-9) === 1);
    const times = goesAt(runs, bar).map((one) => one.time);
    expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(true);
  });

  it('says which bar a moment of the recording was in', () => {
    const bar = bars.find((one) => Math.floor(one.at + 1e-9) === 1);
    const when = goesAt(runs, bar).at(-1).time;
    const found = barAtTimeInRuns(runs, bars, when);
    expect(Math.floor(bars[found].at + 1e-9)).toBe(1);
    // …and nothing at all for a moment in one of the silences.
    expect(barAtTimeInRuns(runs, bars, 0.5)).toBe(-1);
  });

  it('counts the goes out loud', () => {
    expect(sayRuns(runs)).toMatch(/goes at this music/);
  });
});

describe('the same passage, played again', () => {
  const spanOf = (at, until, from, to) => ({
    sure: true, at, until, from, to, anchors: [{ at, time: from }], notes: [],
  });

  it('groups the goes that cover the same music', () => {
    const groups = samePassage([
      spanOf(1, 2, 10, 20),
      spanOf(1.05, 2.1, 30, 41),
      spanOf(5, 6, 60, 70),
      spanOf(0.98, 2, 80, 90),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].goes).toHaveLength(3);
  });

  // ONE CONTAINING ANOTHER IS NOT ONE REPEATING IT. A run-through of the whole
  // page overlaps every four-bar go inside it completely, and calling those the
  // same passage would compare four bars against a whole page and then say
  // which was steadier.
  it('does not call a whole run-through the same passage as a bar of it', () => {
    const groups = samePassage([
      spanOf(0, 10, 10, 120),        // the whole page
      spanOf(4, 5, 130, 142),        // one system of it
      spanOf(4, 5, 150, 162),        // …and again
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].goes).toHaveLength(2);
    expect(groups[0].at).toBeCloseTo(4, 5);
  });

  it('has nothing to say about music played once', () => {
    expect(samePassage([spanOf(1, 2, 10, 20), spanOf(5, 6, 30, 40)])).toEqual([]);
  });

  it('compares the goes with the app’s own measures, and refuses what it cannot measure', () => {
    // Two goes at the same music: the second steadier and nearer the middle.
    const wobbly = [];
    const steady = [];
    for (let i = 0; i < 24; i += 1) {
      wobbly.push({ midi: 60, cents: i % 2 ? 22 : -20, start: 10 + i * (0.4 + (i % 3) * 0.13), end: 10 + i * 0.4 + 0.3 });
      steady.push({ midi: 60, cents: i % 2 ? 4 : -3, start: 40 + i * 0.4, end: 40 + i * 0.4 + 0.3 });
    }
    const played = [...wobbly, ...steady];
    const group = {
      at: 1,
      until: 2,
      goes: [spanOf(1, 2, 10, 30), spanOf(1, 2, 40, 60)],
    };
    const out = compareGoes(group, played);
    expect(out.goes).toHaveLength(2);
    expect(out.steadiest.number).toBe(2);
    expect(out.cleanest.number).toBe(2);
    expect(out.centsMoved).toBeLessThan(0);            // nearer the middle
    expect(sayComparison(out)).toMatch(/2 goes at this/);
    expect(sayComparison(out)).toMatch(/nearer the middle/);
  });

  // A PRACTICE TOOL THAT CANNOT SAY "not measurably" IS ONE THAT FLATTERS.
  // Tuning wanders by a couple of cents between any two goes and a pulse by a
  // percent or two; calling that an improvement would make every session look
  // like progress.
  it('says nothing moved when nothing moved by enough to mean anything', () => {
    const notes = [];
    for (const at of [10, 40]) {
      for (let i = 0; i < 24; i += 1) {
        notes.push({ midi: 60, cents: i % 2 ? 5 : -5, start: at + i * 0.4, end: at + i * 0.4 + 0.3 });
      }
    }
    const out = compareGoes({ at: 1, until: 2, goes: [spanOf(1, 2, 10, 30), spanOf(1, 2, 40, 60)] }, notes);
    expect(sayComparison(out)).toMatch(/nothing measurably between them/);
  });

  it('says nothing at all about a group of one', () => {
    expect(compareGoes({ goes: [spanOf(1, 2, 10, 20)] }, [])).toBe(null);
    expect(sayComparison(null)).toBe('');
  });
});
