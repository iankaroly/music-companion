// RECORDING WITHOUT LEAVING THE MUSIC.
//
// "when you select a score to record from, you can't actually read the music."
// That was true: recording lived on the Record tab, so pressing record put a
// tab of charts in front of somebody who was about to play from a page. The
// button on the reader fixes it, and the thing that could go wrong is not the
// button — it is that a second door into recording holds a second recorder.
// Two recorders is one microphone taken away from the other, which on iOS is
// silence with no error.
//
// So this presses the button on the music and checks that what starts is the
// SAME take the Record tab drives: one recorder, one state, both controls
// showing it.
//
// NO MICROPHONE IS EVER OPENED. `getUserMedia` is replaced before the app
// loads, so nothing here can turn a real microphone on — see the memory note
// about browser checks and cameras; the same rule holds for the mic.
//
//   npm run dev              (on 5199)
//   npm run reader:record

import puppeteer from 'puppeteer-core';

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
await page.setViewport({ width: 1100, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// A silent, fake microphone, installed before a line of the app runs.
await page.evaluateOnNewDocument(() => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const fake = ctx.createMediaStreamDestination();
  const quiet = ctx.createOscillator();
  quiet.frequency.value = 220;
  const level = ctx.createGain();
  level.gain.value = 0.05;
  quiet.connect(level).connect(fake);
  quiet.start();
  navigator.mediaDevices.getUserMedia = async () => fake.stream;
});
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 1400));

