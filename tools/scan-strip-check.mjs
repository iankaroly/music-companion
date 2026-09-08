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
// PAST THE FIRST RUN BEFORE A SINGLE POINT IS HIT-TESTED. "Start playing" is
// the welcome screen's button and it does two things: it settles the
// instrument, and on an install that has never seen it, it starts the TOUR.
// `#tour` is fixed, inset 0, z-index 100, pointer-events auto, so while it is
// up every `elementFromPoint` on the page answers the tour and not the strip —
// which is how the two hit tests below came to read a bare "DIV" on a build
// where the strip was perfect. A player never opens the scanner mid-tour: the
// tour is modal by design and `app:tour` holds it to that. So the state this
// check wants is the state AFTER the tour, and the honest way to ask for it is
// the flag ui/tour.js itself writes when the tour ends, set before a line of
// the app runs.
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('tourSeen', '1'); } catch { /* an opaque origin; survivable */ }
});
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
  // WHAT IS UNDER A POINT, NAMED SO THE FAILURE DIAGNOSES ITSELF. The class on
  // its own answered "DIV" for a full-screen overlay with no class — true, and
  // no help whatever: the id is the half that says WHICH div it was.
  const named = (at) => {
    if (!at) return null;
    const cls = typeof at.className === 'string' ? at.className.trim() : '';
    if (cls) return cls;
    return at.id ? `${at.tagName}#${at.id}` : at.tagName;
  };
  const hit = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return named(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
  };
  // The middle of the PICTURE — the place a finger goes, and the place that did
  // nothing at all before.
  const middleOfPicture = (() => {
    if (!img) return null;
    const b = img.getBoundingClientRect();
    const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return at === openBtn ? 'the edges button' : (named(at) ?? 'nothing');
  })();
  return {
    opened: true,
    // ASKED WHERE IT MATTERS, not at the end of the setup. The tour is started
    // a frame or two after "Start playing", by which time a check that asked
    // immediately has already been told there is no tour; what decides every
    // hit test below is what is on the page NOW, with the scanner open.
    firstRunLeft: [...document.querySelectorAll('#tour, #welcome')].map((el) => `#${el.id}`),
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
// SAID OUT LOUD, because the setup above is load-bearing and fails silently.
// A first-run screen left over the app does not break the strip, it breaks
// every MEASUREMENT of the strip — the two hit tests below sat red on a build
// where the strip was perfect, and said only "DIV". One line, named, so the
// next thing to cover the scanner is read off the check rather than inferred
// from a hit test three lines later.
check('and nothing from the first run is left over it',
  Array.isArray(out.firstRunLeft) && out.firstRunLeft.length === 0,
  out.firstRunLeft?.length ? `still on the page: ${out.firstRunLeft.join(', ')}` : 'the app is on top');
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

// --- AND A PAGE THROWN AWAY RENAMES THE ONES AFTER IT ----------------------
//
// A thumbnail says which page it is THREE times: the number printed on it, the
// ✕'s aria-label and the picture's aria-label. `renumber` rewrote only the
// first, so after throwing away page 2 of four the badges read 1, 2, 3 while
// the labels still said page 1, page 3, page 4 — and the number is not
// aria-hidden, so a screen reader read the contradiction in one breath.
// Somebody pressing the thumbnail announced as "Throw away page 3" threw away
// the one everyone else could see as page 2.
//
// THREE ASSERTIONS, because any one of them alone passes a wrong fix. Agreement
// alone passes if every slot agrees on the same wrong number; the sequence
// alone passes if the labels are right and the ✕ now deletes by position; and
// the pages themselves are what a name is a name OF, so the surviving pictures
// are checked by identity. The delete was never the broken half — `dropButton`
// closes over the File — and this is what stops a later fix from making it
// index-based to match the labels.
//
// It runs LAST and reaches four pages from where the check already is: the
// timing measurement above is about the first press, and everything between
// here and it works `.scan-thumb` (the first slot), which by now has had its
// edges changed twice. So this covers `reshape`'s naming path for free.
const naming = await page.evaluate(async () => {
  const settled = () => document.querySelectorAll('.scan-thumb:not(.pending)').length;
  const shutter = document.querySelector('#scan-shutter');
  if (!shutter) return { took: 0 };
  // Waited on the strip rather than on a delay: a shot takes as long as the
  // machine takes.
  for (let want = settled() + 1; want <= 4; want += 1) {
    shutter.click();
    for (let i = 0; i < 300 && settled() < want; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const digitsIn = (text) => (text ?? '').match(/\d+/)?.[0] ?? null;
  const read = () => [...document.querySelectorAll('.scan-thumb')].map((slot) => ({
    num: digitsIn(slot.querySelector('.scan-number')?.textContent),
    drop: digitsIn(slot.querySelector('.scan-drop')?.getAttribute('aria-label')),
    open: digitsIn(slot.querySelector('.scan-open')?.getAttribute('aria-label')),
    dropSays: slot.querySelector('.scan-drop')?.getAttribute('aria-label') ?? null,
    src: slot.querySelector('img')?.src ?? null,
  }));
  const before = read();
  const doneBefore = document.querySelector('#scan-done')?.textContent?.trim();
  // The SECOND one, pressed on the ✕ it really carries.
  document.querySelectorAll('.scan-thumb')[1]?.querySelector('.scan-drop')?.click();
  await new Promise((r) => setTimeout(r, 200));
  const after = read();
  // AND THE EDGES CHANGED ON A PAGE THAT HAS MOVED. `reshape` names its slot
  // from `pages.indexOf(file)`, which is the only place in the file where the
  // number comes from somewhere other than the slot's position in the strip —
  // and it is the one path the section above cannot see, because the page whose
  // edges were changed up there never moved. So it is done again here, on the
  // slot that used to be page 3 and is now page 2. The rebuilt ✕ and picture
  // must come back named 2, not 3: this is the same rebuild whose own comment
  // records the button that was missed last time.
  const moved = document.querySelectorAll('.scan-thumb')[1];
  const wasSrc = moved?.querySelector('img')?.src;
  moved?.querySelector('.scan-open')?.click();
  for (let i = 0; i < 60 && document.querySelector('#crop')?.hidden !== false; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('#crop-keep')?.click();
  for (let i = 0; i < 150; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (moved?.querySelector('img')?.src !== wasSrc) break;
  }
  await new Promise((r) => setTimeout(r, 250));
  const reshaped = read();
  return {
    took: before.length,
    before,
    after,
    reshaped,
    reshapedIt: moved?.querySelector('img')?.src !== wasSrc,
    doneBefore,
    doneAfter: document.querySelector('#scan-done')?.textContent?.trim(),
    // The pictures that should have survived, by identity: 1, 3 and 4.
    wanted: [before[0]?.src, before[2]?.src, before[3]?.src],
  };
});
const agree = (rows) => (rows ?? []).every((r) => r.num !== null
  && r.num === r.drop && r.num === r.open);
// READ OFF THE LABELS, not off the badge: with the bug in, the badges renumber
// and only the spoken names lag, so a sequence assertion made against
// `.scan-number` passes on the broken build.
const spokenInOrder = (rows) => (rows ?? []).every((r, i) => r.drop === String(i + 1)
  && r.open === String(i + 1));
check('four pages went into the strip', naming.took === 4, `${naming.took} in it`);
check('every thumbnail agrees with itself about which page it is',
  naming.took === 4 && agree(naming.before) && agree(naming.after),
  (naming.after ?? []).map((r) => `${r.num}/${r.drop}/${r.open}`).join(' '));
check('…and after one is thrown away they are still 1, 2, 3 out loud',
  naming.after?.length === 3 && spokenInOrder(naming.after),
  (naming.after ?? []).map((r) => r.dropSays).join(' · '));
check('and the page thrown away is the one that was named',
  naming.after?.length === 3
  && naming.after.every((r, i) => r.src && r.src === naming.wanted[i]),
  naming.after?.length === 3 && naming.after.every((r, i) => r.src === naming.wanted[i])
    ? 'pages 1, 3 and 4 are what is left'
    : 'the wrong picture went');
check('and the count says so too', naming.doneAfter === 'Done · 3 pages',
  `${naming.doneBefore} \u2192 ${naming.doneAfter}`);
check('changing the edges of a page that has MOVED keeps its new name',
  naming.reshapedIt === true && agree(naming.reshaped) && spokenInOrder(naming.reshaped),
  naming.reshapedIt
    ? (naming.reshaped ?? []).map((r) => `${r.num}/${r.drop}/${r.open}`).join(' ')
    : 'the page was never re-cut, so this proves nothing');

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
