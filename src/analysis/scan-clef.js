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

// How far outside the stave the clef zone is sampled, in staff spaces — and it
// is NOT the same above as below.
//
// Everything a page puts near the head of a stave that is not the clef sits
// ABOVE it: the printed bar number, a pencil bowing, a dynamic, a fingering.
// Measured on the photograph, the five systems that read wrong had tops of
// -1.60, -2.01, -1.62, -2.18 and -2.19 while the five that read right sat at
// -0.10 to -0.20, and every one of the ten had the same bottom, about 3.0. The
// verdicts differed on ink no clef has, two spaces above the stave.
//
// Below the stave there is only the clef: a treble hangs to 5.6 spaces and
// nothing else reaches down there at the head of a system. So the window is cut
// short above, where the noise is, and left long below, where the evidence is.
const ABOVE = 1.4;
const BELOW = 3;
export const MARGIN = ABOVE;
export const MARGIN_BELOW = BELOW;

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
  // Collected as runs first, then walked from the STAVE UPWARD.
  //
  // A clef is one connected shape standing on the stave. What sits above it —
  // the printed bar number, a pencil bowing, a dynamic — is separate ink with
  // clear paper between. Measured from the topmost run down, that separate ink
  // becomes part of the clef's extent and a bass clef reports a top of -1.4
  // where its own ink starts at -0.1, which is the tenor test firing on a bar
  // number. So the extent stops at the first clear gap: below it is the clef,
  // above it is the page.
  const runs = [];
  let i = 0;
  while (i < column.length) {
    if (column[i] < INK) { i++; continue; }
    let end = i;
    while (end + 1 < column.length && column[end + 1] >= INK) end++;
    if (end - i + 1 >= minRun) runs.push([i, end]);
    i = end + 1;
  }
  // Wide enough to be paper rather than the pale waist of a glyph.
  const gap = Math.max(2, Math.round(space * 0.55));
  const keep = [];
  for (let k = runs.length - 1; k >= 0; k--) {
    const above = runs[k - 1];
    keep.unshift(runs[k]);
    if (above && runs[k][0] - above[1] - 1 >= gap) break;
  }
  for (const [from, to] of keep) {
    if (first < 0) first = from;
    last = to;
    for (let r = from; r <= to; r++) { weighted += r * column[r]; total += column[r]; }
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
// Shorter than any clef and taller than a speck. A bass clef is the smallest
// of the three at about 2.6 spaces; a smudge left by the barline or a fleck of
// grain is a fraction of one.
const SHORTEST = 1.5;
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
    return { clef: 'treble', confidence: Math.max(0, Math.min(1, (bottom - STAVE) / 1.6)) };
  }

  // Tenor next, by the TOP.
  //
  // This is the correction the benchmark forced. Bass and C-clef both STOP
  // around three spaces — 2.5 to 3.3 and 3.1 to 3.2 — so a rule reading the
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

  // Bass is what is left, and it is left DELIBERATELY rather than tested for.
  //
  // Its own measurement is the weakest on the page: a bass clef stops between
  // 2.5 and 3.3 spaces depending on the camera, and the bottom line is at 4, so
  // any threshold drawn between them has a fraction of a space of margin.
  // Tested directly at 3.5 it read fifteen of fifteen sampled by hand and ONE
  // OF FOUR through readPage, which samples a slightly different band — the
  // rule was fitted to a measurement, not to a clef.
  //
  // The three clefs are mutually exclusive and two of them have wide margins:
  // only a treble hangs below the bottom line, only a C-clef starts above the
  // top one. So bass is the residual, and what guards it is not a boundary but
  // a sanity check — ink tall enough to be a symbol at all. A stave whose head
  // is blank or smeared has nothing that tall and still refuses.
  if (bottom - top > SHORTEST) {
    // Clamped at both ends: ink reaching past the bottom line gave a NEGATIVE
    // confidence, which every caller was about to compare against a threshold.
    return { clef: 'bass', confidence: Math.max(0, Math.min(1, (STAVE - bottom) / 1.5)) };
  }
  return { clef: null, confidence: 0 };
}

