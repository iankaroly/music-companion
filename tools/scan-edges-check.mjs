// The edges somebody DRAGGED are the edges the page gets cut to.
//
// THE COMPLAINT: "when i trim after taking the photo in scan, it doesnt update
// to what i cropped it to, but instead stays the same."
//
// It is true, and it is total rather than approximate. `straightenCanvas` puts
// every outline through three corrections on its way to the knife, and all
// three were written for an outline the FINDER produced:
//
//   guardQuad    — a boundary with print beyond it is not a paper edge, so push
//                  that side out to the frame; and a sheet that reaches both
//                  sides of the picture has no edges in it at all, so keep the
//                  WHOLE FRAME. A page photographed the way the scanner asks
//                  for it (fill the frame, edges and all) reaches top and
//                  bottom — so a hand crop of one page out of an open book was
//                  thrown away in its entirety and the photograph came back.
//   widen        — let it out by a tenth, because a finder that lands a little
//                  inside the paper costs a line of music.
//   trimBackground — and then eat up to a fifth of a side back off again.
//
// A person dragging a corner onto a corner is not guessing, and the one thing
// they are usually doing is cutting the FACING PAGE off — which is the case
// every one of those three corrections is built to undo. So the hand crop is
// taken as given, and this measures it: an open book, the outline dragged onto
// the left-hand page, and the question of whether the right-hand page is in
// what comes out.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run scan:edges
//
// No camera: it calls straightenCanvas the way the crop editor does.

