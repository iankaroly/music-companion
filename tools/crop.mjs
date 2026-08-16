// Look at what the reader got wrong, at a size where it can be seen.
//
// Every real bug in this reader was found by looking at the page and every dead
// end came from reasoning about what the code probably does. truth-check says
// there is a false notehead at x=104 y=262 on system 1; it cannot say that the
// thing there is the letter P. This crops the page around a list of
// coordinates and writes one image per crop, at eight times.
//
//   npm run scan:crop -- <page.pdf> 104,262 122,266 190,265
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
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1400));

const images = await page.evaluate(async ({ b64, at, pad: p }) => {
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

  return at.map(([x, y]) => {
    const zoom = 6;
    const c = document.createElement('canvas');
    c.width = p * 2 * zoom; c.height = p * 2 * zoom;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(work, x - p, y - p, p * 2, p * 2, 0, 0, c.width, c.height);
    // A ring where the reader put one, so the crop says which mark is meant.
    g.strokeStyle = '#e0245e'; g.lineWidth = 3;
    g.beginPath(); g.arc(c.width / 2, c.height / 2, 8 * zoom, 0, Math.PI * 2); g.stroke();
    return c.toDataURL('image/png').split(',')[1];
  });
}, { b64: bytes.toString('base64'), at: spots, pad });

await browser.close();
for (const [i, data] of images.entries()) {
  const path = `${out}/crop-${spots[i][0]}-${spots[i][1]}.png`;
  await writeFile(path, Buffer.from(data, 'base64'));
  console.log(path);
}
