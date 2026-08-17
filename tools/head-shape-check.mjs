// Is the synthetic corpus lying to the reader about what a notehead looks like?
//
// WHY THIS EXISTS
//
// tools/glyphs.mjs opens with the reason the clef benchmarks use real Bravura:
//
//     "Clefs cannot be graded against shapes we invent. A classifier tuned
//      against its author's drawing of a bass clef learns that drawing, and the
//      page it then meets is engraved by somebody else."
//
// That argument is correct and it was applied to clefs, accidentals and the
// time signature. It was NOT applied to noteheads — tools/scan-corpus.mjs draws
// every head on every page with `g.ellipse(...)`, three hand-chosen radii — and
// a notehead is the one thing this entire reader exists to find. So every
// corpus number that has ever guarded a change to findHeads was measured
// against our own ellipse.
//
// AND AN ENGRAVED NOTEHEAD IS NOT AN ELLIPSE. SMuFL's noteheadBlack is a
// rotated lozenge: wider than it is tall, tilted about twenty degrees, with the
// long axis running up to the right so a stem meets it at the corner, and with
// flattened rather than elliptical ends. A rule tuned to an axis-aligned ellipse
// meets a real page and finds a shape that is systematically wider at the
// corners and narrower at the top and bottom than the one it was fitted to.
//
// Whether that MATTERS is a measurement, not an argument, and this is the
// measurement:
//
//   npm run scan:heads-shape
//
// The same page, twice — once with the corpus's ellipse and once with real
// Bravura — at four sizes, clean and photographed, scored with the shipped
// reader. If the two columns agree, the ellipse is a fair stand-in and the
// corpus can be left alone. If Bravura reads worse, then every corpus number
// about noteheads is optimistic, and the pages that guard this reader have been
// grading it against its own handwriting.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontB64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const report = await page.evaluate(async ({ b64 }) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  const face = new FontFace('BravuraCheck', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  // SMuFL notehead codepoints. A stem attaches at the notehead's right edge for
  // an up-stem and its left for a down-stem, and the glyph origin sits at the
  // LEFT edge on the head's vertical centre — which is the one fact needed to
  // put a Bravura head where an ellipse would have been centred.
  const HEAD = { black: '\u{E0A4}', half: '\u{E0A3}', whole: '\u{E0A2}' };

  // One page, drawn either way.
  //
  // Deliberately the same geometry as tools/scan-corpus.mjs's simplest page —
  // six systems, unbeamed crotchets, no accidentals, no text — because the
  // question is about the HEAD and nothing else. Anything else that differed
  // would be a second variable in a two-column comparison.
  function drawPage({ space, glyphs, camera }) {
    const systems = 6;
    const perSystem = 12;
    const noteGap = space * 3.2;
    const W = Math.round(space * 8 + perSystem * noteGap + space * 6);
    const H = Math.round(space * 10 + systems * space * 14 + space * 8);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const truth = [];

    for (let sys = 0; sys < systems; sys++) {
      const base = space * 10 + sys * space * 14;
      const lineY = (l) => base + l * space;
      g.fillStyle = '#111';
      for (let l = 0; l < 5; l++) g.fillRect(space * 3, lineY(l), W - space * 6, Math.max(1, space * 0.1));

      for (let i = 0; i < perSystem; i++) {
        // A spread of steps, including ledger territory, so the sample is not
        // all mid-stave. Prime stride so the pattern does not repeat per system.
        const step = ((sys * 5 + i * 7) % 13) - 2;
        const x = space * 6 + i * noteGap;
        const y = lineY(4) - step * (space / 2);
        const up = step < 4;

        if (glyphs) {
          // Real Bravura. Sized so the glyph's own em maps to four staff spaces,
          // which is what SMuFL specifies and what every engraver assumes.
          g.font = `${space * 4}px BravuraCheck`;
          g.textBaseline = 'alphabetic';
          const m = g.measureText(HEAD.black);
          // The glyph is placed by its left edge at the head's vertical centre,
          // so the centre it lands on is half its advance width to the right.
          g.fillText(HEAD.black, x - m.width / 2, y);
          // Stem, at the corner the engraver puts it: right side going up.
          const sx = up ? x + m.width / 2 - space * 0.06 : x - m.width / 2 + space * 0.06;
          g.fillRect(sx - space * 0.06, up ? y - space * 3.5 : y, space * 0.12, space * 3.5);
        } else {
          // The corpus's own ellipse, copied exactly from tools/scan-corpus.mjs
          // so this column IS the corpus rather than a reconstruction of it.
          g.save();
          g.translate(x, y);
          g.beginPath();
          g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
          const sx = up ? x + space * 0.62 : x - space * 0.62;
          g.fillRect(sx - space * 0.06, up ? y - space * 3.5 : y, space * 0.12, space * 3.5);
        }

        // Ledger lines, drawn for anything off the stave, because a real page
        // has them and the reader has a rule about them.
        for (let s = 10; s <= step; s += 2) g.fillRect(x - space * 0.9, lineY(4) - s * (space / 2), space * 1.8, Math.max(1, space * 0.1));
        for (let s = -2; s >= step; s -= 2) g.fillRect(x - space * 0.9, lineY(4) - s * (space / 2), space * 1.8, Math.max(1, space * 0.1));

        truth.push({ x: x / W, y: y / H });
      }
    }

    if (!camera) return { canvas: c, truth, W, H };

    // A photograph of it: the same treatment the corpus's `photograph` case
    // uses — a little blur, a little grey, a little unevenness — so the two
    // columns are degraded identically and the only difference stays the shape.
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const o = out.getContext('2d');
    o.filter = 'blur(0.6px) contrast(0.88) brightness(1.04)';
    o.drawImage(c, 0, 0);
    o.filter = 'none';
    const grad = o.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(0,0,0,0.06)');
    grad.addColorStop(1, 'rgba(0,0,0,0.0)');
    o.fillStyle = grad; o.fillRect(0, 0, W, H);
    return { canvas: out, truth, W, H };
  }

  function score(drawn) {
    const { canvas, truth, W, H } = drawn;
    const read = readPage(canvas, W, H);
    if (!read) return { staves: 0, precision: 0, recall: 0, found: 0 };
    const found = notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * H).sort((a, b) => a - b);
    const space = spaces.length ? spaces[Math.floor((spaces.length - 1) / 2)] : 10;
    const near = space * 0.5;
    const pairs = [];
    for (const [fi, f] of found.entries()) {
      for (const [ti, t] of truth.entries()) {
        const d = Math.hypot((f.x - t.x) * W, (f.y - t.y) * H);
        if (d < near) pairs.push({ fi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tf = new Set(); const tt = new Set();
    for (const p of pairs) {
      if (tf.has(p.fi) || tt.has(p.ti)) continue;
      tf.add(p.fi); tt.add(p.ti);
    }
    return {
      staves: read.staves.length,
      found: found.length,
      truth: truth.length,
      precision: found.length ? tt.size / found.length : 0,
      recall: truth.length ? tt.size / truth.length : 0,
    };
  }

  const rows = [];
  for (const space of [8, 10, 12, 16]) {
    for (const camera of [false, true]) {
      const ell = score(drawPage({ space, glyphs: false, camera }));
      const bra = score(drawPage({ space, glyphs: true, camera }));
      rows.push({ space, camera: camera ? 'photo' : 'clean', ell, bra });
    }
  }

  // …and the shapes themselves, measured rather than described: how wide and
  // how tall each is in staff spaces, so the difference has a number.
  const shape = [];
  for (const space of [8, 12, 16, 22]) {
    const c = document.createElement('canvas');
    c.width = space * 6; c.height = space * 6;
    const g = c.getContext('2d');
    for (const kind of ['ellipse', 'bravura']) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#000';
      const cx = c.width / 2; const cy = c.height / 2;
      if (kind === 'ellipse') {
        g.beginPath(); g.ellipse(cx, cy, space * 0.62, space * 0.46, 0, 0, Math.PI * 2); g.fill();
      } else {
        g.font = `${space * 4}px BravuraCheck`;
        g.textBaseline = 'alphabetic';
        const m = g.measureText(HEAD.black);
        g.fillText(HEAD.black, cx - m.width / 2, cy);
      }
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9; let x1 = -1; let y0 = 1e9; let y1 = -1; let ink = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4] > 128) continue;
          ink++;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      const w = (x1 - x0 + 1) / space; const h = (y1 - y0 + 1) / space;
      shape.push({
        space, kind, wide: +w.toFixed(2), tall: +h.toFixed(2),
        // How much of its own bounding box the shape actually fills. An ellipse
        // fills pi/4 = 0.785 of its box; a tilted lozenge fills less, and the
        // difference is exactly what findHeads' `fill` test measures.
        fill: +(ink / ((x1 - x0 + 1) * (y1 - y0 + 1))).toFixed(3),
      });
    }
  }

  return { rows, shape };
}, { b64: fontB64 });

