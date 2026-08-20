// The multi-page orchestration, without half an hour of real OMR.
//
// The behaviour that makes a long scan work is not in any one module — it is
// the ORDER the pipeline does things in: parse each page, notice which pages
// went badly, ask the other engine for those, keep whichever read more, join
// the lot into one continuous score. That is exactly the kind of logic that
// breaks silently, and testing it against real engines costs half an hour a
// run, which means in practice it does not get tested.
//
// So the engines here are stubs that return prepared MusicXML. Everything else
// — the thin-page rule, the replacement, the join, the page report, the
// serialiser — is the real thing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { convert } from '../src/pipeline.js';
import { parseMusicXml } from '../src/musicxml/parse.js';
import { fixturePath } from './helpers.js';

const quiet = { stage() {}, log() {} };
const logging = () => {
  const lines = [];
  return { stage() {}, log: (l) => lines.push(l), lines };
};

/** A page of `bars` bars, each one whole note, so bar counts are obvious. */
function pageXml(bars, { title = 'Stub', partId = 'P1' } = {}) {
  const measures = Array.from({ length: bars }, (_, i) => `
    <measure number="${i + 1}">
      ${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>' : ''}
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
    </measure>`).join('');
  return `<score-partwise version="4.0">
    <work><work-title>${title}</work-title></work>
    <part-list><score-part id="${partId}"><part-name>Stub</part-name></score-part></part-list>
    <part id="${partId}">${measures}</part>
  </score-partwise>`;
}

/**
 * An engine that returns one document per page, with the bar counts given.
 * `null` in the list means that page throws, the way a real engine refuses one.
 */
function stubEngine(id, barsPerPage, { accepts = ['pdf', 'image'], onConvert } = {}) {
  return {
    id,
    label: `stub ${id}`,
    accepts,
    needsRaster: false,
    async available() { return { ok: true }; },
    async convert({ kind }) {
      onConvert?.(kind);
      if (kind === 'image') {
        // Rescuing one page: the caller wants a single document back.
        const bars = barsPerPage.rescue;
        if (bars == null) throw new Error(`${id} cannot read this page`);
        return { documents: [{ page: null, musicXml: pageXml(bars, { title: id }) }], meta: { engine: id } };
      }
      const pages = barsPerPage.pages ?? barsPerPage;
      const documents = [];
      const failures = [];
      pages.forEach((bars, i) => {
        if (bars == null) failures.push({ page: i + 1, error: `${id} refused page ${i + 1}` });
        else documents.push({ page: i + 1, musicXml: pageXml(bars, { title: id }) });
      });
      if (documents.length === 0) throw new Error(`${id} could not read any page`);
      return { documents, meta: { engine: id, failures, pagesTotal: pages.length } };
    },
  };
}

function run(primary, alternative, options = {}) {
  const workDir = mkdtempSync(path.join(tmpdir(), 'multipage-'));
  const engines = [primary, alternative].filter(Boolean);
  return convert({
    scoreId: 'test',
    // A real PDF, because the rescue path re-renders pages from it.
    filePath: fixturePath('three-blank-pages.pdf'),
    filename: 'book.pdf',
    kind: 'pdf',
    report: options.report ?? quiet,
    workDir,
    registry: {
      chooseEngine: async () => ({ engine: primary, degraded: false, note: null }),
      engines,
    },
  }).finally(() => rmSync(workDir, { recursive: true, force: true }));
}

