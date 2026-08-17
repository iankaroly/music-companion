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
// systems, at x = 80 to 93, at steps 4/5 and 7/8. A sharp's two thick crossbars
// straddle the line it is centred on, and each of them reads as a notehead — so
// that is ONE sharp, read as two noteheads, ten times over. It is the largest
// single population of false circles on the page and it is one printed object.
//
// NOT A BASS-CLEF EFFECT, though this paragraph used to say it was. The Bach's
// sharp sits on the F line, which in bass clef is step 6, and the pair lands at
// steps 5 and 7 either side of it — but the same pair was then measured on the
// TREBLE sharps of both other marked pages, straddling the top line, and the
// hand marks on the Scanned score record it thirteen times over at x = 110 to
// 116 on systems 3, 4, 6, 7, 8, 10 and 11. The mechanism is the crossbars and
// whichever line they straddle; the clef has nothing to do with it, and anyone
// looking for a bass-clef special case will not find one.
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
// …and it turns out to be a usable CEILING too, once the leaked staff line is
// out of the measurement — just not at the boundary the note above rejected.
//
// That paragraph was written against a notehead, which measures 1.23 to 1.69
// spaces across where an accidental measures 0.73 to 1.27, and it is right: the
// two overlap and no line drawn between them is honest. It says nothing about
// what lies further out. MEASURED on the thirty-two systems of the three marked
// pages once the bridge below was in place, every band on every system that has
// a printed signature came back between 0.40 and 1.52 spaces wide (Bach 0.49 to
// 1.48, Concerto 0.40 to 1.52, Scanned 0.73 to 1.25) — and the only two runs
// anywhere near them were 2.01 spaces on the Scanned score's first system and
// 2.78 on the Concerto's, both of which are the pages' known-broken first
// system, both clef null at confidence zero, and neither of which is standing
// on a key signature at all. Half a space of daylight between 1.52 and 2.01,
// and the bound sits in it.
//
// A run this wide is a time signature, a notehead with something touching it,
// or a stave whose model has gone wrong and is measuring the title block. It is
// not an accidental, and by this file's own rule everything it cannot identify
// STOPS the signature rather than being swept into it. Note that this bounds a
// RUN and not the band: seven flats is ten spaces of band, and each flat in it
// is a space and a bit on its own.
const GLYPH_WIDE = 1.9;            // staff spaces
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
  // A staff line is FOUND, not predicted.
  //
  // Masking the five rows the stave model puts the lines on does not survive a
  // photograph: the model is a curve fitted across forty strips, it is a pixel
  // or three out here and there, the mask misses, and the column then measures
  // from the top line to the bottom one. On four of the ten systems of the
  // Bärenreiter page EVERY column came back four and a half spaces tall — the
  // whole stave, against a ceiling of 3.2 — so the scan stopped at the first
  // column it looked at and the key signature was circled as two noteheads.
  // Following the model more carefully does not help: strip by strip and
  // interpolated between strips both read worse than holding it still.
  //
  // What a staff line IS needs no model. It is ink that runs a long way
  // sideways, and an accidental's strokes are a space or so across and stop.
  const RULE = 3;   // staff spaces of horizontal run that mean a line, not a glyph
  const far = Math.round(space * RULE);
  // …AND IT DOES NOT ARRIVE IN ONE PIECE.
  //
  // The first version of this walked sideways only while every pixel it passed
  // was inked, and on a photograph that is not what a staff line looks like.
  // MEASURED on the Bärenreiter Bach, on columns holding nothing whatever but
  // blank paper and the five printed lines (system 4, x = 98 to 122, space
  // 12.14, so `far` is 36): the longest UNBROKEN horizontal run in those rows
  // is 11 to 32 pixels. Every one of them fell short of the bound, so onRule
  // said "not a line", column() returned a height on bare staved paper, and
  // every test downstream was measuring paper rather than ink. That single leak
  // produced all three of this file's symptoms at once — one-pixel "glyphs"
  // that ended the scan, an overhang walk that strolled straight over the key
  // signature because no column was ever blank, and phantom accidentals that
  // made the counts disagree system to system. Twenty-seven of the thirty-two
  // systems on the three marked pages ended their scan on leaked line ink.
  //
  // A local threshold on a grey photograph does not fail a whole line, it fails
  // a pixel here and a pixel there, and CROP_LAYER=ink shows the lines rendering
  // dashed. So the walk is allowed to step over a short break, exactly as the
  // glyph scan below already steps over one blank column for the same reason —
  // a photographed sharp's two thin uprights leave gaps a pixel wide too.
  //
  // HALF A STAFF SPACE, and it was measured, not chosen. The probe prints, for
  // every column from the end of the clef band nine spaces right, how many rows
  // survive onRule at each bridge width. Bach system 4, space 12.1, on the seven
  // columns between the clef's ink and the sharp — paper and five printed lines,
  // nothing else:
  //
  //     bridge      0      2      4      6
  //     rows kept   2–5    1–3    0–1    0
  //     tallest     3.14   2.15   0.08   0
  //
  // and on the fifteen columns of the sharp itself, x = 85 to 99:
  //
  //     bridge      0      2      4      6
  //     rows kept   2–34   1–31   1–29   1–28
  //     tallest     4.22   3.97   3.97   3.97
  //
  // At a bridge of two the blank paper still measures 2.15 spaces tall, which is
  // inside GLYPH_TALL, so it reads as an accidental and the sharp two columns
  // later is never reached. At six the paper is empty and the sharp has lost
  // three rows in twenty-eight. There is no value in between where the two
  // populations are anything but wide apart, and eight reads identically to six.
  //
  // Written as half a space rather than as six pixels because that is what it is
  // about: the break a local threshold leaves in a printed line scales with the
  // page, and this file's every other bound is in staff spaces for the same
  // reason. What makes a bridge this wide safe is the asymmetry — a staff line
  // is inked for hundreds of pixels either side, so half a space of bridge
  // recovers it many times over, while an accidental is a space and a bit across
  // and then there is nothing for a space and a bit more. Bridged end to end a
  // sharp's two uprights measure eight tenths of a space; the bound is three.
  const BRIDGE = Math.max(2, Math.round(space * 0.5));
  const onRule = (x, y) => {
    if (!ink[y * w + x]) return false;
    let run = 1;
    let gap = 0;
    for (let k = x - 1; k >= 0 && run <= far; k--) {
      if (ink[y * w + k]) { run += gap + 1; gap = 0; continue; }
      if (++gap > BRIDGE) break;
    }
    gap = 0;
    for (let k = x + 1; k < w && run <= far; k++) {
      if (ink[y * w + k]) { run += gap + 1; gap = 0; continue; }
      if (++gap > BRIDGE) break;
    }
    return run > far;
  };
  // The page with the stave taken out of it, as the EXTENT scan sees it.
  const mark = (x, y) => !!ink[y * w + x] && !onRule(x, y);

  // …AND AS THE SHAPE READING SEES IT, WHICH IS NOT THE SAME PICTURE.
  //
  // onRule is deliberately blunt. It calls any ink running more than three
  // spaces sideways a staff line, over a bridge of half a space, and for the
  // extent scan that is exactly right: what it is guarding against is bare
  // staved paper measuring two spaces tall and reading as an accidental, and it
  // can afford to lose a row here and there of a glyph because all the extent
  // scan wants is the first and last inked row of a column.
  //
  // A SIGNATURE OF THREE OR MORE DEFEATS IT, and this was measured, not
  // guessed. Accidentals in a signature are set two or three PIXELS apart —
  // measured at a staff space of 22, the runs land at x = 129–151, 154–176,
  // 180–202, 205–227, so the gaps are 2 and 3 pixels against a bridge of 11.
  // At any row where two neighbours both carry ink, onRule bridges straight
  // from one into the next and reports a run of 75 pixels against a bound of
  // 66 — so it erases those rows from BOTH glyphs as though they were a printed
  // line. The damage is invisible until you count: the first sharp of a
  // signature measured a step of 8.02 alone, 8.31 with a third sharp beside it
  // and 8.46 with a fourth, and its bottom-left corner fell from 0.90 to 0.62
  // and read as a natural. Every signature of three or more was refused, in both
  // clefs at every size — which is every key from three sharps up, D, A, E and B
  // major and their minors.
  //
  // So the shape is read through a NARROWER test: ink is line ink only where the
  // stave model says a line is AND it runs a long way sideways. Both halves are
  // needed and neither is enough on its own. The model alone does not survive a
  // photograph — the comment above records four systems of the Bärenreiter page
  // where every column measured the whole stave because the fitted curve missed
  // the printed lines by a pixel or three. The run alone is what bridges across
  // a signature. Together, a row is erased only where the model is roughly right
  // AND the ink behaves like a line, and a row of accidentals two spaces above
  // the top line — where no line is printed and no model claims one — is left
  // alone whatever it runs into sideways.
  //
  // A THIRD OF A SPACE of tolerance on the model, which is the "pixel or three"
  // that comment measured, at the sizes this reader works at.
  //
  // This cannot move anything the reader already does. The extent scan, the
  // band, the count and the suppression are all `mark`; `shapeMark` is read only
  // after a run has been accepted, and only to describe it.
  const lineTol = Math.max(1, Math.round(space * 0.35));
  const nearLine = (y) => {
    for (let k = 0; k < 5; k++) if (Math.abs(y - lineY(k)) <= lineTol) return true;
    return false;
  };
  const shapeMark = (x, y) => !!ink[y * w + x] && !(nearLine(y) && onRule(x, y));

  // The tallest a run may be and still be an accidental, in pixels. Declared
  // here rather than beside its only other use because `column` below needs it:
  // the whole point of the growth there is that it may stop as soon as the
  // answer to "is this too tall to be an accidental" can no longer change.
  const cap = GLYPH_TALL[1] * space;

  // HOW TALL IS THE INK IN THIS COLUMN — and it is asked of the INK, not of the
  // band, which is the difference between ending a signature on the first note
  // and eating that note.
  //
  // THE BUG THIS FIXES, because it is the one thing the band is never allowed
  // to do. The band may eat furniture; it may never eat music. A note the band
  // covers is deleted outright by `dropFurniture`, which suppresses every head
  // with `head.x` between x0 and x1, so a note swept into the band is a note
  // gone from the page — and a missing note breaks the alignment a take
  // depends on.
  //
  // The scan searches from 1.2 spaces above the top line to 1.2 below the
  // bottom one, and that bound is right and is not moving (see the long note
  // above `describe`: everything a page prints near the head of a stave that is
  // not furniture — the bar number, a pencilled bowing, a dynamic — sits
  // outside it, and letting that ink in would end signatures that read
  // perfectly well). But it is a bound on WHERE THE SCAN LOOKS, and it was
  // being used as a measurement. A note is four spaces of ink from stem tip to
  // the far side of its head, so a note standing anywhere but the middle of the
  // stave hangs out of that window, and what came back was the part of it that
  // happened to lie inside — CLIPPED, and therefore short.
  //
  // MEASURED, on the reviewer's own fixture reduced to one line: a stave at
  // space 12 with lines at y = 60..108, so the window runs 46 to 122, and a
  // crotchet whose head sits a step and a half below the bottom line. Its ink
  // runs y = 84 to 132, four and a bit spaces. The column reported 85 to 122 —
  // cut off exactly at the window's own edge — which is 3.17 spaces, inside a
  // ceiling of 3.2, so the height test below took it for an accidental and the
  // band came back covering the note. A fleck of grain two pixels wide between
  // the clef and that note is enough to walk the scan up to it. 3746 of 32832
  // drawn arrangements of one crotchet did this (tools/key-safety-check.mjs).
  //
  // THE TWO CHEAPER ANSWERS ARE BOTH ALREADY MEASURED AND DEAD, so nobody need
  // try them again. `describe`'s `ran` — ink still present at the 2.4-space
  // contiguity bound, which is what says NOTEHEAD to classifyKeyGlyph — is
  // FALSE on every one of those 3746, because a head hanging below the stave
  // stops at 131 and the bound is at 137: it is a real notehead that never
  // reaches the edge. And putting a height ceiling on `describe`'s box instead
  // was measured last round and costs 18 real signatures of 167 at 3.4 spaces,
  // because that box is grown by contiguity and joins a signature's neighbours.
  //
  // SO THE COLUMN FOLLOWS ITS OWN INK OUT OF THE BAND. Each column takes the
  // first and last inked row inside the window as before, and then walks out
  // from each end while the ink continues, so what the height test is handed is
  // the run's true extent.
  //
  // THIS CANNOT LET NEW INK INTO THE SCAN, which is what makes it safe against
  // the bar number and the bowing the window was drawn to exclude. The walk
  // only ever starts from ink already found INSIDE the window, and it only ever
  // follows ink that touches, row by row, with no bridge — so a column that was
  // blank is still blank, `if (!column(x))` at the top of the loop is untouched,
  // and the `reach` lookahead below still asks the same question of the same
  // pixels. Nothing that was outside the signature can be drawn into it; a run
  // can only be measured taller than it was, and a taller run is one the height
  // test ENDS the signature on.
  //
  // BOUNDED BY THE ANSWER RATHER THAN BY A DISTANCE. The only thing anybody
  // asks of this height is whether it is over `cap`, so the walk stops the
  // moment it is: past that point no further pixel can change a decision, and
  // a stem three and a half spaces long is not traced to its tip for nothing.
  // Both ends grow together rather than one and then the other, so that a
  // column whose ink runs upwards and its neighbour whose ink runs downwards
  // are measured on the same rule — growing one end to exhaustion first would
  // make the pair's extents differ by the order they were walked in, and the
  // JUMP test below reads exactly that difference.
  //
  // WHAT THIS DELIBERATELY DOES NOT DO — first..last, and not the tallest
  // contiguous PIECE. A column's first and last inked rows are taken across
  // whatever blank rows lie between them, and that is not an oversight: an
  // accidental standing on a staff line has the line's rows removed by `mark`
  // and arrives here in two pieces, and the two are one glyph. The cost is that
  // a speck of grain in the same column as a notehead is joined to it — a fleck
  // at 1.8 spaces above a head makes the pair measure 1.4 spaces where the bare
  // head measures 1.08, which lifts it over GLYPH_TALL's floor and into the
  // band. That is the whole of the residue tools/key-safety-check.mjs still
  // reports, and it is REAL.
  //
  // BOUNDING THE VERTICAL GAP WAS MEASURED AND IS WORSE, and it is worse in the
  // one direction that is not allowed. Bridging only gaps under a bound and
  // taking the tallest piece was swept at 0.5, 0.8, 1.2, 1.6, 2.0 and 2.5
  // spaces. It looks like a clear win on three of the four instruments — at 1.2
  // spaces `scan:key-read` reads 175 printed signatures of 224 against 172, with
  // no wrong key either way, `bench` precision on the Mozart goes 87.6% to 89.1%
  // for six fewer false circles, and the safety count halves from 1422 to 794 —
  // and then `scan:corpus` says it costs RECALL on a photograph: slopedPhoto
  // 98% to 95%, mixedPhoto 99% to 97%, barMixPhoto 98% to 97%. The mechanism is
  // the obvious one once seen: taking the tallest piece makes every column
  // measure SHORTER, so more noteheads pass the height test, so the band eats
  // more music. A page may lose a false circle; it may not lose a note. Under
  // 1.2 spaces it is worse still on every axis at once — at 0.5 spaces real
  // photographed accidentals split and measure short, and `scan:key-read` falls
  // to 158 with five WRONG keys back.
  const column = (x) => {
    let first = -1;
    let last = -1;
    for (let y = top; y <= bottom; y++) {
      if (!mark(x, y)) continue;
      if (first < 0) first = y;
      last = y;
    }
    if (first < 0) return null;
    while (last - first + 1 <= cap) {
      const up = first - 1 >= 0 && mark(x, first - 1);
      const down = last + 1 < h && mark(x, last + 1);
      if (!up && !down) break;
      if (up) first--;
      if (down) last++;
    }
    return { first, last };
  };

  // WHAT SHAPE IS IT, measured while the run is in hand.
  //
  // Reported rather than decided here: findKeyBand's job is the extent, and a
  // run it accepts is a run whether or not anything can name it. The naming is
  // classifyKeyGlyph below, which is a pure function of these four numbers so
  // that it can be argued with, tested and swept without a page in front of it.
  //
  // The four numbers are the two DIAGONAL CORNERS of the glyph's box and two
  // centres of ink. See classifyKeyGlyph for what the corners mean and
  // keyGlyphStep for what the centres are for.
  //
  // AND IT IS MEASURED IN A TALLER WINDOW THAN THE SCAN RUNS IN, deliberately.
  //
  // The scan's band stops 1.2 spaces above the top line, and that bound is not
  // moving: everything a page prints near the head of a stave that is not
  // furniture sits ABOVE it — the bar number, a pencilled bowing, a dynamic —
  // which is the same asymmetry scan-clef.js cuts its own window short for, and
  // widening it would let that ink end signatures that are perfectly readable.
  //
  // But a key signature does not fit in it. The THIRD sharp in treble is G
  // sharp, printed in the space ABOVE the top line, and a sharp is 2.8 spaces
  // tall — so its ink reaches 1.9 spaces above that line and the scan's band cuts
  // 0.7 of a space off the top of it. Measured on the ink that is left, the
  // centre of the glyph sits 0.7 of a half-step low, which rounds G sharp onto F
  // and fails the order test. That is every key from three sharps upward: D, A,
  // E, B major and their minors, refused for a bound that has nothing to do with
  // them.
  //
  // So the run is ACCEPTED on the narrow band and MEASURED on a wide one. The
  // two questions are different: the narrow band decides what ends a signature,
  // and this decides how tall a thing already accepted is. Nothing here can
  // change which runs are accepted, where the band ends or what gets suppressed
  // — it only changes the shape reported for a run the scan already took.
  //
  // Grown by CONTIGUITY rather than by reaching, which is what keeps it honest:
  // each column follows its own ink out of the band and stops at the first blank
  // row, so a slur or a bar number a space above the stave is never joined. Note
  // that a staff line counts as blank here, because `mark` has already taken the
  // lines out — so ink on the far side of a line cannot be reached either.
  // Bounded at 2.4 spaces past the stave, which is a whole accidental clear of
  // the 1.9 the tallest one needs.
  const hardTop = Math.max(0, Math.round(lineY(0) - space * 2.4));
  const hardBottom = Math.min(h - 1, Math.round(lineY(4) + space * 2.4));
  const describe = (gx0, gx1, ry0, ry1) => {
    let gy0 = ry0;
    let gy1 = ry1;
    let ran = false;
    for (let x = gx0; x <= gx1; x++) {
      let first = -1;
      let last = -1;
      for (let y = ry0; y <= ry1; y++) {
        if (!shapeMark(x, y)) continue;
        if (first < 0) first = y;
        last = y;
      }
      if (first < 0) continue;
      let up = first;
      while (up - 1 >= hardTop && shapeMark(x, up - 1)) up--;
      let down = last;
      while (down + 1 <= hardBottom && shapeMark(x, down + 1)) down++;
      if ((up <= hardTop && shapeMark(x, hardTop))
        || (down >= hardBottom && shapeMark(x, hardBottom))) ran = true;
      if (up < gy0) gy0 = up;
      if (down > gy1) gy1 = down;
    }
    const gw = gx1 - gx0 + 1;
    const gh = gy1 - gy0 + 1;
    const third = Math.max(1, Math.ceil(gh / 3));
    const sideW = Math.max(1, Math.ceil(gw / 3));
    const rightFrom = Math.max(gx0, gx1 - sideW + 1);
    const leftTo = Math.min(gx1, gx0 + sideW - 1);
    const rowHas = (y, from, to) => {
      for (let x = from; x <= to; x++) if (shapeMark(x, y)) return true;
      return false;
    };
    // COUNTED OVER THE ROWS THE GLYPH ACTUALLY HAS INK IN, not over every row of
    // the box, and the difference is the third sharp of a signature.
    //
    // Where a printed staff line crosses an upright, the two merge into one long
    // horizontal run and shapeMark takes the whole row out — correctly, because
    // that row IS mostly line. A sharp centred in the space above the top line
    // has its bottom third sitting squarely on that line, so a third of its rows
    // vanish, and against a denominator of every row in the band its bottom-left
    // corner read 0.53 where the same sharp lower down the stave read 0.87. It
    // was called a natural on every size of both clefs, which is why every
    // signature of three sharps or more was refused.
    //
    // Dividing by the rows that have any ink at all asks the question the corner
    // is meant to ask — of the rows where this glyph is present down here, how
    // many reach into the left third — and an erased row then drops out of the
    // numerator and the denominator together instead of counting against it.
    //
    // TWO CORNERS AND NOT FOUR, and the other two were measured this round and
    // are not worth their cost — recorded here so nobody has to measure them
    // twice. Both uprights of a sharp run the full height of the glyph, so a
    // sharp ought to fill all four corners while a down-stemmed crotchet has
    // nothing whatever in its bottom right; that is true about the GLYPHS and
    // false about these BOXES, because the box is whatever the contiguity walk
    // above joined and the bottom third of a real sharp is often not the sharp.
    // On the 352 drawn signatures against 288 bare staves carrying one crotchet:
    // requiring the bottom-right corner costs 14 real signatures of 167 and
    // removes 21 phantom keys of 26, requiring the top-left costs 4 and removes
    // 2, and requiring all four costs 102. `ran` above removes 11 for nothing.
    let rtRows = 0;
    let rtSeen = 0;
    for (let y = gy0; y <= Math.min(gy1, gy0 + third - 1); y++) {
      if (!rowHas(y, gx0, gx1)) continue;
      rtSeen++;
      if (rowHas(y, rightFrom, gx1)) rtRows++;
    }
    let lbRows = 0;
    let lbSeen = 0;
    for (let y = Math.max(gy0, gy1 - third + 1); y <= gy1; y++) {
      if (!rowHas(y, gx0, gx1)) continue;
      lbSeen++;
      if (rowHas(y, gx0, leftTo)) lbRows++;
    }
    // …and where the ink sits, over the whole box and over its right half.
    let all = 0;
    let allY = 0;
    let right = 0;
    let rightY = 0;
    const half = gx0 + Math.floor(gw / 2);
    for (let y = gy0; y <= gy1; y++) {
      for (let x = gx0; x <= gx1; x++) {
        if (!shapeMark(x, y)) continue;
        all++; allY += y;
        if (x >= half) { right++; rightY += y; }
      }
    }
    return {
      y0: gy0,
      y1: gy1,
      // DID THE GLYPH'S INK RUN OUT OF THE WINDOW? This is what says NOTEHEAD,
      // and it is the only thing measured here that does. See classifyKeyGlyph.
      //
      // The window is the one this function already grows in — 2.4 spaces past
      // each end of the stave, which is a whole accidental clear of the 1.9 the
      // tallest one needs. An accidental in a signature is printed ON the stave
      // and its ink stops; a NOTE has a stem three and a bit spaces long, so a
      // note standing where the signature should be reaches the bound with ink
      // still under it and this comes back true.
      ran,
      rt3: rtSeen ? rtRows / rtSeen : 0,
      lb3: lbSeen ? lbRows / lbSeen : 0,
      inkY: all ? allY / all : (gy0 + gy1) / 2,
      rightY: right ? rightY / right : (gy0 + gy1) / 2,
    };
  };

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
  //
  // AND ONLY OVER INK NO ACCIDENTAL COULD BE. This is the correction that
  // matters, because the first version stepped over any ink at all and the
  // thing it was stepping over turned out, on the page it was written for, to
  // be the key signature.
  //
  // MEASURED on the Bärenreiter Bach, clef ink end against scan start: on all
  // ten systems the clef's ink ENDS BEFORE the scan begins, by 0.74 to 2.6
  // spaces. There is no overhang on that page to step over. What the walk was
  // stepping over was leaked staff line, and on systems 9 and 10 it was
  // stepping over the SHARP — the scan opens at x = 78 and 79 and the sharp's
  // own ink spans 76 to 91, because the clef band is 3.6 spaces wide and the
  // signature on this edition begins inside the last of them. The walk then ran
  // to x = 96 and the band was reported past the whole signature, at 102 to 105
  // where the printed sharp is at 85 to 97. The real overhang, where there is
  // one, is +0.6 spaces on the Concerto and +0.4 to +0.7 on the Scanned score.
  //
  // So the test is not "is there ink here" but "is this ink something an
  // accidental could not be". The reason the walk exists at all is a bass
  // clef's tail measuring six spaces tall and ending the scan before the sharp
  // two spaces further on — six spaces is nearly twice GLYPH_TALL's ceiling.
  // Ink under that ceiling is left alone: if it is an accidental the scan is
  // about to read it, and if it is not, the height test below will end the
  // signature on it as it should. Still capped at two spaces, because this is
  // for a glyph that overhangs its band and not a licence to hunt rightwards.
  //
  // AND CLAMPED TO THE IMAGE, which `limit` twelve lines above has always been
  // and this had not. `column` indexes `ink[y * w + x]` with no bounds check of
  // its own — it cannot have one, it is called for every row of every column of
  // the band — so an x at or past `w` does not read blank paper, it reads the
  // NEXT ROW's pixels, and the column comes back holding whatever stands at the
  // left-hand edge of the stave one row down. Reachable whenever the stave's
  // left edge is within two spaces of the right edge of the image, which is a
  // crop or a fragment rather than a whole page — the same reason `limit` is
  // clamped, and the two should not disagree.
  let from = start;
  const overhang = Math.min(w - 1, start + Math.round(space * 2));
  while (from <= overhang) {
    const c = column(from);
    if (!c) break;
    if ((c.last - c.first + 1) / space <= GLYPH_TALL[1]) break;
    from++;
  }

  const glyphs = [];
  const adjacent = from + space * KEY_ADJACENT;
  let x = from;
  // Where the last ACCEPTED glyph ended, which is what the next one has to be
  // near. Held explicitly rather than measured after the fact, because a speck
  // between two accidentals is now stepped over (see the floor below) and a run
  // that is stepped over must not be allowed to reset how far the signature is
  // entitled to reach.
  let lastEnd = -1;
  // The last run too narrow to be a glyph, kept in case it is the left half of
  // the next one. See the floor test below.
  let pending = null;
  // WHY THE SCAN STOPPED, which is the difference between a signature that
  // ENDED and a signature that was CUT. See the `cut` field on the return.
  //
  // 'gap'   — the next ink is more than a glyph's spacing away. The signature
  //           ended and the music begins; this is the intended terminator.
  //           'none' is the same answer with no more ink at all.
  // 'wide' / 'tall' — something adjacent to the last accidental was measured
  //           and is not an accidental.
  // 'speck' — ink stood inside the signature's own spacing and was too narrow
  //           to be a glyph. See `lastInk` below; this is the one that catches
  //           the truncations.
  // 'reach' — the scan ran out of KEY_REACH with ink still under way.
  let why = 'none';
  // The right-hand end of the last run the scan LOOKED AT, accepted or not, as
  // against `lastEnd` which is the last run it TOOK. The two part company
  // exactly when the signature was cut short — see the note on `cut` at the
  // return.
  let lastInk = -1;
  // …and how far that run stood from the last accidental TAKEN, which is what
  // says whether it is a next accidental or the last one's own debris.
  let lastInkGap = 0;
  // Two pieces are one accidental when their centres agree to this and the two
  // together are still no wider than an accidental. A space and a half is the
  // closest two different accidentals in a signature ever stand.
  const SAME_GLYPH = 0.6;   // staff spaces between the two pieces' centres
  while (x <= limit) {
    if (!column(x)) { x++; continue; }
    // HOW FAR THIS IS ALLOWED TO BE FROM WHAT CAME BEFORE, and it is the whole
    // safety property of this function: the band can never reach into music
    // that happens to start early, because every glyph after the first has to
    // begin within one glyph's spacing of the last one accepted, and the first
    // has to begin within KEY_ADJACENT of where the clef's ink stopped.
    if (glyphs.length ? x - lastEnd - 1 > gap : x > adjacent) { why = 'gap'; break; }
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
      // …AND NOT ALL AT ONCE, WHICH IS WHERE ONE ACCIDENTAL ENDS AND THE NEXT
      // BEGINS.
      //
      // The height cap above stops a run swallowing something far away, and it
      // is not sharp enough to stop a run swallowing its NEIGHBOUR. The closest
      // two accidentals in a signature ever stand is three steps — F sharp to C
      // sharp, B flat to E flat — and two sharps three steps apart, each 2.8
      // spaces tall, make a union of 2.9 spaces, which is inside a cap of 3.2.
      // MEASURED on the drawn seven sharps in treble at a staff space of 12: the
      // third sharp is printed at x = 98 and the fourth at x = 111, one blank
      // column apart, and the run took them both — 98 to 113, 3.8 spaces tall
      // once its ink was followed out, reading as a natural and refusing the
      // whole signature. It is the third sharp that does this on every treble
      // page, because it is the one printed above the top line with its
      // neighbour three steps below.
      //
      // What separates them is not how tall the union is but HOW SUDDENLY it
      // grows. Inside one glyph the columns overlap almost completely — an
      // upright spans nearly the whole height, a crossbar and a bowl add nothing
      // below it, and the largest honest jump is a natural's right upright
      // reaching a quarter of its height past the left one, about 0.75 spaces.
      // At a boundary the jump is the distance between the two degrees, a space
      // and a half at the very closest. The bound sits between them, and the
      // run is cut at the column where the ink moves.
      //
      // SWEPT on the 352 drawn signatures of tools/key-read-check.mjs, and the
      // two halves of the score move in opposite directions, so the choice is
      // made on which failure costs more rather than on the total:
      //
      //   JUMP   read correctly   read as the WRONG key
      //   0.9      295 (83.8%)      6
      //   1.1      291 (82.7%)      4
      //   1.2      290 (82.4%)      4
      //
      // A tighter bound cuts more runs, and a run cut in the middle of a
      // signature is read as a shorter signature — which is a valid prefix of
      // the real one and therefore passes the order test. That is the one
      // failure this file is built to avoid, and 0.9 buys four extra correct
      // reads by adding two of them, both on CLEAN pages at a comfortable size
      // (seven sharps read as three, in both clefs at a space of 16). At 1.1
      // every wrong read left is on a photograph. Four extra refusals is the
      // cheap half of that trade and it is the half taken.
      const JUMP = 1.1;   // staff spaces one column may add to a run's extent
      if (end >= 0 && (bottom2 - lo > space * JUMP || hi - top2 > space * JUMP)) break;
      blank = 0;
      end = k;
      hi = top2;
      lo = bottom2;
    }
    const tall = end < 0 ? 0 : (lo - hi + 1) / space;
    if (end < 0) break;
    lastInk = end;
    lastInkGap = glyphs.length ? x - lastEnd - 1 : 0;
    // A SPECK IS NOT A GLYPH AND IT IS NOT A BOUNDARY EITHER — step over it.
    //
    // This break was the single largest failure in the file. MEASURED across
    // all thirty-two systems of the three marked pages: twenty-seven of the
    // thirty-two scans ended HERE, three at the gap that is the only intended
    // terminator, two at the height floor. Every one of the twenty-seven was
    // tripped by a run of 0.08 to 0.41 spaces — fourteen of them by a run ONE
    // PIXEL wide — and because this was a `break`, one leaked pixel ended the
    // whole signature. On systems 5, 6 and 7 of the Scanned score the speck sat
    // at x = 104 and the printed sharp began at x = 107: the scan died three
    // pixels short of the thing it was looking for.
    //
    // The floor itself is right and stays: a one-pixel speck used to be COUNTED
    // as a signature of one, which is why it was put here. The mistake was
    // making the cure terminal — it turned a false positive into a total
    // failure on eleven systems of thirty-two. Something too narrow to be a
    // glyph is grain, a broken line or the frayed edge of the clef, and the
    // right answer to grain is to walk past it. What keeps that bounded is the
    // adjacency test at the top of the loop, not this one: a speck does not
    // move `lastEnd`, so the scan still has to find its next real accidental
    // within one glyph's spacing of the last one it accepted.
    // …BUT REMEMBER IT, BECAUSE HALF A SHARP LOOKS EXACTLY LIKE A SPECK.
    //
    // A sharp centred ON a staff line loses its crossbars: they lie along the
    // line, the merged run is hundreds of pixels wide, and onRule takes the
    // rows out as line ink — correctly, because those rows ARE mostly line. What
    // is left is the sharp's two uprights standing separately, with two blank
    // columns where its middle was, and the run loop above ends a run at two
    // blanks.
    //
    // MEASURED, on the drawn signature of seven sharps in treble at a staff
    // space of 16 (tools/key-read-check.mjs, and the column dump that found it).
    // The fourth sharp is printed at x = 149 and is seventeen columns wide. The
    // columns read: 149–154 solid, 155 one pixel, 156 and 157 EMPTY, 158 one
    // pixel, 159–165 solid. So the scan cut it at 155, called 149–155 a speck at
    // 0.44 spaces against a floor of 0.5, threw it away, and reported the sharp
    // as the run 158–165 — half a glyph, whose bottom-left corner is a bare
    // upright and which reads as a natural. Every signature of four sharps or
    // more failed this way.
    //
    // Widening the run's blank tolerance does not work and the same dump says
    // why: the gaps BETWEEN accidentals in that signature are one and two
    // columns — 111, 129, 147–148, 166, 184, 203 — which is the same size as the
    // gap inside the broken sharp. There is no daylight in the horizontal.
    //
    // There is a great deal of it in the VERTICAL. Two pieces of one accidental
    // are two uprights of the same glyph and share a centre to within the stem
    // offset, about 0.15 of a space. Two different accidentals in a signature
    // are never nearer than three steps apart — that is the closest any pair in
    // either order comes, F sharp to C sharp and B flat to E flat — which is a
    // space and a half. Ten times the margin, so the test is the centre.
    //
    // WHY THIS CANNOT MOVE THE SUPPRESSION. A speck is joined only to the run
    // AFTER it, so the only thing that can change is a glyph's x0, and a joined
    // x0 is always further LEFT than the one it replaces. dropFurniture
    // suppresses from the stave's edge to the band's x1, and x1 is the last
    // glyph's end — untouched here. The count is untouched too: a speck was
    // never counted and a joined one still is not counted separately.
    if ((end - x + 1) / space < GLYPH_FLOOR) {
      pending = { x0: x, x1: end, hi, lo };
      x = end + 1;
      continue;
    }
    // Anything that is not an accidental ends the signature — including the
    // first note, which is exactly the boundary the rule this replaced could
    // not find at all.
    if ((end - x + 1) / space > GLYPH_WIDE) { why = 'wide'; break; }
    if (tall < GLYPH_TALL[0] || tall > GLYPH_TALL[1]) { why = 'tall'; break; }
    // The other half of this glyph, if the speck just stepped over was one.
    let x0 = x;
    let gy0 = hi;
    let gy1 = lo;
    if (pending
      && Math.abs((pending.hi + pending.lo) / 2 - (hi + lo) / 2) <= space * SAME_GLYPH
      && (end - pending.x0 + 1) / space <= GLYPH_WIDE) {
      x0 = pending.x0;
      gy0 = Math.min(gy0, pending.hi);
      gy1 = Math.max(gy1, pending.lo);
    }
    pending = null;
    glyphs.push({ x0, x1: end, ...describe(x0, end, gy0, gy1) });
    lastEnd = end;
    x = end + 1;
  }

  // Ran out of reach with the signature still under way, which is the other way
  // a long one gets cut: KEY_REACH bounds the scan at nine spaces and seven
  // flats is ten spaces of band. Asked as "is there ink where the NEXT
  // accidental would stand", not as "is there ink anywhere out there" — the
  // second question is answered yes by the first note of the bar on a page
  // whose signature is complete, and gating on it refused nine correct reads.
  //
  // Floored by SAME_GLYPH exactly as the speck test below is, and for the same
  // reason: both paths mean "ink continues past the last accidental taken", so
  // both have to exclude that accidental's own debris. Leaving the floor off
  // one of them would be an asymmetry a reader could only take for a bug.
  if (why === 'none' && glyphs.length) {
    const clear = lastEnd + 1 + Math.round(space * SAME_GLYPH);
    for (let k = clear; k <= Math.min(w - 1, lastEnd + 1 + gap); k++) {
      if (column(k)) { why = 'reach'; break; }
    }
  }
  // …and the one that actually catches the truncations: ink stood WITHIN the
  // signature's own spacing of the last accidental taken, and was stepped over
  // as grain rather than measured.
  // …AND THE SPECK HAS TO STAND FAR ENOUGH OUT TO BE A DIFFERENT GLYPH.
  //
  // The bound is SAME_GLYPH, reused rather than invented: it is already this
  // file's answer to "are these two pieces of ink one accidental or two", and
  // that is exactly the question here. A sharp centred on a staff line loses
  // its crossbars and splits into two uprights, and where the rejoin above
  // fails to put them back the leftover upright is stepped over as a speck
  // sitting almost on top of the accidental that was taken — which is the
  // glyph's own debris and says nothing about a signature being cut.
  if ((why === 'gap' || why === 'none') && lastInk > lastEnd
    && lastInkGap > space * SAME_GLYPH) why = 'speck';

  if (!glyphs.length || glyphs.length > 7) return null;
  // The glyphs themselves come out too, and not as a diagnostic. A page agrees
  // with itself about how many accidentals it has (see agreeKeyCount below) and
  // the only way to act on that agreement without inventing ink is to keep the
  // FIRST n of the runs this system's own scan actually found. So the caller
  // needs the runs, not just the extent they add up to.
  return {
    x0: glyphs[0].x0,
    x1: glyphs.at(-1).x1,
    count: glyphs.length,
    glyphs,
    // WAS THE SIGNATURE CUT SHORT? The extent is reported either way and the
    // suppression uses it either way — this only tells readKeySignature that
    // the run of accidentals it is holding may be a PREFIX of the real one.
    //
    // A cut signature is the one dangerous failure this file has, because a
    // prefix of a key signature is a valid key signature: four sharps cut to
    // three reads F, C, G in order and passes every test below it. The order
    // check cannot see it, and the page agreement only helps when the systems
    // are cut differently.
    //
    // MEASURED on the 352 drawn signatures: all four of the reads that came
    // back as the WRONG key end here, and every one of them ends the same way —
    // 'speck'. That is worth spelling out because it is not the mechanism the
    // obvious version of this rule looks for. The next accidental had NOT been
    // measured and rejected; the photograph had thresholded it down to
    // fragments under GLYPH_FLOOR, the scan stepped over them as grain, and
    // because a stepped-over speck deliberately does not move `lastEnd` the
    // adjacency test then measured from the last accidental it TOOK all the way
    // to the first note of the bar and reported a clean gap. So the signature
    // ended on the intended terminator while the missing accidental's own ink
    // was sitting inside the band the whole time.
    //
    // Hence `lastInk` against `lastEnd`, which is the honest form of "the ink
    // continues past the last glyph the scan accepted": it counts the runs the
    // scan LOOKED at, not only the one it broke on.
    // WHICH ENDINGS COUNT AS CUT, and the line is drawn where this file already
    // drew it rather than at "anything but a blank gap".
    //
    // 'gap' and the height and width tests are the INTENDED terminators, and
    // the note above GLYPH_TALL says so: everything the scan cannot identify
    // stops the signature, the first note of the bar included. A signature that
    // ends because the thing next to it was measured and is not an accidental
    // ended the way this function is built to end. MEASURED: refusing those as
    // well costs seven correct reads of the 224 and removes no wrong key at
    // all.
    //
    // 'speck' and 'reach' are not terminators, they are the scan giving up.
    // A speck is meant to be STEPPED OVER and the scan is meant to carry on; if
    // the signature then ends, that speck was the accidental. Reach is the scan
    // hitting its own bound with the next accidental's ink already in view.
    // Refusing those two costs six correct reads and takes the WRONG-key count
    // from four to zero.
    why,
    cut: why === 'speck' || why === 'reach',
    // HOW FAR THE LAST RUN THE SCAN LOOKED AT STOOD FROM THE LAST ONE IT TOOK,
    // in pixels, or -1 where they are the same run. This is the exact quantity
    // the speck test bounds, reported so a `cut` can be explained instead of
    // merely asserted — and so that a report showing it cannot drift from the
    // rule. Under SAME_GLYPH it is the accidental's own debris; around a
    // glyph's pitch it is a real next accidental, which is a true truncation.
    inkGap: lastInk > lastEnd ? lastInkGap : -1,
  };
}

