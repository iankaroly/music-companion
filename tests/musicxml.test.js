import { describe, test, expect } from 'vitest';
import { parseScore } from '../src/analysis/musicxml.js';

// Fixture helpers — MusicXML is verbose and the noise buries the intent.
function note(step, octave, duration, extra = '') {
  return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
    `<duration>${duration}</duration>${extra}</note>`;
}

function rest(duration) {
  return `<note><rest/><duration>${duration}</duration></note>`;
}

function measure(number, body, attrs = '') {
  return `<measure number="${number}">${attrs}${body}</measure>`;
}

const FOUR_FOUR = '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>';

function score(measures, { partName = 'Cello' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <score-partwise version="4.0">
      <part-list><score-part id="P1"><part-name>${partName}</part-name></score-part></part-list>
      <part id="P1">${measures}</part>
    </score-partwise>`;
}

describe('parseScore — reading notes', () => {
  test('a bar of quarter notes becomes midi numbers on the beat', () => {
    const xml = score(measure(1, note('C', 4, 1) + note('D', 4, 1) + note('E', 4, 1) + note('F', 4, 1), FOUR_FOUR));
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 64, 65]);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 1, 2, 3]);
    expect(notes.map((n) => n.durBeats)).toEqual([1, 1, 1, 1]);
    expect(notes.every((n) => n.measure === 1)).toBe(true);
  });

  test('divisions scale duration into quarter-note beats', () => {
    const attrs = '<attributes><divisions>4</divisions></attributes>';
    const xml = score(measure(1, note('C', 4, 4) + note('D', 4, 2) + note('E', 4, 2), attrs));
    const { notes, divisions } = parseScore(xml);
    expect(divisions).toBe(4);
    expect(notes.map((n) => n.durBeats)).toEqual([1, 0.5, 0.5]);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 1, 1.5]);
  });

  test('alter raises and lowers the pitch', () => {
    const sharp = '<note><pitch><step>F</step><alter>1</alter><octave>3</octave></pitch><duration>1</duration></note>';
    const flat = '<note><pitch><step>B</step><alter>-1</alter><octave>3</octave></pitch><duration>1</duration></note>';
    const { notes } = parseScore(score(measure(1, sharp + flat, FOUR_FOUR)));
    expect(notes.map((n) => n.midi)).toEqual([54, 58]);
  });

  test('a rest makes no note but still moves the clock', () => {
    const xml = score(measure(1, note('C', 4, 1) + rest(2) + note('G', 4, 1), FOUR_FOUR));
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.midi)).toEqual([60, 67]);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 3]);
  });

  test('measures run on from each other and carry their own beat position', () => {
    const xml = score(
      measure(1, note('C', 4, 4), FOUR_FOUR) + measure(2, note('D', 4, 2) + note('E', 4, 2)),
    );
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 4, 6]);
    expect(notes.map((n) => n.measure)).toEqual([1, 2, 2]);
    expect(notes.map((n) => n.beatInMeasure)).toEqual([0, 0, 2]);
  });

  test('every note gets an id that is stable and unique', () => {
    const xml = score(measure(1, note('C', 4, 1) + note('C', 4, 1), FOUR_FOUR));
    const { notes } = parseScore(xml);
    expect(new Set(notes.map((n) => n.id)).size).toBe(2);
    expect(parseScore(xml).notes.map((n) => n.id)).toEqual(notes.map((n) => n.id));
  });
});

describe('parseScore — what one played note actually is', () => {
  test('a tie across the barline is one note, not two', () => {
    const start = note('C', 4, 4, '<tie type="start"/>');
    const stop = note('C', 4, 4, '<tie type="stop"/>');
    const xml = score(measure(1, start, FOUR_FOUR) + measure(2, stop));
    const { notes } = parseScore(xml);
    expect(notes).toHaveLength(1);
    expect(notes[0].durBeats).toBe(8);
    expect(notes[0].tied).toBe(true);
  });

  test('a chord keeps only the written note — the engine hears one line', () => {
    const top = note('C', 4, 2);
    const under = '<note><chord/><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration></note>';
    const { notes } = parseScore(score(measure(1, top + under + note('D', 4, 2), FOUR_FOUR)));
    expect(notes.map((n) => n.midi)).toEqual([60, 62]);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 2]);
    expect(notes[0].chord).toBe(true);
  });

  test('a grace note sounds but takes no time from the bar', () => {
    const grace = '<note><grace/><pitch><step>B</step><octave>3</octave></pitch></note>';
    const { notes } = parseScore(score(measure(1, grace + note('C', 4, 4), FOUR_FOUR)));
    expect(notes.map((n) => n.midi)).toEqual([59, 60]);
    expect(notes.map((n) => n.durBeats)).toEqual([0, 4]);
    expect(notes[0].grace).toBe(true);
    expect(notes[1].onsetBeats).toBe(0);
  });

  test('a second voice written under the first is left out', () => {
    const upper = '<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice></note>';
    const lower = '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice></note>';
    const body = upper + '<backup><duration>4</duration></backup>' + lower;
    const { notes } = parseScore(score(measure(1, body, FOUR_FOUR)));
    expect(notes.map((n) => n.midi)).toEqual([72]);
  });
});

describe('parseScore — repeats', () => {
  const REPEAT_OPEN = '<barline location="left"><repeat direction="forward"/></barline>';
  const REPEAT_CLOSE = '<barline location="right"><repeat direction="backward"/></barline>';

  test('a repeated bar is played twice, and both passes point at the same notehead', () => {
    const xml = score(
      measure(1, note('C', 4, 4), FOUR_FOUR) +
      measure(2, REPEAT_OPEN + note('D', 4, 4) + REPEAT_CLOSE),
    );
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 62]);
    expect(notes.map((n) => n.pass)).toEqual([0, 0, 1]);
    expect(notes[1].id).toBe(notes[2].id);
    expect(notes.map((n) => n.onsetBeats)).toEqual([0, 4, 8]);
  });

  test('with no forward repeat the music goes back to the beginning', () => {
    const xml = score(
      measure(1, note('C', 4, 4), FOUR_FOUR) + measure(2, note('D', 4, 4) + REPEAT_CLOSE),
    );
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 60, 62]);
  });

  test('first time takes the first ending, second time takes the second', () => {
    const first = measure(2, '<barline location="left"><ending number="1" type="start"/></barline>' +
      note('D', 4, 4) + REPEAT_CLOSE);
    const second = measure(3, '<barline location="left"><ending number="2" type="start"/></barline>' +
      note('E', 4, 4));
    const xml = score(measure(1, REPEAT_OPEN + note('C', 4, 4), FOUR_FOUR) + first + second);
    const { notes } = parseScore(xml);
    expect(notes.map((n) => n.midi)).toEqual([60, 62, 60, 64]);
    expect(notes.map((n) => n.pass)).toEqual([0, 0, 1, 1]);
  });
});

describe('parseScore — parts', () => {
  test('lists the parts so the player can say which line is theirs', () => {
    const xml = `<score-partwise>
      <part-list>
        <score-part id="P1"><part-name>Flute</part-name></score-part>
        <score-part id="P2"><part-name>Piano</part-name></score-part>
      </part-list>
      <part id="P1">${measure(1, note('C', 5, 4), FOUR_FOUR)}</part>
      <part id="P2">${measure(1, note('C', 3, 4), '<attributes><divisions>1</divisions><staves>2</staves></attributes>')}</part>
    </score-partwise>`;
    const { parts } = parseScore(xml);
    expect(parts.map((p) => p.name)).toEqual(['Flute', 'Piano']);
    expect(parts[0].staves).toBe(1);
    expect(parts[1].staves).toBe(2);
  });

  test('partIndex chooses whose notes come back', () => {
    const xml = `<score-partwise>
      <part-list>
        <score-part id="P1"><part-name>Flute</part-name></score-part>
        <score-part id="P2"><part-name>Cello</part-name></score-part>
      </part-list>
      <part id="P1">${measure(1, note('C', 5, 4), FOUR_FOUR)}</part>
      <part id="P2">${measure(1, note('C', 3, 4), FOUR_FOUR)}</part>
    </score-partwise>`;
    expect(parseScore(xml, { partIndex: 1 }).notes[0].midi).toBe(48);
    expect(parseScore(xml).notes[0].midi).toBe(72);
  });

  test('a score-timewise file is refused by name rather than parsed as empty', () => {
    expect(() => parseScore('<score-timewise><measure/></score-timewise>')).toThrow(/timewise/i);
  });
});
