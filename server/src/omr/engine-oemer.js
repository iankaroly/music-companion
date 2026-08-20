// oemer — the no-Java OMR engine.
//
// WHY IT IS HERE: Audiveris needs a JDK, which is a real barrier on a laptop
// and an awkward layer in a container. oemer is `pip install oemer`, runs an
// ONNX model, and needs nothing else. It is the engine that lets this pipeline
// be end-to-end runnable on a plain machine today.
//
// WHAT IT COSTS: oemer takes ONE IMAGE at a time, so multi-page PDFs are
// rasterised and fed page by page and the results joined downstream. Its
// MusicXML carries no layout coordinates and no page structure — the notes and
// the bars are there, where they sit on the paper is not. It is also weaker on
// multi-voice and piano scores.
//
// So: oemer to get running, Audiveris when the page positions matter. Both
// answer the same adapter interface, and nothing above this line knows which
// one ran.

import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './run.js';
import { readMusicXmlBuffer } from '../musicxml/mxl.js';
import { rasterisePdf } from './pdf.js';
import { mapWithConcurrency } from '../util/pool.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENV_BIN = path.resolve(HERE, '../../.venv/bin/oemer');

const CANDIDATES = [process.env.OEMER_BIN, VENV_BIN, 'oemer'].filter(Boolean);

async function locate() {
  for (const candidate of CANDIDATES) {
    if (candidate.includes('/')) {
      try { await access(candidate); return candidate; } catch { /* keep looking */ }
    } else {
      try { await run('which', [candidate], { timeoutMs: 5000 }); return candidate; } catch { /* keep looking */ }
    }
  }
  return null;
}

export const oemerEngine = {
  id: 'oemer',
  label: 'oemer (Python/ONNX)',
  accepts: ['pdf', 'image'],
  // It cannot open a PDF; the pipeline renders pages first.
  needsRaster: true,
  // And it wants a SMALLER page than Audiveris does. oemer's post-processing
  // after the model runs is pixel-wise work in Python, so its cost grows with
  // the square of the resolution: a 300dpi A4 page spends many minutes in
  // "extracting layers of different symbols" where a 200dpi one is a fraction
  // of that, and the model resizes to its own scale either way. Each engine
  // knows what it wants; the pipeline asks rather than imposing one number.
  preferredDpi: Number(process.env.OEMER_DPI) || 200,

  async available() {
    const bin = await locate();
    if (!bin) {
      return {
        ok: false,
        reason: 'oemer not found',
        hint: 'run scripts/install-oemer.sh (creates server/.venv), or set OEMER_BIN',
      };
    }
    return { ok: true, bin };
  },

  /**
   * @param {{inputPath:string, workDir:string, kind:'pdf'|'image', dpi?:number,
   *          maxPages?:number, onLog?:Function, timeoutMs?:number}} job
   */
  async convert({
    inputPath, workDir, kind, dpi = 200, maxPages = 30, onLog, onProgress,
    timeoutMs = 20 * 60 * 1000,
  }) {
    const bin = await locate();
    if (!bin) throw new Error('oemer is not installed on this machine');

    let truncated = false;
    let pages;
    if (kind === 'pdf') {
      const rendered = await rasterisePdf(inputPath, path.join(workDir, 'pages'), { dpi, maxPages, onLog });
      pages = rendered.pages;
      truncated = rendered.truncated;
    } else {
      pages = [{ path: inputPath, page: 1 }];
    }

    const outDir = path.join(workDir, 'oemer');

    // Progress is counted as pages LAND, not as they start: with several in
    // flight at once, "page 3 of 12" would otherwise mean nothing.
    let finished = 0;
    const tick = () => {
      finished += 1;
      onProgress?.(finished / pages.length, `page ${finished} of ${pages.length}`);
    };

    // Pages run CONCURRENTLY. oemer takes about four minutes on an A4 page and
    // saturates three or four cores; one at a time left a ten-core machine
    // mostly idle and a twelve-page scan taking the best part of an hour.
    const results = await mapWithConcurrency(pages, concurrency(), async (page) => {
      // ONE attempt per page, deliberately. oemer's own retry knobs were
      // measured and do not earn their cost: the page of a photographed
      // concerto part it dies on ("max() arg is an empty sequence" in
      // align_staffs) fails identically with deskewing off and at 300 dpi
      // instead of 200. A retry that has never rescued a page just doubles the
      // four minutes a failing page already costs. The rescue that IS worth
      // trying is a different ENGINE, and the pipeline does that after this.
      const pageOut = path.join(outDir, `p${String(page.page).padStart(3, '0')}`);
      try {
        // oemer opens its output path without creating the directory: a missing
        // one fails with FileNotFoundError AFTER the whole page has been
        // recognised, which is four minutes of work thrown away at the last line.
        await mkdir(pageOut, { recursive: true });
        await run(bin, [page.path, '-o', pageOut], {
          timeoutMs,
          onLog,
          // Keep matplotlib from trying to open a window on a headless box.
          env: { MPLBACKEND: 'Agg' },
        });
        const written = (await readdir(pageOut)).filter((f) => /\.(musicxml|xml|mxl)$/i.test(f));
        if (written.length === 0) throw new Error('oemer wrote no MusicXML');
        onLog?.(`oemer: page ${page.page} read`);
        tick();
        return {
          page: page.page,
          musicXml: readMusicXmlBuffer(await readFile(path.join(pageOut, written[0]))),
        };
      } catch (err) {
        onLog?.(`oemer: page ${page.page} failed — ${err.message}`);
        tick();
        throw err;
      }
    });

    const documents = results.filter((r) => r.value).map((r) => r.value);
    const failures = results
      .filter((r) => r.error)
      .map((r) => ({ page: r.item.page, error: r.error.message }));

    if (documents.length === 0) {
      throw new Error(`oemer could not read any page (${failures.map((f) => f.error).join('; ')})`);
    }
    return {
      documents,
      meta: {
        engine: 'oemer',
        bin,
        dpi,
        concurrency: concurrency(),
        pagesRead: documents.length,
        pagesTotal: pages.length,
        truncated,
        failures,
      },
    };
  },
};

/**
 * How many pages at once.
 *
 * oemer uses three to four cores per page, so the useful number is roughly a
 * quarter of the machine — more than that and the pages contend rather than
 * overlap.
 */
function concurrency() {
  const asked = Number(process.env.OEMER_CONCURRENCY);
  if (Number.isFinite(asked) && asked > 0) return Math.floor(asked);
  return Math.max(1, Math.min(4, Math.floor(cpus().length / 4)));
}
