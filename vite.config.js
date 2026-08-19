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

// /api/ask in the dev server.
//
// In production that path is a Vercel function (api/ask.js); `npm run dev` is
// plain vite and has no functions, so without this the Ask panel works when
// deployed and does nothing at all on the machine it was written on. Both hosts
// import the SAME handler, so there is one code path to get right.
//
// The import is dynamic so a checkout with no @anthropic-ai/sdk installed still
// starts the dev server — every measuring tool in tools/ needs it up, and none
// of them ask anything.
function askEndpoint() {
  return {
    name: 'ask-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/ask', async (req, res, next) => {
        if (req.method !== 'POST') { next(); return; }
        try {
          const { default: handler } = await import('./src/ai/ask-handler.js');
          await handler(req, res);
        } catch (err) {
          res.statusCode = 500;
          res.end(`The ask endpoint could not start: ${err.message}`);
        }
      });
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
  plugins: [pdfjsAssets(), askEndpoint()],
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
});
