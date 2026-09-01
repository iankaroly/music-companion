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
const SCREENS = [
  { tab: 'analyze', name: '1-what-you-played' },
  { tab: 'score', name: '2-on-the-music' },
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
  await page.goto(APP, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));

  await page.evaluate(async ({ bravura }) => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
    const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
    const { scoreId, written } = await engravePart({
      base64: bravura, name: 'Bach — Menuet', pages: 2, systems: 5, perSystem: 8, space: 13,
    });
    const { selectScore, measurePages, annotateTake } = await import('/src/ui/score.js');
    const { renderFreeReview } = await import('/src/ui/report.js');
    const { Recorder } = await import('/src/audio/recording.js');
    await selectScore(scoreId);
    await measurePages(scoreId);
    const notes = takeFromWritten(written, { from: 0, count: 48, spacing: 0.35, sounding: 0.3, lead: 0 });
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
  }, { bravura: font });

  for (const screen of SCREENS) {
    for (let i = 0; i < 20; i += 1) {
      if (await page.evaluate((t) => document.querySelector(`#tab-${t}`)?.classList.contains('active'), screen.tab)) break;
      await page.evaluate((t) => document.querySelector(`.tab-btn[data-tab="${t}"]`)?.click(), screen.tab);
      await new Promise((r) => setTimeout(r, 150));
    }
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
