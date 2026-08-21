// The pipeline, end to end.
//
//   upload -> sniff -> OMR engine -> MusicXML -> score model -> timeline
//
// Each arrow is a module that knows nothing about the ones on either side of
// it, and this file is the only place that knows the order. That is the whole
// architecture: the OMR engine can be swapped, the storage can be swapped, and
// the alignment layer sits on the timeline rather than on any of it.
//
// The timeline is built and STORED at conversion time rather than computed per
// request. It is a pure function of the score, so caching it is safe, and it
// turns every later alignment call into a lookup rather than a re-parse.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { chooseEngine, ENGINES } from './omr/registry.js';
import { isPdf, rasterisePdf, countPdfPages } from './omr/pdf.js';
import { looksLikeZip } from './musicxml/mxl.js';
import { parseMusicXml } from './musicxml/parse.js';
import { joinScores } from './musicxml/assemble.js';
import { buildTimeline } from './musicxml/timeline.js';
import { scoreToMusicXml, withTitle } from './musicxml/serialise.js';
import { repairForEngraving } from './musicxml/repair.js';
import { steadyClefsAndKeys } from './musicxml/steady.js';
import { imagesToPdf, imageSize } from './scan/images-to-pdf.js';
import { clearWork, workDirFor } from './storage/store.js';
import { mapWithConcurrency } from './util/pool.js';
import { thinPages } from './util/thin-pages.js';
import config from './config.js';

/**
 * What kind of file did we just receive?
 *
 * Sniffed from the BYTES, not from the filename or the browser's content-type,
 * both of which are supplied by whoever is uploading. A .mxl and a .pdf are
 * routed completely differently, so getting this from a trusted source matters.
 */
export function sniffKind(buffer, filename = '') {
  if (isPdf(buffer)) return 'pdf';

  const head = buffer.subarray(0, 512).toString('latin1');
  // A .mxl is a zip; so is a .docx, so check that the zip smells like MusicXML.
  if (looksLikeZip(buffer)) {
    return head.includes('META-INF/container.xml') || /\.(musicxml|xml)/i.test(head) ? 'musicxml' : 'unknown';
  }
  if (/<\s*(score-partwise|score-timewise)/i.test(head) || head.includes('<?xml')) return 'musicxml';

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image';                       // JPEG
  if (head.startsWith('II*') || head.startsWith('MM\0*')) return 'image';             // TIFF, what scanners emit

  // Last resort: trust the extension, and let the engine fail loudly.
  if (/\.(png|jpe?g|tiff?|bmp)$/i.test(filename)) return 'image';
  if (/\.(musicxml|xml|mxl)$/i.test(filename)) return 'musicxml';
  return 'unknown';
}

/**
 * Run one upload all the way through.
 *
 * @param {{scoreId:string, filePath:string, filename:string, kind:string,
 *          engineId?:string, title?:string, workDir?:string,
 *          report:{stage:Function, log:Function}}} input
 * @returns {Promise<object>} the score, its timeline, the MusicXML, and what
 *   happened to each page along the way
 */
/**
 * How much of a reading is actually usable: bars that hold their beats.
 *
 * Not a count of notes — a page can come back with plenty of noteheads in bars
 * that make no rhythmic sense, and that is worse than fewer notes read
 * properly, because an alignment follows the bars. Not a percentage either: a
 * reading that found eight bars and got six right is not better than one that
 * found forty and got twenty.
 */
function barsThatAddUp(documents, title) {
  let good = 0;
  let bars = 0;
  let notes = 0;
  for (const document of documents) {
    try {
      const score = parseMusicXml(document.musicXml, { title });
      for (const part of score.parts) {
        for (const measure of part.measures) {
          bars += 1;
          if (!measure.irregular) good += 1;
          notes += measure.notes.filter((n) => !n.rest).length;
        }
      }
    } catch {
      return { good: 0, bars: 0, notes: 0 };
    }
  }
  return { good, bars, notes };
}

/**
 * A SECOND OPINION ON A PAGE THAT READ BADLY.
 *
 * A photograph can be handed to Audiveris as a picture, or wrapped in a page
 * and handed over as a document it renders itself. Neither is better than the
 * other — measured on three real pages, same camera, same music:
 *
 *   1800px page   as a picture 202 notes, 9 bars adding up   as a page 182, 13
 *   2000px page   as a picture 246 notes, 11 bars            as a page 120, 4
 *   3200px page   as a picture 151 notes, 8 bars             as a page 227, 11
 *
 * Always wrapping would have cost the middle page a third of its music; never
 * wrapping costs the other two. So a page that reads badly is read the other
 * way too, and the better of the two is kept. A page that read well is left
 * alone, and costs nothing.
 */
const RHYTHM_FLOOR = 0.6;   // of the other reading's share of sound bars
// The long edge a page is read at. Audiveris renders at 300 dpi — about 2500
// across — so more than this is memory spent on pixels it throws away.
const BIGGEST_WORTH_READING = 2600;

