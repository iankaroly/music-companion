// Throwaway probe 2: counterfactuals for the checksum on the real page.
// Ground truth (verified by eye, all ten systems): 20 bars, 2 per system,
// 16 sixteenth notes each, 320 heads, 80 beats. Zero rests/flags/dots/ties/tuplets.
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
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
  const pages = await openPaper({ source: 'images', pages: [blob] });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  const dpr = window.devicePixelRatio || 1;
  await pages.draw(0, sheet, 1400 / dpr, (1400 * 4.3) / dpr);
  const found = readPage(sheet, sheet.width, sheet.height);
  return {
    W: sheet.width, H: sheet.height, space: found.space,
    heads: notesInOrder(found).map((h) => ({ staff: h.staff, x: h.x, y: h.y, beams: h.beams, beats: h.beats })),
    bars: found.staves.map((s) => s.bars),
  };
}, { b64: base64 });

const { W, H, space } = out;
const px = space * H;
const { validateValues } = await import('file:///Users/iankaroly/music-companion/src/analysis/scan-values.js');

// ---------- 1. duplicate clustering: how many DISTINCT objects were detected?
console.log('=== OVER-DETECTION: distinct objects vs head count ===');
let clustersTotal = 0;
for (let i = 0; i < 10; i++) {
  const hs = out.heads.filter((h) => h.staff === i).sort((a, b) => a.x - b.x);
  const used = new Array(hs.length).fill(false);
  let clusters = 0;
  for (let a = 0; a < hs.length; a++) {
    if (used[a]) continue;
    used[a] = true; clusters++;
    for (let b = a + 1; b < hs.length; b++) {
      if (used[b]) continue;
      const dx = Math.abs(hs[b].x - hs[a].x) * W / px;
      const dy = Math.abs(hs[b].y - hs[a].y) * H / px;
      if (dx > 1.3) break;
      if (dx <= 1.3 && dy <= 1.5) used[b] = true;
    }
  }
  clustersTotal += clusters;
  console.log(`  staff ${i}: ${hs.length} heads -> ${clusters} distinct objects (true 32)`);
}
console.log(`  page: ${out.heads.length} heads -> ${clustersTotal} distinct objects (true 320)`);
console.log(`  duplicates (>=2 heads on one object): ${out.heads.length - clustersTotal}`);
console.log(`  remaining over-detection (extra objects): ${clustersTotal - 320}`);

// ---------- 2. counterfactuals with PERFECT barlines
// Every system's interior barline sits near x=700/1400. Split each staff there.
function barsAt(split, beatOf) {
  const bars = [];
  for (let i = 0; i < 10; i++) {
    const hs = out.heads.filter((h) => h.staff === i);
    bars.push(hs.filter((h) => h.x * W < split).map(beatOf));
    bars.push(hs.filter((h) => h.x * W >= split).map(beatOf));
  }
  return bars;
}
const SPLITS = [680, 700, 720];
for (const split of SPLITS) {
  console.log(`\n=== PERFECT BARLINES (split x=${split}) ===`);

  const A = barsAt(split, (h) => h.beats ?? 0);
  const sumsA = A.map((b) => +b.reduce((a, c) => a + c, 0).toFixed(2));
  const vA = validateValues(A);
  console.log(`  A. as read           sums: ${sumsA.join(' ')}`);
  console.log(`     validate: ok=${vA.ok} beatsPerBar=${vA.beatsPerBar} trusted=${vA.trusted.size}/20  why="${vA.why}"`);
  console.log(`     bars within 0.25 of 4.0: ${sumsA.filter((s) => Math.abs(s - 4) <= 0.25).length}`);

  const B = barsAt(split, () => 0.25);      // perfect beam counts, detection as-is
  const sumsB = B.map((b) => +b.reduce((a, c) => a + c, 0).toFixed(2));
  const nB = B.map((b) => b.length);
  const vB = validateValues(B);
  console.log(`  B. beams all correct  n:    ${nB.join(' ')}   (true 16 each)`);
  console.log(`     sums: ${sumsB.join(' ')}   (true 4.0 each)`);
  console.log(`     validate: ok=${vB.ok} beatsPerBar=${vB.beatsPerBar} trusted=${vB.trusted.size}/20  why="${vB.why}"`);
  console.log(`     bars exactly 4.0: ${sumsB.filter((s) => s === 4).length}/20`);
  console.log(`     bars off 4.0 by exactly one 16th (3.75 or 4.25): ${sumsB.filter((s) => s === 3.75 || s === 4.25).length}/20`);
}

// ---------- 3. how far is each bar from repairable-by-checksum?
console.log('\n=== IS THE CHECKSUM WELL-CONDITIONED? (perfect barlines, split 700) ===');
const A = barsAt(700, (h) => h.beats ?? 0);
const nA = barsAt(700, () => 1).map((b) => b.length);
A.forEach((b, i) => {
  const sum = b.reduce((a, c) => a + c, 0);
  const n = b.length;
  const wrongBeams = b.filter((v) => v !== 0.25).length;
  const extraHeads = n - 16;
  console.log(`  bar ${String(i).padStart(2)}: n=${String(n).padStart(2)} (true 16, +${extraHeads})  `
    + `sum=${sum.toFixed(2)} (true 4.00, +${(sum - 4).toFixed(2)})  `
    + `notes with wrong value=${wrongBeams}  => unknowns=${Math.abs(extraHeads) + wrongBeams}, equations=1`);
});
const totalUnknowns = A.reduce((a, b) => a + Math.abs(b.length - 16) + b.filter((v) => v !== 0.25).length, 0);
console.log(`\n  bars with 0 errors (checksum already right): ${A.filter((b) => b.length === 16 && b.every((v) => v === 0.25)).length}/20`);
console.log(`  bars with exactly 1 error (checksum could repair): `
  + `${A.filter((b) => Math.abs(b.length - 16) + b.filter((v) => v !== 0.25).length === 1).length}/20`);
console.log(`  bars with >=2 errors (underdetermined): `
  + `${A.filter((b) => Math.abs(b.length - 16) + b.filter((v) => v !== 0.25).length >= 2).length}/20`);
console.log(`  mean unknowns per bar: ${(totalUnknowns / 20).toFixed(1)} against 1 equation`);

await browser.close();
