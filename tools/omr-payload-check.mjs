// WHAT ACTUALLY GOES UP THE WIRE when a scan is sent to be recognised.
//
// `npm run omr:truth` measures which of three pictures the recogniser reads
// best and says the photograph cut to the paper wins by twenty-eight points
// over the page the app squares up. That is a measurement of the RECOGNISER.
// This is the other half: it drives the app's own send, catches the upload
// before it leaves, and looks at what is in it — because the last time a fix
// was proved on the convenient path instead of the one a player takes, it cost
// four rounds.
//
// No service is contacted. `fetch` is replaced for the length of the call, so
// nothing is uploaded anywhere and no recognition is run.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run omr:payload

import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const APP = process.env.APP ?? 'http://localhost:5199';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const { readWithOmr } = await import('/src/analysis/omr-client.js');
  const { straightenFile, readableImage, sizeOfImage } = await import('/src/ui/straighten.js');

  // A book on a table: two leaves, the phone over the right-hand one. Drawn
  // rather than photographed because a check that needs a photograph is a check
  // nobody can run.
  const W = 2400;
  const H = 1800;
  const shot = document.createElement('canvas');
  shot.width = W;
  shot.height = H;
  const g = shot.getContext('2d');
  g.fillStyle = 'rgb(40,36,32)';
  g.fillRect(0, 0, W, H);
  const leaf = (x, w, ink) => {
    g.fillStyle = 'rgb(243,240,234)';
    g.fillRect(x, 60, w, H - 120);
    g.fillStyle = ink;
    for (let system = 0; system < 9; system += 1) {
      const top = 150 + system * 170;
      for (let line = 0; line < 5; line += 1) g.fillRect(x + 45, top + line * 12, w - 90, 3);
      for (let n = 0; n < 7; n += 1) g.fillRect(x + 60 + n * ((w - 140) / 7), top - 18, 60, 8);
    }
  };
  leaf(40, 1020, 'rgb(25,25,25)');                 // the facing page
  leaf(1160, 1180, 'rgb(30,30,30)');               // the one being scanned
  g.fillStyle = 'rgb(150,144,134)';                // the gutter
  g.fillRect(1070, 60, 90, H - 120);

  const asFile = async (canvas, name, quality) => {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return new File([blob], name, { type: 'image/jpeg' });
  };
  const raw = await asFile(shot, 'shot.jpg', 0.9);
  // The corners of the page being scanned, the way the scanner keeps them.
  const quad = [[1150 / W, 55 / H], [2350 / W, 55 / H], [2350 / W, 1745 / H], [1150 / W, 1745 / H]];
  const squared = await straightenFile(raw);

  // Catch the upload. Nothing leaves the page.
  const sent = [];
  const realFetch = window.fetch;
  window.fetch = async (url, init) => {
    if (String(url).includes('/v1/scores') && init?.body instanceof FormData) {
      for (const [key, value] of init.body.entries()) {
        if (value instanceof File) sent.push(value);
      }
      throw new Error('stopped before sending');
    }
    if (String(url).includes('/v1/engines')) {
      return new Response(JSON.stringify({ engines: [{ id: 'audiveris', ok: true }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  try {
    await readWithOmr({ source: 'photos', pages: [squared], raws: [raw], quads: [quad] },
      { name: 'book' });
  } catch { /* the stub above stops it, which is the point */ }
  window.fetch = realFetch;

  const measure = async (file) => {
    const image = await readableImage(file);
    const { w, h } = sizeOfImage(image);
    // How much of the FACING page is in it: the left-hand leaf is printed in a
    // darker ink than the page being scanned, but the reliable answer here is
    // geometric — the sheet being scanned starts at x = 1150 of 2400, so
    // anything wider than the sheet has reached over the gutter.
    return { w, h };
  };

  return {
    files: sent.length,
    sent: sent.length ? await measure(sent[0]) : null,
    squared: await measure(squared),
    raw: await measure(raw),
    // The sheet being scanned, in the photograph's own pixels.
    sheet: { w: 2350 - 1150, h: 1745 - 55 },
  };
});

await browser.close();

console.log(`files put in the upload            ${result.files}`);
console.log(`the sheet being scanned            ${result.sheet.w}x${result.sheet.h}`);
console.log(`the photograph as taken            ${result.raw.w}x${result.raw.h}`);
console.log(`the page the app squares up        ${result.squared.w}x${result.squared.h}`);
console.log(`WHAT WAS SENT                      ${result.sent ? `${result.sent.w}x${result.sent.h}` : 'nothing'}`);

// One file for one page, and it is the photograph cut to the sheet: wider than
// the sheet means it reached over the gutter and took the facing page with it;
// much narrower than the sheet means it is the squared page or worse.
const one = result.files === 1;
const shape = result.sent ? result.sent.w / result.sent.h : 0;
const want = result.sheet.w / result.sheet.h;
const cut = result.sent
  && result.sent.w <= result.raw.w * 0.62          // not the whole spread
  && Math.abs(shape - want) / want < 0.12;         // and the shape of the sheet
console.log(`\nexactly one file for one page:     ${one}`);
console.log(`the shape of what was sent:        ${shape.toFixed(3)} against the sheet's ${want.toFixed(3)}`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
console.log(one && cut ? '\nPASS' : '\nFAIL');
process.exit(one && cut ? 0 : 1);
