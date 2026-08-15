// THROWAWAY PROBE — delete when done.
// menuet.png through the real front door, with findHeads instrumented: which
// gate rejects what, where the rejects sit on the stave, and an overlay to look at.
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const OUT = '/private/tmp/claude-501/-Users-iankaroly/3cf48b2a-5a9c-4612-b149-47b748b870f7/scratchpad';
const FILE = process.argv[2] ?? `${OUT}/menuet.png`;
const GATE = process.argv[3] ?? 'shipped';
const ACROSS = Number(process.argv[4] ?? 2.6);

const bytes = await readFile(FILE);
const base64 = bytes.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const result = await page.evaluate(async ({ b64, gateName, acrossMul }) => {
  const M = await import('/src/analysis/scan-read.js');
  const { readPage, combPeaks, trackCombs, fillMissedStaves, stavesToLines, beamMask } = M;
  const { openPaper } = await import('/src/ui/paper.js');
  const WORK_WIDTH = 1400; const STRIPS = 40;

  function toGray(canvas) {
    const { width, height } = canvas;
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    return gray;
  }
  function boxBlur(src, w, h, radius) {
    const tmp = new Float32Array(w * h); const dst = new Float32Array(w * h);
    const span = radius * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += src[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { tmp[y * w + x] = sum / span; sum += src[y * w + Math.min(w - 1, x + radius + 1)] - src[y * w + Math.max(0, x - radius)]; }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { dst[y * w + x] = sum / span; sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x]; }
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
        const t = colour ? black : white;
        if (run > 0 && run < t.length) t[run]++;
        colour = v; run = 1;
      }
    }
    const commonest = (t, from) => { let b = from; for (let i = from; i < t.length; i++) if (t[i] > t[b]) b = i; return b; };
    const thickness = commonest(black, 1);
    const space = commonest(white, thickness + 1);
    return { thickness, space, pitch: space + thickness };
  }
  function makeGate(name, hw) {
    if (name === 'shipped') return (ink, w, x, y) => ink[y * w + x] || (ink[y * w + x - hw] && ink[y * w + x + hw]);
    if (name === 'band') {
      const lo = Math.max(1, Math.round(hw * 0.7));
      return (ink, w, x, y) => {
        if (ink[y * w + x]) return true;
        let l = 0; let r = 0;
        for (let k = lo; k <= hw; k++) { if (ink[y * w + x - k]) l = 1; if (ink[y * w + x + k]) r = 1; }
        return l && r;
      };
    }
    if (name === 'hwMinus1') {
      return (ink, w, x, y) => ink[y * w + x]
        || (ink[y * w + x - (hw - 1)] && ink[y * w + x + (hw - 1)]);
    }
    if (name === 'twoRadii') {
      const p2 = Math.max(1, Math.round(hw * 0.8));
      return (ink, w, x, y) => ink[y * w + x]
        || (ink[y * w + x - hw] && ink[y * w + x + hw])
        || (ink[y * w + x - p2] && ink[y * w + x + p2]);
    }
    if (name === 'walk') {
      return (ink, w, x, y) => {
        if (ink[y * w + x]) return true;
        let l = 0; let r = 0;
        for (let k = 1; k <= hw; k++) if (ink[y * w + x - k]) { l = 1; break; }
        for (let k = 1; k <= hw; k++) if (ink[y * w + x + k]) { r = 1; break; }
        return l && r;
      };
    }
    throw new Error('gate?');
  }

  function findHeadsProbe(ink, w, h, staff, space, gray, background) {
    const hw = Math.max(2, Math.round(space * 0.62));
    const hh = Math.max(2, Math.round(space * 0.45));
    const gate = makeGate(gateName, hw);
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
    const acrossRejects = [];       // passed shape + open, killed by `across`
    for (let y = top; y <= bottom; y++) {
      for (let x = hw + 1; x < w - hw - 1; x++) {
        if (!gate(ink, w, x, y)) continue;
        let filled = 0;
        for (const [dx, dy] of inside) filled += ink[(y + dy) * w + x + dx];
        const fill = filled / inside.length;
        let solid = fill >= 0.86;
        let hollow = false;
        if (!solid && fill >= 0.3 && fill <= 0.82) {
          let rimInk = 0; for (const [dx, dy] of rim) rimInk += ink[(y + dy) * w + x + dx];
          let coreInk = 0; for (const [dx, dy] of core) coreInk += ink[(y + dy) * w + x + dx];
          let paper = 0;
          for (const [dx, dy] of core) { const at = (y + dy) * w + x + dx; if (gray[at] >= background[at] - 6) paper += 1; }
          const isRing = (rimInk / rim.length) >= 0.68 && (coreInk / core.length) <= 0.42;
          hollow = isRing && (paper / core.length) >= 0.7;
          if (isRing && !hollow) solid = true;
        }
        if (!solid && !hollow) continue;
        let across = 1;
        for (let k = x - 1; k >= 0 && ink[y * w + k]; k--) across += 1;
        for (let k = x + 1; k < w && ink[y * w + k]; k++) across += 1;
        let clear = 0;
        for (const [dx, dy] of ringPts) { const yy = y + dy; if (yy < 0 || yy >= h || !ink[yy * w + x + dx]) clear++; }
        const open = clear / ringPts.length;
        if (open < 0.45) continue;
        if (across > space * acrossMul) { acrossRejects.push({ x, y, across, fill, open, hollow }); continue; }
        scored.push({ x, y, score: (solid ? fill : 0.86) + open, hollow, across });
      }
    }
    const dedupe = (list) => {
      const sorted = list.slice().sort((a, b) => (b.score ?? b.across) - (a.score ?? a.across));
      const kept = [];
      for (const p of sorted) {
        if (kept.some((k) => Math.abs(k.x - p.x) < space * 1.1 && Math.abs(k.y - p.y) < space * 0.9)) continue;
        kept.push(p);
      }
      return kept.sort((a, b) => a.x - b.x);
    };
    return { heads: dedupe(scored), acrossRejects: dedupe(acrossRejects) };
  }

  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const pages = await openPaper({ source: 'images', pages: [blob] });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  const dpr = window.devicePixelRatio || 1;
  await pages.draw(0, sheet, 1400 / dpr, (1400 * 4.3) / dpr);

  const nw = sheet.width; const nh = sheet.height;
  const w = Math.min(WORK_WIDTH, nw); const h = Math.round(nh * (w / nw));
  const work = document.createElement('canvas');
  work.width = w; work.height = h;
  work.getContext('2d', { willReadFrequently: true }).drawImage(sheet, 0, 0, w, h);
  const gray = toGray(work);
  const background = boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
  const { space, pitch } = pageScale(ink, w, h);
  const stripW = Math.max(1, Math.floor(w / STRIPS));
  const profiles = [];
  for (let s = 0; s < STRIPS; s++) {
    const x0 = s * stripW; const x1 = Math.min(w, x0 + stripW);
    const p = new Float32Array(h);
    for (let y = 0; y < h; y++) { let n = 0; for (let x = x0; x < x1; x++) n += ink[y * w + x]; p[y] = n / (x1 - x0); }
    profiles.push(p);
  }
  const tracked = trackCombs(profiles.map((p) => combPeaks(p, pitch)), pitch);
  const staves = stavesToLines(fillMissedStaves(tracked, profiles, pitch), STRIPS);
  const body = beamMask(ink, w, h, space);

  const stepOf = (staff, x, y) => {
    const strip = Math.min(STRIPS - 1, Math.max(0, Math.floor((x / w) * STRIPS)));
    return Math.round((staff.lines[4].at[strip] - y) / (staff.space / 2));
  };

  const perStaff = staves.map((staff) => findHeadsProbe(body, w, h, staff, staff.space, gray, background));
  const headRows = []; const rejRows = [];
  for (const [si, r] of perStaff.entries()) {
    for (const hd of r.heads) headRows.push({ si, ...hd, step: stepOf(staves[si], hd.x, hd.y), space: staves[si].space });
    for (const rj of r.acrossRejects) rejRows.push({ si, ...rj, step: stepOf(staves[si], rj.x, rj.y), space: staves[si].space });
  }

  const real = readPage(sheet, nw, nh);
  const realHeads = [];
  for (const st of (real?.staves ?? [])) for (const hd of st.heads) realHeads.push({ x: hd.x * w, y: hd.y * h, step: hd.step });

  // overlay
  const view = document.createElement('canvas');
  view.width = w; view.height = h;
  const vg = view.getContext('2d');
  vg.drawImage(sheet, 0, 0, w, h);
  for (const hd of headRows) {
    vg.strokeStyle = hd.step > 8 ? '#0c0' : '#06f'; vg.lineWidth = 1.2;
    vg.beginPath(); vg.arc(hd.x, hd.y, space * 0.9, 0, Math.PI * 2); vg.stroke();
  }
  for (const rj of rejRows) {
    vg.strokeStyle = '#f0f'; vg.lineWidth = 1.6;
    vg.beginPath(); vg.rect(rj.x - space, rj.y - space, space * 2, space * 2); vg.stroke();
  }

  const hist = (rows, key) => {
    const o = {};
    for (const r of rows) o[r[key]] = (o[r[key]] ?? 0) + 1;
    return o;
  };
  return {
    gateName, acrossMul, w, h, space, pitch,
    staves: staves.length, realStaves: real?.staves.length ?? 0,
    mine: headRows.length, real: realHeads.length,
    acrossRejects: rejRows.length,
    headStepHist: hist(headRows, 'step'),
    rejectStepHist: hist(rejRows, 'step'),
    rejectAcross: rejRows.map((r) => +(r.across / r.space).toFixed(2)).sort((a, b) => a - b),
    headAcrossHigh: headRows.filter((r) => r.step > 8).map((r) => +(r.across / r.space).toFixed(2)).sort((a, b) => a - b),
    headAcrossLow: headRows.filter((r) => r.step <= 8).map((r) => +(r.across / r.space).toFixed(2)).sort((a, b) => a - b),
    png: view.toDataURL('image/png'),
  };
}, { b64: base64, gateName: GATE, acrossMul: ACROSS });

const { png, ...s } = result;
fs.writeFileSync(`${OUT}/real-${GATE}-${ACROSS}.png`, Buffer.from(png.split(',')[1], 'base64'));
const pct = (a) => {
  if (!a.length) return 'none';
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return `n=${a.length} min ${a[0]} p25 ${q(0.25)} med ${q(0.5)} p75 ${q(0.75)} max ${a.at(-1)}`;
};
console.log(JSON.stringify({
  ...s, rejectAcross: pct(s.rejectAcross),
  headAcrossHigh: pct(s.headAcrossHigh), headAcrossLow: pct(s.headAcrossLow),
}, null, 2));
if (errors.length) console.log('errors:', errors.slice(0, 4).join(' | '));
await browser.close();
