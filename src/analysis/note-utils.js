const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// 'F#2' → 42, 'Bb3' → 58. Accepts one # or b.
export function nameToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!m) throw new Error(`invalid note name: ${name}`);
  const [, letter, accidental, octave] = m;
  const offset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return (Number(octave) + 1) * 12 + LETTER_SEMITONES[letter] + offset;
}

export function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

// Equal temperament relative to a configurable A4 reference (MIDI 69).
// Orchestras tune anywhere from 440 to 443; the default is 440.
export function freqToNote(frequency, a4 = 440) {
  const midiFloat = 69 + 12 * Math.log2(frequency / a4);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  return { name: midiToName(midi), midi, cents };
}
