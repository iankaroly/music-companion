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
  let first = -1;
  let last = -1;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < column.length; i++) {
    const v = column[i];
    if (v < INK) continue;
    if (first < 0) first = i;
    last = i;
    weighted += i * v;
    total += v;
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

/**
 * Which clef those measurements are.
 *
 * Returns { clef, confidence }. `clef` null means it could not be told, and the
 * caller must refuse the stave rather than fall back to the commonest answer.
 */
export function classifyClef(features) {
  if (!features) return { clef: null, confidence: 0 };
  const { top, bottom, height, symmetry } = features;
  if (height > TALLEST) return { clef: null, confidence: 0 };
  // Treble first: it is the only clef that leaves the stave at BOTH ends, and
  // nothing else comes near its height.
  if (height > STAVE * 1.4 && top < -0.4 && bottom > STAVE - 0.4) {
    return { clef: 'treble', confidence: Math.min(1, height / (STAVE * 1.8)) };
  }
  // Bass: stops well before the bottom line, starts at or above the top one.
  if (bottom < STAVE - 0.8 && top < 1) {
    return { clef: 'bass', confidence: Math.min(1, (STAVE - bottom) / 1.6) };
  }
  // C-clef: fills the stave, near-symmetric. Reported as tenor rather than alto
  // because a cello part in a C-clef is in tenor — alto belongs to the viola,
  // and reading it here would be a guess wearing the clothes of a measurement.
  if (height > STAVE * 0.8 && height < STAVE * 1.3 && symmetry > 0.7) {
    return { clef: 'tenor', confidence: symmetry };
  }
  return { clef: null, confidence: 0 };
}
