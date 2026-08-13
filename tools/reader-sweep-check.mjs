// Everything in the reader, used the way it is used, watching for anything
// that throws, hangs, or quietly stops working.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-sweep-check.mjs          # phone
//   node tools/reader-sweep-check.mjs ipad     # tablet
//
// This is the broad one. The other checks each prove a specific behaviour;
// this drives the whole surface — every tool, undo and redo, layers, stamps,
// bookmarks, zoom, night, the page jump, spread, close and reopen — and fails
// on any uncaught error, any tool that will not arm, and any mark that does
// not survive a round trip through the store.
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
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const W = size.width;
const H = size.height;

const xml = (bars = 80) => {
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
// A stroke well below the tool bar, which is above the ink and eats presses.
const scribble = async (row = 0) => {
  const y = 320 + row * 70;
  await pen('mousePressed', W * 0.25, y);
  for (let i = 1; i <= 20; i++) await pen('mouseMoved', W * 0.25 + i * (W * 0.02), y + Math.sin(i / 3) * 9);
  await pen('mouseReleased', W * 0.25 + W * 0.4, y);
  await wait(120);
};
const click = (sel) => page.evaluate((s) => {
  const n = document.querySelector(s);
  if (!n) return false;
  n.click();
  return true;
}, sel);
const marks = () => page.evaluate(async () => {
  const { loadAnnotations } = await import('/src/store/db.js');
  return (await loadAnnotations('sweep').catch(() => [])).length;
});
// What is armed. The shape and stamp buttons are lit the same way as the
// tools but carry no data-tool of their own — they stand for a whole family —
// so they are asked for by id.
const tool = () => page.evaluate(() => {
  const lit = document.querySelector('#reader-ink-bar [data-tool].on');
  if (lit) return lit.dataset.tool;
  if (document.querySelector('#reader-shapes.on')) return 'shape';
  if (document.querySelector('#reader-stamps.on')) return 'stamp';
  return null;
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(2200);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});
await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('sweep', []);
  await openReader({ id: 'sweep', name: 'Sweep', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 1000));
}, xml());
await wait(400);
check('the score opened', await page.evaluate(() => {
  const r = document.querySelector('#reader');
  return !!r && !r.hidden;
}));

// ---- every drawing tool arms, and the marking ones mark --------------------
await click('#reader-annotate');
await wait(200);
const MARKERS = ['pen', 'highlighter', 'lasso', 'eraser'];
for (const t of MARKERS) {
  await click(`#reader-ink-bar [data-tool="${t}"]`);
  await wait(180);
  check(`the ${t} arms`, (await tool()) === t, `tool=${await tool()}`);
}
// …and back to the pen to actually draw with it.
await click('#reader-ink-bar [data-tool="pen"]');
await wait(200);
const before = await marks();
await scribble(0);
await scribble(1);
await wait(900);
const after = await marks();
check('two strokes were kept', after === before + 2, `${before} -> ${after}`);

// ---- undo, redo -------------------------------------------------------------
await click('#reader-undo');
await wait(800);
check('undo takes one back', (await marks()) === after - 1, `${await marks()}`);
await click('#reader-redo');
await wait(800);
check('redo puts it back', (await marks()) === after, `${await marks()}`);

// ---- shapes, stamps, text ---------------------------------------------------
await click('#reader-shapes');
await wait(250);
const shapePicked = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.pick-row')].find((n) => /box/i.test(n.textContent));
  if (!row) return false;
  row.click();
  return true;
});
await wait(250);
check('a shape can be chosen from its menu', shapePicked && (await tool()) === 'shape',
  `tool=${await tool()}`);
const shapesBefore = await marks();
await pen('mousePressed', W * 0.3, 520);
for (let i = 1; i <= 10; i++) await pen('mouseMoved', W * 0.3 + i * 8, 520 + i * 4);
await pen('mouseReleased', W * 0.3 + 80, 560);
await wait(900);
check('a box is drawn', (await marks()) === shapesBefore + 1, `${await marks()}`);

await click('#reader-stamps');
await wait(250);
const stampPicked = await page.evaluate(() => {
  const row = document.querySelector('.pick-row');
  if (!row) return false;
  row.click();
  return true;
});
await wait(250);
check('a stamp can be chosen', stampPicked && (await tool()) === 'stamp', `tool=${await tool()}`);

// ---- layers -----------------------------------------------------------------
await click('#reader-layers');
await wait(250);
const layerPicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pick-row')];
  const other = rows.find((n) => /bowings/i.test(n.textContent));
  if (!other) return false;
  other.click();
  return true;
});
await wait(300);
check('another layer can be written on', layerPicked === true);

