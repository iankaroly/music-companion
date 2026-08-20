import test from 'node:test';
import assert from 'node:assert/strict';
import { thinPages } from '../src/util/thin-pages.js';

const page = (n, measures) => ({ page: n, measures });

test('the shape actually measured: dense pages and barely-read ones', () => {
  const pages = [
    page(1, 2), page(2, 66), page(4, 54), page(5, 1),
    page(6, 66), page(8, 54), page(9, 2), page(10, 1),
  ];
  assert.deepEqual(thinPages(pages), [1, 5, 9, 10]);
});

test('an empty page is always suspect, even with nothing to compare it to', () => {
  assert.deepEqual(thinPages([page(1, 0), page(2, 30)]), [1]);
  assert.deepEqual(thinPages([page(1, 0)]), [1]);
});

test('a single page read as two bars is suspect, with no median to prove it', () => {
  // The case a median cannot catch: one page in, and the engine returned a
  // couple of bars of a page that has twenty.
  assert.deepEqual(thinPages([page(1, 2)]), [1]);
  assert.deepEqual(thinPages([page(1, 20)]), []);
});

test('an evenly-read book has nothing to rescue', () => {
  assert.deepEqual(thinPages([page(1, 28), page(2, 31), page(3, 26), page(4, 30)]), []);
});

test('a genuinely short last page is not called a failure', () => {
  // Final pages are often half empty; a quarter of a well-read page is well
  // below "the piece ended half way down".
  assert.deepEqual(thinPages([page(1, 32), page(2, 30), page(3, 28), page(4, 12)]), []);
  assert.deepEqual(thinPages([page(1, 32), page(2, 30), page(3, 28), page(4, 8)]), []);
  // A quarter of it is not.
  assert.deepEqual(thinPages([page(1, 32), page(2, 30), page(3, 28), page(4, 5)]), [4]);
});

test('two pages are enough to spot one that is a tenth of the other', () => {
  // Measured: three photographed pages came back 37, FAILED, 7. The median of
  // [37, 7] is 22, so a quarter of it is 5.5 and the 7-bar page — really 27 —
  // went unquestioned. Comparing against the better-read half instead makes the
  // baseline 37, and 7 is plainly wrong beside it.
  assert.deepEqual(thinPages([page(1, 37), page(3, 7)]), [3]);
  assert.deepEqual(thinPages([page(1, 40), page(2, 3)]), [2]);
  // But a page that is merely smaller is left alone.
  assert.deepEqual(thinPages([page(1, 40), page(2, 12)]), []);
});

test('a book where every page is empty asks for all of them back', () => {
  assert.deepEqual(thinPages([page(1, 0), page(2, 0), page(3, 0)]), [1, 2, 3]);
});
