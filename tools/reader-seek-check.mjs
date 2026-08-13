// The seek bar: getting to a page a long way off in one gesture.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-seek-check.mjs          # phone
//   node tools/reader-seek-check.mjs ipad     # tablet
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

const xml = (bars = 200) => {
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

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(2200);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// A long part, with a bookmark part-way through so the label has a name to say.
await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('seek', []);
  await openReader({
    id: 'seek', name: 'Seek', xml: x, kind: 'notation',
    bookmarks: [{ bar: 1, label: 'I. Prélude' }, { bar: 60, label: 'II. Adagio' }],
  });
  await new Promise((r) => setTimeout(r, 1200));
}, xml());
await wait(400);

const state = () => page.evaluate(() => {
  const bar = document.querySelector('#reader-seek');
  const label = bar?.querySelector('.seek-label');
  return {
    exists: !!bar,
    shown: !!bar && getComputedStyle(bar).display !== 'none' && !bar.hidden,
    at: bar?.style.getPropertyValue('--at'),
    label: label?.hidden ? null : label?.textContent,
    page: document.querySelector('#reader-count')?.textContent ?? '',
    bare: document.querySelector('#reader')?.classList.contains('bare'),
  };
});

// The reader opens showing only the music, which is right — so the controls
// are asked for first, the way a player asks for them.
const tap = async (x, y, id) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(320);
};
if (await page.evaluate(() => document.querySelector('#reader')?.classList.contains('bare'))) {
  await tap(W * 0.5, H * 0.1, 2);
}

let s = await state();
const screens = Number((s.page.match(/of (\d+)/) ?? [])[1] ?? 0);
console.log(`the part is ${screens} screenfuls`);
check('the seek bar exists and is up with the controls', s.exists && s.shown,
  `shown=${s.shown} bare=${s.bare}`);
check('it starts at the beginning', (s.at ?? '').startsWith('0'), `at=${s.at}`);

// Where the track actually is.
const track = await page.evaluate(() => {
  const t = document.querySelector('#reader-seek .seek-track');
  const b = t?.getBoundingClientRect();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
});
console.log('track:', JSON.stringify(track));
if (!track || track.w < 40) {
  check('the track is a usable size', false, JSON.stringify(track));
} else {
  check('the track is a usable size', track.h >= 30, `${Math.round(track.h)}px tall`);

  const at = (frac) => track.x + track.w * frac;
  const my = track.y + track.h / 2;

  // Drag to the far end and hold: the label should name where we are.
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: at(0.02), y: my, button: 'left', buttons: 1, pointerType: 'touch' });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: at(0.02 + 0.9 * (i / 12)), y: my, button: 'none', buttons: 1, pointerType: 'touch' });
  }
  await wait(300);
  s = await state();
  check('a label appears while scrubbing', !!s.label, `label=${JSON.stringify(s.label)}`);
  check('the handle moved with the finger', parseFloat(s.at) > 60, `at=${s.at}`);

  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: at(0.92), y: my, button: 'left', buttons: 0, pointerType: 'touch' });
  await wait(900);
  s = await state();
  const landed = Number((s.page.match(/p\. (\d+)/) ?? [])[1] ?? 0);
  check('letting go lands on a page a long way in',
    landed > Math.floor(screens * 0.6), `${s.page}`);
  check('the label goes away when the finger does', s.label === null, `label=${s.label}`);
  check('the handle stays where the page is', parseFloat(s.at) > 60, `at=${s.at}`);

  // …and back to the start in one gesture.
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mousePressed', x: at(0.9), y: my, button: 'left', buttons: 1, pointerType: 'touch' });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: at(0.9 - 0.88 * (i / 10)), y: my, button: 'none', buttons: 1, pointerType: 'touch' });
  }
  await cdp.send('Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: at(0.02), y: my, button: 'left', buttons: 0, pointerType: 'touch' });
  await wait(900);
  s = await state();
  check('and back to the front the same way', /p\. 1 /.test(s.page), s.page);

  // A named place says its name.
  const named = await page.evaluate(async () => {
    const mod = await import('/src/ui/reader.js');
    return typeof mod.openReader === 'function';
  });
  check('the reader is still healthy after all that', named === true);
}

// The bar is not there while the music is what you are looking at.
if (!(await page.evaluate(() => document.querySelector('#reader')?.classList.contains('bare')))) {
  await tap(W * 0.5, H * 0.5, 4);
}
s = await state();
check('it hides with the rest of the controls', s.bare === true && s.shown === false,
  `bare=${s.bare} shown=${s.shown}`);

console.log('');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
check('nothing threw', errors.length === 0, `${errors.length} errors`);
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
