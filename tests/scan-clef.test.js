import { describe, test, expect } from 'vitest';
import {
  clefFeatures, classifyClef, midClefAt, midTrebleAt, MARGIN,
} from '../src/analysis/scan-clef.js';

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

// A CLEF PRINTED PART WAY ALONG A SYSTEM.
//
// These pin the SHAPE of the rule, not the numbers in it. The numbers were
// found by sliding the reader's own window along 13,148 windows of the three
// marked photographs and along twenty-two pieces of drawn furniture; that
// measurement lives in `npm run scan:clef`, which is where it belongs, because
// a hand-built column cannot tell you whether a real sharp beats the gate.
// What a unit test CAN pin is that each test is doing the job it claims — so
// each one below moves exactly one thing away from a clef and expects a
// refusal, which is what stops a later round loosening a bound by accident.
describe('midClefAt — a C-clef printed in the middle of a system', () => {
  // A tenor C-clef: waist on line 1, a space below the top line, and here 1.5
  // spaces of glyph either side of it — the three-quarter size an engraver
  // prints mid-system.
  const tenor = () => column({ from: -0.5, to: 2.5 });
  const alto = () => column({ from: 0.5, to: 3.5 });

  test('names the line its waist stands on', () => {
    expect(midClefAt(tenor(), 10).clef).toBe('tenor');
    expect(midClefAt(alto(), 10).clef).toBe('alto');
  });

  test('is size-independent — the same clef at half again the size still reads', () => {
    // The reason this exists at all: classifyClef separates tenor from bass by
    // a single bound on the TOP of the ink, and a three-quarter-size C-clef
    // measured -0.61 against that bound's -0.60. A hundredth of a space.
    for (const half of [1.35, 1.5, 1.75, 2.0, 2.15]) {
      expect(midClefAt(column({ from: 1 - half, to: 1 + half }), 10).clef).toBe('tenor');
    }
  });

  test('a glyph too small to be a clef is refused, and so is one too big', () => {
    expect(midClefAt(column({ from: -0.2, to: 2.2 }), 10)).toBeNull();   // half 1.2
    expect(midClefAt(column({ from: -1.5, to: 3.5 }), 10)).toBeNull();   // half 2.5
  });

  test('a waist that is not on a line is refused rather than rounded onto one', () => {
    // This is the test that carries the whole thing. It is what refuses a
    // printed sharp — the one window of the Bach that passes every other test
    // is an accidental, and it is an accidental inflecting a note in a SPACE.
    // It is also what refuses a chord of thirds, which reads a waist of 1.71.
    expect(midClefAt(column({ from: 0.2, to: 3.2 }), 10)).toBeNull();    // waist 1.7
    expect(midClefAt(column({ from: -0.05, to: 2.95 }), 10)).toBeNull(); // waist 1.45
  });

  test('the waist is read to a quarter of a space, and 0.2 off is still a clef', () => {
    expect(midClefAt(column({ from: -0.3, to: 2.7 }), 10).clef).toBe('tenor');
    expect(midClefAt(column({ from: -0.3, to: 2.7 }), 10).confidence).toBeGreaterThan(0);
  });

  test('two glyphs with paper between them are not one clef', () => {
    // A stack of noteheads with a gap: as tall and as symmetric as a C-clef,
    // and the only thing separating them is that a clef has no hole in it.
    const rows = column({ from: -0.5, to: 2.5 });
    for (let r = Math.round((0.6 + MARGIN) * 10); r <= Math.round((1.4 + MARGIN) * 10); r++) rows[r] = 0;
    expect(midClefAt(rows, 10)).toBeNull();
  });

  test('nothing to read is refused, not guessed', () => {
    expect(midClefAt(null, 10)).toBeNull();
    expect(midClefAt(new Float32Array(120), 10)).toBeNull();
  });

  test('it never answers treble or bass — those are not C-clefs', () => {
    // A treble hangs to 5.6 spaces and a bass stops at 3; neither has a waist
    // on a line, so both come back null rather than being renamed.
    expect(midClefAt(column({ from: -1.3, to: 5.6 }), 10)).toBeNull();
    for (const from of [-0.1, 0, 0.1]) {
      const got = midClefAt(column({ from, to: 3.2 }), 10);
      expect(got === null || got.clef === 'tenor' || got.clef === 'alto').toBe(true);
    }
  });
});

