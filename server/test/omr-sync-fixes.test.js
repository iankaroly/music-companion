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

test('a beat the bar does not have is refused, not moved to the next bar', async () => {
  const { quarterAt } = await import('../src/musicxml/timeline.js');
  // A 4/4 bar the recogniser read as one quarter long. Beats 2, 3 and 4 are not
  // in it; they used to resolve to the next bar's downbeat — all three to the
  // SAME quarter, which then made buildTimemap refuse the whole alignment.
  const timeline = {
    measures: [
      { ordinal: 0, measureIndex: 0, measureNumber: '1', pass: 1, startQuarter: 0, durationQuarters: 1, time: { beats: 4, beatType: 4 } },
      { ordinal: 1, measureIndex: 1, measureNumber: '2', pass: 1, startQuarter: 1, durationQuarters: 4, time: { beats: 4, beatType: 4 } },
    ],
  };
  assert.equal(quarterAt(timeline, { measureNumber: '1', beat: 1 }).quarter, 0);
  for (const beat of [2, 3, 4]) {
    assert.equal(quarterAt(timeline, { measureNumber: '1', beat }), null,
      `beat ${beat} of a one-quarter bar was placed somewhere instead of refused`);
  }
  // The next bar is untouched: its own beats still resolve inside it.
  assert.equal(quarterAt(timeline, { measureNumber: '2', beat: 3 }).quarter, 3);
});

test('an ending nobody closed does not swallow the rest of the piece', async () => {
  const { unfoldRepeats } = await import('../src/musicxml/timeline.js');
  const plain = { repeatForward: false, repeatBackward: false, repeatTimes: 2, endings: [] };
  const bar = (over = {}) => ({ barlines: { ...plain, ...over } });
  // A first ending whose stop hook the recogniser missed, then four more bars.
  const measures = [
    bar({ repeatForward: true }),
    bar(),
    bar({ endings: [{ type: 'start', numbers: [1] }], repeatBackward: true }),
    bar({ endings: [{ type: 'start', numbers: [2] }] }),
    bar(),
    bar(),
  ];
  const plan = unfoldRepeats(measures);
  const reached = new Set(plan.map((step) => step.measureIndex));
  for (const index of [0, 1, 2, 3, 4, 5]) {
    assert.ok(reached.has(index), `bar ${index} was never played — the piece was truncated`);
  }
});

test('two taps a hair apart are not a tempo of forty million', async () => {
  const { buildTimemap } = await import('../src/align/timemap.js');
  assert.throws(
    () => buildTimemap([{ quarter: 0, time: 0 }, { quarter: 4, time: 0.0000001 }]),
    /not a tempo/i,
  );
  assert.throws(
    () => buildTimemap([{ quarter: 0, time: 0 }, { quarter: 0.0001, time: 600 }]),
    /not a tempo/i,
  );
  assert.ok(buildTimemap([{ quarter: 0, time: 0 }, { quarter: 4, time: 2 }]));
});

test('a tempo the caller gave is what the ends are extrapolated at', async () => {
  const { buildTimemap, secondsAt } = await import('../src/align/timemap.js');
  // Anchors covering an interior span, taken at a rubato 240; the caller knows
  // the piece is 60. Before, bar 1 was extrapolated from the rubato.
  const anchors = [{ quarter: 8, time: 10 }, { quarter: 12, time: 11 }];
  const guessed = buildTimemap(anchors);
  const told = buildTimemap(anchors, { quarterBpm: 60 });
  assert.equal(told.headBpm, 60);
  assert.equal(told.tailBpm, 60);
  assert.notEqual(guessed.headBpm, told.headBpm);
  // Four quarters before the first anchor at 60 is four seconds earlier.
  assert.ok(Math.abs(secondsAt(told, 4) - 6) < 1e-6, `got ${secondsAt(told, 4)}`);
});

test('the timeline says how much of its clock is measurement rather than music', async () => {
  const { buildTimeline } = await import('../src/musicxml/timeline.js');
  const { parseMusicXml } = await import('../src/musicxml/parse.js');
  const { readFileSync } = await import('node:fs');
  const xml = readFileSync(
    new URL('../../test/fixtures/recognised-page.musicxml', import.meta.url), 'utf8',
  );
  const timeline = buildTimeline(parseMusicXml(xml));
  // A real page read off a photograph: bars that came up short, and by how much.
  assert.ok(timeline.barsShort > 0, 'a read page has short bars and should say so');
  assert.ok(timeline.adriftQuarters > 1, `only ${timeline.adriftQuarters} quarters adrift`);
  assert.ok(timeline.measures.every((m) => typeof m.shortByQuarters === 'number'));
});
