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
// The tick first. A tool now stays in your hand until you say otherwise, and
// while one is out a tap on the page is a mark rather than a page turn — the
// turns live on the annotating bar's own arrows. So this puts the pen away the
// way a player does, and then checks the reading gestures.
await page.evaluate(() => document.querySelector('#reader-done')?.click());
await wait(250);
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

// --- the row that comes out with the pen, and whether pressing it does anything
//
// "none of the options work from the new design in annotation mode. i click on
// the pen and then try to change something in the drop down and nothing works."
//
// The row was added and not added to `CHROME` — the one list of what on top of
// the music is a CONTROL rather than the page. Four gestures ask that question
// and the comment above the list says exactly what happens to anything left out
// of it: "every control added afterwards was a bug waiting in whichever list
// somebody forgot". So a press on a nib, a width or a colour fell through to
// the music and DREW A LINE, which is why nothing appeared to work.
//
// That is the signature this asserts, and it is stronger than "the button
// lights up": pressing a control must move the selection AND must not leave a
// mark on the page. Checking only the first would pass on a build where the
// selection changed and a stray stroke was laid down behind it.
{
  await page.evaluate(() => {
    if (!document.querySelector('#reader')?.classList.contains('drawing')) {
      document.querySelector('#reader-annotate')?.click();
    }
  });
  await wait(600);
  // THE CHROME HAS TO BE UP. The page-turn steps above deliberately leave the
  // reader `bare`, and bare styles the row `opacity: 0; pointer-events: none`
  // while leaving its BOX exactly where it was — so `getBoundingClientRect`
  // hands back a perfectly good rectangle for a control nobody can press, and
  // the first version of this block spent three assertions tapping an
  // invisible row. A tap on the music brings the bar back.
  if (await bare()) { await tap(W * 0.5, H * 0.5, 40); await wait(400); }
  if (await bare()) { await tap(W * 0.5, H * 0.5, 41); await wait(400); }
  check('the tool row can be reached at all', await bare() === false,
    'the reader is still bare, so nothing below could be pressed');
  const before = (await marks()).count;
  // PRESSED WHERE THEY ARE, WITH A REAL PEN, and not with `.click()`.
  //
  // The first version of this used `element.click()` and PASSED WITH THE BUG
  // PUT BACK — checked, by putting it back. A synthetic click is dispatched
  // straight at the element and never goes near the reader's own pointer
  // handlers, which is the entire mechanism at fault: `onChrome` is asked on
  // POINTERDOWN, and a control missing from that list has its press treated as
  // a mark on the music. So the press has to arrive the way a hand's does, at
  // a coordinate, through the same routing.
  const boxOf = (sel, pick) => page.evaluate(([s, want]) => {
    const all = [...document.querySelectorAll(s)];
    const node = want === 'off' ? all.find((n) => !n.classList.contains('on')) : all[0];
    if (!node) return null;
    // BROUGHT INTO VIEW FIRST. The tool's half of the row scrolls sideways on a
    // phone — deliberately, so a pen coming out never pushes the music down —
    // and the colours sit at the far end of it. A control scrolled past the
    // edge of its own pill still reports a rectangle, so tapping its centre
    // taps whatever is over that spot instead, which is how this failed on the
    // colours and only on the colours.
    node.scrollIntoView({ block: 'nearest', inline: 'center' });
    const b = node.getBoundingClientRect();
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    const at = document.elementFromPoint(x, y);
    return {
      x,
      y,
      key: node.dataset.nib ?? node.dataset.rowsize ?? node.dataset.preset ?? null,
      // What is ACTUALLY at that point — a control scrolled out of its own
      // pill still reports a perfectly good rectangle.
      at: at ? `${at.tagName}.${String(at.className).split(' ')[0]}` : 'nothing',
      inRow: !!at?.closest('#reader-ink-row'),
      onScreen: x > 0 && y > 0 && x < innerWidth && y < innerHeight,
    };
  }, [sel, pick]);
  const litOf = (sel, attr) => page.evaluate(([s, a]) =>
    document.querySelector(s)?.dataset?.[a] ?? null, [sel, attr]);

  const row = {};
  row.showing = await page.evaluate(() => {
    const r = document.querySelector('#reader-ink-row');
    return !!r && !r.hidden;
  });
  // THE NIBS ARE NOT ON THE ROW ON A PHONE, on purpose: there is room there for
  // the two things you change mid-bar — how thick and what colour — and not for
  // four pen types as well, and tapping the pen you are already holding opens
  // the case that has all of them. So which assertion is right here depends on
  // the width, and the check asks the screen rather than assuming.
  const nibsShown = await page.evaluate(() =>
    [...document.querySelectorAll('#reader-ink-row .ink-nib')].some((n) => n.offsetParent !== null));
  const nib = nibsShown ? await boxOf('#reader-ink-row .ink-nib', 'off') : null;
  row.askedFor = nib?.key ?? null;
  // TAPPED, not moused. This page is emulated as a phone (`isMobile: true`),
  // and a dispatched mouse event there produces pointer events but never a
  // click — so three assertions failed against a build where the control was
  // sitting right under the coordinate and working. A finger is also what a
  // player uses on these.
  if (nib) await tap(nib.x, nib.y, 50);
  await wait(300);
  row.nibTook = await litOf('#reader-ink-row .ink-nib.on', 'nib');

  const width = await boxOf('#reader-ink-row .ink-width', 'off');
  row.widthAsked = width?.key ?? null;
  if (width) await tap(width.x, width.y, 51);
  await wait(300);
  row.widthTook = await litOf('#reader-ink-row .ink-width.on', 'rowsize');

  const swatch = await boxOf('#reader-ink-row .reader-swatch', 'off');
  row.colourAsked = swatch?.key ?? null;
  if (swatch) await tap(swatch.x, swatch.y, 52);
  await wait(300);
  row.colourTook = await litOf('#reader-ink-row .reader-swatch.on', 'preset');
  await wait(700);
  const after = (await marks()).count;

  check('the row comes out with the pen', row.showing === true);
  if (nibsShown) {
    check('pressing a nib on it changes the pen',
      row.askedFor !== null && row.nibTook === row.askedFor,
      `asked for ${row.askedFor}, got ${row.nibTook}`
      + ` — at ${nib?.x?.toFixed(0)},${nib?.y?.toFixed(0)} sits ${nib?.at},`
      + ` in the row: ${nib?.inRow}, on screen: ${nib?.onScreen}`);
  } else {
    // Not simply skipped: the way to them has to still be there, or this is a
    // phone with four pen types and no route to any of them.
    const caseOpens = await page.evaluate(async () => {
      const wait2 = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('#reader-ink-bar [data-tool="pen"]')?.click();
      await wait2(400);
      const open = document.querySelector('#reader-brush')?.classList.contains('open') ?? false;
      const nibs = document.querySelectorAll('#reader-brush .brush-nib').length;
      document.querySelector('#reader-ink-bar [data-tool="pen"]')?.click();
      return { open, nibs };
    });
    check('the nibs are off the row on a phone, and the pen case still holds them',
      caseOpens.open && caseOpens.nibs >= 4,
      `case opened=${caseOpens.open}, ${caseOpens.nibs} nibs in it`);
  }
  check('pressing a width on it changes the width',
    row.widthAsked !== null && row.widthTook === row.widthAsked,
    `asked for ${row.widthAsked}, got ${row.widthTook}`);
  check('pressing a colour on it changes the colour',
    row.colourAsked !== null && row.colourTook === row.colourAsked,
    `asked for ${row.colourAsked}, got ${row.colourTook}`);
  // The bug itself: those three presses landed on the music and drew.
  check('…and none of those presses left a mark on the page',
    after === before, `${before} marks before, ${after} after`);

  // AND EVERY CONTROL ON IT IS REACHABLE AT EVERY WIDTH A PHONE COMES IN.
  //
  // The row scrolled sideways at first rather than wrapping, and `edge:fit`
  // could not see what that cost because it ALLOWS anything inside a sideways
  // scroller past the edge — which is exactly what this was. MEASURED then:
  // eight of twelve controls outside their own pill at 320px, five at 414px,
  // every colour among them. A control you can only reach by a drag nobody
  // tells you about is not a control.
  for (const width of [320, 375, 414, 430]) {
    await page.setViewport({ width, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await wait(500);
    const seen = await page.evaluate(() => {
      const shown = [...document.querySelectorAll('#reader-ink-row button')]
        .filter((c) => c.offsetParent !== null);
      const off = shown.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left < 0 || b.right > window.innerWidth;
      });
      // …and the middle of each one has to BE that control, not whatever is
      // painted over it.
      const covered = shown.filter((c) => {
        const b = c.getBoundingClientRect();
        const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return !at || (at !== c && !c.contains(at));
      });
      return { shown: shown.length, off: off.length, covered: covered.length };
    });
    check(`${width}px: every control on the row is on screen and answers`,
      seen.shown > 0 && seen.off === 0 && seen.covered === 0,
      `${seen.shown} shown, ${seen.off} off the edge, ${seen.covered} covered`);
  }
  await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await wait(400);
}

console.log('');
console.log(results.every((r) => r.pass) ? 'ALL PASS' : 'SOME FAILED');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
