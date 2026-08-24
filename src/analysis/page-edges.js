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
// …but only holes the size of INK.
//
// The rule "dark with paper all the way round it is part of the paper" has one
// way of going badly wrong, and it is the case that made a page against a lit
// wall impossible to find at all. Photograph a part on a black stand in a bright
// room and the wall is the bright thing, the stand is a dark ring INSIDE it, and
// the ring is enclosed — so the whole frame filled in as one page, ink and all,
// and the shape that came back was the picture's own four corners.
// MEASURED, `npm run scan:pages`, case "sheet on stand, BRIGHT wall behind":
// one region, 100% of the frame, 29% of it "ink", and nothing found.
//
// So a hole is filled only if it is the size of a mark on paper. `HOLE_MOST` is
// generous — a beamed group, a rehearsal box, the shadow of a hand — and far
// under anything that is a piece of furniture.
const HOLE_MOST = 0.06;      // of the frame

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
  // What is left over is enclosed dark — but only the SMALL ones are ink. Each
  // enclosed patch is walked on its own and filled only if it is under the cap,
  // so a rehearsal box on the page is closed and the stand the page is sitting
  // on is not.
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = mask[i] ? 1 : 0;
  const cap = w * h * HOLE_MOST;
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (mask[start] || outside[start] || seen[start]) continue;
    top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const patch = [];
    while (top > 0) {
      const at = stack[--top];
      patch.push(at);
      const x = at % w;
      const y = (at / w) | 0;
      const step = (to) => {
        if (mask[to] || outside[to] || seen[to]) return;
        seen[to] = 1;
        stack[top++] = to;
      };
      if (x > 0) step(at - 1);
      if (x < w - 1) step(at + 1);
      if (y > 0) step(at - w);
      if (y < h - 1) step(at + w);
    }
    if (patch.length <= cap) for (const at of patch) out[at] = 1;
  }
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

// How much of a quadrilateral the bright region inside it actually fills, in
// pixels, for the last test in `looksLikePaper`. Counted rather than taken from
// the region's own size, because the quadrilateral is cut back to the sheet
// afterwards and the region it came from may be much bigger than what is left.
function fillOf(region, quad, w) {
  const side = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  let inside = 0;
  for (const at of region) {
    const p = [at % w, (at / w) | 0];
    let sign = 0;
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      const s = side(quad[i], quad[(i + 1) % 4], p);
      if (s === 0) continue;
      if (sign === 0) sign = Math.sign(s);
      else if (Math.sign(s) !== sign) ok = false;
    }
    if (ok) inside++;
  }
  return inside;
}

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

// --- the ink on it ------------------------------------------------------------
//
// Brightness alone cannot say where a sheet of paper stops, and the outline
// covering "a lot more than just the sheet" is what that looks like on a real
// camera. Everything above splits the picture into bright and dark and takes
// the biggest bright thing: on a dark table that IS the page, and on a pale
// desk, against a lit wall, or with the white lip of a stand touching the
// paper, the biggest bright thing is the page AND whatever it is lying on.
// MEASURED, `npm run scan:pages` before this section existed: a page on a white
// desk was not found at all, a page against a bright wall was not found at all,
// a bright slab beside the page came back as a SECOND page (100% of that
// outline was not paper), and the lip of a stand added 16% to the one round the
// page.
//
// The thing that separates all four from a page is that a page of music has
// MUSIC ON IT. Staff lines, beams, a title — dark marks over most of the paper,
// in a band that stops where the paper's margin starts. A wall has none, a desk
// has none, and the gutter of a book has none, which is the same fact answering
// three different questions:
//
//   is this paper?          a bright shape with no ink on it is not a page.
//   where does it stop?     a broad band of blank at the edge of a bright blob
//                           is not the page's margin, it is the desk.
//   is this one page?       a corridor with no ink down the middle of a wide
//                           bright shape is the fold of a book.
//
// It is deliberately a measure of INK rather than of edges: a phone photograph
// of paper on a pale desk often has no edge to find — the two are within a few
// levels of each other and the camera's own noise is bigger than the step — but
// the difference in what is PRINTED on them is total.

