// Where in the part this take actually starts.
//
// Marks on a scanned page were paired positionally: the first note you played
// went on the first notehead of the piece, the second on the second, and so on
// from the very beginning of the part. That is right exactly once — when you
// play a piece from its first note — and wrong every other time. Open a part
// whose first page is a title page, play the music on page two, and every ring
// lands on page one, on noteheads you never touched.
//
// The fix does not need to know what the notes ARE. It needs to know where the
// take begins, which is one number, and that number can be found from shape
// alone.
//
// HOW, WITHOUT READING A SINGLE PITCH
//
// The page reader measures where each notehead sits between the staff lines —
// its step: 0 on the bottom line, 1 in the space above it, 2 on the next line.
// That is the note's position on the stave, and it is available from geometry
// the reader already has. What it is NOT is a pitch: turning a step into a
// note needs the clef, the key signature and any accidental in front of it,
// and none of those are read here.
//
// But a melody's SHAPE survives all of that. If the written line goes up, the
// played line goes up; if it repeats a note, so does the recording. Comparing
// the direction of each step against the direction of each interval played
// needs no clef, because a clef moves every note by the same amount and
// changes no direction at all. The same is true of the key, of transposition,
// and of playing the whole thing an octave down because that is where it sits
// on a cello.
//
// So the take is slid along the part, and the place where the directions agree
// best is where it started. Forty notes of a real line agree in one place and
// nowhere else.

// Up or down, and by a little or a lot. The whole vocabulary.
//
// Direction alone was not quite enough: on a line of fifty notes the right
// place beat the next-best by two agreements out of seventeen, which is not a
// margin, it is a coin landing on its edge. Adding "a step or a leap" roughly
// doubles what each interval says while still needing no key and no clef — a
// third stays a third in any key, and a clef moves both notes of it equally.
//
// The two scales are bucketed to MEET rather than to convert: a written step
// or two is a semitone to four, and anything wider is a leap on both sides.
// Nothing here turns a step into a pitch, which remains the thing that would
// need the clef, the key and the accidentals.
function shapeOf(values, wide) {
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d === 0) { out.push(0); continue; }
    const size = Math.abs(d) > wide ? 2 : 1;
    out.push(d > 0 ? size : -size);
  }
  return out;
}

// A written interval of one or two steps is a step or a third; wider is a leap.
const WRITTEN_WIDE = 2;
// The same boundary in semitones: a third is four, a fourth is five.
const PLAYED_WIDE = 4;

// How much of a run agrees, at one offset.
function agreement(written, played, at) {
  let same = 0;
  let counted = 0;
  for (let i = 0; i < played.length; i++) {
    const w = written[at + i];
    if (w === undefined) break;
    counted += 1;
    if (w === played[i]) same += 1;
  }
  return counted ? { score: same / counted, counted } : { score: 0, counted: 0 };
}

// The least a take can be and still say anything about where it is.
//
// Three notes is two directions, and two directions match in a dozen places on
// any page. This is the point below which the answer would be a guess wearing
// the clothes of a measurement.
const ENOUGH = 8;

// How much better the best place has to be than the next candidate that is not
// beside it. Two neighbouring offsets scoring alike is one answer measured
// twice; two DISTANT offsets scoring alike is a line that repeats, and a
// repeat is exactly when a confident wrong answer would be worst.
const MARGIN = 0.12;

/**
 * Find where a take begins among the noteheads read off a scan.
 *
 * `heads` carry a `step` — the position on the stave the page reader measured.
 * `played` carry a `midi`. Neither is converted to the other; only the
 * direction of movement is compared, which is the part that survives not
 * knowing the clef.
 *
 * Returns { offset, score, margin, sure, why }. `sure` false means the take
 * could not be placed, and the caller must say so rather than fall back to
 * pretending it starts at the beginning — which is the bug this exists for.
 */
export function findStart(heads, played) {
  const steps = (heads ?? []).map((h) => h?.step);
  const notes = (played ?? []).map((n) => n?.midi);
  if (steps.some((s) => !Number.isFinite(s))) {
    return { offset: 0, score: 0, margin: 0, sure: false, why: 'the page reader did not measure where the notes sit' };
  }
  if (notes.length < ENOUGH) {
    return { offset: 0, score: 0, margin: 0, sure: false, why: 'too few notes to place' };
  }
  // Matched on the OPENING of the take, not the whole of it.
  //
  // Where a take starts is decided by how it starts, and a window has two
  // advantages over the whole thing. A take longer than the part still has a
  // place — play a page twice, or carry on past the last page you photographed,
  // and requiring the whole take to fit would refuse it outright. And the
  // further in you go the more a small slip early on has thrown the two
  // sequences out of step with each other, so the tail is the least
  // trustworthy evidence in the take, not the most.
  // Short on purpose. The longer this window, the more of the take has to be
  // note-perfect for the take to be placed at all — and a note left out at the
  // twentieth would refuse a take whose first twenty were exact. Where a take
  // begins is decided by how it BEGINS; everything after that is the aligner's
  // problem, and the aligner is built for exactly the slips that would ruin
  // this comparison.
  const WINDOW = 16;
  const written = shapeOf(steps, WRITTEN_WIDE);
  const heard = shapeOf(notes, PLAYED_WIDE).slice(0, WINDOW);
  if (heard.length < ENOUGH - 1) {
    return { offset: 0, score: 0, margin: 0, sure: false, why: 'too few notes to place' };
  }
  const last = written.length - heard.length;
  if (last < 0) {
    return {
      offset: 0, score: 0, margin: 0, sure: false,
      why: 'there are fewer noteheads on these pages than notes in the take',
    };
  }

  let best = { at: 0, score: -1 };
  let runnerUp = -1;
  const scores = [];
  for (let at = 0; at <= last; at++) {
    const { score, counted } = agreement(written, heard, at);
    // A tail too short to judge is not a candidate.
    scores.push(counted >= heard.length ? score : -1);
  }
  for (const [at, score] of scores.entries()) {
    if (score > best.score) best = { at, score };
  }
  // The runner-up, ignoring the shoulder around the winner: an offset one note
  // either side of the right answer scores nearly as well by construction, and
  // treating that as a rival would refuse every correct match.
  const SHOULDER = 3;
  for (const [at, score] of scores.entries()) {
    if (Math.abs(at - best.at) <= SHOULDER) continue;
    if (score > runnerUp) runnerUp = score;
  }

  const margin = best.score - Math.max(0, runnerUp);
  // Two tests, and both have to pass. A high score with no margin is a phrase
  // that appears twice on the page; a clear margin over a poor score is the
  // best of a bad set.
  const sure = best.score >= 0.62 && margin >= MARGIN;
  return {
    offset: best.at,
    score: best.score,
    margin,
    sure,
    why: sure ? '' : (best.score < 0.62
      ? 'what was played does not follow the shape of the notes on these pages'
      : 'this passage looks the same in more than one place'),
  };
}
