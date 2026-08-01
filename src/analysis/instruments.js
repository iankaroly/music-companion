// Who is holding the instrument.
//
// The app was built by and for a cellist and it showed everywhere a word
// appeared. Landing bands said "shift past a 5th" — a shift is a left-hand
// motion on a fingerboard, and a flutist does not make one. Drone timbres
// defaulted to strings. Nothing knew that a soprano's low C and a cello's are
// two octaves apart, or that a clarinet reads a written C and sounds a B flat.
//
// A profile is that knowledge in one place: the vocabulary for how you get from
// one note to the next, which drone sounds like the room you practice in, and
// what to try when a kind of reach keeps landing badly. Everything user-facing
// asks the profile rather than assuming a fingerboard.
//
// Deliberately NOT here: transposition. A family is not a transposition — a
// flute and a B flat clarinet are both winds — so that stays where it already
// was, on the tuner's own instrument control, which names the actual pitch.

export const INSTRUMENTS = [
  {
    id: 'strings',
    label: 'Strings',
    examples: 'violin, viola, cello, bass, guitar',
    timbre: 'strings',
    // how a player of this instrument describes getting from note to note
    motion: {
      same: 'repeated note',
      step: 'step',
      leap: 'leap to a 5th',
      shift: 'shift past a 5th',
      samePlural: 'repeated notes',
      stepPlural: 'steps',
      leapPlural: 'leaps up to a 5th',
      shiftPlural: 'shifts past a 5th',
    },
    // what the coach suggests when a band lands badly
    aim: 'Play the shift slowly and stop the bow on arrival — land it, then play it.',
  },
  {
    id: 'winds',
    label: 'Winds',
    examples: 'flute, clarinet, oboe, sax, bassoon',
    timbre: 'reed',
    motion: {
      same: 'repeated note',
      step: 'step',
      leap: 'leap to a 5th',
      shift: 'leap past a 5th',
      samePlural: 'repeated notes',
      stepPlural: 'steps',
      leapPlural: 'leaps up to a 5th',
      shiftPlural: 'leaps past a 5th',
    },
    aim: 'Take the leap without changing air speed first — set the embouchure, then blow.',
  },
  {
    id: 'brass',
    label: 'Brass',
    examples: 'trumpet, horn, trombone, tuba',
    timbre: 'reed',
    motion: {
      same: 'repeated note',
      step: 'step',
      leap: 'slur to a 5th',
      shift: 'leap past a 5th',
      samePlural: 'repeated notes',
      stepPlural: 'steps',
      leapPlural: 'slurs up to a 5th',
      shiftPlural: 'leaps past a 5th',
    },
    aim: 'Hear the partial before you play it — arriving flat usually means arriving late.',
  },
  {
    id: 'voice',
    label: 'Voice',
    examples: 'any part',
    timbre: 'pure',
    motion: {
      same: 'repeated note',
      step: 'step',
      leap: 'leap to a 5th',
      shift: 'leap past a 5th',
      samePlural: 'repeated notes',
      stepPlural: 'steps',
      leapPlural: 'leaps up to a 5th',
      shiftPlural: 'leaps past a 5th',
    },
    aim: 'Approach the interval on the breath, not the throat — sing the top note first, then the phrase.',
    // A voice is the one family here whose vibrato is wide enough to be read as
    // a change of note. At ±60 cents — ordinary for a trained singer — every
    // swing crosses the 0.6-semitone split threshold, and once one swing has
    // split the note the new note's median IS that peak, so the opposite peak
    // is a whole tone away and splits again. A five-syllable phrase came out
    // as forty-eight notes, measured.
    //
    // The fix is time, not a wider threshold: above a semitone the segmenter
    // stops hearing stepwise melody at all. A vibrato swing is past the
    // threshold for a few tens of milliseconds and returns; a real note change
    // stays. 70 ms tells them apart and is still far shorter than any sung
    // note. Silence stays where it is on purpose — in singing a consonant gap
    // usually IS the boundary between one syllable and the next, and bridging
    // them merged notes that were genuinely separate.
    segmentation: { holdFrames: 6, silenceFrames: 4, minDuration: 0.08 },
  },
  {
    id: 'keys',
    label: 'Keys & other',
    examples: 'piano, mallets, anything else',
    timbre: 'organ',
    motion: {
      same: 'repeated note',
      step: 'step',
      leap: 'leap to a 5th',
      shift: 'leap past a 5th',
      samePlural: 'repeated notes',
      stepPlural: 'steps',
      leapPlural: 'leaps up to a 5th',
      shiftPlural: 'leaps past a 5th',
    },
    aim: 'Listen for the arrival rather than the departure.',
  },
];

const DEFAULT_ID = 'strings';
const KEY = 'instrument';

// What the note segmenter should do for this player. Absent means the defaults
// in notes.js, which is deliberate: those were tuned on a cello and every
// family that has not been shown to need something else keeps them, so a
// profile only ever appears here on evidence.
export function segmentation(profile = current) {
  return profile.segmentation ?? {};
}

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS.find((i) => i.id === DEFAULT_ID);
}

// Module state rather than a storage read on every call: this is asked for on
// every note label the app draws, and the analysis modules stay pure.
let current = instrumentById(DEFAULT_ID);

export function instrument() {
  return current;
}

export function setInstrument(id) {
  current = instrumentById(id);
  return current;
}

export function loadInstrument(storage = globalThis.localStorage) {
  try {
    return setInstrument(storage?.getItem(KEY) ?? DEFAULT_ID);
  } catch {
    return setInstrument(DEFAULT_ID);
  }
}

export function saveInstrument(id, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, id);
  } catch { /* survivable */ }
  return setInstrument(id);
}

// Has the player ever said what they play? A fresh install hasn't, which is
// what the first-run screen keys off.
export function instrumentChosen(storage = globalThis.localStorage) {
  try {
    return !!storage?.getItem(KEY);
  } catch {
    return false;
  }
}
