// Scores that are paper: a PDF, or a photograph of each page.
//
// Everything else in this app treats a score as NOTATION — bars, pitches,
// something a take can be lined up against. Most of the music a player actually
// owns is not that. It is a part their teacher printed, a movement downloaded
// from IMSLP, a page of an étude book photographed on a phone. None of it can
// be marked up against a recording, and all of it can be read from, paged
// through and written on, which is most of what a stand is for.
//
// So paper is a second kind of score, deliberately less clever: pages in, pages
// out, at whatever size the screen is. The reader treats the two the same from
// the outside — same page turns, same pen, same top bar.
//
// PDF.js is fetched on FIRST USE and never at startup, exactly like the
// engraver. A tuner has no business paying for a PDF renderer.

import { readableImage, readableImageSmall, sizeOfImage } from './straighten.js';
import { why } from './why.js';
import { unshadow } from '../analysis/unshadow.js';

// THE PAGE, BRIGHTENED FOR LOOKING AT — and only for looking at.
//
// A player asked for what a scanner app does: "makes the page brighter and
// eliminating shadows". The lighting is already divided out of a photograph on
// the way in; what is left is a page the shade it was photographed at, which is
// grey-brown paper. This takes it the rest of the way — the paper to just under
// white, the room's colour off it — and it is done HERE, on the pixels that go
// to the screen, rather than to the page that is stored.
//
// It is stored plain because the reader reads the stored page. MEASURED,
// `npm run scan:import`: brightening what the reader reads costs it notes,
// 51.4% of the marks on three photographed pages down to 49.9%, because taking
// the paper up takes the faintest staff lines with it and they are what a stave
// is found by. So the two are separated — the eye gets the bright page, the
// reader gets the flat one — and neither is asked to pay for the other.
function brighten(context, w, h) {
  if (!(w > 0) || !(h > 0)) return;
  try {
    const image = context.getImageData(0, 0, w, h);
    unshadow(image.data, w, h, { lift: true });
    context.putImageData(image, 0, 0);
  } catch { /* a page that will not read back is still a page on the screen */ }
}

// Where the music actually is on the page.
//
// A photograph of a book, or a PDF made for a printer, is mostly margin: the
// music sits in the middle with two centimetres of white all round it, and on a
// phone that white is a third of the screen. So every page is measured once —
// downscaled, then walked in from each edge until something darker than the
// paper turns up — and only that part of it is ever drawn. It is the reason a
// scan fills the screen instead of floating in it.
//
// Nothing is thrown away: the crop is a rectangle to draw FROM, the original
// image is untouched, and a page with ink to the edges simply crops to itself.
// HOW BIG THE PAGE IS MEASURED AT, and it was 160 pixels across.
//
// At 160 across, an A4 page of music has staff lines a fifth of a pixel wide.
// They wash out to within a few levels of the paper, and so do the noteheads on
// them — so the only thing left under the ink cut is the boldest print on the
// page: a heading, a big rehearsal number, a thick beam. The box then follows
// THAT, and the music is cropped away.
//
// MEASURED, `node tools/.draw-probe.mjs ~/Downloads/Burdett.pdf` (a cello
// method book, five pages): page 1 kept the whole page, and pages 2 to 5 came
// back cropped to 72%, 79%, 61% and 61% of their width — one of them starting
// 27% in. The reader then found ZERO staves and ZERO noteheads on every one of
// them, which is a part that cannot be recorded against at all, and it is a
// user's report: "zero notes were scanned".
//
// 560 across is where a staff line is still a pixel and the measurement is
// still a fraction of a millisecond.
const CROP_AT = 560;
const CROP_PAD = 0.012;      // a little air, so nothing sits against the edge
const INK_MARGIN = 26;       // how much darker than the paper counts as ink

