import { describe, it, expect } from 'vitest';
import { barsOf, scanTiming } from '../src/analysis/scan-timing.js';

// A take, built from the outside in: bars of a known length, notes evenly
// spread inside them unless asked otherwise. `marks` are what the review pairs
// — a notehead the page reader found, with the note that was played on it.
function take({ bars = 8, per = 4, barLength = 2, gaps = null, jitter = 0, staffEvery = 4 } = {}) {
  const marks = [];
  let t = 0;
  for (let b = 0; b < bars; b++) {
    const length = typeof barLength === 'function' ? barLength(b) : barLength;
    for (let k = 0; k < per; k++) {
      // Where this note sits inside its bar, as a fraction.
      const at = gaps ? gaps[k % gaps.length] : k / per;
      const start = t + at * length + (jitter ? (((b * 7 + k * 13) % 11) / 11 - 0.5) * jitter : 0);
      marks.push({
        page: Math.floor(b / (staffEvery * 3)),
        staff: Math.floor(b / staffEvery) % 3,
        bar: b % staffEvery,
        note: { start, end: start + length / per * 0.9, cents: 0, midi: 50 },
      });
    }
    t += length;
  }
  return marks;
}

describe('grouping a take into the bars on the page', () => {
  it('groups consecutive notes by the bar changing, not by counting', () => {
    const bars = barsOf(take({ bars: 6, per: 4 }));
    expect(bars).toHaveLength(6);
    expect(bars.every((b) => b.notes.length === 4)).toBe(true);
  });

  it('starts a new bar when the stave changes, even at the same bar number', () => {
    // Bar 0 of stave 0 and bar 0 of stave 1 are different bars, and a numbering
    // that restarts per stave is exactly why this groups on change.
    const marks = [
      { page: 0, staff: 0, bar: 0, note: { start: 0 } },
      { page: 0, staff: 0, bar: 0, note: { start: 0.5 } },
      { page: 0, staff: 1, bar: 0, note: { start: 1 } },
      { page: 0, staff: 1, bar: 0, note: { start: 1.5 } },
    ];
    expect(barsOf(marks)).toHaveLength(2);
  });

  it('ignores notes with no time on them', () => {
    const marks = [
      { page: 0, staff: 0, bar: 0, note: { start: 0 } },
      { page: 0, staff: 0, bar: 0, note: {} },
      { page: 0, staff: 0, bar: 1, note: { start: 1 } },
    ];
    const bars = barsOf(marks);
    expect(bars).toHaveLength(2);
    expect(bars[0].notes).toHaveLength(1);
  });
});

describe('reading the timing off those bars', () => {
  it('says nothing at all from one or two bars', () => {
    expect(scanTiming(take({ bars: 2 }))).toBeNull();
  });

  it('finds a steady take steady, and times its bars', () => {
    const report = scanTiming(take({ bars: 8, per: 4, barLength: 2 }));
    expect(report.bars).toBe(8);
    expect(report.barLength).toBeCloseTo(2, 1);
    expect(report.barsPerMinute).toBeCloseTo(30, 0);
    expect(report.steadiness).toBeGreaterThan(0.95);
    expect(report.verdict).toBe('steady');
  });

  it('catches a take that speeds up', () => {
    // Each bar four per cent shorter than the last.
    const report = scanTiming(take({ bars: 10, per: 4, barLength: (b) => 2 * (0.96 ** b) }));
    expect(report.verdict).toBe('rushing');
    expect(report.drift).toBeLessThan(0);
  });

  it('catches a take that slows down', () => {
    const report = scanTiming(take({ bars: 10, per: 4, barLength: (b) => 2 * (1.04 ** b) }));
    expect(report.verdict).toBe('dragging');
    expect(report.drift).toBeGreaterThan(0);
  });

  it('points at the bar that stands out', () => {
    const marks = take({ bars: 8, per: 4, barLength: (b) => (b === 5 ? 3.6 : 2) });
    const report = scanTiming(marks);
    expect(report.worstBar.length).toBeCloseTo(3.6, 1);
  });

  // The assumption this whole file turns on, checked in both directions.
  it('gives a per-note verdict when the notes ARE evenly spread', () => {
    const report = scanTiming(take({ bars: 8, per: 4, barLength: 2 }));
    expect(report.evenNotes).toBe(true);
    expect(report.notes).toHaveLength(32);
    expect(report.meanOffMs).toBeLessThan(30);
  });

  it('and REFUSES one when they are not — a dotted rhythm is not four equal notes', () => {
    // Long-short-long-short: the shape a per-note verdict would libel.
    const report = scanTiming(take({ bars: 8, per: 4, barLength: 2, gaps: [0, 0.375, 0.5, 0.875] }));
    expect(report.evenNotes).toBe(false);
    expect(report.notes).toHaveLength(0);
    expect(report.meanOffMs).toBeNull();
    // …but the BARS are still reported, because they need no assumption.
    expect(report.bars).toBe(8);
    expect(report.steadiness).toBeGreaterThan(0.9);
  });

  it('survives a barline the reader saw that is not a bar', () => {
    const marks = take({ bars: 8, per: 4, barLength: 2 });
    // A stray two-note bar a tenth of the length of a real one, as a repeat
    // sign counted twice would give.
    marks.splice(12, 0,
      { page: 0, staff: 9, bar: 9, note: { start: 5.98, end: 6.0 } },
      { page: 0, staff: 9, bar: 9, note: { start: 6.0, end: 6.02 } });
    const report = scanTiming(marks);
    expect(report.barLength).toBeCloseTo(2, 1);
    expect(report.steadiness).toBeGreaterThan(0.9);
  });

  it('is not thrown by an unsteady hand', () => {
    const report = scanTiming(take({ bars: 10, per: 4, barLength: 2, jitter: 0.06 }));
    expect(report.verdict).toBe('steady');
    expect(report.steadiness).toBeGreaterThan(0.8);
  });
});
