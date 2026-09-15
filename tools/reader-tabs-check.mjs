// Tabs: switching, closing, home; and a dotted, stabilised stroke.
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const xml = (name) => `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>${name}</part-name></score-part></part-list><part id="P1">` + Array.from({ length: 12 }, (_, m) => `<measure number="${m + 1}">` + (m === 0 ? '<attributes><divisions>1</divisions><clef><sign>F</sign><line>4</line></clef></attributes>' : '') + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type></note></measure>').join('') + '</part></score-partwise>';
const out = await page.evaluate(async ([xa, xb]) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.removeItem('readerTabs');
  const { saveScore, loadScore, loadAnnotations } = await import('/src/store/db.js');
  const a = await saveScore({ name: 'Alpha', xml: xa });
  const b = await saveScore({ name: 'Beta', xml: xb });
  const reader = await import('/src/ui/reader.js');
  await reader.openReader(await loadScore(a));
  await new Promise((r) => setTimeout(r, 600));
  await reader.openReader(await loadScore(b));
  await new Promise((r) => setTimeout(r, 600));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tabs = () => [...document.querySelectorAll('.reader-tab')].map((t) => t.querySelector('.reader-tab-label').textContent + (t.classList.contains('on') ? '*' : ''));
  const r = { afterTwoOpens: tabs() };
  // switch to Alpha by its tab
  document.querySelector('.reader-tab:not(.on) .reader-tab-name').click();
  await wait(1200);
  r.afterSwitch = tabs();
  r.titleAfterSwitch = document.querySelector('#reader-title').textContent;
  r.readerOpen = reader.readerIsOpen();
  r.stillReading = document.documentElement.dataset.reading === 'yes';
  // a dotted, stabilised stroke on Alpha
  document.querySelector('#reader-annotate').click();
  await wait(200);
  document.querySelector('#reader-ink-bar .ink-width.on').click();   // opens stroke settings
  await wait(200);
  r.strokeOpen = document.querySelector('#reader-stroke').classList.contains('open');
  document.querySelector('[data-dash="dotted"]').click();
  await wait(100);
  r.dottedLit = document.querySelector('[data-dash="dotted"]').classList.contains('on');
  document.querySelector('#reader-ink-bar [data-tool="pen"]').click();   // the pen case
  await wait(200);
  r.penOpen = document.querySelector('#reader-brush').classList.contains('open');
  r.brushTitle = document.querySelector('#reader-brush-title').textContent;
  const rail = document.querySelector('#reader-stab-rail');
  const box = rail.getBoundingClientRect();
  rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: box.left + box.width * 0.6, clientY: box.top + 4, pointerId: 7 }));
  await wait(100);
  r.stabValue = document.querySelector('#reader-stab-value').textContent;
  reader.close();
  return { ...r, aId: a, bId: b };
}, [xml('Alpha'), xml('Beta')]);
console.log(out);
// draw a stroke with a finger on Alpha (reopen), then read it back
const drawn = await page.evaluate(async (aId) => {
  const { loadScore, loadAnnotations } = await import('/src/store/db.js');
  const reader = await import('/src/ui/reader.js');
  await reader.openReader(await loadScore(aId));
  await new Promise((r) => setTimeout(r, 700));
  document.querySelector('#reader-annotate').click();
  await new Promise((r) => setTimeout(r, 200));
  return { drawing: document.querySelector('#reader').classList.contains('drawing') };
}, out.aId);
console.log('reopened', drawn);
const cdp = await page.createCDPSession();
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
await touch('touchStart', 300, 420);
for (let i = 1; i <= 20; i++) { await touch('touchMove', 300 + i * 12, 420 + Math.sin(i) * 14); await new Promise((r) => setTimeout(r, 16)); }
await touch('touchEnd', 540, 420);
await new Promise((r) => setTimeout(r, 900));
const marks = await page.evaluate(async (aId) => {
  const reader = await import('/src/ui/reader.js');
  reader.close();
  await new Promise((r) => setTimeout(r, 400));
  const { loadAnnotations } = await import('/src/store/db.js');
  const strokes = await loadAnnotations(aId);
  return strokes.map((s) => ({ dash: s.dash, nib: s.nib, points: s.points.length, tool: s.tool }));
}, out.aId);
console.log('strokes on Alpha', marks);
// close the active tab: the reader moves to the neighbour
const closed = await page.evaluate(async (aId) => {
  const { loadScore } = await import('/src/store/db.js');
  const reader = await import('/src/ui/reader.js');
  await reader.openReader(await loadScore(aId));
  await new Promise((r) => setTimeout(r, 600));
  const tabs = () => [...document.querySelectorAll('.reader-tab')].map((t) => t.querySelector('.reader-tab-label').textContent + (t.classList.contains('on') ? '*' : ''));
  document.querySelector('.reader-tab.on .reader-tab-close').click();
  await new Promise((r) => setTimeout(r, 1200));
  const r = { afterClose: tabs(), open: reader.readerIsOpen() };
  document.querySelector('.reader-tab.on .reader-tab-close').click();
  await new Promise((r) => setTimeout(r, 600));
  r.afterLast = { tabs: tabs(), open: reader.readerIsOpen() };
  return r;
}, out.aId);
console.log(closed);
await browser.close();
