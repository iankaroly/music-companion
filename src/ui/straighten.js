// A photograph of a page, turned into a page.
//
// One thing happens here, to every photograph that comes into the app — taken
// with the camera or picked out of the phone's library, it makes no difference:
// the sheet of paper is found, pulled square, and the lighting is taken off it.
// What gets stored is the page. Not the table it was lying on, not the facing
// page, not the corner of the room, and not the trapezium the camera saw
// because it was held at arm's length over a book.
//
// It happens ONCE, on the way in, rather than every time a page is drawn: the
// work is a few hundred milliseconds a page and the answer never changes.
//
// If the paper cannot be found convincingly, the photograph is cropped to the
// bright part of the frame instead — which still gets rid of the table, the
// visible half of the complaint — and if even that fails, the picture is kept
// exactly as it was taken. A page ruined by a confident guess has no undo.

import { findPage, findPages, homography, through, rectFor } from '../analysis/page-edges.js';
import { unshadow } from '../analysis/unshadow.js';

const LOOK_AT = 220;      // the width the corners are looked for at
const MOST = 2000;        // the widest a straightened page is stored at
// The longest edge the PIXEL work is done at. A phone camera hands over twelve
// megapixels; squaring a page reads every one of them into a Float array, twice,
// and on a phone that is where the whole thing quietly falls over — the canvas
// comes back blank, the encode comes back empty, and what gets stored is a page
// no browser will open. Nothing downstream wants more than MOST pixels across
// anyway, so the work happens at a size that fits in memory on the device this
// is actually used on.
const WORK_MAX = 2600;

function scratch(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// One value a pixel, at the size the search works at.
function lumaOf(source, w, h) {
  const small = scratch(w, h);
  small.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
  const { data } = small.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  const luma = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    luma[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  return luma;
}

// Is there really an edge of paper along this side of the quadrilateral?
//
// THE PROBLEM THIS SOLVES: a page held close enough to fill the frame — which
// is exactly what the scanner asks for, in those words — has no visible edge.
// The detector then finds the strongest boundary it can see, and on a page of
// music that is where the PRINTING stops. Measured on three photographs of
// pages that fill the frame, the quadrilateral came back 100% of the width and
// 79–90% of the height: 8–11% cut off the top and bottom of every one of them,
// taking the title, the composer and the last system with it.
//
// A real paper edge has paper on one side and something else on the other, so
// it is a STEP in brightness. The end of the printed area has paper on both
// sides. That is the difference this measures: sample a band just inside the
// boundary and a band just outside it, and if the outside is still as bright as
// the inside, nothing ends there and the boundary is not to be trusted.
/**
 * Is there PRINT just outside this boundary?
 *
 * The one thing a crop must never do is cut through the music, and the two
 * things it has to tell apart are a sheet of paper ending and a page of print
 * continuing. Both are darker outside than in, so brightness cannot do it —
 * that was tried twice and cut a system off a page each time.
 *
 * Print has a shape brightness does not: it is thin dark marks with paper
 * showing between them. A table, a shadow, the dark of the room — whatever is
 * beyond a real paper edge — is dark in a lump, with no paper in it. So the
 * question is not "is it darker out there" but "are there dark marks out there
 * WITH PAPER AROUND THEM", and that is what this counts.
 */
function printBeyond(luma, w, h, side, at) {
  const along = side === 'top' || side === 'bottom' ? w : h;
  const depth = Math.max(3, Math.round((side === 'top' || side === 'bottom' ? h : w) * 0.04));
  const inside = [];
  const beyond = [];

  const value = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? null : luma[y * w + x]);
  const step = (i, d) => {
    if (side === 'top') return [i, at - d];
    if (side === 'bottom') return [i, at + d];
    if (side === 'left') return [at - d, i];
    return [at + d, i];
  };

  // A gap, so the boundary itself is never sampled. The pixels either side of
  // an edge are a blend of both sides, and counting those as "a dark mark with
  // paper beside it" is how the first version of this refused to crop a page
  // lying on a table.
  const gap = Math.max(2, Math.round(depth * 0.3));

  for (let i = 0; i < along; i += 1) {
    for (let d = gap; d <= depth + gap; d += 1) {
      const [ox, oy] = step(i, d);
      const out = value(ox, oy);
      if (out !== null) beyond.push([ox, oy, out]);
      const [ix, iy] = step(i, -d);
      const inn = value(ix, iy);
      if (inn !== null) inside.push(inn);
    }
  }
  if (beyond.length < 200 || inside.length < 200) return false;   // nothing out there to judge

  const sorted = [...inside].sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.6)];
  const dark = paper - 45;
  const light = paper - 20;

  // IS IT STILL A PAGE OUT THERE? Beyond a boundary that has music past it,
  // most of what you see is paper — printing is thin, and a page is mostly
  // white even where it is busy. Beyond the real edge of the sheet, hardly any
  // of it is. This is the half of the test that tells a table from a margin,
  // and it does the work the brightness comparisons could not.
  const paperShare = beyond.filter(([, , level]) => level > light).length / beyond.length;
  if (paperShare < 0.5) return false;

  let marks = 0;
  for (const [x, y, level] of beyond) {
    if (level >= dark) continue;
    // Paper within two pixels: a mark ON a page, rather than a piece of a
    // large dark thing that is not a page at all.
    let hasPaper = false;
    for (let dx = -2; dx <= 2 && !hasPaper; dx += 1) {
      for (let dy = -2; dy <= 2 && !hasPaper; dy += 1) {
        const near = value(x + dx, y + dy);
        if (near !== null && near > light) hasPaper = true;
      }
    }
    if (hasPaper) marks += 1;
  }
  // Four marks in a thousand pixels is a staff line; blank margin has none
  // either, and cutting blank margin costs nothing.
  return marks / beyond.length > 0.004;
}

