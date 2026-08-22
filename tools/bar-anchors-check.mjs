// THE MARKS SURVIVE THE APP BEING SHUT.
//
// "save the anchors so i dont have to redo them." Two taps is a small price
// once and an irritating one every time, and marks that vanish with the tab are
// marks nobody will make.
//
// This writes them the way the review writes them, reloads the page — a real
// reload, so IndexedDB is the only thing that carries anything across — and
// reads them back. It also checks the two things that would make saving them
// worse than not saving them:
//
//   a DIFFERENT take must not inherit them. An anchor is a second of one
//   recording; the same page played yesterday is a different set of seconds,
//   and marks handed to the wrong take put the playhead confidently nowhere.
//
//   a page that is re-cropped must LOSE them. An anchor is a position in a
//   layout — a system and how far across it — and cropping a page moves every
//   system after it. Better to ask for two taps again than to play the wrong
//   bar.
//
//   npm run dev            (on 5199)
//   npm run scan:anchors

import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

// A scan to hang them on: one page, so the row exists to be written to.
const scoreId = await page.evaluate(async () => {
  const { savePagesScore } = await import('/src/store/db.js');
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 60;
  canvas.getContext('2d').fillRect(0, 0, 40, 60);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  return savePagesScore({
    name: 'anchor check', source: 'photos', pageCount: 1,
    pages: [new File([blob], 'page-01.jpg', { type: 'image/jpeg' })],
  });
});

const wrote = await page.evaluate(async (id) => {
  const { saveBarAnchors, loadScorePages } = await import('/src/store/db.js');
  await saveBarAnchors(id, 77, [{ at: 0, time: 2 }, { at: 4, time: 34 }]);
  await saveBarAnchors(id, 78, [{ at: 1, time: 9 }]);
  const row = await loadScorePages(id);
  return { keys: Object.keys(row.barAnchors ?? {}), take77: row.barAnchors?.[77] ?? null };
}, scoreId);

// A REAL reload: nothing in memory crosses this line.
await page.reload({ waitUntil: 'domcontentloaded' });

const after = await page.evaluate(async (id) => {
  const { loadScorePages, setPageCrop, saveBarAnchors } = await import('/src/store/db.js');
  const row = await loadScorePages(id);
  const mine = row.barAnchors?.[77] ?? null;
  const other = row.barAnchors?.[78] ?? null;
  const stranger = row.barAnchors?.[99] ?? null;

  // …and what a crop does to them.
  await setPageCrop(id, 0, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const cropped = await loadScorePages(id);

  // An empty list takes the take's marks away rather than storing nothing.
  await saveBarAnchors(id, 77, [{ at: 0, time: 2 }]);
  await saveBarAnchors(id, 77, []);
  const cleared = await loadScorePages(id);
  return {
    mine,
    other,
    stranger,
    afterCrop: cropped.barAnchors ?? null,
    afterClear: cleared.barAnchors?.[77] ?? null,
  };
}, scoreId);

await browser.close();

const same = JSON.stringify(after.mine) === JSON.stringify([{ at: 0, time: 2 }, { at: 4, time: 34 }]);
console.log(`takes with marks against them   ${wrote.keys.join(', ')}`);
console.log(`after a full reload             ${JSON.stringify(after.mine)}`);
console.log(`  the same marks                ${same}`);
console.log(`another take's marks            ${JSON.stringify(after.other)}  (its own, not this one's)`);
console.log(`a take that marked nothing      ${JSON.stringify(after.stranger)}  (want null)`);
console.log(`after the page was re-cropped   ${JSON.stringify(after.afterCrop)}  (want null)`);
console.log(`after marking then clearing     ${JSON.stringify(after.afterClear)}  (want null)`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

const ok = same
  && JSON.stringify(after.other) === JSON.stringify([{ at: 1, time: 9 }])
  && after.stranger === null
  && after.afterCrop === null
  && after.afterClear == null;
console.log(ok ? '\nPASS — the marks come back, to the take that made them' : '\nFAIL');
process.exit(ok ? 0 : 1);
