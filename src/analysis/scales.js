import { nameToMidi } from './note-utils.js';

// Semitone offsets within one octave, ascending (index 0..7 = degrees 1..8).
const ASCENDING = {
  major: [0, 2, 4, 5, 7, 9, 11, 12],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10, 12],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11, 12],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11, 12],
};

// Melodic minor is the only type that comes down differently than it went up.
const DESCENDING = {
  'melodic-minor': ASCENDING['natural-minor'],
};

// Expands { tonic: 'D3', type: 'major', octaves: 2 } into the full midi
// sequence: ascending to the top, then descending without repeating the peak.
export function buildScale({ tonic, type = 'major', octaves = 1 }) {
  const root = nameToMidi(tonic);
  const upSteps = ASCENDING[type];
  const downSteps = DESCENDING[type] ?? upSteps;
  if (!upSteps) throw new Error(`unknown scale type: ${type}`);

  const up = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (let i = oct === 0 ? 0 : 1; i < upSteps.length; i++) {
      up.push(root + oct * 12 + upSteps[i]);
    }
  }

  const down = [];
  for (let oct = octaves - 1; oct >= 0; oct--) {
    for (let i = downSteps.length - 2; i >= 0; i--) {
      down.push(root + oct * 12 + downSteps[i]);
    }
  }

  return [...up, ...down];
}
