// THE LISTING IMAGES: each raw screenshot from `store:shots`, set inside a drawn
// device and captioned, at the exact pixel size App Store Connect asks for.
//
// A raw screenshot on its own is what the app looks like; a listing image is
// what the app is FOR, and the two lines above the phone are the only words a
// browser reads before deciding whether to scroll. So each image is three
// things: a caption in the app's own display face, a device with the screen in
// it, and a ground built from the app's own palette so the twelve images read
// as one thing and match the icon beside them.
//
// The device is a plain rounded bezel and not Apple's artwork: Apple's device
// images are trademarked and the guidelines only ask that a frame, if any, is
// generic. The frame runs off the bottom of the canvas on purpose — with the
// caption above it a whole phone would have to shrink to two-thirds width to
// fit, and the crop is what every polished listing in the Music category does.
// MEASURED on the raw shots: the tab bar's lower edge sits at 2779 of 2796 on
// the phone and 2720 of 2732 on the iPad, so the scale is chosen to keep the
// whole tab bar on the canvas and cut only the chin below it — a tab bar sliced
// through the middle looks like a mistake, not a crop.
//
// Everything is drawn as an HTML page and screenshotted at device scale factor
// 1 in a window of exactly the output size, so there is no resampling step to
// get wrong and `sips` reports the size Apple wants without a crop.
//
//   npm run store:shots     (needs the dev server; see store-shots.mjs)
//   npm run store:frames    (needs nothing but the raw PNGs)
//
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const RAW = new URL('../docs/store/', import.meta.url);
const OUT = new URL('../docs/store/framed/', import.meta.url);
await mkdir(OUT, { recursive: true });

// The app's palette, copied from the :root block in index.html rather than
// imported, because the listing must not change under a theme edit nobody
// meant for it. --bg is the ground, --grad's two stops are the colour, --ink
// the caption, --accent-warm the one warm note the app allows itself.
const PALETTE = {
  ground: '#eeebfa', ink: '#2a2149', purple: '#7c5cff', sky: '#4cb8ff', warm: '#ff8a7a',
  bezel: '#1b1535',
};
// --display in index.html: the system face, which on the machine that renders
// this is San Francisco — the same face the app's own headings are set in.
const DISPLAY = '-apple-system, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Per device: the canvas, the caption size, and where the device sits.
//   scale    the raw screenshot's size inside the frame (see the tab-bar note)
//   bezel    the dark rim, in output pixels
//   radius   the SCREEN's corner radius; the bezel's is radius + bezel, so the
//            rim is the same width around the corner as along the sides
//   top      where the top of the bezel lands, leaving room for two lines
const DEVICES = [
  {
    name: 'iphone-6.9', width: 1290, height: 2796,
    caption: 96, captionTop: 150, scale: 0.84, bezel: 22, radius: 138, top: 440,
  },
  {
    name: 'ipad-13', width: 2048, height: 2732,
    caption: 120, captionTop: 160, scale: 0.81, bezel: 30, radius: 64, top: 520,
  },
];

// The six screens, in the order the listing tells the story, with the line
// each one earns. Short enough to sit in two lines at 96px on the phone.
//
// Two of them are the score tab as a music stand — the shelf, and a page with
// a pencil on it — and none of them is the take marked onto the music. That
// screen ("Marked straight onto your music") was the second image until the
// rings were held back from the listing; store-shots.mjs no longer makes it,
// and a caption promising it would be a promise the app on the store does
// not keep yet.
const SCREENS = [
  { name: '1-what-you-played', caption: 'Every note, as you played it' },
  { name: '2-on-the-stand', caption: 'Your music, on the stand' },
  { name: '3-pencil', caption: 'Mark it up with a pencil' },
  { name: '4-tuner', caption: 'A tuner that understands vibrato' },
  { name: '5-coach', caption: 'What changed since last week' },
  { name: '6-metronome', caption: 'A metronome that trains tempo' },
];

function pageFor(device, caption, pngBase64) {
  const { width, height, scale, bezel, radius, top } = device;
  const screenW = Math.round(width * scale);
  const screenH = Math.round(height * scale);
  const outerW = screenW + bezel * 2;
  const left = Math.round((width - outerW) / 2);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    position: relative;
    font-family: ${DISPLAY};
    /* The app's own stage: a lavender ground with the button gradient's two
       colours drifting under it, kept pale near the top so the caption sits on
       something close to paper, and the warm accent low and small so the
       image has a floor. Radial gradients rather than blurred blobs so the
       result is deterministic across renders. */
    background:
      radial-gradient(60% 40% at 18% 78%, ${PALETTE.purple}66 0%, ${PALETTE.purple}00 70%),
      radial-gradient(55% 38% at 86% 62%, ${PALETTE.sky}70 0%, ${PALETTE.sky}00 70%),
      radial-gradient(45% 30% at 62% 100%, ${PALETTE.warm}40 0%, ${PALETTE.warm}00 70%),
      radial-gradient(70% 30% at 50% 0%, #ffffff99 0%, #ffffff00 70%),
      ${PALETTE.ground};
  }
  .caption {
    position: absolute; left: 0; right: 0; top: ${device.captionTop}px;
    height: ${Math.round(device.caption * 1.1 * 2)}px;
    display: flex; align-items: center; justify-content: center;
    padding: 0 ${Math.round(width * 0.06)}px;
    text-align: center;
    font-size: ${device.caption}px; line-height: 1.1;
    font-weight: 700; letter-spacing: -0.022em;
    color: ${PALETTE.ink};
    text-wrap: balance;
  }
  .device {
    position: absolute; left: ${left}px; top: ${top}px;
    width: ${outerW}px; height: ${screenH + bezel * 2}px;
    padding: ${bezel}px; box-sizing: border-box;
    background: ${PALETTE.bezel};
    border-radius: ${radius + bezel}px;
    /* One soft shadow in the ink's own hue, and a hairline of light on the rim
       so the bezel reads as an edge rather than a flat black shape. */
    box-shadow:
      0 ${Math.round(bezel * 2)}px ${Math.round(bezel * 6)}px rgba(42, 33, 73, 0.28),
      inset 0 0 0 1.5px rgba(255, 255, 255, 0.14);
  }
  .screen {
    display: block; width: ${screenW}px; height: ${screenH}px;
    border-radius: ${radius}px;
    background: ${PALETTE.ground};
  }
</style></head><body>
  <div class="caption">${caption}</div>
  <div class="device"><img class="screen" src="data:image/png;base64,${pngBase64}"></div>
</body></html>`;
}

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true,
  args: ['--no-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'],
});

const made = [];
for (const device of DEVICES) {
  const page = await browser.newPage();
  await page.setViewport({ width: device.width, height: device.height, deviceScaleFactor: 1 });
  for (const screen of SCREENS) {
    const name = `${device.name}-${screen.name}.png`;
    const raw = await readFile(new URL(name, RAW));
    await page.setContent(pageFor(device, screen.caption, raw.toString('base64')), { waitUntil: 'load' });
    // The system face and the image both arrive after `load` reports.
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 200));
    const file = fileURLToPath(new URL(name, OUT));
    await page.screenshot({
      path: file, clip: { x: 0, y: 0, width: device.width, height: device.height },
    });
    made.push({ file, device: device.name, screen: screen.name });
  }
  await page.close();
}
await browser.close();

console.log(`\n${made.length} framed images in docs/store/framed/`);
for (const one of made) console.log(`  ${one.device.padEnd(12)} ${one.screen}`);
