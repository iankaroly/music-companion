// THE BARS, DRAWN ON THE PAGE THEY CAME OFF.
//
// "click at the start of a bar. It'll sync to that time in the audio" rests
// entirely on the boxes this draws being the bars a player sees. Everything
// downstream — the tap, the anchor, the seek — is arithmetic; the only thing
// that can be quietly wrong is the geometry, and the only way to know it is
// right is to look at it.
//
// So this reads a real page with the app's own reader, cuts it into bars with
// `barsInReadingOrder`, draws every box on the photograph with its number in
// it, and writes the result out. It also counts the bars per system, because a
// system with one bar in it or eleven is the shape of a reading that has gone
// wrong and is worth seeing in a number as well as in a picture.
//
//   npm run dev            (on 5199)
//   npm run scan:barmap -- <page.jpg|page.png> [--out <dir>]

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const SOURCE = args.find((a) => !a.startsWith('--') && /\.(jpe?g|png)$/i.test(a));
if (!SOURCE) {
  console.error('usage: npm run scan:barmap -- <page.jpg> [--out <dir>]');
  process.exit(2);
}
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-barmap')));
const APP = flag('app', 'http://localhost:5199');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async (data) => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  const { barsInReadingOrder, barAtPoint } = await import('/src/analysis/bar-map.js');
  const { readableImage, sizeOfImage } = await import('/src/ui/straighten.js');

  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const image = await readableImage(new File([bytes], 'page.jpg', { type: 'image/jpeg' }));
  const { w, h } = sizeOfImage(image);

  // The reader works off a canvas at the size it wants; hand it the page.
  const READ_ACROSS = 1400;
  const sheet = document.createElement('canvas');
  sheet.width = READ_ACROSS;
  sheet.height = Math.round(h * (READ_ACROSS / w));
  sheet.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, sheet.width, sheet.height);
  const read = readPage(sheet, sheet.width, sheet.height);
  if (!read) return { read: false };

  const bars = barsInReadingOrder([read]);

  // Drawn on the page itself, at a size somebody can read.
  const shown = document.createElement('canvas');
  shown.width = Math.min(1600, w);
  shown.height = Math.round(h * (shown.width / w));
  const g = shown.getContext('2d');
  g.drawImage(image, 0, 0, shown.width, shown.height);
  g.lineWidth = Math.max(2, shown.width / 500);
  g.font = `${Math.round(shown.width / 45)}px system-ui, sans-serif`;
  bars.forEach((bar, i) => {
    const x = bar.left * shown.width;
    const y = bar.top * shown.height;
    const bw = (bar.right - bar.left) * shown.width;
    const bh = (bar.bottom - bar.top) * shown.height;
    g.strokeStyle = i % 2 ? 'rgb(58 130 255 / 0.9)' : 'rgb(255 90 40 / 0.9)';
    g.fillStyle = i % 2 ? 'rgb(58 130 255 / 0.13)' : 'rgb(255 90 40 / 0.13)';
    g.fillRect(x, y, bw, bh);
    g.strokeRect(x, y, bw, bh);
    g.fillStyle = '#fff';
    g.strokeStyle = 'rgb(0 0 0 / 0.85)';
    g.lineWidth = 4;
    g.strokeText(String(i + 1), x + 6, y + bh - 8);
    g.fillText(String(i + 1), x + 6, y + bh - 8);
    g.lineWidth = Math.max(2, shown.width / 500);
  });

  // A tap in the middle of every bar must find that bar again: the hit test and
  // the drawing have to agree, or the picture is right and the feature is not.
  let hits = 0;
  for (const bar of bars) {
    const mid = [(bar.left + bar.right) / 2, (bar.top + bar.bottom) / 2];
    if (barAtPoint(bars, 0, mid[0], mid[1]) === bar.index) hits += 1;
  }

  const blob = await new Promise((r) => shown.toBlob(r, 'image/jpeg', 0.9));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);

  const perSystem = [];
  for (const bar of bars) {
    perSystem[bar.stave] = (perSystem[bar.stave] ?? 0) + 1;
  }
  return {
    read: true,
    staves: read.staves.length,
    bars: bars.length,
    perSystem,
    hits,
    picture: btoa(s),
  };
}, readFileSync(SOURCE).toString('base64'));

await browser.close();

if (!report.read) {
  console.log('the reader found no staves on that page');
  process.exit(1);
}
const file = path.join(OUT, 'bars.jpg');
writeFileSync(file, Buffer.from(report.picture, 'base64'));
console.log(`systems found        ${report.staves}`);
console.log(`bars found           ${report.bars}`);
console.log(`bars per system      ${report.perSystem.join(' ')}`);
console.log(`a tap in the middle of a bar finds that bar   ${report.hits} of ${report.bars}`);
console.log(`\ndrawn on the page: ${file}`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
const ok = report.bars > 0 && report.hits === report.bars;
console.log(ok ? '\nPASS — every bar can be found by a tap in it' : '\nFAIL');
process.exit(ok ? 0 : 1);
