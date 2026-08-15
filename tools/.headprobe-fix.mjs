// throwaway probe: which noteheads are missed, and which gate rejects them.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const WHICH = process.argv[2] ?? 'minims';
const OUT = '/private/tmp/claude-501/-Users-iankaroly/3cf48b2a-5a9c-4612-b149-47b748b870f7/scratchpad';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async (WHICH) => {
  const { readPage, notesInOrder, beamMask } = await import('/tools/.scan-read-fix.js');

  // ---- drawPage, copied verbatim from tools/scan-corpus.mjs ----
  function drawPage({ space = 14, systems = 6, sysGap = 16, warp = 0, tilt = 0,
    gapSpaces = 6.6, noteGap = 2.2, plan }) {
    const layouts = [];
    for (let sys = 0; sys < systems; sys++) layouts.push(plan(sys));
    const spans = layouts.map((units) => units.reduce(
      (a, u, i) => a + (u.steps.length - 1) * noteGap + (i ? (u.gapBefore ?? gapSpaces) : 0), 0));
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
          truth.push({ x, y, beams: unit.beams, step: unit.steps[i], sys, hollow: !!unit.hollow });
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
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
            g.lineTo(x2, y2 + t); g.lineTo(x1, y1 + t);
            g.closePath(); g.fillStyle = '#111'; g.fill();
          }
        }
        cursor += (n - 1) * space * noteGap + space * gapSpaces;
      }
    }
    return { canvas: c, truth };
  }

  async function spoil(source, { blur = 0, contrast = 1, tint = null, jpeg = null, scale = 1 } = {}) {
    const W = Math.round(source.width * scale); const H = Math.round(source.height * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
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
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    out.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return out;
  }

  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };
  const PHOTO_DRAW = { space: 18, warp: 0.7, tilt: 0.004 };
  const PAGES = {
    minims: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [(grp * 3 + sys) % 8], dir: -1, hollow: true })) }, spoil: {} },
    // same page but every head solid — the control
    minimsSolid: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [(grp * 3 + sys) % 8], dir: -1 })) }, spoil: {} },
    // semibreves: hollow, no stem
    semibreves: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [(grp * 3 + sys) % 8], dir: -1, hollow: true, stem: false })) }, spoil: {} },
    // hollow heads on ledger lines high above the stave
    minimsHigh: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [10 + ((grp * 2 + sys) % 8)], dir: 1, hollow: true })) }, spoil: {} },
    solidHigh: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [10 + ((grp * 2 + sys) % 8)], dir: 1 })) }, spoil: {} },
    noBeams: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [(grp * 3 + sys) % 8], dir: -1 })) }, spoil: {} },
    noBeamsPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({
      beams: 0, steps: [(grp * 3 + sys) % 8], dir: -1 })) }, spoil: PHOTO },
    downStems: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
      beams: 1 + ((sys + grp) % 3),
      steps: [8, 10, 12, 8].map((s) => s - (grp % 3)), dir: 1 })) }, spoil: {} },
    clean: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({
      beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: -1 })) }, spoil: {} },
  };

  const recipe = PAGES[WHICH];
  const { canvas, truth } = drawPage(recipe.draw);
  const spoiled = await spoil(canvas, recipe.spoil);
  const s = spoiled.width / canvas.width;
  const moved = truth.map((t) => ({ ...t, x: t.x * s, y: t.y * s }));
  const read = readPage(spoiled, spoiled.width, spoiled.height);

  const found = [];
  if (read) for (const n of notesInOrder(read)) {
    found.push({ x: n.x * spoiled.width, y: n.y * spoiled.height, beams: n.beams, step: n.step });
  }

  // match, exactly as grade() does
  const near = Math.max(6, spoiled.width / 160);
  const taken = new Set();
  const matchOf = new Array(moved.length).fill(null);
  for (const f of found) {
    let best = -1; let bestGap = Infinity;
    for (const [i, t] of moved.entries()) {
      if (taken.has(i)) continue;
      const gap = Math.hypot(t.x - f.x, t.y - f.y);
      if (gap < near && gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best < 0) continue;
    taken.add(best); matchOf[best] = { gap: +bestGap.toFixed(2), fx: f.x, fy: f.y };
  }

  // ---- rebuild the image pipeline exactly as readPage does ----
  const WORK_WIDTH = 1400;
  const w = Math.min(WORK_WIDTH, spoiled.width);
  const h = Math.round(spoiled.height * (w / spoiled.width));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d', { willReadFrequently: true }).drawImage(spoiled, 0, 0, w, h);
  const data = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  }
  function boxBlur(src, w, h, radius) {
    const tmp = new Float32Array(w * h); const dst = new Float32Array(w * h);
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
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
  const pageSpace = read ? read.space * h : null;
  const staffSpace = read && read.staves[0] ? read.staves[0].space * h : null;
  const body = staffSpace ? beamMask(ink, w, h, pageSpace) : ink;

  // ---- reconstruct findHeads' gates at an arbitrary centre ----
  function gates(x, y, space) {
    const hw = Math.max(2, Math.round(space * 0.62));
    const hh = Math.max(2, Math.round(space * 0.45));
    const inside = []; const rimP = []; const coreP = [];
    for (let dy = -hh; dy <= hh; dy++) {
      for (let dx = -hw; dx <= hw; dx++) {
        const d = (dx / hw) ** 2 + (dy / hh) ** 2;
        if (d <= 1) inside.push([dx, dy]);
        if (d >= 0.62 && d <= 1.3) rimP.push([dx, dy]);
        if (d <= 0.25) coreP.push([dx, dy]);
      }
    }
    const ringP = [];
    for (let dx = -hw; dx <= hw; dx += 2) {
      ringP.push([dx, -hh - Math.round(space * 0.5)]);
      ringP.push([dx, hh + Math.round(space * 0.5)]);
    }
    const at = (xx, yy) => (yy < 0 || yy >= h || xx < 0 || xx >= w ? 0 : body[yy * w + xx]);
    const centreGate = !!(at(x, y) || (at(x - hw, y) && at(x + hw, y)));
    let filled = 0; for (const [dx, dy] of inside) filled += at(x + dx, y + dy);
    const fill = filled / inside.length;
    let rimInk = 0; for (const [dx, dy] of rimP) rimInk += at(x + dx, y + dy);
    let coreInk = 0; for (const [dx, dy] of coreP) coreInk += at(x + dx, y + dy);
    let paper = 0;
    for (const [dx, dy] of coreP) {
      const yy = y + dy; const xx = x + dx;
      if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
      const i = yy * w + xx;
      if (gray[i] >= background[i] - 6) paper += 1;
    }
    let across = 1;
    for (let k = x - 1; k >= 0 && at(k, y); k--) across += 1;
    for (let k = x + 1; k < w && at(k, y); k++) across += 1;
    let clear = 0;
    for (const [dx, dy] of ringP) { if (!at(x + dx, y + dy)) clear++; }
    const open = clear / ringP.length;
    const rimR = rimInk / rimP.length; const coreR = coreInk / coreP.length;
    const paperR = paper / coreP.length;
    const solidRaw = fill >= 0.86;
    const inWindow = !solidRaw && fill >= 0.3 && fill <= 0.82;
    const isRing = inWindow && rimR >= 0.68 && coreR <= 0.42;
    const hollow = isRing && paperR >= 0.7;
    const solid = solidRaw || (isRing && !hollow);
    let verdict = 'ok';
    if (!centreGate) verdict = 'centre-gate';
    else if (!solid && !hollow) {
      if (!inWindow && !solidRaw) verdict = `fill-window(${fill.toFixed(2)})`;
      else if (rimR < 0.68) verdict = `rim(${rimR.toFixed(2)})`;
      else if (coreR > 0.42) verdict = `core(${coreR.toFixed(2)})`;
      else verdict = 'unknown';
    } else if (across > space * 2.6) verdict = `across(${across})`;
    else if (open < 0.45) verdict = `open(${open.toFixed(2)})`;
    return { fill: +fill.toFixed(3), rimR: +rimR.toFixed(3), coreR: +coreR.toFixed(3),
      paperR: +paperR.toFixed(3), across, open: +open.toFixed(3),
      centreGate, solid, hollow, verdict, hw, hh };
  }

  // per truth note: matched?, gates at the exact drawn centre, and the best
  // verdict anywhere within +-3px of it.
  const rows = moved.map((t, i) => {
    const x0 = Math.round(t.x); const y0 = Math.round(t.y);
    const sp = staffSpace ?? 14;
    const here = gates(x0, y0, sp);
    let anyOk = null;
    for (let dy = -3; dy <= 3 && !anyOk; dy++) {
      for (let dx = -3; dx <= 3 && !anyOk; dx++) {
        const g = gates(x0 + dx, y0 + dy, sp);
        if (g.verdict === 'ok') anyOk = { dx, dy, ...g };
      }
    }
    return { i, sys: t.sys, step: t.step, x: x0, y: y0,
      matched: !!matchOf[i], gap: matchOf[i]?.gap ?? null, here, anyOk: !!anyOk, anyOkAt: anyOk };
  });

  // ---- overlay picture ----
  const view = document.createElement('canvas');
  view.width = spoiled.width; view.height = spoiled.height;
  const vg = view.getContext('2d');
  vg.drawImage(spoiled, 0, 0);
  for (const f of found) {
    vg.strokeStyle = 'rgba(0,140,255,0.95)'; vg.lineWidth = 1.4;
    vg.beginPath(); vg.arc(f.x, f.y, 9, 0, Math.PI * 2); vg.stroke();
  }
  for (const r of rows) {
    vg.strokeStyle = r.matched ? 'rgba(0,190,90,0.9)' : 'rgba(255,0,0,1)';
    vg.lineWidth = r.matched ? 1 : 2.2;
    vg.beginPath(); vg.arc(r.x, r.y, 14, 0, Math.PI * 2); vg.stroke();
    if (!r.matched) {
      vg.fillStyle = 'rgba(255,0,0,1)'; vg.font = '11px monospace';
      vg.fillText(`s${r.step} ${r.here.verdict}`, r.x + 16, r.y + 4);
    }
  }
  const png = view.toDataURL('image/png');

  return { rows, found: found.length, drawn: moved.length,
    staves: read?.staves.length ?? 0, staffSpace, pageSpace, size: `${w}x${h}`, png };
}, WHICH);

writeFileSync(`${OUT}/probe-${WHICH}.png`, Buffer.from(report.png.split(',')[1], 'base64'));
const { png, ...rest } = report;
console.log(JSON.stringify(rest, null, 1));
if (errors.length) console.log('errors:', errors.slice(0, 3));
await browser.close();
