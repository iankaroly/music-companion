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
// What one heard interval is worth when it explains TWO written ones — a note
// left out. A shade under two, so that where both readings fit, the one that
// needs no missing note wins.
const MERGED = 1.7;

/**
 * Place each system of a scan in a take, by shape alone.
 *
 * @param {Array<Array<object>>} systems the heads of each system, in reading order
 * @param {Array<object>} played the take: `{ midi, start }`
 * @returns {Array<object>} one entry a system: `{ system, at, time, score, margin, sure, why }`
 *   where `at` is an index into `played` and `time` its second.
 */
// --- READING THE TAKE IN THE PAGE'S OWN UNITS ---------------------------------
//
// WHY FIVE BUCKETS ARE NOT ENOUGH ON A PAGE THAT REPEATS ITSELF.
//
// `shapeOf` reduces every interval to one of five symbols: up or down, by a
// step or by a leap. That is what makes it survive not knowing the clef, and it
// is deliberately coarse. On the Bach Prélude it is TOO coarse. The figure in
// bar 1 goes G D B A B D B D and the one in bar 2 goes G D C B C D C D — a
// fifth then a third against a fifth then a fourth — and in five buckets those
// are the same seven symbols. A page of forty such bars then matches itself
// everywhere, which is why a go that played systems 2 to 4 could claim to have
// played systems 0 to 1.
//
// The intervals are not the same. They are only the same after the bucketing,
// and the bucketing exists because a written STEP and a played SEMITONE are
// different units — a diatonic third is three semitones or four depending where
// it sits, so no fixed number converts one to the other.
//
// But the take says what scale it is in. Count the pitch classes somebody
// played and one seven-note scale fits far better than the other eleven; with
// that, every played note becomes a DEGREE, and a degree counted through the
// octaves is a staff position — the same kind of number the page reader
// measures. The clef is still not needed, because a clef shifts every position
// by the same amount and the comparison is of differences.
//
// So where the scale is clear the intervals are compared as integers — a fifth
// is 4 and a fourth is 3 and they are not each other — and where it is not, the
// five buckets are what is left and are used exactly as before.

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * The scale this take is in, as a tonic pitch class — or null if none fits.
 *
 * Fitted rather than assumed: a cello part wanders into accidentals and a
 * practice take is half scales, so what is wanted is the seven notes that hold
 * most of the playing, not a key signature. A take that is spread evenly over
 * all twelve has no scale to find and says so, and the caller falls back to the
 * coarse comparison rather than being handed a guess.
 */
export function scaleOf(played) {
  const weight = new Float64Array(12);
  let total = 0;
  for (const note of played ?? []) {
    if (!Number.isFinite(note?.midi)) continue;
    weight[((note.midi % 12) + 12) % 12] += 1;
    total += 1;
  }
  if (total < 12) return null;
  let best = { tonic: 0, share: 0 };
  let second = 0;
  for (let tonic = 0; tonic < 12; tonic += 1) {
    let inside = 0;
    for (const step of MAJOR) inside += weight[(tonic + step) % 12];
    const share = inside / total;
    if (share > best.share) { second = best.share; best = { tonic, share }; }
    else if (share > second) second = share;
  }
  // Most of the playing has to be in it, and it has to beat the next scale by
  // enough that the answer is not a coin toss between two neighbouring keys.
  if (best.share < 0.8 || best.share - second < 0.03) return null;
  return best.tonic;
}

/** Where a played note sits on a stave, in the page reader's own units. */
export function diatonicOf(midi, tonic) {
  const from = midi - tonic;
  const octave = Math.floor(from / 12);
  const pc = ((from % 12) + 12) % 12;
  let degree = 0;
  let nearest = 99;
  let over = 0;
  MAJOR.forEach((at, i) => {
    const straight = Math.abs(pc - at);
    if (straight < nearest) { nearest = straight; degree = i; over = 0; }
  });
  // …and the wrap: a note a semitone under the tonic is the seventh degree of
  // the octave below by distance, and the tonic of the one above by ear. The
  // shorter way round wins, which is what a reader would write.
  if (12 - pc < nearest) { degree = 0; over = 1; nearest = 12 - pc; }
  return (octave + over) * 7 + degree;
}

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

