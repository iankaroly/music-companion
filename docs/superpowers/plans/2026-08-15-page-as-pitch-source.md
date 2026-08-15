# Reading Pitch Off The Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a photographed page an independent source of pitch — read the clef and key signature off the paper so a notehead's position becomes an actual note, instead of being guessed from the audio it is meant to be judging.

**Architecture:** The page reader already measures each notehead's `step` (its position between the staff lines). Today `scan-pitch.js` turns that into pitch by fitting the clef offset *from the recording*, which makes the page depend on the take and the take depend on the page — a cycle. This plan reads the clef and key signature from the image instead, breaking the cycle, and hands absolute MIDI pitches to `align-score.js` (a full edit-distance aligner) in place of the positional matcher in `scan-align.js` that fails on detection noise.

**Tech Stack:** Vanilla ES modules, Vitest for unit tests, Puppeteer-core + chrome-headless-shell for image benchmarks against the Vite dev server on port 5199.

## Global Constraints

- No new runtime dependencies. Benchmark-only dependencies (fonts) live in `tools/` and must not ship in `dist/`.
- Every image benchmark requires `npm run dev` running on port 5199 in another terminal.
- Existing corpus baselines must not regress: `npm run scan:corpus` core mean ≥ 97%, hard mean ≥ 83%.
- `npx vitest run` must stay green (currently 467 tests, 49 files).
- No component may state a pitch it is not confident of. Where confidence is unavailable, return `null` and let the caller refuse — never fall back to a guess.
- Comment style follows the existing codebase: explain *why*, in prose, including what went wrong before.

---

## Roadmap

This plan is **Phase 1** only. Later phases get their own plans once this one lands, because each needs what this one produces.

| Phase | Delivers | Blocked by |
|---|---|---|
| **1 — this plan** | Clef + key read off the page; absolute pitches; proper edit-distance alignment | — |
| 2 — Accidentals & confidence | Inline accidentals, mid-system clef changes, per-note confidence gating in the UI | Needs real photographs (Phase 1 Task 7) |
| 3 — Rhythm | Rests, augmentation dots, checksum-driven correction of flags and tuplets, ties | Phase 1 |
| 4 — Scale | Bar-level page↔score mapping, library integration | Phases 1–3 |

**Why this order:** Phase 1 is the only phase that can be honestly graded on synthetic pages. Clefs and key signatures sit at the staff head where nothing crowds them; accidentals sit against noteheads where fingerings, slurs and editorial marks do. Grading accidentals on drawn pages would flatter the result — which is the mistake `tools/real-page-check.mjs` already documents.

---

### Task 1: Drop phantom staves

Every photographed page in both benchmarks reports one more staff than was drawn (`7/6`). A probe against the `photograph` corpus case shows the extra staff carries **0 noteheads and 0 barlines**, while the six real systems carry 80–84 heads each. It is a comb peak that locked onto the page gradient. It inflates every recall denominator and would corrupt bar numbering downstream.

A staff with neither heads nor barlines is not a staff. A system of nothing but rests still has barlines, so this predicate cannot discard real music.

**Files:**
- Modify: `src/analysis/scan-read.js` (near the `return { staves: out, ... }` at the end of `readPage`)
- Test: `tests/scan-read.test.js`

**Interfaces:**
- Produces: `export function realStaff(staff)` → `boolean`

- [ ] **Step 1: Write the failing test**

Add to `tests/scan-read.test.js`:

```js
import { realStaff } from '../src/analysis/scan-read.js';

describe('realStaff', () => {
  test('a staff with noteheads is real', () => {
    expect(realStaff({ heads: [{ x: 0.1 }], bars: [] })).toBe(true);
  });

  test('a staff with only barlines is real — a bar of rests is still a bar', () => {
    expect(realStaff({ heads: [], bars: [0.1, 0.9] })).toBe(true);
  });

  test('a staff with neither is the gradient, not a stave', () => {
    expect(realStaff({ heads: [], bars: [] })).toBe(false);
  });

  test('missing fields are not a stave', () => {
    expect(realStaff({})).toBe(false);
    expect(realStaff(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan-read.test.js`
Expected: FAIL — `realStaff is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/analysis/scan-read.js`:

```js
// A comb locks onto the shadow gradient at the foot of a photographed page and
// reports a stave that is not there: every photographed case in both benchmarks
// read 7 staves where 6 were drawn, and the seventh carried no noteheads and no
// barlines while the real six carried eighty each. It cost nothing visible and
// everything countable — a phantom system inflates every recall denominator and
// would renumber every bar after it.
//
// Heads OR bars, not heads AND bars: a system of nothing but rests has no
// noteheads and is still a system, and dropping it would lose the bars that
// carry the count past it.
export function realStaff(staff) {
  return ((staff?.heads?.length ?? 0) > 0) || ((staff?.bars?.length ?? 0) > 0);
}
```

Then change the return of `readPage` from:

```js
  return { staves: out, strips: STRIPS, space: space / h };
```

to:

```js
  return { staves: out.filter(realStaff), strips: STRIPS, space: space / h };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scan-read.test.js`
Expected: PASS

- [ ] **Step 5: Verify both benchmarks improve**

Run (with `npm run dev` up): `npm run scan:bars`
Expected: every `staves` column reads `6`, and photographed recall rises from ~86% to ~100%.

