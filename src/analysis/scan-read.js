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
import {
  clefFeatures, classifyClef, midClefAt, midTrebleAt,
  MARGIN as CLEF_ABOVE, MARGIN_BELOW as CLEF_BELOW,
} from './scan-clef.js';
import {
  scanKeyBand, agreeKeyCount, agreeKeyReach, trimKeyBand, readKeySignature, agreeKey,
  agreeNoKey, bareKey,
} from './scan-key.js';
import { headPatch, headScore, headScoreMlp } from './head-model.js';
import { pitchOf } from './scan-notes.js';
import { accidentalFor, applyAccidentals, ACC_OFFSET } from './scan-accidental.js';

const WORK_WIDTH = 1400;   // enough detail for a staff space of ~9px
const STRIPS = 40;
// How good a comb curve is allowed to be in ABSOLUTE terms and still be a
// stave, whatever the crispest thing on the page reads. See trackCombs, which
// is the only caller and carries the measurement that fixed the value.
const STAVE_FLOOR = 0.45;

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
      curve.points.push([s, best.y0, best.step, best.score]);
      curve.y0 = best.y0;
      curve.last = s;
    }
    for (const c of perStrip[s]) {
      if (taken.has(c)) continue;
      curves.push({ points: [[s, c.y0, c.step, c.score]], y0: c.y0, last: s });
    }
  }
  // ONE STAVE, BROKEN INTO PIECES, IS STILL ONE STAVE.
  //
  // A curve claims the nearest comb in the next strip and gives up after three
  // strips without one. On a comfortable page that never happens — every stave
  // answers in all forty strips and this pass does nothing whatever. On a small
  // photograph it happens constantly: measured on the size sweep's `photo8`, a
  // page whose six staves stand at y = 100, 230, 359, 488, 617 and 746 in nearly
  // every strip, the comb slips a line here and there (the top stave reads 96,
  // 97, 98, 97, 93, 91, 90, 100, 109, 100, 100 …) and every slip larger than
  // `drift` starts a NEW curve. Six staves came back as thirty-odd fragments of
  // five to seven points each, not one of them long enough to survive the
  // crossing test, and `trackCombs` returned ZERO curves — `readPage` then
  // returned null and the page read as blank paper. That was the whole of the
  // reader's failure at a working staff space of six and eight.
  //
  // So fragments that CONTINUE one another are joined before the length test.
  // The bound is scale-free and it is safe for a reason that is worth writing
  // down: `combPeaks` already refuses to report two peaks within 4.2 pitches of
  // each other in the same strip, so two staves are never nearer than that, and
  // a fragment whose y agrees with another's to within a pitch and a half cannot
  // belong to a different stave — there is no other stave it could belong to.
  // Nothing here can invent a stave: a join only ever makes an existing curve
  // longer, and every point in it was measured in the strip it came from.
  //
  // No bound on HOW FAR APART in strips the two pieces may be, deliberately. A
  // stave runs the width of the page, so two pieces at the same height that do
  // not overlap in strips are the same printed line however wide the hole
  // between them is; and the hole is exactly what the crossing test is there to
  // punish, which it still does — a stave rebuilt from two short fragments is
  // still short, and is still thrown away.
  const joined = [];
  for (const c of curves) {
    let host = null;
    let nearest = pitch * 1.5;
    for (const m of joined) {
      if (m.points.at(-1)[0] >= c.points[0][0]) continue;   // they overlap: two staves
      const d = Math.abs(m.points.at(-1)[1] - c.points[0][1]);
      if (d < nearest) { nearest = d; host = m; }
    }
    if (host) host.points.push(...c.points);
    else joined.push(c);
  }

  // HOW FAR A CURVE HAS TO GET, asked of the page as well as carried.
  //
  // Half the strips is what a stave has to cross that a chance answer in one
  // corner does not, and on any page the reader currently reads well every stave
  // crosses all forty. The trouble is the page where nothing crosses twenty: on
  // a close-up — a phone held near two bars on a stand — the best curve on the
  // page reaches nineteen strips of forty, and half is then not a bar a stave
  // has to clear, it is a bar NO stave clears, and `readPage` returns null and
  // the page reads as blank paper.
  //
  // So the page's own longest curve gets a vote. The errors here run one way and
  // that is what makes the longest curve an honest yardstick: a real stave goes
  // missing in a strip — a beam, the gutter, a black chord — but nothing
  // produces a NON-stave answer in more strips than a real stave does, so the
  // longest thing on the page is the best evidence available about how far a
  // stave gets on this page. Three fifths of it is the bar.
  //
  // TAKEN AS THE LOWER OF THE TWO, deliberately. This can only ever LOOSEN the
  // test, never tighten it: on the three marked pages the longest curve is forty
  // and three fifths of that is twenty-four, so the old half-the-page rule is
  // the one that binds and nothing whatever changes. A rule that could also
  // tighten would be able to throw away a stave the reader finds today, and no
  // page here would show it.
  //
  // THE FALLBACK IS THE CONSTANT THAT WAS THERE — `strips * cross` — and it is
  // what binds on every page that works at all.
  //
  // `longest` IS TAKEN OVER EVERY CURVE, JUNK INCLUDED, AND THAT IS SAFE — which
  // is worth stating because the score test two paragraphs down had exactly that
  // shape and it was a bug there. The difference is the `min`. A junk curve can
  // only ever make `longest` bigger, which can only ever push `reach` back UP
  // towards `strips * cross`, and the `min` stops it there. So the worst a long
  // junk curve can do is cancel the close-up rescue and leave the old constant
  // standing: a page whose real staves reach nineteen strips beside a forty-strip
  // edge artefact is read exactly as it was before this rule existed. It cannot
  // throw away a stave the old code kept, which is the property that matters.
  // Filtering the junk out by score first would tighten it further and there is
  // no page in the corpus that shows the difference, so it is not done — and on
  // `scan:sizes` photo6, whose longest curve is a REAL stave scoring 0.400, such
  // a filter would have thrown away the honest yardstick along with the junk.
  const longest = joined.reduce((a, c) => Math.max(a, c.points.length), 0);
  const reach = Math.min(strips * cross, longest * 0.6);

  // AND HOW MUCH LIKE A STAVE IT HAS TO LOOK, measured against the best thing on
  // this page rather than against a number.
  //
  // Until the fragments were joined, a curve was tested on LENGTH alone —
  // `combPeaks` had already applied an absolute floor of 0.3 to each point, and
  // anything that got most of the way across the page was taken to be a stave.
  // Joining made that too generous, and the page it broke was the top EDGE of
  // the image: the background blur is built from a clamped window there, so the
  // first few rows carry an artefact that answers the comb weakly in scattered
  // strips. Those scraps used to be too short to survive and now they assemble.
  // Measured on tools/scan-clef-check.mjs's end-to-end page — four photographed
  // systems at y = 52, 208, 364 and 520 — the reader came back with a fifth
  // stave at y = 0, spanning the top edge, and read `treble` off it on a page of
  // basses.
  //
  // A comb score is a fraction of a strip's columns, so an absolute floor is a
  // statement about how black this photograph happens to be. The page's own best
  // curve is not: whatever the exposure, the clearest stave on the page is what
  // a stave looks like HERE, and three fifths of it is the bar. The edge artefact
  // reads a small fraction of that; every real stave on every page measured this
  // round reads most of it.
  //
  // THE MEDIAN of a curve's points, not the mean: a beamed run, the gutter or a
  // black chord costs a stave its score in a handful of strips, and a mean lets
  // those few strips speak for the whole curve.
  //
  // `best` IS TAKEN OVER THE CURVES THAT PASS THE LENGTH TEST, and taking it
  // over all of them was a bug that could return a BLANK PAGE. A two-strip
  // scrap — a bracket, a black chord, the frame of a photograph — is thrown
  // away by the very next line for being too short, and it was setting the bar
  // for the whole page before it went: six real staves answering in all forty
  // strips at 0.52 beside one scrap at 0.95 leaves 0.52 < 0.57, all six are
  // deleted, `trackCombs` returns nothing, `fillMissedStaves` bails at its own
  // three-stave floor and `readPage` returns null. It is not hypothetical:
  // `scan:sizes` photo6 took the page's best from a ONE-strip scrap at 0.686
  // where its longest curves read 0.40 to 0.457, and one of its six real staves
  // was being deleted here and put back by `fillMissedStaves` — the row reads
  // 94% recall before this and 96% after.
  //
  // AND THE BAR HAS AN ABSOLUTE FLOOR UNDER IT, because relative alone has no
  // lower bound and the fallback the comment used to claim does not exist.
  // `combPeaks`' 0.3 is a floor on each POINT, so every curve's median has
  // already cleared it and a conjunctive floor here would be a no-op; the
  // relative test is strictly tightening and nothing was holding the line under
  // it. A legitimately faint system among crisp ones was therefore dropped
  // however good it was in absolute terms — and on a two- or three-system page,
  // which is exactly the close-up the camera scanner produces, `fillMissedStaves`
  // returns early below three staves and the system is gone for good. That page
  // now exists in the corpus: the FEW block in tools/scan-corpus.mjs, whose
  // `few2faint` and `few3faint` rows read 50% and 67% recall before this and
  // 100% after.
  //
  // 0.45 IS A MEASURED WINDOW AND NOT A GUESS, and the window is narrow enough
  // that it is worth writing down where both edges came from. Dumping every
  // joined curve's median: the clef page's top-edge artefact reads 0.400 over
  // exactly 20 strips — it passes the length test and only this bar stops it —
  // and the faint system the FEW block draws reads 0.471 to 0.479. Swept, every
  // floor from 0.41 to 0.47 keeps the artefact out AND rescues the faint system;
  // 0.40 lets the artefact back (five staves, `treble` read on a page of basses)
  // and 0.48 loses the faint system again. It is the middle of that window.
  //
  // A PAGE-RELATIVE VERSION WAS CONSIDERED AND IS WORSE, so it is not left as an
  // obvious idea: measuring against the MEDIAN of the long curves instead of the
  // best would separate both fixtures too — the clef page's four staves out-vote
  // its one artefact — but on a page with two long curves the median IS the
  // lower of them and the test becomes vacuous, and a two-system page is the
  // page this whole rule is for.
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
  const scores = new Map(joined.map((c) => [c, median(c.points.map((p) => p[3] ?? 0))]));
  const long = joined.filter((c) => c.points.length >= reach);
  const best = Math.max(0, ...long.map((c) => scores.get(c)));

  return long
    .filter((c) => scores.get(c) >= best * 0.6 || scores.get(c) >= STAVE_FLOOR)
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
//
// …EXCEPT THAT IT DID, ON THE TWO HARDEST PAGES IN THE PROJECT, AND `floor =
// 0.05` IS WHY.
//
// Both Mozart pages predict one system ABOVE the first real one (the `wanted`
// loop below runs upwards from `tops[0]` as well as down) and land on the
// page's printed TITLE BLOCK. The Scanned score then draws twenty-one
// noteheads on printed type — the É of CARATGÉ, the o of Solo, five on W. A.
// MOZART — and the Concerto three. Measured, both pages: the phantom's comb
// score is 0.00 in every strip it crosses, and the real staves on the same page
// score 0.66 to 0.86. A fixed floor of 0.05 is thirteen times below the
// faintest honest stave on the page it is standing on, so it admits anything.
//
// SO ASK THE PAGE. A page is engraved once: whatever its own tracked staves
// score is what a stave on this photograph, at this exposure, through this
// scanner, looks like — and a prediction may be a fifth of that and no less.
// The low quartile twice over, because the number wanted is "the faintest
// honest stave in its worst strip" and neither a mean nor a best would say it:
// the inner quartile is across strips within one stave (a system is weakest
// where the shadow falls on it), the outer is across the staves themselves.
//
// A FIFTH is the width of the daylight, not a fitted constant. The two
// populations are separated by an ORDER OF MAGNITUDE — 0.00 against 0.66 — and
// the same idea measured in staff SPACES instead (the phantom is 18% off the
// page's median space against a real spread of 1.6%) is a strictly weaker
// discriminator and was measured to be: it cannot see the Concerto's phantom at
// all, because that phantom's per-strip step oscillates between the two
// extremes of `combPeaks`' window so its mean is the page's own. Use the axis
// with the daylight in it.
//
// ONE-DIRECTIONAL, `Math.max`. This may only ever raise the bar, never lower
// it, so no page that keeps a predicted stave today can lose one because its
// own staves happen to score badly — `fillMissedStaves` exists to rescue the
// faint system at the foot of a photographed page and it must still rescue
// every one. Measured: all 49 rows of CORE, HARD, SIZES and FEW come back
// identical, not merely equal in the mean.
//
// THIS WAS WRITTEN, MEASURED AND REVERTED ONCE BEFORE, and the reason it went
// back out was not the reader. On the Scanned score it read as a 2.65-point
// recall FALL, because twelve of the phantom's heads were matched to marks
// somebody had put on the composer's name. Those thirteen marks are now off the
// file — cropped one at a time, every one a ring and a mark on a printed letter
// of "Édition · F. CARATGÉ · Solo · Concert · Lamoureux" and "W. A. MOZART" —
// and `tools/truth-check.mjs` now reports such a mark under SUSPECT LABELS as
// `title`, so the contamination cannot come back unnoticed.
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

  // What a stave on THIS page scores. See the note above the function.
  const lowQuarter = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) * 0.25)];
  const bar = Math.max(floor, lowQuarter(staves.map((st) => lowQuarter(
    Array.from({ length: strips }, (_, s) => combScore(profiles[s], st.y0[s], st.step[s])),
  ))) / 5);

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
      if (best > bar) answered++;
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
    // FLAGGED, because `stavesToLines` must treat this stave differently from a
    // tracked one. A tracked stave's per-strip answer is EVIDENCE and is now
    // followed; a predicted one's is a local search around a position the page's
    // rhythm guessed, run in the strips where the system was too faint to track
    // at all, and it swings wildly. Measured on the Bach photograph, whose last
    // two systems `trackCombs` never finds: after the five-wide mean above,
    // staves 8 and 9 still swing 9.5 and 10.1 STEPS from end to end, against
    // 1.2 to 4.5 on the eight tracked ones — and a real page's curl is inside
    // that lower band. Following that would be far worse than a quadratic
    // through it, so a predicted stave keeps the quadratic. See `stavesToLines`.
    out.push({ y0: smooth, step, predicted: true });
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
const BEAM_THIN = 0.5;    // a beam's own thickness, in staff spaces
const BEAM_LONG = 3;      // …or a run this long, which no head and accidental is