function contentBox(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, w, h);
  const luma = new Float32Array(w * h);
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    const at = i * 4;
    luma[i] = data[at] * 0.299 + data[at + 1] * 0.587 + data[at + 2] * 0.114;
    total += luma[i];
  }
  // The paper is whatever most of the page is; ink is what is darker than that.
  const paper = total / (w * h);
  const dark = paper - INK_MARGIN;

  // HOW MUCH INK IS IN EACH ROW AND EACH COLUMN, rather than where the single
  // darkest pixel in the whole page is.
  //
  // This used to walk the extremes: the topmost dark pixel anywhere set the top
  // of the crop. One speck of sensor noise, one fleck of the table, one dark
  // pixel at the edge of a scan, and the crop is the whole page — which is what
  // was happening. Measured on a photographed page: the top of the crop was set
  // by a speck three rows down, so the margins were never taken off and the
  // reader showed the whole sheet fitted to the glass with a band of nothing
  // above and below it.
  //
  // A row of MUSIC has a staff line in it, which is hundreds of dark pixels. A
  // row of margin has none. So the edge of the printing is the first row with
  // enough ink in it to be printing, and a speck cannot vote.
  const rowInk = new Float64Array(h);
  const colInk = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] > dark) continue;
      rowInk[y] += 1;
      colInk[x] += 1;
    }
  }
  // Half a per cent of the way across is a staff line seen end-on; two pixels
  // is the floor, so this still works on a thumbnail of a very small page.
  const enoughAcross = Math.max(2, w * 0.005);
  const enoughDown = Math.max(2, h * 0.005);

  // AND THE OUTERMOST SLIVER IS NOT PRINTING.
  //
  // Nothing is printed to the very edge of a sheet of paper. What lives there
  // is the edge itself: the dark line a scanner leaves, the shadow under the
  // curl of a book, the sliver of table a photograph could not avoid. All of it
  // reads as ink, all of it hugs the border, and any one of those rows makes
  // the crop the whole page — measured on a photographed page, rows nine to
  // eleven of seven hundred held a dark edge, so the margins were never taken
  // off and the reader showed the whole sheet with a band of nothing above and
  // below it.
  //
  // So the search starts a little way in. A page loses nothing by it: a page
  // that really does have music in its outermost one and a half per cent has
  // been cropped too tight already.
  const insetY = Math.round(h * 0.015);
  const insetX = Math.round(w * 0.015);
  const firstWith = (counts, enough, from) => {
    for (let i = from; i < counts.length - from; i++) if (counts[i] >= enough) return i;
    return -1;
  };
  const lastWith = (counts, enough, from) => {
    for (let i = counts.length - 1 - from; i >= from; i--) if (counts[i] >= enough) return i;
    return -1;
  };

  const top = firstWith(rowInk, enoughAcross, insetY);
  const bottom = lastWith(rowInk, enoughAcross, insetY);
  const left = firstWith(colInk, enoughDown, insetX);
  const right = lastWith(colInk, enoughDown, insetX);

  if (right <= left || bottom <= top) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = CROP_PAD;
  const box = {
    x: Math.max(0, left / w - pad),
    y: Math.max(0, top / h - pad),
    w: Math.min(1, (right - left) / w + pad * 2),
    h: Math.min(1, (bottom - top) / h + pad * 2),
  };
  // A crop that keeps almost everything is not worth having; a crop that keeps
  // almost nothing is a mistake. Both fall back to the whole page.
  if (box.w * box.h > 0.92 || box.w < 0.25 || box.h < 0.25) return { x: 0, y: 0, w: 1, h: 1 };
  return box;
}

// A rectangle of the page, in the page's own coordinates.
//
// The reader works in CROPPED-page terms — 0 to 1 across the music, which is
// also what the page reader measured its staves in — and asks for a band of it
// at a time. A band may reach back OUTSIDE the crop, into the margin the crop
// took off, because that is where the last few pixels of a screenful come from.
// So it is combined with the crop rather than applied inside it, and clipped to
// the paper at the end: there is nothing beyond the edge of a photograph.
function region(crop, rect) {
  if (!rect) return crop;
  const x = crop.x + rect.x * crop.w;
  const y = crop.y + rect.y * crop.h;
  const w = rect.w * crop.w;
  const h = rect.h * crop.h;
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  return {
    x: left,
    y: top,
    w: Math.max(0.01, Math.min(1 - left, w - (left - x))),
    h: Math.max(0.01, Math.min(1 - top, h - (top - y))),
  };
}

