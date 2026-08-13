// Does a mark actually MOVE while you drag it, or only when you let go?
//
// The finished marks live on a cached layer that is only re-drawn when
// something about it changes — see the dry-ink layer in reader.js. A lasso drag
// is the one mutation that does not announce itself through the save path, so
// this watches the pixels.
//
// Comparing whole canvases would prove nothing: the selection OUTLINE is drawn
// from the marks' live positions and moves during the drag whether or not the
// marks are re-drawn. So it counts the ink INSIDE the loop, where every mark
// was picked up and nothing else was. Frozen ink shows up as a count that
// barely moves while the pen is still down.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-lasso-check.mjs
//
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
const cdp = await page.createCDPSession();
page.on('pageerror', (e) => console.log('ERR', String(e)));

const xml = () => {
  const ms = [];
  for (let m = 1; m <= 24; m++) {
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
await page.evaluate(async (x) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  // Fat marks over the first dozen bars, so wherever the engraver puts them
  // some of them land in the middle of the screen where a loop can reach.
  await saveAnnotations('lasso-test', Array.from({ length: 12 }, (_, b) => ({
    tool: 'pen', layer: 0, colour: '#d81b3c', width: 1.2, overlay: false, nib: 'ballpoint',
    points: Array.from({ length: 14 }, (_, i) => ({ m: b + 1, u: 0.4 + i * 0.14, v: -1.8 })),
  })));
  await openReader({ id: 'lasso-test', name: 'Lasso', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 1000));
}, xml());
await new Promise((r) => setTimeout(r, 400));

// The ink canvas alone, so the engraving underneath cannot mask the answer.
const inkShot = () => page.evaluate(() => document.querySelector('#reader-ink').toDataURL());

const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen',
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Reach for the lasso, the long way round.
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(200);
await page.evaluate(() => document.querySelector('#reader-ink-bar [data-tool="lasso"]')?.click());
await wait(200);
const tool = await page.evaluate(() =>
  document.querySelector('#reader-ink-bar .reader-tool.on')?.dataset.tool);
console.log('tool:', tool);

const box = await page.evaluate(() => {
  const b = document.querySelector('#reader-sheet .osmd-page:not([hidden])')?.getBoundingClientRect();
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
});
console.log('page box:', JSON.stringify(box));

// Where the ink actually IS, read off the canvas rather than guessed at: the
// mark is anchored to a bar, and only the engraver knows where it put that bar.
const inkBox = await page.evaluate(() => {
  const c = document.querySelector('#reader-ink');
  const g = c.getContext('2d');
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const dpr = window.devicePixelRatio || 1;
  return x1 < 0 ? null : { x0: x0 / dpr, y0: y0 / dpr, x1: x1 / dpr, y1: y1 / dpr };
});
console.log('ink bounding box on screen:', JSON.stringify(inkBox));
if (!inkBox) { console.log('no ink drawn at all — FAIL'); await browser.close(); process.exit(1); }
// A loop over the middle of the page. It has to start BELOW the tool bar —
// that bar is showing (a tool is out) and it is above the ink canvas, so a
// loop begun up there is drawn on a button instead of on the music.
const lx0 = size.width * 0.06;
const lx1 = size.width * 0.94;
const ly0 = Math.max(size.height * 0.14, 110);
const ly1 = size.height * 0.46;
const cx = (lx0 + lx1) / 2;
const cy = (ly0 + ly1) / 2;
const rx = (lx1 - lx0) / 2;
const ry = (ly1 - ly0) / 2;
// Drawn slowly, round every side.
//
// A loop thrown down as five corners is five pointer moves, and a stroke of
// five points can miss what it is meant to enclose — the reader thins samples
// that have not travelled, so repeating a corner adds nothing. Walking each
// side gives the loop a shape rather than a hint of one, which is what made
// this catch nothing about one run in three.
async function loop(times) {
  const corners = [[cx - rx, cy - ry], [cx + rx, cy - ry], [cx + rx, cy + ry],
    [cx - rx, cy + ry], [cx - rx, cy - ry]];
  await pen('mousePressed', corners[0][0], corners[0][1]);
  for (let c = 1; c < corners.length; c++) {
    const [ax, ay] = corners[c - 1];
    const [bx, by] = corners[c];
    for (let i = 1; i <= 12; i++) {
      await pen('mouseMoved', ax + ((bx - ax) * i) / 12, ay + ((by - ay) * i) / 12);
    }
  }
  await pen('mouseReleased', corners[0][0], corners[0][1]);
  await wait(500);
  const said = await page.evaluate(() =>
    document.querySelector('#reader-selection')?.textContent?.trim() ?? 'nothing');
  const got = Number((said.match(/^(\d+)/) ?? [])[1] ?? 0);
  console.log(`selection bar says: ${said}`);
  if (!got && times > 0) {
    console.log('  (nothing caught — drawing the loop again)');
    return loop(times - 1);
  }
  return got;
}
const count = await loop(2);
if (!count) {
  console.log('the loop caught nothing — the test cannot answer');
  await browser.close();
  process.exit(1);
}

// Comparing whole canvases proves nothing here: the selection OUTLINE is drawn
// from the marks' live positions, so it moves during the drag whether or not
// the marks themselves are re-drawn. What settles it is the ink left behind —
// count the heavy pixels in the band the marks started in. If the marks really
// move, that band empties out while the pen is still down. If only the outline
// moves, the band is untouched but for one thin line.
const bandInk = (y0, y1) => page.evaluate(([a, b]) => {
  const c = document.querySelector('#reader-ink');
  const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const top = Math.max(0, Math.round(a * dpr));
  const h = Math.max(1, Math.round((b - a) * dpr));
  const { data } = g.getImageData(0, top, c.width, h);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) n++;
  return n;
}, [y0, y1]);

