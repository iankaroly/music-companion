// Reading the shape of a photographed page: staves, bars, noteheads.
//
// Not what the notes ARE — that is optical music recognition and it does not
// run here. What this finds is where the music sits: which lines make a stave,
// where the barlines fall, and where every notehead is. That is enough to put a
// take's intonation on the right note of your own photograph, which is the
// thing a scan could never do before.
//
// Everything is measured off the page as photographed. A book on a table is not
// flat: the page curves into the gutter, the phone is never square to it, and a
// staff line running the width of the page drifts several pixels as it goes.
// Projected onto one profile, five sharp lines become one grey smear — so the
// lines are tracked in narrow vertical STRIPS, where the drift is a fraction of
// a pixel, and linked across the page into curves. Nothing downstream needs the
// page flattened.
//
// Coordinates come out normalised to the image (0–1 across, 0–1 down), so they
// survive being drawn at any size on any screen.

const WORK_WIDTH = 1400;   // enough detail for a staff space of ~9px
const STRIPS = 40;

function toGray(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  return gray;
}

// A separable box blur, used to build the page's own lighting so it can be
// divided out. A photograph of a book has a shadow across it and a gradient
// from the lamp; a single threshold survives neither.
function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const dst = new Float32Array(w * h);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span;
      sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return dst;
}

// The commonest vertical run of ink is the thickness of a staff line; the
// commonest run of white between them is the staff space. No thresholds and no
// guess about how far away the camera was.
function pageScale(ink, w, h) {
  const black = new Array(40).fill(0);
  const white = new Array(80).fill(0);
  for (let x = 0; x < w; x += 2) {
    let run = 0;
    let colour = 0;
    for (let y = 0; y < h; y++) {
      const v = ink[y * w + x];
      if (v === colour) { run++; continue; }
      const table = colour ? black : white;
      if (run > 0 && run < table.length) table[run]++;
      colour = v;
      run = 1;
    }
  }
  const commonest = (table, from) => {
    let best = from;
    for (let i = from; i < table.length; i++) if (table[i] > table[best]) best = i;
    return best;
  };
  const thickness = commonest(black, 1);
  const space = commonest(white, thickness + 1);
  return { thickness, space, pitch: space + thickness };
}

// How much like a stave is this?
//
// The first reader hunted each of the five lines on its own — "is more than
// half this strip inked at this row" — and on a photographed book page one line
// in five routinely fails that test. Four lines is not a stave, so whole
// systems vanished: on the page this was rebuilt against it found two of ten.
//
// A comb asks a different question. It scores the five rows a stave would
// occupy MINUS the four rows halfway between them, so it answers only where
// there is a five-line GRID and not merely ink. The four lines that are clear
// vote for the one that is faint, and the negative lobes are what stop a beam,
// a black chord or the edge of the page from answering at all.
export function combScore(profile, y0, step) {
  let on = 0;
  let off = 0;
  for (let k = 0; k < 5; k++) {
    const y = Math.round(y0 + k * step);
    if (y < 0 || y >= profile.length) return -1;
    on += profile[y];
    if (k < 4) off += profile[Math.round(y0 + (k + 0.5) * step)];
  }
  return on / 5 - off / 4;
}

