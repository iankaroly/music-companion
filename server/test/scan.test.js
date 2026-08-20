// Photographs -> one PDF.
//
// The property that matters is LOSSLESSNESS: the bytes that come out of a
// phone are the bytes an OMR engine measures staff lines in, and anything that
// re-encodes them on the way in is throwing away the thing being measured. So
// these tests check the image data is embedded verbatim, and then check the
// result with the real Ghostscript — because a PDF that only this repo can read
// is not a PDF.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { imagesToPdf, isEmbeddableImage } from '../src/scan/images-to-pdf.js';
import { assembleUpload } from '../src/scan/assemble-upload.js';
import { findRasteriser, isPdf, rasterisePdf } from '../src/omr/pdf.js';
import { fixturePath } from './helpers.js';

const jpg = readFileSync(fixturePath('tiny-page.jpg'));
const png = readFileSync(fixturePath('tiny-page.png'));
const tool = await findRasteriser();

test('a JPEG and a PNG are both recognised as embeddable; other things are not', () => {
  assert.equal(isEmbeddableImage(jpg), true);
  assert.equal(isEmbeddableImage(png), true);
  assert.equal(isEmbeddableImage(readFileSync(fixturePath('three-blank-pages.pdf'))), false);
  assert.equal(isEmbeddableImage(Buffer.from('hello')), false);
});

test('one page per image, in the order given', () => {
  const pdf = imagesToPdf([{ buffer: jpg, name: '1.jpg' }, { buffer: png, name: '2.png' }, { buffer: jpg, name: '3.jpg' }]);
  assert.equal(isPdf(pdf), true);
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length, 3);
  assert.match(pdf.toString('latin1'), /\/Count 3/);
});

test('the image data goes in byte for byte', () => {
  // The JPEG's own compressed bytes appear in the PDF unchanged: nothing was
  // decoded, resized or re-compressed on the way in.
  const pdf = imagesToPdf([{ buffer: jpg, name: 'a.jpg' }]);
  assert.ok(pdf.includes(jpg), 'the JPEG bytes are not in the PDF verbatim');
  assert.match(pdf.toString('latin1'), /\/Filter \/DCTDecode/);

  // A PNG goes in as its own compressed IDAT stream, with PDF undoing the row
  // filters — which is what makes it lossless without decoding it.
  const fromPng = imagesToPdf([{ buffer: png, name: 'a.png' }]);
  assert.match(fromPng.toString('latin1'), /\/Filter \/FlateDecode/);
  assert.match(fromPng.toString('latin1'), /\/Predictor 15/);
  assert.match(fromPng.toString('latin1'), /\/ColorSpace \/DeviceGray/);
});

test('an image it cannot embed is refused by name, not flattened', () => {
  assert.throws(() => imagesToPdf([{ buffer: Buffer.from('not an image'), name: 'notes.txt' }]),
    /notes\.txt is not a JPEG or a PNG/);
  assert.throws(() => imagesToPdf([]), /no images/);
});

test('Ghostscript reads the result, and every page has something on it',
  { skip: tool ? false : 'no rasteriser installed' }, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
    try {
      const file = path.join(dir, 'assembled.pdf');
      writeFileSync(file, imagesToPdf([{ buffer: jpg, name: 'a' }, { buffer: png, name: 'b' }]));

      const { pages } = await rasterisePdf(file, path.join(dir, 'out'), { dpi: 72, maxPages: 10 });
      assert.equal(pages.length, 2);
      for (const page of pages) {
        const rendered = readFileSync(page.path);
        assert.ok(rendered.length > 100, `page ${page.page} rendered as nothing`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test('an upload of several images becomes one PDF of that many pages', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
  try {
    const result = await assembleUpload([
      { buffer: jpg, name: 'IMG_1.jpg' },
      { buffer: png, name: 'IMG_2.png' },
      { buffer: jpg, name: 'IMG_3.jpg' },
    ], { workDir: dir });
    assert.equal(result.kind, 'pdf');
    assert.equal(result.pages, 3);
    assert.equal(isPdf(result.buffer), true);
    assert.match(result.note, /3 images were combined/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an upload of several PDFs is merged', { skip: tool ? false : 'needs ghostscript' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
  try {
    const three = readFileSync(fixturePath('three-blank-pages.pdf'));
    const result = await assembleUpload([
      { buffer: three, name: 'a.pdf' },
      { buffer: three, name: 'b.pdf' },
    ], { workDir: dir });
    assert.equal(result.kind, 'pdf');
    assert.match(result.note, /2 PDFs were merged/);

    const { pages } = await rasterisePdf(
      (writeFileSync(path.join(dir, 'm.pdf'), result.buffer), path.join(dir, 'm.pdf')),
      path.join(dir, 'out'), { dpi: 72, maxPages: 20 },
    );
    assert.equal(pages.length, 6);   // three pages twice
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mixture of PDFs and images is refused, naming the file that broke it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-'));
  try {
    await assert.rejects(
      assembleUpload([
        { buffer: jpg, name: 'page1.jpg' },
        { buffer: readFileSync(fixturePath('three-blank-pages.pdf')), name: 'rest.pdf' },
      ], { workDir: dir }),
      /all images or all PDFs/,
    );
    await assert.rejects(
      assembleUpload([
        { buffer: jpg, name: 'page1.jpg' },
        { buffer: Buffer.from('just text'), name: 'notes.txt' },
      ], { workDir: dir }),
      /notes\.txt is neither a PDF nor a JPEG\/PNG/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
