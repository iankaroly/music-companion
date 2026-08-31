import { describe, test, expect, afterEach } from 'vitest';
import {
  findNoteAt, intonationStatus, setIntonationTolerance, intonationTolerance,
  cursorReading,
} from '../src/ui/chart-utils.js';

const notes = [
  { name: 'A3', start: 1.0, end: 1.5, cents: 2 },
  { name: 'B3', start: 1.6, end: 2.1, cents: -12 },
  { name: 'C4', start: 2.5, end: 3.0, cents: 30 },
];

describe('findNoteAt', () => {
  test('a time inside a span returns that note', () => {
    expect(findNoteAt(notes, 1.8)).toBe(notes[1]);
  });

  test('a time in a small gap snaps to the nearest note edge', () => {
    expect(findNoteAt(notes, 1.55)).toBe(notes[0]);
    expect(findNoteAt(notes, 2.4)).toBe(notes[2]);
  });

  test('a time far from any note returns null', () => {
    expect(findNoteAt(notes, 5.0)).toBeNull();
    expect(findNoteAt(notes, 0.2)).toBeNull();
  });
});

describe('intonationStatus', () => {
  afterEach(() => setIntonationTolerance(8));

  test('tiers by absolute cents', () => {
    expect(intonationStatus(3)).toBe('good');
    expect(intonationStatus(-7.9)).toBe('good');
    expect(intonationStatus(12)).toBe('off');
    expect(intonationStatus(-24)).toBe('off');
    expect(intonationStatus(25)).toBe('bad');
    expect(intonationStatus(-40)).toBe('bad');
  });

  test('the in-tune door is a setting', () => {
    setIntonationTolerance(5);
    expect(intonationTolerance()).toBe(5);
    expect(intonationStatus(6)).toBe('off');
    setIntonationTolerance(12);
    expect(intonationStatus(6)).toBe('good');
    expect(intonationStatus(11.9)).toBe('good');
    // badly-off is the same call whatever the door is set to
    expect(intonationStatus(26)).toBe('bad');
  });

  test('nonsense tolerances fall back to the default', () => {
    setIntonationTolerance(0);
    expect(intonationTolerance()).toBe(8);
    setIntonationTolerance(NaN);
    expect(intonationTolerance()).toBe(8);
  });
});

// WHAT THE READOUT SAYS UNDER THE CURSOR.
//
// The complaint: "I'll click a note that's green, and when I go through slowly
// over the note in the zoomed in graph, it will show blue or red over certain
// parts, while the line still shows green." Every frame was being rounded to
// its own nearest semitone, so the moments of a note that stray past 50¢ — an
// attack arriving from below, the far side of a vibrato swing, any note sitting
// well sharp — were renamed to the neighbouring note and reported as a big
// deviation of the opposite sign.
describe('the reading under the cursor', () => {
  // A5 is midi 81. A note decided as A5 but sitting 40¢ sharp: its vibrato
  // crosses 50¢, and those moments are what used to flip.
  const note = { midi: 81, start: 1, end: 2, cents: 40 };

  test('measures against the note the cursor is in, not the nearest semitone', () => {
    const strayed = 81 + 0.62;                       // 62¢ above A5, past the line
    const { midi, cents } = cursorReading(strayed, note);
    expect(midi).toBe(81);                           // still A5
    expect(cents).toBeCloseTo(62, 0);                // still sharp, and by more
  });

  test('keeps the sign, which is the part that was flipping', () => {
    // Rounded on its own this frame is A#5 at -38¢ — the opposite direction
    // from the note it belongs to, which is what turned a green note blue.
    const strayed = 81 + 0.62;
    expect(cursorReading(strayed).cents).toBeCloseTo(-38, 0);
    expect(cursorReading(strayed, note).cents).toBeGreaterThan(0);
  });

  test('is unchanged in the middle of a note, where it was always right', () => {
    expect(cursorReading(81.1, note).cents).toBeCloseTo(10, 0);
    expect(cursorReading(80.9, note).cents).toBeCloseTo(-10, 0);
  });

  test('falls back to the nearest semitone outside any note', () => {
    const { midi, cents } = cursorReading(80.9, null);
    expect(midi).toBe(81);
    expect(cents).toBeCloseTo(-10, 0);
  });
});