Run: `npm run scan:corpus`
Expected: `staves` column reads `6/6` on every row; core mean ≥ 97%, hard mean ≥ 83%.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/scan-read.js tests/scan-read.test.js
git commit -m "A stave with no notes and no bars is the shadow, not a system"
```

---

### Task 2: A real music font for the benchmark

Clefs and key signatures cannot be graded against shapes we invent — a classifier tuned against its author's drawing of a bass clef learns that drawing. Bravura is the reference SMuFL font, SIL Open Font License, and is what MuseScore and most engravers render with.

Benchmark-only. It must not reach `dist/`.

**Files:**
- Create: `tools/fonts/Bravura.otf` (downloaded)
- Create: `tools/glyphs.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `export const GLYPH` — `{ trebleClef, bassClef, cClef, sharp, flat, natural }`, each a SMuFL codepoint string.

- [ ] **Step 1: Download the font**

```bash
mkdir -p tools/fonts
curl -L -o tools/fonts/Bravura.otf \
  https://raw.githubusercontent.com/steinbergmedia/bravura/master/redist/otf/Bravura.otf
```

Verify: `ls -la tools/fonts/Bravura.otf` — expect a file over 300KB.

- [ ] **Step 2: Confirm it is not bundled**

Run: `grep -rn "tools/fonts" vite.config.js public/ src/`
Expected: no output. `tools/` is outside the Vite root's served assets, so nothing to exclude — record this check so a later change cannot ship it silently.

- [ ] **Step 3: Write the glyph table**

Create `tools/glyphs.mjs`:

```js
// SMuFL codepoints, which is how Bravura names its glyphs. Written out rather
// than pasted as literal characters because a bass clef in a source file is
// invisible in half the tools that will ever open it.
export const GLYPH = {
  trebleClef: '',
  bassClef: '',
  cClef: '',
  sharp: '',
  flat: '',
  natural: '',
};

// Where each clef's glyph origin sits, counted in staff spaces DOWN from the
// top line. SMuFL places a clef by the line it names: the treble's spiral is on
// the second line from the bottom, the bass's two dots straddle the second from
// the top, and a C-clef's waist is on the line it is centred on.
export const CLEF_ANCHOR = {
  trebleClef: 3,   // G line — second from the bottom
  bassClef: 1,     // F line — second from the top
  cClef: 2,        // middle line for alto; tenor is drawn one space higher
};
```

- [ ] **Step 4: Commit**

```bash
git add tools/fonts/Bravura.otf tools/glyphs.mjs
git commit -m "Bravura, for pages whose clefs are the clefs an engraver draws"
```

---

### Task 3: Read the clef at the staff head

Three classes for a cello part — bass, tenor, treble — distinguished without machine learning by where the ink sits relative to the stave.

- **Treble** extends far above the top line and below the bottom one: total ink height well over the stave's four spaces.
- **Bass** sits inside the top three spaces and stops: its ink bottom is above the bottom line.
- **C-clef** fills the stave almost exactly and is near-symmetric about its centre.

The clef zone is the horizontal band from the staff's first barline to the first notehead, capped at four staff spaces wide.

**Files:**
- Create: `src/analysis/scan-clef.js`
- Test: `tests/scan-clef.test.js`

**Interfaces:**
- Consumes: `realStaff` from Task 1 (indirectly — staves are already filtered).
- Produces:
  - `export function clefFeatures(column, space)` → `{ top, bottom, height, centroid, symmetry }` in staff spaces relative to the top line, or `null`
  - `export function classifyClef(features)` → `{ clef: 'treble'|'bass'|'tenor'|null, confidence: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/scan-clef.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { clefFeatures, classifyClef } from '../src/analysis/scan-clef.js';

// A column of ink density, one entry per row, covering three staff spaces above
// the top line and three below the bottom one. `space` rows to a staff space.
function column({ space = 10, from, to, height = 10 }) {
  const rows = new Float32Array(space * height);
  const start = Math.round((from + 3) * space);
  const end = Math.round((to + 3) * space);
  for (let i = start; i < end; i++) rows[i] = 1;
  return rows;
}

describe('clefFeatures', () => {
  test('measures ink extent in staff spaces from the top line', () => {
    const f = clefFeatures(column({ from: 0, to: 4 }), 10);
    expect(f.top).toBeCloseTo(0, 1);
    expect(f.bottom).toBeCloseTo(4, 1);
    expect(f.height).toBeCloseTo(4, 1);
  });

  test('an empty column has no features', () => {
    expect(clefFeatures(new Float32Array(100), 10)).toBeNull();
  });
});

describe('classifyClef', () => {
  test('ink far above and below the stave is a treble clef', () => {
    const f = clefFeatures(column({ from: -1.5, to: 5.5 }), 10);
    expect(classifyClef(f).clef).toBe('treble');
  });

  test('ink confined to the top three spaces is a bass clef', () => {
    const f = clefFeatures(column({ from: 0, to: 2.6 }), 10);
    expect(classifyClef(f).clef).toBe('bass');
  });

  test('ink filling the stave and no more is a C-clef', () => {
    const f = clefFeatures(column({ from: 0.1, to: 3.9 }), 10);
    expect(classifyClef(f).clef).toBe('tenor');
  });

  test('nothing to read is refused rather than guessed', () => {
    expect(classifyClef(null).clef).toBeNull();
    expect(classifyClef(null).confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan-clef.test.js`
Expected: FAIL — cannot resolve `../src/analysis/scan-clef.js`

- [ ] **Step 3: Write the implementation**

Create `src/analysis/scan-clef.js`:

