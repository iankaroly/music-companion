// WHAT THE FINDER DOES WITH ONE REAL FRAME.
//
// Point it at a photograph — or at a screenshot of the scanner, with the
// overlay cropped off — and it says which page-finding route ran and where each
// boundary landed, in the frame's own pixels. It draws the answer on the frame
// so it can be looked at beside the original.
//
// It exists because "the outline is short on the gutter side" has two completely
// different causes with completely different fixes: a page found as its OWN
// bright region whose mask stopped in the gutter shadow, or one wide quad cut in
// two at a fold whose shave was too generous. Nothing in the repo could tell
// them apart on a real frame.
//
//   npm run scan:frame -- <image> [--crop top,bottom]
//
// `--crop` drops that many pixels off the top and bottom before looking, which
// is how a screenshot of the scanner loses its buttons.

import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: npm run scan:frame -- <image> [--crop top,bottom]');
  process.exit(2);
}
const cropArg = args.find((a) => a.startsWith('--crop='))?.slice(7)
  ?? (args.includes('--crop') ? args[args.indexOf('--crop') + 1] : null);
const [cropTop, cropBottom] = (cropArg ?? '0,0').split(',').map((n) => Number(n) || 0);

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const OUT = join(process.env.TMPDIR ?? '/tmp', 'practice-partner-frame');
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 900 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 900));

const base64 = (await readFile(file)).toString('base64');

const report = await page.evaluate(async (b64, top, bottom) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const W = bitmap.width;
  const H = bitmap.height - top - bottom;
  const shot = document.createElement('canvas');
  shot.width = W;
  shot.height = H;
  const g = shot.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, -top);

  // THE SCANNER'S OWN CALL, not `findPages`. The guard that decides where a
  // boundary really is lives in `papersIn`, and a probe that skips it measures
  // a different program from the one the shutter runs.
  const { papersIn } = await import('/src/ui/straighten.js');
  const found = papersIn(shot, W, H) ?? [];
  // …and the raw regions underneath it, which is what says WHICH ROUTE ran:
  // two bright regions found apart, or one wide quad cut at a fold.
  const { findPages } = await import('/src/analysis/page-edges.js');
  const px = g.getImageData(0, 0, W, H).data;
  const luma = new Uint8ClampedArray(W * H);
  for (let i = 0; i < W * H; i += 1) {
    luma[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  }
  const raw = findPages(luma, W, H) ?? [];
  const inPixels = (q) => q.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);

  // Draw it: every quad found, and the columns of the frame's brightness
  // profile across the middle band, so the gutter is visible as a number.
  g.lineWidth = Math.max(3, Math.round(W / 400));
  ['#3b82f6', '#ef4444', '#10b981'].forEach((colour, i) => {
    const q = found[i];
    if (!q) return;
    g.strokeStyle = colour;
    g.beginPath();
    inPixels(q).forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
  });

  const shown = await new Promise((r) => shot.toBlob(r, 'image/jpeg', 0.86));
  const buf = new Uint8Array(await shown.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);

  // The brightness across the frame, averaged down the middle half — what the
  // mask is actually looking at. A fixture built to guess at this is a fixture
  // that measures nothing; these are the numbers to draw against.
  const profile = [];
  for (let x = 0; x < W; x += Math.max(1, Math.round(W / 120))) {
    let sum = 0;
    let n = 0;
    for (let y = Math.round(H * 0.3); y < Math.round(H * 0.7); y += 3) {
      sum += luma[y * W + x];
      n += 1;
    }
    profile.push([x, Math.round(sum / n)]);
  }

  return {
    size: [W, H],
    profile,
    pages: found.length,
    quads: found.map(inPixels),
    raw: raw.map(inPixels),
    // WHICH ROUTE. Two quads that share an edge to the pixel came out of one
    // wide quad cut at a fold; two that stand apart were found as separate
    // bright regions and never went near the fold code.
    drawn: btoa(s),
  };
}, base64, cropTop, cropBottom);

await browser.close();

console.log(`frame ${report.size[0]}x${report.size[1]}  pages found: ${report.pages}`);
report.quads.forEach((q, i) => {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  console.log(`  page ${i}: x ${Math.min(...xs)}..${Math.max(...xs)}`
    + `  y ${Math.min(...ys)}..${Math.max(...ys)}   ${JSON.stringify(q)}`);
});
// WHICH ROUTE, read off the quads BEFORE the guard touched them: two that abut
// to the pixel came out of one wide quad cut at a fold; two that stand apart
// were separate bright regions and the fold code never ran.
if (report.raw.length === 2) {
  const right0 = Math.max(...report.raw[0].map((p) => p[0]));
  const left1 = Math.min(...report.raw[1].map((p) => p[0]));
  const gap = left1 - right0;
  console.log(`  as found, before the guard: x ..${right0} | ${left1}..  (${gap}px apart)`);
  console.log(gap <= 2
    ? '  -> they ABUT: one wide quad cut at a fold (pagesApart)'
    : '  -> they STAND APART: two bright regions, the fold code never ran');
  const right0g = Math.max(...report.quads[0].map((p) => p[0]));
  console.log(`  the guard moved the gutter side of page 0 by ${right0g - right0}px`);
}
if (process.argv.includes('--profile')) {
  console.log('\nbrightness across the frame (x: level), middle half averaged:');
  console.log(report.profile.map(([x, v]) => `${x}:${v}`).join('  '));
}
const shot = join(OUT, `${basename(file).replace(/\.\w+$/, '')}-found.jpg`);
await writeFile(shot, Buffer.from(report.drawn, 'base64'));
console.log(`\npicture: ${shot}`);