// The rim is left out of every reading of the ink.
//
// A quadrilateral round a sheet of paper always has DARK along its edge — the
// table just outside it, the shadow the paper casts, the camera's own vignette
// in the corners — and read as ink that says every page has ink from 0.00 to
// 1.00 on both axes. MEASURED, `npm run scan:pages -- --why` before this: a
// bright slab of WALL beside the page came back with 10.5% "ink" on it, all of
// it in the last fifth, and was outlined as a second page; and no page anywhere
// in the corpus could be trimmed, because none of them had a blank edge to
// trim. So the ink is read of the inside of the shape and the answers are
// mapped back out.
const INK_INSET = 0.05;       // of the quadrilateral, at each edge
const INK_COLS = 64;          // the grid the ink is read on, across the page…
const INK_ROWS = 88;          // …and down it
const INK_PAPER = 0.75;       // "paper" for a row is this quantile of the row
const INK_DARK = 0.92;        // and ink is this much darker than that
const INK_FLOOR = 0.012;      // a page carries at least this much ink
// HOW MUCH INK IS TOO MUCH TO BE PAPER, and it was set where no page had ever
// been measured.
//
// Every sheet drawn in `npm run scan:pages` reads between 20% and 39% ink, so
// nothing in this project ever asked what a BUSY page reads. A photograph of a
// real cadenza — semiquaver runs, ten systems — reads 56%; the same music
// engraved by LilyPond and read off the paper reads 65%. At 0.62 a page of hard
// music was refused for being too printed, `findPage` returned null, and
// `straightenCanvas` fell back to cropping the bright part of the frame: no
// squaring up, no shadow taken off, no page found, and nothing said.
//
// MEASURED, `npm run omr:truth` — the page of 352 notes, photographed, read by
// Audiveris and scored as the longest run of its own notes that comes back in
// order: the photograph as taken 85.5%, and the "page" the app made of it
// 54.0%. Thirty-one points, and not one of them the camera's fault.
//
// What the ceiling is actually for is a bright TEXTURED thing that is not paper
// — wood grain, a patterned cloth, a keyboard — because a uniformly dark object
// reads almost no ink at all by this measure (the paper level is taken per row,
// so a dark row's own level is dark). 0.8 leaves the densest music this project
// can draw (75.6%, `scan:pages` case "sheet of DENSE music") under the bar with
// room, and still refuses a shape that is four-fifths marks.
const INK_CEILING = 0.8;      // and this much means it is not paper but ink
const INK_SPREAD = 0.45;      // and it reaches at least this far across the page
const BLANK_EDGE = 0.12;      // a blank band this wide at an edge may not be margin
const KEEP_MARGIN = 0.08;     // …and what is left of it when the rest is cut

// The ink on a quadrilateral, as a grid in the PAGE's own square: `dark[r][c]`
// is 1 where that patch of the page is darker than the paper around it. Read
// through the homography rather than off the picture, so a page photographed at
// an angle is read square and a row of the grid is a row of the page.
//
// The paper level is taken per ROW rather than once for the whole page, because
// a photograph of paper is never evenly lit — a shadow across the bottom third
// is normal, and one number for the page calls all of it ink.
function inkGrid(quad, luma, w, h) {
  const map = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  if (!map) return null;
  const dark = new Uint8Array(INK_COLS * INK_ROWS);
  const value = new Float64Array(INK_COLS * INK_ROWS);
  // Each patch is read as NINE samples, not one — its average for the surface
  // and its darkest for the ink. One sample a patch misses anything thinner
  // than the grid: MEASURED, `npm run scan:pages -- --why`, case "open book,
  // FAINT fold": the seam is twenty pixels of a sixteen-hundred-pixel frame,
  // the grid steps twenty pixels at a time, and the fold simply was not in the
  // reading — the paper level across the book ran smooth through the middle
  // where the gutter is. Staff lines are thin the same way.
  const low = new Float64Array(INK_COLS * INK_ROWS);
  const inside = (t) => INK_INSET + t * (1 - 2 * INK_INSET);
  const stepU = (1 - 2 * INK_INSET) / INK_COLS;
  const stepV = (1 - 2 * INK_INSET) / INK_ROWS;
  for (let r = 0; r < INK_ROWS; r++) {
    const v = inside((r + 0.5) / INK_ROWS);
    for (let c = 0; c < INK_COLS; c++) {
      const u = inside((c + 0.5) / INK_COLS);
      let sum = 0;
      let darkest = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [x, y] = through(map, u + dx * stepU / 3, v + dy * stepV / 3);
          const px = Math.max(0, Math.min(w - 1, Math.round(x)));
          const py = Math.max(0, Math.min(h - 1, Math.round(y)));
          const seen = luma[py * w + px];
          sum += seen;
          if (seen < darkest) darkest = seen;
        }
      }
      value[r * INK_COLS + c] = sum / 9;
      low[r * INK_COLS + c] = darkest;
    }
  }

  // What counts as ink is decided against the paper AROUND each patch, in both
  // directions, and that is not a detail — it is what stops a darker SURFACE
  // being read as ink.
  //
  // Taken one row at a time (which is what this did first), a desk a shade
  // darker than the paper is "ink" all down the side of the picture, because
  // the row it is in is mostly paper and it is darker than that. MEASURED,
  // `npm run scan:pages -- --why`, case "sheet on a WHITE desk": the ink ran
  // from 0.05 to 0.95 across a shape that was two thirds desk, so there was no
  // blank band at the edge to notice and 39% of the outline was not paper.
  //
  // A patch is ink if it is darker than its own row AND its own column. A desk
  // down the left of the picture fills its columns, so the column's own level
  // IS the desk and the desk is not darker than itself. The gutter of a book
  // works the same way and this is what lets a fold be found in the ink: a seam
  // fills its column, so the column reads blank rather than solid black.
  const quantile = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * INK_PAPER)];
  };
  const rowLevel = [];
  for (let r = 0; r < INK_ROWS; r++) {
    rowLevel.push(quantile([...value.slice(r * INK_COLS, (r + 1) * INK_COLS)]));
  }
  const colLevel = [];
  for (let c = 0; c < INK_COLS; c++) {
    const column = [];
    for (let r = 0; r < INK_ROWS; r++) column.push(value[r * INK_COLS + c]);
    colLevel.push(quantile(column));
  }
  let total = 0;
  for (let r = 0; r < INK_ROWS; r++) {
    for (let c = 0; c < INK_COLS; c++) {
      const cut = Math.min(rowLevel[r], colLevel[c]) * INK_DARK;
      if (low[r * INK_COLS + c] < cut) { dark[r * INK_COLS + c] = 1; total++; }
    }
  }
  return { dark, value, total, share: total / (INK_COLS * INK_ROWS) };
}