// A small copy of a page, for measuring rather than showing.
function scratch(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// What the pages in hand have worked out about themselves, as two arrays the
// score can be asked to remember. A page nobody has looked at yet is a null,
// which is a hole for the next pass to fill rather than an answer.
//
// This exists because the reader was measuring every page of a part it had
// already measured on the last open, and throwing all of it away on close.
function measuredSoFar(count, crops, sizes) {
  const out = { crops: [], sizes: [] };
  for (let i = 0; i < count; i++) {
    out.crops.push(crops.get(i) ?? null);
    out.sizes.push(sizes.get(i) ?? null);
  }
  return out;
}

// Paper, under everything, before anything is drawn on it.
//
// An empty canvas is transparent, and transparent over the reader's ground is
// BLACK — so every moment between "this page has a size" and "this page has
// been drawn" was a black rectangle where the music goes. Sometimes that moment
// is long (a page still rendering), sometimes it arrives out of nowhere (iOS
// taking the pixels back under memory pressure), and either way what you get is
// a screen that goes black while you are playing off it.
//
// One fillRect makes the worst case a blank sheet of paper instead. In night
// mode the whole sheet is inverted by CSS, so this comes out near-black there
// without knowing anything about it.
const PAPER = '#f6f5f2';

function paperUnder(context, w, h) {
  context.fillStyle = PAPER;
  context.fillRect(0, 0, w, h);
}

// Give a canvas a size, and find out whether the device meant it.
//
// MAX_AREA below is a guess about somebody else's hardware, and a guess is a
// poor thing to hang a black screen on: too high and the ceiling it is meant to
// keep us under is still there, too low and the music is blurrier than the
// iPad could have drawn it. So the size is ASKED FOR and then checked. The
// canvas is filled with paper and one pixel of it is read back: paper is
// opaque, an allocation the device quietly refused is not, and the difference
// costs one pixel of readback against a render of several million.
//
// Refused, it halves and asks again. What comes out is the sharpest page this
// device will actually hand over, worked out on the device rather than assumed
// about it.
function sizeToBand(canvas, cssW, cssH, wanted) {
  let pixels = Math.max(0.25, wanted);
  for (let attempt = 0; ; attempt++) {
    canvas.width = Math.max(1, Math.round(cssW * pixels));
    canvas.height = Math.max(1, Math.round(cssH * pixels));
    canvas.style.width = `${Math.max(1, Math.round(cssW))}px`;
    canvas.style.height = `${Math.max(1, Math.round(cssH))}px`;
    const context = canvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    paperUnder(context, canvas.width, canvas.height);
    let took = true;
    // A canvas that cannot be read from is not a canvas that was refused —
    // that is a different problem, and guessing "refused" would halve the
    // sharpness of every page for ever.
    try { took = context.getImageData(0, 0, 1, 1).data[3] !== 0; } catch { took = true; }
    if (took || pixels <= 0.25 || attempt >= 4) return { context, pixels };
    pixels /= 2;
  }
}

// The most pixels one canvas is allowed to be.
//
// iOS will not give a canvas more than a certain number of pixels, and what it
// does when asked for more is the dangerous part: it does not throw, it does
// not return null, it hands back a canvas of the size you asked for with
// NOTHING IN IT. Every draw into it succeeds and every one of them is a no-op.
// On screen that is a page of music that is simply black, arriving for no
// reason anybody watching could name.
//
// Which is exactly what pinching to look closer used to do. Zooming asks for
// the page again at screen × zoom, that gets multiplied by the device's own
// pixels, and on an iPad at 5× it comes to about 79 million pixels — 314MB,
// four times over the line. The music went black, and letting go put it back.
//
// So every canvas here is fitted to what a device will actually hand over.
// Past that point a page stops getting sharper, which is the right way for a
// zoom to run out and the difference between a limit and a bug.
const MAX_SIDE = 4096;
const MAX_AREA = 12e6;   // ~48MB, and three times an iPad's own screen

// How much to shrink a canvas of this size by, or 1 if it is already fine.
function withinReach(w, h) {
  let k = 1;
  if (w > MAX_SIDE) k = Math.min(k, MAX_SIDE / w);
  if (h > MAX_SIDE) k = Math.min(k, MAX_SIDE / h);
  const area = (w * k) * (h * k);
  if (area > MAX_AREA) k *= Math.sqrt(MAX_AREA / area);
  return k;
}

let pdfLib = null;

async function loadPdfLib() {
  if (pdfLib) return pdfLib;
  let lib;
  let worker;
  try {
    // The LEGACY build, deliberately.
    //
    // pdf.js's default build is written against whatever the newest browsers
    // have, and one of the things it assumes is Map.prototype.getOrInsertComputed
    // — a method that reached browsers in 2025. On an iPad a version behind
    // that, opening a part died on "this.getOrInsertComputed is not a function"
    // and the import hung there for ever. The legacy build is the same reader
    // with the polyfills for those built-ins compiled in; it costs a larger
    // download of a chunk that is only ever fetched when a PDF is opened, and
    // it is the difference between a reader that works on the tablet somebody
    // actually owns and one that works on this year's.
    [lib, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
    ]);
  } catch (err) {
    // The reader itself would not load, and there are two quite different
    // reasons for that which this used to report as one.
    //
    // On an older tablet the PDF engine is genuinely too new for the browser,
    // and saying so is the help. But the commoner reason is that the engine is
    // a CHUNK FETCHED THE FIRST TIME A PDF IS OPENED — so a flaky connection, a
    // deploy landing between the page loading and the part being opened, or an
    // offline practice room all fail here too, and every one of them was told
    // their browser was too old and to photograph the pages instead.
    //
    // A failed fetch has no meaningful message in Safari (often none at all),
    // which is how a player ends up reading the word "null" — see src/ui/why.js.
    const said = why(err, '');
    const offline = /load|fetch|network|import|dynamic/i.test(said)
      || (typeof navigator !== 'undefined' && navigator.onLine === false);
    throw new Error(offline
      ? 'the PDF reader could not be downloaded — this part needs a connection the first'
        + ' time it is opened. Try again once you are online.'
      : `this browser cannot open PDFs — it is too old for the reader this app uses${
        said ? ` (${said})` : ''}. Photograph the pages instead, or open the app in Safari`
        + ' on a newer device');
  }
  // Without this the worker never starts and every page renders blank — silent,
  // and indistinguishable from a broken reader.
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfLib = lib;
  return lib;
}

