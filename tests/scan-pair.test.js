import { describe, it, expect } from 'vitest';
import { pairNotes } from '../src/ui/scan-view.js';
import { semitonesForStep, fitPitches } from '../src/analysis/scan-pitch.js';

// A page of music, as the reader would have measured it: a notehead's position
// on the stave, its page, its stave and its bar.
const PART = (() => {
  const out = [];
  let at = 0;
  let seed = 8675309;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 120; i++) {
    const r = next();
    const move = r < 0.1 ? 0 : (r < 0.55 ? 1 : (r < 0.85 ? 2 : 4));
    at += next() < 0.5 ? -move : move;
    at = Math.max(-6, Math.min(12, at));
    out.push(at);
  }
  return out;
})();

const heads = PART.map((step, i) => ({
  step, x: (i % 8) / 8, y: 0.5,
  page: Math.floor(i / 40), staff: Math.floor(i / 8) % 5, bar: i % 4,
}));

// Playing the page: the written position becomes a pitch through one offset,
// which is what a clef is.
const BASE = 43;                       // the bottom line of a bass stave
const play = (steps, from = 0) => steps.map((step, i) => ({
  midi: BASE + semitonesForStep(step), start: (from + i) * 0.25, end: (from + i) * 0.25 + 0.2, cents: 0,
}));

describe('putting played notes on the noteheads they belong to', () => {
  it('fits the one unknown a clef represents', () => {
    const fit = fitPitches(heads, play(PART.slice(0, 40)), 0);
    expect(fit.base).toBe(BASE);
    expect(fit.agreement).toBeGreaterThan(0.95);
  });

  it('places a take played from the top', () => {
    const played = play(PART.slice(0, 40));
    const { marks, placed } = pairNotes(heads, played);
    expect(placed).toBe(true);
    expect(marks).toHaveLength(40);
    // Note k is on notehead k.
    expect(marks[0].step).toBe(PART[0]);
    expect(marks[39].step).toBe(PART[39]);
  });

  it('places a take played from the middle of the part', () => {
    const played = play(PART.slice(50, 95), 50);
    const { marks, placed } = pairNotes(heads, played);
    expect(placed).toBe(true);
    expect(marks[0].step).toBe(PART[50]);
    expect(marks.at(-1).step).toBe(PART[94]);
  });

  // The one this file exists for. Counting off in order is right until the
  // first slip and wrong for the whole rest of the take after it.
  it('survives a note left out in the middle', () => {
    const steps = [...PART.slice(0, 45)];
    const played = play([...steps.slice(0, 20), ...steps.slice(21)]);
    const { marks, aligned } = pairNotes(heads, played);
    expect(aligned).toBe(true);
    // The notes after the gap are still on their own noteheads: the 30th note
    // played is the 31st written, because one was skipped.
    const late = marks.find((m) => m.index === 30);
    expect(late.step).toBe(PART[31]);
  });

  it('survives an extra note nobody wrote', () => {
    const steps = PART.slice(0, 45);
    const played = play(steps);
    // A squeak between the 15th and 16th, at a pitch of its own.
    played.splice(15, 0, { midi: BASE + 6, start: 3.7, end: 3.75, cents: 0 });
    const { marks, aligned } = pairNotes(heads, played);
    expect(aligned).toBe(true);
    // Everything after the squeak is still where it belongs: the 25th note
    // played is the 24th written.
    const after = marks.find((m) => m.index === 25);
    expect(after.step).toBe(PART[24]);
  });

  it('survives a bar played twice', () => {
    const steps = PART.slice(0, 40);
    const played = play([...steps.slice(0, 16), ...steps.slice(12, 16), ...steps.slice(16)]);
    const { marks, placed } = pairNotes(heads, played);
    expect(placed).toBe(true);
    // The take is longer than the stretch of page it covers, and the notes
    // after the repeat are still on the right side of it.
    expect(marks.length).toBeGreaterThan(35);
    expect(marks.at(-1).step).toBe(PART[39]);
  });

  it('still refuses a take that is not this music', () => {
    const nothing = Array.from({ length: 30 }, (_, i) => ({
      midi: 40 + ((i * 7) % 13), start: i * 0.25, end: i * 0.25 + 0.2, cents: 0,
    }));
    const { placed, marks } = pairNotes(heads, nothing);
    expect(placed).toBe(false);
    expect(marks).toHaveLength(0);
  });

  it('falls back to counting off when the pitches cannot be fitted', () => {
    // Positions the reader never measured: there is nothing to fit a clef to.
    const blind = heads.map(({ step, ...rest }) => rest);
    const { placed } = pairNotes(blind, play(PART.slice(0, 40)));
    // Nothing can be placed at all without positions, and it says so rather
    // than putting the take on the first forty noteheads.
    expect(placed).toBe(false);
  });
});
