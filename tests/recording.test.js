import { describe, test, expect } from 'vitest';
import { Recorder } from '../src/audio/recording.js';

describe('Recorder', () => {
  test('tracks duration from pushed chunks', () => {
    const r = new Recorder(100);
    r.push(new Float32Array(50));
    expect(r.duration).toBeCloseTo(0.5, 5);
  });

  test('extracts a time range spanning chunk boundaries', () => {
    const r = new Recorder(10);
    r.push(Float32Array.from({ length: 10 }, (_, i) => i));
    r.push(Float32Array.from({ length: 10 }, (_, i) => i + 10));
    const seg = r.extract(0.5, 1.5);
    expect(Array.from(seg)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  test('clamps out-of-range times to the recording bounds', () => {
    const r = new Recorder(10);
    r.push(Float32Array.from({ length: 10 }, (_, i) => i));
    const seg = r.extract(-5, 99);
    expect(seg.length).toBe(10);
    expect(seg[0]).toBe(0);
    expect(seg[9]).toBe(9);
  });

  test('an empty recorder extracts an empty segment', () => {
    const r = new Recorder(44100);
    expect(r.extract(0, 1).length).toBe(0);
  });

  test('stores copies, not references to pushed chunks', () => {
    const r = new Recorder(10);
    const chunk = Float32Array.from([1, 2, 3]);
    r.push(chunk);
    chunk[0] = 99;
    expect(r.extract(0, 0.3)[0]).toBe(1);
  });
});
