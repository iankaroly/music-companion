// Finding the sheet of paper in a photograph, and pulling it square.
//
// A phone held over a book does not photograph a page. It photographs a page,
// the table under it, the facing page, your own shadow, and the corner of the
// stand — and the page it does photograph is a trapezium, because the phone was
// never quite square to the paper and the paper was never quite flat.
//
// Every scanner app on a phone does the same two things about this, and this
// does them too: find the four corners of the paper, then map that quadrilateral
// onto a rectangle. What comes out is the page and nothing else, straight, the
// way a photocopier would have given it to you. It is the difference between a
// photograph OF a page and a page.
//
// Nothing here recognises music, and nothing here is clever about documents in
// general. It looks for one big bright four-sided thing on a darker background,
// checks that what it found could actually be a sheet of paper, and refuses if
// it could not — because a page mangled by a wrong guess has no undo, and a
// photograph left alone is at worst what you took.

// --- finding the paper --------------------------------------------------------

const WORK = 220;        // the width the search runs at: corners, not detail

// Otsu's threshold: the split between dark and light that leaves each side as
// tightly grouped as it can be. It is the standard answer to "where does the
// paper stop", and it needs to be told nothing about the room.
function splitAt(luma, count) {
  const bins = new Float64Array(256);
  for (let i = 0; i < count; i++) bins[Math.max(0, Math.min(255, luma[i] | 0))]++;
  let total = 0;
  let sum = 0;
  for (let v = 0; v < 256; v++) { total += bins[v]; sum += v * bins[v]; }
  let below = 0;
  let weight = 0;
  let best = 128;
  let bestSpread = -1;
  for (let v = 0; v < 256; v++) {
    weight += bins[v];
    if (weight === 0) continue;
    const above = total - weight;
    if (above === 0) break;
    below += v * bins[v];
    const meanBelow = below / weight;
    const meanAbove = (sum - below) / above;
    const spread = weight * above * (meanBelow - meanAbove) ** 2;
    if (spread > bestSpread) { bestSpread = spread; best = v; }
  }
  return best;
}

// Shaving the bright mask back by a pixel at a time.
//
// This is what separates the page you are photographing from the page facing
// it. Both are paper, both are bright, and across the gutter of an open book
// they touch — so the brightest region is TWO pages, and the corners of two
// pages describe a shape that is not a page. The fold between them is always
// darker than either (it is a crease, in shadow, at an angle to the light), so
// it is thin in the mask, and a couple of passes of erosion cut it. What is
// left is the page that was lying flattest under the camera.
//
// What is off the edge of the picture counts as bright rather than as dark: a
// page held close enough to run to the edge of the frame is still a page, and
// the old version — which simply skipped the border row — ate a pixel off every
// edge that touched it on every pass, so a page photographed close was shaved
// from the outside in while a page photographed at arm's length was not.
function erode(mask, w, h, times) {
  let from = mask;
  for (let pass = 0; pass < times; pass++) {
    const to = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = y * w + x;
        if (!from[at]) continue;
        const left = x > 0 ? from[at - 1] : 1;
        const right = x < w - 1 ? from[at + 1] : 1;
        const up = y > 0 ? from[at - w] : 1;
        const down = y < h - 1 ? from[at + w] : 1;
        to[at] = left && right && up && down ? 1 : 0;
      }
    }
    from = to;
  }
  return from;
}

// …and pushing the corners back out again by as much as was shaved off, so the
// page comes back with its own edges rather than with a hairline of it lost.
function grow(quad, by) {
  const cx = quad.reduce((n, p) => n + p[0], 0) / 4;
  const cy = quad.reduce((n, p) => n + p[1], 0) / 4;
  return quad.map(([x, y]) => {
    const away = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / away) * by, y + ((y - cy) / away) * by];
  });
}

// The other half of the same idea: filling in, a pixel at a time.
//
// Paper has dark lines ON it — staff lines, a heavy title, a black barline —
// and at the size this search runs at they are one pixel wide. Left alone they
// cut the sheet of paper into strips and the largest bright region is a strip
// rather than a page. Growing the mask by a pixel and then shrinking it back
// closes those lines without moving the edges of the paper: the lines are thin,
// and the fold of a book is not.
function dilate(mask, w, h, times) {
  let from = mask;
  for (let pass = 0; pass < times; pass++) {
    const to = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = y * w + x;
        to[at] = from[at]
          || (x > 0 && from[at - 1]) || (x < w - 1 && from[at + 1])
          || (y > 0 && from[at - w]) || (y < h - 1 && from[at + w]) ? 1 : 0;
      }
    }
    from = to;
  }
  return from;
}