```js
// Which clef a stave is written in, read off the paper.
//
// This is the file that breaks the cycle. scan-pitch.js works out the clef from
// the RECORDING — it fits the one unknown offset from the pitches you produced
// — so the page's notes depend on the take being correctly placed, and placing
// the take depends on the page's notes. Each waits for the other, and when the
// placement went wrong (which it does: shape-only matching cannot survive a
// missed notehead) everything downstream inherited it silently.
//
// A clef is ink at a known place, and it does not care what you played.
//
// HOW THREE CLEFS ARE TOLD APART WITHOUT LEARNING ANYTHING
//
// Not by their shape. By where they reach:
//
//   treble   spirals well above the top line and hangs below the bottom one —
//            over six staff spaces of ink for a stave four spaces tall
//   bass     two dots and a hook in the TOP THREE spaces; its ink stops before
//            the bottom line
//   C-clef   fills the stave and almost exactly the stave, symmetric about its
//            own middle
//
// Those three are separable by extent and symmetry alone, which is a handful of
// numbers off an ink profile rather than a classifier that has to be trained
// and shipped. It will not survive a hand-copied part, and it does not have to:
// a clef it cannot read is refused, and a refused clef costs the verdicts on
// that stave rather than making them up.

// How far outside the stave the clef zone is sampled, in staff spaces.
const MARGIN = 3;

/**
 * Ink extent of one horizontal band, measured in staff spaces from the top line.
 *
 * `column` is one value per row — the fraction of that band's columns inked —
 * starting MARGIN spaces above the top line. `space` is rows per staff space.
 *
 * Returns null when there is not enough ink to measure, which is the honest
 * answer for a stave whose head was cropped off the photograph.
 */
export function clefFeatures(column, space) {
  if (!column?.length || !(space > 0)) return null;
  const INK = 0.12;
  let first = -1;
  let last = -1;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < column.length; i++) {
    const v = column[i];
    if (v < INK) continue;
    if (first < 0) first = i;
    last = i;
    weighted += i * v;
    total += v;
  }
  if (first < 0 || total <= 0) return null;
  const toSpaces = (row) => row / space - MARGIN;
  const top = toSpaces(first);
  const bottom = toSpaces(last);
  const centroid = toSpaces(weighted / total);
  const height = bottom - top;
  // How near the centre of mass sits to the middle of the ink. A C-clef is
  // built symmetrically about its waist; a bass clef is top-heavy by design.
  const middle = (top + bottom) / 2;
  const symmetry = height > 0 ? 1 - Math.abs(centroid - middle) / height : 0;
  return { top, bottom, height, centroid, symmetry };
}

// A stave is four spaces tall, so these are read against four.
const STAVE = 4;

/**
 * Which clef those measurements are.
 *
 * Returns { clef, confidence }. `clef` null means it could not be told, and the
 * caller must refuse the stave rather than assume the commonest one — assuming
 * bass on a cello part would be right most of the time and catastrophic the
 * rest, because a clef wrong by a sixth is a page of confident wrong verdicts.
 */
export function classifyClef(features) {
  if (!features) return { clef: null, confidence: 0 };
  const { top, bottom, height, symmetry } = features;
  // Treble first: it is the only one that leaves the stave at both ends, and
  // nothing else comes close to its height.
  if (height > STAVE * 1.4 && top < -0.4 && bottom > STAVE - 0.4) {
    return { clef: 'treble', confidence: Math.min(1, height / (STAVE * 1.8)) };
  }
  // Bass: stops before the bottom line and starts at or near the top.
  if (bottom < STAVE - 0.8 && top < 1) {
    return { clef: 'bass', confidence: Math.min(1, (STAVE - bottom) / 1.6) };
  }
  // C-clef: fills the stave, near-symmetric. Tenor rather than alto because a
  // cello part in a C-clef is in tenor; alto belongs to the viola and reading
  // it here would be a guess dressed as a fact.
  if (height > STAVE * 0.8 && height < STAVE * 1.3 && symmetry > 0.7) {
    return { clef: 'tenor', confidence: symmetry };
  }
  return { clef: null, confidence: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scan-clef.test.js`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/analysis/scan-clef.js tests/scan-clef.test.js
