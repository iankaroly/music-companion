// A position on the stave, plus a clef, plus a key signature, is a note.
//
// This is what scan-pitch.js was standing in for. That file fits the one
// unknown — where the pattern starts — from the RECORDING, which works only
// once the recording has already been placed on the page, which is the thing
// the pitches were wanted for in the first place. Reading the clef off the
// paper (scan-clef.js) and the signature off the paper (scan-key.js) leaves
// nothing to fit and nothing to wait for.
//
// Everything here is arithmetic. The hard part was upstream.

// Semitones above C for each diatonic degree: C D E F G A B. The pattern that
// makes a step sometimes a tone and sometimes a semitone, and the reason a
// notehead's position cannot be turned into a pitch by multiplication.
const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// What the bottom line of the stave IS, as MIDI, in each clef.
//
// A clef does exactly one thing: it names a line. Every other note on the page
// follows from that one number, which is why reading three symbols correctly
// settles a whole page and why reading one wrong ruins one.
export const BOTTOM_LINE = { bass: 43, tenor: 53, treble: 64 };

// Which diatonic degree that bottom line is. Bass is G, tenor F, treble E.
const BOTTOM_DEGREE = { bass: 4, tenor: 3, treble: 2 };

/**
 * The note a notehead at `step` represents.
 *
 * `step` counts steps up from the bottom line — 0 on the bottom line, 1 in the
 * space above it — which is what scan-read.js measures off the page. Negative
 * steps are ledger lines below the stave and read the same way.
 *
 * Returns { midi, degree }, or null when the clef or the key could not be read.
 *
 * Null must be PROPAGATED, never defaulted. A cello part is in bass clef most
 * of the time, and "most of the time" is exactly the assumption that turns the
 * other times into a page of confident verdicts a sixth out of place.
 */
export function pitchOf(step, clef, key) {
  if (!Number.isFinite(step)) return null;
  const base = BOTTOM_LINE[clef];
  const baseDegree = BOTTOM_DEGREE[clef];
  if (base === undefined || !key?.alter) return null;

  // Where this step lands, counted in degrees from C rather than from the
  // bottom line, so the octave arithmetic has something absolute to divide by.
  const absolute = baseDegree + step;
  const degree = ((absolute % 7) + 7) % 7;
  const octave = Math.floor(absolute / 7) - Math.floor(baseDegree / 7);

  const semitones = DEGREE_SEMITONES[degree] - DEGREE_SEMITONES[baseDegree];
  return { midi: base + semitones + octave * 12 + key.alter[degree], degree };
}
