// Throwaway probe: note-value error decomposition + barline gate instrumentation.
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const FILE = process.argv[2];
const OUT = process.argv[3] ?? '/private/tmp/overlay.png';

const base64 = (await readFile(FILE)).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const out = await page.evaluate(async ({ b64 }) => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const { openPaper } = await import('/src/ui/paper.js');
  const M = await import('/src/analysis/scan-read.js');
  const { readPage, notesInOrder, beamMask, stavesToLines, fillMissedStaves,
    trackCombs, combPeaks } = M;

  const WORK_WIDTH = 1400; const STRIPS = 40;
  const pages = await openPaper({ source: 'images', pages: [blob] });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  const dpr = window.devicePixelRatio || 1;
  await pages.draw(0, sheet, WORK_WIDTH / dpr, (WORK_WIDTH * 4.3) / dpr);

  const found = readPage(sheet, sheet.width, sheet.height);
  if (!found) return { ok: false };
  const heads = notesInOrder(found);

  // ---- rebuild ink exactly as readPage does, so findBars can be instrumented
  const w = Math.min(WORK_WIDTH, sheet.width);
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
    for (let y = 0; y < hh; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[y * ww + Math.min(ww - 1, Math.max(0, x))];
      for (let x = 0; x < ww; x++) { tmp[y * ww + x] = sum / span; sum += src[y * ww + Math.min(ww - 1, x + radius + 1)] - src[y * ww + Math.max(0, x - radius)]; }
    }
    for (let x = 0; x < ww; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(hh - 1, Math.max(0, y)) * ww + x];
      for (let y = 0; y < hh; y++) { dst[y * ww + x] = sum / span; sum += tmp[Math.min(hh - 1, y + radius + 1) * ww + x] - tmp[Math.max(0, y - radius) * ww + x]; }
    }
    return dst;
  };
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;

  const space = found.space * h;   // px
  const stripW = Math.max(1, Math.floor(w / STRIPS));

  // reconstruct per-staff line arrays in PIXELS from the normalised output
  const staffLines = found.staves.map((s) => s.lines.map((arr) => arr.map((v) => v * h)));

  // ---- findBars, instrumented. Same code, but reports which gate killed each column.
  const gateReport = staffLines.map((lines, si) => {
    const lineY = (index, x) => lines[index][Math.min(lines[index].length - 1, Math.max(0, Math.floor(x / stripW)))];
    const sp = space;
    const wide = Math.max(3, Math.round(sp * 1.2));
    const cols = [];
    for (let x = 0; x < w; x++) {
      const top = Math.round(lineY(0, x));
      const bottom = Math.round(lineY(4, x));
      if (bottom <= top) continue;
      let filled = 0;
      for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) filled++;
      const fill = filled / (bottom - top + 1);
      if (fill <= 0.88) { cols.push({ x, gate: 'fill', fill }); continue; }
      const ls = [0, 1, 2, 3, 4].map((k) => lineY(k, x));
      let looked = 0; let attached = 0;
      for (let y = top; y <= bottom; y++) {
        if (y < 0 || y >= h) continue;
        if (ls.some((line) => Math.abs(y - line) <= Math.max(1, sp * 0.22))) continue;
        looked += 1;
        let across = 1;
        for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
        for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
        if (across >= wide) attached += 1;
      }
      const att = looked > 0 ? attached / looked : 0;
      if (looked > 0 && att > 0.12) { cols.push({ x, gate: 'attached', fill, att }); continue; }
      const over = Math.round(sp * 1.4);
      let above = 0; let below = 0;
      for (let k = 1; k <= over; k++) {
        const up = top - k; const down = bottom + k;
        if (up >= 0 && ink[up * w + x]) above += 1;
        if (down < h && ink[down * w + x]) below += 1;
      }
      const overhang = Math.max(1, Math.round(sp * 0.5));
      if (above > overhang || below > overhang) { cols.push({ x, gate: 'overhang', fill, att, above, below, overhang, over }); continue; }
      cols.push({ x, gate: 'PASS', fill, att, above, below });
    }
    return cols;
  });

  // ---- overlay render
  const scale = 2;
  const ov = document.createElement('canvas');
  ov.width = w * scale; ov.height = h * scale;
  const g = ov.getContext('2d');
  g.drawImage(cv, 0, 0, ov.width, ov.height);
  g.lineWidth = 1.6;
  for (const hd of heads) {
    const X = hd.x * ov.width; const Y = hd.y * ov.height;
    const col = hd.beams === 0 ? '#ff0000' : hd.beams === 1 ? '#0088ff' : '#00c000';
    g.strokeStyle = col;
    g.beginPath(); g.arc(X, Y, hd.beams === 2 ? 4 : 7, 0, 7); g.stroke();
    if (hd.beams !== 2) { g.beginPath(); g.arc(X, Y, 11, 0, 7); g.stroke(); }
  }
  g.lineWidth = 3; g.strokeStyle = '#ff00ff';
  found.staves.forEach((s) => {
    for (const bx of s.bars) {
      g.beginPath(); g.moveTo(bx * ov.width, s.top * ov.height); g.lineTo(bx * ov.width, s.bottom * ov.height); g.stroke();
    }
  });
  const png = ov.toDataURL('image/png');

  const beatTally = {};
  for (const hd of heads) beatTally[hd.beats] = (beatTally[hd.beats] ?? 0) + 1;

  return {
    ok: true, W: w, H: h, spacePx: space,
    heads: heads.map((hd) => ({ staff: hd.staff, bar: hd.bar, x: hd.x, y: hd.y, beams: hd.beams, beats: hd.beats })),
    beatTally,
    staves: found.staves.map((s) => ({ bars: s.bars, n: s.heads.length, top: s.top, bottom: s.bottom, space: s.space })),
    gateReport,
    png,
  };
}, { b64: base64 });