test('ten good pages join into one continuous score', async () => {
  const bars = [8, 9, 7, 8, 9, 8, 7, 9, 8, 6];
  const result = await run(stubEngine('primary', bars), null);

  const total = bars.reduce((a, b) => a + b, 0);
  assert.equal(result.score.measureCount, total);
  assert.equal(result.pages.length, 10);
  assert.deepEqual(result.pages.map((p) => p.measures), bars);
  // The rows sum to the score: three numbers that must always agree.
  assert.equal(result.pages.reduce((n, p) => n + p.measures, 0), result.score.measureCount);
  assert.equal(result.quality.measures, total);

  // One clock, running from the first bar of page 1 to the last of page 10.
  const measures = result.score.parts[0].measures;
  assert.equal(measures[0].startQuarter, 0);
  assert.equal(result.timeline.totalQuarters, total * 4);
  for (let i = 1; i < measures.length; i += 1) {
    assert.equal(measures[i].startQuarter, measures[i - 1].startQuarter + 4, `bar ${i}`);
  }
  // Page numbers survive, in order.
  assert.deepEqual([...new Set(measures.map((m) => m.layout.page))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // And the file is written from the model, since there were many documents.
  assert.equal(result.omr.generatedMusicXml, true);
  assert.equal(parseMusicXml(result.musicXml).measureCount, total);
});

test('a page the primary refused is read by the other engine and slotted in', async () => {
  const report = logging();
  const primary = stubEngine('primary', [8, null, 9]);   // page 2 refused
  const alternative = stubEngine('second', { rescue: 5 });
  const result = await run(primary, alternative, { report });

  assert.deepEqual(result.pages.map((p) => `${p.page}:${p.status}:${p.measures}`),
    ['1:read:8', '2:read:5', '3:read:9']);
  assert.equal(result.pages[1].rescuedBy, 'second');
  assert.equal(result.score.measureCount, 22);
  assert.equal(result.omr.rescuedBy, 'second');
  assert.ok(report.lines.some((l) => /rescued by second/.test(l)));
});

test('a page that came back nearly empty is re-read, and the better one wins', async () => {
  // The failure that succeeds: the primary returns 1 bar of a page that has 20.
  const primary = stubEngine('primary', [20, 1, 19, 20]);
  const alternative = stubEngine('second', { rescue: 18 });
  const result = await run(primary, alternative);

  assert.equal(result.pages[1].measures, 18);
  assert.equal(result.pages[1].rescuedBy, 'second');
  assert.equal(result.score.measureCount, 77);
  assert.deepEqual(result.omr.rescuedPages, [2]);
});

test('a second opinion that is no better is discarded', async () => {
  const report = logging();
  const primary = stubEngine('primary', [20, 2, 19, 20]);
  const alternative = stubEngine('second', { rescue: 1 });   // worse
  const result = await run(primary, alternative, { report });

  assert.equal(result.pages[1].measures, 2);        // the primary's is kept
  assert.equal(result.pages[1].rescuedBy, undefined);
  assert.ok(report.lines.some((l) => /no better than/.test(l)));
});

test('a page neither engine can read is reported, and the rest still align', async () => {
  const primary = stubEngine('primary', [8, null, 9]);
  const alternative = stubEngine('second', { rescue: null });   // throws too
  const result = await run(primary, alternative);

  const failed = result.pages.find((p) => p.status === 'failed');
  assert.equal(failed.page, 2);
  assert.match(failed.error, /both failed/);
  // The pages that worked are still one continuous score, and still alignable.
  assert.equal(result.score.measureCount, 17);
  assert.equal(result.timeline.totalQuarters, 68);
  assert.equal(result.quality.notes, 17);
});

test('with no second engine installed, the failure is simply reported', async () => {
  const result = await run(stubEngine('primary', [8, null, 9]), null);
  assert.equal(result.pages.find((p) => p.status === 'failed').page, 2);
  assert.equal(result.omr.rescuedBy, null);
  assert.equal(result.score.measureCount, 17);
});

test('bars, notes and quarters agree across every report, on a rescued book', async () => {
  const primary = stubEngine('primary', [10, 1, null, 12]);
  const alternative = stubEngine('second', { rescue: 9 });
  const result = await run(primary, alternative);

  const pagesBars = result.pages.filter((p) => p.status === 'read').reduce((n, p) => n + p.measures, 0);
  assert.equal(pagesBars, result.score.measureCount);
  assert.equal(pagesBars, result.quality.measures);
  assert.equal(result.timeline.totalQuarters, result.score.measureCount * 4);
  // One note per bar in these stubs, so notes must match bars exactly.
  assert.equal(result.quality.notes, result.score.measureCount);
  assert.ok(result.quality.irregularCount <= result.quality.measures);
});

test('thirty pages join without the ids or the clock going wrong', async () => {
  // Nothing here is quadratic and nothing is capped, but "it worked on three
  // pages" is not evidence for thirty, and the failures at scale (colliding
  // note ids, a clock that resets, page numbers that repeat) are all silent.
  const bars = Array.from({ length: 30 }, (_, i) => 6 + (i % 5));
  const result = await run(stubEngine('primary', bars), null);

  const total = bars.reduce((a, b) => a + b, 0);
  assert.equal(result.pages.length, 30);
  assert.equal(result.score.measureCount, total);
  assert.equal(result.timeline.totalQuarters, total * 4);

  const measures = result.score.parts[0].measures;
  // Measure numbers run 1..N with no repeats, and note ids are unique across
  // the whole book — an alignment points at notes by id.
  assert.deepEqual(measures.map((m) => m.number), measures.map((_, i) => String(i + 1)));
  const ids = measures.flatMap((m) => m.notes.map((n) => n.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(measures.map((m) => m.layout.page))], bars.map((_, i) => i + 1));

  // And the cursor still lands on the right bar at the far end of the book.
  const { buildTimemap } = await import('../src/align/timemap.js');
  const { cursorAt } = await import('../src/align/lookup.js');
  const map = buildTimemap([{ quarter: 0, time: 0 }, { quarter: total * 4, time: total * 2 }]);
  const last = result.timeline.measures.at(-1);
  const at = cursorAt(result.timeline, map, (last.startQuarter + 1) / 2);
  assert.equal(at.measure.ordinal, last.ordinal);
  assert.equal(at.measure.page, 30);
});

test('pages that disagree about their part count still line up in time', async () => {
  // The real mixed-engine shape: the primary reads a page as two parts, the
  // engine that rescues the next page reads it as one.
  const twoPartPage = (bars) => `<score-partwise version="4.0">
    <part-list>
      <score-part id="P1"><part-name>a</part-name></score-part>
      <score-part id="P2"><part-name>b</part-name></score-part>
    </part-list>
    ${['P1', 'P2'].map((id) => `<part id="${id}">${Array.from({ length: bars }, (_, i) => `
      <measure number="${i + 1}">
        ${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>' : ''}
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type></note>
      </measure>`).join('')}</part>`).join('')}
  </score-partwise>`;

  const primary = {
    id: 'primary',
    label: 'stub',
    accepts: ['pdf', 'image'],
    async available() { return { ok: true }; },
    async convert() {
      return {
        documents: [
          { page: 1, musicXml: twoPartPage(6) },
          { page: 2, musicXml: twoPartPage(1) },   // thin: gets a second opinion
          { page: 3, musicXml: twoPartPage(7) },
        ],
        meta: { engine: 'primary', failures: [] },
      };
    },
  };
  const result = await run(primary, stubEngine('second', { rescue: 5 }));

  assert.equal(result.pages[1].measures, 5);
  assert.equal(result.pages[1].rescuedBy, 'second');

  // Both parts run the whole length, and bar N is the same moment in each —
  // which is what a partwise score means, and what a reader needs to lay it out.
  const [first, second] = result.score.parts;
  assert.equal(result.score.parts.length, 2);
  assert.equal(first.measures.length, second.measures.length);
  assert.equal(first.totalQuarters, second.totalQuarters);
  for (let i = 0; i < first.measures.length; i += 1) {
    assert.equal(first.measures[i].startQuarter, second.measures[i].startQuarter, `bar ${i}`);
  }
  // The mismatch is recorded rather than hidden.
  assert.deepEqual(result.quality.partCountMismatch, [1, 2]);
  // Bars are counted once: 6 + 5 + 7, not doubled by the second part.
  assert.equal(result.quality.measures, 18);
  assert.equal(result.score.measureCount, 18);
});