// Anything dark with paper all the way round it is part of the paper.
//
// This is the other half of the ink problem, and it is the half that decides
// whether the finder works with the phone held close. Closing by a pixel shuts
// a staff line; it does not shut a beamed group, a chord, a rehearsal mark or
// the shadow the phone itself throws across the page — and those get BIGGER in
// the frame as the phone comes closer, until the brightest connected thing in
// the picture is a strip of margin rather than a page. So instead of trying to
// bridge ink by its width, the dark that is reachable from the edge of the
// picture is called background and everything else is called page. Ink cannot
// reach the edge of the picture; the table can.
function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const reach = (at) => { if (!mask[at] && !outside[at]) { outside[at] = 1; stack[top++] = at; } };
  for (let x = 0; x < w; x++) { reach(x); reach((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { reach(y * w); reach(y * w + w - 1); }
  while (top > 0) {
    const at = stack[--top];
    const x = at % w;
    const y = (at / w) | 0;
    if (x > 0) reach(at - 1);
    if (x < w - 1) reach(at + 1);
    if (y > 0) reach(at - w);
    if (y < h - 1) reach(at + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] || !outside[i] ? 1 : 0;
  return out;
}

// Runs of bright pixels that all touch each other, biggest first. The first of
// them is the page, when the page is the brightest large thing in the frame —
// islands of light on the table, a reflection, the white of a cuff are all
// smaller. The SECOND matters too: across the gutter of an open book it is the
// facing page, and that is how a spread is told from a sheet.
function regionsOf(bright, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const regions = [];
  for (let start = 0; start < w * h; start++) {
    if (!bright[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const found = [];
    while (top > 0) {
      const at = stack[--top];
      found.push(at);
      const x = at % w;
      const y = (at / w) | 0;
      if (x > 0 && bright[at - 1] && !seen[at - 1]) { seen[at - 1] = 1; stack[top++] = at - 1; }
      if (x < w - 1 && bright[at + 1] && !seen[at + 1]) { seen[at + 1] = 1; stack[top++] = at + 1; }
      if (y > 0 && bright[at - w] && !seen[at - w]) { seen[at - w] = 1; stack[top++] = at - w; }
      if (y < h - 1 && bright[at + w] && !seen[at + w]) { seen[at + w] = 1; stack[top++] = at + w; }
    }
    regions.push(found);
  }
  return regions.sort((a, b) => b.length - a.length);
}

// The four corners of a roughly rectangular blob. A page's top-left corner is
// the pixel with the smallest x + y, its bottom-right the largest, and the
// other two are the extremes of x - y. It is the oldest trick in document
// scanning and it holds for anything convex and not far off square-on.
function cornersOf(pixels, w) {
  let tl = null; let tr = null; let br = null; let bl = null;
  let minSum = Infinity; let maxSum = -Infinity;
  let minDiff = Infinity; let maxDiff = -Infinity;
  for (const at of pixels) {
    const x = at % w;
    const y = (at / w) | 0;
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum) { minSum = sum; tl = [x, y]; }
    if (sum > maxSum) { maxSum = sum; br = [x, y]; }
    if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
    if (diff < minDiff) { minDiff = diff; bl = [x, y]; }
  }
  return [tl, tr, br, bl];
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function quadArea(q) {
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

// Could this be a sheet of paper? Four tests, and all of them have to pass,
// because the cost of a wrong yes is a ruined page and the cost of a wrong no
// is a photograph that looks like a photograph.
//
// `floor` is how much of the frame the shape has to fill, and it is an argument
// because half of an open book is half the size of a page — a spread shot at a
// sensible distance has each of its pages down around a fifth of the frame, and
// judging those two halves at the bar a whole page has to clear rejects every
// book ever photographed.
function looksLikePaper(quad, area, w, h, floor = 0.25) {
  if (quad.some((point) => !point)) return false;
  const size = quadArea(quad);
  if (size < w * h * floor || size > w * h * 0.995) return false;
  // A photograph that is nothing but paper has no edges in it to straighten by
  // — every corner it finds is a corner of the picture — and pulling it onto
  // itself would cost it a resampling and gain it nothing.
  //
  // The band is 1.5% of the frame rather than the 3% it was, because 3% is a
  // page held at exactly the distance this is meant to be used at. A phone a
  // hand's width above a part, square to it, puts the paper's corners about two
  // per cent in from the picture's — and the whole shape was being thrown away
  // for being too well framed, which is the opposite of what this test is for.
  const inCorner = ([x, y]) => (x < w * 0.015 || x > w * 0.985) && (y < h * 0.015 || y > h * 0.985);
  if (quad.every(inCorner)) return false;
  // Convex, and going round one way: a bow-tie is not a page.
  const turns = quad.map((_, i) => cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4]));
  if (!(turns.every((t) => t > 0) || turns.every((t) => t < 0))) return false;
  // Corners like a rectangle seen at an angle, not like a shard.
  for (let i = 0; i < 4; i++) {
    const before = quad[(i + 3) % 4];
    const at = quad[i];
    const after = quad[(i + 1) % 4];
    const a = [before[0] - at[0], before[1] - at[1]];
    const b = [after[0] - at[0], after[1] - at[1]];
    const cosine = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
    if (Math.abs(cosine) > 0.5) return false;             // outside 60°–120°
  }
  // Opposite sides of a page are about the same length, however it is tilted.
  const sides = [dist(quad[0], quad[1]), dist(quad[1], quad[2]),
    dist(quad[2], quad[3]), dist(quad[3], quad[0])];
  if (Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]) < 0.68) return false;
  if (Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]) < 0.68) return false;
  // And the bright thing has to fill most of that quadrilateral. The gap is
  // generous because a real page is not evenly bright — a shadow across one
  // corner, a heavy line of print, the crease down the middle all take pixels
  // out of the mask without taking anything off the paper. What this catches is
  // a shape nothing like its own outline; two pages of an open book are caught
  // by the side lengths before they get here.
  if (area !== null && area / size < 0.6) return false;
  return true;
}