// A CLEF PRINTED IN THE MIDDLE OF A SYSTEM, which is what a cello part does
// every time it goes up into its high register and comes back down.
//
// WHY classifyClef CANNOT DO THIS JOB, measured before anything was written.
// It is a CHOOSER, not a detector: treble needs ink below the bottom line,
// tenor needs ink above the top one, and BASS IS THE RESIDUAL, guarded only by
// "taller than a speck". So it always answers. Slid along one drawn system with
// no clef change anywhere in it, the reader's own clef window read `bass` at
// 201 x-positions out of 651 and `tenor` at 30. Anything that walks a window
// along a stave and asks classifyClef will find clefs in the music.
//
// It is also, at this size, right by an accident too small to build on. A
// C-clef engraved at three quarters size — which is what an engraver prints
// mid-system — measured a top of -0.61 against ABOVE_STAVE's -0.60. One
// hundredth of a staff space is not a measurement, it is a coin landing on its
// edge, and the coin is a whole system of a cello part named a ninth wrong.
//
// SO THIS IS A DIFFERENT TEST, AND IT IS SIZE-INDEPENDENT BY CONSTRUCTION. A
// C-clef is the only glyph on a page built symmetrically about its own waist
// with that waist standing ON the line it names. Everything else follows from
// those two facts rather than from a height in spaces:
//
//   symmetric         the centre of MASS sits at the middle of the extent
//   waist on a line   within a quarter space of line 1 (tenor) or 2 (alto)
//   continuous        no paper across its height — it is one glyph, not two
//                     noteheads with a gap
//   half a stave to a whole stave tall
//
// WHAT IT WAS TESTED AGAINST, because a detector with no false-fire count gets
// re-broken by the next round. Every window of the three marked photographs —
// 13,148 of them, none of which has a clef change — fires ZERO times. So does
// every one of twenty-four pieces of drawn furniture printed mid-system, clean
// and photographed: a sharp, a flat and a natural inflecting a note ON EACH OF
// THE FIVE LINES (the case whose waist lands exactly where a C-clef's would), a
// thick-and-thin repeat barline with its dots, a double barline, a plain
// barline, a fermata, a forte, a common-time C, a quarter rest, a multi-bar
// rest with its number, and a chord of thirds. `npm run scan:clef` prints the
// count and fails the build if it is not zero.
//
// THE ONE THING THAT BEAT THE SHAPE TESTS was a chord of three notes a third
// apart on a photograph: as tall, as solid and as symmetric as a small C-clef,
// reading height 3.51, symmetry 0.98, continuity 0.97. What it could not fake
// was the WAIST — it came out 1.71, a third of a space off the line — where
// every real C-clef measured here lands within 0.06 of one. That is why naming
// is part of the gate rather than a step after it, and why there is no
// "something is here that I cannot name" refusal: the shape half on its own is
// not specific enough to carry one, and a refusal that fired on every double
// stop would blank half of the Bach suites.
const WAIST_NEAR = 0.25;   // how near the named line the waist must sit
const MIN_HALF = 1.30;     // half-height, in spaces: a clef half a stave tall
const MAX_HALF = 2.20;     // …and no taller than a stave and a bit
const SYM_MIN = 0.90;
const SOLID_MIN = 0.95;    // share of its height with ink across the band
// A row this much of the band inked is ink; below it the row is the paper
// between two separate glyphs. Deliberately well under the 1.0 a staff line
// scores and well over the 0.03 a stem does.
const SOLID_INK = 0.25;

/**
 * The two C-clefs, by where their waist sits, or null.
 *
 * `column` is what clefColumn built: one value per row, the fraction of the
 * band's width inked, beginning MARGIN staff spaces above the top line.
 *
 * Returns { clef, confidence, waist, height } or null. Null is the answer for
 * a barline, an accidental, a rest, a chord, and for a real C-clef too small
 * or too smeared to be sure of — see the note above for what refusing costs
 * and why it is cheaper than the alternative.
 */
