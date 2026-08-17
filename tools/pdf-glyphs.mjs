// What is actually DRAWN in an engraved PDF, and where.
//
// WHY THIS EXISTS
//
// The reader is fitted to three hand-marked pages. Marking a page is four
// hundred clicks, it takes an evening, and — measured this session — about four
// percent of the clicks are wrong: sixteen marks across two files stood on the
// printed key signature, on a bass clef and in the fork of a quarter rest. So
// the ground truth costs a day a page and carries its own error, and everything
// the handover says about variety being the lever runs into that wall.
//
// AN ENGRAVED PDF ALREADY KNOWS THE ANSWER. A page set by MuseScore, Sibelius,
// Finale, LilyPond or a modern publisher is not a picture of music — it is a
// list of drawing commands, and every notehead in it is a glyph placed at an
// exact position by the engraver. pdf.js hands that list over. So a vector PDF
// is a page and its ground truth in one file, free, exact, and with none of the
// clicking.
//
// That is the whole idea: render the page, take the notehead positions from the
// operator list rather than from a person, then degrade the rendering into a
// photograph the way tools/scan-corpus.mjs already does — blur, tilt, warp,
// JPEG, grain, uneven light — and the reader can be measured and trained
// against hundreds of engravings instead of three.
//
//   npm run scan:pdf-glyphs -- <file.pdf> [--page 1] [--all]
//
// THIS TOOL DOES THE FIRST HALF AND STOPS: it says what glyphs a PDF contains,
// how they are encoded, and where they sit. It is deliberately a LOOK rather
// than an extractor, because the thing that decides whether the idea works is
// what real files actually contain, and that cannot be reasoned about:
//
//   - MuseScore and most modern engravers embed a SMuFL font (Bravura, Petaluma,
//     Leland), where a black notehead is U+E0A4 and the mapping is a standard.
//   - LilyPond embeds Emmentaler, whose encoding is its own.
//   - Some publishers subset a font down to the glyphs used and renumber them,
//     so the codepoints mean nothing and only the SHAPES are left.
//   - And an OCR'd scan carries a text layer that has nothing to do with the
//     music at all.
//
// The first three are all usable and the third needs the glyphs clustered by
// shape rather than read by name. Which of them a given publisher produces is a
// fact about the world, so this prints the inventory and lets the next step be
// chosen on evidence.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--page');
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const wantPage = Number(flag('page') ?? 1);
const showAll = args.includes('--all');
const wantJson = args.includes('--json');

if (!file) {
  console.log('usage: npm run scan:pdf-glyphs -- <file.pdf> [--page 1] [--all] [--json]');
  process.exit(1);
}

const bytes = await readFile(file);
const base64 = bytes.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const report = await page.evaluate(async ({ b64, which }) => {
  const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: binary }).promise;
  if (which > doc.numPages) return { failed: `this PDF has ${doc.numPages} pages` };
  const pg = await doc.getPage(which);
  const viewport = pg.getViewport({ scale: 1 });

  // The operator list is the page as the engraver wrote it: a stream of
  // transforms, fills and glyph placements. Everything below reads it rather
  // than the rendered pixels, which is the entire point.
  const ops = await pg.getOperatorList();
  const FN = pdfjs.OPS;

  // The glyphs, with the transform in force when each was drawn.
  //
  // A PDF's text position is the product of the text matrix and the current
  // transform, and pdf.js gives both — so the position of a notehead is
  // available to the pixel without rendering anything. Tracked with a stack
  // because save/restore is how a page scopes a transform, and a notehead drawn
  // inside three nested saves is drawn at the composition of all of them.
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];

  // A matrix argument, however this build of pdf.js chose to hand it over.
  //
  // `transform` gives six loose numbers and `setTextMatrix` gives ONE object
  // with keys 0..5 — so `args.slice()` on the second yields `[{...}]`, `m[4]`
  // is undefined, and every position computed from it comes out null while
  // every count above it is perfectly correct. That is the worst shape a bug
  // can have: the tool ran, reported eighteen glyphs from one font, and printed
  // nothing but nulls for where they were.
  const matrix = (a) => {
    const m = (a.length === 6 && typeof a[0] === 'number') ? a : a[0];
    return [+m[0], +m[1], +m[2], +m[3], +m[4], +m[5]];
  };

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let textMatrix = [1, 0, 0, 1, 0, 0];
  let font = null;
  let fontSize = 0;
  const glyphs = [];
  const fonts = new Map();
  // Filled rectangles, which is what a staff line and a beam and a stem are in
  // an engraved PDF — no font involved. Counted here because they are the other
  // half of the ground truth: the staff lines say where the stave is, and the
  // reader's whole first stage exists to find them.
  let rects = 0;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (fn === FN.save) { stack.push(ctm.slice()); continue; }
    if (fn === FN.restore) { ctm = stack.pop() ?? ctm; continue; }
    if (fn === FN.transform) { ctm = mul(ctm, matrix(a)); continue; }
    if (fn === FN.setFont) {
      font = a[0];
      fontSize = a[1];
      if (!fonts.has(font)) fonts.set(font, 0);
      continue;
    }
    if (fn === FN.setTextMatrix) { textMatrix = matrix(a); continue; }
    if (fn === FN.constructPath || fn === FN.rectangle) { rects++; continue; }
    if (fn !== FN.showText) continue;
    const items = a[0];
    if (!Array.isArray(items)) continue;
    // Where the text cursor is, composed with the page transform.
    const m = mul(ctm, textMatrix);
    let advance = 0;
    for (const it of items) {
      if (typeof it === 'number') { advance -= (it / 1000) * fontSize; continue; }
      const code = it.unicode ?? '';
      const point = code ? code.codePointAt(0) : null;
      glyphs.push({
        font,
        // The glyph's own name where the font gives one — a subset font that
        // renumbered its codepoints usually keeps the names, and the names are
        // then the only thing left that says what a glyph IS.
        name: it.fontChar ?? null,
        code: point,
        x: m[4] + advance * m[0],
        y: m[5] + advance * m[1],
        size: fontSize,
        width: it.width ?? null,
      });
      fonts.set(font, (fonts.get(font) ?? 0) + 1);
      advance += ((it.width ?? 0) / 1000) * fontSize;
    }
  }

  return {
    pages: doc.numPages,
    page: which,
    size: `${Math.round(viewport.width)}x${Math.round(viewport.height)}pt`,
    rects,
    fonts: [...fonts.entries()].map(([f, n]) => ({ font: f, glyphs: n })),
    glyphs,
  };
}, { b64: base64, which: wantPage });