import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const APP = process.env.APP ?? 'http://localhost:5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const { straightenCanvas } = await import('/src/ui/straighten.js');

  // A book open under a phone held the way the scanner asks — close, the page
  // filling the frame, running off the top and the bottom of it — with the
  // FACING PAGE still catching the edge of the picture. That is the complaint
  // exactly: the phone is over one page and a strip of the next one is in shot.
  const W = 1400;
  const H = 1000;
  const LEFT = { x: 40, y: -20, w: 1000, h: H + 40 };
  const RIGHT = { x: 1080, y: -20, w: 320, h: H + 40 };
  const shot = new OffscreenCanvas(W, H);
  const ctx = shot.getContext('2d');
  ctx.fillStyle = 'rgb(34,34,38)';                    // the table, and the gutter
  ctx.fillRect(0, 0, W, H);
  const sheet = (box, ink) => {
    ctx.fillStyle = 'rgb(244,242,236)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.fillStyle = ink;
    for (let system = 0; system < 6; system += 1) {
      const top = 90 + system * 150;
      for (let line = 0; line < 5; line += 1) {
        ctx.fillRect(box.x + 50, top + line * 11, box.w - 100, 3);
      }
    }
  };
  sheet(LEFT, 'rgb(20,20,20)');
  // The facing page is drawn BLACKER than music ever is, so a single dark pixel
  // in the answer is proof of where it came from rather than a judgement call.
  ctx.fillStyle = 'rgb(244,242,236)';
  ctx.fillRect(RIGHT.x, RIGHT.y, RIGHT.w, RIGHT.h);
  ctx.fillStyle = 'rgb(0,0,0)';
  for (let y = 40; y < H; y += 24) ctx.fillRect(RIGHT.x + 40, y, RIGHT.w - 80, 12);

  // What somebody drags: the corners of the left-hand page, and nothing else.
  const quad = [
    [LEFT.x / W, 0.0],
    [(LEFT.x + LEFT.w) / W, 0.0],
    [(LEFT.x + LEFT.w) / W, 1.0],
    [LEFT.x / W, 1.0],
  ];

  const look = (canvas) => {
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
    const lum = (i) => (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const px = data.length / 4;
    // The facing page's hatching is solid black and covers most of its width;
    // the left page's staff lines are three pixels of grey in a hundred. So the
    // question "is the neighbour in here" is asked of the RIGHT-HAND EDGE of
    // what came out, where the neighbour would land.
    let edge = 0;
    let edgeInk = 0;
    const from = Math.round(canvas.width * 0.88);
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = from; x < canvas.width; x += 1) {
        edge += 1;
        if (lum((y * canvas.width + x) * 4) < 120) edgeInk += 1;
      }
    }
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) if (lum(i) < 120) ink += 1;
    return {
      w: canvas.width,
      h: canvas.height,
      shape: +(canvas.width / canvas.height).toFixed(3),
      ink: +((ink / px) * 100).toFixed(2),
      rightEdgeInk: +((edgeInk / Math.max(1, edge)) * 100).toFixed(2),
    };
  };

  // AND THE OTHER HALF OF THE SAME QUESTION: the page the SHUTTER keeps, with
  // nobody dragging anything. The scanner finds the pages in the frame with
  // `papersIn`, fills in the one being aimed at, and hands those corners to
  // `straightenCanvas` — so the guard runs a second time, on a quadrilateral
  // that is one page of several, and pushes its inner edge back over the page
  // beside it. The outline drawn on the glass says one thing and the page that
  // is kept is another.
  const { papersIn, besideOf } = await import('/src/ui/straighten.js');
  const { aimedPage } = await import('/src/analysis/page-edges.js');

  // A book with a FAINT gutter, which is the one that goes wrong: pressed flat
  // under a lamp, the two leaves are one bright region.
  const book = new OffscreenCanvas(W, H);
  const bg = book.getContext('2d');
  bg.fillStyle = 'rgb(34,34,38)';
  bg.fillRect(0, 0, W, H);
  const leaf = (box, ink) => {
    bg.fillStyle = 'rgb(244,242,236)';
    bg.fillRect(box.x, box.y, box.w, box.h);
    bg.fillStyle = ink;
    for (let system = 0; system < 6; system += 1) {
      const top = 90 + system * 150;
      for (let line = 0; line < 5; line += 1) bg.fillRect(box.x + 50, top + line * 11, box.w - 100, 3);
    }
  };
  const BAND = { x: -120, y: 30, w: 420, h: H - 60 };
  const AIMED = { x: 350, y: 30, w: 1010, h: H - 60 };
  leaf(BAND, 'rgb(40,40,40)');
  // The page being aimed at is printed in MID GREY, and the facing page's
  // marker in solid black, so "is the neighbour in this page" can be asked of
  // the darkness alone — the aimed page's own staff lines are not black and
  // cannot answer yes for it.
  leaf(AIMED, 'rgb(130,130,130)');
  bg.fillStyle = 'rgb(206,199,188)';                  // the gutter, barely a seam
  bg.fillRect(300, 30, 50, H - 60);
  // AND THE OUTER EDGE OF THE BOOK FALLING AWAY FROM THE LAMP. This is what a
  // page of a bound book does: the far side lifts off the table and goes into
  // shadow, so the bright mask stops short of the paper and the outline lands
  // inside the music. The guard that pushes an outline out to the paper when
  // there is print beyond it exists for exactly this — and switching it off
  // for a book, which is what "there are two pages in the frame" used to do,
  // leaves the far quarter of the page outside the blue.
  const dusk = bg.createLinearGradient(1120, 0, 1360, 0);
  dusk.addColorStop(0, 'rgb(0 0 0 / 0)');
  dusk.addColorStop(1, 'rgb(0 0 0 / 0.5)');
  bg.fillStyle = dusk;
  bg.fillRect(1120, 30, 240, H - 60);
  // The facing page's marker is BLUE, and the colour is the point. Darkness
  // cannot answer this question: the table beyond the page is dark, the page's
  // own staff lines are dark, and the outline is let out a tenth up and down on
  // purpose, so a dark pixel in the answer has three possible sources. Nothing
  // else in the picture is blue, so a blue pixel has one.
  bg.fillStyle = 'rgb(20,40,230)';
  for (let y = 60; y < H - 60; y += 30) bg.fillRect(0, y, 290, 16);

  const pages = papersIn(book, W, H);
  const at = aimedPage(pages, [0.62, 0.5]);           // the phone over the right-hand page
  // The outlines BEFORE the guard runs, so the three ways of guarding can be
  // compared from the same starting quadrilateral — `papersIn` has already
  // guarded the ones above.
  const { findPages } = await import('/src/analysis/page-edges.js');
  const lumaOf = (canvas, w, h) => {
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    small.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, w, h);
    const { data } = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i += 1) {
      out[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }
    return out;
  };
  const lookW = 220;
  const lookH = Math.round((H / W) * lookW);
  const raw = findPages(lumaOf(book, lookW, lookH), lookW, lookH);
  const rawAt = aimedPage(raw, [0.62, 0.5]);
  const kept = at >= 0
    ? straightenCanvas(book, W, H, pages[at], { beside: besideOf(pages, at) })
    : straightenCanvas(book, W, H);
  // The same page cut two other ways, so the number above has something to be a
  // number against. `alone` is the guard running with no idea there is another
  // page in the frame — it pushes this outline over the neighbour, which is
  // what the scanner did before this round. `blind` is the guard switched off
  // altogether, which is what it did for the hour after that: the neighbour
  // stays out and the page's own shadowed outer edge is never recovered.
  const alone = rawAt >= 0 ? straightenCanvas(book, W, H, raw[rawAt]) : null;
  const blind = rawAt >= 0 ? straightenCanvas(book, W, H, raw[rawAt], { asGiven: true }) : null;
  const neighbourIn = (canvas) => {
    const c = canvas.getContext('2d', { willReadFrequently: true });
    const { data } = c.getImageData(0, 0, canvas.width, canvas.height);
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Saturated blue, not merely blue-ish. A heavy shadow amplified by
      // `unshadow` leaves JPEG chroma noise that clears a "blue beats red by
      // sixty" test at low brightness and is not the marker at all.
      if (data[i + 2] > 140 && data[i + 2] > data[i] * 1.8 && data[i + 2] > data[i + 1] * 1.8) blue += 1;
    }
    return +((blue / (data.length / 4)) * 100).toFixed(2);
  };

  return {
    given: look(straightenCanvas(shot, W, H, quad, { asGiven: true })),
    found: look(straightenCanvas(shot, W, H, quad)),
    want: +(LEFT.w / LEFT.h).toFixed(3),
    shutter: {
      pages: pages.length,
      aimed: at,
      w: kept.width,
      h: kept.height,
      neighbour: neighbourIn(kept),
      wasNeighbour: alone ? neighbourIn(alone) : null,
      wasW: alone?.width ?? null,
      blindW: blind?.width ?? null,
      page: AIMED.w,
      quads: pages.map((q) => q.map(([x, y]) => [Math.round(x * W), Math.round(y * H)])),
    },
  };
});

