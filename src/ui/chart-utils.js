// Hit-testing and status tiers shared by the chart and the note boxes.

// The note whose span contains `time`, or the nearest one within
// `tolerance` seconds of a span edge (clicks in the tiny gaps between
// fast notes should still land).
export function findNoteAt(notes, time, tolerance = 0.15) {
  let best = null;
  let bestDistance = Infinity;
  for (const note of notes) {
    const distance = time < note.start ? note.start - time
      : time > note.end ? time - note.end
      : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = note;
    }
  }
  return bestDistance <= tolerance ? best : null;
}

// good: in tune · off: audibly off · bad: badly off.
//
// The "in tune" edge is a judgement call, not a fact — 8¢ is about where a
// held note starts to beat against a drone, but a beginner wants a wider door
// and someone tuning a quartet wants a narrower one. It's a setting; the
// module keeps it in a variable rather than reading storage so this stays pure
// and testable, and settings.js sets it once at startup.
const DEFAULT_TOLERANCE = 8;
let goodWithin = DEFAULT_TOLERANCE;

export function setIntonationTolerance(cents) {
  goodWithin = Number.isFinite(cents) && cents > 0 ? cents : DEFAULT_TOLERANCE;
}

export function intonationTolerance() {
  return goodWithin;
}

export function intonationStatus(cents) {
  const c = Math.abs(cents);
  if (c < goodWithin) return 'good';
  if (c < 25) return 'off';
  return 'bad';
}