export function placeSystems(systems, played, { ends = true } = {}) {
  const notes = (played ?? []).map((n) => n?.midi);
  // The take in the page's own units where its scale is clear, and in five
  // buckets where it is not: see scaleOf. `exact` says which, because it
  // decides how two intervals are compared and how much they have to agree.
  const tonic = scaleOf(played);
  const exact = tonic !== null;
  const coarse = shapeOf(notes, PLAYED_WIDE);
  const heard = exact
    ? steps(notes.map((midi) => (Number.isFinite(midi) ? diatonicOf(midi, tonic) : null)))
    : coarse;
  const out = [];
  (systems ?? []).forEach((heads, system) => {
    const none = (why) => out.push({ system, at: -1, time: null, score: 0, margin: 0, sure: false, why });
    const rows = (heads ?? []).map((h) => h?.step).filter((one) => Number.isFinite(one));
    if (rows.length < SYSTEM_ENOUGH) { none('too few noteheads read on this system'); return; }
    if (notes.length < ENOUGH) { none('too few notes played'); return; }
    // The system is the needle and the take is the haystack — the other way
    // round from findStart, which slides the take's opening along the page.
    const written = exact ? steps(rows) : shapeOf(rows, WRITTEN_WIDE);
    if (written.length < 2 || heard.length < 4) { none('too little shape to compare'); return; }
    // THE SHARP TEST FIRST, THE COARSE ONE ONLY WHERE IT CANNOT DECIDE.
    //
    // Counting intervals as degrees is precise and unforgiving; counting them
    // in five buckets is tolerant and, on a page that repeats a figure, unable
    // to tell one copy from another. They fail on different systems, so each is
    // asked in turn: the exact comparison decides where it can, and where it
    // refuses — a system too spoiled for integers to agree — the buckets get
    // their say, with every guard downstream applying either way.
    // MEASURED: exact alone puts the Bach at 5 systems placed with 9 covered
    // and the Mozart at 5 with 6; buckets alone the Bach at 4 with 5 and the
    // Mozart at 7 with 8.
    const tries = exact ? [true, false] : [false];
    let found = null;
    for (const sharp of tries) {
      const line = sharp ? written : shapeOf(rows, WRITTEN_WIDE);
      const against = sharp ? heard : coarse;
      const span = Math.min(SYSTEM_SPAN, line.length);
      const want = line.slice(0, span);
      const scores = [];
      for (let at = 0; at + span <= against.length; at += 1) {
        scores.push(inOrderShare(want, against, at, span + SYSTEM_SLACK, sharp));
      }
      if (!scores.length) continue;
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
      found = { best, margin, sure };
      if (sure) break;
    }
    if (!found) { none('nothing to compare against'); return; }
    const { best, margin, sure } = found;
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
  const settled = keepInOrder(atAConsistentPlace(out, systems));
  // Reaching the ends is a claim about a take that runs from the top of the
  // page to the bottom, and one GO of a practice session is explicitly not
  // that — a go at the fourth system says nothing about where the page ends.
  // MEASURED, with it on for goes: two goes of the Bach session stretched to
  // the page's last system and were grouped as a passage that was never played.
  return ends ? reachTheEnds(settled, systems, played) : settled;
}

/**
 * THE ENDS OF THE PAGE, where there is nothing to interpolate between.
 *
 * Past the outermost anchor the map extrapolates — it carries the pace of the
 * end pair on into music nothing has been said about — and that is where all
 * its worst answers are. MEASURED, `npm run scan:guess` on the Mozart: between
 * the anchors the error is 0.42s, and on the two systems past the last one it
 * is 9.25s. The systems in the middle are fine and the ones at the edges are
 * guesses dressed as answers.
 *
 * There are two facts nothing else uses: the take STARTS somewhere and it STOPS
 * somewhere. If the line through the placed systems says that the first system
 * of the page sits at the take's first note — which is what playing a page from
 * the top means — then the take's first note IS that system, and the same at
 * the other end. That is not a guess about the music; it is reading off the
 * line the placements already agreed on, and it is only taken where the line
 * lands close enough to the edge to mean it.
 */
const ENDS_OUT = 0.35;      // of a system's noteheads, before the edge is not the edge

function reachTheEnds(placements, systems, played) {
  const sure = placements.filter((one) => one.sure && one.at >= 0);
  if (sure.length < 2 || !played?.length) return placements;
  const before = [];
  let running = 0;
  (systems ?? []).forEach((heads, i) => { before[i] = running; running += heads.length; });
  const points = sure.map((one) => ({ x: before[one.system] ?? 0, y: one.at }));
  const middle = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const slopes = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const run = points[j].x - points[i].x;
      if (run > 0) slopes.push((points[j].y - points[i].y) / run);
    }
  }
  if (!slopes.length) return placements;
  const slope = middle(slopes);
  const intercept = middle(points.map((one) => one.y - slope * one.x));
  const typical = middle((systems ?? []).map((heads) => heads.length)) || 20;
  const room = Math.max(6, typical * ENDS_OUT);

  const out = [...placements];
  const first = sure[0].system;
  const last = sure.at(-1).system;
  // The top of the page: does the line say system 0 begins at the first note?
  if (first > 0 && Math.abs(intercept) <= room) {
    for (let s = 0; s < first; s += 1) {
      if (before[s] !== 0) continue;              // only a system with nothing before it
      out[s] = {
        ...out[s], at: 0, time: played[0].start, sure: true, why: '', fromEnd: true,
      };
    }
  }
  // …and the bottom, asked of the END of the page rather than of the last
  // system's start: if the line says the whole page's music runs out just as
  // the take does, then the take's last note is the end of the page, and that
  // one fact bounds every system after the final anchor. It is a position one
  // PAST the last system — the page's own end — so it anchors the map without
  // claiming to have found any particular system.
  const lastSystem = (systems?.length ?? 0) - 1;
  if (last < lastSystem && lastSystem >= 0) {
    const predicted = intercept + slope * running;          // running = every notehead
    if (Math.abs(predicted - played.length) <= room) {
      out.push({
        system: lastSystem + 1,
        at: played.length - 1,
        time: played.at(-1).start,
        score: 1,
        margin: 1,
        sure: true,
        why: '',
        fromEnd: true,
      });
    }
  }
  return out;
}

