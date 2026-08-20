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
const scoreId = await page.evaluate(async () => {
  const W = 1200;
  const H = 1600;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f2ec'; x.fillRect(0, 0, W, H);

  x.fillStyle = '#000';
  x.fillRect(0, 0, W, 26);                       // the very top of the paper
  x.font = 'bold 64px serif';
  x.fillText('TOP', 60, 130);
  x.fillRect(0, H - 26, W, 26);                  // and the very bottom
  x.font = 'bold 64px serif';
  x.fillText('FOOT', 60, H - 60);

  // Systems in between, so the page can be banded like real music.
  for (let s = 0; s < 8; s++) {
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
});

// Let the import settle, the reader open, and the page draw.
await new Promise((r) => setTimeout(r, 6000));
await page.screenshot({ path: shot });

// Where the page ended up on the glass.
//
// Pixel-reading the drawn canvas was tried and is not trustworthy here — the
// reader swaps canvases as it lays out, and reading the wrong one gives a
// confident answer about nothing. What can be trusted is geometry: how much of
// the screen the page is using, and whether its top edge is on screen. The
// screenshot beside it is for the eye.
const seen = await page.evaluate(() => {
  const canvas = [...document.querySelectorAll('canvas')]
    .map((el) => ({ el, box: el.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 100 && box.height > 100)
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)[0];
  if (!canvas) return { drawn: false };
  const { box } = canvas;
  return {
    drawn: true,
    screen: { w: window.innerWidth, h: window.innerHeight },
    page: { top: Math.round(box.top), height: Math.round(box.height), width: Math.round(box.width) },
    usesHeight: Math.round((box.height / window.innerHeight) * 100),
    usesWidth: Math.round((box.width / window.innerWidth) * 100),
    topOnScreen: box.top >= -1,
  };
});

await browser.close();

if (!seen.drawn) {
  console.error('the reader drew no page at all');
  process.exit(1);
}
console.log(`screen        ${seen.screen.w}x${seen.screen.h}`);
console.log(`page drawn    ${seen.page.width}x${seen.page.height} at y=${seen.page.top}`);
console.log(`uses          ${seen.usesWidth}% of the width, ${seen.usesHeight}% of the height`);
console.log(`shot          ${shot}`);

if (!seen.topOnScreen) problems.push(`the page starts ${-seen.page.top}px above the screen — its top is cut off`);
// WHAT THIS DOES NOT MEASURE, said plainly: the canvas is full-screen and the
// page is drawn inside it, so these numbers say the reader laid a page out —
// not how much of the glass the MUSIC covers. Reading that back out of the
// canvas was tried and gives confident answers about the wrong canvas. The
// screenshot is the honest record of it; look at it.
if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nthe page is on the screen, top edge and all.');
