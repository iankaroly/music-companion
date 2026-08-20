// Turning an uploaded PDF into what an OMR engine can read.
//
// Two engines, two needs: Audiveris opens a PDF itself, oemer (and every
// deep-learning OMR model) wants one bitmap per page. So this file owns
// rasterising, and nothing else in the pipeline knows how it is done.
//
// Ghostscript is the rasteriser because it is already on most machines that do
// anything with scores, and pdftoppm (poppler) is used when it is there because
// it is faster. Both are run with argv only and with the sandbox flags on: a
// scanned PDF is UNTRUSTED INPUT, and PDF interpreters are a classic place to
// get owned.
//
// 300 dpi is the default because that is where staff lines on a scan are thick
// enough for the models that were trained on printed music, and because
// Audiveris's own documentation asks for it. Below ~200 dpi recognition falls
// off a cliff; above 400 the memory cost doubles for nothing.

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { canRun, run } from './run.js';

export const PDF_MAGIC = '%PDF-';

/** Does this buffer start with a PDF header? */
export function isPdf(buffer) {
  // Some scanners put junk before the header, so allow a small offset —
  // the same tolerance every PDF reader has.
  return buffer.subarray(0, 1024).includes(PDF_MAGIC);
}

/** Which rasteriser this machine has, if any. */
export async function findRasteriser() {
  if (await canRun('pdftoppm', ['-v'])) return 'pdftoppm';
  if (await canRun('gs', ['--version'])) return 'gs';
  return null;
}

/**
 * Render a PDF to one PNG per page.
 *
 * @param {string} pdfPath
 * @param {string} outDir
 * @param {{dpi?:number, maxPages?:number, onLog?:Function}} [options]
 * @returns {Promise<{pages:{path:string, page:number}[], truncated:boolean}>}
 *   `truncated` means the document has more pages than the cap allowed.
 */
export async function rasterisePdf(pdfPath, outDir, options = {}) {
  const { dpi = 300, maxPages = 40, onLog } = options;
  await mkdir(outDir, { recursive: true });

  const tool = await findRasteriser();
  if (!tool) {
    throw new Error(
      'no PDF rasteriser found — install poppler (`brew install poppler`) or ghostscript (`brew install ghostscript`)',
    );
  }

  // Render ONE PAGE MORE than we will use. If that extra page exists, the
  // document is longer than the cap and the caller must be told rather than
  // silently handed the first half of a piece — an alignment against a score
  // that stops at bar 200 of 400 looks like it works until it does not.
  const probeLast = maxPages + 1;

  if (tool === 'pdftoppm') {
    await run('pdftoppm', [
      '-png', '-r', String(dpi),
      '-f', '1', '-l', String(probeLast),
      pdfPath, path.join(outDir, 'page'),
    ], { timeoutMs: 10 * 60 * 1000, onLog });
  } else {
    await run('gs', [
      '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
      '-sDEVICE=png16m',
      `-r${dpi}`,
      // Anti-aliasing helps the models: a hard-edged 1-pixel staff line at a
      // steep skew disappears entirely when downsampled without it.
      '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
      '-dFirstPage=1', `-dLastPage=${probeLast}`,
      `-sOutputFile=${path.join(outDir, 'page-%03d.png')}`,
      pdfPath,
    ], { timeoutMs: 10 * 60 * 1000, onLog });
  }

  const files = (await readdir(outDir))
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  if (files.length === 0) throw new Error('the PDF rendered no pages — it may be empty or damaged');

  const truncated = files.length > maxPages;
  const kept = files.slice(0, maxPages);
  if (truncated) {
    onLog?.(`this PDF has more than ${maxPages} pages — only the first ${maxPages} will be read `
      + '(raise MAX_PAGES to read more)');
    // Delete the probe page so nothing downstream can pick it up by accident.
    await rm(path.join(outDir, files[files.length - 1]), { force: true });
  }

  return {
    pages: kept.map((file, i) => ({ path: path.join(outDir, file), page: i + 1 })),
    truncated,
  };
}
