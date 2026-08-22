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
export function shapeOf(values, wide) {
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
export const WRITTEN_WIDE = 2;
// The same boundary in semitones: a third is four, a fourth is five.
export const PLAYED_WIDE = 4;

// How much of a run agrees, at one offset.
export function agreement(written, played, at) {
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
export const ENOUGH = 8;

// How much better the best place has to be than the next candidate that is not
// beside it. Two neighbouring offsets scoring alike is one answer measured
// twice; two DISTANT offsets scoring alike is a line that repeats, and a
// repeat is exactly when a confident wrong answer would be worst.
export const MARGIN = 0.12;

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

// --- WHERE EACH SYSTEM OF THE PAGE FALLS IN THE TAKE ---------------------------
//
// `findStart` answers one question about the whole take: where does it begin.
// This asks the same question of every system separately, and the answers are
// what turn "tap two bars and the rest follow" into "the app already knows".
//
// WHY IT IS THE SAME MACHINERY AND NOT THE SAME MISTAKE. This repo has measured
// the contour route going badly wrong once: `pairByShape`, which assigns EVERY
// played note to a notehead, put 8 wrong heads up to 102 on flipped takes of a
// photographed page. That is not this. Assigning a note needs the shape to be
// right at one place; locating a system needs it to be right ON AVERAGE over
// twenty or thirty notes, and the two fail in opposite directions — a page read
// at 92% steps with a fifth of its noteheads missed is hopeless at the first
// and comfortable at the second. The thresholds below are `findStart`'s own,
// unchanged, because they were set for exactly this question.
//
// AND IT REFUSES, SYSTEM BY SYSTEM. A system whose shape agrees in two places,
// or agrees nowhere well, produces no anchor at all — the map is then a
// straight line across it, which is what the map did before any of this
// existed. Nothing here is allowed to move a bar somebody marked by hand.

// A system has to carry this many noteheads before its shape says anything.
// Below it the same run of directions turns up all over a page.
const SYSTEM_ENOUGH = 10;

// How much of a system is compared, and how much slack the take is given.
//
// A RIGID COMPARISON CANNOT SURVIVE A NOTE LEFT OUT, and that is what the first
// measurement of this said. `agreement` walks two sequences in lockstep, so one
// missing note shifts everything after it and the rest of the system scores
// like noise: MEASURED, `npm run scan:guess` on the Bach page with a tenth of
// the notes dropped, 3 systems of 10 placed, four of them refused with "what
// was played does not follow the shape of this system".
//
// Neither sequence is trustworthy enough for lockstep. The reader misses about
// a fifth of the noteheads on a photograph and reads 92% of the steps right;
// the player leaves notes out, adds them, and plays some of them wrong. So the
// comparison counts how many of the system's own moves appear IN ORDER in what
// was played, allowing either side to skip — a longest common subsequence,
// which is the standard answer to "the same thing with things missing".
//
// AND SKIPPING HAS TO COST SOMETHING, which the first attempt at this did not
// charge for. A subsequence that may skip freely finds a sixteen-move shape
// almost anywhere in a repetitive piece — MEASURED, the same page and take with
// free skipping: every system scored well enough and NONE had a margin over its
// runner-up, so all ten were refused as "looks the same somewhere else". Free
// skipping does not make the comparison tolerant, it makes it meaningless.
//
// So a match is worth one, a disagreement costs a little, and a skip on either
// side costs more than a disagreement — because a note left out is rarer than a
// note played differently, and the alignment should prefer to believe a wrong
// note over an absent one. The vocabulary is five symbols wide, so a shape that
// agrees by chance scores near nothing once the skips are charged for.
const SYSTEM_SPAN = 16;     // moves of the system compared, from its start
const SYSTEM_SLACK = 6;     // extra notes of the take they may be found across
const MISMATCH = -0.35;     // the two moved differently
const SKIP = -0.6;          // one of them has a move the other has not

/**
 * Place each system of a scan in a take, by shape alone.
 *
 * @param {Array<Array<object>>} systems the heads of each system, in reading order
 * @param {Array<object>} played the take: `{ midi, start }`
 * @returns {Array<object>} one entry a system: `{ system, at, time, score, margin, sure, why }`
 *   where `at` is an index into `played` and `time` its second.
 */
/**
 * AND HOW MUCH MUSIC CAME BEFORE IT — a second witness, independent of shape.
 *
 * The shape says a system looks like a stretch of the take. It cannot say that
 * the stretch is in the wrong COPY of a figure the page repeats, and on music
 * that repeats that is the mistake it makes. MEASURED, `npm run scan:guess` on
 * the Bach page: system 1 placed at 5.6s where it truly starts at 12.7s — one
 * system early, matched to the previous copy of the same arpeggio, with a score
 * of 0.96 and a clear margin. Neither going forwards nor a sensible pace can
 * see it: it is in order, and one system's worth of slip barely moves the pace.
 *
 * But the page knows something the shape does not. A system with two hundred
 * noteheads before it cannot begin eight notes into the playing. So the number
 * of noteheads before each system is compared with the number of notes before
 * its anchor, and the placements that do not sit on the same line as the rest
 * are dropped. The line is fitted from the MIDDLE of the pairwise slopes rather
 * than by least squares, because what is being looked for is the outlier, and
 * least squares moves the line towards it.
 *
 * This assumes nothing about where the take starts: the line has an intercept,
 * and a take that begins half way down the page simply fits a line that does.
 */
// Two fifths of a system's own noteheads. A slip of one whole system is the
// mistake this exists to catch, so the bar has to sit well inside that — and
// being out by half a system's worth of music already means the anchor is in
// the wrong half of a system, which is not a placement worth keeping. MEASURED
// on the Bach page, whose one bad anchor sat 16 notes off the line the other
// four agreed on, with a system 32 noteheads long: at 0.6 the bar is 19 notes
// and it survives; at 0.4 it is 13 and it does not, while the four good ones
// are 0, 1, 1 and 4 notes off and are nowhere near either bar.
const PLACE_OUT = 0.4;      // of a system's own noteheads, before it is out of line

function atAConsistentPlace(placements, systems) {
  const before = [];
  let running = 0;
  (systems ?? []).forEach((heads, i) => { before[i] = running; running += heads.length; });
  const sure = placements.filter((one) => one.sure && one.at >= 0);
  if (sure.length < 3) return placements;
  const points = sure.map((one) => ({ system: one.system, x: before[one.system] ?? 0, y: one.at }));
  const slopes = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const run = points[j].x - points[i].x;
      if (run > 0) slopes.push((points[j].y - points[i].y) / run);
    }
  }
  if (!slopes.length) return placements;
  const middle = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const slope = middle(slopes);
  const intercept = middle(points.map((one) => one.y - slope * one.x));
  // The tolerance is a share of a system's own length, so a page of long
  // systems is judged as loosely as it deserves.
  const typical = middle((systems ?? []).map((heads) => heads.length)) || 20;
  const room = Math.max(8, typical * PLACE_OUT);
  const drop = new Set();
  for (const one of points) {
    if (Math.abs(one.y - (intercept + slope * one.x)) > room) drop.add(one.system);
  }
  if (!drop.size || drop.size === points.length) return placements;
  return placements.map((one) => (drop.has(one.system)
    ? {
      ...one,
      at: -1,
      time: null,
      sure: false,
      why: 'it would begin sooner than the music before it could have been played',
    }
    : one));
}

