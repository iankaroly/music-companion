import { validateValues } from './scan-values.js';

// Your timing, against the bars on the page.
//
// A take against a scan could say how steady your own pulse was, and that is a
// real thing to know, but it is not the thing a page of music offers. The page
// has BARS on it — the reader finds the barlines — and bars are the unit a
// player thinks in: this one rushed, that one is where it always falls apart,
// the second half is faster than the first. None of that needs a written tempo
// and none of it needs to know a crotchet from a quaver.
//
// WHAT IS READ, WHAT IS NOT, AND WHAT IS BELIEVED — CORRECTED
//
// This header used to say that note values are not read. They are, and have
// been since scan-stems.js: filled or hollow, stem or none, and how many beams
// cross the stem. What is still NOT read is a FLAG and a DOT, and both cost
// something measurable.
//
// MEASURED, npm run scan:values, against pages/truth/scanned.values.json — 52
// hand-encoded noteheads over eight bars of the Scanned score photograph, each
// value read off a crop at 11x to 40x: 38 right, 14 wrong, 73.1%. Of the 14:
// beams overcounted 7, the dot missed 3 (3 of the 3 dotted quavers in the span
// — 100% of the feature), beams undercounted 3, a hollow head missed 1. The one
// unbeamed FLAGGED quaver in the span came back a semiquaver with beams: 2,
// because the flag's ink is counted as two beams — so an unread flag is not the
// harmless "call it a crotchet" that scan-stems.js's own header claimed.
//
// AND THE PART THAT DECIDES WHAT THIS FILE DOES: validateValues believes ZERO
// bars on all three photographs in this repo — 0 of 39 (Bach), 0 of 38
// (Mozart), 0 of 37 (Scanned), at coverage 21%, 18% and 11% against its
// COVERAGE gate of 0.55. So `fromWritten` below has been false on every real
// page and always was, and every per-note verdict any take has been given came
// from the even-spread fallback further down. The cause is NOT the beam
// counting: the Bach photograph reads 315 of its 318 marked heads as
// semiquavers on a page that is twenty bars of sixteen semiquavers, 99.1%, and
// is still refused entirely. It is that the bar GROUPING is roughly doubled —
// notesInOrder counts barlines within a stave and Bach averages 8.3 notes per
// bar-group where a printed bar of that page holds sixteen — plus chords, which
// validateValues counts as two notes on one onset and which therefore cannot
// add up however well they are read. Both sit upstream of this file.
//
// AND A THIRD CAUSE, MEASURED SINCE, WHICH IS BIGGER THAN EITHER: a bar sum is
// built out of CIRCLES, not out of noteheads. `npm run scan:bars-believed`, on
// 32 studies this repo engraved itself where every printed bar is four crotchet
// beats: 943 things circled where 692 noteheads are printed, all 692 found, and
// 251 of the circles are not a printed notehead — 218 of them priced at a full
// crotchet each. The note values on those same pages are 97.7% right. So the
// refusal below is the correct answer and not a missing feature, and the repair
// is upstream of the values as well as upstream of the grouping. The rejected
// regrouping experiment, with the numbers that rejected it, is in
// tools/value-bars.mjs and in scan-values.js's header.
//
// So what this file can honestly say about a real page today is what it always
// said: that BAR was late. scan-rhythm.js is the join that gives a per-note
// verdict where a bar IS believed and falls back to here where it is not.

// The even-spread assumption is the load-bearing one and it is CHECKED rather
// than assumed. A page of continuous semiquavers satisfies it completely; a
// page with a dotted rhythm or a held note does not, and on that page a
// per-note verdict would be confidently wrong. So the take is asked whether it
// looks evenly spaced, and if it does not, only the bars are reported.

// How uneven a bar's notes may be and still be called even. A bar of equal
// notes played by a person comes in around 0.1; a dotted rhythm is 0.4 and up.
const EVEN_ENOUGH = 0.28;

// Bars shorter than this are a barline the reader saw that is not there — a
// stave end, a repeat sign counted twice — and they would wreck an average.
const RUNT = 0.35;

