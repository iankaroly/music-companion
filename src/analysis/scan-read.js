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

import { beamLayer, readValues } from './scan-stems.js';
import { clefFeatures, classifyClef } from './scan-clef.js';

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

// Link the per-strip combs across the page into staves.
//
// A stave moves slowly: a photographed page sags a few pixels from edge to
// edge, never a few pixels from one strip to the next. So each curve claims the
// nearest comb in the next strip, and is allowed to go missing for three strips
// before it is given up on — a beamed run can hide a stave's lines for that
// long, and the curve should survive it rather than start again as a second
// stave a third of the way across.
//
// Crossing half the page is what a stave has to do that a chance answer in one
// corner does not. Gaps are then filled by interpolating between the strips
// that did answer, so every stave has a value everywhere and nothing
// downstream has to ask whether this strip was measured or inferred.
export function trackCombs(perStrip, pitch, { drift = 0.6, cross = 0.5 } = {}) {
  const strips = perStrip.length;
  const curves = [];
  for (let s = 0; s < strips; s++) {
    const taken = new Set();
    for (const curve of curves) {
      if (curve.last < s - 3) continue;
      let best = null;
      let gap = Math.max(2, pitch * drift);
      for (const c of perStrip[s]) {
        if (taken.has(c)) continue;
        const d = Math.abs(c.y0 - curve.y0);
        if (d < gap) { gap = d; best = c; }
      }
      if (!best) continue;
      taken.add(best);
      curve.points.push([s, best.y0, best.step]);
      curve.y0 = best.y0;
      curve.last = s;
    }
    for (const c of perStrip[s]) {
      if (taken.has(c)) continue;
      curves.push({ points: [[s, c.y0, c.step]], y0: c.y0, last: s });
    }
  }
  return curves
    .filter((c) => c.points.length >= strips * cross)
    .map((c) => {
      const y0 = new Float32Array(strips);
      const step = new Float32Array(strips);
      let k = 0;
      for (let s = 0; s < strips; s++) {
        while (k + 1 < c.points.length && c.points[k + 1][0] <= s) k++;
        const [sa, ya, sta] = c.points[k];
        const next = c.points[k + 1];
        // Clamped, so a stave is never EXTRAPOLATED past the strips that
        // actually measured it.
        //
        // Before this, a strip to the left of the first measured point got a
        // negative t and the line was run backwards off the end of its own
        // evidence. That is the left margin of the page — which is precisely
        // where the clef is drawn, so the one region the model was inventing was
        // the one region it would be read in. On a photograph of the Bärenreiter
        // Bach the fitted lines sat right through the body of every system and a
        // space and a half out at the clef, and every clef there read tenor.
        //
        // Held flat instead: outside the evidence a stave keeps the height it
        // last had. A page bends, and it does not bend in the margin where there
        // is nothing printed to bend.
        const t = next ? Math.max(0, Math.min(1, (s - sa) / (next[0] - sa))) : 0;
        y0[s] = next ? ya + (next[1] - ya) * t : ya;
        step[s] = next ? sta + (next[2] - sta) * t : sta;
      }
      return { y0, step };
    })
    .sort((a, b) => a.y0[0] - b.y0[0]);
}

