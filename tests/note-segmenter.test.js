import { describe, test, expect } from 'vitest';
import { NoteSegmenter } from '../src/analysis/notes.js';

const HOP = 1024 / 44100; // ~23ms per reading, matching the Analyzer

function midiToFreq(midiFloat) {
  return 440 * 2 ** ((midiFloat - 69) / 12);
}

function voiced(midiFloat, time) {
  return { frequency: midiToFreq(midiFloat), confidence: 0.95, rms: 0.05, time };
}

function silent(time) {
  return { frequency: null, confidence: 0.1, rms: 0.0001, time };
}

// Push a sequence of frames, collect every completed note.
function run(segmenter, frames) {
  const notes = [];
  for (const f of frames) notes.push(...segmenter.push(f));
  notes.push(...segmenter.flush());
  return notes;
}

const A3 = 57;
const B3 = 59;

describe('NoteSegmenter', () => {
  test('a sustained pitch followed by silence yields one note with correct name and timing', () => {
    const frames = [];
    for (let i = 0; i < 20; i++) frames.push(voiced(A3, i * HOP));
    for (let i = 20; i < 25; i++) frames.push(silent(i * HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.length).toBe(1);
    expect(notes[0].name).toBe('A3');
    expect(notes[0].start).toBeCloseTo(0, 2);
    expect(notes[0].end).toBeGreaterThan(19 * HOP - 0.001);
    expect(Math.abs(notes[0].cents)).toBeLessThan(3);
  });

  test('two different pitches split into two notes at the boundary', () => {
    const frames = [];
    for (let i = 0; i < 15; i++) frames.push(voiced(A3, i * HOP));
    for (let i = 15; i < 30; i++) frames.push(voiced(B3, i * HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.map((n) => n.name)).toEqual(['A3', 'B3']);
    expect(notes[1].start).toBeCloseTo(15 * HOP, 1);
  });

  test('vibrato of ±30 cents stays one note with median-centered pitch', () => {
    const frames = [];
    for (let i = 0; i < 30; i++) {
      frames.push(voiced(A3 + 0.3 * Math.sin(i * 0.9), i * HOP));
    }
    const notes = run(new NoteSegmenter(), frames);
    expect(notes.length).toBe(1);
    expect(notes[0].name).toBe('A3');
    expect(Math.abs(notes[0].cents)).toBeLessThan(10);
  });

  test('a single glitch frame does not split the note', () => {
    const frames = [];
    for (let i = 0; i < 10; i++) frames.push(voiced(A3, i * HOP));
    frames.push(voiced(A3 + 12, 10 * HOP)); // one octave-error frame
    for (let i = 11; i < 21; i++) frames.push(voiced(A3, i * HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.length).toBe(1);
    expect(notes[0].name).toBe('A3');
  });

  test('a blip shorter than the minimum duration is dropped', () => {
    const frames = [silent(0), voiced(64, HOP), voiced(64, 2 * HOP), silent(3 * HOP), silent(4 * HOP)];
    const notes = run(new NoteSegmenter(), frames);
    expect(notes.length).toBe(0);
  });

  test('a fast run of ~80ms notes registers every note', () => {
    // Three notes of 4 frames each (~93ms at the 23ms hop) — a fast
    // sixteenth-note passage. All three must survive.
    const frames = [];
    let t = 0;
    for (const midi of [57, 59, 61]) {
      for (let i = 0; i < 4; i++) frames.push(voiced(midi, t++ * HOP));
    }
    for (let i = 0; i < 3; i++) frames.push(silent(t++ * HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.map((n) => n.name)).toEqual(['A3', 'B3', 'C#4']);
  });

  test('a super-fast run of ~60ms notes registers at a fine analysis hop', () => {
    // 5 frames per note at an 11.6ms hop ≈ 58ms notes — fast semiquavers.
    const FINE_HOP = 512 / 44100;
    const frames = [];
    let t = 0;
    for (const midi of [57, 59, 61, 62]) {
      for (let i = 0; i < 5; i++) frames.push(voiced(midi, t++ * FINE_HOP));
    }
    for (let i = 0; i < 4; i++) frames.push(silent(t++ * FINE_HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.map((n) => n.name)).toEqual(['A3', 'B3', 'C#4', 'D4']);
  });

  test('honors a custom A4 reference: 221 Hz reads as an in-tune A3 at a4=442', () => {
    const frames = [];
    for (let i = 0; i < 15; i++) {
      frames.push({ frequency: 221, confidence: 0.95, rms: 0.05, time: i * HOP });
    }
    for (let i = 15; i < 18; i++) frames.push(silent(i * HOP));

    const notes = run(new NoteSegmenter({ a4: 442 }), frames);
    expect(notes.length).toBe(1);
    expect(notes[0].name).toBe('A3');
    expect(Math.abs(notes[0].cents)).toBeLessThan(2);
  });

  test('low-confidence frames act as silence and split re-articulated notes', () => {
    const frames = [];
    for (let i = 0; i < 10; i++) frames.push(voiced(A3, i * HOP));
    for (let i = 10; i < 14; i++) frames.push({ frequency: midiToFreq(A3), confidence: 0.2, rms: 0.05, time: i * HOP });
    for (let i = 14; i < 24; i++) frames.push(voiced(A3, i * HOP));

    const notes = run(new NoteSegmenter(), frames);
    expect(notes.map((n) => n.name)).toEqual(['A3', 'A3']);
  });
});
