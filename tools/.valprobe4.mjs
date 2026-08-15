// Throwaway probe 4: pin the `attached` mechanism at the TRUE barline column.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const FILE = process.argv[2];
const base64 = (await readFile(FILE)).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const out = await page.evaluate(async ({ b64 }) => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const { openPaper } = await import('/src/ui/paper.js');
  const { readPage } = await import('/src/analysis/scan-read.js');
  const WORK = 1400; const STRIPS = 40;
  const pages = await openPaper({ source: 'images', pages: [blob] });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  const dpr = window.devicePixelRatio || 1;
  await pages.draw(0, sheet, WORK / dpr, (WORK * 4.3) / dpr);
  const found = readPage(sheet, sheet.width, sheet.height);
  const w = Math.min(WORK, sheet.width);
  const h = Math.round(sheet.height * (w / sheet.width));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(sheet, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const boxBlur = (src, ww, hh, r) => { const t = new Float32Array(ww * hh); const d = new Float32Array(ww * hh); const sp = r * 2 + 1;
    for (let y = 0; y < hh; y++) { let s = 0; for (let x = -r; x <= r; x++) s += src[y * ww + Math.min(ww - 1, Math.max(0, x))];
      for (let x = 0; x < ww; x++) { t[y * ww + x] = s / sp; s += src[y * ww + Math.min(ww - 1, x + r + 1)] - src[y * ww + Math.max(0, x - r)]; } }
    for (let x = 0; x < ww; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(hh - 1, Math.max(0, y)) * ww + x];
      for (let y = 0; y < hh; y++) { d[y * ww + x] = s / sp; s += t[Math.min(hh - 1, y + r + 1) * ww + x] - t[Math.max(0, y - r) * ww + x]; } }
    return d; };
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
  const pageSpace = found.space * h;
  const stripW = Math.max(1, Math.floor(w / STRIPS));

  // The TRUE interior barline column per staff: found by eye from the overlay,
  // and cross-checked as the longest solid full-height column in 620..800 whose
  // ink does NOT overhang the stave (the one thing only a barline does).
  const TRUE_X = [735, 696, 713, 700, 717, 699, 726, 692, 700, 692];

  return {
    pageSpace,
    staves: found.staves.map((s, si) => {
      const lines = s.lines.map((arr) => arr.map((v) => v * h));
      const lineY = (k, x) => lines[k][Math.min(lines[k].length - 1, Math.max(0, Math.floor(x / stripW)))];
      const x = TRUE_X[si];
      const top = Math.round(lineY(0, x)); const bottom = Math.round(lineY(4, x));
      const ls = [0, 1, 2, 3, 4].map((k) => lineY(k, x));
      // where the staff lines ACTUALLY are at this column, from a clean column 30px left
      const probeX = x - 30;
      const actual = [];
      for (let y = top - 8; y <= bottom + 8; y++) {
        if (y < 1 || y >= h - 1) continue;
        if (ink[y * w + probeX] && !ink[(y - 1) * w + probeX]) {
          let d = 1; let yy = y;
          while (yy + 1 < h && ink[(yy + 1) * w + probeX]) { d++; yy++; }
          if (d <= 5) actual.push(y + (d - 1) / 2);
        }
      }
      const rows = [];
      const wide = Math.max(3, Math.round(pageSpace * 1.2));
      for (let y = top; y <= bottom; y++) {
        const near = Math.min(...ls.map((L) => Math.abs(y - L)));
        const skipped = near <= Math.max(1, pageSpace * 0.22);
        let across = 1;
        for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
        for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
        rows.push({ y, dy: y - top, near: +near.toFixed(1), skipped, across, on: !!ink[y * w + x] });
      }
      const looked = rows.filter((r) => !r.skipped);
      const att = looked.filter((r) => r.across >= wide);
      return {
        si, x, span: bottom - top, pageSpanExpect: +(4 * pageSpace).toFixed(1),
        staffSpace: +(s.space * h).toFixed(2),
        modelled: ls.map((v) => +v.toFixed(1)),
        actual: actual.map((v) => +v.toFixed(1)),
        totalRows: rows.length, skipped: rows.length - looked.length, looked: looked.length,
        attached: att.length, ratio: +(att.length / Math.max(1, looked.length)).toFixed(3),
        wide,
        attDetail: att.map((r) => ({ dy: r.dy, near: r.near, across: r.across })),
        foundBars: s.bars.map((b) => Math.round(b * w)),
      };
    }),
  };
}, { b64: base64 });

console.log(`page staff space (what findBars is given): ${out.pageSpace.toFixed(2)}px`);
console.log(`skip window = space*0.22 = ${(out.pageSpace * 0.22).toFixed(2)}px;  wide = round(space*1.2) = ${Math.round(out.pageSpace * 1.2)}px\n`);
for (const s of out.staves) {
  const drift = s.modelled.map((m) => {
    let best = null;
    for (const a of s.actual) if (best === null || Math.abs(a - m) < Math.abs(best - m)) best = a;
    return best === null ? 'n/a' : (best - m).toFixed(1);
  });
  console.log(`staff ${s.si}  true barline x=${s.x}  (findBars returned [${s.foundBars}]) ${s.foundBars.some((b) => Math.abs(b - s.x) < 12) ? 'FOUND' : '*** MISSED ***'}`);
  console.log(`   per-staff space ${s.staffSpace}px vs page space ${out.pageSpace.toFixed(2)}px  `
    + `(ratio ${(s.staffSpace / out.pageSpace).toFixed(3)})`);
  console.log(`   line0..line4 span ${s.span}px; 4 page-spaces would be ${s.pageSpanExpect}px`);
  console.log(`   rows ${s.totalRows}: skipped ${s.skipped}, looked ${s.looked}, attached ${s.attached} => ${s.ratio} (limit 0.12)`);
  console.log(`   modelled lines: [${s.modelled}]`);
  console.log(`   actual lines  : [${s.actual}]`);
  console.log(`   drift (actual - modelled): [${drift}]`);
  if (s.attDetail.length) console.log(`   attached rows (dy / near / sidewaysRun): ${s.attDetail.map((a) => `${a.dy}/${a.near}/${a.across}`).join('  ')}`);
  console.log('');
}
await browser.close();
