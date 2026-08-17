// Pages that behave like photographs, whose every note is known.
//
// The page reader was tuned twice against one photograph of one page, which is
// how a thing gets fixed for that page and no other. The trouble with a real
// photograph is that nobody has counted it: "405 noteheads" cannot be graded,
// so the only measurable claims are about shape — are the staves evenly spaced,
// is any system empty — and those pass long before the reading is any good.
//
// So the pages here are DRAWN, which means every notehead's position and every
// beam count is known exactly, and then they are spoiled on purpose in the ways
// a camera spoils a page: blurred, dimmed, tinted, warped along a crease,
// rotated a degree, and run through a JPEG at the quality a phone uses. Each
// spoiling on its own, and then all of them at once, which is what a photograph
// actually is.
//
// Grading is per note, matched by position, so a beam count that is right for
// the wrong note does not score.
//
// TWO BLOCKS, AND WHY
//
// CORE is the ten spoilings: one page shape, photographed ten ways. It answers
// "does the camera beat the reader".
//
// HARD is one spoiling, many page shapes: beams that slope, stems that point
// down, groups of two and six, crotchets standing alone, crotchets crowded up
// against a beamed group. It answers "does the MUSIC beat the reader", which is
// the question the core block structurally cannot ask — and the one that caught
// a change scoring 96% on the core block while reading every unbeamed crotchet
// on a photograph as a quaver.
//
// Their means are reported separately and deliberately not averaged together:
// they are different questions, and a change can win one and lose the other.
//
// SIZES is the third block and it asks the question neither of the others can:
// HOW BIG IS THE PAGE. Every number in this project until it was written came
// from a staff space between 9.6 and 12.1 pixels — the three marked pages sit in
// that band, `clean` draws 14, `tiny` draws 8 — and a phone held closer or
// further away moves that number by a factor of four. A reader whose constants
// are pixels rather than staff spaces reads perfectly across that whole band and
// then falls off a cliff just outside it, and nothing in CORE or HARD would ever
// see the cliff. So this block draws ONE page shape at nine sizes and reports
// precision and recall for each, which is the only measurement in the corpus
// whose x-axis is scale.
//
// Read the WORKING space column, not the drawn one. `readPage` clamps the page
// to WORK_WIDTH = 1400 pixels, so a page drawn at a large staff space on a wide
// canvas is handed to the reader shrunk; and the photographed variants are drawn
// large and then scaled down by the camera, which is how a phone photograph
// arrives. The working column is what the reader actually saw, measured off its
// own fitted staves.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-corpus.mjs            # everything, both blocks
//   node tools/scan-corpus.mjs --json     # machine-readable, for a harness
//   node tools/scan-corpus.mjs --core     # the ten spoilings only
//   node tools/scan-corpus.mjs --sizes    # the size sweep on its own
//   node tools/scan-corpus.mjs --few      # the few-systems block on its own
//   node tools/scan-corpus.mjs blurred    # one page
//
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const wantJson = process.argv.includes('--json');
const coreOnly = process.argv.includes('--core');
const sizesOnly = process.argv.includes('--sizes');
const fewOnly = process.argv.includes('--few');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({
  pick, coreOnly: justCore, sizesOnly: justSizes, fewOnly: justFew,
}) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  // --- drawing a page, and remembering what was drawn ----------------------
  //
  // A page is a list of systems; a system is a list of UNITS. A unit is either
  // a beamed group (n heads, k beams, one stem direction, a list of staff
  // steps) or a single unbeamed note — a crotchet or a minim.
  //
  // Written this way rather than as one hard-coded shape because the shape is
  // the variable that matters. The first version of this file drew one shape,
  // and it drew it wrong: its steps were `(grp + i*2) % 6`, whose fourth note
  // lands back on the first note's step, so `ys[3] === ys[0]` and every beam it
  // ever graded was exactly parallel to the stave. A whole tournament optimised
  // against it and one of the winners had a rule fitted to that accident.
  function drawPage({
    space = 14, systems = 6, sysGap = 16, warp = 0, tilt = 0,
    gapSpaces = 6.6, noteGap = 2.2, plan, lineDuty = () => 5,
  }) {
    const layouts = [];
    for (let sys = 0; sys < systems; sys++) layouts.push(plan(sys));
    const spans = layouts.map((units) => units.reduce(
      (a, u, i) => a + (u.steps.length - 1) * noteGap + (i ? (u.gapBefore ?? gapSpaces) : 0), 0,
    ));
    const W = Math.round(space * Math.max(50, 12 + Math.max(...spans)));
    // Tall enough for every system it is about to draw: the first sits at
    // twelve spaces and each one after is `sysGap` further down.
    const H = Math.round(space * 12 + systems * space * sysGap + space * 8);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const truth = [];

    // A page photographed off a bound book bends: the further across, the more
    // the line drops. `warp` is how many staff spaces of bend across the page.
    const bendAt = (x) => warp * space * Math.sin((x / W) * Math.PI);
    const tiltAt = (x) => tilt * (x - W / 2);

    for (let sys = 0; sys < systems; sys++) {
      const base = space * 12 + sys * space * sysGap;
      const lineY = (l, x) => base + l * space + bendAt(x) + tiltAt(x);

      g.fillStyle = '#111';
      // Staff lines, drawn as short segments so they can bend.
      //
      // HOW MUCH OF THE LINE IS INKED is `lineDuty`, and the segments are laid
      // down every four pixels: five wide is the solid line every page here has
      // always drawn (they overlap), and two wide is a line inked half the time
      // — which is what a faint system on a photograph thresholds into. It is
      // per SYSTEM because the case worth drawing is one faint system among
      // crisp ones, which nothing in CORE, HARD or SIZES contains. See FEW.
      const duty = lineDuty(sys);
      for (let l = 0; l < 5; l++) {
        for (let x = space * 3; x < W - space * 3; x += 4) {
          g.fillRect(x, lineY(l, x), duty, Math.max(1, space * 0.1));
        }
      }
      // A barline at each end.
      for (const at of [space * 3, W - space * 3]) {
        g.fillRect(at, lineY(0, at), Math.max(1.4, space * 0.12), space * 4);
      }

      let cursor = space * 6;
      let first = true;
      for (const unit of layouts[sys]) {
        if (!first) cursor += space * ((unit.gapBefore ?? gapSpaces) - gapSpaces);
        first = false;
        const n = unit.steps.length;
        const dir = unit.dir ?? -1;              // -1 stems up, +1 stems down
        const xs = [];
        const ys = [];
        for (let i = 0; i < n; i++) {
          const x = cursor + i * space * noteGap;
          const y = lineY(4, x) - unit.steps[i] * space / 2;
          xs.push(x); ys.push(y);
          g.save(); g.translate(x, y); g.rotate(-0.28);
          if (unit.hollow) {
            // A ring: ink round the rim, paper in the middle.
            g.beginPath(); g.ellipse(0, 0, space * 0.66, space * 0.5, 0, 0, Math.PI * 2);
            g.fillStyle = '#111'; g.fill();
            g.beginPath(); g.ellipse(0, 0, space * 0.44, space * 0.3, 0, 0, Math.PI * 2);
            g.fillStyle = '#fff'; g.fill();
          } else {
            g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
            g.fillStyle = '#111'; g.fill();
          }
          g.restore();
          truth.push({ x, y, beams: unit.beams });
        }
        g.fillStyle = '#111';
        const stemW = Math.max(1.3, space * 0.11);
        const sx = (i) => xs[i] + (dir < 0 ? space * 0.55 : -space * 0.55);
        if (unit.stem === false) {
          // A semibreve: no stem, no beam.
        } else if (unit.beams === 0 || n === 1) {
          // Unbeamed: a full three-and-a-bit spaces of clean stem.
          for (let i = 0; i < n; i++) {
            const end = ys[i] + dir * space * 3.2;
            g.fillRect(sx(i), Math.min(ys[i], end), stemW, Math.abs(ys[i] - end));
          }
        } else {
          // The beam slopes with the notes, as an engraver draws it: the run
          // rises or falls by half the pitch spread of the group.
          const rise = (ys[n - 1] - ys[0]) * (unit.slope ?? 0.5);
          const at = (i) => rise * (n > 1 ? i / (n - 1) : 0);
          const yBase = dir < 0
            ? Math.min(...ys.map((y, i) => y - at(i))) - space * 3.2
            : Math.max(...ys.map((y, i) => y - at(i))) + space * 3.2;
          const beamY = (i) => yBase + at(i);
          for (let i = 0; i < n; i++) {
            const end = beamY(i);
            g.fillRect(sx(i), Math.min(ys[i], end), stemW, Math.abs(ys[i] - end));
          }
          // A beam is half a staff space thick with a quarter space of paper
          // under it, which is what engraving practice says and what the
          // editions on a stand actually look like. The first version of this
          // file drew them 0.26 and 0.46 — barely half size — and that is not a
          // cosmetic difference: beams that thin merge into one band under a
          // blur that leaves real beams separate, so every photographed page
          // here was harder than any photograph of real music, and the reader
          // was being tuned against a difficulty that does not exist.
          const t = Math.max(1.8, space * 0.5);
          for (let bm = 0; bm < unit.beams; bm++) {
            // Stacked away from the beam nearest the heads: downwards for
            // stems up, upwards for stems down.
            const off = dir < 0 ? bm * space * 0.75 : -bm * space * 0.75;
            const x1 = sx(0);
            const x2 = sx(n - 1) + stemW;
            const y1 = beamY(0) + off;
            const y2 = beamY(n - 1) + off;
            g.beginPath();
            g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2 + t); g.lineTo(x1, y1 + t);
            g.closePath(); g.fillStyle = '#111'; g.fill();
          }
        }
        cursor += (n - 1) * space * noteGap + space * gapSpaces;
      }
    }
    return { canvas: c, truth };
  }

  // --- spoiling it the way a camera does -----------------------------------
  async function spoil(source, { blur = 0, contrast = 1, tint = null, jpeg = null, scale = 1 } = {}) {
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
      // Paper is not white and a lamp is not even: a warm wash, brighter at one
      // corner, which is what flattens the contrast on a real photograph.
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, `rgba(${tint.join(',')},0.42)`);
      grad.addColorStop(1, `rgba(${tint.join(',')},0.12)`);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    if (jpeg === null) return c;
    // Through a JPEG at a phone's quality and back, which is where the ringing
    // around every stem comes from.
    const blob = await new Promise((done) => c.toBlob(done, 'image/jpeg', jpeg));
    const bitmap = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return out;
  }

  // --- grading -------------------------------------------------------------
  // `near` — how close a detection has to be to count as the drawn note.
  //
  // The default is a share of the page's WIDTH, which is fine while every page
  // in a block is drawn at about the same size and is exactly wrong across a
  // size sweep: at a staff space of 6 the floor of six pixels is a whole staff
  // space of slack, and at 28 the same rule is a third of one. A tolerance that
  // tightens as the page grows would show a cliff at the large end that is the
  // RULER moving, not the reader. So the size block passes its own radius,
  // measured in staff spaces the way tools/truth-check.mjs measures its own.
  function grade(truth, canvas, read, near = Math.max(6, canvas.width / 160)) {
    const found = [];
    if (read) {
      for (const note of notesInOrder(read)) {
        found.push({ x: note.x * canvas.width, y: note.y * canvas.height, beams: note.beams });
      }
    }
    const taken = new Set();
    let matched = 0;
    let rightBeams = 0;
    // Where the wrong answers go, by (truth beams -> read beams). A count that
    // is wrong in a consistent direction is a different bug from one that is
    // wrong at random, and the summary alone cannot tell them apart.
    const confusion = {};
    for (const f of found) {
      let best = -1;
      let bestGap = Infinity;
      for (const [i, t] of truth.entries()) {
        if (taken.has(i)) continue;
        const gap = Math.hypot(t.x - f.x, t.y - f.y);
        if (gap < near && gap < bestGap) { bestGap = gap; best = i; }
      }
      if (best < 0) continue;
      taken.add(best);
      matched += 1;
      if (truth[best].beams === f.beams) rightBeams += 1;
      else {
        const key = `${truth[best].beams}->${f.beams}`;
        confusion[key] = (confusion[key] ?? 0) + 1;
      }
    }
    return {
      drawn: truth.length,
      found: found.length,
      matched,
      spurious: found.length - matched,
      rightBeams,
      recall: +(matched / truth.length).toFixed(3),
      // Reported as well as `spurious` because a count of false circles is not
      // comparable between pages that carry different numbers of notes, and the
      // size sweep compares nine pages that do.
      precision: found.length ? +(matched / found.length).toFixed(3) : 0,
      beamAccuracy: matched ? +(rightBeams / matched).toFixed(3) : 0,
      // What matters end to end: of every note on the page, how many were both
      // found AND given the right value.
      overall: +(rightBeams / truth.length).toFixed(3),
      confusion,
    };
  }

  const up = -1;
  const down = 1;
  // Four notes whose steps genuinely rise, so the beam genuinely slopes.
  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  const falling = (grp) => [6, 4, 2, 0].map((s) => (s + grp) % 8);
  // The shape the core block draws: 1, 2 or 3 beams varying group by group so
  // one page carries quavers, semiquavers and demisemiquavers together.
  // `rising(grp + sys)`, not `rising(grp)`.
  //
  // It used to be the latter, and that made every system of every page in this
  // corpus a pitch-for-pitch copy of the one above it, at the same distance
  // across — which is not a page anyone has ever engraved, and made the fixture
  // an odd one out beside `dense`, which had varied by system all along. It
  // matters because a reader is entitled to treat ink printed identically on
  // every system as furniture rather than music, and against a page where the
  // MUSIC is printed identically on every system that inference cannot be told
  // from a wrong one. Same note count, same shapes, same cameras; only the
  // pitches differ system to system, as they do on a page.
  const ordinary = (sys) => [0, 1, 2, 3, 4].map((grp) => ({
    beams: 1 + ((sys + grp) % 3), steps: rising(grp + sys), dir: up,
  }));
  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };
  const PHOTO_DRAW = { space: 18, warp: 0.7, tilt: 0.004 };

  // --- CORE: one shape, ten cameras ----------------------------------------
  const CORE = {
    clean: { draw: { plan: ordinary }, spoil: {} },
    small: { draw: { space: 10, plan: ordinary }, spoil: {} },
    tiny: { draw: { space: 8, plan: ordinary }, spoil: {} },
    blurred: { draw: { plan: ordinary }, spoil: { blur: 1.1 } },
    faint: { draw: { plan: ordinary }, spoil: { contrast: 0.55, tint: [214, 196, 160] } },
    jpeg: { draw: { plan: ordinary }, spoil: { jpeg: 0.5 } },
    tilted: { draw: { tilt: 0.006, plan: ordinary }, spoil: {} },
    creased: { draw: { warp: 0.9, plan: ordinary }, spoil: {} },
    shrunk: { draw: { space: 20, plan: ordinary }, spoil: { scale: 0.55 } },
    // Everything at once, which is what a photograph of a page actually is.
    photograph: { draw: { ...PHOTO_DRAW, plan: ordinary }, spoil: PHOTO },
  };

  // --- HARD: one camera, many shapes ---------------------------------------
  const HARD = {
    // Beams that slope the other way, and steeper than an engraver would.
    slopedDown: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3), steps: falling(grp), dir: up })) },
      spoil: {},
    },
    slopedSteep: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3), steps: [0, 3, 6, 9], dir: up, slope: 0.7 })) },
      spoil: {},
    },
    slopedPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3), steps: (grp % 2 ? falling : rising)(grp), dir: up })) },
      spoil: PHOTO,
    },

    // Stems the other way. A page has both on every line.
    downStems: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3),
        steps: [8, 10, 12, 8].map((s) => s - (grp % 3)), dir: down })) },
      spoil: {},
    },
    // A plain descending group with down stems: the commonest shape there is,
    // and the one whose stems cross every staff line.
    dsOrdinary: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3),
        steps: [10, 8, 6, 4].map((s) => s - (grp % 3)), dir: down, slope: 0.5 })) },
      spoil: {},
    },
    dsOrdinaryPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3),
        steps: [10, 8, 6, 4].map((s) => s - (grp % 3)), dir: down, slope: 0.5 })) },
      spoil: PHOTO,
    },
    usCrossLines: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 1 + ((sys + grp) % 3),
        steps: [-8, -6, -4, -2].map((s) => s + (grp % 3)), dir: up, slope: 0.5 })) },
      spoil: {},
    },

    // Group sizes other than four. A pair has one neighbour to vote with.
    pairs: {
      draw: { gapSpaces: 5.5, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 1 + ((sys + grp) % 3), steps: [(grp * 2) % 6, (grp * 2 + 2) % 6], dir: up })) },
      spoil: {},
    },
    pairsPhoto: {
      draw: { ...PHOTO_DRAW, gapSpaces: 5.5, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 1 + ((sys + grp) % 3), steps: [(grp * 2) % 6, (grp * 2 + 2) % 6], dir: up })) },
      spoil: PHOTO,
    },
    sixes: {
      draw: { plan: (sys) => [0, 1, 2].map((grp) => ({
        beams: 1 + ((sys + grp) % 3),
        steps: [0, 1, 2, 3, 4, 5].map((i) => (grp + i) % 7), dir: up })) },
      spoil: {},
    },

    // UNBEAMED NOTES. The core block has none at all — every note it grades has
    // 1, 2 or 3 beams, so a reader biased towards seeing a beam where there is
    // none scores perfectly on it. A crotchet is the commonest note in music.
    noBeams: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) },
      spoil: {},
    },
    noBeamsPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) },
      spoil: PHOTO,
    },
    minims: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up, hollow: true })) },
      spoil: {},
    },
    // Beamed and unbeamed side by side, which is what a bar of music is.
    mixed: {
      draw: { plan: (sys) => [0, 1, 2, 3].flatMap((grp) => [
        { beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up },
        { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up },
        { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up },
      ]) },
      spoil: {},
    },
    mixedPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3].flatMap((grp) => [
        { beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up },
        { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up },
        { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up },
      ]) },
      spoil: PHOTO,
    },
    // A bar as it is actually set: the crotchets crowd up against the beamed
    // group that shares their bar, and the next BAR stands well clear.
    barMix: {
      draw: { plan: (sys) => [0, 1, 2].flatMap((grp) => [
        { beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up, gapBefore: 8 },
        { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up, gapBefore: 2.6 },
        { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up, gapBefore: 2.6 },
      ]) },
      spoil: {},
    },
    barMixPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2].flatMap((grp) => [
        { beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up, gapBefore: 8 },
        { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up, gapBefore: 2.6 },
        { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up, gapBefore: 2.6 },
      ]) },
      spoil: PHOTO,
    },

    // THE SHAPE OF THE PAGE THIS WAS ALL FOR.
    //
    // Bars 21–41 of the Bach, photographed off the stand: continuous
    // semiquavers in groups of four, nine or ten groups to a system, at ten
    // pixels to the staff space. Every other page here is more generous than
    // that — six groups a system, well spaced — and the difference matters,
    // because a dense page gives every stem a neighbour's beam two spaces away
    // and gives the profile window less room to be wrong in.
    denseSemis: {
      draw: { space: 16, gapSpaces: 3, noteGap: 2, plan: (sys) => (
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((grp) => ({
          beams: 2, steps: rising(grp + sys), dir: grp % 2 ? down : up })))
      },
      spoil: {},
    },
    densePhoto: {
      draw: { space: 16, warp: 0.7, tilt: 0.004, gapSpaces: 3, noteGap: 2, plan: (sys) => (
        [0, 1, 2, 3, 4, 5, 6, 7, 8].map((grp) => ({
          beams: 2, steps: rising(grp + sys), dir: grp % 2 ? down : up })))
      },
      spoil: PHOTO,
    },

    // The page's own geometry: very small, very close together, very blurred.
    halfSpace: {
      draw: { space: 7, plan: ordinary },
      spoil: {},
    },
    // Only three-beam groups at half size: nothing on the page resolves a pair,
    // so a calibration that learns the beam pitch from the page has nothing to
    // learn it from and must fall back.
    halfSpaceThree: {
      draw: { space: 7, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
        beams: 3, steps: rising(grp), dir: up })) },
      spoil: {},
    },
    tightSystems: {
      draw: { sysGap: 10.5, plan: ordinary },
      spoil: {},
    },
    heavyBlur: {
      draw: { space: 18, plan: ordinary },
      spoil: { blur: 2.4 },
    },
  };

  // --- SIZES: one shape, nine sizes ----------------------------------------
  //
  // THREE GROUPS TO A SYSTEM, and that is a constraint of the drawing code
  // rather than a taste: drawPage sizes its canvas at
  // `space * max(50, 12 + widest span)`, and `readPage` clamps whatever it is
  // given to 1400 pixels across. So a page whose music spans 59 staff spaces —
  // which is what `ordinary` draws — is 71 spaces wide, and past a drawn space
  // of about 19 the clamp shrinks it back down and the sweep stops sweeping.
  // Three groups span 33, the page is 50 spaces wide, and the working space
  // then follows the drawn one all the way to 1400/50 = 28. That is the corpus
  // ceiling and it cannot be raised without narrowing the page further; the
  // cliff measured on real pages is above it, at about 35, and this block
  // cannot reach it. Said plainly in the handover rather than hidden here.
  const sparse = (sys) => [0, 1, 2].map((grp) => ({
    beams: 1 + ((sys + grp) % 3), steps: rising(grp + sys), dir: up,
  }));
  // A phone photograph arrives having been scaled down by the camera, so the
  // photographed rows are DRAWN large and shrunk to land on the same working
  // sizes as the clean ones. Drawn at target/0.62, which is PHOTO's own scale.
  const SIZES = {};
  for (const target of [6, 8, 10, 12, 14, 16, 20, 24, 28]) {
    SIZES[`clean${target}`] = { draw: { space: target, plan: sparse }, spoil: {}, target };
  }
  for (const target of [6, 8, 10, 12, 14, 16, 20]) {
    SIZES[`photo${target}`] = {
      draw: { space: Math.round(target / 0.62), warp: 0.7, tilt: 0.004, plan: sparse },
      spoil: PHOTO,
      target,
    };
  }

  // --- FEW: two and three systems, one of them printed faint ---------------
  //
  // Every other page in this file has SIX systems, all printed alike, and that
  // hides two rules of the stave tracker at once.
  //
  // ONE: `fillMissedStaves` returns early below three staves — two points are
  // not a rhythm — so on a six-system page a stave the tracker drops is put
  // back and nothing downstream ever knows. On a two- or three-system page
  // there is no rescue, and a dropped system is gone for good. That page is not
  // a curiosity: it is the close-up the app's own camera scanner produces, a
  // phone held near two bars on a stand.
  //
  // TWO: `trackCombs` decides how much like a stave a curve has to look by
  // comparing it with the BEST curve on the same page — three fifths of it —
  // and with every system printed alike there is nothing for that comparison to
  // get wrong. One faint system among crisp ones is the case that can break it,
  // and until this block there was no such page anywhere in the corpus.
  //
  // THE FAINT SYSTEM IS CALIBRATED, not chosen by eye. `lineDuty: 2` was picked
  // by dumping every joined curve's median comb score: it puts the faint
  // system's curve at 0.47 against 0.94 for the crisp ones, which is above
  // `combPeaks`' own 0.3 floor — so every point of it is admitted as a stave —
  // and below three fifths of the best. That is exactly the window where the
  // relative bar, and only the relative bar, decides whether the page is read.
  // Fainter (duty 1.5 and below) and the curve shatters into fragments that die
  // on LENGTH instead, which measures a different rule; darker (duty 2.5) and
  // it clears the bar and the case tests nothing.
  //
  // The heads are drawn at full ink on every system. A faint NOTEHEAD would
  // confound the recall column with a head-detection loss; the comb only ever
  // looks at staff lines, so faint lines isolate the rule under test and the
  // recall column reads as a step — the system is kept and all twelve of its
  // notes are found, or it is dropped and all twelve are missed.
  const faint = (which) => (s) => (s === which ? 2 : 5);
  const FEW = {
    few2: { draw: { systems: 2, sysGap: 11, plan: sparse }, spoil: {} },
    few2faint: { draw: { systems: 2, sysGap: 11, plan: sparse, lineDuty: faint(1) }, spoil: {} },
    few2photo: {
      draw: { systems: 2, sysGap: 11, space: 23, warp: 0.7, tilt: 0.004, plan: sparse },
      spoil: PHOTO,
    },
    few2faintPhoto: {
      draw: {
        systems: 2, sysGap: 11, space: 23, warp: 0.7, tilt: 0.004, plan: sparse,
        lineDuty: faint(1),
      },
      spoil: PHOTO,
    },
    few3: { draw: { systems: 3, sysGap: 11, plan: sparse }, spoil: {} },
    few3faint: { draw: { systems: 3, sysGap: 11, plan: sparse, lineDuty: faint(1) }, spoil: {} },
    few3photo: {
      draw: { systems: 3, sysGap: 11, space: 23, warp: 0.7, tilt: 0.004, plan: sparse },
      spoil: PHOTO,
    },
    few3faintPhoto: {
      draw: {
        systems: 3, sysGap: 11, space: 23, warp: 0.7, tilt: 0.004, plan: sparse,
        lineDuty: faint(1),
      },
      spoil: PHOTO,
    },
    // The control, and it is the row that says what the rescue is worth: the
    // same faint system on a page with enough systems for `fillMissedStaves` to
    // have a rhythm to predict from. If this row reads 6/6 while `few3faint`
    // reads 2/3, the difference between them is the rescue and nothing else.
    few6faint: { draw: { systems: 6, sysGap: 11, plan: sparse, lineDuty: faint(3) }, spoil: {} },
  };

  const BLOCKS = justFew ? { few: FEW }
    : justSizes ? { sizes: SIZES }
      : justCore ? { core: CORE }
        : { core: CORE, hard: HARD, sizes: SIZES, few: FEW };
  const out = { core: {}, hard: {}, sizes: {}, few: {} };
  for (const [block, pages] of Object.entries(BLOCKS)) {
    for (const [name, recipe] of Object.entries(pages)) {
      if (pick.length && !pick.includes(name)) continue;
      const { canvas, truth } = drawPage(recipe.draw);
      const spoiled = await spoil(canvas, recipe.spoil);
      // Truth positions move with the page when it is scaled.
      const s = spoiled.width / canvas.width;
      const moved = truth.map((t) => ({ ...t, x: t.x * s, y: t.y * s }));
      let read = null;
      let error = null;
      try { read = readPage(spoiled, spoiled.width, spoiled.height); } catch (e) { error = String(e); }
      // The staff space the READER worked at, off its own fitted staves — which
      // is the honest x-axis of the sweep and is not the drawn one: the camera
      // shrinks the page and WORK_WIDTH clamps it.
      const spaces = (read?.staves ?? []).map((st) => st.space * spoiled.height)
        .sort((a, b) => a - b);
      const working = spaces.length ? spaces[Math.floor((spaces.length - 1) / 2)] : 0;
      // In the size block the match radius is measured in staff spaces, at the
      // size the page was DRAWN and then scaled — not off the reader's own
      // answer, which would make the ruler depend on the thing being measured.
      const near = block === 'sizes'
        ? Math.max(2, (recipe.draw.space ?? 14) * s * 0.6)
        : undefined;
      out[block][name] = {
        ...grade(moved, spoiled, read, near),
        staves: read?.staves.length ?? 0,
        wantStaves: recipe.draw.systems ?? 6,
        size: `${spoiled.width}x${spoiled.height}`,
        drawnSpace: recipe.draw.space ?? 14,
        target: recipe.target ?? null,
        workingSpace: +working.toFixed(1),
        // Did the page's agreed key reach fire here?
        //
        // A corpus page is bare staves with music where the furniture would be,
        // and the one rule in the reader that lets one system's evidence widen
        // another system's suppression is the one that could eat a note on all
        // six at once. It is gated on the page agreeing a KEY, which a page with
        // no signature printed on it should never do — and "should never" is
        // exactly the kind of claim this file exists to replace with a number.
        // See agreeKeyReach in src/analysis/scan-key.js.
        keyReach: read?.keyReach ?? null,
        error,
      };
    }
  }
  return out;
}, { pick: only, coreOnly, sizesOnly, fewOnly });

