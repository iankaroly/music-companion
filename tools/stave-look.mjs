// Draw the reader's STAVE MODEL on the page, magnified, so it can be compared
// with the printed lines by eye.
//
// WHY: a pitch is measured FROM THE LINES. If the model's five lines part
// company with the printed ones by half a space, every note of that passage is
// named a second wrong while the ring still sits dead centre on the notehead,
// and no residual test can see it. The only way to see it is to draw it.
//
//   node tools/stave-look.mjs <page.pdf> --at x,y [--at x,y] [--pad 90] [--zoom 6]
//
// Red = the reader's five model lines. Blue dot = a hand-marked notehead.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);
const spots = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--at') spots.push(args[i + 1].split(',').map(Number));
const pad = Number(args[args.indexOf('--pad') + 1] ?? 90);
const zoom = Number(args[args.indexOf('--zoom') + 1] ?? 6);
const tp = args.indexOf('--truth');
const truth = tp >= 0 ? JSON.parse(await readFile(args[tp + 1], 'utf8')).notes : null;

const bytes = await readFile(file);
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1400));

const out = await page.evaluate(async ({ b64, at, pad: p, zoom: z, truth, isPdf }) => {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  let src;
  if (isPdf) {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: bin }).promise;
    const pg = await doc.getPage(1);
    const scale = 1800 / pg.getViewport({ scale: 1 }).width;
    const vp = pg.getViewport({ scale });
    src = document.createElement('canvas'); src.width = vp.width; src.height = vp.height;
    await pg.render({ canvasContext: src.getContext('2d'), viewport: vp }).promise;
  } else {
    const bmp = await createImageBitmap(new Blob([bin]));
    src = document.createElement('canvas'); src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0);
  }
  const W = Math.min(1400, src.width);
  const work = document.createElement('canvas');
  work.width = W; work.height = Math.round(src.height * (W / src.width));
  work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
  const { readPage } = await import('/src/analysis/scan-read.js');
  const read = readPage(work, work.width, work.height);
  const H = work.height;
  const model = read.staves.map((st) => st.lines.map((ln) => ln.map((v) => v * H)));
  const images = at.map(([x, y]) => {
    const c = document.createElement('canvas');
    c.width = p * 2 * z; c.height = p * 2 * z;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(work, x - p, y - p, p * 2, p * 2, 0, 0, c.width, c.height);
    // the model, sampled per pixel column from the strip array
    g.strokeStyle = 'rgba(224,36,94,0.85)'; g.lineWidth = 1.5;
    for (const staff of model) {
      for (const line of staff) {
        g.beginPath();
        let started = false;
        for (let px = x - p; px <= x + p; px++) {
          const s = Math.min(line.length - 1, Math.max(0, Math.floor((px / work.width) * line.length)));
          const yy = (line[s] - (y - p)) * z;
          if (yy < -50 || yy > c.height + 50) { started = false; continue; }
          const xx = (px - (x - p)) * z;
          if (!started) { g.moveTo(xx, yy); started = true; } else g.lineTo(xx, yy);
        }
        g.stroke();
      }
    }
    if (truth) {
      g.fillStyle = '#1c7ed6';
      for (const t of truth) {
        const tx = t.x * work.width; const ty = t.y * H;
        if (tx < x - p || tx > x + p || ty < y - p || ty > y + p) continue;
        g.beginPath(); g.arc((tx - (x - p)) * z, (ty - (y - p)) * z, 1.6 * z, 0, Math.PI * 2); g.fill();
      }
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  return { images, w: work.width, h: H, staves: read.staves.length, space: read.staves.map((s) => +(s.space * H).toFixed(2)) };
}, { b64: bytes.toString('base64'), at: spots, pad, zoom, truth, isPdf: /\.pdf$/i.test(file) });

await browser.close();
console.log(`page ${out.w}x${out.h} · ${out.staves} staves · spaces ${out.space.join(' ')}`);
for (const [i, data] of out.images.entries()) {
  const path = `${process.env.CROP_OUT ?? '/tmp'}/look-${spots[i][0]}-${spots[i][1]}.png`;
  await writeFile(path, Buffer.from(data, 'base64'));
  console.log(path);
}
