import { describe, test, expect } from 'vitest';
import { yin } from '../src/audio/yin.js';

const SR = 44100;
const N = 4096;

function sine(freq, sampleRate = SR, n = N, amp = 0.5) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);
  return buf;
}

// Additive sawtooth: harmonically rich, closest synthetic stand-in for a bowed string.
function sawtooth(freq, sampleRate = SR, n = N, harmonics = 20) {
  const buf = new Float32Array(n);
  for (let h = 1; h <= harmonics; h++) {
    for (let i = 0; i < n; i++) {
      buf[i] += (0.5 / h) * Math.sin(2 * Math.PI * freq * h * i / sampleRate);
    }
  }
  return buf;
}

// Deterministic PRNG so the noise test never flakes.
function seededNoise(seed = 1, n = N) {
  const buf = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    buf[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function centsOff(detected, expected) {
  return Math.abs(1200 * Math.log2(detected / expected));
}

describe('yin', () => {
  test('detects a pure sine at 220 Hz within 2 cents', () => {
    const { frequency, confidence } = yin(sine(220), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 220)).toBeLessThan(2);
    expect(confidence).toBeGreaterThan(0.9);
  });

  test('detects a sine at 440 Hz within 2 cents', () => {
    const { frequency } = yin(sine(440), SR);
    expect(centsOff(frequency, 440)).toBeLessThan(2);
  });

  test('detects cello low C (65.4 Hz) sawtooth within 5 cents without octave error', () => {
    const { frequency } = yin(sawtooth(65.4), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 65.4)).toBeLessThan(5);
  });

  test('does not octave-jump on a harmonically rich 196 Hz sawtooth (open G)', () => {
    const { frequency } = yin(sawtooth(196), SR);
    expect(centsOff(frequency, 196)).toBeLessThan(5);
  });

  test('sub-sample precision: distinguishes 440 Hz from 442 Hz', () => {
    const a = yin(sine(440), SR).frequency;
    const b = yin(sine(442), SR).frequency;
    expect(b).toBeGreaterThan(a);
    expect(centsOff(b, 442)).toBeLessThan(2);
  });

  test('detects piano low A0 (27.5 Hz) within 5 cents', () => {
    const { frequency } = yin(sine(27.5), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 27.5)).toBeLessThan(5);
  });

  test('detects piano high A6 (1760 Hz) within 3 cents', () => {
    const { frequency } = yin(sine(1760), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 1760)).toBeLessThan(3);
  });

  test('detects piano top C8 (4186 Hz) within 10 cents', () => {
    const { frequency } = yin(sine(4186), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 4186)).toBeLessThan(10);
  });

  test('returns null frequency for white noise', () => {
    const { frequency } = yin(seededNoise(), SR);
    expect(frequency).toBeNull();
  });

  test('returns null frequency for silence', () => {
    const { frequency } = yin(new Float32Array(N), SR);
    expect(frequency).toBeNull();
  });

  test('respects minFreq: 30 Hz tone below the floor is not reported', () => {
    const { frequency } = yin(sine(30), SR, { minFreq: 50 });
    if (frequency !== null) expect(frequency).toBeGreaterThanOrEqual(50);
  });
});