// Where the rest of the reader lives — the decoders and fonts pdf.js fetches
// when a page turns out to need them. See vite.config.js for what these are.
//
// Unset, which is what they were, the URLs come out as the string "null" and
// every fetch for them fails: a scanned part is JBIG2 or JPEG 2000 inside, so
// its images decode to nothing and the page arrives blank. Nothing says so
// either — the render "succeeds" on an empty canvas.
// Worked out when a PDF is actually opened rather than when this file loads:
// the base URL is a browser thing, and reading it at module scope makes the
// whole module unimportable anywhere else — including the tests that check what
// a refused PDF says.
function pdfAssets() {
  const base = globalThis.document?.baseURI ?? '/';
  const at = (path) => new URL(path, base).href;
  return {
    wasmUrl: at('/pdfjs/wasm/'),
    standardFontDataUrl: at('/pdfjs/standard_fonts/'),
    cMapUrl: at('/pdfjs/cmaps/'),
    cMapPacked: true,
    iccUrl: at('/pdfjs/iccs/'),
  };
}

// What pdf.js is actually complaining about, in words a player can act on.
//
// This is the difference between "there was a problem" and knowing that the
// part is locked, or that the download came down truncated. Publishers encrypt
// PDFs as a matter of course, which makes a password prompt — not an error —
// the right answer to the commonest failure of all.
export function pdfTrouble(err) {
  const name = err?.name ?? '';
  const said = err?.message ?? String(err ?? 'something went wrong');
  if (name === 'PasswordException') {
    return err.code === 2
      ? 'that password was not right for this PDF'
      : 'this PDF is locked and needs its password';
  }
  if (name === 'InvalidPDFException') {
    return 'that file is not a PDF this reader can make sense of — it may have come down'
      + ' incomplete. Download it again, or photograph the pages instead';
  }
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') {
    return 'that PDF could not be read off the disk';
  }
  if (/QuotaExceeded/i.test(name) || /quota/i.test(said)) {
    return 'there is no room left on this device for a part that size';
  }
  return said;
}

// Whether a PDF needs a password before anything else can be asked of it.
export function needsPassword(err) {
  return err?.name === 'PasswordException';
}

// How many pages, and how to draw one. Both kinds answer the same two
// questions, so the reader never asks which it is holding.
export async function openPaper(payload) {
  // What was measured when the pages came in, if it was: see saveScoreLayout.
  const known = { crops: payload?.crops ?? null, sizes: payload?.sizes ?? null };
  if (payload?.source === 'pdf' && payload.data) return openPdf(payload.data, payload.password, known);
  if (payload?.pages?.length) return openImages(payload.pages, known);
  throw new Error('there are no pages in that score');
}