git commit -m "A clef is told by where it reaches, not by what it looks like"
```

---

### Task 4: Grade the clef reader on drawn-then-photographed pages

The unit tests prove the rules; they do not prove the rules survive a camera. This benchmark draws real Bravura clefs, spoils the page exactly as `scan-corpus.mjs` does, and reports what the classifier makes of each.

**Files:**
- Create: `tools/scan-clef-check.mjs`
- Modify: `package.json` (add `scan:clef` script)

**Interfaces:**
- Consumes: `GLYPH`, `CLEF_ANCHOR` from Task 2; `clefFeatures`, `classifyClef` from Task 3.

- [ ] **Step 1: Write the benchmark**

Create `tools/scan-clef-check.mjs`. It draws six systems per page, each with a known clef, at three spoilings — clean, photographed, and photographed small — and prints a confusion matrix.

```js
// Clefs, graded against a camera.
//
// The unit tests in tests/scan-clef.test.js prove the RULES: ink this far above
// the stave is a treble, ink stopping short of the bottom line is a bass. What
// they cannot prove is that a photograph still presents those extents — a blur
// wide enough to close the gap between a bass clef's two dots is a blur that
// may also drag its ink below the line it stops at.
//
// So the pages here carry real Bravura clefs, spoiled the way scan-corpus.mjs
// spoils its pages, and the classifier is asked what it sees.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:clef
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { GLYPH, CLEF_ANCHOR } from './glyphs.mjs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({ glyph, anchor, fontBase64: b64 }) => {
  const face = new FontFace('BravuraTest', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  const { clefFeatures, classifyClef } = await import('/src/analysis/scan-clef.js');

  const KINDS = [
    { name: 'treble', glyph: glyph.trebleClef, anchor: anchor.trebleClef },
    { name: 'bass', glyph: glyph.bassClef, anchor: anchor.bassClef },
    // Tenor: a C-clef centred one space above the middle line.
    { name: 'tenor', glyph: glyph.cClef, anchor: 1 },
  ];

  // One system, one clef, drawn on a five-line stave.
  function drawSystem(g, { space, x0, W, top, kind, warp, tilt }) {
    const bendAt = (x) => warp * space * Math.sin((x / W) * Math.PI);
    const tiltAt = (x) => tilt * (x - W / 2);
    const lineY = (l, x) => top + l * space + bendAt(x) + tiltAt(x);
    g.fillStyle = '#111';
    for (let l = 0; l < 5; l++) {
      for (let x = x0; x < W - space * 2; x += 4) {
        g.fillRect(x, lineY(l, x), 5, Math.max(1, space * 0.1));
      }
    }
    // The opening barline, which is where the clef zone starts.
    g.fillRect(x0, lineY(0, x0), Math.max(1.4, space * 0.12), space * 4);
    // The clef itself. Bravura is drawn at a size where one em is four spaces.
    g.font = `${space * 4}px BravuraTest`;
    g.textBaseline = 'alphabetic';
    g.fillText(kind.glyph, x0 + space * 0.6, lineY(kind.anchor, x0 + space));
  }

  async function spoil(source, { blur = 0, contrast = 1, tint = null, jpeg = null, scale = 1 }) {
    const W = Math.round(source.width * scale);
    const H = Math.round(source.height * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const filters = [];
    if (blur) filters.push(`blur(${blur}px)`);
    if (contrast !== 1) filters.push(`contrast(${contrast})`);
    g.filter = filters.length ? filters.join(' ') : 'none';
    g.drawImage(source, 0, 0, W, H);
    g.filter = 'none';
    if (tint) {
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, `rgba(${tint.join(',')},0.42)`);
      grad.addColorStop(1, `rgba(${tint.join(',')},0.12)`);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    if (jpeg === null) return c;
    const blob = await new Promise((d) => c.toBlob(d, 'image/jpeg', jpeg));
    const bmp = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
    return out;
  }

  // The clef zone, sampled straight off the spoiled page: the band just right
  // of the opening barline, three staff spaces above and below the stave.
  function columnAt(canvas, { x, width, top, space }) {
    const MARGIN = 3;
    const y0 = Math.round(top - MARGIN * space);
    const rows = Math.round(space * (4 + MARGIN * 2));
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const data = g.getImageData(Math.round(x), Math.max(0, y0), Math.round(width), rows).data;
    const out = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      let inked = 0;
      for (let cx = 0; cx < width; cx++) {
        const i = ((r * Math.round(width)) + cx) * 4;
        const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (grey < 150) inked++;
      }
      out[r] = inked / width;
    }
    return out;
  }

  const SPOILS = {
    clean: { scale: 1 },
    photographed: { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 },
    small: { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.4 },
  };

  const results = [];
  for (const [spoilName, spoilOpts] of Object.entries(SPOILS)) {
    const space = 18;
    const W = 1200;
    const gap = space * 14;
    const H = Math.round(space * 8 + KINDS.length * gap);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const tops = [];
    for (const [i, kind] of KINDS.entries()) {
      const top = space * 4 + i * gap;
      tops.push(top);
      drawSystem(g, { space, x0: space * 3, W, top, kind, warp: 0.7, tilt: 0.004 });
    }
    const shot = await spoil(c, spoilOpts);
    const s = spoilOpts.scale ?? 1;
    for (const [i, kind] of KINDS.entries()) {
      const col = columnAt(shot, {
        x: (space * 3 + space * 0.3) * s,
        width: Math.max(4, space * 3.6 * s),
        top: tops[i] * s,
        space: space * s,
      });
      const got = classifyClef(clefFeatures(col, space * s));
      results.push({
        spoil: spoilName, want: kind.name, got: got.clef,
        confidence: +got.confidence.toFixed(2),
      });
    }
  }
  return results;
});

await browser.close();

console.log('\nCLEFS — Bravura glyphs, spoiled the way a camera spoils them\n');
console.log('spoiling        want     read     confidence');
let right = 0;
for (const r of report) {
  const mark = r.want === r.got ? ' ' : '  <-- WRONG';
  if (r.want === r.got) right++;
  console.log(
    `${r.spoil.padEnd(15)} ${r.want.padEnd(8)} ${String(r.got).padEnd(8)} `
    + `${String(r.confidence).padStart(5)}${mark}`,
  );
}
console.log(`\n${right}/${report.length} read correctly\n`);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, after the `scan:bars` line:

```json
    "scan:bars": "node tools/scan-bars-check.mjs",
    "scan:clef": "node tools/scan-clef-check.mjs"
```

- [ ] **Step 3: Run it**

Run (with `npm run dev` up): `npm run scan:clef`
Expected: all three clefs read correctly on `clean`. If `photographed` or `small` misreads, tune the thresholds in `classifyClef` — and add the failing case as a unit test in `tests/scan-clef.test.js` before changing any threshold, so the tuning is pinned.

- [ ] **Step 4: Commit**

```bash
git add tools/scan-clef-check.mjs package.json
git commit -m "Clefs, graded against a camera rather than against their author"
```

---

### Task 5: Read the key signature

Immediately right of the clef, sharps or flats stand on fixed lines in a fixed order. This is the easiest thing on the page: a known position, a small alphabet, and only fifteen possible answers.

Order of sharps: F C G D A E B. Order of flats: B E A D G C F. Count them and the key is determined; their vertical positions are a cross-check that the count was read correctly.

**Files:**
- Create: `src/analysis/scan-key.js`
- Test: `tests/scan-key.test.js`

