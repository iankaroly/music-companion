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
      // Fit inside the box, and render at the device's real pixels so the
      // engraving on the page is as sharp as the screen can show.
      const dpr = window.devicePixelRatio || 1;
      const scale = Math.min(width / base.width, height / base.height);
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
      const context = canvas.getContext('2d');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
    },
    destroy() { doc.destroy?.(); },
  };
}

async function openImages(blobs) {
  const urls = blobs.map((blob) => URL.createObjectURL(blob));
  const cache = new Map();
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
      const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const w = Math.round(image.naturalWidth * scale);
      const h = Math.round(image.naturalHeight * scale);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const context = canvas.getContext('2d');
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, w, h);
      context.drawImage(image, 0, 0, w, h);
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
