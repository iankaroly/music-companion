// A practice session is not a performance, and this is the difference.
//
// Everything else that joins a page to a recording assumes time moves forward
// through the music once: bar 1 then bar 2, one anchor after another, a map
// that only ever climbs. That is a PERFORMANCE. What a phone on a music stand
// actually records is somebody playing bar 12 six times, stopping, going back
// four bars, starting again from the top, and giving up half way down the page —
// and against that a single climbing map is not slightly wrong, it is wrong in
// the way a straight line through a scatter is wrong. Three minutes on one page
// is a dozen partial passes over it.
//
// So the take is cut into RUNS first, and each run gets placed on its own. A
// run is a stretch of playing with no long silence in it, which is what a go at
// a passage is: you play, you stop, you think, you play it again. Nothing here
// needs to know that the second run is the same music as the first — it places
// each one against the page independently, and two runs landing on the same
// bars IS the app knowing you played it twice.
//
// WHAT THAT CHANGES FOR THE PLAYER. "Play me from this bar" stops having one
// answer. A bar you played six times has six answers, and the useful one is
// almost always the LAST — the go after you fixed whatever was wrong. So the
// last is what plays, the count is said out loud, and pressing again walks
// back through the earlier ones.
//
// WHAT IT REFUSES. A run it cannot place contributes nothing: it is a stretch
// of the recording that is not claimed to be anywhere on the page, which is
// honest about scales, tuning, and the bit where you were talking to someone.

import { placeSystems } from './scan-align.js';
import { guessedAnchors } from './bar-map.js';

// How long a silence has to be before it is a new go rather than a breath.
//
// A rest inside music is short and a stop between attempts is long, and the gap
// between those two is where this number lives. A bar of rest at a slow tempo
// is about two seconds; thinking about what went wrong takes longer than that
// every time. Set low, a phrase with a pause in it becomes two runs, which
// costs nothing much — both land in the right place. Set high, two goes at a
// passage merge into one run that appears to jump backwards in the middle,
// which is the failure that matters, so this errs short.
const NEW_GO = 2.0;          // seconds of silence

// A run has to have this many notes in it to be worth placing. Below it there
// is not enough shape to say anything, and the run is left unplaced rather than
// guessed at.
const RUN_ENOUGH = 10;

/**
 * Cut a take into the goes it is made of, at the silences between them.
 *
 * @param {Array<object>} played notes with `start` and `end` in seconds
 * @param {{gap?:number}} [options]
 * @returns {Array<object>} `{ notes, from, to }`, in the order they were played
 */
export function runsIn(played, { gap = NEW_GO } = {}) {
  const notes = (played ?? [])
    .filter((n) => Number.isFinite(n?.start))
    .sort((a, b) => a.start - b.start);
  if (!notes.length) return [];
  const runs = [];
  let current = [notes[0]];
  for (let i = 1; i < notes.length; i += 1) {
    const since = notes[i].start - (notes[i - 1].end ?? notes[i - 1].start);
    if (since > gap) {
      runs.push(current);
      current = [];
    }
    current.push(notes[i]);
  }
  runs.push(current);
  return runs.map((one) => ({
    notes: one,
    from: one[0].start,
    to: one.at(-1).end ?? one.at(-1).start,
  }));
}

/**
 * Where on the page each go was, and when.
 *
 * Each run is placed against the systems on its own — the same shape match the
 * whole-take route uses, handed a shorter take. A run that places two or more
 * systems knows its own pace; one that places a single system is given the
 * pace of the page around it, which is the only rate anybody has said anything
 * about; one that places none is refused.
 *
 * @returns {Array<object>} `{ from, to, at, until, notes, anchors, sure, why }`
 *   where `from`/`to` are seconds and `at`/`until` are positions, in systems.
 */
export function placeRuns(systems, played, { gap = NEW_GO } = {}) {
  const runs = runsIn(played, { gap });
  if (!systems?.length) return runs.map((one) => ({ ...one, sure: false, why: 'the page was not read' }));
  const lengths = systems.map((heads) => heads.length).filter((n) => n > 0);
  const perSystem = lengths.length
    ? [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)]
    : 20;

  const out = runs.map((run) => {
    if (run.notes.length < RUN_ENOUGH) {
      return { ...run, at: null, until: null, anchors: [], sure: false, why: 'too short to place' };
    }
    const anchors = agreeWithin(
      guessedAnchors(placeSystems(systems, run.notes)), run.notes, perSystem,
    );
    if (!anchors.length) {
      return { ...run, at: null, until: null, anchors: [], sure: false, why: 'not found on these pages' };
    }
    // HOW FAR EITHER SIDE OF ITS ANCHORS A GO REACHES — counted in NOTES, not
    // extrapolated from a pace.
    //
    // A pace is a ratio, and a ratio measured across a short run or from a
    // single anchor can be anything: MEASURED, `npm run scan:practice` on the
    // Bach page, a go that played two systems claimed to cover 0.0 to 10.1 —
    // the whole page — and another claimed 0.0 to 49.7, on a page with ten
    // systems in it. A go that claims music it never played offers itself when
    // a bar it never touched is pressed, which is the one thing this model
    // exists to prevent.
    //
    // The notes themselves cannot lie like that. Whatever was played before the
    // first anchor is at most that many noteheads of music, and a page's
    // systems hold about `perSystem` of them — so the reach is the note COUNT
    // divided by that, and a run of sixty notes cannot cover ten systems
    // however its anchors are spaced.
    const first = anchors[0];
    const last = anchors.at(-1);
    const before = run.notes.filter((n) => n.start < first.time).length;
    const after = run.notes.filter((n) => n.start > last.time).length;
    const at = first.at - before / perSystem;
    const until = last.at + after / perSystem;
    return {
      ...run,
      at: Math.max(0, at),
      until: Math.max(at, until),
      anchors,
      sure: true,
      why: '',
    };
  });
  return out;
}

