import { describe, test, expect } from 'vitest';
import { parseXml } from '../src/analysis/xml.js';

describe('parseXml', () => {
  test('reads an element, its attributes and its text', () => {
    const root = parseXml('<note type="quarter">middle</note>');
    expect(root.name).toBe('note');
    expect(root.attrs.type).toBe('quarter');
    expect(root.text).toBe('middle');
  });

  test('nests children and finds them by name', () => {
    const root = parseXml('<pitch><step>C</step><octave>4</octave></pitch>');
    expect(root.children.map((c) => c.name)).toEqual(['step', 'octave']);
    expect(root.child('octave').text).toBe('4');
  });

  test('self-closing tags carry no children', () => {
    const root = parseXml('<note><rest/><duration>4</duration></note>');
    expect(root.child('rest')).toBeTruthy();
    expect(root.child('rest').children).toEqual([]);
    expect(root.child('duration').text).toBe('4');
  });

  test('skips the xml declaration, the doctype and comments', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
      <!-- exported by something -->
      <score-partwise version="4.0"><part id="P1"/></score-partwise>`;
    const root = parseXml(xml);
    expect(root.name).toBe('score-partwise');
    expect(root.attrs.version).toBe('4.0');
    expect(root.child('part').attrs.id).toBe('P1');
  });

  test('decodes the five xml entities in text and attributes', () => {
    const root = parseXml('<work-title label="&quot;a&quot; &amp; b">&lt;fine&gt; &apos;now&apos;</work-title>');
    expect(root.text).toBe("<fine> 'now'");
    expect(root.attrs.label).toBe('"a" & b');
  });

  test('finds every child of a name, not just the first', () => {
    const root = parseXml('<measure><note>a</note><note>b</note><backup/></measure>');
    expect(root.all('note').map((n) => n.text)).toEqual(['a', 'b']);
    expect(root.all('missing')).toEqual([]);
  });

  test('an unclosed tag is an error rather than a silently short score', () => {
    expect(() => parseXml('<part><measure></part>')).toThrow(/measure/);
  });
});