/**
 * Which of two readings of the same page to keep.
 *
 * MORE OF THE MUSIC WINS. What is wanted from a scan is the notes that are on
 * the page — "it should get all of the notes" — and a reading that found two
 * hundred of them is more of the page than one that found a hundred and twenty,
 * whatever else is true of it.
 *
 * WITH A FLOOR UNDER THE RHYTHM, because noteheads alone are a bad master: a
 * reading can come back covered in notes that make no rhythmic sense, and an
 * alignment follows bars, not noteheads. So a reading with more notes is kept
 * unless its bars are markedly worse than the one it would replace — worse by
 * more than a third of the proportion holding their beats.
 *
 * Measured, on the four readings this rule was written against (notes, and the
 * share of bars that hold their beats):
 *
 *   1800px  picture 202 @ 0.24   page 182 @ 0.35   -> the picture, 202
 *   2000px  picture 246 @ 0.31   page 120 @ 0.17   -> the picture, 246
 *   3200px  picture 151 @ 0.22   page 227 @ 0.31   -> the page, 227
 *   a PDF   300dpi  152 @ 0.31   450dpi 215 @ 0.27 -> the bigger render, 215
 *
 * @returns {'first'|'second'}
 */
export function chooseReading(first, second) {
  if (second.notes <= first.notes) return 'first';
  const share = (r) => (r.bars > 0 ? r.good / r.bars : 0);
  return share(second) >= share(first) * RHYTHM_FLOOR ? 'second' : 'first';
}

