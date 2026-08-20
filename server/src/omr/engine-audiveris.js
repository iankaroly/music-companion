// Audiveris — the primary OMR engine.
//
// WHY THIS ONE IS PRIMARY: it is the only mature open-source OMR that (a) reads
// PDFs directly, (b) exports MusicXML with LAYOUT COORDINATES — <print>,
// system breaks, default-x/default-y on notes — and (c) handles multi-page,
// multi-system, multi-voice printed scores rather than one staff at a time.
// Those coordinates are what makes highlighting the bar you are hearing
// possible; an engine that returns notes without positions can be aligned to
// audio but cannot be drawn on the page.
//
// The cost is a JVM: Audiveris is Java, needs a JDK 21 runtime and Tesseract for
// its text. That is why this adapter is one of several rather than the only
// path — see `engine-oemer.js` for the no-Java option and `probe.js` for how a
// caller finds out what this machine can actually do.
//
// Batch invocation (Audiveris 5.3+):
//   audiveris -batch -export -output <dir> -- <input.pdf>
// which writes <dir>/<book>/<book>.mxl (compressed MusicXML).

import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';
import { rasterisePdf } from './pdf.js';
import { mapWithConcurrency } from '../util/pool.js';
import { readMusicXmlBuffer } from '../musicxml/mxl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Where the launcher may be, best guess first. */
const CANDIDATES = [
  process.env.AUDIVERIS_BIN,
  // What scripts/install-audiveris.sh builds: a gradle start script under the
  // `app` subproject of a checkout inside this repo.
  path.resolve(HERE, '../../.audiveris/app/build/install/app/bin/Audiveris'),
  'audiveris',
  '/Applications/Audiveris.app/Contents/MacOS/Audiveris',
  '/opt/audiveris/bin/Audiveris',
  '/usr/local/bin/audiveris',
].filter(Boolean);

/** Homebrew's JDKs are keg-only, so `java` is usually NOT on PATH. */
const JAVA_HOMES = [
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk',
  '/opt/homebrew/opt/openjdk@25',
  '/opt/homebrew/opt/openjdk@21',
  '/usr/local/opt/openjdk',
].filter(Boolean);

// Where Audiveris keeps the language data it can actually use.
//
// TESSDATA_PREFIX is only passed through when the CALLER set it. Pointing it at
// Homebrew's tessdata actively breaks OCR: Audiveris initialises Tesseract in
// legacy mode and Homebrew ships the LSTM-only build, so it finds eng, fails to
// load it, and logs "Tesseract couldn't load any languages!". Left alone,
// Audiveris uses its own folder — which scripts/install-audiveris.sh fills with
// the full file from the tessdata repository.
const AUDIVERIS_TESSDATA = process.env.HOME
  ? path.join(process.env.HOME, 'Library/Application Support/AudiverisLtd/audiveris/tessdata')
  : null;

async function firstExisting(paths) {
  for (const candidate of paths) {
    try { await access(candidate); return candidate; } catch { /* keep looking */ }
  }
  return null;
}

/**
 * The environment Audiveris needs to start.
 *
 * The gradle start script looks for `java` on PATH or under JAVA_HOME, and a
 * Homebrew JDK is on neither — so a working Audiveris fails with "JAVA_HOME is
 * not set" unless we hand it one. Tesseract's data is the same story: without
 * TESSDATA_PREFIX the OCR step throws part way through a book.
 */
async function environment() {
  const env = {};
  const javaHome = await firstExisting(JAVA_HOMES);
  if (javaHome) env.JAVA_HOME = javaHome;

  // NO WINDOW, AND NOTHING IN THE DOCK.
  //
  // Audiveris is a desktop application being used as a library here, and its
  // launcher starts a JVM with the AWT toolkit — so macOS treats every
  // conversion as an app being launched, and a Java icon jumps into the Dock
  // while somebody is trying to work. It surprised the person whose machine it
  // is, which is the definition of a thing that should not happen: they asked
  // for a score to be read, not for a program to open.
  //
  // `java.awt.headless` keeps it from ever making a window (the image classes
  // it actually needs work perfectly well headless — verified by running a
  // conversion with it on), and `apple.awt.UIElement` tells macOS this process
  // is not an app even if something does touch the toolkit.
  //
  // Appended to whatever the caller set, so AUDIVERIS_OPTS still works.
  const quiet = '-Djava.awt.headless=true -Dapple.awt.UIElement=true';
  env.AUDIVERIS_OPTS = process.env.AUDIVERIS_OPTS
    ? `${process.env.AUDIVERIS_OPTS} ${quiet}`
    : quiet;
  // Only when the caller asked for it — see AUDIVERIS_TESSDATA above.
  if (process.env.TESSDATA_PREFIX) env.TESSDATA_PREFIX = process.env.TESSDATA_PREFIX;
  return env;
}

