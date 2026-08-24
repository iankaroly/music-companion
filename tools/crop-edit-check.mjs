// MOVING THE EDGES OF A SCANNED PAGE, AND WHERE THEY START FROM.
//
// Two complaints, one screen: "when I click Edges … when I drag, it works fine,
// except it's very glitchy, it's slow, and the edges start off below what was
// actually scanned in the blue rectangle."
//
// WHERE THEY START. Three things move an outline between being found and being
// cut — the guard pushes a side out to the paper's real edge, `widen` lets the
// whole thing out by a tenth so an outline a little inside the paper does not
// cost a line of music, and `trimBackground` takes back whatever of the table
// that let in. The scanner kept the outline from BEFORE all of that and opened
// the editor on it, so the handles sat inside the page that had actually been
// kept and dragging them out again undid work already done right.
//
// HOW IT DRAGS. `draw` wrote an SVG source string into `overlay.innerHTML` on
// every pointermove: parsing markup and building six elements, sixty to a
// hundred and twenty times a second, for a gesture that is four numbers.
//
// Both are measured here rather than described: the gap between the quad the
// editor opens on and the quad the page was cut to, and the wall-clock cost of
// a hundred moves of a corner.
//
//   npm run dev            (on 5199)
//   npm run crop:edit
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// --- 1. the editor opens on the page that was KEPT ------------------------
//
// A photograph of a sheet with room round it, put through the same call the
// shutter makes, and then asked: where did the page it produced come from?
const cut = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1600;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, c.width, c.height);
  // paper, with a margin of table all round it
  g.fillStyle = '#f4f2ee'; g.fillRect(140, 190, 920, 1220);
  // …and music on it, so the edges are edges of paper and not of print
  g.fillStyle = '#101010';
  for (let sys = 0; sys < 9; sys += 1) {
    for (let line = 0; line < 5; line += 1) {
      g.fillRect(210, 300 + sys * 120 + line * 9, 780, 2);
    }
  }
  const { straightenCanvas, papersIn } = await import('/src/ui/straighten.js');
  const all = papersIn(c, c.width, c.height);
  let reported = null;
  straightenCanvas(c, c.width, c.height, all[0] ?? null, { onQuad: (q) => { reported = q; } });
  const box = (q) => (q ? {
    left: Math.min(...q.map((p) => p[0])), right: Math.max(...q.map((p) => p[0])),
    top: Math.min(...q.map((p) => p[1])), bottom: Math.max(...q.map((p) => p[1])),
  } : null);
  return { found: box(all[0]), reported: box(reported), pages: all.length };
});
const area = (b) => (b ? (b.right - b.left) * (b.bottom - b.top) : 0);
const grew = cut.reported && cut.found
  ? ((area(cut.reported) / area(cut.found)) - 1) * 100 : null;
check('the pipeline reports where the page it cut came from', !!cut.reported,
  cut.reported ? `found ${(area(cut.found) * 100).toFixed(1)}% of the frame, `
    + `cut ${(area(cut.reported) * 100).toFixed(1)}% — ${grew >= 0 ? '+' : ''}${grew?.toFixed(1)}%`
    : 'onQuad said nothing');
// The whole point: the two are NOT the same, so opening on the found one is a
// real error rather than a tidiness argument.
check('…and it is not the outline that was found', grew !== null && Math.abs(grew) > 1,
  `they differ by ${grew?.toFixed(1)}% of the frame`);