async function openPdf(data, password = null, known = {}) {
  const lib = await loadPdfLib();
  // A copy, because pdf.js takes ownership of the buffer it is handed and the
  // one in the database is wanted again next time.
  const doc = await lib.getDocument({
    data: new Uint8Array(data.slice(0)),
    ...pdfAssets(),
    ...(password ? { password } : {}),
  }).promise;
  const crops = new Map();
  const sizes = new Map();
  // Where the music is on this page. Measured off a thumbnail the first time,
  // which means RENDERING the page — so if it was measured when the score came
  // in, that answer is used and nothing is rendered at all.
  async function cropFor(index) {
    if (crops.has(index)) return crops.get(index);
    if (known.crops?.[index]) {
      crops.set(index, known.crops[index]);
      return crops.get(index);
    }
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const small = scratch(CROP_AT, Math.round(CROP_AT * (base.height / base.width)));
    const thumb = page.getViewport({ scale: small.width / base.width });
    await page.render({
      canvasContext: small.getContext('2d', { willReadFrequently: true }),
      viewport: thumb,
      canvas: small,
    }).promise;
    crops.set(index, contentBox(small));
    return crops.get(index);
  }
  return {
    count: doc.numPages,
    async aspect(index) {
      const page = await doc.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      return view.width / view.height;
    },
    cropOf: cropFor,
    async sizeOf(index) {
      if (sizes.has(index)) return sizes.get(index);
      if (known.sizes?.[index]) {
        sizes.set(index, known.sizes[index]);
        return sizes.get(index);
      }
      const page = await doc.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      sizes.set(index, { w: view.width, h: view.height });
      return sizes.get(index);
    },
    measured() { return measuredSoFar(doc.numPages, crops, sizes); },
    // The whole sheet, margins and all, with no crop applied at all.
    //
    // Everything else here draws the CROPPED page, which is the point of the
    // crop. This is the one thing that must not: it is what a new crop is
    // chosen from, and a page you can only see the inside of is a page whose
    // margins you can never give back.
    async drawWhole(index, canvas, width, height) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(width / base.width, height / base.height);
      const { context, pixels } = sizeToBand(canvas, base.width * fit, base.height * fit,
        dpr * withinReach(base.width * fit * dpr, base.height * fit * dpr));
      await page.render({
        canvasContext: context,
        viewport: page.getViewport({ scale: fit * pixels }),
        canvas,
        background: PAPER,
      }).promise;
    },
    draw(index, canvas, width, height, band = null) {
      return this.drawBand(index, canvas, band
        ? { x: 0, y: band.top, w: 1, h: band.bottom - band.top }
        : { x: 0, y: 0, w: 1, h: 1 }, width, height);
    },
    // Only the band, and only ever the band.
    //
    // This used to fit the crop to the screen, render the WHOLE PAGE at that
    // size into a canvas of its own, and copy the sliver it wanted out of it.
    // A band is a third of a page, so the scale that makes a third of a page
    // fill an iPad makes the whole page three iPads tall: a 15–22MB canvas,
    // built and thrown away for every page turn, on a device with a hard
    // ceiling on how much canvas it will hold at once. Past that ceiling iOS
    // does not fail — it quietly takes the pixels back out of canvases that
    // are still on screen, which is a page of music that turns black while you
    // are reading it, and a turn that took a second and a half to do it.
    //
    // pdf.js will render a page anywhere on a canvas, including mostly off the
    // edge of one, and a canvas clips. So the page is slid up and left until the
    // band lands on the origin and the canvas is cut to the band: everything
    // outside it is never rasterised and never allocated. Same pixels on the
    // glass, a fraction of the memory to put them there.
    //
    // The slide is `transform` rather than the viewport's own offsetX/offsetY.
    // Both exist and they are not the same thing: the viewport's offsets are
    // applied inside a transform that has already flipped the page the right way
    // up, so using them renders the music upside down. `transform` is applied in
    // the canvas's own coordinates, where "up and left" means what it says.
    async drawBand(index, canvas, rect, width, height, density = 1) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const crop = region(await cropFor(index), rect);
      const cropW = base.width * crop.w;
      const cropH = base.height * crop.h;
      // How big the band is on the glass, and then how many real pixels it is
      // allowed to be made of. The two are kept apart: a canvas cut down to fit
      // the device is a canvas with fewer pixels in the SAME space, not a
      // smaller page.
      const fit = Math.min(width / cropW, height / cropH);
      const { context, pixels } = sizeToBand(canvas, cropW * fit, cropH * fit,
        density * dpr * withinReach(cropW * fit * dpr, cropH * fit * dpr));
      const scale = fit * pixels;
      await page.render({
        canvasContext: context,
        viewport: page.getViewport({ scale }),
        canvas,
        transform: [1, 0, 0, 1,
          -Math.round(crop.x * base.width * scale),
          -Math.round(crop.y * base.height * scale)],
        background: PAPER,
      }).promise;
    },
    destroy() { doc.destroy?.(); },
  };
}

// A page that will not decode, drawn as a page that says so. One bad photograph
// in a twelve-page part is a bad photograph; it is not a reason for the part to
// refuse to open, which is what throwing here used to make it.
function missingPage(index) {
  const canvas = scratch(1000, 1400);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f5f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#8a8794';
  ctx.textAlign = 'center';
  ctx.font = '400 42px system-ui, sans-serif';
  ctx.fillText(`Page ${index + 1} could not be read`, canvas.width / 2, canvas.height / 2 - 24);
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillText('Scan or import this page again', canvas.width / 2, canvas.height / 2 + 34);
  return canvas;
}

// How many photographed pages are kept decoded at once.
//
// This must stay comfortably ABOVE the number of pages the reader can be
// drawing at one moment, and that is what makes evicting safe without any
// book-keeping about who is using what: asking for a page moves it to the front
// of the queue, eviction always takes from the back, so a page being drawn is
// only ever thrown out if this many OTHER pages were asked for after it. The
// reader shows at most two pages at once (a spread) and looks two either side,
// so six is the most that can ever be in flight. Eight leaves room to be wrong.
const DECODED_PAGES = 8;