async function locate() {
  for (const candidate of CANDIDATES) {
    if (candidate.includes('/')) {
      try { await access(candidate); return candidate; } catch { /* keep looking */ }
    } else {
      try {
        await run('which', [candidate], { timeoutMs: 5000 });
        return candidate;
      } catch { /* keep looking */ }
    }
  }
  return null;
}

/** Every .mxl/.xml Audiveris wrote, newest first. */
async function findExports(dir) {
  const found = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(mxl|musicxml|xml)$/i.test(entry.name)) {
        found.push({ path: full, mtime: (await stat(full)).mtimeMs });
      }
    }
  }
  await walk(dir);
  return found.sort((a, b) => b.mtime - a.mtime);
}

export const audiverisEngine = {
  id: 'audiveris',
  label: 'Audiveris 5 (Java)',
  accepts: ['pdf', 'image'],
  // Audiveris reads the PDF itself, at its own resolution.
  needsRaster: false,

  async available() {
    const bin = await locate();
    if (!bin) {
      return {
        ok: false,
        reason: 'audiveris not found',
        hint: 'set AUDIVERIS_BIN, or run scripts/install-audiveris.sh',
      };
    }
    const env = await environment();
    if (!env.JAVA_HOME && !process.env.PATH?.split(':').some((d) => d.includes('jdk'))) {
      return {
        ok: false,
        bin,
        reason: 'audiveris is installed but no JDK was found',
        hint: 'brew install openjdk, or set JAVA_HOME',
      };
    }
    // Text recognition is optional — without it Audiveris still reads notes,
    // it just cannot read the words — so a missing language file is reported
    // rather than treated as unavailable.
    const ocr = AUDIVERIS_TESSDATA ? await firstExisting([path.join(AUDIVERIS_TESSDATA, 'eng.traineddata')]) : null;
    return {
      ok: true,
      bin,
      javaHome: env.JAVA_HOME ?? null,
      ocr: ocr ? 'eng' : 'none — run scripts/install-audiveris.sh to fetch the language file',
      // Reported so it can be checked without starting a JVM: this is what
      // keeps a Java icon from jumping into the Dock mid-conversion.
      headless: /java\.awt\.headless=true/.test(env.AUDIVERIS_OPTS ?? ''),
    };
  },

  /**
   * @param {{inputPath:string, workDir:string, onLog?:Function, timeoutMs?:number}} job
   * @returns {Promise<{documents:{page:number|null, musicXml:string}[], meta:object}>}
   */
  async convert({
    inputPath, workDir, kind, dpi = 300, maxPages = 30, onLog, onProgress,
    timeoutMs = 60 * 60 * 1000,
  }) {
    const bin = await locate();
    if (!bin) throw new Error('audiveris is not installed on this machine');
    const env = await environment();

    // STRATEGY, and it is the whole answer to "make it work with many pages":
    //
    //   1. Give Audiveris the PDF whole. It is much the best outcome — one
    //      document, cross-page structure, page breaks and system breaks
    //      intact, and about 30 seconds a sheet.
    //   2. If that fails, fall back to ONE PAGE AT A TIME, rendered to images.
    //
    // Step 2 exists because of how Audiveris fails: a sheet it cannot measure
    // is REMOVED, and then the whole book refuses to export — "could not export
    // since transcription did not complete successfully". One bad page in
    // twenty costs you all twenty. Measured on a photographed concerto part:
    // sheet 2 was dropped for "a too low interline value of 2 pixels" and
    // sheets 1 and 3, which were fine, came back with nothing.
    //
    // Page by page, a bad page costs itself. And because we render the page
    // ourselves on that path, a page that failed can be retried BIGGER, which
    // is what Audiveris asks for by name when it drops one.

    try {
      onProgress?.(0, 'reading the whole book');
      return await runBook({ bin, env, inputPath, outDir: path.join(workDir, 'audiveris'), onLog, onProgress, timeoutMs });
    } catch (err) {
      if (kind !== 'pdf') throw err;
      onLog?.(`audiveris could not read the book in one pass (${err.message}) — retrying page by page`);
    }

    const { pages, truncated } = await rasterisePdf(inputPath, path.join(workDir, 'pages'), {
      dpi, maxPages, onLog,
    });

    // Counted as pages land, for the same reason as in the oemer adapter.
    let finished = 0;
    const tick = () => {
      finished += 1;
      onProgress?.(finished / pages.length, `page ${finished} of ${pages.length}`);
    };

    const results = await mapWithConcurrency(pages, concurrency(), async (page) => {
      // Each page gets two goes: as rendered, then at half again the
      // resolution, which is the fix Audiveris itself names for the failure
      // that drops a sheet ("the picture resolution is too low (try 300 DPI)").
      //
      // Measured caveat: on the one page available to test it — a photographed
      // concerto part whose scale step reports a 2-pixel interline — neither
      // 300 nor 450 dpi, nor a greyscale render, rescued it. The retry is kept
      // because Audiveris names the cause and it only costs a failing page,
      // but it is not a fix for a page that is simply too poor to read.
      const attempts = [
        { label: `${dpi}dpi`, path: page.path },
        { label: `${Math.round(dpi * 1.5)}dpi`, path: null },
      ];
      let lastError = null;
      for (const attempt of attempts) {
        try {
          let imagePath = attempt.path;
          if (!imagePath) {
            const bigger = await rasterisePdf(inputPath, path.join(workDir, `pages-${Math.round(dpi * 1.5)}`), {
              dpi: Math.round(dpi * 1.5), maxPages, onLog: () => {},
            });
            imagePath = bigger.pages.find((p) => p.page === page.page)?.path;
            if (!imagePath) throw lastError ?? new Error('could not re-render the page');
          }
          const result = await runBook({
            bin,
            env,
            inputPath: imagePath,
            outDir: path.join(workDir, `audiveris-p${page.page}-${attempt.label}`),
            onLog,
            timeoutMs,
          });
          onLog?.(`audiveris: page ${page.page} read at ${attempt.label}`);
          tick();
          return { page: page.page, musicXml: result.documents[0].musicXml };
        } catch (err) {
          lastError = err;
          onLog?.(`audiveris: page ${page.page} failed at ${attempt.label} — ${err.message}`);
        }
      }
      tick();
      throw lastError;
    });

    const documents = results.filter((r) => r.value).map((r) => r.value);
    const failures = results
      .filter((r) => r.error)
      .map((r) => ({ page: r.item.page, error: r.error.message }));

    if (documents.length === 0) {
      throw new Error(`Audiveris could not read any page (${failures.map((f) => f.error).join('; ')})`);
    }
    return {
      documents,
      meta: {
        engine: 'audiveris',
        bin,
        javaHome: env.JAVA_HOME ?? null,
        mode: 'page-by-page',
        dpi,
        pagesRead: documents.length,
        pagesTotal: pages.length,
        truncated,
        failures,
      },
    };
  },
};