/**
 * Does the sheet reach both sides of the picture in either direction?
 *
 * If it does, it is bigger than the frame and part of it was never in the
 * photograph at all. Two callers need to know: the crop, which must not then
 * trust any boundary it finds inside the picture, and the SCANNER, which must
 * not take the shot.
 */
export function paperRunsOffTheFrame(quad) {
  const [tl, tr, br, bl] = quad;
  const across = Math.max(tr[0], br[0]) - Math.min(tl[0], bl[0]);
  const down = Math.max(bl[1], br[1]) - Math.min(tl[1], tr[1]);
  return across >= 0.97 || down >= 0.97;
}

/**
 * A page that fills the frame has no edges, so nothing inside it is one.
 *
 * THE BUG THIS FIXES: the scanner asks the player to "hold it close, so the
 * page fills the frame" — and a page that fills the frame has no visible paper
 * edge at all. The detector then finds the strongest boundary it can see, which
 * on a page of music is where the PRINTING stops. Measured on three
 * photographs of pages that fill the frame, the outline came back at 100% of
 * the width and 79–90% of the height: 8–11% cut off the top and bottom of every
 * one, taking the title, the composer and the last system with it. On the page
 * this was first noticed on, the strip below the "edge" holds a whole system.
 *
 * WHY NOT MEASURE THE EDGE INSTEAD: because a paper edge and the end of the
 * printing look the same from here. Both are darker outside than in — outside a
 * real edge is the table, outside the last system is the footer and the margin
 * — and a dense band of music at thumbnail size is as dark as a table. Two
 * attempts at telling them apart by brightness both cut a system off a page.
 *
 * The geometry is not ambiguous in the same way. If the paper reaches both
 * sides of the frame in either direction, it is bigger than the picture, and
 * every boundary inside the picture is something printed on it. Keep the whole
 * frame. The cost is a strip of margin, or a sliver of whatever the page is
 * lying on; the cost the other way is music that no undo brings back.
 */
function trustEdges(luma, w, h, quad) {
  if (paperRunsOffTheFrame(quad)) return [[0, 0], [1, 0], [1, 1], [0, 1]];

  // The page sits inside the frame, so its edges CAN be seen — but a boundary
  // with music printed just beyond it is not one of them. This is the case the
  // frame rule above cannot catch: a page held at arm's length, its top in
  // shadow, and the outline landing under the title.
  const [tl, tr, br, bl] = quad;
  const top = Math.min(tl[1], tr[1]);
  const bottom = Math.max(bl[1], br[1]);
  const left = Math.min(tl[0], bl[0]);
  const right = Math.max(tr[0], br[0]);

  const out = quad.map(([x, y]) => [x, y]);
  if (top > 0.02 && printBeyond(luma, w, h, 'top', Math.round(top * h))) { out[0][1] = 0; out[1][1] = 0; }
  if (bottom < 0.98 && printBeyond(luma, w, h, 'bottom', Math.round(bottom * h))) { out[2][1] = 1; out[3][1] = 1; }
  if (left > 0.02 && printBeyond(luma, w, h, 'left', Math.round(left * w))) { out[0][0] = 0; out[3][0] = 0; }
  if (right < 0.98 && printBeyond(luma, w, h, 'right', Math.round(right * w))) { out[1][0] = 1; out[2][0] = 1; }
  return out;
}

// Where the paper is, in the picture's own 0–1 terms. Null when nothing in the
// frame looks enough like a sheet of paper to risk it — and null for an open
// book too, because one quadrilateral cannot describe two pages and this is
// what the callers that keep exactly one page ask.
export function paperIn(source, width, height) {
  const w = Math.min(LOOK_AT, width);
  const h = Math.max(1, Math.round(height * (w / width)));
  try {
    const luma = lumaOf(source, w, h);
    const quad = findPage(luma, w, h);
    return quad ? trustEdges(luma, w, h, quad) : null;
  } catch {
    return null;
  }
}

