// THE METRONOME IS A PAGE, NOT A SCROLL.
//
//   "When I click on the metronome tab, it lets me scroll up and down, which I
//    don't like. It should just be that page. You shouldn't be able to scroll
//    up and down."
//
// It is one card with everything on it, so there is nothing below the fold to
// scroll to — the drag was slack. The card was set in fixed rem and came to
// 680px; a phone whose usable height falls short of that (a browser with its
// own toolbar, a small phone) had a few dozen pixels of nothing to pull around.
//
// WHAT IS CHECKED, at every height a phone can hand this app: that the document
// does not scroll, AND that the last control on the card — Start — is still on
// screen and above the tab bar. The second half is the one that matters,
// because the cheap way to stop a page scrolling is to clip it, and a Start
// button under the tab bar is worse than a scroll.
//
//   npm run dev             (on 5199)
//   npm run metro:page
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

// The short end is deliberate: 568 is an iPhone SE with a browser toolbar over
// it, which is the smallest thing this ever has to be a page on.
// …and LANDSCAPE, which is the hardest case there is: 393 tall is shorter than
// anything a phone is upright, and both new max-height blocks apply at once.
const SIZES = [[390, 568], [390, 667], [390, 740], [393, 852], [430, 932], [820, 1180], [852, 393]];

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});

for (const [w, h] of SIZES) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, hasTouch: true, isMobile: w < 700 });
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1200));
  const seen = await page.evaluate(async () => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    // Pressed until it takes. The app restores whichever tab was last open,
    // and that restore lands AFTER the page's load event — a single click at a
    // fixed delay raced it and measured the tuner half the time.
    for (let i = 0; i < 20; i += 1) {
      if (document.querySelector('#tab-metronome')?.classList.contains('active')) break;
      document.querySelector('.tab-btn[data-tab="metronome"]')?.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 450));
    const start = document.querySelector('#metro-toggle');
    const box = start.getBoundingClientRect();
    const bar = document.querySelector('.tabbar, #tabbar, nav');
    const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
    // What a finger lands on in the middle of Start, which is the only proof
    // that "on screen" also means "reachable".
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      slack: document.documentElement.scrollHeight - window.innerHeight,
      startBottom: Math.round(box.bottom),
      barTop: Math.round(barTop),
      card: Math.round(document.querySelector('#metro-card').getBoundingClientRect().height),
      reachable: hit === start || start.contains(hit),
      active: !!document.querySelector('#tab-metronome')?.classList.contains('active'),
    };
  });
  check(`${w}x${h}: the page does not scroll`, seen.slack <= 0,
    `${seen.slack}px of slack; the card measured ${seen.card}${seen.active ? '' : ' (TAB NOT ACTIVE)'}`);
  check(`${w}x${h}: Start is above the tab bar and pressable`,
    seen.startBottom <= seen.barTop && seen.reachable,
    `Start ends at ${seen.startBottom}, the bar starts at ${seen.barTop}`
    + `${seen.reachable ? '' : ', and a finger lands on something else'}`);
  await page.close();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
