// WHO IS DRIVING THE SCROLL WHILE A TAKE IS PLAYING.
//
// The review of a take against photographed pages is taller than a phone: the
// pages at the top, the graph under them, the controls under that. While the
// take runs, the light moves down the music and the page is pulled after it
// (score-tab.js:keepInView) — and a hand reaching PAST the music, for the pause
// button or the trace, was overruled a second later, every second:
//
//   "when it's playing and I try to scroll down on the score while it's still
//    playing to pause it or go to one of the graphs, it just automatically
//    scrolls back up to the score, which I don't like."
//
// WHAT IS MEASURED, and why it is three facts and not one. "The page did not
// scroll back" on its own is the sort of assertion that passes because nothing
// was following in the first place — so this states the whole shape:
//
//   1. before anybody touches it, the follower DOES scroll the page,
//   2. after a touch, the follower keeps arriving and stops scrolling,
//   3. a seek — pressing a bar — hands the scroll back and it follows again.
//
// (2) without (1) is a dead follower and (2) without (3) is a follower that
// never comes back. score-tab.js counts both halves for exactly this; see
// followState.
//
//   npm run dev             (on 5199)
//   npm run review:follow
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// The same fixture review that review:taps uses: a photographed part, a take
// laid over it, both on the Score tab.
const built = await page.evaluate(async ({ b64 }) => {
  const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const { scoreId, written } = await engravePart({
    base64: b64, name: 'Followed scan', pages: 2, systems: 5, perSystem: 8, space: 13,
  });
  const notes = takeFromWritten(written, { from: 0, count: 60, spacing: 0.35, sounding: 0.3 });
  const readings = notes.map((n) => ({
    time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
  }));
  const seconds = Math.ceil(notes.at(-1).end) + 1;
  const audio = new Float32Array(44100 * seconds);
  for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i * 0.05) * 0.2;
  const { Recorder } = await import('/src/audio/recording.js');
  const rec = new Recorder(44100);
  rec.push(audio);
  const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
  const { renderFreeReview } = await import('/src/ui/report.js');
  await selectScore(scoreId);
  await measurePages(scoreId);
  renderFreeReview(document, notes, rec, { readings, a4: 440 });
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  await annotateTake(notes, { readings, a4: 440 });
  for (let i = 0; i < 40 && !document.querySelectorAll('.scan-bar').length; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    bars: document.querySelectorAll('.scan-bar').length,
    tall: document.body.scrollHeight,
    seconds,
  };
}, { b64: font });
check('the review is up and taller than the screen',
  built.bars > 0 && built.tall > 844, `${built.bars} bars, page ${built.tall}px tall`);

// (1) PLAYING FROM THE TOP: the follower moves the page.
//
// TAPPED, not `.click()`ed. A finger sends pointerdown before click, and the
// latch below is armed by exactly that — so a check that dispatches a bare
// click starts the take without ever exercising the thing under test, and step
// (1) passes with the latch untouched. `page.touchscreen.tap` sends the real
// sequence.
// A bar brought on screen and then TAPPED — pointerdown, pointerup, click, the
// sequence a finger sends. A bare `.click()` starts the take without ever
// exercising the latch, so this step would pass with the thing under test
// untouched.
const barBox = await page.evaluate(async () => {
  const bar = document.querySelectorAll('.scan-bar')[1];
  if (!bar) return null;
  bar.scrollIntoView({ block: 'center', behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 350));
  const b = bar.getBoundingClientRect();
  const x = Math.round(b.left + b.width / 2);
  const y = Math.round(b.top + b.height / 2);
  const hit = document.elementFromPoint(x, y);
  return (hit === bar || bar.contains(hit)) ? { x, y } : null;
});
if (!barBox) { console.log('FAIL  no bar was reachable at the top of the review'); process.exit(1); }
await page.touchscreen.tap(barBox.x, barBox.y);
const following = await page.evaluate(async () => {
  const { followState } = await import('/src/ui/score-tab.js');
  // AWAY FROM THE MUSIC, WITHOUT A GESTURE: `scrollTo` fires neither a wheel
  // nor a touchmove, so this is the app moving its own page and the follower
  // still has the wheel. To the foot of the review rather than to the top —
  // the music is at the TOP, so this is the position from which the follower
  // has to bring it back, and it does not depend on how tall the page happens
  // to be. (It did: this scrolled to the top and waited for the light to walk
  // far enough down to leave the comfortable middle, which stopped happening
  // the day the graph stopped being 900px wide and the page got shorter.)
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 3500));
  return { ...followState(), y: Math.round(window.scrollY),
    play: document.querySelector('#clip-play')?.textContent };
});
check('while the take runs the follower scrolls the page to the music',
  following.follows > 0 && following.scrolls > 0,
  `${following.follows} follow ticks, ${following.scrolls} scrolls, at y=${following.y}, transport ${following.play}`);

