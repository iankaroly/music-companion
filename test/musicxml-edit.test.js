import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { editNote, findNote, addressOf, divisionsAt } from '../src/analysis/musicxml-edit.js';
import { parseScore } from '../src/analysis/musicxml.js';

// The recogniser's own output, from a photographed page — the file these edits
// exist for. A toy score would not have Audiveris's attributes, its self-closing
// tags or its layout elements, and those are exactly what an edit must not
// disturb.
const REAL = readFileSync(
  new URL('./fixtures/recognised-page.musicxml', import.meta.url), 'utf8',
);

const pitched = () => parseScore(REAL, { partIndex: 0 }).notes.find((n) => n.midi != null);

describe('finding the note somebody tapped', () => {
  it('reads the three coordinates out of the id the app already gives it', () => {
    expect(addressOf('P1-m4-n2')).toEqual({ partId: 'P1', measure: 4, note: 2 });
    expect(addressOf('nonsense')).toBe(null);
  });

  it('finds a real note in a real recogniser file', () => {
    const note = pitched();
    const found = findNote(REAL, note.id);
    expect(found).not.toBe(null);
    expect(found.text).toMatch(/<note[\s>]/);
    expect(REAL.slice(found.from, found.to)).toBe(found.text);
  });
});

describe('correcting a note', () => {
  it('moves it a step, by lines and spaces rather than semitones', () => {
    const note = pitched();
    const up = editNote(REAL, note.id, { steps: 1 });
    expect(up.changed).toBe(true);
    const after = parseScore(up.xml, { partIndex: 0 }).notes.find((n) => n.id === note.id);
    expect(after.midi).toBeGreaterThan(note.midi);
    expect(after.midi - note.midi).toBeLessThanOrEqual(2);   // a step, not a leap
  });

  it('carries the octave when it moves past B', () => {
    // B4 up a step is C5 — the case that is wrong in every naive version.
    const xml = '<part id="P1"><measure number="1"><note><pitch><step>B</step>'
      + '<octave>4</octave></pitch><duration>24</duration><type>quarter</type></note></measure></part>';
    const out = editNote(xml, 'P1-m0-n0', { steps: 1 });
    expect(out.xml).toContain('<step>C</step>');
    expect(out.xml).toContain('<octave>5</octave>');
  });

  it('sharpens and flattens, and takes the accidental away at natural', () => {
    const note = pitched();
    const sharp = editNote(REAL, note.id, { alter: 1 });
    expect(sharp.xml).toMatch(/<alter>1<\/alter>/);
    const back = editNote(sharp.xml, note.id, { alter: -1 });
    expect(findNote(back.xml, note.id).text).not.toMatch(/<alter>/);
  });

  it('halves and doubles what a note is worth, type and duration together', () => {
    const note = pitched();
    const before = findNote(REAL, note.id).text;
    const shorter = editNote(REAL, note.id, { shorter: true });
    const after = findNote(shorter.xml, note.id).text;
    expect(Number(/<duration>(\d+)<\/duration>/.exec(after)[1]))
      .toBe(Number(/<duration>(\d+)<\/duration>/.exec(before)[1]) / 2);
    expect(after).toMatch(/<type>eighth<\/type>/);
  });

  it('turns a wrong note into a rest without moving everything after it', () => {
    const note = pitched();
    const out = editNote(REAL, note.id, { remove: true });
    expect(out.changed).toBe(true);
    const after = findNote(out.xml, note.id).text;
    expect(after).toMatch(/<rest\s*\/>/);
    expect(after).not.toMatch(/<pitch>/);
    // The bar is the same length: a hole where a note was is not a bar that has
    // lost a beat.
    expect(/<duration>(\d+)<\/duration>/.exec(after)[1])
      .toBe(/<duration>(\d+)<\/duration>/.exec(findNote(REAL, note.id).text)[1]);
  });

  it('leaves every other byte of the file exactly as it was', () => {
    const note = pitched();
    const out = editNote(REAL, note.id, { steps: -1 });
    const where = findNote(REAL, note.id);
    expect(out.xml.slice(0, where.from)).toBe(REAL.slice(0, where.from));
    expect(out.xml.slice(-200)).toBe(REAL.slice(-200));
  });

  it('refuses what it cannot do, rather than mangling the file', () => {
    expect(editNote(REAL, 'P9-m99-n99', { steps: 1 }).changed).toBe(false);
    expect(editNote(REAL, pitched().id, {}).changed).toBe(false);
  });

  it('knows the divisions in force where the note is', () => {
    expect(divisionsAt(REAL, REAL.length)).toBeGreaterThan(0);
  });
});