export async function convert({
  scoreId, filePath, filename, kind, engineId, title, report, workDir: workDirOverride,
  // The engine registry, injectable ONLY so the multi-page orchestration can be
  // tested without half an hour of real OMR. Production never passes it.
  registry = { chooseEngine, engines: ENGINES },
}) {
  report.stage('choosing an engine', 5);
  const { engine, degraded, note } = await registry.chooseEngine({ kind, requested: engineId });
  report.log(`engine: ${engine.label}${degraded ? ' (DEGRADED — not a real reading)' : ''}`);
  if (note) report.log(note);

  report.stage(`recognising with ${engine.id}`, 15);

  // Every engine runs as a child process with this as its working directory,
  // and spawn() fails with ENOENT when the cwd does not exist — reported as if
  // the BINARY were missing, which sends you looking in entirely the wrong
  // place. Make it before anyone can trip over it.
  //
  // The server keeps its scratch under the data directory so a failed job can
  // be inspected; the CLI passes its own temporary one and deletes it after.
  const workDir = workDirOverride ?? workDirFor(scoreId);
  await mkdir(workDir, { recursive: true });

  // BOTH WAYS AT ONCE.
  //
  // There is more than one way to hand the same page to a recogniser and none
  // of them is best — see chooseReading for the measurements. A photograph can
  // go as a picture or wrapped in a page the recogniser renders itself; a PDF
  // can be rendered by the recogniser at 300 or by us at 450, which on a real
  // page found 215 notes against 152.
  //
  // They used to be done one after the other, and only when the first came back
  // poor — which is most photographs, so most scans paid for two readings END
  // TO END: three Audiveris runs and twenty-three seconds for one page. They
  // are independent, the machine has two cores, and nobody is waiting on the
  // first to decide whether to start the second. Run together, a scan costs
  // about what the slower one costs, and the better of the two is still kept.
  // A TWELVE-MEGAPIXEL PHOTOGRAPH IS NOT TWELVE MEGAPIXELS OF MUSIC.
  //
  // Audiveris renders a page at 300 dpi — about 2500 pixels across — whatever
  // it is given, so the pixels beyond that buy nothing and cost a great deal:
  // four readings of a 12MP photograph at once put the service into memory it
  // does not have, and a page that reads as 306 notes on a laptop came back as
  // 51 from the machine. Brought down to the size the recogniser works at,
  // once, and every reading starts from that.
  let base = filePath;
  if (kind === 'image') {
    const size = imageSize(await readFile(filePath).catch(() => null) ?? Buffer.alloc(0));
    const longest = Math.max(size?.width ?? 0, size?.height ?? 0);
    if (longest > BIGGEST_WORTH_READING) {
      try {
        const smallerDir = path.join(workDir, 'to-size');
        await mkdir(smallerDir, { recursive: true });
        const wrapped = path.join(smallerDir, 'page.pdf');
        await writeFile(wrapped, imagesToPdf([{ buffer: await readFile(filePath), name: filename }]));
        // The page is rendered at whatever dpi lands the long edge on the size
        // the recogniser wants.
        const shrink = BIGGEST_WORTH_READING / longest;
        const rendered = await rasterisePdf(wrapped, path.join(smallerDir, 'pages'), {
          dpi: Math.max(72, Math.round((engine.preferredDpi ?? config.omr.dpi) * shrink)),
          maxPages: 1,
          onLog: () => {},
        });
        if (rendered.pages.length) {
          base = rendered.pages[0].path;
          report.log(`the photograph is ${longest}px on its long edge; `
            + `read at ${BIGGEST_WORTH_READING}, which is what the recogniser works at`);
        }
      } catch (err) {
        report.log(`could not bring the photograph down to size (${err.message}) — reading it whole`);
      }
    }
  }

  const attempts = [{
    label: 'as it is',
    run: (signal) => engine.convert({
      signal,
      inputPath: base,
      workDir,
      kind,
      // The engine's own preference wins over the global default: see
      // engine-oemer.js for why one number cannot serve both engines.
      dpi: engine.preferredDpi ?? config.omr.dpi,
      maxPages: config.upload.maxPages,
      timeoutMs: config.omr.timeoutMs,
      onLog: (line) => report.log(line),
      // Recognition is nearly all of the wall clock, so it owns most of the
      // bar: 15% when it starts, 65% when it finishes.
      onProgress: (fraction, label) => report.stage(
        label ? `${engine.id}: ${label}` : `recognising with ${engine.id}`,
        15 + Math.max(0, Math.min(1, fraction)) * 50,
      ),
    }),
  }];

  // A book of twenty pages read several ways is twenty pages of somebody's time
  // and the whole machine. The other ways are for the scan somebody is waiting
  // on.
  const pagesIn = kind === 'pdf' ? await countPdfPages(filePath) : 1;
  if (pagesIn <= 4) {
    // MORE THAN ONE SIZE, BECAUSE ONE READING OF A HARD PAGE IS A LOTTERY.
    //
    // The same photographed page of a Mozart cadenza — dense semiquaver runs,
    // printed, clean — read as 271 notes at one size, 22 at the next size up,
    // and 298 at the one after that. Not a gradual falling-off with resolution:
    // a page where the recogniser either finds the beams or does not, and which
    // way it goes turns on a few pixels of staff spacing.
    //
    // There is no way to know in advance which size is the lucky one, and there
    // is no need to: they are independent, the machine has four cores, and the
    // reading that found most of the music is picked afterwards by measurement
    // rather than by hope (see chooseReading). Three sizes and the engine's own
    // rendering cost about what one costs in wall clock, and turn "it read
    // almost nothing this time" into a thing that has to happen three times
    // over before anybody sees it.
    for (const [label, times] of [['smaller', 0.7], ['bigger', 1.4]]) {
      attempts.push({
        label: `${label} (${times}x)`,
        run: async (signal) => {
          const at = path.join(workDir, `at-${times}`);
          await mkdir(at, { recursive: true });
          const source = kind === 'image' ? base : null;
          const asPdf = path.join(at, 'page.pdf');
          if (source) {
            await writeFile(asPdf, imagesToPdf([{ buffer: await readFile(source), name: filename }]));
          }
          const dpi = Math.round((engine.preferredDpi ?? config.omr.dpi) * times);
          const rendered = await rasterisePdf(source ? asPdf : base, path.join(at, 'pages'), {
            dpi, maxPages: config.upload.maxPages, onLog: () => {},
          });
          if (!rendered.pages.length) throw new Error('nothing came out of that render');
          const book = path.join(at, 'book.pdf');
          await writeFile(book, imagesToPdf(await Promise.all(rendered.pages.map(async (page) => ({
            buffer: await readFile(page.path),
            name: path.basename(page.path),
          })))));
          return engine.convert({
            signal,
            inputPath: book,
            workDir: at,
            kind: 'pdf',
            // The engine's own default: the page has already been rendered at
            // the size we wanted, and this number is what it renders its own
            // retries at.
            dpi: engine.preferredDpi ?? config.omr.dpi,
            maxPages: config.upload.maxPages,
            timeoutMs: config.omr.timeoutMs,
            onLog: () => {},
            onProgress: () => {},
          });
        },
      });
    }
    attempts.push({
      label: kind === 'image' ? 'as a page' : 'at a bigger render',
      run: async (signal) => {
        // The engine spawns with this as its cwd, and spawn() reports a missing
        // directory as a missing BINARY — which sent this one looking for
        // Audiveris on the PATH instead of for a folder nobody had made.
        const otherDir = path.join(workDir, 'other-way');
        await mkdir(otherDir, { recursive: true });
        const dpi = engine.preferredDpi ?? config.omr.dpi;
        let input = filePath;
        let asKind = kind;
        if (kind === 'image') {
          input = path.join(workDir, 'as-page.pdf');
          await writeFile(input, imagesToPdf([{ buffer: await readFile(filePath), name: filename }]));
          asKind = 'pdf';
        } else {
          const bigger = await rasterisePdf(filePath, path.join(workDir, 'bigger'), {
            dpi: Math.round(dpi * 1.5), maxPages: config.upload.maxPages, onLog: () => {},
          });
          if (!bigger.pages.length) throw new Error('nothing came out of the bigger render');
          // ALL of the pages, bound back into a book.
          //
          // Handing over bigger.pages[0] read the first page and quietly threw
          // the rest of the book away — and if that reading won on notes, so
          // did the book: a two-page scan came back with one page of music in
          // it, 37 bars where there should have been 73.
          input = path.join(workDir, 'bigger.pdf');
          await writeFile(input, imagesToPdf(await Promise.all(bigger.pages.map(async (page) => ({
            buffer: await readFile(page.path),
            name: path.basename(page.path),
          })))));
          asKind = 'pdf';
          // NOT the bigger dpi: the page has already been rendered bigger, and
          // this number is what the engine renders its OWN retries at. Passing
          // 450 here had it rescue the page a second time at 450 on top of a
          // 4800-pixel render: 109 notes, against 236 when left alone.
        }
        return engine.convert({
          signal,
          inputPath: input,
          workDir: otherDir,
          kind: asKind,
          dpi,
          maxPages: config.upload.maxPages,
          timeoutMs: config.omr.timeoutMs,
          onLog: () => {},
          onProgress: () => {},
        });
      },
    });
  }

  // AND THE SECOND ONE IS DROPPED WHEN IT IS NOT NEEDED.
  //
  // Both start together, so a page that needs the other way does not wait for
  // the first to finish failing. But a page that reads WELL first time needs
  // nothing else — and waiting for the other one anyway made a six-second page
  // take thirteen. So the first reading is looked at as soon as it lands: if it
  // is good, the other is stopped where it stands, which on a machine that
  // takes one job at a time is the next person's scan getting started sooner.
  // The readings share one signal, so a caller that gives up stops all of them
  // rather than leaving JVMs finishing answers nobody will read.
  const stopTheOther = new AbortController();
  const running = attempts.map((attempt, i) => attempt
    .run(i === 0 ? undefined : stopTheOther.signal)
    .then((documents) => ({ label: attempt.label, documents }))
    .catch((err) => ({ label: attempt.label, error: err })));

  // NO EARLY EXIT ON A GOOD-LOOKING FIRST READING.
  //
  // There was one, and it kept a reading of TWENTY-TWO notes off a page holding
  // three hundred — because it judged "good" by the SHARE of bars that hold
  // their beats, and a reading that found four bars and got three of them tidy
  // scores 75%. A ratio cannot tell a good reading from one that found almost
  // nothing; only the other readings can, and they were already running.
  //
  // So they are all waited for. On four cores that costs about what the slowest
  // one costs, and it is the difference between "sometimes it reads almost
  // nothing" and "it would have to go wrong three times over".
  const settled = await Promise.all(running);
  const firstAttempt = settled[0];
  const firstScore = firstAttempt.documents
    ? barsThatAddUp(firstAttempt.documents.documents, title)
    : null;

  const read = settled.filter((r) => r.documents);
  if (!read.length) throw settled[0].error;
  let reading = read[0].documents;
  let chose = read[0].label;
  if (read.length > 1) {
    const scored = read.map((r) => ({
      ...r,
      score: r === firstAttempt && firstScore ? firstScore : barsThatAddUp(r.documents.documents, title),
    }));
    const best = scored.reduce((winner, other) => (
      chooseReading(winner.score, other.score) === 'second' ? other : winner
    ));
    for (const one of scored) {
      report.log(`${one.label}: ${one.score.notes} notes, ${one.score.good} of ${one.score.bars} bars hold their beats`);
    }
    reading = best.documents;
    chose = best.label;
    report.log(`keeping the reading ${chose}`);
  }
  for (const r of settled) {
    // A reading stopped on purpose is not a reading that failed.
    if (r.error && !r.error.details?.dropped) {
      report.log(`reading it ${r.label} did not work (${r.error.message})`);
    }
  }
  const omr = reading;

  report.stage('parsing MusicXML', 68);
  const pageErrors = [];
  const parsedDocuments = [];
  // EACH DOCUMENT'S PAGES CARRY ON FROM THE LAST.
  //
  // A whole-book engine that writes one file per MOVEMENT numbers the pages
  // inside each one from 1. Joined as they came, a two-page scan is two page
  // ones — the join sees the page never change and writes no page break, so a
  // book that was two sheets came out as a single unbroken page of music. Each
  // document's pages are shifted past the last document's instead, which is
  // what puts a page break back where the sheet had one.
  let pagesSoFar = 0;
  for (const document of reading.documents) {
    try {
      const parsed = shiftPages(parseMusicXml(document.musicXml, { title }), pagesSoFar);
      pagesSoFar = highestPage(parsed) || pagesSoFar;
      parsedDocuments.push({
        page: document.page,
        musicXml: document.musicXml,
        score: stampPage(parsed, document.page),
      });
    } catch (err) {
      // One page of a scan that the engine mangled beyond parsing should cost
      // that page, not the job.
      pageErrors.push({ page: document.page, error: err.message });
      report.log(`page ${document.page ?? '?'} did not parse: ${err.message}`);
    }
  }

  // A second opinion on the pages that went badly.
  //
  // Two kinds of bad, and the second is the dangerous one. A page the engine
  // REFUSED throws, and everyone knows. A page it returned nearly EMPTY — two
  // bars where there are twenty — succeeds quietly and leaves a hole that only
  // shows up later as drift. Both get handed to the other engine, and whichever
  // read more of the page wins.
  const rescued = await rescueBadPages({
    kind, engine, omr, workDir, filePath, title, parsedDocuments, report,
    engines: registry.engines,
  });
  // Recorded whenever a second opinion actually RAN — not only when it helped.
  // A page both engines failed on must say so: "audiveris refused page 2" alone
  // sends someone off to fix Audiveris, when the truth is that nothing on this
  // machine can read that page.
  if (rescued.engineId) {
    omr.meta = {
      ...omr.meta,
      failures: rescued.stillFailed,
      rescuedPages: [...rescued.replaced.keys(), ...rescued.added.map((d) => d.page)],
      rescuedBy: rescued.replaced.size || rescued.added.length ? rescued.engineId : null,
    };
  }

  // The documents that actually made it into the score: what the primary read,
  // with any page a rescue read better swapped in, plus any page only the
  // rescue could read at all.
  const documents = parsedDocuments
    .map((d) => rescued.replaced.get(d.page) ?? d)
    .concat(rescued.added)
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  const parsed = documents.map((d) => d.score);

  if (parsed.length === 0) {
    throw new Error(`the engine produced MusicXML that could not be parsed: ${pageErrors.map((p) => p.error).join('; ')}`);
  }

  const score = joinScores(parsed);

  // Titles. An explicit one wins. Otherwise keep what is printed on the score —
  // unless the engine invented it, which it does constantly: oemer names every
  // score after the image file it was handed. That is "Page-001" for a
  // rasterised page, and "Source" for an upload the server stored as
  // source.jpg — a name from this pipeline's own plumbing, handed back to the
  // person as the title of their music.
  if (title) {
    score.title = title;
  } else if (!score.title || isInventedTitle(score.title, filePath, filename)) {
    score.title = filename ? filename.replace(/\.[^.]+$/, '') : score.title;
  }

  report.stage('building the timeline', 85);
  const timeline = buildTimeline(score);

  // The MusicXML we keep.
  //
  // ONE document from the engine: keep it exactly as written. It is the
  // engine's own output, with everything it knows that this model does not —
  // beams, slurs, layout — and provenance beats round-tripping.
  //
  // SEVERAL documents (a page-at-a-time engine): write the joined score out
  // ourselves. Handing back page 1 of a twelve-page scan and calling it the
  // MusicXML is the wrong answer to "turn my scan into a file", and stitching
  // the documents as TEXT would be guesswork about someone else's markup. The
  // model is what actually knows how the pages join, so it does the writing —
  // and what it cannot carry (engraving) is stated rather than implied.
  // Counted on the documents that made it into the SCORE, not on what the
  // engine first returned: a page swapped in by a rescue means the engine's own
  // file no longer describes what was parsed, and serving it would hand back a
  // document that disagrees with every other endpoint.
  const generatedMusicXml = documents.length > 1;
  // The engine's file, with only its title corrected when the engine invented
  // one — see withTitle — and with whole-measure rests told what to draw, which
  // is the difference between a score that engraves and one that refuses.
  // Everything else in it is exactly as written. See musicxml/repair.js.
  // Repaired either way. A file this pipeline WROTE should not need it — but a
  // ten-page book came back unengravable over two rests of no length, and a
  // score nobody can draw is a score nobody can use, whoever wrote it.
  const written = repairForEngraving(generatedMusicXml
    ? scoreToMusicXml(score, { software: `score-pipeline (from ${engine.id})` })
    : withTitle(documents[0].musicXml, score.title)).xml;

  // And the clefs and keys steadied — the recogniser's most expensive mistakes,
  // because a clef and a key persist. See musicxml/steady.js.
  const steadied = steadyClefsAndKeys(written);
  for (const line of steadied.notes) report.log(line);
  const musicXml = steadied.xml;

  // EVERY ANSWER OFF THE SAME READING.
  //
  // The score and the timeline were parsed before the clefs were steadied, so
  // leaving them would hand a client notes in one place and a file in another —
  // the bars a wrong clef displaced would be right in the download and wrong in
  // the API, which is the worst of both. Re-parsed from what is actually
  // served, and only when something changed.
  let finalScore = score;
  let finalTimeline = timeline;
  if (steadied.clefsFixed || steadied.keysFixed) {
    try {
      finalScore = parseMusicXml(musicXml, { title });
      finalTimeline = buildTimeline(finalScore);
    } catch (err) {
      report.log(`the steadied score would not re-parse (${err.message}) — keeping the first reading`);
      finalScore = score;
      finalTimeline = timeline;
    }
  }

  report.stage('done', 100);
  return {
    score: finalScore,
    timeline: finalTimeline,
    musicXml,
    omr: {
      engine: engine.id,
      degraded,
      note,
      documents: documents.length,
      generatedMusicXml,
      // Which engine's reading actually survived. `engine` is the one that was
      // chosen and ran first; when a second opinion replaced pages — or the
      // whole book — saying only the first would credit the wrong reader.
      rescuedBy: omr.meta?.rescuedBy ?? null,
      rescuedPages: omr.meta?.rescuedPages ?? [],
      meta: omr.meta,
      pageErrors,
    },
    // One row per page of the upload: what was read, and what was not. On a
    // twenty-page scan this is the first thing a person needs to see — a score
    // with a hole in it is worse than a short one, because an alignment that
    // spans the hole is wrong rather than incomplete.
    pages: pageReport(score, omr, pageErrors),
    // Quality signals a caller should look at before trusting an alignment.
    // OMR output that says "half these bars are the wrong length" is worth
    // surfacing at upload time, not discovering when the cursor drifts.
    quality: qualityReport(score),
    cleanup: async () => {
      if (workDirOverride) return;   // the caller owns its own directory
      if (!config.omr.keepWork) await clearWork(scoreId);
    },
  };
}

