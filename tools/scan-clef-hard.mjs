// Clefs on a page that behaves like the photograph, not like clean paper.
//
// WHY THIS FILE EXISTS
//
// tools/scan-clef-check.mjs scores 15/15 sampled and 12/12 end to end. The real
// photograph — Bärenreiter's Bach Cello Suite 1 Prélude, bars 1-20, ten systems,
// every one of them bass clef — scores 5/10. A benchmark that passes everything
// the page fails is measuring a page that does not exist, and every clef fix
// proposed against it has been validated on clean paper and then failed on a
// photograph.
//
// Key signatures were added to scan-clef-check.mjs and it still scored 12/12,
// which settled that the missing ingredient was not the key signature by itself.
//
// WHAT THE REAL PAGE ACTUALLY DOES, MEASURED
//
// Read through readPage at 1400 across (staff space ~12.2px), recomputing the
// clef column from the reader's own reported zone. Not copied from anywhere —
// run `node tools/scan-clef-hard.mjs --real <the photograph>` and this table is
// printed above the drawn one, by the same code, for checking rather than
// trusting. It read 469 noteheads doing it.
//
// AT deviceScaleFactor 1, and that matters. This file sets its viewport at 1,
// tools/real-page-check.mjs sets it at 2, and the same photograph read at the
// same 1400px width comes out DIFFERENT: at 1 it is 469 noteheads and 5/10,
// with staveStart 106,357,85,44,36,168,134,50,none,74; at 2 it is 6/10, with
// staveStart 105,133,253,42,136,168,129,28,247,74. Same clef on six systems out
// of ten, and system 2's stave start moves from 133 to 357. Neither is wrong —
// openPaper renders through the device pixel ratio and a photograph resampled
// two ways is two slightly different pictures. The table below is the dsf=1
// one, because 469 and 5/10 is the state this benchmark was written against.
// Anyone who ran real-page-check.mjs first and got other numbers has not found
// a bug; they have found the other rendering path.
//
//   sys  clef     conf   staveStart    top   bottom   sym
//    1   null     0.00      106        0.11   0.79   0.94   <-- refused
//    2   bass     0.73      357        0.24   2.90   0.94
//    3   tenor    0.99       85       -0.61   2.28   0.99   <-- wrong
//    4   bass     0.95       44       -0.17   2.58   1.00
//    5   bass     1.00       36       -0.29   2.43   0.97
//    6   tenor    0.98      168       -0.85   1.80   0.98   <-- wrong
//    7   tenor    1.00      134       -0.80   1.90   1.00   <-- wrong
//    8   bass     1.00       50       -0.34   2.40   0.99
//    9   tenor    1.00      none      -1.04   1.66   1.00   <-- wrong
//   10   bass     0.94       74       -0.12   2.59   0.97
//
// Three things in that table are the whole benchmark:
//
//   1. staveStart is different on every system — 36 to 357, and null on one,
//      against a true left edge near 40. readPage takes ONE margin for the page
//      (the low quartile, 50 here) so the band lands at 53, which on that page
//      is past the clef's start. A drawn page with clean line-ends gives ten
//      identical starts, the band lands squarely on the clef, and the classifier
//      is asked an easy question it will always get right.
//
//   2. The four tenor misreads differ from the five bass reads by seven to
//      fourteen ROWS of ink above the top line — top -0.61..-1.04 against
//      -0.34..+0.24, where the boundary is -0.60. Not a gross failure: a
//      hairline. Every one of them is confident, three of the four at 0.98 or
//      better, which is the part that makes it dangerous.
//
//   3. One system is REFUSED — 0.11 to 0.79 is 0.68 spaces of ink, under the
//      1.5 the classifier demands before it will call anything at all. The band
//      landed somewhere with almost nothing in it.
//
// So this file draws ten bass-clef systems with a key signature, printed bar
// numbers, pencil bowings, slurs, accidentals at the stave head, a heading, a
// dark left-edge shadow, the edge of the facing page lying across the bottom,
// curl, tilt, a gutter, and then photographs the result.
//
// WHAT THIS PAGE READS, AND WHICH INGREDIENT DOES IT
//
//   6/10 — three tenor and one treble — against the photograph's 5/10, which is
//   four tenor and one refusal. One system apart on the score, and the same
//   kind of wrong: confident misreads produced by a band that has slipped
//   half a space up the stave, not by ink nobody could read.
//
//   It is not identical and should not be claimed to be. The photograph refuses
//   a system and this page never does; this page produces a treble and the
//   photograph does not. What matches is the number, the direction and the
//   margins: tops of -0.82 to -1.40 here against -0.61 to -1.04 there, bottoms
//   of 1.87 to 3.24 here against 1.66 to 2.90 there, staveStart spread 52 to 184
//   here against 36 to 357 there.
//
//   One more divergence, and it is the one most likely to mislead: the
//   CONFIDENCES on the bass reads. Four of the six here come back at 0.45 to
//   0.56, where the photograph's five sit at 0.73 and above. A change that adds
//   a confidence floor — refuse anything under 0.6, say — would refuse four
//   systems on this page that the real page reads and reads correctly. That is
//   this harness raising a false alarm, not the reader failing.
//
// WHAT THIS BENCHMARK CANNOT TELL YOU
//
// Every system on this page is bass, so `return { clef: 'bass', confidence: 1 }`
// scores 10/10 on it. That is not a hypothetical failure mode: a cello part is
// in bass clef most of the time, guessing bass is right most of the time, and
// this file rewards the guess with a perfect score. It also counts a refusal and
// a confident misread the same, which scan-clef.js's own doctrine says are not
// the same thing at all.
//
// So this number is only meaningful read next to `npm run scan:clef`, which
// carries treble and tenor and is where a bass-bias shows up immediately. A
// change that wins here and loses there has not fixed anything.
//
// Measured by removing each ingredient in turn (`--ablate`), and reported as
// measured rather than as hoped:
//
//   removed             score   what it says
//   the gutter          9/10    <-- almost the whole difficulty is here
//   the curl            8/10    warp, tilt and the drifting left margin
//   the camera          8/10    blur, tint, contrast, JPEG, downscale
//   the shadow          5/10    HARDER without it, by one system
//   key signature       6/10    no change
//   bar numbers         6/10    no change
//   pencil              6/10    no change
//   slurs               6/10    no change
//   accidentals         6/10    no change
//   heading             6/10    no change
//
// Read that honestly: SIX of the ten ingredients this benchmark was asked to
// carry do not move the number. They are drawn, they are on the page, and they
// are worth keeping because a fix that trips over a bar number should be caught
// here — but the difficulty is not in them, and saying otherwise would send the
// next agent to tune against a slur.
//
// The difficulty is the gutter, and the gutter is a two-pixel disagreement
// between where the reader's model of a stave line says the line is and where it
// is printed, over the first inch of the page and nowhere else. Not a smudge,
// not a missing line, not a hard glyph — the reader being slightly wrong about
// the geometry at the one place it reads the clef, which costs four systems in
// ten. That is the thing scan-clef-check.mjs cannot express: it draws a bend a
// parabola fits exactly, so the model is right everywhere and the classifier is
// handed a clean column of its own clef every time.
//
// HOW TO READ THE OUTPUT
//
// The score is out of ten and directly comparable with the real page's 5/10.
// `--real <path>` measures the photograph with the same code and prints it
// above, which is how the comparison stays honest. `--ablate` re-runs the page
// with one ingredient removed at a time; `--shot` writes the photographed page
// to SHOT_OUT so it can be looked at, which is how every real bug on this page
// has been found.
//
// A future score of 10/10 here means one of two things and they want opposite
// work: either the reader got better, or this page stopped being hard. Check it
// with `--real` before believing the first.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:clef-hard
//   node tools/scan-clef-hard.mjs --ablate
//   node tools/scan-clef-hard.mjs --real ~/…/menuet.png
//   SHOT_OUT=/tmp/p.jpg node tools/scan-clef-hard.mjs --shot
//   node tools/scan-clef-hard.mjs --json
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { GLYPH, CLEF_ANCHOR } from './glyphs.mjs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const wantJson = process.argv.includes('--json');
const wantAblate = process.argv.includes('--ablate');
const wantShot = process.argv.includes('--shot');
// The photograph itself, measured by the same code that measures the drawn page.
//
// The table at the top of this file is the comparison target, and a table in a
// comment is a claim rather than a measurement — six months from now nobody can
// tell whether it still holds. Given `--real <path>` this reads the real page
// through the same readPage, rebuilds the same ink, resamples the same clef zone
// and prints the same columns, so the two can be put side by side and the
// harness checked rather than believed.
const realAt = (() => {
  const i = process.argv.indexOf('--real');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const realBase64 = realAt ? (await readFile(realAt)).toString('base64') : null;
const realMime = /\.jpe?g$/i.test(realAt ?? '') ? 'image/jpeg' : 'image/png';

// The dials the page was iterated on, exposed so the next agent can sweep them
// rather than re-derive them. See the note by `gutterAt`.
//
// GUTTER is the one that decides the score, and it was swept: 0 gives 8/10,
// 0.15 gives 9/10, 0.3 gives 8/10, 0.42 to 0.48 give 6 or 7 out of 10, 0.6
// gives 5/10 and 0.9 gives 2/10. It is set where the page reads what the
// photograph reads, and it is not perched on a cliff — every value from 0.42 to
// 0.48 lands within one system of it, and system 1 and system 10 fail across
// the whole of that range.
const TUNE = {
  gutter: Number(process.env.GUTTER ?? 0.45),
  gutterVar: Number(process.env.GUTTER_VAR ?? 0.405),
  shadow: Number(process.env.SHADOW ?? 0.30),
  shadowVar: Number(process.env.SHADOW_VAR ?? 0.34),
};

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({
  glyph, anchor, fontBase64: b64, ablate, shot: wantImage, tune, realB64, realMime,
}) => {
  const face = new FontFace('BravuraHard', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  const { readPage, clefColumn, staveStart } = await import('/src/analysis/scan-read.js');
  const { clefFeatures } = await import('/src/analysis/scan-clef.js');

  // --- the page ------------------------------------------------------------
  //
  // Drawn at space 20 and photographed at 0.62, which lands the reader on a
  // staff space of 12.4px — the real page reads 11.9 to 12.5.
  const SPACE = 20;
  const SYSTEMS = 10;
  const SYS_GAP = 12.8;      // staff spaces between system tops; the real page runs 12.7
  const W = Math.round(SPACE * 113);
  const H = Math.round(SPACE * (25 + SYSTEMS * SYS_GAP + 12));

  // What each system carries at its head, and it is the whole experiment.
  //
  // The Prélude does not present the same thing ten times: some systems open on
  // a low note with nothing above the stave, and some open on an accidental or
  // under a slur that reaches a space above the top line. On the photograph the
  // second kind is what reads tenor, because the band the reader samples has
  // walked past the clef and is sitting on exactly that ink.
  //
  // `high` is a sharp standing on a note above the stave, immediately right of
  // the key signature. `slur` is an arc over the opening group. `steps` are the
  // opening group's positions, counted in half spaces up from the bottom line.
  const HEADS = [
    { bar: 1, high: false, slur: false, steps: [0, 2, 4, 6] },
    { bar: 3, high: false, slur: true, steps: [1, 3, 5, 7] },
    { bar: 5, high: true, slur: true, steps: [6, 8, 10, 9] },
    { bar: 7, high: false, slur: false, steps: [0, 3, 5, 2] },
    { bar: 9, high: false, slur: false, steps: [2, 4, 1, 3] },
    { bar: 11, high: true, slur: true, steps: [7, 9, 11, 10] },
    { bar: 13, high: true, slur: false, steps: [5, 8, 10, 7] },
    { bar: 15, high: false, slur: false, steps: [1, 4, 2, 5] },
    { bar: 17, high: true, slur: true, steps: [6, 9, 11, 8] },
    { bar: 19, high: false, slur: false, steps: [0, 2, 5, 3] },
  ];

  // The page's left edge, in staff spaces, as a function of how far down it is.
  //
  // A photograph of a bound book is not a rectangle: the gutter pulls the left
  // margin in a curve, and the camera is never square on, so the margin also
  // walks sideways. The real page's stave heads are not at one x, and the reader
  // takes one margin for the whole page.
  const edgeAt = (t) => 3.0 + 1.5 * Math.sin(t * Math.PI) + 1.1 * t;

  // THE GUTTER, and it is the ingredient that makes staveStart disagree.
  //
  // A half-sine bend across the whole width is not a curl, it is a shape a
  // quadratic fits exactly — and the reader models each stave line as a
  // quadratic across the page. Draw the page that way and its model is right
  // everywhere, staveStart finds all five lines at the true left edge on every
  // system, and the ten answers agree.
  //
  // A page held open in a book does not bend like that. It falls away sharply
  // in the last inch before the spine and is flat across the rest, which is a
  // shape no parabola follows: the fit splits the difference, and at the far
  // left — the one place it is extrapolating rather than interpolating — the
  // modelled lines sit two or three pixels off the printed ones. staveStart
  // samples one row either side of where the model says the line is, so where
  // the model is off by three the stave has not started yet as far as the
  // reader is concerned, and it walks right until it meets something thick
  // enough to light three rows at once, which is the music.
  //
  // The depth varies system by system because the curl of a page does.
  //
  // A PLATEAU AND THEN A RAMP, not an exponential. The first shape tried here
  // was `depth * exp(-x / 3.2 spaces)`, which decays across the sampled band
  // itself: each staff line then smears four or five rows vertically inside the
  // band, the bottom line thickens past the reader's THINNEST run filter, and
  // every bottom extent came back at 4.0 — past the bottom line, where the
  // photograph's bass reads sit between 2.06 and 2.80. It made the page hard by
  // blurring it rather than by displacing it, which is the wrong bug.
  //
  // A page lifted by its binding is FLAT over the first inch and comes down over
  // the next one. Flat over the band means the lines inside it stay as thin as
  // they were printed; displaced relative to what a parabola fitted across the
  // whole width predicts means the reader's model of the stave is wrong exactly
  // where it reads the clef.
  const PLATEAU = SPACE * 4.5;
  const RAMP = SPACE * 15;
  const gutterAt = (x, depth) => {
    if (x <= PLATEAU) return -depth * SPACE;
    if (x >= RAMP) return 0;
    const t = (x - PLATEAU) / (RAMP - PLATEAU);
    return -depth * SPACE * 0.5 * (1 + Math.cos(Math.PI * t));
  };

  function drawPage(g, on) {
    g.fillStyle = '#f7f2e6';
    g.fillRect(0, 0, W, H);
    const warp = 0.7;
    const tilt = 0.004;
    const bendAt = (x) => (on.curl ? warp * SPACE * Math.sin((x / W) * Math.PI) : 0);
    const tiltAt = (x) => (on.curl ? tilt * (x - W / 2) : 0);
    const systems = [];

    // The heading. A real page has one, it is the largest ink above the first
    // system, and it is in the reader's search band for that system's clef.
    if (on.heading) {
      g.fillStyle = '#1a1a1a';
      g.font = `${SPACE * 1.9}px Georgia, serif`;
      g.textBaseline = 'alphabetic';
      g.fillText('PRÉLUDE', SPACE * 14, SPACE * 16);
    }

    for (let sys = 0; sys < SYSTEMS; sys++) {
      const t = SYSTEMS === 1 ? 0 : sys / (SYSTEMS - 1);
      const x0 = SPACE * (on.curl ? edgeAt(t) : 3.6);
      const top = SPACE * 25 + sys * SPACE * SYS_GAP;
      // How far this system's left end falls into the gutter. Deepest at the
      // top of the page and at the bottom, where a bound page lifts least.
      const gutter = on.gutter ? tune.gutter + tune.gutterVar * Math.cos(t * Math.PI * 1.6) : 0;
      const lineY = (l, x) => top + l * SPACE + bendAt(x) + tiltAt(x) + gutterAt(x - x0, gutter);
      systems.push({ x0, top });
      const head = HEADS[sys];

      // Five lines.
      g.fillStyle = '#1a1a1a';
      for (let l = 0; l < 5; l++) {
        for (let x = x0; x < W - SPACE * 3; x += 4) {
          g.fillRect(x, lineY(l, x), 5, Math.max(1, SPACE * 0.09));
        }
      }
      // A barline at the right-hand end only. Engravers draw none at a start.
      const endAt = W - SPACE * 3;
      g.fillRect(endAt, lineY(0, endAt), Math.max(1.4, SPACE * 0.12), SPACE * 4);

      g.font = `${SPACE * 4}px BravuraHard`;
      g.textBaseline = 'alphabetic';
      // The clef, on the line it names.
      const clefX = x0 + SPACE * 0.5;
      g.fillText(glyph.bassClef, clefX, lineY(anchor.bassClef, clefX));
      // One sharp: G major, on the F line, which in bass clef is the second
      // line from the top.
      if (on.keysig) {
        const kx = x0 + SPACE * 2.9;
        g.fillText(glyph.sharp, kx, lineY(1, kx));
      }
      // Common time, first system only, exactly as the page sets it.
      if (sys === 0) {
        const cx = x0 + SPACE * 4.2;
        g.fillText(glyph.commonTime, cx, lineY(2, cx));
      }

      // The printed bar number, above the stave head, small and roman.
      if (on.barNumbers) {
        // Set over the CLEF, where an engraver puts it, and therefore left of
        // the band the reader ends up sampling. Drawn a third of a space right
        // of here instead it sat inside the band and took the top to -1.79 on
        // every system carrying a two-digit number — three times the depth the
        // photograph reaches, and the wrong mechanism: on the real page the bar
        // numbers are at x 30-42 and the band is at 77-121.
        g.font = `${SPACE * 0.85}px Georgia, serif`;
        g.fillStyle = '#1a1a1a';
        const bx = x0 + SPACE * 0.1;
        g.fillText(String(head.bar), bx, lineY(0, bx) - SPACE * 1.15);
        g.font = `${SPACE * 4}px BravuraHard`;
      }

      // The music: eight groups of four beamed semiquavers.
      const noteGap = SPACE * 3.1;
      const groupGap = SPACE * 1.5;
      // Where the first note stands. Set at 5.4 spaces the opening notehead sat
      // inside the sampled band and dragged every bottom extent to 4.1, which
      // is past the bottom line and reads as a bass clef at confidence zero;
      // the photograph's bass reads come back between 2.06 and 2.80, off the
      // clef and the key signature alone.
      let cursor = x0 + SPACE * (sys === 0 ? 8.0 : 7.0);
      const opening = [];
      for (let grp = 0; grp < 8; grp++) {
        const steps = grp === 0
          ? head.steps
          : [0, 1, 2, 3].map((i) => ((sys * 3 + grp * 2 + i * 2) % 11));
        const xs = [];
        const ys = [];
        for (let i = 0; i < steps.length; i++) {
          const x = cursor + i * noteGap;
          const y = lineY(4, x) - steps[i] * SPACE / 2;
          xs.push(x); ys.push(y);
          g.fillStyle = '#1a1a1a';
          g.save(); g.translate(x, y); g.rotate(-0.28);
          g.beginPath(); g.ellipse(0, 0, SPACE * 0.62, SPACE * 0.46, 0, 0, Math.PI * 2);
          g.fill(); g.restore();
        }
        // Stems up, joined by two beams.
        const stemW = Math.max(1.3, SPACE * 0.1);
        const tips = ys.map((y) => y - SPACE * 3.3);
        const tipAt = (i) => tips[0] + ((tips.at(-1) - tips[0]) * i) / (steps.length - 1);
        for (let i = 0; i < steps.length; i++) {
          g.fillRect(xs[i] + SPACE * 0.55, tipAt(i), stemW, ys[i] - tipAt(i));
        }
        for (const off of [0, SPACE * 0.55]) {
          g.beginPath();
          g.moveTo(xs[0] + SPACE * 0.55, tipAt(0) + off);
          g.lineTo(xs.at(-1) + SPACE * 0.55 + stemW, tipAt(steps.length - 1) + off);
          g.lineTo(xs.at(-1) + SPACE * 0.55 + stemW, tipAt(steps.length - 1) + off + SPACE * 0.42);
          g.lineTo(xs[0] + SPACE * 0.55, tipAt(0) + off + SPACE * 0.42);
          g.closePath(); g.fill();
        }
        if (grp === 0) { opening.push(...xs.map((x, i) => ({ x, y: ys[i] }))); }
        cursor += steps.length * noteGap + groupGap;
      }

      // An accidental at the stave head, on a note above the stave. This is the
      // ink the misread systems have and the others do not.
      if (on.accidentals && head.high) {
        g.font = `${SPACE * 4}px BravuraHard`;
        g.fillStyle = '#1a1a1a';
        // Centred ON the top line, not above it. Placed a space higher its ink
        // reached 1.85 spaces above the stave and every system carrying one read
        // tenor at 0.94 — far past anything the photograph does, where the four
        // misreads sit between -0.78 and -1.01.
        const ax = x0 + SPACE * 4.3;
        g.fillText(glyph.sharp, ax, lineY(0, ax));
      }

      // A slur over the opening group, arcing above the stave.
      if (on.slurs && head.slur && opening.length) {
        g.strokeStyle = '#1a1a1a';
        g.lineWidth = Math.max(1.2, SPACE * 0.11);
        g.beginPath();
        const a = opening[0];
        const b = opening.at(-1);
        const apex = Math.min(a.y, b.y) - SPACE * 2.6;
        g.moveTo(a.x - SPACE * 2.2, a.y - SPACE * 0.9);
        g.quadraticCurveTo((a.x + b.x) / 2, apex, b.x, b.y - SPACE * 0.9);
        g.stroke();
      }

      // Pencil. Bowings above the stave, fingerings below it, in the soft grey
      // a 2B leaves on cream paper — lighter than the print, and lighter than
      // the ink threshold cares about only if it is very light indeed.
      if (on.pencil) {
        g.strokeStyle = 'rgba(96,96,104,0.72)';
        g.lineWidth = Math.max(1.1, SPACE * 0.1);
        for (let m = 0; m < 4; m++) {
          const mx = x0 + SPACE * (6 + m * 9 + (sys % 3));
          const my = lineY(0, mx) - SPACE * 1.5;
          g.beginPath();
          if ((sys + m) % 2) {
            // a down-bow bracket
            g.moveTo(mx, my - SPACE * 0.5); g.lineTo(mx, my + SPACE * 0.3);
            g.moveTo(mx, my - SPACE * 0.5); g.lineTo(mx + SPACE * 0.75, my - SPACE * 0.5);
            g.moveTo(mx + SPACE * 0.75, my - SPACE * 0.5); g.lineTo(mx + SPACE * 0.75, my + SPACE * 0.3);
          } else {
            // an up-bow V
            g.moveTo(mx, my - SPACE * 0.6); g.lineTo(mx + SPACE * 0.4, my + SPACE * 0.3);
            g.lineTo(mx + SPACE * 0.8, my - SPACE * 0.6);
          }
          g.stroke();
        }
        g.fillStyle = 'rgba(96,96,104,0.72)';
        g.font = `${SPACE * 0.9}px Georgia, serif`;
        for (let m = 0; m < 3; m++) {
          const fx = x0 + SPACE * (9 + m * 12);
          g.fillText(String((sys + m) % 4), fx, lineY(4, fx) + SPACE * 1.7);
        }
        g.font = `${SPACE * 4}px BravuraHard`;
      }
    }

    // The footer the edition prints, which is ink below the last system.
    g.fillStyle = '#3a3a3a';
    g.font = `${SPACE * 0.8}px Georgia, serif`;
    g.fillText('Bärenreiter-Ausgabe 320', SPACE * 3.6, H - SPACE * 4);

    // THE DARK LEFT-EDGE SHADOW, and it is the ingredient no suite here has.
    //
    // A page photographed in a book falls away into the gutter, and the lamp
    // does not reach the last centimetre of it. Multiplied rather than painted,
    // because that is what less light does: it scales the contrast between the
    // print and the paper as well as darkening both, and the reader's ink test
    // is a fixed 16 grey levels below a local average. Under the shadow a staff
    // line that was twenty levels darker than its paper is twelve, and vanishes
    // — which is why staveStart on the real page walks right past the clef on
    // eight systems in ten and comes back with 253 where the truth is near 40.
    //
    // The depth changes down the page because the curl does.
    if (on.shadow) {
      const img = g.getImageData(0, 0, W, H);
      const px = img.data;
      const reach = SPACE * 9;
      // The facing page's edge, lying across the bottom of this one.
      //
      // This is what puts ink BELOW the last system on the real photograph: its
      // clef column runs a steady fifth of the band inked from four spaces below
      // the top line to ten, which is not a symbol and is not the stave — it is
      // a boundary. A gradient would not show up at all, because the reader's
      // ink test is against a local average and a local average follows a
      // gradient. An EDGE does show up: the average is taken over a box a
      // thirty-sixth of the page wide, so for that many rows either side of the
      // boundary the average sits above the dark side of it and the dark side
      // reads as ink. Thirty-odd rows of it, which is what the page shows.
      // Placed just under the last system's bottom line, which is where the
      // photograph puts it: its column runs solid from 4.2 spaces below the top
      // line to the end of the window at 10, and the reader calls that a treble.
      //
      // Right across the page and very slightly off square, because that is what
      // the facing leaf of an open book does. Drawn as a rectangle over the left
      // fifth it read the same and looked like what it was.
      const edgeY = SPACE * 25 + (SYSTEMS - 1) * SPACE * SYS_GAP + SPACE * 4.6;
      for (let x = 0; x < W; x++) {
        const at = edgeY + (x / W) * SPACE * 2.2;
        for (let y = Math.round(at); y < H; y++) {
          // Deep enough to survive the reader's own contrast test, and that took
          // measuring: at 22% the paper went from 184 to 154, but the local
          // average the test compares against is taken over 39 rows and lands at
          // 164 — ten short of the sixteen levels it needs, so the band was there
          // to the eye and invisible to the reader. At 42% it clears it.
          const across = Math.min(1, (y - at) / (SPACE * 1.2));
          const f = 1 - 0.42 * across;
          const i = (y * W + x) * 4;
          px[i] *= f; px[i + 1] *= f; px[i + 2] *= f;
        }
      }
      for (let y = 0; y < H; y++) {
        const t = y / H;
        // deepest a third of the way down, where a bound page lifts least
        const depth = tune.shadow + tune.shadowVar * Math.sin(Math.PI * Math.min(1, t * 1.15));
        const width = reach * (0.75 + 0.5 * Math.sin(Math.PI * t * 0.9));
        for (let x = 0; x < width; x++) {
          const f = 1 - depth * (1 - x / width) ** 1.6;
          const i = (y * W + x) * 4;
          px[i] *= f; px[i + 1] *= f; px[i + 2] *= f;
        }
      }
      g.putImageData(img, 0, 0);
    }
    return systems;
  }

  async function spoil(source, { blur, contrast, tint, jpeg, scale }) {
    const w = Math.round(source.width * scale);
    const h = Math.round(source.height * scale);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    const filters = [];
    if (blur) filters.push(`blur(${blur}px)`);
    if (contrast !== 1) filters.push(`contrast(${contrast})`);
    g.filter = filters.length ? filters.join(' ') : 'none';
    g.drawImage(source, 0, 0, w, h);
    g.filter = 'none';
    if (tint) {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, `rgba(${tint.join(',')},0.42)`);
      grad.addColorStop(1, `rgba(${tint.join(',')},0.12)`);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    if (!jpeg) return c;
    const blob = await new Promise((d) => c.toBlob(d, 'image/jpeg', jpeg));
    const bmp = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    bmp.close?.();
    return out;
  }

  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };

  // The reader's own ink, rebuilt here so the extents it measured can be
  // reported rather than guessed at. Same rule: darker than a local average by
  // sixteen grey levels, the average taken over a box a thirty-sixth of the
  // page wide.
  function inkOf(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    }
    const rad = Math.max(4, Math.round(w / 36));
    const tmp = new Float32Array(w * h);
    const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let sum = 0; let n = 0;
      for (let x = -rad; x <= rad; x++) if (x >= 0 && x < w) { sum += gray[y * w + x]; n++; }
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / n;
        if (x + rad + 1 < w) { sum += gray[y * w + x + rad + 1]; n++; }
        if (x - rad >= 0) { sum -= gray[y * w + x - rad]; n--; }
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0; let n = 0;
      for (let y = -rad; y <= rad; y++) if (y >= 0 && y < h) { sum += tmp[y * w + x]; n++; }
      for (let y = 0; y < h; y++) {
        bg[y * w + x] = sum / n;
        if (y + rad + 1 < h) { sum += tmp[(y + rad + 1) * w + x]; n++; }
        if (y - rad >= 0) { sum -= tmp[(y - rad) * w + x]; n--; }
      }
    }
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;
    return ink;
  }

  const ALL = {
    curl: true, gutter: true, shadow: true, keysig: true, barNumbers: true,
    pencil: true, slurs: true, accidentals: true, heading: true, camera: true,
  };

  // Everything the harness reports about one page, drawn or photographed. The
  // real page goes through this too, which is the point: the comparison table is
  // produced by the same code on both sides or it is not a comparison.
  function measure(shot) {
    const read = readPage(shot, shot.width, shot.height);
    if (!read) return { ok: false, rows: [] };
    const w = shot.width;
    const h = shot.height;
    const ink = inkOf(shot);
    const rows = [];
    for (const s of read.staves) {
      const n = s.lines[0].length;
      const stripW = w / n;
      const staff = {
        space: s.space * h,
        lines: s.lines.map((line) => ({ at: line.map((y) => y * h), mid: line[Math.floor(n / 2)] * h })),
      };
      const own = staveStart(ink, w, h, staff, stripW);
      const fromX = s.clefZone ? s.clefZone.x * w : null;
      const col = fromX === null
        ? null
        : clefColumn(ink, w, h, staff, stripW, staff.space, fromX);
      const f = col ? clefFeatures(col, staff.space) : null;
      rows.push({
        clef: s.clef,
        conf: +(s.clefConfidence ?? 0).toFixed(2),
        own,
        zoneX: fromX === null ? null : Math.round(fromX),
        space: +staff.space.toFixed(1),
        top: f ? +f.top.toFixed(2) : null,
        bottom: f ? +f.bottom.toFixed(2) : null,
        sym: f ? +f.symmetry.toFixed(2) : null,
        col: col ? [...col].map((v) => Math.round(v * 9)).join('') : null,
      });
    }
    return {
      ok: true,
      rows,
      heads: read.staves.reduce((a, s) => a + s.heads.length, 0),
      size: `${w}x${h}`,
    };
  }

  async function runPage(on) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    drawPage(g, on);
    const shot = on.camera ? await spoil(c, PHOTO) : await spoil(c, { scale: 0.62 });
    const out = measure(shot);
    out.image = on === ALL && wantImage ? shot.toDataURL('image/jpeg', 0.8) : null;
    return out;
  }

  // The photograph, through the door a picture from the camera roll goes
  // through — openPaper, then drawn 1400 across, which is what
  // tools/real-page-check.mjs does and what the numbers at the top of this file
  // were measured at.
  let real = null;
  if (realB64) {
    const { openPaper } = await import('/src/ui/paper.js');
    const blob = await (await fetch(`data:${realMime};base64,${realB64}`)).blob();
    const pages = await openPaper({ source: 'images', pages: [blob] });
    const sheet = document.createElement('canvas');
    sheet.width = 8; sheet.height = 8;
    const dpr = window.devicePixelRatio || 1;
    await pages.draw(0, sheet, 1400 / dpr, (1400 * 4.3) / dpr);
    real = measure(sheet);
  }

  const full = await runPage(ALL);
  const ablations = [];
  if (ablate) {
    for (const key of Object.keys(ALL)) {
      const on = { ...ALL, [key]: false };
      const r = await runPage(on);
      ablations.push({
        without: key,
        staves: r.rows.length,
        right: r.rows.filter((x) => x.clef === 'bass').length,
        starts: r.rows.map((x) => x.own),
        clefs: r.rows.map((x) => String(x.clef)[0]).join(''),
        tops: r.rows.map((x) => x.top),
        bottoms: r.rows.map((x) => x.bottom),
      });
    }
  }
  return { full, ablations, real, wanted: 'bass', systems: SYSTEMS };
}, { glyph: GLYPH, anchor: CLEF_ANCHOR, fontBase64, ablate: wantAblate, shot: wantShot, tune: TUNE, realB64: realBase64, realMime });

