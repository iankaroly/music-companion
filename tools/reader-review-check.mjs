// STOP A TAKE ON THE MUSIC, AND LAND ON THE REVIEW.
//
// "when i record on an opened score, and stop recording, it should take me to a
// new window to analyze the recording like we set up. right now nothing
// happens, but it should bring me to that window where i have the score and i
// can click and get the options about pitch and different things."
//
// Two faults behind that one sentence, and only one of them was navigation:
//
//   the review was never BUILT. `annotateTake` opens with `if (!current)
//   return null`, and `openScoreFromLibrary` — the shelf, which is how you open
//   a scan — went straight to the reader for a `pages` score without ever
//   choosing it. So the app did not think any score was open. The reader knew
//   which page was on the screen and it was the only thing that did.
//
//   and the review was never SHOWN. It draws behind the reader, which is
//   full-screen, so stopping looked like nothing happening.
//
// THIS CHECK GOES THROUGH THE DOOR HE GOES THROUGH. `reader:record` calls
// `openReader(await loadScore(id))` directly, which skips everything above and
// is exactly why it could pass while this was broken. Here the score is opened
// by PRESSING ITS ROW IN THE LIBRARY.
//
// NO MICROPHONE IS EVER OPENED — `getUserMedia` is replaced before the app
// loads, and the fake device plays a few separated notes so there is something
// for the segmenter to find.
//
//   npm run dev              (on 5199)
//   npm run reader:review

import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  // A LONG EVALUATE NEEDS A LONG PROTOCOL TIMEOUT, and puppeteer's default is
  // three minutes. This check records a real take through the fake microphone
  // and waits for the analysis inside one call: MEASURED, 36s end to end on a
  // quiet machine — and about five times that with the rest of the suite and a
  // second browser competing for the CPU, which is over the default and comes
  // back as `Runtime.callFunctionOn timed out`. A loaded machine then reads as
  // a broken app, which cost three false alarms in one sitting.
  //
  // It does not make anything faster; it stops the wait being mistaken for a
  // fault. `press-hear-check.mjs`, which records the same way, has had this
  // since it was written — these three were simply missed.
  protocolTimeout: 240000,
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// A fake microphone that PLAYS SOMETHING: four separated notes, because a take
// the segmenter finds nothing in is discarded and never reaches a review, and
// a check whose take is empty would be measuring the wrong branch.
await page.evaluateOnNewDocument(() => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fake = ctx.createMediaStreamDestination();
  // A cello-ish tone, not a sine: YIN wants a harmonic series, and a bare sine
  // at cello pitch is the one thing a pitch tracker can be shy about.
  const level = ctx.createGain();
  level.gain.value = 0;
  const partials = [1, 2, 3, 4].map((n) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.6 / n;
    osc.connect(g).connect(level);
    osc.start();
    return { osc, n };
  });
  level.connect(fake);
  // A FRESH STREAM EVERY TIME IT IS ASKED FOR. The app stops the tracks when a
  // take finishes, which is right; handing back the same MediaStream on the
  // second take hands back stopped tracks, and the app correctly reports "the
  // microphone is open but no sound is coming through it". A check that records
  // twice needs a microphone that can be opened twice.
  const streams = [];
  window.__playNotes = async (midi, each = 0.55) => {
    // THE CONTEXT IS SUSPENDED until something resumes it — nothing in this
    // page ever gestured at it — and a suspended context's clock does not move,
    // so the stream is silence and the take is discarded. This cost a round.
    await ctx.resume();
    const now = ctx.currentTime + 0.1;
    midi.forEach((m, i) => {
      const at = now + i * each;
      const hz = 440 * (2 ** ((m - 69) / 12));
      for (const { osc, n } of partials) osc.frequency.setValueAtTime(hz * n, at);
      level.gain.setValueAtTime(0.0001, at);
      level.gain.exponentialRampToValueAtTime(0.8, at + 0.03);
      level.gain.setValueAtTime(0.8, at + each * 0.72);
      level.gain.exponentialRampToValueAtTime(0.0001, at + each * 0.84);
    });
    return midi.length * each + 0.4;
  };
  // …and a take with NOTHING in it, which is a different branch and the one
  // somebody hits when they tap the dot and then think better of it.
  window.__playNothing = async () => { await ctx.resume(); };
  // WHERE PLAYBACK WAS ASKED TO BEGIN, measured as the LENGTH of the clip it
  // started. `playFullFrom` extracts the samples from the seek point to the end
  // and plays that clip from zero, so there is no offset to read — but a clip
  // that runs to the end of the take is exactly `duration - from` long. Press
  // the first bar and then another, and one divided by the other says how far
  // through the take the second press landed, with nothing imported from the
  // app and no second module instance to get wrong.
  window.__clips = [];
  const realStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function start(...rest) {
    if (this.buffer) window.__clips.push(this.buffer.duration);
    return realStart.apply(this, rest);
  };
  navigator.mediaDevices.getUserMedia = async () => {
    await ctx.resume();
    const out = ctx.createMediaStreamDestination();
    level.connect(out);
    streams.push(out);
    return out.stream;
  };
});
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1400));