// The page has a rhythm; use it.
//
// Systems on a printed page are evenly spaced, so the staves that were found
// say where the ones that were missed must be. A PREDICTED position is then
// accepted on far weaker evidence than an unprompted one — which is the whole
// point: the shadow at the foot of a photographed page costs a system its
// score, not its existence. On the page this was built against it is what
// turned seven systems into ten.
//
// The weak threshold is safe only because the position was predicted. Nothing
// here can invent a stave in a blank margin: a prediction must still find some
// comb response in half the strips it crosses.
export function fillMissedStaves(staves, profiles, pitch, { votes = 0.5, floor = 0.05 } = {}) {
  if (staves.length < 3) return staves;      // two points are not a rhythm
  const strips = profiles.length;
  const height = profiles[0].length;
  const middle = Math.floor(strips / 2);
  const tops = staves.map((s) => s.y0[middle]);
  // The LOWER median, and that is the whole trick: a missed system doubles the
  // gap on either side of where it should have been, and nothing ever halves
  // one. Taking the upper median of [160, 320] would adopt the hole as the
  // page's spacing and then find nothing missing at all.
  const gaps = tops.slice(1).map((y, i) => y - tops[i]).sort((a, b) => a - b);
  const gap = gaps[Math.floor((gaps.length - 1) / 2)];

  const wanted = [];
  for (let y = tops[0] - gap; y > pitch; y -= gap) wanted.push(y);
  for (let i = 0; i + 1 < tops.length; i++) {
    const span = tops[i + 1] - tops[i];
    const n = Math.round(span / gap);
    for (let k = 1; k < n; k++) wanted.push(tops[i] + (span * k) / n);
  }
  for (let y = tops.at(-1) + gap; y + 5 * pitch < height; y += gap) wanted.push(y);

  const out = [...staves];
  for (const want of wanted) {
    if (out.some((s) => Math.abs(s.y0[middle] - want) < gap * 0.4)) continue;
    const y0 = new Float32Array(strips);
    const step = new Float32Array(strips);
    let answered = 0;
    for (let s = 0; s < strips; s++) {
      let best = -1;
      let bestY = want;
      let bestStep = pitch;
      for (let y = Math.round(want - gap * 0.35); y <= Math.round(want + gap * 0.35); y++) {
        for (let st = pitch - 1.5; st <= pitch + 1.5; st += 0.25) {
          const v = combScore(profiles[s], y, st);
          if (v > best) { best = v; bestY = y; bestStep = st; }
        }
      }
      y0[s] = bestY;
      step[s] = bestStep;
      if (best > floor) answered++;
    }
    if (answered < strips * votes) continue;
    // A stave does not jump about. The best answer in each strip is pulled
    // toward its neighbours before the lines are drawn from it, so a strip that
    // happened to like a slur keeps the stave straight anyway.
    const smooth = new Float32Array(strips);
    for (let s = 0; s < strips; s++) {
      let sum = 0;
      let n = 0;
      for (let k = Math.max(0, s - 2); k <= Math.min(strips - 1, s + 2); k++) { sum += y0[k]; n++; }
      smooth[s] = sum / n;
    }
    out.push({ y0: smooth, step });
  }
  return out.sort((a, b) => a.y0[0] - b.y0[0]);
}

// Beams, erased before noteheads are hunted.
//
// A beamed page fuses heads, stems and beams into one shape, and the head
// finder scores any ellipse-sized patch of solid ink — so on a page of
// sixteenths it reports a chain of heads riding along every beam. On the page
// this was built against that is 748 detections where there are about 320
// notes.
//
// A beam is a long horizontal bar and a notehead is not: a head is at most a
// space and a half wide. But a fixed thickness cut cannot separate them, since
// a head TOUCHING a beam is one connected shape with it — cut thin and the
// beams stay (this edition's double beams merge into one bar at photograph
// resolution), cut thick and the heads go with them. So the beam measures
// itself: its thickness is constant along its length, and where a head joins it
// the column is far taller than that. Erase to the beam's own median, spare the
// bulge.
//
// Slurs go too, being longer and thinner still, and they were noise.
export function beamMask(ink, w, h, space, { run = 2.4, bulge = 1.8 } = {}) {
  const body = new Uint8Array(ink);
  const runFloor = Math.max(3, Math.round(space * run));
  // The contiguous ink this pixel belongs to, up and down its own column.
  const extent = (x, y) => {
    let top = y;
    while (top > 0 && body[(top - 1) * w + x]) top--;
    let bottom = y;
    while (bottom < h - 1 && body[(bottom + 1) * w + x]) bottom++;
    return { top, bottom, tall: bottom - top + 1 };
  };
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!body[y * w + x]) { x++; continue; }
      let end = x;
      while (end < w && body[y * w + end]) end++;
      if (end - x >= runFloor) {
        const talls = [];
        for (let k = x; k < end; k++) talls.push(extent(k, y).tall);
        talls.sort((a, b) => a - b);
        const median = talls[Math.floor(talls.length / 2)];
        // What the beam is on its OWN, measured where nothing is attached to it.
        //
        // `bulge` asks whether a column is taller than the beam by enough to be
        // a notehead joining it, and it was asking that against the median — but
        // half of a beamed group's columns HAVE something joining them. Stems at
        // every note, heads at the ends, a second beam under the first. The
        // median is therefore already inflated by the very thing being detected,
        // so the bar for "taller than the beam" sits too high, the join is not
        // recognised, and the beam is erased straight through the notehead.
        //
        // The low quartile is the beam where it is only itself. Same test, honest
        // baseline. (The median still gates the line below: that decision is
        // about whether this run is a beam at all, and for that the whole run's
        // typical height is the right question.)
        const base = talls[Math.floor((talls.length - 1) * 0.25)];
        // Ink taller than a notehead everywhere along a long run is not a beam
        // at all — it is a black chord, a bracket, or the edge of the page.
        if (median <= space * 1.4) {
          for (let k = x; k < end; k++) {
            const { top, bottom, tall } = extent(k, y);
            if (tall > base * bulge) continue;    // a head joins here
            for (let yy = top; yy <= bottom; yy++) body[yy * w + k] = 0;
          }
        }
      }
      x = end;
    }
  }
  return body;
}