// Every stave in one vertical strip of the page.
//
// The spacing is refined per peak rather than taken from the page average: a
// photographed page is not flat, and a system at the foot of it can sit a
// fraction of a pixel per line wider than one at the top.
//
// `apart` is deliberately wider than a stave is tall. A comb will happily lock
// onto four real lines plus a ledger line a few spaces below and report a
// second stave that does not exist; suppressing anything within four pitches
// of a stronger answer is what stopped that on the page this was built against
// — twenty staves found where there are ten.
export function combPeaks(profile, pitch, { floor = 0.3, apart = 4.2 } = {}) {
  const found = [];
  for (let y0 = 0; y0 + 4 * pitch < profile.length; y0++) {
    let best = -1;
    let bestStep = pitch;
    for (let step = pitch - 1.5; step <= pitch + 1.5; step += 0.25) {
      const v = combScore(profile, y0, step);
      if (v > best) { best = v; bestStep = step; }
    }
    if (best >= floor) found.push({ y0, step: bestStep, score: best });
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of found) {
    if (kept.some((k) => Math.abs(k.y0 - c.y0) < pitch * apart)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.y0 - b.y0);
}

function stripPeaks(ink, w, h, strip, stripW, thickness) {
  const x0 = strip * stripW;
  const x1 = Math.min(w, x0 + stripW);
  const profile = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) n += ink[y * w + x];
    profile[y] = n;
  }
  const peaks = [];
  const floor = (x1 - x0) * 0.55;
  for (let y = 1; y < h - 1; y++) {
    if (profile[y] < floor) continue;
    if (profile[y] < profile[y - 1] || profile[y] < profile[y + 1]) continue;
    if (peaks.length && y - peaks.at(-1) <= thickness) continue;
    peaks.push(y);
  }
  return peaks;
}

// Link the per-strip peaks into curves. Each curve is one staff line, allowed to
// wander by a fraction of a staff space from one strip to the next.
function trackLines(peaksPerStrip, pitch) {
  const drift = Math.max(2, pitch * 0.45);
  const curves = [];
  for (let s = 0; s < peaksPerStrip.length; s++) {
    const taken = new Set();
    for (const curve of curves) {
      if (curve.last < s - 2) continue;
      let best = null;
      let bestGap = drift;
      for (const y of peaksPerStrip[s]) {
        if (taken.has(y)) continue;
        const gap = Math.abs(y - curve.y);
        if (gap < bestGap) { bestGap = gap; best = y; }
      }
      if (best === null) continue;
      taken.add(best);
      curve.points.push([s, best]);
      curve.y = best;
      curve.last = s;
    }
    for (const y of peaksPerStrip[s]) {
      if (taken.has(y)) continue;
      curves.push({ points: [[s, y]], y, last: s });
    }
  }
  // A staff line crosses most of the page; a beam, a slur or a pencil mark does
  // not. What survives is sampled to one y per strip.
  return curves
    .filter((c) => c.points.length >= peaksPerStrip.length * 0.45)
    .map((c) => {
      const at = new Float32Array(peaksPerStrip.length);
      let k = 0;
      for (let s = 0; s < at.length; s++) {
        while (k + 1 < c.points.length && c.points[k + 1][0] <= s) k++;
        const [sa, ya] = c.points[k];
        const next = c.points[k + 1];
        at[s] = next ? ya + (next[1] - ya) * ((s - sa) / (next[0] - sa)) : ya;
      }
      return { at, mid: at[Math.floor(at.length / 2)] };
    })
    .sort((a, b) => a.mid - b.mid);
}

function groupStaves(lines, pitch) {
  const staves = [];
  for (let i = 0; i + 4 < lines.length; i++) {
    const five = lines.slice(i, i + 5);
    const gaps = five.slice(1).map((l, k) => l.mid - five[k].mid);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (Math.abs(mean - pitch) > pitch * 0.35) continue;
    if (!gaps.every((g) => Math.abs(g - mean) < mean * 0.3)) continue;
    staves.push({ lines: five, space: mean });
    i += 4;
  }
  return staves;
}

// A barline is a column of ink that spans the stave from the top line to the
// bottom one — and nothing else on a single-staff part does that. Thick columns
// (a final double bar, a repeat) come out as one barline, which is right.
function findBars(ink, w, h, staff, stripW, space) {
  const lineY = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  const columns = [];
  for (let x = 0; x < w; x++) {
    const top = Math.round(lineY(0, x));
    const bottom = Math.round(lineY(4, x));
    if (bottom <= top) continue;
    let filled = 0;
    for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) filled++;
    if (filled / (bottom - top + 1) > 0.88) columns.push(x);
  }
  const bars = [];
  for (const x of columns) {
    const last = bars.at(-1);
    if (last && x - last.at(-1) <= space * 1.2) last.push(x);
    else bars.push([x]);
  }
  return bars.map((group) => group.reduce((a, b) => a + b, 0) / group.length);
}