// (2) A TOUCH TAKES THE WHEEL. The follower keeps arriving; it stops scrolling.
const before = await page.evaluate(async () => {
  const { followState } = await import('/src/ui/score-tab.js');
  return followState();
});
// A HAND ON THE PAGE, DRAGGING IT DOWN — the real sequence, not a synthetic
// event: touchstart, several touchmoves, touchend. A tap is deliberately not
// enough (a tap is how you press a bar), so the check has to drag.
await page.touchscreen.touchStart(200, 700);
for (let y = 660; y >= 260; y -= 80) await page.touchscreen.touchMove(200, y);
await page.touchscreen.touchEnd();
const afterTouch = await page.evaluate(async () => {
  const { followState } = await import('/src/ui/score-tab.js');
  // After the fling has settled. A drag has velocity and the browser carries
  // it on for a few hundred milliseconds; reading the resting place before
  // that is reading a number that was still moving.
  await new Promise((r) => setTimeout(r, 900));
  const start = followState();
  const parked = Math.round(window.scrollY);
  await new Promise((r) => setTimeout(r, 3500));
  const after = followState();
  return {
    ours: after.ours,
    followsGained: after.follows - start.follows,
    scrollsGained: after.scrolls - start.scrolls,
    parked,
    y: Math.round(window.scrollY),
  };
});
check('a touch stops the follower scrolling, without stopping the follower',
  afterTouch.ours === false && afterTouch.followsGained > 0 && afterTouch.scrollsGained === 0,
  `${afterTouch.followsGained} more follow ticks, ${afterTouch.scrollsGained} more scrolls`
  + ` (${before.scrolls} before the drag)`);
check('…and the page stays where the hand left it',
  Math.abs(afterTouch.y - afterTouch.parked) < 40,
  `parked at ${afterTouch.parked}, ended at ${afterTouch.y}`);

// (3) A SEEK HANDS IT BACK. Pressing a bar is asking to be taken there.
// From where the hand left the page — no scrolling of our own, or the scroll
// this is about would have been given back by the app itself.
const seekAt = await page.evaluate(async () => {
  for (const bar of document.querySelectorAll('.scan-bar')) {
    const b = bar.getBoundingClientRect();
    const x = Math.round(b.left + b.width / 2);
    const y = Math.round(b.top + b.height / 2);
    if (y < 60 || y > window.innerHeight - 90) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit === bar || bar.contains(hit)) return { x, y };
  }
  return null;
});
if (!seekAt) { console.log('FAIL  no bar was on screen where the hand left the page'); process.exit(1); }
const seekBefore = await page.evaluate(async () => {
  const { followState } = await import('/src/ui/score-tab.js');
  return { ...followState(), y: Math.round(window.scrollY) };
});
// TAPPED, not clicked — and a tap must not arm the latch, or this could only
// ever pass by the press undoing what the press itself did.
await page.touchscreen.tap(seekAt.x, seekAt.y);
const afterSeek = await page.evaluate(async (was) => {
  const { followState } = await import('/src/ui/score-tab.js');
  await new Promise((r) => setTimeout(r, 3000));
  const after = followState();
  return { ours: after.ours, scrollsGained: after.scrolls - was, y: Math.round(window.scrollY) };
}, seekBefore.scrolls);
check('pressing a bar hands the scroll back and it follows again',
  afterSeek.ours === true && afterSeek.scrollsGained > 0,
  `${afterSeek.scrollsGained} scrolls after the press, y ${seekBefore.y} → ${afterSeek.y}`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
