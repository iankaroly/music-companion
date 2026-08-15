// Whether the note values read off a page can be believed.
//
// Reading a notehead's duration from a photograph — filled or hollow, stem or
// none, how many beams cross the stem — gives an answer for every note whether
// or not it is right. This is the part that decides whether to use it, and it
// is deliberately separate from the reading: a classifier tuned against a
// validator whose own behaviour is not pinned down is two unknowns and no way
// to tell which one is wrong.
//
// THE CHECK THAT MATTERS, AND THE ONE THAT LOOKS LIKE IT
//
// The obvious test is that the bars agree with each other — every bar summing
// to the same number of beats. That is necessary and it is nowhere near
// sufficient, because the commonest way for this to fail is a SYSTEMATIC error:
// read every semiquaver as a quaver and every bar sums to exactly double, with
// perfect agreement. Consistency is not correctness.
//
// So there is a second test that does not depend on the first: the number the
// bars agree on has to be a number music is actually written in. Bars of four
// beats, three, two, six — those are time signatures. Bars of eight are a page
// where everything came out twice as long as it is.
//
// WHAT SUMS SHORT, AND WHY IT IS REFUSED ONE BAR AT A TIME
//
// A bar with a rest in it sums short by exactly the rest. So does a bar where
// the reader missed a notehead, and both are common. Nothing here can tell them
// apart, and neither can be placed — a rest has no notehead to hang a time on.
// But that is a fact about THAT BAR, not about the page: a movement with two
// rested bars in twenty should still get its other eighteen read properly. So
// the refusal is per bar, and the take keeps whatever it is entitled to.

// A bar's worth of beats, in crotchets, that music is actually written in.
// Anything else is a reading that has gone wrong in a consistent way.
const PLAUSIBLE = [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6];

// How much of the page has to agree before the agreement means anything.
const COVERAGE = 0.55;

// Beats are eighths and sixteenths; comparing them raw is comparing floats.
const tick = (beats) => Math.round(beats * 16);

/**
 * Given the note values read for each bar, decide what to trust.
 *
 * `bars` is an array of arrays: one number per note, in crotchet beats.
 *
 * Returns { ok, beatsPerBar, trusted, coverage, why }. `trusted` is a Set of
 * the indices of bars whose notes add up to the bar the page is written in —
 * the ones a per-note verdict may be given for. Everything else falls back to
 * bar-level timing, which needs no note values at all.
 */
export function validateValues(bars) {
  const sums = (bars ?? []).map((bar) => (bar ?? []).reduce((a, b) => a + b, 0));
  const real = sums.filter((s) => s > 0);
  if (real.length < 3) {
    return { ok: false, beatsPerBar: null, trusted: new Set(), coverage: 0, why: 'too few bars to tell' };
  }

  // What most bars come to.
  const tally = new Map();
  for (const sum of real) tally.set(tick(sum), (tally.get(tick(sum)) ?? 0) + 1);
  let mode = null;
  let best = 0;
  for (const [value, count] of tally) {
    if (count > best) { best = count; mode = value; }
  }
  const beatsPerBar = mode / 16;
  const coverage = best / real.length;

  // Test one: do enough of them agree?
  if (coverage < COVERAGE) {
    return {
      ok: false, beatsPerBar, trusted: new Set(), coverage,
      why: 'the bars do not agree on how long a bar is',
    };
  }

  // Test two, and it is NOT implied by the first: is the number they agree on
  // a bar? A page whose bars all come to eight beats is a page where every
  // value was read twice as long, agreeing with itself perfectly.
  if (!PLAUSIBLE.some((p) => tick(p) === mode)) {
    return {
      ok: false, beatsPerBar, trusted: new Set(), coverage,
      why: `every bar came to ${beatsPerBar} beats, which is not a bar — the values are wrong together`,
    };
  }

  // Per bar, not per page: a rested bar and a bar with a notehead missed both
  // sum short, neither can be placed, and neither says anything about the bar
  // after it.
  const trusted = new Set();
  for (const [i, sum] of sums.entries()) {
    if (tick(sum) === mode) trusted.add(i);
  }
  return { ok: true, beatsPerBar, trusted, coverage, why: '' };
}

/**
 * Turn trusted bars into the shape the score analysis already speaks.
 *
 * `scoreTiming` and the rest were written for MusicXML, and what they want of a
 * note is where it falls: which bar, how far into it, and how long it lasts.
 * A bar whose values add up gives all three without anything else being read —
 * no clef, no tempo, no key.
 */
export function beatsFor(bars, { beatsPerBar, trusted }) {
  const out = [];
  let measure = 0;
  for (const [i, bar] of (bars ?? []).entries()) {
    let at = 0;
    for (const durBeats of bar ?? []) {
      out.push({
        bar: i,
        measure,
        beatInMeasure: at,
        onsetBeats: measure * beatsPerBar + at,
        durBeats,
        trusted: trusted.has(i),
      });
      at += durBeats;
    }
    // A bar that did not add up still HAPPENED — the take went through it — so
    // the count moves on. Only its notes are untrusted.
    measure += 1;
  }
  return out;
}