// A tracked stave, in the shape the bar and head finders take: five lines, each
// sampled once per strip, plus the midpoint they use to reach for ledger lines
// above and below.
// A stave BENDS. It does not wave.
//
// The tracker takes the best comb in each strip and interpolates across the
// strips that had none. Where a strip's best answer is not the stave — a beam
// lying across it, a slur, the thick of a phrase mark — the curve steps sideways
// and the interpolation smooths that step into the shape of a real bend. The
// result reads as a stave everywhere and is a stave nowhere.
//
// It is visible on a photograph of the Bärenreiter Bach: on the last three
// systems the tracked lines weave across the printed ones instead of following
// them, and those are precisely the systems whose clef comes back wrong. Nothing
// downstream can survive it — the clef is measured in spaces from the top line,
// the step of every notehead is measured from the bottom one.
//
// A page curls in ONE direction. Whatever a book does between the gutter and the
// fore-edge, it does smoothly, so two coefficients and a curve describe it and a
// third would only be fitting the noise. Anything a quadratic cannot follow is
// not the stave, so it is dropped and the curve refitted without it.
function fitCurve(values, tolerance) {
  const n = values.length;
  if (n < 4) return Float32Array.from(values);
  const solve = (use) => {
    // Normal equations for a + b·s + c·s², built over the strips still in play.
    let n0 = 0; let s1 = 0; let s2 = 0; let s3 = 0; let s4 = 0;
    let v0 = 0; let v1 = 0; let v2 = 0;
    for (let s = 0; s < n; s++) {
      if (!use[s]) continue;
      const v = values[s];
      n0 += 1; s1 += s; s2 += s * s; s3 += s ** 3; s4 += s ** 4;
      v0 += v; v1 += s * v; v2 += s * s * v;
    }
    if (n0 < 4) return null;
    // Gaussian elimination on the 3×3, written out because it is a 3×3.
    const m = [[n0, s1, s2, v0], [s1, s2, s3, v1], [s2, s3, s4, v2]];
    for (let i = 0; i < 3; i++) {
      let pivot = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
      if (Math.abs(m[pivot][i]) < 1e-9) return null;
      [m[i], m[pivot]] = [m[pivot], m[i]];
      for (let r = 0; r < 3; r++) {
        if (r === i) continue;
        const f = m[r][i] / m[i][i];
        for (let k = i; k < 4; k++) m[r][k] -= f * m[i][k];
      }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  };

  const use = new Array(n).fill(true);
  let coefficients = solve(use);
  if (!coefficients) return Float32Array.from(values);
  // One rejection pass. A second buys nothing on a page that has any stave at
  // all, and on a page that has none it would happily fit four points.
  let dropped = false;
  for (let s = 0; s < n; s++) {
    const [a, b, c] = coefficients;
    if (Math.abs(values[s] - (a + b * s + c * s * s)) > tolerance) { use[s] = false; dropped = true; }
  }
  if (dropped) coefficients = solve(use) ?? coefficients;
  const [a, b, c] = coefficients;
  const out = new Float32Array(n);
  for (let s = 0; s < n; s++) out[s] = a + b * s + c * s * s;
  return out;
}

export function stavesToLines(staves, strips) {
  return staves.map(({ y0, step }) => {
    // The spacing is smoothed too, and harder. A stave's lines do not get
    // further apart across a page by more than the perspective of a curling
    // sheet, so a strip claiming a different spacing is a strip that found
    // something else.
    let raw = 0;
    for (let s = 0; s < strips; s++) raw += step[s];
    const nominal = raw / strips;
    const smoothStep = fitCurve(step, Math.max(0.5, nominal * 0.12));
    const smoothY0 = fitCurve(y0, Math.max(1.5, nominal * 0.9));
    const lines = [0, 1, 2, 3, 4].map((index) => {
      const at = new Float32Array(strips);
      for (let s = 0; s < strips; s++) at[s] = smoothY0[s] + index * smoothStep[s];
      return { at, mid: at[Math.floor(strips / 2)] };
    });
    let sum = 0;
    for (let s = 0; s < strips; s++) sum += smoothStep[s];
    return { lines, space: sum / strips };
  });
}

// The clef zone: the band just right of a stave's opening barline.
//
// Sampled here rather than in scan-clef.js because this is where the ink and
// the stave's own geometry are, and a photographed page sags — so the zone has
// to follow the line under it rather than sit at a fixed height. What comes back
// is one value per row, the fraction of the band inked, running from CLEF_MARGIN
// spaces above the top line to the same below the bottom one, which is the shape
// scan-clef.js measures extents from.
const CLEF_MARGIN = 3;

// Where a stave's lines actually begin.
//
// The clef zone used to start at the stave's first BARLINE, which sounded right
// and is wrong on almost every printed page: engravers do not draw a barline at
// the start of a system. On a real photograph of the Bärenreiter Bach the first
// barline sits at 0.5 across the page — it is the barline in the MIDDLE — so
// the clef was being read off a handful of semiquavers halfway through the bar.
// It read treble, at confidence 1.00, on a page that is bass clef throughout.
// One system in ten came out right, and only because it found no barline at all
// and fell back to the left edge, which is where the clef was all along.
//
// So the stave is asked where it starts: the first column at which most of its
// five lines are inked, which is the left end of the stave and the thing the
// clef is drawn against.
export function staveStart(ink, w, h, staff, stripW) {
  const lineY = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  // Only the first third is searched: a stave that has not started by then has
  // not been found, and hunting further right risks calling the music the start.
  const limit = Math.floor(w / 3);
  let run = 0;
  for (let x = 0; x < limit; x++) {
    let lit = 0;
    for (let k = 0; k < 5; k++) {
      const y = Math.round(lineY(k, x));
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy >= 0 && y + dy < h && ink[(y + dy) * w + x]) { lit++; break; }
      }
    }
    // Four of five, because one faint line is what a photographed page does and
    // the comb that found this stave was built around exactly that.
    // Three of five, not four.
    //
    // At the left edge of a photographed page one line in five is routinely
    // lost to the shadow — that is the whole reason the stave is found by a comb
    // rather than by hunting lines one at a time — and asking for four here
    // asked for more than the tracker itself asks for.
    if (lit >= 3) {
      run++;
      // Held for half a space before it counts, so a stray mark in the margin
      // cannot start the stave early.
      if (run >= Math.max(2, Math.round(staff.space * 0.5))) {
        return x - run + 1;
      }
    } else {
      run = 0;
    }
  }
  // NOT zero.
  //
  // Returning zero when the stave could not be found put the clef zone at the
  // left edge of the IMAGE — the page margin — and the classifier then read
  // whatever noise was there and reported it at 0.97 confidence. Measured on a
  // photograph of the Bärenreiter Bach: the systems that read their clef right
  // sampled at x = 39, the ones that read it wrong sampled at x = 3, every time.
  //
  // Six confident wrong answers is worse than six refusals, and a refusal is
  // what not knowing where the stave starts actually means.
  return null;
}