// --- an open book ---------------------------------------------------------------
//
// Music does not arrive as loose sheets. It arrives as a book open on a stand,
// and what the camera sees is two pages at once, hinged down the middle, each
// leaning away from the other. Warping that pair onto one rectangle gives a
// page that is twice as wide as any page and bent in the middle; picking the
// bigger half of it and throwing the other away — which is what the erosion
// here used to do, quietly — loses half the music and says nothing about it.
//
// So a spread is FOUND, as a spread, and comes back as two pages. There are two
// ways it shows up in the picture and both have to be handled:
//
//   the fold is dark enough to cut the paper in two — two bright regions, side
//   by side, the same size and the same height. This is the common one: the
//   gutter of a bound book is a crease in shadow.
//
//   the book is flat enough, or lit flat enough, that the fold stays brighter
//   than the table — one wide bright region with a dark seam down it. Here the
//   evidence is a valley in the page's own brightness, read across the page
//   after it has been squared up, so a tilted book does not hide it.

const HALF_FLOOR = 0.09;      // how much of the frame one page of a spread must fill
const GUTTER_BAND = 0.16;     // how far from the middle the fold is looked for
const GUTTER_DARK = 0.92;     // how much darker than the paper beside it the fold must be
const GUTTER_WIDE = 0.14;     // and how narrow: a spine is a line, a shadow is a wash

// Two pages, when the fold has cut the paper into two bright regions.
function pagesApart(regions, w, h, shave) {
  const count = w * h;
  const [first, second] = regions;
  if (!first || !second) return null;
  if (second.length < count * HALF_FLOOR) return null;
  if (second.length < first.length * 0.45) return null;   // a page and a scrap
  const quads = [first, second].map((region) => grow(cornersOf(region, w), shave));
  const box = (q) => ({
    left: Math.min(...q.map((p) => p[0])),
    right: Math.max(...q.map((p) => p[0])),
    top: Math.min(...q.map((p) => p[1])),
    bottom: Math.max(...q.map((p) => p[1])),
  });
  const [a, b] = quads.map(box);
  // Side by side, not one above the other and not one inside the other.
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const heights = [a.bottom - a.top, b.bottom - b.top];
  if (overlapX > Math.min(a.right - a.left, b.right - b.left) * 0.25) return null;
  if (overlapY < Math.min(...heights) * 0.6) return null;
  if (Math.min(...heights) / Math.max(...heights) < 0.6) return null;
  // Facing each other across a fold, rather than two sheets a hand apart.
  if (-overlapX > w * 0.2) return null;
  if (!quads.every((quad, i) => looksLikePaper(quad, regions[i].length, w, h, HALF_FLOOR))) return null;
  return quads.sort((p, q) => box(p).left - box(q).left);
}

