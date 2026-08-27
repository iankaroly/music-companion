// THE WHOLE TAKE AGAINST THE WHOLE PAGE, IN ONE PASS.
//
// WHAT THIS IS FOR, and it is one number. `npm run scan:guess` asks the
// question a player asks — press a bar, how many seconds out is the audio — and
// on a photographed page the answer is a median of 0.78s with a worst of about
// three seconds. The median is fine: 0.78s is roughly one note of a forty-note
// system. The worst is not, and it is not bad luck either. It is structural.
//
// The map is built from ANCHORS and a straight line between them, and the
// anchors come from `placeSystems`, which slides each system of the page along
// the take as a whole and keeps the ones it is sure of. That gives at best one
// anchor a system — ten on a page — and between two of them the line assumes
// the tempo did not move. A player's tempo moves; that is most of what practice
// is. So the error at a bar is however far the playing wandered from a straight
// line since the last anchor, and on a page where three systems in a row are
// refused it is however far it wandered across all three.
//
// This is the other way of getting anchors: match the take to the page NOTE BY
// NOTE, in one monotone pass, and take an anchor from every bar the path goes
// through. Between two anchors a bar apart the tempo has almost no room to
// wander, so the straight line stops being an assumption and becomes an
// interpolation over a distance short enough not to matter.
//
// WHAT IT DOES NOT NEED, which is what makes it usable on a photograph:
//
//   * No clef. Only the DIRECTION and SIZE of each interval is compared, and a
//     clef moves every note of a system by the same amount.
//   * No key. Where the take makes a scale clear its intervals are counted in
//     degrees so that a fifth is not a fourth (see scaleOf); where it does not,
//     the five buckets of `shapeOf` are what is left and are used instead.
//   * No pitch on the page at all. `step` is where a notehead sits between the
//     printed lines, which the reader measures better than anything else it
//     reads.
//
// WHY SUBSEQUENCE AND NOT WHOLE-TO-WHOLE. A take is played FROM somewhere; it
// almost never starts at the first notehead of the part and ends at the last.
// So the whole take is consumed and any contiguous stretch of the page may
// carry it, with beginning and ending anywhere in the page costing nothing.
// That is the same thing as "I started half way down", and it needs no mark and
// no assumption about where the music began — which is the fix this replaces.
import { shapeOf, scaleOf, diatonicOf, WRITTEN_WIDE, PLAYED_WIDE } from './scan-align.js';

// HOW A DISAGREEMENT IS PRICED, and the shape of it is taken from
// `inOrderShare` in scan-align.js, which was swept there against real pages: a
// match is worth one, moving differently costs a little, and a note only one
// side has costs more than moving differently — because a note left out is
// rarer than a note played wrong, and where both readings fit the alignment
// should prefer to believe a wrong note over an absent one.
const MATCH = 1;
const MISMATCH = -0.35;
const SKIP = -0.6;

// A path is only believed if this much of the take found something. Below it
// the take is not this music, or the page was read too poorly to say — and a
// dense wrong map is worse than a sparse right one, because every bar of it
// looks equally confident.
const ENOUGH_MATCHED = 0.45;
// …and never on a handful of notes, where anything matches anything.
const ENOUGH_NOTES = 12;

// HOW BIG A TABLE IS WORTH FILLING. The path is found with a dynamic program
// over written intervals by played intervals, and the direction of each cell
// has to be kept to walk the path back — one byte each. A page of music against
// a take of a few hundred notes is a few hundred thousand cells and costs
// nothing; a twenty-page part against a long take is tens of millions, which is
// tens of megabytes on a phone that this app spends most of paper.js trying not
// to allocate. Past this it refuses and says so, and the map falls back to what
// it did before, which is what it has always done on a page nothing could place.
const MAX_CELLS = 4_000_000;

const refused = (why) => ({ placed: false, why, anchors: [], pairs: [], matched: 0 });

