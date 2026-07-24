import { describe, test, expect } from 'vitest';
import { Analyzer } from '../src/audio/analyzer.js';
import { NoteSegmenter } from '../src/analysis/notes.js';

const SR = 44100;

// Sawtooth-ish tone: harmonically rich like a bowed string.
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

describe('audio → notes pipeline', () => {
  test('three played notes with a gap come out as three named notes', () => {
    const samples = [];
    let cursor = 0;
    cursor += tone(220, 0.5, samples, cursor);       // A3
    cursor += silence(0.2, samples);
    cursor += tone(246.94, 0.5, samples, cursor);    // B3
    cursor += tone(293.66, 0.5, samples, cursor);    // D4 — no gap, pitch-split
    const audio = Float32Array.from(samples);

    const analyzer = new Analyzer(SR);
    const segmenter = new NoteSegmenter();
    const notes = [];
    for (let i = 0; i < audio.length; i += 128) {
      for (const reading of analyzer.push(audio.subarray(i, i + 128))) {
        notes.push(...segmenter.push(reading));
      }
    }
    notes.push(...segmenter.flush());

    expect(notes.map((n) => n.name)).toEqual(['A3', 'B3', 'D4']);
    for (const n of notes) expect(Math.abs(n.cents)).toBeLessThan(5);
    expect(notes[0].end - notes[0].start).toBeGreaterThan(0.3);
  });
});
