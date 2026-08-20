// A scanned page is straightened ONCE.
//
// The bug this keeps out: the scanner squares each page itself, using the
// corners the player saw and could drag, and the importer then squared it
// again. A second pass over a page that is already nothing but paper finds
// "paper" inside the printed area and crops to that, divides the lighting out
// of an image the lighting has already been divided out of, and re-encodes a
// JPEG encoded a moment ago. Measured on a photographed page, first pass then
// second: 2000x2339 became 2000x1784 — a portrait page came out landscape —
// and pure-white pixels went from 37% to 50%.
//
// That is "it zooms in, the quality goes, and the lighting goes strange", and
// it is one line of flag away from coming back.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run scan:once
//
// It does NOT open the scanner: that would turn on the camera. It goes in
// through the same import call the scanner makes when the player presses done.

import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1200));

const result = await page.evaluate(async () => {
  // A photograph of a page ON A TABLE: dark surround, paper inset, staves on
  // the paper. The surround is what makes this a decisive check — straightening
  // CROPS IT AWAY, so the two paths cannot come out the same size unless the
  // flag is being honoured. A page with nothing to crop would pass this test
  // even if the flag were ignored entirely.
  const W = 1200;
  const H = 1600;
  const MARGIN = 140;                        // the table around the paper
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b2b2e';                 // the table
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#f4f2ec';                 // paper, not pure white
  ctx.fillRect(MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2);
  ctx.fillStyle = '#111';
  for (let system = 0; system < 8; system++) {
    const top = MARGIN + 120 + system * 140;
    for (let line = 0; line < 5; line++) ctx.fillRect(MARGIN + 60, top + line * 12, W - MARGIN * 2 - 120, 2);
    for (let head = 0; head < 10; head++) {
      ctx.beginPath();
      ctx.ellipse(MARGIN + 100 + head * 85, top + 12 + (head % 5) * 6, 9, 6, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  const file = new File([blob], 'scanned-page.jpg', { type: 'image/jpeg' });

  const { addPaper } = await import('/src/ui/score.js');
  const { loadScorePages, deleteScore } = await import('/src/store/db.js');

  const sizeOf = async (stored) => {
    const bitmap = await createImageBitmap(stored);
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
    return size;
  };

  // The scanner's page: already square, so the importer must not touch it.
  const keptId = await addPaper([file], { name: 'once', straightened: true });
  const kept = await sizeOf((await loadScorePages(keptId)).pages[0]);

  // The same image brought in as a picked photograph, which SHOULD be squared.
  const squaredId = await addPaper([file], { name: 'twice' });
  const squared = await sizeOf((await loadScorePages(squaredId)).pages[0]);

  await deleteScore(keptId);
  await deleteScore(squaredId);

  // AND a page held close enough to FILL THE FRAME, which is what the scanner
  // asks for in those words. There is no paper edge in such a picture, so
  // nothing inside it is one: the outline used to land where the printing
  // stopped and take the title and the last system with it.
  const full = document.createElement('canvas');
  full.width = 1000;
  full.height = 1400;
  const fx = full.getContext('2d');
  fx.fillStyle = '#f4f2ec';
  fx.fillRect(0, 0, full.width, full.height);
  fx.fillStyle = '#111';
  fx.font = 'bold 48px serif';
  fx.fillText('CONCERTO', 300, 90);          // a title, near the top edge
  for (let system = 0; system < 9; system++) {
    const top = 200 + system * 130;
    for (let line = 0; line < 5; line++) fx.fillRect(70, top + line * 12, full.width - 140, 2);
    for (let head = 0; head < 10; head++) {
      fx.beginPath();
      fx.ellipse(110 + head * 85, top + 12 + (head % 5) * 6, 9, 6, -0.3, 0, Math.PI * 2);
      fx.fill();
    }
  }
  fx.font = '18px serif';
  fx.fillText('A.L.20.856', 430, 1370);      // a footer, near the bottom edge

  // The lighting a phone gives a page held under a lamp: brightest in the
  // middle, falling away at the edges. This is what makes the check bite. On a
  // flat, evenly lit rectangle the detector finds nothing and crops nothing; on
  // a real photograph the brightest coherent region is the middle of the page,
  // and the outline shrinks onto it — which is where the eight percent went.
  const falloff = fx.createRadialGradient(
    full.width / 2, full.height / 2, full.height * 0.2,
    full.width / 2, full.height / 2, full.height * 0.72,
  );
  falloff.addColorStop(0, 'rgba(0,0,0,0)');
  falloff.addColorStop(1, 'rgba(0,0,0,0.34)');
  fx.fillStyle = falloff;
  fx.fillRect(0, 0, full.width, full.height);
  const fullBlob = await new Promise((res) => full.toBlob(res, 'image/jpeg', 0.92));
  const fullId = await addPaper([new File([fullBlob], 'filled.jpg', { type: 'image/jpeg' })], { name: 'filled' });
  const filled = await sizeOf((await loadScorePages(fullId)).pages[0]);
  await deleteScore(fullId);

  // AND A PAGE WHOSE TOP IS IN SHADOW, lying on a table — the case a phone
  // actually produces. The page is well inside the frame, so its edges can be
  // seen and the frame rule does not apply; but a band of shade across the top
  // is a stronger boundary than the paper's own edge, and the outline lands
  // under it. What gets cut off is the title, the composer, and the first line
  // of music.
  const shot = document.createElement('canvas');
  shot.width = 1500;
  shot.height = 1100;
  const sx = shot.getContext('2d');
  sx.fillStyle = '#37332c';
  sx.fillRect(0, 0, shot.width, shot.height);
  const pageBox = { x: 300, y: 90, w: 900, h: 920 };
  sx.fillStyle = '#f4f2ec';
  sx.fillRect(pageBox.x, pageBox.y, pageBox.w, pageBox.h);
  sx.fillStyle = '#111';
  sx.font = 'bold 34px serif';
  sx.fillText('CONCERTO', pageBox.x + 320, pageBox.y + 60);   // in the shaded strip
  for (let system = 0; system < 7; system++) {
    const top = pageBox.y + 110 + system * 115;
    for (let line = 0; line < 5; line++) sx.fillRect(pageBox.x + 40, top + line * 10, pageBox.w - 80, 2);
    for (let head = 0; head < 9; head++) {
      sx.beginPath();
      sx.ellipse(pageBox.x + 70 + head * 90, top + 10 + (head % 5) * 5, 8, 5, -0.3, 0, Math.PI * 2);
      sx.fill();
    }
  }
  // The shade across the top fifth of the page.
  const shade = sx.createLinearGradient(0, pageBox.y, 0, pageBox.y + pageBox.h * 0.22);
  shade.addColorStop(0, 'rgba(0,0,0,0.42)');
  shade.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = shade;
  sx.fillRect(pageBox.x, pageBox.y, pageBox.w, pageBox.h * 0.22);
  const shotBlob = await new Promise((res) => shot.toBlob(res, 'image/jpeg', 0.92));
  const shadedId = await addPaper([new File([shotBlob], 'shaded.jpg', { type: 'image/jpeg' })], { name: 'shaded' });
  const shaded = await sizeOf((await loadScorePages(shadedId)).pages[0]);
  await deleteScore(shadedId);

  // AND THE DOOR THE CAMERA ACTUALLY USES.
  //
  // The scanner finds its own corners, shows them to the player and hands them
  // to straightenCanvas as `known`. That path took the corners as given, so
  // every fix to the outline applied to pictures picked from the library and to
  // nothing taken with the phone — which is exactly the difference between
  // every measurement here passing and the scan on the phone still being wrong.
  //
  // So: a page that fills the frame, with corners that cut the top off it, as
  // the scanner would hand them over. The top must survive.
  const camera = document.createElement('canvas');
  camera.width = 1000;
  camera.height = 1400;
  const mx = camera.getContext('2d');
  mx.fillStyle = '#f4f2ec';
  mx.fillRect(0, 0, camera.width, camera.height);
  mx.fillStyle = '#111';
  mx.font = 'bold 44px serif';
  mx.fillText('CONCERTO', 300, 80);                 // the title, near the top
  for (let system = 0; system < 9; system++) {
    const top = 150 + system * 135;
    for (let line = 0; line < 5; line++) mx.fillRect(70, top + line * 12, camera.width - 140, 2);
    for (let head = 0; head < 10; head++) {
      mx.beginPath();
      mx.ellipse(110 + head * 85, top + 12 + (head % 5) * 6, 9, 6, -0.3, 0, Math.PI * 2);
      mx.fill();
    }
  }
  const { straightenCanvas } = await import('/src/ui/straighten.js');
  // Corners as the scanner might find them on a page held close: the top edge
  // landed under the title.
  const cut = [[0, 0.09], [1, 0.09], [1, 1], [0, 1]];
  const straightened = straightenCanvas(camera, camera.width, camera.height, cut);
  const cameraKept = straightened.height / camera.height;

  return {
    source: { w: W, h: H }, kept, squared, filled,
    fullFrame: { w: full.width, h: full.height },
    shaded, pageBox,
    cameraKept: Math.round(cameraKept * 100),
  };
});

await browser.close();

const same = (a, b) => a.w === b.w && a.h === b.h;
console.log(`the page as scanned      ${result.source.w}x${result.source.h}`);
console.log(`stored, straightened:true ${result.kept.w}x${result.kept.h}`);
console.log(`stored, as a photograph   ${result.squared.w}x${result.squared.h}`);

if (!same(result.kept, result.source)) {
  problems.push('a page the scanner already squared was changed on the way in: '
    + `${result.source.w}x${result.source.h} became ${result.kept.w}x${result.kept.h}`);
}
// And the other direction, or the check proves nothing: a picked photograph
// with a table around it MUST be cropped to the paper.
if (same(result.squared, result.source)) {
  problems.push('a photograph with a table around it was stored uncropped, so this '
    + 'check cannot tell whether the flag is doing anything');
}
// A page that fills the frame must come through whole. Half a percent of
// rounding is fine; eight percent is a system of music.
const shrink = 1 - (result.filled.w * result.filled.h) / (result.fullFrame.w * result.fullFrame.h);
console.log(`a page filling the frame  ${result.fullFrame.w}x${result.fullFrame.h}`
  + ` -> ${result.filled.w}x${result.filled.h} (${(shrink * 100).toFixed(1)}% cut away)`);
if (shrink > 0.02) {
  problems.push(`a page that fills the frame lost ${(shrink * 100).toFixed(1)}% of itself — `
    + 'the outline landed where the printing stops, not where the paper does');
}

// The shaded-top page: the stored page must still be the whole sheet. Cropping
// under the shadow is what takes the title off.
const keptShare = result.shaded.h / (result.shaded.w / result.pageBox.w * result.pageBox.h);
console.log(`a page with its top shaded  ${result.pageBox.w}x${result.pageBox.h} on the table`
  + ` -> ${result.shaded.w}x${result.shaded.h} (${Math.round(keptShare * 100)}% of its height kept)`);
if (keptShare < 0.92) {
  problems.push(`a page with its top in shadow lost ${Math.round((1 - keptShare) * 100)}% of its height — `
    + 'the outline landed under the shadow, and the title went with it');
}

// The camera's own door: corners handed in must be guarded like any others.
console.log(`corners handed in by the scanner  ${result.cameraKept}% of the page height kept`);
if (result.cameraKept < 92) {
  problems.push(`corners handed in by the scanner cut ${100 - result.cameraKept}% off the page — `
    + 'the guard is not being applied to the path the camera uses');
}

if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nstraightened once.');
