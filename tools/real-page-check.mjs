// A real photograph of real music, read by the real pipeline.
//
// Everything else in this suite draws its own pages, which is honest about the
// logic and dishonest about the input: drawn ellipses on a white rectangle are
// not a photograph of a creased page under a lamp, with slurs over the notes,
// fingerings under them, beams joining them in fours and a bow mark in the
// margin. This takes an actual page — bars 21 to 41 of a cello part, in bass
// clef, two sharps, almost entirely beamed semiquavers — and asks what the page
// reader makes of it.
//
// It reports rather than asserts a number it cannot know. Nobody has counted
// the noteheads on this page by hand, so a pass/fail on "found N" would be a
// number I made up. What it DOES assert is the shape of a working read: the
// staves are found, they are found in the right places, and the heads are
// spread across them rather than piled onto one.
//
// WHAT RESOLUTION IS AND IS NOT WORTH
//
// READ_WIDE exists because the obvious first move — read the page bigger — is
// worth measuring before it is believed. The reading pass draws every page into
// a canvas 1400 across whatever the photograph's own size, so a 4000px scan and
// a 700px screenshot are read at the same size. Raising that on this page:
//
//   1400 across, 10px staff space  → 405 heads, evenly spread across the staves
//   2200 across, 16px staff space  → 417
//   3000 across, 21px staff space  → 427, and MORE uneven between staves
//
// Four times the pixels for five per cent more notes, and the distribution gets
// worse rather than better. So the cap stays where it is, and the note is kept
// here so the next person does not spend the afternoon finding out again.
//
// What the source resolution DOES change is what survives being shrunk to 1400.
// The same page from a 739px screenshot read 450 heads with a wild spread
// (37 39 31 37 35 46 45 49 66 39 26); from a 1640px copy, 405 with an even one
// (34 25 34 35 34 37 44 39 45 40 38). Upscaling a small picture invents blur;
// downscaling a large one averages the noise away. Photograph the page, do not
// screenshot a photograph of it.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/real-page-check.mjs [path-to-image]
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const WIDE = Number(process.env.READ_WIDE ?? 1400);
const FILE = process.argv[2]
  ?? `${process.env.HOME}/music-companion/tests/fixtures/cello-page.jpg`;

const bytes = await readFile(FILE).catch(() => null);
if (!bytes) {
  console.log(`no image at ${FILE} — pass one as the first argument`);
  process.exit(0);
}
const base64 = bytes.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const read = await page.evaluate(async ({ b64, wide }) => {
  const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
  const { openPaper } = await import('/src/ui/paper.js');
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  // Through the same door a photograph from the camera roll goes through.
  const pages = await openPaper({ source: 'images', pages: [blob] });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  const dpr = window.devicePixelRatio || 1;
  await pages.draw(0, sheet, wide / dpr, (wide * 4.3) / dpr);
  const found = readPage(sheet, sheet.width, sheet.height);
  if (!found) return { ok: false, sheet: `${sheet.width}x${sheet.height}` };

  const heads = notesInOrder(found);
  const perStaff = found.staves.map((s) => s.heads.length);
  // Where each staff sits down the page, as a fraction — a healthy read has
  // them evenly spaced, not bunched.
  const tops = found.staves.map((s) => Math.round(s.top * 1000) / 1000);
  const gaps = tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 1000) / 1000);
  const steps = heads.map((h) => h.step).filter((s) => Number.isFinite(s));
  return {
    ok: true,
    sheet: `${sheet.width}x${sheet.height}`,
    staves: found.staves.length,
    heads: heads.length,
    perStaff,
    tops,
    gaps,
    space: Math.round(found.space * sheet.height * 10) / 10,
    bars: found.staves.reduce((n, s) => n + s.bars.length, 0),
    stepRange: steps.length ? [Math.min(...steps), Math.max(...steps)] : null,
    withStep: steps.length,
  };
}, { b64: base64, wide: WIDE });

if (!read.ok) {
  check('the page was read at all', false, `readPage returned nothing (sheet ${read.sheet})`);
} else {
  console.log(`\n  sheet ${read.sheet}, staff space ${read.space}px`);
  console.log(`  staves ${read.staves}, barlines ${read.bars}, noteheads ${read.heads}`);
  console.log(`  per staff: ${read.perStaff.join(' ')}`);
  console.log(`  staff gaps: ${read.gaps.join(' ')}`);
  console.log(`  steps measured for ${read.withStep} of ${read.heads}, range ${JSON.stringify(read.stepRange)}\n`);

  // The page has ten systems of music on it, plus a status bar at the top that
  // is not music. Nine is the point below which whole lines are being missed.
  check('the systems on the page were found', read.staves >= 9 && read.staves <= 12,
    `${read.staves} staves (the page carries 10 systems)`);

  // Evenly spaced: a read that has found one line four times over, or has
  // wandered onto the creases, shows up as wildly uneven gaps.
  const spread = Math.max(...read.gaps) / Math.min(...read.gaps);
  check('and they are spaced like systems on a page, not bunched',
    Number.isFinite(spread) && spread < 2.2, `widest gap is ${spread.toFixed(2)}× the narrowest`);

  // Every head must have a step, or nothing can be located on the page.
  check('every notehead found has a position on the stave',
    read.withStep === read.heads, `${read.withStep} of ${read.heads}`);

  // Bars 21–41 of continuous semiquavers is several hundred notes. This is not
  // a count anybody has verified by hand — it is the difference between a read
  // that found the music and one that found a dozen specks.
  check('the number of noteheads is in the right order of magnitude',
    read.heads >= 150, `${read.heads} found on a page of ~20 bars of semiquavers`);

  // Spread across the systems rather than piled onto one.
  const empty = read.perStaff.filter((n) => n === 0).length;
  check('no system came back empty', empty === 0, `${empty} of ${read.staves} empty`);
}

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
