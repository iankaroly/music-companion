// WHAT THE MICROPHONE REPORT SAYS ABOUT WHERE THE APP IS RUNNING, and where it
// sends somebody when the microphone refuses.
//
// The settings sheet's report opens with the place — "Running in the browser",
// "Added to the home screen", "The installed app" — and the mic-failure advice
// picks its Settings path from the same decision. That decision was written
// twice in main.js and only one copy knew about `capacitor:`, so the App Store
// build read as a browser and was sent to Settings → Safari → Microphone, which
// does not govern a WKWebView.
//
// TWO OF THE THREE PLACES ARE REACHABLE HERE and both are checked end to end:
// a plain page, and `navigator.standalone` defined the way iOS defines it on a
// Home Screen app. THE THIRD IS NOT — nothing headless can serve a page over
// `capacitor://`, so the App Store build's own reading is checked as the
// decision, imported from the page's own module graph, and by
// tests/where-running.test.js. Said plainly rather than faked.
//
// AND THE STATE THE THREE REPORTS ARE IN BEFORE ANY OF THEM IS PRESSED, which
// nothing looked at: they carry `white-space: pre-wrap` so a written report
// keeps one finding to a line, and that rule was rendering the HTML's own
// indentation in the placeholder prose as well. See the block below.
//
//   npm run dev            (on 5199)
//   npm run mic:place
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
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const errors = [];
let page = null;

// A FRESH PAGE EVERY TIME, and that is not tidiness: scripts handed to
// `evaluateOnNewDocument` accumulate and are never taken off again, so reusing
// one page left the deaf microphone patched in for every run after the first
// deaf one — the third check then read "Asking…" forever and passed on its
// prefix alone, which is the kind of green that means nothing.
//
// `homeScreen` defines navigator.standalone the way iOS defines it on an app
// added to the Home Screen, and `deaf` makes getUserMedia a promise that never
// settles — which is the silent refusal the ten-second branch exists for, and
// the only way to read that branch's advice without a device that is refusing.
async function open({ homeScreen = false, deaf = false } = {}) {
  await page?.close();
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((standalone, never) => {
    if (standalone) {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    }
    if (never) {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    }
  }, homeScreen, deaf);
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
  });
}

// The gear, top right.
async function openSheet() {
  await page.evaluate(() => {
    const d = document.querySelector('#settings-dialog');
    if (!d.open) document.querySelector('#settings-btn').click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

// The gear, top right, then "Check the microphone", then what it wrote.
async function micReport(waitMs) {
  await openSheet();
  await page.evaluate(() => document.querySelector('#set-mic-check').click());
  await new Promise((r) => setTimeout(r, waitMs));
  return page.evaluate(() => document.querySelector('#set-mic-report')?.textContent ?? '');
}

// --- 0. what the three reports say BEFORE anybody presses anything ----------
// The three report paragraphs are the only .set-hint elements in the sheet with
// `white-space: pre-wrap` on them, and that rule is load-bearing: the report a
// press writes is a list of findings and its newlines carry the meaning. It
// preserves the newlines and leading spaces in the HTML too, so the placeholder
// prose they start life holding was breaking mid sentence and resuming 27px in
// — the source's own indentation, rendered, at every width.
//
// BOTH HALVES ARE ASSERTED, because each one alone invites the wrong fix. Drop
// the rule and the placeholder reads correctly while every report written after
// it collapses into one paragraph; rewrap the markup only and nothing stops the
// next hand re-indenting it. So: pre-wrap is still computed on all three, AND
// nothing they are authored with survives to the screen as a break — no
// newline, and no run of two spaces, which pre-wrap renders just as literally.
await open();
await openSheet();
const placeholders = await page.evaluate(() => ['set-pen-report', 'set-sound-report', 'set-mic-report']
  .map((id) => {
    const el = document.querySelector('#' + id);
    if (!el) return { id, missing: true };
    const text = el.textContent ?? '';
    return {
      id,
      whiteSpace: getComputedStyle(el).whiteSpace,
      newlines: (text.match(/\n/g) ?? []).length,
      runs: (text.match(/ {2,}/g) ?? []).length,
    };
  }));
check('the report rule that keeps a finding to a line is still on all three',
  placeholders.every((p) => p.whiteSpace === 'pre-wrap'),
  placeholders.map((p) => `${p.id} ${p.missing ? 'MISSING' : p.whiteSpace}`).join(', '));
const ragged = placeholders.filter((p) => p.missing || p.newlines || p.runs);
check('and none of them renders its own source indentation before it is pressed',
  ragged.length === 0,
  ragged.map((p) => `${p.id}: ${p.newlines} newlines, ${p.runs} runs of spaces`).join(', '));

// --- 1. a plain page is a browser, and Safari is the right place to send it ---
const inBrowser = await micReport(5000);
check('in a browser the report says so', inBrowser.startsWith('Running in the browser'),
  inBrowser.slice(0, 90));

await open({ deaf: true });
const browserDeaf = await micReport(11500);
check('a browser that never answers is sent to Safari\'s own settings',
  /Settings → Safari → Microphone/.test(browserDeaf), browserDeaf.slice(0, 140));

// --- 2. added to the home screen: not a browser, and not Safari's settings ----
await open({ homeScreen: true });
const onHome = await micReport(5000);
check('a home-screen app is not called a browser', onHome.startsWith('Added to the home screen'),
  onHome.slice(0, 90));

await open({ homeScreen: true, deaf: true });
const homeDeaf = await micReport(11500);
check('a home-screen app that never answers is told Safari\'s settings are not the switch',
  /the Safari\s+settings are not what is holding it shut/.test(homeDeaf.replace(/\s+/g, ' '))
    && !/check Settings → Safari → Microphone/.test(homeDeaf),
  homeDeaf.slice(0, 160));

// --- 3. the App Store build, as far as anything headless can go --------------
// No browser can be served over capacitor://, so this is the decision itself,
// read out of the page's own copy of the module the report calls.
const nativeReading = await page.evaluate(async () => {
  const { whereRunning, placeName } = await import('/src/ui/where-running.js');
  const where = whereRunning({ protocol: 'capacitor:', standalone: undefined, displayStandalone: false });
  return { where, name: placeName(where) };
});
check('the App Store build reads as the installed app, not as a browser',
  nativeReading.where === 'app' && nativeReading.name === 'The installed app',
  `${nativeReading.where} / ${nativeReading.name}`);

check('nothing threw', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