export function clefColumn(ink, w, h, staff, stripW, space, fromX) {
  const lineY = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  // Wide enough for a clef and no wider. Segmenting the clef by its own ink was
  // tried instead — count non-staff ink per column, stop at the first gap — and
  // it read WORSE on a real page (one system in ten against four), because a
  // bass clef's dots and the key signature that follows do not separate by a
  // clean gap at photograph resolution. Kept simple until there is a real
  // corpus to tune against; see the note in the plan about what this costs.
  const across = Math.max(3, Math.round(space * 3.6));
  const x0 = Math.max(0, Math.round(fromX));
  const x1 = Math.min(w - 1, x0 + across);
  if (x1 <= x0) return null;
  const mid = Math.round((x0 + x1) / 2);
  // Measured over a wide window, not over the clef zone alone: a comb wants five
  // clean lines and the clef zone is the one place on the stave guaranteed to
  // have something else drawn in it.
  const top = lineY(0, mid);
  const rows = Math.round(space * (4 + CLEF_MARGIN * 2));
  const out = new Float32Array(rows);
  const wide = x1 - x0 + 1;
  for (let r = 0; r < rows; r++) {
    const y = Math.round(top - CLEF_MARGIN * space + r);
    if (y < 0 || y >= h) continue;
    let inked = 0;
    for (let x = x0; x <= x1; x++) if (ink[y * w + x]) inked++;
    out[r] = inked / wide;
  }
  return out;
}