await browser.close();

const { full, ablations, real, systems } = report;

if (wantShot && full.image) {
  const { writeFile } = await import('node:fs/promises');
  const out = process.env.SHOT_OUT ?? '/tmp/clef-hard.jpg';
  await writeFile(out, Buffer.from(full.image.split(',')[1], 'base64'));
  console.log(`page written to ${out}`);
}

if (wantJson) {
  console.log(JSON.stringify({ full: { ...full, image: undefined }, real, ablations, errors }, null, 2));
} else {
  const table = (rows) => {
    console.log('sys  clef     conf   staveStart  band   space    top   bottom   sym');
    for (const [i, r] of rows.entries()) {
      console.log(
        `${String(i + 1).padStart(3)}  ${String(r.clef).padEnd(7)} ${String(r.conf).padStart(4)}   `
        + `${String(r.own).padStart(8)}  ${String(r.zoneX).padStart(4)}   ${String(r.space).padStart(5)}  `
        + `${String(r.top).padStart(5)}   ${String(r.bottom).padStart(5)}  ${String(r.sym).padStart(4)}`
        + `${r.clef === 'bass' ? '' : '   <-- WRONG'}`,
      );
    }
  };
  const score = (rows) => `${rows.filter((r) => r.clef === 'bass').length}/${rows.length}`;
  if (real) {
    console.log(`\nTHE PHOTOGRAPH — ${realAt}\n`);
    console.log(`  ${real.size}, ${real.rows.length} systems found, ${real.heads} noteheads\n`);
    table(real.rows);
    console.log(`\n  ${score(real.rows)} read correctly\n`);
  }
  const right = full.rows.filter((r) => r.clef === 'bass').length;
  console.log('\nCLEFS ON A HARD PAGE — ten systems, every one of them bass clef\n');
  console.log(`  ${full.size}, ${full.rows.length} systems found, ${full.heads} noteheads\n`);
  table(full.rows);
  console.log(`\n  ${right}/${full.rows.length} read correctly`
    + `  (${real ? `the photograph above reads ${score(real.rows)}` : 'the real photograph reads 5/10 —'
      + ' pass --real <path> to measure it here'})\n`);
  if (full.rows.length !== systems) {
    console.log(`  WARNING: ${full.rows.length} systems found, not ${systems}. A page that loses`);
    console.log('  whole systems is a broken page, not a hard one — the clef score below is\n'
      + '  not comparable with the photograph.\n');
  }
  if (ablations.length) {
    console.log('WITHOUT EACH INGREDIENT — how much of the difficulty each one carries\n');
    console.log('removed        systems  right   staveStart spread');
    for (const a of ablations) {
      const s = a.starts.filter((x) => x !== null);
      const spread = s.length ? `${Math.min(...s)}..${Math.max(...s)}` : 'none';
      console.log(`${a.without.padEnd(14)} ${String(a.staves).padStart(5)}   `
        + `${String(a.right).padStart(4)}/${a.staves}   ${spread}`);
    }
    console.log('');
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
}
