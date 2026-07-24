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
  test('a fast run then a double stop: all notes register, chord voice included', () => {
    const samples = [];
    let cursor = 0;
    // four fast notes (~120ms each), then a held fifth (D3+A3)
    for (const f of [220, 246.94, 277.18, 293.66]) {
      cursor += tone(f, 0.12, samples, cursor);
    }
    const start = samples.length;
    for (let i = 0; i < Math.floor(0.8 * SR); i++) {
      const t = (start + i) / SR;
      let v = 0;
      for (let h = 1; h <= 12; h++) {
        v += (0.4 / h) * Math.sin(2 * Math.PI * 146.83 * h * t)
           + (0.35 / h) * Math.sin(2 * Math.PI * 220 * h * t);
      }
      samples.push(v * 0.5);
    }
    silence(0.2, samples);
    const audio = Float32Array.from(samples);

    const analyzer = new Analyzer(SR, { dual: true });
    const primary = new NoteSegmenter();
    const chordSeg = new NoteSegmenter({ minDuration: 0.12 });
    const notes = [];
    const chordNotes = [];
    for (let i = 0; i < audio.length; i += 128) {
      for (const r of analyzer.push(audio.subarray(i, i + 128))) {
        notes.push(...primary.push(r));
        chordNotes.push(...chordSeg.push({
          frequency: r.secondary?.frequency ?? null,
          confidence: r.secondary?.confidence ?? 0,
          rms: r.rms,
          time: r.time,
        }));
      }
    }
    notes.push(...primary.flush());
    chordNotes.push(...chordSeg.flush());

    const names = notes.map((n) => n.name);
    for (const expected of ['A3', 'B3', 'C#4', 'D4']) {
      expect(names).toContain(expected);
    }
    expect(names).toContain('D3'); // lower voice of the fifth
    expect(chordNotes.map((n) => n.name)).toContain('A3'); // upper voice as chord note
  });

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