// HOW MANY ACCIDENTALS THE PAGE HAS, from the systems that agree.
//
// A key signature is printed once per system and it is the same one every time.
// That is a fact about how music is engraved, not a pattern noticed in some
// pixels, and it is the one piece of cross-system reasoning this reader is
// allowed — because it decides a COUNT, not a position, and the count is only
// ever used to make a band NARROWER.
//
// Read the difference carefully, because a rule that looks like this one was
// built here before and taken out with numbers. That rule found NOTEHEADS by
// their being repeated system to system, and it cost four to eight points of
// recall across the corpus, because music near the start of a system is often
// similar system to system and nothing in it could tell "printed twice" from
// "played twice". This asks nothing about any position on any other system. It
// takes the count each system read off its OWN ink, and returns the count the
// page as a whole supports; each band is then trimmed to its own first n runs,
// so a system that found nothing still gets nothing and a system that found one
// glyph is never handed a second from somewhere else. The suppression can
// therefore never reach past ink that system printed, whatever the page agrees.
//
// A LOW QUANTILE, not the mode or the median, and the reason is which way the
// errors run. Under-counting costs a false circle on the key signature, which
// is cosmetic; over-counting widens a suppression band into the music and costs
// a NOTE, which breaks the alignment a take depends on. So the statistic is
// picked for the direction of the damage, the same way `margin` and the system
// gaps are picked in scan-read.js.
//
// THE FIRST VERSION OF IT WAS THE MINIMUM IN DISGUISE, and on a short page that
// is what it was. It indexed the sorted counts at `floor((n - 1) * 0.25)`,
// which is ZERO for n = 1, 2, 3 AND 4 — so on a page of four systems reading
// 2, 4, 4, 4 it agreed on 2, every system's band was trimmed to its first two
// glyphs, and on an E major page the third and fourth sharps came back as false
// circles on every system of it. Three systems out of four had read the truth
// and the one that had not decided the page.
//
// It got away with it because of what it was measured on. The three marked
// pages are ONE SHARP on every system between them, so the only failure they
// can show is over-reading, and the minimum is the perfect statistic for a page
// that can only over-read. That is not evidence about a page in five flats.
//
// SO IT IS STATED AS THE QUESTION IT IS ASKING: what is the largest count that
// at least THREE QUARTERS of the witnesses will support? That is the sorted
// counts indexed at `n - ceil(n * 0.75)`, which is the honest rounding of the
// low quartile rather than a floor that keeps landing on zero. It answers 4 on
// the E major page and it is unchanged on all three marked pages.
//
// AND BELOW FOUR WITNESSES IT CANNOT BE ANYTHING BUT THE MINIMUM — three
// quarters of three, rounded up, is three — which is arithmetic and not a
// choice, so it is declared here rather than discovered later. A page with
// fewer than four systems reporting a band has no quorum to argue with, and the
// answer is the narrowest reading any of them made. That is the SAFE direction:
// the trim can only ever narrow a band (see trimKeyBand), so the minimum
// suppresses least and costs at worst a false circle, where returning null
// would leave a system that ran on into the music suppressing the music. Four
// is where the declared floor and the statistic's own arithmetic coincide.
//
// THAT IS STILL TRUE OF THE TRIM AND IS NO LONGER TRUE OF THE SUPPRESSION, and
// the difference matters to anybody reasoning from this note. `trimKeyBand`
// narrows and nothing else; but `agreeKeyReach` below now lets the page WIDEN
// the range dropFurniture suppresses on a system whose own band came back
// short, which is a thing no cross-system rule in this file used to do. The
// safety argument that replaces "it can only narrow" is written out in full
// above agreeKeyReach, and it is a weaker argument that has to be checked
// rather than assumed — npm run scan:key-safety has a block that checks it.
//
// RE-MEASURED this round rather than carried forward, because the counts this
// comment used to quote — Bach 1,1,1,1,4,1,5,3 · Concerto 2,1,1,2,1,4,2,3,1,2 ·
// Scanned 2,2,1,1,1,4,2,2,2 — are stale. `npm run scan:key-why` on all three
// pages now reads a band count of ONE on every system that finds a band at all:
// Bach 9 of 10, Concerto 10 of 11, Scanned 10 of 11. The over-reading those
// numbers describe was fixed by the band scan since they were taken, so every
// statistic on this page — minimum, quartile, median, mode — returns 1 on all
// three, and no marked page can currently tell them apart. The E major case
// below is a unit test for the same reason.
const MIN_WITNESSES = 4;