// A BASS CLEF STANDING MID-SYSTEM: MEASURED, AND THERE IS NO SUCH TEST.
//
// `midBassAt` used to live here, and it NEVER ONCE READ A BASS CLEF. Slid across
// a real mid-system F clef at 0.72 and 1.0 em, at staff spaces 12 and 16, clean
// and photographed, it returned null at all 80 window positions. Its apparent
// four-of-twelve on `npm run scan:clef-change` came from the following NOTEHEAD
// supplying the bottom the clef never produced.
//
// AND IT FIRED ON EVERYTHING ELSE. Measured on `npm run scan:clef` with that
// function still in, its two MUST-BE-ZERO totals read 155 FALSE FIRES and 118
// NOTES NAMED WRONG on a page whose change was found — it answered `bass` on
// every sharp, every flat, every natural, the barlines, the common-time C and
// the chord of thirds — and the 12-of-12 changes it reported included rows
// where a `bass` was "found" on a page changing to TENOR. Deleting it takes
// both totals to zero. A function that appears to work because of the ink
// beside the thing it is looking at is worse than no function.
//
// AND IT IS GONE BECAUSE IT CANNOT BE FIXED, which is a measurement and not a
// shrug. Every window of every one of those sixty pages plus all twenty-two
// pieces of `npm run scan:clef` furniture at both spoilings — 58,411 windows —
// was swept against every gate that could be built out of this profile: the ink
// extent at four ink floors (0.12 down to 0.04), the F line's position within
// that extent as a fraction of its height (0.31 to 0.41, which IS
// size-independent and does hold), continuity, symmetry, top-heaviness, the
// glyph's width relative to the band, the ratio of its widest row to its
// narrowest, and the required run length from 3 windows to 7. THE MOST
// SENSITIVE GATE READ 41 OF 60 SYSTEMS AND FIRED 88 TIMES ON THE FURNITURE; THE
// QUIETEST THAT READ ANY CLEF AT ALL READ 32 OF 60 AND STILL FIRED 25. Nothing
// in the sweep came near a zero, and a false clef change renames a passage that
// was right.
//
// The reason was already written down in classifyClef above and it is worth
// reading again: BASS IS THE RESIDUAL. Treble is alone below the stave and a
// C-clef is alone above it; a bass clef is recognised by where its ink STOPS,
// and a sharp, a flat, a natural, a common-time C, a quarter rest and a chord
// of thirds all stop in the same place. At the head of a system that costs
// nothing, because there are only three answers and the other two are excluded
// first. Mid-system there is a fourth answer — "nothing, this is music" — and
// the residual cannot carry it.
//
// TWO THINGS THAT ARE NOT THE PROBLEM, so the next round does not re-derive
// them. `INK` (0.12) does truncate a cue-sized F clef: its lower curl covers
// 0.114 of the 3.6-space band against a floor of 0.12, so the glyph reads 1.25
// spaces tall where it is really 2.4, and at a floor of 0.06 the extent comes
// back correct at every size (2.01, 2.51, 2.67, 3.23, 3.56 spaces for em 0.6,
// 0.72, 0.75, 0.9, 1.0). `BASS_SOLID` (0.8) did refuse even a full-size clef,
// because solidity was taken at SOLID_INK over a band sized for a full-size
// C-clef and an F clef reads 0.55 there. BOTH WERE FIXED IN THE SWEEP AND THE
// FALSE FIRES ARE WHAT REMAINED. The blocked constants were never the finding.
//
// WHAT WOULD BE NEEDED, for a round that wants to try again: a measurement with
// 2-D structure in it, not this row profile. An F clef's own unique signature is
// its TWO DOTS straddling the line it names — the exact counterpart of the
// C-clef's waist — and they are invisible here, because each is about a fifth of
// a space across in a band 3.6 spaces wide and contributes 0.06 to a row that
// the curl beside it already fills to 0.3. Cutting the glyph out of the band by
// its own ink was tried and is recorded in the handover: it recovers the extent
// on a photograph and falls apart on a clean page, where the binarised curl is
// not connected column to column.