// Is there music on it? A wall, a desk and a tablecloth come back near zero; a
// page of music sits between about 0.05 and 0.35. The ceiling is there because
// a black music stand read through a bright frame comes back nearly all "ink",
// and so does the dark table itself when the threshold lands the wrong side of
// the split.
function hasInk(grid) {
  if (!grid || grid.share < INK_FLOOR || grid.share > INK_CEILING) return false;
  // …and the music has to be spread over the shape. MEASURED, `npm run
  // scan:pages`, case "sheet with a bright slab beside it": a slab of lit WALL
  // carries 5% ink by this reading — all of it in the last fifth, where the
  // quadrilateral has run off the slab onto the dark room behind — and it was
  // outlined as a second page. A page of music is inked across most of itself
  // in both directions.
  const span = inkSpan(grid);
  if (!span.across || !span.down) return false;
  return span.across[1] - span.across[0] >= INK_SPREAD
    && span.down[1] - span.down[0] >= INK_SPREAD;
}

// Where the ink starts and stops, along each axis, in the page's own 0–1 terms.
// A row or column counts as inked if a few of its patches are, so one noisy
// sample cannot stretch the page over the desk.
function inkSpan(grid) {
  const rows = [];
  const cols = new Float64Array(INK_COLS);
  for (let r = 0; r < INK_ROWS; r++) {
    let count = 0;
    for (let c = 0; c < INK_COLS; c++) {
      if (grid.dark[r * INK_COLS + c]) { count++; cols[c]++; }
    }
    rows.push(count);
  }
  const spanOf = (counts, n, floor) => {
    let first = -1;
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (counts[i] >= floor) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return null;
    // …and back into the whole quadrilateral's terms, since the grid is read of
    // the inside of it.
    const out = (t) => INK_INSET + t * (1 - 2 * INK_INSET);
    return [out(first / n), out((last + 1) / n)];
  };
  return {
    down: spanOf(rows, INK_ROWS, Math.max(2, INK_COLS * 0.03)),
    across: spanOf(cols, INK_COLS, Math.max(2, INK_ROWS * 0.03)),
  };
}

// The part of a quadrilateral that is actually the sheet.
//
// A page's own margin is narrow — the printed area of engraved music starts
// within a fifth of the paper on every side — so a blank band WIDER than that
// at the edge of a bright blob is not margin, it is whatever the paper was
// lying on. This cuts it back to the ink plus a margin of its own, in the
// page's square, so a photograph taken at an angle is cut along the page's
// edges rather than along the picture's.
//
// It cuts only when the blank band is wide enough to be somebody's desk, and it
// never cuts into the ink. A page that was found correctly is left exactly as
// it was: MEASURED, `npm run scan:pages`, every case that was already right
// keeps its IoU to within a point.
// The paper's own brightness, read one line at a time and ignoring the ink,
// down the page and across it. Ink is left out because a row through a system
// of music is darker than the paper it is printed on and that has nothing to do
// with where the paper stops.
function paperProfiles(grid) {
  const middleOf = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  // The paper in a line is the BRIGHT end of it — the ninth decile — and not
  // the middle of the patches that are not ink. Taking the middle of what is
  // left after the ink is removed sounds equivalent and is not: a line that
  // runs the length of a staff line is ink nearly all the way across, so there
  // is nothing left to take the middle of, and the reading comes back as the
  // ink itself. MEASURED, `test/page-edges.test.js`, "finds a page with heavy
  // ink on it": the profile down that page read 220 45 220 45, every jump was a
  // step of eighty per cent, and the page was cut off at the first of them —
  // 38 pixels of a 182-pixel page.
  const PAPER = 0.9;
  const brightOf = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * PAPER)];
  };
  // Each line is read across the MIDDLE of the shape rather than the whole of
  // it. A camera darkens the corners of its picture — every phone does, and it
  // is a lens, not a mistake — so a line read corner to corner falls away at
  // both ends of the shape and the fall looks like the edge of a piece of
  // paper. It is strongest exactly where this reading is weakest and absent
  // down the middle, where a real edge shows just as well.
  // MEASURED, `npm run scan:pages`, "sheet held close": read corner to corner,
  // the vignette cut an eighth off a page that filled the frame.
  const MIDDLE = 0.25;
  const fromCol = Math.round(INK_COLS * MIDDLE);
  const toCol = INK_COLS - fromCol;
  const fromRow = Math.round(INK_ROWS * MIDDLE);
  const toRow = INK_ROWS - fromRow;
  const down = [];
  const across = [];
  for (let r = 0; r < INK_ROWS; r++) {
    const seen = [];
    for (let c = fromCol; c < toCol; c++) seen.push(grid.value[r * INK_COLS + c]);
    down.push(brightOf(seen));
  }
  for (let c = 0; c < INK_COLS; c++) {
    const seen = [];
    for (let r = fromRow; r < toRow; r++) seen.push(grid.value[r * INK_COLS + c]);
    across.push(brightOf(seen));
  }
  // …and then the brightest reading within a line or two either way, because a
  // line that lies ALONG a staff line has no paper in it at all. Paper is what
  // the neighbourhood is made of; a step from one surface to another survives
  // this (it moves the reading by a line or two), a staff line does not.
  // ONE line either way, MEASURED by sweeping it: at a reach of one the worst
  // spill over the corpus is 9%, at two it is 15% and at three 20% — the wider
  // the neighbourhood, the further the paper's own level reaches out over the
  // desk and the later the edge is cut. Mean IoU moves the other way by half a
  // point, and spill is the number the complaint is about.
  const REACH = 1;
  const brightest = (profile) => profile.map((_, i) => {
    let most = null;
    for (let k = -REACH; k <= REACH; k++) {
      const seen = profile[i + k];
      if (seen !== undefined && seen !== null && (most === null || seen > most)) most = seen;
    }
    return most;
  });
  return { middleOf, downProfile: brightest(down), acrossProfile: brightest(across) };
}

