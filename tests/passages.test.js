import { describe, it, expect } from 'vitest';
import { passageStats, passageProgress } from '../src/analysis/passages.js';

const notes = [
  { midi: 48, name: 'C3', cents: -12, start: 0.0, end: 0.4 },
  { midi: 50, name: 'D3', cents: 6, start: 0.5, end: 0.9 },
  { midi: 52, name: 'E3', cents: 18, start: 1.0, end: 1.4 },
  { midi: 53, name: 'F3', cents: -4, start: 1.5, end: 1.9 },
  { midi: 55, name: 'G3', cents: 30, start: 2.0, end: 2.4 },
];

describe('passageStats', () => {
  it('summarises only the notes inside the span', () => {
    const s = passageStats(notes, 0.4, 1.6);
    expect(s.noteCount).toBe(3); // D3, E3, F3
    expect(s.absMeanCents).toBeCloseTo((6 + 18 + 4) / 3, 5);
  });

  it('counts a note by where it starts, so a span cuts cleanly', () => {
    const s = passageStats(notes, 0.0, 1.0);
    expect(s.noteCount).toBe(3); // C3, D3 and E3 — E3 starts exactly at 1.0
  });

  it('returns null when the span is empty', () => {
    expect(passageStats(notes, 3.0, 4.0)).toBeNull();
    expect(passageStats([], 0, 1)).toBeNull();
  });

  it('carries a timing read when the span has enough notes for one', () => {
    const even = Array.from({ length: 12 }, (_, i) => ({
      midi: 48, name: 'C3', cents: 0, start: i * 0.5, end: i * 0.5 + 0.4,
    }));
    const s = passageStats(even, 0, 6);
    expect(s.bpm).toBeCloseTo(120, 0);
    expect(s.meanAbsMs).toBeLessThan(6);
  });

  it('leaves the timing read off a span too short to imply a pulse', () => {
    const s = passageStats(notes, 0.0, 0.6);
    expect(s.noteCount).toBe(2);
    expect(s.bpm).toBeNull();
    expect(s.meanAbsMs).toBeNull();
  });
});

describe('passageProgress', () => {
  const mk = (name, date, absMeanCents, meanAbsMs) => ({
    name, date, stats: { noteCount: 8, absMeanCents, meanAbsMs, bpm: 100, evenness: 0.9 },
  });

  it('groups attempts by name and measures the change since the first', () => {
    const rows = passageProgress([
      mk('Elgar m. 42', 1000, 20, 40),
      mk('Elgar m. 42', 2000, 12, 25),
      mk('Bach prelude', 1500, 9, 18),
    ]);
    expect(rows).toHaveLength(2);
    const elgar = rows.find((r) => r.name === 'Elgar m. 42');
    expect(elgar.attempts).toHaveLength(2);
    expect(elgar.latestCents).toBe(12);
    expect(elgar.centsDelta).toBe(-8); // 8 cents better than the first attempt
    expect(elgar.msDelta).toBe(-15);
    expect(elgar.improving).toBe(true);
  });

  it('treats the same name in different case or spacing as one passage', () => {
    const rows = passageProgress([
      mk('Elgar m. 42', 1000, 20, 40),
      mk('  elgar M. 42 ', 2000, 15, 30),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toHaveLength(2);
    expect(rows[0].name).toBe('Elgar m. 42'); // the first spelling is kept
  });

  it('has no delta to report from a single attempt', () => {
    const rows = passageProgress([mk('Elgar m. 42', 1000, 20, 40)]);
    expect(rows[0].centsDelta).toBeNull();
    expect(rows[0].improving).toBe(false);
  });

  it('orders the most recently practised passage first', () => {
    const rows = passageProgress([
      mk('older', 1000, 10, 20),
      mk('newer', 5000, 10, 20),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['newer', 'older']);
  });

  it('sorts each passage\'s attempts oldest first, whatever order they arrive in', () => {
    const rows = passageProgress([
      mk('p', 3000, 10, 20),
      mk('p', 1000, 30, 60),
      mk('p', 2000, 20, 40),
    ]);
    expect(rows[0].attempts.map((a) => a.date)).toEqual([1000, 2000, 3000]);
    expect(rows[0].centsDelta).toBe(-20);
  });

  it('ignores unnamed or statless rows rather than inventing a passage', () => {
    const rows = passageProgress([
      { name: '', date: 1, stats: { absMeanCents: 5 } },
      { name: 'ok', date: 2, stats: null },
      mk('real', 3, 10, 20),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['real']);
  });
});
