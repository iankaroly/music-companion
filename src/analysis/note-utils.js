const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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