async function openImages(blobs, known = {}) {
  const cache = new Map();
  const crops = new Map();
  const sizes = new Map();
  // Every page is decoded through the same door as the importer, so a format
  // one of them accepts is a format the other one draws.
  //
  // Only the last few pages looked at are kept decoded. A phone photograph of a
  // page is twelve megapixels — around 48MB once it is pixels rather than JPEG
  // — and this used to keep every page it had ever drawn, for as long as the
  // score was open. Twenty pages of a scanned part is a gigabyte of decoded
  // photographs held against a device that has nothing like that to give, and
  // what iOS does about it is take the pixels back out of the canvases the
  // reader is using to show them. Which is the page going black.
  const load = (index) => {
    if (cache.has(index)) {
      // Looked at again: back to the front of the queue.
      const held = cache.get(index);
      cache.delete(index);
      cache.set(index, held);
      return held;
    }
    const promise = (async () => {
      const blob = blobs[index];
      if (!blob) return { el: missingPage(index), w: 1000, h: 1400, missing: true };

      // ONE FAILED DECODE IS NOT A BROKEN PAGE.
      //
      // "when i finish scanning something it says page not read after a couple
      // of seconds" — and the page was fine. A phone that has just taken half a
      // dozen photographs, straightened them and opened the reader has no
      // memory to spare, and iOS answers the next decode with a failure rather
      // than with pixels. That was taken as proof the page was unreadable, the
      // "could not be read" card was drawn, and — because the failure was
      // cached like any other answer — it stayed drawn for as long as the score
      // was open, however much memory came free afterwards.
      //
      // So: try again after a moment, then try at half the size, and if the
      // page still will not come, do not remember the failure. The next page
      // turn asks again.
      let image = await readableImage(blob);
      if (!image) {
        await new Promise((wait) => setTimeout(wait, 150));
        image = await readableImage(blob);
      }
      if (!image) image = await readableImageSmall(blob);
      if (!image) {
        cache.delete(index);
        return { el: missingPage(index), w: 1000, h: 1400, missing: true };
      }
      const { w, h } = sizeOfImage(image);
      return { el: image, w, h, missing: false };
    })();
    cache.set(index, promise);
    // A Map keeps its insertion order, so the oldest key is the first one.
    while (cache.size > DECODED_PAGES) {
      const oldest = cache.keys().next().value;
      const going = cache.get(oldest);
      cache.delete(oldest);
      // close() is what hands an ImageBitmap's memory back; without it the
      // decoded page stays alive until the collector gets round to it, which on
      // the device that needs the memory is far too late.
      Promise.resolve(going).then((page) => page?.el?.close?.()).catch(() => {});
    }
    return promise;
  };
  async function cropFor(index) {
    if (crops.has(index)) return crops.get(index);
    // Measured when the page came in, if it was: measuring means decoding the
    // whole photograph, and the answer cannot have changed since.
    if (known.crops?.[index]) {
      crops.set(index, known.crops[index]);
      return crops.get(index);
    }
    const page = await load(index);
    const small = scratch(CROP_AT, Math.max(1, Math.round(CROP_AT * (page.h / page.w))));
    small.getContext('2d', { willReadFrequently: true })
      .drawImage(page.el, 0, 0, small.width, small.height);
    crops.set(index, page.missing ? { x: 0, y: 0, w: 1, h: 1 } : contentBox(small));
    return crops.get(index);
  }
  return {
    count: blobs.length,
    async aspect(index) {
      const page = await load(index);
      return page.w / page.h;
    },
    cropOf: cropFor,
    async sizeOf(index) {
      if (sizes.has(index)) return sizes.get(index);
      if (known.sizes?.[index]) {
        sizes.set(index, known.sizes[index]);
        return sizes.get(index);
      }
      const page = await load(index);
      sizes.set(index, { w: page.w, h: page.h });
      return sizes.get(index);
    },
    measured() { return measuredSoFar(blobs.length, crops, sizes); },
    // The whole photograph, uncropped — see the note on the PDF side.
    async drawWhole(index, canvas, width, height, { plain = false } = {}) {
      const page = await load(index);
      const dpr = window.devicePixelRatio || 1;
      const fit = Math.min(width / page.w, height / page.h);
      const w = Math.max(1, Math.round(page.w * fit));
      const h = Math.max(1, Math.round(page.h * fit));
      const { context, pixels } = sizeToBand(canvas, w, h, dpr * withinReach(w * dpr, h * dpr));
      context.setTransform(pixels, 0, 0, pixels, 0, 0);
      context.drawImage(page.el, 0, 0, w, h);
      if (!plain) brighten(context, canvas.width, canvas.height);
    },
    draw(index, canvas, width, height, band = null, opts = {}) {
      return this.drawBand(index, canvas, band
        ? { x: 0, y: band.top, w: 1, h: band.bottom - band.top }
        : { x: 0, y: 0, w: 1, h: 1 }, width, height, 1, opts);
    },
    async drawBand(index, canvas, rect, width, height, density = 1, { plain = false } = {}) {
      const page = await load(index);
      const dpr = window.devicePixelRatio || 1;
      const crop = region(await cropFor(index), rect);
      const sx = crop.x * page.w;
      const sy = crop.y * page.h;
      const sw = crop.w * page.w;
      const sh = crop.h * page.h;
      const scale = Math.min(width / sw, height / sh);
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      // Same space on the glass, only as many real pixels as the device will
      // actually give — see sizeToBand.
      const { context, pixels } = sizeToBand(canvas, w, h,
        density * dpr * withinReach(w * dpr, h * dpr));
      context.setTransform(pixels, 0, 0, pixels, 0, 0);
      context.drawImage(page.el, sx, sy, sw, sh, 0, 0, w, h);
      // On the pixels that were just drawn — the band, at the size it is being
      // shown — so nothing is held in memory for it and a page that is never
      // looked at is never brightened. See `brighten`.
      if (!plain) brighten(context, canvas.width, canvas.height);
    },
    destroy() {
      for (const promise of cache.values()) {
        Promise.resolve(promise).then((page) => page?.el?.close?.()).catch(() => {});
      }
      cache.clear();
    },
  };
}

