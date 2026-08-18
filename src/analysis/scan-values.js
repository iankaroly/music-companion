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

// WHY EVERY BAR ON EVERY PHOTOGRAPH USED TO BE REFUSED, and it is not the beams
//
// MEASURED this round, by dumping the barline reader's own answer per stave on
// the Bach photograph and then CROPPING the page at 6x and looking at it
// (tools/crop.mjs at 274,1277 and at 705,1277, side by side):
//
//   staff 0  bars at 735, 1301          groups of 17, 17 heads     RIGHT
//   staff 1  bars at 696, 1302          groups of 16, 16           RIGHT
//   staff 2  bars at 713 881 918 956 …  groups of 17, 4, 1, 1, 6, 2, 2
//   staff 8  bars at 1319 only          one group of 32            A BARLINE MISSED
//
// The page is twenty printed bars of sixteen semiquavers. Four of its ten
// systems are barred exactly right, one has an interior barline MISSED, and the
// other five are cut into fragments by columns that are not barlines at all.
// What the crop shows at 274,1277 is the STEM of a beamed semiquaver group
// whose notehead sits on the top line and whose beam sits on the bottom one:
// it fills the column between the lines, nothing wide touches it over most of
// its height (the beam is five pixels of a fifty-pixel stave), and it does not
// overhang, so all three of findBars' tests pass on it. The barline at 705 in
// the same system, cropped beside it, is the same shape with nothing attached.
//
// So the page's bar-groups had sums of 0.5 beats x8, 4 beats x7, 1.25 x4 … and
// the MODE over bar-groups was half a beat — two semiquavers — while seven
// groups holding sixteen semiquavers each summed to exactly four. The reader's
// invented barlines outvoted the page, 8 fragments to 7 bars, because a
// one-note fragment and a sixteen-note bar counted the same.
//
// The obvious repair — count the agreement in NOTES so that a one-note fragment
// cannot outvote a sixteen-note bar — was built, measured and taken out again;
// the numbers are beside the tally below.
//
// AND THE SECOND CAUSE, WHICH IS BIGGER AND IS NOT ABOUT BARLINES AT ALL.
//
// A bar sum is built out of CIRCLES, not out of noteheads. MEASURED, npm run
// scan:bars-believed — thirty-two studies this repo engraved itself, where
// every printed bar is four crotchet beats and every printed notehead's own
// coordinates are known: the reader circles 943 things where 692 noteheads are
// printed, it finds every one of the 692, and 251 OF THOSE CIRCLES ARE NOT A
// PRINTED NOTEHEAD — of which 218 are priced at a full crotchet each. A clean,
// computer-drawn page in three sharps has whole beats added to its bars by its
// own key signature, and the note values themselves are 97.7% right on the same
// pages. No arithmetic over those sums can recover a printed bar.
//
// THAT IS WHY THE OBVIOUS REPAIR DOES NOT WORK, and it was built and measured
// rather than argued about. Merging consecutive bar-groups until their values
// add up to a bar — merging only, never splitting, so that a barline the reader
// found is still evidence — is a clear win on the Bach photograph: 0 bars
// believed becomes 9 of its 20, and every one of those nine holds exactly the
// sixteen semiquaver heads printed in it. On the corpus, where a believed bar
// can be checked against the heads actually printed in it, the same code takes
// bars believed from 6 to 28 and the bars that ARE a printed bar from 2 to 10 —
// buying eight right bars with fourteen more wrong ones. The experiment is kept
// whole, with both halves of that result, in tools/value-bars.mjs, and it is
// deliberately not in this file.
//
// So the written-value route stays refused, and this file's job is to refuse it
// for the right reason. The next thing that would move it is upstream of here
// and upstream of the values: stop circling the key signature.

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
  //
  // COUNTED PER BAR, AND THE OBVIOUS REPAIR WAS BUILT AND MEASURED AND TAKEN
  // OUT AGAIN. On the Bach photograph this line is most of why the page is
  // refused: its bar-groups sum to half a beat eight times (two-note fragments
  // cut out by stems the barline reader believed — see the note at the head of
  // this file) and to four beats seven times (whole printed bars of sixteen
  // semiquavers), so counting BARS makes the modal bar half a beat and the
  // coverage 21%. Weighting each bar by its NOTE COUNT answers 4 beats instead,
  // which is right about that page, and it is not shipped, because the corpus
  // says it is wrong about more pages than it is right about.
  //
  // MEASURED, npm run scan:bars-believed, 32 engraved studies whose every
  // printed bar is four crotchet beats:
  //
  //   per bar   (shipped)   6 bars believed of 200, 2 of them a printed bar
  //   per note              19 bars believed of 200, 0 of them a printed bar
  //
  // Counting notes lets a page's two or three biggest bar-groups carry the
  // whole vote, and on a page whose sums are inflated by circles that are not
  // noteheads the biggest groups are the most inflated. The argument for it —
  // that a one-note fragment is not evidence equal to a sixteen-note bar — is
  // still true and is still not enough.
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

