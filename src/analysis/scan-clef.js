// Which clef a stave is written in, read off the paper.
//
// This is the file that breaks the cycle. scan-pitch.js works out the clef from
// the RECORDING — it fits the one unknown offset from the pitches you produced
// — so the page's notes depend on the take being correctly placed, and placing
// the take depends on the page's notes. Each waits for the other, and neither
// can check the other. When the placement went wrong, which it does because
// shape-only matching cannot survive a missed notehead, everything downstream
// inherited it in silence and reported itself sure.
//
// A clef is ink at a known place, and it does not care what you played.
//
// HOW THREE CLEFS ARE TOLD APART WITHOUT LEARNING ANYTHING
//
// Not by their shape. By where they reach:
//
//   treble   spirals well above the top line and hangs below the bottom one —
//            six or seven staff spaces of ink for a stave four spaces tall
//   bass     two dots and a hook in the TOP THREE spaces; its ink stops before
//            the bottom line and never approaches it
//   C-clef   fills the stave and almost exactly the stave, built symmetrically
//            about its own waist
//
// Those three separate on extent and symmetry alone, which is a handful of
// numbers off an ink profile rather than a model that has to be trained, hosted
// and shipped. It will not survive a hand-copied part, and does not have to: a
// clef this cannot read is REFUSED, and a refused clef costs the verdicts on
// that stave rather than inventing them.
//
// Why refusing matters more here than almost anywhere else: a cello part is in
// bass clef most of the time, so guessing bass would be right most of the time
// and a sixth out the rest — and a page of confident wrong verdicts teaches
// somebody to play out of tune.

// How far outside the stave the clef zone is sampled, in staff spaces.
const MARGIN = 3;

// Below this a row is paper, not ink. Low, because a photographed clef is grey
// at its edges and the extent is exactly what is being measured.
const INK = 0.12;

// The stave runs THROUGH the clef, and it is inked right across the band.
//
// Found by the benchmark on the day this was written: every bass clef measured
// down to 4.17 spaces and every C-clef the same, which is not a clef, it is the
// bottom line of the stave. Ink alone cannot tell a clef from the five lines it
// stands on — but thickness can. A staff line is a tenth of a space; the
// thinnest part of any clef is several times that.
//
// So the extent is measured over vertical RUNS of inked rows, and a run too
// thin to be part of a symbol is the stave and is dropped. Where a clef crosses
// a line the two merge into one thick run and are kept, which is right: that
// row does carry clef.
const THINNEST = 0.42;

/**
 * Ink extent of one horizontal band, measured in staff spaces from the top line.
 *
 * `column` is one value per row — the fraction of that band's columns inked —
 * beginning MARGIN staff spaces above the top line. `space` is rows per space.
 *
 * Returns null when there is not enough ink to measure, which is the honest
 * answer for a stave whose head was cropped off the edge of the photograph.
 */
export function clefFeatures(column, space) {
  if (!column?.length || !(space > 0)) return null;
  const minRun = Math.max(2, Math.round(THINNEST * space));
  let first = -1;
  let last = -1;
  let weighted = 0;
  let total = 0;
  // Walked as runs rather than as rows, so the five lines the clef is standing
  // on do not get to vote on how far down it reaches.
  let i = 0;
  while (i < column.length) {
    if (column[i] < INK) { i++; continue; }
    let end = i;
    while (end + 1 < column.length && column[end + 1] >= INK) end++;
    if (end - i + 1 >= minRun) {
      if (first < 0) first = i;
      last = end;
      for (let r = i; r <= end; r++) { weighted += r * column[r]; total += column[r]; }
    }
    i = end + 1;
  }
  if (first < 0 || total <= 0) return null;
  const toSpaces = (row) => row / space - MARGIN;
  const top = toSpaces(first);
  const bottom = toSpaces(last);
  const centroid = toSpaces(weighted / total);
  const height = bottom - top;
  // How near the centre of MASS sits to the middle of the extent. A C-clef is
  // built symmetrically about its waist; a bass clef is top-heavy by design,
  // and that difference survives a blur that closes its two dots into one.
  const middle = (top + bottom) / 2;
  const symmetry = height > 0 ? 1 - Math.abs(centroid - middle) / height : 0;
  return { top, bottom, height, centroid, symmetry };
}

// A stave is four spaces tall, and every threshold here is read against that
// rather than against pixels, so a page at any size answers the same.
const STAVE = 4;

// Taller than any clef an engraver draws. Ink from the top of the zone to the
// bottom of it is a shadow, a thumb over the lens or the edge of the facing
// page — and left unbounded it would sail through the treble test, which is
// the only one that WANTS to see ink outside the stave.
const TALLEST = STAVE * 2;

// The two boundaries the three clefs actually separate on, both measured off
// real Bravura through the camera spoiling rather than reasoned about:
//
//            top            bottom
//   treble   -1.22..-1.33   5.56..5.61
//   tenor    -1.06..-1.19   3.09..3.17
//   bass     -0.06..-0.22   2.50..3.27
//
// Treble is alone below the stave; tenor is alone above it. Bass and tenor
// overlap completely at the bottom, which is why reading the bottom to tell
// them apart failed on eight of fifteen real glyphs.
const BELOW_STAVE = 4.5;
const ABOVE_STAVE = -0.6;

/**
 * Which clef those measurements are.
 *
 * Returns { clef, confidence }. `clef` null means it could not be told, and the
 * caller must refuse the stave rather than fall back to the commonest answer.
 */
export function classifyClef(features) {
  if (!features) return { clef: null, confidence: 0 };
  const { top, bottom, symmetry } = features;
  if (bottom - top > TALLEST) return { clef: null, confidence: 0 };

  // Treble, by the one thing only a treble does: hang well below the bottom
  // line. Measured at 5.6 spaces where neither other clef passes 3.3, which is
  // the widest margin on the page.
  if (bottom > BELOW_STAVE) {
    return { clef: 'treble', confidence: Math.min(1, (bottom - STAVE) / 1.6) };
  }

  // Bass against tenor, by the TOP.
  //
  // This is the correction the benchmark forced. Both stop around three spaces
  // — 2.5 to 3.3 for a bass, 3.1 to 3.2 for a C-clef — so a rule reading the
  // bottom cannot separate them at all, and the first version of this file read
  // every C-clef as a bass and half the basses as C-clefs. Where they differ is
  // the top: a C-clef in tenor position begins a full space ABOVE the top line
  // (-1.06 to -1.19 measured), a bass clef begins on it (-0.06 to -0.22). A
  // whole space of daylight between them, at every spoiling.
  if (top < ABOVE_STAVE) {
    // Reported as tenor rather than alto because a cello part in a C-clef is in
    // tenor. Alto belongs to the viola, and reading it here would be a guess
    // wearing the clothes of a measurement.
    return { clef: 'tenor', confidence: symmetry };
  }
  if (bottom < STAVE - 0.5) {
    return { clef: 'bass', confidence: Math.min(1, (STAVE - bottom) / 1.5) };
  }
  return { clef: null, confidence: 0 };
}