// --- bringing paper in --------------------------------------------------------

// A breath between pages.
//
// Reading a page is a tenth of a second of solid arithmetic, and a run of them
// back to back is a tenth of a second at a time when the screen answers
// nothing — the app looking stuck while it is in fact working. Handing the
// frame back means a tap lands and the page being read from still turns.
//
// A frame AND a timer, whichever comes first, and the timer is the important
// half: a webview that has been put in the background is not painting, so
// requestAnimationFrame there is not "soon", it is NEVER. Waiting on it alone
// stops the pass dead the moment somebody switches apps — which is precisely
// the moment this pass exists to survive.
function breathe() {
  return new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    setTimeout(go, 40);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  });
}

// How often the pass stops to write down what it has. Small, because the cost
// of a write is two short arrays and the cost of not having written is the
// whole part read again.
const SAVE_EVERY = 3;

// Reading the shape of every page as it comes in: staves, bars, noteheads. It
// happens once, at import, because it takes a second a page and because the
// answer never changes — the photograph is the photograph.
//
// `onMeasured` is handed what has been read SO FAR, every few pages, and it is
// the difference between a pass that survives being interrupted and one that
// does not. This used to hand back everything at the end and only at the end:
// twenty-six pages of a twenty-seven page part, and then the app was put aside,
// meant nothing was written down at all — and nothing ever ran this again, so
// that part measured itself from scratch on every open for the rest of its life.
// Which is the twenty seconds of black screen this whole thing is about.
// `standAside` is awaited before every page, and is how this pass stays out of
// the way of somebody actually reading. Measuring a part is a second of solid
// arithmetic per page, and until now it took that second whether or not a
// player was tapping to turn a page at the time — so opening a part you had
// just imported and reading from it meant every turn queueing behind a page
// being measured. On a laptop that is invisible. On an iPad it is the
// occasional turn that hangs for a second and then catches up, which is
// exactly what it looked like from the stand.
export async function readPages(
  payload, onProgress = null, onMeasured = null, standAside = null,
) {
  const pages = await openPaper(payload);
  const { readPage } = await import('../analysis/scan-read.js');
  const layout = [];
  // Measured here because this is the one pass that already looks at every
  // page. Doing it here means the reader never has to, and opening a long part
  // stops costing a render per page before anything appears.
  const crops = [];
  const sizes = [];
  // One canvas for the whole pass, emptied after every page.
  //
  // A page big enough to read a staff space off is fourteen megabytes, and this
  // used to make a new one for each of them and leave the old one to the
  // collector. Twenty-seven pages is then twenty-seven fourteen-megabyte
  // canvases whose moment of being freed is somebody else's decision — and on
  // an iPad, what happens while that decision is pending is that the pages the
  // reader is SHOWING get emptied to make room. Zero by zero is how a canvas
  // hands its pixels back at a moment of our choosing rather than at one of the
  // collector's.
  const sheet = scratch(8, 8);
  const release = () => { sheet.width = 0; sheet.height = 0; };
  for (let i = 0; i < pages.count; i++) {
    onProgress?.(i, pages.count);
    let found = null;
    try {
      // Big enough to read a staff space, and no bigger. draw() works in device
      // pixels, so the request is divided by them — on a phone at 3× this would
      // otherwise build a 4200px canvas per page to look at 1400px of it.
      const dpr = window.devicePixelRatio || 1;
      // The DRAW is inside the try as well, and that is the point of this.
      // A page that will not render threw straight out of the loop, so the
      // narration stopped on "reading the pages… 1 of 21" and stayed there —
      // the score was already saved and openable, and the only thing broken
      // was the sentence on the screen.
      // PLAIN, because this is the reader's copy. The bright page is for the
      // eye; taking the paper up takes the faintest staff lines with it. See
      // `brighten` above.
      await pages.draw(i, sheet, 1400 / dpr, 6000 / dpr, null, { plain: true });
      // Again here, between the two expensive halves of a page. Drawing it and
      // reading it are each about half a second on a tablet, and standing
      // aside only between whole pages meant a turn could still be a full page
      // behind. This halves the longest a tap can wait.
      if (standAside) await standAside();
      found = readPage(sheet, sheet.width, sheet.height);
      // …AND AGAIN, BIGGER, WHERE THE MUSIC IS SMALL.
      //
      // 1400 across is enough for a page with four or five systems on it and
      // nothing like enough for a page with ten. On a cello method book it puts
      // the staff space at four pixels, and at four pixels the reader calls 18
      // staves of a bass-clef part TREBLE — every note a sixth and an octave
      // out, so a player who plays the page exactly is told none of their notes
      // matched it. `readPage` will take a second, larger look by itself, but
      // only if it is HANDED more pixels than it used; this is where they come
      // from. MEASURED, node tools/pdf-open-check.mjs on that book — see the
      // note above WORK_MOST in scan-read.js.
      //
      // Only for the pages that need it, because a re-render is the most
      // expensive thing in this loop and most pages do not.
      const smallSpace = (found?.space ?? 0) * sheet.height;
      if (found && smallSpace > 0 && smallSpace < 9) {
        if (standAside) await standAside();
        await pages.draw(i, sheet, 2400 / dpr, 9000 / dpr, null, { plain: true });
        if (standAside) await standAside();
        const closer = readPage(sheet, sheet.width, sheet.height);
        const heads = (read) => (read?.staves ?? [])
          .reduce((n, st) => n + (st.heads?.length ?? 0), 0);
        if (closer && heads(closer) >= heads(found)) found = closer;
      }
    } catch {
      found = null;   // an unreadable page is not a reason to lose the score
    }
    release();
    layout.push(found);
    try {
      crops.push(await pages.cropOf(i));
      sizes.push(await pages.sizeOf(i));
    } catch {
      crops.push(null);
      sizes.push(null);
    }
    // Written down as it goes, not at the end. A pass that gets three pages in
    // and is then interrupted has still made the next open three pages faster.
    if ((i + 1) % SAVE_EVERY === 0 && i + 1 < pages.count) {
      // Never fatal: the reading is worth finishing whether or not the disk
      // took this instalment of it.
      await Promise.resolve(onMeasured?.({ layout, crops, sizes })).catch(() => {});
    }
    await breathe();
    // The page in front of the player comes first, always. This pass has
    // nothing to do that will not keep.
    if (standAside) await standAside();
  }
  release();
  pages.destroy?.();
  // Three arrays, one per page, rather than properties hung off the layout: an
  // array with things attached to it loses them the moment it is stored, and
  // storing them is the entire point. A null in crops or sizes means that page
  // was not measured, and the reader works that one out for itself.
  return { layout, crops, sizes };
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

export function isImage(file) {
  return file.type?.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name ?? '');
}

