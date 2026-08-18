// The lighting pass, drawn: the photograph, the page with its lighting divided
// out, and the page brightened for looking at — side by side, same crop.
//
// Every real decision about this file has been made by looking at a page rather
// than at a number, and there was no way to look at this one.
//
//   npm run dev            (in another terminal)
//   node tools/lighting-look.mjs [--at x,y] [--out /tmp/lighting.png]
//
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const argv = process.argv.slice(2);
const flag = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const out = flag('out', '/tmp/lighting.png');
const at = (flag('at', '0.30,0.34')).split(',').map(Number);
const which = Number(flag('page', 0));

const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const entry = index[which];
const bytes = (await readFile(entry.file)).toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1200 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const png = await page.evaluate(async ({ b64, spot }) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
  const one = await doc.getPage(1);
  const scale = 1400 / one.getViewport({ scale: 1 }).width;
  const view = one.getViewport({ scale });
  const sheet = document.createElement('canvas');
  sheet.width = view.width;
  sheet.height = view.height;
  await one.render({ canvasContext: sheet.getContext('2d'), viewport: view }).promise;

  // A photograph of it: soft, low contrast, a lamp on one side, JPEGed.
  const shot = document.createElement('canvas');
  shot.width = sheet.width;
  shot.height = sheet.height;
  const g = shot.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(0.8px) contrast(0.62) brightness(0.92)';
  g.drawImage(sheet, 0, 0);
  g.filter = 'none';
  const lamp = g.createLinearGradient(0, 0, shot.width, shot.height);
  lamp.addColorStop(0, 'rgb(0 0 0 / 0)');
  lamp.addColorStop(1, 'rgb(24 18 6 / 0.5)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, shot.width, shot.height);

  const { unshadow } = await import('/src/analysis/unshadow.js');
  const pass = (lift) => {
    const c = document.createElement('canvas');
    c.width = shot.width;
    c.height = shot.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(shot, 0, 0);
    const image = ctx.getImageData(0, 0, c.width, c.height);
    unshadow(image.data, c.width, c.height, { lift });
    ctx.putImageData(image, 0, 0);
    return c;
  };
  const flat = pass(false);
  const bright = pass(true);

  // The same crop of each, one under the other, labelled.
  const cw = 900;
  const ch = 300;
  const sx = Math.round(spot[0] * shot.width);
  const sy = Math.round(spot[1] * shot.height);
  const sheetOut = document.createElement('canvas');
  sheetOut.width = cw;
  sheetOut.height = ch * 3 + 90;
  const o = sheetOut.getContext('2d');
  o.fillStyle = '#fff';
  o.fillRect(0, 0, sheetOut.width, sheetOut.height);
  o.fillStyle = '#111';
  o.font = '600 20px system-ui, sans-serif';
  [['the photograph', shot], ['lighting divided out — what the READER reads', flat],
    ['…and brightened — what the PLAYER sees', bright]].forEach(([label, src], i) => {
    const top = i * (ch + 30) + 26;
    o.fillText(label, 8, top - 6);
    o.drawImage(src, sx, sy, cw, ch, 0, top, cw, ch);
  });
  return sheetOut.toDataURL('image/png');
}, { b64: bytes, spot: at });

writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
console.log(`${entry.name} at ${at.join(',')} → ${out}`);
await browser.close();