export function beamMask(ink, w, h, space, { run = 2.4, bulge = 1.8, join = 0.55, stack = 1.8 } = {}) {
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
        // A BEAM IS THINNER THAN A NOTEHEAD IS TALL — or else it is long.
        //
        // This is what stops the mask eating a notehead that has an accidental
        // standing against it. At a ten-pixel staff space a flat and the head
        // it belongs to blur into ONE horizontal run about 2.7 spaces long:
        // long enough to be a beam by `run`, and its low-quartile column height
        // is the HEAD's own height, so the sparing test below measures the head
        // against itself, spares the tall accidental beside it, and erases the
        // head. MEASURED, `npm run scan:studies -- --phone --dir <A-minor-scale>`:
        // 23 of 29 notes found and 0 of the 5 notes carrying an accidental;
        // with the mask off entirely, 28 of 29 and 5 of 5. The five other
        // suspects in the handover were ruled out one at a time and none of
        // them was this.
        //
        // A beam drawn on paper is about half a staff space thick. What it is
        // NOT is a space thick, which is what an ellipse is. So the run has to
        // be thin — or, when it is not, long enough that it cannot be one note
        // and its accidental: double and triple beams merge into one bar at
        // photograph resolution and that bar spans a whole beamed group.
        const thin = base <= space * BEAM_THIN;
        const long = (end - x) >= space * BEAM_LONG;
        if (median <= space * stack && (thin || long)) {
          for (let k = x; k < end; k++) {
            const { top, bottom, tall } = extent(k, y);
            // A head joins here.
            //
            // Asked two ways, and spared if EITHER says so. `bulge` is a
            // multiple of the beam's own thickness, and that is the wrong shape
            // of question on its own: it makes the bar for "a head is attached"
            // depend on how thick this edition draws its beams, so a thin beam
            // spares almost anything and a thick double beam spares almost
            // nothing. Measured on a photographed Mozart flute part, whose
            // double beams are thick and whose staff space is 10 pixels, the
            // multiplicative bar landed ABOVE a notehead's own height and the
            // mask erased whole beamed runs straight through their heads.
            //
            // A notehead adds about a space of height wherever it meets a beam,
            // and that is true of every engraving because it is what a staff
            // space means. So the additive test is the one that travels.
            if (tall > base * bulge || tall > base + space * join) continue;
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
// READ THE BLOCK ABOVE `smoothTrack` BEFORE BELIEVING THAT SENTENCE. It is true
// of a stave's SPACING, which is all this curve is still fitted to on a tracked
// system, and it is false of a stave's POSITION on a photograph of a bound book,
// where the printed line waves and this fit least-squares straight through it.
// That cost a whole wrong note per passage and it was measured; the position is
// now smoothed rather than fitted.
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

// …AND ON A PHOTOGRAPH OF A BOUND BOOK IT WAVES, WHICH IS WHERE THE PITCH WAS
// BEING LOST. The paragraph above is right about what a stave does and wrong
// about what a quadratic can follow, and the difference cost a whole note.
//
// DRAWN ON THE PAGE, which is the only way this was ever going to be seen. On
// the photographed Bärenreiter BWV 1007, system 1, at 8x: the tracked comb sits
// exactly on the five printed lines all the way across, and the FITTED model
// runs a third of a space ABOVE the print at x=0.30 and a third to a half BELOW
// it by x=0.69, crossing somewhere near the middle. Every red line of the model
// runs through the white of a space while the print runs below it. In steps —
// half a space, which is a note name — the fitted bottom line was +0.79 out at
// x=0.30 and -0.96 at x=0.69, and the sign of that error is the sign of the
// wrong pitch note for note.
//
// The printed line is not a bend on that page, it is a WAVE: down at the left,
// up by strip 12, down again by strip 30, up at the right end, about 13px of
// swing on a 12px staff space. A quadratic has one turning point and that shape
// has three, so the fit least-squares straight through it. Raising the degree is
// not the answer either — a global quartic needs a fourth turning point it will
// find in the noise, and it goes unstable at exactly the strip ends where
// `trackCombs`' clamp fabricates flat data.
//
// WHAT SEPARATES THE SIGNAL FROM THE FAILURE IS SCALE, NOT SHAPE. The thing the
// fit was protecting against is one strip landing on a beam or the thick of a
// slur: that is a SINGLE strip. The wave is ten strips wide. So a running MEDIAN
// throws the first away by construction — a median of five cannot be moved by
// one bad value, and it needs no tolerance constant at all — while passing a
// ten-strip wave through almost untouched. The short mean after it only takes
// the staircase off the median's output.
//
// THE WINDOW IS THE WHOLE CHANGE, so it was swept, on the three marked pages,
// scored as the STEP each hand-marked notehead reads against the lines printed
// around it (tools/step-truth.mjs):
//
//     y0 smoothed by      Bach            Concerto        Scanned score
//     the quadratic       193/248  77.8%  204/230  88.7%  262/301  87.0%
//     median 3, mean 3    229/248  92.3%  211/230  91.7%  278/301  92.4%
//     median 5, mean 3    229/248  92.3%  210/230  91.3%  279/301  92.7%
//     median 7, mean 3    229/248  92.3%  210/230  91.3%  276/301  91.7%
//     median 5, no mean   229/248  92.3%  209/230  90.9%  275/301  91.4%
//     median 5, mean 5    228/248  91.9%  210/230  91.3%  278/301  92.4%
//
// THE DENOMINATORS ARE IDENTICAL DOWN EVERY COLUMN — 248, 230, 301 — so those
// are the same marks answered before and after and not a different sample. The
// harness consults the reader's own model for one bounded tie-break, so that had
// to be checked rather than assumed: its self-score against the steps BWV 1007
// gives is 25 of 32, on the same 25 marks, before and after.
//
// AND THE OPENING OF THE PRELUDE COMES BACK. Bars 1-2 read
//   0 4 9 8 9 3 8 3 -1 4 8 8 9 4 9 4 0 6 11 10 11 6 11 6 1 6 11 10 11 5 10 4
// and now read
//   0 4 9 8 9 4 9 4  0 4 9 8 9 4 9 4 0 5 11 10 10 5 10 5 0 5 10 9 10 5 10 5
// against a music that is not in dispute (pages/truth/bach.pitch.json):
//   0 4 9 8 9 4 9 4  0 4 9 8 9 4 9 4 0 5 10  9 10 5 10 5 0 5 10 9 10 5 10 5
// 14 of 32 to 30 of 32, and both statements of bar 1 exactly right.
//
// 3 and 5 tie on the total. FIVE is taken because it is the one that survives
// TWO neighbouring bad strips, and the thing being survived is a beamed group
// lying across the stave — at 40 strips on a 1400px raster a strip is 35px and a
// beamed group of semiquavers is wider than that, so a beam is not reliably a
// one-strip event. The mean after it is three wide and not five: five costs Bach
// a mark and buys nothing, and dropping it altogether costs the Concerto one and
// the Scanned score four, which is the staircase the median leaves behind.
//
// AND THE ONE THING THAT SAYS THIS IS THE STAVE AND NOT A LUCKY ROUNDING: the
// model's own distance from the printed lines, in steps, measured at the marks
// across each system of the Bach photograph. On the eight systems `trackCombs`
// tracks, the end-to-end swing was 0.20 to 1.67 steps and is now 0.10 to 0.18 —
// every tracked stave square on the print to a tenth of a step. The two the
// quadratic still governs, systems 8 and 9, are unmoved at 0.30 and 0.00, and
// they hold all 45 of the page's remaining half-step-or-worse marks.
//
// WHAT IT COST, because nothing here is free and the next round should not have
// to find it out again. `scan:key-read` comes back byte-identical, 300 of 352
// and 0 read as the wrong key. `scan:key-safety` passes all five of its gated
// zeroes. `scan:studies` is unchanged on every summary line it prints — in bass
// and again under FORCE_CLEF=treble and FORCE_CLEF=tenor — 692 found, 666 named
// right, `wrong by semitones` empty. (Those three were diffed on the lines the
// tools print, not note by note.) `scan:corpus` is identical
// in all four means, `scan:clef-change` byte-identical, `npm test` 607.
// `bench` recall does not move on any page (99.7 / 95.1 / 99.5, mean 98.1); its
// precision moves 95.0 to 94.9 in the mean — two more invented circles on Bach,
// one fewer on the Concerto. `scan:bars` loses one barline of 42 on its `faint`
// fixture, 6 clean staves of 6 down to 5, mean recall still 100%. And the
// mid-system clef block of `scan:clef`, which is deep in debt at both ends
// already, moves the right way on both of its totals: 158 false fires to 155,
// and 141 notes named wrong on a page whose change was found down to 118.
//
// THE `bars` COLUMN OF `bench` RISES ON ALL THREE REAL PAGES — Bach 34 to 40 —
// and that was checked rather than claimed, because more barlines is not by
// itself better. Dumping the positions: three of Bach's six new bars are the
// CLOSING barline of systems 0, 1 and 2 at x≈1301, which no other system was
// missing, and those are exactly the three systems whose model was furthest out
// (swings 1.67, 1.30, 0.93 steps). A barline is measured between the stave's own
// top and bottom line, so a model half a space out at the right-hand edge clips
// it away. The other three (x=918, 956 on system 2, 903 on system 5, 1013 on
// system 6) land among stems in the cluster this page's bar finder already
// invents, and are not defended here.
//
// THE SPACING KEEPS THE QUADRATIC, and that is not an oversight. Splitting the
// bottom line's error into the stave's vertical position and four times its
// spacing error, on Bach staff 0: the position slides by -5.4 to +6.2px while
// four times the spacing error stays inside ±0.65px. The stave MOVES; it does
// not stretch. Smoothing the spacing the same way would only let noise into the
// one quantity that is already right.
//
// A PREDICTED STAVE KEEPS THE QUADRATIC TOO. `fillMissedStaves` does not track
// those — it searches around a position the page's rhythm guessed, in the strips
// where the system was too faint to track — and its answer swings 9.5 and 10.1
// steps end to end on the two systems at the foot of the Bach photograph,
// against 1.2 to 4.5 on the eight `trackCombs` actually finds. There is nothing
// there to follow. A quadratic through it is a rescue, not a measurement.
const TRACK_MEDIAN = 2;
const TRACK_MEAN = 1;

// Running median then a short running mean, both with windows that SHRINK
// symmetrically at the ends rather than repeating the edge value. Shrinking
// keeps a straight stave straight: on a plain ramp every output equals its
// input, because the median of a symmetric window of a monotone run is its
// centre, and the mean of one is too. Padding would flatten both ends of every
// stave on the page towards its first and last strip, which is the margin where
// the clef is drawn and read.
//
// THE PRICE OF SHRINKING, NAMED: at strips 0 and 39 the half-width is 0 and the
// value passes through UNFILTERED, so a single bad comb answer in the very first
// or very last strip now reaches the model where the quadratic would have
// absorbed it. That is the clef margin, and the step harness cannot see it —
// the `.0` column of its per-system table is empty on all ten Bach staves,
// because nobody marks a notehead inside a clef zone. So it was LOOKED AT
// instead: `node tools/stave-look.mjs <pdf> --at 120,325 --at 120,1440 --zoom 8`,
// systems 0 and 7 of the photograph, and the five red lines run along the
// printed ones through the clef and the key sharp in both. The reader agrees —
// clefs 10/10 on all three marked pages, `scan:clef`'s first two blocks
// unchanged, `scan:clef-hard` 9/10 before and after, `scan:clef-change`
// byte-identical. Padding the ends instead would trade this risk for a
// certainty: every stave on the page flattened towards its own end strip, in
// that same margin.
function smoothTrack(values, median = TRACK_MEDIAN, mean = TRACK_MEAN) {
  const n = values.length;
  const mid = new Float32Array(n);
  // `sorted` and not `window`: this module runs in the browser and calls
  // `document.createElement`, and a local named `window` inside it is a trap
  // waiting for the next person who adds a line to this function.
  const sorted = [];
  for (let s = 0; s < n; s++) {
    const half = Math.min(median, s, n - 1 - s);
    sorted.length = 0;
    for (let k = s - half; k <= s + half; k++) sorted.push(values[k]);
    sorted.sort((a, b) => a - b);
    mid[s] = sorted[(sorted.length - 1) >> 1];
  }
  const out = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    const half = Math.min(mean, s, n - 1 - s);
    let sum = 0;
    for (let k = s - half; k <= s + half; k++) sum += mid[k];
    out[s] = sum / (2 * half + 1);
  }
  return out;
}

export function stavesToLines(staves, strips) {
  return staves.map(({ y0, step, predicted }) => {
    // The spacing is smoothed too, and harder. A stave's lines do not get
    // further apart across a page by more than the perspective of a curling
    // sheet, so a strip claiming a different spacing is a strip that found
    // something else.
    let raw = 0;
    for (let s = 0; s < strips; s++) raw += step[s];
    const nominal = raw / strips;
    const smoothStep = fitCurve(step, Math.max(0.5, nominal * 0.12));
    // See the note above `smoothTrack`. The tolerance the quadratic needed here
    // was `nominal * 0.9` — 10.8px, nearly two whole steps — and it had to be
    // that loose precisely BECAUSE the quadratic could not follow the wave and
    // honest strips had to survive the rejection pass. The median needs no
    // tolerance at all.
    const smoothY0 = predicted
      ? fitCurve(y0, Math.max(1.5, nominal * 0.9))
      : smoothTrack(y0);
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
// is one value per row, the fraction of the band inked, running from CLEF_ABOVE
// spaces above the top line to CLEF_BELOW below the bottom one — asymmetric, and
// scan-clef.js says why.

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

// How far the PRINTED stave sits from where the page-wide fit puts it, right
// here, under the clef band.
//
// trackCombs holds each staff line flat outside the strips that measured it. At
// the left edge the first strips are lost to the shadow in the gutter, so a line
// keeps the height it had at the first strip that answered — and a page lifting
// out of a binding rises over exactly that inch, so the printed lines sit as much
// as 0.58 of a space ABOVE the model. clefColumn took its window from that model,
// so `top` moved from about -0.3 to about -0.9 and crossed ABOVE_STAVE (-0.6) in
// scan-clef.js: a bass clef, read confidently as tenor.
//
// The clef ink itself is the same height on every system — bottom minus top is
// 2.65 to 2.89 spaces across all of them, which is one bass clef nine times. Only
// the zero point moved. And the first inch is the ONLY place a clef is ever read,
// which is why this error costs the clef and costs nothing else.
// How wide a clef band is, in staff spaces. Wide enough for a clef and no
// wider — see clefColumn. Named because three places need to agree about it:
// where the clef is read, where the overlay draws that band, and which heads
// are the clef rather than notes.
export const CLEF_WIDE = 3.6;

const REGISTER = 0.9;        // reach, in staff spaces — strictly under one
const REGISTER_FLOOR = 0.4;  // below this the band has no stave to register on

function bandShift(ink, w, h, lineY, space, x0, x1, mid) {
  const wide = x1 - x0 + 1;
  const seen = new Map();
  const rowInk = (y) => {
    if (y < 0 || y >= h) return 0;
    const had = seen.get(y);
    if (had !== undefined) return had;
    let lit = 0;
    for (let x = x0; x <= x1; x++) if (ink[y * w + x]) lit++;
    const v = lit / wide;
    seen.set(y, v);
    return v;
  };
  const reach = Math.round(space * REGISTER);
  const above = Math.round(lineY(0, mid) - space);
  const below = Math.round(lineY(4, mid) + space);
  let best = 0;
  let bestScore = -1;
  for (let d = -reach; d <= reach; d++) {
    let score = 0;
    // A staff line is inked right across the band; the clef standing on it
    // covers half the band at most. So the five lines are what the comb finds.
    for (let k = 0; k < 5; k++) score += rowInk(Math.round(lineY(k, mid)) + d);
    // Seven teeth, not five, and the outer two count AGAINST. Five evenly spaced
    // teeth slid a whole space match four of the five lines again; what a stave
    // has that its aliases do not is a blank row a space outside each end.
    score -= rowInk(above + d) + rowInk(below + d);
    // Ties to the smaller correction.
    if (score > bestScore || (score === bestScore && Math.abs(d) < Math.abs(best))) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore / 5 >= REGISTER_FLOOR ? best : 0;
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
  const across = Math.max(3, Math.round(space * CLEF_WIDE));
  const x0 = Math.max(0, Math.round(fromX));
  const x1 = Math.min(w - 1, x0 + across);
  if (x1 <= x0) return null;
  const mid = Math.round((x0 + x1) / 2);
  // Registered inside the clef band, not over a wide window. A comb wants five
  // clean lines and the clef zone is the one place on the stave guaranteed to
  // have something else drawn in it — so the comb carries two negative teeth a
  // space outside each end, which is what a stave has that its aliases and the
  // clef's own ink do not.
  //
  // The top line as PRINTED under this band, not as the page-wide fit predicts.
  const top = lineY(0, mid) + bandShift(ink, w, h, lineY, space, x0, x1, mid);
  const rows = Math.round(space * (4 + CLEF_ABOVE + CLEF_BELOW));
  const out = new Float32Array(rows);
  const wide = x1 - x0 + 1;
  for (let r = 0; r < rows; r++) {
    const y = Math.round(top - CLEF_ABOVE * space + r);
    if (y < 0 || y >= h) continue;
    let inked = 0;
    for (let x = x0; x <= x1; x++) if (ink[y * w + x]) inked++;
    out[r] = inked / wide;
  }
  return out;
}

// Is there anything in this band to read at all?
//
// Not "is this a clef" — that is scan-clef.js's job and it is entitled to say
// no. This is the far cruder question of whether the band holds ink, which
// distinguishes a clef the classifier cannot name from a piece of blank margin
// nobody drew anything on. A stave alone puts five rows across the full width
// of the band, so the bar is set below one line and far above paper.
//
// MEASURED ACROSS THE BAND'S WIDTH, and that is what makes it shadow-proof.
//
// The obvious worry about any ink test at the left margin is the page-edge
// shadow, which is what killed an earlier attempt to find the clef by hunting
// tall ink — that one read the shadow on nine systems in ten. Two things stop
// it here. `ink` is thresholded against a LOCAL rolling background, so a smooth
// shadow carries its own background with it and never becomes ink at all; and
// what does survive it, a hard shadow EDGE, is a vertical line one or two
// columns wide against a band some forty across, which comes to about 0.05 of a
// row. A staff line comes to 1.0. There is no way to confuse the two at 0.35.
//
// Confirmed on tools/scan-clef-hard.mjs, whose page carries a shadow, a gutter
// and an indented first system: the relocation fires, and taking the shadow
// away does not change the score.
const BAND_INK = 0.35;

function bandHasInk(column) {
  if (!column) return false;
  for (const v of column) if (v >= BAND_INK) return true;
  return false;
}

// How much of the column between the top and bottom lines has to be ink.
const BAR_FILL = 0.88;
// How much of it may have something wide hanging off it.
const BAR_ATTACHED = 0.25;
// How wide the thing hanging off it has to be before it counts.
const BAR_WIDE = 1.2;
// How far it may run past the stave before it is a stem going somewhere.
const BAR_OVERHANG = 0.5;

// A barline is a column of ink that spans the stave from the top line to the
// bottom one — and nothing else on a single-staff part does that. Thick columns
// (a final double bar, a repeat) come out as one barline, which is right.
// Why is there no barline here?
//
// The same job headProbe does for noteheads, and needed for the same reason: a
// crop shows a barline the reader did not draw, and the only way to find out
// which of findBars' three tests turned it down is to ask. Mirrors them in
// order, with the numbers each one saw.
export function barProbe(ink, w, h, staff, stripW, space, x) {
  const lineY = (index, at) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(at / stripW)))
  ];
  const top = Math.round(lineY(0, x));
  const bottom = Math.round(lineY(4, x));
  if (bottom <= top) return { verdict: 'no stave here' };
  let filled = 0;
  for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) filled++;
  const fill = filled / (bottom - top + 1);
  const out = { fill: +fill.toFixed(3) };
  if (fill <= BAR_FILL) return { ...out, verdict: `column only ${(fill * 100).toFixed(0)}% inked between the lines` };

  const lines = [0, 1, 2, 3, 4].map((k) => lineY(k, x));
  const wide = Math.max(3, Math.round(space * BAR_WIDE));
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
  out.attached = looked ? +(attached / looked).toFixed(3) : 0;
  if (looked > 0 && attached / looked > BAR_ATTACHED) {
    return { ...out, verdict: 'something wide is hanging off it — a stem with a head or a beam' };
  }
  const over = Math.round(space * 1.4);
  let above = 0; let below = 0;
  for (let k = 1; k <= over; k++) {
    if (top - k >= 0 && ink[(top - k) * w + x]) above += 1;
    if (bottom + k < h && ink[(bottom + k) * w + x]) below += 1;
  }
  out.above = above; out.below = below;
  const overhang = Math.max(1, Math.round(space * BAR_OVERHANG));
  if (above > overhang || below > overhang) {
    return { ...out, verdict: `runs on past the stave — ${above} above, ${below} below, ${overhang} allowed` };
  }
  return { ...out, verdict: 'accepted' };
}

function findBars(ink, w, h, staff, stripW, space) {
  const lineY = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  const columns = [];
  // How wide is too wide for something a barline is touching.
  const wide = Math.max(3, Math.round(space * BAR_WIDE));
  for (let x = 0; x < w; x++) {
    const top = Math.round(lineY(0, x));
    const bottom = Math.round(lineY(4, x));
    if (bottom <= top) continue;
    let filled = 0;
    for (let y = top; y <= bottom; y++) if (y >= 0 && y < h && ink[y * w + x]) filled++;
    if (filled / (bottom - top + 1) <= BAR_FILL) continue;

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
    if (looked > 0 && attached / looked > BAR_ATTACHED) continue;

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
    const overhang = Math.max(1, Math.round(space * BAR_OVERHANG));
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

// The width a notehead has to reach before it is believed, expressed as what
// the page itself measures rather than as one number for every page. FLOOR is
// the absolute minimum below which nothing is a head whatever the page says —
// a stem is a fifth of a space — and CAP stops a page of beams talking the
// floor up past its own notes.
// How sure the classifier has to be.
//
// CHOSEN FROM THE CROSS-PAGE TABLE, NOT FROM npm run bench.
//
// The shipped weights are fitted to both marked pages, so on those two pages
// the model is more confident than it will ever be on a new one, and a cut
// tuned against them is tuned against a confidence the next upload will not
// produce. The bench reads its best at 0.7 — and on a page held out of
// training, 0.7 throws away a fifth of the notes.
//
//   held-out page      cut 0.3        cut 0.4        cut 0.7
//   Bach            97.2 / 99.4    98.1 / 99.4    99.7 / 99.4
//   Mozart          90.9 / 94.3    93.3 / 89.5    96.2 / 77.7
//
// So 0.4, which is where the harder of the two still keeps nine notes in ten
// when it has never been trained on. A missed note breaks the alignment a take
// depends on; an extra circle is cosmetic.
//
// THE TABLE ABOVE IS THE ONE THAT GOVERNS, because it is the table for the
// weights actually shipped in head-model.js. There is now a second one, printed
// by npm run scan:train against pages/patches.json as it stands — three pages,
// 1267 patches — and it belongs to a model that was measured and NOT installed:
//
//   held out   cut 0.3        0.4            0.5            0.6
//   Bach       97.8 / 99.4    99.1 / 99.4    99.7 / 99.4    100.0 / 99.4
//   Mozart     85.8 / 99.3    89.6 / 98.0    93.9 / 97.3     96.3 / 95.0
//   Scanned    95.7 / 92.8    96.2 / 90.9    96.4 / 89.2     96.4 / 88.1
//
// Its mean F1 is flat from 0.4 to 0.6 (95.45, 95.93, 95.78) and its mean recall
// is 96.1 at 0.4 against 94.2 at 0.6, so even for that model the asymmetry the
// paragraph above states — a lost note is expensive and a spare circle is not —
// picks 0.4 again. Read the long note in head-model.js before using either.
//
// One thing that table does NOT say, and it is the difference between "a third
// page was a big win" and "a page of a different KIND is still the next step":
// the held-out Mozart row is trained on the Bach AND THE SCANNED SCORE, and the
// Scanned score is the same music as the Concerto photographed differently. Its
// 89.5 -> 98.0 recall is flattered by that. The only clean independent row is
// the Bach, and it moves 98.1 / 99.4 to 99.1 / 99.4.
const HEAD_JUDGE = true;
const HEAD_CUT = 0.4;

// How close two candidates have to be before the weaker is taken as the same
// head found twice. A notehead is about 1.2 spaces wide, so a pair of adjacent
// heads on a dense page are barely more than that apart — and a radius set for
// deduplication doubles as a radius for deleting the neighbour.
const CLUSTER_X = 1.1;
const CLUSTER_Y = 0.9;

const HEAD_WIDE_FLOOR = 0.55;
const HEAD_WIDE_SHARE = 0.45;
const HEAD_WIDE_CAP = 1.2;

// A notehead away from the stave stands on a ledger line — and on nothing
// longer than one.
//
// MEASURED, on a page of the Bärenreiter Bach marked up by somebody who can see
// it. Of the reader's 417 heads, 363 were real and 54 were not, and eighty of
// them sit outside the stave, where the notes and the marks separate cleanly:
//
//     horizontal rule through the head     notes   not-notes
//     under half a space                       3           3
//     1.5 to 2.5 spaces                       35           6
//     2.5 to 3.0 spaces                        2           3
//     over 3 spaces                            0          24
//
// The rule that was expected here was the opposite one — require a ledger line,
// reject a head that has none — and measuring it is what stopped it being
// shipped. It removes three marks and costs five real notes, because a ledger
// line on a photographed page is one grey pixel and misses as often as it hits.
//
// What separates them is the rule being TOO LONG. An engraver draws a ledger
// line barely wider than the head it carries, about two staff spaces; nothing
// legitimate outside the stave sits on more. The heads with six spaces of ink
// under them are standing on the slurs a cello part is covered in, and on the
// heading, whose letters bridge into one run at photograph resolution. Both are
// facts about how music is printed rather than about this page's range, so a
// part in any clef for any instrument is read by the same rule — which a cut on
// height, the other tempting answer here, would not be: step 14 is the editor's
// title on a cello part and an ordinary note on a violin one.
//
// The first space either side of the stave — step 9 and step -1 — is written
// without a ledger line and is never asked about.
const LEDGER_LONGEST = 3;   // staff spaces; the notes on that page reach 2.9
// How long a run the second judge is allowed to overrule LEDGER_LONGEST on, and
// how sure it has to be. See the filter in readPage that uses them: a real note
// off the stave often rests on its own BEAM, which is ink far too long to be a
// ledger line, and this is what lets those back in without letting in a patch of
// a beam that spans half a system.
const LEDGER_OVERRULE = 6;    // staff spaces of run the overrule still reaches
const LEDGER_SURE = 0.9;      // the second judge must be this certain
// Out where only a ledger note can be, there has to be a ledger line: an
// engraver draws one because otherwise nobody could tell which line the note is
// on. Text, dynamics, rests and ornaments have none.
const LEDGER_SHORTEST = 1.2;
const FAR_ABOVE = 14;
const FAR_BELOW = -2;
const LEDGER_GAP = 2;       // pixels of break tolerated, for a photographed line

// How wide the horizontal rule through this head runs, in staff spaces, at the
// ledger line it would stand on. Separated from the verdict so the distribution
// can be measured before a threshold is chosen — the last discriminator
// proposed for this looked obvious, was applied on a hunch and cost a quarter
// of the notes on the page. See tools/ledger-audit.mjs.
export function ledgerRun(ink, w, h, staff, stripW, space, head) {
  const at = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  const bottom = at(4, head.x);
  const step = Math.round((bottom - head.y) / (space / 2));
  // The ledger line this head is nearest, counting inward: a head ON a line
  // wants that line, a head in the space beyond one wants the line below it.
  const line = step % 2 === 0 ? step : step + (step > 0 ? -1 : 1);
  const y0 = Math.round(bottom - (line * space) / 2);
  const x = Math.round(head.x);
  let best = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const y = y0 + dy;
    if (y < 1 || y >= h - 1) continue;
    const lit = (px) => ink[y * w + px] || ink[(y - 1) * w + px] || ink[(y + 1) * w + px];
    if (!lit(x)) continue;
    let left = x;
    for (let gap = 0; left > 0 && gap <= LEDGER_GAP;) {
      if (lit(left - 1)) { left--; gap = 0; } else { gap++; left--; }
    }
    let right = x;
    for (let gap = 0; right < w - 1 && gap <= LEDGER_GAP;) {
      if (lit(right + 1)) { right++; gap = 0; } else { gap++; right++; }
    }
    best = Math.max(best, right - left);
  }
  return best / space;
}

// Is a head this far from the stave believable?
function offStaveIsCredible(ink, w, h, staff, stripW, space, head) {
  const at = (index, x) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
  ];
  const step = Math.round((at(4, head.x) - head.y) / (space / 2));
  if (step >= -1 && step <= 9) return true;
  const run = ledgerRun(ink, w, h, staff, stripW, space, head);
  if (run > LEDGER_LONGEST) return false;
  // …and out where only a ledger note can be, there has to be a ledger line.
  if (step >= FAR_ABOVE || step <= FAR_BELOW) return run >= LEDGER_SHORTEST;
  return true;
}

// Ink printed at the start of every system is furniture, not music.
//
// MEASURED, on the marked-up Bärenreiter page. Sixty-one heads were not notes,
// and eighteen of them were one pair per system — systems two to ten, every one
// at x = 80 to 93, every one at steps 4/5 and 7/8, every one reported as a
// semiquaver. System one had the same pair at x = 142, because system one is
// indented. That is the KEY SIGNATURE, read as noteheads ten times over, and it
// is a fifth of everything the reader invents on the page.
//
// A key signature cannot be told from a chord by shape — a sharp has two thick
// strokes at notehead height and no amount of looking at one of them settles
// it. What settles it is that it is printed in the same place on every system,
// and music is not: a page whose every system carried the same two pitches at
// the same distance from the barline would be a page nobody wrote.
//
// So the systems vote. A position is measured from each stave's OWN start —
// which is why the indented first system agrees with the other nine rather than
// looking like a tenth exception — and a head whose position and height are
// shared by most of the page is dropped from all of them.
//
// This asks nothing about what the mark IS, which is the point: it takes out
// the time signature and the editor's rehearsal letters on the same evidence,
// and it will take out a five-flat key signature it has never seen. A real key
// signature reader is still worth building, because naming a pitch needs to
// know that the B is flat and this cannot say so — but that is a different job
// from not drawing a circle round it.
// Where a clef is printed there is no note.
//
// MEASURED, on the marked-up Bärenreiter page: the reader drew a ring on the
// bass clef of nine systems out of ten, at x = 39 to 50, step 6 to 8, on a
// stave whose left end is 34. Music does not begin four tenths of a space after
// the stave does — a clef alone is three and a half spaces wide — so a head in
// that band is the clef, every time. Certain, so it needs no agreement across
// the page and works on a single-system fragment.
//
// ONLY WHERE A CLEF WAS ACTUALLY READ. A page of bare staves — a cropped
// photograph, a fragment, most of the synthetic corpus — has music where a clef
// would be, and excluding the band unconditionally cost real notes: CORE 99% to
// 94%, HARD 91% to 84%.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// The key signature is the other furniture read as noteheads, and it is worth
// eighteen false heads a page — a pair on every system, at the same distance
// past the stave's start, at the same two heights. Recognising it by that
// repetition was built and measured and then taken out again. It works on the
// real page, 85.1% precision to 89.4%, and it costs four to eight points of
// RECALL across the synthetic corpus, because music near the start of a system
// is often similar system to system and a rule that cannot tell "printed twice"
// from "played twice" will take the notes as well. A missing note breaks the
// alignment a take depends on; an extra circle is cosmetic. The trade is the
// wrong way round.
//
// What that population actually needs is a key signature READER — sharps and
// flats found by their own shape in the band after the clef — which is owed
// anyway, since naming a pitch means knowing the B is flat and no amount of
// counting repetitions can say so. scan-key.js is waiting for it.
//
// BOTH SUPPRESSIONS WAIT FOR A CLEF, AND THE SECOND ONE DOES SO BY MEASUREMENT
// RATHER THAN BY INHERITANCE.
//
// The single gate below — `if (from === null || !clefs[i].clef) continue;` —
// looks like an accident of how this function grew: the clef band plainly needs
// a clef, the key band has its own evidence, and a system whose clef cannot be
// named therefore gets no suppression of ANY kind. That is two systems of the
// three marked pages, the first of the Concerto and the first of the Scanned
// score, both clef null at confidence zero.
//
// So it was split and measured, and the answer is that it should not be. Run
// findKeyBand wherever the stave's left end is known, and:
//
//   the three marked pages            NO CHANGE AT ALL
//     Bach 97.5/98.8, Mozart 87.0/91.0, Scanned 90.2/91.4 either way
//   the synthetic corpus              CORE mean 99% -> 98%
//     clean, small, tiny, blurred, faint, jpeg, tilted, creased and shrunk all
//     fall from 100% recall to 98–99%; photograph 96% -> 95%; HARD heavyBlur
//     97% -> 93%, denseSemis 100% -> 99%, halfSpace 100% -> 98%
//
// The corpus is a page of bare staves, which is what a cropped photograph and a
// fragment are too, and on a bare stave the music starts where the furniture
// would be. The key scan is good enough that it usually refuses — but "usually"
// costs a note per page there, and a note is the thing this reader is not
// allowed to lose. The two systems it was supposed to rescue turn out to be
// worth nothing measured: with the width ceiling now in scan-key.js both of
// them return no band at all, because neither is standing on a key signature —
// the Scanned score's first system is a stave fillMissedStaves invented over
// the title block, and its false heads are on the printed words rather than in
// the furniture zone.
//
// Which leaves the clef band, and the same conditional guards it for the reason
// already written above: excluding it unconditionally cost CORE 99% to 94% and
// HARD 91% to 84%. What would lift it is a test for CLEF-SHAPED INK that does
// not depend on scan-clef being able to name which clef — a band with a tall
// confident glyph in it is furniture either way. That test is not built. The
// obvious candidate, height, does not separate: clefFeatures already discards
// the staff lines and a notehead with a stem measures about three and a half
// spaces, over SHORTEST, which is exactly why the unconditional drop cost what
// it did. See docs/reader-handover.md.
function dropFurniture(ink, w, h, found, edges, clefs, stripW) {
  // Read every system's band FIRST, then let the page agree, then suppress.
  //
  // Three passes rather than one because the middle one needs the whole page:
  // a key signature is the same on every system, so a system reporting five
  // accidentals on a page whose other nine report one has run past the
  // signature into the music, and trimming it back is the difference between
  // suppressing a sharp and suppressing the first two notes of the bar. See
  // agreeKeyCount in scan-key.js for why the trim can only ever narrow a band —
  // and note that the page's agreement now does one more thing than trim, which
  // is documented at the widening below and above agreeKeyReach.
  const bands = found.map((sys, i) => {
    const from = edges[i];
    if (from === null || !clefs[i].clef) return null;
    const space = sys.staff.space;
    const wide = Math.max(3, space * CLEF_WIDE);
    // The key signature after the clef band, when there is one. Found by
    // walking right until something that is not an accidental turns up, so the
    // band ends where the music starts rather than at a width somebody chose.
    // Held at the x the band STARTS at, rather than followed across it.
    //
    // Following the curve was tried both ways — strip by strip, and interpolated
    // between strips — and both read two more false heads than holding it
    // still. A key signature is a strip and a half wide and the lines move a
    // pixel or two across it, which is less than the tolerance the mask already
    // carries; what following them adds is the strip boundary's own step.
    const at = (index, x) => sys.staff.lines[index].at[
      Math.min(sys.staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
    ];
    const held = (k) => at(k, from + wide);
    // scanKeyBand rather than findKeyBand, for `empty` — the one thing a null
    // band cannot say. A system that ran this scan and found the place a
    // signature is printed to be BARE is evidence about the page's key; a
    // system that found something it could not name is not. See scanKeyBand and
    // agreeNoKey in scan-key.js. The band itself is exactly what findKeyBand
    // would have returned, so nothing below this line sees a new shape.
    const scan = scanKeyBand(ink, w, h, (k) => held(k), space, from + wide);
    return { at: held, band: scan.band, empty: scan.empty, why: scan.why };
  });

  const agreed = agreeKeyCount(bands.map((b) => b?.band?.count ?? 0));

  for (const [i, sys] of found.entries()) {
    // DID THIS SYSTEM LOOK, AND WHAT DID IT SEE WHERE A SIGNATURE IS PRINTED?
    // Set before the `continue` below and on every system, because the page's
    // answer is arithmetic over ALL of them — a system that never ran the scan
    // is not a witness for bare paper and it must not be a witness against one
    // either. `bands[i]` is null exactly when the scan was not run: no left
    // edge, or no clef to measure the band from. See agreeNoKey in scan-key.js.
    sys.keyScanned = !!bands[i];
    sys.keyEmpty = !!bands[i]?.empty;
    // …and WHAT ENDED THE SCAN, whether or not a band came back. keyBand.why
    // says this already for a system that found glyphs, and a system that found
    // none is exactly the one worth asking — it is the difference between bare
    // paper ('gap') and ink in the signature's own place that could not be
    // identified ('tall', 'wide'). Carried so a report can explain a page that
    // did NOT name itself C major instead of only noting that it did not.
    sys.keyWhy = bands[i]?.why ?? null;
    const from = edges[i];
    if (from === null) continue;
    const space = sys.staff.space;
    // WHICH key, read off this system's OWN band and not off the trimmed one.
    //
    // The trim exists to keep a suppression narrow and it acts on the count the
    // PAGE agreed, so a system that over-read comes out of it holding a prefix
    // of what it saw. A prefix of a key signature is a valid key signature —
    // three sharps trimmed from five still reads F, C, G in order — so reading
    // the trimmed band would turn an over-read into a confident wrong answer
    // that the order test cannot see. The untrimmed band is what this system
    // actually found, readKeySignature refuses it if it is not a signature, and
    // agreeKey then does the cross-system arithmetic on ANSWERS rather than on
    // extents. Two agreements about two different things, kept apart.
    sys.key = readKeySignature(bands[i]?.band, bands[i]?.at, space, clefs[i].clef);
    const key = trimKeyBand(bands[i]?.band, agreed);
    sys.keyBand = key;
  }

  // HOW FAR THE PAGE'S SIGNATURE REACHES, for the systems whose own band stopped
  // inside it.
  //
  // The band scan can end in the middle of a printed sharp, and when it does the
  // right-hand half of the glyph is outside the suppression and gets circled. It
  // is the whole of the residual the user reports as false circles on the key
  // signature: `npm run scan:key-why` names the cause on every one of them —
  // the Concerto's systems 5, 7 and 11 return bands 0.40, 0.40 and 0.81 staff
  // spaces wide where the same page's readable systems return 1.39, and the
  // Bach's system 3 returns no band at all while its neighbours return 1.14 to
  // 1.16. Cropped, the Concerto's narrow bands are not the sharp read short:
  // they are the treble clef's own trailing ink, and the sharp stands fifteen
  // pixels further right untouched.
  //
  // A key signature is printed at the same distance past every system's left
  // end, so the systems that read one know how far it reaches. See
  // agreeKeyReach in scan-key.js for why this is not the cross-system voting
  // that is measured and dead, and for the safety argument that replaces the
  // invariant it breaks.
  //
  // TWO GATES, and the second one is what keeps this off the synthetic corpus.
  // agreeKeyReach itself needs MIN_KEY_WITNESSES systems to have read a key;
  // this additionally refuses a page whose systems did not AGREE on one. A
  // corpus page is bare staves with music where the furniture would be, a clef
  // is often named on one anyway, and two such systems inventing a signature
  // out of their first notehead is exactly the shape that would reach a
  // suppression into the music on all six. Measured: the reach is null on every
  // page of CORE, HARD, SIZES and FEW, so this never fires there at all.
  const pageKey = agreeKey(found.map((sys) => sys.key));
  const reach = pageKey.key
    ? agreeKeyReach(found.map((sys, i) => (edges[i] === null ? null : {
      key: sys.key,
      reach: (sys.keyBand ? sys.keyBand.x1 - edges[i] : NaN) / sys.staff.space,
    })))
    : null;

  for (const [i, sys] of found.entries()) {
    const from = edges[i];
    if (from === null) continue;
    const space = sys.staff.space;
    const key = sys.keyBand;
    if (!clefs[i].clef) continue;
    // ONE range, from the stave's left end to whichever of the two bands ends
    // further right, because the key signature is printed hard against the clef
    // and there is nothing between them.
    //
    // The version this replaces wrote `wide = key.x1 - from`, which REPLACED the
    // clef band's width with the key band's end rather than taking whichever is
    // greater — so a system whose signature was read narrow suppressed LESS than
    // the clef band alone, and the clef went back to being circled. Taking the
    // greater is wider than that was, so it was measured both ways before it
    // was kept, and the two are indistinguishable: identical on all three marked
    // pages and on every page of the corpus, CORE and HARD alike. The furthest
    // right this can reach is still whatever ink this system printed, since
    // findKeyBand's every bound is measured off that ink.
    //
    // …AND WHICHEVER OF THOSE THE PAGE ITSELF REACHES, which is the only bound
    // here not measured off this system's own ink. WIDEN ONLY: a system whose
    // own band already reaches further keeps it, so no system can lose
    // suppression to the page's agreement and this cannot narrow anything.
    // A BAND THE READER COULD NOT NAME A KEY FROM STILL SUPPRESSES.
    //
    // This read `key && !key.cut ? key.x1 : 0` for part of one night, on the
    // argument that a band good enough to name a key is good enough to suppress
    // and nothing else is. findKeyBand marks a band `cut` when its scan stopped
    // on a speck or ran out of reach, readKeySignature refuses such a band
    // outright, and it seemed to follow that the suppression should too.
    //
    // IT DOES NOT FOLLOW, AND THE COST IS LARGE. The two questions are not the
    // same question. Naming a key from a signature cut short is dangerous
    // because a prefix of a key signature is a valid key signature — four sharps
    // cut to two reads as D major and puts a semitone on the wrong notes.
    // Suppressing a notehead inside a band cut short is not dangerous at all: it
    // covers less of the furniture than it should, and covering less is the
    // failure it was supposed to prevent.
    //
    // MEASURED, over every signature from none to seven, in both clefs, both
    // sharps and flats — six systems and forty-eight plain crotchets each, which
    // is a test the three marked pages cannot perform because all three are in
    // ONE SHARP. False circles standing on the furniture, summed over the four
    // clef-and-kind combinations:
    //
    //   accidentals in the signature   0   1   2   3   4   5   6   7
    //   with the cut gate             28  41  45  72  96 132 120 144
    //   without it                    16  11  15  30  36  66  60  78
    //
    // It doubles them at every length. A long signature is exactly the one whose
    // band runs out of reach, so the gate switches the suppression off precisely
    // where there is most to suppress — and every number that said the gate was
    // free came from three pages whose signature is one sharp and whose bands are
    // not cut.
    //
    // The danger it was added for is real and is NOT fixed by this gate: a
    // phantom band on a signature-less stave can still reach into the first bar.
    // Measured, A/B: the count of heads a band's own scan reaches is identical
    // with the gate and without it — 13 of 1320 in tools/key-safety-check.mjs —
    // because those bands end cleanly and were never `cut` in the first place.
    // The gate cost a great deal and bought nothing. That residual is a separate
    // open problem and belongs to `column()`'s measurement window, not here.
    const usable = key ? key.x1 : 0;
    const lo = from;
    const hi = Math.max(
      from + Math.max(3, space * CLEF_WIDE),
      usable,
      reach === null ? 0 : from + reach * space,
    );
    sys.heads = sys.heads.filter((head) => head.x < lo || head.x > hi);
  }
  return reach;
}

// Noteheads by SHAPE, not by connected components. A beamed page fuses heads,
// stems and beams into one blob per group — flood fill returns the pencilled
// fingerings, which is exactly the wrong thing to find. A notehead is instead a
// solid ellipse about a staff space tall and half again as wide, with white
// above and below it; a beam is thinner, a stem far narrower, a slur thinner
// still.
// The head geometry, built once and shared.
//
// findHeads inlines its own loops for speed, but the SHAPES it measures — the
// ellipse, the rim band, the core — are the definition of a notehead in this
// reader, and a second copy of them in a diagnostic tool would drift from the
// first the day either changed. So they are built here and both use them.
export function headShapes(space) {
  const hw = Math.max(2, Math.round(space * 0.62));
  const hh = Math.max(2, Math.round(space * 0.45));
  const inside = [];
  const rim = [];
  const core = [];
  for (let dy = -hh; dy <= hh; dy++) {
    for (let dx = -hw; dx <= hw; dx++) {
      const d = (dx / hw) ** 2 + (dy / hh) ** 2;
      if (d <= 1) inside.push([dx, dy]);
      if (d >= 0.62 && d <= 1.3) rim.push([dx, dy]);
      if (d <= 0.25) core.push([dx, dy]);
    }
  }
  return { hw, hh, inside, rim, core };
}

// Why is there no notehead here?
//
// A crop says a notehead is at x,y and the reader drew no ring on it. This says
// which test turned it down and by how much — the fill it scored, what its rim
// and core came to, how far its ink runs sideways. Every head test in this file
// was written against a page where it mattered, and without this the only way
// to find out which one is firing is to guess and re-measure the whole page.
//
// Mirrors findHeads in the same order, using the same shapes. Verified against
// it by tools/head-probe.mjs, which checks that the points the reader DID find
// come back "accepted".
export function headProbe(ink, w, h, space, gray, background, x, y) {
  const { hw, hh, inside, rim, core } = headShapes(space);
  if (x < hw + 1 || x >= w - hw - 1 || y < hh + 1 || y >= h - hh - 1) {
    return { accepted: false, verdict: 'off the page' };
  }
  const solidCentre = ink[y * w + x];
  const inner = Math.max(1, Math.round(hw * 0.78));
  const leftInk = ink[y * w + x - hw] || ink[y * w + x - inner];
  const rightInk = ink[y * w + x + hw] || ink[y * w + x + inner];
  const out = { solidCentre: !!solidCentre, leftInk: !!leftInk, rightInk: !!rightInk };
  if (!solidCentre && !(leftInk && rightInk)) {
    return { ...out, accepted: false, verdict: 'not a candidate: centre is paper and there is no ring either side' };
  }
  let filled = 0;
  for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
  out.fill = +(filled / inside.length).toFixed(3);
  let rimInk = 0;
  for (const [dx, dy] of rim) rimInk += ink[(y + dy) * w + x + dx];
  let coreInk = 0;
  for (const [dx, dy] of core) coreInk += ink[(y + dy) * w + x + dx];
  let paper = 0;
  for (const [dx, dy] of core) {
    const at = (y + dy) * w + x + dx;
    if (gray[at] >= background[at] - 6) paper += 1;
  }
  out.rim = +(rimInk / rim.length).toFixed(3);
  out.core = +(coreInk / core.length).toFixed(3);
  out.paper = +(paper / core.length).toFixed(3);
  let solid = out.fill >= 0.86;
  let hollow = false;
  if (!solid && out.fill >= 0.3 && out.fill < 0.86) {
    if (out.core >= 0.9 && out.fill >= 0.8) solid = true;
    const ring = out.rim >= 0.68 && out.core <= 0.42;
    hollow = ring && out.paper >= 0.7;
    if (ring && !hollow) solid = true;
  }
  out.solid = solid;
  out.hollow = hollow;
  if (!solid && !hollow) {
    return { ...out, accepted: false, verdict: out.fill < 0.3 ? 'too little ink to be a head'
      : 'rim or core failed: not solid enough, not ring enough' };
  }
  let across = 1;
  for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
  for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
  out.across = +(across / space).toFixed(2);
  if (across > space * 2.6) return { ...out, accepted: false, verdict: 'ink runs too far sideways — a beam, not a head' };
  // THE WIDTH FLOOR IS THE PAGE'S DECISION AND THIS PROBE CANNOT MAKE IT.
  //
  // findHeads does not reject a narrow candidate here. It collects every
  // survivor, asks the page how wide its own noteheads are — the low quartile of
  // what the shape tests accepted, times HEAD_WIDE_SHARE — and applies THAT.
  // The comment there says so in as many words: "The width floor is not applied
  // here. It is applied below, against a width this page measured for itself."
  //
  // This probe applied the constant instead, and the constant is exactly what
  // that measurement replaced because it cannot be right twice: noteheads run
  // 1.0 spaces wide on a photographed flute part and 1.24 on a Bärenreiter Bach.
  //
  // SO THE PROBE HAS BEEN LYING, and about a lot: measured with
  // tools/head-probe.mjs, which exists to check that the points the reader DID
  // find come back `accepted`, it agreed with findHeads on 262 of 455 heads on
  // the photographed page. One hundred and ninety-three heads the reader
  // accepted were reported as "ink too narrow for a head — a stem or a speck",
  // with a fabricated reason, by the tool the handover calls the fastest-paying
  // in the project. Anybody asking `npm run scan:why` why a head was rejected
  // was being told about a test that no longer runs at this point.
  //
  // A per-point probe has no page to ask, so it reports the width and says who
  // decides. That is the honest answer and it is also the useful one: `across`
  // is printed either way, and the caller can compare it to the page's own floor.
  out.floor = 'the page decides — see HEAD_WIDE_SHARE in findHeads';
  out.narrowFor = +(1 * HEAD_WIDE_FLOOR).toFixed(2);
  if (solid && across < space * HEAD_WIDE_FLOOR) {
    return {
      ...out,
      // ACCEPTED, with a caveat — the shape tests passed and only the page-level
      // width floor is in doubt. A caller testing `verdict === 'accepted'` would
      // read this as a rejection, which is why the boolean exists.
      accepted: true,
      verdict: `accepted by shape; ${out.across} spaces across is under the`
        + ` ${HEAD_WIDE_FLOOR}-space fallback floor, so whether findHeads keeps it`
        + ' depends on the width this page measured for itself',
    };
  }
  return { ...out, accepted: true, verdict: 'accepted' };
}

// Notes found by their STEMS, for the ones the shape tests never offer.
//
// The shape tests scan for ellipses and the classifier judges what they find,
// so a note the scan never proposes cannot be recovered by any amount of
// judging: measured, the Mozart's recall of 89% was EXACTLY the number of real
// candidates the scan produced, meaning the classifier was losing none of them
// and every missing note was one that was never offered.
//
// A stem is the way back to them. It is the easiest thing on a page to find —
// a thin vertical run, and nothing else on a stave is thin and vertical and
// three spaces long — and it points at its own notehead: an engraver puts the
// head at one end of it, on the left of a stem that goes up and the right of
// one that goes down. Measured on the two marked pages, 76% of the Mozart's
// missing notes and 60% of the Bach's have a stem of two spaces or more
// standing next to them.
//
// This costs nothing in precision because it does not accept anything. It
// PROPOSES, and the classifier decides, which is the same division of labour
// that made showing it the stem worth doing in the first place.
// A NOTEHEAD HAS A BODY. A STEM CROSSING A STAFF LINE HAS ONLY THE TWO STROKES
// IT IS MADE OF, and until this was written the reader could not tell them
// apart.
//
// HOW IT WAS FOUND, because the method is the point. `scan:bars-believed` has
// reported "251 of the 943 circles on these clean pages are NOT printed
// noteheads" for weeks and nothing could say WHICH 251. Tallying them by the
// `via` field every head already carries answers it in one line:
//
//   proposed by   real heads   circles on nothing
//   shape             692              0
//   stem                0            251
//
// Every one. Drawn — the engraved page with every circle on it, green for a
// printed head and red for the rest — all 251 sit exactly where a stem crosses
// a staff line. The classifier scores that little cross of ink 0.95 and over,
// which is the judging failure the note above STEM_CUT records.
//
// WHY IT IS NOT A SIXTH GEOMETRIC VETO OF STEM ENDS. Every rule that failed
// before asked about the STEM — which end already has a head, how far down it
// the proposal fell, whether the run was long enough to hold two notes — and
// each surrendered a real note printed at the far end of a shared column of
// ink. This asks about the CANDIDATE'S OWN INK: on the rows that are not the
// staff line, is there anything across here wider than the stem? A notehead is
// a filled ellipse a space and a bit across and answers yes; a crossing is two
// thin strokes and answers no. It runs on the STEM PASS ONLY, so it cannot move
// a single mark the shape tests made.
//
// SWEPT, on the Scanned score, which is the one page whose stem pass does real
// work (37 rescued notes of its 412):
//
//   STEM_BODY   Scanned P / R      stem pass: real / invented
//     none       91.5 / 99.5             37 / 18
//     0.15       91.7 / 99.3             36 / 17
//     0.22       91.8 / 98.3
//     0.30       91.8 / 98.3
//     0.45       94.8 / 92.5              8 /  1
//
// 0.45 is the value that reads like the right one and it costs twenty-nine real
// notes — seven points of recall on the page a user photographed. Rule 2 allows
// three tenths, so it is 0.15, and 0.15 is nearly inert on a photograph: at a
// 9.6px staff space a head and a line-crossing are four pixels apart and three,
// and no bound separates them. `scan:import`, which reads the same three pages
// at the 6px space a phone actually delivers, is byte-identical with this in
// and out — 51.4%, 544 of 1059.
//
// THIS FLOOR IS NO LONGER THE ONLY ONE, and the sentence that used to end this
// paragraph — "THE TEST CANNOT HURT A PHONE SCAN BECAUSE AT THAT SIZE IT DOES
// NOT FIRE" — is no longer true and was only ever half the story. An absolute
// number in staff spaces cannot be right at both ends of the scale: 0.15 is
// inert at a 6px space, and at a 12px space a STEM binarises to two pixels,
// which is 0.17 spaces, which is OVER it. So the test passed a bare stem on a
// clean page while doing nothing at all on a photograph. See STEM_BODY_SHARE,
// which puts a second floor on top of this one taken from the width this page's
// own heads measure; that one DOES fire at a phone scale, and recall survives
// there because the heads the stem pass rescues on a photograph are heads and
// heads are wide. This constant stays underneath it as the fallback for a page
// with too few solid heads to measure.
//
// WHERE IT DOES ITS WORK IS CLEAN PAPER, which is what a PDF import produces
// and what every synthetic corpus here is made of. `scan:bars-believed`, the
// 32 engraved studies:
//
//                                        before      after
//   circles on nothing                251 of 943   67 of 759
//   printed heads found               692 of 692  692 of 692
//   BARS BELIEVED                       6 of 200    52 of 200
//   …and IS ONE PRINTED BAR             2 of 6      52 of 52
//   values right inside a believed bar 20 of 24    187 of 187
//
// That third row is the one CLAUDE.md calls the number that matters, and the
// fourth says the bars it now believes are bars rather than a looser glue.
// `scan:corpus`, `scan:sizes` and `scan:few`: recall stays 100% on every page
// of all three and precision rises on nearly all of them — `faint` 121 circles
// for 120 notes becomes exactly 120, `clean28` 83% precision becomes 99%.
// `scan:bars`, `scan:clef` and `scan:clef-hard` are byte-identical. Keys are
// untouched: `scan:key-read` still reads 0 signatures as the wrong key,
// `scan:key-gate` and `scan:key-safety` pass. `scan:steps` moves by one note on
// the Scanned page (278 right of 303 to 277) and not at all on the other two.
//
// AND THE PAIRING, which is what a player sees. `scan:align`, 2672 played notes
// over 128 takes: 94.8% land on the right notehead against 97.5%, notes landing
// on the WRONG head fall from 124 to 43, and takes marking a squeak nobody
// wrote fall from 53 of 64 to 38. Eight more played notes come back unmarked,
// which is the price.
//
// WHAT IT COSTS, WRITTEN DOWN RATHER THAN BURIED. `npm run scan:floor` asks
// whether a take is even this piece, and it got worse: of 128 takes played from
// a DIFFERENT study, 116 were refused and 79 are. (An earlier version of this
// note said 117 and 83; it added the takes the ENOUGH gate refused to the ones
// the floor refused by hand instead of reading the tool's own `WRONG pairings
// that survive` line, which is the number.) Thirty-seven takes changed side and
// they did NOT all change for the same reason — the two mechanisms were
// separated by dumping every crossing's verdict in both states and diffing,
// because "the corpus is made of scales" is a story until it is counted:
//
//   was          is now       n
//   refused      survives    31    scored under the floor before, over it now
//   unscorable   survives     7    the ENOUGH gate used to refuse these outright
//   survives     refused       1
//
// THE 31 ARE THE CORPUS AND NOT THE READER. 46 of the 49 survivors are
// same-key, same-clef crossings, and the moves are the family the note above
// FLOOR in scan-view.js already writes down as blind BY CONSTRUCTION: A major
// arpeggio against A major scale 0.39 to 0.79, A minor arpeggio against A minor
// scale 0.40 to 0.71, C major scale against A minor arpeggio — a relative minor
// — 0.64 to 0.91. Every note of those takes really is on that page in that
// order. The phantom circles were suppressing the score by injecting
// disagreement into it, so part of the old 117 was the reader being wrong twice
// and getting the right answer.
//
// THE 7 ARE A DIFFERENT THING AND ARE NOT COVERED BY THAT ARGUMENT. Twenty-two
// wrong pairings used to have too few JUDGEABLE marks to be scored at all,
// because their marks were landing on phantom circles the page never priced,
// and the ENOUGH gate refused them for it. With the phantoms gone those marks
// land on priced heads, all but three of the 22 now reach the floor, and 7 get
// past it. That is a guard which was doing load-bearing work by accident and is
// now gone, and no amount of "the studies are all scales" explains it away.
//
// WHAT THE REMAINING 67 ARE. `npm run scan:bars-believed -- --shots <dir>`
// draws them, and on the A major scale the four survivors sit where a stem
// crosses a LEDGER line rather than a staff line. `staff.lines` holds the five
// printed lines and nothing else, so those rows are not excluded and a ledger
// line is wide enough to look like a body. The obvious extension is to exclude
// ledger rows too, and it is NOT free: 176 of the 692 heads on these pages are
// ledger notes, and excluding the line a head sits on is exactly what makes
// this test blind at a six-pixel space. It has not been measured, so it has not
// been done.
//
// PART OF IT HAS SINCE BEEN TAKEN BACK, and the lever is one this change
// created: with the phantoms gone a wrong take also MARKS LESS OF ITSELF, so
// COVERAGE separates the two where it could not before. `COVER_FLOOR` in
// scan-view.js is that test and it recovers 7 — 42 wrong takes survive now
// rather than 49 — at no cost to a right take at any read quality. The
// measurement that set it is `scan:floor --miss`, which this round added: the
// value the clean corpus alone would have chosen, 0.9, refuses EVERY right take
// on a page half of whose noteheads were never found. NONE of the 7 the ENOUGH
// gate used to catch are among the 7 recovered. Those are still open.
const STEM_BODY = 0.15;   // staff spaces of ink across, off the line

/**
 * The widest run of ink within a staff space of `cx`, on the rows around `cy`
 * that are NOT part of a staff line, in staff spaces.
 *
 * Exported for `tests/stem-body.test.js` and for nothing else — it is a test on
 * a candidate, not a way to read a page. Same reason `headProbe` and `barProbe`
 * are out here.
 *
 * The line's own rows are found by walking out from where the line is printed
 * for as long as the ink holds, rather than by a fixed thickness — a scanned
 * line is two rows at a ten-pixel staff space and one at six, and excluding a
 * fixed band takes the head's body with it at the small end. That is the way
 * this test could fail on exactly the pages a player scans, so it is measured
 * from the ink instead of assumed.
 */
export function bodyAcross(ink, w, h, staff, stripW, space, cx, cy) {
  const lineAt = (index) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(cx / stripW)))
  ];
  // The rows the printed lines occupy at this column, from the ink itself.
  const onLine = new Set();
  const most = Math.max(1, Math.round(space * 0.3));
  for (let k = 0; k < 5; k++) {
    const ly = Math.round(lineAt(k));
    if (!Number.isFinite(ly)) continue;
    onLine.add(ly);
    for (let d = 1; d <= most && ly - d >= 0 && ink[(ly - d) * w + cx]; d++) onLine.add(ly - d);
    for (let d = 1; d <= most && ly + d < h && ink[(ly + d) * w + cx]; d++) onLine.add(ly + d);
  }
  const reach = Math.max(1, Math.round(space * 0.45));
  const side = Math.max(1, Math.round(space));
  let widest = 0;
  for (let dy = -reach; dy <= reach; dy++) {
    const y = cy + dy;
    if (y < 1 || y >= h - 1 || onLine.has(y)) continue;
    let run = 0;
    for (let x = Math.max(0, cx - side); x <= Math.min(w - 1, cx + side); x++) {
      run = ink[y * w + x] ? run + 1 : 0;
      if (run > widest) widest = run;
    }
  }
  return widest / space;
}
const STEM_TALL = 2;      // staff spaces; shorter than this is a flag or a bar
const STEM_WIDE = 0.35;   // staff spaces; wider than this is not a stem
const STEM_HUNT = 0.5;    // how far around the proposal to look for the best fit
// A HIGHER BAR than the scan's own candidates, because these scores are the
// best of a hundred-odd positions rather than the score at one. Taking the
// maximum over a neighbourhood biases it upward — somewhere in a square of
// paper there is always a spot that scores well — so judging a max-selected
// candidate at the same cut as a single-position one accepts a great deal of
// nothing. Measured at 0.4 it read the Mozart's recall up three points and its
// precision down twenty-one.
//
// AND IT IS THE ONE CONSTANT IN THIS FILE THAT NO HONEST MEASUREMENT COVERS,
// which is worth understanding before anyone retrains the classifier.
//
// HEAD_CUT below is chosen from the cross-page table that npm run scan:train
// prints — trained on some pages, scored on a page held out. This one cannot
// be, because npm run scan:patches dumps with the judge OFF and stemHeads only
// runs with the judge ON, so not one stem-pass candidate has ever appeared in
// pages/patches.json. There is no held-out table for it. 0.95 was read off the
// bench, on the three pages the shipped weights are fitted to, and it is a
// point in the extreme tail of one particular model's score distribution.
//
// That makes it fragile in a way a threshold on a fixed measurement is not. The
// three marked pages were re-dumped and the model refitted over all three (see
// the long note in head-model.js), and the stem pass fell over: on the Scanned
// score it reads 48 real / 14 invented with the shipped weights and 26 / 22
// with the refit, which is 22 real notes — most of that page's whole regression.
// Swept, with the refit installed, mean precision / mean recall over the three
// marked pages against 92.12 / 93.98 for what is shipped here:
//
//   STEM_CUT   mean P / mean R    Scanned stem pass (real / invented)
//     0.80      85.42 / 93.10          37 / 89
//     0.90      88.53 / 92.73          32 / 45
//     0.95      89.99 / 92.09          26 / 22
//     0.98      90.87 / 91.15          16 /  7
//     0.99      91.15 / 90.93          13 /  4
//
// No value of it recovers what a different set of weights took away, and the
// best joint attempt — HEAD_CUT 0.5 with STEM_CUT 0.85 — reads 89.34 / 92.92,
// still below both halves of the baseline. The proposal that has not been built
// is to stop carrying a number at all and ask the page: the bar for a
// max-selected candidate should be a quantile of what this same model says
// about the heads the shape pass ALREADY accepted on this page, which moves
// with the model instead of being invalidated by it.
const STEM_CUT = 0.95;
// How long a vertical run can be and still be ONE stem, in staff spaces.
// Above this the run has gone through more than one object and both of its ends
// may be real noteheads — see the note in stemHeads on `oneStem`.

