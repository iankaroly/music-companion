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
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-corpus.mjs            # every condition, summary
//   node tools/scan-corpus.mjs --json     # machine-readable, for a harness
//   node tools/scan-corpus.mjs blurred    # one condition
//
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const wantJson = process.argv.includes('--json');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async (pick) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  // --- drawing a page, and remembering what was drawn ----------------------
  //
  // Groups of four beamed notes, with the beam count varying group by group so
  // one page carries quavers, semiquavers and demisemiquavers together — which
  // is what a real page does and what a page of one value cannot test.
  function drawPage({ space = 14, systems = 6, groups = 5, warp = 0, tilt = 0 } = {}) {
    const W = Math.round(space * 78);
    // Tall enough for every system it is about to draw: the first sits at
    // twelve spaces and each one after is sixteen further down.
    const H = Math.round(space * 12 + systems * space * 16 + space * 8);
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
      const base = space * 12 + sys * space * 16;
      const lineY = (l, x) => base + l * space + bendAt(x) + tiltAt(x);

      g.fillStyle = '#111';
      // Staff lines, drawn as short segments so they can bend.
      for (let l = 0; l < 5; l++) {
        for (let x = space * 3; x < W - space * 3; x += 4) {
          g.fillRect(x, lineY(l, x), 5, Math.max(1, space * 0.1));
        }
      }
      // A barline at each end and between the groups.
      for (const at of [space * 3, W - space * 3]) {
        g.fillRect(at, lineY(0, at), Math.max(1.4, space * 0.12), space * 4);
      }

      for (let grp = 0; grp < groups; grp++) {
        // 1, 2 or 3 beams, cycling so every page has all three.
        const beams = 1 + ((sys + grp) % 3);
        const x0 = space * 6 + grp * ((W - space * 12) / groups);
        const ys = [];
        const xs = [];
        for (let i = 0; i < 4; i++) {
          const x = x0 + i * space * 2.2;
          const st = (grp + i * 2) % 6;
          const y = lineY(4, x) - st * space / 2;
          xs.push(x); ys.push(y);
          g.save(); g.translate(x, y); g.rotate(-0.28);
          g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
          g.fillStyle = '#111'; g.fill();
          g.restore();
          truth.push({ x, y, beams });
        }
        // Stems up to a beam that slopes with the notes, as an engraver draws.
        const stemTop = Math.min(...ys) - space * 3.2;
        const slope = (ys[3] - ys[0]) * 0.25;
        for (let i = 0; i < 4; i++) {
          const top = stemTop + slope * (i / 3);
          g.fillRect(xs[i] + space * 0.55, top, Math.max(1.3, space * 0.11), ys[i] - top);
        }
        for (let bm = 0; bm < beams; bm++) {
          g.save();
          g.beginPath();
          const x1 = xs[0] + space * 0.55;
          const x2 = xs[3] + space * 0.55 + Math.max(1.3, space * 0.11);
          const y1 = stemTop + bm * space * 0.46;
          const y2 = y1 + slope;
          const t = Math.max(1.8, space * 0.26);
          g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2 + t); g.lineTo(x1, y1 + t);
          g.closePath(); g.fillStyle = '#111'; g.fill();
          g.restore();
        }
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
  function grade(truth, canvas, read) {
    const found = [];
    if (read) {
      for (const note of notesInOrder(read)) {
        found.push({ x: note.x * canvas.width, y: note.y * canvas.height, beams: note.beams });
      }
    }
    const near = Math.max(6, canvas.width / 160);
    const taken = new Set();
    let matched = 0;
    let rightBeams = 0;
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
    }
    return {
      drawn: truth.length,
      found: found.length,
      matched,
      spurious: found.length - matched,
      rightBeams,
      recall: +(matched / truth.length).toFixed(3),
      beamAccuracy: matched ? +(rightBeams / matched).toFixed(3) : 0,
      // What matters end to end: of every note on the page, how many were both
      // found AND given the right value.
      overall: +(rightBeams / truth.length).toFixed(3),
    };
  }

  // --- the conditions ------------------------------------------------------
  const CONDITIONS = {
    clean: { draw: {}, spoil: {} },
    small: { draw: { space: 10 }, spoil: {} },
    tiny: { draw: { space: 8 }, spoil: {} },
    blurred: { draw: {}, spoil: { blur: 1.1 } },
    faint: { draw: {}, spoil: { contrast: 0.55, tint: [214, 196, 160] } },
    jpeg: { draw: {}, spoil: { jpeg: 0.5 } },
    tilted: { draw: { tilt: 0.006 }, spoil: {} },
    creased: { draw: { warp: 0.9 }, spoil: {} },
    shrunk: { draw: { space: 20 }, spoil: { scale: 0.55 } },
    // Everything at once, which is what a photograph of a page actually is.
    photograph: {
      draw: { space: 18, warp: 0.7, tilt: 0.004 },
      spoil: { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 },
    },
  };

  const out = {};
  for (const [name, recipe] of Object.entries(CONDITIONS)) {
    if (pick.length && !pick.includes(name)) continue;
    const { canvas, truth } = drawPage(recipe.draw);
    const spoiled = await spoil(canvas, recipe.spoil);
    // Truth positions move with the page when it is scaled.
    const s = spoiled.width / canvas.width;
    const moved = truth.map((t) => ({ ...t, x: t.x * s, y: t.y * s }));
    let read = null;
    try { read = readPage(spoiled, spoiled.width, spoiled.height); } catch (e) { read = null; }
    out[name] = {
      ...grade(moved, spoiled, read),
      staves: read?.staves.length ?? 0,
      wantStaves: recipe.draw.systems ?? 6,
      size: `${spoiled.width}x${spoiled.height}`,
      space: read ? Math.round(read.space * spoiled.height * 10) / 10 : null,
    };
  }
  return out;
}, only);

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const names = Object.keys(report);
  const pad = Math.max(...names.map((n) => n.length));
  console.log(`\n${'condition'.padEnd(pad)}  staves  recall  beams   overall   found/drawn  spurious`);
  for (const [name, r] of Object.entries(report)) {
    console.log(
      `${name.padEnd(pad)}  ${String(r.staves).padStart(2)}/${r.wantStaves}`
      + `    ${String(Math.round(r.recall * 100)).padStart(3)}%`
      + `    ${String(Math.round(r.beamAccuracy * 100)).padStart(3)}%`
      + `    ${String(Math.round(r.overall * 100)).padStart(3)}%`
      + `      ${String(r.found).padStart(3)}/${r.drawn}`
      + `      ${r.spurious}`,
    );
  }
  const overall = Object.values(report).reduce((a, r) => a + r.overall, 0) / names.length;
  console.log(`\nmean overall: ${Math.round(overall * 100)}%`);
}
if (errors.length) console.log('\nerrors:', errors.slice(0, 4).join(' | '));
await browser.close();
