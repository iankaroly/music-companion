// THROWAWAY PROBE — delete when done.
// Replicates readPage's pipeline, re-implements findHeads with per-gate
// instrumentation, verifies parity against the real reader, then reports which
// gate rejects each MISSED truth notehead.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const OUT = process.env.OUT ?? '/private/tmp/claude-501/-Users-iankaroly/3cf48b2a-5a9c-4612-b149-47b748b870f7/scratchpad';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const which = process.argv[2] ?? 'minims';
const gate = process.argv[3] ?? 'shipped';

const result = await page.evaluate(async ({ WHICH, GATE }) => {
  window.__GATE = GATE;
  const M = await import('/src/analysis/scan-read.js');
  const { readPage, combPeaks, trackCombs, fillMissedStaves, stavesToLines, beamMask } = M;
  const WORK_WIDTH = 1400;
  const STRIPS = 40;

  // ---- copies of the private helpers in scan-read.js -----------------------
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
  function pageScale(ink, w, h) {
    const black = new Array(40).fill(0);
    const white = new Array(80).fill(0);
    for (let x = 0; x < w; x += 2) {
      let run = 0; let colour = 0;
      for (let y = 0; y < h; y++) {
        const v = ink[y * w + x];
        if (v === colour) { run++; continue; }
        const table = colour ? black : white;
        if (run > 0 && run < table.length) table[run]++;
        colour = v; run = 1;
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

  // ---- findHeads, instrumented --------------------------------------------
  // Byte-for-byte the shipped logic, plus a `why` recorder keyed by pixel.
  function findHeadsProbe(ink, w, h, staff, space, gray, background, probeAt) {
    const hw = Math.max(2, Math.round(space * 0.62));
    const hh = Math.max(2, Math.round(space * 0.45));
    const inside = []; const rim = []; const core = [];
    for (let dy = -hh; dy <= hh; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const d = (dx / hw) ** 2 + (dy / hh) ** 2;
        if (d <= 1) inside.push([dx, dy]);
        if (d >= 0.62 && d <= 1.3) rim.push([dx, dy]);
        if (d <= 0.25) core.push([dx, dy]);
      }
    }
    const ringPts = [];
    for (let dx = -hw; dx <= hw; dx += 2) {
      ringPts.push([dx, -hh - Math.round(space * 0.5)]);
      ringPts.push([dx, hh + Math.round(space * 0.5)]);
    }
    const reach = space * 7;
    const top = Math.max(hh + 1, Math.round(staff.lines[0].mid - reach));
    const bottom = Math.min(h - hh - 2, Math.round(staff.lines[4].mid + reach));
    const scored = [];
    const notes = new Map();          // "x,y" -> diagnostic record
    for (let y = top; y <= bottom; y++) {
      for (let x = hw + 1; x < w - hw - 1; x++) {
        const key = `${x},${y}`;
        const watch = probeAt.has(key);
        const rec = watch ? { x, y, hw, hh, space } : null;
        if (rec) notes.set(key, rec);
        const solidCentre = ink[y * w + x];
        const leftProbe = ink[y * w + x - hw];
        const rightProbe = ink[y * w + x + hw];
        if (rec) Object.assign(rec, { solidCentre, leftProbe, rightProbe });
        let pass = solidCentre || (leftProbe && rightProbe);
        if (!pass && window.__GATE === 'band') {
          const lo = Math.max(1, Math.round(hw * 0.7));
          let l = 0; let r = 0;
          for (let k = lo; k <= hw; k++) { if (ink[y * w + x - k]) l = 1; if (ink[y * w + x + k]) r = 1; }
          pass = !!(l && r);
        }
        if (!pass) {
          if (rec) rec.died = 'candidate-gate';
          continue;
        }
        let filled = 0;
        for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
        const fill = filled / inside.length;
        if (rec) rec.fill = +fill.toFixed(3);
        let solid = fill >= 0.86;
        let hollow = false;
        if (!solid && fill >= 0.3 && fill <= 0.82) {
          let rimInk = 0;
          for (const [dx, dy] of rim) rimInk += ink[(y + dy) * w + x + dx];
          let coreInk = 0;
          for (const [dx, dy] of core) coreInk += ink[(y + dy) * w + x + dx];
          let paper = 0;
          for (const [dx, dy] of core) {
            const at = (y + dy) * w + x + dx;
            if (gray[at] >= background[at] - 6) paper += 1;
          }
          const isRing = (rimInk / rim.length) >= 0.68 && (coreInk / core.length) <= 0.42;
          hollow = isRing && (paper / core.length) >= 0.7;
          if (rec) Object.assign(rec, {
            rimFrac: +(rimInk / rim.length).toFixed(3),
            coreFrac: +(coreInk / core.length).toFixed(3),
            paperFrac: +(paper / core.length).toFixed(3),
          });
          if (isRing && !hollow) solid = true;
        } else if (rec) {
          rec.fillWindow = fill < 0.3 ? 'below-0.3' : (fill > 0.82 ? 'above-0.82' : 'solid');
        }
        if (rec) Object.assign(rec, { solid, hollow });
        if (!solid && !hollow) { if (rec) rec.died = rec.died ?? 'not-solid-not-ring'; continue; }
        let across = 1;
        for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
        for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
        if (rec) { rec.across = across; rec.acrossLimit = +(space * 2.6).toFixed(2); }
        if (across > space * 2.6) { if (rec) rec.died = 'across'; continue; }
        let clear = 0;
        for (const [dx, dy] of ringPts) {
          const yy = y + dy;
          if (yy < 0 || yy >= h || !ink[yy * w + x + dx]) clear++;
        }
        const open = clear / ringPts.length;
        if (rec) rec.open = +open.toFixed(3);
        if (open < 0.45) { if (rec) rec.died = 'open'; continue; }
        if (rec) rec.died = null;
        const quality = solid ? fill : 0.86;
        scored.push({ x, y, score: quality + open, hollow });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const point of scored) {
      if (kept.some((k) => Math.abs(k.x - point.x) < space * 1.1
        && Math.abs(k.y - point.y) < space * 0.9)) continue;
      kept.push(point);
    }
    return { heads: kept.sort((a, b) => a.x - b.x), notes, all: scored };
  }

  // ---- the corpus page drawer (subset) ------------------------------------
  function drawPage({
    space = 14, systems = 6, sysGap = 16, warp = 0, tilt = 0,
    gapSpaces = 6.6, noteGap = 2.2, plan,
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
      for (const at of [space * 3, W - space * 3]) {
        g.fillRect(at, lineY(0, at), Math.max(1.4, space * 0.12), space * 4);
      }
      let cursor = space * 6;
      let first = true;
      for (const unit of layouts[sys]) {
        if (!first) cursor += space * ((unit.gapBefore ?? gapSpaces) - gapSpaces);
        first = false;
        const n = unit.steps.length;
        const dir = unit.dir ?? -1;
        const xs = []; const ys = [];
        for (let i = 0; i < n; i++) {
          const x = cursor + i * space * noteGap;
          const y = lineY(4, x) - unit.steps[i] * space / 2;
          xs.push(x); ys.push(y);
          g.save(); g.translate(x, y); g.rotate(-0.28);
          if (unit.hollow) {
            g.beginPath(); g.ellipse(0, 0, space * 0.66, space * 0.5, 0, 0, Math.PI * 2);
            g.fillStyle = '#111'; g.fill();
            g.beginPath(); g.ellipse(0, 0, space * 0.44, space * 0.3, 0, 0, Math.PI * 2);
            g.fillStyle = '#fff'; g.fill();
          } else {
            g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
            g.fillStyle = '#111'; g.fill();
          }
          g.restore();
          truth.push({ x, y, beams: unit.beams, step: unit.steps[i], sys });
        }
        g.fillStyle = '#111';
        const stemW = Math.max(1.3, space * 0.11);
        const sx = (i) => xs[i] + (dir < 0 ? space * 0.55 : -space * 0.55);
        if (unit.stem === false) {
          // semibreve
        } else if (unit.beams === 0 || n === 1) {
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
            const x1 = sx(0); const x2 = sx(n - 1) + stemW;
            const y1 = beamY(0) + off; const y2 = beamY(n - 1) + off;
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
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
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

  const up = -1;
  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };
  const PHOTO_DRAW = { space: 18, warp: 0.7, tilt: 0.004 };
  const RECIPES = {
    minims: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up, hollow: true })) },
      spoil: {},
    },
    noBeamsPhoto: {
      draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) },
      spoil: PHOTO,
    },
    noBeams: {
      draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
        beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) },
      spoil: {},
    },
    creased: { draw: { warp: 0.9, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
      beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up })) }, spoil: {} },
  };

  const recipe = RECIPES[WHICH];
  const { canvas, truth } = drawPage(recipe.draw);
  const spoiled = await spoil(canvas, recipe.spoil);
  const s = spoiled.width / canvas.width;
  const moved = truth.map((t) => ({ ...t, x: t.x * s, y: t.y * s }));

  // ---- rebuild readPage's pipeline exactly --------------------------------
  const nw = spoiled.width; const nh = spoiled.height;
  const w = Math.min(WORK_WIDTH, nw);
  const h = Math.round(nh * (w / nw));
  const work = document.createElement('canvas');
  work.width = w; work.height = h;
  work.getContext('2d', { willReadFrequently: true }).drawImage(spoiled, 0, 0, w, h);
  const gray = toGray(work);
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
  const { space, pitch } = pageScale(ink, w, h);
  const stripW = Math.max(1, Math.floor(w / STRIPS));
  const profiles = [];
  for (let st = 0; st < STRIPS; st++) {
    const x0 = st * stripW; const x1 = Math.min(w, x0 + stripW);
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
  const body = beamMask(ink, w, h, space);

  // truth positions in WORK coordinates
  const kx = w / nw; const ky = h / nh;
  const truthWork = moved.map((t) => ({ ...t, wx: t.x * kx, wy: t.y * ky }));

  // Probe every integer pixel within 2px of each truth centre, so a head whose
  // true centre lands between pixels is still described.
  const probeAt = new Set();
  const probeOwner = new Map();
  for (const [i, t] of truthWork.entries()) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const k = `${Math.round(t.wx) + dx},${Math.round(t.wy) + dy}`;
        probeAt.add(k);
        if (!probeOwner.has(k)) probeOwner.set(k, i);
      }
    }
  }

  const perStaff = staves.map((staff) => findHeadsProbe(
    body, w, h, staff, staff.space, gray, background, probeAt,
  ));

  // ---- parity check against the real reader -------------------------------
  const real = readPage(spoiled, nw, nh);
  const realHeads = [];
  for (const st of (real?.staves ?? [])) {
    for (const hd of st.heads) realHeads.push({ x: hd.x * w, y: hd.y * h });
  }
  const mineHeads = [];
  for (const r of perStaff) for (const hd of r.heads) mineHeads.push({ x: hd.x, y: hd.y, hollow: hd.hollow });
  let parity = 0;
  const usedReal = new Set();
  for (const m of mineHeads) {
    const i = realHeads.findIndex((r, k) => !usedReal.has(k)
      && Math.abs(r.x - m.x) < 0.75 && Math.abs(r.y - m.y) < 0.75);
    if (i >= 0) { usedReal.add(i); parity += 1; }
  }

  // ---- which truth heads were found, and why the rest were not ------------
  const near = Math.max(6, spoiled.width / 160) * kx;
  const takenHead = new Set();
  const rows = [];
  for (const [i, t] of truthWork.entries()) {
    let best = -1; let bestGap = Infinity;
    for (const [k, m] of mineHeads.entries()) {
      if (takenHead.has(k)) continue;
      const gap = Math.hypot(m.x - t.wx, m.y - t.wy);
      if (gap < near && gap < bestGap) { bestGap = gap; best = k; }
    }
    if (best >= 0) takenHead.add(best);
    // the best diagnostic among the 5x5 pixels around this truth centre
    const cands = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const k = `${Math.round(t.wx) + dx},${Math.round(t.wy) + dy}`;
        if (probeOwner.get(k) !== i) continue;
        for (const r of perStaff) if (r.notes.has(k)) cands.push(r.notes.get(k));
      }
    }
    const alive = cands.filter((c) => c.died === null);
    const order = ['candidate-gate', 'not-solid-not-ring', 'across', 'open'];
    const deepest = cands.slice().sort((a, b) => order.indexOf(b.died) - order.indexOf(a.died))[0];
    rows.push({
      i, step: t.step, sys: t.sys,
      wx: +t.wx.toFixed(2), wy: +t.wy.toFixed(2),
      found: best >= 0,
      probed: cands.length,
      passing: alive.length,
      deepest: deepest ? {
        died: deepest.died, solidCentre: deepest.solidCentre,
        leftProbe: deepest.leftProbe, rightProbe: deepest.rightProbe,
        fill: deepest.fill, rimFrac: deepest.rimFrac, coreFrac: deepest.coreFrac,
        paperFrac: deepest.paperFrac, across: deepest.across, acrossLimit: deepest.acrossLimit,
        open: deepest.open, hw: deepest.hw, hh: deepest.hh, space: +deepest.space.toFixed(2),
      } : null,
      // how many of the 25 probed pixels cleared the candidate gate at all
      gatePassed: cands.filter((c) => c.died !== 'candidate-gate').length,
    });
  }

  // ---- overlay image -------------------------------------------------------
  const view = document.createElement('canvas');
  view.width = w; view.height = h;
  const vg = view.getContext('2d');
  vg.drawImage(spoiled, 0, 0, w, h);
  vg.globalAlpha = 1;
  for (const m of mineHeads) {
    vg.strokeStyle = m.hollow ? '#0a0' : '#00f';
    vg.lineWidth = 1.4;
    vg.beginPath(); vg.arc(m.x, m.y, space * 0.95, 0, Math.PI * 2); vg.stroke();
  }
  for (const r of rows) {
    if (r.found) continue;
    vg.strokeStyle = '#f00'; vg.lineWidth = 2;
    vg.beginPath();
    vg.moveTo(r.wx - space, r.wy - space); vg.lineTo(r.wx + space, r.wy + space);
    vg.moveTo(r.wx + space, r.wy - space); vg.lineTo(r.wx - space, r.wy + space);
    vg.stroke();
  }

  return {
    which: WHICH, w, h, space, pitch,
    staves: staves.length, realStaves: real?.staves.length ?? 0,
    truth: truthWork.length,
    mine: mineHeads.length, real: realHeads.length, parity,
    rows,
    png: view.toDataURL('image/png'),
  };
}, { WHICH: which, GATE: gate });

