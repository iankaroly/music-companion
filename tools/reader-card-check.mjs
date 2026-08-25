// A CARD IS A PAGE THAT HAS NOT ARRIVED YET, AND IT HAS TO GO AWAY.
//
// "it still says page 1 not read after i scan and open a score about 20 seconds
// after."
//
// WHY TWENTY SECONDS, which is the part nobody had found. It is not the reading
// pass being slow. When that pass finishes it stores what it measured, and
// storing triggers a RE-LAYOUT — `relayoutSameScore` → `layOutPaper` — which
// destroys the paper instance and builds a new one with an empty decode cache
// and an empty set of small copies, then decodes every visible page again from
// nothing. Measured at 16.8–20.3s after opening a four-page part. Before that
// moment a card is impossible: the first decode is cached and the small copies
// stand in. After it, every page is decoded afresh with nothing to fall back
// on, at the exact moment the reading pass has finished eating the memory.
//
// TWO FAULTS KEPT IT ON THE GLASS, and this refuses both.
//
//  · `drewCard` was ONE boolean for the whole score, drained by whichever
//    caller asked first. Two pages drawing at once — a turn and the look-ahead
//    behind it — and the second was told it had drawn no card, so it was never
//    asked again. Measured: four cards drawn, the flag true for the first page
//    and false for the second.
//  · The retry was bounded at three, at 0.9s / 1.8s / 2.7s, so it gave up 5.4s
//    after the first card. The memory pressure lasts longer than that.
//
// So this refuses decodes for LONGER THAN THE OLD RETRY — twelve seconds, armed
// on the re-layout itself — and then asserts the card is gone. A three-second
// refusal heals even on the broken build and proves nothing; the window has to
// outlast 5.4s of retries.
//
//   npm run dev             (on 5199)
//   npm run reader:card
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
// A phone, roughly. The window this opens is a real one on his device and a
// narrow one here.
await page.emulateCPUThrottling(4);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// EVERY DECODER REFUSES, for a window armed by the re-layout — which is the
// moment the fault actually happens, and the only moment a card is possible.
// Installed before a line of the app runs.
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
  // `readableImage` goes through an <img>, so that has to refuse too. The src
  // setter is captured OUTSIDE the constructor: a previous round found that
  // patching it inside never fired and the shim silently refused nothing.
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

// A part of four photographed pages with NO stored layout — which is what a
// part that has just been scanned is, and the only kind that gets a re-layout.
const built = await page.evaluate(async () => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  const { savePagesScore } = await import('/src/store/db.js');
  const sheet = (n) => {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 1900;
    const g = c.getContext('2d');
    g.fillStyle = '#fdfbf4'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#141210';
    for (let sys = 0; sys < 8; sys += 1) {
      const top = 190 + sys * 200;
      for (let l = 0; l < 5; l += 1) g.fillRect(150, top + l * 15, 1080, 3);
      for (let i = 0; i < 9; i += 1) {
        const x = 200 + i * 115;
        const y = top + ((i + n) % 5) * 7.5 + 15;
        g.beginPath(); g.ellipse(x, y, 9, 6.5, -0.3, 0, Math.PI * 2); g.fill();
        g.fillRect(x + 8, y - 44, 3, 44);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/jpeg', 0.9));
  };
  const pages = await Promise.all([0, 1, 2, 3].map(sheet));
  return savePagesScore({
    name: 'Just scanned', source: 'images', pageCount: 4,
    pages: pages.map((b, i) => new File([b], `page-0${i + 1}.jpg`, { type: 'image/jpeg' })),
  });
});

// THE CARD, WATCHED. `missingPage` writes "could not be read" on its canvas, so
// what is on the glass is found by reading the pixels rather than by trusting a
// counter — a counter is the thing that was wrong.
const watched = await page.evaluate(async ({ scoreId, refuseMs }) => {
  const { openReader, readerState } = await import('/src/ui/reader.js');
  const { loadScore } = await import('/src/store/db.js');
  await openReader(await loadScore(scoreId), {});

  // Armed on the RE-LAYOUT — the reader rebuilding its pages, which is what
  // `relayoutSameScore` does when the reading pass stores what it measured.
  const sheetEl = document.querySelector('#reader-sheet') ?? document.querySelector('#reader');
  let armedAt = null;
  const watcher = new MutationObserver((list) => {
    if (armedAt !== null) return;
    if (!list.some((m) => m.removedNodes.length)) return;
    armedAt = Date.now();
    window.__refuseUntil = armedAt + refuseMs;
  });
  watcher.observe(sheetEl, { childList: true });

  // A card on the glass, per page: the canvas each page was drawn on carries
  // the words when it is a card.
  const carded = () => {
    const out = [];
    for (const [i, node] of [...document.querySelectorAll('#reader .osmd-page')].entries()) {
      const canvas = node.querySelector('canvas');
      if (!canvas || canvas.width < 2) continue;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      // The card is a pale sheet with two lines of grey text and nothing else.
      // A page of music has ink over most of its height; a card has it in one
      // band across the middle. Counting rows that carry any dark pixel tells
      // them apart without reading the words.
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

  const trail = [];
  const began = Date.now();
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const now = Date.now();
    trail.push({
      at: Math.round((now - began) / 100) / 10,
      refusing: now < window.__refuseUntil,
      cards: carded(),
      ...readerState(),
    });
    // Long enough past the refusal for any retry to have run.
    if (armedAt && now > armedAt + refuseMs + 12000) break;
  }
  watcher.disconnect();
  const last = trail.at(-1) ?? {};
  return {
    relayoutAt: armedAt ? Math.round((armedAt - began) / 100) / 10 : null,
    refusals: window.__refusals,
    everCarded: trail.some((t) => t.cards.length > 0),
    mostAtOnce: Math.max(0, ...trail.map((t) => t.cards.length)),
    stillCarded: last.cards ?? [],
    cardsDrawn: last.cardsDrawn,
    cardsHealed: last.cardsHealed,
    ranFor: Math.round((Date.now() - began) / 100) / 10,
  };
}, { scoreId: built, refuseMs: REFUSE_MS });

check('the reading pass re-lays the score out, which is where the card comes from',
  watched.relayoutAt !== null,
  watched.relayoutAt === null ? 'no re-layout seen' : `${watched.relayoutAt}s after opening`);
check('refusing every decode across it does put cards up',
  watched.everCarded === true,
  `${watched.refusals} decodes refused, ${watched.mostAtOnce} pages carded at once,`
  + ` ${watched.cardsDrawn} drawn`);
// THE ASSERTION. Everything above is the setup that makes this one mean
// something: a card that was never drawn cannot prove it goes away.
check('and every one of them is gone once the decodes work again',
  watched.everCarded === true && watched.stillCarded.length === 0,
  watched.stillCarded.length
    ? `still carded after ${watched.ranFor}s: pages ${watched.stillCarded.map((i) => i + 1).join(', ')}`
    : `all healed — ${watched.cardsDrawn} drawn, ${watched.cardsHealed} healed,`
      + ` over ${watched.ranFor}s`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