**Interfaces:**
- Produces:
  - `export function keyFromCount(count, kind)` → `{ sharps: number, flats: number, alter: number[] }` where `alter` is a 7-entry array indexed by diatonic degree C=0..B=6, each −1, 0 or +1
  - `export const SHARP_ORDER`, `export const FLAT_ORDER` — degree indices in signature order

- [ ] **Step 1: Write the failing test**

Create `tests/scan-key.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { keyFromCount, SHARP_ORDER, FLAT_ORDER } from '../src/analysis/scan-key.js';

describe('key signatures', () => {
  test('no accidentals is C major — nothing altered', () => {
    const k = keyFromCount(0, 'sharp');
    expect(k.alter).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test('two sharps raises F and C', () => {
    const k = keyFromCount(2, 'sharp');
    expect(k.sharps).toBe(2);
    expect(k.alter[3]).toBe(1); // F
    expect(k.alter[0]).toBe(1); // C
    expect(k.alter[4]).toBe(0); // G untouched
  });

  test('three flats lowers B, E and A', () => {
    const k = keyFromCount(3, 'flat');
    expect(k.flats).toBe(3);
    expect(k.alter[6]).toBe(-1); // B
    expect(k.alter[2]).toBe(-1); // E
    expect(k.alter[5]).toBe(-1); // A
    expect(k.alter[3]).toBe(0);  // F untouched
  });

  test('the orders are the orders an engraver writes them in', () => {
    expect(SHARP_ORDER).toEqual([3, 0, 4, 1, 5, 2, 6]); // F C G D A E B
    expect(FLAT_ORDER).toEqual([6, 2, 5, 1, 4, 0, 3]);  // B E A D G C F
  });

  test('more than seven is not a key signature', () => {
    expect(keyFromCount(8, 'sharp')).toBeNull();
    expect(keyFromCount(-1, 'flat')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan-key.test.js`
Expected: FAIL — cannot resolve `../src/analysis/scan-key.js`

- [ ] **Step 3: Write the implementation**

Create `src/analysis/scan-key.js`:

```js
// The key signature, which is the second half of turning a position into a note.
//
// A clef says which line is which note. A key signature says which of those
// notes are sharp or flat for the whole page — and unlike an accidental, which
// stands against one notehead in a crowd of fingerings and slurs, it stands
// alone at the head of the stave in a fixed order on fixed lines. Fifteen
// possible answers and nothing overlapping it. It is the easiest thing on the
// page to read and it is worth the whole of a semitone on every note it touches.
//
// Degrees are indexed C=0, D=1, E=2, F=3, G=4, A=5, B=6 — the diatonic degree,
// not the pitch, because that is what a step on a stave gives you.

// F C G D A E B — the order sharps are written in, and the reason a key with
// three sharps has F, C and G sharp rather than any other three.
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
// B E A D G C F — the same run backwards, which is why flats undo sharps.
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * The alterations a signature of `count` sharps or flats applies.
 *
 * Returns { sharps, flats, alter }, where `alter[degree]` is +1, 0 or -1.
 * Returns null for a count that is not a key signature — which is a reading
 * that has gone wrong, and saying so is better than altering six degrees
 * because seven symbols were counted where there are five.
 */
export function keyFromCount(count, kind) {
  if (!Number.isInteger(count) || count < 0 || count > 7) return null;
  if (kind !== 'sharp' && kind !== 'flat') return null;
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const order = kind === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  const delta = kind === 'sharp' ? 1 : -1;
  for (let i = 0; i < count; i++) alter[order[i]] = delta;
  return {
    sharps: kind === 'sharp' ? count : 0,
    flats: kind === 'flat' ? count : 0,
    alter,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scan-key.test.js`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/analysis/scan-key.js tests/scan-key.test.js
git commit -m "A key signature is fifteen answers on fixed lines"
```

---

### Task 6: Turn step + clef + key into a pitch

The join. `scan-read.js` already gives each notehead a `step` — half staff-spaces above the bottom line. With a clef and a key signature that becomes a MIDI number, read entirely from the page.

Reference values, all as MIDI, for the bottom line of the stave:
- **Bass clef**: bottom line is G2 = 43
- **Tenor clef**: bottom line is F3 = 53
- **Treble clef**: bottom line is E4 = 64

**Files:**
- Create: `src/analysis/scan-notes.js`
- Test: `tests/scan-notes.test.js`

**Interfaces:**
- Consumes: `keyFromCount` from Task 5.
- Produces: `export function pitchOf(step, clef, key)` → `{ midi, degree }` or `null`
- Produces: `export const BOTTOM_LINE` — `{ bass: 43, tenor: 53, treble: 64 }`

- [ ] **Step 1: Write the failing test**

Create `tests/scan-notes.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { pitchOf, BOTTOM_LINE } from '../src/analysis/scan-notes.js';
import { keyFromCount } from '../src/analysis/scan-key.js';

const NONE = keyFromCount(0, 'sharp');