function trimToInk(quad, luma, w, h) {
  const grid = inkGrid(quad, luma, w, h);
  if (!grid || !hasInk(grid)) return quad;
  const span = inkSpan(grid);
  if (!span.down || !span.across) return quad;
  const map = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  if (!map) return quad;

  const { middleOf, downProfile, acrossProfile } = paperProfiles(grid);

  // Where the surface CHANGES inside a blank band, and by how much.
  //
  // This is the whole of the rule, and it is deliberately a step rather than a
  // width or an average. A page's own margin and the page are one sheet of
  // paper: the brightness runs through them unbroken, however wide the margin
  // is and however unevenly the page is lit. A desk, the lip of a stand, the
  // next sheet in the pile is a different surface, and where it starts there is
  // a STEP — a couple of grid rows across which the level jumps and then stays
  // jumped.
  //
  // Two rules that were tried first and are wrong, both MEASURED with
  // `npm run scan:pages`: cutting every blank band wider than a fifth of the
  // page took the bottom off a page that was found perfectly (97.6% IoU to
  // 83.4%), because the last system does not reach the bottom of the paper; and
  // comparing the band against the page's own average level cut a quarter off
  // the page with the phone's shadow lying across it (98.2% to 73.6%), because
  // a shadow IS a different level — it is just not a different surface. A
  // gradient has no step in it, which is exactly how the two differ.
  const STEP = 0.045;              // how big the jump across the edge has to be
  const HOLDS = 0.5;               // …and how much of it must STAY jumped
  const OVER_NOISE = 3;            // …and how far above the profile's own wobble
  // A page held close is nearly all music, and the paper level read between the
  // systems wobbles by several levels a line. Read raw, that wobble contains a
  // "step" of five per cent almost anywhere, and one of them cut a page that
  // filled the frame down by an eighth (MEASURED, `npm run scan:pages`, "sheet
  // held close": 98.2% IoU to 86.2%). So the profile is smoothed first, and a
  // step has to stand clear of how much the profile moves line to line anyway.
  const smooth = (profile) => profile.map((_, i) => {
    const seen = [profile[i - 1], profile[i], profile[i + 1]].filter((n) => n !== null && n !== undefined);
    return seen.length ? seen.sort((a, b) => a - b)[Math.floor(seen.length / 2)] : null;
  });
  const wobble = (profile) => {
    const steps = [];
    for (let i = 1; i < profile.length; i++) {
      if (profile[i] !== null && profile[i - 1] !== null) steps.push(Math.abs(profile[i] - profile[i - 1]));
    }
    if (!steps.length) return 0;
    steps.sort((a, b) => a - b);
    return steps[Math.floor(steps.length / 2)];
  };
  const near = (profile, from, to) => middleOf(profile
    .slice(Math.max(0, from), Math.min(profile.length, to))
    .filter((n) => n !== null));
  const stepIn = (raw, from, to) => {
    const profile = smooth(raw);
    const floor = wobble(profile) * OVER_NOISE;
    let bestAt = -1;
    let best = 0;
    for (let i = Math.max(3, from); i <= Math.min(profile.length - 3, to); i++) {
      const before = near(profile, i - 2, i);
      const after = near(profile, i + 1, i + 3);
      if (before === null || after === null) continue;
      const scale = Math.max(before, after);
      const jump = Math.abs(after - before) / scale;
      if (jump <= STEP || jump <= best) continue;
      if (Math.abs(after - before) < floor) continue;
      // An EDGE stops. A gradient keeps going, and a gradient is what a shadow
      // across the page and the camera's own vignette both are: the level three
      // lines further on has moved as far again. MEASURED, `npm run scan:pages`,
      // "sheet with the phone's shadow across it": judging the jump alone cut a
      // third of that page away (98.2% IoU to 64.3%).
      const outward = near(profile, i - 5, i - 2);
      const onward = near(profile, i + 3, i + 6);
      const keeps = (a, b) => (a === null || b === null
        ? true : Math.abs(b - a) / scale < jump * HOLDS);
      if (!keeps(before, outward) || !keeps(after, onward)) continue;
      best = jump;
      bestAt = i;
    }
    return best > STEP ? bestAt : -1;
  };

  const at = (t, n) => Math.max(0, Math.min(n, Math.round(((t - INK_INSET) / (1 - 2 * INK_INSET)) * n)));
  const back = (i, n) => INK_INSET + (i / n) * (1 - 2 * INK_INSET);
  const rowFrom = at(span.down[0], INK_ROWS);
  const rowTo = at(span.down[1], INK_ROWS);
  const colFrom = at(span.across[0], INK_COLS);
  const colTo = at(span.across[1], INK_COLS);

  // How much ink there is in each line, so a cut can be checked against the one
  // thing that must never happen: taking music off the page.
  const rowInk = new Float64Array(INK_ROWS);
  const colInk = new Float64Array(INK_COLS);
  for (let r = 0; r < INK_ROWS; r++) {
    for (let c = 0; c < INK_COLS; c++) {
      if (grid.dark[r * INK_COLS + c]) { rowInk[r]++; colInk[c]++; }
    }
  }

  // The search runs in the outer third of the shape from each side and takes
  // the strongest step it finds there, whether or not there is a wide blank
  // band to look in. Waiting for a blank band was tried and does not work: a
  // desk a shade darker than the paper leaves the odd patch reading as ink out
  // in the desk, so the "blank" band is a few per cent wide and the search
  // never ran. MEASURED, `npm run scan:pages`, case "sheet on a WHITE desk":
  // 40% of the outline was desk, with the step sitting plainly in the profile.
  //
  // A cut is only taken if what it removes is nearly empty of music — a fifth
  // of what is left, no more. That is the guard that makes searching the whole
  // outer third safe: a heavy step INSIDE the page (a title block, a rehearsal
  // band, the fold of a page turned back) has music beyond it and is refused.
  const CUT_MOST = 0.28;             // never take more than this off one side
  // A tenth, MEASURED by sweeping it: at a fifth the knee of the phone's own
  // shadow across a page was taken for the paper's edge and cut the bottom
  // system off (98.2% IoU to 83.5%), because the one system below the knee is
  // an eighth of the page's ink. At a tenth and at a twentieth the corpus reads
  // the same, so the looser of the two is kept.
  const CARRIES = 0.1;               // …and only if it carries this little ink
  const inkIn = (counts, from, to) => {
    let sum = 0;
    for (let i = Math.max(0, from); i < Math.min(counts.length, to); i++) sum += counts[i];
    return sum;
  };
  // The outer third itself, not "the outer third up to where the ink starts".
  // The camera's own vignette darkens the corners of the frame past any
  // threshold, so a shape that runs to the edge of the picture has a patch or
  // two of "ink" in its corners and the ink never starts at zero. MEASURED,
  // `npm run scan:pages`, "sheet on a WHITE desk" again: clamping the search
  // there left the step unlooked-for and a third of the outline desk. The guard
  // that keeps this safe is the ink one below, not where the search stops.
  const cutStart = (profile, counts, inkFrom, n) => {
    const found = stepIn(profile, 0, Math.round(n * CUT_MOST));
    if (found < 0) return 0;
    if (inkIn(counts, 0, found) > inkIn(counts, found, n) * CARRIES) return 0;
    return back(found, n);
  };
  const cutEnd = (profile, counts, inkTo, n) => {
    const found = stepIn(profile, Math.round(n * (1 - CUT_MOST)), n);
    if (found < 0) return 1;
    if (inkIn(counts, found, n) > inkIn(counts, 0, found) * CARRIES) return 1;
    return back(found, n);
  };
  const v0 = cutStart(downProfile, rowInk, rowFrom, INK_ROWS);
  const v1 = cutEnd(downProfile, rowInk, rowTo, INK_ROWS);
  const u0 = cutStart(acrossProfile, colInk, colFrom, INK_COLS);
  const u1 = cutEnd(acrossProfile, colInk, colTo, INK_COLS);
  if (u1 - u0 < 0.35 || v1 - v0 < 0.35) return quad;      // that is not a page
  return [through(map, u0, v0), through(map, u1, v0),
    through(map, u1, v1), through(map, u0, v1)];
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
// HOW FAR FROM THE MIDDLE THE FOLD IS LOOKED FOR, and why it is no longer a
// sixth.
//
// A spread photographed whole has its gutter down the middle, and for as long
// as that was the only book this was shown, a sixth either way was plenty. It
// is not the picture a phone over a music stand takes. THE COMPLAINT: "when i
// scan a page from a book, it doesnt single out the page but instead get part
// of the page to the right or left." That is the phone held close over ONE
// page — which is what the scanner asks for, in those words — with a band of
// the facing page still catching the edge of the frame. The fold in that
// picture is a fifth of the way in, not half, so neither witness to it was ever
// looked for where it was, `pagesTogether` never fired, and one outline went
// round the page and its neighbour's edge.
//
// MEASURED, `npm run scan:pages`, case "book, ONE page, a BAND of the next one
// in shot": 72.1% IoU and the outline spanning two pages, against 96.4% when
// the gutter is dark enough to part the two leaves in the mask by itself.
const GUTTER_BAND = 0.34;     // how far from the middle the fold is looked for
const GUTTER_DARK = 0.92;     // how much darker than the paper beside it the fold must be
const GUTTER_WIDE = 0.14;     // and how narrow: a spine is a line, a shadow is a wash
// A fold has MUSIC ON BOTH SIDES OF IT. It is the guard that makes a search
// this wide safe: the other thing that looks like a gutter is the page's own
// margin, and there is nothing printed beyond that. The floor is a share of the
// page's ink rather than an absolute, and it is low because the far side of an
// off-centre fold is a BAND of a page rather than a page — a fifth of the frame
// carrying a fifth of what is printed.
const GUTTER_INK = 0.08;
// How much darker than the corridor's own ends the trough has to be before it
// is believed to be the fold rather than arithmetic. Levels are 0-255, so this
// is a shade a human would call slightly grey — a crease that shows at all
// clears it, and an evenly lit margin does not.
const GUTTER_TROUGH = 6;
// How much of its own outline the bright thing has to fill before a fold is
// looked for in it at all. The same 0.6 `looksLikePaper` has always used — see
// the note on `canSplit` in findPages.
const FILL_OUTLINE = 0.6;

// Two pages, when the fold has cut the paper into two bright regions.
function pagesApart(candidates, w, h) {
  const count = w * h;
  const [first, second] = candidates;
  if (!first || !second) return null;
  if (second.area < count * HALF_FLOOR) return null;
  if (second.area < first.area * 0.45) return null;       // a page and a scrap
  const quads = [first.quad, second.quad];
  const areas = [first, second].map(({ region, quad }) => fillOf(region, quad, w));
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
  if (!quads.every((quad, i) => looksLikePaper(quad, areas[i], w, h, HALF_FLOOR))) return null;
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
  const widths = [];
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
    widths.push((closes - opens + 1) / STEPS);
  }
  // The same seam each time, give or take the slant of the book.
  if (Math.max(...found) - Math.min(...found) > 0.06) return null;
  // …and how wide it is, so the pages can be cut at its EDGES rather than down
  // the middle of it. See `pagesTogether`.
  return { at: found, wide: Math.max(...widths) };
}

