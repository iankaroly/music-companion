// A grid of crops, so a hundred marks can be LOOKED AT rather than sampled.
//
// WHY THIS EXISTS
//
// Every real bug in this reader was found by looking at the page, and the tool
// for that — tools/crop.mjs — draws ONE place at a time. That is the right shape
// for "why is there no ring here", and it is the wrong shape for the question
// this project keeps running into: a hundred and sixty-two marks are suspected
// of being wrong, and a twelve-point sample cannot settle which ones.
//
// So this lays them out in a grid, each crop labelled with its index and its
// coordinates, with the reader's ring and the hand's mark drawn on: the reader's
// detections in pink, the truth marks in green. Twenty-four to a sheet at four
// to eight times, which is enough to tell a notehead from a bare stem by eye and
// small enough that a sheet is one look.
//
//   npm run scan:sheet -- <file.pdf|png> --points <x,y;x,y;...> [--out /tmp/sheet]
//   npm run scan:sheet -- <file> --json <report.json> --shape stem-foot
//
// The second form reads a truth-check --json report and takes every CORRECT head
// whose `shape` matches, which is how the marks under suspicion get onto a sheet
// without anybody typing coordinates.
//
// WHAT IT IS FOR, and the discipline that goes with it: editing ground truth is
// the most dangerous thing anybody does in this project, because a truth file is
// what every number is measured against and a bad edit is invisible afterwards.
// So a mark is only ever removed after it has been seen, and the removal is
// recorded in the file. See the `cleaned` and `removed` fields written by
// tools/truth-check.mjs --clean.

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
const outBase = flag('out', '/tmp/sheet');
const perSheet = Number(flag('per', 24));
const zoom = Number(flag('zoom', 5));
const truthPath = flag('truth', null);

let points = [];
const jsonPath = flag('json', null);
if (jsonPath) {
  const report = JSON.parse(await readFile(jsonPath, 'utf8'));
  const want = flag('shape', 'stem-foot');
  const from = flag('from', 'matched');
  points = (report[from] ?? [])
    .filter((r) => (want === 'all' ? true : r.shape === want))
    .map((r) => [r.x, r.y]);
} else {
  points = (flag('points', '') || '').split(';').filter(Boolean)
    .map((p) => p.split(',').map(Number));
}

if (!file || !points.length) {
  console.log('usage: npm run scan:sheet -- <file> --json <report.json> --shape stem-foot');
  console.log('       npm run scan:sheet -- <file> --points 100,200;300,400');
  process.exit(1);
}

const bytes = await readFile(file);
const truth = truthPath ? JSON.parse(await readFile(truthPath, 'utf8')).notes : [];

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const sheets = await page.evaluate(async ({ b64, pdf, pts, want, per, zoom }) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  async function toCanvas() {
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (!pdf) {
      const bmp = await createImageBitmap(new Blob([binary]));
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      return c;
    }
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const vp = first.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await first.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return c;
  }

  const src = await toCanvas();
  const W = Math.min(1400, src.width);
  const work = document.createElement('canvas');
  work.width = W;
  work.height = Math.round(src.height * (W / src.width));
  work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
  const w = work.width; const h = work.height;

  const read = readPage(work, w, h);
  const found = read ? notesInOrder(read) : [];
  const spaces = (read?.staves ?? []).map((s) => s.space * h).sort((a, b) => a - b);
  const space = spaces.length ? spaces[Math.floor((spaces.length - 1) / 2)] : 10;

  // One tile: a window of the page around the point, blown up, with what the
  // reader thinks and what the hand said drawn over it.
  const win = Math.round(space * 5.2);
  const tile = Math.round(win * zoom / 2);
  const cols = 6;
  const out = [];

  for (let start = 0; start < pts.length; start += per) {
    const batch = pts.slice(start, start + per);
    const rows = Math.ceil(batch.length / cols);
    const pad = 22;
    const c = document.createElement('canvas');
    c.width = cols * (tile + 6) + 6;
    c.height = rows * (tile + pad + 6) + 6;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);

    for (const [k, [px, py]] of batch.entries()) {
      const cx = (k % cols) * (tile + 6) + 6;
      const cy = Math.floor(k / cols) * (tile + pad + 6) + 6 + pad;
      g.save();
      g.beginPath(); g.rect(cx, cy, tile, tile); g.clip();
      g.drawImage(work, px - win / 2, py - win / 2, win, win, cx, cy, tile, tile);
      // The reader's rings and the hand's marks, in the tile's own scale.
      const at = (gx, gy) => [cx + (gx - (px - win / 2)) * (tile / win),
        cy + (gy - (py - win / 2)) * (tile / win)];
      g.lineWidth = 2;
      for (const t of want) {
        const [ax, ay] = at(t.x * w, t.y * h);
        if (ax < cx - 20 || ax > cx + tile + 20) continue;
        g.strokeStyle = 'rgba(0,170,85,0.95)';
        g.beginPath(); g.arc(ax, ay, tile * 0.09, 0, 7); g.stroke();
      }
      for (const f of found) {
        const [ax, ay] = at(f.x * w, f.y * h);
        if (ax < cx - 20 || ax > cx + tile + 20) continue;
        g.strokeStyle = 'rgba(230,20,90,0.95)';
        g.beginPath(); g.arc(ax, ay, tile * 0.05, 0, 7); g.stroke();
      }
      // A crosshair on the point this tile is ABOUT, so a tile with several
      // marks in it cannot be read as being about the wrong one.
      const [mx, my] = at(px, py);
      g.strokeStyle = 'rgba(0,90,220,0.85)';
      g.beginPath();
      g.moveTo(mx - tile * 0.13, my); g.lineTo(mx - tile * 0.05, my);
      g.moveTo(mx + tile * 0.05, my); g.lineTo(mx + tile * 0.13, my);
      g.moveTo(mx, my - tile * 0.13); g.lineTo(mx, my - tile * 0.05);
      g.moveTo(mx, my + tile * 0.05); g.lineTo(mx, my + tile * 0.13);
      g.stroke();
      g.restore();
      g.strokeStyle = '#bbb'; g.lineWidth = 1;
      g.strokeRect(cx, cy, tile, tile);
      g.fillStyle = '#111';
      g.font = 'bold 15px sans-serif';
      g.fillText(`${start + k}  ${px},${py}`, cx + 2, cy - 6);
    }
    out.push(c.toDataURL('image/png'));
  }
  return out;
}, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(file), pts: points, want: truth, per: perSheet, zoom });

await browser.close();

for (const [i, url] of sheets.entries()) {
  const path = `${outBase}-${String(i).padStart(2, '0')}.png`;
  await writeFile(path, Buffer.from(url.split(',')[1], 'base64'));
  console.log(path);
}
console.log(`\n${points.length} points over ${sheets.length} sheets from ${basename(file)}`);
console.log('  green ring = a truth mark · pink ring = the reader · blue crosshair = this tile\n');
