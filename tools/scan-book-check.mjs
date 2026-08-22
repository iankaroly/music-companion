// THE SCANNER, ON A BOOK MADE OF REAL PAGES — and it leaves the pictures behind
// so somebody can look at them.
//
// `scan:pages` draws its book: five-line staves and rectangles for beamed
// groups, clipped to a quadrilateral. That corpus has caught real bugs and it
// keeps catching them, and it is still a drawing. A real page has a title, a
// ragged last system, dynamics under the stave, a page number in the margin, an
// outer edge that curls, and ink that stops in different places on every line —
// and every one of those is something the finder has to not mistake for the
// edge of the paper or the fold of a book.
//
// So this builds the frame out of REAL ENGRAVED PAGES, rendered from a PDF,
// warped into a photograph the way a phone sees a book open on a stand, and
// runs the whole shutter path over it: find the pages, pick the one being aimed
// at, cut it out. Then it says how much of the aimed page came back and how
// much of its neighbour came with it — and writes `frame.png` and `kept.jpg`
// so the answer can be looked at rather than only counted.
//
//   npm run dev              (on 5199)
//   npm run scan:book -- [--pdf <file.pdf>] [--out <dir>]
//
// The PDF is somebody's own sheet music and is not in this repo; the check says
// so and stops rather than pretending, exactly as pages/index.json does.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-scan-book')));
const APP = flag('app', 'http://localhost:5199');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

