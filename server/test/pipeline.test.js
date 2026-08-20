import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { joinScores } from '../src/musicxml/assemble.js';
import { pageReport, qualityReport, sniffKind } from '../src/pipeline.js';
import { fixture, fixturePath } from './helpers.js';

test('sniffing routes on the bytes, not on the name', () => {
  assert.equal(sniffKind(Buffer.from('%PDF-1.7\n...'), 'anything.txt'), 'pdf');
  assert.equal(sniffKind(Buffer.from('<?xml version="1.0"?><score-partwise/>'), 'x.bin'), 'musicxml');
  assert.equal(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'x'), 'image');
  assert.equal(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'x'), 'image');
  assert.equal(sniffKind(Buffer.from('hello'), 'x.bin'), 'unknown');
  // A PDF renamed .musicxml is still a PDF.
  assert.equal(sniffKind(readFileSync(fixturePath('two-bar-tune.musicxml')), 'x.pdf'), 'musicxml');
});

test('joining pages continues the clock and keeps ids unique', () => {
  const page = parseMusicXml(fixture('two-bar-tune.musicxml'));
  const joined = joinScores([page, parseMusicXml(fixture('two-bar-tune.musicxml'))]);
  assert.equal(joined.parts[0].measures.length, 8);
  assert.equal(joined.parts[0].totalQuarters, 32);
  assert.deepEqual(joined.parts[0].measures.map((m) => m.number), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(joined.parts[0].measures.map((m) => m.startQuarter), [0, 4, 8, 12, 16, 20, 24, 28]);
  const ids = joined.parts[0].measures.flatMap((m) => m.notes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);
  // A note's own start must agree with the bar it now sits in.
  for (const measure of joined.parts[0].measures) {
    for (const note of measure.notes) {
      assert.equal(note.startQuarter, measure.startQuarter + note.measureQuarter);
    }
  }
});

test('a page recognised on its own keeps its page number through the join', () => {
  // What a per-page engine produces: two documents that each believe they are
  // page 1. The pipeline stamps them before joining; without that, every bar of
  // a twelve-page scan reports page 1 and nothing can be highlighted on paper.
  const pages = [1, 2].map((page) => {
    const parsed = parseMusicXml(fixture('two-bar-tune.musicxml'));
    for (const part of parsed.parts) {
      for (const measure of part.measures) {
        measure.layout.page = page;
        for (const note of measure.notes) note.layout.page = page;
      }
    }
    return parsed;
  });
  const joined = joinScores(pages);
  assert.deepEqual(joined.parts[0].measures.map((m) => m.layout.page), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(joined.parts[0].measures[5].notes[0].layout.page, 2);
});

test('joining one page is the identity', () => {
  const page = parseMusicXml(fixture('two-bar-tune.musicxml'));
  assert.equal(joinScores([page]), page);
});

test('the quality report counts what would break an alignment', () => {
  const clean = qualityReport(parseMusicXml(fixture('two-bar-tune.musicxml')));
  assert.equal(clean.ok, true);
  assert.equal(clean.rhythmScore, 1);
  assert.equal(clean.measures, 4);
  assert.equal(clean.irregularMeasures.length, 0);

  // A bar with a beat missing — what OMR does when it loses a note.
  const broken = parseMusicXml(`<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1"><attributes><divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      </measure>
      <measure number="2">
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration><type>half</type><dot/></note>
      </measure>
    </part></score-partwise>`);
  const report = qualityReport(broken);
  assert.equal(report.irregularMeasures.length, 1);
  assert.equal(report.irregularMeasures[0].number, '2');
  assert.equal(report.rhythmScore, 0.5);
});

test('a first bar that is too LONG is reported; a short one is a pickup', () => {
  const first = (quarters, beats) => `<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1"><attributes><divisions>1</divisions>
        <time><beats>${beats}</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>${quarters}</duration><type>whole</type></note>
      </measure>
      <measure number="2">
        <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
      </measure>
    </part></score-partwise>`;

  // Short: an upbeat, and normal.
  assert.equal(qualityReport(parseMusicXml(first(1, 4))).irregularMeasures.length, 0);
  // Long: the OMR put a beat in bar 1 that is not printed there, and every note
  // after it is now late. This must not be waved through as a pickup.
  const over = qualityReport(parseMusicXml(first(5, 4)));
  assert.equal(over.irregularMeasures.length, 1);
  assert.equal(over.irregularMeasures[0].number, '1');
  assert.equal(over.irregularMeasures[0].quarters, 5);
});

test('a page the engine found nothing on degrades instead of crashing', async () => {
  // oemer on a blank or unreadable page can return a part with no measures.
  // Everything downstream must survive it: this is the shape of a bad scan,
  // not an impossible input.
  const { buildTimeline, quarterAt } = await import('../src/musicxml/timeline.js');
  const { cursorAt } = await import('../src/align/lookup.js');
  const { constantTimemap } = await import('../src/align/timemap.js');

  const empty = parseMusicXml(`<score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1"></part></score-partwise>`);
  assert.equal(empty.parts[0].measures.length, 0);

  const report = qualityReport(empty);
  assert.equal(report.ok, false);
  assert.equal(report.notes, 0);

  const timeline = buildTimeline(empty);
  assert.equal(timeline.measures.length, 0);
  assert.equal(timeline.totalQuarters, 0);
  assert.equal(quarterAt(timeline, { measureNumber: '1' }), null);

  const map = constantTimemap({ quarterBpm: 90 });
  const cursor = cursorAt(timeline, map, 3);
  assert.equal(cursor.measure, null);
  assert.deepEqual(cursor.sounding, []);
  assert.equal(cursor.finished, true);
});

test('a score split across two parts is counted whole, not halved', async () => {
  // What Audiveris does to a photographed page: one instrument's line comes
  // back as two parts. Reporting only the first is how 249 notes get reported
  // as 136.
  const twoParts = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>Voice</part-name></score-part>
      <score-part id="P2"><part-name>Voice</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure></part></score-partwise>`);

  const report = qualityReport(twoParts);
  assert.equal(report.notes, 3);      // 1 + 2 across the parts, not 1
  // ...but ONE bar: measure 1 of P1 and measure 1 of P2 are the same bar.
  assert.equal(report.measures, 1);
  assert.deepEqual(report.parts.map((p) => p.notes), [1, 2]);
});

test('the timeline follows the part with the music in it', async () => {
  const { buildTimeline } = await import('../src/musicxml/timeline.js');
  // OMR gave part P1 almost nothing and put the line in P2. Aligning a
  // recording to P1 would look like the pipeline had lost the piece.
  const lopsided = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>Voice</part-name></score-part>
      <score-part id="P2"><part-name>Voice</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><rest/><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>half</type></note>
    </measure></part></score-partwise>`);

  assert.equal(buildTimeline(lopsided).partId, 'P2');
  assert.equal(buildTimeline(lopsided).noteCount, 3);
  // And a caller who knows better can still say which.
  assert.equal(buildTimeline(lopsided, { partId: 'P1' }).partId, 'P1');
});

test('pages are reported across every part of the page', async () => {
  const { pageReport } = await import('../src/pipeline.js');
  const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
  const rows = pageReport(score, { meta: { failures: [{ page: 2, error: 'no staves found' }] } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'read');
  assert.equal(rows[0].measures, 4);
  assert.equal(rows[1].status, 'failed');
  assert.match(rows[1].error, /no staves/);
});

test('pages that disagree about their part count say so', () => {
  const onePart = parseMusicXml(fixture('two-bar-tune.musicxml'));
  const twoParts = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>a</part-name></score-part>
      <score-part id="P2"><part-name>b</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);

  // What a mixed book looks like: Audiveris gave a page two parts, the engine
  // that rescued the next page gave it one.
  const joined = joinScores([twoParts, onePart]);
  assert.deepEqual(joined.partCountMismatch, [1, 2]);
  assert.equal(qualityReport(joined).partCountMismatch.length, 2);

  // And a book where every page agrees says nothing.
  assert.equal(joinScores([onePart, parseMusicXml(fixture('two-bar-tune.musicxml'))]).partCountMismatch, null);
});

test('a page missing a part contributes silence to it, so the parts stay in step', () => {
  const twoParts = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>a</part-name></score-part>
      <score-part id="P2"><part-name>b</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);
  const onePart = parseMusicXml(fixture('two-bar-tune.musicxml')); // 4 bars, one part

  const joined = joinScores([twoParts, onePart]);

  // Measure N of every part must be the same bar of music — a partwise score
  // means nothing otherwise, and a reader shows only the shortest part.
  assert.deepEqual(joined.parts.map((p) => p.measures.length), [5, 5]);
  assert.deepEqual(joined.parts.map((p) => p.totalQuarters), [20, 20]);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(
      joined.parts[0].measures[i].startQuarter,
      joined.parts[1].measures[i].startQuarter,
      `bar ${i} starts at the same moment in both parts`,
    );
  }
  // The part the second page did not have is silent there, not missing.
  assert.deepEqual(joined.parts[1].measures.slice(1).map((m) => m.notes.length), [0, 0, 0, 0]);
  assert.equal(joined.parts[1].measures[1].durationQuarters, 4);
  assert.deepEqual(joined.partCountMismatch, [1, 2]);
});

