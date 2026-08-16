// The key signature, which is the second half of turning a position into a note.
//
// A clef says which line is which note. A key signature says which of those
// notes are sharp or flat for the whole page — and unlike an accidental, which
// stands against one notehead in a crowd of fingerings, slurs and bowings, it
// stands alone at the head of the stave, in a fixed order, on fixed lines, with
// fifteen possible answers and nothing overlapping it. It is the easiest thing
// on the page to read and it is worth a whole semitone on every note it touches.
//
// Degrees are indexed C=0, D=1, E=2, F=3, G=4, A=5, B=6 — the diatonic degree
// rather than the pitch, because a degree is what a step on a stave gives you
// and a pitch is what this and scan-clef.js together turn it into.

// F C G D A E B — the order sharps are written in, and the reason a key with
// three sharps has F, C and G sharp rather than any other three.
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
// B E A D G C F — the same run backwards, which is why flats undo sharps.
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * The alterations a signature of `count` sharps or flats applies.
 *
 * Returns { sharps, flats, alter }, where `alter[degree]` is +1, 0 or -1.
 *
 * Returns null for a count that is not a key signature. Eight sharps is not a
 * page in an unusual key, it is a reading that has gone wrong — and altering
 * seven degrees because eight symbols were counted where there are five would
 * put a semitone on notes nothing on the page ever touched.
 */
export function keyFromCount(count, kind) {
  if (!Number.isInteger(count) || count < 0 || count > 7) return null;
  if (kind !== 'sharp' && kind !== 'flat') return null;
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = kind === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  const delta = kind === 'sharp' ? 1 : -1;
  for (let i = 0; i < count; i++) alter[order[i]] = delta;
  return {
    sharps: kind === 'sharp' ? count : 0,
    flats: kind === 'flat' ? count : 0,
    alter,
  };
}

// A page with nothing at the head of the stave, which is also what an unread
// signature falls back to. Named rather than written out at each call site so
// the places that are ASSUMING C major can be found by grepping for it.
export const NO_KEY = keyFromCount(0, 'sharp');

// WHERE the key signature is, which is a smaller question than what it says and
// worth answering on its own.
//
// MEASURED, on a marked-up page of the Bärenreiter Bach: eighteen of the fifty
// heads the reader invents are the key signature, a pair on every one of the ten
// systems, at x = 80 to 93, at steps 4/5 and 7/8. In bass clef the F line is
// step 6 and a sharp's two thick crossbars straddle it — so that is ONE sharp,
// read as two noteheads, ten times over. It is the largest single population of
// false circles on the page and it is one printed object.
//
// Reading which key it is needs the glyphs told apart, and that is the next job.
// Knowing not to draw a circle on them only needs them FOUND, so that is what
// this does: it walks right from the end of the clef and returns the band the
// accidentals occupy.
//
// It stops rather than scanning a fixed width, and the difference matters. The
// rule this replaces recognised the key signature by its being printed in the
// same place on every system, and it could not tell "printed twice" from
// "played twice" — it took four to eight points of recall off the corpus,
// because music near the start of a system is often similar system to system.
// A scan that terminates at the first thing which is not an accidental cannot
// reach into the music at all, whatever the music happens to look like.

// HOW TALL, and only how tall.
//
// MEASURED on real Bravura at four sizes, clean and photographed — see
// tools/scan-key. Height separates an accidental from the thing that must not
// be mistaken for one, and width does not:
//
//               wide          tall
//   accidental  0.73–1.27    2.15–2.89
//   notehead    1.23–1.69    3.67–3.74
//
// The first version of this tested width at 1.15 spaces, which is inside the
// accidentals' own range: a real sharp measures 1.24 across, so the scan
// rejected every key signature on the page and the filter quietly did nothing
// on every system of every system it ran on. Height has three quarters of a
// space of daylight between the two populations, so the bound sits in the
// middle of it and nothing else is asked.
//
// A head with no stem — a semibreve — measures about one space and falls under
// the floor, which ends the scan rather than eating it. That is the right way
// round: everything this cannot identify STOPS the signature.
const GLYPH_TALL = [1.2, 3.2];     // staff spaces
// Width is no use as a CEILING — the two populations overlap there — but it is
// a fine floor. The measured accidentals run 0.73 to 1.27 spaces across, so
// anything under half a space is a speck, and a one-pixel speck was being
// counted as a key signature of one.
const GLYPH_FLOOR = 0.5;           // staff spaces
const GLYPH_GAP = 1.1;             // spaces of blank that end the run
const KEY_REACH = 9;               // spaces past the clef; seven flats and slack
// A key signature is set hard against the clef. Anything that starts a couple
// of spaces further out is the time signature or the first note, and a scan
// that will walk that far to find something narrow will find it in the music:
// on the indented first system of the Bärenreiter page it found three "glyphs"
// two and a half spaces out and ate a note.
const KEY_ADJACENT = 1.5;          // staff spaces from where the clef's ink ends

