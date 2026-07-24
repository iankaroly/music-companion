import { describe, test, expect } from 'vitest';
import { timeStretch } from '../src/audio/stretch.js';
import { yin } from '../src/audio/yin.js';

const SR = 44100;

function saw(freq, seconds) {
  const n = Math.floor(seconds * SR);
  const buf = new Float32Array(n);
  for (let h = 1; h <= 12; h++) {
    for (let i = 0; i < n; i++) {
      buf[i] += (0.4 / h) * Math.sin(2 * Math.PI * freq * h * i / SR);
    }
  }
  return buf;
}

function centsOff(a, b) {
  return Math.abs(1200 * Math.log2(a / b));
}

describe('timeStretch', () => {
  test('half speed doubles the duration but keeps the pitch at 220 Hz', () => {
    const input = saw(220, 1);
    const out = timeStretch(input, SR, 0.5);
    expect(out.length / input.length).toBeGreaterThan(1.85);
    expect(out.length / input.length).toBeLessThan(2.15);

    const mid = Math.floor(out.length / 2);
    const { frequency } = yin(out.subarray(mid, mid + 4096), SR);
    expect(frequency).not.toBeNull();
    expect(centsOff(frequency, 220)).toBeLessThan(15);
  });

  test('three-quarter speed keeps a low cello pitch intact', () => {
    const input = saw(98, 1);
    const out = timeStretch(input, SR, 0.75);
    expect(out.length / input.length).toBeGreaterThan(1.25);
    expect(out.length / input.length).toBeLessThan(1.45);

    const mid = Math.floor(out.length / 2);
    const { frequency } = yin(out.subarray(mid, mid + 4096), SR);
    expect(centsOff(frequency, 98)).toBeLessThan(15);
  });

  test('speed 1 returns the input unchanged', () => {
    const input = saw(220, 0.2);
    const out = timeStretch(input, SR, 1);
    expect(out.length).toBe(input.length);
    expect(out[500]).toBeCloseTo(input[500], 6);
  });

  test('stretched audio has comparable loudness, not doubled-up energy', () => {
    const input = saw(220, 1);
    const out = timeStretch(input, SR, 0.5);
    const rms = (b) => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length);
    const mid = Math.floor(out.length / 2);
    const ratio = rms(out.subarray(mid, mid + 8192)) / rms(input.subarray(8192, 16384));
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.4);
  });
});
