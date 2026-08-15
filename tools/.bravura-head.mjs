// throwaway: does the centre gate fire on a REAL engraved hollow notehead?
import puppeteer from 'puppeteer-core';
import { readFile, writeFile } from 'node:fs/promises';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 800));

const out = await page.evaluate(async (b64) => {
  const face = new FontFace('BravuraTest', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);
  const GLYPHS = {
    noteheadBlack: '', noteheadHalf: '', noteheadWhole: '',
  };
  const rows = [];
  for (const space of [8, 10, 12, 14, 18, 24]) {
    for (const [name, ch] of Object.entries(GLYPHS)) {
      const W = 200; const H = 120;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#111';
      g.font = `${space * 4}px BravuraTest`;   // one em == one stave == 4 spaces
      g.textBaseline = 'alphabetic';
      // Bravura noteheads sit on the baseline centred vertically on it.
      g.fillText(ch, 60, 60);
      const d = g.getImageData(0, 0, W, H).data;
      const gray = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
      }
      // ink, the way readPage makes it: darker than a local background by 16.
      // Here the background is plain paper (255) so the test is gray < 239.
      const ink = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) ink[i] = gray[i] < 255 - 16 ? 1 : 0;
      // bounding box of the glyph
      let x0 = W; let x1 = -1; let y0 = H; let y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!ink[y * W + x]) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      const cx = Math.round((x0 + x1) / 2); const cy = Math.round((y0 + y1) / 2);
      const hw = Math.max(2, Math.round(space * 0.62));
      const hh = Math.max(2, Math.round(space * 0.45));
      // the ink run on the head's own centre row, outward from the middle
      const rowInk = [];
      for (let x = x0 - 2; x <= x1 + 2; x++) rowInk.push(ink[cy * W + x] ? 1 : 0);
      // nearest and farthest ink from cx on that row
      let leftNear = null; let leftFar = null; let rightNear = null; let rightFar = null;
      for (let k = 1; k < 60; k++) {
        if (ink[cy * W + cx - k]) { if (leftNear === null) leftNear = k; leftFar = k; }
        if (ink[cy * W + cx + k]) { if (rightNear === null) rightNear = k; rightFar = k; }
      }
      const gateOld = !!(ink[cy * W + cx] || (ink[cy * W + cx - hw] && ink[cy * W + cx + hw]));
      const gateNew = !!(ink[cy * W + cx]
        || ((leftNear !== null && leftNear <= hw) && (rightNear !== null && rightNear <= hw)));
      // …and over every centre the head could plausibly be tried at
      let oldHits = 0; let newHits = 0; let tried = 0;
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
          tried++;
          if (ink[y * W + x] || (ink[y * W + x - hw] && ink[y * W + x + hw])) oldHits++;
          let l = 0; let r = 0;
          for (let k = 1; k <= hw; k++) if (ink[y * W + x - k]) { l = 1; break; }
          for (let k = 1; k <= hw; k++) if (ink[y * W + x + k]) { r = 1; break; }
          if (ink[y * W + x] || (l && r)) newHits++;
        }
      }
      rows.push({
        space, name, hw, hh,
        headHalfWidth: +((x1 - x0 + 1) / 2).toFixed(1),
        headHalfHeight: +((y1 - y0 + 1) / 2).toFixed(1),
        widthInSpaces: +((x1 - x0 + 1) / space).toFixed(2),
        centreRowInkFrom: leftNear, centreRowInkTo: leftFar,
        rightNear, rightFar,
        centrePixelInked: !!ink[cy * W + cx],
        gateOld, gateNew, oldHits, newHits, tried,
      });
    }
  }
  return rows;
}, fontBase64);

console.log('space glyph            hw  headHalfW  widthSp  centreRowInk(|dx|)  centrePx  oldGate newGate  oldHits/49 newHits/49');
for (const r of out) {
  console.log(
    String(r.space).padStart(5), r.name.padEnd(16), String(r.hw).padStart(2),
    String(r.headHalfWidth).padStart(9), String(r.widthInSpaces).padStart(8),
    `   ${String(r.centreRowInkFrom).padStart(3)}..${String(r.centreRowInkTo).padStart(3)} / ${String(r.rightNear).padStart(3)}..${String(r.rightFar).padStart(3)}`,
    String(r.centrePixelInked).padStart(9), String(r.gateOld).padStart(8), String(r.gateNew).padStart(8),
    String(r.oldHits).padStart(9), String(r.newHits).padStart(9),
  );
}
await browser.close();
