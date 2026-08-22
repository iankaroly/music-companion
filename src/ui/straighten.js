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

  // THE LEVEL IS TAKEN OUT THERE, NOT IN HERE, and that is the difference
  // between recovering a shadowed edge and losing it.
  //
  // This used to measure the band beyond the boundary against the paper level
  // INSIDE it, and ask whether most of it was still that bright. On a page
  // lying flat that is the same question. On a page of a BOOK it is not: the
  // outer edge of a bound page lifts off the table and falls away from the
  // lamp, so the paper out there is thirty or forty levels darker than the
  // paper in here — which is the very reason the bright mask stopped where it
  // did and the outline needs rescuing at all. Measured against the inside, a
  // shadowed margin full of music reads as "not paper", the side is left where
  // it was, and the far quarter of the page is outside the outline:
  // "now its only highlighting blue for about 3/4s of the page".
  //
  // MEASURED, `npm run scan:edges`, a drawn book page whose outer edge falls
  // into shadow: the page kept came back 20.8% narrower than the sheet with the
  // guard off, 12.9% narrower with the guard on and reading the inside level,
  // and within 6% of the sheet reading the level out there.
  const level = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.6)];
  };
  const paper = level(beyond.map(([, , value]) => value));
  const dark = paper - 45;
  const light = paper - 20;

  // IS IT STILL A PAGE OUT THERE? Beyond a boundary that has music past it,
  // most of what you see is paper — printing is thin, and a page is mostly
  // white even where it is busy. Read against its own level this no longer
  // tells a table from a margin (both are mostly themselves); what it still
  // catches is a band that is mostly INK, which is not a margin either. The
  // work of telling a table from a page is done entirely by the marks test
  // below, and it is the right test for it: a table has no marks with paper
  // around them, however bright or dark the table is.
  const paperShare = beyond.filter(([, , value]) => value > light).length / beyond.length;
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
function trustEdges(luma, w, h, quad, beside = null) {
  // A page with another page beside it cannot be given the whole frame, and
  // cannot have the side that FACES its neighbour moved at all — beyond that
  // side there is print, and it is the next sheet's. Every other side is
  // guarded exactly as before, which is the half of this that went missing:
  // see `besideOf`.
  const shares = beside && (beside.left || beside.right || beside.top || beside.bottom);
  if (!shares && paperRunsOffTheFrame(quad)) return [[0, 0], [1, 0], [1, 1], [0, 1]];

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
  const free = (side) => !beside?.[side];
  if (free('top') && top > 0.02 && printBeyond(luma, w, h, 'top', Math.round(top * h))) { out[0][1] = 0; out[1][1] = 0; }
  if (free('bottom') && bottom < 0.98 && printBeyond(luma, w, h, 'bottom', Math.round(bottom * h))) { out[2][1] = 1; out[3][1] = 1; }
  if (free('left') && left > 0.02 && printBeyond(luma, w, h, 'left', Math.round(left * w))) { out[0][0] = 0; out[3][0] = 0; }
  if (free('right') && right < 0.98 && printBeyond(luma, w, h, 'right', Math.round(right * w))) { out[1][0] = 1; out[2][0] = 1; }
  return out;
}

/**
 * Which sides of one page have ANOTHER PAGE on them.
 *
 * THE BUG THIS FIXES, and it is one this round put in. The guard that pushes a
 * short outline out to the edge of the paper was switched off entirely for a
 * frame holding more than one page, because on a book it would push one page's
 * outline over its neighbour. That is true of ONE side — the side facing the
 * gutter — and false of the other three, and switching the whole thing off
 * means a book page whose outer edge is in shadow keeps the short outline the
 * mask found: "now its only highlighting blue for about 3/4s of the page, the
 * far right isnt in the blue."
 *
 * So the side that faces the neighbour is left alone and the rest are guarded.
 */
export function besideOf(quads, at) {
  const mine = quads?.[at];
  if (!mine || quads.length < 2) return null;
  const box = (q) => ({
    left: Math.min(...q.map((p) => p[0])),
    right: Math.max(...q.map((p) => p[0])),
    top: Math.min(...q.map((p) => p[1])),
    bottom: Math.max(...q.map((p) => p[1])),
  });
  const me = box(mine);
  const found = { left: false, right: false, top: false, bottom: false };
  quads.forEach((other, i) => {
    if (i === at) return;
    const it = box(other);
    const overlapY = Math.min(me.bottom, it.bottom) - Math.max(me.top, it.top);
    const overlapX = Math.min(me.right, it.right) - Math.max(me.left, it.left);
    // Side by side: they share most of their height and sit next to each other.
    if (overlapY > (me.bottom - me.top) * 0.4) {
      if (it.right <= me.right && (it.left + it.right) / 2 < (me.left + me.right) / 2) found.left = true;
      if (it.left >= me.left && (it.left + it.right) / 2 > (me.left + me.right) / 2) found.right = true;
    }
    if (overlapX > (me.right - me.left) * 0.4) {
      if ((it.top + it.bottom) / 2 < (me.top + me.bottom) / 2) found.top = true;
      if ((it.top + it.bottom) / 2 > (me.top + me.bottom) / 2) found.bottom = true;
    }
  });
  return found;
}

