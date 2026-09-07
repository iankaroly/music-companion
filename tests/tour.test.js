// The tour's flag and its stops, apart from the browser. The geometry is
// measured by tools/tour-check.mjs against the real page; what is left to pin
// here is that the flag survives a storage that throws (private browsing on
// iOS used to), and that every stop points somewhere on a tab that exists.

import { describe, it, expect } from 'vitest';
import { tourSeen, markTourSeen, forgetTour, STOPS } from '../src/ui/tour.js';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

describe('the tour is shown once', () => {
  it('is due until it has ended, and not after', () => {
    const s = memory();
    expect(tourSeen(s)).toBe(false);
    markTourSeen(s);
    expect(tourSeen(s)).toBe(true);
    forgetTour(s);
    expect(tourSeen(s)).toBe(false);
  });

  it('treats a storage that throws as never seen, and does not throw itself', () => {
    const broken = {
      getItem: () => { throw new Error('quota'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('quota'); },
    };
    expect(tourSeen(broken)).toBe(false);
    expect(() => markTourSeen(broken)).not.toThrow();
    expect(() => forgetTour(broken)).not.toThrow();
  });

  it('is not a preference: a missing storage reads as not seen', () => {
    expect(tourSeen(null)).toBe(false);
  });
});

describe('the stops', () => {
  it('are seven, one for every tab and one for the gear, each with something to point at', () => {
    const tabs = ['tuner', 'analyze', 'score', 'library', 'coach', 'metronome'];
    expect(STOPS).toHaveLength(7);
    for (const stop of STOPS) {
      expect(tabs).toContain(stop.tab);
      expect([].concat(stop.target).length).toBeGreaterThan(0);
      const text = typeof stop.text === 'function'
        ? stop.text({ querySelector: () => null })
        : stop.text;
      expect(text.length).toBeGreaterThan(20);
    }
  });
});
