// Throwaway probe 3: WHY does the `attached` gate fire on the true barlines?
// Hypothesis: the rows counted "attached" are STAFF LINES that the modelled
// line positions missed, not beams. Test: for each attached row, report its
// distance to the nearest modelled staff line, and its ink DEPTH (a staff line
// is thin; a beam is thick).
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const FILE = process.argv[2];

const base64 = (await readFile(FILE)).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
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
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(sheet, 0, 0, w, h);
  const data = cx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const boxBlur = (src, ww, hh, radius) => {
    const tmp = new Float32Array(ww * hh); const dst = new Float32Array(ww * hh);
    const span = radius * 2 + 1;
    for (let y = 0; y < hh; y++) { let s = 0;
      for (let x = -radius; x <= radius; x++) s += src[y * ww + Math.min(ww - 1, Math.max(0, x))];
      for (let x = 0; x < ww; x++) { tmp[y * ww + x] = s / span; s += src[y * ww + Math.min(ww - 1, x + radius + 1)] - src[y * ww + Math.max(0, x - radius)]; } }
    for (let x = 0; x < ww; x++) { let s = 0;
      for (let y = -radius; y <= radius; y++) s += tmp[Math.min(hh - 1, Math.max(0, y)) * ww + x];
      for (let y = 0; y < hh; y++) { dst[y * ww + x] = s / span; s += tmp[Math.min(hh - 1, y + radius + 1) * ww + x] - tmp[Math.max(0, y - radius) * ww + x]; } }
    return dst;
  };
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;

  const space = found.space * h;
  const stripW = Math.max(1, Math.floor(w / STRIPS));
  const depth = (x, y) => { let d = 1;
    for (let yy = y - 1; yy >= 0 && ink[yy * w + x]; yy--) d++;
    for (let yy = y + 1; yy < h && ink[yy * w + x]; yy++) d++;
    return d; };

  // For each staff, the column in 620..800 with the highest fill = best barline candidate.
  const report = found.staves.map((s, si) => {
    const lines = s.lines.map((arr) => arr.map((v) => v * h));
    const lineY = (k, x) => lines[k][Math.min(lines[k].length - 1, Math.max(0, Math.floor(x / stripW)))];
    const wide = Math.max(3, Math.round(space * 1.2));
    let bestX = -1; let bestFill = 0;
    for (let x = 620; x <= 800; x++) {
      const top = Math.round(lineY(0, x)); const bottom = Math.round(lineY(4, x));
      if (bottom <= top) continue;
      let f = 0;
      for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) f++;
      const fill = f / (bottom - top + 1);
      if (fill > bestFill) { bestFill = fill; bestX = x; }
    }
    const x = bestX;
    const top = Math.round(lineY(0, x)); const bottom = Math.round(lineY(4, x));
    const ls = [0, 1, 2, 3, 4].map((k) => lineY(k, x));
    const rows = [];
    for (let y = top; y <= bottom; y++) {
      const near = Math.min(...ls.map((L) => Math.abs(y - L)));
      const skipped = near <= Math.max(1, space * 0.22);
      let across = 1;
      for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
      for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
      rows.push({ y: y - top, near: +near.toFixed(1), skipped, across, deep: ink[y * w + x] ? depth(x, y) : 0 });
    }
    const looked = rows.filter((r) => !r.skipped);
    const att = looked.filter((r) => r.across >= wide);
    return {
      si, x, fill: +bestFill.toFixed(3),
      foundBars: s.bars.map((b) => Math.round(b * w)),
      looked: looked.length, attached: att.length,
      ratio: +(att.length / Math.max(1, looked.length)).toFixed(3),
      wide,
      // The key question: are the attached rows NEAR a modelled staff line
      // (=> unstripped line, drift) or between them (=> a real beam)?
      attRows: att.map((r) => ({ near: r.near, across: r.across, deep: r.deep })),
      // how far the nearest ACTUAL dark row is from each modelled line, at this x
      drift: ls.map((L) => {
        const at = Math.round(L);
        for (let d = 0; d <= 6; d++) {
          if (at - d >= 0 && ink[(at - d) * w + x] && depth(x, at - d) <= 5) return -d;
          if (at + d < h && ink[(at + d) * w + x] && depth(x, at + d) <= 5) return d;
        }
        return null;
      }),
    };
  });
  return { space, report };
}, { b64: base64 });

console.log(`staff space ${out.space.toFixed(1)}px;  the "attached" gate skips rows within ${(out.space * 0.22).toFixed(1)}px of a MODELLED staff line\n`);
let nearLine = 0; let betweenLines = 0;
for (const r of out.report) {
  const skipWin = Math.max(1, out.space * 0.22);
  const onLine = r.attRows.filter((a) => a.near <= out.space * 0.5).length;
  const between = r.attRows.length - onLine;
  nearLine += onLine; betweenLines += between;
  const verdict = r.ratio > 0.12 ? 'KILLED by attached' : 'passes attached';
  console.log(`staff ${r.si}: best column x=${r.x} fill=${r.fill}  bars found=[${r.foundBars}]`);
  console.log(`   attached ${r.attached}/${r.looked} = ${r.ratio}  (limit 0.12)  -> ${verdict}`);
  console.log(`   of the attached rows: ${onLine} lie within half a space of a MODELLED staff line `
    + `(= unstripped staff line), ${between} lie between the lines (= a real beam)`);
  console.log(`   model drift at this column, per line (px, null = no thin ink within 6px): [${r.drift.join(', ')}]`);
  if (r.attRows.length) {
    console.log(`   attached rows (distance-to-nearest-modelled-line, sideways run, ink depth):`);
    console.log(`     ${r.attRows.map((a) => `${a.near}/${a.across}/${a.deep}`).join('  ')}`);
  }
  console.log('');
}
console.log(`TOTAL attached rows on the ten best-barline columns: ${nearLine} on a staff line, ${betweenLines} between lines`);
await browser.close();
