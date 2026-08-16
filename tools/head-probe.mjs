// Why is there no notehead here?
//
// tools/scan-crop shows a notehead with no ring on it. This says which test in
// findHeads turned it down, and by how much. Give it points; it walks a small
// neighbourhood around each and reports the best verdict it can find, because
// a head's centre by eye is a pixel or two off its centre by ink.
//
//   npm run scan:why -- <page.pdf> 264,556 390,551
//
// With no points it audits instead: it takes every head the reader DID find and
// checks headProbe agrees, which is what keeps the probe honest as findHeads
// changes.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const args = process.argv.slice(2);
const file = args.find((a) => !a.includes(','));
const spots = args.filter((a) => a.includes(',')).map((a) => a.split(',').map(Number));
if (!file) { console.log('usage: npm run scan:why -- <page.pdf> [x,y …]'); process.exit(1); }
const bytes = await readFile(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const out = await page.evaluate(async ({ b64, pdf, at }) => {
  const { readPage, notesInOrder, headProbe, beamMask } = await import('/src/analysis/scan-read.js');
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
  const rad = Math.max(4, Math.round(w / 36)); const span = rad * 2 + 1;
  const t1 = new Float32Array(w * h); const bg = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -rad; x <= rad; x++) s += gray[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { t1[y * w + x] = s / span; s += gray[y * w + Math.min(w - 1, x + rad + 1)] - gray[y * w + Math.max(0, x - rad)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -rad; y <= rad; y++) s += t1[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { bg[y * w + x] = s / span; s += t1[Math.min(h - 1, y + rad + 1) * w + x] - t1[Math.max(0, y - rad) * w + x]; }
  }
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;

  const read = readPage(work, w, h);
  const spaces = read.staves.map((s) => s.space * h).sort((a, b) => a - b);
  const space = spaces[Math.floor(spaces.length / 2)];
  const body = beamMask(ink, w, h, space);
  const found = notesInOrder(read).map((n) => [n.x * w, n.y * h]);

  // The probe must agree with the reader on the heads the reader accepted.
  let agree = 0;
  for (const [hx, hy] of found) {
    const r = headProbe(body, w, h, space, gray, bg, Math.round(hx), Math.round(hy));
    if (r.verdict === 'accepted') agree++;
  }

  const reports = at.map(([x, y]) => {
    let best = null;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const r = headProbe(body, w, h, space, gray, bg, x + dx, y + dy);
        if (r.verdict === 'accepted') return { x, y, at: `${x + dx},${y + dy}`, ...r };
        if (!best || (r.fill ?? 0) > (best.fill ?? 0)) best = { x, y, at: `${x + dx},${y + dy}`, ...r };
      }
    }
    return best;
  });
  return { space: +space.toFixed(1), found: found.length, agree, reports };
}, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(file), at: spots });

await browser.close();
console.log(`\nstaff space ${out.space}px · the reader found ${out.found} heads`);
// Two known reasons the probe and the reader differ, neither of them drift:
// the reader measures each stave with its OWN staff space and the probe uses
// the page's median, and the width floor the reader applies is computed from
// the whole page's heads, which one point cannot know. So the agreement is a
// smoke alarm, not a checksum — a sudden collapse in it means the probe has
// stopped mirroring findHeads and its verdicts should not be trusted.
console.log(`the probe agrees with it on ${out.agree}/${out.found} of them`
  + `${out.agree < out.found * 0.5 ? '  <-- too low: the probe has drifted from findHeads' : ''}\n`);
for (const r of out.reports) {
  console.log(`  ${r.x},${r.y}  ${r.verdict}`);
  const nums = ['fill', 'rim', 'core', 'paper', 'across']
    .filter((k) => r[k] !== undefined).map((k) => `${k} ${r[k]}`).join('   ');
  if (nums) console.log(`      ${nums}`);
  if (r.solidCentre !== undefined) {
    console.log(`      centre ${r.solidCentre ? 'ink' : 'paper'}`
      + `   left ${r.leftInk ? 'ink' : 'paper'}   right ${r.rightInk ? 'ink' : 'paper'}`);
  }
}
console.log('');