export function agreeKeyCount(counts) {
  const ranked = counts.filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!ranked.length) return null;
  if (ranked.length < MIN_WITNESSES) return ranked[0];
  return ranked[ranked.length - Math.ceil(ranked.length * 0.75)];
}

/**
 * One system's band, trimmed to the count the page agreed on.
 *
 * Never widens: a band of one glyph on a page that agreed on three stays one
 * glyph, because the other two are not in this system's ink and a suppression
 * that reaches past a system's own ink is exactly the failure this file exists
 * to avoid.
 */
export function trimKeyBand(band, count) {
  if (!band || !count || band.count <= count) return band;
  const glyphs = band.glyphs.slice(0, count);
  // CUT UNCONDITIONALLY, because a trimmed band IS a prefix — that is the whole
  // of what this function does. Nothing reads a key off a trimmed band today
  // (dropFurniture deliberately reads the untrimmed one and uses this only to
  // suppress, and the note there says why), but a band that has had glyphs
  // taken off its end and reports itself un-cut is a loaded gun: it would walk
  // straight past readKeySignature's refusal and be read as the shorter key it
  // now looks like. `why` is carried for the same reason.
  return {
    x0: glyphs[0].x0,
    x1: glyphs.at(-1).x1,
    count: glyphs.length,
    glyphs,
    why: band.why,
    cut: true,
    inkGap: band.inkGap,
  };
}

