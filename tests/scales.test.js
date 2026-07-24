import { describe, test, expect } from 'vitest';
import { nameToMidi } from '../src/analysis/note-utils.js';
import { buildScale } from '../src/analysis/scales.js';

describe('nameToMidi', () => {
  test('parses natural notes', () => {
    expect(nameToMidi('C4')).toBe(60);
    expect(nameToMidi('A4')).toBe(69);
    expect(nameToMidi('D3')).toBe(50);
  });

  test('parses sharps and flats', () => {
    expect(nameToMidi('F#2')).toBe(42);
    expect(nameToMidi('Bb3')).toBe(58);
    expect(nameToMidi('C#4')).toBe(61);
  });

  test('round-trips with midiToName for naturals and sharps', () => {
    expect(nameToMidi('G#3')).toBe(56);
  });
});

describe('buildScale', () => {
  test('one-octave D major ascends and descends without repeating the top', () => {
    const midis = buildScale({ tonic: 'D3', type: 'major', octaves: 1 });
    expect(midis).toEqual([50, 52, 54, 55, 57, 59, 61, 62, 61, 59, 57, 55, 54, 52, 50]);
  });

  test('two octaves has 29 notes and peaks at the double octave', () => {
    const midis = buildScale({ tonic: 'C2', type: 'major', octaves: 2 });
    expect(midis.length).toBe(29);
    expect(Math.max(...midis)).toBe(nameToMidi('C4'));
    expect(midis[0]).toBe(36);
    expect(midis.at(-1)).toBe(36);
  });

  test('melodic minor raises 6 and 7 ascending but descends natural', () => {
    const midis = buildScale({ tonic: 'A3', type: 'melodic-minor', octaves: 1 });
    expect(midis.slice(0, 8)).toEqual([57, 59, 60, 62, 64, 66, 68, 69]); // F#, G# up
    expect(midis.slice(8)).toEqual([67, 65, 64, 62, 60, 59, 57]);        // G♮, F♮ down
  });

  test('harmonic minor keeps the raised 7th in both directions', () => {
    const midis = buildScale({ tonic: 'A3', type: 'harmonic-minor', octaves: 1 });
    expect(midis.slice(0, 8)).toEqual([57, 59, 60, 62, 64, 65, 68, 69]);
    expect(midis.slice(8)).toEqual([68, 65, 64, 62, 60, 59, 57]);
  });
});