/**
 * Is this "title" just the name of the file the engine was handed?
 *
 * Matches a rasterised page name ("page-001"), the name the server stored the
 * upload under ("source"), and any exact echo of the input's own stem — all of
 * which are plumbing, not titles. A real <work-title> is left alone.
 */
function isInventedTitle(title, filePath, filename) {
  const stem = (name) => (name ? path.basename(name).replace(/\.[^.]+$/, '').toLowerCase() : null);
  const candidate = title.trim().toLowerCase();
  if (/^page[-_ ]?\d+$/.test(candidate)) return true;
  if (candidate === 'source' || candidate === stem(filePath)) return true;
  // An engine echoing the user's own filename is not wrong, just not useful —
  // and replacing it with the same string changes nothing.
  return candidate === stem(filename);
}

/**
 * Give the pages that went badly to a different engine.
 *
 * "Badly" is two things. A page the primary engine REFUSED — it threw, and its
 * page number is in `omr.meta.failures`. And a page it returned nearly EMPTY,
 * which is the more dangerous one: nothing errors, the job succeeds, and the
 * score has a hole in it that shows up much later as an alignment that drifts.
 * See util/thin-pages.js for where the line is drawn and why.
 *
 * The engines fail on different things — Audiveris on a page whose scale it
 * cannot measure, oemer on a page whose stafflines it cannot align — so the
 * second opinion is worth having. Whichever read MORE OF THE PAGE wins; a
 * rescue that came back thinner than the original is discarded.
 *
 * Bounded on purpose: one alternative engine, one attempt per bad page, only
 * for a PDF, and only when the primary read the pages separately — replacing
 * part of a whole-book document would mean splicing someone else's markup.
 *
 * @returns {Promise<{replaced:Map<number,object>, added:{page:number,score:object}[],
 *                    stillFailed:object[], engineId:string|null}>}
 */
