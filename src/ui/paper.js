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
    async draw(index, canvas, width, height) {
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
      const crop = crops.get(index);
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
    async draw(index, canvas, width, height) {
      const image = await load(index);
      const dpr = window.devicePixelRatio || 1;
      if (!crops.has(index)) {
        const small = scratch(160, Math.max(1, Math.round(160 * (image.naturalHeight / image.naturalWidth))));
        small.getContext('2d', { willReadFrequently: true })
          .drawImage(image, 0, 0, small.width, small.height);
        crops.set(index, contentBox(small));
      }
      const crop = crops.get(index);
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