describe('pitchOf', () => {
  test('step 0 in bass clef is the G below the bass stave', () => {
    expect(pitchOf(0, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass);
  });

  test('a step up is one degree, not one semitone', () => {
    // G2 -> A2 is a tone.
    expect(pitchOf(1, 'bass', NONE).midi).toBe(45);
    // A2 -> B2 is a tone.
    expect(pitchOf(2, 'bass', NONE).midi).toBe(47);
    // B2 -> C3 is a SEMITONE.
    expect(pitchOf(3, 'bass', NONE).midi).toBe(48);
  });

  test('seven steps is an octave', () => {
    expect(pitchOf(7, 'bass', NONE).midi).toBe(BOTTOM_LINE.bass + 12);
  });

  test('tenor and treble move the whole pattern, nothing else', () => {
    expect(pitchOf(0, 'tenor', NONE).midi).toBe(BOTTOM_LINE.tenor);
    expect(pitchOf(0, 'treble', NONE).midi).toBe(BOTTOM_LINE.treble);
    expect(pitchOf(3, 'treble', NONE).midi - pitchOf(0, 'treble', NONE).midi)
      .toBe(pitchOf(3, 'bass', NONE).midi - pitchOf(0, 'bass', NONE).midi);
  });

  test('two sharps raises every F and C by a semitone', () => {
    const twoSharps = keyFromCount(2, 'sharp');
    // In bass clef step 6 is F3.
    expect(pitchOf(6, 'bass', NONE).midi).toBe(53);
    expect(pitchOf(6, 'bass', twoSharps).midi).toBe(54);
    // Step 1 is A2 — untouched by two sharps.
    expect(pitchOf(1, 'bass', twoSharps).midi).toBe(45);
  });

  test('an unreadable clef refuses rather than assuming bass', () => {
    expect(pitchOf(0, null, NONE)).toBeNull();
    expect(pitchOf(0, 'treble', null)).toBeNull();
    expect(pitchOf(null, 'bass', NONE)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan-notes.test.js`
Expected: FAIL — cannot resolve `../src/analysis/scan-notes.js`

- [ ] **Step 3: Write the implementation**

Create `src/analysis/scan-notes.js`:

```js
// A position on the stave, plus a clef, plus a key signature, is a note.
//
// This is what scan-pitch.js was standing in for. That file fits the one
// unknown — where the pattern starts — from the RECORDING, which works only
// once the recording has already been placed on the page, which is the thing
// the pitches were wanted for. Reading the clef off the paper (scan-clef.js)
// and the signature off the paper (scan-key.js) leaves nothing to fit.
//
// Everything here is arithmetic. The hard part was upstream.

// Semitones above C for each diatonic degree: C D E F G A B.
const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// What the bottom line of the stave IS, as MIDI, in each clef. A clef does
// exactly one thing — it names a line — and every other note on the page
// follows from that one number.
export const BOTTOM_LINE = { bass: 43, tenor: 53, treble: 64 };

// Which diatonic degree the bottom line is, C=0..B=6. Bass bottom line is G,
// tenor is F, treble is E.
const BOTTOM_DEGREE = { bass: 4, tenor: 3, treble: 2 };

/**
 * The note a notehead at `step` represents.
 *
 * `step` counts half staff-spaces up from the bottom line, which is what
 * scan-read.js measures: 0 on the bottom line, 1 in the space above it.
 *
 * Returns { midi, degree } or null. Null when the clef or the key could not be
 * read — and null must be propagated, not defaulted. A cello part is in bass
 * clef most of the time, and "most of the time" is exactly the assumption that
 * makes the other times into confident wrong verdicts a sixth out.
 */
export function pitchOf(step, clef, key) {
  if (!Number.isFinite(step)) return null;
  const base = BOTTOM_LINE[clef];
  const baseDegree = BOTTOM_DEGREE[clef];
  if (base === undefined || !key?.alter) return null;

  // Where this step lands, counted in degrees from the bottom line.
  const octave = Math.floor((baseDegree + step) / 7);
  const degree = ((baseDegree + step) % 7 + 7) % 7;

  // The bottom line's own octave, so the arithmetic is relative to it rather
  // than to a C somewhere off the page.
  const baseOctave = Math.floor(baseDegree / 7);
  const semitonesFromC = DEGREE_SEMITONES[degree] - DEGREE_SEMITONES[baseDegree];
  const midi = base + semitonesFromC + (octave - baseOctave) * 12 + key.alter[degree];
  return { midi, degree };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scan-notes.test.js`
Expected: PASS — all 6 tests

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — 467 existing plus the 17 added by Tasks 1, 3, 5 and 6

- [ ] **Step 6: Commit**

```bash
git add src/analysis/scan-notes.js tests/scan-notes.test.js
git commit -m "Step, clef and key are a note — and the clef now comes off the paper"
```

---

### Task 7: A near-miss cost tier in the aligner

`scan-pitch.js:19` says "The alignment is told to treat a semitone as near-enough." It isn't — `align-score.js:33` returns full `COST.wrong` (1.4) for a semitone, the same as for a genuinely wrong note. That comment describes an intention the code never had.

It matters now. A reference read off a page carries semitone errors from missed accidentals, and those must not cost what a wrong note costs, or the aligner will prefer to skip past correctly-played notes rather than match them.

The tier is opt-in, because it must never soften the MusicXML path: there, a semitone difference genuinely is a wrong note and saying so is the entire point.

**Files:**
- Modify: `src/analysis/align-score.js:17-36` and its `alignScore` signature
- Test: `tests/align-score.test.js`

**Interfaces:**
- Produces: `alignScore(playedNotes, scoreNotes, { nearMiss = false } = {})` — when `nearMiss` is true, a one-semitone difference costs `COST.near` (0.6) instead of `COST.wrong`.

- [ ] **Step 1: Write the failing test**

Add to `tests/align-score.test.js`:

```js
describe('near-miss costing for a reference read off a page', () => {
  const notes = (midis) => midis.map((midi, i) => ({ midi, id: i, start: i }));

  test('by default a semitone is a wrong note, because MusicXML is exact', () => {
    const score = notes([60, 62, 64, 65]);
    const played = notes([60, 62, 63, 65]);   // third note a semitone flat
    const { attempts } = alignScore(played, score);
    expect(attempts[2].verdict).toBe('wrong');
  });

  test('with nearMiss the same note still MATCHES POSITIONALLY rather than being skipped', () => {
    const score = notes([60, 62, 64, 65]);
    const played = notes([60, 62, 63, 65]);
    const { attempts } = alignScore(played, score, { nearMiss: true });
    // Every score note is still paired with the played note in its place.
    expect(attempts.filter(Boolean).length).toBe(4);
    expect(attempts[2].played.midi).toBe(63);
  });

  test('nearMiss does not excuse a note a third out', () => {
    const score = notes([60, 62, 64, 65]);
    const played = notes([60, 62, 68, 65]);
    const { attempts } = alignScore(played, score, { nearMiss: true });
    expect(attempts[2].verdict).toBe('wrong');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/align-score.test.js`
Expected: FAIL — the second test fails because `alignScore` takes no options and the semitone note is skipped rather than paired.

- [ ] **Step 3: Write the implementation**

In `src/analysis/align-score.js`, add to `COST`:

```js
const COST = {
  match: 0,
  octave: 0.5, // right note, wrong register — still tells you something
  // A semitone, when the SCORE ITSELF is a reading rather than a file.
  //
  // Off a photograph, a missed accidental puts a written note a semitone from
  // where it really is, and there is nothing on the page to catch it. Priced at
  // COST.wrong the aligner would rather leave a correctly-played note unmatched
  // (1.0) than pair it with a reference that is one semitone out (1.4) — so the
  // notes most likely to have been read slightly wrong are exactly the ones
  // that would go unmarked. Off MusicXML this must stay OFF: there a semitone
  // is a wrong note and saying so is the whole job.
  near: 0.6,
  wrong: 1.4, // must stay under insert + delete, or wrong notes derail the path
  insert: 1.0, // a played note the score does not have
  delete: 1.0, // a score note that never sounded
};
```

Replace `substitutionCost` and `verdictFor`:

```js
function substitutionCost(scoreNote, playedNote, nearMiss) {
  const distance = playedNote.midi - scoreNote.midi;
  if (distance === 0) return COST.match;
  if (distance % 12 === 0) return COST.octave;
  if (nearMiss && Math.abs(distance) === 1) return COST.near;
  return COST.wrong;
}

function verdictFor(scoreNote, playedNote, nearMiss) {
  const distance = playedNote.midi - scoreNote.midi;
  if (distance === 0) return 'match';
  if (distance % 12 === 0) return 'octave';
  // Reported as its own verdict, not folded into 'match': a note that is a
  // semitone from a reference we are not sure of is a note nothing can judge,
  // and the caller has to be able to withhold rather than approve.
  if (nearMiss && Math.abs(distance) === 1) return 'near';
  return 'wrong';
}
```

Change the signature and both call sites:

```js
export function alignScore(playedNotes, scoreNotes, { nearMiss = false } = {}) {
```

```js
      const diagonal = above[j - 1] + substitutionCost(scoreNote, played[j - 1], nearMiss);
```

```js
      const verdict = verdictFor(scoreNote, playedNote, nearMiss);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/align-score.test.js`
Expected: PASS — including every pre-existing test, since `nearMiss` defaults to false.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/analysis/align-score.js tests/align-score.test.js
git commit -m "A semitone is a wrong note in a file and a doubt on a photograph"
```

---

### Task 8: Wire the read pitches into the scan review

Replace the cycle. `pairNotes` currently calls `findStart` (shape-only positional matching) then `fitPitches` (clef fitted from the audio). With clef and key read from the page, `alignScore` can be given real pitches and does the placing itself — including finding where in the part the take begins, which is what the traceback is for.

`findStart` and `fitPitches` stay in the tree as the fallback for pages whose clef could not be read.

**Files:**
- Modify: `src/ui/scan-view.js:33-122`
- Test: `tests/scan-pair.test.js`

**Interfaces:**
- Consumes: `pitchOf` (Task 6), `classifyClef`/`clefFeatures` (Task 3), `keyFromCount` (Task 5), `alignScore` with `nearMiss` (Task 7).
- Produces: `headsOf(layout)` gains `clef` and `key` per head; `pairNotes` returns `{ ..., readPitch: boolean }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/scan-pair.test.js`:

```js
import { pairNotes } from '../src/ui/scan-view.js';

describe('pairing with pitches read off the page', () => {
  // Heads carrying a midi read from clef + key, not fitted from the audio.
  const heads = (midis) => midis.map((midi, i) => ({
    midi, step: i, page: 0, space: 0.01, x: 0.1 + i * 0.01, y: 0.5,
  }));
  const played = (midis) => midis.map((midi, i) => ({ midi, start: i * 0.5 }));

  const PART = [43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];

  test('a take starting halfway is placed halfway, not at the top', () => {
    const result = pairNotes(heads(PART), played(PART.slice(9)));
    expect(result.placed).toBe(true);
    // The first mark must sit on the tenth notehead, not the first.
    expect(result.marks[0].midi).toBe(PART[9]);
  });

  test('a spurious notehead costs one note, not the rest of the take', () => {
    const withExtra = [...PART.slice(0, 5), 99, ...PART.slice(5)];
    const result = pairNotes(heads(withExtra), played(PART));
    expect(result.placed).toBe(true);
    // Everything after the spurious head still lands on the right note.
    const last = result.marks.at(-1);
    expect(last.midi).toBe(PART.at(-1));
  });

  test('heads with no readable pitch fall back rather than refusing', () => {
    const noPitch = heads(PART).map((h) => ({ ...h, midi: null }));
    const result = pairNotes(noPitch, played(PART));
    expect(result.readPitch).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan-pair.test.js`
Expected: FAIL — `pairNotes` ignores `midi` on heads and routes through `findStart`.

- [ ] **Step 3: Write the implementation**

In `src/ui/scan-view.js`, add above `pairNotes`:

```js
// Placed by the ALIGNER, on pitches read off the page.
//
// The old route asked two questions in the wrong order: findStart guessed where
// the take began from the shape of it alone, then fitPitches worked out the
// clef from the take that had just been placed. Neither could check the other,
// and a page whose noteheads were 85% right — which is every photograph — gave
// findStart a shape sequence broken every seventh note, so the offset it
// returned was whichever one the noise favoured. It reported that as `sure`.
//
// With a clef read off the paper there is nothing to guess. alignScore sees the
// whole take against the whole page and decides everything at once, and its
// edit distance is built for exactly the errors the reader makes: a spurious
// notehead costs one delete (1.0) against the 1.4 per note of staying shifted,
// so it resyncs after a single note instead of never.
function alignByPitch(heads, played) {
  const window = heads
    .map((head, id) => ({ ...head, id }))
    .filter((head) => Number.isFinite(head.midi));
  if (window.length < 2 || played.length < 2) return null;

  let attempts = null;
  try {
    // nearMiss, because this reference is a READING. A missed accidental is a
    // semitone, and a semitone must not cost what a wrong note costs.
    ({ attempts } = alignScore(played, window, { nearMiss: true }));
  } catch {
    return null;
  }

  const seen = new Set();
  const marks = [];
  for (const attempt of attempts) {
    if (!attempt?.played || !attempt.score) continue;
    const at = played.indexOf(attempt.played);
    if (at < 0 || seen.has(at)) continue;
    seen.add(at);
    marks.push({
      ...heads[attempt.score.id],
      note: attempt.played,
      index: at,
      // Carried through so the review can withhold a verdict on a note whose
      // reference was only nearly right. A ring that says "read as a semitone
      // out" is honest; one that says "you played this 100 cents flat" is not.
      verdict: attempt.verdict,
    });
  }
  marks.sort((a, b) => a.index - b.index);
  return marks;
}
```

Then at the top of `pairNotes`, before the existing `findStart` call:

```js
export function pairNotes(heads, played) {
  // The page read its own clef, so the aligner can be given real notes.
  const readPitch = (heads ?? []).some((h) => Number.isFinite(h?.midi));
  if (readPitch) {
    const marks = alignByPitch(heads, played);
    if (marks?.length) {
      return {
        marks,
        heads: heads.length,
        played: played.length,
        unmarked: Math.max(0, played.length - marks.length),
        spare: Math.max(0, heads.length - marks.length),
        placed: true,
        aligned: true,
        readPitch: true,
      };
    }
  }

  // …the old route, for a page whose clef could not be read. See scan-align.js.
  const start = findStart(heads, played);
```

and add `readPitch: false` to each of the three existing return objects in `pairNotes` and `positional`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scan-pair.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/scan-view.js tests/scan-pair.test.js
git commit -m "Place the take with the aligner, on notes the page read itself"
```

---

### Task 9: Photograph the real thing

Everything above is graded on drawn pages. `tools/real-page-check.mjs:53` expects `tests/fixtures/cello-page.jpg` and that file is not in the repo — no real photograph has ever been committed. Phase 2 (accidentals) cannot start honestly without one, because a drawn page has no fingerings, slurs or editorial marks crowding the noteheads, and accidental association is entirely about what is crowding the notehead.

**This task needs the human.** It cannot be completed by an agent.

**Files:**
- Create: `tests/fixtures/` (photographs)
- Create: `tests/fixtures/README.md`

- [ ] **Step 1: Take the photographs**

10–20 pages, on an iPad, of real parts. For each, note the piece, the clef, the key signature and the bar range. Cover deliberately: at least one tenor-clef page, one with a mid-system clef change, one heavily fingered, one from a bound book where the page curves.

- [ ] **Step 2: Record what each one is**

Create `tests/fixtures/README.md` listing, per file: piece, edition, clef(s), key, first and last bar, and anything unusual on the page.

- [ ] **Step 3: Run the existing real-page check against each**

Run: `node tools/real-page-check.mjs tests/fixtures/<name>.jpg`
Record the staff count and head count per page. These become the baseline Phase 2 is graded against.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures
git commit -m "Real pages, photographed, so the next thing is graded on music"
```

---

## Self-Review

**Spec coverage.** Clef → Tasks 3, 4. Key signature → Task 5. Step-to-pitch → Task 6. Breaking the audio-fitted-clef cycle → Tasks 6, 8. Aligner tolerance of detection noise → Tasks 7, 8. Phantom staff → Task 1. Honest grading → Tasks 4, 9. **Not covered by design, deferred to later phases:** inline accidentals, mid-system clef changes, per-note confidence in the UI (Phase 2); rests, dots, flags, tuplets, ties (Phase 3); bar-level page↔score mapping (Phase 4).

**Known gap carried forward.** Task 6 reads the key signature's *count* but nothing in Phase 1 detects the sharps and flats in the image — `keyFromCount` is pure arithmetic awaiting a detector. Phase 2 adds it; until then `pairNotes` runs with `keyFromCount(0, 'sharp')` and a page in two sharps produces semitone errors, which is exactly what Task 7's `nearMiss` tier exists to absorb. This is deliberate: the alignment is correct without the key, only the verdicts are not, and Phase 2 gates verdicts anyway.

**Type consistency.** `clefFeatures` → `classifyClef` both use `{ top, bottom, height, centroid, symmetry }`. `keyFromCount` returns `{ sharps, flats, alter }` and `pitchOf` reads only `key.alter`. `pitchOf` returns `{ midi, degree }`; Task 8 reads only `midi`. `alignScore`'s third parameter is `{ nearMiss }` at both its definition and its one new call site.