export function placeSystems(systems, played) {
  const notes = (played ?? []).map((n) => n?.midi);
  const heard = shapeOf(notes, PLAYED_WIDE);
  const out = [];
  (systems ?? []).forEach((heads, system) => {
    const none = (why) => out.push({ system, at: -1, time: null, score: 0, margin: 0, sure: false, why });
    const steps = (heads ?? []).map((h) => h?.step).filter((s) => Number.isFinite(s));
    if (steps.length < SYSTEM_ENOUGH) { none('too few noteheads read on this system'); return; }
    if (notes.length < ENOUGH) { none('too few notes played'); return; }
    // The system is the needle and the take is the haystack — the other way
    // round from findStart, which slides the take's opening along the page.
    const written = shapeOf(steps, WRITTEN_WIDE);
    if (written.length < 2 || heard.length < 4) { none('too little shape to compare'); return; }
    const span = Math.min(SYSTEM_SPAN, written.length);
    const want = written.slice(0, span);
    const scores = [];
    for (let at = 0; at + span <= heard.length; at += 1) {
      scores.push(inOrderShare(want, heard, at, span + SYSTEM_SLACK));
    }
    if (!scores.length) { none('nothing to compare against'); return; }
    let best = { at: 0, score: -1 };
    scores.forEach((score, at) => { if (score > best.score) best = { at, score }; });
    const SHOULDER = 3;
    let runnerUp = -1;
    scores.forEach((score, at) => {
      if (Math.abs(at - best.at) <= SHOULDER) return;
      if (score > runnerUp) runnerUp = score;
    });
    const margin = best.score - Math.max(0, runnerUp);
    const sure = best.score >= 0.62 && margin >= MARGIN;
    out.push({
      system,
      at: sure ? best.at : -1,
      time: sure ? (played[best.at]?.start ?? null) : null,
      score: best.score,
      margin,
      sure,
      why: sure ? '' : (best.score < 0.62
        ? 'what was played does not follow the shape of this system'
        : 'this system looks the same as somewhere else in the take'),
    });
  });
  return keepInOrder(atAConsistentPlace(out, systems));
}

