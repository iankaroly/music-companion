// Drives tools/reader-bench.html in the headless shell.
//
// The stroke is dispatched as REAL touch input over CDP rather than as
// hand-made PointerEvents, because a synthetic event cannot be given pointer
// capture and the reader's drawing path is built on capture.
import puppeteer from 'puppeteer-core';

// Deliberately the headless SHELL rather than the Chrome app: launching the app
// puts a bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const label = process.argv[2] ?? 'run';
const size = process.argv[3] === 'ipad'
  ? { width: 1024, height: 1366 }
  : { width: 414, height: 896 };

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`http://localhost:${PORT}/tools/reader-bench.html`, { waitUntil: 'load' });

const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
  type,
  touchPoints: type === 'touchEnd' ? [] : [{ x, y, force: 0.6, radiusX: 4, radiusY: 4, id: 1 }],
});

let ok = true;
try {
  await page.waitForFunction('window.__benchReadyToStroke', { timeout: 120000 });
  const { steps, w, h } = await page.evaluate(() => window.__benchReadyToStroke);

  await page.evaluate(() => window.__benchCount(true));
  const t0 = Date.now();
  await touch('touchStart', w * 0.3, h * 0.5);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', w * 0.3 + (w * 0.4 * i) / steps, h * 0.5 + Math.sin(i / 5) * 20);
  }
  // A hand held still at the end of the stroke, the way one is when you stop to
  // look at what you have written. Forty more samples, no movement: none of
  // them is a place the pen went, and none should be kept.
  const STILL = 40;
  for (let i = 0; i < STILL; i++) await touch('touchMove', w * 0.7, h * 0.5);
  await page.evaluate((n) => { window.__benchStill = n; }, STILL);
  await touch('touchEnd', w * 0.7, h * 0.5);
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.__benchCount(false));
  await page.evaluate((v) => { window.__benchStrokeMs = v; window.__benchStrokeDone(); }, ms);

  await page.waitForFunction('window.__benchDone', { timeout: 60000 });
} catch (err) {
  ok = false;
  errors.push(String(err));
}

console.log(`\n===== ${label} (${size.width}x${size.height}) =====`);
console.log(await page.$eval('#out', (n) => n.textContent));
if (ok) console.log('JSON:', JSON.stringify(await page.evaluate(() => window.__benchDone)));
else console.log('TIMED OUT / FAILED');
if (errors.length) console.log('page errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
await browser.close();
process.exit(ok ? 0 : 1);
