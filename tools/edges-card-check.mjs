// "PAGE 1 COULD NOT BE READ", AFTER CHANGING THE EDGES OF A PAGE.
//
// "after being in a score and then clicking change edges and cropping it, it
// will say page not read and i have to reopen it."
//
// TRIMMING a page never did this and CHANGING ITS EDGES always did, and the
// difference is one line of the database. `setPageCrop` writes a rectangle and
// leaves the page's SIZE alone; `replaceOnePage` used to null it along with
// everything else measured about the old picture. paper.js decides how big to
// decode a page from exactly that number — see DECODE_MAX and `big` in `load` —
// so with no size on record it decoded the WHOLE 2600-pixel page, at the one
// moment there is least room for it: the straightened canvas and the
// twelve-megapixel photograph it was cut from are both still alive, because
// nothing zeroed them. iOS answers that with nothing, the card goes up, and
// every retry repeats the same unbounded decode — so the card cannot heal until
// the score is closed and everything is finally let go. Which is the "I have to
// reopen it".
//
// THREE THINGS ARE CHECKED, and only the second one needs a browser at all:
//
//  · the size is written down, which is what bounds the decode;
//  · with EVERY decoder refusing for twelve seconds, armed the moment the edges
//    are applied, no card ever reaches the glass — because the page was handed
//    to paper.js as a canvas on the way past (`keepSpare`), so there is a small
//    copy of it to fall back on. This is the one that fails without the fix: a
//    re-layout used to build a paper instance with an empty set of small copies
//    and nothing to stand in for a refused decode;
//  · and the page gets its layout back, so it is cut into screenfuls rather
//    than shown as one tall sheet shrunk to fit.
//
// The refusal window has to outlast the reader's own retries, which back off to
// a steady three seconds and never stop — a short refusal heals on a broken
// build and proves nothing.
//
//   npm run dev            (on 5199)
//   npm run edges:card
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const REFUSE_MS = Number(process.env.REFUSE ?? 12000);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// EVERY DECODER REFUSES, for a window the page arms itself. The same shim
// `reader:card` uses: iOS refuses by answering NOTHING rather than by throwing
// something a caller could tell apart.
await page.evaluateOnNewDocument(() => {
  window.__refuseUntil = 0;
  window.__refusals = 0;
  const realBitmap = window.createImageBitmap;
  window.createImageBitmap = function refuse(...args) {
    if (Date.now() < window.__refuseUntil) {
      window.__refusals += 1;
      return Promise.reject(new DOMException('refused', 'InvalidStateError'));
    }
    return realBitmap.apply(this, args);
  };
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return src.get.call(this); },
    set(value) {
      if (Date.now() < window.__refuseUntil) {
        window.__refusals += 1;
        setTimeout(() => this.onerror?.(new Event('error')), 0);
        return;
      }
      src.set.call(this, value);
    },
  });
});

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));