/**
 * THE ANCHORS OF ONE GO HAVE TO AGREE WITH EACH OTHER about how much music is
 * between them.
 *
 * A go is placed by matching each system of the page against it, and on music
 * that repeats a figure one of those matches can land on the wrong copy. Inside
 * a single go there is a cheap way to see it: the notes played between two
 * anchors say how far apart they should be. MEASURED, `npm run scan:practice`
 * on the Bach page — a go that played the first two systems anchored one of
 * them at system 0.8 and the other at system 6, thirty notes apart, and claimed
 * to cover 0.8 to 7.5 of a ten-system page. Thirty notes is one system of that
 * page, not five.
 *
 * The longest chain of anchors that agree is kept. A single anchor cannot
 * disagree with anything and is kept as it is, with its reach bounded by the
 * notes either side of it.
 */
const ANCHORS_OUT = 0.7;      // systems of disagreement allowed between two anchors

function agreeWithin(anchors, notes, perSystem) {
  if (anchors.length < 2) return anchors;
  const countBefore = (time) => notes.filter((n) => n.start < time).length;
  const marks = anchors.map((one) => ({ ...one, notes: countBefore(one.time) }));
  const agrees = (a, b) => {
    const want = (b.notes - a.notes) / perSystem;
    return Math.abs((b.at - a.at) - want) <= ANCHORS_OUT;
  };
  // Longest chain in which every neighbouring pair agrees. The anchors are few,
  // so the plain O(n^2) walk is the right amount of machinery.
  const best = marks.map(() => ({ run: 1, from: -1, score: 0 }));
  marks.forEach((one, i) => {
    best[i].score = one.score ?? 0;
    for (let j = 0; j < i; j += 1) {
      if (!agrees(marks[j], one)) continue;
      const run = best[j].run + 1;
      const score = best[j].score + (one.score ?? 0);
      if (run > best[i].run || (run === best[i].run && score > best[i].score)) {
        best[i] = { run, from: j, score };
      }
    }
  });
  let end = 0;
  best.forEach((one, i) => {
    if (one.run > best[end].run || (one.run === best[end].run && one.score > best[end].score)) end = i;
  });
  const keep = [];
  for (let i = end; i >= 0; i = best[i].from) {
    keep.unshift(marks[i]);
    if (best[i].from < 0) break;
  }
  return keep.map(({ notes: _notes, ...one }) => one);
}

/**
 * WHICH GOES PASSED THROUGH THIS BAR, latest last.
 *
 * A bar played six times has six answers and the count is a fact the player
 * wants: "three goes at this one" is the sentence that makes a practice
 * recording legible.
 */
export function goesAt(runs, bar) {
  const at = typeof bar === 'object' && bar !== null ? bar.at : bar;
  if (!Number.isFinite(at)) return [];
  return (runs ?? [])
    .filter((run) => run.sure && at >= run.at - 1e-9 && at <= run.until + 1e-9)
    .map((run) => {
      // Straight through the run, between where it started and where it
      // stopped. Its own anchors bend it where it has more than one.
      const marks = [
        { at: run.at, time: run.from },
        ...run.anchors,
        { at: run.until, time: run.to },
      ].sort((a, b) => a.at - b.at);
      for (let i = 0; i < marks.length - 1; i += 1) {
        const a = marks[i];
        const b = marks[i + 1];
        if (at >= a.at && at <= b.at) {
          const across = b.at - a.at;
          return { run, time: across > 0 ? a.time + ((at - a.at) / across) * (b.time - a.time) : a.time };
        }
      }
      return { run, time: run.from };
    })
    .sort((a, b) => a.time - b.time);
}

/** Which bar a moment of the recording was in, across all the goes. */
export function barAtTimeInRuns(runs, bars, time) {
  if (!Number.isFinite(time)) return -1;
  const run = (runs ?? []).find((one) => one.sure && time >= one.from && time <= one.to);
  if (!run) return -1;
  const across = run.to - run.from;
  const at = across > 0
    ? run.at + ((time - run.from) / across) * (run.until - run.at)
    : run.at;
  let best = -1;
  for (const bar of bars ?? []) {
    if (at >= bar.at && at < bar.to) return bar.index;
    if (at >= bar.at) best = bar.index;
  }
  return best;
}

/** What the runs add up to, in a sentence a player can act on. */
export function sayRuns(runs) {
  const sure = (runs ?? []).filter((one) => one.sure);
  const lost = (runs ?? []).length - sure.length;
  if (!sure.length) return 'none of this take could be found on these pages';
  const goes = sure.length === 1 ? 'one go' : `${sure.length} goes`;
  return `${goes} at this music`
    + (lost ? `, and ${lost} stretch${lost === 1 ? '' : 'es'} that could not be placed` : '');
}
