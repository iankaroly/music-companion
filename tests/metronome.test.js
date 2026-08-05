import { describe, test, expect } from 'vitest';
import { subdivisionOffsets, tempoName, clickVoice } from '../src/audio/metronome.js';
import { CLICK_PITCH_MIN, CLICK_PITCH_MAX } from '../src/audio/context.js';

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

describe('click pitch', () => {
  test('unshifted, the click keeps the pitches it already had', () => {
    expect(clickVoice('accent', 0).freq).toBeCloseTo(880, 2);
    expect(clickVoice('beat', 0).freq).toBeCloseTo(587.33, 2);
    expect(clickVoice('sub', 0).freq).toBeCloseTo(440, 2);
  });

  test('an octave up doubles every voice', () => {
    for (const kind of ['accent', 'beat', 'sub']) {
      expect(clickVoice(kind, 12).freq).toBeCloseTo(clickVoice(kind, 0).freq * 2, 4);
    }
  });

  test('the three voices keep their intervals at any shift', () => {
    // accent a fifth over the beat, beat a fifth over the sub — the shape of
    // the click is what makes a downbeat read as a downbeat, so moving the
    // whole thing must not rearrange it.
    for (const semis of [CLICK_PITCH_MIN, -3, 0, 5, CLICK_PITCH_MAX]) {
      const ratio = (a, b) => clickVoice(a, semis).freq / clickVoice(b, semis).freq;
      expect(ratio('accent', 'beat')).toBeCloseTo(880 / 587.33, 6);
      expect(ratio('beat', 'sub')).toBeCloseTo(587.33 / 440, 6);
    }
  });

  test('the loudness balance does not move with the pitch', () => {
    // levels are what separate a downbeat from a subdivision; only pitch shifts
    for (const semis of [CLICK_PITCH_MIN, 0, CLICK_PITCH_MAX]) {
      expect(clickVoice('accent', semis).base).toBe(2.5);
      expect(clickVoice('beat', semis).base).toBe(1.9);
      expect(clickVoice('sub', semis).base).toBe(0.95);
    }
  });

  test('the lowest voice never drops into the register being played', () => {
    // The pitches came down an octave once because a shrill click was tiring;
    // dropping them far enough loses the click in the playing instead, which
    // is why the floor is not the mirror of the ceiling. 330 Hz is the line.
    expect(clickVoice('sub', CLICK_PITCH_MIN).freq).toBeGreaterThan(320);
    expect(CLICK_PITCH_MIN).toBeGreaterThan(-12);
  });

  test('an unknown kind is a sub-click rather than a throw', () => {
    expect(clickVoice('nonsense', 0).freq).toBeCloseTo(440, 2);
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
