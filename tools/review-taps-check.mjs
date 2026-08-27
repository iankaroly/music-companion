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

// A BAR PRESSED WHILE THE TAKE IS ALREADY RUNNING.
//
// "when I click on a bar, it should start playing from that bar. Even if it's
// playing somewhere else in the score, I should click the bar and it starts
// from that bar." Every earlier assertion here presses a bar from a standing
// start, which is a different code path from the inside: playClip has to tear
// down a source that is mid-flight and put up another without the old one's
// `onended` reporting the new one as finished.
//
// WHAT IS ASSERTED. Not the audio clock — there is no rAF in the headless
// shell, so the playhead never advances and a position read here would be the
// number that was set, not the number that was played. What can be seen is
// that the press was HONOURED: the transport stayed running rather than
// falling back to ▶, and the close-up under the graph moved to a different
// note — which is `selectAtMoment` answering the new second, and the one
// visible thing that says the press landed somewhere else in the take.
const midPlay = await page.evaluate(async () => {
  const btn = document.querySelector('#clip-play');
  const bars = [...document.querySelectorAll('.scan-bar')];
  if (bars.length < 12) return { bars: bars.length };
  bars[2].click();
  await new Promise((r) => setTimeout(r, 700));
  const first = { play: btn.textContent, note: document.querySelector('#zoom-label')?.textContent };
  // …and now, without pausing anything, a bar most of the way through.
  bars[bars.length - 3].click();
  await new Promise((r) => setTimeout(r, 700));
  const second = { play: btn.textContent, note: document.querySelector('#zoom-label')?.textContent };
  return { first, second };
});
check('a bar pressed while the take is running keeps it running',
  midPlay.first?.play === '❚❚' && midPlay.second?.play === '❚❚',
  `${midPlay.first?.play ?? `only ${midPlay.bars} bars`} → ${midPlay.second?.play ?? ''}`);
check('…and moves the take to that bar',
  !!midPlay.second?.note && midPlay.second.note !== midPlay.first?.note,
  `“${midPlay.first?.note ?? ''}” → “${midPlay.second?.note ?? ''}”`);

// THE PRESS ON A TAKE THE APP COULD NOT PLACE used to be measured here, by
// pressing "Start again" to throw the marks away and leave the layer with no
// map. That button is gone — marking a bar again replaces the anchor at that
// place and marking another bar replaces the start, so nothing needed a third
// control that undid both — and with it went the only way to reach that state
// from this fixture, whose take the app places for itself.
//
// The coverage did not go with it: `npm run scan:barsync` mounts the layer with
// no take at all, which IS the unplaced state, and drives the whole gesture
// from there — starts in marking mode, two marks make the map, and a third
// press then plays the second the map says. What this file could add to that
// was the transport, and the transport is asserted three checks above.
//
// The take is left paused, which is where the block below expects it: the
// graph is sampled either side of a filter and a playhead moving between the
// samples is a difference nobody asked about.
await page.evaluate(async () => {
  const btn = document.querySelector('#clip-play');
  if (btn.textContent === '❚❚') { btn.click(); await new Promise((r) => setTimeout(r, 400)); }
});

// ONLY THE NOTES THAT WERE HELD.
//
// "you can select a duration, like 0.5 seconds and up… It'll only show you the
// pitches, like the notes, that were sustained for that amount of time or
// longer." The fixture take holds every note for 0.3s, so a threshold either
// side of that says whether the picker is doing arithmetic on the take or just
// setting a class: at 0.25s every tile stays, at 0.5s none of them do.
//
// It also checks the thing that makes this safe to do at all — that a filtered
// note is HIDDEN and not removed. `tileByNote` is how a notehead pressed on the
// page finds its tile, and a detached tile would throw the moment somebody
// pressed a short note on the music.
const held = await page.evaluate(async () => {
  const field = document.querySelector('#held-least');
  if (!field) return { missing: true };
  const tiles = () => [...document.querySelectorAll('#report-grid .degree')];
  const shown = () => tiles().filter((t) => !t.hidden).length;
  const canvas = document.querySelector('#pitch-chart');
  // WHAT THE GRAPH IS SHOWING, as a number. The bands are the only thing on
  // that canvas painted in the three verdict fills, so counting pixels that are
  // NOT the ground and not the trace's grey is a direct count of how much of
  // the take is being claimed about. A picture that does not move when the
  // filter does is the fault this exists to catch — the two screenshots either
  // side of a pick used to be byte-identical.
  const tinted = () => {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let on = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const gg = d[i + 1];
      const b = d[i + 2];
      // A verdict fill is tinted: one channel clearly away from the other two.
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 10) on += 1;
    }
    return on;
  };
  // Typed, the way a finger types — an `input` event per keystroke, which is
  // what the field listens for.
  const type = async (text) => {
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
  };
  await type('');
  const all = shown();
  const allTint = tinted();
  // The fixture holds every note for 0.3s, so 0.25 keeps them all and 0.5 none.
  await type('0.25');
  const quarter = shown();
  const quarterTint = tinted();
  await type('0.5');
  const half = shown();
  const halfTint = tinted();
  const summary = document.querySelector('#notes-summary')?.textContent ?? '';
  const stillThere = tiles().length;
  const typed = field.value;
  // …and a filtered note pressed on the page still opens and plays.
  let pressed = 'not tried';
  try {
    const bar = document.querySelectorAll('.scan-bar')[4];
    bar?.click();
    await new Promise((r) => setTimeout(r, 500));
    pressed = document.querySelector('#note-zoom')?.hidden === false ? 'opened' : 'stayed shut';
  } catch (err) { pressed = `threw ${err.message}`; }
  await type('');
  const backTint = tinted();
  return {
    all, quarter, half, summary, stillThere, pressed, typed,
    allTint, quarterTint, halfTint, backTint,
  };
});