// HOW MUCH OF A HEAD'S OWN WIDTH A STEM-END PROPOSAL HAS TO SHOW.
//
// STEM_BODY is an absolute floor in staff spaces and its own note says what is
// wrong with it: "0.15 is nearly inert on a photograph: at a 9.6px staff space
// a head and a line-crossing are four pixels apart and three, and no bound
// separates them." That is true, and it is also true the other way round — at
// a 12px space a STEM binarises to two pixels, which is 0.17 spaces, which is
// over the floor. So the test passes a bare stem on a clean page and fails to
// fire at all on a photograph: the one absolute number cannot be right at both
// ends, which is the argument HEAD_WIDE_FLOOR already makes about head widths
// a few hundred lines below.
//
// The page has hundreds of heads on it and `findHeads` has already measured how
// wide they are, for exactly this reason. A share of that is a floor that means
// the same thing at every scale: a notehead is a filled ellipse a space and a
// bit across, a stem is a fifth of a space, and half a head's width is nowhere
// near either boundary. The absolute floor STAYS underneath it — a page with
// too few solid heads to measure falls back to it — so this can only ever
// tighten and never loosen.
//
// SWEPT. `scan:bars-believed` (32 engraved studies), `scan:import` (the three
// photographed pages), `scan:align` (2672 played notes over 128 takes), and the
// synthetic minims of `score:heads`:
//
//   share   circles on   bars      import   align: right head /   Scanned
//           nothing      believed  recall   wrong / squeaks       step RIGHT
//    off      67          52/200    53.4%   97.5% / 43 / 38       277  92.3%
//    0.35     67          52/200    53.4%   97.5% / 43 / 38       —
//    0.40     19          99/200    53.4%   98.9% / 18 / 12       273  92.2%
//    0.45     19          99/200    53.4%   98.9% / 18 / 12       273  92.2%
//    0.50     19          99/200    53.4%   98.9% / 18 / 12       265  92.0%
//    0.65     18          99/200    53.4%   98.9% / 18 / 12       —
//    0.80     18          99/200    53.4%   98.9% / 18 / 12       —
//
// The whole of the corpus gain arrives between 0.35 and 0.40 and does not move
// again. 0.80 starts taking real minims off the synthetic pages for nothing.
//
// 0.5 AND NOT 0.4 IS A TRADE AND IS NOT COVERED BY THE RULE, so it is written
// here as what it is rather than argued into being free.
//
// 0.4 buys the whole corpus gain and costs less. What it does not do is finish
// the job this was written for: the crotchet and clutter pages of `score:heads`
// still come back with 25 circles on nothing at 0.4 and with none at 0.5. Those
// pages draw a bare stem three spaces long with nothing on the end of it, and
// they are the only fixture in the repo that isolates this failure mode — every
// other page has beams, clutter, ledger lines and a photograph's blur mixed
// into it, so nothing else can say whether the test refuses a bare stem or
// merely refuses most things. Keeping that fixture honest is what the extra
// tenth is spent on.
//
// WHAT IT SPENDS. `npm run scan:steps` on the Scanned photograph: 446 circles
// become 424 and the marks that read the right STEP fall from 277 to 265 —
// 92.3% to 92.0%. Twelve marks, on a page a user actually photographed, and
// rule 2's whole allowance for one page is three tenths. At 0.4 it is 273 and
// 92.2%, so eight of those twelve are bought back by the lower value. Bach and
// Mozart are identical to the mark at both (325 found / 229 right, 341 / 210),
// `scan:import` recall is byte-identical on all three pages at every value
// swept, `scan:clef` does not move (18 of 26 changes, debt 129), and `scan:bars`
// loses one system of 72 that had every bar right and none invented — 66 to 65,
// mean recall 100% either way.
//
// The file's own priority says a missing note breaks an alignment and an extra
// circle is cosmetic, and by that priority 0.4 is the better number. It is not
// chosen because the pages those twelve marks are traded for are the only ones
// that can catch this test failing, and a test nothing checks is a test that
// rots. `scan:align`, which is the pairing a player actually sees, does not
// move between the two. If a photographed page ever needs the twelve marks
// back, 0.4 is one edit away and this table is why.
//
// WHAT IT BUYS, and BARS BELIEVED is the row CLAUDE.md calls the number that
// matters: 52 of 200 becomes 99 of 200, every one of the 99 still exactly one
// printed bar with none wrong, and the values inside a believed bar go from
// 187 of 187 to 363 of 363. Twenty of the 32 pages now have values believed at
// all, against eleven. The phantom circles fall from 67 to 19 while all 692
// printed heads are still found — the stem pass on these pages proposed 67
// circles and 0 real notes, so what is being thrown away is its entire output
// there and none of anybody else's.
//
// WHAT IT COSTS, which on the corpus is nothing measurable. `scan:import` is
// byte-identical at every value swept — 53.4%, 565 of 1059, Mozart 81.1% and
// Scanned 72.6% — so the 37 notes the stem pass rescues on the photographed
// page are all still rescued: their bodies are heads and heads are wide.
// `scan:corpus` holds its 89% photo mean and its 91% few mean, and two of its
// pages get PRECISION back (few3 37 circles for 36 notes becomes 36, few6faint
// 74 for 72 becomes 72). `scan:align` improves on every column: 97.5% of played
// notes on the right head becomes 98.9%, notes on the WRONG head fall from 43
// to 18, unmarked from 24 to 12, and takes ringing a squeak nobody wrote from
// 38 of 64 to 12 of 64.
//
// The other place it shows is the synthetic minims of `score:heads`, where ten
// of the fifty are found by the stem pass rather than the shape pass and go with
// it. Those pages draw a ring with a bare stem and nothing else; on every real
// page in the corpus the shape pass finds the hollow heads itself.
//
// AND THE CLASSIFIER WAS TRIED FIRST, because the note above `stemHeads` says
// that is where this belongs. The two-judge gate is applied to the shape pass
// and stops there, so the one pass that produces every phantom is the one pass
// the better judge never sees — which looked like the whole answer. Asking
// `headScoreMlp` as a veto on stem-end proposals at the same 0.15 the shape
// pass uses: the 25 circles on the crotchet page stayed at 25, and ten of the
// fifty real minims went. It removes what should be kept and keeps what should
// go, which is what a judge trained mostly on drawn pages does with a patch of
// bare stem. That experiment is written down because the file predicted the
// opposite, and because it is the reason a geometric test earns its place here.
const STEM_BODY_SHARE = 0.5;

