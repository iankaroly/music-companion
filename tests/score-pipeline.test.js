import { describe, test, expect } from 'vitest';
import { Analyzer } from '../src/audio/analyzer.js';
import { NoteSegmenter } from '../src/analysis/notes.js';
import { parseScore } from '../src/analysis/musicxml.js';
import { alignScore } from '../src/analysis/align-score.js';
import { scoreTiming } from '../src/analysis/score-timing.js';

// The test that decides whether any of this is real. Everything else checks a
// module against synthetic inputs it was designed for; this plays a scale as
// audio, pushes it through the SAME Analyzer and NoteSegmenter the microphone
// feeds, and asks whether the mark lands on the right notehead. Anything less
// tests the aligner against its own assumptions.

const SR = 44100;

function tone(freq, seconds, out, startSample) {
  const n = Math.floor(seconds * SR);
  for (let i = 0; i < n; i++) {
    const t = (startSample + i) / SR;
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h;
    out.push(v * 0.3);
  }
  return n;
}

function silence(seconds, out) {
  const n = Math.floor(seconds * SR);
  for (let i = 0; i < n; i++) out.push(0);
  return n;
}

// D major, one octave, as MuseScore would write it.
const SCALE = [
  ['A', 0, 3, 220], ['B', 0, 3, 246.94], ['C', 1, 4, 277.18], ['D', 0, 4, 293.66],
  ['E', 0, 4, 329.63], ['F', 1, 4, 369.99], ['G', 1, 4, 415.30], ['A', 0, 4, 440],
];

const SCALE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${SCALE.slice(0, 4).map(([step, alter, octave]) => `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}
    </measure>
    <measure number="2">
      ${SCALE.slice(4).map(([step, alter, octave]) => `<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}
    </measure>
  </part>
</score-partwise>`;

const SHARP_INDEX = 4; // E4, played 30 cents sharp
const LATE_INDEX = 6;  // G#4, entered late

function playScale() {
  const samples = [];
  let cursor = 0;
  SCALE.forEach(([, , , freq], i) => {
    if (i === LATE_INDEX) cursor += silence(0.15, samples);
    const played = i === SHARP_INDEX ? freq * Math.pow(2, 30 / 1200) : freq;
    cursor += tone(played, 0.42, samples, cursor);
    cursor += silence(0.08, samples);
  });
  return Float32Array.from(samples);
}

function heardNotes(audio) {
  const analyzer = new Analyzer(SR, { windowSize: 2048, hopSize: 512 });
  const segmenter = new NoteSegmenter();
  const notes = [];
  for (let i = 0; i < audio.length; i += 128) {
    for (const reading of analyzer.push(audio.subarray(i, i + 128))) {
      notes.push(...segmenter.push(reading));
    }
  }
  notes.push(...segmenter.flush());
  return notes;
}

describe('a played scale annotated onto the score it was read from', () => {
  const played = heardNotes(playScale());
  const { notes: score } = parseScore(SCALE_XML);
  const aligned = alignScore(played, score);

  test('the score reads as the eight notes that were played', () => {
    expect(score.map((n) => n.midi)).toEqual([57, 59, 61, 62, 64, 66, 68, 69]);
    expect(played.map((n) => n.midi)).toEqual([57, 59, 61, 62, 64, 66, 68, 69]);
  });

  test('every notehead gets the note that was actually played on it', () => {
    expect(aligned.matched).toBe(8);
    expect(aligned.missed).toBe(0);
    expect(aligned.extra).toBe(0);
    expect(aligned.attempts.map((a) => a.verdict)).toEqual(Array(8).fill('match'));
  });

  test('the sharp note is sharp, on its own notehead and no other', () => {
    const attempt = aligned.attempts[SHARP_INDEX];
    expect(attempt.scoreNoteId).toBe(score[SHARP_INDEX].id);
    expect(attempt.score.measure).toBe(2);
    expect(attempt.played.cents).toBeGreaterThan(20);
    expect(attempt.played.cents).toBeLessThan(40);

    const others = aligned.attempts.filter((_, i) => i !== SHARP_INDEX);
    for (const other of others) expect(Math.abs(other.played.cents)).toBeLessThan(12);
  });

  test('the late entry is late, and the notes after it are not blamed for it', () => {
    const timing = scoreTiming(aligned.attempts);
    expect(timing.bpm).toBeGreaterThan(110);
    expect(timing.bpm).toBeLessThan(130);
    expect(timing.perNote[LATE_INDEX].verdict).toBe('late');
    expect(timing.perNote[LATE_INDEX].deviationMs).toBeGreaterThan(100);
    expect(timing.perNote.filter((n) => n.verdict === 'late')).toHaveLength(1);
  });
});
