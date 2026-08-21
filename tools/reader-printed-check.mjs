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
const XML = arg('xml', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/served-cp1.musicxml`);
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

  const sheet = document.querySelector('#reader-sheet');
  const out = {
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
const whole = paired.noteheads > alone.noteheads;
console.log(fits ? '\na page of the sheet is a page on the screen' : `\nFAIL — ${paired.pages} pages for ${sheetPages}`);
console.log(whole ? 'every staff is drawn' : `FAIL — no more noteheads than the one-part view (${paired.noteheads})`);
console.log(fits && whole ? '\nPASS' : '\nFAIL');
process.exit(fits && whole ? 0 : 1);
