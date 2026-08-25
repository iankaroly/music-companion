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
// A shutter that answers within a couple of frames reads as instant; the page
// itself can take as long as it takes behind that.
check('a picture is in the strip within two frames of the shutter',
  out.appeared !== null && out.appeared < 120,
  `${out.appeared === null ? 'never' : `${Math.round(out.appeared)}ms`}`
  + ` (the finished page at ${out.settled === null ? 'never' : `${Math.round(out.settled)}ms`})`);
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
  const buttons = [...root.querySelectorAll('button')].map((b) => b.textContent.trim());
  const pic = root.querySelector('#crop-picture').getBoundingClientRect();
  return {
    open: true,
    buttons,
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
check('there are no instructions on it', editor.hint === false);
check('and the picture has most of the screen', editor.share > 0.8,
  `${Math.round((editor.share ?? 0) * 100)}% of it`);
// A page held close enough to fill the frame has its corners at 0,0 and 1,1, so
// the handles land on the edge of the picture. There has to be something left
// of them to put a finger on.
check('a handle on the picture\'s own edge is still reachable',
  editor.edgeHandle === true, `nearest handle centre ${editor.handleInset}px from the screen edge`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
