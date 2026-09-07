// THE SCREENSHOTS THE APP STORE LISTING NEEDS, rendered rather than cropped.
//
// App Store Connect wants images at exact pixel sizes, and the app ships for
// iPhone AND iPad, so it wants both. These are produced at the size Apple asks
// for by rendering at the device's LOGICAL size and letting the device pixel
// ratio do the rest — 430x932 at 3x is 1290x2796, 1024x1366 at 2x is 2048x2732
// — so nothing is ever scaled up, and the type is as sharp as the screen it is
// pretending to be.
//
// The app is filled from the same fixtures `edge:fit` uses, so what is shown is
// the real interface with real content in it rather than an empty shell: a
// part on the shelf, a take against it, and the review drawn from the take.
//
//   npm run dev
//   npm run store:shots
//
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
const OUT = new URL('../docs/store/', import.meta.url);
await mkdir(OUT, { recursive: true });

// Logical size and scale chosen so the PNG lands exactly on the size asked for.
const DEVICES = [
  { name: 'iphone-6.9', width: 430, height: 932, scale: 3 },   // 1290 x 2796
  { name: 'ipad-13', width: 1024, height: 1366, scale: 2 },    // 2048 x 2732
];

// The five screens worth showing, in the order a listing should tell the story:
// what it hears, what it shows you, the music itself, the weeks, the practice.
//
// `settle` runs in the page after the tab is up and before the shot, for a
// screen whose resting state is not the one worth showing.
const SCREENS = [
  { tab: 'analyze', name: '1-what-you-played' },
  {
    tab: 'score', name: '2-on-the-music',
    // The review writes four paragraphs about the take above the music — what
    // was paired, what the barlines could and could not vouch for — and on a
    // phone the page itself only began two-thirds of the way down. MEASURED,
    // at 430x932: the head row ends at 122px, the prose runs 135 to 400, and
    // the whole document is 970px tall, so no scroll can carry the page above
    // the prose. The paragraph is hidden for this one shot instead, the way
    // the welcome card is; the head row, the page, the rings and the pager
    // are all exactly what the app draws. Not a change to the app: nothing
    // outside this screenshot ever sees it.
    settle: () => {
      const summary = document.querySelector('#score-tab-summary');
      if (summary) summary.hidden = true;
      document.scrollingElement.scrollTop = 0;
    },
  },
  { tab: 'tuner', name: '3-tuner' },
  { tab: 'coach', name: '4-coach' },
  { tab: 'metronome', name: '5-metronome' },
];

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
  protocolTimeout: 240000,
});

const made = [];
for (const device of DEVICES) {
  const page = await browser.newPage();
  await page.setViewport({
    width: device.width, height: device.height,
    deviceScaleFactor: device.scale, hasTouch: true, isMobile: true,
  });
  // The overview chart opens at 120 px per second, which on a phone shows the
  // first three seconds of a seventeen-second take — three notes of forty-eight
  // and a lot of empty ruled paper. The zoom is a stored preference the chart
  // reads once when its module loads, so it is set BEFORE the page's scripts
  // run, at the same 30 px/s floor the pinch gesture bottoms out at: about
  // thirteen seconds across a phone, the whole take across an iPad.
  await page.evaluateOnNewDocument(() => localStorage.setItem('chartPxPerSec', '30'));
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));

  await page.evaluate(async ({ bravura }) => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
    // EIGHT SYSTEMS, NOT FIVE. The stored page is trimmed to its ink, and
    // five systems of eight trim to a picture as wide as it is tall — which
    // on a phone left the page finishing halfway down the screen with the
    // background under it. Seven trimmed to 1.66:1 and still left a strip
    // under the pager where the Record tab's playback panel, borrowed into
    // the score dock, showed through the tab bar. Eight is the shape of a
    // printed part (about 1.9:1); the width-fitted page runs to the tab bar
    // on a phone and under it on an iPad, and the dock goes with it.
    const { scoreId, written } = await engravePart({
      base64: bravura, name: 'Bach — Menuet', pages: 2, systems: 8, perSystem: 8, space: 13,
    });
    const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
    const { renderFreeReview } = await import('/src/ui/report.js');
    const { Recorder } = await import('/src/audio/recording.js');
    await selectScore(scoreId);
    await measurePages(scoreId);
    // Sixty-four notes is the whole first page: a ring on every notehead, and
    // no dashed system at the foot asking why it was not played.
    const notes = takeFromWritten(written, { from: 0, count: 64, spacing: 0.35, sounding: 0.3, lead: 0 });
    const readings = notes.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
    }));
    const rec = new Recorder(44100);
    rec.push(new Float32Array(44100 * 18));
    renderFreeReview(document, notes, rec, { readings, a4: 440 });
    document.querySelector('.tab-btn[data-tab="score"]')?.click();
    await new Promise((r) => setTimeout(r, 500));
    await annotateTake(notes, { readings, a4: 440 });
    await new Promise((r) => setTimeout(r, 1600));

    // THE COACH NEEDS A FORTNIGHT, not a take. It draws nothing until three
    // takes share a note, and its opening card compares this week with last —
    // so on a fresh store the Coach screenshot was an empty state under a
    // caption about what changed. Six takes of the same part, dated across
    // the last two weeks, each starting somewhere else in the music so the
    // same notes recur with different errors; and the older takes are played
    // wider of the mark than the newer ones, so the week-on-week card has a
    // direction to report. Saved once: the iPad page shares the iPhone's
    // store, and a second sowing would double every count on the screen.
    const { saveRecording, listRecordingsWithStats } = await import('/src/store/db.js');
    if ((await listRecordingsWithStats()).length === 0) {
      const DAY = 86400000;
      const takes = [
        { ago: 13, from: 8, wide: 1.6 }, { ago: 11, from: 0, wide: 1.5 },
        { ago: 8, from: 16, wide: 1.3 }, { ago: 5, from: 4, wide: 1.0 },
        { ago: 2, from: 12, wide: 0.8 }, { ago: 0, from: 0, wide: 0.7 },
      ];
      for (const t of takes) {
        const played = takeFromWritten(written, { from: t.from, count: 40, spacing: 0.35, sounding: 0.3, lead: 0 })
          .map((n) => ({ ...n, cents: Math.round(n.cents * t.wide) }));
        const heard = played.map((n) => ({
          time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
        }));
        await saveRecording({
          date: Date.now() - t.ago * DAY, duration: 16, sampleRate: 44100,
          audio: new Float32Array(44100 * 2), notes: played, readings: heard, a4: 440,
          scoreId, name: 'Bach — Menuet',
        });
      }
    }
  }, { bravura: font });

  for (const screen of SCREENS) {
    for (let i = 0; i < 20; i += 1) {
      if (await page.evaluate((t) => document.querySelector(`#tab-${t}`)?.classList.contains('active'), screen.tab)) break;
      await page.evaluate((t) => document.querySelector(`.tab-btn[data-tab="${t}"]`)?.click(), screen.tab);
      await new Promise((r) => setTimeout(r, 150));
    }
    if (screen.settle) await page.evaluate(screen.settle);
    // The charts draw on a canvas and the score draws on a photograph; both
    // finish a frame or two after the tab does.
    await new Promise((r) => setTimeout(r, 1500));
    const file = fileURLToPath(new URL(`${device.name}-${screen.name}.png`, OUT));
    await page.screenshot({ path: file, captureBeyondViewport: false });
    made.push({ file, device: device.name, screen: screen.name });
  }
  await page.close();
}
await browser.close();

console.log(`\n${made.length} screenshots in docs/store/`);
for (const one of made) console.log(`  ${one.device.padEnd(12)} ${one.screen}`);
