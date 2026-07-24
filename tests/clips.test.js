import { describe, test, expect } from 'vitest';
import { Recorder } from '../src/audio/recording.js';
import { buildEmphasizedClip, buildComparisonClip, buildLoopClip, findComparisonNote } from '../src/audio/clips.js';

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

describe('buildLoopClip', () => {
  test('uses the stable middle of the note and stays constant for constant input', () => {
    const rec = constantRecording(100, 10, 1);
    const clip = buildLoopClip(rec, { start: 2, end: 6 }, { trimFraction: 0.25, crossfadeSec: 0.1 });
    // 4s note, 25% trimmed each side → 2s kept, minus 0.1s crossfade tail
    expect(clip.samples.length).toBe(190);
    for (const v of clip.samples) expect(v).toBeCloseTo(1, 5);
  });

  test('crossfades the tail into the head so the loop point is seamless', () => {
    const sr = 100;
    const rec = new Recorder(sr);
    const ramp = Float32Array.from({ length: 1000 }, (_, i) => i / 1000);
    rec.push(ramp);
    const clip = buildLoopClip(rec, { start: 0, end: 10 }, { trimFraction: 0, crossfadeSec: 0.1 });
    // At the loop start the head is fully replaced by the tail's first sample.
    expect(clip.samples[0]).toBeCloseTo(ramp[1000 - 10], 3);
    // Well past the crossfade, samples are untouched.
    expect(clip.samples[500]).toBeCloseTo(ramp[500], 5);
  });

  test('short notes are used whole rather than trimmed to nothing', () => {
    const rec = constantRecording(100, 10, 1);
    const clip = buildLoopClip(rec, { start: 1, end: 1.1 }, { trimFraction: 0.25, crossfadeSec: 0.05 });
    expect(clip.samples.length).toBeGreaterThan(4);
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
