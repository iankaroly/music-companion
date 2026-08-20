// Rendering a PDF to pages.
//
// This runs the REAL rasteriser (ghostscript or poppler) against a real
// multi-page PDF, because the two things worth testing here — that pages come
// back in order, and that a document longer than the cap is REPORTED rather
// than quietly halved — are both properties of the external tool's behaviour,
// not of our arithmetic. Skipped, loudly, when neither tool is installed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRasteriser, isPdf, rasterisePdf } from '../src/omr/pdf.js';
import { readFileSync } from 'node:fs';
import { fixturePath } from './helpers.js';

const tool = await findRasteriser();
const pdf = fixturePath('three-blank-pages.pdf');

test('a PDF is recognised by its header', () => {
  assert.equal(isPdf(readFileSync(pdf)), true);
  assert.equal(isPdf(Buffer.from('<?xml version="1.0"?>')), false);
});

test('every page is rendered, in order', { skip: tool ? false : 'no rasteriser installed' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'raster-'));
  try {
    const { pages, truncated } = await rasterisePdf(pdf, dir, { dpi: 72, maxPages: 10 });
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.map((p) => p.page), [1, 2, 3]);
    assert.equal(truncated, false);
    // Page 10 must sort after page 9, not between 1 and 2.
    assert.deepEqual([...pages].sort((a, b) => a.page - b.page), pages);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a document longer than the cap says so', { skip: tool ? false : 'no rasteriser installed' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'raster-'));
  try {
    const { pages, truncated } = await rasterisePdf(pdf, dir, { dpi: 72, maxPages: 2 });
    // Exactly the cap is kept, and the caller is told there was more. Silently
    // returning half a piece is the failure this guards against: an alignment
    // against a score that stops at the cap looks right until it does not.
    assert.equal(pages.length, 2);
    assert.equal(truncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
