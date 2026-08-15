import { describe, it, expect } from 'vitest';
import { validateValues, beatsFor } from '../src/analysis/scan-values.js';

const bar = (...values) => values;
const semiquavers = () => Array.from({ length: 16 }, () => 0.25);
const page = (n, make) => Array.from({ length: n }, (_, i) => make(i));

describe('deciding whether read note values can be believed', () => {
  it('says nothing from one or two bars', () => {
    expect(validateValues([semiquavers(), semiquavers()]).ok).toBe(false);
  });

  it('accepts a page of semiquavers in four four', () => {
    const found = validateValues(page(20, semiquavers));
    expect(found.ok).toBe(true);
    expect(found.beatsPerBar).toBe(4);
    expect(found.trusted.size).toBe(20);
  });

  it('accepts a mixed page that still adds up', () => {
    const found = validateValues(page(12, (i) => (i % 2
      ? bar(1, 0.5, 0.5, 1, 1)
      : bar(2, 1, 0.5, 0.25, 0.25))));
    expect(found.ok).toBe(true);
    expect(found.beatsPerBar).toBe(4);
  });

  it('accepts three four', () => {
    const found = validateValues(page(10, () => bar(1, 1, 1)));
    expect(found.ok).toBe(true);
    expect(found.beatsPerBar).toBe(3);
  });

  // The failure this file exists for. A classifier that reads every value as
  // twice its length agrees with itself perfectly, bar after bar.
  it('REFUSES a page where every value came out twice as long', () => {
    const found = validateValues(page(20, () => Array.from({ length: 16 }, () => 0.5)));
    expect(found.ok).toBe(false);
    expect(found.beatsPerBar).toBe(8);
    expect(found.why).toMatch(/not a bar|wrong together/);
  });

  it('refuses when the bars simply disagree', () => {
    const found = validateValues(page(12, (i) => Array.from({ length: 3 + (i % 5) }, () => 1)));
    expect(found.ok).toBe(false);
    expect(found.why).toMatch(/do not agree/);
  });

  // Rests and missed noteheads look identical from here, and both are common.
  it('trusts the bars that add up and refuses the ones that do not, one at a time', () => {
    const bars = page(20, semiquavers);
    bars[4] = Array.from({ length: 12 }, () => 0.25);   // a crotchet rest, or a missed note
    bars[11] = Array.from({ length: 14 }, () => 0.25);
    const found = validateValues(bars);
    expect(found.ok).toBe(true);
    expect(found.beatsPerBar).toBe(4);
    expect(found.trusted.has(4)).toBe(false);
    expect(found.trusted.has(11)).toBe(false);
    expect(found.trusted.has(5)).toBe(true);
    expect(found.trusted.size).toBe(18);
  });

  it('still refuses everything when too much of the page is short', () => {
    const bars = page(20, (i) => (i % 2 ? semiquavers() : Array.from({ length: 9 }, () => 0.25)));
    const found = validateValues(bars);
    expect(found.ok).toBe(false);
  });

  it('is not fooled by a tuplet bar among honest ones', () => {
    const bars = page(20, semiquavers);
    bars[7] = Array.from({ length: 12 }, () => 1 / 3);   // triplets: 4 beats, but not in sixteenths
    const found = validateValues(bars);
    expect(found.ok).toBe(true);
    // The triplet bar rounds to four beats and is allowed — which is right,
    // because it IS four beats. What matters is that the honest bars survive.
    expect(found.trusted.size).toBeGreaterThanOrEqual(19);
  });
});

describe('turning trusted bars into where the notes fall', () => {
  it('places each note in its bar and its beat', () => {
    const bars = [bar(1, 1, 1, 1), bar(0.5, 0.5, 1, 1, 1)];
    const found = validateValues([...bars, ...page(6, () => bar(1, 1, 1, 1))]);
    const placed = beatsFor(bars, found);
    expect(placed[0]).toMatchObject({ measure: 0, beatInMeasure: 0, onsetBeats: 0, durBeats: 1 });
    expect(placed[3]).toMatchObject({ measure: 0, beatInMeasure: 3, onsetBeats: 3 });
    expect(placed[4]).toMatchObject({ measure: 1, beatInMeasure: 0, onsetBeats: 4 });
    expect(placed[5]).toMatchObject({ measure: 1, beatInMeasure: 0.5, onsetBeats: 4.5 });
  });

  it('marks the notes of an untrusted bar as untrusted, and still counts the bar', () => {
    const bars = [bar(1, 1, 1, 1), bar(1, 1, 1), bar(1, 1, 1, 1)];
    const found = validateValues([...bars, ...page(6, () => bar(1, 1, 1, 1))]);
    const placed = beatsFor(bars, found);
    expect(placed.filter((p) => !p.trusted)).toHaveLength(3);
    // The bar after the short one is still bar two, not bar one-and-a-bit.
    expect(placed.at(-1).measure).toBe(2);
  });
});
