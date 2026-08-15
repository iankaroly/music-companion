// What the notes on a scanned page probably are.
//
// PROBABLY is the whole word. The page reader measures where a notehead sits
// between the staff lines and nothing else — no clef, no key signature, no
// accidental in front of the note. Those three are what turn a position into a
// pitch, and none of them is read.
//
// But the mapping from position to pitch is almost entirely fixed. Going up one
// step on the stave is a tone or a semitone in a pattern that repeats every
// octave, and everything a clef does is slide the whole pattern up or down by
// the same amount for every note on the page. So there is exactly ONE unknown:
// where the pattern starts. And a take gives it away — play the page and the
// pitches you produced are the pattern, offset by that one number.
//
// That is enough to hand the ordinary aligner a score to align against, which
// is the point of this file. It is NOT enough to say a note was wrong: a key
// signature moves some degrees by a semitone and an accidental moves one note,
// and neither is read, so a semitone disagreement here means "one of us has an
// accidental" rather than "you played the wrong note". The alignment is told to
// treat a semitone as near-enough; nothing else should read these as gospel.

// Semitones above the bottom line, for each step of the stave, in a plain
// major-ish scale. Step 0 is the bottom line, 1 the space above it.
const DEGREE = [0, 2, 4, 5, 7, 9, 11];

// How much of the take's opening the clef is fitted from. Enough that a stray
// note cannot move a median, short enough to be over before the playing has
// had a chance to depart from the page.
const FIT_WINDOW = 24;

export function semitonesForStep(step) {
  const octave = Math.floor(step / 7);
  const degree = ((step % 7) + 7) % 7;
  return octave * 12 + DEGREE[degree];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

/**
 * Fit the one unknown — the pitch of the bottom line — from a take that has
 * already been placed on the page, and hand back the heads with a `midi` on
 * them so the ordinary aligner can work.
 *
 * `pairs` is what findStart's offset gives: played note i sits on head i. They
 * do not all have to be right; the fit is a median, so a handful of wrong ones
 * move it not at all.
 *
 * Deliberately NOT fitted: the key signature. Working out which degrees are
 * sharp from what the player produced means learning whatever the player
 * consistently does — and on an instrument with no frets, "consistently plays
 * that degree a bit low" is a thing the app exists to TELL you about, not to
 * absorb into its model of the page. A semitone of slack in the aligner costs
 * less than a model that quietly agrees with your mistakes.
 */
export function fitPitches(heads, played, offset = 0, window = FIT_WINDOW) {
  const guesses = [];
  // Fitted from the OPENING of the take, and only the opening.
  //
  // The pairs handed in here are positional — played note i on notehead i —
  // which is exactly the pairing that goes wrong the moment a note is left out
  // or an extra one appears. Fit across the whole take and one slip halfway
  // through puts half the pairs an octave-ish adrift, the agreement collapses,
  // and the fit is refused on a take it should have handled. The opening is
  // the part findStart has already confirmed matches, so it is the part worth
  // measuring, and one number is all that is being measured.
  const upto = Math.min(heads.length - offset, played.length, window);
  for (let i = 0; i < upto; i++) {
    const step = heads[offset + i]?.step;
    const midi = played[i]?.midi;
    if (!Number.isFinite(step) || !Number.isFinite(midi)) continue;
    guesses.push(midi - semitonesForStep(step));
  }
  if (guesses.length < 8) return null;

  const base = Math.round(median(guesses));
  // How much of the take actually agrees with that one number. A page whose
  // notes were never really placed gives a scattered fit, and a scattered fit
  // is a reason to leave the whole thing alone.
  const agree = guesses.filter((g) => Math.abs(g - base) <= 1).length / guesses.length;
  return {
    base,
    agreement: agree,
    // Every notehead on the page, priced in pitch.
    notes: heads.map((head, index) => ({
      ...head,
      index,
      midi: Number.isFinite(head.step) ? base + semitonesForStep(head.step) : null,
    })).filter((n) => n.midi !== null),
  };
}
