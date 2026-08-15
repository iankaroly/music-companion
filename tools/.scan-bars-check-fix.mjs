// Barlines, graded — the one part of the page reader nothing measured.
//
// scan-corpus.mjs grades noteheads and beam counts against pages whose every
// note is known, and it is careful and thorough about both. What it never
// draws is a barline in the MIDDLE of a system: its pages carry one at each
// end and nothing between, so `findBars` has been shipping against a test that
// cannot fail it. Every bar number the app has ever printed rests on a
// measurement nobody has taken.
//
// That number decides something specific. Reading a photograph well enough to
// say WHICH NOTE you played means recognising noteheads, and the corpus says
// that runs at 75–90% on a photographed page — not enough to count notes off
// against. Reading it well enough to say WHICH BAR you are in is a different
// and much smaller question: a barline is a long vertical stroke with nothing
// hanging off it, and there are twenty of them on a page rather than four
// hundred. If bars are found reliably then the notes on the page can be
// supplied by a MusicXML file that is already correct, and the photograph only
// has to say where on the paper each bar sits. If bars are NOT found reliably,
// that plan collapses too and the scanned page can only ever be a picture.
//
// So the pages here are the corpus's pages with barlines added at known x, and
// the grading asks three things of each: how many real barlines were found,
// how many were invented, and how far out the found ones were.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-bars-check.mjs
//   node tools/scan-bars-check.mjs --json
//
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const wantJson = process.argv.includes('--json');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async () => {
  const { readPage } = await import('/tools/.scan-read-fix.js');

  // The corpus's page, with bars in it.
  //
  // `perBar` units between barlines, and the barline is drawn the full height
  // of the stave at the x the cursor has reached — which is where an engraver
  // puts it and, more to the point, is a position this file then knows exactly.
  function drawPage({
    space = 14, systems = 6, sysGap = 16, warp = 0, tilt = 0,
    gapSpaces = 6.6, noteGap = 2.2, perBar = 2, plan,
  }) {
    const layouts = [];
    for (let sys = 0; sys < systems; sys++) layouts.push(plan(sys));
    const spans = layouts.map((units) => units.reduce(
      (a, u, i) => a + (u.steps.length - 1) * noteGap + (i ? (u.gapBefore ?? gapSpaces) : 0), 0,
    ));
    const W = Math.round(space * Math.max(50, 12 + Math.max(...spans)));
    const H = Math.round(space * 12 + systems * space * sysGap + space * 8);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    // Every barline drawn, as a fraction of the page width. The same x in
    // every system, so one list grades all of them and a staff that was found
    // in the wrong place cannot quietly score against a neighbour's bars.
    let barsAt = null;

    const bendAt = (x) => warp * space * Math.sin((x / W) * Math.PI);
    const tiltAt = (x) => tilt * (x - W / 2);

    for (let sys = 0; sys < systems; sys++) {
      const base = space * 12 + sys * space * sysGap;
      const lineY = (l, x) => base + l * space + bendAt(x) + tiltAt(x);
      g.fillStyle = '#111';
      for (let l = 0; l < 5; l++) {
        for (let x = space * 3; x < W - space * 3; x += 4) {
          g.fillRect(x, lineY(l, x), 5, Math.max(1, space * 0.1));
        }
      }
      const barline = (at) => {
        g.fillStyle = '#111';
        g.fillRect(at, lineY(0, at), Math.max(1.4, space * 0.12), space * 4);
      };
      const here = [];
      for (const at of [space * 3, W - space * 3]) { barline(at); here.push(at); }

      let cursor = space * 6;
      let first = true;
      let sinceBar = 0;
      for (const unit of layouts[sys]) {
        if (!first) cursor += space * ((unit.gapBefore ?? gapSpaces) - gapSpaces);
        first = false;
        // A barline stands in the gap BEFORE this unit, once `perBar` units
        // have gone by — which is what the extra space in that gap is for.
        if (sinceBar >= perBar) {
          const at = cursor - space * 2.4;
          barline(at); here.push(at);
          sinceBar = 0;
        }
        sinceBar += 1;
        const n = unit.steps.length;
        const dir = unit.dir ?? -1;
        const xs = [];
        const ys = [];
        for (let i = 0; i < n; i++) {
          const x = cursor + i * space * noteGap;
          const y = lineY(4, x) - unit.steps[i] * space / 2;
          xs.push(x); ys.push(y);
          g.save(); g.translate(x, y); g.rotate(-0.28);
          g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
          g.fillStyle = '#111'; g.fill();
          g.restore();
        }
        g.fillStyle = '#111';
        const stemW = Math.max(1.3, space * 0.11);
        const sx = (i) => xs[i] + (dir < 0 ? space * 0.55 : -space * 0.55);
        if (unit.beams === 0 || n === 1) {
          for (let i = 0; i < n; i++) {
            const end = ys[i] + dir * space * 3.2;
            g.fillRect(sx(i), Math.min(ys[i], end), stemW, Math.abs(ys[i] - end));
          }
        } else {
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
          const t = Math.max(1.8, space * 0.5);
          for (let bm = 0; bm < unit.beams; bm++) {
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
      if (!barsAt) barsAt = here.slice().sort((a, b) => a - b);
    }
    return { canvas: c, bars: barsAt, width: W };
  }

  // Identical to the corpus's, so "photographed" means the same thing here.
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
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, `rgba(${tint.join(',')},0.42)`);
      grad.addColorStop(1, `rgba(${tint.join(',')},0.12)`);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    if (jpeg === null) return c;
    const blob = await new Promise((done) => c.toBlob(done, 'image/jpeg', jpeg));
    const bitmap = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return out;
  }

  // Every staff graded against the same list of barlines, because every system
  // was drawn with its bars at the same x. A staff is scored on its own: the
  // question the caller has is "can I trust the bar number on THIS line", and
  // a page-wide average hides a system that found none at all.
  function gradeBars(truthPx, drawnWidth, canvas, read) {
    // Truth is in the ORIGINAL page's pixels and the reading is in fractions of
    // whatever the page was shrunk to, so both go to fractions of width before
    // anything is compared.
    const truth = truthPx.map((x) => x / drawnWidth);
    const near = Math.max(6, canvas.width / 160) / canvas.width;
    const staves = read?.staves ?? [];
    let matched = 0;
    let found = 0;
    let perfect = 0;
    const offsets = [];
    for (const staff of staves) {
      const bars = staff.bars ?? [];
      found += bars.length;
      const taken = new Set();
      let here = 0;
      for (const b of bars) {
        let best = -1;
        let bestGap = Infinity;
        for (const [i, t] of truth.entries()) {
          if (taken.has(i)) continue;
          const gap = Math.abs(t - b);
          if (gap < near && gap < bestGap) { bestGap = gap; best = i; }
        }
        if (best < 0) continue;
        taken.add(best);
        here += 1;
        offsets.push(bestGap);
      }
      matched += here;
      // The measure that actually matters: a system whose bars are ALL right
      // and which invented none. Bar numbering is a running count, so one
      // missed line renumbers everything after it on that system — 90% of the
      // barlines is not 90% of the bar numbers, it is a wrong answer from the
      // miss onwards.
      if (here === truth.length && bars.length === truth.length) perfect += 1;
    }
    const want = truth.length * (staves.length || 1);
    offsets.sort((a, b) => a - b);
    return {
      staves: staves.length,
      drawnPerStaff: truth.length,
      found,
      matched,
      spurious: found - matched,
      recall: want ? +(matched / want).toFixed(3) : 0,
      cleanStaves: perfect,
      // In staff-widths, which is the unit that survives the page being any
      // size: a barline half a percent of the width out is a barline you can
      // still put a note on the right side of.
      medianOffset: offsets.length
        ? +(offsets[Math.floor(offsets.length / 2)] * 100).toFixed(3) : null,
    };
  }

  const up = -1;
  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  // Twelve groups to a system, so a page carries five or six barlines per line
  // rather than one. A system with a single bar in the middle of it is a test
  // that can be passed by finding almost nothing, and a page of music does not
  // look like that: four to six bars a line is what a part actually sets.
  const ordinary = (sys) => Array.from({ length: 12 }, (_, grp) => ({
    beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up,
  }));
  const plain = (sys) => Array.from({ length: 16 }, (_, grp) => ({
    beams: 0, steps: [(grp * 2 + sys) % 8], dir: up,
  }));
  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };
  const PHOTO_DRAW = { space: 18, warp: 0.7, tilt: 0.004 };

  const PAGES = {
    clean: { draw: { plan: ordinary }, spoil: {} },
    blurred: { draw: { plan: ordinary }, spoil: { blur: 1.1 } },
    faint: { draw: { plan: ordinary }, spoil: { contrast: 0.55, tint: [214, 196, 160] } },
    jpeg: { draw: { plan: ordinary }, spoil: { jpeg: 0.5 } },
    tilted: { draw: { tilt: 0.006, plan: ordinary }, spoil: {} },
    creased: { draw: { warp: 0.9, plan: ordinary }, spoil: {} },
    shrunk: { draw: { space: 20, plan: ordinary }, spoil: { scale: 0.55 } },
    // Everything at once, which is what a photograph of a page actually is.
    photograph: { draw: { ...PHOTO_DRAW, plan: ordinary }, spoil: PHOTO },
    // Four units to a bar rather than two: fewer barlines, further apart, which
    // is the easy end and worth having as the ceiling.
    wideBars: { draw: { plan: ordinary, perBar: 4 }, spoil: {} },
    wideBarsPhoto: { draw: { ...PHOTO_DRAW, plan: ordinary, perBar: 4 }, spoil: PHOTO },
    // Unbeamed notes: every stem is a short vertical stroke, and a barline is a
    // long one. This is where a barline finder is most likely to be fooled.
    stemsOnly: { draw: { plan: plain, perBar: 4 }, spoil: {} },
    stemsOnlyPhoto: { draw: { ...PHOTO_DRAW, plan: plain, perBar: 4 }, spoil: PHOTO },
  };

  const out = [];
  for (const [name, spec] of Object.entries(PAGES)) {
    const drawn = drawPage(spec.draw);
    const shot = await spoil(drawn.canvas, spec.spoil);
    let read = null;
    let error = null;
    try { read = readPage(shot, shot.width, shot.height); } catch (e) { error = String(e); }
    out.push({ name, error, ...gradeBars(drawn.bars, drawn.width, shot, read) });
  }
  return out;
});