await browser.close();

if (report.failed) {
  console.log(`\n${report.failed}\n`);
  process.exit(1);
}

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(`\n${basename(file)} — page ${report.page} of ${report.pages}, ${report.size}`);
console.log(`  ${report.glyphs.length} glyphs drawn from ${report.fonts.length} font(s),`
  + ` ${report.rects} filled paths\n`);

if (!report.glyphs.length) {
  console.log('  NO GLYPHS. This is a raster scan — a photograph wrapped in a PDF — and');
  console.log('  it carries no ground truth of its own. It has to be read, or marked by');
  console.log('  hand. Every page in pages/index.json is one of these.\n');
  process.exit(0);
}

for (const f of report.fonts) {
  console.log(`  font ${f.font}: ${f.glyphs} glyphs`);
}

// WHAT IS IN THE FONT, by codepoint. A SMuFL font puts every music glyph in the
// private use area from U+E000, and a black notehead is U+E0A4 — so a page whose
// commonest private-use codepoint appears once per note is a page whose
// noteheads can be read straight off the operator list.
const SMUFL = {
  0xe0a4: 'noteheadBlack', 0xe0a3: 'noteheadHalf', 0xe0a2: 'noteheadWhole',
  0xe050: 'gClef', 0xe062: 'fClef', 0xe05c: 'cClef',
  0xe262: 'accidentalSharp', 0xe260: 'accidentalFlat', 0xe261: 'accidentalNatural',
  0xe4e5: 'restQuarter', 0xe4e6: 'restEighth', 0xe4e3: 'restWhole', 0xe4e4: 'restHalf',
  0xe08a: 'timeSigCommon', 0xe240: 'flag8thUp', 0xe241: 'flag8thDown',
};

const byCode = new Map();
for (const g of report.glyphs) {
  const k = g.code ?? -1;
  if (!byCode.has(k)) byCode.set(k, []);
  byCode.get(k).push(g);
}
const rows = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);

console.log('\n  codepoint   count   SMuFL name           example position');
for (const [code, gs] of showAll ? rows : rows.slice(0, 18)) {
  const hex = code < 0 ? '(none)' : `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  const name = SMUFL[code] ?? (code >= 0xe000 && code <= 0xf8ff ? '(private use)' : '');
  const g = gs[0];
  console.log(`  ${hex.padEnd(11)} ${String(gs.length).padStart(5)}   ${name.padEnd(20)}`
    + ` ${g.x.toFixed(0)},${g.y.toFixed(0)}`);
}
if (!showAll && rows.length > 18) console.log(`  …and ${rows.length - 18} more codepoints (--all)`);

const heads = report.glyphs.filter((g) => [0xe0a4, 0xe0a3, 0xe0a2].includes(g.code));
const priv = report.glyphs.filter((g) => g.code >= 0xe000 && g.code <= 0xf8ff);
console.log('');
if (heads.length) {
  console.log(`  ${heads.length} NOTEHEADS read straight off the page, with exact positions.`);
  console.log('  This file is a page and its ground truth in one, and needs no marking.');
} else if (priv.length) {
  console.log(`  ${priv.length} private-use glyphs and no SMuFL noteheads among them.`);
  console.log('  The font is a music font with its own encoding — LilyPond\'s Emmentaler,');
  console.log('  or a subset that renumbered. Usable, but the glyphs have to be told');
  console.log('  apart by SHAPE rather than read by codepoint.');
} else {
  console.log('  Text glyphs only, and no music font. This is a scan with an OCR text');
  console.log('  layer over it: the words are there and the notes are still a picture.');
}
console.log('');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
