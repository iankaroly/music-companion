import { describe, test, expect } from 'vitest';
import { freqToNote } from '../src/analysis/note-utils.js';

describe('freqToNote', () => {
  test('440 Hz is A4 with 0 cents deviation', () => {
    const n = freqToNote(440);
    expect(n.name).toBe('A4');
    expect(n.midi).toBe(69);
    expect(n.cents).toBeCloseTo(0, 1);
  });

  test('cello open strings map to C2 G2 D3 A3', () => {
    expect(freqToNote(65.406).name).toBe('C2');
    expect(freqToNote(97.999).name).toBe('G2');
    expect(freqToNote(146.832).name).toBe('D3');
    expect(freqToNote(220).name).toBe('A3');
  });

  test('sharp pitch reports positive cents', () => {
    const n = freqToNote(446); // ~23.4 cents above A4
    expect(n.name).toBe('A4');
    expect(n.cents).toBeGreaterThan(20);
    expect(n.cents).toBeLessThan(27);
  });

  test('flat pitch reports negative cents', () => {
    const n = freqToNote(435);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeLessThan(-15);
  });

  test('accidentals render as sharps', () => {
    expect(freqToNote(207.65).name).toBe('G#3');
  });

  test('honors a custom A4 reference: 442 Hz reads as A4 ±0 cents when calibrated to 442', () => {
    const n = freqToNote(442, 442);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeCloseTo(0, 1);
  });

  test('a 440 Hz tone reads ~8 cents flat when calibrated to 442', () => {
    const n = freqToNote(440, 442);
    expect(n.name).toBe('A4');
    expect(n.cents).toBeLessThan(-7);
    expect(n.cents).toBeGreaterThan(-9);
  });

  test('rounds to the nearer note across the boundary', () => {
    // Quarter-tone between A4 and A#4 is ~452.9 Hz; just above it lands on A#4.
    expect(freqToNote(454).name).toBe('A#4');
  });
});
