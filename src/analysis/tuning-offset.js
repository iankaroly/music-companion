// WHERE THE INSTRUMENT ITSELF IS SITTING, against the A the app assumes.
//
// THE COMPLAINT THIS EXISTS FOR, in a player's words: "one time, it got the
// pitch perfect relative to the notes being played, and the other times it was
// like a half step too low — the app would say it's an A, but it's actually an
// A#. Everything seemed to be a half step too low."
//
// NOTHING WAS BROKEN, and that is the point. The detector was measured against
// synthesised flute tones from C4 to C7 at both sample rates and came back
// inside two cents everywhere. Naming a pitch means rounding it to the nearest
// semitone, and an instrument sitting 51 cents below A440 IS nearer the note
// below. Every name moves down, together, and the cents beside each one look
// immaculate — a flute 55¢ flat reads "A5, +45¢", which is a confident sentence
// and the wrong note. That is why it is baffling from the outside: the app
// never looks unsure.
//
// So the app should notice. This is the one thing it can say that turns a
// hundred wrong names back into one fact about the instrument.
//
// WHY THE OBVIOUS STATISTIC DOES NOT WORK. The first idea is to average the
// cents: if everything is 55 flat, the mean should be -55. It cannot be. The
// naming has already folded every reading into ±50 by the time it is written
// down — that IS the renaming — so a take 55¢ flat comes back with a median of
// +11 and a spread of 36, and looks like bad playing. MEASURED on a real take
// of 185 notes, shifted 55¢ flat: median +11.2¢, MAD 36.5¢. The evidence is
// destroyed by the fold.
//
// So the cents are treated as ANGLES on a circle of one semitone, which is what
// they are once folded, and the offset is the circular mean. That survives the
// fold because it never unfolds anything.
//
// AND THE SECOND NUMBER IS THE ONE THAT MAKES IT SAFE. The circular mean alone
// cannot tell an instrument that is flat from a player who is scattered — both
// can average anywhere. What separates them is how TIGHT the readings are
// around that mean, which is the length of the resultant vector: 1 is every
// note off by the same amount, 0 is noise. MEASURED, same 185-note take:
//
//   the take as recorded                 offset  +6.4¢   tightness 0.67
//   the same playing, 30¢ flat           offset -23.6¢   tightness 0.67
//   the same playing, 55¢ flat           offset -48.6¢   tightness 0.67
//   scattered at random by ±30¢          offset  +4.7¢   tightness 0.26
//   scattered at random by ±60¢          offset -44.6¢   tightness 0.22
//   scattered at random by ±90¢          offset -45.1¢   tightness 0.09
//
// Shifting the instrument moves the offset and leaves the tightness alone;
// playing badly collapses the tightness and puts the offset anywhere. A
// sentence gated on tightness therefore cannot fire on somebody having a hard
// time, which is the failure that would matter — telling a struggling player
// that their tuner is wrong.

// The gap in the table above is between 0.26 and 0.67, and this sits in it. A
// take under this is not consistent enough for the offset to mean anything.
const TIGHT_ENOUGH = 0.45;
// …and below this there is nothing worth saying: a few cents is a player, not
// a reference.
const WORTH_SAYING = 18;
// Fewer than this and one sour note moves the answer.
const ENOUGH_NOTES = 12;
// Past this the fold makes the direction unknowable — see sayTuningOffset.
const NO_DIRECTION = 40;

/**
 * How far the playing sits from the A the app is measuring against.
 *
 * @param {Array<object>} notes what was heard, each with `cents` folded to ±50
 * @returns {object|null} `{ cents, tightness, notes }`, or null when there is
 *   not enough to say — which is most takes, and is the answer then.
 */
export function tuningOffset(notes) {
  const heard = (notes ?? [])
    .map((one) => one?.cents)
    .filter((one) => Number.isFinite(one));
  if (heard.length < ENOUGH_NOTES) return null;
  let sin = 0;
  let cos = 0;
  for (const cents of heard) {
    const angle = (2 * Math.PI * cents) / 100;
    sin += Math.sin(angle);
    cos += Math.cos(angle);
  }
  sin /= heard.length;
  cos /= heard.length;
  const tightness = Math.hypot(sin, cos);
  const cents = (Math.atan2(sin, cos) / (2 * Math.PI)) * 100;
  return { cents, tightness, notes: heard.length };
}

/**
 * …and the same thing as the one sentence worth showing, or nothing.
 *
 * Nothing is the usual answer and it is deliberate. A take that is a few cents
 * off is a player playing, and a take that is scattered is a player struggling;
 * neither wants to be told about A440. What is left is the case this was
 * written for — steady playing against the wrong reference — where every name
 * on the screen is wrong together and nothing else on it says so.
 */
export function sayTuningOffset(offset, a4 = 440) {
  if (!offset) return null;
  const { cents, tightness } = offset;
  if (tightness < TIGHT_ENOUGH || Math.abs(cents) < WORTH_SAYING) return null;
  const size = Math.round(Math.abs(cents));

  // PAST THE HALFWAY LINE THERE IS NO DIRECTION TO GIVE, and giving one would
  // send a player the wrong way.
  //
  // The cents written down are already folded into ±50 — that fold IS the
  // renaming — so an instrument 55¢ FLAT and one 45¢ SHARP produce identical
  // readings, note for note. Nothing in the take can tell them apart, because
  // by the time it is written down they are the same take. A flute 55¢ flat
  // therefore measures +45 here, and a sentence that says "45¢ above A440"
  // would be pointing at the opposite of the problem.
  //
  // So near the line it says the one thing it does know: that the playing sits
  // about half a semitone off, and that the names have moved with it. Which
  // side is something the player can see on their own instrument in a second
  // and the app cannot see at all.
  if (Math.abs(cents) > NO_DIRECTION) {
    return `everything you played sits about half a semitone from A${Math.round(a4)}`
      + ' — near enough the halfway line that the names on this take may be a'
      + ' semitone out, all in the same direction';
  }
  // Below it the fold has not touched most of the readings, so the direction is
  // real, and the A it implies is the number a player already thinks in.
  const theirA = Math.round(a4 * 2 ** (cents / 1200));
  return `everything you played sits about ${size}¢ ${cents < 0 ? 'below' : 'above'}`
    + ` A${Math.round(a4)} — that is an A of about ${theirA}`;
}