// A barline is a column of ink that spans the stave from the top line to the
// bottom one — and nothing else on a single-staff part does that. Thick columns
// (a final double bar, a repeat) come out as one barline, which is right.
function findBars(ink, w, h, staff, stripW, space) {
  const lineY = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  const columns = [];
  // How wide is too wide for something a barline is touching.
  const wide = Math.max(3, Math.round(space * 1.2));
  for (let x = 0; x < w; x++) {
    const top = Math.round(lineY(0, x));
    const bottom = Math.round(lineY(4, x));
    if (bottom <= top) continue;
    let filled = 0;
    for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) filled++;
    if (filled / (bottom - top + 1) <= 0.88) continue;

    // A full column is not a barline if something is hanging off it.
    //
    // This test was the whole of it, and on a photograph of anything faster
    // than crotchets it is wrong far more often than right: a stem with a
    // notehead at one end and a beam at the other fills a column from the top
    // line to the bottom just as well as a barline does. A page of twenty bars
    // came back with a hundred and fifty-three barlines, almost all of them
    // stems, and every bar-shaped thing downstream — the timing, the note
    // values, the grouping — was built on that.
    //
    // What tells them apart is what they touch. A barline touches the five
    // staff lines and nothing else: it is thin for its whole height. A stem
    // touches a notehead, or a beam, or both, and those are WIDE. So the
    // column is walked and asked how much of it is attached to something,
    // ignoring the staff lines themselves, which cross everything.
    const lines = [0, 1, 2, 3, 4].map((k) => lineY(k, x));
    let looked = 0;
    let attached = 0;
    for (let y = top; y <= bottom; y++) {
      if (y < 0 || y >= h) continue;
      if (lines.some((line) => Math.abs(y - line) <= Math.max(1, space * 0.22))) continue;
      looked += 1;
      let across = 1;
      for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
      for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
      if (across >= wide) attached += 1;
    }
    if (looked > 0 && attached / looked > 0.12) continue;

    // And a barline STOPS at the stave.
    //
    // What the test above leaves is the leading stem of a beamed group: long,
    // vertical, nothing wide touching it over most of its length. But a stem is
    // going somewhere — up to a beam above the stave, or down to a notehead
    // below it — and a barline is not. It is drawn between the top line and the
    // bottom line and it ends there.
    const over = Math.round(space * 1.4);
    let above = 0;
    let below = 0;
    for (let k = 1; k <= over; k++) {
      const up = top - k;
      const down = bottom + k;
      if (up >= 0 && ink[up * w + x]) above += 1;
      if (down < h && ink[down * w + x]) below += 1;
    }
    // A little overhang is how a barline is drawn by hand and printed by a
    // press; half a staff space of it either way is not a stem.
    const overhang = Math.max(1, Math.round(space * 0.5));
    if (above > overhang || below > overhang) continue;
    columns.push(x);
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
function findHeads(ink, w, h, staff, space, gray, background) {
  const hw = Math.max(2, Math.round(space * 0.62));
  const hh = Math.max(2, Math.round(space * 0.45));
  const inside = [];
  // …and the two halves of that same ellipse, for the OTHER kind of notehead.
  //
  // A minim and a semibreve are rings. The test below asks for an ellipse that
  // is 86% inked, which a ring is not — it is ink around a hole — so every
  // white notehead on the page scored zero and was never a candidate. On a
  // slow movement that is not a few notes missed, it is ALL of them: a page of
  // minims read as a page with no notes on it, and a take against it paired
  // with nothing.
  //
  // So a head is now either solid or a ring: ink around the rim, paper in the
  // middle. The rim is generous (the stroke of an engraved head is thin and a
  // photograph blurs it) and the middle is strict, because "dark rim, dark
  // centre" is a solid head and already has a test of its own.
  const rim = [];
  const core = [];
  for (let dy = -hh; dy <= hh; dy++) {
    for (let dx = -hw; dx <= hw; dx++) {
      const d = (dx / hw) ** 2 + (dy / hh) ** 2;
      if (d <= 1) inside.push([dx, dy]);
      // The band the DRAWN LINE of a ring actually occupies, which straddles
      // the ellipse rather than sitting inside it: a stroke is centred on the
      // path, so half of it lies outside d = 1. Sampling only within the head
      // meant most of the band was the paper inside the ring, the rim scored
      // about a third, and no minim ever passed.
      if (d >= 0.62 && d <= 1.3) rim.push([dx, dy]);
      if (d <= 0.25) core.push([dx, dy]);
    }
  }
  const ring = [];
  for (let dx = -hw; dx <= hw; dx += 2) {
    ring.push([dx, -hh - Math.round(space * 0.5)]);
    ring.push([dx, hh + Math.round(space * 0.5)]);
  }
  // How far off the stave a notehead is still looked for.
  //
  // Four and a half spaces reaches step 17 and stops, and that is a real ceiling
  // rather than a safe margin: on a photograph of the Bach the measured steps
  // ran [-8, 17] — hard against it at the top, which is what a truncation looks
  // like from the outside. A cello part in bass clef climbs past it constantly,
  // and every note above D5 was simply not there.
  //
  // Seven spaces is four ledger lines, which is as high as this repertoire goes
  // before an editor gives up and changes clef. It costs more of the margin
  // being searched, and the margin is where the pencil lives — so what stops a
  // bowing mark being read as a note is the head tests themselves, not the
  // refusal to look.
  const reach = space * 7;
  const top = Math.max(hh + 1, Math.round(staff.lines[0].mid - reach));
  const bottom = Math.min(h - hh - 2, Math.round(staff.lines[4].mid + reach));
  const scored = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = hw + 1; x < w - hw - 1; x++) {
      // Where a head could be centred.
      //
      // This asked only whether the pixel itself was inked, which is the one
      // thing that is never true of a ring: the middle of a minim is paper.
      // So a hollow head was rejected before any test of it ran, and no
      // widening of those tests could ever have found one.
      //
      // Two more lookups let a clear pixel stay in the running — ink to the
      // left AND to the right at the head's own width, which is what the
      // inside of a ring looks like and what almost nothing else does. It is
      // two array reads on the pixels that used to be skipped outright, and it
      // is the whole of the extra cost.
      const solidCentre = ink[y * w + x];
      // Looked for at TWO radii each side, not one.
      //
      // The single probe sat at exactly ±hw — the notehead's own half-width,
      // which is to say exactly on the ellipse the ring is drawn along. That is
      // the one place the answer depends on where a two-pixel stroke happens to
      // fall rather than on whether there is a ring there at all: half a pixel
      // out and the probe reads paper on a perfectly good minim, and the
      // candidate is dropped before any test of it runs. It is why `minims`
      // scored 64% on a CLEAN page — the worst number in the suite and the one
      // that could not be blamed on the camera.
      //
      // An inner probe at 78% of the radius sits inside the stroke instead of on
      // it. Ink at EITHER radius, on BOTH sides, is a ring.
      const inner = Math.max(1, Math.round(hw * 0.78));
      const leftInk = ink[y * w + x - hw] || ink[y * w + x - inner];
      const rightInk = ink[y * w + x + hw] || ink[y * w + x + inner];
      if (!solidCentre && !(leftInk && rightInk)) continue;
      let filled = 0;
      for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
      const fill = filled / inside.length;
      // Solid, or a ring. A ring wants ink round the rim and paper inside it;
      // the centre test is what keeps this from accepting a solid head twice
      // and, more importantly, from accepting the inside of a slur or the gap
      // in a beam, which are dark all through or light all through.
      let solid = fill >= 0.86;
      let hollow = false;
      if (!solid && fill >= 0.3 && fill <= 0.82) {
        let rimInk = 0;
        for (const [dx, dy] of rim) rimInk += ink[(y + dy) * w + x + dx];
        let coreInk = 0;
        for (const [dx, dy] of core) coreInk += ink[(y + dy) * w + x + dx];
        // The centre is allowed to be a little inky, because half the minims
        // on any page sit ON a line and that line runs straight through the
        // middle of them. A staff line is thin, so it costs the core a small
        // fraction; a solid head fills it completely and is caught by the
        // solid test long before this one.
        // AND THE MIDDLE MUST BE PAPER, not merely too pale to binarise.
        //
        // Ink is a threshold on how much darker than the local background a
        // pixel is, and everything below that threshold is "not ink" whether it
        // is white paper or the faded middle of a solid notehead. On a
        // photograph a great many solid heads print grey in the middle — the
        // lamp, the blur, the downscale — and every one of them satisfied a
        // core test written against the binarised image. Thirty-two of the four
        // hundred and five notes on the page this was built for were called
        // minims, which makes each of them two beats instead of a quarter, and
        // no bar containing one can add up.
        //
        // The grey the threshold was computed from is still to hand, so the
        // question can be asked properly: is the middle of this head as light
        // as the paper around it? For a ring it is, because it IS the paper.
        let paper = 0;
        for (const [dx, dy] of core) {
          const at = (y + dy) * w + x + dx;
          if (gray[at] >= background[at] - 6) paper += 1;
        }
        const ring = (rimInk / rim.length) >= 0.68 && (coreInk / core.length) <= 0.42;
        hollow = ring && (paper / core.length) >= 0.7;
        // A ring whose middle is grey rather than white is not a ring at all —
        // it is a solid head that printed faintly, and it must be taken as one
        // rather than thrown away. Rejecting these outright cost twenty-four of
        // the real page's four hundred and five noteheads: better than calling
        // them minims, but they are neither missing nor hollow, they are just
        // pale.
        if (ring && !hollow) solid = true;
      }
      if (!solid && !hollow) continue;
      // Wide ink is a beam, whatever shape a patch of it happens to be.
      //
      // This is the one that a photograph teaches you and a drawn page never
      // will. beamMask takes out a beam by finding a long horizontal run of
      // ink no taller than a notehead — which works for ONE beam and fails for
      // a stack of two or three, because a stack is exactly a notehead tall.
      // What survives is a long black bar, and any patch of it is a perfectly
      // good solid ellipse. On bars of semiquavers that put a ring on the beam
      // every few pixels: a row of them marching along above the notes, and
      // more marks than the page has notes.
      //
      // A notehead is about a staff space and a half across and then it stops.
      // Ink that carries on well past that, on the head's own middle row, is
      // something the head is attached to rather than the head.
      let across = 1;
      for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
      for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
      if (across > space * 2.6) continue;
      let clear = 0;
      for (const [dx, dy] of ring) {
        const yy = y + dy;
        if (yy < 0 || yy >= h || !ink[yy * w + x + dx]) clear++;
      }
      const open = clear / ring.length;
      if (open < 0.45) continue;
      // A solid head keeps its old score exactly, so nothing about which
      // solid candidate wins a cluster changes. A ring is scored by how well
      // it IS a ring rather than by how dark it is, or a fat one would always
      // lose to the smudge beside it.
      const quality = solid ? fill : 0.86;
      scored.push({ x, y, score: quality + open, hollow });
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

// A comb locks onto the shadow gradient at the foot of a photographed page and
// reports a stave that is not there. Every photographed case in both benchmarks
// read seven staves where six were drawn, and the seventh carried no noteheads
// and no barlines while the real six carried eighty heads each. It cost nothing
// visible and everything countable: a phantom system inflates every recall
// denominator — the barline check read 86% where the six real systems had in
// fact found every barline — and it would renumber every bar after it.
//
// Heads OR bars, not heads AND bars. A system of nothing but rests has no
// noteheads and is still a system, and dropping it would lose the barlines that
// carry the count past it.
export function realStaff(staff) {
  return ((staff?.heads?.length ?? 0) > 0) || ((staff?.bars?.length ?? 0) > 0);
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
  // One profile per strip: for each row, the fraction of that strip's columns
  // that are inked. Everything above works on these and never on the image.
  const profiles = [];
  for (let s = 0; s < STRIPS; s++) {
    const x0 = s * stripW;
    const x1 = Math.min(w, x0 + stripW);
    const p = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) n += ink[y * w + x];
      p[y] = n / (x1 - x0);
    }
    profiles.push(p);
  }
  const tracked = trackCombs(profiles.map((p) => combPeaks(p, pitch)), pitch);
  const staves = stavesToLines(fillMissedStaves(tracked, profiles, pitch), STRIPS);
  if (staves.length === 0) return null;

  // Heads are hunted on the cleaned page; bars stay on the raw one. A barline
  // is a full-height column and beam removal has no business nibbling at it.
  const body = beamMask(ink, w, h, space);
  // The beams, as their own layer: what beamMask took out. Finding them was
  // already done — this is only the difference between the page and the page
  // with the beams removed — and it is what says a quaver from a semiquaver.
  const beams = beamLayer(ink, body);

  // Bars and heads for every stave first, and the note values only afterwards.
  //
  // The values cannot be read stave by stave, because counting beams needs to
  // know how this edition draws them — how thick, how far apart — and one
  // stave of twenty notes is too small a sample to measure that off a bad
  // photograph. Read together, the whole page measures its own engraving once.
  // See readValues.
  const found = staves.map((staff) => ({
    staff,
    bars: findBars(ink, w, h, staff, stripW, space),
    heads: findHeads(body, w, h, staff, staff.space, gray, background),
    space: staff.space,
    // Where this stave's five lines sit under any given x — a stem crosses
    // them and they must not be counted as the beams it is looking for.
    lineAt: (x) => {
      const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((x / w) * STRIPS)));
      return staff.lines.map((line) => line.at[strip]);
    },
  }));
  const perStaff = readValues(ink, beams, w, h, found);

  // Where the staves start, decided for the PAGE and not for each system.
  //
  // Systems on a printed page are left-aligned — the same engraver set them all
  // to the same margin — so "where does this stave begin" has one answer, and
  // asking it ten times gets ten answers of which several are wrong. Measured on
  // a photograph of the Bärenreiter Bach the per-system answers came back 109,
  // 360, 88, 47, 38, 171, 137, 53, none, 77, where the truth is around fifty:
  // the systems that landed near it read their clef correctly and the rest read
  // the music, or the margin, and reported it at 0.97 confidence.
  //
  // A LOW percentile of the answers, not the median.
  //
  // The errors only go one way. staveStart walks left to right and stops at the
  // first sustained run of staff lines, so a system it reads correctly gives the
  // margin and a system it misreads gives something further RIGHT — it has run
  // past the clef into the music. The nine answers on that page sorted to
  // 38, 47, 53, 77, 88, 109, 137, 171, 360 against a truth near fifty: the
  // median lands on 88 and is wrong for everybody, the low quarter lands on 53.
  //
  // The same trick fillMissedStaves uses on the vertical — the page has a
  // rhythm, so use it — with the statistic chosen for which way the errors run.
  const starts = found
    .map(({ staff }) => staveStart(ink, w, h, staff, stripW))
    .filter((x) => x !== null)
    .sort((a, b) => a - b);
  const margin = starts.length
    ? starts[Math.floor((starts.length - 1) * 0.25)]
    : null;

  const out = found.map(({ staff, bars, heads }, staffIndex) => {
    const values = perStaff[staffIndex];
    // The clef, read from the paper rather than fitted from a recording.
    //
    // Measured just right of where the stave's LINES begin — not of its first
    // barline, which on a printed page is the one in the middle of the system.
    // See staveStart. Null when it cannot be told, and null must stay null: a
    // cello part is in bass clef most of the time, and assuming so is what
    // turns the other times into a page of confident verdicts a sixth out.
    const clefFrom = margin === null ? null : margin + staff.space * 0.25;
    const read = clefFrom === null
      ? { clef: null, confidence: 0 }
      : classifyClef(clefFeatures(
        clefColumn(ink, w, h, staff, stripW, staff.space, clefFrom), staff.space,
      ));
    return {
      clef: read.clef,
      clefConfidence: read.confidence,
      // Where it looked, so the answer can be checked rather than believed.
      //
      // Five ways of correcting this reading were tried and measured and all
      // five came to nothing. What none of them did was LOOK at the band being
      // sampled — every real bug on this page was found by drawing something on
      // top of it, and every dead end came from reasoning about what the code
      // probably does. The reader now reports its own clef zone so the next
      // question can be asked of a picture. Drawn by tools/reader-look.html.
      clefZone: clefFrom === null ? null : {
        x: clefFrom / w,
        w: Math.min(w - clefFrom, Math.max(3, Math.round(staff.space * 3.6))) / w,
      },
      // the five lines, sampled across the page and normalised
      lines: staff.lines.map((line) => [...line.at].map((y) => y / h)),
      space: staff.space / h,
      top: (staff.lines[0].mid - staff.space * 4.5) / h,
      bottom: (staff.lines[4].mid + staff.space * 4.5) / h,
      bars: bars.map((x) => x / w),
      // …and WHERE ON THE STAVE each one sits.
      //
      // Zero is the bottom line, one the space above it, two the next line up:
      // the note's position, counted in half staff-spaces, which is what a
      // notehead's height on the page actually means. Measured against the
      // bottom line UNDER THAT HEAD rather than the middle of the stave, so a
      // photograph of a page that curves — which is every photograph of a
      // bound part — does not tilt every step at the far end of the system.
      //
      // This is not a pitch and cannot become one here: a step turns into a
      // note only through the clef, the key signature and whatever accidental
      // stands in front of it, and none of those are read. What it IS good for
      // is shape. Two lines that rise and fall together are the same music
      // whatever clef they are written in, and that is enough to find where a
      // take begins — see analysis/scan-align.js.
      heads: heads.map((head, i) => {
        const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((head.x / w) * STRIPS)));
        const bottom = staff.lines[4].at[strip];
        return {
          x: head.x / w,
          y: head.y / h,
          step: Math.round((bottom - head.y) / (staff.space / 2)),
          // How long the note is, in crotchets — read from the head's own
          // shape, its stem and the beams crossing it. Whether to believe it
          // is a separate question with its own file.
          beats: values[i]?.beats ?? null,
          beams: values[i]?.beams ?? 0,
        };
      }),
    };
  });

  return { staves: out.filter(realStaff), strips: STRIPS, space: space / h };
}

// Every notehead on a page, in reading order, with the bar it belongs to.
export function notesInOrder(page) {
  const notes = [];
  for (const [staffIndex, staff] of (page?.staves ?? []).entries()) {
    for (const head of staff.heads) {
      // which bar of this stave it falls in
      let bar = 0;
      for (const x of staff.bars) if (head.x > x) bar++;
      // `step` comes with it: where on the stave the head sits, which is what
      // lets a take be found on the page rather than assumed to start at the
      // top of it. Dropping it here is how the whole alignment came out blind.
      notes.push({
        staff: staffIndex, bar, x: head.x, y: head.y, step: head.step,
        beats: head.beats, beams: head.beams,
        // Carried down from the stave, because a note's pitch is its position
        // AND the clef that names the lines it sits between — and by the time
        // anything downstream has a note it no longer has the stave.
        clef: staff.clef ?? null,
        clefConfidence: staff.clefConfidence ?? 0,
      });
    }
  }
  return notes;
}
