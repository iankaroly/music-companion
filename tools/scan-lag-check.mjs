// HOW SLOW THE SCANNER ACTUALLY IS, in three separate numbers.
//
// "The scanner is slow to use" has been an open, undiagnosed item since the
// commit that says so out loud: "I do not know whether what is slow is the
// outline, the shutter, or the app, and guessing at it produced this." Those
// are three different things and they are measured three different ways:
//
//   · THE OUTLINE — how long one tick of the watch loop takes. It runs every
//     150ms and does the whole page-find on the frame; if a tick costs more
//     than the gap between ticks, the loop is saturated and everything on that
//     thread — the blue box, a tap, the button lighting — is behind.
//   · THE SHUTTER — press to a picture in the strip, and press to the finished
//     page replacing it. The first is the one that reads as "instant".
//   · THE APP — press to the shutter being usable again, which is what a hand
//     scanning a movement of ten pages actually feels.
//
// Measured with the processor slowed, because this laptop is not the device:
// THROTTLE=6 is roughly the gap to a phone.
//
//   npm run dev             (on 5199)
//   npm run scan:lag        [THROTTLE=6]
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const SHOTS = Number(process.env.SHOTS ?? 5);

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
if (THROTTLE > 1) await page.emulateCPUThrottling(THROTTLE);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));

const out = await page.evaluate(async (shots) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { openScanner } = await import('/src/ui/scanner.js');
  openScanner().catch(() => null);
  for (let i = 0; i < 80 && !document.querySelector('#scan-shutter'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const shutter = document.querySelector('#scan-shutter');
  const opened = performance.now();
  for (let i = 0; i < 150 && shutter.disabled; i += 1) await new Promise((r) => setTimeout(r, 100));
  const live = Math.round(performance.now() - opened);

  // --- THE OUTLINE. One tick of the watch loop, timed from outside it: the
  // gap between the long tasks it schedules is what the interval actually
  // achieves, and how long each one blocks is what everything else waits for.
  const ticks = [];
  await new Promise((done) => {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) ticks.push(Math.round(entry.duration));
    });
    try { observer.observe({ entryTypes: ['longtask'] }); } catch { /* not everywhere */ }
    setTimeout(() => { observer.disconnect(); done(); }, 3000);
  });

  // …and the same thing measured directly, which works everywhere: how long
  // the main thread is unavailable, sampled by a timer that wants to run every
  // 16ms and reporting how late it actually is.
  const late = [];
  await new Promise((done) => {
    let last = performance.now();
    const beat = setInterval(() => {
      const now = performance.now();
      late.push(Math.round(now - last - 16));
      last = now;
    }, 16);
    setTimeout(() => { clearInterval(beat); done(); }, 3000);
  });

  // …and the loop's own stopwatch, which is the one that separates the outline
  // from everything else on the thread. See `scannerCost` in ui/scanner.js.
  const { scannerCost } = await import('/src/ui/scanner.js');
  const loop = scannerCost();

  // --- THE SHUTTER, and the app after it.
  const strip = document.querySelector('#scan-strip');
  const runs = [];
  for (let i = 0; i < shots; i += 1) {
    const began = performance.now();
    let appeared = null;
    let settled = null;
    const watching = new MutationObserver(() => {
      const slots = [...strip.querySelectorAll('.scan-thumb')];
      const mine = slots[i];
      if (!mine) return;
      if (appeared === null) appeared = performance.now() - began;
      if (settled === null && !mine.classList.contains('pending')) settled = performance.now() - began;
    });
    watching.observe(strip, { childList: true, subtree: true, attributes: true });
    shutter.click();
    for (let w = 0; w < 200; w += 1) {
      await new Promise((r) => setTimeout(r, 50));
      if (settled !== null && !shutter.disabled) break;
    }
    const usable = performance.now() - began;
    watching.disconnect();
    runs.push({
      appeared: appeared === null ? null : Math.round(appeared),
      settled: settled === null ? null : Math.round(settled),
      usable: Math.round(usable),
    });
    await new Promise((r) => setTimeout(r, 300));
  }
  document.querySelector('#scan-cancel')?.click();
  await new Promise((r) => setTimeout(r, 400));
  return { live, ticks, late, loop, runs, pages: runs.filter((r) => r.settled !== null).length };
}, SHOTS);

const mid = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const worst = (list) => (list.length ? Math.max(...list) : null);

console.log(`\n  the scanner, ${THROTTLE > 1 ? `processor slowed ${THROTTLE}x` : 'at full speed'}\n`);
console.log(`  camera live after            ${out.live}ms`);
console.log('');
console.log('  THE OUTLINE — the watch loop runs every 150ms and finds the page on every tick');
console.log(`  long tasks in 3s             ${out.ticks.length}`
  + `   median ${mid(out.ticks) ?? '—'}ms   worst ${worst(out.ticks) ?? '—'}ms`);
console.log(`  a 16ms timer ran this late   median ${mid(out.late)}ms   worst ${worst(out.late)}ms`);
console.log(`  one tick of the loop         median ${out.loop.tick}ms   worst ${out.loop.worst}ms`
  + `   over ${out.loop.ticks} ticks, one every ${out.loop.every}ms`);
console.log(`   …of which the page-find     ${out.loop.find}ms`
  + `   and reading the frame ${out.loop.frame}ms`);
const busy = out.loop.tick === null ? null : Math.round((out.loop.tick / out.loop.every) * 100);
console.log(`  the thread is busy           ${busy === null ? '—' : `${busy}%`} of the time,`
  + ' just looking at the picture');
console.log('');
console.log('  THE SHUTTER — press to picture, press to finished page, press to usable again');
for (const [i, r] of out.runs.entries()) {
  console.log(`   shot ${i + 1}    picture ${String(r.appeared ?? '—').padStart(5)}ms`
    + `   page ${String(r.settled ?? '—').padStart(6)}ms`
    + `   usable again ${String(r.usable).padStart(6)}ms`);
}
const nums = (k) => out.runs.map((r) => r[k]).filter((n) => n !== null);
console.log(`   median   picture ${String(mid(nums('appeared')) ?? '—').padStart(5)}ms`
  + `   page ${String(mid(nums('settled')) ?? '—').padStart(6)}ms`
  + `   usable again ${String(mid(nums('usable'))).padStart(6)}ms`);
if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
console.log(`\n  ${out.pages} of ${SHOTS} presses produced a page`);
await browser.close();
process.exit(out.pages === SHOTS && !errors.length ? 0 : 1);
