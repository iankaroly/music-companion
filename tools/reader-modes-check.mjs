// THE LOCK, THE CLOCK AND THE TRANSPOSER, driven the way a hand would.
//
// Three things the reader can now do on a stand, each checked against what
// it must refuse as much as what it must do:
//
//   the performance lock — turns still turn (tap zone, pedal), and a tap in
//   the middle, a tap at the top, a pinch and a pencil all do nothing; the
//   lock at the corner and Escape are the only ways out.
//   turning by itself — at one second a page the score walks to its last page
//   and stops, the countdown showing on the way and gone at the end.
//   transposing — two semitones up moves every notehead up a step, the file's
//   notes are still all found on the page, the label says what was done, and
//   "written pitch" puts it back exactly.
//
//   npm run dev
//   npm run reader:modes
//
import puppeteer from 'puppeteer-core';

const PORT = Number(process.env.PORT ?? 5199);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const OUT = process.env.OUT ?? null;

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const page = await browser.newPage();
const size = { width: 820, height: 1180 };
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true });
const cdp = await page.createCDPSession();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const xml = (bars) => {
  const ms = [];
  for (let m = 1; m <= bars; m++) {
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
    + `<part-name>Voice</part-name></score-part></part-list><part id="P1">${ms.join('')}</part></score-partwise>`;
};

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};
const shot = async (name) => {
  if (!OUT) return;
  await page.screenshot({ path: `${OUT}/modes-${name}.png` });
};
const state = () => page.evaluate(async () => {
  const { readerState } = await import('/src/ui/reader.js');
  const root = document.querySelector('#reader');
  const head = document.querySelector('.vf-notehead');
  return {
    ...readerState(),
    locked: root.classList.contains('locked'),
    bare: root.classList.contains('bare'),
    drawing: root.classList.contains('drawing'),
    lockChip: !document.querySelector('#reader-lock')?.hidden,
    countdown: document.querySelector('#reader-countdown')?.hidden ? null
      : document.querySelector('#reader-countdown')?.textContent,
    count: document.querySelector('#reader-count')?.textContent ?? '',
    menuOpen: document.querySelector('#reader-menu')?.classList.contains('open'),
    firstHeadY: head ? head.getBoundingClientRect().top : null,
    transposeLabel: document.querySelector('#reader-transpose-value')?.textContent ?? '',
  };
});
const tapAt = async (fx, fy, type = 'touch') => {
  await page.evaluate(({ x, y, type }) => {
    const target = document.elementFromPoint(x, y);
    const ev = (kind) => new PointerEvent(kind, {
      pointerId: 7, pointerType: type, isPrimary: true, bubbles: true, cancelable: true,
      clientX: x, clientY: y, buttons: kind === 'pointerup' ? 0 : 1, pressure: kind === 'pointerup' ? 0 : 0.5,
    });
    target?.dispatchEvent(ev('pointerdown'));
    target?.dispatchEvent(ev('pointerup'));
  }, { x: size.width * fx, y: size.height * fy, type });
  await wait(700);
};
const menuPick = async (label) => page.evaluate((label) => {
  const rows = [...document.querySelectorAll('#reader-menu .reader-menu-row')];
  const row = rows.find((r) => r.querySelector('b')?.textContent === label);
  row?.click();
  return !!row;
}, label);
const openMenu = async () => {
  await page.evaluate(() => {
    const root = document.querySelector('#reader');
    if (!root.classList.contains('bare')) return;
  });
  // A tap at the top brings the bar; the ⋯ opens the sheet.
  await page.evaluate(() => document.querySelector('#reader-menu-btn')?.click());
  await wait(300);
};
const pinch = async () => {
  const cx = size.width / 2;
  const cy = size.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: cx - 60, y: cy, id: 1 }, { x: cx + 60, y: cy, id: 2 }],
  });
  for (let i = 1; i <= 6; i += 1) {
    const d = 60 + i * 30;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
    });
    await wait(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(700);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  localStorage.setItem('readerNight', 'off');
  localStorage.setItem('readerHinted', 'yes');
  localStorage.setItem('readerHalfTurns', 'off');
  localStorage.setItem('readerSpread', 'off');
  localStorage.removeItem('readerAutoTurn:modes');
  localStorage.removeItem('readerTranspose:modes');
});
const open = () => page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  // With the file's notes, as score.js hands them over: they are what the
  // engraved noteheads are matched against, and the transposition has to keep
  // that match.
  const { parseScore } = await import('/src/analysis/musicxml.js');
  const parsed = parseScore(x);
  await saveAnnotations('modes', []);
  await openReader({ id: 'modes', name: 'Modes', xml: x, kind: 'notation', notes: parsed.notes });
}, xml(120));
const closeReader = () => page.evaluate(async () => { const { close } = await import('/src/ui/reader.js'); close(); });

