// What is cut is what was in the blue outline.
//
// The outline is let out by a tenth before cutting (see `widen`) so that an
// outline landing a little inside the paper does not cost a line of music. The
// price was visible: "the blue part in the scanner was only on the page, but
// when I clicked done there was part of the background in it."
//
// So the margin is trimmed back off the squared page, and this measures both
// halves of that bargain on synthetic pages where the truth is known:
//
//   a) an ACCURATE outline           -> no background survives
//   b) an outline that fell SHORT    -> the music widen recovered is still there
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run scan:trim
//
// No camera: it calls straightenCanvas the way the scanner does, with corners.

import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const APP = process.env.APP ?? 'http://localhost:5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const { straightenCanvas } = await import('/src/ui/straighten.js');

  // A photograph: dark table, a bright sheet on it, five staff lines across the
  // sheet and one line of "music" near its very top edge — the part a short
  // outline eats.
  const W = 1200;
  const H = 1600;
  const PAGE = { x: 150, y: 200, w: 900, h: 1200 };
  const shot = new OffscreenCanvas(W, H);
  const ctx = shot.getContext('2d');
  ctx.fillStyle = 'rgb(38,38,42)';                 // the table
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgb(246,244,238)';              // the paper
  ctx.fillRect(PAGE.x, PAGE.y, PAGE.w, PAGE.h);
  ctx.fillStyle = 'rgb(20,20,20)';
  for (let i = 0; i < 5; i += 1) {                 // a system near the top
    ctx.fillRect(PAGE.x + 60, PAGE.y + 40 + i * 12, PAGE.w - 120, 3);
  }
  for (let i = 0; i < 5; i += 1) {                 // and one in the middle
    ctx.fillRect(PAGE.x + 60, PAGE.y + 600 + i * 12, PAGE.w - 120, 3);
  }

  const corners = (inset) => {
    const x0 = (PAGE.x + inset * PAGE.w) / W;
    const x1 = (PAGE.x + PAGE.w - inset * PAGE.w) / W;
    const y0 = (PAGE.y + inset * PAGE.h) / H;
    const y1 = (PAGE.y + PAGE.h - inset * PAGE.h) / H;
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  };

  const look = (canvas) => {
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
    const lum = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    // Background is measured at the BORDER, not over the whole page: ink is as
    // dark as the table, so counting dark pixels everywhere counts the music.
    const ring = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.03));
    let edge = 0;
    let edgeDark = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const onEdge = x < ring || y < ring || x >= canvas.width - ring || y >= canvas.height - ring;
        if (!onEdge) continue;
        edge += 1;
        if (lum((y * canvas.width + x) * 4) < 90) edgeDark += 1;
      }
    }
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (lum(i) < 140) ink += 1;
    const px = data.length / 4;
    const table = edgeDark / Math.max(1, edge) * px / 100;
    // Ink in the top eighth: the system a short outline would have cut off.
    let topInk = 0;
    const rows = Math.round(canvas.height / 8);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (lum((y * canvas.width + x) * 4) < 140) topInk += 1;
      }
    }
    return {
      w: canvas.width, h: canvas.height,
      table: +(edgeDark / Math.max(1, edge) * 100).toFixed(2),
      ink: +(ink / px * 100).toFixed(2),
      topInk,
    };
  };

  return {
    accurate: look(straightenCanvas(shot, W, H, corners(0))),
    short: look(straightenCanvas(shot, W, H, corners(0.04))),   // 4% inside the paper
  };
});

await browser.close();

console.log('an ACCURATE outline  ', JSON.stringify(result.accurate));
console.log('an outline 4% SHORT  ', JSON.stringify(result.short));

const clean = result.accurate.table < 0.5;
const kept = result.short.topInk > 0;
console.log(`\nbackground left after an accurate outline: ${result.accurate.table}%  (want under 0.5)`);
console.log(`music at the top after a short outline:    ${result.short.topInk} px  (want some)`);
console.log(clean && kept ? '\nPASS' : '\nFAIL');
process.exit(clean && kept ? 0 : 1);
