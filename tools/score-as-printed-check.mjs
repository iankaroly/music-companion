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
// KEPT IN THE REPO, not in a scratch directory. This default pointed at
// `~/.claude/jobs/6a5cd90a/tmp/…` — a working directory from the afternoon it
// was written — and it has been passing on borrowed time ever since: the sister
// tool `score:coverage` pointed at a file in the SAME directory that has since
// been deleted, and died on a raw ENOENT stack. The file is small and it is the
// thing being measured against, so it lives beside the check now.
const XML = arg('xml', new URL('../test/fixtures/printed-part.musicxml', import.meta.url).pathname);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const xml = readFileSync(XML, 'utf8');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200 });
await page.goto(APP, { waitUntil: 'domcontentloaded' });

// The reader engraves onto a page shaped like the screen — that is where one
// scanned page turns into three. A check with no page format has one page by
// construction and cannot see it.
const PHONE = { width: 39, height: 83, zoom: 1 };

const measure = async (asPrinted, pageFormat = null) => page.evaluate(async ({ xml: text, asPrinted: flag, pageFormat: shape }) => {
  const { showScore } = await import('/src/ui/score-view.js');
  const host = document.createElement('div');
  host.style.cssText = 'width:820px';
  document.body.append(host);
  // A real page shape, the way the reader asks for one.
  let view = null;
  try {
    view = await showScore(host, { xml: text, asPrinted: flag, ...(shape ? { pageFormat: shape, zoom: shape.zoom } : {}) });
  } catch (err) {
    return { error: `${err?.name}: ${err?.message}`, where: String(err?.stack ?? '').slice(0, 400) };
  }
  const pages = host.querySelectorAll('svg').length;   // OSMD draws one per page
  const staves = host.querySelectorAll('svg').length
    ? [...host.querySelectorAll('svg')].reduce((n, s) => n + s.querySelectorAll('g').length, 0)
    : 0;
  const notes = host.querySelectorAll('.vf-notehead, .vf-note').length;
  // One <stave> per staff per system: with the page's own breaks honoured this
  // follows the sheet, and without them it follows the width of the screen.
  const staves2 = host.querySelectorAll('.staffline').length;
  host.remove();
  return { pages, staves: staves2, notes, engraved: view?.map?.size ?? null };
}, { xml, asPrinted, pageFormat });

const parts0 = (xml.match(/<score-part\b/g) ?? []).length || 1;
const before = await measure(false);
const after = await measure(true);
const onAPhoneBefore = await measure(false, PHONE);
// What the reader does for a score read off a page: keep the screen's width and
// let the page grow until the systems on it fit, the way engraveAsPrinted does.
const printedPages = Math.max(1, Math.round(
  (xml.match(/new-page="yes"/g) ?? []).length / parts0) + 1);
let shape = { ...PHONE };
let onAPhone = await measure(true, shape);
for (let i = 0; i < 3 && (onAPhone.pages ?? 1) > printedPages; i += 1) {
  shape = { ...shape, height: shape.height * ((onAPhone.pages / printedPages) * 1.04) };
  onAPhone = await measure(true, shape);
}
await browser.close();

if (before.error) console.log('the old way errored:', before.error, '\n', before.where);
const parts = parts0;
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
const fits = (onAPhone.pages ?? 99) <= printedPages;
console.log(`\nthe sheet has ${printedPages} page(s)`);
console.log(`on a phone     ${onAPhoneBefore.pages} engraved page(s) the old way, ${onAPhone.pages} as printed`);
console.log(fits
  ? `a page of the sheet is a page on the screen`
  : `FAIL — ${onAPhone.pages} engraved pages for ${printedPages} printed`);
const ok = moreNotes && laidOut && fits;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
