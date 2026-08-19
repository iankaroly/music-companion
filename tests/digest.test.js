import { describe, it, expect } from 'vitest';
import { digestTake, digestLibrary } from '../src/ai/digest.js';

// A take a person could have played: eighteen notes of a D major scale up,
// down and up again, one every 0.6 s (100 bpm), every F sharp 30 cents sharp
// and the rest within a few cents. The eleventh note comes in 120 ms late.
// It goes up twice because a pitch class is only named as a tendency once it
// has been played three times — two F sharps is an accident, not a habit.
const A4 = 440;
const SCALE = [62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 64, 66, 67];
const NAMES = {
  62: 'D4', 64: 'E4', 66: 'F#4', 67: 'G4', 69: 'A4', 71: 'B4', 73: 'C#5', 74: 'D5',
};

function take() {
  const notes = SCALE.map((midi, i) => {
    const late = i === 10 ? 0.12 : 0;
    const start = i * 0.6 + late;
    return {
      start,
      end: start + 0.45,
      midi,
      name: NAMES[midi],
      cents: midi % 12 === 6 ? 30 : (i % 3) - 1,
    };
  });
  // Readings inside each note: it arrives at its onset error and stays there,
  // which makes every F sharp a note that never settles.
  const readings = [];
  for (const n of notes) {
    for (let t = n.start; t < n.end; t += 0.0116) {
      readings.push({
        time: t,
        frequency: A4 * 2 ** ((n.midi + n.cents / 100 - 69) / 12),
        confidence: 0.9,
      });
    }
  }
  return { notes, readings };
}

describe('the digest a model is asked questions about', () => {
  const { notes, readings } = take();
  const text = digestTake({
    notes, readings, a4: A4, duration: 10, name: 'D major', tolerance: 10,
  });

  it('names the take and counts its notes', () => {
    expect(text).toContain('"D major"');
    expect(text).toContain('18 notes');
  });

  it('names only the pitch class that leans, and says nothing about the ones that do not', () => {
    const line = text.split('\n').find((l) => l.includes('pitch classes that lean'));
    expect(line).toMatch(/F# \+30c \(3x\)/);
    expect(line).not.toContain('D ');
  });

  it('says a take is in tune rather than listing eight notes that are not out', () => {
    const clean = notes.map((n) => ({ ...n, cents: 1 }));
    const text2 = digestTake({ notes: clean, a4: A4, tolerance: 10 });
    expect(text2).toContain('no note sat further than 10 c');
    expect(text2).not.toContain('furthest out');
  });

  it('finds the tempo the player implied without a metronome', () => {
    const line = text.split('\n').find((l) => l.includes('implied'));
    expect(line).toMatch(/implied 10[01] bpm/);
  });

  it('names the note that came in late, with its offset', () => {
    const line = text.split('\n').find((l) => l.includes('notes worth naming'));
    expect(line).toContain('6.12s');
    expect(line).toMatch(/\+1\d\dms/);
  });

  it('says which notes never found the centre', () => {
    expect(text).toContain('never settled');
  });

  it('lists every note when the take is short enough', () => {
    const rows = text.split('\n').filter((l) => /^ {2}\d+(\.\d+)?s /.test(l));
    expect(rows).toHaveLength(18);
  });

  // The one failure that would be invisible: a trimmed list read as a whole
  // one. If the elision is not in the text, the model will count from it.
  it('declares the trim, and only lists the outliers, when the take is long', () => {
    const trimmed = digestTake({ notes, readings, a4: A4, tolerance: 10, maxNotes: 4 });
    expect(trimmed).toContain('ONLY the outliers');
    const rows = trimmed.split('\n').filter((l) => /^ {2}\d+(\.\d+)?s /.test(l));
    expect(rows.length).toBeLessThan(18);
    expect(rows.every((l) => l.includes('F#4') || l.includes('ms'))).toBe(true);
  });

  it('says a section is missing rather than inventing it', () => {
    const bare = digestTake({ notes: notes.slice(0, 2), a4: A4 });
    expect(bare).toContain('TIMING: not reported');
    expect(bare).not.toContain('LANDING');
  });

  it('survives a take with nothing in it', () => {
    expect(digestTake({ notes: [] })).toContain('No notes were detected');
  });
});

describe('the library index', () => {
  it('summarises takes from their metadata alone, without touching audio', () => {
    const text = digestLibrary([
      {
        id: 3, date: Date.parse('2026-08-17'), name: 'Prelude', duration: 61.2, noteCount: 2,
        noteStats: [{ midi: 62, name: 'D4', cents: 12 }, { midi: 64, name: 'E4', cents: -8 }],
        landingStats: [{ settled: true }, { settled: false }],
      },
    ]);
    expect(text).toContain('#3');
    expect(text).toContain('mean |error| 10c');
    expect(text).toContain('50% settled');
  });

  it('says so when there is nothing saved', () => {
    expect(digestLibrary([])).toBe('The library is empty.');
  });
});