test('the per-page bars sum to the score bars, and the irregular count is not capped', () => {
  const score = parseMusicXml(fixture('two-bar-tune.musicxml'));
  const rows = pageReport(score, { meta: {} });
  const summed = rows.reduce((n, r) => n + r.measures, 0);
  // Three numbers that must agree: the rows, the score, and what a client sees.
  assert.equal(summed, score.measureCount);
  assert.equal(summed, score.parts[0].measures.length);

  // A book with more than fifty bad bars must report more than fifty. The bars
  // are made too LONG rather than too short, so that bar 1 is not exempt as a
  // pickup and the count is exactly what was put in.
  const many = { parts: [{ id: 'P1', name: 'x', measures: [] }] };
  for (let i = 0; i < 80; i += 1) {
    many.parts[0].measures.push({
      index: i, number: String(i + 1), durationQuarters: 5, nominalQuarters: 4,
      irregular: true, implicit: false, noteCount: 1,
      notes: [{ rest: false, midi: 60 }],
      layout: { page: 1 },
    });
  }
  const report = qualityReport(many);
  assert.equal(report.irregularCount, 80);
  assert.equal(report.irregularMeasures.length, 50);  // the list stays capped
  assert.equal(report.rhythmScore, 0);
});

test('an engine-invented title gives way to the filename, a real one does not', async () => {
  const { convert } = await import('../src/pipeline.js');
  const report = { stage() {}, log() {} };
  const run = (filePath, filename, title) => convert({
    scoreId: 'test', filePath, filename, kind: 'musicxml', engineId: 'musicxml', title, report,
    workDir: mkdtempSync(path.join(tmpdir(), 'title-')),
  });

  // The fixture prints "Fixture Tune", so that survives.
  assert.equal((await run(fixturePath('two-bar-tune.musicxml'), 'whatever.musicxml')).score.title, 'Fixture Tune');
  // An explicit title wins over both.
  assert.equal((await run(fixturePath('two-bar-tune.musicxml'), 'whatever.musicxml', 'My Take')).score.title, 'My Take');

  // oemer names every score after the image it read — "Page-001" is not a
  // title, it is the filename of a temporary PNG, and the person's own
  // filename is better.
  const invented = path.join(mkdtempSync(path.join(tmpdir(), 'title-')), 'x.musicxml');
  writeFileSync(invented, `<score-partwise version="4.0">
    <work><work-title>Page-001</work-title></work>
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);
  assert.equal((await run(invented, 'Brahms sonata.pdf')).score.title, 'Brahms sonata');
});

test('a padded part does not inflate the bar count or the rhythm score', async () => {
  // Joining pages pads the parts a page did not have with silent bars, so the
  // parts stay in step. Those bars are this pipeline's doing, not the engine's
  // failure, and counting them turned "230 bars" into "264 bars that do not
  // add up" — a number larger than the piece.
  const twoParts = parseMusicXml(`<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>a</part-name></score-part>
      <score-part id="P2"><part-name>b</part-name></score-part>
    </part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part>
    <part id="P2"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);
  const joined = joinScores([twoParts, parseMusicXml(fixture('two-bar-tune.musicxml'))]);
  const report = qualityReport(joined);

  assert.equal(joined.parts.length, 2);
  assert.equal(joined.parts[0].measures.length, 5);
  assert.equal(report.measures, 5);                    // bars, counted once
  assert.equal(report.measures, joined.measureCount);  // and agreeing with the score
  assert.equal(report.notes, 13);                      // 2 + 11 pitched, across both parts
  assert.ok(report.irregularCount <= report.measures);
  assert.equal(report.emptyMeasures, 0);               // padding is not an empty bar
});

test('a title that is really our own filename gives way to the upload name', async () => {
  const { convert } = await import('../src/pipeline.js');
  const report = { stage() {}, log() {} };

  // What the server stores an upload as, and what oemer then calls the score.
  const dir = mkdtempSync(path.join(tmpdir(), 'title-'));
  const stored = path.join(dir, 'source.musicxml');
  writeFileSync(stored, `<score-partwise version="4.0">
    <work><work-title>Source</work-title></work>
    <part-list><score-part id="P1"><part-name>x</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure></part></score-partwise>`);

  const result = await convert({
    scoreId: 'test', filePath: stored, filename: 'Elgar cello concerto.jpg',
    kind: 'musicxml', engineId: 'musicxml', report,
    workDir: mkdtempSync(path.join(tmpdir(), 'title-')),
  });
  assert.equal(result.score.title, 'Elgar cello concerto');
  // And the file handed back carries it, not the plumbing name.
  assert.match(result.musicXml, /<work-title>Elgar cello concerto<\/work-title>/);
});
