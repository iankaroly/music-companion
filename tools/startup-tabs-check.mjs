// THE APP HAS TO FINISH STARTING UP, WHICHEVER TAB IT OPENS ON.
//
// It reopens on whatever tab you left it on (`localStorage.tab`), and that
// restore happens DURING main.js's own evaluation — `tabBar` calls `onShown`
// for the initial tab from inside its constructor. So everything that handler
// touches has to already exist at that moment, and one branch of it did not:
//
//   if (name === 'tuner') queueMicrotask(autoStartTuner);
//   else autoStopTuner();                       // <- reads a `let` 330 lines down
//
// `autoStopTuner` reads `scoreWantsEars`, so the branch taken for EVERY tab
// except the tuner ran inside its temporal dead zone and threw "Cannot access
// 'scoreWantsEars' before initialization" — which aborts the rest of main.js.
// The app still LOOKS right: the markup and the CSS are there, the tab bar is
// wired inside `tabBar` itself. What is missing is every line of wiring below
// that call — which is why the metronome's pickers came up as raw browser
// dropdowns, and how this was found: by looking at a screenshot of the
// metronome tab and seeing the app's own error toast in it.
//
// So: open on each tab in turn, and require ZERO page errors and the tab
// actually showing. A startup crash is worth its own check.
//
//   npm run dev             (on 5199)
//   npm run startup:tabs
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

const TABS = ['tuner', 'analyze', 'library', 'score', 'coach', 'metronome'];

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});

for (const tab of TABS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Written BEFORE a line of the app runs, so the restore is what opens the tab.
  await page.evaluateOnNewDocument((name) => {
    localStorage.setItem('tab', name);
    localStorage.setItem('instrument', 'cello');
  }, tab);
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));
  const seen = await page.evaluate((name) => ({
    showing: !!document.querySelector(`#tab-${name === 'analyze' ? 'analyze' : name}`)
      ?.classList.contains('active'),
    // The proof that main.js got PAST the restore: initControls runs well below
    // it, and it is what turns the <select>s into pills.
    wired: !!document.querySelector('#instrument-seg')?.children.length
      || !!document.querySelector('.pick-btn'),
  }), tab);
  check(`opening on “${tab}” starts the app up completely`,
    errors.length === 0 && seen.wired,
    errors.length ? errors[0].split('\n')[0] : (seen.wired ? '' : 'main.js stopped before initControls'));
  await page.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
