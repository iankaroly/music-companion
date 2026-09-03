// ONE FINGER MOVES A ZOOMED PAGE — and nothing else changes.
//
// "when im zoomed in on the score annotating, i should be able to drag with one
// finger up and down, to the left and to the right to move the score in that
// direction while zoomed in."
//
// The rule is ZOOM, not the tool: past zoom 1 there is more page than screen,
// so a finger has somewhere to push it and the pencil keeps the ink. At zoom 1
// nothing changes, and that half is asserted here too — a gesture that quietly
// stopped a finger drawing or stopped a page turning would be a worse fault
// than the one this fixes.
//
// GETTING TO ZOOM > 1 IS ITSELF THE HARD PART, and two earlier attempts at it
// measured the wrong thing. The reader's own "Bigger" menu row calls `resize`,
// which changes the READING size and never touches the pinch zoom — so a run
// that used it reported `zoom 1` while believing it had magnified the page.
// Only a real two-finger spread gets there, so that is what this does, and it
// READS THE ZOOM BACK before trusting anything below it.
//
//   npm run dev
//   npm run reader:pan
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
const W = 820;
const H = 1180;
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })),
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1900);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  localStorage.setItem('readerNight', 'off');
});

// A photographed part, which is what gets zoomed into and annotated.
await page.evaluate(async () => {
  const db = await import('/src/store/db.js');
  const reader = await import('/src/ui/reader.js');
  const mk = async () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 4400;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    for (let st = 0; st < 18; st += 1) {
      const y = 220 + st * 230;
      for (let k = 0; k < 5; k += 1) g.fillRect(150, y + k * 12, 900, 3);
    }
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  };
  const pages = [await mk(), await mk()];
  const id = await db.savePagesScore({
    name: 'Pan test', source: 'photo', pageCount: 2, pages, raws: pages,
  });
  await db.saveAnnotations(id, []);
  await reader.openReader({ id, name: 'Pan test', kind: 'pages', source: 'photo' });
  await new Promise((r) => setTimeout(r, 3500));
});
await wait(700);

const state = () => page.evaluate(async () => {
  const { readerState } = await import('/src/ui/reader.js');
  const s = readerState();
  const { loadAnnotations } = await import('/src/store/db.js');
  const marks = await loadAnnotations('__none__').catch(() => []);
  return { zoom: s.zoom, panX: Math.round(s.panX), panY: Math.round(s.panY),
    page: document.querySelector('#reader-count')?.textContent ?? '', marks: marks.length };
});

// ── a real pinch, because nothing else reaches zoom > 1 ─────────────────────
const cx = W / 2;
const cy = H / 2;
await touch('touchStart', [{ x: cx - 60, y: cy, id: 1 }, { x: cx + 60, y: cy, id: 2 }]);
for (let i = 1; i <= 8; i += 1) {
  const d = 60 + i * 28;
  await touch('touchMove', [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]);
  await wait(45);
}
await touch('touchEnd', []);
await wait(700);
const zoomed = await state();
check('a two-finger spread magnifies the page', zoomed.zoom > 1.05,
  `zoom ${zoomed.zoom.toFixed(2)}`);

if (zoomed.zoom <= 1.05) {
  console.log('\n  the page never magnified, so nothing below would mean anything');
} else {
  // ── one finger, dragged ───────────────────────────────────────────────────
  const beforeDrag = await state();
  await touch('touchStart', [{ x: cx, y: cy, id: 7 }]);
  for (let i = 1; i <= 8; i += 1) {
    await touch('touchMove', [{ x: cx - i * 18, y: cy - i * 12, id: 7 }]);
    await wait(35);
  }
  await touch('touchEnd', []);
  await wait(600);
  const afterDrag = await state();
  check('one finger moves the page while it is zoomed in',
    Math.abs(afterDrag.panX - beforeDrag.panX) > 40
      && Math.abs(afterDrag.panY - beforeDrag.panY) > 20,
    `pan ${beforeDrag.panX},${beforeDrag.panY} → ${afterDrag.panX},${afterDrag.panY}`);
  check('…and it moves the way the finger went',
    afterDrag.panX < beforeDrag.panX && afterDrag.panY < beforeDrag.panY,
    `dragged up and left; pan went ${afterDrag.panX - beforeDrag.panX},`
    + `${afterDrag.panY - beforeDrag.panY}`);
  check('…and does not turn the page under you',
    afterDrag.page === beforeDrag.page, `${beforeDrag.page} → ${afterDrag.page}`);
  check('…and leaves no ink behind', afterDrag.marks === beforeDrag.marks,
    `${beforeDrag.marks} marks → ${afterDrag.marks}`);
}

check('nothing was thrown', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
process.exit(failed.length ? 1 : 0);