const out = {};

// Past the welcome screen, and a scanned part in the library to open.
//
// ENGRAVED, not drawn staves: the page reader prices a page by its clef, and a
// page with none is a page the review can say nothing about. See the note in
// CLAUDE.md about the scan fixtures.
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
out.made = await page.evaluate(async (base64) => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await new Promise((r) => setTimeout(r, 500));
  try {
    const { engravePart } = await import('/src/fixtures/engraved-page.js');
    const made = await engravePart({ base64, name: 'stop and look at it', pages: 1 });
    const { listScores } = await import('/src/store/db.js');
    // THE PAGE'S OWN NOTES, so the take is of this music rather than of eight
    // unrelated pitches. The review REFUSES to place marks on a take it cannot
    // tell is the same piece — "too few notes to tell whether this is the same
    // music" — and a check played eight notes into it passes on a review that
    // has explicitly declined to do the thing he asked for.
    return {
      id: made.scoreId,
      midi: made.written.map((w) => w.midi).filter((m) => m != null),
      scores: (await listScores()).map((s) => `${s.id}:${s.name}:${s.kind}`),
    };
  } catch (err) { return { error: String(err) }; }
}, font);
console.log('made:', JSON.stringify(out.made));

// RELOADED, on purpose. The fixture writes to the database behind the app's
// back, and the shelf is built when the app starts — so without this the Score
// tab honestly says "No scores yet" and the check is testing an empty shelf.
// A reload is also closer to what he does: the scan was taken yesterday.
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1600));
await page.evaluate(async () => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await new Promise((r) => setTimeout(r, 400));
});

// THE DOOR: the shelf on the Score tab, and a press on the piece's row. That
// is how a scan gets opened — the Library lists TAKES, not scores.
out.openedFromTheShelf = await page.evaluate(async () => {
  const nav = document.querySelector('nav[role="tablist"]');
  [...nav.querySelectorAll('button')]
    .find((b) => /score/i.test(b.textContent ?? ''))?.click();
  await new Promise((r) => setTimeout(r, 1200));
  const row = [...document.querySelectorAll('button')]
    .find((b) => /stop and look at it/i.test(b.textContent ?? ''));
  if (!row) {
    return { ok: false, buttons: [...document.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null)
      .map((b) => (b.textContent ?? '').trim().slice(0, 40)).filter(Boolean) };
  }
  row.click();
  await new Promise((r) => setTimeout(r, 3000));
  return { ok: !document.querySelector('#reader')?.hidden };
});
if (!out.openedFromTheShelf.ok) {
  console.log('shelf:', JSON.stringify(out.openedFromTheShelf.buttons));
  await page.screenshot({ path: `${process.env.TMPDIR ?? '/tmp'}/reader-review-shelf.png` });
}
out.openedFromTheShelf = out.openedFromTheShelf.ok;

// FIRST, A TAKE WITH NOTHING IN IT. Tap the dot, play nothing, tap it again.
// That must NOT throw you out of your music to tell you it heard nothing — the
// page stays, and the word is said over it. This branch had never once been
// watched render before it was asserted.
Object.assign(out, await page.evaluate(async () => {
  const r = {};
  const button = document.querySelector('#reader-record');
  r.dotThere = !!button && !button.hidden;
  if (!r.dotThere) return r;
  const press = async () => {
    button.click();
    await new Promise((x) => setTimeout(x, 400));
  };
  await press();
  for (let i = 0; i < 80 && !button.classList.contains('recording'); i += 1) {
    await new Promise((x) => setTimeout(x, 100));
  }
  await window.__playNothing();
  await new Promise((x) => setTimeout(x, 1800));
  button.click();
  await new Promise((x) => setTimeout(x, 1500));
  r.silentKeptTheMusic = !document.querySelector('#reader')?.hidden;
  r.silentSaidSo = document.querySelector('#reader-hint')?.textContent ?? null;
  return r;
}));

