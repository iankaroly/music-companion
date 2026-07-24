import { describe, test, expect } from 'vitest';
import { Recorder } from '../src/audio/recording.js';
import { buildEmphasizedClip, buildComparisonClip, findComparisonNote } from '../src/audio/clips.js';

function constantRecording(sampleRate, seconds, value) {
  const r = new Recorder(sampleRate);
  r.push(new Float32Array(sampleRate * seconds).fill(value));
  return r;
}

describe('buildEmphasizedClip', () => {
  test('keeps the target at full gain and ducks the context around it', () => {
    const rec = constantRecording(100, 10, 1);
    const clip = buildEmphasizedClip(rec, 4, 6, { contextSec: 2, contextGain: 0.35, rampSec: 0, edgeFadeSec: 0 });
    expect(clip.samples.length).toBe(600); // 2s + 2s + 2s at 100 Hz
    expect(clip.samples[100]).toBeCloseTo(0.35, 5); // t=3s, pre-context
    expect(clip.samples[300]).toBeCloseTo(1, 5);    // t=5s, inside target
    expect(clip.samples[550]).toBeCloseTo(0.35, 5); // t=7.5s, post-context
    expect(clip.targetOffset).toBeCloseTo(2, 5);
  });

  test('clamps the context to the start of the recording', () => {
    const rec = constantRecording(100, 10, 1);
    const clip = buildEmphasizedClip(rec, 0.5, 1, { contextSec: 2, rampSec: 0, edgeFadeSec: 0 });
    expect(clip.samples.length).toBe(300); // 0..3s
    expect(clip.targetOffset).toBeCloseTo(0.5, 5);
  });
});

describe('buildComparisonClip', () => {
  test('lays out reference, silent gap, then target', () => {
    const rec = constantRecording(100, 10, 2);
    const clip = buildComparisonClip(
      rec,
      { start: 1, end: 2 },
      { start: 5, end: 6 },
      { padSec: 0, gapSec: 0.5, edgeFadeSec: 0 },
    );
    expect(clip.samples.length).toBe(250); // 1s ref + 0.5s gap + 1s target
    expect(clip.samples[50]).toBeCloseTo(2, 5);   // inside reference
    expect(clip.samples[125]).toBeCloseTo(0, 5);  // inside gap
    expect(clip.samples[200]).toBeCloseTo(2, 5);  // inside target
  });
});

describe('findComparisonNote', () => {
  const notes = [
    { midi: 57, cents: 2, start: 0 },
    { midi: 57, cents: -15, start: 1 },
    { midi: 55, cents: 0, start: 2 },
    { midi: 57, cents: 20, start: 3 },
  ];

  test('picks the most in-tune other note with the same midi', () => {
    const target = notes[3];
    expect(findComparisonNote(notes, target)).toBe(notes[0]);
  });

  test('returns null when no other note shares the midi', () => {
    expect(findComparisonNote(notes, notes[2])).toBeNull();
  });
});