// The page's own brightness, read across it: one number per column of a page
// that has been squared up first, so the fold of a book photographed at an
// angle is still a straight line down the middle of the reading.
function acrossPage(quad, luma, w, h, from, to, steps) {
  const map = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  if (!map) return null;
  const profile = new Float64Array(steps);
  const rows = 24;
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps;
    let total = 0;
    for (let j = 0; j < rows; j++) {
      const v = from + ((j + 0.5) / rows) * (to - from);
      const [x, y] = through(map, u, v);
      const px = Math.max(0, Math.min(w - 1, Math.round(x)));
      const py = Math.max(0, Math.min(h - 1, Math.round(y)));
      total += luma[py * w + px];
    }
    profile[i] = total / rows;
  }
  return profile;
}

// Where the fold is, in the page's own 0–1 width, or null if there is no fold.
// Read three times down the page: a seam that is in the middle at the top and
// somewhere else at the bottom is a shadow, not a spine.
function foldIn(quad, luma, w, h) {
  const STEPS = 90;
  const bands = [[0.06, 0.36], [0.36, 0.66], [0.66, 0.96]];
  const found = [];
  for (const [from, to] of bands) {
    const profile = acrossPage(quad, luma, w, h, from, to, STEPS);
    if (!profile) return null;
    let at = -1;
    let darkest = Infinity;
    const first = Math.round(STEPS * (0.5 - GUTTER_BAND));
    const last = Math.round(STEPS * (0.5 + GUTTER_BAND));
    for (let i = first; i <= last; i++) {
      if (profile[i] < darkest) { darkest = profile[i]; at = i; }
    }
    if (at < 0) return null;
    // Darker than the paper BESIDE it rather than than the page as a whole: a
    // reading taken across a system of music is pulled down by the staff lines
    // in it, and they lie across the fold and the margins alike, so measuring
    // the fold against them is measuring it against itself.
    const reach = Math.round(STEPS * 0.16);
    const clear = Math.round(STEPS * 0.045);
    const beside = (from, to) => {
      const run = [...profile.slice(Math.max(0, from), Math.min(STEPS, to))].sort((a, b) => a - b);
      return run.length ? run[Math.floor(run.length / 2)] : 0;
    };
    // Both sides averaged rather than the darker of them, because one side of
    // the fold is where the title sits and the other is where it does not.
    const paper = (beside(at - reach, at - clear) + beside(at + clear, at + reach + 1)) / 2;
    if (!paper || darkest > paper * GUTTER_DARK) return null;
    // And a LINE rather than a wash. The one thing that looks like a fold and
    // is not is the shadow of the phone lying across the middle of the page,
    // and that is broad — it darkens a third of the paper, not a column of it.
    const level = (darkest + paper) / 2;
    let opens = at;
    let closes = at;
    while (opens > 0 && profile[opens - 1] < level) opens--;
    while (closes < STEPS - 1 && profile[closes + 1] < level) closes++;
    if ((closes - opens + 1) / STEPS > GUTTER_WIDE) return null;
    found.push((at + 0.5) / STEPS);
  }
  // The same seam each time, give or take the slant of the book.
  if (Math.max(...found) - Math.min(...found) > 0.06) return null;
  return found;
}

// One wide sheet, cut in two down the fold. The halves are the quadrilateral
// split along the seam, which is where a spread's two pages actually are.
function pagesTogether(quad, luma, w, h) {
  const across = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const down = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  if (across < down * 1.08) return null;         // one page is not this wide
  const fold = foldIn(quad, luma, w, h);
  if (!fold) return null;
  const map = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  if (!map) return null;
  // A straight seam through the three readings, so a book that leans keeps its
  // pages square rather than gaining a wedge of its neighbour.
  const slant = (fold[2] - fold[0]) / 2;
  const middle = (fold[0] + fold[1] + fold[2]) / 3;
  const top = through(map, middle - slant / 2, 0);
  const bottom = through(map, middle + slant / 2, 1);
  const halves = [
    [quad[0], top, bottom, quad[3]],
    [top, quad[1], quad[2], bottom],
  ];
  if (!halves.every((half) => looksLikePaper(half, null, w, h, HALF_FLOOR))) return null;
  return halves;
}

const withinPicture = (quad, w, h) => quad.map(([x, y]) => [
  Math.max(0, Math.min(1, x / w)),
  Math.max(0, Math.min(1, y / h)),
]);

// The bright mask a page is found in: paper against the table, with the ink and
// the shadows on the paper filled back in.
function paperMask(luma, w, h) {
  const count = w * h;
  const cut = splitAt(luma, count);
  const bright = new Uint8Array(count);
  for (let i = 0; i < count; i++) bright[i] = luma[i] > cut ? 1 : 0;
  return { cut, bright, solid: fillHoles(erode(dilate(bright, w, h, 1), w, h, 1), w, h) };
}

