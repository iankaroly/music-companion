// Look at what the reader got wrong, at a size where it can be seen.
//
// Every real bug in this reader was found by looking at the page and every dead
// end came from reasoning about what the code probably does. truth-check says
// there is a false notehead at x=104 y=262 on system 1; it cannot say that the
// thing there is the letter P. This crops the page around a list of
// coordinates and writes one image per crop, at eight times.
//
//   npm run scan:crop -- <page.pdf> 104,262 122,266 190,265
//   CROP_MARKS=1 npm run scan:crop -- <page.pdf> 700,300     every head it found
//   CROP_LAYER=body npm run scan:crop -- …                  what findHeads sees
//   CROP_LAYER=ink  npm run scan:crop -- …                  what it thresholds to
//   CROP_TRUTH=<f.truth.json> …    a marked page: ring = found, dot = really
//                                  there. A ring with no dot is invented, a dot
//                                  with no ring is missed, and both at once is
//                                  the reader being right.
//
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const args = process.argv.slice(2);
const file = args.find((a) => !a.includes(','));
const spots = args.filter((a) => a.includes(',')).map((a) => a.split(',').map(Number));
const out = process.env.CROP_OUT ?? '/tmp';
const pad = Number(process.env.CROP_PAD ?? 60);
if (!file || !spots.length) {
  console.log('usage: npm run scan:crop -- <page.pdf> x,y [x,y …]');
  process.exit(1);
}

const bytes = await readFile(file);
const truth = process.env.CROP_TRUTH
  ? JSON.parse(await readFile(process.env.CROP_TRUTH, 'utf8')).notes
  : null;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1400));

const images = await page.evaluate(async ({ b64, at, pad: p, marks, layer, truth }) => {
  const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: binary }).promise;
  const first = await doc.getPage(1);
  const scale = 1800 / first.getViewport({ scale: 1 }).width;
  const viewport = first.getViewport({ scale });
  const src = document.createElement('canvas');
  src.width = viewport.width; src.height = viewport.height;
  await first.render({ canvasContext: src.getContext('2d'), viewport }).promise;
  // The reader's working width, so the coordinates line up with its report.
  const W = Math.min(1400, src.width);
  const work = document.createElement('canvas');
  work.width = W; work.height = Math.round(src.height * (W / src.width));
  work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);

  // Every head the reader found, so a crop shows what it MISSED as well as
  // what it invented. A list of coordinates says where the mistakes are; only
  // the picture says which notes have no ring on them at all.
  // The reader's own view of the page, when asked for it: the ink it thresholds
  // to, or the body left after the beams are masked out — which is what the
  // notehead finder actually looks at. A crop of the paper cannot show why a
  // head was missed; a crop of `body` can, and did.
  if (layer) {
    const { beamMask, readPage } = await import('/src/analysis/scan-read.js');
    const wg = work.getContext('2d', { willReadFrequently: true });
    const px = wg.getImageData(0, 0, work.width, work.height).data;
    const W2 = work.width; const H2 = work.height;
    const gray = new Float32Array(W2 * H2);
    for (let i = 0; i < W2 * H2; i++) {
      gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    }
    const rad = Math.max(4, Math.round(W2 / 36)); const span = rad * 2 + 1;
    const t1 = new Float32Array(W2 * H2); const bg = new Float32Array(W2 * H2);
    for (let y = 0; y < H2; y++) {
      let sum = 0;
      for (let x = -rad; x <= rad; x++) sum += gray[y * W2 + Math.min(W2 - 1, Math.max(0, x))];
      for (let x = 0; x < W2; x++) {
        t1[y * W2 + x] = sum / span;
        sum += gray[y * W2 + Math.min(W2 - 1, x + rad + 1)] - gray[y * W2 + Math.max(0, x - rad)];
      }
    }
    for (let x = 0; x < W2; x++) {
      let sum = 0;
      for (let y = -rad; y <= rad; y++) sum += t1[Math.min(H2 - 1, Math.max(0, y)) * W2 + x];
      for (let y = 0; y < H2; y++) {
        bg[y * W2 + x] = sum / span;
        sum += t1[Math.min(H2 - 1, y + rad + 1) * W2 + x] - t1[Math.max(0, y - rad) * W2 + x];
      }
    }
    const ink = new Uint8Array(W2 * H2);
    for (let i = 0; i < W2 * H2; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
    const read = readPage(work, W2, H2);
    const spaces = (read?.staves ?? []).map((st) => st.space * H2).sort((a, b) => a - b);
    const space = spaces.length ? spaces[Math.floor(spaces.length / 2)] : 12;
    const shown = layer === 'body' ? beamMask(ink, W2, H2, space) : ink;
    const img = wg.createImageData(W2, H2);
    for (let i = 0; i < W2 * H2; i++) {
      const v = shown[i] ? 0 : 255;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    wg.putImageData(img, 0, 0);
  }

  let heads = [];
  if (marks) {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const read = readPage(work, work.width, work.height);
    if (read) {
      heads = notesInOrder(read).map((n) => [n.x * work.width, n.y * work.height]);
    }
  }

  return at.map(([x, y]) => {
    const zoom = 6;
    const c = document.createElement('canvas');
    c.width = p * 2 * zoom; c.height = p * 2 * zoom;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(work, x - p, y - p, p * 2, p * 2, 0, 0, c.width, c.height);
    // What is really there, when a marked page has been given.
    if (truth) {
      g.fillStyle = '#e0245e';
      for (const t of truth) {
        const tx = t.x * work.width; const ty = t.y * work.height;
        if (tx < x - p || tx > x + p || ty < y - p || ty > y + p) continue;
        g.beginPath();
        g.arc((tx - (x - p)) * zoom, (ty - (y - p)) * zoom, 2.2 * zoom, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Everything the reader found inside this crop.
    g.strokeStyle = '#12b886'; g.lineWidth = 2.5;
    for (const [hx, hy] of heads) {
      if (hx < x - p || hx > x + p || hy < y - p || hy > y + p) continue;
      g.beginPath();
      g.arc((hx - (x - p)) * zoom, (hy - (y - p)) * zoom, 5.5 * zoom, 0, Math.PI * 2);
      g.stroke();
    }
    // …and a ring at the point asked about, so the crop says what is meant.
    if (!marks) {
      g.strokeStyle = '#e0245e'; g.lineWidth = 3;
      g.beginPath(); g.arc(c.width / 2, c.height / 2, 8 * zoom, 0, Math.PI * 2); g.stroke();
    }
    return c.toDataURL('image/png').split(',')[1];
  });
}, { b64: bytes.toString('base64'), at: spots, pad, marks: process.env.CROP_MARKS === '1' || !!truth, layer: process.env.CROP_LAYER ?? null, truth });

await browser.close();
for (const [i, data] of images.entries()) {
  const path = `${out}/crop-${spots[i][0]}-${spots[i][1]}.png`;
  await writeFile(path, Buffer.from(data, 'base64'));
  console.log(path);
}