/**
 * Every outline goes through the guard, whoever found it.
 *
 * THE BUG THIS EXISTS TO CLOSE: the guard used to live inside `paperIn`, and
 * the scanner does not call `paperIn`. It finds its own corners with
 * `papersIn`, shows them to the player, and hands them to `straightenCanvas` as
 * `known` — which used them as given. So every photograph taken with the CAMERA
 * skipped all of it, and the only path that was protected was the one for
 * pictures chosen out of the library. That is why a page scanned with the phone
 * still came out with its top cut off while every measurement here said it was
 * fixed: the measurements went in through the other door.
 *
 * So the guard is applied where the outline is USED, not where one of the two
 * finders happens to return.
 *
 * It is skipped for an outline that is plainly one page of several — a spread
 * photographed open, where each sheet is half the frame. Pushing the sides of
 * one of those out to the frame would swallow the facing page.
 *
 * "PLAINLY ONE OF SEVERAL" USED TO MEAN "UNDER 45% OF THE FRAME WIDE", and that
 * is a description of a spread photographed whole rather than of the picture a
 * phone over a music stand takes. Held close over ONE page of a book, with a
 * band of the next one catching the side of the frame, the page being aimed at
 * is seventy per cent of the width — so the guard ran, found the neighbour's
 * music printed just beyond the fold, concluded that a boundary with print
 * beyond it is not a paper edge, and pushed the outline back over the page next
 * door. The finder had just done the work of telling the two apart.
 * MEASURED, `npm run scan:edges`: the kept page came back 1119 pixels wide
 * where the page aimed at is 1010, with the facing page's marks over 3% of its
 * inner edge.
 *
 * So the caller says. When the finder returned more than one page, the boundary
 * between them is the one thing in the picture that IS known, and nothing here
 * may move it.
 */
function guardQuad(source, width, height, quad, beside = null) {
  if (!quad) return null;
  const xs = quad.map(([x]) => x);
  const share = Math.max(...xs) - Math.min(...xs);
  // A narrow outline with room round it has edges of its own to be found and
  // needs no help. A page of a BOOK is narrow too and is not that case — it is
  // told apart by `beside` rather than by its width, which is what the 0.45
  // was standing in for and getting wrong in both directions.
  if (!beside && share < 0.45) return quad;
  const w = Math.min(LOOK_AT, width);
  const h = Math.max(1, Math.round(height * (w / width)));
  try {
    return trustEdges(lumaOf(source, w, h), w, h, quad, beside);
  } catch {
    return quad;
  }
}

/**
 * The background the margin let in, taken back off.
 *
 * `widen` lets the outline out by a tenth before cutting, so an outline that
 * lands a little inside the paper does not cost a line of music. The price is
 * a border of whatever the page was lying on — "the blue part was only on the
 * page, but when I clicked done there was part of the background in it".
 *
 * So it is trimmed here, on the SQUARED page, where it is safe to do: music is
 * printed on paper, so a border that is not paper cannot contain any. Each edge
 * is walked inwards while its line is darker than the paper it borders, and
 * stops at the first line that is paper — which is why an outline that was
 * short keeps everything `widen` recovered for it: that border IS paper, and
 * the walk does not start.
 *
 * Capped at a seventh per side, a little more than the margin, so no amount of
 * shadow can eat into the page itself.
 */
const TRIM_MOST = 1 / 5;     // never more than this off a side, whatever it looks like
const TRIM_DARKER = 0.78;   // a pixel this much darker than the paper is not paper
const TRIM_ENOUGH = 0.3;    // and a line this much not-paper is a line to drop

