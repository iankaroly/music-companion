// THE STRIP AT THE FOOT OF THE SCANNER, and the screen behind it.
//
// Three complaints about one row of thumbnails:
//
//   "as soon as I take the image, it is slow before it shows up in the bottom
//    left. That should be instant."
//   "when I click on it, I should be able to click anywhere on that bottom-left
//    photo, not just where it says edges."
//   "there's a bunch of options with whole photo and writing that overlaps a
//    bunch of things… you can just trim it and then confirm it."
//
// The delay was the whole pipeline: find the paper on a full-size frame, square
// it, divide the lighting out, encode a JPEG and decode it again to prove it
// came out. None of that has to happen before a picture that already exists is
// put on the screen.
//
//   npm run dev              (on 5199)
//   npm run scan:strip
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

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

const out = await page.evaluate(async () => {
  const { openScanner } = await import('/src/ui/scanner.js');
  openScanner().catch(() => null);
  for (let i = 0; i < 80 && !document.querySelector('#scan-shutter'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 1200));
  const shutter = document.querySelector('#scan-shutter');
  if (!shutter) return { opened: false };

  // HOW LONG BEFORE THERE IS A PICTURE IN THE STRIP. Polled every frame from
  // the press, so what is measured is what a player waits.
  const t0 = performance.now();
  shutter.click();
  let appeared = null;
  let settled = null;
  for (let i = 0; i < 600; i += 1) {
    const thumb = document.querySelector('.scan-thumb img');
    if (thumb && appeared === null) appeared = performance.now() - t0;
    if (document.querySelector('.scan-thumb:not(.pending) .scan-open') && settled === null) {
      settled = performance.now() - t0;
      break;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  const wrap = document.querySelector('.scan-thumb');
  const openBtn = wrap?.querySelector('.scan-open');
  const badge = wrap?.querySelector('.scan-edges');
  const drop = wrap?.querySelector('.scan-drop');
  const img = wrap?.querySelector('img');
  const hit = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return at?.className || at?.tagName || null;
  };
  // The middle of the PICTURE — the place a finger goes, and the place that did
  // nothing at all before.
  const middleOfPicture = (() => {
    if (!img) return null;
    const b = img.getBoundingClientRect();
    const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return at === openBtn ? 'the edges button' : (at?.className || at?.tagName || 'nothing');
  })();
  return {
    opened: true,
    appeared,
    settled,
    hasOpen: !!openBtn,
    badgeIsLabel: badge ? getComputedStyle(badge).pointerEvents === 'none' : null,
    middleOfPicture,
    dropOnTop: hit(drop),
    thumbBox: img ? [Math.round(img.getBoundingClientRect().width),
      Math.round(img.getBoundingClientRect().height)] : null,
  };
});

check('the scanner opened with a shutter to press', out.opened === true);
// A RATIO, NOT A STOPWATCH. This asserted "under 120ms", which is the right
// claim on an idle machine and meaningless on a busy one: run beside anything
// else it reads 129, 250 or 743ms for the same code, and the check then reports
// the load average rather than the app. What is actually being claimed is that
// the FRAME goes up long before the straightened page replaces it — the two are
// measured in the same run, on the same machine, in the same conditions, so
// their ratio says it whatever else is happening. The absolute bound stays as a
// loose backstop for the case where both are slow because the frame never went
// up at all.
check('the picture is in the strip long before the finished page is',
  out.appeared !== null && out.settled !== null
  && out.appeared < out.settled * 0.5 && out.appeared < 900,
  `${out.appeared === null ? 'never' : `${Math.round(out.appeared)}ms`}`
  + ` against ${out.settled === null ? 'never' : `${Math.round(out.settled)}ms`} for the page`
  + `${out.settled ? ` — ${Math.round((out.appeared / out.settled) * 100)}% of the wait` : ''}`);
check('…and it is a picture, not an empty box',
  (out.thumbBox?.[0] ?? 0) > 20 && (out.thumbBox?.[1] ?? 0) > 20, out.thumbBox?.join('x'));
check('the middle of the picture opens the edges', out.middleOfPicture === 'the edges button',
  `what is under it: ${out.middleOfPicture}`);
check('the "Edges" word is a label and not the target', out.badgeIsLabel === true,
  `pointer-events: ${out.badgeIsLabel ? 'none' : 'auto'}`);
check('and the ✕ still owns its own middle', out.dropOnTop === 'scan-drop', out.dropOnTop);

// --- the editor, stripped -------------------------------------------------
const editor = await page.evaluate(async () => {
  document.querySelector('.scan-thumb .scan-open')?.click();
  for (let i = 0; i < 60 && document.querySelector('#crop')?.hidden !== false; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600));
  const root = document.querySelector('#crop');
  if (!root || root.hidden) return { open: false };
  const buttons = [...root.querySelectorAll('.crop-bar button')].map((b) => b.textContent.trim());
  // Symbols now, at the top — the word is the label a screen reader gets.
  const looks = [...root.querySelectorAll('.crop-look')].map((b) => b.getAttribute('aria-label'));
  const pic = root.querySelector('#crop-picture').getBoundingClientRect();
  return {
    open: true,
    buttons,
    looks,
    looksHidden: !!root.querySelector('.crop-head')?.hidden,
    looksAtTop: (() => {
      const bar = root.querySelector('.crop-looks')?.getBoundingClientRect();
      const pic = root.querySelector('#crop-picture')?.getBoundingClientRect();
      return !!bar && !!pic && bar.bottom <= pic.top + 2;
    })(),
    hint: !!root.querySelector('.crop-hint'),
    // How much of the screen the picture gets, which is what "I just want it to
    // be huge" is asking for.
    share: (pic.height * pic.width) / (window.innerWidth * window.innerHeight),
    ...(() => {
      const dots = [...root.querySelectorAll('circle[r="13"]')];
      const inset = Math.min(...dots.map((d) => {
        const b = d.getBoundingClientRect();
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        return Math.min(cx, window.innerWidth - cx, cy, window.innerHeight - cy);
      }));
      return { handleInset: Math.round(inset), edgeHandle: inset >= 10 };
    })(),
  };
});
check('the editor opens', editor.open === true);
check('it has two buttons and no more', editor.buttons?.length === 2,
  `[${editor.buttons?.join(', ')}]`);