check('a duration typed into the field filters the note list',
  held.all > 0 && held.quarter === held.all && held.half === 0,
  `empty → ${held.all}, 0.25 → ${held.quarter}, 0.5 → ${held.half} (notes are held 0.3s)`);
// THE PICTURE MOVES WITH IT. This is the assertion the previous round did not
// have, and its absence is why the graph sat unchanged for a fortnight while
// every other assertion about the filter passed.
check('…and the graph stops claiming anything about the notes it dropped',
  held.halfTint < held.allTint * 0.2
  && Math.abs(held.quarterTint - held.allTint) < held.allTint * 0.01,
  `tinted pixels: empty ${held.allTint}, 0.25 ${held.quarterTint}, 0.5 ${held.halfTint}`);
check('…and they come back when the field is cleared',
  Math.abs(held.backTint - held.allTint) < held.allTint * 0.02,
  `${held.allTint} → ${held.halfTint} → ${held.backTint}`);
check('…and says so where the count is',
  /held 0.5s or longer/.test(held.summary), `“${held.summary}”`);
check('…and hides the tiles rather than removing them',
  held.stillThere === held.all, `${held.stillThere} tiles still in the grid`);
check('…and a filtered note pressed on the page still opens',
  held.pressed === 'opened', held.pressed);
check('…and the field holds the number that was typed', held.typed === '0.5',
  `the field read "${held.typed}"`);

