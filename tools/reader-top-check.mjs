// Does the reader show the TOP of a scanned page?
//
// Every other check in this round asserted the size of the page that was
// STORED. The complaint is about the page that is SHOWN — "it was still not
// showing the top of the page and there was space below the bottom" — and
// nothing measured that, which is why three rounds of fixes did not touch it.
//
// So this goes in through the app's own import, opens the app's own reader, and
// photographs the screen. The fixture page has a black bar and the word TOP
// across its first centimetre, and a bar at its foot: if the first screen of a
// freshly scanned page does not contain the top bar, the reader is not showing
// the top of the page.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run reader:top
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const shot = arg('shot', 'docs/reader-top.png');
// A real photograph of a page, when one is given: the reader behaves quite
// differently on a page it can find staves on, and that is the page the
// complaint is about.
const photo = arg('photo', null);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
// A phone, because that is where this was seen.
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  const start = [...document.querySelectorAll('button')].find((b) => /start playing/i.test(b.textContent ?? ''));
  start?.click();
});
await new Promise((r) => setTimeout(r, 400));

// A page as the scanner hands one over: square, edge to edge, marked top and
// bottom so it is obvious which part of it is on the screen.
const scoreId = await page.evaluate(async (photoBytes) => {
  let W = 1200;
  let H = 1600;
  const c = document.createElement('canvas');
  const x0 = () => c.getContext('2d');
  if (photoBytes) {
    // The real page, marked at its extremes.
    const bmp = await createImageBitmap(new Blob([new Uint8Array(photoBytes)]));
    W = bmp.width; H = bmp.height;
    c.width = W; c.height = H;
    x0().drawImage(bmp, 0, 0);
    bmp.close();
  } else {
    c.width = W; c.height = H;
    x0().fillStyle = '#f4f2ec';
    x0().fillRect(0, 0, W, H);
  }
  const x = x0();

  // Markers no page of music could be confused with: pure red across the first
  // centimetre of the paper, pure blue across the last. If the red is not on
  // the screen when the score opens, the top of the page is not being shown —
  // and that is the whole question.
  x.fillStyle = '#ff0000';
  x.fillRect(0, 0, W, 40);
  x.fillStyle = '#0000ff';
  x.fillRect(0, H - 40, W, 40);
  x.fillStyle = '#000';
  x.font = 'bold 64px serif';
  x.fillText('TOP', 60, 150);
  x.fillText('FOOT', 60, H - 80);

  // Systems in between, so the page can be banded like real music. Only when
  // this is a made-up page: a real photograph brings its own.
  for (let s = 0; !photoBytes && s < 8; s++) {
    const top = 220 + s * 160;
    for (let l = 0; l < 5; l++) x.fillRect(90, top + l * 14, W - 180, 3);
    for (let n = 0; n < 9; n++) {
      x.beginPath();
      x.ellipse(130 + n * 115, top + 14 + (n % 5) * 7, 11, 7, -0.3, 0, Math.PI * 2);
      x.fill();
    }
  }
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  const file = new File([blob], 'page-01.jpg', { type: 'image/jpeg' });

  const { addPaper } = await import('/src/ui/score.js');
  return addPaper([file], { name: 'Top check', straightened: true });
}, photo ? [...readFileSync(photo)] : null);

// Let the import settle, the reader open, and the page draw.
await new Promise((r) => setTimeout(r, 6000));

// THEN OPEN IT AGAIN, which is the case the complaint is about: "it's still
// happening but when i open the score now". The first open happens while the
// page is still being measured; the second has the staves, and the reader
// bands the page from them. Those are two different screens and only one of
// them was ever being checked.
if (arg('reopen', '1') === '1') {
  await page.evaluate(async (id) => {
    const { selectScore } = await import('/src/ui/score.js');
    const { loadScorePages } = await import('/src/store/db.js');
    // Wait for the measuring pass to have written its staves down.
    for (let i = 0; i < 40; i += 1) {
      const row = await loadScorePages(id);
      if (row?.layout?.[0]?.staves?.length) break;
      await new Promise((wait) => setTimeout(wait, 500));
    }
    await selectScore(id);
  }, scoreId);
  await new Promise((r) => setTimeout(r, 4000));
}
await page.screenshot({ path: shot });

// WHAT IS ACTUALLY ON THE GLASS.
//
// Not the size of the stored page, not the size of the canvas element — the
// pixels. The screenshot is handed back to the browser to decode, because it
// is the one thing here that can read a PNG, and then the red and blue marker
// bands are looked for. Every check before this one measured something else,
// which is how they all passed while the screen was wrong.
const png = await page.screenshot({ encoding: 'base64' });
const seen = await page.evaluate(async (dataUrl) => {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const rowHas = (y, test) => {
    let hits = 0;
    for (let x = 0; x < canvas.width; x += 3) {
      const at = (y * canvas.width + x) * 4;
      if (test(data[at], data[at + 1], data[at + 2])) hits += 1;
    }
    return hits / (canvas.width / 3) > 0.5;
  };
  const isRed = (r, g, b) => r > 140 && g < 110 && b < 110;
  const isBlue = (r, g, b) => b > 140 && r < 110 && g < 110;
  let redAt = null;
  let blueAt = null;
  for (let y = 0; y < canvas.height; y += 1) {
    if (redAt === null && rowHas(y, isRed)) redAt = y;
    if (rowHas(y, isBlue)) blueAt = y;
  }
  return { w: canvas.width, h: canvas.height, redAt, blueAt };
}, `data:image/png;base64,${png}`);

await browser.close();

const pct = (y) => (y === null ? 'not on screen' : `${Math.round((y / seen.h) * 100)}% down`);
console.log(`screen         ${seen.w}x${seen.h} device pixels`);
console.log(`top of page    ${pct(seen.redAt)}`);
console.log(`foot of page   ${pct(seen.blueAt)}`);
console.log(`shot           ${shot}`);

if (seen.redAt === null) {
  problems.push('the top of the page is not on the screen at all when the score opens');
}
if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nthe score opens showing the top of the page.');
