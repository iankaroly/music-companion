// THE TOUR POINTS AT THE RIGHT THINGS, FITS ON THE SCREEN, AND IS SHOWN ONCE.
//
// The tour is ten coach marks drawn over the real app after the welcome
// screen (ui/tour.js). Everything that could go wrong with it is geometric or
// is a flag, and neither kind of fault throws: a hole that frames the wrong
// control, a card that has walked off the bottom of a phone, a card sat over
// the very thing it is describing, a tour that comes back on every launch.
// So this drives it exactly as a finger does — real clicks on the instrument
// picker, on Start playing, on Next — and measures rectangles after each.
//
// Both ends of the range the app ships to: a 390-wide phone, a 1024x1366 iPad,
// and 320, the narrowest phone anybody still holds, where the card has 304px
// to be a card in.
//
// NO REAL DEVICE IS EVER OPENED. The microphone is a fake one granted by the
// browser flag, the same as every other check here, and the camera is never
// asked for — the check reads the tour's source to be sure it CANNOT ask, and
// watches every getUserMedia call the page makes to be sure the tour did not.
//
//   npm run dev             (on 5199)
//   npm run app:tour
//   TOUR_SHOTS=/some/dir npm run app:tour     also writes step-one screenshots
//
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const SHOTS = process.env.TOUR_SHOTS ?? null;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What each stop must frame, written here independently of ui/tour.js so a
// stop that drifts onto the wrong control is caught rather than agreed with.
// The first stop frames the dial AND the "Tap to listen" button under it,
// because on a cold device that button is there (the microphone has not been
// granted) and a hole round the dial alone left a sliver of it showing. The
// three Score stops frame the shelf's own buttons and its empty-shelf note,
// because on a cold device there is no part to frame — and the empty note is
// the tallest thing the tour points at, which is what the 320x568 screen is
// here to catch.
// `topic` is the words Settings promises for that stop. The hint under "Show
// the tour again" in index.html is the only description of the tour a player
// reads before starting it, and it said "Four short stops — the dial, Record,
// putting a part on the stand, and the coach" while this list was ten long: a
// count six out and six areas of the app unmentioned. Nothing could see it,
// because the hint is copy in index.html and the tour is data in ui/tour.js.
// So the phrases are written HERE, beside the stops they belong to and
// independently of both, and read back out of the open sheet below.
const STOPS = [
  { tab: 'tuner', target: ['#gauge-wrap', '#tuner-listen'], topic: 'the dial' },
  { tab: 'analyze', target: '#start', topic: 'Record' },
  { tab: 'analyze', target: ['#tab-analyze .mini-label', '.seg[aria-label="Count-in before recording"]'], topic: 'count-in' },
  { tab: 'library', target: ['#new-folder', '#library-search'], topic: 'the Library' },
  { tab: 'score', target: '#score-load', topic: 'on the stand' },
  { tab: 'score', target: ['#score-sets', '#score-folder'], topic: 'setlists' },
  { tab: 'score', target: ['#score-search', '#score-list-empty'], topic: 'the reader' },
  { tab: 'coach', target: '.tab-btn[data-tab="coach"]', topic: 'the coach' },
  { tab: 'metronome', target: ['#bpm-display', '#bpm-slider'], topic: 'the metronome' },
  { tab: 'tuner', target: '#settings-btn', topic: 'Settings' },
];
const LAST = STOPS.length;

// Counting words, so a stop added without a look at Settings fails here rather
// than being quietly undercounted to the player. Every one of them is looked
// for: the fault this catches is the RIGHT count word never appearing and an
// old WRONG one staying put.
const COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// The tour must not be ABLE to open a device, whatever the page around it does.
{
  const src = await readFile(new URL('../src/ui/tour.js', import.meta.url), 'utf8');
  const asks = src.match(/getUserMedia|openScanner|mediaDevices|getDisplayMedia/g) ?? [];
  check('ui/tour.js never names the microphone, the camera or the scanner',
    asks.length === 0, asks.join(', '));
  // The take-on-the-page feature is not ready and must not be promised. The
  // card copy is the one place a new player reads a promise, so the strings
  // are read here rather than trusted; the comment above STOPS is allowed to
  // say the words, the copy is not.
  const copy = src.slice(src.indexOf('export const STOPS'));
  const promises = copy.match(/'[^']*marked[^']*'|'[^']*onto the (page|score|music)[^']*'/g) ?? [];
  check('ui/tour.js does not promise the take is marked onto the page',
    promises.length === 0, promises.join(', '));
}

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  protocolTimeout: 240000,
});

