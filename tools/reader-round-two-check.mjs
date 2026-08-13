// The second round of complaints from the stand, each one held to.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-round-two-check.mjs          # phone
//   node tools/reader-round-two-check.mjs ipad     # tablet
//
// What this cannot reach, as ever: whether iOS itself still raises the
// Copy / Look Up bubble. Chrome is not WebKit. It CAN prove that nothing in
// the app permits a selection, which is the half that is ours.
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

const xml = (bars = 60) => {
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

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = size.width;
const H = size.height;

const touchStart = (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent',
  { type: 'touchStart', touchPoints: [{ x, y, id }] });
const touchMove = (x, y, id = 1) => cdp.send('Input.dispatchTouchEvent',
  { type: 'touchMove', touchPoints: [{ x, y, id }] });
const touchEnd = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const tap = async (x, y, id = 1) => { await touchStart(x, y, id); await touchEnd(); await wait(240); };
const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force: 0.6,
});

const state = () => page.evaluate(() => ({
  drawing: document.querySelector('#reader')?.classList.contains('drawing'),
  tool: document.querySelector('#reader-ink-bar .reader-tool.on')?.dataset.tool ?? null,
  bare: document.querySelector('#reader')?.classList.contains('bare'),
  page: document.querySelector('#reader-count')?.textContent ?? '',
}));
const marks = () => page.evaluate(async () => {
  const { loadAnnotations } = await import('/src/store/db.js');
  const all = await loadAnnotations('r2').catch(() => []);
  return { count: all.length, points: all.map((s) => s.points.length) };
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(2000);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

const open = async (seed = []) => page.evaluate(async ([x, s]) => {
  const { openReader, close } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  close();
  await new Promise((r) => setTimeout(r, 200));
  await saveAnnotations('r2', s);
  await openReader({ id: 'r2', name: 'Round two', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, [xml(), seed]);

const bare = () => page.evaluate(() =>
  document.querySelector('#reader')?.classList.contains('bare'));
const hideBar = async () => { if (!(await bare())) await tap(W * 0.5, H * 0.5, 90); };

// ---- 1. the page always turns on the way down, with no mode to switch on ----
await open();
await hideBar();
const before = (await state()).page;
await touchStart(W * 0.9, H * 0.6, 2);
await wait(140);
const mid = (await state()).page;
check('the page turns before the finger leaves, with no mode set',
  before !== mid, `${before} -> ${mid}`);
await touchEnd();
await wait(250);
check('and lifting does not turn it again', (await state()).page === mid);
const gone = await page.evaluate(() =>
  [...document.querySelectorAll('.reader-menu-text b')].some((n) => /performance/i.test(n.textContent)));
check('the performance-mode switch is gone from the menu', gone === false);

// ---- 2. the top strip is easier to hit ---------------------------------------
await hideBar();
await tap(W * 0.5, H * 0.22, 3);          // 22% down: inside a quarter, outside a sixth
check('a tap a fifth of the way down brings the bar', (await bare()) === false,
  `bare=${await bare()}`);

// ---- 3. nothing anywhere is selectable while reading -------------------------
const sel = await page.evaluate(() => {
  const reading = document.documentElement.dataset.reading === 'yes';
  const pick = (s) => {
    const n = document.querySelector(s);
    return n ? getComputedStyle(n).webkitUserSelect || getComputedStyle(n).userSelect : 'absent';
  };
  // And prove a selection cannot be MADE: try to select the whole document.
  const range = document.createRange();
  range.selectNodeContents(document.body);
  const chosen = getSelection();
  chosen.removeAllRanges();
  chosen.addRange(range);
  const madeOne = !chosen.isCollapsed;
  // …and that a pointerdown on the page clears whatever was made.
  document.querySelector('#reader').dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 501, pointerType: 'touch', bubbles: true, clientX: 100, clientY: 400,
  }));
  const survived = !getSelection().isCollapsed;
  // …and that selectstart is refused.
  const ev = new Event('selectstart', { bubbles: true, cancelable: true });
  document.querySelector('#reader-sheet').dispatchEvent(ev);
  return {
    reading,
    html: pick('html'),
    sheet: pick('#reader-sheet'),
    title: pick('#reader-title'),
    ink: pick('#reader-ink'),
    body: pick('body'),
    madeOne,
    survived,
    selectstartRefused: ev.defaultPrevented,
  };
});
console.log('  selection state:', JSON.stringify(sel));
check('everything on screen refuses selection',
  ['html', 'sheet', 'title', 'ink', 'body'].every((k) => sel[k] === 'none'),
  Object.entries(sel).filter(([, v]) => v === 'auto' || v === 'text').map(([k]) => k).join(',') || 'all none');
check('selectstart is refused outright', sel.selectstartRefused === true);
check('a selection made anyway is cleared by touching the page', sel.survived === false);

// ---- 4. the tool stays put; a tap only hides the bar -------------------------
await open();
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('#reader-ink-bar [data-tool="highlighter"]')?.click());
await wait(200);
check('the highlighter is out', (await state()).tool === 'highlighter');
await tap(W * 0.5, H * 0.55, 4);          // a bare tap on the page
let s = await state();
check('a tap on the page hides the bar', s.bare === true, `bare=${s.bare}`);
check('…and does NOT put the tool down', s.drawing === true && s.tool === 'highlighter',
  `drawing=${s.drawing} tool=${s.tool}`);
await tap(W * 0.5, H * 0.55, 5);
s = await state();
check('tapping again brings the bar back, still on the highlighter',
  s.bare === false && s.tool === 'highlighter', `bare=${s.bare} tool=${s.tool}`);
await page.evaluate(() => document.querySelector('#reader-done')?.click());
await wait(200);
check('only the tick puts the tool away', (await state()).drawing === false);

// ---- 5. the eraser: a finger tap hides the bar, and it has sizes ------------
await open();
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('#reader-ink-bar [data-tool="eraser"]')?.click());
await wait(200);
check('the eraser is out', (await state()).tool === 'eraser');
await tap(W * 0.5, H * 0.55, 6);
s = await state();
check('a finger tap with the eraser out hides the bar', s.bare === true, `bare=${s.bare}`);
check('…and the eraser is still in hand', s.tool === 'eraser');
const sizes = await page.evaluate(() => {
  document.querySelector('#reader-ink-bar [data-tool="eraser"]')?.click();  // open its case
  return new Promise((r) => setTimeout(() => r({
    open: document.querySelector('#reader-brush')?.classList.contains('open'),
    rubbing: document.querySelector('#reader-brush')?.classList.contains('rubbing'),
    dots: document.querySelectorAll('#reader-eraser-sizes [data-eraser]').length,
    shown: getComputedStyle(document.querySelector('#reader-eraser-sizes')).display,
  }), 300));
});
console.log('  eraser panel:', JSON.stringify(sizes));
check('tapping the eraser again opens its sizes',
  sizes.open === true && sizes.rubbing === true && sizes.dots >= 3 && sizes.shown !== 'none');