async function rescueBadPages({
  kind, engine, omr, workDir, filePath, title, parsedDocuments, report, engines = ENGINES,
}) {
  const failures = omr.meta?.failures ?? [];
  const nothing = { replaced: new Map(), added: [], stillFailed: failures, engineId: null };
  // MusicXML that came in as MusicXML has nothing to re-read.
  if (kind !== 'pdf' && kind !== 'image') return nothing;

  const perPage = parsedDocuments.filter((d) => Number.isFinite(d.page));

  // A WHOLE-BOOK result is one document that covers every page, so a thin page
  // inside it cannot be swapped out — splicing into someone else's markup is
  // exactly what this pipeline refuses to do. But when EVERY page of it looks
  // thin, the document as a whole is the thing that went badly, and the other
  // engine can be asked for the entire book instead.
  //
  // This is the single-page case in disguise, and it is not rare: Audiveris
  // read a printed menuet page as 2 bars and reported success, where oemer read
  // 20. With one page there is no median to catch it, so without this the best
  // available answer is quietly thrown away.
  // A single image, or a whole-book PDF result: one document covering
  // everything. Both are handled the same way — count what came back, and if it
  // is nearly nothing, ask the other engine for the lot.
  if (perPage.length === 0 && parsedDocuments.length) {
    const byPage = new Map();
    for (const part of parsedDocuments[0].score.parts) {
      for (const measure of part.measures) {
        const page = measure.layout?.page ?? 1;
        byPage.set(page, (byPage.get(page) ?? new Set()).add(measure.index));
      }
    }
    const counts = [...byPage.entries()].map(([page, bars]) => ({ page, measures: bars.size }));
    const suspect = thinPages(counts);
    if (counts.length && suspect.length === counts.length) {
      return await rescueWholeBook({
        kind, engine, filePath, workDir, title, counts, parsedDocuments, report, engines,
      });
    }
    return nothing;
  }

  // Past this point a page is re-rendered from the PDF, which an upload that
  // was already one image cannot do — for that, the whole-document path above
  // is the only one, and it has already run.
  if (kind !== 'pdf') return nothing;

  const thin = perPage.length
    ? thinPages(perPage.map((d) => ({ page: d.page, measures: d.score.measureCount })))
    : [];
  const failed = failures.map((f) => f.page).filter(Number.isFinite);
  const wanted = [...new Set([...failed, ...thin])].sort((a, b) => a - b);
  if (wanted.length === 0) return nothing;

  const alternative = await firstAvailableEngine(
    engines.filter((e) => e.id !== engine.id && e.id !== 'fixture' && e.accepts.includes('image')),
  );
  if (!alternative) return nothing;

  report.log(
    `${wanted.length} page(s) went badly in ${engine.id}`
    + `${thin.length ? ` (${thin.length} came back nearly empty)` : ''}`
    + ` — asking ${alternative.id}`,
  );

  const dpi = alternative.preferredDpi ?? config.omr.dpi;
  const rescueDir = path.join(workDir, `rescue-${alternative.id}`);
  let rendered;
  try {
    rendered = await rasterisePdf(filePath, path.join(rescueDir, 'pages'), {
      dpi,
      maxPages: config.upload.maxPages,
      onLog: () => {},
    });
  } catch (err) {
    report.log(`could not re-render the pages to rescue: ${err.message}`);
    return nothing;
  }

  const replaced = new Map();
  const added = [];
  const stillFailed = [];

  // The rescues run concurrently, like the pages did: a book with six bad
  // pages would otherwise spend half an hour doing them one after another.
  const attempts = await mapWithConcurrency(wanted, rescueConcurrency(alternative), async (number) => {
    const image = rendered.pages.find((p) => p.page === number);
    if (!image) throw new Error('page could not be re-rendered');
    const result = await alternative.convert({
      inputPath: image.path,
      workDir: path.join(rescueDir, `p${number}`),
      kind: 'image',
      dpi,
      maxPages: 1,
      // Shorter than the primary's: see config.omr.rescueTimeoutMs.
      timeoutMs: config.omr.rescueTimeoutMs,
      // The rescuing engine sees one image and calls it "page 1", whichever
      // page of the book it really is. Say which, or the log is unreadable.
      onLog: (line) => report.log(`page ${number}: ${line}`),
    });
    // The alternative engine read one image, so its single document IS this
    // page, whatever page number it thinks it is looking at.
    return {
      musicXml: result.documents[0].musicXml,
      score: stampPage(parseMusicXml(result.documents[0].musicXml, { title }), number),
    };
  });

  for (const attempt of attempts) {
    const number = attempt.item;
    const original = perPage.find((d) => d.page === number) ?? null;

    if (attempt.error) {
      if (!original) {
        stillFailed.push({
          page: number,
          error: `${engine.id} and ${alternative.id} both failed: ${attempt.error.message}`,
        });
      } else if (/did not finish within/.test(attempt.error.message)) {
        // Worth distinguishing: this page was not refused, it was abandoned,
        // and a longer RESCUE_TIMEOUT_MS might have read it.
        report.log(`page ${number}: ${alternative.id} was still working after the rescue time limit — `
          + `keeping ${engine.id}'s reading (raise RESCUE_TIMEOUT_MS to wait longer)`);
      } else {
        report.log(`page ${number}: ${alternative.id} could not read it either`);
      }
      continue;
    }

    const { score, musicXml } = attempt.value;
    if (!original) {
      added.push({ page: number, score, musicXml });
      report.log(`page ${number} rescued by ${alternative.id}: ${score.measureCount} bars`);
    } else if (score.measureCount > original.score.measureCount) {
      replaced.set(number, { page: number, score, musicXml });
      report.log(
        `page ${number}: ${alternative.id} read ${score.measureCount} bars where `
        + `${engine.id} read ${original.score.measureCount} — keeping ${alternative.id}`,
      );
    } else {
      report.log(
        `page ${number}: ${alternative.id} read ${score.measureCount} bars, no better than `
        + `${engine.id}'s ${original.score.measureCount} — keeping ${engine.id}`,
      );
    }
  }

  return { replaced, added, stillFailed, engineId: alternative.id };
}