// …and then the real take, from the dot on the music.
Object.assign(out, await page.evaluate(async (midi) => {
  const r = {};
  const button = document.querySelector('#reader-record');
  button.click();
  for (let i = 0; i < 80 && !button.classList.contains('recording'); i += 1) {
    await new Promise((x) => setTimeout(x, 100));
  }
  r.recording = button.classList.contains('recording');
  // THE WHOLE PAGE, not part of it. A take that stops half way down is placed
  // correctly at half way down, so a check that plays half and then expects a
  // press at four fifths of the page to land at four fifths of the take is
  // asserting something false. He plays the page.
  const seconds = await window.__playNotes(midi, 0.32);
  await new Promise((x) => setTimeout(x, seconds * 1000 + 600));
  button.click();
  return r;
}, out.made.midi ?? []));

// Stopping runs the analysis and the engraver; give it room.
await new Promise((r) => setTimeout(r, 6000));

Object.assign(out, await page.evaluate(() => {
  const r = {};
  r.readerClosed = !!document.querySelector('#reader')?.hidden;
  const pane = document.querySelector('#pane-score, [data-pane="score"], #score');
  r.onTheScoreTab = localStorage.getItem('tab');
  // THE THING HE ASKED FOR: the score, on screen, with something to press.
  const stage = document.querySelector('#score-stage');
  const canvas = stage?.querySelector('canvas');
  r.pageOnScreen = !!canvas && canvas.getBoundingClientRect().height > 150;
  // THE PITCH MARKS, counted APART from the bar boxes. `.scan-bar` is the
  // marking layer and it is there whether or not the take was placed; a check
  // that adds the two together passes on a review that refused to say anything
  // about the notes — which is the half of his sentence about "the options
  // about pitch".
  r.pitchMarks = stage ? stage.querySelectorAll('.scan-note').length : 0;
  r.barBoxes = stage ? stage.querySelectorAll('.scan-bar, .bar-sync-bar').length : 0;
  // Syncing the audio to the bars is on hold for this release — BAR_SYNC in
  // ui/score.js. Read here, inside the page, because by the time the lines
  // below are printed the frame this ran in is gone. `import()` rather than
  // `await import()`: this function is not async, and the answer is a build
  // switch that cannot change while it resolves.

  r.summary = document.querySelector('#score-tab-summary')?.textContent?.trim() ?? '';
  // THE GRAPH, UNDER THE SCORE. He asked for it in those words, and the Score
  // tab deliberately did not borrow it.
  const dock = document.querySelector('#score-dock');
  const chart = dock?.querySelector('#chart-scroll');
  r.graphUnderTheScore = !!chart && chart.getBoundingClientRect().height > 20;
  r.graphIsBelow = !!chart && !!stage
    && chart.getBoundingClientRect().top >= stage.getBoundingClientRect().top;
  // AND NO TAPPING REQUIRED. A strip still in marking mode is a page where
  // every bar is inert until somebody finds the moment by ear.
  r.askedToMark = !!document.querySelector('.bar-sync-bar.marking');
  r.barLine = document.querySelector('.bar-sync-say')?.textContent?.trim() ?? '';
  r.recordStatus = document.querySelector('#status')?.textContent?.trim()
    ?? document.querySelector('#rec-status')?.textContent?.trim() ?? '(no status el)';
  r.hintOnTheMusic = document.querySelector('#reader-hint')?.textContent ?? null;
  r.paneShowing = pane ? !pane.hidden : null;
  return r;
}));