await browser.close();

console.log('\nWHAT A NOTEHEAD IS — the corpus\'s ellipse against real Bravura\n');
console.log('  space  shape      wide   tall   fills its box');
for (const s of report.shape) {
  console.log(`  ${String(s.space).padStart(5)}  ${s.kind.padEnd(9)} ${String(s.wide).padStart(6)}`
    + ` ${String(s.tall).padStart(6)}   ${s.fill}`);
}

console.log('\nTHE READER ON EACH — same page, same camera, only the head differs\n');
console.log('  space  camera     ELLIPSE  prec  recall      BRAVURA  prec  recall');
let dp = 0; let dr = 0;
for (const r of report.rows) {
  const f = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);
  console.log(`  ${String(r.space).padStart(5)}  ${r.camera.padEnd(9)}  ${String(r.ell.found).padStart(9)}`
    + ` ${f(r.ell.precision)} ${f(r.ell.recall)}   ${String(r.bra.found).padStart(9)}`
    + ` ${f(r.bra.precision)} ${f(r.bra.recall)}`);
  dp += r.bra.precision - r.ell.precision;
  dr += r.bra.recall - r.ell.recall;
}
const n = report.rows.length;
console.log(`\n  Bravura minus ellipse:  precision ${(dp / n * 100).toFixed(1)} points,`
  + ` recall ${(dr / n * 100).toFixed(1)} points\n`);
if (Math.abs(dr / n) > 0.02 || Math.abs(dp / n) > 0.02) {
  console.log('  The two are NOT interchangeable. Every corpus number about noteheads is');
  console.log('  measured against a shape no engraver draws, and the corpus should draw');
  console.log('  the real glyph for the same reason the clef benchmarks already do.\n');
} else {
  console.log('  The ellipse is a fair stand-in at these sizes: the reader cannot tell');
  console.log('  them apart, so the corpus is not flattering it on this axis.\n');
}
if (errors.length) console.log('page errors:', errors.slice(0, 3));
