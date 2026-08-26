// Bars on a photograph, and the moment in a recording each one was played.
//
// WHAT THIS IS FOR, AND WHY IT DOES NOT READ A NOTE.
//
// The other route from a scan to a recording goes through the notes: read the
// clef, read the key, name every notehead, match those names against the pitches
// the microphone heard. Every step of that can be wrong, and when the clef is
// wrong every step after it is wrong together — a page of BWV 1007 came back
// with its first system a thirteenth out because one symbol at the start of it
// was read as a treble clef.
//
// None of that is needed to answer "play me from here". A bar is a rectangle on
// a page and a moment in a recording, and neither of those is a pitch. The
// reader finds barlines better than it finds anything else it looks for —
// `npm run scan:bars` is at 100% mean recall with 63 of 72 systems exactly
// right, against 72-81% for noteheads and worse for what those noteheads are
// called — so a feature built on bars is built on the strongest thing the page
// reader knows.
//
// WHAT IT REFUSES TO DO. It does not align. It is handed anchors — a bar
// somebody said was sounding at a moment they heard — and it interpolates
// between them. Guessing the anchors from the audio is a real piece of work and
// a different one (see the handover); putting a guess in here would hide the
// one thing a caller has to be able to see, which is how much of this is known
// and how much is inferred. With fewer than two anchors it returns null rather
// than inventing a tempo, because rule 5 of CLAUDE.md is that null propagates
// and is never defaulted, and a playhead that lands in the wrong bar with
// confidence is worse than one that says it does not know.

// WHY THE MAP RUNS ON POSITION AND NOT ON BAR NUMBER, which is the thing
// looking at the page changed.
//
// `npm run scan:barmap` draws these boxes on the photograph they came off. On
// the Bärenreiter page of BWV 1007 — ten systems, two printed bars in each —
// five systems come back cut exactly right and four come back with extra
// dividers in them: a stem read as a barline leaves bars 10, 11 and 12 as three
// slivers inside one printed bar. 31 boxes for 20 bars.
//
// Numbering those boxes and interpolating between the numbers assumes every box
// is the same amount of music, and a sliver is not. A system with six boxes in
// it would then take three times as long to play as the identical system beside
// it with two.
//
// So the coordinate is WHERE ON THE PAGE the bar sits, counted in systems: the
// third system is 2.0 to 3.0 whatever it was cut into, and a box half way along
// it is at 2.5. Engraved music is spaced across a system roughly in proportion
// to how long it lasts — that is what proportional spacing means — so position
// across a system is a better proxy for elapsed time than a count of boxes, and
// it does not care how many boxes there are. A false divider stops being an
// error and becomes somewhere else to tap.

// How much of a staff space to leave round the outside of a system's first and
// last bar. The reader gives the barlines it found; the two OUTER edges of a
// system are not barlines at all — they are where the music starts and stops —
// so they are taken from the notes and let out a little, or a bar's worth of
// its own music sits outside the box that is supposed to hold it.
const EDGE_PAD = 2.5;      // in staff spaces

/**
 * Every bar on a scan, in the order they are played, as rectangles on the page.
 *
 * Each bar carries the page it is on and its box in that page's own 0–1 terms,
 * so a caller can draw it, hit-test a tap against it, or put a light in it
 * without knowing anything about how the page was read.
 *
 * @param {Array<object|null>} layout what `readPages` measured, one entry a page
 * @returns {Array<object>} `{ page, stave, inSystem, index, left, right, top, bottom }`
 */