/**
 * Line a take up against the noteheads of a scan, note by note.
 *
 * @param {Array<object>} heads from `headsInReadingOrder` — `{ at, step }`
 * @param {Array<object>} played the take: `{ midi, start }`
 * @returns {object} `{ placed, why, pairs, matched }` where `pairs` is one entry
 *   per matched note: `{ head, note, at, time }`, in reading order.
 */
export function alignTake(heads, played) {
  const written = (heads ?? []).filter((one) => Number.isFinite(one?.step) && Number.isFinite(one?.at));
  const notes = (played ?? []).filter((one) => Number.isFinite(one?.midi) && Number.isFinite(one?.start));
  if (written.length < ENOUGH_NOTES) return refused('too few noteheads read on these pages');
  if (notes.length < ENOUGH_NOTES) return refused('too few notes played');

  // The two sequences in one vocabulary — see scaleOf. Where the take makes a
  // scale clear both sides are counted in DEGREES, which tells a fifth from a
  // fourth; where it does not, both sides drop to the five buckets that survive
  // not knowing the key.
  const tonic = scaleOf(notes);
  const exact = tonic !== null;
  const W = exact
    ? diffs(written.map((one) => one.step))
    : shapeOf(written.map((one) => one.step), WRITTEN_WIDE);
  const P = exact
    ? diffs(notes.map((one) => diatonicOf(one.midi, tonic)))
    : shapeOf(notes.map((one) => one.midi), PLAYED_WIDE);
  const m = W.length;
  const n = P.length;
  if (m < 2 || n < 2) return refused('too little shape to compare');
  if (m * n > MAX_CELLS) return refused('these pages are too long to line up note by note');

  // --- the path -------------------------------------------------------------
  //
  // best[i] is the best score of an alignment that has consumed the take up to
  // the column being filled and the page up to written interval i. Starting
  // anywhere on the page is free — that is the whole of "I began half way down"
  // — so the row before the first played interval is zero everywhere.
  const DIAG = 1;
  const UP = 2;      // a written interval nothing was played for
  const LEFT = 3;    // a played interval nothing is written for
  const from = new Uint8Array(m * n);
  let prev = new Float32Array(m).fill(0);
  let now = new Float32Array(m);
  for (let j = 0; j < n; j += 1) {
    const p = P[j];
    for (let i = 0; i < m; i += 1) {
      const agree = same(W[i], p) ? MATCH : MISMATCH;
      // Diagonal: this written interval explains this played one.
      let best = (i > 0 ? prev[i - 1] : 0) + agree;
      let dir = DIAG;
      // Up: the page has an interval the take does not — a note left out, or a
      // notehead the reader found that was never played.
      const up = (i > 0 ? now[i - 1] : -Infinity) + SKIP;
      if (up > best) { best = up; dir = UP; }
      // Left: the take has an interval the page does not — an extra note, a
      // squeak, a note the reader missed.
      const left = prev[i] + SKIP;
      if (left > best) { best = left; dir = LEFT; }
      now[i] = best;
      from[j * m + i] = dir;
    }
    const swap = prev; prev = now; now = swap;
  }

  // Where the take finished on the page: the best cell of the last column.
  let end = 0;
  for (let i = 1; i < m; i += 1) if (prev[i] > prev[end]) end = i;

  // --- walk it back ---------------------------------------------------------
  const pairs = [];
  let i = end;
  let j = n - 1;
  while (j >= 0 && i >= 0) {
    const dir = from[j * m + i];
    if (dir === DIAG) {
      // An interval pairs W[i] with P[j], which pairs the NOTE at i+1 with the
      // note at j+1 — an interval is the move onto a note, not the note.
      if (same(W[i], P[j])) pairs.push({ head: written[i + 1], note: notes[j + 1] });
      i -= 1;
      j -= 1;
    } else if (dir === UP) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  pairs.reverse();

  const matched = pairs.length / notes.length;
  if (pairs.length < ENOUGH_NOTES || matched < ENOUGH_MATCHED) {
    return refused('what was played does not follow the shape of these pages');
  }
  // TIME HAS TO CLIMB. The path is monotone in both sequences by construction,
  // so this cannot fail on its own arithmetic — but `played` is handed in from
  // outside and a take whose notes are not in time order would produce a map
  // that runs backwards, which `placeAtTime` searches as though it were sorted.
  for (let k = 1; k < pairs.length; k += 1) {
    if (pairs[k].note.start < pairs[k - 1].note.start
      || pairs[k].head.at < pairs[k - 1].head.at) {
      return refused('the take does not run forwards against these pages');
    }
  }
  return {
    placed: true,
    why: null,
    matched: pairs.length,
    share: matched,
    pairs: pairs.map((one) => ({ ...one, at: one.head.at, time: one.note.start })),
  };
}

/**
 * The path thinned to one anchor a bar.
 *
 * WHY THINNED AT ALL, when more anchors is a better map. Two reasons and both
 * are measured elsewhere. `timeOfBar` walks its marks linearly and `barAtTime`
 * calls it on every animation frame while a take plays, so a few hundred
 * anchors a page is a per-frame walk for an accuracy nothing can see. And a
 * single mispaired note becomes a single wrong anchor, which bends the line
 * either side of it — taking the MEDIAN pair in each bar throws that away for
 * free, because within one bar the pairs are in order in both sequences and the
 * middle one is a real pair rather than an average of two.
 */
export function anchorsFromPath(pairs, bars, heads = null) {
  if (!pairs?.length || !bars?.length) return [];
  const into = (list, at) => {
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (at < list[mid].at) hi = mid - 1;
      else if (at >= list[mid].to) lo = mid + 1;
      else return mid;
    }
    return -1;
  };
  const inBar = new Map();
  for (const pair of pairs) {
    const b = into(bars, pair.at);
    if (b < 0) continue;
    if (!inBar.has(b)) inBar.set(b, []);
    inBar.get(b).push(pair);
  }
  // HOW MANY NOTEHEADS EACH BAR HAS, so an anchor can be asked to rest on a
  // share of them rather than on however many happened to agree.
  const printed = new Map();
  for (const head of heads ?? []) {
    const b = into(bars, head.at);
    if (b >= 0) printed.set(b, (printed.get(b) ?? 0) + 1);
  }
  const out = [];
  for (const [b, list] of [...inBar.entries()].sort((x, y) => x[0] - y[0])) {
    // ENOUGH OF THE BAR, not merely something in it.
    //
    // A monotone path pays to skip, so where a take jumps over a stretch of the
    // page the cheapest route is to accept a handful of coincidental agreements
    // inside it rather than skip every interval. MEASURED, on a page of six
    // systems whose take plays 0, 1, 4 and 5 and never touches 2 or 3: the
    // played systems matched 23, 23, 14 and 24 of their 24 noteheads, and the
    // two that were never played matched 4 and 6. The path is not wrong to
    // report those — they really do agree — but an anchor resting on two notes
    // of a bar nobody played is the dense wrong map this whole module warns
    // about, and it bends the line either side of it.
    //
    // So a bar earns an anchor by having a share of its own noteheads on the
    // path. Where the head count is not to hand the old rule stands, because a
    // sparse anchor is still better than the straight line it replaces.
    const has = printed.get(b) ?? 0;
    if (has > 0 && (list.length < 2 || list.length / has < PATH_SHARE)) continue;
    const middle = list[Math.floor((list.length - 1) / 2)];
    out.push({ at: middle.at, time: middle.time, guessed: true, fromPath: true, bar: b });
  }
  return out;
}

// A third of a bar's noteheads, which on the fixture above is the gap between
// 17% and 58% and is nowhere near either edge of it.
const PATH_SHARE = 1 / 3;

// The differences between one position and the next, keeping how big each move
// was — `shapeOf` throws that away on purpose and this does not.
function diffs(values) {
  const out = [];
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    out.push(Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  }
  return out;
}

// Two moves agree. A null is a note whose position or pitch could not be read,
// and it agrees with nothing — it is not a wildcard, or a page the reader half
// failed on would match everything.
function same(a, b) {
  return a !== null && b !== null && a === b;
}