function stemHeads(ink, w, h, staff, space, gray, background, taken, headWide = 0) {
  // In staff spaces, and never below the absolute floor.
  const bodyFloor = Math.max(STEM_BODY, (headWide / space) * STEM_BODY_SHARE);
  const found = [];
  const stripW = w / staff.lines[0].at.length;
  const tall = Math.round(space * STEM_TALL);
  const wide = Math.max(1, Math.round(space * STEM_WIDE));
  const top = Math.max(1, Math.round(staff.lines[0].mid - space * 7));
  const bottom = Math.min(h - 2, Math.round(staff.lines[4].mid + space * 7));
  const near = (x, y) => taken.some((k) => Math.abs(k.x - x) < space * CLUSTER_X
    && Math.abs(k.y - y) < space * CLUSTER_Y);
  // ONE HEAD PER STEM END, asked before the hunt rather than during it.
  //
  // `near` above vetoes a PIXEL, and that is the wrong shape of veto. The hunt
  // takes the maximum score over a square of a staff space, so when the shape
  // pass has already found this stem's notehead the square is mostly inside its
  // cluster box — and instead of concluding that this stem already has its
  // head, the hunt simply slides to the edge of the box and reports the best
  // score it is ALLOWED. What comes back is an empty ring standing on the bare
  // stem, roughly a space below a notehead that is already correctly circled.
  //
  // Looked at: `CROP_MARKS=1 CROP_TRUTH=pages/truth/scanned.truth.json npm run
  // scan:crop -- "Scanned score.pdf" 749,937` and the same at 839,522 and
  // 1203,1478 — a beamed group with its heads on top, every head ringed with
  // its truth dot on it, and one more empty ring partway down a stem.
  //
  // So the question is asked of the stem END, at the point the proposal is
  // aimed at, and if a head is already standing there nothing is proposed.
  //
  // THE BOUND IN X IS TIGHT AND THE REASON IS NOT PRETTY. A chord of a third is
  // two heads one space apart in y at the SAME x, which is geometrically the
  // same picture as a phantom — so this cannot separate them and no rule of
  // this shape can. The Scanned score prints exactly one such third, at
  // 609,353 and 613,344, and its two heads are four pixels apart in x at a
  // staff space of 9.6. Everything the veto is aimed at is nearer than that in
  // x, because it is the same stem. Swept, with mean precision / mean recall
  // over the three pages against a baseline of 91.59 / 93.70:
  //
  //   |dx| < 0.30, |dy| < 2.0    91.86 / 93.70    4 circles gone, no note lost
  //   |dx| < 0.45, |dy| < 2.0    92.05 / 93.63    7 gone, the third goes too
  //   |dx| < 0.60, |dy| < 2.0    92.05 / 93.63    the same seven, the same loss
  //   round radius 1.2 spaces    91.85 / 93.63    4 gone, the third goes too
  //   round radius 1.4 spaces    91.98 / 93.56    6 gone, and a second note
  //
  // Three extra circles are not worth a note, so it is 0.30 — and 0.30 is a
  // number this page measured rather than a principle, which is why it is
  // written down here with the pair that set it. A page whose chords are
  // printed less squarely will want it looser and will pay a note for it.
  //
  // ALSO MEASURED AND DEAD: sparing a chord by putting a FLOOR under |dy| as
  // well — veto only a head 1.15 to 2.5 spaces away, on the theory that a chord
  // stacks in thirds and a phantom sits further down the stem. It loses three
  // real notes and removes no more circles than the tight bound does
  // (90.9 / 90.7 on the Scanned score against 91.0 / 91.4).
  const STEM_OWN_X = 0.30;
  const STEM_OWN_Y = 2.0;
  const owned = (x, y) => taken.some((k) => Math.abs(k.x - x) < space * STEM_OWN_X
    && Math.abs(k.y - y) < space * STEM_OWN_Y);

  for (let x = wide + 1; x < w - wide - 1; x++) {
    let y = top;
    while (y <= bottom) {
      if (!ink[y * w + x]) { y++; continue; }
      let end = y;
      while (end < bottom && ink[(end + 1) * w + x]) end++;
      const run = end - y + 1;
      if (run < tall) { y = end + 1; continue; }
      // Thin, or it is a barline or the edge of something.
      let across = 1;
      const mid = Math.round((y + end) / 2);
      for (let k = x - 1; k >= 0 && ink[mid * w + k]; k--) across++;
      for (let k = x + 1; k < w && ink[mid * w + k]; k++) across++;
      if (across > wide) { y = end + 1; continue; }

      // A head at either end — except the end the BEAM is on.
      //
      // A stem runs from its notehead to whatever joins it to its neighbours,
      // so one end has a head and the other has a beam, and proposing at both
      // asks for a notehead in the middle of a beam once per note. On the
      // synthetic corpus, whose beamed groups are perfectly regular, that was
      // forty-odd spurious heads on a page.
      //
      // The beam end is the one with a long horizontal run across it, which is
      // the same measurement the ledger rule and the width test already use.
      const beamAt = (at) => {
        let run = 1;
        const reach = Math.round(space * 1.5);
        for (let k = x - 1; k >= 0 && ink[at * w + k] && run <= reach; k--) run++;
        for (let k = x + 1; k < w && ink[at * w + k] && run <= reach; k++) run++;
        return run > reach;
      };
      // A STEM HAS ONE NOTEHEAD — AND USING THAT COSTS MORE THAN IT SAVES.
      //
      // The user reported "many false circles still happen oftentimes in the
      // stem at the bottom", and a page drawn for the purpose reproduces it
      // exactly: plain crotchets, bare stems, no beams, no flags, no clutter,
      // and about a third of the stems carry a ring at the far TIP three spaces
      // from their own notehead. `owned` does not stop it, because `owned` asks
      // about the proposal point and the tip is three spaces from the head that
      // was found.
      //
      // An engraver puts the head at one end of a stem, so a stem whose head the
      // shape pass has already found should propose nothing at all. Written,
      // measured, and REVERTED — the trade is the wrong way round at every bound:
      //
      //   rule                                   Scanned precision / recall
      //   none (shipped)                              91.2 / 94.3
      //   one head per stem, any run length           91.8 / 91.4   -13 real notes
      //   …only when the run is <= 4.5 spaces         91.9 / 92.3
      //   …only when the run is <= 3.5 spaces         91.5 / 93.2
      //   …and taking only the better of two ends     90.7 / 93.2   worse on BOTH
      //
      // Every version buys a few tenths of precision and pays one to three
      // points of recall. What it takes is real: a column of ink through TWO
      // noteheads — two notes a third apart, an up-stem under a down-stem, a
      // stem crossing a ledger line into the head below — has a found head at one
      // end and a genuinely missing one at the other, and the rule surrenders
      // the second. A missing note breaks the alignment a take depends on and an
      // extra circle is cosmetic, so this is the trade this reader must not make.
      //
      // THE PHANTOM IS A JUDGING FAILURE, NOT A GEOMETRY ONE. The bare tip of a
      // stem scores 0.95 and over from the classifier, which is what admits it;
      // no arrangement of the ends fixes a judge that likes the wrong patch. It
      // belongs with the classifier — see the engraved-corpus work, where one
      // hidden layer over twenty thousand patches reads nine points of held-out
      // precision above the logistic fit — and not in a sixth geometric veto.
      //
      // THAT CONCLUSION HAS BEEN TESTED AND IS WRONG, and both halves of it
      // were. The classifier route was tried exactly as this paragraph
      // prescribes — the MLP asked as a veto on stem-end proposals, at the same
      // 0.15 the shape pass vetoes on — and it removed NONE of the 25 circles on
      // a page of bare crotchet stems while taking ten of the fifty real minims
      // beside them. And geometry did fix it: see STEM_BODY_SHARE, which cut the
      // engraved corpus's phantoms from 67 to 19 and nearly doubled the bars
      // that add up, with recall on all three photographed pages byte-identical.
      //
      // WHAT SEPARATES IT FROM THE FIVE ABOVE, since it is a sixth veto and they
      // were all reverted. Every one of those asked about THE STEM — which end
      // already has a head, how far down it the proposal fell, how long the run
      // was — and surrendered a real note printed at the far end of a shared
      // column of ink. STEM_BODY_SHARE asks what `bodyAcross` already asks, and
      // `bodyAcross` is the one test of this kind that survived: is the
      // CANDIDATE'S OWN INK as wide as a notehead on this page? Nothing about
      // the stem enters it, so nothing it refuses can be a head at the far end
      // of one.
      for (const [at, side] of [[y, 1], [end, -1]]) {
        if (beamAt(at)) continue;
        // This end already has its head. See the note on `owned` above.
        if (owned(Math.round(x + side * space * 0.5), at)) continue;
        let best = null;
        for (let dy = -Math.round(space * STEM_HUNT); dy <= Math.round(space * STEM_HUNT); dy++) {
          for (let dx = -Math.round(space * STEM_HUNT); dx <= Math.round(space * STEM_HUNT); dx++) {
            const hx = Math.round(x + side * space * 0.5) + dx;
            const hy = at + dy;
            if (hx < 1 || hx >= w - 1 || hy < 1 || hy >= h - 1) continue;
            if (near(hx, hy)) continue;
            const score = headScore(headPatch(gray, background, w, h, space, hx, hy));
            if (!best || score > best.score) best = { x: hx, y: hy, score };
          }
        }
        // …and it has to be a notehead rather than the place this stem crosses a
        // staff line. See STEM_BODY.
        if (best && best.score >= STEM_CUT
          && bodyAcross(ink, w, h, staff, stripW, space, best.x, best.y) >= bodyFloor) {
          found.push(best);
        }
      }
      y = end + 1;
    }
  }

  // One per place, strongest first — the same rule the shape tests use.
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of found) {
    if (kept.some((k) => Math.abs(k.x - c.x) < space * CLUSTER_X
      && Math.abs(k.y - c.y) < space * CLUSTER_Y)) continue;
    kept.push({ x: c.x, y: c.y, score: c.score, hollow: false, via: 'stem' });
  }
  return kept;
}

