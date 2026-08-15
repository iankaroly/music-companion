import { describe, test, expect } from 'vitest';
import { keyFromCount, SHARP_ORDER, FLAT_ORDER } from '../src/analysis/scan-key.js';

describe('key signatures', () => {
  test('no accidentals is C major — nothing altered', () => {
    const k = keyFromCount(0, 'sharp');
    expect(k.alter).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('two sharps raises F and C', () => {
    const k = keyFromCount(2, 'sharp');
    expect(k.sharps).toBe(2);
    expect(k.alter[3]).toBe(1); // F
    expect(k.alter[0]).toBe(1); // C
    expect(k.alter[4]).toBe(0); // G untouched
  });

  test('three flats lowers B, E and A', () => {
    const k = keyFromCount(3, 'flat');
    expect(k.flats).toBe(3);
    expect(k.alter[6]).toBe(-1); // B
    expect(k.alter[2]).toBe(-1); // E
    expect(k.alter[5]).toBe(-1); // A
    expect(k.alter[3]).toBe(0); // F untouched
  });

  test('the orders are the orders an engraver writes them in', () => {
    expect(SHARP_ORDER).toEqual([3, 0, 4, 1, 5, 2, 6]); // F C G D A E B
    expect(FLAT_ORDER).toEqual([6, 2, 5, 1, 4, 0, 3]); // B E A D G C F
  });

  test('seven of either alters every degree', () => {
    expect(keyFromCount(7, 'sharp').alter).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(keyFromCount(7, 'flat').alter).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  test('more than seven is not a key signature', () => {
    expect(keyFromCount(8, 'sharp')).toBeNull();
    expect(keyFromCount(-1, 'flat')).toBeNull();
    expect(keyFromCount(2.5, 'sharp')).toBeNull();
    expect(keyFromCount(2, 'both')).toBeNull();
  });
});
