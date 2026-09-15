// The page reader, off the main thread.
//
// Reading a page — staves, bars, noteheads — is the heaviest arithmetic in the
// app, and it used to run on the thread that turns pages: yielding between
// staves kept the biggest block down to a few hundred milliseconds, and every
// one of those blocks was still a tap that waited. "slow to load … and laggy."
// Here it runs flat out, with nothing to yield to, and the main thread's whole
// cost of reading a page is rendering it and handing the bitmap over.
//
// The reader itself is unchanged — `readPage` is the same synchronous function
// every tool in tools/ measures — it just draws its working copy on an
// OffscreenCanvas when there is no document (see readSteps in scan-read.js).
import { readPage } from './scan-read.js';

self.onmessage = (e) => {
  const { id, bitmap, width, height } = e.data;
  try {
    const found = readPage(bitmap, width, height);
    self.postMessage({ id, found });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  } finally {
    bitmap?.close?.();
  }
};