/**
 * How many rescues at once.
 *
 * The rescuing engine is running alongside nothing else at this point, so it
 * gets the same width it would get as the primary.
 */
function rescueConcurrency(engine) {
  const asked = Number(process.env.RESCUE_CONCURRENCY);
  if (Number.isFinite(asked) && asked > 0) return Math.floor(asked);
  return engine.id === 'oemer' ? Math.max(1, Math.floor(cpus().length / 4)) : 2;
}

/**
 * Ask the other engine for the whole book, when the primary barely read it.
 *
 * Only called when EVERY page of a whole-book result came back thin — see
 * rescueBadPages. Whichever engine read more of the book wins, so a wasted
 * attempt costs time and nothing else.
 */
async function rescueWholeBook({
  kind, engine, filePath, workDir, title, counts, parsedDocuments, report, engines = ENGINES,
}) {
  const nothing = { replaced: new Map(), added: [], stillFailed: [], engineId: null };
  const alternative = await firstAvailableEngine(
    engines.filter((e) => e.id !== engine.id && e.id !== 'fixture' && e.accepts.includes(kind)),
  );
  if (!alternative) return nothing;

  const had = counts.reduce((n, c) => n + c.measures, 0);
  report.log(
    `${engine.id} read the whole book as ${had} bar(s) over ${counts.length} page(s) — `
    + `that is nearly empty, so ${alternative.id} is being asked for the book instead`,
  );

  let result;
  try {
    result = await alternative.convert({
      inputPath: filePath,
      workDir: path.join(workDir, `rescue-${alternative.id}`),
      kind,
      dpi: alternative.preferredDpi ?? config.omr.dpi,
      maxPages: config.upload.maxPages,
      timeoutMs: config.omr.rescueTimeoutMs,
      onLog: (line) => report.log(line),
    });
  } catch (err) {
    report.log(`${alternative.id} could not read it either: ${err.message}`);
    return nothing;
  }

  const rescuedDocuments = [];
  for (const document of result.documents) {
    try {
      rescuedDocuments.push({
        page: document.page,
        musicXml: document.musicXml,
        score: stampPage(parseMusicXml(document.musicXml, { title }), document.page),
      });
    } catch (err) {
      report.log(`${alternative.id}'s output did not parse: ${err.message}`);
    }
  }

  const got = rescuedDocuments.reduce((n, d) => n + d.score.measureCount, 0);
  if (got <= had) {
    report.log(`${alternative.id} read ${got} bar(s), no better than ${engine.id}'s ${had} — keeping ${engine.id}`);
    return nothing;
  }

  report.log(`${alternative.id} read ${got} bars where ${engine.id} read ${had} — keeping ${alternative.id}`);
  // The primary's document is dropped entirely: this is a replacement of the
  // whole book, not of one page inside it.
  parsedDocuments.length = 0;
  return {
    replaced: new Map(),
    added: rescuedDocuments,
    stillFailed: result.meta?.failures ?? [],
    engineId: alternative.id,
  };
}