let pdf = flag('pdf', null);
if (!pdf) {
  try {
    const index = JSON.parse(readFileSync(path.join(process.cwd(), 'pages/index.json'), 'utf8'));
    pdf = index.find((row) => existsSync(row.file))?.file ?? null;
  } catch { /* no index, no default */ }
}
if (!pdf || !existsSync(pdf)) {
  console.log('no page to build a book from — pass --pdf <file.pdf>.');
  console.log('The marked pages in pages/index.json are somebody\'s own sheet music');
  console.log('and are deliberately not in this repo.');
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

// Two pages of real music, rendered big enough to be photographed.
const rendered = [];
for (const page of [1, 2]) {
  const file = path.join(OUT, `sheet-${page}.png`);
  if (!existsSync(file)) {
    execFileSync('gs', ['-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', '-r200',
      `-dFirstPage=${page}`, `-dLastPage=${page}`, `-sOutputFile=${file}`, pdf], { stdio: 'pipe' });
  }
  if (existsSync(file)) rendered.push(file);
}
if (!rendered.length) {
  console.error('ghostscript rendered nothing from', pdf);
  process.exit(1);
}
// A one-page part is still a book if the same page is used twice: what is being
// tested is the FOLD between two sheets, not that they hold different music.
while (rendered.length < 2) rendered.push(rendered[0]);
console.log(`built from ${path.basename(pdf)}, pages 1 and ${rendered.length}`);

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async (sheets) => {
  const {
    papersIn, besideOf, straightenCanvas, readableImage, sizeOfImage,
  } = await import('/src/ui/straighten.js');
  const { aimedPage } = await import('/src/analysis/page-edges.js');

  const scratch = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.round(w); c.height = Math.round(h); return c;
  };
  const decoded = [];
  for (const one of sheets) {
    const bytes = Uint8Array.from(atob(one), (c) => c.charCodeAt(0));
    decoded.push(await readableImage(new File([bytes], 'sheet.png', { type: 'image/png' })));
  }

  // THE PHOTOGRAPH. A phone held over a book open on a stand: the near page
  // filling most of the frame, the far one falling away across the gutter, a
  // dark stand under both, the light falling off towards one corner, and the
  // outer edge of the near page lifting into shadow the way a bound page does.
  const W = 3024;
  const H = 4032;
  const shot = scratch(W, H);
  const g = shot.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgb(46,42,38)';
  g.fillRect(0, 0, W, H);

  // Each sheet is drawn through its own quadrilateral, so both lean.
  const quads = [
    // the facing page, mostly out of frame on the left
    [[-620, 300], [980, 210], [1010, 3760], [-560, 3660]],
    // the page being scanned
    [[1120, 190], [2930, 300], [2880, 3820], [1070, 3730]],
  ];
  const drawInto = (image, quad) => {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const source = scratch(iw, ih);
    source.getContext('2d').drawImage(image, 0, 0);
    const src = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, iw, ih);
    const left = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[0]))));
    const right = Math.min(W, Math.ceil(Math.max(...quad.map((p) => p[0]))));
    const top = Math.max(0, Math.floor(Math.min(...quad.map((p) => p[1]))));
    const bottom = Math.min(H, Math.ceil(Math.max(...quad.map((p) => p[1]))));
    const im = g.getImageData(left, top, right - left, bottom - top);
    const od = im.data;
    const sd = src.data;
    const width = right - left;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        // Invert the bilinear surface of the quad to find (u,v).
        let u = (x - Math.min(...quad.map((p) => p[0])))
          / (Math.max(...quad.map((p) => p[0])) - Math.min(...quad.map((p) => p[0])));
        let v = (y - Math.min(...quad.map((p) => p[1])))
          / (Math.max(...quad.map((p) => p[1])) - Math.min(...quad.map((p) => p[1])));
        for (let k = 0; k < 10; k += 1) {
          const px = (1 - u) * (1 - v) * quad[0][0] + u * (1 - v) * quad[1][0]
            + u * v * quad[2][0] + (1 - u) * v * quad[3][0];
          const py = (1 - u) * (1 - v) * quad[0][1] + u * (1 - v) * quad[1][1]
            + u * v * quad[2][1] + (1 - u) * v * quad[3][1];
          const dxu = -(1 - v) * quad[0][0] + (1 - v) * quad[1][0] + v * quad[2][0] - v * quad[3][0];
          const dyu = -(1 - v) * quad[0][1] + (1 - v) * quad[1][1] + v * quad[2][1] - v * quad[3][1];
          const dxv = -(1 - u) * quad[0][0] - u * quad[1][0] + u * quad[2][0] + (1 - u) * quad[3][0];
          const dyv = -(1 - u) * quad[0][1] - u * quad[1][1] + u * quad[2][1] + (1 - u) * quad[3][1];
          const det = dxu * dyv - dxv * dyu;
          if (!det) break;
          const ex = px - x;
          const ey = py - y;
          u -= (ex * dyv - ey * dxv) / det;
          v -= (dxu * ey - dyu * ex) / det;
        }
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
        const sx = u * (iw - 1);
        const sy = v * (ih - 1);
        const x0 = sx | 0;
        const y0 = sy | 0;
        const a = (y0 * iw + x0) * 4;
        const at = ((y - top) * width + (x - left)) * 4;
        for (let k = 0; k < 3; k += 1) od[at + k] = sd[a + k];
        od[at + 3] = 255;
      }
    }
    g.putImageData(im, left, top);
  };
  drawInto(decoded[0], quads[0]);
  drawInto(decoded[1], quads[1]);

  // The light, and the outer edge of the near page lifting into shadow.
  const lamp = g.createLinearGradient(0, 0, W, H);
  lamp.addColorStop(0, 'rgb(0 0 0 / 0)');
  lamp.addColorStop(1, 'rgb(0 0 0 / 0.26)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, W, H);
  const curl = g.createLinearGradient(2500, 0, 2940, 0);
  curl.addColorStop(0, 'rgb(0 0 0 / 0)');
  curl.addColorStop(1, 'rgb(0 0 0 / 0.42)');
  g.fillStyle = curl;
  g.fillRect(2500, 190, 440, 3640);

  const asData = async (canvas, quality) => {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
    return btoa(s);
  };

  // THE SHUTTER PATH, exactly as scanner.js runs it.
  const found = papersIn(shot, W, H);
  const at = aimedPage(found);
  const kept = at >= 0
    ? straightenCanvas(shot, W, H, found[at], { beside: besideOf(found, at) })
    : straightenCanvas(shot, W, H);

  // How much of the page being aimed at came back, and how much of the other
  // one came with it — measured in the FRAME's own coordinates, against the
  // quadrilaterals the sheets were actually drawn through.
  const box = (q) => ({
    left: Math.min(...q.map((p) => p[0])), right: Math.max(...q.map((p) => p[0])),
    top: Math.min(...q.map((p) => p[1])), bottom: Math.max(...q.map((p) => p[1])),
  });
  const truth = box(quads[1]);
  const other = box(quads[0]);
  const outline = at >= 0 ? box(found[at].map(([x, y]) => [x * W, y * H])) : null;
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const area = (a) => (a.right - a.left) * (a.bottom - a.top);
  const seen = Math.max(0, Math.min(W, truth.right) - Math.max(0, truth.left))
    * Math.max(0, Math.min(H, truth.bottom) - Math.max(0, truth.top));

  return {
    pages: found.length,
    aimed: at,
    covered: outline ? overlap(outline, truth) / seen : 0,
    neighbour: outline ? overlap(outline, other) / area(outline) : 1,
    kept: { w: kept.width, h: kept.height },
    frame: await asData(shot, 0.86),
    keptImage: await asData(kept, 0.9),
  };
}, rendered.map((f) => readFileSync(f).toString('base64')));

await browser.close();

writeFileSync(path.join(OUT, 'frame.png'), Buffer.from(report.frame, 'base64'));
writeFileSync(path.join(OUT, 'kept.jpg'), Buffer.from(report.keptImage, 'base64'));

console.log(`pages found in the frame        ${report.pages}  (want 2)`);
console.log(`the page aimed at               #${report.aimed}`);
console.log(`how much of it is in the blue   ${(report.covered * 100).toFixed(1)}%  (want over 92)`);
console.log(`how much of the outline is the`);
console.log(`  facing page                   ${(report.neighbour * 100).toFixed(1)}%  (want under 2)`);
console.log(`the page kept                   ${report.kept.w}x${report.kept.h}`);
console.log(`\npictures in ${OUT}`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

const ok = report.pages === 2 && report.covered > 0.92 && report.neighbour < 0.02;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