function findHeads(ink, w, h, staff, space, gray, background, judge = true) {
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
      // Up to the solid test's own floor, with no gap between them.
      //
      // This read `fill <= 0.82` against a solid test of `fill >= 0.86`, which
      // leaves a band where a candidate is neither: too inky to be offered to
      // the ring test, not inky enough to be called solid, and dropped without
      // any test having actually rejected it. On a photographed Mozart flute
      // part — greyer paper, a 10px staff space — real noteheads land in it.
      if (!solid && fill >= 0.3 && fill < 0.86) {
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
        // A SOLID HEAD WHOSE EDGES HAVE ERODED is still a solid head.
        //
        // `fill >= 0.86` asks the whole ellipse to be ink, and the whole
        // ellipse is the part a blurred, greyed, downscaled scan loses first —
        // the edges go pale, the threshold drops them, and a perfectly solid
        // notehead scores 0.77 to 0.84. Probed on a photographed Mozart flute
        // part, the heads that came back missing read `core 1` every time: the
        // middle completely inked, the rim eaten away.
        //
        // The middle is the robust half of the measurement, and it is also the
        // half that carries the meaning — a solid head is solid IN THE MIDDLE,
        // and a minim is exactly the same shape with the middle left white.
        // The `paper` test below is what tells those apart, and it is asked of
        // the same pixels, so nothing here can make a minim solid.
        if ((coreInk / core.length) >= 0.9 && fill >= 0.8) solid = true;
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
      //
      // WHAT THIS STILL DOES NOT CATCH, looked at rather than guessed:
      // tools/scan-crop cut the page open at four of the false heads and the
      // one below the stave on system 1 is a ring drawn in the white channel
      // BETWEEN two beams — ink above, paper in the middle, ink below, which is
      // a textbook minim except that the ink does not stop.
      //
      // Bounding the rim the way this bounds the middle row was written and
      // measured and changed nothing at all: 366 heads before and after, on the
      // page and on the corpus. So these are not being found as rings. They are
      // solid patches of a beam that beamMask took MOST of — the mask hunts a
      // horizontal run no taller than a notehead, and a stack of two is exactly
      // a notehead tall, so what it leaves behind at the join is a compact blob
      // whose middle row is short enough to pass this test honestly.
      //
      // The fix belongs in the mask, where the beam is, and not in another veto
      // here. It has not been made yet because beamMask decides note VALUES as
      // well, and changing it needs the values re-measured with it.
      let across = 1;
      for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
      for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
      if (across > space * 2.6) continue;
      // …and a notehead is not NARROWER than a notehead either.
      //
      // The upper bound has always been here: ink that runs on past a head's own
      // width is something the head is attached to. The lower bound was missing,
      // and it is the one that matters on a real page. A solid candidate whose
      // middle row is thinner than a notehead is a stem crossing a beam, the
      // dot of a fingering, a letter of the heading, the tip of a pencil bowing
      // — all of them dark, all of them convincingly round at the scale of an
      // ellipse two pixels smaller than they are.
      //
      // Only the SOLID branch is floored. A ring is judged by its rim and its
      // paper centre and has its own tests; measured on the corpus the same
      // floor applied to rings costs real minims and buys nothing.
      // The width floor is not applied here. It is applied below, against a
      // width this page measured for itself — see the note at HEAD_WIDE.
      if (solid && across < space * HEAD_WIDE_FLOOR) continue;
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
      // Which PASS proposed this — carried all the way out to the reports.
      //
      // The shape pass and the stem pass both drop their answers into the same
      // list, and a false circle in the finished reading says nothing about
      // which of them made it. That is not a detail: the two are tuned
      // separately, judged at different cuts, and a fix aimed at the wrong one
      // is a day spent moving a number that was never the number.
      scored.push({ x, y, score: quality + open, hollow, across, via: 'shape' });
    }
  }
  // HOW WIDE A NOTEHEAD IS ON THIS PAGE, asked of this page.
  //
  // A solid candidate narrower than a notehead is a stem crossing a beam, the
  // dot of a fingering, a letter of a heading. The floor for that was a constant
  // — 1.05 staff spaces — and a constant is exactly what cannot be right twice:
  // measured with tools/scan-why, the noteheads on a photographed Mozart flute
  // part run 1.0 spaces wide and the ones on the Bärenreiter Bach run 1.24. The
  // constant was fitted to the second and threw away the first, which is a
  // whole engraving's worth of notes rejected for being the size they were
  // printed.
  //
  // The page has hundreds of heads on it and they are all the same width, so it
  // can be asked. The low quartile of what the shape tests accepted is the
  // narrowest a head on this page honestly gets; three quarters of that is the
  // floor, which leaves room for the blur and keeps out a stem, since a stem is
  // a fifth of a space and no page draws heads four times narrower than each
  // other.
  //
  // Two passes over a list already in memory, and no second scan of the image.
  const widths = scored.filter((c) => !c.hollow).map((c) => c.across).sort((a, b) => a - b);
  const typical = widths.length >= 12
    ? widths[Math.floor((widths.length - 1) * 0.25)] * HEAD_WIDE_SHARE
    : space * HEAD_WIDE_FLOOR;
  const floor = Math.max(space * HEAD_WIDE_FLOOR, Math.min(space * HEAD_WIDE_CAP, typical));
  const wide = scored.filter((c) => c.hollow || c.across >= floor);

  // …and then asked, of each survivor, whether there is actually a notehead
  // there. See head-model.js: the shape tests find the candidates and this
  // judges them, which is the division of labour the measurements kept pointing
  // at — the reader localises well and judges badly.
  //
  // Applied AFTER the shape tests rather than instead of them, because the
  // shape tests are what keep the number of patches to score down to the
  // hundreds. Two hundred and fifty-six multiply-adds on four hundred
  // candidates is nothing; on every pixel of the page it would be a different
  // kind of program.
  // …AND A SECOND OPINION WHERE THE FIRST ONE IS UNSURE.
  //
  // head-model.js now carries two judges. The logistic fit that has always
  // shipped, and a twenty-four unit hidden layer trained on the three marked
  // pages plus a hundred and twenty pages that tools/engrave.mjs drew with real
  // Bravura and knows the answer to. Leaving one real page out and scoring it on
  // the page the model never saw, the second reads about NINE POINTS of
  // precision above the first — 77.4% to 95.6% on the held-out Concerto.
  //
  // IT CANNOT SIMPLY REPLACE THE FIRST, and that was measured before this was
  // written. In headScore's place it costs two to three points of recall on the
  // marked pages at every cut from 0.05 to 0.9, swept in eight combinations with
  // STEM_CUT: bench 92.5/95.2 becomes 89.7/92.6. It is trained mostly on drawn
  // pages and it refuses eroded printed heads that the logistic fit keeps — and
  // those heads are real, because all 162 of the photographed page's stem-foot
  // marks were cropped and looked at and only four were contamination.
  //
  // So it is asked ONLY about the candidates the logistic fit is unsure of, and
  // it can only ever say no. Above 0.95 the first judge is confident and the
  // second is not consulted; below HEAD_CUT the candidate is already gone.
  // Between them the second judge must not be CERTAIN it is wrong — 0.15, which
  // is a veto on what it is sure about rather than a vote on what it prefers.
  //
  // MEASURED, and every page gains precision while recall stays where it was:
  //
  //   page      before          after
  //   Bach      98.1 / 99.7     98.8 / 99.7
  //   Mozart    89.1 / 91.6     91.8 / 91.6
  //   Scanned   90.3 / 94.3     90.9 / 94.0
  //   mean      +1.29 precision, -0.08 recall
  //
  // The veto threshold was swept: 0.02 does nothing, 0.1 reads +1.04/-0.08,
  // 0.2 reads +1.45/-0.25 and starts taking real notes off two pages. 0.15 is
  // the last point where no page loses a note it had.
  //
  // The stem pass is deliberately NOT changed. It scores the best of a hundred
  // positions rather than one, so its numbers mean something different, and it
  // carries the photographed page's recall.
  const HEAD_UNSURE = 0.95;   // above this the first judge is not second-guessed
  const HEAD_VETO = 0.15;     // the second judge must be SURE to overrule
  const judged = judge && HEAD_JUDGE
    ? wide.filter((c) => {
      const patch = headPatch(gray, background, w, h, space, c.x, c.y);
      const first = headScore(patch);
      if (first < HEAD_CUT) return false;
      if (first >= HEAD_UNSURE) return true;
      return headScoreMlp(patch) >= HEAD_VETO;
    })
    : wide;

  judged.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const point of judged) {
    if (kept.some((k) => Math.abs(k.x - point.x) < space * CLUSTER_X
      && Math.abs(k.y - point.y) < space * CLUSTER_Y)) continue;
    kept.push(point);
  }
  // …and then the notes the scan never offered, hunted from their stems and
  // judged by the same classifier. Only when the judge is on: with it off this
  // would accept everything a stem points at, and the one caller that turns it
  // off is the trainer, which wants the scan's own candidates and nothing else.
  if (judge && HEAD_JUDGE) {
    // `floor` is what this page's own solid heads measure — see HEAD_WIDE above.
    kept.push(...stemHeads(ink, w, h, staff, space, gray, background, kept, floor));
  }

  // AND THEN CENTRED ON THE INK, because what is kept above is a PIXEL and not
  // a notehead.
  //
  // Everything up to here scores positions and keeps the winning one. That is
  // the right way to choose and it is the wrong place to stop: `fill + open` is
  // nearly flat across the middle of a solid head, so which pixel wins is
  // settled by a stray bit of blur at the rim, and the answer lands a pixel or
  // two off the head's real centre. Nobody looking at the screen can see it.
  // The measurement can, and it charges for it TWICE:
  //
  //   mark  704,1200   ring  709,1200    0.50 spaces apart
  //   mark 1123,1485   ring 1118,1486    0.51
  //   mark  574,759    ring  579,758     0.53
  //   mark  647,1191   ring  649,1186    0.56
  //   mark 1304,1350   ring 1307,1345    0.61
  //
  // Ground truth matches at half a staff space, so each of those is ONE
  // notehead scoring as one false circle AND one missed note — eight such pairs
  // across the two hard pages, sixteen errors made of eight objects. Widening
  // the match radius would hide them and must not be done: one staff space is
  // two steps of pitch, so an error of half a space is half a wrong note, and a
  // tolerance that swallowed this would swallow a real defect with it. So the
  // point is moved and the ruler is left alone.
  //
  // The centre of the ink inside the head's OWN ellipse-sized box — not of the
  // connected component it belongs to, which on a beamed page is the whole
  // beamed group and would send the point flying off down the beam.
  //
  // SIDEWAYS ONLY, and that is measured rather than tidy. Look at the pairs
  // above: every one of them is a horizontal offset, and the reason is that the
  // scan walks x fastest, so a plateau of equal scores is broken in x. Run on
  // each axis and on both, as mean precision / mean recall over the three pages
  // against 91.86 / 93.70:
  //
  //   x alone      92.12 / 93.98      and the corpus's note values do not move
  //   x and y      92.19 / 94.05      and five of them do
  //   y alone      91.86 / 93.70      nothing at all
  //
  // The extra 0.07 that y adds is one head on one page, and it is not free.
  // beamMask decides note VALUES as well as positions, and readValues counts
  // beams by looking along the stem from the head — so moving a head vertically
  // moves it toward or away from the beam it is being counted against. Measured
  // on the synthetic corpus, adding the y move takes the photographed CORE case
  // from 95% of its beams to 90% (six notes read wrong, then eleven), barMixPhoto
  // from 92% to 89% and heavyBlur from 86% to 85%. One head is not worth five
  // wrong note values, so the y move is not made. With x alone every beam column
  // of both corpus blocks is identical to what it was before this existed.
  //
  // CLAMPED, and the clamp is read off a plateau rather than off a peak. Both
  // axes, swept, so the numbers are comparable with the table above:
  //
  //   0.10 spaces   92.19 / 94.05        0.30 spaces   92.09 / 93.95
  //   0.20 spaces   92.19 / 94.05        0.50 spaces   91.51 / 93.36
  //   0.25 spaces   92.19 / 94.05
  //
  // Everything from 0.10 to 0.25 is the same answer — the offsets this is for
  // are a pixel or two and the clamp is not binding on them at all. It starts
  // binding at 0.30, where it costs the Bach a note, and by 0.50 it is dragging
  // heads onto the ink beside them. 0.20 sits in the middle of the flat part, a
  // whole plateau's width from the edge, which is the only honest reason to
  // prefer one number on a plateau to another.
  const HEAD_CENTRE_CAP = 0.2;
  for (const point of kept) {
    let sx = 0; let n = 0;
    for (let dy = -hh; dy <= hh; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const yy = point.y + dy; const xx = point.x + dx;
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
        if (!ink[yy * w + xx]) continue;
        sx += dx; n += 1;
      }
    }
    if (!n) continue;
    const cap = space * HEAD_CENTRE_CAP;
    point.x = Math.round(point.x + Math.max(-cap, Math.min(cap, sx / n)));
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
// --------------------------------------------------------------------------
// ONE PIECE OF INK, REPORTED BY TWO STAVES.
//
// findHeads runs once per stave and searches `reach = space * 7` above the
// top line and below the bottom line — four ledger lines, which is what this
// repertoire needs and which the note above `reach` argues for at length. But
// the distance between one system and the next is 13 to 15 spaces on every
// page measured here, and a stave is 4 of those. So two neighbouring staves'
// search bands OVERLAP, by 4.4 to 5.8 spaces on the three marked pages, and
// until now nothing anywhere noticed. A high ledger-line note in system 2 was
// found by system 2 — correctly — and found AGAIN by system 1, which measured
// its step down from its own bottom line and got a number 26 steps out.
//
// 26 steps is one system. It is why `npm run scan:studies` reported a group of
// notes wrong by -44 and -45 semitones — three and a half octaves, which is
// not a pitch error at all but a note filed under the wrong stave. Measured on
// the studies before this: 25 heads reported twice across 12 of the 32 pages,
// at PIXEL identity, e.g. A-major-scale (175,258) staff 0 step -13 midi 21 ===
// (175,258) staff 1 step 13 midi 66. On the real pages: Bach 0 (its music
// never climbs that far), Concerto 4, Scanned 5.
//
// The matcher then picked whichever of the two it happened to reach first, so
// the failure was intermittent in a way that made it look like a pitch bug.
//
// NOT FIXED BY SHRINKING `reach`, and that was tried first. Patching only the
// constant in the served module: reach 7 gives 557 right pitch, 6 gives 572,
// 5 gives 577 and the group is gone — but FORCE_CLEF=treble at reach 5 costs
// recall 98.0% to 92.1%, because bass-clef music read in treble sits BELOW its
// stave and the same notes fall off the other end. The reach is right. What
// was missing is that a stave has no claim on ink that plainly belongs to its
// neighbour.
//
// THE RULE: where two staves report a head at the same place, the stave whose
// own five lines are NEARER keeps it. Distance is measured outside the stave
// only — a head between the lines scores zero — under that head's own strip,
// so a stave that curves across the page is measured where the head actually
// is. It is a re-ASSIGNMENT and not a narrowing: no head is ever lost, and the
// count `found` reports is unchanged by construction, which is why nothing
// that scores circles rather than pitches moves by more than the duplicates it
// was double-counting.
//
// "Same place" is 0.8 of a space in x and in y. A notehead is about 1.2 spaces
// across, so two detections that close are on one piece of ink; and the test
// only ever compares heads belonging to DIFFERENT staves, so a chord's
// interior heads — half a space apart on one stave — are never candidates.
//
// Run BEFORE dropFurniture and therefore before readValues, so the heads stay
// index-aligned with the values they are about to be given.
// A TREBLE'S TAIL HANGS UNDER ITS OWN BODY. A BARLINE'S DOES NOT.
//
// The second half of the test that came off the Bach photograph — see
// TREBLE_BEAM in scan-clef.js for the first, and for the picture. Four windows
// of that page read as a mid-system treble, and cropped at 8x every one of them
// is a BARLINE with a beamed group on either side: the barline supplies ink
// continuous from the top line to the bottom one, and the beam a space to its
// side supplies the depth. The column profile cannot see that they are two
// objects, because it has already summed across the band.
//
// So this asks the one question the profile cannot: is the ink below the stave
// UNDER the ink inside it? Take the x-centre of the ink below the bottom line
// and the x-centre of the ink between the lines, both with the staff's own five
// lines left out, and measure how far apart they stand.
//
// MEASURED: on the 675 windows of a real drawn mid-system G clef that pass
// every other test, the two centres are 0.19 of a staff space apart at the
// median and 0.50 at the ninetieth centile; on all three of the Bach's barline
// runs they are 0.68 to 1.36 apart, because the beam is beside the barline and
// not under it. The bound is 0.65 and the run of five carries the rest — a clef
// has to answer this five windows running. With this and TREBLE_BEAM in, the
// three marked photographs report ZERO clef changes on thirty staves, where the
// treble test without them fired four times on the Bach.
//
// WHY IT LIVES HERE and not in scan-clef.js: everything in that file reads one
// column of numbers, one per row, and this needs the page. Applied to the
// TREBLE only. A C-clef sits inside the stave and has no tail to ask about.
const TAIL_SPLIT = 0.65;     // staff spaces between the two centres
const TAIL_BELOW = 4.15;     // where "below the stave" starts, in spaces
function tailUnderBody(ink, w, h, staff, stripW, space, x0, x1) {
  const mid = Math.round((x0 + x1) / 2);
  const lineY = (index) => staff.lines[index].at[
    Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(mid / stripW)))
  ];
  const top = lineY(0) + bandShift(ink, w, h, lineY, space, x0, x1, mid);
  // The x-centre of the ink in one horizontal slice, weighted by how much of
  // that column is inked, or null where the slice is empty.
  const centre = (from, to, floor) => {
    let sum = 0;
    let total = 0;
    for (let cx = x0; cx <= x1; cx++) {
      let n = 0;
      for (let y = Math.round(top + from * space); y <= Math.round(top + to * space); y++) {
        if (y >= 0 && y < h && ink[y * w + cx]) n++;
      }
      const v = n / space;
      if (v > floor) { sum += cx * v; total += v; }
    }
    return total > 0 ? sum / total : null;
  };
  const tail = centre(TAIL_BELOW, TAIL_BELOW + 3, 0.02);
  // …and the ink INSIDE the stave, which is what the tail has to stand under.
  //
  // BE CLEAR WHAT THIS IS, because the obvious reading of it is wrong and a
  // later round correcting it would lose the zero. The staff lines are NOT
  // excluded. They are inked right across the band, so every column of a bare
  // stave scores 0.8 here and the centre of an EMPTY band comes back as the
  // band's own middle rather than null — checked directly, not assumed. A
  // notehead column scores about 2.0 against that 0.8, so a glyph moves this
  // centre but does not own it.
  //
  // That is why the test works and why it is stated as "under its own body"
  // rather than "under its own glyph": a G clef sits square in the band for
  // several of the windows in its run, so its tail is near the middle; a beam
  // a space to the side of a barline is not. Excluding the line rows was NOT
  // tried, and the bound of 0.65 was measured against THIS arithmetic — moving
  // one without re-measuring the other is how the number stops meaning anything.
  const body = centre(0.15, 3.85, 0.15);
  if (tail === null || body === null) return false;
  return Math.abs(tail - body) / space <= TAIL_SPLIT;
}