// The other witness to a fold, and the one that works when the light does not.
//
// A book pressed flat under a lamp has no crease to see — MEASURED, `npm run
// scan:pages`, case "open book, FAINT fold": the seam is twenty pixels of paper
// four levels darker than the paper beside it, `foldIn` says no, and ONE
// outline goes round both pages, which is exactly the complaint this round is
// about. But no engraver prints across the gutter. The corridor between the two
// pages has no ink in it however flat the book is lying, and that is what this
// looks for: the widest run of blank columns near the middle of a wide bright
// shape, with music on both sides of it.
function foldByInk(quad, luma, w, h) {
  const grid = inkGrid(quad, luma, w, h);
  if (!hasInk(grid)) return null;
  const columns = new Float64Array(INK_COLS);
  for (let r = 0; r < INK_ROWS; r++) {
    for (let c = 0; c < INK_COLS; c++) if (grid.dark[r * INK_COLS + c]) columns[c]++;
  }
  const quiet = Math.max(1, INK_ROWS * 0.02);
  const first = Math.round(INK_COLS * (0.5 - GUTTER_BAND));
  const last = Math.round(INK_COLS * (0.5 + GUTTER_BAND));
  let bestFrom = -1;
  let bestTo = -1;
  let from = -1;
  for (let c = first; c <= last + 1; c++) {
    const blank = c <= last && columns[c] <= quiet;
    if (blank && from < 0) from = c;
    if (!blank && from >= 0) {
      if (c - from > bestTo - bestFrom) { bestFrom = from; bestTo = c; }
      from = -1;
    }
  }
  if (bestFrom < 0) return null;
  if ((bestTo - bestFrom) / INK_COLS > GUTTER_WIDE) return null;   // a blank page, not a fold
  // Music on BOTH sides of it, and a fair amount of it: the margin at the end
  // of a single page is also a run of blank columns, and it is not a gutter.
  const inkIn = (a, b) => {
    let sum = 0;
    for (let c = Math.max(0, a); c < Math.min(INK_COLS, b); c++) sum += columns[c];
    return sum;
  };
  const left = inkIn(0, bestFrom);
  const right = inkIn(bestTo, INK_COLS);
  if (!left || !right) return null;
  if (Math.min(left, right) < grid.total * GUTTER_INK) return null;
  // THE DARKEST COLUMN IN THE CORRIDOR, NOT THE MIDDLE OF IT.
  //
  // The corridor is the gutter PLUS both inner margins, and its middle is the
  // gutter only when those two margins are the same width in the picture. On
  // the frame a phone over a music stand actually takes they are not: one page
  // is a BAND running off the side of the frame and the other is a whole page
  // seen at an angle, so their margins are nothing like each other and the
  // middle of the corridor is not the fold.
  //
  // MEASURED, `npm run scan:pages -- WHY=BAND`, case "book, ONE page, a BAND of
  // the next one in shot": the paper parts at 0.224..0.253 of the frame and the
  // corridor's middle put the seam at 0.284 — past the gutter entirely and a
  // twentieth of the frame INSIDE the page being aimed at. So the outline of
  // the page he wanted started six per cent late on its left, which is the
  // complaint: "the blue rectangle only reaches about 85% of the page,
  // especially if it's on the left side."
  //
  // The gutter is still the darkest thing in that corridor even when it is not
  // dark enough to part the two leaves in the mask — that is the whole reason
  // this route is reached rather than `foldIn`. Reading brightness rather than
  // ink costs nothing: `inkGrid` has already measured it.
  const dim = (c) => {
    let sum = 0;
    for (let r = 0; r < INK_ROWS; r++) sum += grid.value[r * INK_COLS + c];
    return sum / INK_ROWS;
  };
  let darkest = (bestFrom + bestTo - 1) / 2;
  let least = Infinity;
  for (let c = bestFrom; c < bestTo; c++) {
    const v = dim(c);
    if (v < least) { least = v; darkest = c; }
  }
  // …and only where the corridor really has a trough in it. A corridor of even
  // margin with no crease anywhere in it has a darkest column by arithmetic and
  // it means nothing; the middle is the better guess there, and it is the
  // answer this route has always given.
  const flat = dim(bestFrom) + dim(bestTo - 1);
  const trough = least < (flat / 2) - GUTTER_TROUGH;
  const seam = trough ? darkest + 0.5 : (bestFrom + bestTo) / 2;
  const middle = INK_INSET + (seam / INK_COLS) * (1 - 2 * INK_INSET);
  // NO WIDTH FROM THIS ROUTE, deliberately. `pagesTogether` cuts at the EDGES
  // of a fold when it knows how wide the fold is, and what this one measures is
  // not the fold: it is the blank corridor between the two pages' printing,
  // which is the gutter PLUS both inner margins. Cutting at its edges would
  // shave the inner margin off both pages and land the knife on the first
  // inked column, a grid patch — twenty pixels — from the first notehead. The
  // middle of the corridor is the gutter, near enough, and margin is paper.
  return { at: [middle, middle, middle], wide: 0 };
}