// --- 2. dragging a corner --------------------------------------------------
const drag = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, 900, 1200);
  g.fillStyle = '#fff'; g.fillRect(90, 180, 720, 840);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const { editCorners } = await import('/src/ui/crop.js');
  editCorners(blob, [[0.1, 0.15], [0.9, 0.15], [0.9, 0.85], [0.1, 0.85]]);
  await new Promise((r) => setTimeout(r, 800));

  const overlay = document.querySelector('#crop-overlay');
  const dot = overlay.querySelector('circle[r="13"]');
  const at = dot.getBoundingClientRect();
  const send = (type, x, y) => overlay.dispatchEvent(new PointerEvent(type, {
    pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
  }));
  const x0 = at.left + at.width / 2;
  const y0 = at.top + at.height / 2;
  send('pointerdown', x0, y0);
  // A hundred moves, which is about a second of a real finger.
  const t0 = performance.now();
  for (let i = 1; i <= 100; i += 1) send('pointermove', x0 + i * 0.6, y0 + i * 0.4);
  const spent = performance.now() - t0;
  send('pointerup', x0 + 60, y0 + 40);
  // …and the outline really followed, rather than being fast by doing nothing.
  const moved = overlay.querySelector('circle[r="13"]').getBoundingClientRect();
  const nodes = overlay.querySelectorAll('*').length;
  // Measured while it is still on screen: a hidden layer is 0x0 and every
  // assertion about its size passes against nothing.
  const overlayBox = overlay.getBoundingClientRect();
  const layerBox = document.querySelector('#crop').getBoundingClientRect();
  // Does the sentence saying what to do land on top of the buttons? It did, as
  // soon as four of them wrapped onto two rows at 390px.
  const hintBox = document.querySelector('.crop-hint').getBoundingClientRect();
  const barBox = document.querySelector('.crop-bar').getBoundingClientRect();
  const overlaps = hintBox.bottom > barBox.top + 1 && hintBox.top < barBox.bottom;
  // …and the picture is not underneath either of them.
  const picBox = document.querySelector('#crop-picture').getBoundingClientRect();
  const clearsFoot = picBox.bottom <= hintBox.top + 1;
  document.querySelector('#crop').hidden = true;
  return {
    perMove: spent / 100,
    followed: Math.round(moved.left - at.left),
    nodes,
    masks: overlay.querySelectorAll('mask').length,
    // THE OVERLAY IS THE SIZE OF THE LAYER IT IS OVER, which is not something
    // `inset: 0` guarantees for an <svg>: with no viewBox it is a replaced
    // element with an intrinsic 300x150 and it ignores the far insets. Taking
    // the viewBox away shrank the whole outline into the corner, and every
    // assertion here still passed — an SVG circle reports its geometry whether
    // or not anybody can see it.
    overlaps,
    clearsFoot,
    overlayBox: [Math.round(overlayBox.width), Math.round(overlayBox.height)],
    layerBox: [Math.round(layerBox.width), Math.round(layerBox.height)],
    viewBox: overlay.getAttribute('viewBox'),
  };
});
// A pointermove has one frame to be answered in; a sixth of that is a budget
// with room for the rest of the app in it.
check('a corner drag costs well under a frame per move', drag.perMove < 2.0,
  `${drag.perMove.toFixed(3)} ms a move over 100 moves`);
check('…and the outline actually followed the finger', drag.followed > 40,
  `the handle moved ${drag.followed}px`);
check('the overlay is not rebuilt on every move', drag.nodes > 0 && drag.nodes < 12,
  `${drag.nodes} nodes in the overlay`);
// A full-screen SVG mask is an offscreen buffer the size of the screen,
// re-rasterised whenever anything inside it moves — over a twelve-megapixel
// photograph, on a phone. One even-odd path says the same thing with no buffer.
check('the shade is cut by a fill rule, not by a mask', drag.masks === 0,
  `${drag.masks} mask element(s)`);
check('and it draws in its own box, with no viewBox to letterbox it',
  drag.viewBox === null, `viewBox: ${drag.viewBox}`);
check('…and that box is the whole layer, not an SVG\'s intrinsic 300x150',
  drag.overlayBox[0] > 100 && drag.overlayBox[0] === drag.layerBox[0]
    && drag.overlayBox[1] === drag.layerBox[1],
  `overlay ${drag.overlayBox.join('x')}, layer ${drag.layerBox.join('x')}`);

check('the hint does not print through the buttons', drag.overlaps === false);
check('…and the picture clears both of them', drag.clearsFoot === true);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