// A TREBLE CLEF STANDING MID-SYSTEM, which IS readable, and by the same one
// wide margin that classifyClef leans on at the head of a system.
//
// MEASURED, over the 58,411 windows described above: 54 of the 60 drawn
// mid-system G clefs are read and NOTHING ELSE FIRES ANYWHERE. The six misses
// are all at em 0.6 — a G clef that small reaches only 4.50 to 4.59 spaces down
// against a bound of 4.4, and the windows either side of the one good one fall
// short — which is the same size that `npm run scan:clef` already records as
// the C-clef's floor.
//
// THAT SWEEP IS WHERE THE GATE CAME FROM AND IT IS NOT THE WHOLE STORY: with it
// alone satisfied the detector fired four times on the Bach photograph, which is
// what TREBLE_BEAM below and tailUnderBody in scan-read.js exist for. END TO END
// WITH ALL OF IT IN: `npm run scan:clef-change` reads the change on 12 of 12
// systems for bass->treble and 12 of 12 for tenor->treble, and both score
// EXACTLY what their no-change controls score (78 of 120 and 60 of 120); `npm
// run scan:clef` finds four of its four treble rows outside the em-0.6 one with
// its furniture block at zero; and the three marked photographs report no clef
// change at all on any of their thirty staves.
//
// WHAT DOES THE WORK, by ablation, dropping one test at a time from the shipped
// gate. Only three of them are load-bearing and the comment says so rather than
// letting the next round assume otherwise:
//
//   drop continuity          54 read,  47 FALSE FIRES   <- carries it
//   drop "below the stave"   54 read,  18 FALSE FIRES   <- carries it
//   run of 3, not 5          54 read,  12 FALSE FIRES   <- carries it
//   drop the anchor ratio    54 read,   0 false fires
//   drop symmetry            54 read,   0 false fires
//   drop the height bound    54 read,   0 false fires
//
// The last three are kept anyway, and deliberately: they cost no recall at all,
// and what they buy is that this says TREBLE CLEF rather than "deep continuous
// ink". The furniture drawn for scan:clef is not the last page this will ever
// meet. But nobody should read them as the measurement — the measurement is the
// first three lines.
const TREBLE_DEEP = 4.4;      // spaces below the top line: past the stave itself
const TREBLE_TALL = [3.0, 7.6];
// The G LINE sits at 0.62 of the way down a G clef's own ink, at every size.
// Measured on the sixty drawn clefs: 0.621, 0.622, 0.624, 0.626, 0.627 for em
// 0.9, 0.72, 0.75, 1.0 and 0.75 again, and 0.54 for the truncated 0.6. This is
// the same law as the C-clef's waist — a clef's extent is anchored on the line
// it names, at a fixed fraction of its height — and the F clef obeys it too, at
// 0.31, which is what makes the deleted function's failure a false-fire problem
// and not a blindness one.
const G_LINE = 3;
const G_ANCHOR = 0.62;
const G_ANCHOR_NEAR = 0.18;
// Continuity, at a LOWER ink floor than SOLID_INK, and the number is measured
// rather than loosened until something passed. The band is 3.6 spaces wide
// because that is what a FULL-SIZE clef at the head of a system needs; a G clef's
// hook and tail are thin, so at SOLID_INK (0.25) a real mid-system treble reads
// between 0.23 and 0.79 solid — the test would refuse every one of them — and at
// 0.10 it reads 0.89 to 1.00. What continuity is for is unchanged: no PAPER
// across the glyph's height, which is what says one symbol rather than two
// things stacked with a gap.
const TREBLE_INK = 0.10;
const TREBLE_SOLID = 0.93;
// AND NOTHING BELOW THE STAVE THAT IS A BEAM.
//
// This is the test the drawn furniture could not have asked for, and it came off
// the Bach photograph. Every bar of the Prélude is beamed semiquavers with the
// stems DOWN, so the beams hang below the bottom line — and a window holding a
// barline (which is continuous from the top line to the bottom one) with a
// beamed group on either side reads exactly like a G clef: ink from above the
// stave to well below it, continuous, symmetric, with the G line at 0.6 of its
// height. Cropped at 8x it is a barline between two beamed groups, and there is
// no clef anywhere on that page.
//
// What tells them apart is that a beam is WIDE. It runs right across the band,
// where the tail of a G clef is a hook. MEASURED, in rows covering more than
// 0.55 of the band below the bottom line: of the 675 windows on a real drawn
// mid-system G clef that pass every other test here, every one has AT MOST ONE
// such row, and the Bach's beamed group has eight to ten — 0.06 to 0.09 of a
// staff space against 0.7 to 0.9.
const TREBLE_BEAM = 0.55;    // a row this much of the band inked, below the stave
const TREBLE_BEAM_DEEP = 0.25;  // …and no more than this much of a space of them

