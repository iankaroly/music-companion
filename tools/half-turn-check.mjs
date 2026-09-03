// HALF-PAGE TURNS, CHECKED AS PICTURES.
//
// The claim: halfway through a turn, everything above the join is the next
// page exactly as it will look when the turn is finished, and everything below
// it is the page you were on exactly as it looked before — ink included, on
// both. Not "looks about right": the top strip of the half-turn screenshot is
// compared pixel for pixel with the same strip of the finished turn, and the
// bottom strip with the same strip of the page before it. Then back is checked
// to be "not yet" (the page comes back whole and identical), and the whole
// thing is done again on a photographed score, whose pages are canvases drawn
// on demand rather than engraved SVG.
//
//   npm run dev
//   npm run turn:half
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const OUT = process.env.OUT ?? null;   // where to write the screenshots, if wanted

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
const size = { width: 820, height: 1180 };
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const xml = (bars) => {
  const ms = [];
  for (let m = 1; m <= bars; m++) {
    let n = '';
    for (let i = 0; i < 4; i++) {
      const step = 'CDEFGAB'[(m + i) % 7];
      n += `<note><pitch><step>${step}</step><octave>3</octave></pitch>`
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

// Marks on every third bar, so every page carries ink in both of its halves.
const barMarks = (bars) => {
  const out = [];
  for (let m = 1; m <= bars; m += 3) {
    const points = [];
    for (let k = 0; k < 16; k++) points.push({ m, u: 0.5 + k * 0.3, v: -1.2 + 0.8 * Math.sin(k / 2) });
    out.push({ tool: 'pen', layer: 0, colour: '#c62828', width: 0.3, overlay: false, nib: 'ballpoint', points });
  }
  return out;
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.setItem('readerNight', 'off');
  localStorage.setItem('readerHalfTurns', 'on');
  localStorage.setItem('readerSpread', 'off');
  // The once-ever hint would sit over the foot of the first page and nowhere
  // else, and this is comparing pages.
  localStorage.setItem('readerHinted', 'yes');
});

const shot = async (name) => {
  const data = await page.screenshot({ encoding: 'base64' });
  if (OUT) (await import('node:fs')).writeFileSync(`${OUT}/half-${name}.png`, Buffer.from(data, 'base64'));
  return data;
};
// Compare two screenshots over a band of rows, inside the page itself.
const differ = (a, b, top, bottom) => page.evaluate(async ({ a, b, top, bottom }) => {
  const load = (data) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = `data:image/png;base64,${data}`;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const dpr = window.devicePixelRatio || 1;
  const w = ia.width;
  const y0 = Math.round(top * dpr);
  const rows = Math.round((bottom - top) * dpr);
  const read = (img) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = rows;
    const g = c.getContext('2d');
    g.drawImage(img, 0, y0, w, rows, 0, 0, w, rows);
    return g.getImageData(0, 0, w, rows).data;
  };
  const da = read(ia);
  const db = read(ib);
  let differing = 0;
  let inked = 0;
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] < 200 || da[i + 1] < 200 || da[i + 2] < 200) inked++;
    if (Math.abs(da[i] - db[i]) > 8 || Math.abs(da[i + 1] - db[i + 1]) > 8 || Math.abs(da[i + 2] - db[i + 2]) > 8) differing++;
  }
  return { differing, total: da.length / 4, inked };
}, { a, b, top, bottom });

const state = () => page.evaluate(async () => {
  const { readerState } = await import('/src/ui/reader.js');
  const line = document.querySelector('#reader-half-line');
  const box = line && !line.hidden ? line.getBoundingClientRect() : null;
  return { ...readerState(), line: box ? { top: box.top, bottom: box.bottom } : null,
    count: document.querySelector('#reader-count')?.textContent ?? '' };
});
const key = async (k) => { await page.keyboard.press(k); await wait(900); };
const tapAt = async (fx, fy) => {
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    const ev = (type) => new PointerEvent(type, {
      pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
    });
    target?.dispatchEvent(ev('pointerdown'));
    target?.dispatchEvent(ev('pointerup'));
  }, { x: size.width * fx, y: size.height * fy });
  await wait(900);
};

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};