// Every page in the picture: one quadrilateral for a sheet, two for a book open
// at a spread, none when there is no convincing paper. The scanner asks this
// one, because a scanner that finds two pages can keep two pages.
export function papersIn(source, width, height) {
  const w = Math.min(LOOK_AT, width);
  const h = Math.max(1, Math.round(height * (w / width)));
  try {
    return findPages(lumaOf(source, w, h), w, h);
  } catch {
    return [];
  }
}

// The quadrilateral, drawn onto a rectangle. Every pixel of the output is
// sampled from where it came from in the photograph — bilinear, so a page
// straightened is not a page made of stairs.
export function pullSquare(source, width, height, quad) {
  const size = rectFor(quad, width, height);
  const scale = Math.min(1, MOST / size.width);
  const outW = Math.max(1, Math.round(size.width * scale));
  const outH = Math.max(1, Math.round(size.height * scale));

  const from = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
  const to = quad.map(([x, y]) => [x * width, y * height]);
  const h = homography(from, to);
  if (!h) return null;

  const full = scratch(width, height);
  full.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, width, height);
  const src = full.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const out = scratch(outW, outH);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const image = ctx.createImageData(outW, outH);

  const sd = src.data;
  const od = image.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = through(h, x + 0.5, y + 0.5);
      const at = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= width - 1 || sy >= height - 1) {
        // Off the edge of the photograph: paper-white, so a corner cut a little
        // wide looks like margin rather than like a hole.
        od[at] = 255; od[at + 1] = 255; od[at + 2] = 255; od[at + 3] = 255;
        continue;
      }
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const a = (y0 * width + x0) * 4;
      const b = a + 4;
      const c = a + width * 4;
      const d = c + 4;
      for (let k = 0; k < 3; k++) {
        const top = sd[a + k] + (sd[b + k] - sd[a + k]) * fx;
        const bottom = sd[c + k] + (sd[d + k] - sd[c + k]) * fx;
        od[at + k] = top + (bottom - top) * fy;
      }
      od[at + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}

// No convincing quadrilateral: crop to the bright part of the frame instead.
// The page is still the brightest thing in the picture even when its corners
// are behind a hand or off the edge, and a straight crop cannot mangle
// anything — the worst it does is nothing.
function cropToBright(source, width, height) {
  const w = Math.min(LOOK_AT, width);
  const h = Math.max(1, Math.round(height * (w / width)));
  const luma = lumaOf(source, w, h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) sum += luma[i];
  const mean = sum / (w * h);
  let left = w; let right = 0; let top = h; let bottom = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] < mean) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const across = (right - left) / w;
  const down = (bottom - top) / h;
  // Too little to be a page, or the whole frame and therefore nothing to do.
  if (!(across > 0.3 && down > 0.3)) return null;
  // THE PAPER RUNS OFF THE FRAME — see trustEdges, which says the same thing
  // about the outline. If the bright part reaches both sides of the picture in
  // EITHER direction, the page is bigger than the picture, and the boundary in
  // the other direction is not the paper ending: it is the lighting falling
  // away, or the printing stopping. Cropping to it takes the title off the top
  // and the last system off the bottom. Measured with a page photographed under
  // a lamp, which is to say the ordinary case: 14% of the page cut away.
  //
  // `||` rather than `&&` is the whole fix. It used to refuse only when the
  // bright part filled the frame in BOTH directions.
  if (across > 0.97 || down > 0.97) return null;
  const box = {
    x: Math.round((left / w) * width),
    y: Math.round((top / h) * height),
    w: Math.round(across * width),
    h: Math.round(down * height),
  };
  const out = scratch(Math.min(MOST, box.w), Math.min(MOST, box.w) * (box.h / box.w));
  out.getContext('2d').drawImage(source, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  return out;
}

