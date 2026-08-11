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
  let left = w; let right = 0; let top = h; let bottom = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] > dark) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
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

// A band of the page, in the page's own coordinates. The reader asks for one
// screenful of systems at a time; the crop already trimmed the margins, and the
// band is measured against the WHOLE page, so the two have to be combined
// rather than applied one inside the other.
function sliced(crop, band) {
  if (!band) return crop;
  // The band is expressed against the CROPPED page — that is the picture the
  // page reader measured — so it is a fraction of the crop, not of the paper.
  const y = crop.y + band.top * crop.h;
  const h = Math.max(0.02, (band.bottom - band.top)) * crop.h;
  return { x: crop.x, y, w: crop.w, h: Math.min(h, crop.y + crop.h - y) };
}

// A small copy of a page, for measuring rather than showing.
function scratch(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

let pdfLib = null;

async function loadPdfLib() {
  if (pdfLib) return pdfLib;
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  // Without this the worker never starts and every page renders blank — silent,
  // and indistinguishable from a broken reader.
  lib.GlobalWorkerOptions.workerSrc = worker.default;
  pdfLib = lib;
  return lib;
}

// How many pages, and how to draw one. Both kinds answer the same two
// questions, so the reader never asks which it is holding.
export async function openPaper(payload) {
  if (payload?.source === 'pdf' && payload.data) return openPdf(payload.data);
  if (payload?.pages?.length) return openImages(payload.pages);
  throw new Error('there are no pages in that score');
}

async function openPdf(data) {
  const lib = await loadPdfLib();
  // A copy, because pdf.js takes ownership of the buffer it is handed and the
  // one in the database is wanted again next time.
  const doc = await lib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const crops = new Map();
  return {
    count: doc.numPages,
    async aspect(index) {
      const page = await doc.getPage(index + 1);
      const view = page.getViewport({ scale: 1 });
      return view.width / view.height;
    },
    // The shape of the page AS DRAWN — margins already trimmed. It is what the
    // reader needs to work out how much music fits on a screen.
    async cropAspect(index) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      if (!crops.has(index)) {
        const small = scratch(160, Math.round(160 * (base.height / base.width)));
        const thumb = page.getViewport({ scale: small.width / base.width });
        await page.render({
          canvasContext: small.getContext('2d', { willReadFrequently: true }),
          viewport: thumb,
          canvas: small,
        }).promise;
        crops.set(index, contentBox(small));
      }
      const crop = crops.get(index);
      return (base.width * crop.w) / (base.height * crop.h);
    },
    async draw(index, canvas, width, height, band = null) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      // Where the music is on this page, measured once off a thumbnail.
      if (!crops.has(index)) {
        const small = scratch(160, Math.round(160 * (base.height / base.width)));
        const thumb = page.getViewport({ scale: small.width / base.width });
        await page.render({
          canvasContext: small.getContext('2d', { willReadFrequently: true }),
          viewport: thumb,
          canvas: small,
        }).promise;
        crops.set(index, contentBox(small));
      }
      const crop = sliced(crops.get(index), band);
      // Fit the CROP to the screen, then render the whole page that much bigger
      // and show only the part that matters.
      const cropW = base.width * crop.w;
      const cropH = base.height * crop.h;
      const scale = Math.min(width / cropW, height / cropH);
      const viewport = page.getViewport({ scale: scale * dpr });
      const full = scratch(Math.round(viewport.width), Math.round(viewport.height));
      await page.render({
        canvasContext: full.getContext('2d'),
        viewport,
        canvas: full,
      }).promise;
      const sx = Math.round(crop.x * full.width);
      const sy = Math.round(crop.y * full.height);
      const sw = Math.round(crop.w * full.width);
      const sh = Math.round(crop.h * full.height);
      canvas.width = sw;
      canvas.height = sh;
      canvas.style.width = `${Math.round(sw / dpr)}px`;
      canvas.style.height = `${Math.round(sh / dpr)}px`;
      const context = canvas.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, sw, sh);
      context.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    },
    destroy() { doc.destroy?.(); },
  };
}