function trimBackground(page) {
  const w = page.width;
  const h = page.height;
  if (w < 40 || h < 40) return page;
  let data;
  try {
    data = page.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  } catch {
    return page;                      // a page that cannot be read is left alone
  }
  const luma = (x, y) => {
    const i = (y * w + x) * 4;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };
  // What paper looks like here: the middle of the page, which the margin never
  // reaches. The median rather than the mean, so printed music does not drag it
  // down.
  const middle = [];
  for (let y = Math.round(h * 0.3); y < h * 0.7; y += 3) {
    for (let x = Math.round(w * 0.3); x < w * 0.7; x += 3) middle.push(luma(x, y));
  }
  if (!middle.length) return page;
  middle.sort((a, b) => a - b);
  const paper = middle[Math.floor(middle.length / 2)];
  const floor = paper * TRIM_DARKER;

  // A line is background when ENOUGH of it is, not when most of it is. The
  // corner of a page photographed at an angle leaves a line that is half table
  // and half paper, and a rule that asks for a majority stops there — measured
  // on a page with a border round it, a median rule cleared 46 per cent of it
  // and left the rest.
  const lineIsPaper = (along, fixed) => {
    let seen = 0;
    let dark = 0;
    if (along === 'row') {
      for (let x = 0; x < w; x += 3) { seen += 1; if (luma(x, fixed) < floor) dark += 1; }
    } else {
      for (let y = 0; y < h; y += 3) { seen += 1; if (luma(fixed, y) < floor) dark += 1; }
    }
    return dark / Math.max(1, seen) < TRIM_ENOUGH;
  };

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  const mostY = Math.floor(h * TRIM_MOST);
  const mostX = Math.floor(w * TRIM_MOST);
  while (top < mostY && !lineIsPaper('row', top)) top += 1;
  while (bottom > h - 1 - mostY && !lineIsPaper('row', bottom)) bottom -= 1;
  while (left < mostX && !lineIsPaper('col', left)) left += 1;
  while (right > w - 1 - mostX && !lineIsPaper('col', right)) right -= 1;

  const cutW = right - left + 1;
  const cutH = bottom - top + 1;
  if (cutW === w && cutH === h) return page;
  if (cutW < w * 0.5 || cutH < h * 0.5) return page;   // that is not a margin
  const cut = scratch(cutW, cutH);
  cut.getContext('2d').drawImage(page, left, top, cutW, cutH, 0, 0, cutW, cutH);
  return cut;
}

/**
 * The outline, let out a little.
 *
 * Every wrong answer this has given has been the same wrong answer: the outline
 * landed inside the paper and took music with it — under a shadow, under a
 * title, under the top of the frame. Four rounds of making the outline cleverer
 * each fixed the case in front of it and left the next one.
 *
 * So the outline is let out by a tenth before anything is cut. It cannot make a
 * page wrong that was right — the worst it adds is a sliver of whatever the
 * page was lying on, which is a thing a player can see past and the reader
 * crops off for the screen anyway. What it buys is that an outline which is a
 * few per cent short no longer costs a system of music, and there is no undo
 * for a system of music.
 */
// `downOnly` is for a page of a BOOK, and it is the whole of what widening may
// do to one. Sideways is where its neighbour is: a tenth on a page seventy per
// cent of the frame wide is fifty pixels over the gutter and onto the next
// leaf's margin, which is the thing the fold was found to prevent. MEASURED,
// `npm run scan:edges`: the page kept off a book came back 1119 pixels wide
// where the page aimed at is 1010, carrying 3% of the facing page's marks along
// its inner edge. Up and down there is no neighbour and the old reason stands
// unchanged — an outline a few per cent short of the top of a page costs a
// system, and there is no undo for a system.
function widen(quad, by = 0.1, downOnly = false) {
  const cx = quad.reduce((sum, [x]) => sum + x, 0) / quad.length;
  const cy = quad.reduce((sum, [, y]) => sum + y, 0) / quad.length;
  const across = downOnly ? 0 : by;
  return quad.map(([x, y]) => [
    Math.max(0, Math.min(1, cx + (x - cx) * (1 + across))),
    Math.max(0, Math.min(1, cy + (y - cy) * (1 + by))),
  ]);
}

// Where the paper is, in the picture's own 0–1 terms. Null when nothing in the
// frame looks enough like a sheet of paper to risk it — and null for an open
// book too, because one quadrilateral cannot describe two pages and this is
// what the callers that keep exactly one page ask.
export function paperIn(source, width, height) {
  const w = Math.min(LOOK_AT, width);
  const h = Math.max(1, Math.round(height * (w / width)));
  try {
    const quad = findPage(lumaOf(source, w, h), w, h);
    return guardQuad(source, width, height, quad);
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
    const found = findPages(lumaOf(source, w, h), w, h);
    // The scanner draws these on the screen and shoots with them, so they are
    // guarded here too — otherwise the outline a player is shown is not the one
    // the page is cut to. On a book each page is guarded on the three sides
    // that have no neighbour on them: see besideOf.
    return found.map((quad, i) => guardQuad(source, width, height, quad, besideOf(found, i)));
  } catch {
    return [];
  }
}

