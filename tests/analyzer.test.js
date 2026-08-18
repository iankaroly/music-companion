import { describe, test, expect } from 'vitest';
import { Analyzer } from '../src/audio/analyzer.js';

const SR = 44100;

function sineChunks(freq, totalSamples, chunkSize = 128) {
  const chunks = [];
  for (let start = 0; start < totalSamples; start += chunkSize) {
    const n = Math.min(chunkSize, totalSamples - start);
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = 0.5 * Math.sin(2 * Math.PI * freq * (start + i) / SR);
    chunks.push(buf);
  }
  return chunks;
}

describe('Analyzer', () => {
  test('emits one reading per hop once the window has filled', () => {
    const a = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
    const readings = [];
    for (const c of sineChunks(220, 8192)) readings.push(...a.push(c));
    // 8192 samples = 8 hops, minus the 3 hops before the first full window.
    expect(readings.length).toBe(5);
  });

  test('readings on a 220 Hz sine report ~220 Hz with timestamps in seconds', () => {
    const a = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
    const readings = [];
    for (const c of sineChunks(220, 8192)) readings.push(...a.push(c));
    const last = readings.at(-1);
    expect(Math.abs(1200 * Math.log2(last.frequency / 220))).toBeLessThan(2);
    // The MIDDLE of the window it was measured over, not the end of it: a
    // reading is an average across 4096 samples and stamping it with the last
    // of them put every onset half a window late — see analyze() in
    // src/audio/analyzer.js.
    expect(last.time).toBeCloseTo((8192 - 4096 / 2) / SR, 3);
  });

  test('dual mode reports both notes of a double stop in each reading', () => {
    const a = new Analyzer(SR, { windowSize: 4096, hopSize: 1024, dual: true });
    const readings = [];
    const total = 8192;
    for (let start = 0; start < total; start += 128) {
      const buf = new Float32Array(128);
      for (let h = 1; h <= 12; h++) {
        for (let i = 0; i < 128; i++) {
          const t = (start + i) / SR;
          buf[i] += (0.4 / h) * Math.sin(2 * Math.PI * 146.83 * h * t)
                  + (0.35 / h) * Math.sin(2 * Math.PI * 220 * h * t);
        }
      }
      readings.push(...a.push(buf));
    }
    const last = readings.at(-1);
    const freqs = [last.frequency, last.secondary?.frequency].filter(Boolean).sort((x, y) => x - y);
    expect(freqs.length).toBe(2);
    expect(Math.abs(1200 * Math.log2(freqs[0] / 146.83))).toBeLessThan(15);
    expect(Math.abs(1200 * Math.log2(freqs[1] / 220))).toBeLessThan(15);
  });

  test('mono mode readings have no secondary field set', () => {
    const a = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
    const readings = [];
    for (const c of sineChunks(220, 8192)) readings.push(...a.push(c));
    expect(readings.at(-1).secondary).toBeNull();
  });

  test('silence produces readings with null frequency and near-zero rms', () => {
    const a = new Analyzer(SR, { windowSize: 4096, hopSize: 1024 });
    const readings = [];
    for (let i = 0; i < 64; i++) readings.push(...a.push(new Float32Array(128)));
    expect(readings.length).toBeGreaterThan(0);
    expect(readings.at(-1).frequency).toBeNull();
    expect(readings.at(-1).rms).toBeLessThan(0.001);
  });
});
