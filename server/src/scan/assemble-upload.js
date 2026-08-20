// Several files in one upload -> one document.
//
// Photographing a six-page part gives you six files with no relationship to
// each other. Some scanning apps give you six PDFs instead. Either way the
// pipeline wants ONE document, because that is what carries a page 1 and a page
// 6 — and because a PDF is the input that can be re-rendered, retried at a
// higher resolution, and fallen back to page by page.
//
// Images are embedded losslessly (see images-to-pdf.js). PDFs are merged with
// Ghostscript, which is already required for rasterising.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { imagesToPdf, isEmbeddableImage } from './images-to-pdf.js';
import { isPdf } from '../omr/pdf.js';
import { run } from '../omr/run.js';

/**
 * @param {{buffer:Buffer, name:string}[]} files in the order they should appear
 * @param {{workDir:string}} options a scratch directory for merging
 * @returns {Promise<{buffer:Buffer, kind:'pdf', pages:number, note:string}>}
 */
export async function assembleUpload(files, { workDir }) {
  if (files.length < 2) throw new Error('assembleUpload is for two files or more');

  const images = files.filter((f) => isEmbeddableImage(f.buffer));
  const pdfs = files.filter((f) => isPdf(f.buffer));

  if (images.length === files.length) {
    // The order is the order they were sent: a client that wants page 3 third
    // must send it third. Sorting by filename would be a guess, and "IMG_0042"
    // sorts differently from "page-3".
    const buffer = imagesToPdf(images.map((f) => ({ buffer: f.buffer, name: f.name })));
    return {
      buffer,
      kind: 'pdf',
      pages: images.length,
      note: `${images.length} images were combined into one PDF, in the order they were sent`,
    };
  }

  if (pdfs.length === files.length) {
    const buffer = await mergePdfs(pdfs, workDir);
    return {
      buffer,
      kind: 'pdf',
      pages: pdfs.length,
      note: `${pdfs.length} PDFs were merged into one, in the order they were sent`,
    };
  }

  // Mixed, or something that is neither. Say which file is the problem: "some
  // files could not be combined" is not something anyone can act on.
  const odd = files.find((f) => !isEmbeddableImage(f.buffer) && !isPdf(f.buffer));
  throw new Error(odd
    ? `${odd.name} is neither a PDF nor a JPEG/PNG, so these files cannot be combined`
    : 'a single upload must be all images or all PDFs, not a mixture');
}

/** Ghostscript concatenates PDFs; it is already here for rasterising. */
async function mergePdfs(files, workDir) {
  const dir = path.join(workDir, 'merge');
  await mkdir(dir, { recursive: true });

  const inputs = [];
  for (const [index, file] of files.entries()) {
    const at = path.join(dir, `part-${String(index + 1).padStart(3, '0')}.pdf`);
    await writeFile(at, file.buffer);
    inputs.push(at);
  }
  const out = path.join(dir, 'merged.pdf');
  await run('gs', [
    '-q', '-dSAFER', '-dBATCH', '-dNOPAUSE',
    '-sDEVICE=pdfwrite',
    // Do not re-compress the images inside: they are the pixels an OMR engine
    // is about to measure.
    '-dAutoFilterColorImages=false', '-dColorImageFilter=/FlateEncode',
    '-dAutoFilterGrayImages=false', '-dGrayImageFilter=/FlateEncode',
    `-sOutputFile=${out}`,
    ...inputs,
  ], { timeoutMs: 5 * 60 * 1000, cwd: dir });

  return readFile(out);
}
