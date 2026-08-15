// THROWAWAY PROBE — delete when done.
// A parity-verified copy of findHeads whose CANDIDATE GATE is swappable, run
// over the whole scan-corpus set so a change can be costed page by page.
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const gates = (process.argv[2] ?? 'shipped,hwMinus1,twoRadii,walk,band').split(',');

const report = await page.evaluate(async (GATES) => {
  const M = await import('/src/analysis/scan-read.js');
  const { readPage, notesInOrder, combPeaks, trackCombs, fillMissedStaves, stavesToLines, beamMask } = M;
  const { readValues, beamLayer } = await import('/src/analysis/scan-stems.js');
  const WORK_WIDTH = 1400;
  const STRIPS = 40;

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
  function pageScale(ink, w, h) {
    const black = new Array(40).fill(0); const white = new Array(80).fill(0);
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
    const commonest = (t, from) => { let b = from; for (let i = from; i < t.length; i++) if (t[i] > t[b]) b = i; return b; };
    const thickness = commonest(black, 1);
    const space = commonest(white, thickness + 1);
    return { thickness, space, pitch: space + thickness };
  }

  // The gate under test. Returns true if (x,y) may be the centre of a head.
  function makeGate(name, hw, hh, space) {
    const p2 = Math.max(1, Math.round(hw * 0.8));
    switch (name) {
      case 'shipped':
        return (ink, w, x, y) => ink[y * w + x] || (ink[y * w + x - hw] && ink[y * w + x + hw]);
      case 'hwMinus1':
        return (ink, w, x, y) => ink[y * w + x]
          || (ink[y * w + x - (hw - 1)] && ink[y * w + x + (hw - 1)]);
      case 'twoRadii':
        return (ink, w, x, y) => ink[y * w + x]
          || (ink[y * w + x - hw] && ink[y * w + x + hw])
          || (ink[y * w + x - p2] && ink[y * w + x + p2]);
      case 'band': {
        // ink anywhere in the outer half of the head's own half-width, both sides
        const lo = Math.max(1, Math.round(hw * 0.7));
        return (ink, w, x, y) => {
          if (ink[y * w + x]) return true;
          let left = 0; let right = 0;
          for (let k = lo; k <= hw; k++) {
            if (ink[y * w + x - k]) left = 1;
            if (ink[y * w + x + k]) right = 1;
          }
          return left && right;
        };
      }
      case 'walk':
        return (ink, w, x, y) => {
          if (ink[y * w + x]) return true;
          let left = 0; let right = 0;
          for (let k = 1; k <= hw; k++) if (ink[y * w + x - k]) { left = 1; break; }
          for (let k = 1; k <= hw; k++) if (ink[y * w + x + k]) { right = 1; break; }
          return left && right;
        };
      default: throw new Error(`no gate ${name}`);
    }
  }

  function findHeadsVariant(ink, w, h, staff, space, gray, background, gateName) {
    const hw = Math.max(2, Math.round(space * 0.62));
    const hh = Math.max(2, Math.round(space * 0.45));
    const gate = makeGate(gateName, hw, hh, space);
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
    let candidates = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = hw + 1; x < w - hw - 1; x++) {
        if (!gate(ink, w, x, y)) continue;
        candidates += 1;
        let filled = 0;
        for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
        const fill = filled / inside.length;
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
          if (isRing && !hollow) solid = true;
        }
        if (!solid && !hollow) continue;
        let across = 1;
        for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
        for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
        if (across > space * 2.6) continue;
        let clear = 0;
        for (const [dx, dy] of ringPts) {
          const yy = y + dy;
          if (yy < 0 || yy >= h || !ink[yy * w + x + dx]) clear++;
        }
        const open = clear / ringPts.length;
        if (open < 0.45) continue;
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
    return { heads: kept.sort((a, b) => a.x - b.x), candidates };
  }

  function realStaff(staff) {
    return ((staff?.heads?.length ?? 0) > 0) || ((staff?.bars?.length ?? 0) > 0);
  }

  // readPage, with the gate swapped. Everything else identical; findBars is
  // private so bars are omitted — they are not graded here, and realStaff is
  // applied on heads alone, which is the same filter for every gate.
  function readPageVariant(source, nw, nh, gateName) {
    const w = Math.min(WORK_WIDTH, nw);
    const h = Math.round(nh * (w / nw));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, w, h);
    const gray = toGray(canvas);
    const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
    const { space, pitch } = pageScale(ink, w, h);
    if (!(space > 2 && space < 40)) return null;
    const stripW = Math.max(1, Math.floor(w / STRIPS));
    const profiles = [];
    for (let s = 0; s < STRIPS; s++) {
      const x0 = s * stripW; const x1 = Math.min(w, x0 + stripW);
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
    if (staves.length === 0) return null;
    const body = beamMask(ink, w, h, space);
    const beams = beamLayer(ink, body);
    let candidates = 0;
    const found = staves.map((staff) => {
      const r = findHeadsVariant(body, w, h, staff, staff.space, gray, background, gateName);
      candidates += r.candidates;
      return {
        staff, bars: [], heads: r.heads, space: staff.space,
        lineAt: (x) => {
          const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((x / w) * STRIPS)));
          return staff.lines.map((line) => line.at[strip]);
        },
      };
    });
    const perStaff = readValues(ink, beams, w, h, found);
    const out = found.map(({ staff, bars, heads }, si) => {
      const values = perStaff[si];
      return {
        bars,
        heads: heads.map((head, i) => ({
          x: head.x / w, y: head.y / h,
          beats: values[i]?.beats ?? null, beams: values[i]?.beams ?? 0,
        })),
      };
    });
    return { staves: out.filter(realStaff), candidates };
  }

  // --- the corpus, copied ---------------------------------------------------
  function drawPage({
    space = 14, systems = 6, sysGap = 16, warp = 0, tilt = 0,
    gapSpaces = 6.6, noteGap = 2.2, plan,
  }) {
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
        for (let x = space * 3; x < W - space * 3; x += 4) g.fillRect(x, lineY(l, x), 5, Math.max(1, space * 0.1));
      }
      for (const at of [space * 3, W - space * 3]) g.fillRect(at, lineY(0, at), Math.max(1.4, space * 0.12), space * 4);
      let cursor = space * 6; let first = true;
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
          truth.push({ x, y, beams: unit.beams });
        }
        g.fillStyle = '#111';
        const stemW = Math.max(1.3, space * 0.11);
        const sx = (i) => xs[i] + (dir < 0 ? space * 0.55 : -space * 0.55);
        if (unit.stem === false) { /* semibreve */ } else if (unit.beams === 0 || n === 1) {
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
            g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2 + t); g.lineTo(x1, y1 + t);
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

  function grade(truth, canvas, read) {
    const found = [];
    if (read) {
      for (const st of read.staves) {
        for (const hd of st.heads) found.push({ x: hd.x * canvas.width, y: hd.y * canvas.height, beams: hd.beams });
      }
    }
    const near = Math.max(6, canvas.width / 160);
    const taken = new Set();
    let matched = 0; let rightBeams = 0;
    for (const f of found) {
      let best = -1; let bestGap = Infinity;
      for (const [i, t] of truth.entries()) {
        if (taken.has(i)) continue;
        const gap = Math.hypot(t.x - f.x, t.y - f.y);
        if (gap < near && gap < bestGap) { bestGap = gap; best = i; }
      }
      if (best < 0) continue;
      taken.add(best); matched += 1;
      if (truth[best].beams === f.beams) rightBeams += 1;
    }
    return {
      drawn: truth.length, found: found.length, matched, spurious: found.length - matched,
      recall: +(matched / truth.length).toFixed(3),
      overall: +(rightBeams / truth.length).toFixed(3),
    };
  }

  const up = -1; const down = 1;
  const rising = (grp) => [0, 2, 4, 6].map((s) => (s + grp) % 8);
  const falling = (grp) => [6, 4, 2, 0].map((s) => (s + grp) % 8);
  const ordinary = (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up }));
  const PHOTO = { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 };
  const PHOTO_DRAW = { space: 18, warp: 0.7, tilt: 0.004 };
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
    photograph: { draw: { ...PHOTO_DRAW, plan: ordinary }, spoil: PHOTO },
  };
  const HARD = {
    slopedDown: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: falling(grp), dir: up })) }, spoil: {} },
    slopedSteep: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [0, 3, 6, 9], dir: up, slope: 0.7 })) }, spoil: {} },
    slopedPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: (grp % 2 ? falling : rising)(grp), dir: up })) }, spoil: PHOTO },
    downStems: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [8, 10, 12, 8].map((s) => s - (grp % 3)), dir: down })) }, spoil: {} },
    dsOrdinary: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [10, 8, 6, 4].map((s) => s - (grp % 3)), dir: down, slope: 0.5 })) }, spoil: {} },
    dsOrdinaryPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [10, 8, 6, 4].map((s) => s - (grp % 3)), dir: down, slope: 0.5 })) }, spoil: PHOTO },
    usCrossLines: { draw: { plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [-8, -6, -4, -2].map((s) => s + (grp % 3)), dir: up, slope: 0.5 })) }, spoil: {} },
    pairs: { draw: { gapSpaces: 5.5, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [(grp * 2) % 6, (grp * 2 + 2) % 6], dir: up })) }, spoil: {} },
    pairsPhoto: { draw: { ...PHOTO_DRAW, gapSpaces: 5.5, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [(grp * 2) % 6, (grp * 2 + 2) % 6], dir: up })) }, spoil: PHOTO },
    sixes: { draw: { plan: (sys) => [0, 1, 2].map((grp) => ({ beams: 1 + ((sys + grp) % 3), steps: [0, 1, 2, 3, 4, 5].map((i) => (grp + i) % 7), dir: up })) }, spoil: {} },
    noBeams: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({ beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) }, spoil: {} },
    noBeamsPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({ beams: 0, steps: [(grp * 3 + sys) % 8], dir: up })) }, spoil: PHOTO },
    minims: { draw: { plan: (sys) => [0, 1, 2, 3, 4, 5].map((grp) => ({ beams: 0, steps: [(grp * 3 + sys) % 8], dir: up, hollow: true })) }, spoil: {} },
    mixed: { draw: { plan: (sys) => [0, 1, 2, 3].flatMap((grp) => [{ beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up }, { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up }, { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up }]) }, spoil: {} },
    mixedPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2, 3].flatMap((grp) => [{ beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up }, { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up }, { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up }]) }, spoil: PHOTO },
    barMix: { draw: { plan: (sys) => [0, 1, 2].flatMap((grp) => [{ beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up, gapBefore: 8 }, { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up, gapBefore: 2.6 }, { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up, gapBefore: 2.6 }]) }, spoil: {} },
    barMixPhoto: { draw: { ...PHOTO_DRAW, plan: (sys) => [0, 1, 2].flatMap((grp) => [{ beams: 1 + ((sys + grp) % 3), steps: rising(grp), dir: up, gapBefore: 8 }, { beams: 0, steps: [(grp * 2 + sys) % 8], dir: up, gapBefore: 2.6 }, { beams: 0, steps: [(grp * 2 + sys + 3) % 8], dir: up, gapBefore: 2.6 }]) }, spoil: PHOTO },
    denseSemis: { draw: { space: 16, gapSpaces: 3, noteGap: 2, plan: (sys) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((grp) => ({ beams: 2, steps: rising(grp + sys), dir: grp % 2 ? down : up })) }, spoil: {} },
    densePhoto: { draw: { space: 16, warp: 0.7, tilt: 0.004, gapSpaces: 3, noteGap: 2, plan: (sys) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((grp) => ({ beams: 2, steps: rising(grp + sys), dir: grp % 2 ? down : up })) }, spoil: PHOTO },
    halfSpace: { draw: { space: 7, plan: ordinary }, spoil: {} },
    halfSpaceThree: { draw: { space: 7, plan: (sys) => [0, 1, 2, 3, 4].map((grp) => ({ beams: 3, steps: rising(grp), dir: up })) }, spoil: {} },
    tightSystems: { draw: { sysGap: 10.5, plan: ordinary }, spoil: {} },
    heavyBlur: { draw: { space: 18, plan: ordinary }, spoil: { blur: 2.4 } },
  };

  const out = {};
  for (const gateName of GATES) out[gateName] = { core: {}, hard: {} };
  // Also a real-reader baseline, to keep the copy honest page by page.
  out.__real = { core: {}, hard: {} };

  for (const [block, pages] of [['core', CORE], ['hard', HARD]]) {
    for (const [name, recipe] of Object.entries(pages)) {
      const { canvas, truth } = drawPage(recipe.draw);
      const spoiled = await spoil(canvas, recipe.spoil);
      const s = spoiled.width / canvas.width;
      const moved = truth.map((t) => ({ ...t, x: t.x * s, y: t.y * s }));
      let real = null;
      try { real = readPage(spoiled, spoiled.width, spoiled.height); } catch { /* */ }
      out.__real[block][name] = grade(moved, spoiled, real
        ? { staves: real.staves } : null);
      for (const gateName of GATES) {
        let read = null;
        try { read = readPageVariant(spoiled, spoiled.width, spoiled.height, gateName); } catch (e) { /* */ }
        out[gateName][block][name] = { ...grade(moved, spoiled, read), candidates: read?.candidates ?? 0 };
      }
    }
  }
  return out;
}, gates);