/**
 * How many of `want` appear, in order, in the take from `at` — as a fraction.
 *
 * A longest common subsequence over a bounded window: either side may skip, so
 * a note the player left out or one the reader never found costs that one move
 * and nothing after it. The window is what stops the skipping from making
 * everything match everything.
 */
// The differences between one position and the next — the same thing `shapeOf`
// makes, without throwing away how big each move was.
function steps(values) {
  const out = [];
  for (let i = 1; i < values.length; i += 1) {
    const a = values[i - 1];
    const b = values[i];
    out.push(Number.isFinite(a) && Number.isFinite(b) ? b - a : null);
  }
  return out;
}

function inOrderShare(want, heard, at, window, exact = false) {
  const across = Math.min(window, heard.length - at);
  if (across < want.length) return -1;
  const n = want.length;

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
  // What the take does AFTER the moves being matched is none of this
  // comparison's business, so the best END is taken and nothing beyond it
  // counts either way.
  const table = [];
  for (let i = 0; i <= n; i += 1) table.push(new Float64Array(across + 1));
  for (let j = 1; j <= across; j += 1) table[0][j] = j * SKIP;
  for (let i = 1; i <= n; i += 1) table[i][0] = table[i - 1][0] + SKIP;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= across; j += 1) {
      // Exactly the same interval, or — where the scale was not clear enough
      // to count in degrees — the same one of five buckets.
      //
      // A GRADED VERSION OF THIS WAS TRIED AND IS WORSE, which is worth writing
      // down because it is the obvious next idea: give partial credit where two
      // intervals agree in direction and are within one degree of each other,
      // so a wrong note does not throw the whole interval away. MEASURED, it
      // took the Bach from 5 systems placed and 9 covered back to 4 and 5, and
      // left the Mozart where it was — the worst of both. Partial credit is
      // exactly what lets a repeat of the same figure at a different interval
      // score nearly as well as the real one.
      const a = want[i - 1];
      const b = heard[at + j - 1];
      const same = a !== null && b !== null && a === b;
      let best = table[i - 1][j - 1] + (same ? 1 : MISMATCH);

      // A NOTE LEFT OUT DOES NOT REMOVE AN INTERVAL, IT MERGES TWO INTO ONE.
      //
      // This is the difference between forgiving a dropped note and explaining
      // it. If the page goes a to b to c and the player skips b, what was
      // played is a to c — which is not "the interval a-b, damaged", it is
      // exactly the sum of the two. Charged as a skip, a fifth of the notes
      // gone left the match scoring like noise; recognised as a sum, the same
      // take reads straight through.
      //
      // Only where the scale was clear enough to count in degrees, because it
      // is arithmetic: five buckets do not add up to anything.
      if (exact && i >= 2 && a !== null && b !== null && want[i - 2] !== null
        && want[i - 2] + a === b) {
        best = Math.max(best, table[i - 2][j - 1] + MERGED);
      }
      // AND NOT THE SAME THE OTHER WAY, which was tried and is worse. Two
      // PLAYED moves explained by one written one is the mirror case — a note
      // the player added, or one the reader never found — and it is just as
      // real. It is also what lets a match swallow the notes before a system
      // and start early: absorbing two heard moves is worth 1.7 where skipping
      // them costs 1.2, so the alignment would rather explain the tail of the
      // previous system than leave it alone. MEASURED, with it in: the Mozart
      // at a fifth of its notes dropped placed 5 systems with a median error of
      // 2.60s and one anchor 3.07s out; with it gone, 4 systems at 1.01s and
      // the worst anchor 2.84s — and at a tenth dropped it went from 7 systems
      // placed to 8, with the worst error between anchors falling from 3.25s to
      // 0.84s. A note the reader missed is already handled: it is a note the
      // page does not have, which is a SKIP on the written side, and skips are
      // what the window's slack is for.

      best = Math.max(best, table[i - 1][j] + SKIP, table[i][j - 1] + SKIP);
      table[i][j] = best;
    }
  }
  let out = -Infinity;
  for (let j = n; j <= across; j += 1) out = Math.max(out, table[n][j]);
  return out / n;
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
