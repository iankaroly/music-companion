// What an Apple Pencil does to the reader, checked as REAL input.
//
// CDP's Input.dispatchMouseEvent takes a pointerType, so "pen" here is a
// genuine PointerEvent with pointerType 'pen': capture works, and the reader's
// arming path runs exactly as it does on a tablet. Palms go in alongside as
// real touches.
//
// What this CANNOT reach, and what still needs a pass on the device: coalesced
// events, pressure, tilt, and how any of it feels. A green run here means the
// logic is right, not that the ink is good.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-pencil-check.mjs          # phone
//   node tools/reader-pencil-check.mjs ipad     # tablet
//
import puppeteer from 'puppeteer-core';

// Deliberately the headless SHELL rather than the Chrome app: launching the app
// puts a bouncing icon in the Dock every time this runs.
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
});

const pen = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1,
  pointerType: 'pen', force: 0.6, ...extra,
});
const palm = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 77, radiusX: 40, radiusY: 40 }],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => page.evaluate(() => ({
  drawing: document.querySelector('#reader')?.classList.contains('drawing'),
  tool: document.querySelector('#reader-ink-bar .reader-tool.on')?.dataset.tool ?? null,
  page: document.querySelector('#reader-count')?.textContent ?? '',
}));
const marks = () => page.evaluate(async () => {
  const { loadAnnotations } = await import('/src/store/db.js');
  const all = await loadAnnotations('pen-test').catch(() => []);
  return { count: all.length, lastPoints: all.at(-1)?.points?.length ?? 0 };
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('pen-test', []);
  await openReader({ id: 'pen-test', name: 'Pen test', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, xml());
await wait(400);

const W = size.width;
const H = size.height;

// --- 1. the pencil arms the last tool and starts writing from that touch -----
await pen('mousePressed', W * 0.35, H * 0.4);
await wait(60);
let s = await state();
check('pencil touching the page arms a pen', s.drawing === true, `tool=${s.tool}`);

for (let i = 1; i <= 25; i++) await pen('mouseMoved', W * 0.35 + i * 3, H * 0.4 + Math.sin(i / 3) * 8);
await pen('mouseReleased', W * 0.35 + 75, H * 0.4);
await wait(900);
let m = await marks();
check('that first touch drew a mark, not nothing', m.count === 1, `${m.count} marks, ${m.lastPoints} points`);
s = await state();
check('the pen stays out after a stroke', s.drawing === true, `tool=${s.tool}`);

// --- 2. a palm landing mid-stroke does not cut the line ---------------------
await pen('mousePressed', W * 0.3, H * 0.6);
for (let i = 1; i <= 10; i++) await pen('mouseMoved', W * 0.3 + i * 4, H * 0.6);
await palm('touchStart', W * 0.75, H * 0.85);      // the hand settles
await wait(40);
s = await state();
check('a palm does not put the pen away mid-stroke', s.drawing === true, `tool=${s.tool}`);
for (let i = 11; i <= 30; i++) await pen('mouseMoved', W * 0.3 + i * 4, H * 0.6 + Math.sin(i / 4) * 6);
await palm('touchEnd', W * 0.75, H * 0.85);        // and shifts
await wait(40);
for (let i = 31; i <= 40; i++) await pen('mouseMoved', W * 0.3 + i * 4, H * 0.6);
await pen('mouseReleased', W * 0.3 + 160, H * 0.6);
await wait(900);
const m2 = await marks();
check('the whole stroke survived the palm', m2.count === 2, `${m2.count} marks`);
check('and it is one stroke, not a stub', m2.lastPoints > 25, `${m2.lastPoints} points`);

// --- 3. a palm alone turns no pages ------------------------------------------
await page.evaluate(() => document.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
await wait(200);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.5, y: H * 0.5, id: 5 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(300);
const before = (await state()).page;
await pen('mousePressed', W * 0.9, H * 0.6);       // pencil down at the turn zone
await wait(30);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.2, y: H * 0.9, id: 6 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await wait(60);
const mid = (await state()).page;
check('a palm tap while the pencil is down turns no page', before === mid, `${before} -> ${mid}`);
await pen('mouseReleased', W * 0.9, H * 0.6);
await wait(300);

// --- 4. a finger still turns pages when no pencil is on the glass -------------
// No Escape here: the pen is already away, and Escape with no tool out closes
// the reader — which is the right behaviour and would make this test meaningless.
const open = await page.evaluate(() => {
  const r = document.querySelector('#reader');
  return !!r && !r.hidden;
});
check('the reader is still open', open === true);
console.log('   state before the finger taps:', JSON.stringify(await state()),
  'bare=', await page.evaluate(() => document.querySelector('#reader').classList.contains('bare')));
const tap = async (x, y, id) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(250);
};
// The bar has to be DOWN before a tap on the right-hand third means "next
// page" — while it is up, any tap on the music is a tap to send it away. Which
// is the behaviour; the test just has to know it.
const bare = () => page.evaluate(() => document.querySelector('#reader').classList.contains('bare'));
if (!(await bare())) await tap(W * 0.5, H * 0.5, 10);
check('the tool bar is down before turning', await bare() === true);
const start = (await state()).page;
await tap(W * 0.9, H * 0.6, 11);
const one = (await state()).page;
check('a finger turns the page', start !== one, `${start} -> ${one}`);
await tap(W * 0.1, H * 0.6, 12);
const back = (await state()).page;
check('and turns it back', back === start, `${one} -> ${back}`);

console.log('');
console.log(results.every((r) => r.pass) ? 'ALL PASS' : 'SOME FAILED');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