export function barsInReadingOrder(layout) {
  const out = [];
  // Systems counted straight through the whole scan, so page 2's first system
  // follows page 1's last rather than starting again.
  let system = 0;
  (layout ?? []).forEach((page, pageIndex) => {
    if (!page?.staves?.length) return;
    page.staves.forEach((stave, staveIndex) => {
      const heads = stave.heads ?? [];
      const bars = [...(stave.bars ?? [])].sort((a, b) => a - b);
      // A system with nothing on it is not a system anybody can play from.
      if (!heads.length && bars.length < 2) return;
      const pad = (stave.space ?? 0.01) * EDGE_PAD;
      const xs = heads.map((head) => head.x).filter((x) => Number.isFinite(x));
      const from = Math.max(0, Math.min(...(xs.length ? xs : bars)) - pad);
      const to = Math.min(1, Math.max(...(xs.length ? xs : bars)) + pad);
      // A barline sitting on the edge of the music is the edge, not a divider:
      // counting it as one leaves a sliver of a bar with nothing in it, which a
      // tap can land in and which then plays the wrong moment.
      const inner = bars.filter((x) => x > from + pad && x < to - pad);
      const edges = [from, ...inner, to];
      const across = to - from || 1;
      for (let i = 0; i < edges.length - 1; i += 1) {
        const left = edges[i];
        const right = edges[i + 1];
        out.push({
          page: pageIndex,
          stave: staveIndex,
          inSystem: i,
          index: out.length,
          left,
          right,
          top: stave.top ?? 0,
          bottom: stave.bottom ?? 1,
          // Where this box sits in the piece, counted in systems: see above.
          // The START of the box, because "play me from here" means from where
          // the bar begins and not from the middle of it.
          at: system + (left - from) / across,
          // …and where it ends, so a caller can play one bar and stop.
          to: system + (right - from) / across,
        });
      }
      system += 1;
    });
  });
  return out;
}

/**
 * The noteheads of each system, in reading order — the shape a take is placed
 * against. One entry a system, in the same order `barsInReadingOrder` counts
 * them, so a placement's system number is a position in the map.
 */
export function systemsOf(layout) {
  const out = [];
  for (const page of layout ?? []) {
    for (const stave of page?.staves ?? []) {
      const heads = stave?.heads ?? [];
      const bars = stave?.bars ?? [];
      if (!heads.length && bars.length < 2) continue;    // the same skip as above
      out.push([...heads].sort((a, b) => (a.x ?? 0) - (b.x ?? 0)));
    }
  }
  return out;
}

/**
 * Anchors the app worked out for itself, from what was played.
 *
 * A system placed in the take says "this system began at that second", which is
 * exactly one anchor at the system's own position. A system that could not be
 * placed contributes nothing and the map runs straight across it — which is
 * what it did before any of this existed, so a refusal costs nothing that was
 * ever there.
 *
 * They are marked `guessed` so a caller can draw them differently and so a tap
 * can overrule one: a place somebody says they heard is worth more than a place
 * a shape-match believes, and it must never be the other way round.
 */
export function guessedAnchors(placements) {
  return (placements ?? [])
    .filter((one) => one?.sure && Number.isFinite(one.time))
    .map((one) => ({ at: one.system, time: one.time, guessed: true, score: one.score }));
}

/**
 * THE WHOLE TAKE, SPREAD EVENLY ACROSS THE PAGE — the map that needs no taps
 * and no reading, and the one a player asked for in so many words:
 *
 *   "since, in music, the notes in each bar equal the same amount of time, what
 *   I want to do is figure out a way. As soon as you hear the first note to the
 *   last note that you hear, you divide that amount of time by how many bars
 *   there are."
 *
 * IT IS TWO ANCHORS, NOT A DIVISION BY THE BAR COUNT, and the difference is the
 * whole reason it is safe. The number of BOXES on a page is not the number of
 * printed bars: `npm run scan:barmap` draws 31 of them over 20 printed bars,
 * because a stem read as a barline cuts one bar into three. Dividing the take
 * by 31 would put every seek in the wrong place on precisely the pages that
 * produce spurious barlines — and it would need a bar COUNT, which the page
 * does not reliably know.
 *
 * What the page does know is WHERE each box sits, measured in systems and
 * fractions of a system. Pinning the first box to the first note and the last
 * box's end to the last note, and letting `timeOfBar` run its straight line
 * between them, is the same arithmetic he described — every bar gets its share
 * of the time in proportion to how much of the page it takes up — without ever
 * counting anything that might be miscounted. On a page of even note values
 * those are the same answer; where they differ, this one is right.
 *
 * IT IS A FLOOR AND NOT A VERDICT. It assumes one pass down the page at a
 * steady tempo, which is what a performance is and what a practice session is
 * not, so `bar-sync.js` only reaches for it where nothing better placed the
 * page — see the gate there. A tap overrules it anywhere.
 *
 * SPREAD ACROSS THE MUSIC THAT WAS PLAYED, NOT ACROSS THE WHOLE PAGE.
 *
 * It used to pin `bars[0]` — the first bar of the first page — to the first
 * note heard, always, and that is only true of somebody who started at the top.
 * Start half way down and every bar above where you began is claimed to have
 * been played in the seconds before you played anything, so the line from there
 * to the first place the app DID recognise is compressed into almost no time
 * and the light runs ahead of the music for the rest of the page. It is the
 * mirror of the bug the comment in bar-sync.js already describes: that one had
 * no anchor before the first sure system, this one had a wrong one.
 *
 * So where the take begins is an argument. `from` is a position in the piece,
 * in systems, and its sources are ranked by how much they are worth: a bar
 * somebody TAPPED to say "I started here" first, then the earliest system the
 * shape-matcher placed, and only failing both the top of the page — which is
 * the old behaviour, kept as the floor, because a page that opens inert is the
 * thing this function exists to prevent.
 *
 * @param {Array<object>} bars from `barsInReadingOrder`
 * @param {Array<object>} notes what was heard, each with `start` and `end`
 * @param {object} [span] `{ from, to }` in systems — where the take begins and
 *   ends on these pages. Either may be null for "as far as the page goes".
 * @returns {Array<object>} two anchors, or none when there is nothing to spread
 */
