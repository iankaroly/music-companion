// Pages of music, engraved with the real font, with the answer written down.
//
// WHY THIS EXISTS
//
// Everything the reader knows about noteheads it learned from three pages that
// a person marked by hand. The handover has said for three rounds that the lever
// is VARIETY and not tuning — the model trained on the richer of two engravings
// travels much better in both directions, and more patches from pages already in
// the set is flat, 60 giving 94.3% and 397 giving 95.1%. But a fourth page costs
// an evening of clicking, and measured this session about four percent of those
// clicks are wrong: sixteen marks across two files stood on a printed sharp, a
// bass clef and a quarter rest.
//
// So hand-marking cannot be the way to variety. It is too slow and it is not
// accurate enough to grade a reader that is already at 98%.
//
// AN ENGRAVER KNOWS WHERE IT PUT THE NOTES. If the page is drawn here, then the
// position of every notehead on it is not a judgement, an estimate or a click —
// it is the number that was passed to fillText. Hundreds of pages, exact truth,
// no clicking, and the engraving itself varied on purpose: the staff space, the
// note density, the stem length, the beam thickness, the margins, the clef, the
// key, how many ledger lines, how much text is scattered over it.
//
//   npm run engrave -- --out pages/engraved --count 40 [--seed 7] [--camera]
//
// AND IT DRAWS WITH REAL BRAVURA, which is the whole reason this file is not
// just tools/scan-corpus.mjs with a loop around it. tools/glyphs.mjs already
// says why, for clefs:
//
//     "Clefs cannot be graded against shapes we invent. A classifier tuned
//      against its author's drawing of a bass clef learns that drawing, and the
//      page it then meets is engraved by somebody else."
//
// That argument was never applied to noteheads, and tools/head-shape-check.mjs
// measured what it cost: the corpus's ellipse is 0.83 to 0.91 staff spaces tall
// where a real Bravura notehead is 1.05 to 1.08 — TWENTY PERCENT SHORT — and the
// shipped reader is 4.2 points more precise on our drawing than on the real
// glyph. Every synthetic number that has ever guarded a change to findHeads was
// graded against a shape no engraver draws. This draws the glyph.
//
// WHAT THIS IS NOT. A drawn page is not a photograph, and a reader trained only
// on drawn pages will learn the drawing — the same trap, one level up. So:
//
//   - the three real marked pages STAY OUT of anything generated here and
//     remain the held-out test. A number quoted from a page this file drew is
//     not a number about the reader on real paper.
//   - `--camera` degrades the page the way scan-corpus does, which narrows the
//     gap and does not close it.
//   - the point of these pages is the NEGATIVE examples as much as the positive
//     ones: rests, accidentals, dots, flags, text and dynamics, printed at every
//     size, in quantities no three pages could contain.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const outDir = resolve(flag('out', 'pages/engraved'));
const count = Number(flag('count', 24));
const seed0 = Number(flag('seed', 1));
const camera = args.includes('--camera');

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontB64 = font.toString('base64');

await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 2200, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// A blank document is enough — nothing here imports from the app, so the dev
// server is not needed and this runs whether or not it is up.
await page.goto('about:blank');