const report = await page.evaluate(async () => {
  const out = {};
  // Past the welcome screen and into a score to read.
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
  await new Promise((r) => setTimeout(r, 500));

  // A part to open: one drawn page is enough — what is being tested is the
  // control, not the music.
  const { savePagesScore } = await import('/src/store/db.js');
  const canvas = document.createElement('canvas');
  canvas.width = 700;
  canvas.height = 990;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 700, 990);
  g.fillStyle = '#111';
  for (let system = 0; system < 8; system += 1) {
    for (let line = 0; line < 5; line += 1) {
      g.fillRect(60, 90 + system * 105 + line * 9, 580, 2);
    }
  }
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  const id = await savePagesScore({
    name: 'record from here', source: 'photos', pageCount: 1,
    pages: [new File([blob], 'page-01.jpg', { type: 'image/jpeg' })],
  });

  const { openReader } = await import('/src/ui/reader.js');
  const { loadScore } = await import('/src/store/db.js');
  await openReader(await loadScore(id));
  await new Promise((r) => setTimeout(r, 600));

  const button = document.querySelector('#reader-record');
  out.hasButton = !!button;
  out.hiddenAtFirst = button ? button.hidden : null;
  // …and the music is on screen behind it, which is the whole point.
  const sheet = document.querySelector('#reader-sheet canvas, #reader-root canvas, #reader canvas');
  out.musicShowing = !!sheet && sheet.getBoundingClientRect().height > 200;

  if (!button || button.hidden) return out;

  button.click();
  // The mic, the count-in and the first capture take a moment.
  for (let i = 0; i < 60 && !button.classList.contains('recording'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  out.recordingShown = button.classList.contains('recording');
  // AND IT IS STILL ON SCREEN. This is the assertion that was missing: the
  // first version of this check read `hidden` once, before the take, and asked
  // only about the class afterwards — so it passed 10/10 against a button that
  // vanished on the first tick of the clock, leaving a take running with
  // nothing to stop it. Measured on the pixels, not on the class.
  const seen = () => {
    const box = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return !button.hidden && box.width > 20 && box.height > 20
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0.4;
  };
  out.stillVisibleWhileRecording = seen();
  // The Record tab's own button must be showing the same take.
  out.tabButtonSays = document.querySelector('#start')?.textContent ?? null;
  // And the music is STILL on screen while it records.
  out.musicWhileRecording = !!sheet && sheet.getBoundingClientRect().height > 200;
  out.readerStillOpen = !document.querySelector('#reader')?.hidden;

  // Play something into it, then stop from the same button. The clock ticks
  // several times over this second — every tick republishes the state, and it
  // was a tick that used to hide it.
  await new Promise((r) => setTimeout(r, 1200));
  out.stillVisibleASecondIn = seen();

  // …AND STILL THERE WITH THE PENCIL IN YOUR HAND.
  //
  // Marking a fingering while a take runs is one of the two things this reader
  // is for. The button moved into the top bar this round, and `#reader.drawing`
  // hides that bar outright — so picking up the pencil mid-take took the only
  // way to stop the take off the screen (measured: 0x0), which is the exact
  // hazard the floating dot it replaced existed to avoid. It moves to whichever
  // bar is showing now; this is the assertion that says so.
  document.querySelector('#reader-annotate')?.click();
  await new Promise((r) => setTimeout(r, 600));
  out.drawingModeOn = document.querySelector('#reader')?.classList.contains('drawing');
  const now = document.querySelector('#reader-record');
  out.stillVisibleWithThePencilOut = !!now && seen();
  out.stopReachableWhileDrawing = (() => {
    if (!now) return false;
    const b = now.getBoundingClientRect();
    if (!(b.width > 0 && b.height > 0)) return false;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return hit === now || now.contains(hit);
  })();
  // Put the pen down again; stopping is tested from the reading bar.
  document.querySelector('#reader-done')?.click();
  await new Promise((r) => setTimeout(r, 400));
  button.click();
  for (let i = 0; i < 60 && button.classList.contains('recording'); i += 1) {
    await new Promise((r) => setTimeout(r, 100));
  }
  out.stoppedFromTheSameButton = !button.classList.contains('recording');
  out.readerOpenAfter = !document.querySelector('#reader')?.hidden;
  out.tabButtonAfter = document.querySelector('#start')?.textContent ?? null;
  out.offeredAgainAfter = seen();
  return out;
});

await browser.close();

const say = (label, value, want) => {
  console.log(`${label.padEnd(44)}${String(value).padEnd(22)}${want ? `(want ${want})` : ''}`);
};
say('the button is on the reader', report.hasButton, 'true');
say('and it is offered', report.hiddenAtFirst === false, 'true');
say('the music is on screen', report.musicShowing, 'true');
say('pressing it starts a take', report.recordingShown, 'true');
say('and the button is STILL on screen', report.stillVisibleWhileRecording, 'true');
say('…still there a second into the take', report.stillVisibleASecondIn, 'true');
say('…and still there with the pencil out', report.stillVisibleWithThePencilOut, 'true');
say('…and a finger can reach it there', report.stopReachableWhileDrawing, 'true');
say('the Record tab shows the same take', report.tabButtonSays, '"Stop & review"');
say('the music is STILL on screen', report.musicWhileRecording, 'true');
say('and the reader is still open', report.readerStillOpen, 'true');
say('pressing it again stops the take', report.stoppedFromTheSameButton, 'true');
say('the reader is open afterwards', report.readerOpenAfter, 'true');
say('and the tab button has reset', report.tabButtonAfter, '"Record"');
say('and it is offered again', report.offeredAgainAfter, 'true');
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

const ok = report.hasButton && report.hiddenAtFirst === false
  && report.musicShowing && report.recordingShown
  && /stop/i.test(report.tabButtonSays ?? '')
  && report.musicWhileRecording && report.readerStillOpen
  && report.stillVisibleWhileRecording && report.stillVisibleASecondIn
  && report.drawingModeOn && report.stillVisibleWithThePencilOut
  && report.stopReachableWhileDrawing
  && report.stoppedFromTheSameButton && report.readerOpenAfter
  && report.offeredAgainAfter;
console.log(ok ? '\nPASS — one take, two doors, and the music never leaves the screen' : '\nFAIL');
process.exit(ok ? 0 : 1);
