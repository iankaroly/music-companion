// A PART OF SEVERAL PAGES, ONE PAGE AT A TIME — and the sound carrying on.
//
// The review used to lay every page it had out down the screen, so looking at
// the second page of a part was a scroll and looking at the tenth was a scroll
// nobody finished. It shows one page now, with an arrow either side.
//
// What is checked is the two halves of that:
//
//   THE TURN. One page visible, the arrows move it, they stop at the ends, and
//   the count says where you are.
//
//   AND THAT NOTHING IS TORN DOWN TO DO IT — which is what "move to another
//   page without the sound stopping" reduces to. A turn touches one attribute
//   on two elements: the very same page elements, canvases and bar boxes are
//   still there afterwards (checked by identity, not by count), the follower
//   another module hung on the playback was never unsubscribed, the take was
//   never asked to play again by the turn itself, and the light still moves
//   when the next moment arrives. A review that rebuilt its pages on a turn
//   would take the audio down with it, because `destroy` is what stops it.
//
// No camera, no microphone: the pages are drawn here and the take player is
// stubbed.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:pager
//
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-pager')));
const APP = flag('app', 'http://localhost:5199');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1300 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async () => {
  const { showScanScore } = await import('/src/ui/scan-view.js');
  const { attachBarSync } = await import('/src/ui/bar-sync.js');

  // Three pages of music, each with its own number written on it so a picture
  // of this says which page is being looked at.
  const sheet = async (number) => {
    const canvas = document.createElement('canvas');
    canvas.width = 620;
    canvas.height = 840;
    const g = canvas.getContext('2d');
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#15130f';
    for (let system = 0; system < 4; system += 1) {
      const top = 120 + system * 180;
      for (let line = 0; line < 5; line += 1) {
        g.fillRect(60, top + line * 12, 500, 2);
      }
    }
    g.font = 'bold 64px system-ui';
    g.fillText(String(number), 275, 800);
    return new Promise((done) => canvas.toBlob(done, 'image/png'));
  };
  const blobs = await Promise.all([sheet(1), sheet(2), sheet(3)]);

  const stave = (top) => ({
    top,
    bottom: top + 0.14,
    space: 0.014,
    bars: [0.4, 0.7],
    heads: [{ x: 0.15, y: top + 0.07, space: 0.014, step: 0 },
      { x: 0.5, y: top + 0.07, space: 0.014, step: 1 },
      { x: 0.85, y: top + 0.07, space: 0.014, step: 2 }],
  });
  const onePage = () => ({ staves: [stave(0.13), stave(0.35), stave(0.56), stave(0.78)] });
  const layout = [onePage(), onePage(), onePage()];

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:420px;z-index:99999;'
    + 'background:#fff;padding:10px;';
  document.body.append(host);

  const view = await showScanScore(host, {
    payload: { pages: blobs },
    layout,
    notes: [],
  });

  const holders = () => [...host.querySelectorAll('.scan-page')];
  const visible = () => holders().filter((h) => !h.hidden).length;
  const pagerButtons = [...host.querySelectorAll('.scan-turn')];
  const counter = () => host.querySelector('.scan-pager-at')?.textContent ?? '';
  const [back, forward] = pagerButtons;

  // Stamp every page element and canvas, so "the same one" can be told from
  // "another one that looks like it" after a turn.
  holders().forEach((holder, i) => {
    holder.dataset.stamp = `page-${i}`;
    holder.querySelector('canvas').dataset.stamp = `canvas-${i}`;
  });

  // The bar layer, over the pages the review just drew — which is what the app
  // does — with the take player and the follower stubbed.
  const asked = [];
  let tell = null;
  let subscribed = 0;
  let dropped = 0;
  const sync = attachBarSync(host, {
    layout,
    play: (seconds) => { asked.push(seconds); return true; },
    follow: (fn) => {
      subscribed += 1;
      tell = fn;
      return () => { dropped += 1; tell = null; };
    },
  });
  const boxes = () => [...host.querySelectorAll('.scan-bar')];
  const boxCount = boxes().length;
  boxes().forEach((box, i) => { box.dataset.stamp = `bar-${i}`; });

  // Two marks, so the map answers: bar 0 at 2s, and a bar on the last page at
  // 60s. Marking uses the moment being HEARD, so the follower is told first.
  tell(null, 2);
  boxes()[0].click();
  const onLastPage = boxes().findIndex((b) => b.closest('.scan-page').dataset.page === '2');
  tell(null, 60);
  boxes()[onLastPage].click();

  // --- the state before any turn -------------------------------------------
  const first = {
    count: view.pageCount,
    visible: visible(),
    at: view.page,
    counter: counter(),
    backOff: back.disabled,
    forwardOff: forward.disabled,
    shownPage: holders().find((h) => !h.hidden)?.dataset.page ?? null,
  };

  // --- press a bar on this page, then turn -------------------------------
  asked.length = 0;
  boxes()[1].click();
  const playedBeforeTurn = asked.length;

  forward.click();
  await new Promise((r) => setTimeout(r, 120));
  const askedByTheTurn = asked.length - playedBeforeTurn;

  const second = {
    visible: visible(),
    at: view.page,
    counter: counter(),
    shownPage: holders().find((h) => !h.hidden)?.dataset.page ?? null,
    // The SAME elements, not new ones that look the same.
    sameHolders: holders().every((h, i) => h.dataset.stamp === `page-${i}`),
    sameCanvases: holders().every((h, i) => h.querySelector('canvas')?.dataset.stamp === `canvas-${i}`),
    sameBoxes: boxes().length === boxCount
      && boxes().every((b, i) => b.dataset.stamp === `bar-${i}`),
    subscribed,
    dropped,
  };

  // The light still follows after the turn, on a bar of the page now shown.
  tell?.(null, 61);
  const litAfterTurn = boxes().findIndex((b) => b.classList.contains('sounding'));
  const litOnPage = litAfterTurn >= 0
    ? boxes()[litAfterTurn].closest('.scan-page').dataset.page
    : null;

  // …and a bar on the page turned TO still asks for its own moment.
  asked.length = 0;
  const here = boxes().findIndex((b) => b.closest('.scan-page').dataset.page === '1'
    && !b.closest('.scan-page').hidden);
  boxes()[here]?.click();
  const askedHere = asked.at(-1) ?? null;

  forward.click();
  await new Promise((r) => setTimeout(r, 120));
  const atEnd = {
    at: view.page,
    counter: counter(),
    forwardOff: forward.disabled,
    backOff: back.disabled,
  };
  // Past the end goes nowhere.
  forward.click();
  const heldAtEnd = view.page;

  back.click();
  back.click();
  await new Promise((r) => setTimeout(r, 120));
  const atStart = { at: view.page, backOff: back.disabled };

  // Leave it on the middle page for the picture.
  forward.click();
  await new Promise((r) => setTimeout(r, 200));
  const shot = host.getBoundingClientRect();
  return {
    built: true,
    first,
    second,
    playedBeforeTurn,
    askedByTheTurn,
    litOnPage,
    askedHere,
    atEnd,
    heldAtEnd,
    atStart,
    boxCount,
    where: { x: shot.x, y: shot.y, width: shot.width, height: shot.height },
    sync: !!sync,
  };
});

