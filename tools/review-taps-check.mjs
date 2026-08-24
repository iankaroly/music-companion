// THE REVIEW HAS TO ANSWER A FINGER.
//
// A take recorded against a scanned score ends on the Score tab: the pages at
// the top, the graph under them, Save and Discard at the foot. Every one of
// those is worked by touching it, and MEASURED at 390x844 not one of them could
// be touched at all —
//
//   #clip-play           SMALL.scan-pairing.scan-bars on top
//   #score-save-take     SMALL.scan-pairing.scan-bars on top
//   #score-discard-take  SMALL.scan-pairing.scan-bars on top
//
// — which is what "when I click the pause button on the graph below, it doesn't
// pause the score, and it doesn't pause the audio… when I click Save or
// Discard, none of those are working" looks like from the inside. Every handler
// was wired the whole time. The click never arrived.
//
// The cause was a NAME. `.scan-bars` is the layer of invisible boxes drawn over
// a photographed page — `position: absolute; inset: 0; z-index: 3` — and the
// sentence in score.js that reports what the barlines cut the take into was
// given the same class, as a label for what it was ABOUT. So a line of prose
// became a transparent sheet 390 by 1383 over the whole review.
//
// WHAT THIS CHECKS, AND WHY IT IS IN TWO PARTS. The sentence is only written on
// a take the reader managed to bar, so a check that waited for it to happen
// would be a check that passes because the hazard did not occur. So the hazard
// is also MADE: an element of prose carrying the layer's class, put where
// score.js used to put it. The controls have to survive that, which they do
// only while the layer's CSS is scoped to a page.
//
// It asserts the thing a player does — that the pixel in the middle of a
// control belongs to that control — rather than that a handler exists, because
// a handler existed the whole time.
//
//   npm run dev             (on 5199)
//   npm run review:taps
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
// A PHONE, and it matters: the sheet was there at every size and only covered
// the controls at some of them. This is the size he holds.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(APP, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// A photographed part and a take of it, put up the way stopping a recording
// puts them up: the free review on the graph, the take marked onto the pages.
// Built rather than played, because what is under test is the review's SURFACE
// and a microphone adds nothing to it but minutes and weather.
const built = await page.evaluate(async ({ b64 }) => {
  const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const { scoreId, written } = await engravePart({
    base64: b64, name: 'Played scan', pages: 2, systems: 5, perSystem: 8, space: 13,
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
  // On the Score tab BEFORE the take is marked up: annotateTake draws the
  // pages only for somebody who is already looking at them.
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  await annotateTake(notes, { readings, a4: 440 });
  for (let i = 0; i < 40 && !document.querySelectorAll('.scan-bar').length; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    scoreId,
    bars: document.querySelectorAll('.scan-bar').length,
    pages: document.querySelectorAll('.scan-page').length,
    reviewShowing: document.querySelector('#score-review')?.hidden === false,
    playbackShowing: document.querySelector('#playback')?.hidden === false,
    summary: (document.querySelector('#score-tab-summary')?.textContent ?? '').slice(0, 120),
  };
}, { b64: font });
check('the review is up, with the pages barred and the graph under them',
  built.reviewShowing && built.playbackShowing && built.bars > 0,
  `${built.bars} bars on ${built.pages} pages`);

// The save bar belongs to a take being kept, which this one is not — it was
// built rather than recorded — so it is put up by hand. What is under test is
// whether a finger can reach it, not what decides to show it.
await page.evaluate(() => {
  const bar = document.querySelector('#score-save-bar');
  if (bar) bar.hidden = false;
  const save = document.querySelector('#score-save-take');
  if (save && !save.textContent) save.textContent = 'Save this take to Played scan';
});

// --- THE ASSERTION ----------------------------------------------------------
//
// Not "the button has a listener". The pixel in the middle of the button, and
// what is actually there to receive a finger.
const CONTROLS = ['#clip-play', '#score-save-take', '#score-discard-take'];
const reachable = async (sel) => page.evaluate(async (s) => {
  const el = document.querySelector(s);
  if (!el) return { missing: true };
  el.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 400));
  const b = el.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  const name = (n) => (n ? `${n.tagName}${n.id ? `#${n.id}` : ''}`
    + `${typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).join('.')}` : ''}` : 'nothing');
  return { ok: hit === el || el.contains(hit), onTop: name(hit) };
}, sel);

for (const sel of CONTROLS) {
  const r = await reachable(sel);
  check(`${sel} is what a finger lands on`, r.ok === true,
    r.missing ? 'not on the page' : `${r.onTop} is on top`);
}

// AT THE BOTTOM OF THE PAGE, WHICH IS WHERE A THUMB LEAVES IT.
//
// `scrollIntoView` centres a control, and a check that only ever asks the
// question there cannot see the other way a button goes missing on a phone: the
// tab bar floats over the foot of every screen, and the last row of a card can
// come to rest underneath it. Scrolling as far as the page goes is what
// somebody reaching for Save actually does.
const atRest = await page.evaluate(async (sels) => {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
  await new Promise((r) => setTimeout(r, 600));
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) { out[s] = 'missing'; continue; }
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    out[s] = (hit === el || el.contains(hit)) ? 'reachable'
      : `covered by ${hit?.id || hit?.className || hit?.tagName}`;
  }
  return out;
}, ['#score-save-take', '#score-discard-take']);
for (const sel of ['#score-save-take', '#score-discard-take']) {
  check(`${sel} is reachable with the page scrolled to the end`, atRest[sel] === 'reachable', atRest[sel]);
}

// No invisible sheet anywhere over the review: a layer of bar boxes belongs to
// a page of music and to nothing else.
const stray = await page.evaluate(() => [...document.querySelectorAll('.scan-bars')]
  .filter((l) => !l.parentElement?.classList.contains('scan-page'))
  .map((l) => `${l.tagName} in ${l.parentElement?.id || l.parentElement?.tagName}`));
check('every .scan-bars layer sits on a page and nowhere else', stray.length === 0, stray.join(', '));

// …AND THE SAME MISTAKE MADE ON PURPOSE, so it cannot come back by a name.
const withStray = await page.evaluate(async (sels) => {
  const line = document.querySelector('#score-tab-summary');
  const said = document.createElement('small');
  said.className = 'scan-pairing scan-bars';
  said.id = 'stray-sheet';
  said.textContent = 'a sentence that is not a layer';
  line.append(said);
  await new Promise((r) => setTimeout(r, 300));
  const box = said.getBoundingClientRect();
  const out = { sheet: [Math.round(box.width), Math.round(box.height)] };
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) { out[s] = 'missing'; continue; }
    el.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 300));
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    out[s] = (hit === el || el.contains(hit)) ? 'reachable'
      : `covered by ${hit?.id || hit?.className || hit?.tagName}`;
  }
  said.remove();
  return out;
}, CONTROLS);
for (const sel of CONTROLS) {
  check(`${sel} survives a stray .scan-bars sentence`, withStray[sel] === 'reachable',
    `${withStray[sel]}; the sentence measured ${withStray.sheet?.join('x')}`);
}

// And then the thing the taps are FOR.
const transport = await page.evaluate(async () => {
  const bar = document.querySelectorAll('.scan-bar')[3];
  if (!bar) return { pressed: 'no bars' };
  bar.click();
  await new Promise((r) => setTimeout(r, 800));
  const playing = document.querySelector('#clip-play')?.textContent;
  const zoomOpen = document.querySelector('#note-zoom')?.hidden === false;
  const btn = document.querySelector('#clip-play');
  btn.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 300));
  const b = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  const reached = hit === btn || btn.contains(hit);
  btn.click();
  await new Promise((r) => setTimeout(r, 700));
  return { pressed: 'yes', playing, zoomOpen, reached, afterPause: btn.textContent };
});
check('a bar press starts the take', transport.playing === '❚❚', `button read ${transport.playing}`);
// The LIGHT that runs along the bars is deliberately not asserted here: it is
// driven from inside the playback tick on requestAnimationFrame, and rAF does
// not run in the headless shell — the transport starts, the audio object
// exists, and no frame ever arrives. `npm run score:follow` is where that is
// measured, in a harness built to drive frames.
check('a bar press opens the close-up under the graph', transport.zoomOpen === true,
  transport.zoomOpen ? '' : '#note-zoom stayed hidden');
check("and the graph's own button stops it",
  transport.reached === true && transport.afterPause === '▶',
  `${transport.reached ? 'reached' : 'BLOCKED'}, button read ${transport.afterPause}`);

// POINTING AT THE GRAPH IS A SEEK, NOT A STOP.
//
// Tapping the trace used to pause: you were listening, you pointed at the
// passage you wanted, and the sound went out. "I should be able to play and
// pause from any of them, and they should all kind of work together."
const seek = await page.evaluate(async () => {
  const btn = document.querySelector('#clip-play');
  btn.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 300));
  if (btn.textContent !== '❚❚') btn.click();
  await new Promise((r) => setTimeout(r, 600));
  const before = btn.textContent;
  const canvas = document.querySelector('#pitch-chart');
  const b = canvas.getBoundingClientRect();
  // A tap two-thirds of the way along whatever part of the trace is on screen.
  canvas.dispatchEvent(new MouseEvent('click', {
    bubbles: true, clientX: b.left + b.width * 0.66, clientY: b.top + b.height / 2,
  }));
  await new Promise((r) => setTimeout(r, 700));
  return { before, after: btn.textContent };
});
check('a tap on the graph seeks and keeps playing',
  seek.before === '❚❚' && seek.after === '❚❚',
  `${seek.before} → ${seek.after}`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
