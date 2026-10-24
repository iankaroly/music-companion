// REPAIR: the shaping facts and measurements. Each fails at ceab50d.
import { describe, test, expect } from 'vitest';
import { topicsOf, compareMusicalityFacts, musicalityFacts } from '../src/ai/musicality-facts.js';
import { musicalityOf } from '../src/analysis/musicality.js';
import { buildSpec, idealTake } from './helpers/musicality-synth.js';

const takeOf = (spec, extra = {}) => {
  const t = idealTake(buildSpec(spec));
  return { ...extra, musicality: musicalityOf({ notes: t.notes, readings: t.readings, a4: 440 }) };
};

describe('a question is narrowed by its words, not by letters inside other words', () => {
  test.each([
    ['How musical was my take against last week?', ['phrasing', 'articulation', 'tempo', 'repeats', 'expression']],
    ['How is my character in march', ['phrasing', 'articulation', 'tempo', 'repeats', 'expression']],
    ['is it carefree', ['phrasing', 'articulation', 'tempo', 'repeats', 'expression']],
  ])('%s asks about everything', (q, all) => {
    expect(topicsOf(q)).toEqual(all);
  });
  test('the whole words still narrow', () => {
    expect(topicsOf('do I play it again the same way')).toEqual(['repeats']);
    expect(topicsOf('is the phrase arch clear')).toEqual(['phrasing']);
    expect(topicsOf('do I play freely')).toEqual(['tempo']);
  });
  test('a comparison "against last week" keeps the rows measured in both takes', () => {
    const a = takeOf({ seed: 1 }, { name: 'A', date: new Date(2026, 2, 6, 9).getTime() });
    const b = takeOf({ seed: 2, shape: 'flat', articulation: 0.6 }, { name: 'B', date: new Date(2026, 2, 1, 9).getTime() });
    const against = compareMusicalityFacts(a, b, { question: 'How musical was my take against last week?' });
    const compared = compareMusicalityFacts(a, b, { question: 'How musical was my take compared with last week?' });
    expect(against).toEqual(compared);
  });
});

describe('two takes of one name on one day are told apart', () => {
  test('by the time', () => {
    const a = takeOf({ seed: 1 }, { name: 'Take', date: new Date(2026, 2, 6, 18).getTime() });
    const b = takeOf({ seed: 2, shape: 'flat', articulation: 0.6 }, { name: 'Take', date: new Date(2026, 2, 6, 9).getTime() });
    const line = compareMusicalityFacts(a, b).join(' ');
    expect(line).toContain('Take, Mar 6, 6:00 PM');
    expect(line).toContain('Take, Mar 6, 9:00 AM');
  });
  test('a take with no name and no date does not say "Invalid Date"', () => {
    const line = musicalityFacts(takeOf({ seed: 1 }, { name: '', date: undefined })).join(' ');
    expect(line).not.toMatch(/Invalid/);
  });
});

describe('the reasons a reading was not made are grammatical', () => {
  test('one phrase end, one note, one link, one spacing', () => {
    const reasons = [];
    for (let n = 3; n <= 40; n++) {
      for (const spec of [{ phrases: 2, perPhrase: n, period: 0.5 }, { phrases: 1, perPhrase: n }, { phrases: n, perPhrase: 1 }]) {
        const m = musicalityOf({ ...(() => { const t = idealTake(buildSpec(spec)); return { notes: t.notes, readings: t.readings }; })(), a4: 440 });
        for (const d of Object.values(m.descriptors)) if (!d.measured && d.reason) reasons.push(d.reason);
      }
    }
    for (const r of reasons) expect(r, r).not.toMatch(/\bonly 1 (notes|phrase ends|note-to-note links|steady spacings|matching|pairs)\b/);
  });
  test('the templates themselves', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/analysis/musicality.js', import.meta.url), 'utf8');
    for (const bad of ['only ${ratios.length} note-to-note links', 'only ${notes.length} notes;', 'only ${kept.length} steady spacings', 'only ${longNotes} notes held', 'only ${loud.length} matching', 'only ${list.length} notes;']) {
      expect(src.includes(bad), bad).toBe(false);
    }
  });
});

describe('"based on only N" says what N counts', () => {
  test('a low-confidence reading names its unit', () => {
    const t = takeOf({ phrases: 2, perPhrase: 16, seed: 1 }, { name: 'T', date: 0 });
    const lines = musicalityFacts(t, { question: '' }).filter((l) => /based on only/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(' ')).toMatch(/based on only 2 phrases, so take it lightly/);
    expect(lines.join(' ')).toMatch(/based on only 1 phrase end, so take it lightly/);
    expect(lines.join(' ')).not.toMatch(/based on only \d+, so/);
  });
});

describe('the same performance reads the same whatever the clock says', () => {
  const shifted = (spec, by) => {
    const t = idealTake(buildSpec(spec));
    return musicalityOf({ notes: t.notes.map((n) => ({ ...n, start: n.start + by, end: n.end + by })), readings: t.readings.map((r) => ({ ...r, time: r.time + by })), a4: 440 });
  };
  const phrases = (m) => Object.values(m.descriptors).filter((d) => d.measured).map((d) => `${d.key}:${d.phrase}`);
  test.each([123.456, 3600.1, 0.37])('shifted by %s s', (by) => {
    for (const seed of [1, 2, 3, 4]) {
      expect(phrases(shifted({ seed }, by)), `seed ${seed}`).toEqual(phrases(shifted({ seed }, 0)));
    }
  });
});

describe('reading a long note\'s frames does not scan the whole take for every note', () => {
  test('time reads grow with the take, not with notes times readings', () => {
    const t = idealTake(buildSpec({ phrases: 100, perPhrase: 10, period: 1.2, vibrato: 'grows' }));
    let reads = 0;
    const readings = t.readings.map((r) => ({ get time() { reads++; return r.time; }, frequency: r.frequency, confidence: r.confidence, rms: r.rms }));
    musicalityOf({ notes: t.notes, readings, a4: 440 });
    // 1000 notes over about 53,000 readings: a scan from the start per long note is ~26 million reads
    expect(reads).toBeLessThan(readings.length * 40);
  });
});
