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
  const drawn = await page.evaluate(async ({ w, h, moves }) => {
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
    const lifted = performance.now() - window.__t0;
    at(w * 0.87, h * 0.45, 'pointerup');
    return { ms: Math.round(performance.now() - t0), lift: lifted };
  }, { w: size.width, h: size.height, moves: MOVES });
  const drawnMs = drawn.ms;
  const lift = drawn.lift;
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
  return { late, drawnMs, drew, lift };
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// HOW MANY MARKS ARE ALREADY ON THE PAGE, which is the condition the first
// version of this could not see. It measured a page with nothing on it and
// reported that the ink path keeps up comfortably — true, and about the one
// page nobody has been annotating.
//
// THE HYPOTHESIS: `dryStamp` includes `strokes.length`, so the moment a stroke
// is finished the whole dry layer is thrown away and every mark on the page is
// placed against its bar and re-rasterised to rebuild it. That is a cost paid
// at every PEN LIFT and it grows with the number of marks already there — which
// is exactly the shape of "it gets slower the more I annotate".
const seedStrokes = (n) => {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const bar = 1 + (i % 36);
    const points = [];
    for (let k = 0; k < 24; k += 1) {
      points.push({ m: bar, u: 0.1 + k * 0.03, v: 0.3 + 0.25 * Math.sin(k / 3 + i) });
    }
    out.push({
      tool: 'pen', layer: 0, colour: '#1c1b22', width: 0.28,
      overlay: false, nib: 'ballpoint', points,
    });
  }
  return out;
};

async function withMarks(count) {
  await page.evaluate(async ({ x, seeded }) => {
    const { openReader, close } = await import('/src/ui/reader.js');
    const { saveAnnotations } = await import('/src/store/db.js');
    close?.();
    await saveAnnotations('pen-lag', seeded);
    await openReader({ id: 'pen-lag', name: 'Pen lag', xml: x, kind: 'notation' });
    await new Promise((r) => setTimeout(r, 1100));
  }, { x: xml(), seeded: seedStrokes(count) });
  await wait(600);

  // A WARM-UP STROKE THAT IS THROWN AWAY. The first press after the tool comes
  // out lands while the row is still arriving and the first paint is still
  // compiling its paths, and a run measured a nib that had not started yet.
  await page.evaluate(() => {
    if (!document.querySelector('#reader')?.classList.contains('drawing')) {
      document.querySelector('#reader-annotate')?.click();
    }
  });
  await wait(500);
  return oneStroke('ballpoint');
}

console.log(`\n  ${MOVES} pointer moves in one stroke, CPU throttled ${THROTTLE}x\n`);
console.log('  marks already   during the stroke      at the PEN LIFT     drawn in');
console.log('  on the page     median      worst      the block           ');
for (const count of [0, 60, 200]) {
  const got = await withMarks(count);
  if (!got) { console.log(`  ${String(count).padEnd(15)} could not draw`); continue; }
  const { late, drawnMs, drew, lift } = got;
  if (drew < MOVES * 0.5) {
    console.log(`  ${String(count).padEnd(15)} THE STROKE DID NOT FORM — ${drew} points of ${MOVES}`);
    continue;
  }
  const during = late.filter(([t]) => t <= lift).map(([, l]) => l);
  const after = late.filter(([t]) => t > lift).map(([, l]) => l);
  console.log(`  ${String(count).padEnd(15)}${`${median(during).toFixed(1)}ms`.padEnd(12)}`
    + `${`${Math.max(0, ...during).toFixed(0)}ms`.padEnd(11)}`
    + `${`${Math.max(0, ...after).toFixed(0)}ms`.padEnd(20)}${drawnMs}ms`);
}