// --- THE LADDER, AND THE NOTES IT PUTS UP ----------------------------------
//
// "the presets could be 0.5 / 0.75 / 1 / 1.5 / 2 seconds… as soon as you select
// one of those options, it shows you the list of the notes that comply with
// those standards. You can just click on one of them, and it'll take you to
// that part of the graph."
//
// A SECOND TAKE, because the one above holds every note for 0.3s — every rung
// of the ladder starts at half a second, so against that fixture all six of
// them would only ever exercise the empty case. This one alternates 0.35s and
// 1.4s and runs long enough that the graph has somewhere to scroll TO, which is
// the half of the promise a highlight cannot prove.
const jumps = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const notes = [];
  let at = 0.4;
  for (let i = 0; i < 24; i += 1) {
    const held = i % 4 === 3 ? 1.4 : 0.35;   // one long note in every four
    const midi = 55 + (i % 9);
    notes.push({
      start: at,
      end: at + held,
      midi,
      name: null,
      cents: (i % 3) * 9 - 9,
      frequency: 440 * (2 ** ((midi - 69) / 12)),
    });
    at += held + 0.25;
  }
  const readings = notes.map((n) => ({
    time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
  }));
  const seconds = Math.ceil(notes.at(-1).end) + 1;
  const audio = new Float32Array(44100 * seconds);
  for (let i = 0; i < audio.length; i++) audio[i] = Math.sin(i * 0.05) * 0.2;
  const { Recorder } = await import('/src/audio/recording.js');
  const rec = new Recorder(44100);
  rec.push(audio);
  const { renderFreeReview } = await import('/src/ui/report.js');
  document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
  await wait(300);
  renderFreeReview(document, notes, rec, { readings, a4: 440 });
  await wait(700);

  // WHAT A PRESS ON A LIST BUTTON STARTS, counted rather than assumed. A panel
  // that opens is not a note that sounded, and this repo has shipped 35 passing
  // assertions over a press that started nothing at all.
  let started = 0;
  const realStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function counted(...rest) {
    started += 1;
    return realStart.apply(this, rest);
  };

  const rung = (secs) => [...document.querySelectorAll('#held-presets button')]
    .find((b) => b.dataset.held === String(secs));
  const list = document.querySelector('#held-list');
  const buttons = () => [...list.querySelectorAll('.held-jump')];

  const out = { rungs: [...document.querySelectorAll('#held-presets button')].map((b) => b.textContent.trim()) };
  out.listHiddenAtAny = list.hidden;

  rung(1)?.click();
  await wait(400);
  out.field = document.querySelector('#held-least')?.value ?? null;
  out.lit = [...document.querySelectorAll('#held-presets button.active')].map((b) => b.textContent.trim());
  out.shown = buttons().length;
  out.longNotes = notes.filter((n) => n.end - n.start >= 1).length;
  // Every label carries BOTH: what the note is, and how far into the take.
  //
  // READ FROM THE TWO ELEMENTS, not from `textContent`. The name is a block <b>
  // over the time, so on the glass they are two lines — and run together as one
  // string "A#3" and "2.2s" become "A#32.2s", which a regex for a number reads
  // as thirty-two point two seconds. That cost this check a round.
  const partsOf = (b) => ({
    name: b.querySelector('b')?.textContent?.trim() ?? '',
    when: b.querySelector('span')?.textContent?.trim() ?? '',
  });
  out.labels = buttons().slice(0, 3).map((b) => {
    const p = partsOf(b);
    return `${p.name} at ${p.when}`;
  });
  out.allLabelled = buttons().every((b) => {
    const p = partsOf(b);
    return /^[A-G][#b]?-?\d$/.test(p.name) && /^\d+\.\ds$/.test(p.when);
  });
  // …and in the order they were played, which is the whole reason this is not
  // the grid said twice.
  out.times = buttons().map((b) => parseFloat(partsOf(b).when));
  out.inOrder = out.times.every((t, i, all) => i === 0 || t >= all[i - 1]);

  // THE JUMP. The last one in the list, because the graph is scrolled to the
  // left when the take opens and a note near the start would be visible already
  // — a check that presses one of those measures nothing.
  const scroller = document.querySelector('#chart-scroll');
  out.scrollBefore = scroller?.scrollLeft ?? null;
  out.scrollable = (scroller?.scrollWidth ?? 0) - (scroller?.clientWidth ?? 0);
  buttons().at(-1)?.click();
  await wait(700);
  out.scrollAfter = scroller?.scrollLeft ?? null;
  out.opened = document.querySelector('#note-zoom')?.hidden === false;
  out.sounded = started;
  out.zoomSays = document.querySelector('#zoom-label')?.textContent ?? null;

  rung(0)?.click();
  await wait(400);
  out.listHiddenAtAnyAgain = list.hidden;
  AudioBufferSourceNode.prototype.start = realStart;
  return out;
});

check('the ladder offers the five durations and a way back to all of them',
  jumps.rungs?.join(' ') === 'any 0.5s 0.75s 1s 1.5s 2s', `“${jumps.rungs?.join(' ')}”`);
check('choosing a rung puts up one button per note that qualified',
  jumps.shown > 0 && jumps.shown === jumps.longNotes,
  `${jumps.shown} buttons for ${jumps.longNotes} notes held 1s or longer`);
check('…each one saying what the note is and how far into the take it is',
  jumps.allLabelled === true, `first three: ${(jumps.labels ?? []).join(' | ')}`);
check('…in the order they were played', jumps.inOrder === true,
  (jumps.times ?? []).join(', '));
check('…and the rung and the typed field agree on the number',
  jumps.field === '1' && jumps.lit?.join(' ') === '1s',
  `field "${jumps.field}", lit “${jumps.lit?.join(' ')}”`);
// THE ASSERTION THE FEATURE IS FOR: "it'll take you to that part of the graph."
check('pressing one scrolls the graph to that moment',
  jumps.scrollable > 0 && jumps.scrollAfter > jumps.scrollBefore,
  `${jumps.scrollBefore} → ${jumps.scrollAfter} of ${jumps.scrollable} scrollable`);
check('…and opens that note and sounds it',
  jumps.opened === true && jumps.sounded > 0,
  `close-up ${jumps.opened ? 'open' : 'shut'}, ${jumps.sounded} source(s) started, “${jumps.zoomSays}”`);
check('and “any” puts the list away again',
  jumps.listHiddenAtAny === true && jumps.listHiddenAtAnyAgain === true,
  `hidden at first ${jumps.listHiddenAtAny}, hidden again ${jumps.listHiddenAtAnyAgain}`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
