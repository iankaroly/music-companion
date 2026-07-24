import { describe, test, expect } from 'vitest';
import { PitchCenterTracker } from '../src/analysis/vibrato.js';

const HOP = 1024 / 44100; // ~23ms
const A3 = 57;

function run(tracker, values) {
  let out = null;
  values.forEach((midiFloat, i) => { out = tracker.push({ midiFloat, time: i * HOP }); });
  return out;
}

describe('PitchCenterTracker', () => {
  test('a steady pitch reports its center with no vibrato', () => {
    const r = run(new PitchCenterTracker(), Array(30).fill(A3 + 0.02));
    expect(r.centerMidiFloat).toBeCloseTo(A3 + 0.02, 2);
    expect(r.vibrato).toBeNull();
  });

  test('6 Hz ±30-cent vibrato reports the center pitch and vibrato stats', () => {
    const values = [];
    for (let i = 0; i < 40; i++) {
      values.push(A3 + 0.3 * Math.sin(2 * Math.PI * 6 * i * HOP));
    }
    const r = run(new PitchCenterTracker(), values);
    expect(Math.abs(r.centerMidiFloat - A3)).toBeLessThan(0.08); // center within 8 cents
    expect(r.vibrato).not.toBeNull();
    expect(r.vibrato.widthCents).toBeGreaterThan(18);
    expect(r.vibrato.widthCents).toBeLessThan(40);
    expect(r.vibrato.rateHz).toBeGreaterThan(4);
    expect(r.vibrato.rateHz).toBeLessThan(8);
  });

  test('a note change resets immediately instead of averaging across notes', () => {
    const tracker = new PitchCenterTracker();
    run(tracker, Array(20).fill(A3));
    const r = run(tracker, Array(3).fill(A3 + 2)); // jump to B3
    expect(r.centerMidiFloat).toBeCloseTo(A3 + 2, 2);
  });

  test('a slow one-way drift is not called vibrato', () => {
    const values = [];
    for (let i = 0; i < 40; i++) values.push(A3 + (0.4 * i) / 40);
    const r = run(new PitchCenterTracker(), values);
    expect(r.vibrato).toBeNull();
  });

  test('reset() clears state between notes', () => {
    const tracker = new PitchCenterTracker();
    run(tracker, Array(20).fill(A3));
    tracker.reset();
    const r = tracker.push({ midiFloat: A3 + 1, time: 99 });
    expect(r.centerMidiFloat).toBeCloseTo(A3 + 1, 5);
  });
});
