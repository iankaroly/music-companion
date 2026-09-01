// HOW FAR THE LINE FALLS BEHIND THE NIB, and whether it gets worse the longer
// you draw.
//
// "the response time when annotating with the pen is a little bit slow."
//
// The ink path is already careful — a redraw is a rAF REQUEST rather than a
// synchronous repaint, and the finished marks live on their own dry canvas that
// is blitted in one call — so the obvious costs are taken and the remaining one
// has to be measured rather than guessed at.
//
// THE HYPOTHESIS THIS IS BUILT TO TEST: `paintInk` ends with
// `drawStroke(ctx, drawing)`, which renders the WHOLE in-progress stroke from
// all of its points, every frame. If that is where the time goes, the cost of a
// frame grows with the length of the stroke — the line is crisp for the first
// inch and lags by the end of a long phrase mark — and a pencil, which is four
// passes, gets there four times faster.
//
// THE INSTRUMENT IS `read:stall`'s, because this repo already established that
// mean frame time is the wrong measure here and the size of the block is the
// right one: a timer that wants to run every 20ms, reporting how late it
// actually is. A block of work N ms long makes it N ms late, whatever else is
// happening. Samples are bucketed by how much of the stroke had been drawn when
// they were taken, so growth is visible rather than averaged away.
//
// THROTTLE=6 slows the processor by roughly the gap to a phone; at 1x on a
// laptop this measures almost nothing and says so.
//
//   npm run dev
//   npm run pen:lag                 (THROTTLE=6 by default here)
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const THROTTLE = Number(process.env.THROTTLE ?? 6);
const MOVES = Number(process.env.MOVES ?? 320);

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
const size = { width: 820, height: 1180 };
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

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

