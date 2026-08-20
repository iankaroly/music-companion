// Which pages came back suspiciously empty.
//
// A page the engine REFUSED is easy: it throws, and the pipeline knows. The
// harder failure is the page that comes back technically fine and nearly empty
// — two bars where there are twenty. Nothing errors, the job succeeds, and the
// score has a hole in it that only shows up when a recording drifts.
//
// Measured, on a ten-page book: Audiveris returned 66, 54, 66 and 54 bars for
// four dense pages and 2, 1, 2 and 1 bars for four others it could barely read.
// That is not a subtle distribution — a page well under a quarter of the median
// is not a sparse page, it is a failed one wearing a success.
//
// Pure and separate from the pipeline so the threshold can be argued with, and
// tested, without running OMR.

/** Median of a list of numbers. */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * What a page of this book looks like when it has been read properly.
 *
 * The median of ALL pages is the obvious baseline and it is the wrong one: it
 * is dragged down by exactly the pages being looked for. Measured — three
 * photographed pages came back as 37, FAILED and 7 bars, and the median of
 * [37, 7] is 22, so the 7-bar page (27 bars in reality) sat comfortably above a
 * quarter of it and was never questioned.
 *
 * The median of the BETTER HALF is the baseline instead: pages that were read
 * well describe what a well-read page looks like. On the same figures it is 37,
 * and the 7-bar page is a tenth of it.
 */
function typicalGoodPage(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const betterHalf = sorted.slice(Math.floor(sorted.length / 2));
  return median(betterHalf);
}

/**
 * @param {{page:number, measures:number}[]} pages what each page produced
 * @param {{fraction?:number, minPages?:number, floor?:number}} [options]
 *   `fraction` of a well-read page below which a page is called thin (0.25).
 *   `minPages` is how many pages must exist before comparing them means
 *   anything. `floor` is the number of bars under which a page is thin whatever
 *   the others did — the rule that catches a single-page upload.
 * @returns {number[]} page numbers worth a second opinion
 */
export function thinPages(pages, options = {}) {
  const { fraction = 0.25, minPages = 2, floor = 4 } = options;

  // A page with almost nothing on it is suspect however few pages there are to
  // compare it with. A scanned page of music has bars on it — Audiveris read a
  // printed menuet page as TWO bars where oemer read twenty, and with a
  // single-page upload there is no comparison to be made. Four is deliberately
  // low: it costs a second opinion on a genuinely tiny excerpt, and the better
  // of the two answers is kept either way.
  const barelyRead = pages.filter((p) => p.measures < floor).map((p) => p.page);
  if (pages.length < minPages) return barelyRead;

  const populated = pages.filter((p) => p.measures > 0).map((p) => p.measures);
  if (populated.length === 0) return pages.map((p) => p.page);

  const threshold = typicalGoodPage(populated) * fraction;
  return [...new Set([
    ...barelyRead,
    ...pages.filter((p) => p.measures < threshold).map((p) => p.page),
  ])].sort((a, b) => a - b);
}