// One wide sheet, cut in two down the fold. The halves are the quadrilateral
// split along the seam, which is where a spread's two pages actually are.
// THE ASPECT GATE IS GONE, and it is worth saying what it was for. It read
// `if (across < down * 1.08) return null` — one page is not this wide, so do
// not go looking for a fold in it — and it was a cheap way of never asking the
// question of a single sheet. It also ruled out the picture the complaint is
// about: a phone close over ONE page of a book is looking at something the
// shape of a page, with a band of the next one down the side, and that is
// exactly what "not this wide" throws away. What replaces it is the evidence
// itself: a crease dark and narrow and in the same place at the top, the middle
// and the bottom, or a blank corridor with music printed on BOTH sides of it.
// A sheet of music has neither.
//
// AND THE FAR SIDE NEED NOT BE A PAGE. This used to refuse unless BOTH halves
// looked like paper, which is the same bug one step further down: the band of
// the facing page in the corner of the frame is a tenth of the picture, not
// half of it, so the refusal fired on precisely the case the fold was found
// for. What matters is that the half being KEPT is a page; the other half is
// being thrown away, and a scrap is a perfectly good thing to throw away.
function pagesTogether(quad, luma, w, h) {
  // The crease first, because it is measured down the page in three bands and
  // so carries the book's lean; the ink corridor is one straight line and is
  // what answers when there is no crease to see.
  const fold = foldIn(quad, luma, w, h) ?? foldByInk(quad, luma, w, h);
  if (!fold) return null;
  const map = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  if (!map) return null;
  // A straight seam through the three readings, so a book that leans keeps its
  // pages square rather than gaining a wedge of its neighbour.
  const seam = fold.at;
  const slant = (seam[2] - seam[0]) / 2;
  const middle = (seam[0] + seam[1] + seam[2]) / 3;
  // CUT AT THE EDGES OF THE FOLD, NOT DOWN THE MIDDLE OF IT. A gutter is fifty
  // pixels of shadow and glued spine, and it is not paper: cutting through its
  // centre gives every page of a book a dark stripe down its inner margin,
  // which is background inside the outline — exactly what the spill column
  // counts. MEASURED, `npm run scan:pages`, case "book, ONE page, a BAND of the
  // next one in shot": 12.2% of one outline was not paper, cut down the middle.
  // Half a fold either way is a little of the page's own margin at worst, and a
  // margin is paper.
  const half = Math.max(0, Math.min(0.06, (fold.wide ?? 0) / 2));
  const cut = (u, v) => through(map, u, v);
  const halves = [
    [quad[0], cut(middle - slant / 2 - half, 0), cut(middle + slant / 2 - half, 1), quad[3]],
    [cut(middle - slant / 2 + half, 0), quad[1], quad[2], cut(middle + slant / 2 + half, 1)],
  ];
  const keep = halves.filter((half) => looksLikePaper(half, null, w, h, HALF_FLOOR));
  if (!keep.length) return null;
  // The BIGGEST half has to be one of the ones being kept. A cut that throws
  // away the largest thing in the picture is not a book being read, it is a
  // page being lost, and there is no undo for that.
  const biggest = quadArea(halves[0]) >= quadArea(halves[1]) ? halves[0] : halves[1];
  if (!keep.includes(biggest)) return null;
  return keep;
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
  // The biggest bright thing is not always the page — a lit wall behind a stand
  // is bigger than the part on it, and a window down one side of the frame is
  // brighter. So the largest few are all considered, each cut back to the sheet
  // it has music on, and the ones with no music on them are not pages.
  // MEASURED, `npm run scan:pages`: this is what finds the page against a
  // bright wall (nothing was found at all before) and what stops a bright slab
  // beside the page being outlined as a second page.
  const candidates = [];
  for (const region of regions.slice(0, 6)) {
    if (region.length < count * HALF_FLOOR * 0.7) break;         // sorted: the rest are smaller
    const found = grow(cornersOf(region, w), shave);
    if (!found.every(Boolean)) continue;
    const quad = trimToInk(found, luma, w, h);
    if (!hasInk(inkGrid(quad, luma, w, h))) continue;
    const area = quadArea(quad);
    candidates.push({ region, quad, area, fill: area ? fillOf(region, quad, w) / area : 0 });
  }
  candidates.sort((a, b) => b.area - a.area);

  const spread = pagesApart(candidates, w, h);
  if (spread) return spread.map((quad) => withinPicture(quad, w, h));
  // A SHAPE THAT DOES NOT FILL ITS OWN OUTLINE IS NOT A BOOK EITHER, and this
  // is the guard the split has to carry now that it is allowed to look for a
  // fold anywhere. `looksLikePaper` has always refused a bright thing that
  // fills less than 0.6 of the quadrilateral drawn round it; `pagesTogether`
  // never had to, because the aspect gate kept it away from anything that was
  // not obviously two pages wide. MEASURED, `npm run scan:pages`, case "sheet
  // on stand, BRIGHT wall behind": the wall is a RING round the dark stand, its
  // corners are the corners of the picture, and it fills 11.7% of them — and
  // with the fold looked for freely it came back as a spread, two outlines,
  // 100% of one of them not paper at all, in front of the page it was standing
  // behind.
  const canSplit = ({ quad, fill }) => fill >= FILL_OUTLINE && pagesTogether(quad, luma, w, h);
  const best = candidates.find((one) => canSplit(one)
    || looksLikePaper(one.quad, fillOf(one.region, one.quad, w), w, h));
  if (!best) return [];
  const flat = canSplit(best);
  if (flat) return flat.map((half) => withinPicture(half, w, h));
  return [withinPicture(best.quad, w, h)];
}