if (!out.ok) { console.log('read failed'); process.exit(1); }
const { W, H, spacePx } = out;
console.log(`sheet ${W}x${H}  spacePx ${spacePx.toFixed(1)}`);

console.log('\n=== BEATS TALLY (page truth: every note 0.25) ===');
for (const [b, n] of Object.entries(out.beatTally).sort((a, c) => +a[0] - +c[0])) {
  const label = b === '4' ? '  <-- HOLLOW, no stem (semibreve)' : b === '2' ? '  <-- HOLLOW, stemmed (minim)' : b === '1' ? '  <-- crotchet' : '';
  console.log(`  beats=${b}: ${n}${label}`);
}
const tot = out.heads.reduce((a, hd) => a + (hd.beats ?? 0), 0);
console.log(`  total beats ${tot.toFixed(2)}  (true 80.0)`);

console.log('\n=== BARLINE GATES: what killed the columns near the true interior barline (x~700) ===');
out.gateReport.forEach((cols, i) => {
  const found = out.staves[i].bars.map((b) => (b * W).toFixed(0));
  const near = cols.filter((c) => c.x >= 620 && c.x <= 800);
  const passes = near.filter((c) => c.gate === 'PASS');
  // the best candidate column in the window: highest fill
  const solid = near.filter((c) => c.fill > 0.88).sort((a, b) => a.x - b.x);
  console.log(`\n staff ${i}  (bars found at x=[${found.join(',')}])`);
  console.log(`   columns in x=620..800 with fill>0.88: ${solid.length}`);
  const byGate = {};
  for (const c of solid) byGate[c.gate] = (byGate[c.gate] ?? 0) + 1;
  console.log(`   their verdicts: ${JSON.stringify(byGate)}`);
  for (const c of solid) {
    console.log(`     x=${c.x} fill=${c.fill.toFixed(3)} att=${(c.att ?? 0).toFixed(3)} `
      + `above=${c.above ?? '-'} below=${c.below ?? '-'} (allowed ${c.overhang ?? '-'} of ${c.over ?? '-'}) -> ${c.gate}`);
  }
});

console.log('\n=== GATE TOTALS across the whole page (columns with fill>0.88 only) ===');
const tally = {};
for (const cols of out.gateReport) for (const c of cols) if (c.fill > 0.88) tally[c.gate] = (tally[c.gate] ?? 0) + 1;
console.log(`  ${JSON.stringify(tally)}`);

await writeFile(OUT, Buffer.from(out.png.split(',')[1], 'base64'));
console.log(`\noverlay -> ${OUT}`);
await browser.close();
