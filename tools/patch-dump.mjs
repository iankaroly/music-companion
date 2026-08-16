// Every candidate the reader offers, as a small picture with a yes or no on it.
//
// The reader localises well and judges badly: on two marked pages it finds 88%
// and 99% of the notes, and a third of what it draws on the Mozart is a rest, an
// accidental, the word SOLO or the p of a dynamic. Every geometric rule left is
// a straight trade — the sweeps buy a point of recall for a point of precision
// and back — because at a ten-pixel staff space a notehead and a rest are the
// same size and the same kind of shape.
//
// What is NOT hard is the question itself: here is a patch of a page, is there a
// notehead in the middle of it. That is a classification problem with hundreds
// of labelled examples already sitting in the truth files, and this is what
// turns them into something a classifier can be trained and — the part that
// matters — HONESTLY TESTED on, by training on one engraving and testing on the
// other.
//
//   npm run scan:patches
//
// Writes pages/patches.json: one row per candidate, with the page it came from,
// its label, and a small normalised picture of it.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const all = [];
for (const p of index) {
  const bytes = await readFile(p.file);
  const truthAt = p.truth.startsWith('/') ? p.truth
    : new URL(`../${p.truth}`, import.meta.url).pathname;
  const truth = JSON.parse(await readFile(truthAt, 'utf8')).notes;
  const rows = await page.evaluate(async ({ b64, pdf, want }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    // The reader's own patch, not a copy of it. A classifier trained on patches
    // built one way and run on patches built another is a classifier fed noise,
    // and the two would drift the day either file changed.
    const { headPatch, GRID, SPAN } = await import('/src/analysis/head-model.js');
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    let src;
    if (pdf) {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ data: binary }).promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 1800 / first.getViewport({ scale: 1 }).width });
      src = document.createElement('canvas');
      src.width = viewport.width; src.height = viewport.height;
      await first.render({ canvasContext: src.getContext('2d'), viewport }).promise;
    } else {
      const bmp = await createImageBitmap(new Blob([binary]));
      src = document.createElement('canvas');
      src.width = bmp.width; src.height = bmp.height;
      src.getContext('2d').drawImage(bmp, 0, 0);
    }
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
    const w = work.width; const h = work.height;

    const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    const rad = Math.max(4, Math.round(w / 36)); const sp = rad * 2 + 1;
    const t1 = new Float32Array(w * h); const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -rad; x <= rad; x++) s += gray[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { t1[y * w + x] = s / sp; s += gray[y * w + Math.min(w - 1, x + rad + 1)] - gray[y * w + Math.max(0, x - rad)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -rad; y <= rad; y++) s += t1[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { bg[y * w + x] = s / sp; s += t1[Math.min(h - 1, y + rad + 1) * w + x] - t1[Math.max(0, y - rad) * w + x]; }
    }

    // WITHOUT the judge. See readPage's note: with it on, the dump only sees
    // candidates the judge already passed, and each round of training would be
    // fitted to the survivors of the last.
    const read = readPage(work, w, h, { judge: false });
    const notes = notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * h).sort((a, b) => a - b);
    const space = spaces[Math.floor(spaces.length / 2)];

    // Sampled in STAFF SPACES and normalised against the page's own paper, so a
    // patch from a 10px page and a patch from a 12px page are the same picture
    // of the same thing. Anything else and the classifier learns the scanner.
    return notes.map((n) => {
      const cx = n.x * w; const cy = n.y * h;
      let real = 0;
      for (const t of want) {
        if (Math.hypot(t.x * w - cx, t.y * h - cy) < space * 0.5) { real = 1; break; }
      }
      const pix = headPatch(gray, bg, w, h, space, cx, cy);
      return { label: real, step: n.step, beats: n.beats,
        pixels: [...pix].map((v) => Math.round(v * 255)) };
    });
  }, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(p.file), want: truth });

  for (const r of rows) all.push({ page: p.name, ...r });
  const yes = rows.filter((r) => r.label).length;
  console.log(`${p.name.padEnd(10)} ${rows.length} candidates — ${yes} notes, ${rows.length - yes} not`);
}
await browser.close();

const { GRID, SPAN } = await import('../src/analysis/head-model.js');
await writeFile(new URL('../pages/patches.json', import.meta.url),
  JSON.stringify({ grid: GRID, span: SPAN, rows: all }));
console.log(`\nwritten to pages/patches.json — ${all.length} patches, ${GRID}x${GRID}\n`);