await browser.close();

if (wantJson) {
  console.log(JSON.stringify({ pages: report, errors }, null, 2));
} else {
  console.log('\nBARLINES — every system drawn with bars at known positions\n');
  console.log('page              staves  bars/staff  found  matched  spur  recall  clean staves  median err');
  for (const r of report) {
    if (r.error) { console.log(`${r.name.padEnd(17)} ERROR ${r.error}`); continue; }
    console.log(
      `${r.name.padEnd(17)} ${String(r.staves).padStart(4)}    `
      + `${String(r.drawnPerStaff).padStart(6)}    `
      + `${String(r.found).padStart(5)}  ${String(r.matched).padStart(7)}  `
      + `${String(r.spurious).padStart(4)}  ${`${Math.round(r.recall * 100)}%`.padStart(6)}  `
      + `${`${r.cleanStaves}/${r.staves}`.padStart(12)}  `
      + `${r.medianOffset === null ? '   —' : `${r.medianOffset}%`.padStart(10)}`,
    );
  }
  const graded = report.filter((r) => !r.error);
  const mean = graded.reduce((a, r) => a + r.recall, 0) / (graded.length || 1);
  const cleanAll = graded.reduce((a, r) => a + r.cleanStaves, 0);
  const stavesAll = graded.reduce((a, r) => a + r.staves, 0);
  console.log(`\nmean recall ${Math.round(mean * 100)}%`
    + ` · systems with every bar right and none invented ${cleanAll}/${stavesAll}\n`);
  if (errors.length) console.log('page errors:', errors);
}
