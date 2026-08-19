// WHEN A NOTE STARTED — the sound, not the moment its pitch became certain.
//
// A player asked whether a fast piece can stay in step with the score. The
// playback half is arithmetic and is held elsewhere; this is the recording
// half. A note used to open on the first frame whose pitch the segmenter
// believed, which is a window and a hop or two after the sound began: measured
// on synthesised scales, every note came back 16-31ms late. At semiquavers at
// 180 that is a quarter of a note.
import { describe, it, expect } from 'vitest';
import { Analyzer } from '../src/audio/analyzer.js';
import { NoteSegmenter } from '../src/analysis/notes.js';

const SR = 44100;

// Notes at known times, as audio. `gap` leaves silence between them so each has
// an attack to find; without one they are slurred and deliberately have none.
function play(notes, { gap = 0.06 } = {}) {
  const last = notes.at(-1);
  const samples = new Float32Array(Math.ceil((last.at + last.hold + 0.5) * SR));
  for (const note of notes) {
    const hz = 440 * 2 ** ((note.midi - 69) / 12);
    const from = Math.round(note.at * SR);
    const len = Math.round((note.hold - (gap ? gap : 0)) * SR);
    for (let k = 0; k < len; k++) {
      const env = Math.min(1, k / (SR * 0.004)) * Math.min(1, (len - k) / (SR * 0.01));
      samples[from + k] += 0.5 * env * Math.sin(2 * Math.PI * hz * (k / SR));
    }
  }
  return samples;
}

function heard(samples) {
  const analyzer = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
  const segmenter = new NoteSegmenter();
  const out = [];
  for (let at = 0; at < samples.length; at += 1024) {
    for (const reading of analyzer.push(samples.subarray(at, Math.min(samples.length, at + 1024)))) {
      for (const note of segmenter.push(reading)) out.push(note);
    }
  }
  for (const note of segmenter.flush()) out.push(note);
  return out;
}

describe('when a note is reported to have started', () => {
  it('is when the sound started, within a few milliseconds', () => {
    const played = [
      { midi: 69, at: 0.5, hold: 0.4 },
      { midi: 71, at: 0.9, hold: 0.4 },
      { midi: 72, at: 1.3, hold: 0.4 },
    ];
    const notes = heard(play(played));
    expect(notes.length).toBeGreaterThanOrEqual(3);
    for (const [i, want] of played.entries()) {
      expect(Math.abs(notes[i].start - want.at)).toBeLessThan(0.02);
    }
  });

  it('never reaches back behind the note before it', () => {
    const played = Array.from({ length: 8 }, (_, i) => ({
      midi: 67 + (i % 4) * 2, at: 0.4 + i * 0.12, hold: 0.12,
    }));
    const notes = heard(play(played, { gap: 0.02 }));
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].start).toBeGreaterThanOrEqual(notes[i - 1].end - 1e-9);
    }
  });

  it('does not invent an attack for a note that has none', () => {
    // One unbroken sound that changes pitch halfway: the second note is slurred
    // out of the first and has no attack of its own, so it keeps the time it
    // was heard at rather than being moved somewhere it never began.
    const samples = new Float32Array(Math.round(2 * SR));
    for (let k = 0; k < samples.length; k++) {
      const t = k / SR;
      const midi = t < 1 ? 69 : 73;
      const hz = 440 * 2 ** ((midi - 69) / 12);
      samples[k] = 0.5 * Math.sin(2 * Math.PI * hz * t) * Math.min(1, k / (SR * 0.004));
    }
    const notes = heard(samples);
    expect(notes.length).toBeGreaterThanOrEqual(2);
    // Somewhere around the change, and not before the sound existed.
    expect(notes[1].start).toBeGreaterThan(0.9);
    expect(notes[1].start).toBeLessThan(1.15);
  });
});
