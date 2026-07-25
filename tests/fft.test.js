import { describe, test, expect } from 'vitest';
import { fftMagnitudes } from '../src/audio/fft.js';

describe('fftMagnitudes', () => {
  test('a pure sine lands its energy in exactly its own bin', () => {
    const n = 1024;
    const bin = 32;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = Math.sin(2 * Math.PI * bin * i / n);
    const mags = fftMagnitudes(samples);
    expect(mags.length).toBe(n / 2);
    expect(mags[bin]).toBeCloseTo(1, 3);
    expect(mags[bin - 4]).toBeLessThan(0.01);
    expect(mags[bin + 4]).toBeLessThan(0.01);
  });

  test('two tones show two peaks with the right relative heights', () => {
    const n = 1024;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      samples[i] = Math.sin(2 * Math.PI * 20 * i / n) + 0.5 * Math.sin(2 * Math.PI * 100 * i / n);
    }
    const mags = fftMagnitudes(samples);
    expect(mags[20]).toBeCloseTo(1, 2);
    expect(mags[100]).toBeCloseTo(0.5, 2);
  });

  test('silence produces silence', () => {
    const mags = fftMagnitudes(new Float32Array(512));
    expect(Math.max(...mags)).toBe(0);
  });
});