const SCREENS = [
  { name: 'phone', width: 390, height: 844, shot: 'tour-phone.png' },
  { name: 'ipad', width: 1024, height: 1366, shot: 'tour-ipad.png' },
  { name: 'narrow', width: 320, height: 568, shot: null },
];

for (const screen of SCREENS) {
  const tag = `[${screen.name} ${screen.width}x${screen.height}]`;
  const page = await browser.newPage();
  await page.setViewport({
    width: screen.width, height: screen.height, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Every microphone request the page makes, with who made it. The tuner is
  // allowed to (that is what showing the Tuner tab does); the tour is not.
  await page.evaluateOnNewDocument(() => {
    window.__mic = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      window.__mic.push(new Error('gum').stack ?? '');
      return real(c);
    };
  });

  // ── A COLD DEVICE, THROUGH THE WELCOME SCREEN ──────────────────────────────
  await page.goto(APP, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'load' });
  await wait(1700);

  const welcome = await page.evaluate(() => {
    const w = document.querySelector('#welcome');
    return !!w && !w.hidden && !document.querySelector('#tour');
  });
  check(`${tag} a cold device shows the welcome screen and no tour yet`, welcome);

  await page.click('#welcome-instruments [data-instrument]');
  await page.click('#welcome-start');
  await wait(700);

  const opened = await page.evaluate(() => ({
    welcomeGone: !document.querySelector('#welcome'),
    tour: !!document.querySelector('#tour'),
    count: document.querySelector('#tour-count')?.textContent ?? '',
  }));
  check(`${tag} Start playing brings the tour up in its place`,
    opened.welcomeGone && opened.tour && opened.count === `1 of ${LAST}`,
    `welcome gone ${opened.welcomeGone}, tour ${opened.tour}, "${opened.count}"`);

  if (SHOTS && screen.shot) {
    await page.screenshot({ path: join(SHOTS, screen.shot) });
  }

  // ── EACH STOP, MEASURED ────────────────────────────────────────────────────
  for (let i = 0; i < STOPS.length; i++) {
    const stop = STOPS[i];
    // The hole slides between stops over 260ms; measure once it has arrived.
    await wait(450);
    const m = await page.evaluate((sels) => {
      const rect = (el) => {
        const b = el?.getBoundingClientRect();
        return b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height } : null;
      };
      const hole = rect(document.querySelector('#tour-hole'));
      const card = rect(document.querySelector('#tour-card'));
      // Everything the stop points at that is actually showing, as one box.
      const boxes = [].concat(sels).map((s) => document.querySelector(s))
        .filter((el) => el && !el.hidden && el.getClientRects().length).map(rect);
      const target = boxes.length ? boxes.reduce((a, b) => ({
        left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
        w: 0, h: 0,
      })) : null;
      if (target) { target.w = target.right - target.left; target.h = target.bottom - target.top; }
      const active = document.querySelector('.tab-panel.active')?.id ?? '';
      const focused = document.activeElement;
      return {
        hole, card, target, active,
        vw: window.innerWidth, vh: window.innerHeight,
        count: document.querySelector('#tour-count')?.textContent ?? '',
        next: document.querySelector('#tour-next')?.textContent?.trim() ?? '',
        text: document.querySelector('#tour-text')?.textContent?.trim() ?? '',
        focusInCard: !!focused && !!focused.closest('#tour-card'),
        scanner: !!document.querySelector('#scanner'),
        dialogOpen: !!document.querySelector('dialog[open]'),
        // The pixel in the middle of Next is Next's own — nothing has crept
        // over the card.
        nextOwnsItsMiddle: (() => {
          const n = document.querySelector('#tour-next');
          const b = n.getBoundingClientRect();
          return n.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
        })(),
      };
    }, stop.target);

    const n = i + 1;
    check(`${tag} stop ${n} is on the ${stop.tab} tab`, m.active === `tab-${stop.tab}`, `active ${m.active}`);
    check(`${tag} stop ${n} counts itself "${n} of ${LAST}"`, m.count === `${n} of ${LAST}`, `"${m.count}"`);
    check(`${tag} stop ${n} says something`, m.text.length > 20, `"${m.text.slice(0, 40)}…"`);

    // The hole frames the control: it contains the control's rectangle, and
    // no side of it is more than the padding away — unless the screen edge
    // clamped it, in which case the control is cut by the screen, not by us.
    const t = m.target; const h = m.hole;
    const contains = !!t && !!h && h.left <= t.left + 1 && h.top <= t.top + 1
      && h.right >= t.right - 1 && h.bottom >= t.bottom - 1;
    const slack = !!t && !!h && Math.max(t.left - h.left, t.top - h.top, h.right - t.right, h.bottom - t.bottom) <= 12;
    check(`${tag} stop ${n} cuts its hole around ${[].concat(stop.target).join(' + ')}`, contains && slack,
      `target ${t ? `${Math.round(t.left)},${Math.round(t.top)} ${Math.round(t.w)}x${Math.round(t.h)}` : 'missing'}`
      + ` hole ${h ? `${Math.round(h.left)},${Math.round(h.top)} ${Math.round(h.w)}x${Math.round(h.h)}` : 'missing'}`);

    const c = m.card;
    const onScreen = !!c && c.left >= 0 && c.top >= 0 && c.right <= m.vw + 0.5 && c.bottom <= m.vh + 0.5;
    check(`${tag} stop ${n} keeps the card fully on screen`, onScreen,
      `card ${c ? `${Math.round(c.left)},${Math.round(c.top)}→${Math.round(c.right)},${Math.round(c.bottom)}` : 'missing'} in ${m.vw}x${m.vh}`);
    const overlaps = !!c && !!h && c.left < h.right && c.right > h.left && c.top < h.bottom && c.bottom > h.top;
    check(`${tag} stop ${n} does not lay the card over the control it describes`, !overlaps);
    check(`${tag} stop ${n} puts focus on the card`, m.focusInCard);
    check(`${tag} stop ${n} says ${n === LAST ? 'Done' : 'Next'}`, m.next === (n === LAST ? 'Done' : 'Next'), `"${m.next}"`);
    check(`${tag} stop ${n} opened nothing — no scanner, no sheet`, !m.scanner && !m.dialogOpen);
    check(`${tag} stop ${n}'s Next button is pressable`, m.nextOwnsItsMiddle);

    await page.click('#tour-next');
  }
  await wait(500);

  const done = await page.evaluate(() => ({
    gone: !document.querySelector('#tour'),
    flag: localStorage.getItem('tourSeen'),
    active: document.querySelector('.tab-panel.active')?.id ?? '',
  }));
  check(`${tag} Done takes the tour down and writes the flag`, done.gone && done.flag === '1',
    `gone ${done.gone}, tourSeen=${done.flag}`);
  // Left on an empty Coach tab, a new player's first screen would be "save a
  // few takes first". The tour puts them back where it found them.
  check(`${tag} …and leaves the player on the tuner, where the tour began`,
    done.active === 'tab-tuner', `active ${done.active}`);

  const asked = await page.evaluate(() => window.__mic);
  check(`${tag} no microphone request came from the tour`,
    !asked.some((s) => /tour\.js/.test(s)), `${asked.length} request(s) in all`);

  // ── SHOWN ONCE ─────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: 'load' });
  await wait(1600);
  const again = await page.evaluate(() => ({
    tour: !!document.querySelector('#tour'),
    welcome: !!document.querySelector('#welcome') && !document.querySelector('#welcome').hidden,
  }));
  check(`${tag} the tour does not come back on the next launch`, !again.tour && !again.welcome,
    `tour ${again.tour}, welcome ${again.welcome}`);

  // ── AND BACK FROM SETTINGS ─────────────────────────────────────────────────
  await page.click('#settings-btn');
  await wait(400);

  // What Settings SAYS the tour is, against the tour just walked. Measured
  // with the sheet open, so the same read also says whether the longer line
  // still fits: at 320 it is the widest hint in the sheet.
  const hint = await page.evaluate(() => {
    const p = document.querySelector('#tour-hint');
    if (!p) return null;
    const sheet = p.closest('dialog') ?? document.body;
    const b = p.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    return {
      text: p.textContent.replace(/\s+/g, ' ').trim(),
      spills: b.left < s.left - 0.5 || b.right > s.right + 0.5,
      overflow: Math.round(sheet.scrollWidth - sheet.clientWidth),
      box: `${Math.round(b.left)}→${Math.round(b.right)} in ${Math.round(s.left)}→${Math.round(s.right)}`,
    };
  });
  const said = hint?.text ?? '';
  const lower = said.toLowerCase();
  const counted = COUNTS.filter((w) => new RegExp(`\\b${w}\\b`).test(lower));
  check(`${tag} Settings counts the tour's stops — "${COUNTS[LAST]}", and no other number`,
    counted.length === 1 && counted[0] === COUNTS[LAST],
    `hint says ${counted.length ? counted.map((w) => `"${w}"`).join(', ') : 'no number'}`
    + ` — "${said.slice(0, 80)}${said.length > 80 ? '…' : ''}"`);
  const unnamed = STOPS.filter((stop) => !said.includes(stop.topic)).map((stop) => stop.topic);
  check(`${tag} Settings names every part of the app the tour visits`,
    !!said && unnamed.length === 0,
    unnamed.length ? `not mentioned: ${unnamed.join(', ')}` : `all ${STOPS.length} named`);
  check(`${tag} …and that line still fits the sheet`,
    !!hint && !hint.spills && hint.overflow <= 0,
    hint ? `${hint.box}, sheet overflows by ${hint.overflow}px` : 'no #tour-hint');

  await page.click('#set-tour');
  await wait(700);
  const replay = await page.evaluate(() => ({
    tour: !!document.querySelector('#tour'),
    count: document.querySelector('#tour-count')?.textContent ?? '',
    sheetOpen: !!document.querySelector('#settings-dialog[open]'),
    active: document.querySelector('.tab-panel.active')?.id ?? '',
  }));
  check(`${tag} "Show the tour again" in Settings brings it back from the first stop`,
    replay.tour && replay.count === `1 of ${LAST}` && !replay.sheetOpen,
    `tour ${replay.tour}, "${replay.count}", sheet still open ${replay.sheetOpen}`);

  // Escape is the keyboard's Skip.
  await page.keyboard.press('Escape');
  await wait(300);
  const escaped = await page.evaluate(() => !document.querySelector('#tour'));
  check(`${tag} Escape skips the tour`, escaped);

  // Started from another tab, Skip returns to that tab and not to the tuner.
  await page.evaluate(() => document.querySelector('.tab-btn[data-tab="library"]')?.click());
  await wait(900);
  await page.click('#settings-btn');
  await wait(400);
  await page.click('#set-tour');
  await wait(700);
  await page.click('#tour-skip');
  await wait(500);
  const back = await page.evaluate(() => ({
    tour: !!document.querySelector('#tour'),
    active: document.querySelector('.tab-panel.active')?.id ?? '',
  }));
  check(`${tag} Skip from the Library tab puts the player back on the Library tab`,
    !back.tour && back.active === 'tab-library', `tour ${back.tour}, active ${back.active}`);

  check(`${tag} nothing was thrown`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await page.close();
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
