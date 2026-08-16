// Does the marking mode actually mark?
//
// tools/reader-look.html is where the ground truth for every real page comes
// from, so a silent break in it does not cost a picture — it costs the ability
// to measure anything at all, and it breaks quietly: a click handler that
// throws still leaves the rings on the screen looking right.
//
// So this drives it the way a person does. It loads a page, turns marking on,
// clicks a ring, checks the ring went red and the tally went down, clicks bare
// paper, checks a cross appeared and the tally went up, undoes both, and reads
// back what a save would have written.
//
//   npm run reader:mark
//
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

// A page of its own, so the check does not depend on a file in somebody's
// Downloads folder. Four systems of plain crotchets, drawn as a PNG.
async function makePage(browser) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  const data = await page.evaluate(() => {
    const space = 16;
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    for (let sys = 0; sys < 4; sys++) {
      const base = 120 + sys * space * 11;
      for (let l = 0; l < 5; l++) g.fillRect(60, base + l * space, 980, 1.6);
      for (let n = 0; n < 12; n++) {
        const x = 150 + n * space * 4.6;
        const y = base + space * 4 - ((n + sys) % 7) * space / 2;
        g.save(); g.translate(x, y); g.rotate(-0.28);
        g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
        g.fillRect(x + space * 0.55, y - space * 3.2, 1.8, space * 3.2);
      }
    }
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.close();
  const path = join(tmpdir(), 'reader-mark-check.png');
  await writeFile(path, Buffer.from(data, 'base64'));
  return path;
}

const fail = [];
const ok = [];
const check = (name, pass, detail = '') => (pass ? ok : fail).push(`${name}${detail ? ` — ${detail}` : ''}`);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const pngPath = await makePage(browser);

const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/tools/reader-look.html`, { waitUntil: 'load' });

const input = await page.$('#file');
await input.uploadFile(pngPath);
await page.waitForFunction(() => !document.querySelector('#stage').hidden, { timeout: 20000 });

const rings = () => page.evaluate(() => ({
  total: document.querySelectorAll('#overlay circle').length,
  struck: [...document.querySelectorAll('#overlay circle')]
    .filter((c) => c.getAttribute('stroke').includes('bad')).length,
  crosses: document.querySelectorAll('#overlay path[stroke*="add"]').length,
  tally: document.querySelector('#tally').textContent,
}));

const found = await rings();
check('the reader found the drawn noteheads', found.total >= 40, `${found.total} rings`);

// Marking on.
await page.click('#markOn');
const armed = await page.evaluate(() => ({
  barShown: getComputedStyle(document.querySelector('#marking')).display !== 'none',
  hasSheet: !!document.querySelector('#overlay rect[fill="transparent"]'),
}));
check('the marking bar appears', armed.barShown);
check('bare paper becomes clickable', armed.hasSheet);

// Reject one ring, by clicking it where it sits on the screen.
const before = await rings();
await page.evaluate(() => {
  const c = [...document.querySelectorAll('#overlay circle')][5];
  const b = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('click', {
    bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2,
  }));
});
const rejected = await rings();
check('clicking a ring strikes it', rejected.struck === before.struck + 1,
  `${before.struck} -> ${rejected.struck}`);
check('the tally counts it off', /1 false/.test(rejected.tally), rejected.tally);

// Add a missed note on bare paper, well away from any ring.
await page.evaluate(() => {
  const sheet = document.querySelector('#overlay rect[fill="transparent"]');
  const b = sheet.getBoundingClientRect();
  sheet.dispatchEvent(new MouseEvent('click', {
    bubbles: true, clientX: b.x + b.width * 0.5, clientY: b.y + b.height * 0.93,
  }));
});
const added = await rings();
check('clicking paper adds a cross', added.crosses === 1, `${added.crosses} crosses`);
check('the tally counts it in', /1 missed/.test(added.tally), added.tally);

// Undo, twice, back to where it started.
await page.click('#undo');
await page.click('#undo');
const undone = await rings();
check('undo puts the ring back', undone.struck === 0, `${undone.struck} struck`);
check('undo takes the cross away', undone.crosses === 0, `${undone.crosses} crosses`);

// Marks survive a reload, because marking a page is slow and losing it is not
// an acceptable cost of a stray refresh.
await page.evaluate(() => {
  const c = [...document.querySelectorAll('#overlay circle')][7];
  const b = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('click', {
    bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2,
  }));
});
const stored = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('reader-look:marks:'));
  return key ? JSON.parse(localStorage.getItem(key)) : null;
});
check('the click is stored, not the state before it', stored?.rejected?.length === 1,
  `${stored?.rejected?.length ?? 'nothing'} stored`);

await page.reload({ waitUntil: 'load' });
await (await page.$('#file')).uploadFile(pngPath);
await page.waitForFunction(() => !document.querySelector('#stage').hidden, { timeout: 20000 });
const reloaded = await rings();
// One MARK, and every candidate standing on it. If the reader put two rings on
// one notehead they both go, which is the honest reading of "there is no note
// there" — the position is what was labelled, not one of the two rings.
check('marks survive a reload', reloaded.struck >= 1, `${reloaded.struck} struck after reload`);

await browser.close();
await unlink(pngPath).catch(() => {});

console.log('\nMARKING MODE\n');
for (const line of ok) console.log(`  ok    ${line}`);
for (const line of fail) console.log(`  FAIL  ${line}`);
if (errors.length) {
  console.log('\n  page errors:');
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
}
console.log(`\n  ${ok.length}/${ok.length + fail.length} checks pass\n`);
process.exit(fail.length || errors.length ? 1 : 0);