/**
 * How far past its own left edge this PAGE prints its key signature, in staff
 * spaces — the one number a system whose own band came back short can borrow.
 *
 * WHY THIS IS NOT THE CROSS-SYSTEM VOTING THAT IS ALREADY MEASURED AND DEAD.
 *
 * "What is measured and does NOT work" records finding NOTEHEADS by repetition
 * across systems, at a cost of four to eight points of recall on the corpus,
 * because music near the start of a system is often similar system to system
 * and a rule that cannot tell "printed twice" from "played twice" takes the
 * notes as well. That rule located music. This one measures ONE PRINTED OBJECT
 * THAT GENUINELY REPEATS: a key signature is the same glyphs at the same
 * distance past the stave's left end on every system of a page, by the
 * engraver's own construction, and nothing about the music is inferred from it.
 * Nothing here is proposed, accepted or located — only a distance is agreed.
 *
 * THE INVARIANT THIS REPLACES, stated so nobody reads the old one and believes
 * it. Until now every bound in findKeyBand was measured off the ink of the
 * system being scanned, and the comment above agreeKeyCount said in as many
 * words that the page's agreement could only ever NARROW a band. That is no
 * longer true and cannot be, because the failure it leaves standing is a band
 * that stops INSIDE the printed sharp: the Concerto's systems 5, 7 and 11 come
 * back 0.40, 0.40 and 0.81 staff spaces wide against 1.39 on the same page, and
 * the right-hand half of the glyph is left outside the suppression and circled.
 * Looked at — `CROP_MARKS=1 CROP_TRUTH=pages/truth/mozart.truth.json npm run
 * scan:crop -- Concerto.pdf 74,797` — those bands are not narrow readings of
 * the sharp at all; they are the treble clef's own trailing ink, fifteen pixels
 * to the LEFT of a sharp the scan never reached.
 *
 * So the new safety argument, which is weaker and has to be stated rather than
 * assumed:
 *
 *   - the reach is a MEDIAN of what systems that successfully READ A KEY
 *     measured for themselves, so it is a distance at which real accidentals
 *     were found on this page and not a guess;
 *   - it is applied only to WIDEN — `Math.max` against the system's own answer —
 *     so no system can lose suppression it already had;
 *   - it needs the same MIN_KEY_WITNESSES the page's key needs, and the caller
 *     additionally refuses it on a page whose systems did not AGREE on a key,
 *     which is what keeps it off a corpus page where two bare staves have each
 *     invented a different signature out of their first notehead;
 *   - and it is bounded by the same thing every band is bounded by, because
 *     each witness's own reach was produced by findKeyBand walking that
 *     system's ink.
 *
 * The median rather than the minimum, and that is measured rather than
 * preferred. The Concerto's five witnesses reach 5.64, 6.14, 6.44, 6.53 and
 * 6.57 spaces; the minimum puts the band's end at x = 72 and the false circles
 * stand at 74 and 75, so it buys nothing at all. The median reaches 79 and
 * catches them, and the largest witness on the page reaches 81 — a page whose
 * first note stands at x = 126. The minimum is the safe direction for a COUNT,
 * where the trim only narrows; it is the useless direction for a reach.
 *
 * A WITNESS IS A SYSTEM THAT READ A KEY, AND THAT IS A WEAKER FILTER THAN IT
 * LOOKS — worth knowing before anybody tightens the statistic. A system can read
 * the RIGHT key off a band that stopped inside the glyph, because a sharp
 * measured half-width is still classified as a sharp and one sharp is still one
 * sharp. The Bach shows it: `npm run scan:key-why` gives system 4 a band 0.74
 * staff spaces wide against 1.14 to 1.16 on the systems that read cleanly, and
 * it reads "1 sharp" all the same. So its reach, 4.87 spaces, is a SHORT reading
 * voting on where the signature ends, and it is the lower of the two middles —
 * exactly the value the sweep below rejects. The statistic survives this because
 * it takes the upper middle; a narrower one would be deciding the page off the
 * broken readings it exists to repair. Filtering witnesses by band width instead
 * is a different statistic with its own sweep to do, and the plateau below says
 * it would buy nothing today.
 *
 * Takes the per-system reaches in staff spaces, already paired with whether
 * that system read a key. Returns null when too few systems read one.
 */