// Noteheads by SHAPE, not by connected components. A beamed page fuses heads,
// stems and beams into one blob per group — flood fill returns the pencilled
// fingerings, which is exactly the wrong thing to find. A notehead is instead a
// solid ellipse about a staff space tall and half again as wide, with white
// above and below it; a beam is thinner, a stem far narrower, a slur thinner
// still.
function findHeads(ink, w, h, staff, space) {
  const hw = Math.max(2, Math.round(space * 0.62));
  const hh = Math.max(2, Math.round(space * 0.45));
  const inside = [];
  for (let dy = -hh; dy <= hh; dy++) {
    for (let dx = -hw; dx <= hw; dx++) {
      if ((dx / hw) ** 2 + (dy / hh) ** 2 <= 1) inside.push([dx, dy]);
    }
  }
  const ring = [];
  for (let dx = -hw; dx <= hw; dx += 2) {
    ring.push([dx, -hh - Math.round(space * 0.5)]);
    ring.push([dx, hh + Math.round(space * 0.5)]);
  }
  const reach = space * 4.5;
  const top = Math.max(hh + 1, Math.round(staff.lines[0].mid - reach));
  const bottom = Math.min(h - hh - 2, Math.round(staff.lines[4].mid + reach));
  const scored = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = hw + 1; x < w - hw - 1; x++) {
      if (!ink[y * w + x]) continue;
      let filled = 0;
      for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
      const fill = filled / inside.length;
      if (fill < 0.86) continue;
      let clear = 0;
      for (const [dx, dy] of ring) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || !ink[yy * w + x + dx]) clear++;
      }
      const open = clear / ring.length;
      if (open < 0.45) continue;
      scored.push({ x, y, score: fill + open });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const point of scored) {
    if (kept.some((k) => Math.abs(k.x - point.x) < space * 1.1
      && Math.abs(k.y - point.y) < space * 0.9)) continue;
    kept.push(point);
  }
  return kept.sort((a, b) => a.x - b.x);
}

// The whole reading, normalised. `source` is anything drawImage accepts.
export function readPage(source, naturalWidth, naturalHeight) {
  const w = Math.min(WORK_WIDTH, naturalWidth);
  const h = Math.round(naturalHeight * (w / naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);

  const gray = toGray(canvas);
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;

  const { thickness, space, pitch } = pageScale(ink, w, h);
  if (!(space > 2 && space < 40)) return null;

  const stripW = Math.max(1, Math.floor(w / STRIPS));
  const peaks = [];
  for (let s = 0; s < STRIPS; s++) peaks.push(stripPeaks(ink, w, h, s, stripW, thickness));
  const lines = trackLines(peaks, pitch);
  const staves = groupStaves(lines, pitch);
  if (staves.length === 0) return null;

  const out = staves.map((staff) => {
    const bars = findBars(ink, w, h, staff, stripW, space);
    const heads = findHeads(ink, w, h, staff, staff.space);
    return {
      // the five lines, sampled across the page and normalised
      lines: staff.lines.map((line) => [...line.at].map((y) => y / h)),
      space: staff.space / h,
      top: (staff.lines[0].mid - staff.space * 4.5) / h,
      bottom: (staff.lines[4].mid + staff.space * 4.5) / h,
      bars: bars.map((x) => x / w),
      heads: heads.map((head) => ({ x: head.x / w, y: head.y / h })),
    };
  });

  return { staves: out, strips: STRIPS, space: space / h };
}

// Every notehead on a page, in reading order, with the bar it belongs to.
export function notesInOrder(page) {
  const notes = [];
  for (const [staffIndex, staff] of (page?.staves ?? []).entries()) {
    for (const head of staff.heads) {
      // which bar of this stave it falls in
      let bar = 0;
      for (const x of staff.bars) if (head.x > x) bar++;
      notes.push({ staff: staffIndex, bar, x: head.x, y: head.y });
    }
  }
  return notes;
}