// A CLEF PRINTED PART WAY ALONG A SYSTEM, which the reader had never looked for.
//
// WHAT IT COSTS TO MISS ONE, measured on a page engraved with real Bravura:
// treble at the head of every system, a C-clef halfway through the first bar,
// eight notes each side. Twenty-four of forty-eight notes came back a ninth
// wrong — the STEP right on every one, the clef naming it wrong — with
// `clefConfidence` reading 1 and the key read correctly. A cello part alternates
// bass and tenor constantly, so this is not an exotic page; and the failure is
// silent, which is the shape this reader treats as the unforgivable one. A clef
// change at a SYSTEM BREAK, by contrast, was already perfect (48 of 48), so the
// hole is exactly the middle of a system.
//
// WHERE IT LOOKS. From `fromX` — past the clef band and past the widest key
// signature there is — to the end of the stave, in quarter-space steps, using
// clefColumn, which is the same window the head of the system is read through
// and the one piece of this machinery already proven on a photograph.
//
// A RUN, NOT A WINDOW. The window is 3.6 spaces wide and the step is a quarter
// of one, so a real glyph answers the same for six to eight windows in a row.
// The answer is only believed where it survives MID_CLEF_RUN of them — half a
// staff space of sliding — and the x reported is the middle of that run. This is
// not a smoothing convenience: the single accident that beat every shape test in
// scan-clef.js's midClefAt (a chord of thirds on a photograph) answered at
// exactly one x out of four hundred, and this is the test that says so.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   - It does not touch the CLEF BAND at the head of the system, does not
//     suppress anything, and is not consulted by dropFurniture. It is read by
//     notesInOrder and by nothing else, which is why every measurement of what
//     gets CIRCLED is unmoved by construction — see the note in readPage.
//   - It finds C-clefs and TREBLE clefs, and it does NOT find a bass. That
//     split is measured, not assumed, and the measurement is in scan-clef.js
//     above the hole where midBassAt used to be: a treble reads 54 of 60 drawn
//     mid-system clefs with zero false fires over 58,411 windows, and the most
//     sensitive bass gate anybody could build out of this profile read 41 of 60
//     while firing 88 times on scan:clef's own furniture — the quietest that
//     read anything read 32 of 60 and still fired 25. A cello part goes up in
//     tenor and
//     comes back down in bass, so the return trip is still not read; where it
//     is not, the page keeps exactly the behaviour it had before this existed.
//   - A clef change in the middle of a BAR is found as readily as one after a
//     barline — the scan has no notion of bars — but nothing here reads the
//     cautionary clef an engraver prints at the END of a system.
const MID_CLEF_STEP = 0.25;   // how far the window slides, in staff spaces
const MID_CLEF_RUN = 3;       // …and how many steps the answer must survive
// A TREBLE has to survive longer, because it is a weaker claim.
//
// A C-clef is named by its waist standing on a line, which is a positive and
// unusual signature; a treble is named by hanging below the stave, and a
// downward stem, a barline and a forte all go there. MEASURED over the same
// 58,411 windows the detector was built on: at a run of 5 the treble reads 54
// of 60 with ZERO false fires, and at a run of 3 it reads the same 54 and fires
// 12 times — on a double barline through the camera. Two more windows of
// sliding is half a staff space and costs nothing but the smallest cue clefs,
// which were already refused.
const MID_TREBLE_RUN = 5;
export function findClefChanges(ink, w, h, staff, stripW, space, fromX, headClef) {
  if (!(space > 0) || fromX === null || !Number.isFinite(fromX)) return [];
  const runs = [];
  const step = Math.max(1, space * MID_CLEF_STEP);
  const wide = Math.max(3, Math.round(space * CLEF_WIDE));
  for (let x = fromX; x + wide < w; x += step) {
    const column = clefColumn(ink, w, h, staff, stripW, space, x);
    // A C-clef first, then a treble. See midTrebleAt in scan-clef.js for what
    // separates one from the music around it, and for why the bass that would
    // bring a passage back down is not read at all.
    //
    // A SYSTEM ALREADY IN TREBLE IS NOT ASKED. A change from treble to treble is
    // not a change, so the question has no right answer to gain and a false fire
    // to lose — and the whole of scan:corpus and two of the three marked pages
    // are single-clef pages that never need to be asked it. This is free
    // exposure to give up and it is given up on purpose.
    let seen = midClefAt(column, space)
      ?? (headClef === 'treble' ? null : midTrebleAt(column, space));
    // …and a treble has one more question to answer, which needs the page and
    // not the profile. See tailUnderBody.
    if (seen?.clef === 'treble') {
      const x0 = Math.max(0, Math.round(x));
      const x1 = Math.min(w - 1, x0 + wide);
      if (!tailUnderBody(ink, w, h, staff, stripW, space, x0, x1)) seen = null;
    }
    const last = runs[runs.length - 1];
    // The same glyph, still under the window. Anything else starts a new run —
    // including the SAME clef found again further along, which is a second
    // change and a real thing for a page to do.
    if (last && seen && last.clef === seen.clef && x - last.lastX <= step * 1.5) {
      last.lastX = x;
      last.n++;
      if (seen.confidence > last.confidence) last.confidence = seen.confidence;
    } else if (seen) {
      runs.push({ clef: seen.clef, firstX: x, lastX: x, n: 1, confidence: seen.confidence });
    }
  }
  return runs
    .filter((r) => r.n >= (r.clef === 'treble' ? MID_TREBLE_RUN : MID_CLEF_RUN))
    .map((r) => ({
      // The middle of the run, which is where the glyph is. Reported in pixels;
      // readPage normalises it like every other x it hands out.
      x: (r.firstX + r.lastX) / 2,
      clef: r.clef,
      confidence: r.confidence,
      // WHERE THE GLYPH ITSELF IS, which is not the same thing and is now needed
      // downstream. Every window of the run contained the whole glyph, so the
      // glyph lies inside the LAST window's left edge and the FIRST window's
      // right edge — the intersection of them all. Reported because the reader
      // was mistaking a mid-system clef for the ACCIDENTAL in front of the next
      // note (8 of the 64 wrong pitches on npm run scan:clef-change), and
      // nothing downstream could tell where the ink it was reading came from.
      //
      // NOT REACHABLE TODAY BUT WORTH KNOWING: this inverts once a run is longer
      // than the band is wide — at a quarter-space step that is 15 windows —
      // and an inverted range simply never contains anything, so the accidental
      // suppression would stop firing silently rather than fire wrongly. The
      // longest run measured anywhere is 8.
      from: r.lastX,
      to: r.firstX + wide,
    }));
}