export function agreeKeyReach(witnesses) {
  const said = witnesses
    .filter((wn) => wn && wn.key && Number.isFinite(wn.reach) && wn.reach > 0)
    .map((wn) => wn.reach)
    .sort((a, b) => a - b);
  if (said.length < MIN_KEY_WITNESSES) return null;
  // THE UPPER MIDDLE, and the choice is a measured plateau rather than a
  // preference. Swept on the three marked pages, false circles left standing on
  // the key signature (Bach + Concerto + Scanned score), recall unchanged to the
  // digit at every setting:
  //
  //   statistic       Bach   Concerto   Scanned   bench mean P / R
  //   nothing (today)    4        7         1        92.1 / 94.9
  //   minimum            4        6         1        92.2 / 94.9
  //   lower middle       4        1         1        92.6 / 94.9
  //   UPPER MIDDLE       2        1         1        92.8 / 94.9
  //   maximum            2        1         1        92.8 / 94.9
  //
  // The top of the distribution is FLAT — the upper middle and the maximum give
  // the same answer on all three pages — so the choice between them is made on
  // which a single bad witness cannot move, and that is the middle. The lower
  // middle is a knife edge and the measurement says so: the Bach's four
  // witnesses reach 4.87, 4.88, 5.20 and 5.46 spaces, its false circles stand at
  // x = 93 and the lower middle puts the band's end at 93.0.
  //
  // Under-reading is the failure this exists to repair — a band that stops
  // INSIDE the printed sharp — so the short witnesses are the broken ones and a
  // statistic that lets them decide buys nothing. Over-reading cannot set the
  // answer, because agreeKeyCount has already trimmed an over-reading band back
  // to the page's agreed number of glyphs before its reach is taken here.
  //
  // At exactly two witnesses this is the LARGER of the two, which is the
  // direction agreeKeyCount refuses for a COUNT. The two are not the same
  // question: a count too large reaches a suppression into the music, while a
  // reach too small simply leaves the sharp circled, and both witnesses' reaches
  // are bounded by findKeyBand's walk over their own ink either way.
  return said[Math.floor(said.length / 2)];
}

