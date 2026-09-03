// A FOLDER MADE ON A SHELF SHOWS UP ON THAT SHELF.
//
// One set of folders holds both pieces and takes, and each shelf lists a
// folder once there is something of its own in it. That rule hid a folder the
// moment it was made: "adding a folder in the score tab adds it to the library
// and not the scores tab". A folder now remembers which shelf made it, and
// that shelf shows it empty; the other shelf shows it once something of its
// own is filed there.
//
//   npm run dev
//   npm run shelf:folder
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.querySelector('#welcome-card')?.remove(); });
const tab = async (name) => { await page.evaluate((t) => document.querySelector(`.tab-btn[data-tab="${t}"]`)?.click(), name); await wait(500); };
const makeFolder = async (button, name) => {
  await page.evaluate((b) => document.querySelector(b)?.click(), button);
  await wait(300);
  await page.evaluate((n) => {
    const input = document.querySelector('#folder-name');
    input.value = n;
    document.querySelector('#folder-dialog button[value="save"]')?.click();
  }, name);
  await wait(800);
};
const rowsOf = (list) => page.evaluate((l) => [...document.querySelectorAll(`${l} .lib-item`)]
  .map((li) => `${li.querySelector('.lib-name')?.textContent} — ${li.querySelector('.lib-sub')?.textContent}`), list);

const stamp = Date.now().toString(36);
const onShelf = `Shelf ${stamp}`;
const inLibrary = `Library ${stamp}`;

await tab('score');
await makeFolder('#score-folder', onShelf);
let shelf = await rowsOf('#score-list');
check('a folder made on the Scores shelf is on the Scores shelf, empty',
  shelf.some((r) => r.startsWith(onShelf) && r.endsWith('0 pieces')), shelf.find((r) => r.startsWith(onShelf)) ?? 'not there');
await tab('library');
let lib = await rowsOf('#library-list');
check('…and not in the Library', !lib.some((r) => r.startsWith(onShelf)));

await makeFolder('#new-folder', inLibrary);
lib = await rowsOf('#library-list');
check('a folder made in the Library is in the Library, empty',
  lib.some((r) => r.startsWith(inLibrary) && r.endsWith('0 takes')), lib.find((r) => r.startsWith(inLibrary)) ?? 'not there');
await tab('score');
shelf = await rowsOf('#score-list');
check('…and not on the Scores shelf', !shelf.some((r) => r.startsWith(inLibrary)));

// Tidy up: the folders this made.
await page.evaluate(async ({ a, b }) => {
  const db = await import('/src/store/db.js');
  for (const f of await db.listFolders()) if (f.name === a || f.name === b) await db.deleteFolder(f.id);
}, { a: onShelf, b: inLibrary });

console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
console.log(failed ? `\n  ${failed} CHECK(S) FAILED` : '\n  all checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