async function openImages(blobs) {
  const urls = blobs.map((blob) => URL.createObjectURL(blob));
  const cache = new Map();
  const crops = new Map();
  const load = (index) => {
    if (cache.has(index)) return cache.get(index);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('that page could not be read as an image'));
      image.src = urls[index];
    });
    cache.set(index, promise);
    return promise;
  };
  return {
    count: urls.length,
    async aspect(index) {
      const image = await load(index);
      return image.naturalWidth / image.naturalHeight;
    },
    async cropAspect(index) {
      const image = await load(index);
      if (!crops.has(index)) {
        const small = scratch(160, Math.max(1, Math.round(160 * (image.naturalHeight / image.naturalWidth))));
        small.getContext('2d', { willReadFrequently: true })
          .drawImage(image, 0, 0, small.width, small.height);
        crops.set(index, contentBox(small));
      }
      const crop = crops.get(index);
      return (image.naturalWidth * crop.w) / (image.naturalHeight * crop.h);
    },
    async draw(index, canvas, width, height, band = null) {
      const image = await load(index);
      const dpr = window.devicePixelRatio || 1;
      if (!crops.has(index)) {
        const small = scratch(160, Math.max(1, Math.round(160 * (image.naturalHeight / image.naturalWidth))));
        small.getContext('2d', { willReadFrequently: true })
          .drawImage(image, 0, 0, small.width, small.height);
        crops.set(index, contentBox(small));
      }
      const crop = sliced(crops.get(index), band);
      const sx = crop.x * image.naturalWidth;
      const sy = crop.y * image.naturalHeight;
      const sw = crop.w * image.naturalWidth;
      const sh = crop.h * image.naturalHeight;
      const scale = Math.min(width / sw, height / sh);
      const w = Math.round(sw * scale);
      const h = Math.round(sh * scale);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const context = canvas.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, w, h);
      context.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
    },
    destroy() {
      for (const url of urls) URL.revokeObjectURL(url);
      cache.clear();
    },
  };
}

// --- bringing paper in --------------------------------------------------------

// Reading the shape of every page as it comes in: staves, bars, noteheads. It
// happens once, at import, because it takes a second a page and because the
// answer never changes — the photograph is the photograph.
export async function readPages(payload, onProgress = null) {
  const pages = await openPaper(payload);
  const { readPage } = await import('../analysis/scan-read.js');
  const layout = [];
  for (let i = 0; i < pages.count; i++) {
    onProgress?.(i, pages.count);
    const canvas = scratch(8, 8);
    // Big enough to read a staff space, and no bigger. draw() works in device
    // pixels, so the request is divided by them — on a phone at 3× this would
    // otherwise build a 4200px canvas per page to look at 1400px of it.
    const dpr = window.devicePixelRatio || 1;
    await pages.draw(i, canvas, 1400 / dpr, 6000 / dpr);
    let found = null;
    try {
      found = readPage(canvas, canvas.width, canvas.height);
    } catch {
      found = null;   // an unreadable page is not a reason to lose the score
    }
    layout.push(found);
  }
  pages.destroy?.();
  return layout;
}

// --- composing a screenful ------------------------------------------------------
//
// A page of music and a screen are different shapes, and nothing makes them the
// same shape: fit the page and there is a band of nothing above and below; fill
// the screen and the sides of the music are cut off. So the page is not fitted
// at all. It is taken apart into systems and rebuilt to the shape of the glass:
// every system drawn the full width, stacked down the screen, the leftover
// space shared out between them as air. The music fills the screen because the
// screen was composed out of music.
//
// It is the same idea as justified text, and it is why a scan can look like the
// app rather than like a photograph of a book sitting inside the app.
export function composedPage(pages) {
  const rendered = new Map();     // page index -> { canvas, width }

  async function pageCanvas(index, width) {
    const held = rendered.get(index);
    if (held && Math.abs(held.width - width) < 2) return held.canvas;
    const canvas = scratch(8, 8);
    await pages.draw(index, canvas, width, 100000);   // the whole page, this wide
    rendered.set(index, { canvas, width });
    return canvas;
  }

  return {
    forget() { rendered.clear(); },
    // rows: [{ page, top, bottom, x0, x1, destY, destH }] — a piece of the page
    // in its own 0-1 terms, and where it goes on the screen in pixels. A piece
    // may be part of a system's width as well as part of its height: on a
    // narrow screen a line of music is cut at a barline and stacked, which is
    // how it stays big instead of merely fitting.
    async draw(canvas, rows, width, height) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${Math.round(width)}px`;
      canvas.style.height = `${Math.round(height)}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      for (const row of rows) {
        const x0 = row.x0 ?? 0;
        const x1 = row.x1 ?? 1;
        const source = await pageCanvas(row.page, (width * dpr) / Math.max(0.05, x1 - x0));
        const sx = x0 * source.width;
        const sw = Math.max(1, (x1 - x0) * source.width);
        const sy = row.top * source.height;
        const sh = Math.max(1, (row.bottom - row.top) * source.height);
        ctx.drawImage(source, sx, sy, sw, sh, 0, row.destY, width, row.destH);
      }
    },
    // How tall a band of this page stands when a slice of its width is drawn
    // across the whole screen — the narrower the slice, the taller the music.
    async heightOf(index, top, bottom, width, x0 = 0, x1 = 1) {
      const dpr = window.devicePixelRatio || 1;
      const source = await pageCanvas(index, (width * dpr) / Math.max(0.05, x1 - x0));
      return ((bottom - top) * source.height) / dpr;
    },
  };
}

export function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '');
}

export function isImage(file) {
  return file.type?.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name ?? '');
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
export async function pdfPageCount(data) {
  const lib = await loadPdfLib();
  const doc = await lib.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const count = doc.numPages;
  doc.destroy?.();
  return count;
}
