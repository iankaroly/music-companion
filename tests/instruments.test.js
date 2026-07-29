import { describe, test, expect, afterEach } from 'vitest';
import {
  INSTRUMENTS, instrument, setInstrument, instrumentById,
  loadInstrument, saveInstrument, instrumentChosen,
} from '../src/analysis/instruments.js';
import { leapBand } from '../src/analysis/landing.js';

// A stand-in for localStorage so these don't depend on a browser.
function store(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

afterEach(() => setInstrument('strings'));

describe('instrument profiles', () => {
  test('every profile can name every distance', () => {
    for (const i of INSTRUMENTS) {
      for (const semitones of [0, 2, 5, 12]) {
        const band = leapBand(semitones, i.motion);
        expect(typeof band.label).toBe('string');
        expect(band.label.length).toBeGreaterThan(0);
        expect(band.plural.length).toBeGreaterThan(0);
      }
    }
  });

  test('a big leap is a shift on a fingerboard and not on a flute', () => {
    const strings = leapBand(12, instrumentById('strings').motion);
    const winds = leapBand(12, instrumentById('winds').motion);
    const voice = leapBand(12, instrumentById('voice').motion);
    expect(strings.plural).toContain('shift');
    expect(winds.plural).not.toContain('shift');
    expect(voice.plural).not.toContain('shift');
  });

  test('without a profile the bands keep their internal keys and no words', () => {
    // analysis stays neutral; only the UI attaches vocabulary
    expect(leapBand(12).key).toBe('shift');
    expect(leapBand(12).label).toBeUndefined();
  });

  test('an unknown id falls back rather than throwing', () => {
    expect(instrumentById('theremin').id).toBe('strings');
    expect(setInstrument(undefined).id).toBe('strings');
  });

  test('the choice round-trips through storage', () => {
    const s = store();
    expect(instrumentChosen(s)).toBe(false);
    saveInstrument('voice', s);
    expect(s.data.instrument).toBe('voice');
    expect(instrumentChosen(s)).toBe(true);
    setInstrument('strings');
    expect(loadInstrument(s).id).toBe('voice');
  });

  test('each profile brings a drone voice and something to try', () => {
    for (const i of INSTRUMENTS) {
      expect(['strings', 'reed', 'organ', 'pure']).toContain(i.timbre);
      expect(i.aim.length).toBeGreaterThan(20);
      expect(i.examples.length).toBeGreaterThan(0);
    }
  });

  test('a family carries no transposition — that is a per-instrument fact', () => {
    // flute and B flat clarinet are both winds; the tuner's own instrument
    // control is what names the actual pitch
    for (const i of INSTRUMENTS) expect(i.transpose).toBeUndefined();
  });
});