// Only the ink INSIDE the loop is counted. Every mark in there was picked up,
// and nothing else was — measuring whole rows of the screen would count marks
// at the same height that the loop never reached, which is most of them.
const boxInk = (x0, y0, x1, y1) => page.evaluate(([a, b, c2, d]) => {
  const c = document.querySelector('#reader-ink');
  const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const left = Math.max(0, Math.round(a * dpr));
  const top = Math.max(0, Math.round(b * dpr));
  const w = Math.max(1, Math.round((c2 - a) * dpr));
  const h = Math.max(1, Math.round((d - b) * dpr));
  const { data } = g.getImageData(left, top, w, h);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 12) n++;
  return n;
}, [x0, y0, x1, y1]);
const inkBefore = await boxInk(lx0, ly0, lx1, ly1);
const before = await inkShot();
// Drag it downward, and photograph the ink halfway through — with the pen
// still DOWN.
await pen('mousePressed', cx, cy);
const DROP = Math.min(240, size.height - ly1 - 20);
for (let i = 1; i <= 20; i++) await pen('mouseMoved', cx, cy + (i * DROP) / 20);
await wait(150);
const during = await inkShot();
const inkDuring = await boxInk(lx0, ly0, lx1, ly1);
await pen('mouseReleased', cx, cy + DROP);
await wait(500);
const after = await inkShot();

const inkAfter = await boxInk(lx0, ly0, lx1, ly1);
console.log('');
console.log(`inked pixels inside the loop — before ${inkBefore}, during ${inkDuring}, after ${inkAfter}`);
// Every mark on the page was picked up and dragged clear of the band, so a real
// move empties most of it. What is left is the selection outline crossing it.
console.log(`  (dragged ${Math.round(DROP)}px down)`);
const movedDuring = inkDuring < inkBefore * 0.6;
const movedAfter = inkAfter < inkBefore * 0.6;
console.log('the marks moved DURING the drag :', movedDuring, movedDuring ? 'PASS' : 'FAIL');
console.log('and stayed moved after it       :', movedAfter, movedAfter ? 'PASS' : 'FAIL');
const ok = movedDuring && movedAfter && before !== after;
console.log(ok ? 'ALL PASS' : 'SOME FAILED');
await browser.close();
process.exit(ok ? 0 : 1);
