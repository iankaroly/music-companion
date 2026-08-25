// "PAGE 1 COULD NOT BE READ" HAS TO BE TEMPORARY.
//
// "as soon as I trim something and save it, and it opens the score, it'll show
// the score for about 20 seconds. It'll then say Page 1 could not be read, and
// I have to go back to the menu and reopen the score."
//
// The card is drawn when a page will not decode. `load` in paper.js has never
// remembered that failure — the cause is a phone short of memory while it
// straightens half a dozen photographs and reads them, and the memory comes
// back — but NOTHING EVER ASKED AGAIN. A state that heals itself and is never
// re-examined is a state that does not heal, and the card sat on the music
// until the score was closed and reopened.
//
// Two things had to be true and neither was: the drawing has to SAY it drew a
// card, and something has to ask again. This checks the first directly and the
// ladder underneath it. WHAT IS NOT CHECKED HERE is the reader's own retry —
// driving the whole reader into an iOS memory refusal in a headless browser
// turned into a harness that hung rather than a measurement, and a check that
// hangs measures nothing. The reader's half is three lines above
// `cardsDrawn`/`cardsHealed` in `readerState`, and those counters are there so
// it can be watched on the device.
//
//   npm run dev            (on 5199)
//   npm run page:card
//
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// A decoder that refuses, the way iOS refuses one: by answering NOTHING rather
// than by throwing something a caller could tell apart.
await page.evaluateOnNewDocument(() => {
  window.__refuse = false;
  const realBitmap = window.createImageBitmap;
  window.createImageBitmap = function refusing(...args) {
    if (window.__refuse) return Promise.reject(new Error('out of memory'));
    return realBitmap.apply(this, args);
  };
  const RealImage = window.Image;
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  window.Image = function Refusing(...args) {
    const img = new RealImage(...args);
    Object.defineProperty(img, 'src', {
      set(v) {
        if (window.__refuse) { setTimeout(() => { img.onerror?.(new Event('error')); }, 0); return; }
        desc.set.call(img, v);
      },
      get() { return desc.get.call(img); },
      configurable: true,
    });
    return img;
  };
  window.Image.prototype = RealImage.prototype;
});

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(async () => {
  const sheet = () => {
    const c = document.createElement('canvas');
    c.width = 700; c.height = 950;
    const g = c.getContext('2d');
    g.fillStyle = '#f5f3ef'; g.fillRect(0, 0, 700, 950);
    g.fillStyle = '#111';
    for (let s = 0; s < 6; s++) for (let l = 0; l < 5; l++) g.fillRect(70, 120 + s * 130 + l * 9, 560, 2);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  };
  const file = new File([await sheet()], 'page-01.jpg', { type: 'image/jpeg' });
  const { openPaper } = await import('/src/ui/paper.js');
  const canvas = document.createElement('canvas');
  document.body.append(canvas);

  // 1. A page that decodes: no card, and nothing claims one.
  const good = await openPaper({ pages: [file] });
  await good.draw(0, canvas, 400, 540, null, { plain: true });
  const cleanCard = good.drewACard();

  // 2. The same page with every decoder refusing. Every rung of the ladder
  //    fails, and the card goes up — and the drawing SAYS SO, which is the part
  //    that did not exist.
  const bad = await openPaper({ pages: [file] });
  window.__refuse = true;
  const t0 = performance.now();
  await bad.draw(0, canvas, 400, 540, null, { plain: true });
  const refusedFor = performance.now() - t0;
  const saidCard = bad.drewACard();
  const cleared = bad.drewACard();   // reading it clears it

  // 3. …and the failure is NOT remembered: with the memory back, the very next
  //    ask gets the page, with nothing reopened and no new `openPaper`.
  window.__refuse = false;
  await bad.draw(0, canvas, 400, 540, null, { plain: true });
  const healed = !bad.drewACard();

  canvas.remove();
  return { cleanCard, saidCard, cleared, healed, refusedFor, trouble: bad.trouble() };
});

check('a page that decodes draws no card', out.cleanCard === false);
check('a page nothing can decode does, and the drawing says so', out.saidCard === true,
  `${out.trouble?.card} card(s), ${out.trouble?.soft} fell back to a spare`);
check('…and reading that clears it, so one card is reported once',
  out.cleared === false);
// The ladder is four quick tries and then one after most of a second, because
// what it is waiting for is a reading pass finishing rather than a network.
check('it waits for the memory before giving up', out.refusedFor > 900,
  `${Math.round(out.refusedFor)}ms of trying`);
check('the failure is not remembered: the next ask gets the page',
  out.healed === true);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