// The quadrilateral, drawn onto a rectangle. Every pixel of the output is
// sampled from where it came from in the photograph — bilinear, so a page
// straightened is not a page made of stairs.
//
// AND ONE SAMPLE PER OUTPUT PIXEL IS ENOUGH, which was measured the hard way
// and is worth writing down so it is not built twice.
//
// One bilinear tap where the map SHRINKS reads two source pixels of four and
// throws the rest away, so a staff line one pixel wide is in one row of the
// answer and gone from the next. That is real, and averaging nine taps per
// pixel instead of one does fix it: MEASURED on a photographed cadenza, the
// same page squared the same size came back from Audiveris with 284 notes
// against 242.
//
// It buys nothing where it is actually used. The page this makes is the page a
// PLAYER READS — `npm run scan:import` is unmoved at 53.4% recall over the
// three marked pages, 565 of 1059, with or without it — and the page the
// RECOGNISER reads is not this one any more: it is the photograph cut to the
// paper, unresampled, because a resampled staff line is what was costing the
// scan its notes (see `pageForReading` below, and `npm run omr:truth`). Nine
// samples a pixel is forty-eight million samples on a phone for a page nobody
// measured a gain on.
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

/**
 * The page, cut out of the photograph WITHOUT RESAMPLING A SINGLE PIXEL.
 *
 * THE PAGE A RECOGNISER SHOULD BE GIVEN, and it is not the page a player should
 * be shown. Squaring up is worth having on screen — a photograph of a book
 * taken at arm's length is unpleasant to read from and the reader wants a
 * rectangle — but every pixel of that rectangle has been resampled, and a
 * staff line is one pixel of black on white. Rotating a raster by three degrees
 * turns each of those lines into two grey ones, and Audiveris finds staves by
 * looking for long dark runs.
 *
 * MEASURED, `npm run omr:truth` — 352 engraved notes, photographed, scored as
 * the longest run of the page's own notes that comes back in order:
 *
 *   the photograph, as taken                 85.5%
 *   the page the app squared up              49.7%
 *
 * It is not the camera and it is not the size: both are the same music at the
 * same scale. It is the resampling. Audiveris deskews a page itself, and does
 * it better than we can, because it does it on the marks rather than on the
 * pixels.
 *
 * So what goes to the recogniser is the photograph, cut to the sheet of paper
 * found in it — a rectangle of the original pixels, copied, never interpolated.
 * The crop still does the one job squaring up was doing for the recogniser,
 * which is keeping the facing page and the table out of the picture.
 */
export function paperCrop(source, width, height, quad) {
  if (!quad) return null;
  // A little proud of the outline, because a crop cannot recover what it cuts
  // and a margin costs a recogniser nothing.
  const out = 0.02;
  const left = Math.max(0, Math.min(...quad.map(([x]) => x)) - out);
  const right = Math.min(1, Math.max(...quad.map(([x]) => x)) + out);
  const top = Math.max(0, Math.min(...quad.map(([, y]) => y)) - out);
  const bottom = Math.min(1, Math.max(...quad.map(([, y]) => y)) + out);
  const x = Math.round(left * width);
  const y = Math.round(top * height);
  const w = Math.round((right - left) * width);
  const h = Math.round((bottom - top) * height);
  if (w < 40 || h < 40) return null;
  const cut = scratch(w, h);
  // Source and destination the same size: a copy, not a resample.
  cut.getContext('2d').drawImage(source, x, y, w, h, 0, 0, w, h);
  return cut;
}

/**
 * The file to send to a RECOGNISER, out of the photograph behind a page.
 *
 * The corners come from the scanner when the scanner took the shot — the ones
 * the player saw outlined and could move — and are looked for here when they do
 * not, which is what a page chosen out of the phone's library has. When nothing
 * in the picture is convincingly one sheet of paper, the photograph goes as it
 * is: it is still a photograph of the music, and it is still better than a
 * resampled page. Null only when the bytes cannot be decoded at all.
 *
 * AND IT IS NOT BROUGHT DOWN TO SIZE HERE, which it was for an afternoon.
 *
 * The reasoning was sound and the measurement says otherwise. Audiveris renders
 * at about 2600 across whatever it is handed, so shrinking to that before the
 * upload looked free and saved somebody's data. It is not free: the service
 * does the same shrink from the FULL photograph with a better resampler than a
 * canvas `drawImage`, and doing it twice — once here, once there — costs the
 * page its thin lines.
 *
 * MEASURED, `npm run omr:truth -- --dense`, a page of 352 semiquavers engraved,
 * photographed, and scored as the longest run of its own notes that comes back
 * in order (and how many of those also came back the right LENGTH):
 *
 *   cut to the paper, shrunk here to 2600     63.4%   values 83.4%
 *   cut to the paper, sent as it is           78.4%   values 90.6%
 *
 * So the cut goes up at the size it was cut, and the only cap left is a guard
 * against something absurd rather than a resolution policy. A phone photograph
 * is about 4000 on its long edge and passes through untouched.
 */
