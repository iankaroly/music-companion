import { describe, test, expect } from 'vitest';
import { clefFeatures, classifyClef, MARGIN } from '../src/analysis/scan-clef.js';

// A column of ink density, one entry per row. `from` and `to` are in staff
// spaces measured from the top line, so 0..4 is exactly the stave.
//
// The origin is MARGIN, imported rather than restated: the window is asymmetric
// — short above the stave where the bar numbers and pencil live, long below it
// where only a treble clef reaches — and a test that hard-codes the old
// symmetric 3 measures every extent 1.6 spaces adrift while claiming the code
// changed behaviour it had not.
function column({ space = 10, from, to, height = 12 }) {
  const rows = new Float32Array(space * height);
  const start = Math.round((from + MARGIN) * space);
  // Inclusive of the last row: the extent is where the ink ENDS, so a band
  // described as reaching 4 spaces has its final inked row at 4 spaces, not one
  // row short of it.
  const end = Math.round((to + MARGIN) * space);
  for (let i = Math.max(0, start); i <= Math.min(rows.length - 1, end); i++) rows[i] = 1;
  return rows;
}

describe('clefFeatures', () => {
  test('measures ink extent in staff spaces from the top line', () => {
    const f = clefFeatures(column({ from: 0, to: 4 }), 10);
    expect(f.top).toBeCloseTo(0, 1);
    expect(f.bottom).toBeCloseTo(4, 1);
    expect(f.height).toBeCloseTo(4, 1);
  });

  test('an empty column has no features', () => {
    expect(clefFeatures(new Float32Array(100), 10)).toBeNull();
  });

  test('nothing to measure against is refused', () => {
    expect(clefFeatures(null, 10)).toBeNull();
    expect(clefFeatures(column({ from: 0, to: 4 }), 0)).toBeNull();
  });
});

describe('clefFeatures ignores the stave it is measured against', () => {
  // A staff line crosses the clef zone like everything else in that band, and
  // it is inked across the whole width of it. Counted as clef ink it pins the
  // extent to the stave: a bass clef that stops at three spaces measured 4.17,
  // which is the bottom line, and every C-clef measured the same. A clef is
  // thick; a staff line is not.
  function withLines(base, { space = 10, lines = [0, 1, 2, 3, 4], thickness = 0.1 }) {
    const rows = Float32Array.from(base);
    for (const l of lines) {
      const from = Math.round((l + MARGIN) * space);
      const to = Math.round((l + MARGIN + thickness) * space);
      for (let i = from; i <= to && i < rows.length; i++) rows[i] = 1;
    }
    return rows;
  }

  test('a bass clef keeps its own extent with the stave drawn through it', () => {
    const bare = column({ from: 0, to: 2.6 });
    const f = clefFeatures(withLines(bare, {}), 10);
    expect(f.bottom).toBeLessThan(3.2);
  });

  test('the staff lines alone are not a clef at all', () => {
    const empty = new Float32Array(10 * 10);
    expect(clefFeatures(withLines(empty, {}), 10)).toBeNull();
  });
});

// The extents below are MEASURED, not invented — they are what tools/
// scan-clef-check.mjs reads off real Bravura glyphs through the camera
// spoiling, across clean, blurred, faint, photographed and small. The first
// version of these tests carried my own idea of where a clef reaches, which
// said a C-clef fills the stave and no more. It does not: in tenor position it
// starts a space ABOVE the top line, and that is the thing that separates it
// from a bass clef. Rules tuned against the invented numbers read five of the
// fifteen real glyphs wrong.
describe('classifyClef', () => {
  test('a treble clef hangs far below the bottom line', () => {
    // Measured -1.22..5.56 clean, -1.33..5.61 small.
    const f = clefFeatures(column({ from: -1.3, to: 5.6 }), 10);
    expect(classifyClef(f).clef).toBe('treble');
  });

  test('a bass clef starts AT the top line and stops short of the bottom', () => {
    // Measured -0.06..2.50 clean, -0.22..3.27 photographed.
    expect(classifyClef(clefFeatures(column({ from: -0.06, to: 2.5 }), 10)).clef).toBe('bass');
    expect(classifyClef(clefFeatures(column({ from: -0.22, to: 3.27 }), 10)).clef).toBe('bass');
  });

  test('a C-clef in tenor position starts ABOVE the top line', () => {
    // Measured -1.06..3.17 clean, -1.19..3.11 small.
    expect(classifyClef(clefFeatures(column({ from: -1.06, to: 3.17 }), 10)).clef).toBe('tenor');
    expect(classifyClef(clefFeatures(column({ from: -1.19, to: 3.11 }), 10)).clef).toBe('tenor');
  });

  test('bass and tenor are separated by the top, which is where they differ', () => {
    // The two sit 1 space apart at the top and overlap at the bottom, so a rule
    // reading the bottom cannot tell them apart at all.
    const bass = clefFeatures(column({ from: -0.22, to: 3.27 }), 10);
    const tenor = clefFeatures(column({ from: -1.06, to: 3.17 }), 10);
    expect(bass.bottom).toBeGreaterThan(tenor.bottom);
    expect(classifyClef(bass).clef).not.toBe(classifyClef(tenor).clef);
  });

  test('nothing to read is refused rather than guessed', () => {
    expect(classifyClef(null).clef).toBeNull();
    expect(classifyClef(null).confidence).toBe(0);
  });

  test('a smear across the whole zone is not a clef', () => {
    // Ink from well above to well below, but filling everything — which is what
    // a thumb over the lens gives, and it must not read as a treble.
    const f = clefFeatures(column({ from: -3, to: 7 }), 10);
    expect(classifyClef(f).clef).toBeNull();
  });
});

// Measured through readPage rather than off a column sampled by hand, which is
// where the bass rule was first found to be fitted to its measurement instead
// of to a clef: 15/15 sampled directly and 1/4 end to end, because readPage
// takes a slightly different band and a bass clef's bottom has barely a third
// of a space of margin against the bottom line.
describe('bass is the residual, not a boundary', () => {
  test('a bass clef reads whether it stops at 2.5 spaces or at 3.4', () => {
    for (const to of [2.5, 2.7, 3.0, 3.27, 3.4]) {
      const f = clefFeatures(column({ from: -0.1, to }), 10);
      expect(classifyClef(f).clef).toBe('bass');
    }
  });

  test('a speck beside the barline is still not a clef', () => {
    const f = clefFeatures(column({ from: 1.0, to: 1.6 }), 10);
    expect(classifyClef(f).clef).toBeNull();
  });

  test('the three stay mutually exclusive', () => {
    const treble = clefFeatures(column({ from: -1.3, to: 5.6 }), 10);
    const tenor = clefFeatures(column({ from: -1.1, to: 3.15 }), 10);
    const bass = clefFeatures(column({ from: -0.1, to: 3.27 }), 10);
    expect(classifyClef(treble).clef).toBe('treble');
    expect(classifyClef(tenor).clef).toBe('tenor');
    expect(classifyClef(bass).clef).toBe('bass');
  });
});
