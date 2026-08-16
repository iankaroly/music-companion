// Why is there no barline here? See barProbe in scan-read.js.
//   npm run scan:bar-why -- <page.pdf> 472,364 918,364 994,364
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const args = process.argv.slice(2);
const file = args.find((a) => !a.includes(','));
const spots = args.filter((a) => a.includes(',')).map((a) => a.split(',').map(Number));
const bytes = await readFile(file);
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));
const out = await page.evaluate(async ({ b64, pdf, at }) => {
  const { readPage, barProbe } = await import('/src/analysis/scan-read.js');
  const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  let src;
  if (pdf) {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const f = await doc.getPage(1);
    const vp = f.getViewport({ scale: 1800 / f.getViewport({ scale: 1 }).width });
    src = document.createElement('canvas'); src.width = vp.width; src.height = vp.height;
    await f.render({ canvasContext: src.getContext('2d'), viewport: vp }).promise;
  } else {
    const bmp = await createImageBitmap(new Blob([binary]));
    src = document.createElement('canvas'); src.width = bmp.width; src.height = bmp.height;
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
  for (let y = 0; y < h; y++) { let s = 0;
    for (let x = -rad; x <= rad; x++) s += gray[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { t1[y * w + x] = s / sp; s += gray[y * w + Math.min(w - 1, x + rad + 1)] - gray[y * w + Math.max(0, x - rad)]; } }
  for (let x = 0; x < w; x++) { let s = 0;
    for (let y = -rad; y <= rad; y++) s += t1[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { bg[y * w + x] = s / sp; s += t1[Math.min(h - 1, y + rad + 1) * w + x] - t1[Math.max(0, y - rad) * w + x]; } }
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
  const read = readPage(work, w, h);
  const stripW = Math.max(1, Math.floor(w / 40));
  return at.map(([x, y]) => {
    // the stave nearest that y
    let best = 0; let gap = Infinity;
    for (const [i, s] of read.staves.entries()) {
      const mid = s.lines[2][Math.min(s.lines[2].length - 1, Math.round((x / w) * (s.lines[2].length - 1)))] * h;
      if (Math.abs(mid - y) < gap) { gap = Math.abs(mid - y); best = i; }
    }
    const s = read.staves[best];
    const staff = { space: s.space * h, lines: s.lines.map((L) => ({ at: Float32Array.from(L, (v) => v * h) })) };
    // the best column within a space either side, since a barline is a pixel wide
    let top = null;
    for (let dx = -Math.round(staff.space); dx <= Math.round(staff.space); dx++) {
      const r = barProbe(ink, w, h, staff, stripW, staff.space, x + dx);
      if (r.verdict === 'accepted') return { x, y, at: x + dx, system: best + 1, ...r };
      if (!top || (r.fill ?? 0) > (top.fill ?? 0)) top = { x, y, at: x + dx, system: best + 1, ...r };
    }
    return top;
  });
}, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(file), at: spots });
await browser.close();
for (const r of out) {
  console.log(`  ${r.x},${r.y}  system ${r.system}  ${r.verdict}`);
  console.log(`      fill ${r.fill}${r.attached !== undefined ? `   attached ${r.attached}` : ''}`
    + `${r.above !== undefined ? `   above ${r.above} below ${r.below}` : ''}`);
}