// The one cross-system rule in the reader, counted rather than assumed safe.
function reachFired(report) {
  const fired = [];
  for (const block of ['core', 'hard', 'sizes', 'few']) {
    for (const [name, r] of Object.entries(report[block] ?? {})) {
      if (r.keyReach != null) fired.push(`${name} ${r.keyReach.toFixed(2)}`);
    }
  }
  return fired;
}

function mean(pages) {
  const values = Object.values(pages);
  if (!values.length) return null;
  return values.reduce((a, r) => a + r.overall, 0) / values.length;
}

if (wantJson) {
  console.log(JSON.stringify({
    ...report,
    means: {
      core: mean(report.core), hard: mean(report.hard),
      sizes: mean(report.sizes), few: mean(report.few),
    },
  }, null, 2));
} else {
  const all = [...Object.keys(report.core), ...Object.keys(report.hard),
    ...Object.keys(report.sizes), ...Object.keys(report.few)];
  if (!all.length) console.log('\nno pages matched');
  const pad = Math.max(4, ...all.map((n) => n.length));
  for (const [block, label] of [['core', 'CORE — one shape, ten cameras'], ['hard', 'HARD — one camera, many shapes']]) {
    const pages = report[block];
    if (!Object.keys(pages).length) continue;
    console.log(`\n${label}`);
    console.log(`${'page'.padEnd(pad)}  staves  recall  beams  overall   found/drawn  spur  confusion`);
    for (const [name, r] of Object.entries(pages)) {
      const conf = Object.entries(r.confusion).sort((a, b) => b[1] - a[1])
        .slice(0, 3).map(([k, n]) => `${k}x${n}`).join(' ');
      console.log(
        `${name.padEnd(pad)}  ${String(r.staves).padStart(2)}/${r.wantStaves}`
        + `    ${String(Math.round(r.recall * 100)).padStart(3)}%`
        + `    ${String(Math.round(r.beamAccuracy * 100)).padStart(3)}%`
        + `   ${String(Math.round(r.overall * 100)).padStart(3)}%`
        + `      ${String(r.found).padStart(3)}/${r.drawn}`
        + `      ${String(r.spurious).padStart(3)}  ${conf}`,
      );
    }
    console.log(`${'mean'.padEnd(pad)}  ${'  '.padStart(6)}${' '.repeat(14)}${String(Math.round(mean(pages) * 100)).padStart(3)}%`);
  }
  if (Object.keys(report.sizes).length) {
    console.log('\nSIZES — one shape, nine sizes. Read the WORKING column.');
    console.log(`${'page'.padEnd(pad)}  drawn  working  staves  precision  recall  beams  overall   found/drawn`);
    for (const [name, r] of Object.entries(report.sizes)) {
      console.log(
        `${name.padEnd(pad)}  ${String(r.drawnSpace).padStart(5)}`
        + `  ${String(r.workingSpace).padStart(7)}`
        + `    ${String(r.staves).padStart(2)}/${r.wantStaves}`
        + `      ${String(Math.round(r.precision * 100)).padStart(3)}%`
        + `    ${String(Math.round(r.recall * 100)).padStart(3)}%`
        + `   ${String(Math.round(r.beamAccuracy * 100)).padStart(3)}%`
        + `    ${String(Math.round(r.overall * 100)).padStart(3)}%`
        + `      ${String(r.found).padStart(3)}/${r.drawn}`,
      );
    }
    console.log(`${'mean'.padEnd(pad)}${' '.repeat(41)}${String(Math.round(mean(report.sizes) * 100)).padStart(3)}%`);
  }
  if (Object.keys(report.few).length) {
    console.log('\nFEW — two and three systems, one of them printed faint.');
    console.log('Read the STAVES column: below three staves nothing rescues a dropped system.');
    console.log(`${'page'.padEnd(pad)}  working  staves  precision  recall  beams  overall   found/drawn`);
    for (const [name, r] of Object.entries(report.few)) {
      console.log(
        `${name.padEnd(pad)}  ${String(r.workingSpace).padStart(7)}`
        + `    ${String(r.staves).padStart(2)}/${r.wantStaves}`
        + `      ${String(Math.round(r.precision * 100)).padStart(3)}%`
        + `    ${String(Math.round(r.recall * 100)).padStart(3)}%`
        + `   ${String(Math.round(r.beamAccuracy * 100)).padStart(3)}%`
        + `    ${String(Math.round(r.overall * 100)).padStart(3)}%`
        + `      ${String(r.found).padStart(3)}/${r.drawn}`,
      );
    }
    console.log(`${'mean'.padEnd(pad)}${' '.repeat(32)}${String(Math.round(mean(report.few) * 100)).padStart(3)}%`);
  }
  const fired = reachFired(report);
  console.log(`\nTHE PAGE-AGREED KEY REACH fired on ${fired.length} of ${
    ['core', 'hard', 'sizes', 'few'].reduce((a, b) => a + Object.keys(report[b] ?? {}).length, 0)
  } pages${fired.length ? `: ${fired.join(', ')}` : ' — no corpus page agrees a key, so no band here is ever widened'}`);
}
if (errors.length) console.log('\nerrors:', errors.slice(0, 4).join(' | '));
await browser.close();