/** The first engine in the list that this machine can actually run. */
async function firstAvailableEngine(candidates) {
  for (const candidate of candidates) {
    if ((await candidate.available()).ok) return candidate;
  }
  return null;
}

/**
 * Put the page number back on a document that was recognised one page at a time.
 *
 * A per-page engine hands us N documents, each of which believes it is a whole
 * piece printed on page 1 — there is no <print page-number> in its output
 * because it never saw the other pages. Joining them without stamping would
 * report every bar of a twelve-page scan as page 1, which is exactly the
 * information the layout fields exist to carry.
 *
 * An engine that read the whole book itself passes `page: null` here, because
 * its MusicXML already knows.
 */
/**
 * Move a document's pages past the ones already read.
 *
 * See the join in convert(): a recogniser that writes a file per movement
 * numbers every one of them from page 1, and a book joined out of those has no
 * page breaks in it at all.
 */
function shiftPages(score, by) {
  if (!by) return score;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      measure.layout.page = (measure.layout.page ?? 1) + by;
      for (const note of measure.notes) note.layout.page = (note.layout.page ?? 1) + by;
    }
  }
  return score;
}

/** The last page this document reaches. */
function highestPage(score) {
  let top = 0;
  for (const part of score.parts) {
    for (const measure of part.measures) top = Math.max(top, measure.layout.page ?? 1);
  }
  return top;
}

function stampPage(score, page) {
  if (!page) return score;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      measure.layout.page = page;
      for (const note of measure.notes) note.layout.page = page;
    }
  }
  return score;
}