// PRESS A BAR IN THE MIDDLE OF THE PAGE, with nothing tapped and nothing
// marked, and see where the audio is asked to start. Even division says a bar
// two thirds of the way down a page played in one pass should be about two
// thirds of the way through the take.
Object.assign(out, await page.evaluate(async () => {
  const r = {};
  const boxes = [...document.querySelectorAll('#score-stage .scan-bar')];
  r.barsPressable = boxes.length;
  if (!boxes.length) return r;
  const stop = () => document.querySelector('#clip-play')?.click();
  const settle = (ms) => new Promise((x) => setTimeout(x, ms));
  // THE RULER: ↺ plays the take from the beginning, so the clip it starts is
  // the whole thing. Reading the presses against the FIRST BAR instead would
  // measure how far through what is left of the take each one landed, which is
  // a different number whenever bar one is not at second zero.
  window.__clips = [];
  document.querySelector('#clip-restart')?.click();
  await settle(700);
  const whole = window.__clips[0] ?? 0;
  stop();
  await settle(300);
  r.wholeTake = +whole.toFixed(2);
  if (!whole) return r;

  // Three presses across the page. What is asserted is what a player would
  // check: they land in order, and each lands about where its bar sits.
  r.presses = [];
  for (const share of [0.15, 0.5, 0.85]) {
    const which = Math.min(boxes.length - 1, Math.floor(boxes.length * share));
    const box = boxes[which];
    window.__clips = [];
    box.click();
    await settle(700);
    const clip = window.__clips.at(-1);
    stop();
    await settle(250);
    const first = Number(boxes[0].dataset.at);
    const end = Number(boxes.at(-1).dataset.to);
    r.presses.push({
      bar: which,
      // Where the bar sits on the page, in systems, as a share of the page.
      onThePage: +((Number(box.dataset.at) - first) / (end - first)).toFixed(3),
      // …and where in the take it started.
      inTheTake: clip === undefined ? null : +(1 - clip / whole).toFixed(3),
    });
  }
  r.ofBars = boxes.length;

  // PRESSING A NOTEHEAD GOES TO ITS BAR, not to the note. "I don't want to be
  // able to press the note head. If you press the note head, I just want to
  // start at the beginning of that bar."
  // A ring that is actually ON SCREEN: elementFromPoint answers about the
  // viewport, and a long part scrolls most of its rings out of it.
  const ring = [...document.querySelectorAll('#score-stage .scan-note')].find((one) => {
    const b = one.getBoundingClientRect();
    return b.width > 0 && b.top > 4 && b.bottom < window.innerHeight - 4
      && b.left > 4 && b.right < window.innerWidth - 4;
  });
  if (ring) {
    const at = ring.getBoundingClientRect();
    const x = at.left + at.width / 2;
    const y = at.top + at.height / 2;
    // What is actually under a finger there — a mark, or the bar box.
    const hit = document.elementFromPoint(x, y);
    r.overARingYouHit = hit?.className ?? null;
    const inBar = hit?.classList?.contains('scan-bar') ? hit : null;
    if (inBar) {
      window.__clips = [];
      inBar.click();
      await settle(700);
      const clip = window.__clips.at(-1);
      stop();
      await settle(250);
      const first = Number(boxes[0].dataset.at);
      const end = Number(boxes.at(-1).dataset.to);
      r.ringPress = {
        // Where the START of that bar sits on the page…
        barStarts: +((Number(inBar.dataset.at) - first) / (end - first)).toFixed(3),
        inTheTake: clip === undefined ? null : +(1 - clip / whole).toFixed(3),
      };
    }
  }
  // …and no note close-up anywhere: that readout is gone from the scan.
  r.noteReadout = document.querySelectorAll('#score-stage .scan-reading, .scan-reading').length;
  // …and it must NOT have thrown the page full screen over what it just started.
  r.readerOpenedOnTap = !document.querySelector('#reader')?.hidden;
  return r;
}));

await page.screenshot({ path: `${process.env.TMPDIR ?? '/tmp'}/reader-review.png` });
await browser.close();

const say = (label, value, want) => {
  console.log(`${label.padEnd(46)}${String(value).padEnd(20)}${want ? `(want ${want})` : ''}`);
};
say('the shelf opens the scan in the reader', out.openedFromTheShelf, 'true');
say('the dot is there', out.dotThere, 'true');
say('and it records', out.recording, 'true');
say('stopping leaves the music', out.readerClosed, 'true');
say('…for the Score tab', out.onTheScoreTab, '"score"');
say('a silent take keeps you on the page', out.silentKeptTheMusic, 'true');
say('…and says so over the music', JSON.stringify(out.silentSaidSo), 'a sentence');
say('the page is on screen', out.pageOnScreen, 'true');
say('with a mark on each note played', out.pitchMarks, '> 0');
// SYNCING THE AUDIO TO THE BARS IS ON HOLD for this release — BAR_SYNC in
// ui/score.js. The lines about bars are paused with it and come back untouched
// when it moves; everything above and below them is the review itself, which is
// what this file is really about: the page on screen, a mark on each note
// played, the summary, the graph under it, and the stand not opening on a tap.
// IS THE BAR LAYER ON? Read off the source rather than out of the page. This
// check reloads, so an evaluate asked at the wrong moment lands on a detached
// frame — and reading it here cannot go stale the way a hard-coded skip would:
// it is the same line the app compiles.
const barsOn = !/const BAR_SYNC = false/.test(
  await readFile(new URL('../src/ui/score.js', import.meta.url), 'utf8'));
