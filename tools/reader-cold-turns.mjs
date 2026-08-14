// Why the first turns of a freshly opened part are the slow ones.
//
// The complaint is specific and the specificity is the clue: turning pages is
// good, EXCEPT just after opening a score, when tapping quickly leaves you
// looking at a page that has not arrived. forScore does not do this, so it is
// not a law of nature.
//
// There are two candidates and they want opposite fixes:
//
//   the measuring pass — the read of every page for staves, bars and
//     noteheads. It runs once per score, ever, and "once per score, ever" is
//     the same shape as "only the first time you open it".
//   the look-ahead — which draws its pages at FULL quality while the turn
//     itself draws cheap-then-sharpens, so the pages being warmed cost several
//     times what the page you are waiting on costs.
//
// So this measures rather than guesses: the same part, turned the same way,
// cold (nothing stored) and then warm (measured, layout cached). If warm is
// fast, it is the measuring pass. If both are slow, it is the look-ahead.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-cold-turns.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const PAGES = 10;
const TURNS = 6;

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// A part of several pages, each one real enough for the page reader to work on.
const scoreId = await page.evaluate(async (count) => {
  const draw = (n) => {
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 1500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    const space = 13;
    for (let sys = 0; sys < 6; sys++) {
      const top = 150 + sys * 220;
      for (let line = 0; line < 5; line++) g.fillRect(100, top + line * space, 900, 2);
      for (const x of [100, 400, 700, 1000]) g.fillRect(x, top, 2, space * 4);
      for (let i = 0; i < 10; i++) {
        const x = 150 + i * 88;
        const y = top + ((i + n) % 5) * (space / 2) + space;
        g.beginPath();
        g.ellipse(x, y, space * 0.6, space * 0.45, -0.3, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x + space * 0.5, y - space * 3, 2, space * 3);
      }
    }
    return c.toDataURL('image/png');
  };
  const { savePagesScore } = await import('/src/store/db.js');
  const pages = Array.from({ length: count }, (_, i) => draw(i));
  return savePagesScore({ name: 'Turn test', source: 'images', pageCount: count, pages });
}, PAGES);

// Open the part and tap through it as fast as a hand can, timing how long each
// turn takes to actually put a DRAWN page on screen.
//
// The taps go in over CDP as real touch input. Synthetic PointerEvents do not
// reach the reader's tap machinery — it counts contacts, arms pinches and
// tells a tap from a swipe — so a hand-made event turns no page at all and
// times nothing but the loop around it.
const cdp = await page.createCDPSession();
const tap = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await new Promise((r) => setTimeout(r, 30));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

const readerState = () => page.evaluate(() => {
  const count = document.querySelector('#reader-count')?.textContent ?? '';
  const on = Number((count.match(/p\.\s*(\d+)/) ?? [])[1] ?? 0) - 1;
  const node = [...document.querySelectorAll('#reader .osmd-page')][on];
  const canvas = node?.querySelector('canvas');
  return { on, drawn: !!canvas && canvas.width > 1, count };
});

async function run(label, { width, height }) {
  await page.evaluate(async (id) => {
    const { openReader, close } = await import('/src/ui/reader.js');
    const { loadScore } = await import('/src/store/db.js');
    close?.();
    await new Promise((r) => setTimeout(r, 400));
    await openReader(await loadScore(id), {});
    await new Promise((r) => setTimeout(r, 1200));
  }, scoreId);

  const out = [];
  for (let t = 0; t < TURNS; t++) {
    const before = (await readerState()).on;
    const began = Date.now();
    await tap(width * 0.9, height * 0.5);
    let state = await readerState();
    // Waited on the PICTURE, not on the page number: the number changes the
    // instant you tap and is not what anybody is complaining about.
    while (Date.now() - began < 5000) {
      state = await readerState();
      if (state.on !== before && state.drawn) break;
      await new Promise((r) => setTimeout(r, 16));
    }
    out.push({ ms: Date.now() - began, moved: state.on !== before, at: state.on });
    await new Promise((r) => setTimeout(r, 120));   // as fast as a hand taps
  }

  const times = out.map((o) => o.ms);
  const moved = out.filter((o) => o.moved).length;
  const mean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`${label.padEnd(22)} ${times.map((t) => String(t).padStart(5)).join(' ')}`
    + `   mean ${mean}ms  worst ${Math.max(...times)}ms  turned ${moved}/${TURNS}`);
  return { times, mean, moved };
}

console.log(`\n${''.padEnd(22)} ${Array.from({ length: TURNS }, (_, i) => `t${i + 1}`.padStart(5)).join(' ')}`);
const size = { width: 1024, height: 1366 };
const cold = await run('cold (never opened)', size);

// Let the measuring pass finish, which is what "warm" means.
await page.evaluate(async () => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
});
const warm = await run('warm (layout stored)', size);


// --- how fast the window in front of you fills ------------------------------
//
// The wall clock above measures one turn at a time with a wait in between,
// which is not the complaint. The complaint is a hand tapping faster than the
// reader can keep up, just after opening — so the honest measure is how many
// pages are READY at a given moment after the score comes up, and how many
// taps in a row land on a page that is already drawn.
async function warmth(label) {
  await page.evaluate(async (id) => {
    const { openReader, close } = await import('/src/ui/reader.js');
    const { loadScore } = await import('/src/store/db.js');
    close?.();
    await new Promise((r) => setTimeout(r, 400));
    await openReader(await loadScore(id), {});
  }, scoreId);

  const ready = [];
  for (const at of [400, 800, 1600]) {
    await new Promise((r) => setTimeout(r, at - (ready.length ? [400, 800, 1600][ready.length - 1] : 0)));
    ready.push(await page.evaluate(() => [...document.querySelectorAll('#reader .osmd-page')]
      .filter((n) => { const c = n.querySelector('canvas'); return c && c.width > 1; }).length));
  }

  // And then eight taps at the speed of an impatient hand, counting how many
  // landed on a page that was already there.
  let instant = 0;
  for (let i = 0; i < 8; i++) {
    await tap(1024 * 0.9, 1366 * 0.5);
    await new Promise((r) => setTimeout(r, 90));
    const s = await readerState();
    if (s.drawn) instant += 1;
  }
  console.log(`${label.padEnd(22)} pages drawn @400/800/1600ms: ${ready.join('/')}`
    + `   instant taps ${instant}/8`);
  return { ready, instant };
}

console.log('');
await warmth('warm-up');

const stored = await page.evaluate(async (id) => {
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(id);
  return { hasLayout: !!row?.layout, read: row?.layout?.filter(Boolean).length ?? 0 };
}, scoreId);

console.log(`\nlayout stored: ${stored.hasLayout} (${stored.read}/${PAGES} pages read)`);
console.log(cold.mean > warm.mean * 1.6
  ? '\n→ the MEASURING PASS is what makes the first turns slow.'
  : '\n→ cold and warm are alike: the LOOK-AHEAD is what makes turns slow.');
if (errors.length) console.log('\nerrors:', errors.slice(0, 4).join(' | '));
await browser.close();