// How far past a stave's left end a mid-system clef may first be looked for, in
// staff spaces: the clef band itself and then the widest key signature an
// engraver sets. KEY_REACH in scan-key.js allows nine spaces for seven flats,
// and CLEF_WIDE is 3.6, so anything left of this is furniture the reader
// already reads and must not be offered to a clef-change scan.
const MID_CLEF_FROM = CLEF_WIDE + 10;

export function dropDoubledHeads(found, w) {
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      const A = found[i];
      const B = found[j];
      const sp = (A.staff.space + B.staff.space) / 2;
      // TWO STAVES THAT OVERLAP ARE ONE SYSTEM FOUND TWICE, AND THIS RULE HAS
      // NOTHING TO SAY ABOUT THEM.
      //
      // The rule's premise is that the two staves are distinct objects standing
      // in different places, so "which is nearer" names an owner. Where the
      // tracker has reported one system as two — which it does — the premise is
      // gone: both answers describe the same five lines, "nearer" is a coin
      // flip, and whichever wins carries its own beam count and its own step.
      //
      // This is not hypothetical. On `photo10` in `npm run scan:sizes` the
      // reader finds SEVEN staves where six were drawn, and the extra is not a
      // phantom on bare paper between systems: staves 0 and 1 span y 65–189 and
      // 95–225 at a space of 9.7, overlapping by 9.7 spaces — more than either
      // stave is tall — while the real system gap on that page is 157 to 161
      // pixels and these two stand 30 apart. Their twelve heads split 7 and 5,
      // staff 0 reads a treble clef and staff 1 reads none. Arbitrating between
      // them moved three notes' beam counts (rightBeams 58 to 55) purely by
      // changing which of two wrong descriptions won, and the beam column is the
      // one thing on that page that was not already broken.
      //
      // So: no vertical overlap, or no arbitration. A real pair of staves never
      // overlaps — four spaces of stave inside a thirteen-space system — so this
      // costs the rule nothing where the rule applies, and it keeps a stave
      // tracking failure from being laundered into a pitch. Measured: skipping
      // overlapped pairs leaves the studies at 660 of 692 and the three marked
      // pages to the digit, and gives photo10 back its beams.
      const aTop = Math.min(...A.staff.lines[0].at);
      const aBottom = Math.max(...A.staff.lines[4].at);
      const bTop = Math.min(...B.staff.lines[0].at);
      const bBottom = Math.max(...B.staff.lines[4].at);
      if (aBottom > bTop && bBottom > aTop) continue;
      // How far outside its own stave this head stands, at its own x. Zero
      // between the lines, and growing either way outside them.
      const outside = (sys, head) => {
        const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((head.x / w) * STRIPS)));
        return Math.max(
          0,
          sys.staff.lines[0].at[strip] - head.y,
          head.y - sys.staff.lines[4].at[strip],
        );
      };
      const dropA = new Set();
      const dropB = new Set();
      for (const a of A.heads) {
        for (const b of B.heads) {
          if (Math.abs(a.x - b.x) > sp * 0.8 || Math.abs(a.y - b.y) > sp * 0.8) continue;
          if (outside(A, a) <= outside(B, b)) dropB.add(b); else dropA.add(a);
        }
      }
      if (dropA.size) A.heads = A.heads.filter((head) => !dropA.has(head));
      if (dropB.size) B.heads = B.heads.filter((head) => !dropB.has(head));
    }
  }
  return found;
}

export function realStaff(staff) {
  return ((staff?.heads?.length ?? 0) > 0) || ((staff?.bars?.length ?? 0) > 0);
}

// The whole reading, normalised. `source` is anything drawImage accepts.
// `judge` turns the notehead classifier off, and it exists for exactly one
// caller: tools/patch-dump.mjs, which collects the training data. With the
// judge on, the dump only ever sees candidates the judge already passed — so
// each round of training would be fitted to the survivors of the last one, the
// negative examples would vanish, and the model would eat its own tail. Nothing
// in the app passes it.
// THE READER WORKS AT THE SIZE THE MUSIC IS, not at the size of the page.
//
// `WORK_WIDTH` is 1400 and the comment beside it says "enough detail for a staff
// space of ~9px" — which is true of a page with four or five systems on it, and
// false of everything else. A cello method book, a study page, any edition that
// prints eight or ten systems to a page, comes out at a staff space of four to
// six pixels at 1400 across, and that is under the size every measurement in
// this repo is taken at.
//
// WHAT IT COSTS, MEASURED. `node tools/pdf-open-check.mjs ~/Downloads/Burdett.pdf`
// — a cello method book, which is bass and tenor clef from cover to cover —
// read at 1400: staff space 4px, and the clefs come back **treble 18, bass 6,
// tenor 7, none 9**. Treble where bass is printed is every note a sixth and an
// octave out, so a player who plays the page exactly is told they played the
// wrong notes: the pairing's agreement collapses and the whole take is refused.
// That is a user's report, in their words — "i played the exact notes on the
// score … it said that none of the notes i played matched the score" — and it
// is not the aligner or the floor. It is this constant.
//
// So the page is read once to find out how big its music is, and read AGAIN,
// larger, when the answer is "too small to read properly". The second pass only
// happens when there are real pixels to go and get: upscaling is measured to
// make things WORSE (`npm run scan:import` at READ_ACROSS=2200 on a small
// photograph: 42.4% against 51.4%), so a source with nothing more to give is
// left alone.
const WORK_MOST = 2400;    // the widest the reader will work at, for memory
const SPACE_WANT = 9;      // the staff space it is built for
const SPACE_WORTH = 1.15;  // …and how much bigger a second look must be to run

// WHETHER A SECOND, BIGGER READ IS WORTH TAKING, and how big.
function worthReadingAgain(first, naturalWidth, naturalHeight) {
  if (!first) return 0;
  const usedW = Math.min(WORK_WIDTH, naturalWidth);
  const usedH = Math.round(naturalHeight * (usedW / naturalWidth));
  const space = (first.space ?? 0) * usedH;
  if (!(space > 0) || space >= SPACE_WANT) return 0;
  const wanted = Math.min(WORK_MOST, naturalWidth, Math.round(usedW * (SPACE_WANT / space)));
  return wanted < usedW * SPACE_WORTH ? 0 : wanted;
}

// A bigger read that finds LESS is not an improvement — it is a page whose
// extra pixels are noise — so the first answer stands unless the second one is
// at least as good.
function betterOf(first, again) {
  const heads = (read) => (read?.staves ?? [])
    .reduce((n, st) => n + (st.heads?.length ?? 0), 0);
  return again && heads(again) >= heads(first) ? again : first;
}

// Run it to the end without stopping. This is what every tool and every corpus
// check takes, and what `readPage` is.
function readAt(source, naturalWidth, naturalHeight, width, judge) {
  const steps = readSteps(source, naturalWidth, naturalHeight, width, judge);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// …and the same, handing the processor back wherever it yields.
async function readAtGently(source, naturalWidth, naturalHeight, width, judge, pause) {
  const steps = readSteps(source, naturalWidth, naturalHeight, width, judge);
  let step = steps.next();
  while (!step.done) {
    if (pause) await pause();
    step = steps.next();
  }
  return step.value;
}

export function readPage(source, naturalWidth, naturalHeight, { judge = true } = {}) {
  const first = readAt(source, naturalWidth, naturalHeight,
    Math.min(WORK_WIDTH, naturalWidth), judge);
  if (!first) return first;
  const wanted = worthReadingAgain(first, naturalWidth, naturalHeight);
  if (!wanted) return first;
  return betterOf(first, readAt(source, naturalWidth, naturalHeight, wanted, judge));
}

/**
 * The same read, stopping between staves so a page turn can be heard.
 *
 * Same two reads, same choice between them, same arithmetic in the same order —
 * it is the same generator body, driven differently. `readPage` above stays
 * synchronous because sixty call sites across the tools take it that way, and
 * those tools are what measure whether the reading is any good.
 *
 * `pause` should be CHEAP — a frame, a timer — and not a wait for the reader to
 * go idle. Between pages the caller already stands aside properly; between
 * staves the job is only to let a pending tap be dispatched, and a pass that
 * parks for seconds at every stave would take an age to finish a long part.
 */
export async function readPageGently(
  source, naturalWidth, naturalHeight, { judge = true, pause = null } = {},
) {
  const first = await readAtGently(source, naturalWidth, naturalHeight,
    Math.min(WORK_WIDTH, naturalWidth), judge, pause);
  if (!first) return first;
  const wanted = worthReadingAgain(first, naturalWidth, naturalHeight);
  if (!wanted) return first;
  return betterOf(first,
    await readAtGently(source, naturalWidth, naturalHeight, wanted, judge, pause));
}



// ONE BODY, TWO DRIVERS.
//
// Reading a page is the heaviest arithmetic in this app and it has no yield in
// it, so a page turn arriving while it runs waits the whole thing out. MEASURED
// on eight dense pages at 6x throttle, by a timer asking to run every 50ms and
// reporting how late it was: the main thread was unavailable for 6743ms at a
// stretch, with eleven other blocks over a second.
//
// Most of that is one loop. Timed stage by stage on an eleven-system page:
// 1864ms of 2371ms is the per-stave work — findBars and findHeads, eleven times
// — against 110ms for the largest of everything else.
//
// So the loop yields — and so does every other stage boundary, which costs
// nothing now the shape exists: at the second, larger read the page is 2400
// across and toGray, boxBlur and the stave tracking are a few hundred
// milliseconds each. Which means the read has to be able to stop and start,
// and `readPage` has to stay SYNCHRONOUS anyway: sixty call sites across the
// tools use it that way, and those tools are the corpus that measures whether
// the reading is any good. A version of this for the app alone would leave the
// path the app actually takes with no corpus behind it.
//
// A generator gives both from one body. Every line that computes anything is
// shared by construction — the two drivers below differ only in whether they
// pause where it yields.
function* readSteps(source, naturalWidth, naturalHeight, width, judge) {
  const w = Math.max(1, Math.round(width));
  const h = Math.round(naturalHeight * (w / naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);

  const gray = toGray(canvas);
  yield;

  // THE BLUR BOX IS A SHARE OF THE PAGE'S WIDTH, AND IT WAS MEASURED THIS ROUND
  // AND LEFT ALONE. The local threshold divides the page's own lighting out, and
  // that only holds while the box is comfortably larger than a glyph — once it
  // is about one staff space across, the background follows the ink into the
  // middle of a solid notehead and the head stops binarising. w/36 is 39 pixels
  // at WORK_WIDTH, which is 3.2 to 4.0 staff spaces on the three marked pages
  // and 0.9 on a photograph of two bars, so it looks like the wrong units. It
  // was converted to staff spaces, twice, and both readings are in the handover:
  // measured in staff spaces the box is right for the three pages and WRONG for
  // the size sweep, which is the failure the size sweep exists to catch.
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  yield;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;

  yield;
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
  yield;
  const tracked = trackCombs(profiles.map((p) => combPeaks(p, pitch)), pitch);
  const staves = stavesToLines(fillMissedStaves(tracked, profiles, pitch), STRIPS);
  if (staves.length === 0) return null;

  // Heads are hunted on the cleaned page; bars stay on the raw one. A barline
  // is a full-height column and beam removal has no business nibbling at it.
  yield;
  const body = beamMask(ink, w, h, space);
  yield;
  // The beams, as their own layer: what beamMask took out. Finding them was
  // already done — this is only the difference between the page and the page
  // with the beams removed — and it is what says a quaver from a semiquaver.
  const beams = beamLayer(ink, body);
  yield;

  // Bars and heads for every stave first, and the note values only afterwards.
  //
  // The values cannot be read stave by stave, because counting beams needs to
  // know how this edition draws them — how thick, how far apart — and one
  // stave of twenty notes is too small a sample to measure that off a bad
  // photograph. Read together, the whole page measures its own engraving once.
  // See readValues.
  const starts = staves.map((staff) => staveStart(ink, w, h, staff, stripW));
  const ranked = starts.filter((x) => x !== null).sort((a, b) => a - b);
  const margin = ranked.length
    ? ranked[Math.floor((ranked.length - 1) * 0.25)]
    : null;

  // Where each system begins — the page's answer, and the one system entitled
  // to disagree with it.
  //
  // Decided ONCE and shared, because two things need it and they must not
  // disagree: the clef is read just past this point, and the furniture printed
  // at every system's start is recognised by being the same distance past it.
  // The per-system answers are not usable on their own — on this page they come
  // back 136, 133, 86, 36, 34, 32, 31, 35, 192, 183 against a truth near 32 —
  // which is why the page decides, by low quartile. See the note above `starts`
  // and the one on bandHasInk.
  const edges = staves.map((staff, i) => {
    if (margin === null) return starts[i];
    const band = (from) => clefColumn(ink, w, h, staff, stripW, staff.space, from + staff.space * 0.25);
    if (bandHasInk(band(margin))) return margin;
    const own = starts[i];
    if (own !== null && own !== margin && bandHasInk(band(own))) return own;
    return margin;
  });

  // The clef on each system, read here rather than at the end, because two
  // things need it and one of them runs before the heads are settled: a head
  // inside a clef's band is the clef, and dropping it is only safe where a clef
  // was actually printed. A page of bare staves — a cropped photograph, a
  // fragment, most of the synthetic corpus — has music where a clef would be,
  // and excluding the band there costs real notes: measured, CORE 99% to 94%
  // and HARD 91% to 84% when the band was excluded unconditionally.
  const clefs = staves.map((staff, i) => {
    const from = edges[i];
    if (from === null) return { clef: null, confidence: 0 };
    return classifyClef(clefFeatures(
      clefColumn(ink, w, h, staff, stripW, staff.space, from + staff.space * 0.25),
      staff.space,
    ));
  });


  // THE LONG POLE, and the one place this yields. Eleven staves at about 170ms
  // each on a dense page at 6x throttle; the block a turn can land inside is one
  // stave instead of the whole page.
  const found = [];
  for (const staff of staves) {
    found.push({
    staff,
    bars: findBars(ink, w, h, staff, stripW, space),
    // Found by shape, then — outside the stave only — asked whether the ink it
    // stands on is a ledger line or something far longer. Filtered HERE rather
    // than in the returned page, so readValues never spends a beam count on ink
    // that is not a note and the values stay index-aligned with the heads.
    //
    // `ink` and not `body`: body has the beams masked out of it, and the mask is
    // looking for horizontal rules, which is the shape being measured. Asked of
    // the masked image the question answers itself.
    heads: findHeads(body, w, h, staff, staff.space, gray, background, judge)
      // …AND A CONFIDENT SECOND JUDGE CAN OVERRULE THE LEDGER RULE.
      //
      // offStaveIsCredible rejects a head outside the stave standing on ink too
      // long to be a ledger line, and it is the largest single cause of MISSED
      // notes left on the Concerto. Traced: of its twenty-eight missing heads,
      // only one has a detection just outside the match radius and eighteen have
      // nothing within two staff spaces — so they are not mislocalised, they are
      // never proposed. Probed with tools/head-probe.mjs, six of ten come back
      // ACCEPTED by the shape tests, fill 0.81 to 0.88, core 1, 1.3 to 1.5 spaces
      // across. Good noteheads, killed after the shape tests, by this rule.
      //
      // WHY THE RULE IS WRONG ABOUT THEM: a beamed note off the stave has its
      // head touching the beam, and a beam is ink far too long to be a ledger
      // line. Measured, the vertical thickness of what a missed off-stave head
      // stands on runs to 1.61 spaces at the third quartile and 2.71 at the
      // maximum, against 0.60 for the ones that are found — they are standing on
      // BEAMS, not on over-long ledger lines. The rule cannot tell a real note
      // resting on its own beam from a patch of that beam.
      //
      // Loosening it does not work — LEDGER_LONGEST 3 to 4, 5 and 6 all read
      // about +1.2 recall for -0.8 precision, flat, and turning it off entirely
      // reads +1.33 / -1.33. What DOES work is letting the head-model's second
      // judge overrule it when that judge is sure, which recovers the same recall
      // at half the precision:
      //
      //   page      before          after                    AT THE TIME
      //   Bach      98.8 / 99.7     98.8 / 99.7     unchanged
      //   Mozart    91.8 / 91.6     92.1 / 94.9     better on BOTH
      //   Scanned   90.9 / 94.0     89.0 / 94.7     -1.9 precision
      //   mean      -0.55 precision, +1.33 recall, F1 94.45 -> 94.81
      //
      // THAT TABLE STILL REPRODUCES ARITHMETICALLY AND ITS READING WAS WRONG.
      // What it used to say here was "THE SCANNED SCORE PAYS FOR THIS", taken as
      // a real trade of precision for recall. It was not the reader paying. It
      // was that page's TRUTH FILE: of the thirteen detections the overrule owns
      // on the Scanned score, three were marked notes and the other ten were
      // real printed noteheads on ledger lines that nobody had ever marked. All
      // ten were cropped one at a time before anything was changed — a large
      // filled head (one a hollow minim) with its own stem, several behind a
      // printed natural or sharp — and the falsification test is that the
      // Concerto prints the same passage, x for x, and marks every one of them.
      // The ten marks are now on the file, and the 1.9 points were the
      // measurement being wrong rather than the reader.
      //
      // RE-MEASURED AGAINST THE REPAIRED FILE, with tools/whatif.mjs, all three
      // options, all three pages. It is no longer a trade in any direction:
      //
      //   page       KEEP (live)   REVERSE       NARROW 4.5    NARROW sure 0.99
      //   Bach       98.8 / 99.7   98.8 / 99.7   98.8 / 99.7   98.8 / 99.7
      //   Mozart     92.9 / 95.1   92.6 / 91.8   92.8 / 94.8   92.7 / 93.0
      //   Scanned    93.4 / 99.5   93.2 / 96.4   93.4 / 99.5   93.4 / 99.5
      //
      // REVERSE now costs 3.4 points of the Concerto's recall AND 3.2 of the
      // Scanned score's, and buys 0.2 points of precision on neither — the
      // circles it takes off that page are notes. NARROW cannot reach that page
      // at all, at any setting of either constant: the thirteen heads that fire
      // there read ledgerRun 3.01 to 4.12 against a bound of 6 and MLP 0.9967 to
      // 1.0000, while the Concerto's rescued heads span 3.03 to 5.15 and 0.9232
      // to 0.9992 — so tightening either number deletes the Concerto's real
      // notes first and moves the Scanned score by exactly nothing. KEEP,
      // unchanged.
      //
      // AND THE PLAINEST STATEMENT OF IT, which only became sayable once the
      // file was repaired: EVERY head this overrule rescues is a real note. 13
      // of 13 on the Scanned score and 11 of 11 on the Concerto now match a
      // truth mark. Its precision cost is not "worth paying"; it is zero. The
      // probe that prints the two distributions above and the marked/unmarked
      // split is kept read-only in the scratchpad as ledger-why.mjs, and it is
      // whatif.mjs's trick — the served module fetched, this one expression
      // patched to record what it decided, imported from a blob URL.
      //
      // The run bound is not the same as loosening the rule: it stops the
      // overrule reaching a head sitting on a beam that spans half a system,
      // which the second judge is as happy about as anything else. Swept at 4.5,
      // 6 and 8 — 6 is where it stops costing recall.
      .filter((head) => offStaveIsCredible(ink, w, h, staff, stripW, staff.space, head)
        || (ledgerRun(ink, w, h, staff, stripW, staff.space, head) <= LEDGER_OVERRULE
          && headScoreMlp(headPatch(gray, background, w, h, staff.space, head.x, head.y)) >= LEDGER_SURE)),
    space: staff.space,
    // Where this stave's five lines sit under any given x — a stem crosses
    // them and they must not be counted as the beams it is looking for.
    lineAt: (x) => {
      const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((x / w) * STRIPS)));
      return staff.lines.map((line) => line.at[strip]);
    },
    });
    yield;
  }

  // ONE PIECE OF INK, REPORTED BY TWO STAVES — see dropDoubledHeads.
  dropDoubledHeads(found, w);

  // …and then the clef itself, taken out before the values are read so nothing
  // spends a beam count on it and the values stay index-aligned with the heads.
  const keyReach = dropFurniture(ink, w, h, found, edges, clefs, stripW);

  // THE ACCIDENTAL IN FRONT OF EACH NOTE, which is the last thing between a
  // position and a pitch. See scan-accidental.js and acc-model.js.
  //
  // Read AFTER dropFurniture, so the key signature's own accidentals are already
  // out of the head list and cannot be asked which note they belong to.
  //
  // The geometry here is now trivial on purpose — a patch a fixed distance left
  // of the head, which a model judges. Four attempts at separating the glyph
  // from its notehead by ink are recorded in scan-accidental.js and every one
  // failed, because at engraved spacing the two TOUCH and a flat's bowl is a
  // loop with the note's own row running through the hole.
  for (const sys of found) {
    const staff = sys.staff;
    const space = staff.space;
    const at = (index, x) => staff.lines[index].at[
      Math.min(staff.lines[index].at.length - 1, Math.max(0, Math.floor(x / stripW)))
    ];
    for (const head of sys.heads) {
      head.accidental = accidentalFor(gray, background, w, h, space, head, at(4, head.x));
    }
  }

  yield;
  const perStaff = readValues(ink, beams, w, h, found);
  yield;

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

  const out = found.map(({
    staff, bars, heads, keyBand, key, keyScanned, keyEmpty, keyWhy,
  }, staffIndex) => {
    const values = perStaff[staffIndex];
    // The clef, read from the paper rather than fitted from a recording.
    //
    // Measured just right of where the stave's LINES begin — not of its first
    // barline, which on a printed page is the one in the middle of the system.
    // See staveStart. Null when it cannot be told, and null must stay null: a
    // cello part is in bass clef most of the time, and assuming so is what
    // turns the other times into a page of confident verdicts a sixth out.
    // …with ONE system allowed to disagree with it, when it is looking at
    // blank paper.
    //
    // An engraver indents the first system of a piece to leave room for the
    // title, and the page-wide margin is then right for every system but that
    // one. Measured on the Bärenreiter Bach: nine staves begin around x = 32 and
    // the first begins at x = 135, so the band sampled for its clef held no ink
    // at all — not a faint clef, not a doubtful one, NOTHING — and the reader
    // refused. That refusal is a false negative dressed as honesty: there is a
    // clef on that system, and it is in the same place it is on every other
    // page ever engraved, just further right.
    //
    // So an empty band is not an answer, it is a wrong place to have looked, and
    // the system's OWN start is the second place to try. The test is deliberately
    // absolute — a band with any ink in it is a band with something to classify,
    // and is left alone, so the eight systems that read correctly off the page
    // margin never reach this branch.
    const clefFrom = edges[staffIndex] === null ? null
      : edges[staffIndex] + staff.space * 0.25;
    const read = clefs[staffIndex];
    // …AND ANY CLEF PRINTED PART WAY ALONG THE SYSTEM.
    //
    // Computed HERE, in the loop that builds the returned page, and read by
    // notesInOrder and by nothing else. That placement is the safety argument
    // and it is deliberate: the three things that decide what gets CIRCLED all
    // consult `clefs[i].clef` — the band gate in dropFurniture, readKeySignature
    // and the key-signature suppression — and none of them can see this list.
    // So `bench`, `scan:corpus` and every other measurement of circles is
    // unmoved by construction rather than by luck, exactly as the round that
    // added agreeNoKey kept the suppression out of its change.
    //
    // It is also skipped where the head of the system could not be read at all:
    // a stave with no clef has no reading for a change to be a change FROM, and
    // naming half of it in tenor while the other half is null would be worse
    // than leaving it alone.
    const clefChanges = (clefFrom === null || !read.clef) ? []
      : findClefChanges(
        ink, w, h, staff, stripW, staff.space,
        edges[staffIndex] + staff.space * MID_CLEF_FROM,
        read.clef,
      );
    // …AND THE CLEF IS NOT AN ACCIDENTAL, which the reader had been asserting
    // eight times over.
    //
    // accidentalFor takes a patch a fixed distance LEFT of each notehead and
    // asks a model what is in it. An engraver prints a mid-system clef with the
    // next note close behind it, so for that one note the patch lands on the
    // clef — and the model, which has never been shown a clef, answers `flat`
    // at 0.99 and `sharp` at 0.993. MEASURED on npm run scan:clef-change: 8 of
    // the 64 wrong pitches on the changing pages are that, and every one is the
    // first note after the change. It is a new error, introduced by finding the
    // change at all, and it is silent — the note is named confidently, a
    // semitone out.
    //
    // Fixed HERE rather than in scan-accidental.js, because the accidental
    // reader has no way to know: the ink is a real glyph and it really is where
    // an accidental would be. What settles it is that something else has already
    // claimed that ink, and only this loop knows that.
    //
    // ONLY THE PATCH'S OWN CENTRE IS TESTED, not the notehead — a note printed
    // to the right of a clef keeps its accidental if the accidental is drawn
    // between them, which is what a bar with both in it looks like.
    for (const change of clefChanges) {
      for (const head of heads) {
        const cx = head.x - staff.space * ACC_OFFSET;
        if (cx >= change.from && cx <= change.to) head.accidental = null;
      }
    }
    return {
      clef: read.clef,
      clefConfidence: read.confidence,
      // Where the clef changes along this system, in the same normalised x
      // everything else here uses, earliest first. Empty on every page in every
      // corpus this project measures — see findClefChanges for the count.
      clefChanges: clefChanges.map((c) => ({
        x: c.x / w, clef: c.clef, confidence: c.confidence,
        // The glyph's own left and right edge, normalised like every other x
        // here. Reported so a caller can tell a clef from the music around it —
        // see the accidental suppression just above, which is the first thing
        // that needed it.
        from: c.from / w, to: c.to / w,
      })),
      // Where it looked, so the answer can be checked rather than believed.
      //
      // Five ways of correcting this reading were tried and measured and all
      // five came to nothing. What none of them did was LOOK at the band being
      // sampled — every real bug on this page was found by drawing something on
      // top of it, and every dead end came from reasoning about what the code
      // probably does. The reader now reports its own clef zone so the next
      // question can be asked of a picture. Drawn by tools/reader-look.html.
      // Where this stave begins, which is not where its clef band does — the
      // band starts a quarter space in. Reported because anything reasoning
      // about "the furniture at the start of a system" needs the stave's own
      // left end, and reconstructing it from the band lands three pixels out.
      edge: edges[staffIndex] === null ? null : edges[staffIndex] / w,
      clefZone: clefFrom === null ? null : {
        x: clefFrom / w,
        w: Math.min(w - clefFrom, Math.max(3, Math.round(staff.space * CLEF_WIDE))) / w,
      },
      // The band the key signature occupies, when one was found — normalised
      // like everything else here. Reported so a tool can ask whether a false
      // circle is standing on an accidental, which is a different bug from a
      // false circle in the music and wants a different fix.
      keyBand: keyBand
        ? {
          x: keyBand.x0 / w,
          w: (keyBand.x1 - keyBand.x0) / w,
          count: keyBand.count,
          // What ended the scan, and how far the last run it looked at stood
          // from the last accidental it took. Carried so `npm run scan:key-why`
          // can say WHY a system's key was refused rather than only that it was.
          why: keyBand.why,
          cut: !!keyBand.cut,
          inkGap: keyBand.inkGap == null ? null : keyBand.inkGap / w,
        }
        : null,
      // …AND THE TWO FACTS A NULL BAND CANNOT CARRY: whether this system ran the
      // scan at all, and whether it ran it and found the place a key signature
      // is printed to be BARE PAPER. Those are different from each other and
      // both are different from "no band", which is also what a scan that found
      // eight runs of ink returns. The page's key is decided on them — see
      // agreeNoKey in scan-key.js — so they are reported rather than kept
      // private, and a tool asking why a page was called C major can count them.
      keyScanned: !!keyScanned,
      keyEmpty: !!keyEmpty,
      keyWhy: keyWhy ?? null,
      // WHICH key signature, when it could be read — and null when it could not,
      // which is most pages, because most parts are in C major and every reading
      // this cannot confirm against the printed order is refused.
      //
      // `alter[degree]` is +1, 0 or -1 for C, D, E, F, G, A, B, so a caller
      // turning a step into a note name adds `alter[degree]` semitones and stops
      // there. Carried at the STAVE and not only at the page because a clef can
      // change system to system and a key read against the wrong clef is worth
      // nothing; the page's own agreed answer is on the return value below.
      //
      // This is a reading, not a naming. `step` still means what it always meant
      // and nothing here turns one into a pitch — see notesInOrder.
      key: key ? {
        sharps: key.sharps, flats: key.flats, alter: key.alter,
        count: key.count, kind: key.kind, degrees: key.degrees,
      } : null,
      // How squarely this system's accidentals sat on their degrees: 1 means
      // every one landed exactly on its line or in its space, 0 means one of
      // them was half a step from being rounded onto its neighbour.
      keyConfidence: key ? key.confidence : 0,
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
          // The accidental standing in front of it, or null. See
          // scan-accidental.js — this is what makes a B flat a B flat on a page
          // whose signature says otherwise.
          accidental: head.accidental ?? null,
          // 'shape' or 'stem' — which pass proposed it. Diagnostic, and the
          // reports break the invented heads down by it.
          via: head.via ?? 'shape',
          // How long the note is, in crotchets — read from the head's own
          // shape, its stem and the beams crossing it. Whether to believe it
          // is a separate question with its own file.
          beats: values[i]?.beats ?? null,
          beams: values[i]?.beams ?? 0,
        };
      }),
    };
  });

  const real = out.filter(realStaff);
  // THE PAGE'S KEY, ONCE, with the arithmetic that produced it.
  //
  // A key signature is printed at the head of every system and it is the same
  // one every time, so eleven systems are eleven readings of one object. What a
  // caller needs is not just the answer but how much of the page stood behind
  // it: "eleven of eleven agree" and "one of eleven guessed" are the difference
  // between a key worth acting on and a coincidence, and only the second number
  // can tell them apart. See agreeKey for why a page whose systems disagree is
  // reported as no key at all rather than as the commoner half.
  const key = agreeKey(real.map((s) => s.key));
  // …AND THE PAGE THAT PRINTS NO SIGNATURE AT ALL, which until now could not
  // name one note.
  //
  // C major and A minor print nothing. `agreeKey` therefore returns null on
  // them, pitchOf refuses a null key on purpose, and a whole study came back
  // with 29 noteheads and 29 empty pitches — 110 of the 692 notes of the
  // engraved cello studies, every one of them on one of the five C-major or
  // A-minor pages. That is not the reader being careful, it is the reader
  // unable to read the commonest key there is.
  //
  // WHY THIS IS NOT THE DEFAULT-TO-C-MAJOR THAT IS FORBIDDEN EVERYWHERE ELSE IN
  // THIS FILE. A null key means "I could not tell", and turning that into C
  // major is the assumption that puts a semitone on every note of a degree.
  // This is a different claim made of different evidence: every system that ran
  // the scan walked the place a signature is printed and found bare paper
  // there. See agreeNoKey and scanKeyBand in scan-key.js for the measurement
  // that says those two populations do not overlap, for why one system is not
  // enough, and for why the two earlier attempts at this failed.
  //
  // DECIDED HERE AND NOT IN dropFurniture, which is deliberate. dropFurniture
  // computes a page key of its own to decide how far the SUPPRESSION reaches
  // (agreeKeyReach), and that arithmetic divides by each system's own key band.
  // A page whose systems have no band at all would feed NaN into it for no gain
  // — there is nothing to suppress on bare paper past the clef. So the
  // suppression is left exactly as it was and only the page's NAME for its key
  // changes, which is why every measurement of what gets circled is unmoved.
  const bare = agreeNoKey(real.map((s) => ({
    scanned: s.keyScanned, empty: s.keyEmpty, key: s.key,
  })));
  return {
    staves: real,
    strips: STRIPS,
    space: space / h,
    key: key.key ?? (bare.bare ? bareKey() : null),
    // HOW THE PAGE GOT ITS KEY, because the two ways are not equally strong and
    // a caller is entitled to tell them apart: 'read' is a printed signature
    // that the systems agreed on, 'bare' is every system finding the place it
    // would be printed empty, and null is neither. A page reported 'bare'
    // carries a key of `kind: 'none'` and alters nothing.
    keySource: key.key ? 'read' : (bare.bare ? 'bare' : null),
    keyAgreement: {
      systems: key.systems,
      read: key.read,
      agreed: key.agreed,
      // The other half of the arithmetic — how many systems ran the key scan
      // and how many of those found bare paper. On a page with a signature
      // these are the count of systems that looked and zero; on a page in C
      // major they are equal and non-zero; and they are what `keySource:
      // 'bare'` is decided on.
      scanned: bare.scanned,
      empty: bare.empty,
    },
    // How far past each system's left end the PAGE agreed its key signature
    // reaches, in staff spaces, or null where it did not agree one. Reported
    // because it is the one bound in the suppression that is not measured off
    // the ink of the system it is applied to, and a reader of npm run
    // scan:key-why is entitled to see it rather than infer it. See
    // agreeKeyReach in scan-key.js.
    keyReach,
  };
}

