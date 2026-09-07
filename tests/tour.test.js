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
  const textOf = (stop) => (typeof stop.text === 'function'
    ? stop.text({ querySelector: () => null })
    : stop.text);

  it('are ten, in tab-bar order, each on a tab that exists with something to point at', () => {
    const tabs = ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome'];
    expect(STOPS).toHaveLength(10);
    for (const stop of STOPS) {
      expect(tabs).toContain(stop.tab);
      expect([].concat(stop.target).length).toBeGreaterThan(0);
      expect(textOf(stop).length).toBeGreaterThan(20);
    }
    // The tab bar's order, with the gear last on the tab the tour began on.
    const order = STOPS.slice(0, -1).map((s) => tabs.indexOf(s.tab));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(STOPS.at(-1).target).toBe('#settings-btn');
  });

  it('say what the reader does once a part is open', () => {
    const score = STOPS.filter((s) => s.tab === 'score').map(textOf).join(' ');
    for (const word of ['scan', 'PDF', 'MusicXML', 'setlist', 'half a page', 'turn by itself',
      'lock', 'pencil', 'transpose', 'record a take']) {
      expect(score.toLowerCase()).toContain(word.toLowerCase());
    }
  });

  it('do not promise the take is marked onto the page — that is not ready', () => {
    for (const stop of STOPS) {
      expect(textOf(stop)).not.toMatch(/marked|onto the (page|score|music)/i);
    }
  });

  it('are a tour and not a manual: no card runs past three sentences or 300 characters', () => {
    for (const stop of STOPS) {
      const text = textOf(stop);
      expect(text.length).toBeLessThanOrEqual(300);
      expect(text.split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBeLessThanOrEqual(3);
    }
  });
});
