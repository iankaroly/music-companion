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
  const seconds = await window.__playNotes(midi.slice(0, 34), 0.34);
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
  r.summary = document.querySelector('#score-tab-summary')?.textContent?.trim() ?? '';
  r.recordStatus = document.querySelector('#status')?.textContent?.trim()
    ?? document.querySelector('#rec-status')?.textContent?.trim() ?? '(no status el)';
  r.hintOnTheMusic = document.querySelector('#reader-hint')?.textContent ?? null;
  r.paneShowing = pane ? !pane.hidden : null;
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
say('and bars to tap for the moment', out.barBoxes, '> 0');
say('and it says what it heard', JSON.stringify(out.summary.slice(0, 60)), 'not empty');
console.log('record status:', JSON.stringify(out.recordStatus), ' hint:', JSON.stringify(out.hintOnTheMusic));
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
console.log(`shot: ${process.env.TMPDIR ?? '/tmp'}reader-review.png`);

const ok = out.openedFromTheShelf && out.dotThere && out.recording
  && out.readerClosed && out.onTheScoreTab === 'score'
  && out.pageOnScreen && out.pitchMarks > 0 && out.barBoxes > 0
  && out.summary.length > 0
  && out.silentKeptTheMusic && (out.silentSaidSo ?? '').length > 0;
console.log(ok ? '\nPASS — stop playing, and the take is in front of you on the page' : '\nFAIL');
process.exit(ok ? 0 : 1);
