import { describe, test, expect, afterEach } from 'vitest';
import { intonationTone, setIntonationTolerance } from '../src/ui/chart-utils.js';

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
