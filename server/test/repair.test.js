// The engine's own file, made safe to draw.
//
// Audiveris writes a whole-measure rest with the length it measured for a bar
// it could not read — "3.875 quarters" — and no <type> to say what to draw.
// VexFlow answers "The provided duration is not valid" and refuses the WHOLE
// score, so one bad bar costs every good one and a player gets a blank panel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { repairForEngraving } = await import('../src/musicxml/repair.js');
const { fixturePath } = await import('./helpers.js');

const REST = `<measure number="12">
      <note>
        <rest measure="yes"/>
        <duration>93</duration>
        <voice>1</voice>
      </note>
    </measure>`;

test('a whole-measure rest is told what to draw', () => {
  const { xml, repaired } = repairForEngraving(REST);
  assert.equal(repaired, 1);
  assert.match(xml, /<type>whole<\/type>/);
  // The length is what the music is worth and is none of the engraver's
  // business: an alignment reads it, so it must come through untouched.
  assert.match(xml, /<duration>93<\/duration>/);
});

test('a rest that already says what it is, is left alone', () => {
  const already = REST.replace('<voice>1</voice>', '<voice>1</voice><type>whole</type>');
  assert.equal(repairForEngraving(already).repaired, 0);
});

test('ordinary notes are not touched', () => {
  const note = `<note><pitch><step>C</step><octave>4</octave></pitch>`
    + `<duration>24</duration><voice>1</voice><type>quarter</type></note>`;
  const { xml, repaired } = repairForEngraving(note);
  assert.equal(repaired, 0);
  assert.equal(xml, note);
});

test('a file with no measure rests comes back as it went in', () => {
  const xml = readFileSync(fixturePath('two-bar-tune.musicxml'), 'utf8');
  const out = repairForEngraving(xml);
  assert.equal(out.xml, xml);
  assert.equal(out.repaired, 0);
});

test('a note of no length never reaches the file', async () => {
  const { scoreToMusicXml } = await import('../src/musicxml/serialise.js');
  // A bar the recogniser measured as a hundredth of a quarter: it rounds to
  // nothing, and a note of no length with no type is what an engraver refuses
  // the whole score over. One of these left a ten-page book blank.
  const score = {
    title: 'a book with a broken bar',
    parts: [{
      id: 'P1',
      name: 'Voice',
      measures: [{
        index: 0, number: '1', startQuarter: 0, durationQuarters: 0.01, nominalQuarters: 4,
        time: { beats: 4, beatType: 4 }, key: { fifths: 0, mode: 'major' }, clefs: [], staves: 1,
        notes: [{
          measureQuarter: 0, durationQuarters: 0.01, midi: 60, rest: false, chord: false, grace: false,
          pitch: { step: 'C', alter: 0, octave: 4 }, voice: '1', staff: 1, layout: { page: 1, system: 1 },
        }],
      }],
      totalQuarters: 4,
    }],
  };
  const xml = scoreToMusicXml(score, { software: 'test' });
  const durations = [...xml.matchAll(/<duration>(\d+)<\/duration>/g)].map((m) => Number(m[1]));
  assert.ok(durations.length > 0, 'the note should be in the file at all');
  assert.ok(durations.every((d) => d >= 1), `a note of no length reached the file: ${durations}`);
});
