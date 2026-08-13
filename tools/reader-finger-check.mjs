// Who is allowed to write, and does the pencil ALWAYS write.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-finger-check.mjs          # phone
//   node tools/reader-finger-check.mjs ipad     # tablet
//
// The important half is the last section: forty pencil strokes in the awkward
// moments — straight after a page turn, straight after a pinch, with a palm
// down — counting how many put ink on the page. It has to be forty.
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const size = process.argv[2] === 'ipad'
  ? { width: 1024, height: 1366 } : { width: 414, height: 896 };

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = size.width;
const H = size.height;
const MID = Math.max(320, H * 0.45);      // well clear of the tool bar

const xml = (bars = 160) => {
  const ms = [];
  for (let m = 1; m <= bars; m++) {
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

const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force: 0.6,
});
const finger = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'touch',
});
const touchAt = (pts) => cdp.send('Input.dispatchTouchEvent',
  { type: pts.length ? 'touchStart' : 'touchEnd', touchPoints: pts });
const touchMove = (pts) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });

const marks = () => page.evaluate(async () => {
  const { loadAnnotations } = await import('/src/store/db.js');
  return (await loadAnnotations('finger').catch(() => [])).length;
});
const draw = async (nib, y) => {
  await nib('mousePressed', W * 0.2, y);
  for (let i = 1; i <= 14; i++) await nib('mouseMoved', W * 0.2 + i * (W * 0.04), y + Math.sin(i / 3) * 7);
  await nib('mouseReleased', W * 0.2 + W * 0.56, y);
  await wait(90);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(2200);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.removeItem('readerPencilSeen');
  localStorage.removeItem('readerBrushes');
});
await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('finger', []);
  await openReader({ id: 'finger', name: 'Finger', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 1200));
}, xml());
await wait(400);

// ---- with no pencil ever seen, a finger may write ---------------------------
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(250);
const fingerOnAtFirst = await page.evaluate(() =>
  document.querySelector('#reader-finger')?.classList.contains('on'));
check('before any pencil, a finger may write', fingerOnAtFirst === true);
let before = await marks();
await draw(finger, MID);
await wait(800);
check('…and it does', (await marks()) === before + 1, `${before} -> ${await marks()}`);

// ---- once a pencil is used, the finger stops writing on its own -------------
before = await marks();
await draw(pen, MID + 60);
await wait(800);
check('the pencil writes', (await marks()) === before + 1, `${before} -> ${await marks()}`);
const fingerOffNow = await page.evaluate(() =>
  document.querySelector('#reader-finger')?.classList.contains('on'));
check('seeing a pencil turns finger-writing off by itself', fingerOffNow === false);

before = await marks();
await draw(finger, MID + 120);
await wait(800);
check('a finger now leaves no mark', (await marks()) === before, `${before} -> ${await marks()}`);

// ---- …and a finger tap takes the bar away, even mid-annotation --------------
const bare = () => page.evaluate(() =>
  document.querySelector('#reader')?.classList.contains('bare'));
if (await bare()) await finger('mousePressed', W * 0.5, MID).then(() => finger('mouseReleased', W * 0.5, MID));
await wait(300);
const wasBare = await bare();
await finger('mousePressed', W * 0.5, MID);
await finger('mouseReleased', W * 0.5, MID);
await wait(350);
check('a finger tap while annotating flips the bar', (await bare()) !== wasBare,
  `${wasBare} -> ${await bare()}`);
const stillDrawing = await page.evaluate(() =>
  document.querySelector('#reader')?.classList.contains('drawing'));
check('…and the tool is still in hand', stillDrawing === true);

// ---- the button turns it back on -------------------------------------------
await page.evaluate(() => document.querySelector('#reader-finger')?.click());
await wait(250);
check('the button lets the finger write again', await page.evaluate(() =>
  document.querySelector('#reader-finger')?.classList.contains('on')) === true);
before = await marks();
await draw(finger, MID + 180);
await wait(800);
check('and it writes', (await marks()) === before + 1, `${before} -> ${await marks()}`);
await page.evaluate(() => document.querySelector('#reader-finger')?.click());
await wait(250);

// ---- THE ONE THAT MATTERS: the pencil always writes -------------------------
// Forty strokes in the awkward moments: straight after a turn, straight after
// a pinch, with a palm resting. Every one has to leave a mark.
let made = 0;
let missed = [];
const nextPage = async () => {
  await cdp.send('Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [{ x: W * 0.9, y: H * 0.75, id: 60 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(120);
};
const pinchOut = async () => {
  await touchAt([{ x: W * 0.4, y: MID, id: 71 }, { x: W * 0.6, y: MID, id: 72 }]);
  for (let i = 1; i <= 5; i++) {
    await touchMove([{ x: W * 0.4 - i * 6, y: MID, id: 71 }, { x: W * 0.6 + i * 6, y: MID, id: 72 }]);
  }
  await touchAt([{ x: W * 0.6 + 30, y: MID, id: 72 }]);
  await touchAt([]);
};

for (let round = 0; round < 40; round++) {
  const kind = round % 4;
  if (kind === 0) await nextPage();                       // straight after a turn
  if (kind === 1) { await pinchOut(); await wait(30); }    // straight after a pinch
  if (kind === 2) {                                        // with a palm resting
    await cdp.send('Input.dispatchTouchEvent',
      { type: 'touchStart', touchPoints: [{ x: W * 0.75, y: H * 0.85, id: 80, radiusX: 40, radiusY: 40 }] });
  }
  const was = await marks();
  await draw(pen, MID + (round % 3) * 40);
  await wait(420);
  const now = await marks();
  if (now === was + 1) made++;
  else missed.push(`${round}(${['after a turn', 'after a pinch', 'palm down', 'plain'][kind]})`);
  if (kind === 2) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // Zoom back out so the next round starts clean.
  if (kind === 1) await page.evaluate(() => document.querySelector('#reader-reset-zoom')?.click());
  await wait(60);
}
console.log(`  pencil strokes that left a mark: ${made} of 40`);
if (missed.length) console.log(`  missed: ${missed.join(', ')}`);
check('every pencil stroke wrote', made === 40, `${made}/40`);

console.log('');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
check('nothing threw', errors.length === 0, `${errors.length} errors`);
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