/**
 * How many of `want` appear, in order, in the take from `at` — as a fraction.
 *
 * A longest common subsequence over a bounded window: either side may skip, so
 * a note the player left out or one the reader never found costs that one move
 * and nothing after it. The window is what stops the skipping from making
 * everything match everything.
 */
function inOrderShare(want, heard, at, window) {
  const across = Math.min(window, heard.length - at);
  if (across < want.length) return -1;
  // GETTING TO THE START COSTS, and leaving the end does not.
  //
  // The offset IS the answer here — it is where the system begins — so notes of
  // the take skipped BEFORE it have to be paid for, or the score is the same
  // for every offset across the slack window and the best place ties with its
  // neighbours. MEASURED, with those skips free: every system of a page scored
  // 1.00 with a margin of 0.00 and all of them were refused as "the same
  // somewhere else", on a page where the first system placed with a margin of
  // 0.47 the moment they were charged for.
  //
  // What the take does AFTER the sixteen moves being matched is none of this
  // comparison's business, so the best END is taken and nothing beyond it
  // counts either way.
  let prev = new Float64Array(across + 1);
  for (let j = 1; j <= across; j += 1) prev[j] = j * SKIP;
  let row = new Float64Array(across + 1);
  for (let i = 1; i <= want.length; i += 1) {
    row[0] = prev[0] + SKIP;
    for (let j = 1; j <= across; j += 1) {
      const step = prev[j - 1] + (want[i - 1] === heard[at + j - 1] ? 1 : MISMATCH);
      row[j] = Math.max(step, prev[j] + SKIP, row[j - 1] + SKIP);
    }
    const swap = prev; prev = row; row = swap;
    row = swap.fill(0);
  }
  let best = -Infinity;
  for (let j = want.length; j <= across; j += 1) best = Math.max(best, prev[j]);
  return best / want.length;
}

/**
 * MUSIC GOES FORWARDS, so the placements have to as well.
 *
 * A system placed after one that comes later on the page is a wrong answer
 * whatever it scored — and a wrong anchor is worse than no anchor, because the
 * map is built by drawing straight lines through them and one out of order
 * drags the lines either side of it. So the longest run that does move forwards
 * is kept and the rest are refused, best-scoring run winning where two are the
 * same length.
 */
