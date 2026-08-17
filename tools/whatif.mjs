// What would this constant do, without touching the file it lives in?
//
// Another session's agents own src/analysis/scan-read.js right now, so an
// experiment cannot edit it. It does not have to: the dev server serves the
// module as text, so it can be fetched, one substring replaced, and the result
// imported from a blob URL. Everything downstream — findHeads, the classifier,
// notesInOrder — is then the real reader with one constant moved.
//
//   node whatif.mjs '<find>' '<replace>'      (repeat pairs for several edits)
//
// Prints the three marked pages, before and after, so a one-line idea costs a
// minute instead of a round.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
  + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

// Edits, either as argument pairs or — for anything with a newline in it — as a
// JSON file of [find, replace] pairs. A shell is a poor place to keep a
// multi-line patch and quoting one is how a test ends up measuring a typo.
const argv = process.argv.slice(2);
const edits = [];
const at = argv.indexOf('--edits');
if (at >= 0) {
  const { readFileSync } = await import('node:fs');
  for (const pair of JSON.parse(readFileSync(argv[at + 1], 'utf8'))) edits.push(pair);
} else {
  for (let i = 0; i + 1 < argv.length; i += 2) edits.push([argv[i], argv[i + 1]]);
}
if (!edits.length) {
  console.log("usage: node whatif.mjs '<find>' '<replace>' ...");
  console.log('   or: node whatif.mjs --edits <file.json>   with [[find, replace], ...]');
  process.exit(1);
}

const PAGES = [
  ['Bach', '/Users/iankaroly/Downloads/Menuet.pdf', 'pages/truth/bach.truth.json'],
  ['Mozart', '/Users/iankaroly/Downloads/Concerto.pdf', 'pages/truth/mozart.truth.json'],
  ['Scanned', '/Users/iankaroly/Downloads/Scanned score.pdf', 'pages/truth/scanned.truth.json'],
];

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const [name, file, truthPath] of PAGES) {
  const b64 = (await readFile(file)).toString('base64');
  const truth = JSON.parse(await readFile(`/Users/iankaroly/music-companion/${truthPath}`, 'utf8')).notes;
  const out = await page.evaluate(async ({ b64, want, edits, origin }) => {
    // The reader as served, and the reader with the edits applied. Imports
    // inside it are rewritten to absolute URLs so the blob can still find them.
    const src = await (await fetch('/src/analysis/scan-read.js')).text();
    let edited = src;
    const applied = [];
    for (const [from, to] of edits) {
      if (!edited.includes(from)) { applied.push(`MISSING: ${from}`); continue; }
      edited = edited.split(from).join(to);
      applied.push(`ok: ${from} -> ${to}`);
    }
    // Every relative specifier made absolute against the SERVER, passed in
    // rather than read from location: a blob: URL has no hierarchical base, so
    // a root-relative "/src/..." inside it fails to resolve just as a "./..."
    // would, and the error names the file rather than the cause.
    // VITE HAS ALREADY REWRITTEN THE IMPORTS. What the dev server serves is not
    // what is on disk: relative specifiers come back root-absolute, as
    // "/src/analysis/scan-stems.js", and a blob: URL has no hierarchical base to
    // resolve those against. So the rewrite that matters is root-relative to
    // fully-qualified, not "./" to anything.
    const absolute = (s) => s
      .split('"/src/').join(`"${origin}/src/`)
      .split("'/src/").join(`'${origin}/src/`)
      .split('"/node_modules/').join(`"${origin}/node_modules/`)
      .split("'/node_modules/").join(`'${origin}/node_modules/`)
      .split("'./").join(`'${origin}/src/analysis/`);
    const url = URL.createObjectURL(new Blob([absolute(edited)], { type: 'text/javascript' }));
    const mod = await import(url);

    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const src2 = document.createElement('canvas');
    src2.width = viewport.width; src2.height = viewport.height;
    await first.render({ canvasContext: src2.getContext('2d'), viewport }).promise;
    const W = Math.min(1400, src2.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src2.height * (W / src2.width));
    work.getContext('2d').drawImage(src2, 0, 0, work.width, work.height);

    const base = await import('/src/analysis/scan-read.js');
    const run = (m) => {
      const read = m.readPage(work, work.width, work.height);
      if (!read) return { precision: 0, recall: 0, found: 0 };
      const found = m.notesInOrder(read);
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
      for (const p of pairs) {
        if (tf.has(p.fi) || tt.has(p.ti)) continue;
        tf.add(p.fi); tt.add(p.ti);
      }
      return {
        found: found.length,
        precision: found.length ? tt.size / found.length : 0,
        recall: want.length ? tt.size / want.length : 0,
      };
    };
    return { applied, before: run(base), after: run(mod) };
  }, { b64, want: truth, edits, origin: `http://localhost:${PORT}` });
  rows.push([name, out]);
  if (rows.length === 1) for (const a of out.applied) console.log(`  ${a}`);
}

await browser.close();

const pc = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);
console.log('\n  page       BEFORE  prec  recall     AFTER  prec  recall     delta');
let dp = 0; let dr = 0;
for (const [name, o] of rows) {
  dp += o.after.precision - o.before.precision;
  dr += o.after.recall - o.before.recall;
  console.log(`  ${name.padEnd(9)} ${String(o.before.found).padStart(6)}${pc(o.before.precision)}${pc(o.before.recall)}`
    + `    ${String(o.after.found).padStart(6)}${pc(o.after.precision)}${pc(o.after.recall)}`
    + `    ${((o.after.precision - o.before.precision) * 100).toFixed(1)}p / ${((o.after.recall - o.before.recall) * 100).toFixed(1)}r`);
}
console.log(`\n  mean delta: precision ${(dp / rows.length * 100).toFixed(2)} points,`
  + ` recall ${(dr / rows.length * 100).toFixed(2)} points\n`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
