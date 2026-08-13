import { describe, test, expect, afterEach } from 'vitest';
import { intonationHue, intonationTone, setIntonationTolerance } from '../src/ui/chart-utils.js';

afterEach(() => setIntonationTolerance(8));

describe('intonationTone', () => {
  test('a centred note has a tier and no direction to act on', () => {
    expect(intonationTone(0)).toEqual({ tier: 'good', direction: 'centred' });
    expect(intonationTone(4)).toEqual({ tier: 'good', direction: 'centred' });
    expect(intonationTone(-4)).toEqual({ tier: 'good', direction: 'centred' });
  });

  test('sharp and flat are told apart once the note is out of tune', () => {
    expect(intonationTone(15)).toEqual({ tier: 'off', direction: 'sharp' });
    expect(intonationTone(-15)).toEqual({ tier: 'off', direction: 'flat' });
    expect(intonationTone(40)).toEqual({ tier: 'bad', direction: 'sharp' });
    expect(intonationTone(-40)).toEqual({ tier: 'bad', direction: 'flat' });
  });

  test('the tier matches the one the graph and the tiles already use', () => {
    setIntonationTolerance(12);
    expect(intonationTone(10).tier).toBe('good');
    expect(intonationTone(-10).direction).toBe('centred');
    setIntonationTolerance(5);
    expect(intonationTone(10).tier).toBe('off');
    expect(intonationTone(-10).direction).toBe('flat');
  });

  test('a note with no reading has nothing to say either way', () => {
    expect(intonationTone(null)).toEqual({ tier: 'none', direction: 'none' });
    expect(intonationTone(undefined)).toEqual({ tier: 'none', direction: 'none' });
    expect(intonationTone(NaN)).toEqual({ tier: 'none', direction: 'none' });
  });
});

describe('intonationHue', () => {
  test('one colour for every sharp note and one for every flat one', () => {
    expect(intonationHue(9)).toBe('sharp');
    expect(intonationHue(40)).toBe('sharp');
    expect(intonationHue(400)).toBe('sharp');
    expect(intonationHue(-9)).toBe('flat');
    expect(intonationHue(-40)).toBe('flat');
    expect(intonationHue(-400)).toBe('flat');
  });

  test('inside the tolerance there is no direction to show', () => {
    expect(intonationHue(0)).toBe('good');
    expect(intonationHue(7.9)).toBe('good');
    expect(intonationHue(-7.9)).toBe('good');
  });

  test('the in-tune door is the same setting the rest of the app uses', () => {
    setIntonationTolerance(12);
    expect(intonationHue(10)).toBe('good');
    setIntonationTolerance(5);
    expect(intonationHue(10)).toBe('sharp');
    expect(intonationHue(-10)).toBe('flat');
  });

  test('a note with no reading gets no colour', () => {
    expect(intonationHue(null)).toBe('none');
    expect(intonationHue(NaN)).toBe('none');
  });
});