/**
 * A treble clef printed part way along a system, or null.
 *
 * Same contract as midClefAt: `column` is what clefColumn built, and null is
 * the answer for anything that is not certainly a G clef.
 */
export function midTrebleAt(column, space) {
  const f = clefFeatures(column, space);
  if (!f) return null;
  // The one wide margin on the page. Only a treble hangs below the bottom line
  // — measured at 5.6 spaces full size and 4.5 at the smallest cue size an
  // engraver sets — and this is the same fact classifyClef reads at the head of
  // a system, where it is the widest margin of the three clefs.
  if (!(f.bottom > TREBLE_DEEP)) return null;
  if (!(f.height >= TREBLE_TALL[0] && f.height <= TREBLE_TALL[1])) return null;
  if (!(f.symmetry >= SYM_MIN)) return null;

  // One glyph, not two things with paper between them. See TREBLE_INK.
  const from = Math.max(0, Math.round((f.top + MARGIN) * space));
  const to = Math.min(column.length - 1, Math.round((f.bottom + MARGIN) * space));
  let inked = 0;
  let rows = 0;
  for (let r = from; r <= to; r++) { rows++; if (column[r] >= TREBLE_INK) inked++; }
  if (!rows || inked / rows < TREBLE_SOLID) return null;

  // …and it is a tail below the stave and not a beam. See TREBLE_BEAM.
  let beamy = 0;
  for (let r = Math.round((STAVE + 0.15 + MARGIN) * space); r <= to; r++) {
    if (r >= 0 && r < column.length && column[r] >= TREBLE_BEAM) beamy++;
  }
  if (beamy / space > TREBLE_BEAM_DEEP) return null;

  // …and the line it names, which is what makes this a reading rather than a
  // shape test. See G_ANCHOR.
  const anchor = (G_LINE - f.top) / f.height;
  const off = Math.abs(anchor - G_ANCHOR);
  if (off > G_ANCHOR_NEAR) return null;
  return {
    clef: 'treble',
    confidence: Math.max(0, Math.min(1, 1 - off / G_ANCHOR_NEAR)),
    anchor,
    height: f.height,
  };
}

export function midClefAt(column, space) {
  const f = clefFeatures(column, space);
  if (!f) return null;
  const half = f.height / 2;
  if (!(half >= MIN_HALF && half <= MAX_HALF)) return null;
  if (!(f.symmetry >= SYM_MIN)) return null;

  // Continuity, measured over the extent clefFeatures settled on. This is what
  // says one glyph rather than two things stacked with paper between them.
  const from = Math.max(0, Math.round((f.top + MARGIN) * space));
  const to = Math.min(column.length - 1, Math.round((f.bottom + MARGIN) * space));
  let inked = 0;
  let rows = 0;
  for (let r = from; r <= to; r++) { rows++; if (column[r] >= SOLID_INK) inked++; }
  if (!rows || inked / rows < SOLID_MIN) return null;

  // …and the waist, which is the whole reading. A C-clef names the line its
  // waist stands on: line 1 counting down from the top is tenor, line 2 alto.
  // Reported as tenor and alto rather than as a line number because that is
  // what the rest of the reader speaks, and because a cello in a C-clef is in
  // tenor — alto belongs to the viola, and the difference between them is a
  // whole space against a quarter-space tolerance, which is why naming which
  // of the two it is costs nothing.
  const waist = (f.top + f.bottom) / 2;
  const line = Math.abs(waist - 1) <= Math.abs(waist - 2) ? 1 : 2;
  const off = Math.abs(waist - line);
  if (off > WAIST_NEAR) return null;
  return {
    clef: line === 1 ? 'tenor' : 'alto',
    // How near the waist sat to the line it names, as a fraction of the
    // tolerance it had to clear. Every C-clef measured here reads 0.76 or
    // better; the chord that beat every other test would have read 0.
    confidence: Math.max(0, Math.min(1, 1 - off / WAIST_NEAR)),
    waist,
    height: f.height,
  };
}