export function evenAnchors(bars, notes, { from = null, to = null } = {}) {
  const sounded = (notes ?? []).filter((one) => Number.isFinite(one?.start));
  if (!bars?.length || sounded.length < 2) return [];
  const first = Math.min(...sounded.map((one) => one.start));
  const last = Math.max(...sounded.map((one) => (Number.isFinite(one.end) ? one.end : one.start)));
  // A take shorter than this is not a page of music; spreading it would put
  // every bar within a few tenths of every other and every seek in the wrong
  // place with an air of confidence.
  if (!(last - first > 1.5)) return [];
  const begins = Number.isFinite(from) ? from : bars[0].at;
  const ends = Number.isFinite(to) ? to : bars[bars.length - 1].to;
  // A span that does not run forwards is not a span. This catches a start mark
  // put on the last bar of the part as well as the arithmetic.
  if (!(ends > begins)) return [];
  return [{ at: begins, time: first, even: true }, { at: ends, time: last, even: true }];
}

/**
 * Hand-made marks, and the guesses under them.
 *
 * A tap wins outright — over a guess at the same place, and over any guess
 * BETWEEN two taps, because two taps say the tempo across that stretch and a
 * guess inside it that disagrees would bend the line away from what somebody
 * heard with their own ears.
 */
export function mergeAnchors(hand, guessed) {
  const mine = tidyAnchors(hand);
  if (!mine.length) return tidyAnchors(guessed);
  const first = mine[0].at;
  const last = mine.at(-1).at;
  const outside = (guessed ?? []).filter((one) => one.at < first || one.at > last);
  return tidyAnchors([...outside, ...mine]);
}

/** Which bar a point on a page is in, or -1. Page and point in 0–1 terms. */
export function barAtPoint(bars, page, x, y) {
  // The one whose box holds the point; and when a tap lands between two
  // systems, the nearest one on the same page rather than nothing, because a
  // finger is eight millimetres wide and the gap between systems is smaller.
  let nearest = -1;
  let best = Infinity;
  for (const bar of bars) {
    if (bar.page !== page) continue;
    if (x >= bar.left && x <= bar.right && y >= bar.top && y <= bar.bottom) return bar.index;
    const dx = Math.max(bar.left - x, 0, x - bar.right);
    const dy = Math.max(bar.top - y, 0, y - bar.bottom);
    const away = Math.hypot(dx, dy);
    if (away < best) { best = away; nearest = bar.index; }
  }
  return best <= 0.06 ? nearest : -1;
}

/**
 * Anchors, tidied: one to a place, the later one winning, in order.
 *
 * An anchor is `{ at, time }` — a position in the piece, in systems, and the
 * second of the recording it was heard at. It is a POSITION and not a bar
 * number for the reason at the top of this file: the boxes are not all one bar.
 */
