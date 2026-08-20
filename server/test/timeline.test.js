import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { buildTimeline, quarterAt, unfoldRepeats } from '../src/musicxml/timeline.js';
import { fixture } from './helpers.js';

const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
const timeline = buildTimeline(score);

test('the repeat is played, and the first-time bar is skipped on the way back', () => {
  // Printed: |: 1 | 2 (1st ending) :| 3 (2nd ending) | 4 |
  // Played:     1   2                1   3            4
  assert.deepEqual(
    timeline.measures.map((m) => `${m.measureNumber}/${m.pass}`),
    ['1/1', '2/1', '1/2', '3/2', '4/1'],
  );
});

test('the performance clock is longer than the printed one', () => {
  assert.equal(score.parts[0].totalQuarters, 16); // four printed bars
  assert.equal(timeline.totalQuarters, 20);       // five played bars
  assert.equal(timeline.repeated, true);
});

test('a bar played twice keeps one page position and gets two performance ones', () => {
  const [first, second] = timeline.measures.filter((m) => m.measureIndex === 0);
  assert.equal(first.scoreStartQuarter, second.scoreStartQuarter);
  assert.notEqual(first.startQuarter, second.startQuarter);
});

test('events point back at one notehead per playing', () => {
  const played = timeline.events.filter((e) => e.noteId === 'P1-m0-v1-n0');
  assert.equal(played.length, 2);
  assert.equal(new Set(played.map((e) => e.id)).size, 2); // ids unique per playing
});

test('events are sorted by time', () => {
  const starts = timeline.events.map((e) => e.startQuarter);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('a tie becomes one attack of the summed length', () => {
  const tied = parseMusicXml(`<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><tie type="start"/></note>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><tie type="stop"/></note>
      </measure>
    </part></score-partwise>`);
  const line = buildTimeline(tied);
  assert.equal(line.events.length, 1);
  assert.equal(line.events[0].durationQuarters, 2);
  assert.equal(line.events[0].tiedNoteIds.length, 1);
});

test('a tie whose far end the OMR missed does not swallow the piece', () => {
  // The fixture's C4 has a tie start and no matching stop anywhere.
  const orphan = timeline.events.find((e) => e.noteId === 'P1-m1-v1-n0');
  assert.equal(orphan.durationQuarters, 2);
});

test('times="3" plays the section three times', () => {
  const measures = [
    { barlines: { repeatForward: true, repeatBackward: false, repeatTimes: 2, endings: [] } },
    { barlines: { repeatForward: false, repeatBackward: true, repeatTimes: 3, endings: [] } },
  ];
  assert.deepEqual(unfoldRepeats(measures).map((s) => `${s.measureIndex}/${s.pass}`),
    ['0/1', '1/1', '0/2', '1/2', '0/3', '1/3']);
});

test('a corrupt repeat structure terminates instead of hanging', () => {
  const measures = Array.from({ length: 3 }, () => ({
    barlines: { repeatForward: true, repeatBackward: true, repeatTimes: 1e9, endings: [] },
  }));
  const plan = unfoldRepeats(measures);
  assert.ok(plan.length > 0 && plan.length <= 100000);
});

test('quarterAt turns "bar 3, beat 2" into a position', () => {
  const at = quarterAt(timeline, { measureNumber: '3', beat: 2 });
  assert.equal(at.quarter, 13); // bar 3 is played at q12, beat 2 is one quarter in
  assert.equal(at.span.pass, 2);
});

test('quarterAt picks the pass you ask for', () => {
  assert.equal(quarterAt(timeline, { measureNumber: '1', pass: 1 }).quarter, 0);
  assert.equal(quarterAt(timeline, { measureNumber: '1', pass: 2 }).quarter, 8);
  assert.equal(quarterAt(timeline, { measureNumber: '99' }), null);
});

test('beats are counted in the bar own unit', () => {
  const sixEight = parseMusicXml(`<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>
      <note><rest/><duration>6</duration><type>half</type><dot/></note>
    </measure></part></score-partwise>`);
  const line = buildTimeline(sixEight);
  // beat 4 of 6/8 is three quavers in = 1.5 quarters
  assert.equal(quarterAt(line, { measureNumber: '1', beat: 4 }).quarter, 1.5);
});