// ── the lock ────────────────────────────────────────────────────────────────
console.log('\n  the performance lock');
await open();
await wait(1800);
const s0 = await state();
check('opened on page 1 with the bar away', s0.count === `p. 1 of ${s0.pagesKnown}` && s0.bare, s0.count);
await openMenu();
check('the menu offers the lock', await menuPick('Lock the page'));
await wait(500);
const s1 = await state();
check('the page is locked, bar away, lock showing', s1.locked && s1.bare && s1.lockChip);
await shot('locked');
await tapAt(0.5, 0.5);
check('a tap in the middle brings no bar', (await state()).bare);
await tapAt(0.5, 0.1);
check('a tap at the top brings no bar', (await state()).bare);
await tapAt(0.85, 0.5);
const s2 = await state();
check('a tap in the right third still turns', s2.count === `p. 2 of ${s0.pagesKnown}`, s2.count);
await page.keyboard.press('ArrowRight');
await wait(700);
check('the pedal still turns', (await state()).count === `p. 3 of ${s0.pagesKnown}`);
await page.keyboard.press('ArrowLeft');
await wait(700);
await pinch();
const s3 = await state();
check('a pinch does not zoom', s3.zoom === 1, `zoom ${s3.zoom}`);
await tapAt(0.5, 0.5, 'pen');
const s4 = await state();
check('a pencil arms nothing', !s4.drawing && s4.bare && s4.locked);
await page.evaluate(() => document.querySelector('#reader-lock')?.click());
await wait(400);
const s5 = await state();
check('the lock at the corner unlocks', !s5.locked && !s5.lockChip);
await tapAt(0.5, 0.5);
check('…and a tap in the middle brings the bar back', !(await state()).bare);
await tapAt(0.5, 0.5);
await openMenu();
await menuPick('Lock the page');
await wait(300);
await page.keyboard.press('Escape');
await wait(300);
check('Escape unlocks too', !(await state()).locked);
await closeReader();
await wait(400);

// ── turning by itself ─────────────────────────────────────────────────────────
console.log('\n  turning by itself');
await page.evaluate(() => localStorage.setItem('readerAutoTurn:modes', '1'));
await open();
await wait(400);
const a0 = await state();
check('the countdown is showing', !!a0.countdown && /turns in \d+s/.test(a0.countdown), a0.countdown ?? 'no chip');
await shot('countdown');
await wait(900);
const a1 = await state();
check('a second later the page has turned by itself', a1.count === `p. 2 of ${a0.pagesKnown}`, a1.count);
await wait(1000 * (a0.pagesKnown - 1) + 800);
const a2 = await state();
check('it walked to the last page and stopped', a2.count === `p. ${a0.pagesKnown} of ${a0.pagesKnown}`, a2.count);
check('…and the countdown went away on the last page', a2.countdown === null, a2.countdown ?? '');
await page.keyboard.press('ArrowLeft');
await wait(300);
const a3 = await state();
check('a turn of your own restarts the clock', !!a3.countdown, a3.countdown ?? 'no chip');
await openMenu();
check('the menu says what it is set to', await page.evaluate(() => [...document.querySelectorAll('#reader-menu small')]
  .some((s) => s.textContent === 'every 1 second')));
await menuPick('Turn pages by itself…');
await wait(300);
check('the clock’s own sheet opens with Off on it', await menuPick('Off'));
await wait(300);
const a4 = await state();
check('Off stops it', a4.countdown === null);
check('…and forgets it', await page.evaluate(() => localStorage.getItem('readerAutoTurn:modes') === null));
await closeReader();
await wait(400);

// ── transposing ──────────────────────────────────────────────────────────────
console.log('\n  transposing');
await open();
await wait(1800);
const t0 = await state();
check('every note of the file is on the page', t0.unmatched === 0 && t0.notesIndexed > 0, `${t0.notesIndexed} indexed`);
await openMenu();
check('the menu offers Transpose', await menuPick('Transpose…'));
await wait(300);
await page.evaluate(() => document.querySelector('#reader-transpose-up')?.click());
await wait(1500);
await page.evaluate(() => document.querySelector('#reader-transpose-up')?.click());
await wait(1800);
const t1 = await state();
check('the stepper stays open and says a tone up', t1.menuOpen && t1.transposeLabel.includes('a tone up'), t1.transposeLabel);
check('the first notehead moved up a step', t1.firstHeadY !== null && t0.firstHeadY - t1.firstHeadY > 2 && t0.firstHeadY - t1.firstHeadY < 12,
  `${t0.firstHeadY?.toFixed(1)} → ${t1.firstHeadY?.toFixed(1)}`);
check('every note of the file is still found on the transposed page', t1.unmatched === 0 && t1.notesIndexed === t0.notesIndexed,
  `${t1.notesIndexed} indexed, ${t1.unmatched} unmatched`);
check('it is remembered for this score', await page.evaluate(() => localStorage.getItem('readerTranspose:modes') === '2'));
check('the review will read it', await page.evaluate(async () => {
  const { transpositionOf } = await import('/src/ui/reader.js');
  return transpositionOf('modes') === 2;
}));
await shot('transposed');
await page.evaluate(() => document.querySelector('#reader-menu')?.classList.remove('open'));
await page.evaluate(() => document.querySelector('#reader-menu-btn')?.click());
await wait(300);
check('the menu row says what was done', await page.evaluate(() => [...document.querySelectorAll('#reader-menu small')]
  .some((s) => s.textContent.includes('a tone up'))));
await menuPick('Transpose…');
await wait(300);
await menuPick('Written pitch');
await wait(1800);
const t2 = await state();
check('written pitch puts the notes back exactly', Math.abs(t2.firstHeadY - t0.firstHeadY) < 0.5, `${t2.firstHeadY?.toFixed(1)}`);
check('…and forgets it', await page.evaluate(() => localStorage.getItem('readerTranspose:modes') === null));
await closeReader();

console.log(`\n  page errors: ${errors.length}${errors.length ? ` — ${errors[0]}` : ''}`);
console.log(failed ? `\n  ${failed} CHECK(S) FAILED` : '\n  all checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