// A TREBLE PRINTED PART WAY ALONG A SYSTEM.
//
// Same discipline as the block above: these pin the SHAPE of the rule and not
// the numbers in it. The numbers came from sliding the reader's own window over
// 58,411 windows — sixty drawn mid-system G clefs at five sizes and two
// spoilings, plus every piece of `npm run scan:clef` furniture — and that
// measurement lives in `scan:clef`, which fails the build if the false-fire
// count is not zero. Two of the tests below could not have been written from a
// drawn page at all: they came off the Bach photograph, where a BARLINE with a
// beamed group on either side reads as a G clef.
describe('midTrebleAt — a treble printed in the middle of a system', () => {
  // A G clef: the G line (line 3) sits at 0.62 of the way down its own ink, so
  // a glyph of height H runs from 3 - 0.62H to 3 + 0.38H.
  //
  // …and the part BELOW the bottom line is drawn at a third of the band rather
  // than filling it, because that is what a tail is. `column` above fills every
  // row it touches, which is a beam and not a clef — measured, a real
  // mid-system G clef covers about 0.3 of the band down there and the Bach's
  // beamed groups cover 0.9.
  const gclef = (height) => {
    const rows = column({ from: 3 - 0.62 * height, to: 3 + 0.38 * height });
    for (let r = Math.round((4.15 + MARGIN) * 10); r < rows.length; r++) {
      if (rows[r] > 0) rows[r] = 0.3;
    }
    return rows;
  };

  test('reads a G clef, and does so at every size', () => {
    for (const height of [3.9, 4.5, 5.0, 6.0, 7.0]) {
      expect(midTrebleAt(gclef(height), 10).clef).toBe('treble');
    }
  });

  test('…and a cue clef too small to reach past the bottom line is refused', () => {
    // Not a hole to plug: this is the SAME size floor scan:clef already records
    // for the C-clef. A G clef of height 3.2 reaches only 4.22 spaces down
    // against a bound of 4.4, and the six of sixty the detector misses are all
    // at em 0.6. Refusing costs the notes after that change; guessing at a
    // depth a stem also reaches would cost a page that has no clef change on it.
    expect(midTrebleAt(gclef(3.6), 10)).toBeNull();   // reaches 4.37
    expect(midTrebleAt(gclef(3.2), 10)).toBeNull();   // reaches 4.22
  });

  test('ink that stops inside the stave is not a treble', () => {
    // The whole margin this rule leans on. Only a treble hangs below the bottom
    // line; a bass stops around 3 spaces and a C-clef around 3.2.
    expect(midTrebleAt(column({ from: -0.1, to: 3.3 }), 10)).toBeNull();
    expect(midTrebleAt(column({ from: -1.2, to: 3.2 }), 10)).toBeNull();
  });

  test('the G line has to fall where a G clef puts it', () => {
    // Same depth, same height, anchored wrong: 0.62 of the way down is what
    // makes this a reading rather than "deep ink".
    expect(midTrebleAt(column({ from: 0.0, to: 5.0 }), 10)).toBeNull();
    expect(midTrebleAt(column({ from: -2.0, to: 5.0 }), 10)).toBeNull();
  });

  test('two glyphs with paper between them are not one clef', () => {
    const rows = gclef(5);
    for (let r = Math.round((1.0 + MARGIN) * 10); r <= Math.round((1.8 + MARGIN) * 10); r++) rows[r] = 0;
    expect(midTrebleAt(rows, 10)).toBeNull();
  });

  test('a BEAM below the stave is not a clef tail — the Bach photograph', () => {
    // This one is not hypothetical and it is not synthetic. Every bar of the
    // BWV 1007 Prélude is beamed semiquavers with the stems DOWN, so the beams
    // hang below the bottom line; a window holding a barline with a beamed group
    // on either side is continuous from above the stave to well below it, and
    // reads as a G clef on every other test here. What it cannot fake is that a
    // beam runs right ACROSS the band where a clef's tail is a hook.
    //
    // The clef and the beam differ in ONE number here and in nothing else: the
    // rows below the bottom line read 0.3 of the band or 1.0 of it.
    const clef = gclef(5);
    expect(midTrebleAt(clef, 10).clef).toBe('treble');
    const beam = gclef(5);
    for (let r = Math.round((4.3 + MARGIN) * 10); r <= Math.round((4.9 + MARGIN) * 10); r++) beam[r] = 1;
    expect(midTrebleAt(beam, 10)).toBeNull();
  });

  test('nothing to read is refused, not guessed', () => {
    expect(midTrebleAt(null, 10)).toBeNull();
    expect(midTrebleAt(new Float32Array(120), 10)).toBeNull();
  });
});
