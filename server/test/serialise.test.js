// Writing MusicXML back out.
//
// The test that matters is a ROUND TRIP: parse, write, parse again, and every
// note must land in the same bar at the same moment with the same pitch. That
// is the property the multi-page path depends on — the file handed to a player
// for a twelve-page scan is written by this module, and if it drifts, so does
// every alignment made from the score they correct and send back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { scoreToMusicXml } from '../src/musicxml/serialise.js';
import { joinScores } from '../src/musicxml/assemble.js';
import { buildTimeline } from '../src/musicxml/timeline.js';
import { fixture } from './helpers.js';

const flat = (score) => score.parts.flatMap((p) => p.measures.flatMap((m) => m.notes));

function roundTrip(name) {
  const before = parseMusicXml(fixture(name));
  const after = parseMusicXml(scoreToMusicXml(before));
  return { before, after };
}

for (const name of ['two-bar-tune.musicxml', 'pickup-and-voices.musicxml', 'oemer-real-page.musicxml']) {
  test(`${name} survives a round trip note for note`, () => {
    const { before, after } = roundTrip(name);
    assert.equal(after.measureCount, before.measureCount);
    assert.equal(after.totalQuarters, before.totalQuarters);

    const a = flat(before);
    const b = flat(after);
    assert.equal(b.length, a.length);
    assert.deepEqual(b.map((n) => n.midi), a.map((n) => n.midi));
    assert.deepEqual(b.map((n) => n.startQuarter), a.map((n) => n.startQuarter));
    assert.deepEqual(b.map((n) => n.durationQuarters), a.map((n) => n.durationQuarters));
    assert.deepEqual(b.map((n) => n.rest), a.map((n) => n.rest));
    assert.deepEqual(b.map((n) => n.voice), a.map((n) => n.voice));
  });
}

test('bars keep their key, time, clef and page', () => {
  const { before, after } = roundTrip('two-bar-tune.musicxml');
  for (const [i, was] of before.parts[0].measures.entries()) {
    const now = after.parts[0].measures[i];
    assert.equal(now.number, was.number, `bar ${i} number`);
    assert.deepEqual(now.key.fifths, was.key.fifths);
    assert.deepEqual([now.time.beats, now.time.beatType], [was.time.beats, was.time.beatType]);
    assert.equal(now.clefs[0]?.sign, was.clefs[0]?.sign);
    assert.equal(now.layout.page, was.layout.page);
    assert.equal(now.layout.system, was.layout.system);
  }
});

test('the repeat structure survives, so the performance is the same length', () => {
  const { before, after } = roundTrip('two-bar-tune.musicxml');
  const was = buildTimeline(before);
  const now = buildTimeline(after);
  assert.equal(now.totalQuarters, was.totalQuarters);
  assert.deepEqual(
    now.measures.map((m) => `${m.measureNumber}/${m.pass}`),
    was.measures.map((m) => `${m.measureNumber}/${m.pass}`),
  );
});

test('a two-voice bar comes back as two voices, not one jumble', () => {
  const { after } = roundTrip('pickup-and-voices.musicxml');
  const bar = after.parts[0].measures[1];
  const second = bar.notes.find((n) => n.voice === '2');
  assert.equal(second.measureQuarter, 0);   // the <backup> was written
  assert.equal(second.durationQuarters, 3);
  assert.equal(second.midi, 48);
});

test('a joined multi-page score writes out as ONE file with every page in it', () => {
  const pages = [1, 2].map((page) => {
    const parsed = parseMusicXml(fixture('oemer-real-page.musicxml'));
    for (const p of parsed.parts) {
      for (const m of p.measures) {
        m.layout.page = page;
        for (const n of m.notes) n.layout.page = page;
      }
    }
    return parsed;
  });
  const joined = joinScores(pages);
  const written = parseMusicXml(scoreToMusicXml(joined));

  assert.equal(written.measureCount, 40);
  assert.equal(written.totalQuarters, joined.totalQuarters);
  assert.equal(flat(written).length, flat(joined).length);
  // The page break is in the file, so a reader lays it out as it was scanned.
  assert.deepEqual([...new Set(written.parts[0].measures.map((m) => m.layout.page))], [1, 2]);
});

test('a note the engine could not name becomes a rest of the right length', () => {
  // Keeping the TIME is what matters: an unnamed note dropped entirely would
  // shorten its bar and shift everything after it.
  const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
  score.parts[0].measures[0].notes[0].pitch = null;
  score.parts[0].measures[0].notes[0].midi = null;
  const after = parseMusicXml(scoreToMusicXml(score));
  const note = after.parts[0].measures[0].notes[0];
  assert.equal(note.rest, true);
  assert.equal(note.durationQuarters, 1);
  assert.equal(after.totalQuarters, score.totalQuarters);
});

test('a title can be corrected without touching anything else in the file', async () => {
  const { withTitle } = await import('../src/musicxml/serialise.js');
  const original = fixture('oemer-real-page.musicxml');

  const renamed = withTitle(original, 'Bach Menuet');
  assert.match(renamed, /<work-title>Bach Menuet<\/work-title>/);
  assert.doesNotMatch(renamed, /Page-001/);
  // Same length of music, same notes: only the one element moved.
  const before = parseMusicXml(original);
  const after = parseMusicXml(renamed);
  assert.equal(after.title, 'Bach Menuet');
  assert.equal(after.measureCount, before.measureCount);
  assert.equal(flat(after).length, flat(before).length);
  assert.equal(renamed.length - original.length, 'Bach Menuet'.length - 'Page-001'.length);
});

test('a file with no <work> gets one, and one with no title is left alone', async () => {
  const { withTitle } = await import('../src/musicxml/serialise.js');
  const bare = `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`;
  assert.equal(parseMusicXml(withTitle(bare, 'Untitled Scan')).title, 'Untitled Scan');
  assert.equal(withTitle(bare, null), bare);
  // Anything that is not a score is returned untouched rather than mangled.
  assert.equal(withTitle('not xml at all', 'x'), 'not xml at all');
});
