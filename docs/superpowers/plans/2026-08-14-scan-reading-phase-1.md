# Reading a Photographed Page — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `readPage()` find every system on a photographed part, and stop reporting beams as noteheads, so a take can later be aligned to the page.

**Architecture:** Replace the per-line peak hunt in `src/analysis/scan-read.js` with a five-line *comb* correlation, recover systems the comb missed by predicting them from the evenly-spaced ones it found, then erase beams by their measured thickness before noteheads are hunted. Everything new is a pure function over typed arrays so it can be unit-tested with no DOM; `readPage()` remains the only function that touches a canvas, and its output shape does not change.

**Tech Stack:** Plain ES modules, no dependencies. Vitest (node environment, no DOM). Puppeteer-core probe (`tools/scan-probe.mjs`) against a real PDF for the things a unit test cannot see.

## Global Constraints

- **No new dependencies.** This module has none and gains none.
- **Everything in staff spaces.** Every threshold is expressed as a multiple of the page's own measured staff space, so a page reads the same at any render size. No pixel constants.
- **No DOM outside `readPage()`.** Vitest runs in the node environment; anything that touches `document` cannot be tested. New functions take typed arrays and return plain data.
- **`readPage()`'s return shape is unchanged:** `{ staves: [{ lines, space, top, bottom, bars, heads }], strips, space }`, all coordinates normalised 0–1. `src/ui/reader.js`, `src/ui/paper.js` and `src/analysis/scan-read.js`'s own `notesInOrder()` depend on it.
- **Comments carry the reasoning.** This codebase explains *why*, not *what*. A threshold with no explanation of what it is defending against is an unfinished change.
- **404 tests pass today.** `npm test` must be green at every commit.

**Reference page for measurement:** `~/Downloads/Menuet.pdf` — an iPhone-scanner photograph of the Bärenreiter BWV 1007 Prélude, bars 1–20. Ground truth: **10 systems, ~320 noteheads** (20 bars × 16 sixteenths), staff space ~12px at the 1400px render. Baseline before this work: **2 systems, 153 heads**.

---

## File Structure

- `src/analysis/scan-read.js` — modified. Gains `combScore`, `combPeaks`, `trackCombs`, `fillMissedStaves`, `beamMask` as named exports (pure), and `readPage()` is rewired to use them. Loses `stripPeaks`, `trackLines`, `groupStaves`, which the comb replaces.
- `tests/scan-read.test.js` — created. Unit tests for the five pure functions, built on synthetic profiles and bitmaps.
- `tools/scan-probe.mjs` — modified in Task 4 and Task 6 to stop patching thresholds that no longer exist, and to import the shipped module directly.

---

### Task 1: The comb — scoring a five-line grid

**Files:**
- Modify: `src/analysis/scan-read.js` (add exports after `pageScale`, around line 86)
- Test: `tests/scan-read.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `combScore(profile: Float32Array | number[], y0: number, step: number) → number` — the response of a five-line comb whose top line sits at `y0` and whose lines are `step` apart. Returns `-1` when the comb would fall off the profile.

- [ ] **Step 1: Write the failing test**

Create `tests/scan-read.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { combScore } from '../src/analysis/scan-read.js';

// A strip's profile: for each row, the fraction of that strip's columns that
// are inked. A stave is five inked rows with clear gaps between them.
function staffProfile({ height = 200, top = 50, step = 12, ink = 1 } = {}) {
  const p = new Float32Array(height);
  for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = ink;
  return p;
}