// ---------------------------------------------------------------------------
// WHICH key signature it is: the glyphs told apart, placed on the stave, and
// then checked against the one order an engraver is allowed to write them in.
// ---------------------------------------------------------------------------

// SHARP, FLAT OR NATURAL, BY THE TWO CORNERS THAT ARE EMPTY.
//
// Width and height were measured first and they do not do it. On real Bravura
// at four sizes, clean and photographed (tools/key-audit.mjs):
//
//   sharp    1.05–1.27 wide   2.15–2.89 tall
//   flat     0.95–1.23 wide   2.43–2.62 tall
//   natural  0.73–1.08 wide   2.31–2.84 tall
//
// Three ranges lying on top of each other. What DOES separate them is where the
// strokes reach, and the cheapest way to ask that is to look at two corners of
// the glyph's own bounding box:
//
//   a SHARP  is two uprights the full height of the box crossed by two thick
//            slanted bars. Both uprights run top to bottom, so ink reaches the
//            top-right corner AND the bottom-left one.
//   a FLAT   is one upright on the LEFT with a bowl hanging off its lower right.
//            The upright fills the bottom-left corner; the top right is bare
//            paper, because a flat has nothing at all up there.
//   a NATURAL is two uprights offset diagonally — the left one runs from the top
//            down to the lower bar, the right one from the upper bar down to the
//            bottom. Both of those corners are therefore empty, which is the
//            pair a flat satisfies only half of.
//
// So one number per corner: of the rows in the top third of the box, what
// fraction have ink somewhere in its right third (rt3); and of the rows in the
// bottom third, what fraction have ink in its left third (lb3). Then
//
//   both corners inked      -> sharp
//   only the bottom-left    -> flat
//   neither                 -> natural
//
// MEASURED, on 204 real Bravura accidentals — sharp, flat and natural, drawn at
// nine positions on the stave at four sizes, clean and photographed, thresholded
// the way readPage thresholds and cleaned by this file's own onRule
// (scratchpad probe key-feat.mjs, and tools/key-read-check.mjs is the version of
// it that ships):
//
//               min(rt3, lb3)        lb3
//   sharp        0.67 – 1.00      0.67 – 1.00
//   flat         0.00 – 0.40      0.67 – 1.00
//   natural      0.00 – 0.67      0.13 – 0.83
//
// A cut at 0.6 reads 67 of 67 sharps, 70 of 70 flats and 64 of 67 naturals. All
// three misses are the same cell: a staff space of nine pixels PHOTOGRAPHED,
// which after the camera's own downscale is a working space of 6.5 pixels — a
// natural there is five pixels wide with bars a pixel thick, and it is not a
// shape any more. Drop that one cell and the three populations are exactly
// separated: min(rt3, lb3) reads 0.67–1.00 for a sharp against 0.00–0.50 for a
// natural, and lb3 reads 0.67–1.00 for a flat against 0.13–0.55.
//
// The three marked pages work at 9.6 to 12.1 pixels a space and the synthetic
// corpus goes down to 7, so the failing cell is smaller than anything this
// reader is asked to read. It is written down rather than papered over.
//
// ONE CONSTANT FOR BOTH TESTS, and it is not a coincidence — it is the same
// question asked of two corners, so the same number answers it. Both boundaries
// have their daylight in the same place, 0.55 to 0.67, and 0.6 sits in it.
const KEY_CORNER = 0.6;

