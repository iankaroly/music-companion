// How long a page turn takes, tap by tap, on a long scanned part.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/reader-lag-check.mjs                  # 14 pages, reading pace
//   SLOW=6 node tools/reader-lag-check.mjs 12 1500   # …on an iPad-ish processor
//   SLOW=6 SETTLE=40000 node tools/reader-lag-check.mjs 12 1500   # …already measured
//
// SLOW throttles the processor, which is the only honest way to ask this
// question from a desk: this laptop is about ten times an iPad, and every turn
// looks instant here whatever the code does. SETTLE is how long to wait after
// opening before turning — long enough and the part has finished measuring
// itself, which is the state a part you have owned for a week is in.
//
// Measures from the touch to the page actually being on screen, and reports
// the worst turns rather than the average, because the complaint is always
// "occasionally".
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
  + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const W = 414; const H = 896;
const PAGES = Number(process.argv[2] ?? 14);

const b = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: W, height: H, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await p.createCDPSession();
// This laptop is about ten times an iPad, so measuring here says nothing about
// the stand. Slowing the processor down is the only honest way to ask the
// question from a desk.
const SLOW = Number(process.env.SLOW ?? 1);
if (SLOW > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOW });
p.on('pageerror', (e) => console.log('ERR', String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await p.goto('http://localhost:5199/', { waitUntil: 'load' });
await wait(2200);

await p.evaluate(async (n, SETTLE) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const db = await import('/src/store/db.js');
  const reader = await import('/src/ui/reader.js');
  const mk = async (label) => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 4400;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    for (let s = 0; s < 18; s++) {
      const y = 220 + s * 230;
      for (let k = 0; k < 5; k++) g.fillRect(150, y + k * 12, 900, 3);
      for (let d = 0; d < 26; d++) {
        g.beginPath();
        g.ellipse(180 + d * 34, y + 12 + (d % 5) * 12, 9, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.font = '34px sans-serif';
    g.fillText(label, 160, 160);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  };
  const pages = [];
  for (let i = 0; i < n; i++) pages.push(await mk(`page ${i + 1}`));
  const id = await db.savePagesScore({
    name: 'Lag test', source: 'photo', pageCount: n, pages, raws: pages,
  });
  await reader.openReader({ id, name: 'Lag test', kind: 'pages' });
  await new Promise((r) => setTimeout(r, Number(SETTLE)));
}, PAGES, process.env.SETTLE ?? 4000);

const screens = await p.evaluate(() => {
  const t = document.querySelector('#reader-count')?.textContent ?? '';
  return Number((t.match(/of (\d+)/) ?? [])[1] ?? 0);
});
console.log(`${PAGES} pages of paper, ${screens} screenfuls, CPU x${SLOW} slower`);

// A turn is: touch the right-hand third, then wait until the page number has
// changed AND the canvas for it has pixels in it. That second half is what the
// eye actually waits for.
const turn = async (id) => {
  const from = await p.evaluate(() => document.querySelector('#reader-count')?.textContent);
  const t0 = Date.now();
  await cdp.send('Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [{ x: W * 0.9, y: H * 0.6, id }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  try {
    await p.waitForFunction((was) => {
      const now = document.querySelector('#reader-count')?.textContent;
      if (!now || now === was) return false;
      const c = document.querySelector('#reader-sheet .reader-paper:not([hidden]) canvas');
      return !!c && c.width > 1;
    }, { timeout: 6000, polling: 16 }, from);
  } catch {
    return { ms: -1, from, to: await p.evaluate(() =>
      document.querySelector('#reader-count')?.textContent) };
  }
  return { ms: Date.now() - t0, from };
};

const times = [];
for (let i = 1; i < Math.min(screens, 26); i++) {
  const r = await turn(100 + i);
  times.push(r.ms);
  await wait(Number(process.argv[3] ?? 260));
}
const good = times.filter((t) => t >= 0);
good.sort((a, b) => a - b);
const at = (q) => good[Math.min(good.length - 1, Math.floor(good.length * q))];
console.log(`turns measured: ${good.length}${times.length - good.length ? `  (${times.length - good.length} TIMED OUT)` : ''}`);
console.log(`median ${at(0.5)}ms   90th ${at(0.9)}ms   worst ${good.at(-1)}ms`);
console.log(`every turn: ${times.join(', ')}`);
await b.close();
