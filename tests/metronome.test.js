import { describe, test, expect } from 'vitest';
import { subdivisionOffsets, tempoName } from '../src/audio/metronome.js';

describe('subdivisionOffsets', () => {
  test('quarter has no sub-clicks', () => {
    expect(subdivisionOffsets('quarter')).toEqual([]);
  });

  test('eighths click halfway through the beat', () => {
    expect(subdivisionOffsets('eighth')).toEqual([0.5]);
  });

  test('triplets click at thirds', () => {
    const [a, b] = subdivisionOffsets('triplet');
    expect(a).toBeCloseTo(1 / 3, 5);
    expect(b).toBeCloseTo(2 / 3, 5);
  });

  test('sixteenths click at quarters of the beat', () => {
    expect(subdivisionOffsets('sixteenth')).toEqual([0.25, 0.5, 0.75]);
  });

  test('shuffle swings the off-beat to the last third', () => {
    const [a] = subdivisionOffsets('shuffle');
    expect(a).toBeCloseTo(2 / 3, 5);
  });
});

describe('tempoName', () => {
  test('names the classic ranges', () => {
    expect(tempoName(40)).toBe('Grave');
    expect(tempoName(80)).toBe('Andante');
    expect(tempoName(140)).toBe('Allegro');
    expect(tempoName(240)).toBe('Prestissimo');
  });
});
