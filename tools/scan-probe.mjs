// Does the reader find the music on a real scanned page?
//
// A page is a photograph, and the only question that matters — does that ellipse
// sit on that notehead — is not one a unit test can answer. So the page is drawn
// back with everything the reader found laid over it, and the answer is
// something to look at.
//
//   npm run dev                       (port 5177, in another terminal)
//   node tools/scan-probe.mjs ~/Downloads/part.pdf
//   node tools/scan-probe.mjs part.pdf 0.6 2.4 40 0.3 staves 4.2
//
// The trailing numbers are the thresholds under test: beam thickness cut,
// minimum beam run, strips across the page, comb score floor, "staves" to stop
// after the staff pass, and how far apart two combs must be to be two staves.
// Everything is measured in staff spaces, so a page reads the same at any size.
//
// It runs the PRODUCTION path — paper.js renders the page exactly as an import
// does, at 1400px — and patches only the thresholds, so what is measured here is
// what will happen on the device.
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync } from 'node:fs';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const OUT = '/private/tmp/claude-501/-Users-iankaroly/4e5be60f-b5db-4c45-b789-d8f2851d989e/scratchpad/probe';

const PDF = process.argv[2];
if (!PDF) {
  console.error('usage: node tools/scan-probe.mjs <part.pdf> [thick] [run] [strips] [floor] [staves] [supp]');
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE THROW:', e.message));
await page.goto('http://localhost:5177/', { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async ({ THICK, RUN, STRIPS: STRIPS_IN, FLOOR, STAVES_ONLY, SUPP, PDF64 }) => {
  const { openPaper } = await import('/src/ui/paper.js');
  const src = await (await fetch('/src/analysis/scan-read.js')).text();
  const m = await import(/* @vite-ignore */ URL.createObjectURL(new Blob([`${src}
export { toGray, boxBlur, pageScale, findHeads, findBars };`], { type: 'text/javascript' })));

  const data = Uint8Array.from(atob(PDF64), (c) => c.charCodeAt(0)).buffer;
  const pages = await openPaper({ source: 'pdf', data });
  const sheet = document.createElement('canvas');
  sheet.width = 8; sheet.height = 8;
  await pages.draw(0, sheet, 1400, 6000);
  const w = sheet.width;
  const h = sheet.height;

  const gray = m.toGray(sheet);
  const background = m.boxBlur(gray, w, h, Math.max(4, Math.round(w / 36)));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < background[i] - 16 ? 1 : 0;
  const { thickness, space, pitch } = m.pageScale(ink, w, h);

  // --- 1. staves by comb ------------------------------------------------------
  const STRIPS = STRIPS_IN;
  const stripW = Math.max(1, Math.floor(w / STRIPS));
  const profiles = [];
  for (let s = 0; s < STRIPS; s++) {
    const x0 = s * stripW;
    const x1 = Math.min(w, x0 + stripW);
    const p = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) n += ink[y * w + x];
      p[y] = n / (x1 - x0);
    }
    profiles.push(p);
  }

  // A five-line grid scores high only when all five rows are inked AND the four
  // gaps between them are not: the negative lobes are what stop a beam, a black
  // chord or the page edge from answering.
  const combAt = (p, y0, step) => {
    let on = 0;
    let off = 0;
    for (let k = 0; k < 5; k++) {
      const y = Math.round(y0 + k * step);
      if (y < 0 || y >= p.length) return -1;
      on += p[y];
      if (k < 4) {
        const mid = Math.round(y0 + (k + 0.5) * step);
        off += p[mid];
      }
    }
    return on / 5 - off / 4;
  };

  const candidates = [];       // per strip: [{ y0, step, score }]
  for (let s = 0; s < STRIPS; s++) {
    const p = profiles[s];
    const found = [];
    for (let y0 = 0; y0 + 4 * pitch < h; y0++) {
      let best = -1;
      let bestStep = pitch;
      for (let step = pitch - 1.5; step <= pitch + 1.5; step += 0.25) {
        const v = combAt(p, y0, step);
        if (v > best) { best = v; bestStep = step; }
      }
      found.push({ y0, step: bestStep, score: best });
    }
    // strongest first, nothing else within a stave's height
    found.sort((a, b) => b.score - a.score);
    const kept = [];
    for (const c of found) {
      if (c.score < FLOOR) break;
      if (kept.some((k) => Math.abs(k.y0 - c.y0) < pitch * SUPP)) continue;
      kept.push(c);
    }
    candidates.push(kept.sort((a, b) => a.y0 - b.y0));
  }

  // Link across strips: a stave's top line moves slowly, so a curve claims the
  // nearest candidate in the next strip and dies if it finds none for a while.
  const drift = Math.max(2, pitch * 0.6);
  const curves = [];
  for (let s = 0; s < STRIPS; s++) {
    const taken = new Set();
    for (const curve of curves) {
      if (curve.last < s - 3) continue;
      let best = null;
      let gap = drift;
      for (const c of candidates[s]) {
        if (taken.has(c)) continue;
        const d = Math.abs(c.y0 - curve.y0);
        if (d < gap) { gap = d; best = c; }
      }
      if (!best) continue;
      taken.add(best);
      curve.points.push([s, best.y0, best.step]);
      curve.y0 = best.y0;
      curve.last = s;
    }
    for (const c of candidates[s]) {
      if (taken.has(c)) continue;
      curves.push({ points: [[s, c.y0, c.step]], y0: c.y0, last: s });
    }
  }

  const staves0 = curves
    .filter((c) => c.points.length >= STRIPS * 0.5)
    .map((c) => {
      const y0 = new Float32Array(STRIPS);
      const step = new Float32Array(STRIPS);
      let k = 0;
      for (let s = 0; s < STRIPS; s++) {
        while (k + 1 < c.points.length && c.points[k + 1][0] <= s) k++;
        const [sa, ya, sta] = c.points[k];
        const next = c.points[k + 1];
        const t = next ? (s - sa) / (next[0] - sa) : 0;
        y0[s] = next ? ya + (next[1] - ya) * t : ya;
        step[s] = next ? sta + (next[2] - sta) * t : sta;
      }
      const lines = [0, 1, 2, 3, 4].map((index) => {
        const at = new Float32Array(STRIPS);
        for (let s = 0; s < STRIPS; s++) at[s] = y0[s] + index * step[s];
        return { at, mid: at[Math.floor(STRIPS / 2)] };
      });
      const meanStep = [...step].reduce((a, b) => a + b, 0) / STRIPS;
      return { lines, space: meanStep };
    })
    .sort((a, b) => a.lines[0].mid - b.lines[0].mid);
  const staves = [...staves0];

  // --- 1b. the page has a rhythm; use it --------------------------------------
  // Systems on a printed page are evenly spaced, so the ones that were found
  // say where the ones that were missed must be. A predicted position is
  // accepted on far weaker evidence than an unprompted one — which is the whole
  // point: the shadow at the foot of a photographed page costs a system its
  // score, not its existence.
  if (staves.length >= 3) {
    const tops = staves.map((st) => st.lines[0].mid);
    const gaps = tops.slice(1).map((y, i) => y - tops[i]).sort((a, b) => a - b);
    const gap = gaps[Math.floor(gaps.length / 2)];
    const wanted = [];
    for (let y = tops[0] - gap; y > pitch * 5; y -= gap) wanted.push(y);
    for (let i = 0; i + 1 < tops.length; i++) {
      const span = tops[i + 1] - tops[i];
      const n = Math.round(span / gap);
      for (let k = 1; k < n; k++) wanted.push(tops[i] + (span * k) / n);
    }
    for (let y = tops.at(-1) + gap; y < h - pitch * 5; y += gap) wanted.push(y);

    for (const want of wanted) {
      if (staves.some((st) => Math.abs(st.lines[0].mid - want) < gap * 0.4)) continue;
      // best comb anywhere near the prediction, in every strip
      const y0 = new Float32Array(STRIPS);
      const step = new Float32Array(STRIPS);
      let votes = 0;
      for (let s = 0; s < STRIPS; s++) {
        let best = -1; let bestY = want; let bestStep = pitch;
        for (let y = Math.round(want - gap * 0.35); y <= Math.round(want + gap * 0.35); y++) {
          for (let st = pitch - 1.5; st <= pitch + 1.5; st += 0.25) {
            const v = combAt(profiles[s], y, st);
            if (v > best) { best = v; bestY = y; bestStep = st; }
          }
        }
        y0[s] = bestY; step[s] = bestStep;
        if (best > 0.05) votes++;
      }
      if (votes < STRIPS * 0.5) continue;
      // smooth: a stave does not jump about, so each strip is pulled toward its
      // neighbours before the lines are drawn from it
      const smooth = new Float32Array(STRIPS);
      for (let s = 0; s < STRIPS; s++) {
        let sum = 0; let n = 0;
        for (let k = Math.max(0, s - 2); k <= Math.min(STRIPS - 1, s + 2); k++) { sum += y0[k]; n++; }
        smooth[s] = sum / n;
      }
      const lines = [0, 1, 2, 3, 4].map((index) => {
        const at = new Float32Array(STRIPS);
        for (let s = 0; s < STRIPS; s++) at[s] = smooth[s] + index * step[s];
        return { at, mid: at[Math.floor(STRIPS / 2)] };
      });
      staves.push({ lines, space: [...step].reduce((a, b) => a + b, 0) / STRIPS });
    }
    staves.sort((a, b) => a.lines[0].mid - b.lines[0].mid);
  }

  if (STAVES_ONLY) {
    return {
      size: [w, h], scale: { thickness, space, pitch },
      staves: staves.length,
      stavesAt: staves.map((s) => Math.round(s.lines[0].mid)),
      spaces: staves.map((s) => +s.space.toFixed(1)),
      // how far each stave's top line moves from left edge to right edge
      tilt: staves.map((s) => Math.round(s.lines[0].at[STRIPS - 2] - s.lines[0].at[1])),
    };
  }

  // --- 2. wipe the staff lines and the beams ----------------------------------
  const body = new Uint8Array(ink);
  for (const staff of staves) {
    for (let index = 0; index < 5; index++) {
      for (let x = 0; x < w; x++) {
        const centre = Math.round(staff.lines[index].at[
          Math.min(STRIPS - 1, Math.floor(x / stripW))]);
        for (let y = centre - thickness; y <= centre + thickness; y++) {
          if (y < 1 || y >= h - 1) continue;
          // only if the ink stops there: a stem crossing the line stays
          const above = ink[(y - thickness - 2) * w + x];
          const below = ink[(y + thickness + 2) * w + x];
          if (above && below) continue;
          body[y * w + x] = 0;
        }
      }
    }
  }

  // A beam is a long horizontal bar of ink; a notehead is a space and a half
  // wide at most. Erase any row-run longer than that whose vertical extent is
  // thinner than a head — which takes the slurs with it, and they were noise.
  const runFloor = Math.round(space * RUN);
  const beam = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!body[y * w + x]) { x++; continue; }
      let end = x;
      while (end < w && body[y * w + end]) end++;
      if (end - x >= runFloor) {
        for (let k = x; k < end; k++) {
          // how tall is the ink here? a beam is thin, a chord of heads is not
          let up = 0;
          while (up < space && y - up >= 0 && body[(y - up) * w + k]) up++;
          let down = 0;
          while (down < space && y + down < h && body[(y + down) * w + k]) down++;
          if (up + down <= space * THICK) beam[y * w + k] = 1;
        }
      }
      x = end;
    }
  }
  let wiped = 0;
  for (let i = 0; i < w * h; i++) if (beam[i]) { body[i] = 0; wiped++; }

  // --- 3. heads, the shipped detector, on the cleaned page ---------------------
  const headsRaw = staves.map((staff) => m.findHeads(ink, w, h, staff, staff.space));
  const headsClean = staves.map((staff) => m.findHeads(body, w, h, staff, staff.space));

  const overlay = (heads, source) => {
    const view = document.createElement('canvas');
    view.width = w; view.height = h;
    const ctx = view.getContext('2d');
    if (source === 'page') ctx.drawImage(sheet, 0, 0);
    else {
      const img = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = body[i] ? 20 : 250;
        img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    staves.forEach((staff, si) => {
      ctx.strokeStyle = 'rgba(109,78,246,0.45)';
      ctx.lineWidth = 1;
      for (const line of staff.lines) {
        ctx.beginPath();
        line.at.forEach((y, s) => {
          const x = (s + 0.5) * stripW;
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(23,181,120,0.95)';
      ctx.lineWidth = 1.4;
      for (const head of heads[si]) {
        ctx.beginPath();
        ctx.ellipse(head.x, head.y, staff.space * 0.7, staff.space * 0.52, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    return view.toDataURL('image/png');
  };

  return {
    size: [w, h],
    scale: { thickness, space, pitch },
    staves: staves.length,
    stavesAt: staves.map((s) => Math.round(s.lines[0].mid)),
    spaces: staves.map((s) => +s.space.toFixed(1)),
    headsRaw: headsRaw.reduce((n, l) => n + l.length, 0),
    headsClean: headsClean.reduce((n, l) => n + l.length, 0),
    perStaffClean: headsClean.map((l) => l.length),
    beamPixelsWiped: wiped,
    overlayPage: overlay(headsClean, 'page'),
    overlayInk: overlay(headsClean, 'ink'),
  };
}, {
  PDF64: readFileSync(PDF).toString('base64'),
  THICK: Number(process.argv[3] ?? 0.6),
  RUN: Number(process.argv[4] ?? 2.4),
  STRIPS: Number(process.argv[5] ?? 40),
  FLOOR: Number(process.argv[6] ?? 0.3),
  STAVES_ONLY: process.argv[7] === 'staves',
  SUPP: Number(process.argv[8] ?? 4.2),
});

if (result.overlayPage) writeFileSync(`${OUT}/comb-page.png`, Buffer.from(result.overlayPage.split(',')[1], 'base64'));
if (result.overlayInk) writeFileSync(`${OUT}/comb-ink.png`, Buffer.from(result.overlayInk.split(',')[1], 'base64'));
delete result.overlayPage;
delete result.overlayInk;
console.log(JSON.stringify(result, null, 2));
await browser.close();
