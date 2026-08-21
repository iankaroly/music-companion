// Three ways a reading of a photograph broke the clock the audio is hung off.
// Each was found by reading the code and confirmed by running it; each of these
// fails with its fix removed.

import test from 'node:test';
import assert from 'node:assert/strict';

const { buildTimeline } = await import('../src/musicxml/timeline.js');
const { buildTimemap, at } = await import('../src/align/timemap.js').then(async (m) => ({
  buildTimemap: m.buildTimemap,
  at: m.timeAt ?? m.at ?? null,
}));

const { parseMusicXml } = await import('../src/musicxml/parse.js');

// A four-bar part, written out, so the shapes are the ones the parser really
// makes rather than ones a test invented.
const partXml = (bars) => `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">${bars}</part>
</score-partwise>`;

const bar = (number, notes, first = false) => `
  <measure number="${number}">
    ${first ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key>'
      + '<time><beats>4</beats><beat-type>4</beat-type></time>'
      + '<clef><sign>G</sign><line>2</line></clef></attributes>' : ''}
    ${notes}
  </measure>`;

const g4 = (opts = '') => `<note><pitch><step>G</step><octave>4</octave></pitch>`
  + `<duration>4</duration><voice>1</voice><type>quarter</type>${opts}</note>`;
const rest = (q) => `<note><rest/><duration>${q * 4}</duration><voice>1</voice></note>`;
const tieStart = '<tie type="start"/><notations><tied type="start"/></notations>';
const tieStop = '<tie type="stop"/><notations><tied type="stop"/></notations>';

const timelineOf = (xml) => buildTimeline(parseMusicXml(xml));

test('a tie only joins a note to the one that follows it', () => {
  // A recogniser invents a tie start; nothing closes it until the same pitch
  // turns up two bars later. That used to make a crotchet nine quarters long
  // and take the whole voice's timing with it.
  const xml = partXml([
    bar(1, g4(tieStart) + rest(3), true),
    bar(2, rest(4)),
    bar(3, rest(1) + g4(tieStop) + rest(2)),
  ].join(''));
  const timeline = timelineOf(xml);
  const gs = timeline.events.filter((n) => n.midi === 67);
  assert.equal(gs.length, 2, 'the far note is its own attack, not the tail of something');
  assert.equal(gs[0].durationQuarters, 1, 'the stray tie swallowed the bars between');
});

test('a tie that does abut still joins', () => {
  const xml = partXml([
    bar(1, g4(tieStart) + g4(tieStop) + rest(2), true),
  ].join(''));
  const gs = timelineOf(xml).events.filter((n) => n.midi === 67);
  assert.equal(gs.length, 1, 'a real tie is one attack');
  assert.equal(gs[0].durationQuarters, 2);
});

test('a tempo that is not a tempo is refused, not used', () => {
  const anchors = [{ quarter: 0, time: 0 }];
  for (const quarterBpm of [0, -60, Number.NaN, Infinity]) {
    assert.throws(
      () => buildTimemap(anchors, { quarterBpm }),
      /quarterBpm|tempo/i,
      `quarterBpm=${quarterBpm} built a map instead of being refused`,
    );
  }
  // And a real one still works.
  assert.ok(buildTimemap(anchors, { quarterBpm: 60 }));
});