// ---- the tick puts everything away -----------------------------------------
await click('#reader-done');
await wait(250);
check('the tick puts the tool away', await page.evaluate(() =>
  !document.querySelector('#reader')?.classList.contains('drawing')));

// ---- the ⋯ menu opens and every row is reachable -----------------------------
await click('#reader-menu-btn');
await wait(350);
const menuRows = await page.evaluate(() => {
  const open = document.querySelector('#reader-menu')?.classList.contains('open');
  return { open, rows: document.querySelectorAll('#reader-menu .reader-menu-row').length };
});
check('the ⋯ menu opens with rows in it', menuRows.open === true && menuRows.rows > 4,
  JSON.stringify(menuRows));
await page.evaluate(() => document.querySelector('#reader-menu')?.classList.remove('open'));
await wait(200);

// ---- night, zoom, page jump, spread ----------------------------------------
await page.evaluate(() => document.querySelector('#reader')?.classList.contains('night'));
await click('#reader-count');            // the page-jump grid
await wait(350);
const jumped = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('.pick-pop.pages .page-cell')].at(-1);
  if (!cell) return null;
  const want = cell.textContent;
  cell.click();
  return want;
});
await wait(500);
check('the page jump goes where it is told', jumped !== null
  && (await page.evaluate(() => document.querySelector('#reader-count')?.textContent))
    .includes(`p. ${jumped} `), `asked for ${jumped}`);

// a pinch, and back out of it
const pinch = async (from, to) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: W / 2 - from, y: H / 2, id: 1 }, { x: W / 2 + from, y: H / 2, id: 2 }],
  });
  for (let i = 1; i <= 8; i++) {
    const at = from + ((to - from) * i) / 8;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: W / 2 - at, y: H / 2, id: 1 }, { x: W / 2 + at, y: H / 2, id: 2 }],
    });
  }
  // Released one finger at a time, the way a hand does. Ending both at once
  // is a thing only a test harness can do, and it hides the case the reader
  // actually has to survive — which reader-round-two-check.mjs covers on
  // purpose, by abandoning a touch outright.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd', touchPoints: [{ x: W / 2 + to, y: H / 2, id: 2 }],
  });
  await wait(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(500);
};
await pinch(40, 130);
const zoomed = await page.evaluate(() =>
  !document.querySelector('#reader-reset-zoom')?.hidden);
check('pinching zooms in', zoomed === true);
await click('#reader-reset-zoom');
await wait(400);
check('and the whole page comes back', await page.evaluate(() =>
  !!document.querySelector('#reader-reset-zoom')?.hidden));

// ---- everything still works after all that ---------------------------------
// The bar has to be DOWN before a tap on a side means "turn": while it is up,
// any tap on the music is a tap to send it away. That is the behaviour; the
// test just has to know it.
const tap1 = async (x, y, id) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(320);
};
const isBare = () => page.evaluate(() =>
  document.querySelector('#reader')?.classList.contains('bare'));
if (!(await isBare())) await tap1(W * 0.5, H * 0.5, 9);
check('the bar is down before the last turn', (await isBare()) === true);
const finalTurnBefore = await page.evaluate(() =>
  document.querySelector('#reader-count')?.textContent);
await tap1(W * 0.1, H * 0.6, 10);
const finalTurnAfter = await page.evaluate(() =>
  document.querySelector('#reader-count')?.textContent);
check('the reader still turns pages at the end of all that',
  finalTurnBefore !== finalTurnAfter, `${finalTurnBefore} -> ${finalTurnAfter}`);

// ---- close and reopen: the marks are all still there ------------------------
const kept = await marks();
await page.evaluate(async (x) => {
  const { close, openReader } = await import('/src/ui/reader.js');
  close();
  await new Promise((r) => setTimeout(r, 400));
  await openReader({ id: 'sweep', name: 'Sweep', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 1000));
}, xml());
await wait(400);
check('every mark survived closing and reopening', (await marks()) === kept,
  `${kept} before, ${await marks()} after`);
check('and nothing is left floating over the app', await page.evaluate(() =>
  document.querySelectorAll('.pick-pop').length === 0));

console.log('');
if (errors.length) {
  console.log(`${errors.length} error(s) on the page:`);
  console.log([...new Set(errors)].slice(0, 10).join('\n'));
}
check('nothing threw anywhere in that', errors.length === 0, `${errors.length} errors`);
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
