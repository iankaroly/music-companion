// THE LONGEST THE MAIN THREAD IS UNAVAILABLE WHILE A PART IS BEING READ.
//
// This is the number behind "after i scan something it takes a while to load
// before i can tap through the pages". The reading pass is the heaviest
// arithmetic in the app and it runs while somebody is trying to turn pages; a
// tap that arrives inside a block of it cannot be heard until the block ends.
//
// MEAN TURN TIME IS THE WRONG MEASURE and the last attempt at this was reverted
// because of it: cold means ran 1344–2669ms on identical code, so the noise
// swamped the change and nothing could be told from it. What is actually being
// changed is the size of the biggest uninterruptible block, and that is
// measured directly — a timer that wants to run every 50ms, reporting how late
// it actually is. A block of work N ms long makes it N ms late, whatever else
// the machine is doing.
//
//   npm run dev            (on 5199)
//   npm run read:stall     [THROTTLE=6] [PAGES=8] [WIDE=2600]
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const THROTTLE = Number(process.env.THROTTLE ?? 6);
const PAGES = Number(process.env.PAGES ?? 8);
const WIDE = Number(process.env.WIDE ?? 2600);
const WATCH_MS = Number(process.env.WATCH ?? 45000);

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
if (THROTTLE > 1) await page.emulateCPUThrottling(THROTTLE);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));

const out = await page.evaluate(async ({ pages, wide, watchMs }) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  // Pages dense enough to have eleven systems on them, which is what makes the
  // per-stave loop the long pole. A four-system page reads in a fraction of the
  // time and would hide the thing being measured.
  const sheet = (n) => {
    const c = document.createElement('canvas');
    c.width = wide;
    c.height = Math.round(wide * 3540 / 2600);
    const g = c.getContext('2d');
    const k = wide / 2600;
    g.fillStyle = '#fbf9f3'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#15130f';
    for (let sys = 0; sys < 11; sys += 1) {
      const top = (260 + sys * 290) * k;
      for (let l = 0; l < 5; l += 1) g.fillRect(230 * k, top + l * 20 * k, 2140 * k, 4 * k);
      for (let i = 0; i < 22; i += 1) {
        const x = (300 + i * 95) * k;
        const y = top + ((i * 3 + n) % 9) * 10 * k;
        g.beginPath(); g.ellipse(x, y, 12 * k, 9 * k, -0.3, 0, Math.PI * 2); g.fill();
        g.fillRect(x + 10 * k, y - 58 * k, 4 * k, 58 * k);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/jpeg', 0.9));
  };
  const files = await Promise.all(Array.from({ length: pages }, (_, i) => sheet(i)));

  const { savePagesScore, loadScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Just scanned', source: 'images', pageCount: pages,
    pages: files.map((b, i) => new File([b], `page-0${i + 1}.jpg`, { type: 'image/jpeg' })),
  });

  // THE TICK. It wants to run every 50ms; how late it is IS the length of the
  // block that kept it out.
  const late = [];
  let last = performance.now();
  const beat = setInterval(() => {
    const now = performance.now();
    late.push(Math.round(now - last - 50));
    last = now;
  }, 50);

  const { openReader } = await import('/src/ui/reader.js');
  const { measurePages } = await import('/src/ui/score.js');
  const { standAside } = await import('/src/ui/reader.js');
  const began = performance.now();
  // Opened and read at the same time, which is what a part just scanned does:
  // score.js fires the pass at import while the reader is coming up.
  openReader(await loadScore(scoreId), {}).catch(() => {});
  measurePages(scoreId, { standAside }).catch(() => {});
  await new Promise((r) => setTimeout(r, watchMs));
  clearInterval(beat);

  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  const read = (row?.layout ?? []).filter(Boolean).length;
  const sorted = [...late].sort((a, b) => b - a);
  return {
    worst: sorted[0] ?? 0,
    top5: sorted.slice(0, 5),
    over250: late.filter((n) => n > 250).length,
    over1000: late.filter((n) => n > 1000).length,
    ticks: late.length,
    pagesRead: read,
    ranFor: Math.round((performance.now() - began) / 100) / 10,
  };
}, { pages: PAGES, wide: WIDE, watchMs: WATCH_MS });

console.log(`\n  ${PAGES} pages, ${WIDE}px across, processor slowed ${THROTTLE}x,`
  + ` watched for ${WATCH_MS / 1000}s\n`);
console.log(`  longest block the main thread was unavailable   ${out.worst}ms`);
console.log(`  the five longest                                ${out.top5.join(', ')}ms`);
console.log(`  blocks over 250ms                               ${out.over250}`);
console.log(`  blocks over 1000ms                              ${out.over1000}`);
console.log(`  pages read in that time                         ${out.pagesRead} of ${PAGES}`);
if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 4)) console.log(`  ${e}`);
}
await browser.close();