const names = [...Object.keys(report.__real.core), ...Object.keys(report.__real.hard)];
const pad = Math.max(8, ...names.map((n) => n.length));
const cols = ['__real', ...gates];
console.log(`\nRECALL %   (real = the shipped reader; 'shipped' = my copy, must match)`);
console.log(`${'page'.padEnd(pad)}  ${cols.map((c) => c.replace('__', '').padStart(11)).join('')}`);
for (const block of ['core', 'hard']) {
  for (const name of Object.keys(report.__real[block])) {
    console.log(`${name.padEnd(pad)}  ${cols.map((c) => `${Math.round(report[c][block][name].recall * 100)}`.padStart(11)).join('')}`);
  }
}
console.log(`\nSPURIOUS`);
console.log(`${'page'.padEnd(pad)}  ${cols.map((c) => c.replace('__', '').padStart(11)).join('')}`);
for (const block of ['core', 'hard']) {
  for (const name of Object.keys(report.__real[block])) {
    console.log(`${name.padEnd(pad)}  ${cols.map((c) => `${report[c][block][name].spurious}`.padStart(11)).join('')}`);
  }
}
console.log(`\nOVERALL % (found AND right beam count)`);
console.log(`${'page'.padEnd(pad)}  ${cols.map((c) => c.replace('__', '').padStart(11)).join('')}`);
for (const block of ['core', 'hard']) {
  for (const name of Object.keys(report.__real[block])) {
    console.log(`${name.padEnd(pad)}  ${cols.map((c) => `${Math.round(report[c][block][name].overall * 100)}`.padStart(11)).join('')}`);
  }
}
const mean = (c, b) => {
  const v = Object.values(report[c][b]);
  return v.reduce((a, r) => a + r.overall, 0) / v.length;
};
console.log(`\nMEANS`);
for (const c of cols) console.log(`${c.replace('__', '').padEnd(12)} core ${(mean(c, 'core') * 100).toFixed(1)}%   hard ${(mean(c, 'hard') * 100).toFixed(1)}%`);
console.log(`\nCANDIDATE PIXELS (cost of the gate)`);
for (const c of gates) {
  let n = 0;
  for (const b of ['core', 'hard']) for (const r of Object.values(report[c][b])) n += r.candidates;
  console.log(`${c.padEnd(12)} ${n.toLocaleString()}`);
}
if (errors.length) console.log('\nerrors:', errors.slice(0, 4).join(' | '));
await browser.close();