/**
 * Which clef governs a note at `x` on this stave, and how sure the reader is.
 *
 * The stave's own reading until the first mid-system change, then whichever
 * change was last printed at or before the note. Exported because two things
 * need to agree about it — notesInOrder and anything drawing the page — and
 * because it is the one place a clef change turns into a pitch.
 */
export function clefHere(staff, x) {
  let clef = staff?.clef ?? null;
  let confidence = staff?.clefConfidence ?? 0;
  for (const change of staff?.clefChanges ?? []) {
    if (change.x > x) break;
    clef = change.clef;
    confidence = change.confidence;
  }
  return { clef, clefConfidence: confidence };
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
        beats: head.beats, beams: head.beams, via: head.via ?? 'shape',
        // Carried down from the stave, because a note's pitch is its position
        // AND the clef that names the lines it sits between — and by the time
        // anything downstream has a note it no longer has the stave.
        // …AND WHICH CLEF, WHERE. A clef printed part way along the system
        // governs every note from there to the end of it, so the clef a note
        // carries is the LAST change at or before the note's own x, and the
        // stave's own reading only until the first one. `clefChanges` is empty
        // on every page in every corpus this project measures, so on all of
        // them this is the stave's clef and nothing has moved.
        //
        // Note what this is NOT: it is not a claim that a change was found
        // wherever one exists. findClefChanges reads C-clefs and TREBLE clefs
        // and refuses everything else — a mid-system BASS is not read at all
        // and cannot be, which is measured above midTrebleAt in scan-clef.js —
        // so a page can still carry a change this does not see, and where it
        // does not see one the answer here is exactly what it was before.
        ...clefHere(staff, head.x),
        // …and the key signature with it, for the same reason: a note's pitch
        // is its position, the clef that names the lines, AND which of those
        // names the signature has altered. Null where this system's signature
        // could not be read, which the caller must treat as "unknown" rather
        // than as C major — the page's own agreed answer is on the page object
        // and is the better fallback.
        key: staff.key ?? null,
        keyConfidence: staff.keyConfidence ?? 0,
        // …AND THE NOTE ITSELF, which is what all of that was for.
        //
        // Every piece of this has existed for a while and nothing joined them
        // up: scan-clef.js reads which line is which note, scan-key.js reads
        // which of those names the signature alters, scan-notes.js turns a step
        // and those two into a MIDI number — and notesInOrder handed downstream
        // a position and left it to guess. scan-pitch.js still opens by saying
        // "no clef, no key signature, no accidental… none of them is read",
        // which was true when it was written and is now two thirds wrong.
        //
        // THE PAGE'S KEY, NOT THIS SYSTEM'S. A printed signature is the same on
        // every system, so the page's agreed answer is the better one — on the
        // three marked pages it is read by 4, 5 and 9 systems out of ten or
        // eleven, unanimously, where any single system may be one of the ones
        // that could not read it. The stave's own is the fallback.
        //
        // NULL IS PROPAGATED AND NEVER DEFAULTED. A cello part is in bass clef
        // most of the time, and "most of the time" is the assumption that turns
        // the other times into a page of confident verdicts a sixth out. A
        // caller that gets null must treat it as unknown, not as C major.
        //
        // …AND A PAGE CAN NOW LEGITIMATELY BE C MAJOR, which is a reading and
        // not that default. `page.key` comes back with `kind: 'none'` and
        // `page.keySource` reads 'bare' when every system of the page ran the
        // key scan and found the place a signature is printed to be empty —
        // see agreeNoKey in scan-key.js for the evidence and for why one
        // system is never enough. The rule for a caller is unchanged and is
        // now worth stating twice: a null key is unknown; a key of kind
        // 'none' is C major, read off the paper; the two must not be conflated
        // in either direction.
        //
        // WHAT THIS STILL DOES NOT KNOW is an accidental standing in front of
        // the note in its own bar. Those are not read at all — the reader only
        // ever meets them as things it wrongly circles — so a note whose bar
        // carries one comes back a semitone out. That is the next thing owed
        // here, and until it exists a pitch from this is right about the key and
        // silent about the bar.
        accidental: head.accidental ?? null,
        ...(() => {
          // A PAGE WHOSE SYSTEMS DISAGREE NAMES NOTHING, and the stave's own
          // reading does not get to stand in for the page's.
          //
          // `page.key` is null for two quite different reasons and this line
          // used to treat them as one. On a page of ONE system there is no
          // second witness and agreeKey declines by design — the stave's own
          // reading is all there is and it is usually right, which is what
          // fourteen one-system arpeggio studies score 92% off. But when two
          // systems DID read a signature and read DIFFERENT ones, agreeKey's
          // null is a positive finding: one of those two readings is wrong and
          // nothing here can say which. Falling back to the stave's own answer
          // there is falling back to a coin toss and reporting it with
          // confidence.
          //
          // MEASURED, `npm run scan:studies -- --phone`, which is the only
          // corpus in this repo photographed badly enough for the key reader to
          // fail at all: Bb-major-scale reads [-3 -2] and Eb-major-scale reads
          // [-2 -3] — first system one flat out in both, second system right in
          // both — and eight notes came back a semitone or a tone from what is
          // printed, with full confidence. They were the ONLY confidently wrong
          // pitches anywhere in this project's measurements. A refusal costs a
          // note its name; a wrong key costs a page its truth (rule 1).
          const split = (page?.keyAgreement?.read ?? 0) >= 2 && !page?.key;
          const key = page?.key ?? (split ? null : staff.key) ?? null;
          // The clef IN FORCE AT THIS NOTE, not the one at the head of the
          // system. Twenty-four of forty-eight notes on an engraved page with a
          // mid-system C-clef were named a ninth wrong by this one line reading
          // `staff.clef` — the step right on every one of them. See
          // findClefChanges.
          const p = pitchOf(head.step, clefHere(staff, head.x).clef, key);
          return p
            // What the SIGNATURE contributed, kept so an accidental in the bar
            // can REPLACE it rather than add to it: a natural in a page of one
            // sharp is a natural, and adding zero to a sharpened F leaves it
            // sharp.
            ? { midi: p.midi, degree: p.degree, keyAlter: key?.alter?.[p.degree] ?? 0 }
            : { midi: null, degree: null, keyAlter: 0 };
        })(),
      });
    }
  }
  // …AND THEN THE BAR'S OWN ACCIDENTALS, one bar at a time.
  //
  // An accidental applies to its note and to every later note in THAT BAR at the
  // same line or space, and stops at the barline. Applying it bar by bar is what
  // makes the last part true rather than asserted — see applyAccidentals, which
  // is handed one bar and cannot see past it.
  const bars = new Map();
  for (const note of notes) {
    const k = `${note.staff}:${note.bar}`;
    if (!bars.has(k)) bars.set(k, []);
    bars.get(k).push(note);
  }
  const out = [];
  for (const bar of bars.values()) out.push(...applyAccidentals(bar));
  // Back into reading order: the bars were walked in the order the notes came,
  // but a note's place on the page is what every caller downstream sorts by.
  out.sort((a, b) => (a.staff - b.staff) || (a.x - b.x));
  return out;
}
