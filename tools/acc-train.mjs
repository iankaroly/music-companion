// A classifier for the accidental in front of a note, trained on pages that
// know where every one of them is.
//
// WHY THIS AND NOT MORE GEOMETRY
//
// Four geometric attempts at this are recorded in scan-accidental.js and every
// one of them broke on the ink rather than on the idea:
//
//   - walking left from a fixed fraction of a space starts INSIDE the notehead,
//     whose half-width is 0.62, so the box holds the head and the accidental
//     together and measures 4.49 staff spaces tall where a flat is 2.5;
//   - walking off the head's own ink instead finds no gap to walk off, because
//     at ordinary engraved spacing AN ACCIDENTAL TOUCHES ITS NOTE;
//   - separating them by column height takes the note's STEM for the glyph,
//     since a stem is taller than any accidental;
//   - and skipping the head by its quiet, then growing the box over ink, cannot
//     measure a flat at all: its bowl is a LOOP, so a column through the note's
//     own row passes through the hole and reads nothing.
//
// That last one is the giveaway. Every rule was a different way of asking where
// one object ends and the next begins, on ink where they touch, at a ten-pixel
// staff space. This reader already knows what to do with that question — it is
// the same one that made the notehead classifier necessary, and the answer
// written all over this codebase is that THE SHAPE TESTS LOCALISE AND A
// CLASSIFIER JUDGES.
//
// So: a patch of page at the place an accidental would be, and a model that says
// which of the four things is there. The place needs no separation — an
// engraver puts an accidental about one and a third staff spaces left of the
// head it belongs to, and a patch that wide takes in both, which is if anything
// more informative than the glyph alone.
//
// AND THE LABELS ARE FREE. tools/engrave.mjs draws accidentals at a known rate
// and records every one with the note it belongs to, so a thousand labelled
// examples cost one command and no clicking.
//
//   npm run acc:train -- --engraved <dir> [--limit 0]
//
// Writes pages/acc-model.json. Nothing loads it until scan-accidental.js does.

import { readFile, writeFile, readdir } from 'node:fs/promises';
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
const limit = Number(flag('limit', 0));
const HOLD = 0.25;              // share of pages held out and never trained on

async function pages(dir) {
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

const all = await pages(root);
if (!all.length) {
  console.log(`no engraved pages under ${root} — run npm run engrave first`);
  process.exit(1);
}
const use = limit ? all.slice(0, limit) : all;
console.log(`\n${use.length} engraved pages\n`);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const KINDS = ['none', 'sharp', 'flat', 'natural'];

async function patchesFor(row) {
  const b64 = (await readFile(row.file)).toString('base64');
  const truth = JSON.parse(await readFile(row.truth, 'utf8'));
  return page.evaluate(async ({ b64, want }) => {
    const M = await import('/src/analysis/scan-read.js');
    const { headPatch } = await import('/src/analysis/head-model.js');
    const { ACC_OFFSET } = await import('/src/analysis/scan-accidental.js');

    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    const src = document.createElement('canvas');
    src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
    const w = work.width; const h = work.height;

    const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    const rad = Math.max(4, Math.round(w / 36));
    const box = (s) => {
      const t = new Float32Array(w * h); const d = new Float32Array(w * h); const span = rad * 2 + 1;
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = -rad; x <= rad; x++) sum += s[y * w + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          t[y * w + x] = sum / span;
          sum += s[y * w + Math.min(w - 1, x + rad + 1)] - s[y * w + Math.max(0, x - rad)];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -rad; y <= rad; y++) sum += t[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          d[y * w + x] = sum / span;
          sum += t[Math.min(h - 1, y + rad + 1) * w + x] - t[Math.max(0, y - rad) * w + x];
        }
      }
      return d;
    };
    const background = box(gray);

    const read = M.readPage(work, w, h);
    if (!read) return [];
    const notes = M.notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * h).sort((a, b) => a - b);
    const space = spaces.length ? spaces[Math.floor((spaces.length - 1) / 2)] : 10;
    const near = space * 0.6;

    const rows = [];
    for (const n of notes) {
      const nx = n.x * w; const ny = n.y * h;
      // The truth records an accidental at the position of the NOTE it belongs
      // to, so a match is by the note and not by the glyph.
      let label = 'none';
      for (const a of want) {
        if (Math.hypot(a.x * w - nx, a.y * h - ny) < near) { label = a.kind; break; }
      }
      const patch = headPatch(gray, background, w, h, space,
        Math.round(nx - space * ACC_OFFSET), Math.round(ny));
      rows.push({ label, patch: Array.from(patch, (v) => Math.round(v * 255)) });
    }
    return rows;
  }, { b64, want: truth.accidentals ?? [] });
}