// ---- 6. the eraser takes PART of a mark -------------------------------------
// One long stroke, rubbed through the middle, should come back as two.
//
// Seeded on a later bar so the engraver puts it well down the page: the tool
// bar is showing whenever a tool is out, it sits above the ink canvas, and a
// pen press on the top of the screen lands on a button instead of on the music.
await open([{
  tool: 'pen', layer: 0, colour: '#1c1b22', width: 0.4, overlay: false, nib: 'ballpoint',
  points: Array.from({ length: 60 }, (_, i) => ({ m: 9, u: 0.3 + i * 0.12, v: -1.6 })),
}]);
const BAR_BOTTOM = 140;   // nothing above this belongs to the page
const inkBox = await page.evaluate((top) => {
  const c = document.querySelector('#reader-ink');
  const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1;
  for (let y = Math.round(top * dpr); y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0: x0 / dpr, y0: y0 / dpr, x1: x1 / dpr, y1: y1 / dpr };
}, BAR_BOTTOM);
console.log('  the mark sits at:', JSON.stringify(inkBox));
if (!inkBox) {
  check('the seeded mark was drawn', false);
} else {
  await page.evaluate(() => {
    document.querySelector('#reader-annotate')?.click();
    document.querySelector('#reader-ink-bar [data-tool="eraser"]')?.click();
  });
  await wait(300);
  const my = (inkBox.y0 + inkBox.y1) / 2;
  const mx = (inkBox.x0 + inkBox.x1) / 2;
  await pen('mousePressed', mx, my);
  await pen('mouseMoved', mx + 4, my);
  await pen('mouseReleased', mx + 4, my);
  await wait(900);
  const after = await marks();
  console.log('  after rubbing the middle:', JSON.stringify(after));
  check('rubbing the middle leaves the two ends behind',
    after.count === 2, `${after.count} marks: ${after.points.join(' + ')} points`);
  // And undo puts the original back as ONE mark.
  await page.evaluate(() => document.querySelector('#reader-undo')?.click());
  await wait(900);
  const undone = await marks();
  console.log('  after undo:', JSON.stringify(undone));
  check('undo restores it as one whole mark',
    undone.count === 1 && undone.points[0] === 60, JSON.stringify(undone));
}

// ---- 7. a lost finger does not lock the reader ------------------------------
await open();
await hideBar();
// A touch that goes down and is never heard from again — a system gesture, an
// app switch, a pointer lost at the edge. Then a second one, to make the
// reader believe two fingers are down.
await touchStart(W * 0.3, H * 0.5, 40);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchMove',
  touchPoints: [{ x: W * 0.3, y: H * 0.5, id: 40 }, { x: W * 0.7, y: H * 0.5, id: 41 }],
});
await wait(120);
// …and now nothing. No touchEnd at all. The pointers are simply abandoned.
await page.evaluate(() => {
  // Take the touch tracking away so no end event can ever arrive for them.
  window.__abandoned = true;
});
await wait(1700);      // longer than the reader's patience for a silent pointer
const turnedBefore = (await state()).page;
await tap(W * 0.9, H * 0.6, 42);
const turnedAfter = (await state()).page;
check('an abandoned finger does not lock the reader for ever',
  turnedBefore !== turnedAfter, `${turnedBefore} -> ${turnedAfter}`);

console.log('');
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