describe('combScore', () => {
  test('a five-line grid at the right place and spacing scores high', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBeCloseTo(1, 5);
  });

  test('the same grid half a space out scores nothing', () => {
    const p = staffProfile({ top: 50, step: 12 });
    expect(combScore(p, 56, 12)).toBeLessThan(0.3);
  });

  test('a solid black band does not answer: the gaps must be clear', () => {
    const p = new Float32Array(200).fill(1);
    expect(combScore(p, 50, 12)).toBeCloseTo(0, 5);
  });

  test('four lines of five still score well — the point of the comb', () => {
    const p = staffProfile({ top: 50, step: 12 });
    p[Math.round(50 + 2 * 12)] = 0;          // the middle line is lost to a beam
    expect(combScore(p, 50, 12)).toBeGreaterThan(0.75);
  });

  test('a comb that runs off the page is not a comb', () => {
    const p = staffProfile({ height: 60, top: 50, step: 12 });
    expect(combScore(p, 50, 12)).toBe(-1);
    expect(combScore(p, -4, 12)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `combScore is not a function`.

- [ ] **Step 3: Implement it**

In `src/analysis/scan-read.js`, immediately after `pageScale()` (which ends at line 86), add:

```js
// How much like a stave is this?
//
// The old reader hunted each of the five lines on its own — "is more than half
// this strip inked at this row" — and on a photographed book page one line in
// five routinely fails that test. Four lines is not a stave, so whole systems
// vanished: on the reference page it found two of ten.
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scan-read.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/scan-read.test.js src/analysis/scan-read.js
git commit -m "A comb, so four clear lines can vouch for the fifth"
```

---

### Task 2: Where the combs sit in one strip

**Files:**
- Modify: `src/analysis/scan-read.js` (add after `combScore`)
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Consumes: `combScore`.
- Produces: `combPeaks(profile, pitch: number, opts?: { floor?: number, apart?: number }) → [{ y0: number, step: number, score: number }]`, ordered top to bottom. `floor` defaults to `0.3` (minimum score), `apart` to `4.2` (minimum separation between two combs, in units of `pitch`). `step` is refined per peak within ±1.5px of `pitch`.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan-read.test.js`:

```js
import { combPeaks } from '../src/analysis/scan-read.js';

function pageProfile({ height = 600, tops = [50, 250, 450], step = 12 } = {}) {
  const p = new Float32Array(height);
  for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
  return p;
}

describe('combPeaks', () => {
  test('one peak per stave, in reading order', () => {
    const found = combPeaks(pageProfile(), 12);
    expect(found.map((c) => c.y0)).toEqual([50, 250, 450]);
  });

  test('a stave is found once, not at every offset that partly fits', () => {
    // Without a wide enough suppression window, a comb locks onto lines 2-5
    // plus a ledger line and reports a second stave a few spaces away.
    const found = combPeaks(pageProfile({ tops: [50] }), 12);
    expect(found).toHaveLength(1);
  });

  test('the spacing is refined, not assumed', () => {
    const found = combPeaks(pageProfile({ tops: [50], step: 13 }), 12);
    expect(found).toHaveLength(1);
    expect(found[0].step).toBeCloseTo(13, 1);
  });

  test('ink that is not a grid is not a stave', () => {
    const noise = new Float32Array(600);
    for (let y = 0; y < 600; y += 3) noise[y] = 1;   // evenly inked, no gaps
    expect(combPeaks(noise, 12)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `combPeaks is not a function`.

- [ ] **Step 3: Implement it**

```js
// Every stave in one vertical strip of the page.
//
// The spacing is refined per peak rather than taken from the page average: a
// photographed page is not flat, and a system at the foot of it can sit a
// fifth of a pixel per line wider than one at the top.
//
// `apart` is deliberately wider than a stave is tall. A comb will happily lock
// onto four real lines plus a ledger line a few spaces below, and report a
// second stave that does not exist; suppressing anything within four pitches
// of a stronger answer is what stopped that on the reference page (20 staves
// found where there are 10).
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scan-read.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/scan-read.test.js src/analysis/scan-read.js
git commit -m "One comb per stave, and the spacing measured rather than assumed"
```

---

### Task 3: Linking the strips into staves

**Files:**
- Modify: `src/analysis/scan-read.js` (add after `combPeaks`)
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Consumes: `combPeaks` output, one array per strip.
- Produces: `trackCombs(perStrip: Array<Array<{y0, step, score}>>, pitch: number, opts?: { drift?: number, cross?: number }) → [{ y0: Float32Array, step: Float32Array }]`, one entry per stave, ordered top to bottom, each array one value per strip. `drift` defaults to `0.6` (how far, in pitches, a stave may move between neighbouring strips), `cross` to `0.5` (the fraction of the page a stave must cross to be one).

- [ ] **Step 1: Write the failing test**

Append to `tests/scan-read.test.js`:

```js
import { trackCombs } from '../src/analysis/scan-read.js';

// One stave, sagging gently across the page the way a photographed one does.
function sagging(strips = 40, from = 100, drop = 8) {
  return Array.from({ length: strips }, (_, s) => [
    { y0: from + (drop * s) / strips, step: 12, score: 1 },
  ]);
}

describe('trackCombs', () => {
  test('a stave that crosses the page is one stave, sampled per strip', () => {
    const staves = trackCombs(sagging(), 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0).toHaveLength(40);
    expect(staves[0].y0[0]).toBeCloseTo(100, 1);
    expect(staves[0].y0[39]).toBeCloseTo(107.8, 1);
  });

  test('a gap of a few strips is carried across, not a second stave', () => {
    const perStrip = sagging();
    perStrip[10] = [];
    perStrip[11] = [];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
    expect(staves[0].y0[10]).toBeGreaterThan(100);
    expect(staves[0].y0[10]).toBeLessThan(108);
  });

  test('something that answers in a corner only is not a stave', () => {
    const perStrip = sagging();
    for (let s = 0; s < 5; s++) perStrip[s] = [...perStrip[s], { y0: 300, step: 12, score: 1 }];
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(1);
  });

  test('two staves stay two staves, top first', () => {
    const perStrip = sagging().map((c, s) => [...c, { y0: 300 + s * 0.1, step: 12, score: 1 }]);
    const staves = trackCombs(perStrip, 12);
    expect(staves).toHaveLength(2);
    expect(staves[0].y0[0]).toBeLessThan(staves[1].y0[0]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `trackCombs is not a function`.

- [ ] **Step 3: Implement it**

```js
// Link the per-strip combs across the page into staves.
//
// A stave moves slowly: a photographed page sags a few pixels from edge to
// edge, never a few pixels from one strip to the next. So each curve claims
// the nearest comb in the next strip and is allowed to go missing for three
// strips before it is given up on — a beamed run can hide a stave's lines for
// that long, and the curve should survive it rather than restart.
//
// Gaps are filled by interpolating between the strips that did answer, so
// every stave has a value everywhere and nothing downstream has to ask whether
// this strip was measured or inferred.
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
        const t = next ? (s - sa) / (next[0] - sa) : 0;
        y0[s] = next ? ya + (next[1] - ya) * t : ya;
        step[s] = next ? sta + (next[2] - sta) * t : sta;
      }
      return { y0, step };
    })
    .sort((a, b) => a.y0[0] - b.y0[0]);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scan-read.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/scan-read.test.js src/analysis/scan-read.js
git commit -m "Combs linked across the page into staves"
```

---

### Task 4: The systems the page implies

**Files:**
- Modify: `src/analysis/scan-read.js` (add after `trackCombs`)
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Consumes: `combScore`, `trackCombs` output.
- Produces: `fillMissedStaves(staves, profiles: Array<Float32Array>, pitch: number, opts?: { votes?: number, floor?: number }) → staves` — the same array with predicted staves inserted, still ordered top to bottom. `votes` defaults to `0.5` (the fraction of strips that must show *some* comb response at the prediction), `floor` to `0.05` (how weak that response may be).

- [ ] **Step 1: Write the failing test**

Append to `tests/scan-read.test.js`:

```js
import { fillMissedStaves } from '../src/analysis/scan-read.js';

// A page of evenly spaced systems, as profiles, one per strip.
function pageStrips({ strips = 40, tops = [100, 260, 420, 580], step = 12, height = 800 } = {}) {
  return Array.from({ length: strips }, () => {
    const p = new Float32Array(height);
    for (const top of tops) for (let k = 0; k < 5; k++) p[Math.round(top + k * step)] = 1;
    return p;
  });
}

describe('fillMissedStaves', () => {
  test('a system missed in the middle is put back', () => {
    const profiles = pageStrips();                       // four systems on the page
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => Math.abs(c.y0 - 260) > 20)), 12,
    );                                                   // …but the reader saw three
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled).toHaveLength(4);
    expect(filled[1].y0[0]).toBeCloseTo(260, 0);
  });

  test('a system missed at the foot of the page is put back', () => {
    const profiles = pageStrips();
    const found = trackCombs(
      profiles.map((p) => combPeaks(p, 12).filter((c) => c.y0 < 500)), 12,
    );
    expect(found).toHaveLength(3);
    const filled = fillMissedStaves(found, profiles, 12);
    expect(filled.map((s) => Math.round(s.y0[0]))).toEqual([100, 260, 420, 580]);
  });

  test('nothing is invented where the page has no ink', () => {
    // Three real systems and blank paper below them: prediction must not
    // manufacture a fourth out of an empty margin.
    const profiles = pageStrips({ tops: [100, 260, 420], height: 800 });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(3);
  });

  test('fewer than three staves is not a rhythm worth extrapolating', () => {
    const profiles = pageStrips({ tops: [100, 260] });
    const found = trackCombs(profiles.map((p) => combPeaks(p, 12)), 12);
    expect(fillMissedStaves(found, profiles, 12)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `fillMissedStaves is not a function`.

- [ ] **Step 3: Implement it**

```js
// The page has a rhythm; use it.
//
// Systems on a printed page are evenly spaced, so the staves that were found
// say where the ones that were missed must be. A PREDICTED position is then
// accepted on far weaker evidence than an unprompted one — which is the whole
// point: the shadow at the foot of a photographed page costs a system its
// score, not its existence. On the reference page this is what turned seven
// systems into ten.
//
// The weak threshold is safe only because the position is predicted. Nothing
// here can invent a stave in the middle of a blank margin: a prediction must
// still find some comb response in half the strips it crosses.
export function fillMissedStaves(staves, profiles, pitch, { votes = 0.5, floor = 0.05 } = {}) {
  if (staves.length < 3) return staves;      // two points are not a rhythm
  const strips = profiles.length;
  const height = profiles[0].length;
  const tops = staves.map((s) => s.y0[Math.floor(strips / 2)]);
  const gaps = tops.slice(1).map((y, i) => y - tops[i]).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];

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
    if (out.some((s) => Math.abs(s.y0[Math.floor(strips / 2)] - want) < gap * 0.4)) continue;
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scan-read.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/scan-read.test.js src/analysis/scan-read.js
git commit -m "The page has a rhythm, so a missed system can be predicted"
```

---

### Task 5: Rewiring readPage, and proving it on a real page

**Files:**
- Modify: `src/analysis/scan-read.js:244-282` (`readPage`), and delete `stripPeaks` (lines 88-106), `trackLines` (110-151), `groupStaves` (153-168)
- Modify: `tools/scan-probe.mjs` — it currently string-patches `stripPeaks`/`trackLines` thresholds that will no longer exist
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Consumes: `combPeaks`, `trackCombs`, `fillMissedStaves`.
- Produces: `stavesToLines(staves, strips) → [{ lines: [{ at: Float32Array, mid: number }] × 5, space: number }]` — the shape `findBars()` and `findHeads()` already take. `readPage()`'s own return shape is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan-read.test.js`:

```js
import { stavesToLines } from '../src/analysis/scan-read.js';

describe('stavesToLines', () => {
  test('five lines a step apart, in the shape the head finder takes', () => {
    const strips = 40;
    const y0 = new Float32Array(strips).fill(100);
    const step = new Float32Array(strips).fill(12);
    const [staff] = stavesToLines([{ y0, step }], strips);
    expect(staff.lines).toHaveLength(5);
    expect(staff.lines[0].at[0]).toBeCloseTo(100, 5);
    expect(staff.lines[4].at[0]).toBeCloseTo(148, 5);
    expect(staff.lines[2].mid).toBeCloseTo(124, 5);
    expect(staff.space).toBeCloseTo(12, 5);
  });

  test('a sagging stave sags on every line together', () => {
    const strips = 40;
    const y0 = Float32Array.from({ length: strips }, (_, s) => 100 + s * 0.2);
    const step = new Float32Array(strips).fill(12);
    const [staff] = stavesToLines([{ y0, step }], strips);
    for (let k = 0; k < 5; k++) {
      expect(staff.lines[k].at[39] - staff.lines[k].at[0]).toBeCloseTo(7.8, 1);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `stavesToLines is not a function`.

- [ ] **Step 3: Implement `stavesToLines` and rewire `readPage`**

Add after `fillMissedStaves`:

```js
// A tracked stave, in the shape the bar and head finders take: five lines,
// each sampled once per strip, plus the midpoint they use to reach for ledger
// lines above and below.
export function stavesToLines(staves, strips) {
  return staves.map(({ y0, step }) => {
    const lines = [0, 1, 2, 3, 4].map((index) => {
      const at = new Float32Array(strips);
      for (let s = 0; s < strips; s++) at[s] = y0[s] + index * step[s];
      return { at, mid: at[Math.floor(strips / 2)] };
    });
    let sum = 0;
    for (let s = 0; s < strips; s++) sum += step[s];
    return { lines, space: sum / strips };
  });
}
```

Then replace the body of `readPage` between the `pageScale` guard and the `out` mapping (currently lines 260-265):

```js
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
```

Delete `stripPeaks`, `trackLines` and `groupStaves` — nothing calls them now. Leave `pageScale`, `findBars`, `findHeads`, `toGray` and `boxBlur` alone.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — 404 existing tests plus the 19 new ones. If any existing test fails, it is reading something this task deleted; fix the test's import rather than restoring the dead function.

- [ ] **Step 5: Update the probe to run the shipped module**

In `tools/scan-probe.mjs`, the `evaluate` block fetches `scan-read.js` and string-replaces `const floor = (x1 - x0) * 0.55;` and the `trackLines` filter. Those lines are gone. Replace the whole patching block with a plain import, keeping the threshold arguments only for the beam constants Task 6 adds:

```js
  const { readPage } = await import('/src/analysis/scan-read.js');
```

- [ ] **Step 6: Measure the real page**

In one terminal: `npm run dev -- --port 5177`
In another: `node tools/scan-probe.mjs ~/Downloads/Menuet.pdf`

Expected: **10 staves**, tops near 303, 465, 626, 786, 947, 1100, 1252, 1415, 1584, 1745, spaces 12.0–12.3. Open `.../probe/comb-page.png` and confirm the purple lines sit on the printed lines. Baseline was 2 staves.

If it is not 10, the constants to move are `combPeaks`'s `floor` (down, to accept fainter systems) and `fillMissedStaves`'s `votes` (down, to accept a system on weaker agreement). Record what you changed and why in the commit message.

- [ ] **Step 7: Commit**

```bash
git add src/analysis/scan-read.js tests/scan-read.test.js tools/scan-probe.mjs
git commit -m "Every system on the page, not two of ten"
```

---

### Task 6: Beams are not noteheads

**Files:**
- Modify: `src/analysis/scan-read.js` (add `beamMask` after `stavesToLines`; call it in `readPage`)
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `beamMask(ink: Uint8Array, w: number, h: number, space: number, opts?: { run?: number, bulge?: number }) → Uint8Array` — a copy of `ink` with beams removed. `run` defaults to `2.4` (how long, in staff spaces, a horizontal run must be to be beam-like), `bulge` to `1.8` (how much taller than the beam's own median thickness a column may be before it is taken to be a notehead and left alone).

**Why a median and not a threshold:** the first attempt erased any long horizontal run thinner than a fixed cut. On the reference page that failed both ways — a cut of 0.5 staff spaces left chains of false heads riding the beams, because this edition's double beams merge into one thick bar at photograph resolution; a cut of 1.2 erased the real noteheads with them, dropping the count from 403 to 158. A beam's thickness is *constant along its length* and a notehead makes it bulge, so the beam measures itself and the bulge is what gets spared.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan-read.test.js`:

```js
import { beamMask } from '../src/analysis/scan-read.js';

// A page 120×60: one horizontal beam 5px thick, with a notehead hanging off it.
function beamAndHead() {
  const w = 120;
  const h = 60;
  const ink = new Uint8Array(w * h);
  const set = (x, y) => { ink[y * w + x] = 1; };
  for (let x = 10; x < 100; x++) for (let y = 20; y < 25; y++) set(x, y);   // beam
  for (let x = 55; x < 70; x++) {                                           // head
    for (let y = 25; y < 37; y++) {
      if (((x - 62) / 7) ** 2 + ((y - 31) / 6) ** 2 <= 1) set(x, y);
    }
  }
  return { ink, w, h };
}

describe('beamMask', () => {
  test('the beam goes', () => {
    const { ink, w, h } = beamAndHead();
    const body = beamMask(ink, w, h, 12);
    expect(body[22 * w + 20]).toBe(0);
    expect(body[22 * w + 90]).toBe(0);
  });

  test('the notehead stays', () => {
    const { ink, w, h } = beamAndHead();
    const body = beamMask(ink, w, h, 12);
    expect(body[31 * w + 62]).toBe(1);
    let left = 0;
    for (let y = 25; y < 37; y++) for (let x = 55; x < 70; x++) left += body[y * w + x];
    expect(left).toBeGreaterThan(90);        // the head is essentially untouched
  });

  test('a notehead on its own is never mistaken for a beam', () => {
    const w = 60;
    const h = 40;
    const ink = new Uint8Array(w * h);
    for (let x = 20; x < 35; x++) {
      for (let y = 14; y < 26; y++) {
        if (((x - 27) / 7) ** 2 + ((y - 20) / 6) ** 2 <= 1) ink[y * w + x] = 1;
      }
    }
    const body = beamMask(ink, w, h, 12);
    expect([...body].reduce((a, b) => a + b, 0)).toBe([...ink].reduce((a, b) => a + b, 0));
  });

  test('a merged double beam goes as one, because it measures itself', () => {
    // Two 4px beams with a 3px gap, blurred into one 11px bar — the case a
    // fixed thickness cut could not survive.
    const w = 120;
    const h = 60;
    const ink = new Uint8Array(w * h);
    for (let x = 10; x < 100; x++) for (let y = 20; y < 31; y++) ink[y * w + x] = 1;
    const body = beamMask(ink, w, h, 12);
    expect(body[25 * w + 55]).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `beamMask is not a function`.

- [ ] **Step 3: Implement it**

```js
// Beams, erased before noteheads are hunted.
//
// A beamed page fuses heads, stems and beams into one shape, and the head
// finder scores any ellipse-sized patch of solid ink — so on a page of
// sixteenths it reports a chain of heads riding along every beam. On the
// reference page that was 748 detections where there are about 320 notes.
//
// A beam is a long horizontal bar and a notehead is not: a head is at most a
// space and a half wide. But a fixed thickness cut cannot separate them, since
// a head TOUCHING a beam is one connected shape with it — cut thin and the
// beams stay, cut thick and the heads go with them. So the beam measures
// itself: its thickness is constant along its length, and where a head joins
// it the column is far taller than that. Erase to the beam's own median, spare
// the bulge.
//
// Slurs go too, being long and thinner still, and they were noise.
export function beamMask(ink, w, h, space, { run = 2.4, bulge = 1.8 } = {}) {
  const body = new Uint8Array(ink);
  const runFloor = Math.max(3, Math.round(space * run));
  // The height of the contiguous ink that this pixel belongs to.
  const extent = (x, y) => {
    let up = y;
    while (up > 0 && body[(up - 1) * w + x]) up--;
    let down = y;
    while (down < h - 1 && body[(down + 1) * w + x]) down++;
    return { top: up, bottom: down, tall: down - up + 1 };
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
        // A run of ink taller than a notehead everywhere along it is not a
        // beam at all — it is a black chord or the page edge. Leave it.
        if (median <= space * 1.4) {
          for (let k = x; k < end; k++) {
            const { top, bottom, tall } = extent(k, y);
            if (tall > median * bulge) continue;    // a head joins here
            for (let yy = top; yy <= bottom; yy++) body[yy * w + k] = 0;
          }
        }
      }
      x = end;
    }
  }
  return body;
}
```

Then in `readPage`, hunt heads on the cleaned page while bars stay on the raw one (a barline is a full-height column and beam removal must not be allowed to nibble at it):

```js
  const body = beamMask(ink, w, h, space);

  const out = staves.map((staff) => {
    const bars = findBars(ink, w, h, staff, stripW, space);
    const heads = findHeads(body, w, h, staff, staff.space);
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS — 404 existing plus 23 new.

- [ ] **Step 5: Measure the real page**

With the dev server running: `node tools/scan-probe.mjs ~/Downloads/Menuet.pdf`

Expected: 10 staves still, and **heads within ±10% of 320 — roughly 290 to 350 — with no system below 20 or above 45** (each system of this page holds two bars of sixteenths, so about 32). Baseline before beam removal on the same page: 748.

Open `.../probe/comb-page.png` and check the beamed groups specifically: there should be one ellipse per notehead and none sitting on a beam.

If the count is high, lower `bulge` toward 1.4 (spare fewer columns). If real heads are being lost, raise it toward 2.2, or raise `run` so that only genuinely long bars are considered. Record the numbers you got in the commit message — the next phase is planned against them.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/scan-read.js tests/scan-read.test.js
git commit -m "A beam measures itself, so a notehead touching one survives"
```

---

### Task 7: Write down what the page now reads

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-scan-alignment-design.md` (the table under "What the probe found")

- [ ] **Step 1: Add the measured row**

The spec's table records the state before this work. Add a row for what Phase 1 achieved, with the real numbers from Task 5 Step 6 and Task 6 Step 5 — not the targets. If a target was missed, say by how much and leave the next phase's plan to deal with it: a spec that records the hoped-for number is worse than no spec.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-14-scan-alignment-design.md
git commit -m "What the page reads after phase one"
```

---

## Self-Review

**Spec coverage.** Phase 1 of the spec asks for comb staff finding (Tasks 1–3), predicted systems (Task 4), both wired in (Task 5), beam removal by thickness profile (Task 6), and a measurement against hand-counted ground truth (Tasks 5 and 6, step 5/6). Phases 2–4 of the spec — the pitch fit, the detect/align loop, the marks and cursor — are deliberately not in this plan; they get their own once the numbers here are real.

**Type consistency.** `combPeaks` returns `{y0, step, score}` and `trackCombs` consumes exactly that. `trackCombs` returns `{y0: Float32Array, step: Float32Array}`, which is what `fillMissedStaves` reads and returns and what `stavesToLines` converts. `stavesToLines` produces `{lines: [{at, mid}], space}`, which is the shape `findBars(ink, w, h, staff, stripW, space)` and `findHeads(ink, w, h, staff, space)` already take today — checked against `src/analysis/scan-read.js:170` and `:198`.

**Risk carried forward.** Task 6's median approach is untested against the real page; the earlier fixed-cut attempt is what failed there. Its measurement step is therefore a real gate, with named constants to move and an instruction to record what happened. If the median cannot separate merged beams from heads either, Phase 1 is not finished and the next attempt is to detect beams as slanted segments rather than row runs — that belongs in a follow-up plan, not in a widened Task 6.
