import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { buildTimeline } from '../src/musicxml/timeline.js';
import { constantTimemap } from '../src/align/timemap.js';
import { cursorAt, measureSchedule, schedule } from '../src/align/lookup.js';
import { fixture } from './helpers.js';

const timeline = buildTimeline(parseMusicXml(fixture('two-bar-tune.musicxml')));
// 60 quarter-bpm makes a quarter exactly one second, so every expectation below
// can be read as "bar 2 beat 1 is at four seconds" without doing arithmetic.
const map = constantTimemap({ quarterBpm: 60, totalQuarters: timeline.totalQuarters });

test('the cursor names the bar, the beat and the page', () => {
  const at = cursorAt(timeline, map, 4.5);
  assert.equal(at.quarter, 4.5);
  assert.equal(at.measure.measureNumber, '2');
  assert.equal(at.measure.beat, 1.5);
  assert.equal(at.measure.pass, 1);
  assert.equal(at.measure.page, 1);
  assert.equal(at.measure.startTime, 4);
  assert.equal(at.measure.endTime, 8);
});

test('the cursor knows which playing of a repeated bar it is in', () => {
  assert.equal(cursorAt(timeline, map, 0.5).measure.pass, 1);
  const second = cursorAt(timeline, map, 8.5);
  assert.equal(second.measure.measureNumber, '1');
  assert.equal(second.measure.pass, 2);
});

test('the notes sounding are the ones that have started and not ended', () => {
  const at = cursorAt(timeline, map, 2.2); // inside the dotted crotchet G
  assert.deepEqual(at.sounding.map((s) => s.midi), [55]);
  const chord = cursorAt(timeline, map, 14.5); // bar 3, the two-note chord
  assert.deepEqual(chord.sounding.map((s) => s.midi).sort((a, b) => a - b), [48, 55]);
});

test('a rest sounds nothing but the cursor still moves', () => {
  const at = cursorAt(timeline, map, 6.5);
  assert.deepEqual(at.sounding, []);
  assert.equal(at.measure.measureNumber, '2');
});

test('the cursor says how long until the next attack', () => {
  const at = cursorAt(timeline, map, 0.25);
  assert.equal(at.nextEvent.inSeconds, 0.75);
  assert.equal(at.nextEvent.noteId, 'P1-m0-v1-n1');
});

test('past the end, the cursor says so instead of pretending', () => {
  assert.equal(cursorAt(timeline, map, 25).finished, true);
  assert.equal(cursorAt(timeline, map, 5).finished, false);
});

test('the schedule gives every note a start and an end in seconds', () => {
  const notes = schedule(timeline, map);
  assert.equal(notes.length, timeline.noteCount);
  assert.equal(notes[0].startTime, 0);
  assert.equal(notes[0].endTime, 1);
  assert.ok(notes.every((n) => n.endTime >= n.startTime));
  // Every event carries the id of the notehead on the page, for highlighting.
  assert.ok(notes.every((n) => typeof n.noteId === 'string'));
});

test('the schedule can be windowed, which is how a long score is streamed', () => {
  const window = schedule(timeline, map, { from: 8, to: 12 });
  assert.ok(window.length > 0 && window.length < timeline.noteCount);
  assert.ok(window.every((n) => n.endTime >= 8 && n.startTime <= 12));
});

test('the measure schedule is contiguous and covers the performance', () => {
  const bars = measureSchedule(timeline, map);
  assert.equal(bars.length, 5);
  assert.equal(bars[0].startTime, 0);
  assert.equal(bars.at(-1).endTime, 20);
  for (let i = 1; i < bars.length; i += 1) {
    assert.equal(bars[i].startTime, bars[i - 1].endTime, `gap before bar ${i}`);
  }
});

test('a cursor lookup on a big score stays quick', () => {
  const started = process.hrtime.bigint();
  for (let i = 0; i < 2000; i += 1) cursorAt(timeline, map, (i % 200) / 10);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `2000 cursor lookups took ${ms.toFixed(0)}ms`);
});
