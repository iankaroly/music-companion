// The three things a device can ask for, checked by asking for them.
//
// prefers-reduced-motion, prefers-reduced-transparency and prefers-contrast are
// settings a person turns on because something about the interface is hurting
// them. They were being answered a selector at a time, which is the kind of
// coverage that looks present and is not: the elements nobody remembered are
// the ones that move. This asks the browser to report each setting on and then
// reads the computed style back off the real page.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/a11y-prefs-check.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// Raw CDP rather than page.emulateMediaFeatures, which keeps an allowlist that
// prefers-reduced-transparency is not on. Chrome itself understands it.
const cdp = await page.createCDPSession();
const load = async (features) => {
  await cdp.send('Emulation.setEmulatedMedia', { features });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1600));
  await page.evaluate(() => {
    document.querySelector('#welcome')?.remove();
    document.querySelector('#welcome-card')?.remove();
  });
};

// Something that is always on the page, always animated, and always translucent.
const styleOf = (selector, props) => page.evaluate((sel, list) => {
  const node = document.querySelector(sel);
  if (!node) return null;
  const cs = getComputedStyle(node);
  return Object.fromEntries(list.map((p) => [p, cs.getPropertyValue(p)]));
}, selector, props);

// --- 1. reduced motion -------------------------------------------------------
await load([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const tab = await styleOf('.tab-btn', ['transition-property', 'transition-duration', 'transition-timing-function']);
check('reduced motion: nothing transitions transform any more',
  !!tab && !tab['transition-property'].includes('transform'),
  `transition-property: ${tab?.['transition-property']}`);
check('reduced motion: and nothing overshoots',
  !!tab && !tab['transition-timing-function'].includes('cubic-bezier(0.34, 1.56'),
  `timing: ${tab?.['transition-timing-function']}`);
const blob = await styleOf('#blobs i', ['animation-name', 'animation-duration']);
check('reduced motion: the drifting field behind everything is off',
  !blob || blob['animation-name'] === 'none' || blob['animation-duration'] === '1ms',
  `${blob?.['animation-name']} ${blob?.['animation-duration']}`);
// …and the colour fade is deliberately KEPT: reduced motion is not no feedback.
check('reduced motion: colour still fades, so a press still answers',
  !!tab && tab['transition-property'].includes('color')
    && tab['transition-duration'] !== '0s',
  `${tab?.['transition-property']} / ${tab?.['transition-duration']}`);

// --- 2. reduced transparency -------------------------------------------------
await load([{ name: 'prefers-reduced-transparency', value: 'reduce' }]);
const opened = await page.evaluate(async () => {
  const { openReader } = await import('/src/ui/reader.js');
  await openReader({
    id: 'a11y', name: 'A11y', kind: 'notation',
    xml: '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1">'
      + '<part-name>Cello</part-name></score-part></part-list><part id="P1"><measure number="1">'
      + '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats>'
      + '<beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>'
      + '<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration>'
      + '<type>whole</type></note></measure></part></score-partwise>',
  });
  await new Promise((r) => setTimeout(r, 900));
  return !!document.querySelector('#reader-top');
});
const bar = await styleOf('#reader-top', ['backdrop-filter', '-webkit-backdrop-filter', 'background-color']);
check('reduced transparency: the reader chrome has no blur left',
  opened && !!bar && (bar['backdrop-filter'] === 'none' || bar['backdrop-filter'] === ''),
  `backdrop-filter: ${bar?.['backdrop-filter']}`);
check('reduced transparency: and the surface under the text is solid',
  !!bar && !/rgba?\([^)]*,\s*0?\.\d+\s*\)/.test(bar['background-color']),
  `background: ${bar?.['background-color']}`);

// --- 3. more contrast --------------------------------------------------------
await load([{ name: 'prefers-contrast', value: 'more' }]);
const card = await styleOf('.card', ['border-top-width', 'border-top-color']);
check('more contrast: surfaces have a border you can find',
  !!card && parseFloat(card['border-top-width']) >= 1,
  `border: ${card?.['border-top-width']} ${card?.['border-top-color']}`);

// --- 4. the device's own text size -------------------------------------------
// The gate is the whole point here. -apple-system-body resolves on macOS too,
// to thirteen pixels, so an ungated version silently shrinks the desktop app by
// a fifth. Checked on a pointer:fine machine (must not follow) and on emulated
// touch hardware (must be willing to).
// A page of its own, because the one above is emulating a tablet — asking it
// whether it behaves like a desktop would only ever have got one answer.
const desk = await browser.newPage();
await desk.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2, hasTouch: false, isMobile: false });
await desk.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));
const desktop = await desk.evaluate(async () => {
  const { textSizeNow } = await import('/src/ui/text-size.js');
  return textSizeNow();
});
await desk.close();
check('text size: a pointer device is left alone',
  desktop.following === false && Math.abs(desktop.root - 16) < 0.5,
  `following=${desktop.following} root=${desktop.root}px`);

// …and the same page told it is a touch device.
const touch = await browser.newPage();
await touch.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await touch.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));
const phone = await touch.evaluate(async () => {
  const { textSizeNow } = await import('/src/ui/text-size.js');
  return textSizeNow();
});
// Chrome does not implement -apple-system-body, so `body` is null here and the
// root must be untouched. That is the correct answer for this browser, and the
// check that matters is that it did not guess at one anyway.
check('text size: touch hardware is willing to follow, and never guesses',
  phone.following === true && (phone.body === null ? Math.abs(phone.root - 16) < 0.5 : phone.root >= 15),
  `following=${phone.following} body=${phone.body} root=${phone.root}px`);
await touch.close();

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