const data = [];
for (const [i, row] of use.entries()) {
  const rows = await patchesFor(row);
  for (const r of rows) data.push({ ...r, page: i });
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${use.length} pages — ${data.length} patches`);
}
await browser.close();

const tally = {};
for (const d of data) tally[d.label] = (tally[d.label] ?? 0) + 1;
console.log(`\n  ${data.length} patches ${JSON.stringify(tally)}`);

// HELD OUT BY PAGE, NOT BY PATCH. Two notes from the same page share its
// engraving, its camera and its grain, so a patch-level split would let the
// model see the test page's paper while claiming not to have seen the test.
const heldPage = (p) => (p % Math.round(1 / HOLD)) === 0;
const train = data.filter((d) => !heldPage(d.page));
const test = data.filter((d) => heldPage(d.page));
console.log(`  ${train.length} to train on, ${test.length} held out (whole pages)\n`);

// One binary model per kind, argmax at the end. Three small fits are easier to
// read and to debug than one four-way soft-max, and the shipped notehead judge
// is the same shape, so the reader has exactly one kind of model in it.
function fit(rows, isPositive, { steps = 260, rate = 0.5, reg = 0.002, hidden = 16 } = {}) {
  const dim = rows[0].patch.length;
  const x = rows.map((r) => Float64Array.from(r.patch, (v) => v / 255));
  const y = rows.map((r) => (isPositive(r) ? 1 : 0));
  // Balanced, because 'none' outnumbers each kind about thirty to one and an
  // unweighted fit answers "no" to everything and is right 97% of the time.
  const pos = y.reduce((a, v) => a + v, 0);
  const wt = y.map((v) => (v ? (y.length - pos) / Math.max(1, pos) : 1));
  const total = wt.reduce((a, v) => a + v, 0);
  let seed = 9973;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const W1 = Array.from({ length: hidden }, () => Float64Array.from({ length: dim }, () => rand() * 0.1));
  const b1 = new Float64Array(hidden);
  const W2 = Float64Array.from({ length: hidden }, () => rand() * 0.1);
  let b2 = 0;
  const hv = new Float64Array(hidden);
  for (let s = 0; s < steps; s++) {
    const gW1 = Array.from({ length: hidden }, () => new Float64Array(dim));
    const gb1 = new Float64Array(hidden);
    const gW2 = new Float64Array(hidden);
    let gb2 = 0;
    for (let i = 0; i < x.length; i++) {
      let z2 = b2;
      for (let j = 0; j < hidden; j++) {
        let z = b1[j];
        for (let k = 0; k < dim; k++) z += W1[j][k] * x[i][k];
        hv[j] = z > 0 ? z : 0;
        z2 += W2[j] * hv[j];
      }
      const p = 1 / (1 + Math.exp(-z2));
      const e = (p - y[i]) * wt[i];
      gb2 += e;
      for (let j = 0; j < hidden; j++) {
        gW2[j] += e * hv[j];
        if (hv[j] <= 0) continue;
        const d = e * W2[j];
        gb1[j] += d;
        for (let k = 0; k < dim; k++) gW1[j][k] += d * x[i][k];
      }
    }
    b2 -= rate * (gb2 / total);
    for (let j = 0; j < hidden; j++) {
      W2[j] -= rate * (gW2[j] / total + reg * W2[j]);
      b1[j] -= rate * (gb1[j] / total);
      for (let k = 0; k < dim; k++) W1[j][k] -= rate * (gW1[j][k] / total + reg * W1[j][k]);
    }
  }
  return { hidden, W1, b1, W2, b2 };
}

const score = (m, patch) => {
  let z2 = m.b2;
  for (let j = 0; j < m.hidden; j++) {
    let z = m.b1[j];
    for (let k = 0; k < patch.length; k++) z += m.W1[j][k] * (patch[k] / 255);
    if (z > 0) z2 += m.W2[j] * z;
  }
  return 1 / (1 + Math.exp(-z2));
};

const models = {};
for (const kind of ['sharp', 'flat', 'natural']) {
  models[kind] = fit(train, (r) => r.label === kind);
  console.log(`  fitted ${kind}`);
}

const guess = (patch) => {
  let best = 'none';
  let bestS = 0.5;
  for (const kind of ['sharp', 'flat', 'natural']) {
    const s = score(models[kind], patch);
    if (s > bestS) { bestS = s; best = kind; }
  }
  return best;
};

const confuse = {};
for (const r of test) {
  const g = guess(r.patch);
  const k = `${r.label}->${g}`;
  confuse[k] = (confuse[k] ?? 0) + 1;
}
const right = Object.entries(confuse).filter(([k]) => k.split('->')[0] === k.split('->')[1])
  .reduce((a, [, v]) => a + v, 0);
const accs = test.filter((r) => r.label !== 'none');
const foundAcc = accs.filter((r) => guess(r.patch) !== 'none').length;
const namedAcc = accs.filter((r) => guess(r.patch) === r.label).length;
const nones = test.filter((r) => r.label === 'none');
const falseAcc = nones.filter((r) => guess(r.patch) !== 'none').length;

console.log('\nON PAGES THE MODEL HAS NEVER SEEN\n');
console.log(`  every patch right          ${right} of ${test.length}  (${(right / test.length * 100).toFixed(1)}%)`);
console.log(`  accidentals FOUND          ${foundAcc} of ${accs.length}  (${(foundAcc / Math.max(1, accs.length) * 100).toFixed(1)}% recall)`);
console.log(`  …and NAMED right           ${namedAcc} of ${accs.length}  (${(namedAcc / Math.max(1, accs.length) * 100).toFixed(1)}%)`);
console.log(`  notes with NO accidental wrongly given one   ${falseAcc} of ${nones.length}  (${(falseAcc / Math.max(1, nones.length) * 100).toFixed(2)}%)`);
console.log(`\n  confusion: ${JSON.stringify(confuse)}`);

await writeFile(new URL('../pages/acc-model.json', import.meta.url), `${JSON.stringify({
  note: 'one binary model per kind, argmax at 0.5; patch taken ACC_OFFSET spaces left of the note',
  trainedOn: `${use.length} engraved pages, ${train.length} patches`,
  heldOut: `${test.length} patches from whole pages never trained on`,
  kinds: Object.fromEntries(Object.entries(models).map(([k, m]) => [k, {
    hidden: m.hidden,
    b2: +m.b2.toFixed(5),
    W2: Array.from(m.W2, (v) => +v.toFixed(5)),
    b1: Array.from(m.b1, (v) => +v.toFixed(5)),
    W1: m.W1.map((r) => Array.from(r, (v) => +v.toFixed(5))),
  }])),
}, null, 2)}\n`);
console.log('\n  written to pages/acc-model.json\n');
