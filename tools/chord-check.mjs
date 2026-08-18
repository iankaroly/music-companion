// Chords, which the reader loses the middle of.
//
// WHY THIS EXISTS
//
// findHeads asks that a notehead have PAPER above and below it — `open`, the
// fraction of a ring of probes half a space clear of the head that is not
// inked, and it must be at least 0.45. That test is what keeps a patch of a
// beam stack from reading as a head, and it is why a page of semiquavers does
// not come back with a ring every few pixels along the beam.
//
// A CHORD HAS NOTEHEADS ABOVE AND BELOW IT. Two notes a third apart stand one
// staff space apart, which is exactly where those probes are, so the interior
// note of every chord fails a test written about beams. The Concerto prints
// chords in its opening bars — 9 of its 304 marked heads are stacked on one
// stem — and a cello part plays double stops constantly, so this is not an
// exotic case.
//
//   npm run scan:chords
//
// Draws chords of two, three and four notes at every interval from a second to
// an octave, at four sizes, clean and photographed, and reports how many of
// each chord's heads come back. The interval matters more than the size: a
// second is 0.5 spaces apart and an octave is 3.5, so the whole question is
// where the neighbour's ink falls relative to the probes.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1400 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = await page.evaluate(async ({ b64 }) => {
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
  const HEAD = '\u{E0A4}';
  const FCLEF = '\u{E062}';

  // One page: a row of chords, every one the same shape, so a miss is the
  // shape's fault and not the layout's.
  function draw({ space, notes, interval, camera }) {
    const perSystem = 8;
    const systems = 3;
    const W = Math.round(space * 56);
    const H = Math.round(space * (10 + systems * 13 + 6));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    const em = space * 4;
    const put = (ch, x, y) => { g.font = `${em}px Bravura`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y); return g.measureText(ch).width; };
    const wid = (ch) => { g.font = `${em}px Bravura`; return g.measureText(ch).width; };
    const lineThick = Math.max(1, space * 0.1);
    const truth = [];
    for (let s = 0; s < systems; s++) {
      const base = space * 8 + s * space * 13;
      const lineY = (l) => base + l * space;
      const stepY = (st) => lineY(4) - st * (space / 2);
      for (let l = 0; l < 5; l++) g.fillRect(space * 2, lineY(l), W - space * 4, lineThick);
      let x = space * 3;
      x += put(FCLEF, x, lineY(1)) + space * 1.2;
      const gap = (W - space * 3 - x) / perSystem;
      for (let i = 0; i < perSystem; i++) {
        const cx = x + gap * (i + 0.5);
        // the lowest note of the chord, moved about so the test is not one place
        const low = 1 + ((s * 3 + i * 2) % 5);
        const w2 = wid(HEAD);
        // The stem first, so the heads sit on top of it as an engraver draws.
        const top = low + interval * (notes - 1);
        g.fillRect(cx + w2 / 2 - lineThick, stepY(top) - space * 3.2, Math.max(1, lineThick), space * 3.2 + (stepY(low) - stepY(top)));
        for (let n = 0; n < notes; n++) {
          const st = low + interval * n;
          const y = stepY(st);
          for (let k = 10; k <= st; k += 2) g.fillRect(cx - w2 * 0.75, stepY(k), w2 * 1.5, lineThick);
          put(HEAD, cx - w2 / 2, y);
          truth.push({ x: cx / W, y: y / H });
        }
      }
    }
    if (!camera) return { canvas: c, truth, W, H };
    const o2 = document.createElement('canvas');
    o2.width = W; o2.height = H;
    const o = o2.getContext('2d');
    o.filter = 'blur(0.6px) contrast(0.9) brightness(1.04)';
    o.drawImage(c, 0, 0);
    return { canvas: o2, truth, W, H };
  }

  const out = [];
  for (const notes of [2, 3, 4]) {
    for (const interval of [1, 2, 3, 4, 6]) {          // steps: a 2nd, 3rd, 4th, 5th, octave
      for (const space of [10, 14, 20]) {
        for (const camera of [false, true]) {
          const d = draw({ space, notes, interval, camera });
          const read = readPage(d.canvas, d.W, d.H);
          const got = read ? notesInOrder(read) : [];
          const near = space * 0.5;
          let hit = 0;
          const took = new Set();
          for (const t of d.truth) {
            let best = -1; let bd = 1e9;
            for (const [i, f] of got.entries()) {
              if (took.has(i)) continue;
              const dd = Math.hypot((f.x - t.x) * d.W, (f.y - t.y) * d.H);
              if (dd < near && dd < bd) { bd = dd; best = i; }
            }
            if (best >= 0) { took.add(best); hit++; }
          }
          out.push({ notes, interval, space, camera, truth: d.truth.length, hit, found: got.length });
        }
      }
    }
  }
  return out;
}, { b64: font });

await browser.close();

console.log('\nCHORDS — how many of a chord\'s noteheads come back\n');
console.log('  notes  interval        recall over 4 sizes x clean/photo');
const key = (r) => `${r.notes}:${r.interval}`;
const by = new Map();
for (const r of rows) {
  if (!by.has(key(r))) by.set(key(r), []);
  by.get(key(r)).push(r);
}
const NAME = { 1: 'a second', 2: 'a third', 3: 'a fourth', 4: 'a fifth', 6: 'an octave' };
for (const [k, rs] of by) {
  const t = rs.reduce((a, r) => a + r.truth, 0);
  const h = rs.reduce((a, r) => a + r.hit, 0);
  const [n, iv] = k.split(':');
  console.log(`  ${n.padStart(5)}  ${NAME[iv].padEnd(12)}    ${h}/${t}  ${(h / t * 100).toFixed(1)}%`);
}
const T = rows.reduce((a, r) => a + r.truth, 0);
const H = rows.reduce((a, r) => a + r.hit, 0);
console.log(`\n  every chord head on every page   ${H}/${T}  ${(H / T * 100).toFixed(1)}%\n`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
