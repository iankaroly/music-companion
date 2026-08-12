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
function erode(mask, w, h, times) {
  let from = mask;
  for (let pass = 0; pass < times; pass++) {
    const to = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const at = y * w + x;
        to[at] = from[at] && from[at - 1] && from[at + 1] && from[at - w] && from[at + w] ? 1 : 0;
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

// The largest run of bright pixels that all touch each other — the page, when
// the page is the brightest large thing in the frame. Islands of light on the
// table, a reflection, the white of a cuff: all smaller, all discarded.
function brightestRegion(bright, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = null;
  let current = 0;
  for (let start = 0; start < w * h; start++) {
    if (!bright[start] || label[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = current;
    const found = [];
    while (top > 0) {
      const at = stack[--top];
      found.push(at);
      const x = at % w;
      const y = (at / w) | 0;
      if (x > 0 && bright[at - 1] && label[at - 1] === -1) { label[at - 1] = current; stack[top++] = at - 1; }
      if (x < w - 1 && bright[at + 1] && label[at + 1] === -1) { label[at + 1] = current; stack[top++] = at + 1; }
      if (y > 0 && bright[at - w] && label[at - w] === -1) { label[at - w] = current; stack[top++] = at - w; }
      if (y < h - 1 && bright[at + w] && label[at + w] === -1) { label[at + w] = current; stack[top++] = at + w; }
    }
    if (!best || found.length > best.length) best = found;
    current++;
  }
  return best;
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
function looksLikePaper(quad, area, w, h) {
  if (quad.some((point) => !point)) return false;
  const size = quadArea(quad);
  if (size < w * h * 0.25 || size > w * h * 0.99) return false;
  // A photograph that is nothing but paper has no edges in it to straighten by
  // — every corner it finds is a corner of the picture — and pulling it onto
  // itself would cost it a resampling and gain it nothing.
  const inCorner = ([x, y]) => (x < w * 0.03 || x > w * 0.97) && (y < h * 0.03 || y > h * 0.97);
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
  if (area / size < 0.6) return false;
  return true;
}

// The page in a photograph, as four corners in the picture's own 0–1 terms, or
// null when there is no convincing one. `luma` is one value a pixel.
export function findPage(luma, w, h) {
  const count = w * h;
  const cut = splitAt(luma, count);
  const bright = new Uint8Array(count);
  for (let i = 0; i < count; i++) bright[i] = luma[i] > cut ? 1 : 0;
  const shave = Math.max(1, Math.round(w / 90));
  // Close the ink up, then shave the fold of the book away.
  const solid = erode(dilate(bright, w, h, 1), w, h, 1);
  const region = brightestRegion(erode(solid, w, h, shave), w, h);
  if (!region || region.length < count * 0.18) return null;
  const quad = grow(cornersOf(region, w), shave);
  if (!looksLikePaper(quad, region.length, w, h)) return null;
  return quad.map(([x, y]) => [
    Math.max(0, Math.min(1, x / w)),
    Math.max(0, Math.min(1, y / h)),
  ]);
}

// Why it said no. Not used by the app; used by the bench in tools/, and by
// anyone trying to work out what a photograph looks like to this code.
export function inspect(luma, w, h) {
  const count = w * h;
  const cut = splitAt(luma, count);
  const bright = new Uint8Array(count);
  for (let i = 0; i < count; i++) bright[i] = luma[i] > cut ? 1 : 0;
  let lit = 0;
  for (let i = 0; i < count; i++) lit += bright[i];
  const shave = Math.max(1, Math.round(w / 90));
  const solid = erode(dilate(bright, w, h, 1), w, h, 1);
  const region = brightestRegion(erode(solid, w, h, shave), w, h);
  const quad = region ? grow(cornersOf(region, w), shave) : null;
  const sides = quad && quad.every(Boolean)
    ? [dist(quad[0], quad[1]), dist(quad[1], quad[2]), dist(quad[2], quad[3]), dist(quad[3], quad[0])]
    : null;
  return {
    cut,
    litFraction: lit / count,
    regionFraction: region ? region.length / count : 0,
    quad,
    sides: sides?.map((n) => Math.round(n)),
    quadFraction: quad && quad.every(Boolean) ? quadArea(quad) / count : 0,
    fill: quad && region && quad.every(Boolean) ? region.length / quadArea(quad) : 0,
    accepted: !!(region && region.length >= count * 0.18 && looksLikePaper(quad, region.length, w, h)),
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
