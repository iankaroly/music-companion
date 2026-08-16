// Does a ledger line tell a notehead from a fingering?
//
// A note more than one space outside the stave is drawn with a ledger line,
// because that is the only way to say which line it is on. A bar number, a
// pencilled fingering and the word PRÉLUDE are not. So the horizontal rule
// through a head ought to separate the notes from the marks — and "ought to" is
// exactly the phrase that preceded the last two filters proposed for this, one
// of which was applied on a hunch and cost a quarter of the notes on the page.
//
// So this measures the rule before anybody sets a threshold on it. It runs the
// reader on a page a person has marked up, asks `ledgerRun` for the width of the
// horizontal rule through every head OUTSIDE the stave, and prints the two
// distributions side by side: the heads that are notes, and the heads that are
// not. Then it prints what each threshold would actually cost.
//
//   npm run scan:ledger -- <page.pdf> --truth <page.truth.json>
//
// If the distributions overlap, the answer is no, and this file is where that
// gets written down rather than found out in production.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--truth');
const truthPath = args[args.indexOf('--truth') + 1];
if (!file || !args.includes('--truth')) {
  console.log('usage: npm run scan:ledger -- <page.pdf> --truth <page.truth.json>');
  process.exit(1);
}
const truth = JSON.parse(await readFile(truthPath, 'utf8'));
const bytes = await readFile(file);
const isPdf = /\.pdf$/i.test(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const rows = await page.evaluate(async ({ b64, pdf, want }) => {
  const { readPage, ledgerRun } = await import('/src/analysis/scan-read.js');

  async function toCanvas() {
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (!pdf) {
      const bitmap = await createImageBitmap(new Blob([binary]));
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      return c;
    }
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = viewport.width; c.height = viewport.height;
    await first.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return c;
  }

  const source = await toCanvas();
  const W = Math.min(1400, source.width);
  const work = document.createElement('canvas');
  work.width = W;
  work.height = Math.round(source.height * (W / source.width));
  work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);
  const wpx = work.width; const hpx = work.height;

  const read = readPage(work, wpx, hpx);
  if (!read) return null;

  // The reader's own ink, rebuilt the way readPage builds it.
  const px = work.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, wpx, hpx).data;
  const gray = new Float32Array(wpx * hpx);
  for (let i = 0; i < wpx * hpx; i++) {
    gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  }
  const radius = Math.max(4, Math.round(wpx / 36)); const span = radius * 2 + 1;
  const tmp = new Float32Array(wpx * hpx); const bg = new Float32Array(wpx * hpx);
  for (let y = 0; y < hpx; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += gray[y * wpx + Math.min(wpx - 1, Math.max(0, x))];
    for (let x = 0; x < wpx; x++) {
      tmp[y * wpx + x] = sum / span;
      sum += gray[y * wpx + Math.min(wpx - 1, x + radius + 1)] - gray[y * wpx + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < wpx; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(hpx - 1, Math.max(0, y)) * wpx + x];
    for (let y = 0; y < hpx; y++) {
      bg[y * wpx + x] = sum / span;
      sum += tmp[Math.min(hpx - 1, y + radius + 1) * wpx + x] - tmp[Math.max(0, y - radius) * wpx + x];
    }
  }
  const ink = new Uint8Array(wpx * hpx);
  for (let i = 0; i < wpx * hpx; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
  const stripW = Math.max(1, Math.floor(wpx / 40));

  // Every head, with its step, its rule width, and whether it is really a note.
  const out = [];
  for (const s of read.staves) {
    const space = s.space * hpx;
    const staff = {
      space,
      lines: s.lines.map((L) => ({ at: Float32Array.from(L, (y) => y * hpx) })),
    };
    const bottomAt = (x) => staff.lines[4].at[
      Math.min(staff.lines[4].at.length - 1, Math.max(0, Math.floor(x / stripW)))];
    for (const head of s.heads) {
      const hx = head.x * wpx; const hy = head.y * hpx;
      const step = Math.round((bottomAt(hx) - hy) / (space / 2));
      if (step >= -1 && step <= 9) continue;   // inside the stave; never asked
      let real = false;
      for (const t of want) {
        if (Math.hypot((t.x - head.x) * wpx, (t.y - head.y) * hpx) < space * 0.5) { real = true; break; }
      }
      out.push({
        step,
        run: +ledgerRun(ink, wpx, hpx, staff, stripW, space, { x: hx, y: hy }).toFixed(2),
        real,
      });
    }
  }
  return out;
}, { b64: bytes.toString('base64'), pdf: isPdf, want: truth.notes });

await browser.close();

if (!rows) {
  console.log('the reader found no stave on this page');
  process.exit(1);
}

const real = rows.filter((r) => r.real);
const fake = rows.filter((r) => !r.real);
const median = (xs) => (xs.length
  ? xs.map((r) => r.run).sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

console.log(`\nLEDGER RULE — ${basename(file)} against ${basename(truthPath)}\n`);
console.log(`  ${rows.length} heads sit outside the stave: ${real.length} are notes, ${fake.length} are not\n`);
console.log(`  median rule width — notes ${median(real)} spaces   not-notes ${median(fake)} spaces\n`);

// The histogram, because a median hides an overlap and the overlap is the answer.
const bucket = (r) => Math.min(9, Math.floor(r.run * 2));
console.log('  rule width      notes   not-notes');
for (let b = 0; b <= 9; b++) {
  const lo = (b / 2).toFixed(1);
  const hi = b === 9 ? '+' : `–${((b + 1) / 2).toFixed(1)}`;
  const rn = real.filter((r) => bucket(r) === b).length;
  const fn = fake.filter((r) => bucket(r) === b).length;
  if (!rn && !fn) continue;
  console.log(`  ${lo}${hi}`.padEnd(16) + `${String(rn).padStart(5)}   ${String(fn).padStart(9)}`
    + `  ${'#'.repeat(Math.round(rn / 2))}${'·'.repeat(Math.round(fn / 2))}`);
}

console.log('\n  a head outside the stave is kept when its rule is at least…\n');
console.log('  width   keeps notes   rejects not-notes   net heads removed');
for (const cut of [0.5, 1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.4]) {
  const keptReal = real.filter((r) => r.run >= cut).length;
  const cutFake = fake.filter((r) => r.run < cut).length;
  console.log(`  ${cut.toFixed(1)}   ${`${keptReal}/${real.length}`.padStart(11)}`
    + `   ${`${cutFake}/${fake.length}`.padStart(17)}`
    + `   ${String(cutFake - (real.length - keptReal)).padStart(17)}`);
}
console.log('');