// …AND THE FOURTH ANSWER, WHICH IS "THIS IS NOT AN ACCIDENTAL AT ALL".
//
// The three corner patterns above partition every run into sharp, flat or
// natural, and a partition has no way to say "none of these". A PLAIN NOTEHEAD
// therefore came out of it as an accidental, and the failure is the expensive
// kind rather than the cheap one. MEASURED, on a bare stave with no printed
// signature and one crotchet standing where the signature would be, at nine
// steps, both stem directions, two clefs, four sizes, clean and photographed —
// 288 pages: TWENTY-SIX of them come back with a key. A down-stemmed crotchet
// puts its head in the top third of its own box (both corners inked) and its
// stem down the LEFT of the bottom third, which is a sharp's pattern exactly,
// so twenty-two of the twenty-six read ONE SHARP, F sharp — the commonest
// signature in print. One of them reads it at confidence 0.99.
//
// WHAT SAYS NOTEHEAD IS THE STEM LEAVING THE WINDOW, and it is the only thing
// measured that separates. `describe` grows a glyph's box by contiguity out to
// 2.4 spaces past each end of the stave; an accidental's ink stops well inside
// that, and a stem is 3.2 spaces long and does not. So `ran` — ink still
// present AT the bound — is a notehead and nothing else:
//
//   drawn accidentals whose ink reached the bound     0 of 1331
//   crotchets whose ink reached the bound            51 of  138
//
// Zero false positives on the whole drawn corpus, which is why this ships as a
// hard refusal rather than as a weighting.
//
// IT IS PARTIAL AND THAT IS STATED RATHER THAN HIDDEN: it removes 11 of the 26
// phantom keys and costs nothing. (Re-measured after the rest of this round, the
// residual is 14 of 288 — the truncation rule below takes one more.) The other 15 are notes whose stem happens to
// end inside the window — a head on the middle line with a down stem finishes
// 1.2 spaces below the bottom line, comfortably in — and NOTHING measured
// reaches them for less than it costs. Four candidates were swept on the same
// 288 bare staves against the 167 drawn signatures the reader gets right today,
// counting whole signatures because one refused glyph refuses the signature:
//
//   rule                            real signatures lost   phantom keys removed
//   ran (this one)                        0 of 167              11 of 26
//   a sharp must fill the BOTTOM-RIGHT   14 of 167              21 of 26
//   a sharp must fill the TOP-LEFT        4 of 167               2 of 26
//   all four corners                    102 of 167              26 of 26
//   the box taller than 3.4 spaces       18 of 167              10 of 26
//   the box taller than 3.7 spaces        8 of 167               6 of 26
//
// **HEIGHT DOES NOT SEPARATE, and the note above GLYPH_TALL should not be read
// as saying it does.** That note's 2.15–2.89 against a notehead's 3.67–3.74 is
// tools/key-audit.mjs's number, and key-audit measures a box CLIPPED at the
// scan's own narrow band and cleaned by a different line test. Measured on the
// box this function is actually handed, 162 of 1331 drawn accidentals stand
// over 3.2 spaces and the tallest is 4.63, because a signature's neighbours
// touch and the contiguity walk joins them — while a crotchet reads 1.23 to
// 4.32. The two populations lie on top of each other. In particular the fourth
// sharp of a four-sharp treble signature, which the reader READS today,
// measures 3.83 where the crotchet that started all this measures 3.75.
//
// The rest of the defect is closed one level up instead, by agreeKey refusing
// to let a single system name a page's key. See MIN_WITNESSES there.

/**
 * Which accidental a run of ink is: 'sharp', 'flat', 'natural' — or 'notehead',
 * meaning it is not an accidental and the caller must not read a key off it.
 *
 * Takes the numbers findKeyBand measured off the run, so this is a pure
 * function and can be argued with on its own.
 *
 * Returns null for a run with no shape reported, which is what a caller holding
 * an old band from before this existed would have.
 */
export function classifyKeyGlyph(glyph) {
  if (!glyph || typeof glyph.rt3 !== 'number' || typeof glyph.lb3 !== 'number') return null;
  if (glyph.ran) return 'notehead';
  if (Math.min(glyph.rt3, glyph.lb3) >= KEY_CORNER) return 'sharp';
  if (glyph.lb3 >= KEY_CORNER) return 'flat';
  return 'natural';
}

// WHERE ON THE STAVE IT STANDS, and the trap in it.
//
// A sharp and a natural are built symmetrically about the note they belong to:
// the crossbars straddle the line or fill the space, and the ink above balances
// the ink below. So the centre of their ink IS their degree, to within a fifth
// of a step.
//
// A FLAT IS NOT. Its bowl is the note; its ascender is a tail that runs about
// two staff spaces further UP and belongs to no pitch at all. Take the centre of
// a flat's ink and every flat on the page comes out a step high — MEASURED at
// +0.84 half-steps of bias, which rounds a flat on a line onto the space above
// it and turns B flat into C flat. That single mistake would put a semitone on
// the wrong degree of every bar of the page.
//
// So a flat is read off its BOWL, and the cheapest handle on the bowl is that it
// is the only part of a flat lying in the right half of its own box — the
// ascender is hard against the left edge. The centre of ink in the right half is
// the bowl's centre, and the bowl's centre is 0.40 half-steps above the note.
//
// MEASURED, on the same 204 glyphs, as the error in half-steps against the
// position each was drawn at:
//
//                       centre of all ink      centre of the right half
//   sharp                +0.13 ± 0.21              +0.33 ± 0.19
//   natural              +0.14 ± 0.20              −0.31 ± 0.28
//   flat                 +0.84 ± 0.37              +0.40 ± 0.25
//
// A step is rounded to the nearest half-space, so anything under half a step of
// error reads the right degree. The centre of all ink does that for a sharp and
// a natural with 0.29 of a step to spare; for a flat it does not, and the right
// half does, with 0.25 to spare. Two estimators, because two shapes.
//
// The biases are small — 0.13 of a half-step is a sixteenth of a staff space —
// and they are subtracted rather than ignored because they are the same sign on
// every one of the 204 and they buy back a third of the rounding margin.
const INK_BIAS = 0.13;    // half-steps: a sharp's and a natural's ink sits this high
const FLAT_BOWL = 0.40;   // half-steps: a flat's bowl sits this high of its note

// Which note the BOTTOM LINE of the stave is, as a diatonic degree — C=0, D=1,
// E=2, F=3, G=4, A=5, B=6. This is the whole of what a clef does, and it is the
// only clef-dependent number in this file.
//
//   treble   bottom line E4   degree 2
//   bass     bottom line G2   degree 4
//   tenor    bottom line D3   degree 1   (a C-clef on the fourth line)
//
// TENOR WAS WRONG BY TWO DEGREES AND THIS IS A CELLO APP, so tenor is core
// repertoire and not an edge case. The entry read 3 with a comment saying the
// bottom line is F3. Derive it rather than remembering it: a tenor clef puts
// MIDDLE C on the FOURTH line, so counting down from there the five lines are
// D3 F3 A3 C4 E4 and the bottom one is D3, degree 1. F3 is the SECOND line.
//
// The failure was not silence, which is what makes it worth this paragraph. A
// probe sweeping a lone sharp over steps 0 to 9 in tenor came back
// {degrees:[3]} — "one sharp, F sharp", the commonest signature there is, and
// therefore the most believable — at steps 0 and 7, where the glyph is really
// standing on D. It now reads one sharp at steps 2 and 9, which are the F
// lines, and refuses 0 and 7. scan-clef.js does return 'tenor', so every one of
// those readings was reachable on any cello page.
//
// The same two numbers are in scan-notes.js — BOTTOM_LINE.tenor and its own
// BOTTOM_DEGREE — and were wrong there in the same way. A duplicated assumption
// is wrong in every copy or in none; if a third copy appears, derive it there
// too rather than copying this one.
//
// The reader's steps are counted from that line in half-spaces, so a step of n
// is n degrees up from it and the degree is (bottom + n) mod 7.
const BOTTOM_DEGREE = { treble: 2, bass: 4, tenor: 1 };