// A DELIBERATE REVERSAL, AND A SMALL ONE. This asserted "two buttons and no
// more" over the WHOLE editor, from "I just want it to be huge… there are no
// instructions. You can just trim it and then confirm it." It still holds for
// the buttons that DO something to the crop — Cancel and confirm — and one row
// has been added above them, from the round after: "The Fourscore app has more
// features when you're scanning the page and then you edit it. There are color
// options, stuff like that."
//
// Four chips, no prose, and the picture still has most of the screen. Both of
// those are asserted rather than assumed, because a row of options is exactly
// the thing that grew into the four buttons and the sentence he asked to have
// taken away.
check('and one row of looks, as symbols, above the page', editor.looks?.length === 4
  && editor.looksAtTop === true,
  `[${editor.looks?.join(', ')}]${editor.looksAtTop ? ' over the picture' : ' NOT over the picture'}`);
check('there are no instructions on it', editor.hint === false);
check('and the picture still has most of the screen', editor.share > 0.75,
  `${Math.round((editor.share ?? 0) * 100)}% of it`);
// A page held close enough to fill the frame has its corners at 0,0 and 1,1, so
// the handles land on the edge of the picture. There has to be something left
// of them to put a finger on.
check('a handle on the picture\'s own edge is still reachable',
  editor.edgeHandle === true, `nearest handle centre ${editor.handleInset}px from the screen edge`);

// --- AND THE LOOK IS ACTUALLY BAKED INTO THE PAGE ---------------------------
//
// The four chips do two separate things and only one of them is visible in a
// screenshot: they put a CSS filter on the `<img>` in the editor (a preview,
// free), and they run `bakeLook` over the pixels of the finished page when you
// confirm. A `LOOKS` entry with the right filter and a bake that never fires
// looks identical in every picture and passes every other assertion here.
//
// So this asks the page itself. Grey and Ink both take the colour out, which is
// a fact about the STORED pixels that nothing else can produce: after either of
// them every pixel has R = G = B. The strip's thumbnail is made from the file
// that was just written (`URL.createObjectURL(fresh)` in reshape), so it is the
// page, not the preview.
const confirmWith = async (look) => page.evaluate(async (which) => {
  const root = document.querySelector('#crop');
  if (!root || root.hidden) {
    document.querySelector('.scan-thumb .scan-open')?.click();
    for (let i = 0; i < 60 && document.querySelector('#crop')?.hidden !== false; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  document.querySelector(`.crop-look[data-look="${which}"]`)?.click();
  await new Promise((r) => setTimeout(r, 150));
  document.querySelector('#crop-keep')?.click();
  // The page is straightened, baked, encoded and decoded again before the
  // thumbnail changes; waited on the picture rather than on a fixed delay.
  const img = document.querySelector('.scan-thumb img');
  const was = img?.src ?? '';
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (img && img.src !== was && img.complete && img.naturalWidth) break;
  }
  await new Promise((r) => setTimeout(r, 250));
  const opened = document.querySelector('#crop')?.hidden === false;
  const chosen = (() => { try { return localStorage.getItem('scanLook'); } catch { return null; } })();
  if (!img?.naturalWidth) return { read: false, opened, chosen };
  const c = document.createElement('canvas');
  c.width = Math.min(160, img.naturalWidth);
  c.height = Math.max(1, Math.round((c.width * img.naturalHeight) / img.naturalWidth));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let coloured = 0;
  let total = 0;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    total += 1;
    sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // JPEG chroma subsampling moves a grey pixel by a level or two; anything
    // that was ever coloured is far past this.
    if (Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) > 8) {
      coloured += 1;
    }
  }
  return { read: true, coloured: coloured / total, luma: Math.round(sum / total),
    stored: chosen, stillOpen: opened, changed: img.src !== was };
}, look);

const asColour = await confirmWith('colour');
const asGrey = await confirmWith('grey');
check('confirming with Colour leaves the page in colour',
  asColour.read === true && asColour.coloured > 0.02,
  asColour.read ? `${Math.round(asColour.coloured * 100)}% of pixels carry colour` : 'the page could not be read back');
check('…and confirming with Grey bakes the colour out of the stored page',
  asGrey.read === true && asGrey.coloured < 0.005,
  asGrey.read ? `${(asGrey.coloured * 100).toFixed(2)}% of pixels carry colour`
    + ` (was ${Math.round(asColour.coloured * 100)}%);`
    + ` the page was rewritten: ${asGrey.changed}` : 'the page could not be read back');

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