const READ_ACROSS = 4400;

export async function pageForReading(file, quad = null) {
  const image = await readableImage(file);
  if (!image) return null;
  const { w, h } = sizeOfImage(image);
  if (!w || !h) return null;
  let found = quad;
  if (!found) {
    const pages = papersIn(image, w, h);
    // One sheet or nothing. Two means a book, and without the corners the
    // scanner kept there is no saying which of them this page was.
    found = pages.length === 1 ? pages[0] : null;
  }
  const cut = found ? paperCrop(image, w, h, found) : null;
  const from = cut ?? image;
  const fromW = cut ? cut.width : w;
  const fromH = cut ? cut.height : h;
  const shrink = Math.min(1, READ_ACROSS / Math.max(fromW, fromH));
  let out = cut;
  if (shrink < 1) {
    out = scratch(fromW * shrink, fromH * shrink);
    out.getContext('2d').drawImage(from, 0, 0, out.width, out.height);
  }
  if (!out) return file;                       // nothing to cut and nothing to shrink
  const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob?.size) return file;
  return new File([blob], jpegName(file.name ?? 'page'), { type: 'image/jpeg' });
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

/**
 * The whole of it, on a canvas: square, then unlit. Returns a canvas — the
 * original if nothing could be done with it.
 *
 * `asGiven` IS THE DIFFERENCE BETWEEN AN OUTLINE AND AN INSTRUCTION.
 *
 * Everything above is written for a quadrilateral the FINDER produced, which is
 * a guess and is treated as one: `guardQuad` overrules a boundary that has
 * print beyond it, `widen` lets it out by a tenth in case it landed short, and
 * `trimBackground` takes back whatever that let in. Three corrections, all of
 * them right, all of them for a guess.
 *
 * A person dragging a corner onto the corner of the paper is not guessing, and
 * the thing they are most often doing is cutting the FACING PAGE off — which is
 * precisely the case those three corrections are built to undo. MEASURED,
 * `npm run scan:edges`, on a book photographed the way the scanner asks for it
 * (close, the page filling the frame top to bottom, a strip of the next page in
 * shot): the crop dragged onto one page came back as the WHOLE PHOTOGRAPH,
 * 1360x1000 where the page dragged was 1000x1000, with a third of its
 * right-hand edge made of the facing page. `guardQuad` saw a sheet running off
 * the top and the bottom of the picture, concluded there were no edges to be
 * seen inside it, and returned the frame. "when i trim after taking the photo
 * in scan, it doesnt update to what i cropped it to, but instead stays the
 * same."
 *
 * So a hand crop is taken as given: cut where it says, and nowhere else.
 */
export function straightenCanvas(source, width, height, known = null, { asGiven = false, beside = null } = {}) {
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
  // Guarded whether it was found here or handed in: see guardQuad. The scanner
  // hands in the corners the player saw, and those went straight through.
  // A hand crop skips all of it — see `asGiven` above.
  const start = known ?? paperIn(src, w, h);
  // `beside`: which sides of this page have another page on them. The guard
  // runs on the others — a book page's outer edge needs it exactly as much as
  // a loose sheet's does. See besideOf.
  const found = asGiven ? start : guardQuad(src, w, h, start, beside);
  // Let out before it is cut: see widen. The margin is the difference between
  // an outline that is a little wrong and a page that has lost a line of music.
  const oneOfSeveral = !!(beside && (beside.left || beside.right || beside.top || beside.bottom));
  const quad = found && !asGiven ? widen(found, 0.1, oneOfSeveral) : found;
  let page = null;
  try {
    page = quad ? pullSquare(src, w, h, quad) : cropToBright(src, w, h);
  } catch {
    page = null;
  }
  if (!page) {
    page = scratch(w, h);
    page.getContext('2d').drawImage(src, 0, 0, w, h);
  } else if (quad && !asGiven) {
    // Only when there was an outline, and never on a hand crop: a page found by
    // brightness alone has no margin of ours around it to take back off, and a
    // page somebody cut by hand has no margin of ours around it either.
    page = trimBackground(page);
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