// The whole of it, on a canvas: square, then unlit. Returns a canvas — the
// original if nothing could be done with it.
export function straightenCanvas(source, width, height, known = null) {
  // Down to a size the device can hold before a single pixel is read. The
  // quadrilateral is measured in the picture's own 0–1 terms, so nothing about
  // the search changes; only the amount of memory it takes.
  let src = source;
  let w = width;
  let h = height;
  const shrink = Math.min(1, WORK_MAX / Math.max(width, height));
  if (shrink < 1) {
    w = Math.max(1, Math.round(width * shrink));
    h = Math.max(1, Math.round(height * shrink));
    src = scratch(w, h);
    src.getContext('2d').drawImage(source, 0, 0, w, h);
  }
  const quad = known ?? paperIn(src, w, h);
  let page = null;
  try {
    page = quad ? pullSquare(src, w, h, quad) : cropToBright(src, w, h);
  } catch {
    page = null;
  }
  if (!page) {
    page = scratch(w, h);
    page.getContext('2d').drawImage(src, 0, 0, w, h);
  }
  try {
    const ctx = page.getContext('2d', { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, page.width, page.height);
    // The page as it will be STORED and read: the lighting divided out, the
    // shade of the paper left alone. What a player looks at is brightened on
    // the way to the screen instead — see `lift` in unshadow.js and the display
    // path in paper.js. MEASURED, `npm run scan:import`: brightening what the
    // reader reads costs it 1.5 points of recall on the three photographed
    // pages, and there is no reason to pay that for something the eye wants.
    unshadow(image.data, page.width, page.height);
    ctx.putImageData(image, 0, 0);
  } catch { /* an unlit page is better than no page, but not by enough to fail */ }
  return page;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('that page could not be read')); };
    image.src = url;
  });
}

// --- proving a picture is a picture -------------------------------------------
//
// A file being called .heic, or a canvas handing back a blob, is not the same
// as a page this browser can draw. That difference is where "could not open
// that score" came from: nothing between the camera and the database ever
// checked, so bytes nothing could decode were stored as a page, and the failure
// surfaced later, in the reader, as a score that would not open at all.
//
// So: everything on the way in is DECODED first, and what cannot be decoded
// never becomes a page.

// Whatever the engine can make of these bytes: an <img> first, because it
// applies the EXIF rotation a phone writes into every photograph, and an
// ImageBitmap after it for the formats <img> will not take. Null when neither
// can read it.
export async function readableImage(file) {
  try {
    return await loadImage(file);
  } catch { /* try the other decoder */ }
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* nothing can read it */ }
  }
  return null;
}

/**
 * The same picture, decoded SMALLER, for when decoding it whole fails.
 *
 * A phone that has just taken half a dozen twelve-megapixel photographs, held
 * the straightened copies of them, and then opened the reader is a phone with
 * no memory left, and what iOS does about that is refuse the next decode. The
 * page is not broken; there is simply no room for it at full size right now.
 * Half the width is a quarter of the memory, and a page at 1400px is what the
 * reader draws at anyway.
 */
export async function readableImageSmall(file, width = 1400) {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file, {
      resizeWidth: width,
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    });
  } catch {
    return null;
  }
}

export function sizeOfImage(image) {
  return {
    w: image?.naturalWidth || image?.width || 0,
    h: image?.naturalHeight || image?.height || 0,
  };
}

// Why a page could not be read, in words a player can act on. HEIC is worth
// naming: it is the default on every iPhone, most browsers cannot decode it,
// and the fix is two taps in Settings.
export function unreadableReason(file) {
  const name = String(file?.name ?? '').trim() || 'that page';
  if (/hei[cf]/i.test(`${file?.type ?? ''} ${name}`)) {
    return `${name} is an iPhone HEIC photo and this device cannot read those`
      + ' — either set Camera → Formats to “Most Compatible”, or scan the page with the camera here';
  }
  return `${name} could not be read as an image`;
}

const jpegName = (name) => String(name ?? 'page').replace(/\.[a-z0-9]+$/i, '') + '.jpg';

// A decoded picture, encoded back out as a JPEG this engine has just proved it
// can read. It is the safety net under every page that goes into the library.
async function asJpeg(image, name) {
  const { w, h } = sizeOfImage(image);
  if (!w || !h) return null;
  const canvas = scratch(Math.min(w, MOST), Math.min(w, MOST) * (h / w));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return blob ? new File([blob], jpegName(name), { type: 'image/jpeg' }) : null;
}

// A photograph in, a page out, under the same name so the ordering of a scan
// survives.
//
// It THROWS when the photograph cannot be read at all — deliberately, and
// early. Handing back the unreadable file, which is what this used to do, is
// what put pages nothing can open into the library.
export async function straightenFile(file) {
  const image = await readableImage(file);
  if (!image) throw new Error(unreadableReason(file));
  const { w, h } = sizeOfImage(image);
  let straightened = null;
  try {
    const page = straightenCanvas(image, w, h);
    const blob = await new Promise((resolve) => page.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob?.size) straightened = new File([blob], jpegName(file.name), { type: 'image/jpeg' });
  } catch { /* the photograph as taken is still a page */ }
  // Proved, not assumed: a phone under memory pressure hands back a blob that
  // decodes to nothing, and that blob must not be what gets kept.
  if (straightened && await readableImage(straightened)) return straightened;
  return (await asJpeg(image, file.name)) ?? file;
}
