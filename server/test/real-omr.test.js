// The parser against REAL engine output.
//
// Every other test in this suite runs on MusicXML written by hand in this repo,
// which proves the parser agrees with its author. This one runs on the file
// oemer actually produced from a scanned PDF of a Bach menuet — machine-written
// markup, with the oddities that come with it (a part called "Piano" for a
// cello part, a made-up title, bars that do not add up) — because that is the
// input this pipeline exists to handle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { joinScores } from '../src/musicxml/assemble.js';
import { buildTimeline } from '../src/musicxml/timeline.js';
import { buildTimemap } from '../src/align/timemap.js';
import { cursorAt, schedule } from '../src/align/lookup.js';
import { qualityReport } from '../src/pipeline.js';
import { fixture } from './helpers.js';

const source = fixture('oemer-real-page.musicxml');
const score = parseMusicXml(source);
const part = score.parts[0];

test('real oemer output parses into bars and notes', () => {
  assert.equal(part.measures.length, 20);
  const notes = part.measures.flatMap((m) => m.notes).filter((n) => !n.rest);
  assert.equal(notes.length, 319);
  assert.ok(notes.every((n) => Number.isFinite(n.midi)));
  assert.ok(notes.every((n) => n.durationQuarters > 0));
});

test('the clock runs continuously through it', () => {
  let expected = 0;
  for (const measure of part.measures) {
    assert.equal(measure.startQuarter, expected);
    expected = Math.round((expected + measure.durationQuarters) * 1e6) / 1e6;
  }
  assert.equal(part.totalQuarters, expected);
  // Notes agree with the bar they are in.
  for (const measure of part.measures) {
    for (const note of measure.notes) {
      assert.equal(note.startQuarter, Math.round((measure.startQuarter + note.measureQuarter) * 1e6) / 1e6);
    }
  }
});

test('what the engine got wrong is reported rather than smoothed over', () => {
  const report = qualityReport(score);
  // Seven of twenty bars do not add up — including bar 1, which is LONGER than
  // its time signature and so is not a pickup.
  assert.equal(report.irregularMeasures.length, 7);
  assert.equal(report.irregularMeasures[0].number, '1');
  assert.ok(report.irregularMeasures[0].quarters > report.irregularMeasures[0].expected);
  assert.equal(report.rhythmScore, 0.65);
  assert.equal(report.ok, false);
});

test('it aligns and the cursor lands inside the right bar', () => {
  const timeline = buildTimeline(score);
  assert.equal(timeline.measures.length, 20);
  assert.equal(timeline.repeated, false); // no repeat signs came back from OMR

  // Three taps, the way a player would give them.
  const map = buildTimemap([
    { quarter: timeline.measures[0].startQuarter, time: 1.2 },
    { quarter: timeline.measures[8].startQuarter, time: 22.0 },
    { quarter: timeline.measures[19].startQuarter, time: 49.5 },
  ]);

  const bar9 = timeline.measures[8];
  const inside = cursorAt(timeline, map, 22.5);
  assert.equal(inside.measure.measureNumber, bar9.measureNumber);
  assert.ok(inside.sounding.length > 0);

  const notes = schedule(timeline, map);
  assert.equal(notes.length, 319);
  assert.ok(notes.every((n) => n.endTime >= n.startTime));
  // Anchored bars land on their taps.
  assert.ok(Math.abs(notes[0].startTime - 1.2) < 0.001);
});

test('two real pages join into one continuous score', () => {
  // The multi-page path with real engine output on both sides: each document
  // believes it is page 1 of its own piece, exactly as a per-page engine hands
  // them over.
  const pages = [1, 2].map((page) => {
    const parsed = parseMusicXml(source);
    for (const p of parsed.parts) {
      for (const measure of p.measures) {
        measure.layout.page = page;
        for (const note of measure.notes) note.layout.page = page;
      }
    }
    return parsed;
  });

  const joined = joinScores(pages);
  assert.equal(joined.parts.length, 1);              // not split into two parts
  assert.equal(joined.parts[0].measures.length, 40);
  assert.deepEqual(
    joined.parts[0].measures.map((m) => m.number),
    Array.from({ length: 40 }, (_, i) => String(i + 1)),
  );
  assert.deepEqual([...new Set(joined.parts[0].measures.map((m) => m.layout.page))], [1, 2]);
  assert.equal(joined.parts[0].totalQuarters, part.totalQuarters * 2);

  const ids = joined.parts[0].measures.flatMap((m) => m.notes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);

  // And the joined score still behaves: one clock, end to end.
  const timeline = buildTimeline(joined);
  assert.equal(timeline.measures.length, 40);
  assert.equal(timeline.totalQuarters, part.totalQuarters * 2);
});