if (barsOn) say('and bars to tap for the moment', out.barBoxes, '> 0');
else console.log('  (bars: on hold for this release — see BAR_SYNC in ui/score.js)');
say('and it says what it heard', JSON.stringify(out.summary.slice(0, 60)), 'not empty');
say('the graph is under the score', out.graphUnderTheScore && out.graphIsBelow, 'true');
say('no tapping needed first', !out.askedToMark, 'true');
if (barsOn) {
  say('  …it says', JSON.stringify(out.barLine.slice(0, 58)), '');
  say('bars you can press', out.barsPressable, '> 0');
}
console.log(`the take is ${out.wholeTake}s long; three presses across the page:`);
for (const one of out.presses ?? []) {
  console.log(`   bar ${String(one.bar).padStart(2)} of ${out.ofBars}`
    + `  ${(one.onThePage * 100).toFixed(0)}% down the page`
    + `  ->  ${one.inTheTake === null ? 'nothing played' : `${(one.inTheTake * 100).toFixed(0)}% into the take`}`);
}
if (barsOn) {
  say('a finger over a ring hits', out.overARingYouHit, 'scan-bar');
  say('  …and that press goes to the bar start',
    out.ringPress ? `${(out.ringPress.inTheTake * 100).toFixed(0)}% into the take` : '(not reached)',
    out.ringPress ? `about ${(out.ringPress.barStarts * 100).toFixed(0)}%` : '');
  say('no note close-up on the scan', out.noteReadout, '0');
}
say('and it did NOT open full screen', !out.readerOpenedOnTap, 'true');
console.log('record status:', JSON.stringify(out.recordStatus), ' hint:', JSON.stringify(out.hintOnTheMusic));
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
console.log(`shot: ${process.env.TMPDIR ?? '/tmp'}reader-review.png`);

const ok = out.openedFromTheShelf && out.dotThere && out.recording
  && out.readerClosed && out.onTheScoreTab === 'score'
  && out.pageOnScreen && out.pitchMarks > 0 && (!barsOn || out.barBoxes > 0)
  && out.summary.length > 0
  && out.silentKeptTheMusic && (out.silentSaidSo ?? '').length > 0
  && out.graphUnderTheScore && out.graphIsBelow
  && !out.askedToMark
  // EVERYTHING FROM HERE TO THE CLOSE-UP IS THE BAR PRESS, and syncing the
  // audio to the bars is on hold for this release — BAR_SYNC in ui/score.js.
  // The clauses come back with it, unchanged. What stays above is this file's
  // real subject: the take opens on its own music, the page is on screen with a
  // mark on every note played, it says what it heard, the graph is under it,
  // and a tap does not throw the stand over the lot.
  && (!barsOn || (out.barsPressable > 0
    && (out.presses ?? []).length === 3
    && out.presses.every((one) => one.inTheTake !== null)
    // In order, and each within a fifth of where its bar sits. A press that
    // plays SOMETHING is not the promise; a press that plays that bar is.
    && out.presses[0].inTheTake < out.presses[1].inTheTake
    && out.presses[1].inTheTake < out.presses[2].inTheTake
    && out.presses.every((one) => Math.abs(one.inTheTake - one.onThePage) < 0.2)
    && String(out.overARingYouHit ?? '').includes('scan-bar')
    && out.ringPress && out.ringPress.inTheTake !== null
    && Math.abs(out.ringPress.inTheTake - out.ringPress.barStarts) < 0.2
    && out.noteReadout === 0))
  && !out.readerOpenedOnTap;
console.log(ok ? '\nPASS — stop playing, and the take is in front of you on the page' : '\nFAIL');
process.exit(ok ? 0 : 1);
