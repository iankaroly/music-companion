// What a pinch does to a sign on the page, checked as REAL input.
//
// The bug this exists to keep out: with the stamp tool in hand, the FIRST
// finger of a pinch used to place a sharp on the page, because at the moment a
// contact arrives nothing distinguishes it from a tap. The pinch then resized
// the accident instead of the sign you had reached for, and every attempt to
// make a flat bigger left another flat behind it.
//
// CDP dispatches genuine touch points, so the reader's pinch machinery — the
// arming, the PINCH_START threshold, the grace timer — runs exactly as it does
// on a tablet.
//
// What this CANNOT reach, and what still needs a pass on the device: how any of
// it feels under two fingers. A green run means the logic is right.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-stamp-check.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const size = { width: 1024, height: 1366 };

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const xml = () => {
  const ms = [];
  for (let m = 1; m <= 40; m++) {
    let n = '';
    for (let i = 0; i < 4; i++) {
      n += '<note><pitch><step>C</step><octave>3</octave></pitch>'
        + '<duration>1</duration><type>quarter</type></note>';
    }
    ms.push(`<measure number="${m}">` + (m === 1
      ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key>'
        + '<time><beats>4</beats><beat-type>4</beat-type></time>'
        + '<clef><sign>F</sign><line>4</line></clef></attributes>' : '') + n + '</measure>');
  }
  return '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
    + `<part-name>Cello</part-name></score-part></part-list><part id="P1">${ms.join('')}</part></score-partwise>`;
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.setItem('readerNight', 'off');
  // A finger only writes if no pencil has ever been seen on this device, and a
  // finger is the only thing this check has.
  localStorage.removeItem('readerPencilSeen');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

// Every stamp on the page, with the size that is the whole point of this file.
const signs = () => page.evaluate(async () => {
  const { loadAnnotations } = await import('/src/store/db.js');
  const all = await loadAnnotations('stamp-test').catch(() => []);
  const stamps = all.filter((s) => s.tool === 'stamp');
  return { count: stamps.length, sizes: stamps.map((s) => s.size) };
});

const chips = () => page.evaluate(() => {
  const bar = document.querySelector('#reader-selection');
  return { there: !!bar, hidden: bar?.hidden ?? null };
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('stamp-test', []);
  await openReader({ id: 'stamp-test', name: 'Stamp test', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, xml());
await wait(500);

const W = size.width;
const H = size.height;

// --- 0. the seek bar is gone -------------------------------------------------
const seek = await page.evaluate(() => ({
  bar: !!document.querySelector('#reader-seek'),
  track: !!document.querySelector('.seek-track'),
}));
check('no seek bar along the foot of the page', !seek.bar && !seek.track,
  `#reader-seek=${seek.bar} .seek-track=${seek.track}`);

// --- pick the sharp out of the stamp menu ------------------------------------
await page.evaluate(() => document.querySelector('#reader-stamps')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('.pick-pop.menu .pick-row')?.click());
await wait(300);
const armed = await page.evaluate(() => document.querySelector('#reader-stamps')?.classList.contains('on'));
check('the stamp tool is in hand', armed === true, `armed=${armed}`);

// --- 1. a tap still leaves a sign --------------------------------------------
await touch('touchStart', [{ x: W * 0.4, y: H * 0.35, id: 1 }]);
await wait(40);
await touch('touchEnd', []);
await wait(700);
let s = await signs();
check('a tap places one sign', s.count === 1, `${s.count} signs`);
const placed = s.sizes[0];

// --- 2. a pinch on it resizes it and adds NOTHING ----------------------------
// Two fingers either side of the sign, spread well past the threshold that
// tells a pinch from a hand resting on the glass.
const cx = W * 0.4;
const cy = H * 0.35;
await touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }]);
await wait(40);
await touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
await wait(40);
let midPinchChips = null;
for (let i = 1; i <= 8; i++) {
  const out = 30 + i * 14;
  await touch('touchMove', [{ x: cx - out, y: cy, id: 1 }, { x: cx + out, y: cy, id: 2 }]);
  await wait(25);
  if (i === 5) midPinchChips = await chips();
}
check('nothing blue is up while the pinch is happening', midPinchChips?.hidden === true,
  `#reader-selection hidden=${midPinchChips?.hidden}`);

await touch('touchEnd', []);
await wait(900);
s = await signs();
check('the pinch added no second sign', s.count === 1, `${s.count} signs`);
check('and made the one that was there bigger',
  s.sizes[0] > placed, `${placed?.toFixed?.(2)} -> ${s.sizes[0]?.toFixed?.(2)}`);

// --- 3. the chips come back when the fingers are off -------------------------
const after = await chips();
check('the chips come back once the fingers are off', after.hidden === false,
  `#reader-selection hidden=${after.hidden}`);

// --- 4. pinching IN makes it smaller, and still adds nothing -----------------
const before = s.sizes[0];
await touch('touchStart', [{ x: cx - 140, y: cy, id: 1 }]);
await wait(40);
await touch('touchStart', [{ x: cx - 140, y: cy, id: 1 }, { x: cx + 140, y: cy, id: 2 }]);
await wait(40);
for (let i = 1; i <= 8; i++) {
  const inn = 140 - i * 14;
  await touch('touchMove', [{ x: cx - inn, y: cy, id: 1 }, { x: cx + inn, y: cy, id: 2 }]);
  await wait(25);
}
await touch('touchEnd', []);
await wait(900);
s = await signs();
check('pinching in adds no sign either', s.count === 1, `${s.count} signs`);
check('and makes the one that was there smaller',
  s.sizes[0] < before, `${before?.toFixed?.(2)} -> ${s.sizes[0]?.toFixed?.(2)}`);

// --- 5. and the pencil places one too ----------------------------------------
// A different road entirely: a pencil is never counted among the fingers, so it
// comes back through penStroke rather than through the ink layer's own pointer
// handlers. Holding the sign back until the lift has to work on both roads, or
// the pencil stops stamping altogether. Last, because a pencil that has been
// seen is a pencil the reader stops letting fingers write alongside.
const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force: 0.6,
});
await pen('mousePressed', W * 0.6, H * 0.55);
await wait(60);
await pen('mouseReleased', W * 0.6, H * 0.55);
await wait(900);
s = await signs();
check('the pencil places a sign as well', s.count === 2, `${s.count} signs`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