/** How many JVMs at once. Each sheet holds its image in heap, so not many. */
function concurrency() {
  const asked = Number(process.env.AUDIVERIS_CONCURRENCY);
  if (Number.isFinite(asked) && asked > 0) return Math.floor(asked);
  // A sheet costs Audiveris roughly a gigabyte at 300 DPI; two at a time keeps
  // a 16GB machine comfortable and still halves the wall clock.
  return 2;
}

/** One Audiveris run over one input (a whole PDF, or a single page image). */
async function runBook({ bin, env, inputPath, outDir, onLog, onProgress, timeoutMs }) {
  // Audiveris announces each sheet as it starts it. That is the only progress
  // signal a whole-book engine gives, and on a forty-page score it is the
  // difference between a bar that moves and a spinner.
  let sheetsSeen = 0;
  let sheetsTotal = null;
  const watch = (line) => {
    onLog?.(line);
    const total = line.match(/(\d+)\s+sheets?/i);
    if (total) sheetsTotal = Number(total[1]);
    if (/Loading sheet/i.test(line)) {
      sheetsSeen += 1;
      onProgress?.(sheetsTotal ? Math.min(1, sheetsSeen / sheetsTotal) : 0, `sheet ${sheetsSeen}`);
    }
  };

  const result = await run(bin, [
    '-batch',       // no GUI
    '-export',      // write MusicXML
    // Swap each sheet out of memory once it is done. On a long book the JVM
    // otherwise holds every sheet's image at once and dies of heap exhaustion
    // half way through — which looks like a crash, not a memory setting.
    '-swap',
    '-output', outDir,
    '--',           // everything after this is an input file
    inputPath,
  ], { timeoutMs, onLog: watch, cwd: path.dirname(outDir), env });

  const exports = await findExports(outDir);
  if (exports.length === 0) {
    throw new Error('Audiveris produced no MusicXML — the scan may have no staves it could find');
  }

  // Audiveris writes ONE document for the whole book, pages included, so the
  // page field is null: the page numbers live inside the MusicXML, as <print>
  // elements, which is why this engine is the one that can put a bar on a page.
  const musicXml = readMusicXmlBuffer(await readFile(exports[0].path));
  return {
    documents: [{ page: null, musicXml }],
    meta: {
      engine: 'audiveris',
      bin,
      javaHome: env.JAVA_HOME ?? null,
      mode: 'whole-book',
      ms: result.ms,
      exportPath: exports[0].path,
      exportsFound: exports.length,
    },
  };
}