// Exported because src/ui/score.js says the same thing about the bars it could
// believe, and a second copy of this in the UI is how two numbers that are
// meant to be one come to disagree by a percent and nobody can say which.
export function spread(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

// The bars a take passed through, in the order it played them.
//
// Grouped by the bar CHANGING rather than by a bar number, deliberately. The
// page reader numbers bars within a stave and starts again on the next one, so
// a global number has to be built by adding up barlines across staves and
// pages — and an off-by-one there gives timing that looks perfectly plausible
// and is wrong. Consecutive notes in the same bar of the same stave of the same
// page are the same bar; the moment any of those changes, so is the bar. That
// needs no arithmetic and cannot drift.
export function barsOf(marks) {
  const bars = [];
  let current = null;
  for (const mark of marks ?? []) {
    const start = mark?.note?.start;
    if (!Number.isFinite(start)) continue;
    const key = `${mark.page}|${mark.staff}|${mark.bar}`;
    if (!current || current.key !== key) {
      current = { key, page: mark.page, staff: mark.staff, notes: [], marks: [] };
      bars.push(current);
    }
    current.notes.push(mark.note);
    current.marks.push(mark);
  }
  return bars;
}

// The values read for one bar's notes, in crotchets, one per note.
//
// Exported because scan-rhythm.js has to ask validateValues the SAME question
// this file asks it — a join whose bar sums are built even slightly differently
// would believe a different set of bars from the ones the fallback thinks it
// refused, and the two would disagree about the same bar without either being
// obviously wrong. One expression, used twice.
//
// A BAR WITH AN UNREAD VALUE IN IT IS NOT EVIDENCE, AND SAYS SO BY BEING NULL.
//
// This used to read `bar.marks?.[k]?.beats ?? 0`, on the argument that a zero
// makes the bar sum SHORT and so gets the bar refused — refusal being the safe
// direction. The argument holds only if sums err short, and MEASURED, they do
// not: npm run scan:bars-believed reports 251 of 943 circles on the clean
// engraved pages are not printed noteheads, 218 of them priced at a full
// crotchet, so a page's sums are commonly INFLATED. A bar whose true sum is 5
// with one unread note defaulting from 1 to 0 lands on exactly 4.0 and is
// BELIEVED — the default turned a hole into the one number that would pass.
// That is how 4 of the 6 bars the app believes today are not printed bars.
//
// So the hole propagates instead of being filled. validateValues needs no
// change to honour it: `(bar ?? []).reduce` makes a null bar sum 0, `real`
// drops it from the vote because it filters `s > 0`, and `trusted` never takes
// it because a plausible mode is never 0. An unread value now costs its bar,
// which is what rule 3 asks for.
export function barValues(bar) {
  const values = bar.notes.map((_, k) => bar.marks?.[k]?.beats);
  return values.some((v) => !(v > 0)) ? null : values;
}

/**
 * How the take sat against the bars the page reader found.
 *
 * Everything here comes from WHEN notes were played and WHICH bar the page
 * says they are in. No written tempo, no note values, no clef.
 *
 * Returns null when there is not enough to say anything — one bar cannot be
 * compared with anything, and a take that never reached a second barline has
 * no rhythm to report that its own pulse does not already cover.
 */
export function scanTiming(marks) {
  const bars = barsOf(marks);
  if (bars.length < 3) return null;

  // A bar lasts from its first note to the first note of the next: the last
  // bar has no next, so it is measured to the end of its own last note.
  const spans = [];
  for (const [i, bar] of bars.entries()) {
    const from = bar.notes[0].start;
    const next = bars[i + 1]?.notes[0]?.start;
    const to = Number.isFinite(next) ? next : (bar.notes.at(-1).end ?? bar.notes.at(-1).start);
    const length = to - from;
    if (length > 0) spans.push({ ...bar, order: i, from, to, length, count: bar.notes.length });
  }
  if (spans.length < 3) return null;

  // A bar far shorter than its neighbours is a barline that is not a bar.
  const typical = median(spans.map((s) => s.length));
  const real = spans.filter((s) => s.length >= typical * RUNT);
  if (real.length < 3) return null;

  // WHAT `steadiness` IS WORTH ON A PAGE WHOSE BARLINES WERE MISCOUNTED, and a
  // repair that was built, measured and TAKEN OUT AGAIN.
  //
  // MEASURED, npm run score:follow — a take synthesised on a 0.45s grid, even
  // by construction, and the free review beside it says "100% even". Its marks
  // group into bars of 1, 1, 1, 1, 4, 4, 3, 2, 1, 3, 1, 3, 4, 1, 3, 2, 2 notes
  // and the review reads "47% steady across 17 bars, dragging" about a take a
  // metronome played. A bar's length here is from its own first note to the
  // NEXT bar's first note, so a group holding one note of a four-note bar
  // measures a quarter of that bar and stands in the same list as groups that
  // hold all four: the spread of that list is `steadiness`, and it is measuring
  // the GROUPING and not the player.
  //
  // The repair tried: drop bars whose note count is far below the take's
  // typical bar before computing steadiness, drift and the worst bar — the same
  // argument as RUNT above, on notes instead of length. It does not work and
  // the reason is worth keeping. The median count over those seventeen groups
  // is 2, because the fragments are the majority, so a "half the typical count"
  // filter keeps every one of them. Weighting by notes instead gives 3, which
  // drops the seven singletons and still leaves groups of 2, 3 and 4 notes
  // whose lengths are 0.9s, 1.35s and 1.8s — the spread barely moves, because
  // the defect is not that fragments are short, it is that a bar-group's length
  // is only comparable with another's when the two hold the same music.
  //
  // So nothing is filtered here. The number that would fix this is upstream:
  // notesInOrder counts barlines within a stave and its groups are roughly half
  // a printed bar (see this file's header and scan-rhythm.js's). Until that
  // moves, `steadiness` is a statement about bar-groups the reader found and
  // NOT one about a player's pulse, and the review's own free-review line —
  // which measures the pulse directly and said 100% on the take above — is the
  // one to believe where the two disagree.

  const lengths = real.map((s) => s.length);
  const steadiness = Math.max(0, 1 - spread(lengths));

  // Rushing or dragging, as the take goes on: the last third against the
  // first. Bars getting shorter is rushing.
  const third = Math.max(1, Math.floor(real.length / 3));
  const early = median(lengths.slice(0, third));
  const late = median(lengths.slice(-third));
  const drift = early > 0 ? (late - early) / early : 0;

  // The bar that stands out most, which is the one worth looking at.
  const worst = real.reduce((a, b) => (
    Math.abs(b.length - typical) > Math.abs(a.length - typical) ? b : a), real[0]);

  // Is a per-note verdict honest on this take?
  //
  // Only if the notes inside a bar are evenly spread — which is what a page of
  // equal notes gives and what a dotted rhythm does not. Asked of the take
  // rather than assumed of the page, because the page's note values are the
  // one thing not read.
  const gaps = real
    .filter((bar) => bar.count >= 3)
    .map((bar) => spread(bar.notes.slice(1).map((n, i) => n.start - bar.notes[i].start)))
    // Everything finite, INCLUDING zero. Nought is not a missing measurement
    // here, it is the perfect one — notes exactly evenly spread — and dropping
    // it as degenerate refused a per-note verdict on precisely the takes that
    // most deserve one.
    .filter((v) => Number.isFinite(v));
  const evenNotes = gaps.length >= 3 && median(gaps) <= EVEN_ENOUGH;

  // Where each note sat inside its bar.
  //
  // Two ways of knowing, and the better one is used where it can be. If the
  // note VALUES were read off the page and the bars they make add up, then a
  // bar says exactly where each of its notes belongs — a dotted quaver is
  // three quarters of a beat in, and no assumption is needed. Where they were
  // not read, or do not add up, the fallback is that the notes of a bar are
  // equal, which is true of a page of semiquavers and false of the first
  // dotted rhythm.
  const written = validateValues(real.map(barValues));
  const notes = [];
  const useWritten = written.ok;
  if (useWritten || evenNotes) {
    for (const [b, bar] of real.entries()) {
      const values = bar.marks?.map((m) => m?.beats) ?? [];
      const trusted = useWritten && written.trusted.has(b)
        && values.length === bar.count && values.every((v) => v > 0);
      let at = 0;
      for (const [k, note] of bar.notes.entries()) {
        // From the written value where the bar adds up, from equal spacing
        // where it does not — and nothing at all if neither is available.
        const wanted = trusted
          ? bar.from + (at / written.beatsPerBar) * bar.length
          : (evenNotes ? bar.from + (k / bar.count) * bar.length : null);
        if (trusted) at += values[k];
        if (wanted === null) continue;
        notes.push({ note, bar: bar.key, wanted, offBy: note.start - wanted, fromWritten: trusted });
      }
    }
  }

  // THE BARS THEMSELVES, one entry each, so the join in scan-rhythm.js does not
  // have to rebuild them.
  //
  // It would otherwise need its own copy of the runt filter and its own median
  // to know which bars this file kept and what a typical bar came to, and two
  // copies of a filter drift apart — the second one keeps a bar the first threw
  // away and then reports a verdict about it. `order` is the index into the
  // ungrouped bar list, which is how a caller can tell two bars that really
  // follow each other from two that have a discarded runt between them.
  //
  // `ratio` is the whole bar-level verdict and it is a number rather than a
  // word ON PURPOSE. "This bar ran 18% longer than your typical bar" needs no
  // cutoff; "this bar dragged" needs one, and there is no take in this repo
  // with a hand-marked rhythm to measure a cutoff against. An unmeasured
  // constant here would be a confident-looking word standing on nothing.
  const perBar = real.map((bar, index) => ({
    index,
    order: bar.order,
    key: bar.key,
    page: bar.page,
    staff: bar.staff,
    from: bar.from,
    to: bar.to,
    length: bar.length,
    count: bar.count,
    ratio: typical > 0 ? bar.length / typical : null,
    worst: bar === worst,
    marks: bar.marks,
    notes: bar.notes,
  }));

  const offs = notes.map((n) => Math.abs(n.offBy));
  return {
    bars: real.length,
    barLength: typical,
    // Bars a minute, which is the number a player can compare to a metronome
    // even though nothing here read a tempo.
    barsPerMinute: typical > 0 ? 60 / typical : null,
    steadiness,
    drift,
    verdict: drift < -0.04 ? 'rushing' : (drift > 0.04 ? 'dragging' : 'steady'),
    worstBar: { page: worst.page, staff: worst.staff, length: worst.length, notes: worst.count },
    evenNotes,
    // Whether the per-note verdicts came from values read off the page or
    // from assuming a bar's notes are equal. A different claim, said plainly.
    fromWritten: notes.length > 0 && notes.every((n) => n.fromWritten),
    beatsPerBar: written.ok ? written.beatsPerBar : null,
    perBar,
    notes,
    meanOffMs: offs.length ? (offs.reduce((a, b) => a + b, 0) / offs.length) * 1000 : null,
  };
}
