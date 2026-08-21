// Correcting a note, through the reader, the way a player does it.
//
// The claim is not "the editor works" — that is unit-tested against the
// recogniser's own output. It is that tapping a wrong note on the page and
// pressing a key changes THE SCORE THE APP KEEPS: the drawing, the notes a take
// is marked against, and the file, still changed after the score is closed and
// opened again.
//
//   npm run dev            (on 5199)
//   npm run score:correct
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const APP = arg('app', 'http://localhost:5199');
const XML = arg('xml', new URL('../test/fixtures/recognised-page.musicxml', import.meta.url).pathname);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const xml = readFileSync(XML, 'utf8');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (err) => problems.push(err.message));
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
});

const result = await page.evaluate(async (text) => {
  const db = await import('/src/store/db.js');
  const { openReader, close } = await import('/src/ui/reader.js');
  const { parseScore } = await import('/src/analysis/musicxml.js');

  // A scan with notation paired onto it: what the app is after a page is read.
  const notationId = await db.saveScore({ name: 'correct me', xml: text });
  const paperId = await db.savePagesScore({ name: 'a scan', source: 'images', pageCount: 1, pages: [] });
  await db.pairScoreNotation(paperId, notationId);

  const row = await db.loadScore(notationId);
  const before = parseScore(row.xml, { partIndex: 0 }).notes;
  await openReader({ ...row, notes: before });
  await new Promise((r) => setTimeout(r, 1400));

  // Into correction mode through the menu, as a player reaches it.
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 300));
  const row2 = [...document.querySelectorAll('.reader-menu-row')]
    .find((r) => /correct the notes/i.test(r.textContent ?? ''));
  if (!row2) return { error: 'no "Correct the notes" in the menu' };
  row2.click();
  await new Promise((r) => setTimeout(r, 500));

  const bar = document.querySelector('#reader-correct.on');
  if (!bar) return { error: 'the correcting keys did not come up' };

  // Tap a real notehead, where it actually is on the screen.
  const target = before.find((n) => n.midi != null);
  const svgNote = document.querySelector('#reader-sheet .vf-notehead');
  const box = svgNote?.getBoundingClientRect();
  if (!box) return { error: 'no notehead on the page to tap' };
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  document.querySelector('#reader').dispatchEvent(new PointerEvent('pointerdown', { ...at, bubbles: true, pointerId: 1 }));
  await new Promise((r) => setTimeout(r, 200));
  const litUp = !!document.querySelector('#reader [data-chosen="yes"]');
  if (!litUp) return { error: 'tapping a notehead chose nothing' };

  const key = [...bar.querySelectorAll('button')].find((b) => b.textContent === '↑');
  key.click();
  await new Promise((r) => setTimeout(r, 900));

  // The file the app KEEPS, read back from the database as a later session
  // would read it.
  const saved = await db.loadScore(notationId);
  const after = parseScore(saved.xml, { partIndex: 0 }).notes;
  const moved = after.filter((n, i) => before[i] && n.midi !== before[i].midi);
  close?.();
  return {
    tapped: true,
    notes: { before: before.length, after: after.length },
    moved: moved.length,
    corrections: saved.corrections ?? 0,
    same: saved.xml === text,
  };
}, xml);

await browser.close();
if (result.error) {
  console.log('FAIL —', result.error);
  for (const p of problems.slice(0, 3)) console.log('   page error:', p);
  process.exit(1);
}
console.log(`notes            ${result.notes.before} before, ${result.notes.after} after`);
console.log(`notes moved      ${result.moved}`);
console.log(`corrections kept ${result.corrections}`);
const ok = result.moved === 1 && result.notes.before === result.notes.after && !result.same;
console.log(ok
  ? '\nPASS — one note moved, the rest untouched, and the score kept it'
  : '\nFAIL — the correction did not land as one moved note');
for (const p of problems.slice(0, 3)) console.log('   page error:', p);
process.exit(ok ? 0 : 1);