// ── AND THE SAME STROKE ON A PHOTOGRAPHED PAGE, ZOOMED IN ───────────────────
//
// The condition this instrument could not see, and the one the owner is
// annotating in: a SCAN rather than engraved notation, magnified. Everything
// above is measured on notation at zoom 1, where the page is drawn once and
// never re-rasterised.
//
// WHAT IS SUSPECTED, from reading the input path: a pencil is deliberately
// never counted in `pointers` — src/ui/reader.js says so at the pen branch,
// because a pencil is never one of the fingers of a pinch. The consequence is
// at the tail of the shared pointerup handler: `if (pointers.size === 0 &&
// isPaper() && zoom > 1) redrawPaperAtZoom()`. With the pen uncounted, that
// condition is TRUE AT EVERY PEN LIFT — so finishing a stroke on a zoomed scan
// schedules a full re-raster of the visible band at innerWidth*zoom by
// innerHeight*zoom, 220ms later, for a gesture that changed no zoom at all.
async function paperRun(onePage = false) {
  await page.evaluateOnNewDocument(() => {});
  await page.evaluate((one) => { window.__ONEPAGE = one; }, onePage);
  await page.evaluate(async () => {
    const db = await import('/src/store/db.js');
    const reader = await import('/src/ui/reader.js');
    const mk = async (label) => {
      const c = document.createElement('canvas');
      c.width = 1200; c.height = 4400;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#111';
      for (let st = 0; st < 18; st += 1) {
        const y = 220 + st * 230;
        for (let k = 0; k < 5; k += 1) g.fillRect(150, y + k * 12, 900, 3);
        for (let d = 0; d < 26; d += 1) {
          g.beginPath();
          g.ellipse(180 + d * 34, y + 12 + (d % 5) * 12, 9, 7, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.font = '34px sans-serif';
      g.fillText(label, 160, 160);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    };
    // ONE PAGE OR TWO, because that is the discriminator. A cost paid once,
    // right at the end of the first stroke on a freshly opened page, is what
    // the neighbour look-ahead looks like — it stands aside while a hand is on
    // the glass and runs the moment the hand comes off. With no neighbour to
    // decode there is nothing for it to do, so if the block survives a
    // single-page score it is something else.
    const many = !window.__ONEPAGE;
    const pages = many ? [await mk('page 1'), await mk('page 2')] : [await mk('page 1')];
    const id = await db.savePagesScore({
      name: 'Pen lag paper', source: 'photo', pageCount: pages.length, pages, raws: pages,
    });
    await db.saveAnnotations(id, []);
    await reader.openReader({ id, name: 'Pen lag paper', kind: 'pages', source: 'photo' });
    await new Promise((r) => setTimeout(r, 4000));
  });
  await wait(800);

  // ZOOMED IN BY A REAL PINCH, because nothing else gets there.
  //
  // Two earlier versions used the reader's own "Bigger" menu row. That calls
  // `resize`, which changes the READING size — how much music is laid out on a
  // screenful — and never touches the pinch zoom. So both runs reported zoom 1
  // while believing they had magnified the page, and measured the cheap case as
  // though it were the expensive one. Only a two-finger spread gets there.
  const cx = size.width / 2;
  const cy = size.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx - 60, y: cy, id: 1 }, { x: cx + 60, y: cy, id: 2 }],
  });
  for (let i = 1; i <= 8; i += 1) {
    const d = 60 + i * 26;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
    });
    await wait(45);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(800);
  const zoomed = await page.evaluate(async () => {
    const { readerState } = await import('/src/ui/reader.js');
    return readerState().zoom;
  });
  await page.evaluate(() => {
    if (!document.querySelector('#reader')?.classList.contains('drawing')) {
      document.querySelector('#reader-annotate')?.click();
    }
  });
  await wait(600);
  // TWO STROKES, because one cannot tell a cost that is paid ONCE from a cost
  // paid every time you lift the pen — and those are different bugs with
  // different fixes. A page's neighbour being decoded after the first stroke
  // settles is the first; a re-raster at every lift is the second.
  const first = await oneStroke('ballpoint');
  await wait(1500);
  const second = await oneStroke('ballpoint');
  return { ...(second ?? {}), zoomed, first };
}

console.log(`\n  the same stroke on a PHOTOGRAPHED page (${process.env.ONEPAGE ? 'ONE page' : 'two pages'})\n`);
const paper = await paperRun(!!process.env.ONEPAGE);
if (!paper || !paper.late || paper.late.length < 8) {
  console.log('  no samples on the paper page — nothing below means anything');
} else {
  const span = paper.late.at(-1)[0];
  const during = paper.late.filter(([t]) => t <= paper.lift).map(([, l]) => l);
  const after = paper.late.filter(([t]) => t > paper.lift).map(([, l]) => l);
  // A run that never magnified the page measures the cheap case and reports it
  // as the expensive one, so the zoom it actually reached is printed and judged.
  console.log(`  zoom reached: ${paper.zoomed}${paper.zoomed > 1 ? '' : '  ← NOT ZOOMED, the re-raster path was never entered'}`);
  console.log(`  during the stroke   median ${median(during).toFixed(1)}ms   worst ${Math.max(0, ...during).toFixed(0)}ms`);
  console.log(`  at the PEN LIFT     worst ${Math.max(0, ...after).toFixed(0)}ms  over ${(span / 1000).toFixed(1)}s`);
  console.log(`  ${paper.drew} points drawn`);
  // WHERE the blocks fall matters more than how big the worst one is: one at
  // the very start is the page still arriving, and one in the middle of a
  // stroke is the thing being complained about.
  const worstOf = (rows) => [...rows].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([t, l]) => `${(t / 1000).toFixed(1)}s ${l.toFixed(0)}ms`).join('   ');
  console.log(`  longest blocks, FIRST stroke:  ${worstOf(paper.first?.late ?? [])}`);
  console.log(`  longest blocks, SECOND stroke: ${worstOf(paper.late)}`);
}

console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
await browser.close();