/**
 * One row per page: read or not, and how much came back.
 *
 * Two shapes have to produce the same table. A whole-book engine returns ONE
 * document that knows its own page breaks (`<print>`), so the pages are read
 * off the parsed measures. A per-page engine returns one document per page, so
 * the pages are the documents. Callers should not have to know which ran.
 */
export function pageReport(score, omr, pageErrors = []) {
  const failures = omr.meta?.failures ?? [];
  const rescued = new Set(omr.meta?.rescuedPages ?? []);
  const rows = new Map();

  // BARS are counted once each; NOTES are counted across every part.
  //
  // Both halves of that matter. Audiveris routinely splits one scanned page
  // into two parts — a photographed page came back as P1 and P2 holding 76
  // notes each — so counting notes on the first part alone halves the score.
  // But bar 12 of P1 and bar 12 of P2 are the SAME BAR, so counting measures
  // across parts would double it, and the rows would not sum to the score's
  // own bar count.
  const barsSeen = new Map();   // page -> Set of measure indices
  for (const part of score.parts) {
    for (const measure of part.measures) {
      const page = measure.layout?.page ?? 1;
      const row = rows.get(page) ?? { page, status: 'read', measures: 0, notes: 0 };
      if (!barsSeen.has(page)) barsSeen.set(page, new Set());
      barsSeen.get(page).add(measure.index);
      row.notes += measure.notes.filter((n) => !n.rest).length;
      rows.set(page, row);
    }
  }
  for (const [page, bars] of barsSeen) rows.get(page).measures = bars.size;

  for (const failure of failures) {
    rows.set(failure.page, {
      page: failure.page, status: 'failed', measures: 0, notes: 0, error: failure.error,
    });
  }
  for (const problem of pageErrors) {
    if (problem.page == null) continue;
    rows.set(problem.page, {
      page: problem.page,
      status: 'failed',
      measures: 0,
      notes: 0,
      error: `the engine's MusicXML for this page did not parse: ${problem.error}`,
    });
  }
  for (const page of rescued) {
    const row = rows.get(page);
    if (row) row.rescuedBy = omr.meta?.rescuedBy ?? null;
  }

  return [...rows.values()].sort((a, b) => a.page - b.page);
}

/**
 * Cheap, honest checks on what came back.
 *
 * None of these can tell you a note was read as the wrong PITCH — nothing can,
 * without the original. What they can tell you is that the RHYTHM does not add
 * up, which is the failure that actually breaks audio alignment: a bar half a
 * beat short shifts everything after it.
 */
export function qualityReport(score) {
  if (!score.parts?.length) return { ok: false, reason: 'no parts' };

  // BARS ARE COUNTED ONCE, NOTES ACROSS EVERY PART — the same rule as
  // pageReport, and for the same two reasons.
  //
  // Notes: Audiveris splits one scanned line into two parts, so counting the
  // first part alone halves the score.
  //
  // Bars: measure 12 of P1 and measure 12 of P2 are the SAME BAR, and joining
  // pages pads the parts that a page did not have with silent bars to keep them
  // in step. Counting part-measures would therefore compare against a total
  // twice the size of the piece — a book of 230 bars reporting "264 bars that
  // do not add up", which is not a number anyone can act on.
  const byIndex = new Map();
  let notes = 0;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      notes += measure.notes.filter((n) => !n.rest).length;
      const seen = byIndex.get(measure.index);
      if (!seen) { byIndex.set(measure.index, measure); continue; }
      // Keep the copy that carries the music: a padded silent bar must not
      // shadow the real one, in either direction.
      if (measure.notes.length > seen.notes.length) byIndex.set(measure.index, measure);
    }
  }
  const measures = [...byIndex.values()].sort((a, b) => a.index - b.index);

  // A first bar SHORTER than its time signature is a pickup and normal. A first
  // bar LONGER than it is an OMR error, and the worst one to hide: everything
  // after it is shifted. So the exemption is by direction, not by position.
  const isPickup = (m) => m.implicit || (m.index === 0 && m.durationQuarters < m.nominalQuarters);
  const irregular = measures.filter((m) => m.irregular && !isPickup(m));

  return {
    parts: score.parts.map((p) => ({
      id: p.id,
      name: p.name,
      measures: p.measures.length,
      notes: p.measures.flatMap((m) => m.notes).filter((n) => !n.rest).length,
    })),
    measures: measures.length,
    notes,
    // The list is capped so a badly-read book does not return a thousand rows;
    // the COUNT is not, because a capped number printed as a total is a lie
    // that only shows up on the books that are worst.
    irregularCount: irregular.length,
    irregularMeasures: irregular.map((m) => ({
      number: m.number, index: m.index, quarters: m.durationQuarters, expected: m.nominalQuarters,
    })).slice(0, 50),
    // A bar with nothing in it in ANY part — padding does not count, because
    // padding is this pipeline's doing, not the engine's failure.
    emptyMeasures: measures.filter((m) => m.notes.length === 0).length,
    unpitchedNotes: measures.flatMap((m) => m.notes).filter((n) => !n.rest && n.midi === null).length,
    // Pages that did not agree how many parts they held — see assemble.js. The
    // timeline follows the part with the most notes, so alignment still works,
    // but a client drawing "the score" should know it is not one clean stack.
    partCountMismatch: score.partCountMismatch ?? null,
    // A single number for a UI to threshold on. 1.0 means every bar adds up.
    rhythmScore: measures.length ? Math.round((1 - irregular.length / measures.length) * 1000) / 1000 : 0,
    ok: notes > 0 && irregular.length <= measures.length * 0.25,
  };
}