// The pages in a photograph, each as four corners in the picture's own 0–1
// terms: one for a sheet, two for an open book, none when nothing in the frame
// is convincingly paper. `luma` is one value a pixel.
export function findPages(luma, w, h) {
  const count = w * h;
  const { solid } = paperMask(luma, w, h);
  const shave = Math.max(1, Math.round(w / 90));
  // Shave the fold of the book away, which is what parts two pages that touch.
  const regions = regionsOf(erode(solid, w, h, shave), w, h);
  const spread = pagesApart(regions, w, h, shave);
  if (spread) return spread.map((quad) => withinPicture(quad, w, h));
  const region = regions[0];
  if (!region || region.length < count * 0.18) return [];
  const quad = grow(cornersOf(region, w), shave);
  const flat = pagesTogether(quad, luma, w, h);
  if (flat) return flat.map((half) => withinPicture(half, w, h));
  if (!looksLikePaper(quad, region.length, w, h)) return [];
  return [withinPicture(quad, w, h)];
}

// The page, for everything that wants exactly one. Null for an open book as
// well as for an empty frame: a caller that can only keep one page must not be
// handed half a spread as though it were the whole of it.
export function findPage(luma, w, h) {
  const found = findPages(luma, w, h);
  return found.length === 1 ? found[0] : null;
}

// How much of the frame some pages take up, 0–1. What the scanner puts a number
// to when it asks somebody to come closer: a page shot from far enough away to
// be a fifth of the picture is a page stored at a fifth of the resolution the
// phone was holding, and no amount of straightening afterwards puts that back.
export function coverageOf(quads) {
  return (quads ?? []).reduce((sum, quad) => sum + quadArea(quad), 0);
}

// How far the pages moved between two looks, as a fraction of the frame —
// Infinity when there is nothing to compare, or when the number of pages
// changed, both of which mean "not settled yet".
export function quadsMoved(now, before) {
  if (!now?.length || !before?.length || now.length !== before.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < now.length; i++) {
    for (let k = 0; k < 4; k++) {
      worst = Math.max(worst, dist(now[i][k], before[i][k]));
    }
  }
  return worst;
}

// Why it said no. Not used by the app; used by the bench in tools/, and by
// anyone trying to work out what a photograph looks like to this code.
export function inspect(luma, w, h) {
  const count = w * h;
  const { cut, bright, solid } = paperMask(luma, w, h);
  let lit = 0;
  for (let i = 0; i < count; i++) lit += bright[i];
  const shave = Math.max(1, Math.round(w / 90));
  const regions = regionsOf(erode(solid, w, h, shave), w, h);
  const region = regions[0];
  const quad = region ? grow(cornersOf(region, w), shave) : null;
  const sides = quad && quad.every(Boolean)
    ? [dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0])]
    : null;
  const found = findPages(luma, w, h);
  return {
    cut,
    litFraction: lit / count,
    regionFraction: region ? region.length / count : 0,
    quad,
    sides: sides?.map((n) => Math.round(n)),
    quadFraction: quad && quad.every(Boolean) ? quadArea(quad) / count : 0,
    fill: quad && region && quad.every(Boolean) ? region.length / quadArea(quad) : 0,
    pages: found.length,
    coverage: coverageOf(found),
    accepted: found.length > 0,
  };
}

// --- pulling it square ---------------------------------------------------------

// The map from the output rectangle back to the photograph: eight numbers that
// send each corner of the rectangle to the matching corner of the quadrilateral,
// and everything between them accordingly. Solved rather than approximated,
// because an affine fit — the usual shortcut of splitting the quad into two
// triangles — cannot represent perspective, and perspective is the whole
// problem with photographing a page.
export function homography(from, to) {
  const a = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination with partial pivoting on the eight-by-eight.
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      if (!factor) continue;
      for (let k = col; k < 8; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const h = new Float64Array(9);
  for (let i = 0; i < 8; i++) h[i] = b[i] / a[i][i];
  h[8] = 1;
  return h;
}

export function through(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

// How big the straightened page should be: the average of each pair of opposite
// edges, so a page photographed at an angle comes out at the size it actually
// is rather than at the size of its widest edge.
export function rectFor(quad, w, h) {
  const at = quad.map(([x, y]) => [x * w, y * h]);
  const across = (dist(at[0], at[1]) + dist(at[3], at[2])) / 2;
  const down = (dist(at[0], at[3]) + dist(at[1], at[2])) / 2;
  return { width: Math.max(1, Math.round(across)), height: Math.max(1, Math.round(down)) };
}