if (report.built) {
  await page.screenshot({ path: path.join(OUT, 'pager.png'), clip: report.where });
}
await browser.close();

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('a scan of three pages, in the review\n');
check('all three pages are laid out', report.first.count === 3, `${report.first.count}`);
check('one of them is shown', report.first.visible === 1, `${report.first.visible} visible`);
check('the count says which', report.first.counter === '1 / 3', report.first.counter);
check('back is off on the first page', report.first.backOff === true);
check('the bar layer covers every page', report.boxCount === 36, `${report.boxCount} boxes`);
check('the arrow turns the page', report.second.at === 1 && report.second.shownPage === '1',
  `page ${report.second.shownPage}, count ${report.second.counter}`);
check('still one page shown', report.second.visible === 1, `${report.second.visible}`);
console.log('');
check('the page elements are the same ones', report.second.sameHolders);
check('…and so are their pictures', report.second.sameCanvases);
check('…and every bar box survived the turn', report.second.sameBoxes);
check('the follower was subscribed once and never dropped',
  report.second.subscribed === 1 && report.second.dropped === 0,
  `${report.second.subscribed} on, ${report.second.dropped} off`);
check('the turn did not ask the take to play', report.askedByTheTurn === 0,
  `${report.askedByTheTurn} requests`);
check('the light still follows after a turn', report.litOnPage !== null,
  `lit on page ${report.litOnPage}`);
check('a bar on the page turned to plays its own moment',
  Number.isFinite(report.askedHere), `${report.askedHere}`);
console.log('');
check('forward stops at the last page', report.atEnd.at === 2 && report.atEnd.forwardOff === true,
  `page ${report.atEnd.at}, count ${report.atEnd.counter}`);
check('and pressing past it goes nowhere', report.heldAtEnd === 2, `${report.heldAtEnd}`);
check('back walks it home', report.atStart.at === 0 && report.atStart.backOff === true,
  `page ${report.atStart.at}`);
check('nothing was thrown', errors.length === 0, errors.join(' | '));

console.log(`\npicture: ${path.join(OUT, 'pager.png')}`);
const ok = results.every(Boolean);
console.log(ok ? '\nPASS — one page at a time, and a turn touches nothing the sound depends on' : '\nFAIL');
process.exit(ok ? 0 : 1);