// A photographed part, with the PHOTOGRAPH kept behind each page — which is
// what "change the edges" cuts from, and what a scan actually stores.
const built = await page.evaluate(async () => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { savePagesScore } = await import('/src/store/db.js');
  const sheet = (n, wide, tall) => {
    const c = document.createElement('canvas');
    c.width = wide; c.height = tall;
    const g = c.getContext('2d');
    g.fillStyle = '#fdfbf4'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#141210';
    const staves = Math.round(tall / 240);
    for (let sys = 0; sys < staves; sys += 1) {
      const top = 190 + sys * 220;
      for (let l = 0; l < 5; l += 1) g.fillRect(150, top + l * 15, wide - 300, 3);
      for (let i = 0; i < 9; i += 1) {
        const x = 200 + i * ((wide - 420) / 9);
        const y = top + ((i + n) % 5) * 7.5 + 15;
        g.beginPath(); g.ellipse(x, y, 9, 6.5, -0.3, 0, Math.PI * 2); g.fill();
        g.fillRect(x + 8, y - 44, 3, 44);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/jpeg', 0.9));
  };
  // A page the size a phone photograph really is, so the decode this is about
  // is the decode that happens.
  const pages = await Promise.all([0, 1].map((n) => sheet(n, 2000, 2600)));
  const raws = await Promise.all([0, 1].map((n) => sheet(n, 2400, 3200)));
  return savePagesScore({
    name: 'Edges',
    source: 'images',
    pageCount: 2,
    pages: pages.map((b, i) => new File([b], `page-0${i + 1}.jpg`, { type: 'image/jpeg' })),
    raws: raws.map((b, i) => new File([b], `raw-0${i + 1}.jpg`, { type: 'image/jpeg' })),
  });
});

const out = await page.evaluate(async ({ scoreId, refuseMs }) => {
  const { openReader, readerState } = await import('/src/ui/reader.js');
  const { loadScore, loadScorePages } = await import('/src/store/db.js');
  await openReader(await loadScore(scoreId), {});
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);

  // A card on the glass, per page — read off the CANVAS rather than a counter,
  // because a counter is the thing that was wrong last time. The card is a pale
  // sheet with two lines of grey text and nothing else; a page of music carries
  // ink down most of its height.
  const carded = () => {
    const out = [];
    for (const [i, node] of [...document.querySelectorAll('#reader .osmd-page')].entries()) {
      const canvas = node.querySelector('canvas');
      if (!canvas || canvas.width < 2) continue;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      let rows = 0;
      const step = Math.max(1, Math.floor(canvas.height / 60));
      for (let y = 0; y < canvas.height; y += step) {
        const d = g.getImageData(0, y, canvas.width, 1).data;
        let dark = 0;
        for (let x = 0; x < d.length; x += 16) if (d[x] < 160) dark += 1;
        if (dark > 2) rows += 1;
      }
      if (rows > 0 && rows <= 8) out.push(i);
    }
    return out;
  };

  const click = (el) => { el?.click(); };
  const rowNamed = (selector, words) => [...document.querySelectorAll(selector)]
    .find((el) => el.textContent.trim().toLowerCase().startsWith(words));

  // THE DOOR HE USES: the ⋯ in the reader's bar, "Change the edges…", page 1,
  // and then the tick in the editor with the corners where they opened.
  click(document.querySelector('#reader-menu-btn'));
  await wait(400);
  const edges = rowNamed('.reader-menu-row', 'change the edges');
  if (!edges) return { failed: 'no “Change the edges…” row in the reader menu' };
  click(edges);
  await wait(400);
  const first = rowNamed('.pick-pop.menu .pick-row', 'page 1');
  if (!first) return { failed: 'no page row under Change the edges' };
  click(first);
  // The editor has a photograph to load before it will keep anything.
  await wait(2500);
  const keep = document.querySelector('#crop-keep');
  if (!keep || document.querySelector('#crop-stage')?.closest('[hidden]')) {
    return { failed: 'the edges editor did not open' };
  }

  // ARMED ON THE RE-LAYOUT, not on the tap.
  //
  // Between the two there is a full-size decode of the PHOTOGRAPH, which the
  // edges are cut from — refuse that and the edit never happens at all, and a
  // check measuring an edit that did not happen passes for the wrong reason
  // (it did, first time round: it read back the ORIGINAL page's size and called
  // it the new one). The window the card is drawn in is the one after: the page
  // has been written, the reader has thrown its pages away and is decoding
  // every one of them again, and the canvas it was all cut from is only just
  // released. `layOutPaper` empties `#reader-sheet`, so that is the signal.
  const before = (await loadScorePages(scoreId))?.sizes?.[0] ?? null;
  const sheetEl = document.querySelector('#reader-sheet') ?? document.querySelector('#reader');
  let armed = null;
  // …and the size is read AT that moment, not at the end.
  //
  // The reader measures its own pages and writes what it finds
  // (`rememberMeasurements`), so a size read after everything has settled is
  // there either way and proves nothing. What matters is whether the size was
  // on record for the FIRST decode after the crop, which is this instant.
  let atCrop;
  const watcher = new MutationObserver((list) => {
    if (armed !== null) return;
    if (!list.some((m) => m.removedNodes.length)) return;
    armed = Date.now();
    window.__refuseUntil = armed + refuseMs;
    atCrop = loadScorePages(scoreId).then((r) => r?.sizes?.[0] ?? null).catch(() => null);
  });
  watcher.observe(sheetEl, { childList: true });
  click(keep);
  for (let i = 0; i < 60 && armed === null; i += 1) await wait(200);
  watcher.disconnect();
  if (armed === null) return { failed: 'the reader never re-laid the score out after the crop' };

  const trail = [];
  for (let i = 0; i < 80; i += 1) {
    await wait(500);
    trail.push({
      at: Math.round((Date.now() - armed) / 100) / 10,
      refusing: Date.now() < window.__refuseUntil,
      cards: carded(),
      ...readerState(),
    });
    if (Date.now() > armed + refuseMs + 10000) break;
  }
  const row = await loadScorePages(scoreId);
  return {
    refusals: window.__refusals,
    before,
    atCrop: await atCrop,
    // The size of the page that was just written — what bounds every decode of
    // it from here on.
    size: row?.sizes?.[0] ?? null,
    layout: !!row?.layout?.[0],
    everCarded: trail.some((t) => t.cards.length > 0),
    whileRefusing: trail.filter((t) => t.refusing).some((t) => t.cards.length > 0),
    stillCarded: trail.at(-1)?.cards ?? [],
    cardsDrawn: trail.at(-1)?.cardsDrawn,
    ranFor: Math.round((Date.now() - armed) / 100) / 10,
  };
}, { scoreId: built, refuseMs: REFUSE_MS });

if (out.failed) {
  check('the edges editor opens from the reader', false, out.failed);
} else {
  check('the page really was replaced by the crop',
    !!(out.size && out.before && (out.size.w !== out.before.w || out.size.h !== out.before.h)),
    `${out.before ? `${out.before.w}x${out.before.h}` : 'unmeasured'}`
    + ` → ${out.size ? `${out.size.w}x${out.size.h}` : 'nothing'}`);
  check('changing the edges of a page records how big the new page is, at once',
    !!(out.atCrop?.w > 0 && out.atCrop?.h > 0),
    out.atCrop
      ? `${out.atCrop.w}x${out.atCrop.h} on record before the first decode of it`
      : 'no size on record — the first decode of the new page is an unbounded one');
  check('the refusal window actually refused decodes',
    out.refusals > 0, `${out.refusals} refused over ${out.ranFor}s`);
  // THE ASSERTION. Everything above is the setup that makes this mean something.
  check('and no card is ever drawn over the page that was just cropped',
    out.everCarded === false,
    out.everCarded
      ? `carded ${out.whileRefusing ? 'while decodes were refused' : 'after the refusal lifted'},`
        + ` ${out.cardsDrawn} drawn, still carded: ${out.stillCarded.length ? out.stillCarded.map((i) => i + 1).join(', ') : 'none'}`
      : `${out.cardsDrawn ?? 0} cards drawn over ${out.ranFor}s`);
  check('the page is read again, so it can still be cut into screenfuls',
    out.layout === true,
    out.layout ? 'the page has a layout' : 'no layout — it is one tall sheet shrunk to fit');
}

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
