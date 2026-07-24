import { describe, test, expect } from 'vitest';
import { findNoteAt, intonationStatus } from '../src/ui/chart-utils.js';

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
  test('tiers by absolute cents', () => {
    expect(intonationStatus(3)).toBe('good');
    expect(intonationStatus(-7.9)).toBe('good');
    expect(intonationStatus(12)).toBe('off');
    expect(intonationStatus(-24)).toBe('off');
    expect(intonationStatus(25)).toBe('bad');
    expect(intonationStatus(-40)).toBe('bad');
  });
});