// The page, for everything that wants exactly one. Null for an open book as
// well as for an empty frame: a caller that can only keep one page must not be
// handed half a spread as though it were the whole of it.
export function findPage(luma, w, h) {
  const found = findPages(luma, w, h);
  return found.length === 1 ? found[0] : null;
}

// Which of the pages in the frame the camera is being AIMED at.
//
// The scanner shows one sheet at a time — a blue outline round the page that
// the shutter will keep, and nothing filled in over its neighbour. Over an open
// book that means picking one of the two, and the honest answer to which one is
// the one under the middle of the picture: pointing a phone at something is how
// people say which thing they mean.
//
// The middle of the frame first, and the nearest centre only as a fallback, so
// aiming squarely at one page of a spread always wins even when the other page
// is bigger in the frame — a book leaning on a stand puts one page much nearer
// the camera than the other.
export function aimedPage(quads, at = [0.5, 0.5]) {
  if (!quads?.length) return -1;
  const holds = (quad) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const side = (b[0] - a[0]) * (at[1] - a[1]) - (b[1] - a[1]) * (at[0] - a[0]);
      if (side === 0) continue;
      if (sign === 0) sign = Math.sign(side);
      else if (Math.sign(side) !== sign) return false;
    }
    return true;
  };
  const over = quads.findIndex(holds);
  if (over >= 0) return over;
  let best = -1;
  let nearest = Infinity;
  quads.forEach((quad, i) => {
    const cx = quad.reduce((n, p) => n + p[0], 0) / 4;
    const cy = quad.reduce((n, p) => n + p[1], 0) / 4;
    const away = Math.hypot(cx - at[0], cy - at[1]);
    if (away < nearest) { nearest = away; best = i; }
  });
  return best;
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

