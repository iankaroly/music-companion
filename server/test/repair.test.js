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
