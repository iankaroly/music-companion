// Is the per-staff spacing right? Fit BOTH offset and spacing locally and
// compare against what the tracker reported.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const base64 = (await readFile(process.argv[2])).toString('base64');
const b = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const out = await p.evaluate(async (b64) => {
  const { readPage, combScore } = await import('/src/analysis/scan-read.js');
  const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
  const W = 1400;
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(img.naturalHeight * (W / img.naturalWidth));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const read = readPage(c, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const dark = (x, y) => {
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return 0;
    const i = (y * c.width + x) * 4;
    return ((data[i] + data[i + 1] + data[i + 2]) / 3) < 165 ? 1 : 0;
  };
  return read.staves.map((staff, i) => {
    const modelSpace = staff.space * c.height;
    const strip0 = 0;
    const modelTop = staff.lines[0][strip0] * c.height;
    // A profile over the left band, where the clef is read.
    const x0 = Math.round(c.width * 0.02);
    const x1 = Math.round(c.width * 0.11);
    const from = Math.round(modelTop - modelSpace * 4);
    const rows = Math.round(modelSpace * 12);
    const profile = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      let k = 0;
      for (let x = x0; x <= x1; x++) k += dark(x, from + r);
      profile[r] = k / (x1 - x0 + 1);
    }
    // Fit offset AND spacing together — the thing a shift-only search cannot do.
    let best = { y0: 0, step: modelSpace, score: -Infinity };
    for (let step = 6; step <= 18; step += 0.1) {
      for (let y0 = 0; y0 + 4 * step < rows; y0++) {
        const v = combScore(profile, y0, step);
        if (v > best.score) best = { y0, step, score: v };
      }
    }
    return {
      system: i + 1,
      clef: staff.clef,
      modelSpace: +modelSpace.toFixed(1),
      trueSpace: +best.step.toFixed(1),
      spaceErrorPct: +(((modelSpace - best.step) / best.step) * 100).toFixed(0),
      modelTopY: +modelTop.toFixed(0),
      trueTopY: +(from + best.y0).toFixed(0),
      topErrorSpaces: +(((modelTop - (from + best.y0)) / best.step)).toFixed(2),
    };
  });
}, base64);
await b.close();
console.log('sys clef     modelSpace trueSpace  err%   topErr(spaces)');
for (const r of out) {
  console.log(`${String(r.system).padStart(3)} ${String(r.clef).padEnd(8)} `
    + `${String(r.modelSpace).padStart(9)} ${String(r.trueSpace).padStart(9)} `
    + `${String(r.spaceErrorPct).padStart(5)}   ${String(r.topErrorSpaces).padStart(6)}`);
}
