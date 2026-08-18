// The music glyphs the benchmarks draw with.
//
// Clefs cannot be graded against shapes we invent. A classifier tuned against
// its author's drawing of a bass clef learns that drawing, and the page it then
// meets is engraved by somebody else — so the pages in tools/scan-clef-check.mjs
// carry real Bravura, which is the reference SMuFL font and what MuseScore sets.
//
// Benchmark-only. tools/ is outside the Vite root, so nothing here ships.

// Written as escapes rather than as the characters themselves: a bass clef
// pasted into a source file is invisible in half the tools that will ever open
// it, and indistinguishable from a treble clef in most of the rest.
export const GLYPH = {
  trebleClef: '\u{E050}',
  bassClef: '\u{E062}',
  cClef: '\u{E05C}',
  commonTime: '\u{E08A}',
  sharp: '\u{E262}',
  flat: '\u{E260}',
  natural: '\u{E261}',
  // Everything below is here for ONE job: the block in scan-clef-check.mjs that
  // proves a mid-system clef detector does not fire on things that are not
  // clefs. Each was chosen because it is tall, or symmetric about a staff line,
  // or both — which is what the detector looks for.
  noteheadBlack: '\u{E0A4}',
  repeatDots: '\u{E043}',
  fermata: '\u{E4C0}',
  dynamicForte: '\u{E522}',
  restQuarter: '\u{E4E5}',
};

// Where each clef's glyph origin sits, counted in staff spaces DOWN from the
// top line.
//
// SMuFL places a clef by the line it NAMES, which is the whole of what a clef
// does: the treble's spiral wraps the second line from the bottom (G), the
// bass's two dots straddle the second from the top (F), and a C-clef's waist
// sits on the line it is centred on — the middle line for alto, one space
// higher for tenor, which is the one a cello part uses.
export const CLEF_ANCHOR = {
  trebleClef: 3,
  bassClef: 1,
  cClefAlto: 2,
  cClefTenor: 1,
};