const { png, rows, ...summary } = result;
fs.writeFileSync(`${OUT}/probe-${which}-${gate}.png`, Buffer.from(png.split(',')[1], 'base64'));
console.log(JSON.stringify(summary, null, 2));
console.log('\nPER-TRUTH-NOTE');
console.log('idx sys step  found  probed gatePass pass  died                 detail');
for (const r of rows) {
  const d = r.deepest ?? {};
  console.log(
    `${String(r.i).padStart(3)} ${String(r.sys).padStart(3)} ${String(r.step).padStart(4)}`
    + `  ${r.found ? 'YES' : 'no '}   ${String(r.probed).padStart(3)}   ${String(r.gatePassed).padStart(3)}`
    + `    ${String(r.passing).padStart(3)}  ${String(d.died ?? '-').padEnd(20)}`
    + ` c=${d.solidCentre ?? '-'} L=${d.leftProbe ?? '-'} R=${d.rightProbe ?? '-'}`
    + ` fill=${d.fill ?? '-'} rim=${d.rimFrac ?? '-'} core=${d.coreFrac ?? '-'}`
    + ` paper=${d.paperFrac ?? '-'} across=${d.across ?? '-'}/${d.acrossLimit ?? '-'} open=${d.open ?? '-'}`,
  );
}
const missed = rows.filter((r) => !r.found);
console.log(`\nMISSED ${missed.length}/${rows.length}`);
const by = {};
for (const r of missed) by[r.deepest?.died ?? 'none-probed'] = (by[r.deepest?.died ?? 'none-probed'] ?? 0) + 1;
console.log('missed by deepest gate reached:', JSON.stringify(by));
const byStep = {};
for (const r of missed) byStep[r.step] = (byStep[r.step] ?? 0) + 1;
console.log('missed by step:', JSON.stringify(byStep));
if (errors.length) console.log('\nerrors:', errors.slice(0, 5).join(' | '));
await browser.close();