function keepInOrder(placements) {
  const sure = placements.filter((one) => one.sure && one.time !== null);
  if (sure.length < 2) return placements;
  // Longest increasing subsequence by time, O(n^2) over a handful of systems.
  const best = sure.map(() => ({ run: 1, score: 0, from: -1 }));
  sure.forEach((one, i) => {
    best[i].score = one.score;
    for (let j = 0; j < i; j += 1) {
      if (sure[j].time >= one.time) continue;
      const run = best[j].run + 1;
      const score = best[j].score + one.score;
      if (run > best[i].run || (run === best[i].run && score > best[i].score)) {
        best[i] = { run, score, from: j };
      }
    }
  });
  let end = 0;
  best.forEach((one, i) => {
    if (one.run > best[end].run || (one.run === best[end].run && one.score > best[end].score)) end = i;
  });
  const keep = new Set();
  for (let i = end; i >= 0; i = best[i].from) {
    keep.add(sure[i].system);
    if (best[i].from < 0) break;
  }
  return atASensibleRate(placements.map((one) => (one.sure && !keep.has(one.system)
    ? { ...one, at: -1, time: null, sure: false, why: 'placed out of order with the systems around it' }
    : one)));
}

// How far a system's own pace may be from the pace of the page around it before
// it is not a placement but a mistake.
const RATE_OUT = 3;

/**
 * A SYSTEM THAT TOOK TEN TIMES AS LONG AS ITS NEIGHBOURS WAS NOT PLACED, IT WAS
 * GUESSED — and this is the guard the worst case needed.
 *
 * Going forwards is not enough on music that repeats: a system matched to the
 * wrong copy of its own figure can still land in order and still be seconds
 * out, and because the map is straight lines drawn through the anchors, one
 * wrong one drags the two stretches either side of it as well. MEASURED,
 * `npm run scan:guess` on the Bach page, whose whole page is one arpeggio
 * figure: 5 systems placed, median 0.90s against two taps' 1.85s — better — and
 * a worst case of 7.08s against two taps' 3.79s, which is worse. A feature that
 * improves the middle and ruins the ends is not an improvement.
 *
 * Between two anchors there is an implied pace, in seconds a system. Real
 * playing changes pace constantly and a run-through of one page does not change
 * it by a factor of three, so the pace between each pair is compared with the
 * MIDDLE pace of the page and the odd one out is dropped. The median is used
 * rather than the mean because the thing being looked for is exactly the
 * outlier that would drag a mean towards itself.
 */
function atASensibleRate(placements) {
  const sure = placements.filter((one) => one.sure && one.time !== null);
  if (sure.length < 3) return placements;      // two anchors have no pace to disagree with
  const rates = [];
  for (let i = 1; i < sure.length; i += 1) {
    const across = sure[i].system - sure[i - 1].system;
    rates.push(across > 0 ? (sure[i].time - sure[i - 1].time) / across : Infinity);
  }
  const middle = [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)];
  if (!(middle > 0)) return placements;
  // An anchor is dropped when BOTH of its sides are out of step — a single odd
  // pace is shared by the two anchors either end of it, and blaming both would
  // throw away the good one with the bad.
  const wild = (rate) => !(rate > middle / RATE_OUT && rate < middle * RATE_OUT);
  const drop = new Set();
  sure.forEach((one, i) => {
    const before = i > 0 ? rates[i - 1] : null;
    const after = i < rates.length ? rates[i] : null;
    const bad = [before, after].filter((r) => r !== null);
    if (bad.length && bad.every(wild)) drop.add(one.system);
  });
  if (!drop.size) return placements;
  return placements.map((one) => (drop.has(one.system)
    ? { ...one, at: -1, time: null, sure: false, why: 'the pace it implies is nothing like the rest of the page' }
    : one));
}
