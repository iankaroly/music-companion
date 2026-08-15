import { describe, test, expect } from 'vitest';
import { clefFeatures, classifyClef } from '../src/analysis/scan-clef.js';

// A column of ink density, one entry per row, covering three staff spaces above
// the top line and three below the bottom one. `from` and `to` are in staff
// spaces measured from the top line, so 0..4 is exactly the stave.
function column({ space = 10, from, to, height = 10 }) {
  const rows = new Float32Array(space * height);
  const start = Math.round((from + 3) * space);
  // Inclusive of the last row: the extent is where the ink ENDS, so a band
  // described as reaching 4 spaces has its final inked row at 4 spaces, not one
  // row short of it.
  const end = Math.round((to + 3) * space);
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

describe('classifyClef', () => {
  test('ink far above and below the stave is a treble clef', () => {
    const f = clefFeatures(column({ from: -1.5, to: 5.5 }), 10);
    expect(classifyClef(f).clef).toBe('treble');
  });

  test('ink confined to the top three spaces is a bass clef', () => {
    const f = clefFeatures(column({ from: 0, to: 2.6 }), 10);
    expect(classifyClef(f).clef).toBe('bass');
  });

  test('ink filling the stave and no more is a C-clef', () => {
    const f = clefFeatures(column({ from: 0.1, to: 3.9 }), 10);
    expect(classifyClef(f).clef).toBe('tenor');
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
