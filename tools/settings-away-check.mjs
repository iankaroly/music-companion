// TAP THE DARK AND THE SETTINGS SHEET GOES AWAY — and nothing else does.
//
// "you can click anywhere off of the settings page and it will take you back to
// the screen, instead of needing to click done every time."
//
// The one-line version of this — close when `event.target` is the dialog — is
// wrong in three ways that are all invisible until somebody meets them, so each
// one is a check here rather than a comment:
//
//   · THE PADDING. The sheet has 1.4rem of it, and a press there IS a press on
//     the dialog element. That version closes when you tap just inside the
//     visible edge, which reads as the app losing your tap.
//   · THE SLIDERS. Volume, drone and click are range inputs; they capture the
//     pointer, so dragging one past the edge and letting go lands a click
//     outside the sheet with the gesture having begun inside it.
//   · THE KEYBOARD. Enter on a button synthesises a click at 0,0 — outside
//     every rectangle there has ever been.
//
//   npm run dev                  (on 5199)
//   npm run settings:away
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
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  [...document.querySelectorAll('button')].find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

const openSheet = () => page.evaluate(async () => {
  const d = document.querySelector('#settings-dialog');
  if (!d.open) document.querySelector('#settings-btn').click();
  await new Promise((r) => setTimeout(r, 500));
  return d.open;
});
const isOpen = () => page.evaluate(() => !!document.querySelector('#settings-dialog')?.open);
const boxOf = (sel) => page.evaluate((s) => {
  const b = document.querySelector(s).getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}, sel);

check('the sheet opens', await openSheet() === true);

// --- 1. the dark around it dismisses ---------------------------------------
const sheet = await boxOf('#settings-dialog');
// Somewhere unambiguously off the sheet: above its top edge, if there is room,
// otherwise beside it.
const away = sheet.y > 40
  ? { x: sheet.x + sheet.w / 2, y: sheet.y / 2 }
  : { x: Math.max(4, sheet.x / 2), y: sheet.y + sheet.h / 2 };
await page.mouse.click(away.x, away.y);
await new Promise((r) => setTimeout(r, 400));
check('a tap on the dark closes it', await isOpen() === false,
  `tapped ${Math.round(away.x)},${Math.round(away.y)}; sheet at `
  + `${Math.round(sheet.x)},${Math.round(sheet.y)} ${Math.round(sheet.w)}x${Math.round(sheet.h)}`);

// --- 2. …and the sheet's own padding does NOT ------------------------------
await openSheet();
const pad = await page.evaluate(() => {
  const d = document.querySelector('#settings-dialog');
  const b = d.getBoundingClientRect();
  const p = parseFloat(getComputedStyle(d).paddingLeft) || 0;
  // Half a padding in from the left edge: inside the sheet you can see, and on
  // the dialog element itself rather than on anything in it.
  return { x: b.left + p / 2, y: b.top + b.height / 2, padding: p };
});
await page.mouse.click(pad.x, pad.y);
await new Promise((r) => setTimeout(r, 400));
check('a tap on the sheet\'s own padding does not', await isOpen() === true,
  `${pad.padding}px of padding; tapped ${Math.round(pad.x)},${Math.round(pad.y)}`);

// --- 3. dragging a slider out over the edge does NOT -----------------------
await openSheet();
const slider = await page.evaluate(async () => {
  const el = document.querySelector('#set-volume');
  el.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 300));
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width * 0.6, y: b.top + b.height / 2, value: el.value };
});
await page.mouse.move(slider.x, slider.y);
await page.mouse.down();
// …out through the side of the sheet and well past it, then let go.
await page.mouse.move(slider.x - 260, slider.y, { steps: 8 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
const afterDrag = await page.evaluate(() => ({
  open: !!document.querySelector('#settings-dialog')?.open,
  value: document.querySelector('#set-volume')?.value,
}));
check('dragging a slider out past the edge does not close it', afterDrag.open === true,
  `volume ${slider.value} → ${afterDrag.value}`);

// --- 4. a keyboard press does NOT ----------------------------------------
// Enter on a focused control synthesises a click at clientX/clientY 0, which is
// outside every rectangle there has ever been, and it arrives with no
// pointerdown in front of it. Dispatched here exactly as the browser makes it,
// on something inside the sheet, so the event that reaches the dialog is the
// one a keyboard produces.
await openSheet();
const keyed = await page.evaluate(async () => {
  const inside = document.querySelector('#settings-dialog .set-label');
  inside.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 0, clientY: 0, detail: 0,
  }));
  await new Promise((r) => setTimeout(r, 300));
  return !!document.querySelector('#settings-dialog')?.open;
});
check('a click at 0,0 — what a keyboard makes — does not close it', keyed === true);

// --- 5. Done still works ---------------------------------------------------
await page.evaluate(() => document.querySelector('#settings-dialog')?.close());
await openSheet();
await page.evaluate(async () => {
  [...document.querySelectorAll('#settings-dialog button')]
    .find((b) => b.textContent.trim() === 'Done')?.click();
  await new Promise((r) => setTimeout(r, 300));
});
check('Done still closes it', await isOpen() === false);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
