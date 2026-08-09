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

// Where the tiers actually change, so a legend can name the cents instead of
// inventing words for them. BADLY is the same 25¢ intonationStatus uses.
const BADLY = 25;

export function intonationBounds() {
  return { good: goodWithin, badly: BADLY };
}

export function intonationStatus(cents) {
  const c = Math.abs(cents);
  if (c < goodWithin) return 'good';
  if (c < BADLY) return 'off';
  return 'bad';
}

// The same tiers, plus which WAY the note missed.
//
// How far off answers "how bad"; which way is the thing a player can act on —
// you fix a flat note and a sharp note with opposite hands. The graph and the
// note tiles deliberately do not use this: they colour by size alone and have
// meant that everywhere in the app for months. The score is where direction
// earns its keep, because a whole page of noteheads can show a habit leaning
// one way at a glance.
//
// A note inside the band has no direction worth naming — calling a note 2¢
// sharp invites chasing a number that is closer than the ear can hear.
export function intonationTone(cents) {
  if (!Number.isFinite(cents)) return { tier: 'none', direction: 'none' };
  const tier = intonationStatus(cents);
  return { tier, direction: tier === 'good' ? 'centred' : cents > 0 ? 'sharp' : 'flat' };
}
