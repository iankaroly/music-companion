import { midiToName, nameToMidi } from './note-utils.js';
import { buildScale } from './scales.js';

// Forward matcher: walks the expected scale, consuming played notes in
// order. Tolerates a re-bowed repeat of the just-matched degree, a single
// skipped degree, and ignores stray notes (octave glitches, squeaks).
export function alignScale(expectedMidis, playedNotes) {
  const degrees = expectedMidis.map((midi) => ({ midi, name: midiToName(midi), played: null }));
  let i = 0;

  for (const note of playedNotes) {
    if (i > 0 && note.midi === degrees[i - 1].midi && degrees[i - 1].played) {
      continue; // re-bowed the degree we just matched
    }
    if (i < degrees.length && note.midi === degrees[i].midi) {
      degrees[i].played = note;
      i++;
    } else if (i + 1 < degrees.length && note.midi === degrees[i + 1].midi) {
      degrees[i + 1].played = note; // current degree was skipped
      i += 2;
    }
    // anything else is a stray — ignore
  }

  const matched = degrees.filter((d) => d.played).length;
  return { degrees, matched, missed: degrees.length - matched };
}

// Register detection: the player picks only key/type/octaves — where they
// started is inferred by aligning against every plausible octave of the
// tonic and keeping the best match (ties go to the octave nearest the
// first played note).
export function bestAlignment({ key, type, octaves }, playedNotes) {
  if (playedNotes.length === 0) return null;

  const pitchClass = nameToMidi(`${key}0`) % 12;
  let best = null;

  for (let oct = 0; oct <= 7; oct++) {
    const tonicMidi = 12 * (oct + 1) + pitchClass;
    const scale = buildScale({ tonic: midiToName(tonicMidi), type, octaves });
    if (tonicMidi < 21 || Math.max(...scale) > 108) continue; // outside piano range

    const result = alignScale(scale, playedNotes);
    const distance = Math.abs(tonicMidi - playedNotes[0].midi);
    if (!best || result.matched > best.matched ||
        (result.matched === best.matched && distance < best.distance)) {
      best = { tonic: midiToName(tonicMidi), scale, distance, ...result };
    }
  }
  return best;
}

// Rhythm summary from matched-note onset times.
// evenness: 1 - coefficient of variation of inter-onset intervals (1 = metronomic).
// drift: relative change in interval length from the first third to the last
// third of the run — negative means intervals shrank, i.e. rushing.
export function tempoStats(onsets) {
  if (onsets.length < 3) return null;

  const intervals = [];
  for (let i = 1; i < onsets.length; i++) intervals.push(onsets[i] - onsets[i - 1]);

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;

  const third = Math.max(1, Math.floor(intervals.length / 3));
  const meanOf = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const drift = (meanOf(intervals.slice(-third)) - meanOf(intervals.slice(0, third))) / mean;

  return { bpm: 60 / mean, evenness: Math.max(0, 1 - cv), drift };
}
