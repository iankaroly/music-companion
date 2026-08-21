// A score read off a page is drawn like that page.
//
// Two complaints, one cause each:
//
//   "1 page equals 3 pages on xml"  — engraving re-flows the music into
//     whatever shape the screen is, so the systems land nowhere near where the
//     sheet had them.
//   "it should show all of the notes" — a score with several parts is drawn one
//     part at a time, which is right for a quartet and wrong for a photograph:
//     the recogniser writes one part per STAFF of the page it read, so the
//     first part is half the page.
//
// Both are measured here on the recogniser's own output, against the same XML
// drawn the old way.
//
//   npm run dev            (on 5199)
//   npm run score:printed
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const APP = arg('app', 'http://localhost:5199');
const XML = arg('xml', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/out-cp1.pdf.musicxml`);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const xml = readFileSync(XML, 'utf8');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const measure = async (asPrinted) => page.evaluate(async ({ xml: text, asPrinted: flag }) => {
  const { showScore } = await import('/src/ui/score-view.js');
  const host = document.createElement('div');
  host.style.cssText = 'width:820px';
  document.body.append(host);
  // A real page shape, the way the reader asks for one.
  let view = null;
  try {
    view = await showScore(host, { xml: text, asPrinted: flag });
  } catch (err) {
    return { error: `${err?.name}: ${err?.message}`, where: String(err?.stack ?? '').slice(0, 400) };
  }
  const pages = host.querySelectorAll('svg').length;
  const staves = host.querySelectorAll('svg').length
    ? [...host.querySelectorAll('svg')].reduce((n, s) => n + s.querySelectorAll('g').length, 0)
    : 0;
  const notes = host.querySelectorAll('.vf-notehead, .vf-note').length;
  // One <stave> per staff per system: with the page's own breaks honoured this
  // follows the sheet, and without them it follows the width of the screen.
  const staves2 = host.querySelectorAll('.staffline').length;
  host.remove();
  return { pages, staves: staves2, notes, engraved: view?.map?.size ?? null };
}, { xml, asPrinted });

const before = await measure(false);
const after = await measure(true);
await browser.close();

if (before.error) console.log('the old way errored:', before.error, '\n', before.where);
const parts = (xml.match(/<score-part\b/g) ?? []).length || 1;
const breaks = (xml.match(/new-system="yes"/g) ?? []).length;
// The breaks are written into every part, so the page has breaks/parts of them,
// and one more system than breaks. One staff line per part per system.
const wanted = (breaks / parts + 1) * parts;
console.log(`the page has       ${breaks / parts + 1} systems across ${parts} part(s) — ${wanted} staff lines`);
console.log(`the old way        staff lines ${before.staves}   noteheads ${before.notes}`);
console.log(`as printed         staff lines ${after.staves}   noteheads ${after.notes}`);
const moreNotes = after.notes > before.notes;
const laidOut = after.staves === wanted;
console.log(moreNotes
  ? `\nevery staff on the page is drawn: ${before.notes} -> ${after.notes} noteheads`
  : `\nFAIL — no more of the page is being drawn than before`);
console.log(laidOut
  ? `the lines break where the page breaks them: ${after.staves} of ${wanted}`
  : `FAIL — ${after.staves} staff lines drawn, the page has ${wanted}`);
console.log(moreNotes && laidOut ? '\nPASS' : '\nFAIL');
process.exit(moreNotes && laidOut ? 0 : 1);
