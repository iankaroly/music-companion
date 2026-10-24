// What a take is called in a sentence, and how two takes are told apart.
//
// Shared by facts.js and musicality-facts.js so a comparison names its two takes
// the same way in both. A take is its name, or failing that the day it was made.
// Two takes of one piece share a name, and two takes made on one day share a
// day, so a comparison that says only "Bach, Oct 20" twice ("Bach, Oct 20" 9¢,
// "Bach, Oct 20" 22¢, so "Bach, Oct 20" is 13¢ closer) has given the numbers and
// lost which one they belong to. The time of day comes next, and when even that
// is the same, newer and older.

const hasName = (take) => String(take?.name ?? '').trim().length > 0;
const valid = (take) => Number.isFinite(new Date(take?.date).getTime());

// Always English. The sentences around a date are English, the guard reads month
// names in English, and a device in German or Japanese printed "19. Okt." or
// "10月19日" there, so an honest "Your Oct 19 take" was refused as a date not in
// the measurements.
export function whenOf(take) {
  return valid(take) ? new Date(take.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
}

export function timeOf(take) {
  return valid(take) ? new Date(take.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}

// A take with no name and no readable date still needs a word; "Invalid Date"
// is never one.
export function takeLabel(take) {
  return String(take?.name ?? '').trim() || whenOf(take) || 'an unnamed take';
}

const join = (...parts) => parts.filter(Boolean).join(', ');

// -> [labelOfA, labelOfB], different from each other whenever the two takes are
// different takes. `a` is the newer take.
export function pairLabels(a, b) {
  const na = takeLabel(a);
  const nb = takeLabel(b);
  if (na !== nb) return [na, nb];
  // An unnamed take's label already is its day.
  const dated = (t, n) => (hasName(t) ? join(n, whenOf(t)) : n);
  let la = dated(a, na);
  let lb = dated(b, nb);
  if (la !== lb) return [la, lb];
  la = join(la, timeOf(a));
  lb = join(lb, timeOf(b));
  if (la !== lb) return [la, lb];
  return [`${la}, the newer one`, `${lb}, the older one`];
}
