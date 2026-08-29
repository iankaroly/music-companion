// The READER draws a scanned score like the page it came from.
//
// There are two doors onto the same engraver. score.js draws the little review
// card; reader.js is the one a player opens a score through, and it engraves
// through a function of its own. The first round of this fix went through the
// card and the reader never got it — the same wrong-door mistake, one layer up,
// so "it is still not in one page like the scan" was exactly right.
//
// So this check opens the READER, on a notation score paired to a scan, the way
// the app does, and counts what is on the screen.
//
//   npm run dev            (on 5199)
//   npm run reader:printed
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
const XML = arg('xml', new URL('../test/fixtures/served-part.musicxml', import.meta.url).pathname);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const xml = readFileSync(XML, 'utf8');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });  // a phone
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
});

const open = async (paired) => page.evaluate(async ({ xml: text, paired: pair }) => {
  const db = await import('/src/store/db.js');
  const { openReader, close } = await import('/src/ui/reader.js');
  const { parseScore } = await import('/src/analysis/musicxml.js');

  const notationId = await db.saveScore({ name: `probe ${pair ? 'paired' : 'alone'}`, xml: text });
  if (pair) {
    // A scan, and the notation paired onto it: the shape the app is in after a
    // page has been photographed and read.
    const paperId = await db.savePagesScore({
      name: 'probe scan', source: 'images', pageCount: 1, pages: [],
    });
    await db.pairScoreNotation(paperId, notationId);
  }
  // listScores leaves the XML behind to keep the library light; the reader is
  // opened with the loaded row, as the app opens it.
  const row = await db.loadScore(notationId);
  const parsed = parseScore(text, { partIndex: 0 });
  let opened = 'ok';
  try {
    const got = await openReader({ ...row, notes: parsed.notes });
    if (!got) opened = 'openReader returned nothing';
  } catch (err) {
    opened = `openReader threw: ${err?.message}`;
  }
  await new Promise((r) => setTimeout(r, 1500));

  // A page that cannot be turned is not a page. The bar index and the page list
  // are what page turning, pencil anchoring, bookmarks and the playback light
  // are all hung off, and drawing a scanned score its own way skipped both.
  const { pagesKnown, barsKnown, notesIndexed, unmatched } = await import('/src/ui/reader.js')
    .then((m) => m.readerState?.() ?? {})
    .catch(() => ({}));

  const sheet = document.querySelector('#reader-sheet');
  // A PAGE HAS TO FIT THE SCREEN. The reader turns pages; it does not scroll,
  // and #reader-sheet does not either — so an engraving taller than the screen
  // is music nobody can reach. Fitting a sheet's systems onto one page has to
  // mean smaller music, not a taller page.
  const drawn = sheet?.querySelector('svg')?.getBoundingClientRect();
  const out = {
    pageHeight: drawn ? Math.round(drawn.height) : null,
    screenHeight: window.innerHeight,
    pagesKnown,
    barsKnown,
    notesIndexed,
    unmatched,
    opened,
    hasSheet: !!sheet,
    pages: sheet ? sheet.querySelectorAll('svg').length : -1,
    noteheads: sheet ? sheet.querySelectorAll('.vf-notehead').length : -1,
    stafflines: sheet ? sheet.querySelectorAll('.staffline').length : -1,
  };
  close?.();
  return out;
}, { xml, paired });

const alone = await open(false);
const paired = await open(true);
await browser.close();

const parts = (xml.match(/<score-part\b/g) ?? []).length || 1;
const sheetPages = Math.max(1, Math.round((xml.match(/new-page="yes"/g) ?? []).length / parts) + 1);

console.log(`the sheet has      ${sheetPages} page(s), ${parts} part(s)`);
if (alone.opened !== 'ok') console.log('alone:', alone.opened, '| sheet?', alone.hasSheet);
if (paired.opened !== 'ok') console.log('paired:', paired.opened, '| sheet?', paired.hasSheet);
console.log(`notation alone     ${alone.pages} page(s)   ${alone.noteheads} noteheads   ${alone.stafflines} staff lines`);
console.log(`read off a scan    ${paired.pages} page(s)   ${paired.noteheads} noteheads   ${paired.stafflines} staff lines`);

const fits = paired.pages > 0 && paired.pages <= sheetPages;
const onScreen = paired.pageHeight != null && paired.pageHeight <= paired.screenHeight + 2;
// Not "every notehead has a note": our reading of a score drops chord members
// and second voices on purpose, so it never has one note per notehead. The
// claim is the other way round — every note we hold finds the notehead it
// belongs to, or it cannot be lit, marked or tapped.
const handed = paired.notesIndexed + paired.unmatched;
const indexedAll = handed > 0 && paired.unmatched <= handed * 0.05;
// A score the recogniser read as ONE part has no hidden staves to reveal, so
// "more noteheads" is not the claim to make about it — "none missing" is.
const whole = parts > 1 ? paired.noteheads > alone.noteheads : paired.noteheads >= alone.noteheads;
console.log(fits ? '\na page of the sheet is a page on the screen' : `\nFAIL — ${paired.pages} pages for ${sheetPages}`);
console.log(onScreen
  ? `and all of it is on the screen: ${paired.pageHeight}px drawn into ${paired.screenHeight}px`
  : `FAIL — ${paired.pageHeight}px of music in a ${paired.screenHeight}px screen, and the reader does not scroll`);
const usable = paired.pagesKnown > 0 && paired.barsKnown > 0;
// Every staff that is drawn has to be tappable too, or half the page cannot be
// lit, marked or corrected.
console.log(`notes indexed  one part: ${alone.notesIndexed} of ${alone.noteheads} | scan: ${paired.notesIndexed} of ${paired.noteheads}`);
console.log(`   of ${handed} notes held, ${paired.unmatched} found no notehead`);
console.log(usable
  ? `and it can be turned and written on: ${paired.pagesKnown} page(s), ${paired.barsKnown} bars indexed`
  : `FAIL — pages known ${paired.pagesKnown}, bars indexed ${paired.barsKnown}: it cannot be turned`);
console.log(whole
  ? (parts > 1 ? 'every staff is drawn' : 'one part, and all of it is drawn')
  : `FAIL — fewer noteheads than the one-part view (${paired.noteheads} against ${alone.noteheads})`);
if (!indexedAll) console.log(`FAIL — ${paired.unmatched} of ${handed} notes found no notehead: they cannot be lit, marked or tapped`);
const ok = fits && whole && usable && indexedAll && onScreen;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
