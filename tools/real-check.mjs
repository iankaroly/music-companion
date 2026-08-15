// The reader, measured on the file you actually upload.
//
// WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE
//
// Every number quoted about the Bärenreiter page for most of a day came from a
// PNG made with `sips` from the PDF. The app does not do that. It renders the
// PDF with pdf.js, and the two rasterisers disagree enough to change every
// answer: the same page, the same code, the same minute, reads NINE clefs
// correctly through the PNG and FOUR through the PDF.
//
// So a fix tuned against the PNG is a fix tuned against a file nobody has, and
// the person looking at the screen sees something else. This drives the reader
// down the SAME path the browser does — pdf.js, the same working width, the
// same canvas — so what it prints is what the tool shows.
//
//   npm run scan:real -- <file.pdf|file.png> [--clef bass] [--notes 320]
//
// --clef says what every system on the page is written in, and --notes says how
// many noteheads are really on it. Both are things a human knows by looking and
// the reader cannot; given them, this scores itself instead of printing numbers
// somebody then has to interpret.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const wantClef = flag('clef');
const wantNotes = Number(flag('notes')) || null;
const wantJson = args.includes('--json');

if (!file) {
  console.log('usage: npm run scan:real -- <file.pdf|file.png> [--clef bass] [--notes 320]');
  process.exit(1);
}

const bytes = await readFile(file);
const base64 = bytes.toString('base64');
const isPdf = /\.pdf$/i.test(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({ b64, pdf }) => {
  const { readPage, notesInOrder, clefColumn } = await import('/src/analysis/scan-read.js');
  const { clefFeatures } = await import('/src/analysis/scan-clef.js');

  // Rasterised the way the app rasterises it. This is the whole point of the
  // file: pdf.js and sips do not produce the same pixels, and the reader can
  // tell.
  async function toCanvas() {
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (!pdf) {
      const blob = new Blob([binary]);
      const bitmap = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return c;
    }
    // Imported and configured by dev-server PATH, not by bare specifier or
    // import.meta. This function is evaluated in the page rather than served as
    // a module, so Vite never rewrites it: a bare 'pdfjs-dist' does not resolve
    // and import.meta is outright a syntax error.
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = viewport.width; c.height = viewport.height;
    await first.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return c;
  }

  const source = await toCanvas();
  // The reader's own working width, exactly as tools/reader-look.html does it.
  const W = Math.min(1400, source.width);
  const work = document.createElement('canvas');
  work.width = W;
  work.height = Math.round(source.height * (W / source.width));
  work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);

  const read = readPage(work, work.width, work.height);
  if (!read) return { failed: 'the reader found no stave on this page' };
  const notes = notesInOrder(read);

  // The extents the verdict was actually made from. Without these a wrong clef
  // is a bare word; with them it says which test fired and by how much it
  // missed — treble is bottom > 4.5, tenor is top < -0.6, bass is whatever is
  // left. Recomputed here from the zone readPage reports rather than smuggled
  // out of it, so the tool cannot disagree with the reader about where it looked.
  const wk = work.getContext('2d', { willReadFrequently: true });
  const px = wk.getImageData(0, 0, work.width, work.height).data;
  const W2 = work.width; const H2 = work.height;
  const gray = new Float32Array(W2 * H2);
  for (let i = 0; i < W2 * H2; i++) {
    gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  }
  const radius = Math.max(4, Math.round(W2 / 36)); const span = radius * 2 + 1;
  const tmpA = new Float32Array(W2 * H2); const bg = new Float32Array(W2 * H2);
  for (let y = 0; y < H2; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += gray[y * W2 + Math.min(W2 - 1, Math.max(0, x))];
    for (let x = 0; x < W2; x++) {
      tmpA[y * W2 + x] = sum / span;
      sum += gray[y * W2 + Math.min(W2 - 1, x + radius + 1)] - gray[y * W2 + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < W2; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmpA[Math.min(H2 - 1, Math.max(0, y)) * W2 + x];
    for (let y = 0; y < H2; y++) {
      bg[y * W2 + x] = sum / span;
      sum += tmpA[Math.min(H2 - 1, y + radius + 1) * W2 + x] - tmpA[Math.max(0, y - radius) * W2 + x];
    }
  }
  const ink = new Uint8Array(W2 * H2);
  for (let i = 0; i < W2 * H2; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
  const stripW = Math.max(1, Math.floor(W2 / 40));
  const extents = read.staves.map((s) => {
    if (!s.clefZone) return null;
    const space = s.space * H2;
    const internal = { lines: s.lines.map((L) => ({ at: Float32Array.from(L, (y) => y * H2) })), space };
    const f = clefFeatures(clefColumn(ink, W2, H2, internal, stripW, space, s.clefZone.x * W2), space);
    return f ? { top: +f.top.toFixed(2), bottom: +f.bottom.toFixed(2), sym: +f.symmetry.toFixed(2) } : null;
  });
  return {
    size: `${source.width}x${source.height} -> ${work.width}x${work.height}`,
    staves: read.staves.map((s, i) => ({
      system: i + 1,
      clef: s.clef,
      confidence: +(s.clefConfidence ?? 0).toFixed(2),
      bars: s.bars.length,
      heads: s.heads.length,
      space: +(s.space * work.height).toFixed(1),
      zoneX: s.clefZone ? Math.round(s.clefZone.x * work.width) : null,
      ...(extents[i] ?? {}),
    })),
    heads: notes.length,
    bars: read.staves.reduce((a, s) => a + s.bars.length, 0),
    steps: [Math.min(...notes.map((n) => n.step)), Math.max(...notes.map((n) => n.step))],
  };
}, { b64: base64, pdf: isPdf });

await browser.close();

if (report.failed) {
  console.log(`\n${report.failed}\n`);
  process.exit(1);
}

if (wantJson) {
  console.log(JSON.stringify({ file, ...report, errors }, null, 2));
} else {
  console.log(`\n${basename(file)} — read the way the app reads it${isPdf ? ' (pdf.js)' : ''}`);
  console.log(`  ${report.size}\n`);
  console.log('sys  clef      conf   zoneX  space  bars  heads     top  bottom   sym');
  for (const s of report.staves) {
    const wrong = wantClef && s.clef !== wantClef;
    console.log(
      `${String(s.system).padStart(3)}  ${String(s.clef).padEnd(8)} ${String(s.confidence).padStart(5)}  `
      + `${String(s.zoneX).padStart(5)}  ${String(s.space).padStart(5)}  ${String(s.bars).padStart(4)}  `
      + `${String(s.heads).padStart(5)}  ${String(s.top ?? '-').padStart(6)}  `
      + `${String(s.bottom ?? '-').padStart(6)}  ${String(s.sym ?? '-').padStart(4)}`
      + `${wrong ? '   <-- WRONG' : ''}`,
    );
  }
  console.log('');
  if (wantClef) {
    const right = report.staves.filter((s) => s.clef === wantClef).length;
    const refused = report.staves.filter((s) => s.clef === null).length;
    console.log(`  CLEF   ${right}/${report.staves.length} correct`
      + `  (${report.staves.length - right - refused} wrong, ${refused} refused)`);
  }
  if (wantNotes) {
    const over = report.heads - wantNotes;
    console.log(`  NOTES  ${report.heads} found against ${wantNotes} real`
      + `  (${over >= 0 ? '+' : ''}${over}, ${((over / wantNotes) * 100).toFixed(0)}%)`);
  } else {
    console.log(`  NOTES  ${report.heads} found`);
  }
  console.log(`  BARS   ${report.bars} barlines · steps ${report.steps[0]}..${report.steps[1]}\n`);
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
}
