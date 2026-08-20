// Run an async job over a list, N at a time.
//
// Why this exists rather than `await Promise.all(items.map(fn))`: OMR is a
// separate process that saturates three or four cores by itself. Firing one per
// page of a twenty-page scan does not make it twenty times faster — it makes
// the machine thrash and every page slower. And firing them one at a time, as
// this pipeline did first, leaves eight of ten cores idle for forty minutes.
//
// Results come back in INPUT ORDER regardless of what finished when, because
// page order is the one thing the caller cannot reconstruct afterwards.

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit how many may be in flight at once (clamped to >= 1)
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<{value?: R, error?: Error, item: T, index: number}[]>}
 *   One entry per input, in input order. A worker that throws produces an
 *   `error` entry rather than rejecting the whole run — a bad page must not
 *   cost the good ones.
 */
export async function mapWithConcurrency(items, limit, worker) {
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = { value: await worker(items[index], index), item: items[index], index };
      } catch (error) {
        results[index] = { error, item: items[index], index };
      }
    }
  }

  await Promise.all(Array.from({ length: width }, runner));
  return results;
}
