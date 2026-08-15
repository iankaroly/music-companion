// Clefs, graded against a camera.
//
// The unit tests in tests/scan-clef.test.js prove the RULES: ink this far above
// the stave is a treble, ink stopping short of the bottom line is a bass. What
// they cannot prove is that a photograph still presents those extents — a blur
// wide enough to close the gap between a bass clef's two dots is a blur that may
// also drag its ink below the line it is supposed to stop at.
//
// So the pages here carry real Bravura, spoiled exactly the way scan-corpus.mjs
// spoils its pages, and the classifier is asked what it sees. This is the first
// honest test of whether reading a page by rule transfers off a drawing, and it
// is deliberately early: if clefs misread here, the whole hand-written route
// plateaus sooner than planned and a learned classifier comes forward.
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
const wantJson = process.argv.includes('--json');

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
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
    { name: 'tenor', glyph: glyph.cClef, anchor: anchor.cClefTenor },
  ];

  // One system: five lines, an opening barline, and a clef sitting on the line
  // it names. Bent and tilted like every other photographed page in the suite.
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
    g.fillRect(x0, lineY(0, x0), Math.max(1.4, space * 0.12), space * 4);
    // Bravura is designed so one em is one stave — four spaces.
    g.font = `${space * 4}px BravuraTest`;
    g.textBaseline = 'alphabetic';
    g.fillText(kind.glyph, x0 + space * 0.7, lineY(kind.anchor, x0 + space));
  }

  async function spoil(source, { blur = 0, contrast = 1, tint = null, jpeg = null, scale = 1 }) {
    const W = Math.round(source.width * scale);
    const H = Math.round(source.height * scale);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
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
    out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    bmp.close?.();
    return out;
  }

  // The clef zone off the SPOILED page: the band just right of the opening
  // barline, three staff spaces above the stave and three below it.
  const MARGIN = 3;
  function columnAt(canvas, { x, width, top, space }) {
    const w = Math.max(2, Math.round(width));
    const rows = Math.round(space * (4 + MARGIN * 2));
    const y0 = Math.round(top - MARGIN * space);
    const clampedY = Math.max(0, y0);
    const clampedRows = Math.min(rows, canvas.height - clampedY);
    if (clampedRows < 4) return new Float32Array(rows);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const data = g.getImageData(Math.max(0, Math.round(x)), clampedY, w, clampedRows).data;
    const out = new Float32Array(rows);
    for (let r = 0; r < clampedRows; r++) {
      let inked = 0;
      for (let cx = 0; cx < w; cx++) {
        const i = (r * w + cx) * 4;
        const grey = (data[i] + data[i + 1] + data[i + 2]) / 3;
        if (grey < 150) inked++;
      }
      // Offset by however much the top was clipped, so a stave near the edge
      // still reports its extents against the same origin.
      out[r + (clampedY - y0)] = inked / w;
    }
    return out;
  }

  const SPOILS = {
    clean: { scale: 1 },
    blurred: { blur: 1.1, scale: 1 },
    faint: { contrast: 0.55, tint: [214, 196, 160], scale: 1 },
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
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const tops = [];
    const x0 = space * 3;
    for (const [i, kind] of KINDS.entries()) {
      const top = space * 4 + i * gap;
      tops.push(top);
      drawSystem(g, { space, x0, W, top, kind, warp: 0.7, tilt: 0.004 });
    }
    const shot = await spoil(c, spoilOpts);
    const s = spoilOpts.scale ?? 1;
    for (const [i, kind] of KINDS.entries()) {
      // The stave bends, so the zone's top is the drawn top plus the bend at
      // the x the clef sits at — the same arithmetic the drawing used.
      const bend = 0.7 * space * Math.sin(((x0 + space) / W) * Math.PI);
      const tiltHere = 0.004 * ((x0 + space) - W / 2);
      const col = columnAt(shot, {
        x: (x0 + space * 0.35) * s,
        width: Math.max(4, space * 3.8 * s),
        top: (tops[i] + bend + tiltHere) * s,
        space: space * s,
      });
      const features = clefFeatures(col, space * s);
      const got = classifyClef(features);
      results.push({
        spoil: spoilName,
        want: kind.name,
        got: got.clef,
        confidence: +got.confidence.toFixed(2),
        top: features ? +features.top.toFixed(2) : null,
        bottom: features ? +features.bottom.toFixed(2) : null,
        symmetry: features ? +features.symmetry.toFixed(2) : null,
      });
    }
  }
  // --- and now through readPage itself ---------------------------------
  //
  // Everything above measures the classifier against a column this file sampled
  // for it. That proves the rules and not the plumbing, and the plumbing is
  // where a feature quietly does nothing: readPage has to find the stave, find
  // its opening barline, sample the zone beside it and hang the answer on the
  // stave. Asked here end to end, because a clef nothing reads is a clef.
  const { readPage } = await import('/tools/.scan-read-fix.js');
  const endToEnd = [];
  for (const kind of KINDS) {
    const space = 18;
    const W = 1200;
    const gap = space * 14;
    const systems = 4;
    const H = Math.round(space * 8 + systems * gap);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const x0 = space * 3;
    for (let sys = 0; sys < systems; sys++) {
      const top = space * 4 + sys * gap;
      drawSystem(g, { space, x0, W, top, kind, warp: 0.7, tilt: 0.004 });
      // Notes, so the stave is a stave and not a bare grid.
      const bendAt = (x) => 0.7 * space * Math.sin((x / W) * Math.PI);
      const lineY = (l, x) => top + l * space + bendAt(x) + 0.004 * (x - W / 2);
      g.fillStyle = '#111';
      for (let n = 0; n < 14; n++) {
        const x = x0 + space * 8 + n * space * 3;
        const y = lineY(4, x) - ((n + sys) % 8) * space / 2;
        g.save(); g.translate(x, y); g.rotate(-0.28);
        g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
        g.fill(); g.restore();
        g.fillRect(x + space * 0.55, y - space * 3.2, Math.max(1.3, space * 0.11), space * 3.2);
      }
    }
    const shot = await spoil(c, { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 });
    let read = null;
    try { read = readPage(shot, shot.width, shot.height); } catch { read = null; }
    const clefs = (read?.staves ?? []).map((s) => s.clef);
    endToEnd.push({
      want: kind.name,
      staves: clefs.length,
      clefs,
      right: clefs.filter((cl) => cl === kind.name).length,
    });
  }

  return { results, endToEnd };
}, { glyph: GLYPH, anchor: CLEF_ANCHOR, fontBase64 });