/**
 * The band the key signature occupies, measured from `fromX` rightwards.
 *
 * Returns { x0, x1, count } in pixels, or null when the first thing past the
 * clef is not an accidental — which is most pages, since most keys are C major
 * and most parts are not transposed.
 *
 * `lineY(k)` gives the y of the stave's kth line where the band begins. Held
 * still across the band rather than followed: a key signature is a strip and a
 * half wide, the lines move a pixel or two over that, and following them adds
 * the strip boundary's own step — measured both ways, and holding still read
 * two fewer false heads.
 *
 * The search runs from a space above the top line to a space below the bottom
 * one, which is where every accidental in a signature is written.
 */
export function findKeyBand(ink, w, h, lineY, space, fromX) {
  const top = Math.max(0, Math.round(lineY(0) - space * 1.2));
  const bottom = Math.min(h - 1, Math.round(lineY(4) + space * 1.2));
  if (bottom <= top) return null;
  const start = Math.max(0, Math.round(fromX));
  const limit = Math.min(w - 1, Math.round(start + space * KEY_REACH));
  const gap = Math.max(2, Math.round(space * GLYPH_GAP));

  // Ink per column, and how tall it stands — with the STAVE'S OWN LINES left
  // out of the measurement.
  //
  // Without that every column in the band is five lines tall and nothing is
  // ever an accidental: a staff line runs the width of the page, so the first
  // and last inked rows under any x at all are the top and bottom lines, four
  // and a half spaces apart. The first version of this measured exactly that
  // and stopped at the first column it looked at, on every system of every
  // page, which is a filter that quietly does nothing.
  const lines = [0, 1, 2, 3, 4].map((k) => Math.round(lineY(k)));
  const tol = Math.max(1, Math.round(space * 0.16));
  const onLine = (y) => lines.some((at) => Math.abs(y - at) <= tol);
  const column = (x) => {
    let first = -1;
    let last = -1;
    for (let y = top; y <= bottom; y++) {
      if (!ink[y * w + x] || onLine(y)) continue;
      if (first < 0) first = y;
      last = y;
    }
    return first < 0 ? null : { first, last };
  };

  const cap = GLYPH_TALL[1] * space;

  // Past the clef's own ink first.
  //
  // The band a clef is read in is three and a half spaces wide, which is a
  // clef and no more — but the ink does not stop dead at the edge of it. On
  // half the systems of the Bärenreiter page the scan opened on the tail of
  // the bass clef, measured it at six spaces tall, and gave up before it had
  // seen the sharp two spaces further on. So a run that is already under way
  // where the scan begins is the clef, and is stepped over.
  //
  // Capped at two spaces, and only at the start: this is for a glyph that
  // overhangs its band, not a licence to hunt rightwards for something better.
  let from = start;
  const overhang = start + Math.round(space * 2);
  if (column(from)) {
    let blank = 0;
    while (from <= overhang && blank <= 1) {
      from++;
      if (column(from)) blank = 0; else blank++;
    }
  }

  const glyphs = [];
  const adjacent = from + space * KEY_ADJACENT;
  let x = from;
  while (x <= limit) {
    if (!column(x)) { x++; continue; }
    if (!glyphs.length && x > adjacent) break;
    // A run of inked columns, allowed the odd blank one — a photographed sharp
    // is not solid and its two thin uprights leave gaps a pixel wide — and
    // BOUNDED BY HEIGHT AS IT GROWS.
    //
    // Grown to the next blank and measured afterwards, a run takes its height
    // from anything it happens to touch: on five systems of the Bärenreiter
    // page the sharp ran into the music beside it and came back six and a half
    // spaces tall, which is the whole band, and the scan gave up. Stopping the
    // run at the column that would make it too tall isolates the accidental
    // from whatever stands next to it, and leaves that thing to be judged on
    // its own — where, being too tall, it ends the signature as it should.
    let end = -1;
    let blank = 0;
    let hi = h;
    let lo = 0;
    for (let k = x; k <= limit && blank <= 1; k++) {
      const c = column(k);
      if (!c) { blank++; continue; }
      const top2 = Math.min(hi, c.first);
      const bottom2 = Math.max(lo, c.last);
      if (end >= 0 && bottom2 - top2 + 1 > cap) break;
      blank = 0;
      end = k;
      hi = top2;
      lo = bottom2;
    }
    const tall = end < 0 ? 0 : (lo - hi + 1) / space;
    if (end < 0 || (end - x + 1) / space < GLYPH_FLOOR) break;
    // Anything that is not an accidental ends the signature — including the
    // first note, which is exactly the boundary the rule this replaced could
    // not find at all.
    if (tall < GLYPH_TALL[0] || tall > GLYPH_TALL[1]) break;
    glyphs.push({ x0: x, x1: end });
    // Past the blank that follows it; a wider blank than one glyph's spacing
    // means the signature has ended.
    let after = end + 1;
    while (after <= limit && !column(after)) after++;
    if (after - end - 1 > gap) break;
    x = after;
  }

  if (!glyphs.length || glyphs.length > 7) return null;
  return { x0: glyphs[0].x0, x1: glyphs.at(-1).x1, count: glyphs.length };
}
