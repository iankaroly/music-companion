// Does the pen case survive being put away, and does the last page of a piece
// say what is coming?
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-memory-check.mjs
import puppeteer from 'puppeteer-core';

// The headless SHELL, not the Chrome app: the app puts an icon in the Dock.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const size = { width: 414, height: 896 };

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('ERR', String(e)));

const xml = (bars) => {
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

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.removeItem('readerBrushes');
});

// --- 1. the pen case ---------------------------------------------------------
// Open, pick up the highlighter, mix a colour nobody would get by accident,
// hide a layer, close.
const mixed = await page.evaluate(async (x) => {
  const { openReader, close } = await import('/src/ui/reader.js');
  await openReader({ id: 'mem', name: 'Memory', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 800));
  document.querySelector('#reader-annotate')?.click();
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('#reader-ink-bar [data-tool="highlighter"]')?.click();
  await new Promise((r) => setTimeout(r, 150));
  // A colour off the palette, well away from any default.
  const swatch = document.querySelector('#reader-brush .reader-palette-swatch, #reader-brush [data-hex]')
    ?? [...document.querySelectorAll('#reader-brush button')].find((b) => /^#/.test(b.dataset.hex ?? ''));
  return {
    tool: document.querySelector('#reader-ink-bar .reader-tool.on')?.dataset.tool,
    hasSwatch: !!swatch,
  };
}, xml(30));
console.log('after picking the highlighter:', JSON.stringify(mixed));

// Mix through the app's own controls: open the brush, set a hex.
const set = await page.evaluate(async () => {
  const pen = document.querySelector('#reader-ink-bar [data-tool="highlighter"]');
  pen?.click();                                   // tapping the held tool opens the case
  await new Promise((r) => setTimeout(r, 250));
  const hex = document.querySelector('#reader-hex');
  if (!hex) return { ok: false, why: 'no hex field' };
  hex.value = '#12b39a';
  hex.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  // And hide a layer, and move to another one.
  return { ok: true, brushOpen: document.querySelector('#reader-brush')?.classList.contains('open') };
});
console.log('mixing:', JSON.stringify(set));

await page.evaluate(async () => {
  const { close } = await import('/src/ui/reader.js');
  await new Promise((r) => setTimeout(r, 500));   // let the debounced save land
  close();
});
await new Promise((r) => setTimeout(r, 400));

const stored = await page.evaluate(() => localStorage.getItem('readerBrushes'));
console.log('stored:', stored ? `${stored.slice(0, 150)}…` : 'nothing');
check('the pen case was written down', !!stored);

// A genuine reload, then open the same score again.
await page.reload({ waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2200));
const back = await page.evaluate(async (x) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { openReader } = await import('/src/ui/reader.js');
  await openReader({ id: 'mem', name: 'Memory', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
  // The reader opens with no tool out; reaching for "annotate" takes the LAST
  // one, which is what should have survived.
  document.querySelector('#reader-annotate')?.click();
  await new Promise((r) => setTimeout(r, 250));
  const tool = document.querySelector('#reader-ink-bar .reader-tool.on')?.dataset.tool;
  document.querySelector(`#reader-ink-bar [data-tool="${tool}"]`)?.click();
  await new Promise((r) => setTimeout(r, 300));
  return { tool, hex: document.querySelector('#reader-hex')?.value };
}, xml(30));
console.log('after a reload:', JSON.stringify(back));
check('the tool you last used came back', back.tool === 'highlighter', `tool=${back.tool}`);
check('and the colour you mixed came back',
  (back.hex ?? '').toLowerCase() === '#12b39a', `hex=${back.hex}`);

// --- 2. up next --------------------------------------------------------------
const next = await page.evaluate(async (x) => {
  const { openReader, close } = await import('/src/ui/reader.js');
  close();
  await new Promise((r) => setTimeout(r, 200));
  await openReader({ id: 'mem2', name: 'Prelude', xml: x, kind: 'notation' }, {
    setlist: {
      id: 's1', name: 'Recital', items: ['mem2', 'mem3', 'mem4'],
      names: ['Prelude', 'Allemande', 'Courante'], index: 0,
    },
    onSetlistMove: () => {},
  });
  await new Promise((r) => setTimeout(r, 900));
  const chip = document.querySelector('#reader-next');
  const first = { hidden: chip?.hidden, text: chip?.textContent };
  // Go to the last page.
  const count = document.querySelector('#reader-count')?.textContent ?? '';
  const pages = Number((count.match(/of (\d+)/) ?? [])[1] ?? 1);
  const { readerIsOpen } = await import('/src/ui/reader.js');
  for (let i = 1; i < pages; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 300));
  return {
    pages,
    first,
    last: { hidden: chip?.hidden, text: chip?.textContent },
    where: document.querySelector('#reader-count')?.textContent,
    open: readerIsOpen(),
  };
}, xml(60));
console.log('up next:', JSON.stringify(next));
check('nothing is said on the first page of a piece', next.first.hidden === true);
check('the last page says what is coming',
  next.last.hidden === false && /Allemande/.test(next.last.text ?? ''), next.last.text);

console.log('');
console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