await browser.close();

const { results: graded, endToEnd } = report;

if (wantJson) {
  console.log(JSON.stringify({ results: graded, endToEnd, errors }, null, 2));
} else {
  console.log('\nCLEFS — real Bravura, spoiled the way a camera spoils a page\n');
  console.log('spoiling         want     read     conf    top   bottom   sym');
  let right = 0;
  for (const r of graded) {
    if (r.want === r.got) right++;
    console.log(
      `${r.spoil.padEnd(16)} ${r.want.padEnd(8)} ${String(r.got).padEnd(8)} `
      + `${String(r.confidence).padStart(4)}  ${String(r.top).padStart(5)}  `
      + `${String(r.bottom).padStart(6)}  ${String(r.symmetry).padStart(4)}`
      + `${r.want === r.got ? '' : '   <-- WRONG'}`,
    );
  }
  console.log(`\n${right}/${graded.length} read correctly\n`);
  console.log('THROUGH readPage — a photographed page, four systems, end to end\n');
  console.log('want     staves  clefs read                       right');
  for (const e of endToEnd) {
    console.log(
      `${e.want.padEnd(8)} ${String(e.staves).padStart(4)}    `
      + `${e.clefs.map((c) => String(c)).join(' ').padEnd(30)} ${e.right}/${e.staves}`,
    );
  }
  console.log('');
  if (errors.length) console.log('page errors:', errors);
}
