// The reader against a hundred pages instead of three.
//
// WHY THIS EXISTS
//
// `npm run bench` scores three pages, and it is the most valuable measurement in
// the project because those pages are real paper somebody photographed. It is
// also three pages, which means: three engravings, three cameras, two staff
// spaces between 9.6 and 12.1, one key (one sharp), two clefs, and — since two
// of the three are the same music — arguably two pieces.
//
// So a change can be measured green on all three and be wrong about the fourth
// page anybody points a phone at, and nothing in the project would say so. The
// synthetic corpus was built to cover that, and it draws ONE page shape with
// noteheads we invented: tools/head-shape-check.mjs measured our ellipse at 0.83
// to 0.91 staff spaces tall against real Bravura's 1.05 to 1.08, and the reader
// 4.2 points more precise on our drawing than on the real glyph.
//
// tools/engrave.mjs draws pages with the real font, varies the engraving on
// purpose, degrades them like a photograph, scatters pencil over them, and knows
// exactly where it put every notehead. So the reader can be scored on a hundred
// of those, and the answer BROKEN DOWN by the thing that varied:
//
//   npm run scan:engraved -- --engraved <dir> [--by space|clef|keys|systems]
//
// WHAT THIS IS AND IS NOT. It is a wide net: it finds the kind of page the
// reader falls over on, at sizes and densities no marked page contains. It is
// NOT a substitute for `bench` — these pages are drawn, and a number from them
// is a number about drawings. When the two disagree, `bench` is right and this
// is telling you which axis to go and photograph.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const root = resolve(flag('engraved', 'pages/engraved'));
const showWorst = Number(flag('worst', 8));

async function indexes(dir) {
  const out = [];
  const walk = async (d) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { await walk(join(d, e.name)); continue; }
      if (e.name !== 'index.json') continue;
      for (const row of JSON.parse(await readFile(join(d, e.name), 'utf8'))) out.push(row);
    }
  };
  await walk(dir);
  return out;
}

const pages = await indexes(root);
if (!pages.length) {
  console.log(`no engraved pages under ${root} — run npm run engrave first`);
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const p of pages) {
  const b64 = (await readFile(p.file)).toString('base64');
  const truth = JSON.parse(await readFile(p.truth, 'utf8'));
  const out = await page.evaluate(async ({ b64, want }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    const src = document.createElement('canvas');
    src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);

    const read = readPage(work, work.width, work.height);
    if (!read) return { failed: true, staves: 0, found: 0, hit: 0 };
    const found = notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * work.height).sort((a, b) => a - b);
    const space = spaces.length ? spaces[Math.floor((spaces.length - 1) / 2)] : 10;
    const near = space * 0.5;
    const pairs = [];
    for (const [fi, f] of found.entries()) {
      for (const [ti, t] of want.entries()) {
        const d = Math.hypot((f.x - t.x) * work.width, (f.y - t.y) * work.height);
        if (d < near) pairs.push({ fi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tf = new Set(); const tt = new Set();
    for (const q of pairs) {
      if (tf.has(q.fi) || tt.has(q.ti)) continue;
      tf.add(q.fi); tt.add(q.ti);
    }
    return {
      failed: false,
      staves: read.staves.length,
      working: +space.toFixed(1),
      found: found.length,
      hit: tt.size,
      key: read.key ? `${read.key.sharps || read.key.flats}${read.key.sharps ? '#' : 'b'}` : '—',
      clef: read.staves[0]?.clef ?? '—',
    };
  }, { b64, want: truth.notes });
  rows.push({
    name: p.name,
    drawn: truth.space,
    truth: truth.notes.length,
    ...out,
    precision: out.found ? out.hit / out.found : 0,
    recall: truth.notes.length ? out.hit / truth.notes.length : 0,
  });
  if (rows.length % 20 === 0) process.stdout.write(`  ${rows.length}/${pages.length}\r`);
}

await browser.close();

const mean = (xs, f) => (xs.length ? xs.reduce((a, r) => a + f(r), 0) / xs.length : 0);
const pc = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);

console.log(`\nTHE READER ON ${rows.length} ENGRAVED PAGES — drawn with the real font,`);
console.log('photographed, and scattered with pencil. The truth is what was drawn.\n');
console.log(`  pages           ${rows.length}`);
console.log(`  noteheads       ${rows.reduce((a, r) => a + r.truth, 0)}`);
console.log(`  found no stave  ${rows.filter((r) => r.failed).length}`);
console.log(`  PRECISION       ${pc(mean(rows, (r) => r.precision))}`);
console.log(`  RECALL          ${pc(mean(rows, (r) => r.recall))}`);

// BROKEN DOWN BY WHAT VARIED, which is the only reason to run a hundred pages
// rather than one. A single mean over a wide corpus hides exactly the cliff it
// was built to find.
const buckets = (label, key, edges) => {
  console.log(`\n  by ${label}`);
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i];
    const hi = edges[i + 1] ?? Infinity;
    const got = rows.filter((r) => r[key] >= lo && r[key] < hi);
    if (!got.length) continue;
    console.log(`    ${String(lo).padStart(3)}${hi === Infinity ? '+ ' : `-${String(hi - 1).padEnd(2)}`}`
      + `  ${String(got.length).padStart(3)} pages   ${pc(mean(got, (r) => r.precision))}`
      + ` / ${pc(mean(got, (r) => r.recall))}`
      + `   ${got.filter((r) => r.failed).length ? `${got.filter((r) => r.failed).length} read as blank` : ''}`);
  }
};
buckets('the staff space it was DRAWN at', 'drawn', [7, 9, 11, 13, 15, 17, 19]);

const byClef = new Map();
for (const r of rows) {
  const k = r.clef ?? '—';
  if (!byClef.has(k)) byClef.set(k, []);
  byClef.get(k).push(r);
}
console.log('\n  by the clef the reader READ on system 1');
for (const [k, got] of [...byClef.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(k).padEnd(8)} ${String(got.length).padStart(3)} pages   `
    + `${pc(mean(got, (r) => r.precision))} / ${pc(mean(got, (r) => r.recall))}`);
}

console.log('\n  THE WORST PAGES — where to go and look');
const worst = rows.slice().sort((a, b) => (a.precision + a.recall) - (b.precision + b.recall));
for (const r of worst.slice(0, showWorst)) {
  console.log(`    ${r.name.padEnd(16)} drawn ${String(r.drawn).padStart(2)}px  `
    + `working ${String(r.working ?? '—').padStart(5)}  staves ${String(r.staves).padStart(2)}  `
    + `${pc(r.precision)} / ${pc(r.recall)}  ${r.found}/${r.truth}`);
}
console.log('');
if (errs.length) console.log('page errors:', errs.slice(0, 3));
