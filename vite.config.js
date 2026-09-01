import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// The parts of the PDF reader that are not JavaScript.
//
// pdf.js ships four things it fetches at RUNTIME rather than bundling, and a
// build that does not put them anywhere is a reader that cannot open half the
// PDFs in the world:
//
//   wasm/          JBIG2 and JPEG 2000 decoders. Every scanned part is one of
//                  those two — JBIG2 is what a black-and-white page scan is
//                  compressed with — and without these the images decode to
//                  nothing and the page comes out blank.
//   standard_fonts/ Helvetica, Times and the rest, for the PDFs that name a
//                  standard font instead of embedding it. Most exports do.
//   cmaps/         the encoding tables a CID font needs to say which glyph is
//                  which.
//   iccs/          colour profiles.
//
// They are copied out of the package rather than committed, and served from
// /pdfjs/ in both the dev server and the build.
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const PDFJS_ASSETS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];

async function copyPdfAssets(into) {
  await mkdir(into, { recursive: true });
  await Promise.all(PDFJS_ASSETS.map((name) => cp(
    join(pdfjsRoot, name),
    join(into, name),
    { recursive: true },
  )));
}

function pdfjsAssets() {
  return {
    name: 'pdfjs-runtime-assets',
    // The dev server reads from public/, so they go there for `npm run dev`…
    async buildStart() {
      await copyPdfAssets(join(process.cwd(), 'public', 'pdfjs'));
    },
    // …and into the build output, which does not include anything written to
    // public/ after the copy step has already run.
    async closeBundle() {
      await copyPdfAssets(join(process.cwd(), 'dist', 'pdfjs'));
    },
  };
}

// Which build is this?
//
// Added on the day a bug could not be told apart from a bug already fixed:
// installed on an iPad from Safari's "Add to Home Screen", the app holds its
// page for days, so "it still does nothing" and "it is still running last
// week's code" look exactly the same from here. A build stamp the app can show
// settles that in one glance, and the service worker registers under it, so a
// deploy is a new worker rather than a hope.
const stamp = [
  (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
  new Date().toISOString().slice(0, 16).replace('T', ' '),
].join(' · ');

export default defineConfig({
  plugins: [pdfjsAssets()],
  // Every measuring tool in tools/ talks to localhost:5199, so the dev server
  // has to BE there. Vite's own default moved with an upgrade, and the whole
  // bench went red with a connection refused rather than a reading — which
  // looks exactly like a reader that stopped working.
  // PORT overrides it, so a second checkout can be measured at the same time
  // without the two servers fighting over the socket — the tools take the same
  // variable.
  server: { port: Number(process.env.PORT ?? 5199), strictPort: true },
  define: {
    __BUILD__: JSON.stringify(stamp),
  },
  test: {
    // server/ is a separate service with its own suite, run by node:test
    // (`npm test` inside server/). Vitest cannot run those files and reports
    // every one of them as a failed suite, which turns a green run red for no
    // reason anybody can act on.
    exclude: ['node_modules/**', 'dist/**', 'server/**', 'ios/**'],
    // A HEADROOM SETTING, NOT A PATIENCE ONE.
    //
    // The heaviest tests here synthesise seconds of audio and run the real
    // detector over it. MEASURED, the slowest — onset.test.js on a quiet
    // recording — takes 694/701/712ms on an idle machine, and 6058ms with the
    // browser bench running beside it: the same work, 8.6x the wall clock,
    // because vitest runs its files in parallel and the DSP is all CPU.
    //
    // Against the 5s default that is a suite which goes red when the machine is
    // busy and green when it is not, which is the worst kind of test: it costs
    // a real investigation every time, and it teaches you to disbelieve it.
    // Nothing here should take twenty seconds, so a hang is still caught.
    testTimeout: 20000,
  },
});