const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', {
  type, x, y, button: type === 'mouseMoved' ? 'none' : 'left',
  buttons: type === 'mouseReleased' ? 0 : 1, pointerType: 'pen', force: 0.6,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(2000);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.setItem('readerNight', 'off');
});
await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('pen-lag', []);
  await openReader({ id: 'pen-lag', name: 'Pen lag', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, xml());
await wait(500);

if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

async function oneStroke(tool) {
  // Pick the nib. The bar is only there once the reader is drawing.
  // THE BUTTON IS `#reader-annotate`, and `#reader-pencil` DOES NOT EXIST.
  //
  // The first version of this clicked that id, which matched nothing — and the
  // run still drew, because a pointerType of 'pen' arms the pencil whatever
  // tool is showing. So it looked like it was working while both rows measured
  // the SAME nib, and the two numbers it printed under different names were
  // one number printed twice. Found by looking for the button in the DOM.
  //
  // The nib is picked off the row that comes out with the tool, and which nib
  // ended up selected is READ BACK rather than assumed.
  const picked = await page.evaluate((want) => {
    if (!document.querySelector('#reader')?.classList.contains('drawing')) {
      document.querySelector('#reader-annotate')?.click();
    }
    const nib = document.querySelector(`#reader-ink-row .ink-nib[data-nib="${want}"]`);
    nib?.click();
    return document.querySelector('#reader-ink-row .ink-nib.on')?.dataset.nib ?? null;
  }, tool);
  await wait(400);
  if (picked !== tool) {
    console.log(`  ${tool.padEnd(12)} COULD NOT SELECT THAT NIB — it is "${picked}";`
      + ' the row below would be about the wrong pen');
    return null;
  }

  await page.evaluate(() => {
    window.__late = [];
    window.__t0 = performance.now();
    let want = performance.now() + 20;
    const tick = () => {
      const now = performance.now();
      window.__late.push([now - window.__t0, Math.max(0, now - want)]);
      want = now + 20;
      window.__timer = setTimeout(tick, 20);
    };
    window.__timer = setTimeout(tick, 20);
  });

  // PACED FROM INSIDE THE PAGE, at the rate a pen actually reports.
  //
  // Neither extreme through CDP measures this. Awaiting each send puts 54ms
  // between points, which is a stroke the app has all the time in the world to
  // paint between — the one condition under which the fault cannot happen.
  // Queueing them all delivers 320 points in 16ms, which is a burst and not a
  // stroke. A pen on an iPad reports every 8ms or so, sustained, and that is
  // the thing being reproduced.
  //
  // The events are genuine PointerEvents with pointerType 'pen' and the same
  // pointerId throughout, dispatched at the element under the nib so capture
  // behaves. Whether it worked is not assumed: the stroke's own point count is
  // read back afterwards, and a run that did not draw says so instead of
  // reporting a small number as if it were good news.
  const drawnMs = await page.evaluate(async ({ w, h, moves }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const at = (x, y, type, extra = {}) => {
      const target = document.elementFromPoint(x, y) ?? document.querySelector('#reader');
      target?.dispatchEvent(new PointerEvent(type, {
        pointerId: 991, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
        clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.6,
        buttons: type === 'pointerup' ? 0 : 1, ...extra,
      }));
    };
    const t0 = performance.now();
    at(w * 0.12, h * 0.45, 'pointerdown');
    for (let i = 0; i < moves; i += 1) {
      const f = i / moves;
      at(w * (0.12 + 0.75 * f), h * (0.45 + 0.12 * Math.sin(f * 12)), 'pointermove');
      await sleep(8);
    }
    at(w * 0.87, h * 0.45, 'pointerup');
    return Math.round(performance.now() - t0);
  }, { w: size.width, h: size.height, moves: MOVES });
  // Saves are debounced (`scheduleSave`), and reading the store 300ms after the
  // pen lifts read the PREVIOUS stroke back — which looked exactly like a nib
  // that had refused to draw, and cost two rounds chasing it.
  await wait(1500);

  const late = await page.evaluate(() => {
    clearTimeout(window.__timer);
    const out = window.__late;
    window.__late = [];
    return out;
  });
  const drew = await page.evaluate(async () => {
    const { loadAnnotations } = await import('/src/store/db.js');
    const all = await loadAnnotations('pen-lag').catch(() => []);
    return all.at(-1)?.points?.length ?? 0;
  });
  return { late, drawnMs, drew };
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// A WARM-UP STROKE THAT IS THROWN AWAY. The first press after the pencil is
// picked lands while the ink bar is still arriving and the first paint is still
// compiling its paths, and the run measured a nib that had not started yet — the
// first tool through here reported 0 points of 320. Every tool is now measured
// in the same state as every other.
await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
await wait(600);
await page.evaluate(async ({ w, h }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (x, y, type) => (document.elementFromPoint(x, y) ?? document.querySelector('#reader'))
    ?.dispatchEvent(new PointerEvent(type, {
      pointerId: 990, pointerType: 'pen', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : 0.6,
      buttons: type === 'pointerup' ? 0 : 1,
    }));
  at(w * 0.2, h * 0.7, 'pointerdown');
  for (let i = 0; i < 12; i += 1) { at(w * (0.2 + i * 0.01), h * 0.7, 'pointermove'); await sleep(8); }
  at(w * 0.32, h * 0.7, 'pointerup');
}, { w: size.width, h: size.height });
await wait(500);

console.log(`\n  ${MOVES} pointer moves in one stroke, CPU throttled ${THROTTLE}x\n`);
console.log('  nib          first quarter        last quarter       worst   drawn in');
for (const tool of ['ballpoint', 'pencil']) {
  const got = await oneStroke(tool);
  if (!got) continue;
  const { late, drawnMs, drew } = got;
  if (late.length < 8) { console.log(`  ${tool.padEnd(12)} no samples`); continue; }
  if (drew < MOVES * 0.5) {
    console.log(`  ${tool.padEnd(12)} THE STROKE DID NOT FORM — ${drew} points of ${MOVES};`
      + ' nothing below this line means anything');
    continue;
  }
  const span = late.at(-1)[0];
  const early = late.filter(([t]) => t < span * 0.25).map(([, l]) => l);
  const later = late.filter(([t]) => t > span * 0.75).map(([, l]) => l);
  const worst = Math.max(...late.map(([, l]) => l));
  console.log(`  ${tool.padEnd(12)} ${`${median(early).toFixed(1)}ms`.padEnd(20)}`
    + `${`${median(later).toFixed(1)}ms`.padEnd(19)}`
    + `${`${worst.toFixed(0)}ms`.padEnd(8)}${drawnMs}ms  (${drew} points)`);
}
console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