const pages = await page.evaluate(async ({ b64, n, seed0, camera }) => {
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  // SMuFL, the glyphs an engraver actually places. Written as escapes because a
  // treble clef pasted into a source file is invisible in half the editors that
  // will open it — the same reasoning as tools/glyphs.mjs, which this shares a
  // vocabulary with deliberately.
  const G = {
    noteheadBlack: '\u{E0A4}', noteheadHalf: '\u{E0A3}', noteheadWhole: '\u{E0A2}',
    gClef: '\u{E050}', fClef: '\u{E062}', cClef: '\u{E05C}',
    sharp: '\u{E262}', flat: '\u{E260}', natural: '\u{E261}',
    restWhole: '\u{E4E3}', restHalf: '\u{E4E4}', restQuarter: '\u{E4E5}',
    rest8th: '\u{E4E6}', rest16th: '\u{E4E7}',
    flag8thUp: '\u{E240}', flag8thDown: '\u{E241}',
    flag16thUp: '\u{E242}', flag16thDown: '\u{E243}',
    timeSigCommon: '\u{E08A}', augmentationDot: '\u{E1E7}',
    dynamicPiano: '\u{E520}', dynamicForte: '\u{E522}', dynamicMezzo: '\u{E521}',
    ornamentTrill: '\u{E566}', articAccentAbove: '\u{E4A0}', articStaccatoAbove: '\u{E4A2}',
  };
  // Which line a clef names, counted in staff spaces down from the top line.
  const CLEF_ANCHOR = { gClef: 3, fClef: 1, cClef: 1 };
  const SHARP_STEPS = { gClef: [8, 5, 9, 6, 3, 7, 4], fClef: [6, 3, 7, 4, 1, 5, 2] };
  const FLAT_STEPS = { gClef: [4, 7, 3, 6, 2, 5, 1], fClef: [2, 5, 1, 4, 0, 3, -1] };

  // A seeded generator, so a corpus is a corpus and not a different corpus every
  // time somebody runs it. mulberry32 — small, fast, and good enough that the
  // pages do not visibly repeat.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function engrave(seed) {
    const r = rng(seed);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const between = (lo, hi) => lo + r() * (hi - lo);

    // THE ENGRAVING, varied on purpose. Every one of these is a decision a real
    // engraver makes differently, and the three marked pages contain exactly
    // three answers to each.
    const space = Math.round(between(7, 20));
    const systems = Math.round(between(3, 11));
    const clef = pick(['gClef', 'gClef', 'fClef', 'cClef']);
    const keyCount = Math.floor(between(0, 6));
    const keyKind = pick(['sharp', 'flat']);
    const density = between(0.45, 1.0);          // how full a system is
    const stemLen = between(2.8, 4.0);           // staff spaces
    const beamThick = between(0.42, 0.62);       // staff spaces
    const lineThick = Math.max(1, space * between(0.07, 0.13));
    const sysGap = between(11, 16);
    const ledgerLove = between(0, 0.35);         // how often a note goes off-stave
    const clutter = between(0, 1);               // dynamics, trills, articulations
    const restRate = between(0.04, 0.18);
    const hollowRate = between(0.03, 0.25);      // minims and semibreves
    // HOW DARK THE INK PRINTS, which is the gap that showed up in the numbers.
    //
    // Measured: the model trained on these pages plus two real ones tops out at
    // 91.7% recall on the photographed Scanned score AT ANY THRESHOLD — eight
    // percent of that page's noteheads are confidently rejected, and no cut
    // recovers them. The Scanned score is the eroded one, and the reader's own
    // comments say what that looks like: "a great many solid heads print grey in
    // the middle — the lamp, the blur, the downscale", twenty-four of four
    // hundred and five heads on the page this was built for.
    //
    // Blur and contrast do not reproduce that. A blurred black head is still
    // black in the middle; a WORN one is grey all through. So the ink itself
    // gets a darkness, per page and jittered per note, and some pages print
    // faint the way a fifth-generation photocopy does.
    const inkDark = between(0.35, 1);
    const grey = (k = 1) => {
      const v = Math.round(255 * (1 - Math.min(1, inkDark * k * between(0.85, 1.15))));
      return `rgb(${v},${v},${v})`;
    };

    const perSystem = Math.max(6, Math.round(between(8, 22) * density));
    const noteGap = between(2.4, 4.2);
    const leftPad = between(9, 16);
    const W = Math.round(space * (leftPad + perSystem * noteGap + 5));
    const H = Math.round(space * (10 + systems * sysGap + 6));

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = grey();
    const truth = [];

    const em = space * 4;                        // SMuFL: one em is four spaces
    const put = (glyph, x, y, size = em) => {
      g.font = `${size}px Bravura`;
      g.textBaseline = 'alphabetic';
      g.fillText(glyph, x, y);
      g.font = `${size}px Bravura`;
      return g.measureText(glyph).width;
    };
    const widthOf = (glyph, size = em) => {
      g.font = `${size}px Bravura`;
      return g.measureText(glyph).width;
    };

    // A page photographed off a bound book bends, and a page on a desk is
    // slightly askew. Both are drawn into the geometry rather than filtered on
    // afterwards, because a bent stave is a different STAVE and the reader's
    // first stage has to track it.
    const warp = camera ? between(-0.6, 0.6) : 0;
    const tilt = camera ? between(-0.004, 0.004) : 0;
    const bendAt = (x) => warp * space * Math.sin((x / W) * Math.PI);
    const tiltAt = (x) => tilt * (x - W / 2);

    for (let sys = 0; sys < systems; sys++) {
      const base = space * 8 + sys * space * sysGap;
      const lineY = (l, x) => base + l * space + bendAt(x) + tiltAt(x);
      const stepY = (step, x) => lineY(4, x) - step * (space / 2);
      // An engraver indents the first system of a piece to leave room for the
      // title. The reader has a whole rule about this and it deserves pages
      // that actually do it.
      const indent = sys === 0 ? space * between(0, 6) : 0;
      const x0 = space * 2 + indent;

      for (let l = 0; l < 5; l++) {
        for (let x = x0; x < W - space * 2; x += 3) {
          g.fillRect(x, lineY(l, x), 4, lineThick);
        }
      }
      // Barlines at both ends, and a few through the system.
      const barAt = (x) => g.fillRect(x, lineY(0, x), Math.max(1, lineThick * 1.2), lineY(4, x) - lineY(0, x));
      barAt(x0);
      barAt(W - space * 2);

      let x = x0 + space * 1.2;
      // The clef.
      const anchor = CLEF_ANCHOR[clef];
      x += put(G[clef], x, lineY(anchor, x)) + space * 0.5;
      // The key signature, in the real order, on the real degrees.
      if (keyCount) {
        const steps = (keyKind === 'sharp' ? SHARP_STEPS : FLAT_STEPS)[clef === 'cClef' ? 'gClef' : clef];
        const glyph = keyKind === 'sharp' ? G.sharp : G.flat;
        for (let k = 0; k < keyCount; k++) {
          x += put(glyph, x, stepY(steps[k], x)) + space * 0.08;
        }
        x += space * 0.6;
      }
      if (r() < 0.5) x += put(G.timeSigCommon, x, lineY(2, x)) + space * 0.8;

      // The music.
      //
      // PLACED FIRST, BEAMED AFTERWARDS, and the order is the whole point.
      //
      // The first version of this drew beams at positions of their own —
      // pick a start, pick a slope, draw the bar — and the result was beams
      // floating in the air with no stems under them. Drawn on top of the
      // reader's output (scratchpad/look0.png) it was unmistakable: every
      // free-floating beam end carried a false circle, and the page scored 63%
      // precision against 91% on real paper. That is not the reader being worse
      // on Bravura, it is the generator engraving something no engraver would
      // print, and a training set built from it would teach the classifier that
      // a beam end in open space is a thing that happens.
      //
      // A beam is not a mark on the page. It is what JOINS the stems of a run of
      // notes, so it cannot be drawn until the notes exist and it must end
      // exactly where their stems do.
      const startX = x;
      const usable = (W - space * 3) - startX;
      const gap = usable / perSystem;
      const placed = [];
      let bars = 0;
      for (let i = 0; i < perSystem; i++) {
        const cx = startX + gap * (i + 0.5);
        if (i && i % Math.max(3, Math.round(perSystem / 4)) === 0) { barAt(cx - gap * 0.5); bars++; }

        if (r() < restRate) {
          // A rest — no notehead, and this is the single most valuable negative
          // example on the page. It is drawn at the size an engraver draws it,
          // which is the thing our own drawings never got right.
          const rest = pick([G.restQuarter, G.rest8th, G.rest16th, G.restHalf, G.restWhole]);
          put(rest, cx - widthOf(rest) / 2, lineY(2, cx));
          continue;
        }

        // Where on the stave, and how far off it.
        const off = r() < ledgerLove;
        const step = off
          ? (r() < 0.5 ? Math.round(between(10, 17)) : Math.round(between(-8, -2)))
          : Math.round(between(-1, 9));
        const y = stepY(step, cx);
        const hollow = r() < hollowRate;
        const glyph = hollow ? (r() < 0.4 ? G.noteheadWhole : G.noteheadHalf) : G.noteheadBlack;
        const w = widthOf(glyph);

        // Ledger lines, which are the reason a quarter of the missed notes on
        // the real pages are missed, and which no page can be honest without.
        for (let s = 10; s <= step; s += 2) g.fillRect(cx - w * 0.75, stepY(s, cx), w * 1.5, lineThick);
        for (let s = -2; s >= step; s -= 2) g.fillRect(cx - w * 0.75, stepY(s, cx), w * 1.5, lineThick);

        // Each head at its own darkness, so a page carries the spread a real
        // print run does rather than one uniform black.
        g.fillStyle = grey();
        put(glyph, cx - w / 2, y);
        g.fillStyle = grey();
        truth.push({ x: cx / W, y: y / H });
        placed.push({ cx, y, step, w, hollow, whole: glyph === G.noteheadWhole, beamed: false });

        // An accidental in front of it, which is the other population the reader
        // circles by mistake.
        if (r() < 0.12) {
          const acc = pick([G.sharp, G.flat, G.natural]);
          put(acc, cx - w / 2 - widthOf(acc) - space * 0.15, y);
        }
        // A dot after it.
        if (r() < 0.12) put(G.augmentationDot, cx + w * 0.7, stepY(step % 2 === 0 ? step + 1 : step, cx));
        // Articulations and ornaments above.
        if (r() < clutter * 0.18) {
          const a = pick([G.articAccentAbove, G.articStaccatoAbove, G.ornamentTrill]);
          put(a, cx - widthOf(a) / 2, stepY(11, cx));
        }
      }

      // BEAM THE RUNS, then stem everything that is left.
      //
      // A beamed group takes one stem direction for all its notes — an engraver
      // picks it from the group as a whole, by which way most of the heads lie
      // from the middle line — and every stem in the group is stretched or cut
      // to meet one sloped bar. That stretching is exactly what makes a beamed
      // page hard to read: it is why a stem crosses staff lines it would not
      // otherwise cross, and why the join at the beam end is a compact blob.
      let i = 0;
      while (i < placed.length) {
        const runLen = (!placed[i].whole && !placed[i].hollow && r() < 0.55)
          ? Math.min(Math.round(between(2, 5)), placed.length - i)
          : 1;
        const group = placed.slice(i, i + runLen).filter((p) => !p.whole && !p.hollow);
        if (runLen > 1 && group.length === runLen) {
          // Which way the stems go: away from the crowd.
          const up = group.reduce((a, p) => a + p.step, 0) / group.length < 4;
          const first = group[0];
          const last = group.at(-1);
          const len = space * stemLen;
          // The beam's own line — and AN ENGRAVER LIMITS ITS SLOPE.
          //
          // Run the beam from the first stem end to the last and a group whose
          // heads jump an octave gets a beam at forty-five degrees, which no
          // published page contains: the convention is that a beam leans in the
          // direction of the run by at most about a space over the group, and
          // the stems take up the difference. Drawn without the limit, the steep
          // beam crosses its own stems at a shallow angle and leaves a long
          // wedge of solid ink at each end — a perfect notehead-sized blob that
          // the reader circles, once per group. Measured on a page of them, that
          // alone was most of the difference between 58% precision here and 91%
          // on real paper: the generator was manufacturing the hardest case in
          // the reader and calling it music.
          let ya = (up ? first.y - len : first.y + len);
          let yb = (up ? last.y - len : last.y + len);
          const lean = Math.max(-space, Math.min(space, yb - ya));
          const mid = (ya + yb) / 2;
          ya = mid - lean / 2;
          yb = mid + lean / 2;
          // …and then pushed clear of every head in the group, so no stem is
          // left pointing the wrong way or shorter than a stem gets.
          for (const p of group) {
            const want = up ? p.y - space * 2.4 : p.y + space * 2.4;
            const here = ya + ((yb - ya) * (p.cx - first.cx)) / Math.max(1, last.cx - first.cx);
            const push = up ? Math.min(0, want - here) : Math.max(0, want - here);
            ya += push; yb += push;
          }
          // SMuFL: a beam is half a staff space thick and consecutive beams sit
          // a quarter space apart, so their tops are three quarters of a space
          // apart. Anything wider fuses into a bar the reader cannot see through.
          const t = space * Math.min(beamThick, 0.55);
          const layers = r() < 0.35 ? 2 : 1;
          const at = (px) => ya + ((yb - ya) * (px - first.cx)) / Math.max(1, last.cx - first.cx);
          for (const p of group) {
            const sx = up ? p.cx + p.w / 2 - lineThick : p.cx - p.w / 2;
            const y1 = at(p.cx);
            // The stem runs from the head to the beam, however long that is.
            g.fillRect(sx, Math.min(p.y, y1), Math.max(1, lineThick), Math.abs(y1 - p.y));
            p.beamed = true;
          }
          const xa = up ? first.cx + first.w / 2 - lineThick : first.cx - first.w / 2;
          const xb = up ? last.cx + last.w / 2 : last.cx - last.w / 2 + lineThick;
          for (let L = 0; L < layers; L++) {
            const off = (up ? 1 : -1) * L * (t + space * 0.25);
            g.beginPath();
            g.moveTo(xa, ya + off);
            g.lineTo(xb, yb + off);
            g.lineTo(xb, yb + off + t);
            g.lineTo(xa, ya + off + t);
            g.closePath();
            g.fill();
          }
          i += runLen;
          continue;
        }
        i += 1;
      }

      // …and a plain stem on everything the beaming left alone. A semibreve has
      // none, which is the case that once read a page of minims as a page with
      // no notes on it.
      for (const p of placed) {
        if (p.beamed || p.whole) continue;
        const up = p.step < 4;
        const sx = up ? p.cx + p.w / 2 - lineThick : p.cx - p.w / 2;
        const len = space * stemLen;
        g.fillRect(sx, up ? p.y - len : p.y, Math.max(1, lineThick), len);
        // A flag, sometimes — the other thing that hangs off a stem and gets
        // mistaken for something. Only on a solid head: a minim has no flag.
        if (!p.hollow && r() < 0.22) {
          const f = up ? pick([G.flag8thUp, G.flag16thUp]) : pick([G.flag8thDown, G.flag16thDown]);
          put(f, sx, up ? p.y - len : p.y + len);
        }
      }

      // A dynamic under the stave, and text over it. Both get circled on the
      // real pages — "the word SOLO or the p of a dynamic" is in the reader's
      // own comments — and neither has ever appeared on a synthetic page.
      if (r() < clutter * 0.7) {
        const d = pick([G.dynamicPiano, G.dynamicForte, G.dynamicMezzo]);
        put(d, startX + between(0, usable * 0.7), lineY(4, startX) + space * 2.4);
      }
      if (r() < clutter * 0.5) {
        g.font = `${Math.round(space * between(1.1, 1.8))}px serif`;
        g.fillText(pick(['Allegro', 'Andante', 'SOLO', 'rit.', 'dolce', 'Tutti', 'cantabile']),
          startX + between(0, usable * 0.5), lineY(0, startX) - space * 1.6);
      }
    }

    // PENCIL, which is the whole difference between a drawing and a page
    // somebody has practised from.
    //
    // MEASURED, and this is why it is here. Leave one real page out, train on
    // the other two, then add drawn pages and score the held-out page again:
    //
    //   held out Mozart, cut 0.4     two real pages      86.1 / 100.0
    //                                + 240 clean drawn   88.8 /  90.3
    //                                + the same, balanced 88.7 / 99.7
    //                                + PHOTOGRAPHED only  91.3 /  99.0
    //
    // Two lessons in one table. Unweighted, nineteen thousand drawn patches
    // swamp eight hundred real ones and recall collapses — the model learns that
    // a notehead is a crisp glyph on white paper, which is true of almost all of
    // its examples and false of every head on a photograph. And once the two are
    // weighted equally, the DEGRADED drawn pages help where the clean ones hurt.
    // Fewer and more realistic beats more and cleaner.
    //
    // So the gap to close is realism, and the largest single thing a drawn page
    // is missing is the marks a player leaves on it. The reader's own comments
    // name them: "a third of what it draws on the Mozart is a rest, an
    // accidental, the word SOLO or the p of a dynamic", and the crops in
    // docs/reader-handover.md add fingerings and pencil bowings. None of those
    // had ever appeared on a synthetic page.
    //
    // Drawn grey rather than black, and wobbly rather than straight, because
    // that is what pencil is: a graphite stroke thresholds paler than print, and
    // a hand does not draw a straight line. Both properties matter to a reader
    // that binarises against a local background.
    if (r() < 0.75) {
      const marks = Math.round(between(2, 14));
      for (let k = 0; k < marks; k++) {
        const sys = Math.floor(r() * systems);
        const base = space * 8 + sys * space * sysGap;
        const px = between(space * 6, W - space * 4);
        const grey = Math.round(between(90, 165));
        g.fillStyle = `rgb(${grey},${grey},${grey})`;
        g.strokeStyle = `rgb(${grey},${grey},${grey})`;
        g.lineWidth = Math.max(1, space * between(0.06, 0.14));
        const kind = pick(['finger', 'finger', 'bow', 'bow', 'slur', 'circle', 'scribble']);
        if (kind === 'finger') {
          // A fingering: a small handwritten digit above or below the stave.
          // Small, round, dark and standing alone — which is to say the shape a
          // notehead detector is most likely to accept.
          g.save();
          g.translate(px, base - space * between(1.2, 3) * (r() < 0.5 ? 1 : -1) + (r() < 0.5 ? 0 : space * 6));
          g.rotate(between(-0.25, 0.25));
          g.font = `${Math.round(space * between(1.1, 1.9))}px sans-serif`;
          g.fillText(String(Math.floor(between(0, 5))), 0, 0);
          g.restore();
        } else if (kind === 'bow') {
          // A bowing mark — a down-bow bracket or an up-bow V, above the stave.
          const y = base - space * between(1.4, 2.6);
          const s = space * between(0.5, 1.0);
          g.beginPath();
          if (r() < 0.5) {
            g.moveTo(px - s, y); g.lineTo(px + s, y);
            g.moveTo(px - s, y); g.lineTo(px - s, y + s * 0.9);
            g.moveTo(px + s, y); g.lineTo(px + s, y + s * 0.9);
          } else {
            g.moveTo(px - s, y); g.lineTo(px, y + s); g.lineTo(px + s, y);
          }
          g.stroke();
        } else if (kind === 'slur') {
          // A hand-drawn phrase mark, which is thin, curved, and crosses notes.
          const w2 = space * between(3, 12);
          const y = base + (r() < 0.5 ? -space * 1.6 : space * 5.6);
          g.beginPath();
          g.moveTo(px, y);
          g.quadraticCurveTo(px + w2 / 2, y - space * between(0.8, 2.2), px + w2, y + between(-space, space));
          g.stroke();
        } else if (kind === 'circle') {
          // A note ringed by a teacher — an ellipse the size of a notehead with
          // paper in the middle, which is exactly what the hollow-head test is
          // looking for.
          g.beginPath();
          g.ellipse(px, base + space * between(0, 4), space * between(0.8, 1.4),
            space * between(0.7, 1.2), between(-0.3, 0.3), 0, Math.PI * 2);
          g.stroke();
        } else {
          // A smudge, a half-erased something, a comma of graphite.
          g.beginPath();
          g.ellipse(px, base + space * between(-2, 6), space * between(0.15, 0.5),
            space * between(0.15, 0.45), between(0, 3), 0, Math.PI * 2);
          g.fill();
        }
      }
      g.fillStyle = grey();
      g.strokeStyle = grey();
      g.lineWidth = 1;
    }

    // A heading, because every real page has one and it is inside the search
    // band of the first system — which is where two of the marked pages' worst
    // false circles come from.
    if (r() < 0.8) {
      g.font = `${Math.round(space * between(2, 3.4))}px serif`;
      g.fillText(pick(['PRELUDE', 'Menuet', 'Concerto', 'Sarabande', 'Allemande', 'Gigue']),
        W * between(0.25, 0.45), space * 4);
    }

    if (!camera) return { canvas: c, truth, W, H, space, jpeg: null };

    // The camera. The same degradations scan-corpus uses, applied together and
    // with varied strength, because a photograph is not one effect.
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const o = out.getContext('2d');
    o.filter = `blur(${between(0.3, 1.1).toFixed(2)}px)`
      + ` contrast(${between(0.78, 1.0).toFixed(2)})`
      + ` brightness(${between(0.96, 1.12).toFixed(2)})`;
    o.drawImage(c, 0, 0);
    o.filter = 'none';
    // Uneven light, which is what a lamp over a music stand does.
    const gr = o.createLinearGradient(0, 0, W * between(0.4, 1), H * between(0.4, 1));
    gr.addColorStop(0, `rgba(0,0,0,${between(0.02, 0.12).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = gr; o.fillRect(0, 0, W, H);
    // Paper grain.
    const grain = o.getImageData(0, 0, W, H);
    const amt = between(2, 12);
    for (let i = 0; i < grain.data.length; i += 4) {
      const n = (r() - 0.5) * amt;
      grain.data[i] += n; grain.data[i + 1] += n; grain.data[i + 2] += n;
    }
    o.putImageData(grain, 0, 0);
    // …and through a JPEG, because every photograph a phone takes is one and its
    // ringing round a black notehead on white paper is the artefact the reader
    // actually meets. A PNG of a drawing is the one thing no uploaded page ever is.
    return {
      canvas: out, truth, W, H, space,
      jpeg: between(0, 1) < 0.7 ? +between(0.4, 0.85).toFixed(2) : null,
    };
  }

  const made = [];
  for (let i = 0; i < n; i++) {
    const { canvas, truth, W, H, space, jpeg } = engrave(seed0 + i * 7919);
    made.push({
      i,
      png: jpeg ? canvas.toDataURL('image/jpeg', jpeg) : canvas.toDataURL('image/png'),
      jpeg,
      truth,
      W,
      H,
      space,
    });
  }
  return made;
}, { b64: fontB64, n: count, seed0, camera });

await browser.close();

const index = [];
for (const p of pages) {
  const name = `engraved-${String(p.i).padStart(3, '0')}`;
  const png = Buffer.from(p.png.split(',')[1], 'base64');
  await writeFile(join(outDir, `${name}.png`), png);
  await writeFile(join(outDir, `${name}.truth.json`), `${JSON.stringify({
    marked: 'engraved — the positions are what was passed to fillText, not a click',
    engraved: true,
    space: p.space,
    size: `${p.W}x${p.H}`,
    notes: p.truth,
  }, null, 2)}\n`);
  index.push({
    name,
    file: join(outDir, `${name}.png`),
    truth: join(outDir, `${name}.truth.json`),
  });
}
await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const heads = pages.reduce((a, p) => a + p.truth.length, 0);
const spaces = pages.map((p) => p.space).sort((a, b) => a - b);
console.log(`\nengraved ${pages.length} pages into ${outDir}`);
console.log(`  ${heads} noteheads, exactly located — no clicking, no judgement calls`);
console.log(`  staff space ${spaces[0]} to ${spaces.at(-1)}px, against 9.6 to 12.1 on the marked pages`);
console.log(`  camera: ${camera ? 'on — blur, warp, tilt, uneven light, grain' : 'off — clean engraving'}`);
console.log(`\n  index written to ${join(outDir, 'index.json')}\n`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
