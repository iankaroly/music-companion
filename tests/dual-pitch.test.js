import { describe, test, expect } from 'vitest';
import { detectTwoPitches } from '../src/audio/dual-pitch.js';

const SR = 44100;
const N = 4096;

function addSaw(buf, freq, amp, harmonics = 12) {
  for (let h = 1; h <= harmonics; h++) {
    for (let i = 0; i < buf.length; i++) {
      buf[i] += (amp / h) * Math.sin(2 * Math.PI * freq * h * i / SR);
    }
  }
  return buf;
}

function centsOff(a, b) {
  return Math.abs(1200 * Math.log2(a / b));
}

function bothFreqs(result) {
  return [result.primary?.frequency, result.secondary?.frequency].filter(Boolean);
}

describe('detectTwoPitches', () => {
  test('hears both notes of a perfect fifth (D3 + A3)', () => {
    const buf = addSaw(addSaw(new Float32Array(N), 146.83, 0.4), 220, 0.35);
    const freqs = bothFreqs(detectTwoPitches(buf, SR));
    expect(freqs.length).toBe(2);
    const [low, high] = freqs.sort((a, b) => a - b);
    expect(centsOff(low, 146.83)).toBeLessThan(15);
    expect(centsOff(high, 220)).toBeLessThan(15);
  });

  test('hears both notes of a major third (C3 + E3)', () => {
    const buf = addSaw(addSaw(new Float32Array(N), 130.81, 0.4), 164.81, 0.35);
    const freqs = bothFreqs(detectTwoPitches(buf, SR));
    expect(freqs.length).toBe(2);
    const [low, high] = freqs.sort((a, b) => a - b);
    expect(centsOff(low, 130.81)).toBeLessThan(15);
    expect(centsOff(high, 164.81)).toBeLessThan(15);
  });

  test('hears both notes of a minor sixth (E3 + C4)', () => {
    const buf = addSaw(addSaw(new Float32Array(N), 164.81, 0.4), 261.63, 0.35);
    const freqs = bothFreqs(detectTwoPitches(buf, SR));
    expect(freqs.length).toBe(2);
  });

  test('a single note reports no secondary', () => {
    const buf = addSaw(new Float32Array(N), 220, 0.5);
    const result = detectTwoPitches(buf, SR);
    expect(centsOff(result.primary.frequency, 220)).toBeLessThan(5);
    expect(result.secondary).toBeNull();
  });

  test('an octave reports no secondary (shared harmonics — documented limit)', () => {
    const buf = addSaw(addSaw(new Float32Array(N), 130.81, 0.4), 261.63, 0.35);
    const result = detectTwoPitches(buf, SR);
    expect(result.secondary).toBeNull();
  });

  test('silence reports nothing', () => {
    const result = detectTwoPitches(new Float32Array(N), SR);
    expect(result.primary.frequency).toBeNull();
    expect(result.secondary).toBeNull();
  });
});