/**
 * The step a key-signature glyph stands on: half-spaces above the bottom line,
 * the same units readPage reports a notehead's step in.
 *
 * `bottomY` is the y of the stave's bottom line where the band begins.
 */
export function keyGlyphStep(glyph, kind, bottomY, space) {
  if (!glyph || !(space > 0)) return null;
  const y = kind === 'flat' ? glyph.rightY : glyph.inkY;
  const bias = kind === 'flat' ? FLAT_BOWL : INK_BIAS;
  if (typeof y !== 'number') return null;
  return (bottomY - y) / (space / 2) - bias;
}

/**
 * WHICH key this system is in, or null.
 *
 * Returns { sharps, flats, alter, count, kind, degrees, confidence } — the same
 * shape keyFromCount returns, with the reading's own evidence attached.
 *
 * NULL IS THE IMPORTANT RETURN VALUE AND IT IS WHY THIS FUNCTION IS SAFE TO
 * SHIP.
 *
 * A key signature is not a set of accidentals, it is a PREFIX of one fixed
 * sequence. Three sharps are F, C and G and can be nothing else, because that is
 * what the tables at the top of this file mean. So the reading can be checked
 * against something the reader did not choose: read the degrees off the stave,
 * and if they are not the first n of SHARP_ORDER or FLAT_ORDER, the scan has
 * gone wrong and there is no answer to give.
 *
 * Refusing is far cheaper than guessing, and the asymmetry is not close. A key
 * read as two sharps on a page in G major puts a semitone on every C on the
 * page — every one of them, for as long as the reading lasts, in a part where a
 * semitone is the difference between in tune and unplayable. A key read as null
 * puts a semitone on nothing: the caller falls back to NO_KEY, the naturals are
 * right, and only the F sharps are wrong. Wrong is worse than absent, so
 * everything this cannot confirm is refused.
 *
 * The four refusals, each of them evidence of a bad scan rather than of exotic
 * music:
 *
 *   - A NOTEHEAD anywhere in the band, which is a run whose ink walked out of
 *     the shape window on a stem — the music, reached by a scan that should
 *     have stopped. See classifyKeyGlyph: without this a bare stave with a
 *     down-stemmed crotchet at the head of it reads ONE SHARP, and it reads it
 *     at confidence up to 0.99.
 *   - A NATURAL anywhere in the band. A natural at the head of a system cancels
 *     the key that was printed before it, which is a key CHANGE — and a change
 *     is a thing this reader has no notion of (see docs/reader-handover.md,
 *     "What is NOT built"). Worse, a cancellation stands at exactly the degrees
 *     the old key's sharps stood at, so the order test cannot catch it: three
 *     naturals cancelling A major would pass every test below and be reported as
 *     A major, which is the one key the page is certainly NOT in.
 *   - MIXED kinds. No engraver writes a sharp and a flat in the same signature.
 *     A band holding both has read something that is not a signature.
 *   - DEGREES OUT OF ORDER. The commonest cause is the scan starting inside the
 *     clef or running on into the first note, and it is exactly what the order
 *     is able to see.
 *
 * `lineY(k)` gives the y of the stave's kth line where the band begins, k = 0
 * the top line and k = 4 the bottom, which is the same convention findKeyBand
 * takes.
 */
export function readKeySignature(band, lineY, space, clef) {
  if (!band?.glyphs?.length) return null;
  const bottom = BOTTOM_DEGREE[clef];
  // A clef this cannot name cannot name a line either, and a signature read
  // against a guessed clef is a guess wearing a measurement's clothes — the
  // same argument scan-clef.js makes about refusing a stave outright.
  if (bottom === undefined) return null;
  if (!(space > 0)) return null;

  // A SIGNATURE THE SCAN CUT SHORT IS A VALID-LOOKING PREFIX, so it is refused
  // before anything is read off it. See `cut` on findKeyBand's return for the
  // measurement and for why the mechanism is not the one you would guess.
  if (band.cut) return null;

  const bottomY = lineY(4);
  const kinds = band.glyphs.map((g) => classifyKeyGlyph(g));
  // Only two of the four answers are a key signature. A natural is a key
  // CHANGE, a notehead is the music, and a null is a run nothing could measure
  // — all three are refusals rather than readings.
  if (kinds.some((k) => k !== 'sharp' && k !== 'flat')) return null;
  const kind = kinds[0];
  if (kinds.some((k) => k !== kind)) return null;

  const degrees = [];
  // How far the worst glyph was from sitting squarely on a line or in a space.
  // A key signature is printed dead on its degrees, so a glyph landing a third
  // of the way between two of them is a glyph that was not measured well, and
  // that is worth telling a caller even when the order test passes.
  let worst = 0;
  for (const [i, g] of band.glyphs.entries()) {
    const step = keyGlyphStep(g, kinds[i], bottomY, space);
    if (step === null) return null;
    const whole = Math.round(step);
    worst = Math.max(worst, Math.abs(step - whole));
    degrees.push(((bottom + whole) % 7 + 7) % 7);
  }

  const order = kind === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  for (const [i, d] of degrees.entries()) if (d !== order[i]) return null;

  const key = keyFromCount(degrees.length, kind);
  if (!key) return null;
  // Half a step is the point at which a glyph would have been rounded onto the
  // neighbouring degree, so the margin left over is 0.5 − worst, and a
  // confidence of 1 means every glyph landed exactly on its line.
  return { ...key, count: degrees.length, kind, degrees, confidence: Math.max(0, 1 - worst * 2) };
}

/**
 * The page's key, from the systems that read one.
 *
 * A key signature is printed once per system and it is the same one every time,
 * which is the same fact agreeKeyCount above leans on and the same care applies:
 * this decides ONE answer for the page out of answers each system read off its
 * OWN ink, and it never hands a system a glyph another system found.
 *
 * Returns { key, systems, read, agreed } — `systems` how many staves there are,
 * `read` how many returned a signature at all, `agreed` how many of those agree
 * with the answer. A caller can then tell "eleven systems of eleven agree" from
 * "one system guessed", which is the difference between a key worth acting on
 * and a coincidence.
 *
 * A MAJORITY OF WHAT WAS READ, or nothing. Two systems saying one sharp against
 * two saying two sharps is not a page in either key, it is a page whose
 * signature is not being read, and the honest answer to that is null for the
 * same reason readKeySignature refuses a bad order.
 *
 * AND MORE THAN ONE WITNESS, WHICH THE MAJORITY TEST DOES NOT GIVE YOU. With
 * one system reading anything, `best * 2 <= read.length` is `2 <= 1` — false —
 * so a single system carried the whole page unanimously, and "unanimous" was
 * reported for it. That is how a phantom key gets out: a bare stave with a
 * down-stemmed crotchet at the head of it reads ONE SHARP at confidence up to
 * 0.99 (see classifyKeyGlyph), one such system on a page is enough, and the
 * page then puts a semitone on every F in it.
 *
 * A key signature is printed on EVERY system, so a second witness costs nothing
 * on a page that has one: the three marked pages read 4 of 4, 7 of 7 and 10 of
 * 10 systems in agreement. A page where exactly one system reads a signature
 * and the other ten do not is not a page in that key — it is one system that
 * has read something the rest of the page does not confirm. Refusing it costs
 * the caller C major, which puts a semitone on nothing.
 *
 * This is the second half of the notehead fix and the half that closes it. The
 * shape test in classifyKeyGlyph removes 11 of the 26 phantoms and nothing
 * measured reaches the other 15 for less than they cost; this makes a single
 * phantom unable to name a page whatever its shape.
 */
const MIN_KEY_WITNESSES = 2;

export function agreeKey(keys) {
  const systems = keys.length;
  const read = keys.filter(Boolean);
  if (read.length < MIN_KEY_WITNESSES) {
    return { key: null, systems, read: read.length, agreed: 0 };
  }
  const tally = new Map();
  for (const k of read) {
    const id = `${k.kind}:${k.sharps + k.flats}`;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  let bestId = null;
  let best = 0;
  let tied = false;
  for (const [id, n] of tally) {
    if (n > best) { best = n; bestId = id; tied = false; } else if (n === best) tied = true;
  }
  if (tied || best * 2 <= read.length) return { key: null, systems, read: read.length, agreed: 0 };
  const winner = read.find((k) => `${k.kind}:${k.sharps + k.flats}` === bestId);
  return {
    key: { sharps: winner.sharps, flats: winner.flats, alter: winner.alter, count: winner.count, kind: winner.kind },
    systems,
    read: read.length,
    agreed: best,
  };
}