// Every bright thing the finder considered and what it decided about each: the
// region's size, how much ink is on it, where that ink stops, and which test
// threw it out. Not used by the app — `npm run scan:pages -- --why` prints it,
// and every round that touches this file starts by reading it rather than by
// reasoning about what the code probably does.
export function probePages(luma, w, h) {
  const count = w * h;
  const { solid } = paperMask(luma, w, h);
  const shave = Math.max(1, Math.round(w / 90));
  const regions = regionsOf(erode(solid, w, h, shave), w, h);
  return regions.slice(0, 6).map((region) => {
    const row = { size: region.length / count };
    const found = grow(cornersOf(region, w), shave);
    if (!found.every(Boolean)) return { ...row, verdict: 'no corners' };
    const before = inkGrid(found, luma, w, h);
    const quad = trimToInk(found, luma, w, h);
    const grid = inkGrid(quad, luma, w, h);
    Object.assign(row, {
      inkBefore: before?.share ?? 0,
      ink: grid?.share ?? 0,
      span: before ? inkSpan(before) : null,
      trimmed: quadArea(quad) / (quadArea(found) || 1),
      down: before ? paperProfiles(before).downProfile.map((n) => (n === null ? -1 : Math.round(n))) : null,
      across: before ? paperProfiles(before).acrossProfile.map((n) => (n === null ? -1 : Math.round(n))) : null,
      quad: quad.map(([x, y]) => [Math.round(x), Math.round(y)]),
      fill: fillOf(region, quad, w) / (quadArea(quad) || 1),
      paper: looksLikePaper(quad, fillOf(region, quad, w), w, h),
      split: fillOf(region, quad, w) / (quadArea(quad) || 1) >= FILL_OUTLINE
        && !!pagesTogether(quad, luma, w, h),
    });
    row.verdict = !hasInk(grid) ? 'no ink' : (row.split ? 'a spread' : (row.paper ? 'a page' : 'not paper-shaped'));
    return row;
  });
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
    // How much of the biggest bright thing is ink, and where that ink stops:
    // the two numbers that say whether it is paper and where the paper ends.
    ink: quad && quad.every(Boolean) ? (inkGrid(quad, luma, w, h)?.share ?? 0) : 0,
    inkSpan: quad && quad.every(Boolean)
      ? (() => { const g = inkGrid(quad, luma, w, h); return g ? inkSpan(g) : null; })() : null,
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
