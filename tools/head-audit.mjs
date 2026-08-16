// Which of the noteheads found are not noteheads, and what would tell them apart.
//
// The reader finds about thirty per cent more heads on a photograph than the
// page has notes on it, and a count cannot say which thirty per cent. Two
// filters have been proposed for this and neither was ever measured; one of them
// was applied on a hunch and collapsed the page from 477 heads to 190.
//
// So this measures. It draws pages whose every notehead is known, spoils them
// the way a camera does, runs the shipped reader, and matches what came back
// against what was drawn. Then for each candidate DISCRIMINATOR it reports the
// only two numbers that matter: how many true heads it would keep, and how many
// false ones it would throw away.
//
// WHAT IT FOUND, so nobody proposes the residual a third time
//
// It does not work. Real heads on a photographed page have a median residual of
// 0.19-0.22 and false ones 0.28-0.35, and the distributions overlap almost
// completely. Every threshold is a bad trade:
//
//   cut 0.15   keeps 42% of real notes, rejects 74% of false
//   cut 0.25   keeps 71% of real notes, rejects 54% of false
//   cut 0.35   keeps 88% of real notes, rejects 31% of false
//
// A filter that throws away a quarter of the notes somebody played, to remove
// half the marks that were never notes, is worse than the problem. The reason is
// visible in the number itself: on a page that is warped, blurred and downscaled,
// a REAL head's centre is already a fifth of a half-space off the ideal grid.
// That is the noise floor, and the signal is smaller than it.
//
// THE DISCRIMINATOR THIS EXISTS FOR
//
// A notehead sits centred on a line or in a space. The reader already computes
// that — `step` is Math.round((bottom - head.y) / (space / 2)) — and throws the
// remainder away. A head that is really there rounds by almost nothing; ink that
// is a stem crossing a beam sits wherever the beam happens to be. If that is
// true the residual separates them, and if it is not this file says so, which is
// a perfectly good answer and cheaper than finding out in production.
//
//   npm run scan:heads-audit
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
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  // A page of beamed groups, with every head's position recorded as it is drawn.
  function drawPage({ space = 18, systems = 6, sysGap = 16, warp = 0.7, tilt = 0.004, plan }) {
    const layouts = [];
    for (let sys = 0; sys < systems; sys++) layouts.push(plan(sys));
    const noteGap = 2.2; const gapSpaces = 6.6;
    const spans = layouts.map((units) => units.reduce(
      (a, u, i) => a + (u.steps.length - 1) * noteGap + (i ? gapSpaces : 0), 0,
    ));
    const W = Math.round(space * Math.max(50, 12 + Math.max(...spans)));
    const H = Math.round(space * 12 + systems * space * sysGap + space * 8);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const truth = [];
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
      let cursor = space * 6;
      for (const unit of layouts[sys]) {
        const n = unit.steps.length;
        const xs = []; const ys = [];
        for (let i = 0; i < n; i++) {
          const x = cursor + i * space * noteGap;
          const y = lineY(4, x) - unit.steps[i] * space / 2;
          xs.push(x); ys.push(y);
          g.save(); g.translate(x, y); g.rotate(-0.28);
          g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
          g.fillStyle = '#111'; g.fill(); g.restore();
          truth.push({ x, y });
        }
        g.fillStyle = '#111';
        const stemW = Math.max(1.3, space * 0.11);
        const sx = (i) => xs[i] + space * 0.55;
        const rise = (ys[n - 1] - ys[0]) * 0.5;
        const at = (i) => rise * (n > 1 ? i / (n - 1) : 0);
        const yBase = Math.min(...ys.map((y, i) => y - at(i))) - space * 3.2;
        const beamY = (i) => yBase + at(i);
        for (let i = 0; i < n; i++) {
          const end = beamY(i);
          g.fillRect(sx(i), Math.min(ys[i], end), stemW, Math.abs(ys[i] - end));
        }
        const t = Math.max(1.8, space * 0.5);
        for (let bm = 0; bm < unit.beams; bm++) {
          const off = bm * space * 0.75;
          g.beginPath();
          g.moveTo(sx(0), beamY(0) + off);
          g.lineTo(sx(n - 1) + stemW, beamY(n - 1) + off);
          g.lineTo(sx(n - 1) + stemW, beamY(n - 1) + off + t);
          g.lineTo(sx(0), beamY(0) + off + t);
          g.closePath(); g.fillStyle = '#111'; g.fill();
        }
        cursor += (n - 1) * space * noteGap + space * gapSpaces;
      }
    }
    return { canvas: c, truth };
  }

  async function spoil(source, { blur = 1.0, contrast = 0.6, tint = [212, 194, 158], jpeg = 0.6, scale = 0.62 }) {
    const W = Math.round(source.width * scale);
    const H = Math.round(source.height * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.filter = `blur(${blur}px) contrast(${contrast})`;
    g.drawImage(source, 0, 0, W, H);
    g.filter = 'none';
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `rgba(${tint.join(',')},0.42)`);
    grad.addColorStop(1, `rgba(${tint.join(',')},0.12)`);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    const blob = await new Promise((d) => c.toBlob(d, 'image/jpeg', jpeg));
    const bmp = await createImageBitmap(blob);
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    bmp.close?.();
    return out;
  }

  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  const PAGES = {
    ordinary: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
      beams: 1 + ((sys + grp) % 3), steps: rising(grp),
    })),
    dense: (sys) => Array.from({ length: 9 }, (_, grp) => ({
      beams: 2, steps: rising(grp + sys),
    })),
  };

  const rows = [];
  for (const [name, plan] of Object.entries(PAGES)) {
    const drawn = drawPage({ plan });
    const shot = await spoil(drawn.canvas, {});
    const scale = shot.width / drawn.canvas.width;
    const read = readPage(shot, shot.width, shot.height);
    if (!read) { rows.push({ name, failed: true }); continue; }

    // Every head, with the residual it rounded away when its step was taken.
    const found = [];
    for (const [i, staff] of read.staves.entries()) {
      const space = staff.space * shot.height;
      const bottomAt = (x) => staff.lines[4][
        Math.min(staff.lines[4].length - 1,
          Math.max(0, Math.round((x / shot.width) * (staff.lines[4].length - 1))))
      ] * shot.height;
      for (const head of staff.heads) {
        const px = head.x * shot.width;
        const py = head.y * shot.height;
        const exact = (bottomAt(px) - py) / (space / 2);
        found.push({ x: px, y: py, staff: i, residual: Math.abs(exact - Math.round(exact)) });
      }
    }

    // Matched to what was drawn, in the spoiled page's own pixels.
    const near = Math.max(6, shot.width / 160);
    const truth = drawn.truth.map((t) => ({ x: t.x * scale, y: t.y * scale, taken: false }));
    for (const f of found) {
      let best = -1; let gap = Infinity;
      for (const [j, t] of truth.entries()) {
        if (t.taken) continue;
        const d = Math.hypot(t.x - f.x, t.y - f.y);
        if (d < near && d < gap) { gap = d; best = j; }
      }
      if (best >= 0) { truth[best].taken = true; f.real = true; } else { f.real = false; }
    }

    const real = found.filter((f) => f.real);
    const fake = found.filter((f) => !f.real);
    const cut = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.45];
    rows.push({
      name,
      drawn: drawn.truth.length,
      found: found.length,
      real: real.length,
      fake: fake.length,
      medianRealResidual: real.length
        ? +real.map((f) => f.residual).sort((a, b) => a - b)[Math.floor(real.length / 2)].toFixed(3) : null,
      medianFakeResidual: fake.length
        ? +fake.map((f) => f.residual).sort((a, b) => a - b)[Math.floor(fake.length / 2)].toFixed(3) : null,
      thresholds: cut.map((c) => ({
        cut: c,
        keepReal: real.length ? +(real.filter((f) => f.residual <= c).length / real.length).toFixed(3) : 0,
        rejectFake: fake.length ? +(fake.filter((f) => f.residual > c).length / fake.length).toFixed(3) : 0,
      })),
    });
  }
  return rows;
});

await browser.close();

if (wantJson) {
  console.log(JSON.stringify({ rows: report, errors }, null, 2));
} else {
  console.log('\nHEADS AUDIT — every notehead matched against what was drawn\n');
  for (const r of report) {
    if (r.failed) { console.log(`${r.name}: the reader found no stave`); continue; }
    console.log(`${r.name}: ${r.found} found · ${r.real} real of ${r.drawn} drawn · ${r.fake} false`);
    console.log(`  median residual — real ${r.medianRealResidual}   false ${r.medianFakeResidual}`);
    console.log('  cut    keeps real   rejects false');
    for (const t of r.thresholds) {
      console.log(`  ${t.cut.toFixed(2)}   ${(t.keepReal * 100).toFixed(1).padStart(8)}%   `
        + `${(t.rejectFake * 100).toFixed(1).padStart(11)}%`);
    }
    console.log('');
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 3));
}