export function tidyAnchors(anchors) {
  const byPlace = new Map();
  for (const one of anchors ?? []) {
    if (!Number.isFinite(one?.at) || !Number.isFinite(one?.time)) continue;
    byPlace.set(Number(one.at.toFixed(4)), { at: one.at, time: Math.max(0, one.time) });
  }
  return [...byPlace.values()].sort((a, b) => a.at - b.at);
}

/** Straight lines between the marks, and the end pair's slope carried past the ends. */
function through(marks, x, key, other) {
  for (let i = 0; i < marks.length - 1; i += 1) {
    const a = marks[i];
    const b = marks[i + 1];
    if (x >= a[key] && x <= b[key]) {
      const across = b[key] - a[key];
      if (across <= 0) return a[other];
      return a[other] + ((x - a[key]) / across) * (b[other] - a[other]);
    }
  }
  const low = x < marks[0][key];
  const [first, second] = low ? [marks[0], marks[1]] : [marks.at(-2), marks.at(-1)];
  const across = second[key] - first[key];
  const rate = across > 0 ? (second[other] - first[other]) / across : 0;
  const from = low ? marks[0] : marks.at(-1);
  return from[other] + (x - from[key]) * rate;
}

/**
 * WHEN a place in the piece was played, in seconds into the recording.
 *
 * Straight lines between the anchors, and the slope of the nearest pair carried
 * on past the ends. A player's tempo is not constant — that is most of what
 * practice is — so the line between two anchors is a guess about everything
 * between them, and the answer is only as good as how many anchors there are.
 * It is exactly right AT an anchor, which is why marking one more is always the
 * fix for a passage that lands early.
 *
 * @param {Array<object>} anchors `{ at, time }`
 * @param {object|number} where a bar from `barsInReadingOrder`, or a position
 * @returns {number|null} null when there is nothing to interpolate between
 */
export function timeOfBar(anchors, where) {
  const marks = tidyAnchors(anchors);
  const at = typeof where === 'object' && where !== null ? where.at : where;
  if (marks.length < 2 || !Number.isFinite(at)) return null;
  return Math.max(0, through(marks, at, 'at', 'time'));
}

/** …and the other way: the place in the piece a moment of the recording is at. */
export function placeAtTime(anchors, time) {
  const marks = tidyAnchors(anchors);
  if (marks.length < 2 || !Number.isFinite(time)) return null;
  return through(marks, time, 'time', 'at');
}

/** Which BOX a moment of the recording falls in, for a light that follows. */
export function barAtTime(bars, anchors, time) {
  const at = placeAtTime(anchors, time);
  if (at === null) return -1;
  let best = -1;
  for (const bar of bars ?? []) {
    if (at >= bar.at && at < bar.to) return bar.index;
    if (at >= bar.at) best = bar.index;
  }
  return best;
}

/**
 * How much of this is known and how much is inferred, in a sentence.
 *
 * The map is exactly right at an anchor and a guess everywhere else, and the
 * player is the only one who can improve it — so the gap between anchors is
 * worth saying out loud rather than leaving somebody to discover that the
 * middle of a long stretch lands in the wrong place.
 */
export function sayMap(anchors, bars) {
  const marks = tidyAnchors(anchors);
  // Both of these were instructions — "play the take and tap the bar you are
  // hearing", "mark a second further on and the rest follow". They are counts
  // now, for the same reason the rest of this sentence is a count: the strip
  // beside it already has a button that says what marking is.
  if (marks.length === 0) return 'nothing marked yet';
  if (marks.length === 1) return 'one place marked';
  const widest = marks.slice(1).reduce((most, one, i) => Math.max(most, one.at - marks[i].at), 0);
  const systems = new Set((bars ?? []).map((b) => Math.floor(b.at))).size;
  const covered = marks.at(-1).at - marks[0].at;
  return `${marks.length} places marked, ${covered.toFixed(1)} of ${systems} systems between them`
    + (widest > 3 ? ` — the longest gap is ${widest.toFixed(1)} systems, so its middle is a guess` : '');
}
