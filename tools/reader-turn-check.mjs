// The two ways forScore turns a page that this reader did not have: a swipe,
// and turning on the way DOWN instead of on the way up.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-turn-check.mjs          # phone
//   node tools/reader-turn-check.mjs ipad     # tablet
import puppeteer from 'puppeteer-core';

// The headless SHELL, not the Chrome app: the app puts an icon in the Dock.
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
page.on('pageerror', (e) => console.log('ERR', String(e)));

const xml = () => {
  const ms = [];
  for (let m = 1; m <= 80; m++) {
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (mode) => page.evaluate(async ([x, m]) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.setItem('readerOnstage', m);
  const { openReader, close } = await import('/src/ui/reader.js');
  close();
  await new Promise((r) => setTimeout(r, 200));
  await openReader({ id: 'turn-test', name: 'Turns', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, [xml(), mode]);

const where = () => page.evaluate(() => document.querySelector('#reader-count')?.textContent ?? '?');
const bare = () => page.evaluate(() =>
  document.querySelector('#reader')?.classList.contains('bare'));

const touchStart = (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent',
  { type: 'touchStart', touchPoints: [{ x, y, id }] });
const touchMove = (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent',
  { type: 'touchMove', touchPoints: [{ x, y, id }] });
const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const tap = async (x, y, id = 1) => { await touchStart(x, y, id); await touchEnd(); await wait(260); };

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const W = size.width;
const H = size.height;
const hideChrome = async () => { if (!(await bare())) await tap(W * 0.5, H * 0.5, 99); };

// ---------------- 1. swipe, in the ordinary mode -----------------------------
await open('off');
await hideChrome();
console.log('pages:', await where());

const swipe = async (fromX, toX, y = H * 0.55, id = 2) => {
  await touchStart(fromX, y, id);
  for (let i = 1; i <= 12; i++) {
    await touchMove(fromX + ((toX - fromX) * i) / 12, y + Math.sin(i / 4) * 3, id);
  }
  await touchEnd();
  await wait(320);
};

let a = await where();
await swipe(W * 0.8, W * 0.2);            // right-to-left = forward
let b = await where();
check('a swipe left turns forward', a !== b, `${a} -> ${b}`);
await swipe(W * 0.2, W * 0.8);            // left-to-right = back
const c = await where();
check('a swipe right turns back', c === a, `${b} -> ${c}`);

// A short, mostly-vertical drag is not a swipe.
await touchStart(W * 0.5, H * 0.4, 3);
for (let i = 1; i <= 10; i++) await touchMove(W * 0.5 + i, H * 0.4 + i * 12, 3);
await touchEnd();
await wait(300);
check('a downward drag turns nothing', (await where()) === c, await where());

// And the swipe must not fire while the pen is out.
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(250);
const drawingAt = await where();
await swipe(W * 0.8, W * 0.2, H * 0.55, 4);
check('a swipe with the pen out draws instead of turning',
  (await where()) === drawingAt, await where());
await page.evaluate(() => document.querySelector('#reader-done')?.click());
await wait(250);

// ---------------- 2. the turn happens on the way down, always ----------------
// There is no mode any more: it was one for a while and should never have
// been, because there is no moment at which you would rather the page came
// later. 'off' is passed deliberately — the old setting must not bring the old
// waiting-for-the-lift behaviour back.
await open('off');
await hideChrome();

const start = await where();
// Finger DOWN on the right third — and not lifted.
await touchStart(W * 0.9, H * 0.6, 5);
await wait(140);
const mid = await where();
check('the page turns before the finger leaves', start !== mid, `${start} -> ${mid}`);
await touchEnd();
await wait(300);
const after = await where();
check('and lifting does not turn it a second time', after === mid, `${mid} -> ${after}`);

// The middle is still the middle: it must not turn anything.
const beforeMiddle = await where();
await touchStart(W * 0.5, H * 0.5, 6);
await wait(120);
check('the middle of the page still turns nothing', (await where()) === beforeMiddle);
await touchEnd();
await wait(300);

console.log('');
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