async function runOn(kind, open) {
  console.log(`\n  ${kind}`);
  await open();
  await wait(1800);
  const s0 = await state();
  check('opened with more than one page', s0.pagesKnown > 1, `${s0.pagesKnown} pages`);
  check('no half turn yet', s0.line === null);
  const before = await shot(`${kind}-before`);

  // The pedal's key: the first turn is a half one.
  await key('ArrowRight');
  await wait(1200);
  const s1 = await state();
  check('the first turn is a half turn', !!s1.line, s1.line ? `join at ${Math.round(s1.line.top)}px` : 'no join drawn');
  check('the page number has not moved', s1.count === s0.count, `${s0.count} → ${s1.count}`);
  const halfway = await shot(`${kind}-halfway`);

  // A tap in the right third finishes it.
  await tapAt(0.85, 0.6);
  await wait(1200);
  const s2 = await state();
  check('the second turn finishes the page', !s2.line && s2.count !== s0.count, s2.count);
  const after = await shot(`${kind}-after`);

  if (s1.line) {
    // The join's own shadow reaches a few pixels either side of it, and a
    // few dozen pixels along the edges of engraved text round differently when
    // a page is clipped and stacked (it gets a compositing layer of its own,
    // and text is antialiased differently on one). MEASURED: 22 and 42 pixels
    // of 1.9 million on the engraved page, 0 on the photographed one. A strip
    // is "the same picture" when fewer than one pixel in twenty thousand
    // disagrees; a page drawn in the wrong place disagrees in hundreds of
    // thousands.
    const SHADOW = 6;
    const same = (d) => d.differing <= d.total / 20000;
    const top = await differ(halfway, after, 0, Math.floor(s1.line.top) - SHADOW);
    check('above the join is the next page, pixel for pixel', same(top),
      `${top.differing} of ${top.total} px differ; ${top.inked} px of ink/notes in the strip`);
    check('…and there is music in that strip', top.inked > 2000, `${top.inked} px`);
    const bottom = await differ(halfway, before, Math.ceil(s1.line.bottom) + SHADOW, size.height);
    check('below the join is the page before, pixel for pixel', same(bottom),
      `${bottom.differing} of ${bottom.total} px differ; ${bottom.inked} px of ink/notes in the strip`);
    check('…and there is music in that strip', bottom.inked > 2000, `${bottom.inked} px`);
  }

  // Back is "not yet": from a whole page, back goes to the page before; from
  // halfway, back puts the page you were on back whole.
  await key('ArrowLeft');
  const s3 = await state();
  check('back from a whole page turns back', !s3.line && s3.count === s0.count, s3.count);
  await key('ArrowRight');
  const s4 = await state();
  check('forward again is halfway again', !!s4.line);
  await key('ArrowLeft');
  await wait(600);
  const s5 = await state();
  check('back from halfway cancels the half turn', !s5.line && s5.count === s0.count, s5.count);
  const restored = await shot(`${kind}-restored`);
  const whole = await differ(restored, before, 0, size.height);
  check('the page came back exactly as it was', whole.differing === 0, `${whole.differing} px differ`);

  // Picking up the pen halfway finishes the turn rather than writing on two
  // pages at once.
  await key('ArrowRight');
  await page.evaluate(() => document.querySelector('#reader-annotate')?.click());
  await wait(600);
  const s6 = await state();
  check('picking up the pen halfway finishes the turn', !s6.line && s6.count !== s0.count, s6.count);
  await page.evaluate(() => document.querySelector('#reader-ink-bar .reader-tool[aria-label="Put the pen down"], #reader-done')?.click());
  await page.keyboard.press('Escape');
  await wait(300);
}

await runOn('engraved', () => page.evaluate(async ({ x, marks }) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('half-turn', marks);
  await openReader({ id: 'half-turn', name: 'Half turn', xml: x, kind: 'notation' });
}, { x: xml(120), marks: barMarks(120) }));

await page.evaluate(async () => { const { close } = await import('/src/ui/reader.js'); close(); });
await wait(500);

await runOn('photographed', () => page.evaluate(async () => {
  const db = await import('/src/store/db.js');
  const reader = await import('/src/ui/reader.js');
  const mk = async (label, seed) => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    for (let st = 0; st < 6; st += 1) {
      const y = 200 + st * 230;
      for (let k = 0; k < 5; k += 1) g.fillRect(150, y + k * 12, 900, 3);
      for (let d = 0; d < 26; d += 1) {
        g.beginPath();
        g.ellipse(180 + d * 34, y + 12 + ((d + seed) % 5) * 12, 9, 7, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.font = '48px sans-serif';
    g.fillText(label, 160, 140);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  };
  const pages = [await mk('page 1', 0), await mk('page 2', 2), await mk('page 3', 4)];
  const id = await db.savePagesScore({
    name: 'Half turn paper', source: 'photo', pageCount: pages.length, pages, raws: pages,
  });
  // Ink on each page, top and bottom.
  const marks = [];
  for (let p = 0; p < pages.length; p++) {
    for (const y of [0.18, 0.72]) {
      const points = [];
      for (let k = 0; k < 20; k++) points.push({ space: 'page', p, x: 0.2 + k * 0.03, y: y + 0.02 * Math.sin(k) });
      marks.push({ tool: 'pen', layer: 0, colour: '#1565c0', width: 0.35, overlay: false, nib: 'ballpoint', points });
    }
  }
  await db.saveAnnotations(id, marks);
  await reader.openReader({ id, name: 'Half turn paper', kind: 'pages', source: 'photo' });
  await new Promise((r) => setTimeout(r, 3000));
}));

console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
console.log(failed ? `\n  ${failed} CHECK(S) FAILED` : '\n  all checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
