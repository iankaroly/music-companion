import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicXml, MusicXmlError } from '../src/musicxml/parse.js';
import { fixture } from './helpers.js';

const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
const part = score.parts[0];

test('reads the score header', () => {
  assert.equal(score.title, 'Fixture Tune');
  assert.equal(score.composer, 'Test Suite');
  assert.equal(part.name, 'Cello');
  assert.equal(part.id, 'P1');
});

test('every measure lands on the quarter clock, end to end', () => {
  assert.deepEqual(part.measures.map((m) => m.startQuarter), [0, 4, 8, 12]);
  assert.equal(part.totalQuarters, 16);
});

test('durations are converted out of divisions into quarters', () => {
  // divisions=4, so a <duration>6</duration> is a dotted crotchet.
  const dotted = part.measures[0].notes[2];
  assert.equal(dotted.durationQuarters, 1.5);
  assert.equal(dotted.midi, 55); // G3
});

test('a chord note starts with the note before it, not after', () => {
  const measure = part.measures[2];
  const [, , half, chordNote] = measure.notes;
  assert.equal(chordNote.chord, true);
  assert.equal(chordNote.measureQuarter, half.measureQuarter);
  assert.equal(measure.durationQuarters, 4); // the chord must not extend the bar
});

test('rests are notes with no pitch, and still take time', () => {
  const rest = part.measures[1].notes[1];
  assert.equal(rest.rest, true);
  assert.equal(rest.midi, null);
  assert.equal(rest.durationQuarters, 1);
});

test('ties, keys, times and clefs are read', () => {
  assert.equal(part.measures[1].notes[0].tieStart, true);
  assert.equal(part.measures[0].key.fifths, 0);
  assert.deepEqual(
    { b: part.measures[0].time.beats, t: part.measures[0].time.beatType },
    { b: 4, t: 4 },
  );
  assert.equal(part.measures[0].clefs[0].sign, 'F');
});

test('layout is carried through so a bar can be found on the page', () => {
  assert.equal(part.measures[0].layout.page, 1);
  assert.equal(part.measures[0].layout.system, 1);
  assert.equal(part.measures[2].layout.system, 2); // <print new-system="yes"/>
  assert.equal(part.measures[0].notes[0].layout.defaultX, 40);
});

test('a tempo direction becomes a mark on the part', () => {
  assert.deepEqual(part.tempoMarks, [{ measureIndex: 0, startQuarter: 0, quarterBpm: 90 }]);
});

test('note ids are unique across the part', () => {
  const ids = part.measures.flatMap((m) => m.notes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);
});

// --- the pickup and two-voice fixture ---------------------------------------

const voiced = parseMusicXml(fixture('pickup-and-voices.musicxml'));

test('a pickup bar is short, and flagged, and does not shift the clock', () => {
  const [pickup, first] = voiced.parts[0].measures;
  assert.equal(pickup.implicit, true);
  assert.equal(pickup.durationQuarters, 1);
  assert.equal(first.startQuarter, 1);
  assert.equal(first.durationQuarters, 3);
});

test('<backup> puts the second voice back at the start of the bar', () => {
  const notes = voiced.parts[0].measures[1].notes;
  const second = notes.find((n) => n.voice === '2');
  assert.equal(second.measureQuarter, 0);
  assert.equal(second.durationQuarters, 3);
  assert.equal(second.midi, 48);
});

test('an unrecognisable document fails as a MusicXmlError, not a crash', () => {
  assert.throws(() => parseMusicXml('<html><body>not music</body></html>'), MusicXmlError);
  assert.throws(() => parseMusicXml('this is not xml at all'), MusicXmlError);
});
