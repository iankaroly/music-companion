// A photograph of an open book, taken apart into two pages.
//
// The scanner's own path — the canvas, the finder, the warp — run against a
// picture drawn to look like what a phone sees over a book on a stand: two
// leaves of paper on a dark table, each leaning away from the fold, a dark
// crease between them, music printed on both. Nothing here touches the camera:
// getUserMedia is never called and no window ever opens.
//
// What it proves is the thing that was wrong. One press of the shutter over a
// spread has to come back with TWO pages, in reading order, each squared up on
// its own — not one page bent down the middle, and not the bigger half with
// the other silently dropped. And the close-up case: a page held near enough to
// fill the frame has to be found at all, which it was not.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-spread-check.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const found = await page.evaluate(async () => {
  const { papersIn, straightenCanvas } = await import('/src/ui/straighten.js');

  // A leaf of paper, drawn as a quadrilateral with music on it and a mark in
  // one corner, so the two pages can be told apart after they come back.
  const leaf = (g, quad, mark) => {
    g.save();
    g.beginPath();
    quad.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = '#efeae2';
    g.fill();
    g.clip();
    const left = Math.min(...quad.map((p) => p[0]));
    const top = Math.min(...quad.map((p) => p[1]));
    const w = Math.max(...quad.map((p) => p[0])) - left;
    const h = Math.max(...quad.map((p) => p[1])) - top;
    g.fillStyle = '#15130f';
    for (let system = 0; system < 6; system++) {
      const y = top + h * (0.16 + system * 0.13);
      for (let line = 0; line < 5; line++) {
        g.fillRect(left + w * 0.08, y + line * (h * 0.012), w * 0.84, Math.max(1, h * 0.002));
      }
      // beamed groups: solid ink, the thing that used to cut the paper into
      // strips once the phone came close enough to resolve it
      for (let n = 0; n < 5; n++) {
        g.fillRect(left + w * (0.14 + n * 0.15), y - h * 0.02, w * 0.09, h * 0.008);
      }
    }
    // the mark that says which page this is
    g.fillRect(left + w * mark.x, top + h * 0.04, w * 0.14, h * 0.05);
    g.restore();
  };

  // The photograph: a book open on a dark table, seen from slightly off square.
  const book = () => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2823';
    g.fillRect(0, 0, c.width, c.height);
    // left leaf, leaning away from the fold, and right leaf mirrored
    leaf(g, [[150, 130], [770, 165], [780, 1050], [140, 1075]], { x: 0.06 });
    leaf(g, [[830, 165], [1450, 130], [1460, 1075], [820, 1050]], { x: 0.8 });
    // the fold: a crease in shadow between them
    g.fillStyle = 'rgb(60 55 48)';
    g.fillRect(775, 150, 50, 910);
    return c;
  };

  // A single page held close: nearly the whole frame, square to the camera.
  const close = () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2823';
    g.fillRect(0, 0, c.width, c.height);
    leaf(g, [[26, 30], [1176, 26], [1180, 1572], [22, 1568]], { x: 0.06 });
    return c;
  };

  // Where the ink is on a page that has come back, as quarters, so the mark in
  // one corner says which leaf it was.
  const inkAt = (canvas) => {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    const half = { w: canvas.width / 2, h: canvas.height / 2 };
    const quarters = [0, 0, 0, 0];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4;
        if (data[at] > 110) continue;
        quarters[(y < half.h ? 0 : 2) + (x < half.w ? 0 : 1)]++;
      }
    }
    return quarters;
  };

  const spread = book();
  const quads = papersIn(spread, spread.width, spread.height);
  const pages = quads.map((quad) => straightenCanvas(spread, spread.width, spread.height, quad));

  const one = close();
  const alone = papersIn(one, one.width, one.height);
  const onePage = alone.length === 1
    ? straightenCanvas(one, one.width, one.height, alone[0]) : null;

  return {
    pages: quads.length,
    order: quads.map((q) => q[0][0]),
    sizes: pages.map((p) => [p.width, p.height]),
    marks: pages.map(inkAt),
    alone: alone.length,
    aloneSize: onePage ? [onePage.width, onePage.height] : null,
    aloneCoverage: alone.length === 1
      ? Math.abs((alone[0][1][0] - alone[0][0][0]) * (alone[0][3][1] - alone[0][0][1])) : 0,
  };
});

check('an open book comes back as two pages', found.pages === 2, `found ${found.pages}`);
check('the left page comes first', found.order[0] < found.order[1],
  found.order.map((n) => n.toFixed(2)).join(' then '));
check('each page is a page, not half a spread',
  found.sizes.every(([w, h]) => h > w * 1.05),
  found.sizes.map(([w, h]) => `${w}×${h}`).join(', '));
// The mark sits top-left on one leaf and top-right on the other; if the warp
// had kept one page twice, or bent both onto one rectangle, this would not hold.
const [left, right] = found.marks;
check('the two pages are different pages',
  !!left && !!right && left[0] > left[1] && right[1] > right[0],
  `left quarters ${left?.join('/')}, right ${right?.join('/')}`);

check('a page held close enough to fill the frame is found', found.alone === 1,
  `found ${found.alone}`);
check('and kept at the size it was photographed',
  !!found.aloneSize && found.aloneSize[0] > 1000,
  found.aloneSize ? `${found.aloneSize[0]}×${found.aloneSize[1]}` : 'nothing came back');
check('and covers most of the frame', found.aloneCoverage > 0.85,
  found.aloneCoverage.toFixed(3));

check('no errors on the page', errors.length === 0, errors[0] ?? '');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