// What the FILE says it is, rather than what the phone called it.
//
// A file arriving from an iPad — out of Files, out of another app's share
// sheet, out of iCloud Drive — regularly has an empty type and a name with no
// extension on it, and then a PDF looks like neither a PDF nor a picture and is
// refused as "not pages of music". Every PDF ever written begins %PDF, so ask
// the bytes.
export async function sniffPdf(file) {
  try {
    // Not just the first four bytes: a PDF is allowed a little rubbish in front
    // of its header, and files that have been through a few apps often have it.
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    return String.fromCharCode(...head).includes('%PDF-');
  } catch {
    return false;
  }
}

// The same question for a picture: the four magic numbers that cover
// everything a camera or a scanner produces.
export async function sniffImage(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const is = (...bytes) => bytes.every((b, i) => head[i] === b);
    if (is(0xff, 0xd8, 0xff)) return true;                                  // JPEG
    if (is(0x89, 0x50, 0x4e, 0x47)) return true;                            // PNG
    if (is(0x47, 0x49, 0x46, 0x38)) return true;                            // GIF
    const tag = String.fromCharCode(...head.slice(4, 12));
    return tag.startsWith('ftyp') || String.fromCharCode(...head.slice(0, 4)) === 'RIFF';
  } catch {
    return false;
  }
}

// A name a player would recognise: the file's, without the extension, without
// the phone's timestamp soup.
export function nameFromFile(file) {
  const raw = String(file.name ?? '').replace(/\.[a-z0-9]+$/i, '').trim();
  if (!raw || /^(img|image|photo|scan|document)[-_ ]?\d*$/i.test(raw)) return 'Scanned score';
  return raw.slice(0, 80);
}

// How many pages a PDF has, without keeping the document open — the shelf wants
// the number the moment it is imported.
//
// It is also where a locked part is unlocked. A publisher's PDF asks for a
// password, and asking for it is the answer: the part opens, the password is
// kept beside it, and every later open is silent. Refusing the file, which is
// what happened before, is the one answer that helps nobody.
export async function pdfPageCount(data, { askPassword = null } = {}) {
  const lib = await loadPdfLib();
  let password = null;
  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await lib.getDocument({
        data: new Uint8Array(data.slice(0)),
        ...pdfAssets(),
        ...(password ? { password } : {}),
      }).promise;
      const count = doc.numPages;
      doc.destroy?.();
      return { count, password };
    } catch (err) {
      if (!needsPassword(err) || !askPassword || attempt >= 3) throw err;
      password = await askPassword(err.code === 2);
      if (!password) throw err;
    }
  }
}