await browser.close();

console.log(`the shape of the page that was dragged      ${result.want}`);
console.log(`taken AS GIVEN                              ${JSON.stringify(result.given)}`);
console.log(`put through the finder's corrections        ${JSON.stringify(result.found)}`);

// The page that comes back is the page that was dragged: the same shape, and
// with none of the facing page's black hatching along its right-hand edge.
const shapeOff = Math.abs(result.given.shape - result.want) / result.want;
const shaped = shapeOff < 0.06;
const clean = result.given.rightEdgeInk < 4;
console.log(`\nshape of what came out, against the drag:   ${(shapeOff * 100).toFixed(1)}% out  (want under 6%)`);
console.log(`the facing page along its right-hand edge:   ${result.given.rightEdgeInk}%  (want under 4)`);

console.log(`\nthe page the SHUTTER keeps, on a book       ${JSON.stringify(result.shutter)}`);
const split = result.shutter.pages === 2;
// TWO THINGS ARE ASKED OF THE KEPT PAGE, and the width is the sharper of them.
// A page of a book that comes back WIDER than the page aimed at has reached
// over the fold, whether or not it caught anything printed on the way: what it
// is holding is gutter, then margin, then the first system of the next page.
const over = result.shutter.w / result.shutter.page - 1;
const wasOver = result.shutter.wasW / result.shutter.page - 1;
const blindOver = result.shutter.blindW / result.shutter.page - 1;
// TWO WAYS TO GET THIS WRONG, and a bar at each end. Too wide and the page has
// reached over the gutter and taken its neighbour's margin. Too narrow and the
// page's own shadowed outer edge is outside the blue, which no straightening
// afterwards puts back — "the far right isnt in the blue".
// The two ends are not the same cost, and the bar says so. A page that comes out
// a little wide has a strip of the table down its edge, which `trimBackground`
// takes off the squared page and a player can see past. A page that comes out
// narrow has lost music, and nothing downstream puts that back.
const tight = over < 0.14 && over > -0.04;
const kept = result.shutter.neighbour < 0.4;
console.log(`pages found in the frame:                   ${result.shutter.pages}  (want 2)`);
console.log(`against the width of the page aimed at:     ${(over * 100).toFixed(1)}%  (want -4% to +14%)`);
console.log(`  …guard with no idea of the neighbour:      ${(wasOver * 100).toFixed(1)}%  (reaches over the gutter)`);
console.log(`  …guard switched off for the whole page:    ${(blindOver * 100).toFixed(1)}%  (loses the shadowed edge)`);
console.log(`the facing page inside the kept page:       ${result.shutter.neighbour}%  (want under 0.4)`);
const ok = shaped && clean && split && kept && tight;
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
