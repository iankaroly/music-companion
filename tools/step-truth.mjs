// Is the reader measuring the STEP right, ON A REAL PHOTOGRAPH?
//
// WHY THIS EXISTS
//
// Every pitch figure this project quotes comes from pages it engraved itself,
// where the staff lines are drawn straight and the truth is the number passed to
// fillText. On a photograph of a bound book the lines sag, and a pitch is
// measured FROM THE LINES: a step is half a staff space, so a stave model half a
// space out names every note of that passage a second wrong while the ring still
// sits dead centre on the notehead.
//
// A RESIDUAL TEST CANNOT FIND THIS, and one was already tried. If the whole
// model is a step out the heads still land neatly on ITS lines and the residual
// stays near zero. Measured: no head on the Bach page is more than half a step
// from the model, and the pitches are still wrong.
//
// So the lines are measured again here, INDEPENDENTLY of the reader — no comb
// tracked across the page, no curve fit, no model at all. For each hand-marked
// notehead, the printed staff lines in two narrow columns either side of it are
// found from the ink, five of them are fitted, and the mark's position against
// THOSE says which line or space it is on. The truth files hold positions rather
// than pitches, but a position plus the printed lines under it IS a step — so a
// marked page becomes step truth without anybody naming a note.
//
//   npm run scan:steps -- <file.pdf> --truth <truth.json>
//   npm run scan:steps -- <file.pdf> --truth <truth.json> \
//                         --known pages/truth/bach.pitch.json
//        …score the harness ITSELF against steps that come from the music and
//        not from the page. Nothing this file says about the reader means
//        anything until that line reads right.
//   STEP_DRAW=3,7,11 npm run scan:steps -- …
//        …one magnified crop per mark, the lines THIS file found in green and
//        the reader's model in red, so both can be checked by eye. That crop is
//        how every decision below was made.
//   STEP_PROFILE=4 npm run scan:steps -- …
//        …the raw ink profile at one mark, row by row, which is what the peak
//        finder had to be built against rather than guessed at.
//   knobs, all with the measured defaults: STEP_NEAR / STEP_FAR (the column
//   bands, 1.1 and 3.4 spaces), STEP_HITS (lines a comb must match, 4),
//   STEP_GATE (the tie-break, 0.9 spaces).
//
// WHAT WAS WRONG WITH THE FIRST VERSION OF THIS FILE, measured on the Bach page:
// it took a ±7-space window, called every row above 70% inked a line, and used
// the LOWEST such row as the bottom line. Three things follow. The window
// reaches the NEIGHBOURING stave, so the "bottom line" was often a line of the
// stave below and the step came out 2 to 4 out — that is the -2 (25 marks) and
// -3/-4 (11 marks) in its own report, its error and not the reader's. Bach is
// beamed semiquavers throughout and a beam is a long horizontal run of ink, so
// beams were being counted as staff lines. And only 169 of 319 marks produced a
// number at all. IT REPORTED THE READER AT 59.8% AND EVERY PART OF THAT FIGURE
// WAS ITS OWN.
//
// WHAT THIS ONE DOES, each piece with the measurement that forced it, in the
// comment above the code:
//   · two column bands either side of the mark, never through the notehead
//   · lines found as RIDGES — darker than the paper a third of a space above
//     and below — not by a threshold, because the five lines of one window on
//     this photograph range from 34% inked to 100%, and not by prominence,
//     because a line lying on the edge of a beam then looks fat
//   · a five-line COMB fitted to those ridges, anchored at BOTH ends, its
//     spacing even to a seventh of a pixel
//   · the comb chosen by the SYSTEM and not by the window: a printed stave sags
//     smoothly and does not jump a space between one note and the next, so a
//     quadratic through the whole system's candidates decides which reading each
//     mark takes. Three ink-only ways of making that choice are recorded, with
//     their numbers, above `consensus`
//   · it REFUSES, and says why and how often, when the page will not say
//   · and it CHECKS ITSELF against pages/truth/bach.pitch.json before it is
//     allowed to say anything about the reader.
//
// WHAT IT SCORES ON ITS OWN CHECK: of the first 32 marks of the Bach page, whose
// steps BWV 1007 already gives, it answers 25 and gets 25 right. It reads 78% of
// that page, 73% of the Concerto and 74% of the Scanned score, and refuses the
// rest by name.

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--truth' && args[i - 1] !== '--known');
const at = args.indexOf('--truth');
const truthPath = at >= 0 ? args[at + 1] : null;
const kn = args.indexOf('--known');
// --known takes a file of steps read off the MUSIC (pages/truth/bach.pitch.json)
// or, for a quick try, the numbers themselves.
let known = null;
if (kn >= 0) {
  const arg = args[kn + 1];
  known = /\.json$/i.test(arg)
    ? JSON.parse(await readFile(arg, 'utf8')).steps
    : arg.split(/[,\s]+/).filter(Boolean).map(Number);
}
if (!file || !truthPath) {
  console.log('usage: npm run scan:steps -- <file.pdf> --truth <truth.json> [--known <steps.json|0,4,9,…>]');
  process.exit(1);
}
const truth = JSON.parse(await readFile(truthPath, 'utf8'));
const b64 = (await readFile(file)).toString('base64');
const draw = (process.env.STEP_DRAW ?? '').split(',').filter(Boolean).map(Number);
const dump = (process.env.STEP_PROFILE ?? '').split(',').filter(Boolean).map(Number);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(async ({ b64, want, pdf, draw, dump, tune }) => {
  const M = await import('/src/analysis/scan-read.js');
  let src;
  if (pdf) {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const pg = await doc.getPage(1);
    const scale = 1800 / pg.getViewport({ scale: 1 }).width;
    const vp = pg.getViewport({ scale });
    src = document.createElement('canvas');
    src.width = vp.width; src.height = vp.height;
    await pg.render({ canvasContext: src.getContext('2d'), viewport: vp }).promise;
  } else {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    src = document.createElement('canvas');
    src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0);
  }
  const W = Math.min(1400, src.width);
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(src.height * (W / src.width));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const w = c.width; const h = c.height;

  // The same ink the reader thresholds to, and by the same arithmetic: a local
  // background from a box blur, and anything 16 grey levels darker than its own
  // neighbourhood is ink. Copied rather than imported because this file must not
  // depend on the thing it is measuring.
  const px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  const rad = Math.max(4, Math.round(w / 36));
  const box = (s) => {
    const t = new Float32Array(w * h); const d = new Float32Array(w * h); const span = rad * 2 + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -rad; x <= rad; x++) sum += s[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { t[y * w + x] = sum / span; sum += s[y * w + Math.min(w - 1, x + rad + 1)] - s[y * w + Math.max(0, x - rad)]; }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -rad; y <= rad; y++) sum += t[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { d[y * w + x] = sum / span; sum += t[Math.min(h - 1, y + rad + 1) * w + x] - t[Math.max(0, y - rad) * w + x]; }
    }
    return d;
  };
  const bg = box(gray);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;

  const read = M.readPage(c, w, h);
  const notes = M.notesInOrder(read);
  const spaces = read.staves.map((s) => s.space * h).sort((a, b) => a - b);
  const space = spaces[Math.floor((spaces.length - 1) / 2)];

  // ---- the printed lines, found from the ink and nothing else ----------------

  // How inked each row is, over two columns that straddle the point asked about.
  //
  // TWO BANDS, NOT ONE. A single band centred on a notehead has the head's own
  // ink in the middle of it, which lifts the rows the head covers and can invent
  // a "line" where the head is. The head is about 1.3 spaces wide, so the bands
  // start 1.1 spaces out and run to 3.4, and the staff line — which runs the
  // whole width of the system — is in both of them.
  const NEAR = tune.near; const FAR = tune.far;
  const shareProfile = (mx, top, bottom) => {
    const cols = [];
    for (let x = Math.round(mx - space * FAR); x <= Math.round(mx - space * NEAR); x++) if (x >= 0 && x < w) cols.push(x);
    for (let x = Math.round(mx + space * NEAR); x <= Math.round(mx + space * FAR); x++) if (x >= 0 && x < w) cols.push(x);
    const prof = new Float32Array(bottom - top + 1);
    if (!cols.length) return prof;
    for (let y = top; y <= bottom; y++) {
      let n = 0;
      for (const x of cols) n += ink[y * w + x];
      prof[y - top] = n / cols.length;
    }
    return prof;
  };

  // A printed staff line is a THIN DARK RIDGE. A beam is a fat plateau.
  //
  // NOT A THRESHOLD, AND NOT A PROMINENCE EITHER — both were tried on this page
  // and the ink profile says why each fails. DUMPED at mark 4 of the Bach page
  // (343,301), a note above the stave, the five printed lines come out at
  //     308.5  0.93     320.5  0.86     333  0.53     345  0.34     356.5  1.00
  // — the same five lines, in one window, from 34% inked to 100%, because the
  // photograph is lit unevenly and the lower lines of this system are paler. A
  // bar at 0.55 keeps two of the five; a bar low enough to keep the 0.34 line
  // turns every stem and slur into a staff line. Prominence found all five and
  // then a thickness rule threw two of them away: line 333 sits on a broad hump
  // of slur and stem ink so its width at half prominence is 6 rows, and line
  // 356.5 is the row where a BEAM BEGINS — 356 to 371 sit flat at 0.60 — so its
  // width is 15. Both are real lines and both looked fat.
  //
  // So a line is found by its RIDGE instead: how much darker this row is than
  // the paper a third of a space above AND below it. A staff line is dark with
  // pale rows either side, and scores high however pale the line itself is. The
  // inside of a beam is dark with dark rows either side and scores ZERO — at row
  // 364 of that dump the profile reads 0.60 and its neighbours 0.595 and 0.60,
  // so the ridge is 0.00 and the beam is gone without any thickness rule at all.
  // The line where the beam BEGINS still scores 0.56, because only one of its
  // two neighbours is dark, which is exactly the line the thickness rule lost.
  const peaksIn = (prof, top, RIDGE = 0.13, MINV = 0.22) => {
    const n = prof.length;
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = (prof[Math.max(0, i - 1)] + 2 * prof[i] + prof[Math.min(n - 1, i + 1)]) / 4;
    // A third of a space out: far enough to be off the line, near enough that
    // the NEXT line up (a whole space away) is not what is being sampled.
    const k = Math.max(2, Math.round(space * 0.36));
    const ridge = new Float32Array(n);
    for (let i = 0; i < n; i++) ridge[i] = s[i] - (s[Math.max(0, i - k)] + s[Math.min(n - 1, i + k)]) / 2;
    const peaks = [];
    for (let i = 1; i < n - 1; i++) {
      if (ridge[i] < RIDGE || s[i] < MINV) continue;
      if (ridge[i] < ridge[i - 1] || ridge[i] < ridge[i + 1]) continue;
      if (ridge[i] === ridge[i - 1]) continue;               // report a plateau once
      let lo = i; while (lo > 0 && ridge[lo - 1] >= ridge[i] * 0.5) lo--;
      let hi = i; while (hi < n - 1 && ridge[hi + 1] >= ridge[i] * 0.5) hi++;
      let sum = 0; let wsum = 0;
      for (let q = lo; q <= hi; q++) { sum += ridge[q]; wsum += ridge[q] * (top + q); }
      peaks.push({ y: sum > 0 ? wsum / sum : top + i, rows: hi - lo + 1, strength: +s[i].toFixed(2), ridge: +ridge[i].toFixed(2) });
    }
    // two ridges closer together than half a space are one line seen twice
    peaks.sort((p, q) => p.y - q.y);
    const kept = [];
    for (const q of peaks) {
      const last = kept[kept.length - 1];
      if (last && q.y - last.y < space * 0.5) { if (q.ridge > last.ridge) kept[kept.length - 1] = q; continue; }
      kept.push(q);
    }
    return kept;
  };

  // FIVE evenly spaced lines fitted to those peaks.
  //
  // This is the part the old version did not have and the reason it was reading
  // the stave below. `peaks[peaks.length - 1]` is the lowest line in the window
  // whatever stave it belongs to; a five-line comb can only be satisfied by five
  // lines that are actually a stave, because the gap between two staves is four
  // or five spaces and no comb spans it.
  const fitCombs = (peaks) => {
    const combs = [];
    for (let i = 0; i < peaks.length; i++) {
      for (let j = i + 1; j < peaks.length; j++) {
        for (let k = 1; k <= 4; k++) {
          const p = (peaks[j].y - peaks[i].y) / k;
          if (p < space * 0.72 || p > space * 1.4) continue;
          for (let r = 0; r < 5; r++) {           // peaks[i] is line r of the five
            const top = peaks[i].y - r * p;
            if (top < peaks[0].y - p * 0.5) continue;
            const hit = [];
            let ok = 0;
            for (let n = 0; n < 5; n++) {
              const wantY = top + n * p;
              let best = null; let bd = p * 0.28;
              for (const q of peaks) { const d = Math.abs(q.y - wantY); if (d < bd) { bd = d; best = q; } }
              // MEASURED AND REVERTED: A FAINT RIDGE MAY NOT FILL IN A LINE.
              //
              // 108 of 319 Bach marks came back 'no comb' because one of the
              // five lines was under a beam or simply pale — the dump at mark 4
              // has a line 34% inked next to one at 100% — so a second, much
              // weaker peak list (ridge 0.05, ink 0.10) was allowed to supply a
              // line the strong list had missed. Coverage went 50.8% to 69.9%
              // and THE HARNESS STARTED LYING: of the first 32 marks, whose
              // steps the music already gives, it answered 20 and got 17. Marks
              // 25, 27 and 28 came back exactly two steps out — one whole space,
              // the comb sliding onto a stem end or a beam edge that a faint
              // peak was happy to call a line. A harness that flatters or
              // maligns the reader is worse than none, so this is gone and the
              // coverage stays at half the page.
              hit.push(best ? best.y : null);
              if (best) ok++;
            }

            if (ok < Number(tune.hits)) continue;
            // A COMB MISSING AN EDGE LINE CAN SLIDE, AND DOES.
            //
            // MEASURED at mark 11 of the Bach page (575,305): the top line of
            // that system was not found, four lines were, and the comb happily
            // matched them as lines 1-4 and invented a fifth BELOW the stave.
            // Its bottom line came out a whole space low and the step came out
            // 10 where the music says 8 — this file's own error, reported as
            // the reader's. When the missing line is an INTERIOR one the comb is
            // pinned at both ends and cannot slide, so that is allowed and this
            // is not.
            if (!hit[0] || !hit[4]) continue;
            // least squares over the lines that were really found, so the comb
            // ends up on the ink rather than on the pair it was seeded from
            let sn = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
            for (let n = 0; n < 5; n++) if (hit[n] != null) { sn++; sx += n; sy += hit[n]; sxx += n * n; sxy += n * hit[n]; }
            const denom = sn * sxx - sx * sx;
            const pitch = denom ? (sn * sxy - sx * sy) / denom : p;
            const y0 = (sy - pitch * sx) / sn;
            if (pitch < space * 0.72 || pitch > space * 1.4) continue;
            let err = 0;
            for (let n = 0; n < 5; n++) if (hit[n] != null) err = Math.max(err, Math.abs(hit[n] - (y0 + pitch * n)));
            // HOW SQUARELY THE FIVE LINES REALLY ARE EVENLY SPACED, which is
            // what separates a stave from five pieces of ink that happen to be
            // roughly a space apart. MEASURED on the Bach page: the right comb
            // fits its peaks to 0.14-0.33px, and every rival comb built out of
            // beams and stems below the stave fits to 1.1-1.9px. At a 12px space
            // this cut takes the first and refuses all of the second.
            if (err > pitch * 0.14) continue;
            combs.push({ y0, pitch, ok, err, lines: [0, 1, 2, 3, 4].map((n) => y0 + pitch * n) });
          }
        }
      }
    }
    // one entry per distinct stave: same y0 to within a third of a space
    combs.sort((a, b) => (b.ok - a.ok) || (a.err - b.err));
    const kept = [];
    // ONE ENTRY PER STAVE. Two combs whose top lines are within half a space of
    // each other are two descriptions of the same five printed lines — an
    // earlier draft treated them as rivals whenever their pitch differed and
    // refused 45 marks of the Bach page as 'two staves' that had only one.
    for (const cb of combs) if (!kept.some((k) => Math.abs(k.y0 - cb.y0) < space * 0.5)) kept.push(cb);
    return kept;
  };

  // Every five-line comb the ink near this point will support.
  //
  // NO CHOICE IS MADE HERE, and that is the point. Three separate attempts to
  // pick the right comb from one window alone are recorded above and below this
  // function and all three failed the same way: the stave, a ledger line and a
  // beam edge are all just ridges, and in a window the size of a stave there is
  // usually more than one honest way to read five of them as five lines. The
  // choice is made across a whole system instead — see `consensus`.
  const combsAt = (mx, my) => {
    const top = Math.max(0, Math.round(my - space * 7));
    const bottom = Math.min(h - 1, Math.round(my + space * 7));
    if (bottom - top < space * 6) return { why: 'off page', combs: [] };
    const prof = shareProfile(mx, top, bottom);
    const peaks = peaksIn(prof, top);
    if (peaks.length < 5) return { why: 'no lines', combs: [] };
    const combs = fitCombs(peaks).filter((cb) => my > cb.lines[0] - cb.pitch * 4 && my < cb.lines[4] + cb.pitch * 4);
    if (!combs.length) return { why: 'no comb', combs: [] };
    return { combs };
  };

  // WHICH of those combs is the printed stave — decided by the SYSTEM, not by
  // the window.
  //
  // A printed stave sags smoothly across a page; it does not jump a whole space
  // between one notehead and the next. So every mark on a system offers its
  // candidates, a quadratic in x is fitted through them, and each mark then
  // takes the candidate that lies on that curve. A comb that has slid one line
  // onto a ledger line is a space off the curve every one of its neighbours
  // agrees on, and it loses.
  //
  // THE THREE THINGS THIS REPLACES, all measured on the Bach page and all worse:
  //   · nearest comb to the mark — 50.8% of marks answered, and the drift table
  //     it produced had ±2.0-step outliers on four systems, which is one whole
  //     space: the harness confirming the reader's bug with a bug of its own.
  //   · demand each line be inked ten spaces out, since a stave line runs the
  //     system and a ledger line does not. It kills the outliers (staff 4's
  //     swing goes 4.00 to 0.16) and cannot be calibrated: this page's first
  //     system is paler than its last, so the bar that keeps system 1 lets
  //     slides through elsewhere and the bar that stops them refuses 29 of the
  //     32 marks whose steps the music already gives.
  //   · refuse any comb with a SIXTH ridge one space beyond either end. Beams
  //     and stem ends supply that sixth ridge constantly: 115 of 319 marks
  //     refused, still 3 outliers left.
  // Only the system-wide fit both keeps the coverage and removes the slides.
  const consensus = (marks) => {
    // x is normalised to the page so the quadratic's coefficients stay sane
    const fit = (pts) => {
      // least squares c = a + b·x + d·x²
      let n = 0; const S = new Array(6).fill(0); const T = new Array(3).fill(0);
      for (const { x, c } of pts) {
        const u = x / w; const v = [1, u, u * u];
        n++;
        for (let i = 0; i < 3; i++) { T[i] += v[i] * c; for (let j = 0; j < 3; j++) S[i * 3 + j] = (S[i * 3 + j] ?? 0) + v[i] * v[j]; }
      }
      if (n < 4) return null;
      // 3x3 solve
      const A = [[S[0], S[1], S[2], T[0]], [S[3], S[4], S[5], T[1]], [S[6], S[7], S[8], T[2]]];
      for (let i = 0; i < 3; i++) {
        let piv = i;
        for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
        if (Math.abs(A[piv][i]) < 1e-9) return null;
        [A[i], A[piv]] = [A[piv], A[i]];
        for (let k = 0; k < 3; k++) {
          if (k === i) continue;
          const f = A[k][i] / A[i][i];
          for (let j = i; j < 4; j++) A[k][j] -= f * A[i][j];
        }
      }
      const co = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
      return (x) => co[0] + co[1] * (x / w) + co[2] * (x / w) * (x / w);
    };
    // the middle line of a comb is what is tracked: it is the least affected by
    // an error in the spacing
    // SEEDED FROM THE MODEL, then left to the ink and its neighbours.
    //
    // Seeding on the best-fitting comb instead was measured and is worse: at
    // mark 28 of the Bach page the slid comb — the stave's lower four lines and
    // a beam edge below them — fits its own five ridges BETTER than the printed
    // stave does, because a beam edge is a harder edge than a pale printed line.
    // The seed only says which of two readings a whole space apart to start
    // from; every position, spacing and step below is the ink's.
    let chosen = marks.map((m) => {
      let best = null; let bd = Infinity;
      for (const cb of m.combs) { const d = Math.abs((cb.y0 + 2 * cb.pitch) - m.mid); if (d < bd) { bd = d; best = cb; } }
      return best;
    });
    let curve = null;
    for (let pass = 0; pass < 6; pass++) {
      const pts = [];
      for (let i = 0; i < marks.length; i++) if (chosen[i]) pts.push({ x: marks[i].x, c: chosen[i].y0 + 2 * chosen[i].pitch });
      if (pts.length < 5) return { curve: null, chosen: marks.map(() => null) };
      // drop the worst tenth so one slid comb cannot bend the curve
      let f = fit(pts);
      if (!f) return { curve: null, chosen: marks.map(() => null) };
      const res = pts.map((pt) => Math.abs(pt.c - f(pt.x))).sort((p, q) => p - q);
      const cut = Math.max(space * 0.3, res[Math.floor(res.length * 0.8)]);
      f = fit(pts.filter((pt) => Math.abs(pt.c - f(pt.x)) <= cut)) ?? f;
      curve = f;
      const next = marks.map((m) => {
        let best = null; let bd = space * 0.6;
        for (const cb of m.combs) {
          const d = Math.abs((cb.y0 + 2 * cb.pitch) - f(m.x));
          if (d < bd) { bd = d; best = cb; }
        }
        return best;
      });
      const same = next.every((cb, i) => cb === chosen[i]);
      chosen = next;
      if (same) break;
    }
    return { curve, chosen };
  };

  // The notehead's own centre, from the ink, as a CHECK on the hand mark.
  //
  // The mark is a human click and can be a fifth of a space off the middle of
  // the head it means. That does not matter for finding notes, which is what the
  // truth files were made for, but a step is decided at half a space so it can
  // matter here. This is computed and REPORTED next to the answer from the mark
  // itself; it is not substituted for it, because the mark is the independent
  // thing and this is not.
  const headCentre = (mx, my) => {
    const x0 = Math.max(0, Math.round(mx - space * 0.62)); const x1 = Math.min(w - 1, Math.round(mx + space * 0.62));
    const y0 = Math.max(0, Math.round(my - space * 1.1)); const y1 = Math.min(h - 1, Math.round(my + space * 1.1));
    const prof = [];
    for (let y = y0; y <= y1; y++) { let n = 0; for (let x = x0; x <= x1; x++) n += ink[y * w + x]; prof.push(n / (x1 - x0 + 1)); }
    let peak = 0;
    for (const v of prof) peak = Math.max(peak, v);
    if (peak < 0.55) return null;
    const bar = peak * 0.6;
    let i = Math.round(my) - y0;
    if (prof[i] < bar) { let d = 1; while (d < prof.length && !(prof[i - d] >= bar || prof[i + d] >= bar)) d++; if (d >= prof.length) return null; i = prof[i - d] >= bar ? i - d : i + d; }
    let a = i; while (a > 0 && prof[a - 1] >= bar) a--;
    let b = i; while (b < prof.length - 1 && prof[b + 1] >= bar) b++;
    if (b - a > space * 1.6) return null;      // a beam or a stem run, not a head
    let sum = 0; let wsum = 0;
    for (let k = a; k <= b; k++) { sum += prof[k]; wsum += prof[k] * (y0 + k); }
    return wsum / sum;
  };

  // ---- every mark ------------------------------------------------------------

  // The reader's own answer for this mark, paired the way truth-check pairs
  // them: greedy nearest first, within half a space. `paired` therefore means
  // the same thing here as it does in bench, and a mark with no reading is a
  // note the reader missed rather than a mark this file could not look up.
  const near = space * 0.5;
  const pairs = [];
  for (let ti = 0; ti < want.length; ti++) {
    for (let fi = 0; fi < notes.length; fi++) {
      const d = Math.hypot(notes[fi].x * w - want[ti].x * w, notes[fi].y * h - want[ti].y * h);
      if (d < near) pairs.push({ ti, fi, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const forMark = new Array(want.length).fill(null);
  const takenF = new Set();
  for (const p of pairs) {
    if (forMark[p.ti] != null || takenF.has(p.fi)) continue;
    forMark[p.ti] = p.fi; takenF.add(p.fi);
  }

  const FRAC = 0.32;

  // Which system each mark belongs to. THE READER IS ASKED FOR THE STAVE'S
  // IDENTITY AND FOR NOTHING ELSE — not where its lines are, only which group of
  // marks belong together — because the ten staves are found 10/10 on every one
  // of these pages and grouping is not the thing under test. Every number below
  // comes from the ink.
  const whichStaff = (my) => {
    let best = 0; let bd = Infinity;
    for (const [i, st] of read.staves.entries()) {
      const mid = (st.lines[0][Math.floor(st.lines[0].length / 2)] + st.lines[4][Math.floor(st.lines[4].length / 2)]) / 2 * h;
      if (Math.abs(mid - my) < bd) { bd = Math.abs(mid - my); best = i; }
    }
    return best;
  };

  // THE ONE PLACE THE READER'S GEOMETRY IS USED, AND EXACTLY HOW FAR.
  //
  // A window the size of a stave usually holds more than one honest way to read
  // five ridges as five lines, and the wrong one is always exactly ONE SPACE
  // out — the comb takes the stave's lower four lines and a beam edge below
  // them, or its upper four and a ledger line above. Looked at, at mark 28 of
  // the Bach page (1178,286): the printed lines run 660, 780, 900, 1020, 1140 in
  // the drawn crop and the comb had taken 780 through to an invented 1260. Two
  // steps out, in a harness built to catch a one-step bug.
  //
  // Nothing in one window separates those two readings, and three attempts that
  // used only the ink are recorded above. So the candidate is required to lie
  // within THREE QUARTERS OF A SPACE of where the reader's model says the stave
  // is. That is a real limitation and it is stated rather than hidden: THIS FILE
  // CANNOT SEE A MODEL MORE THAN 1.5 STEPS OUT. It can see anything smaller,
  // which is the whole of the bug being chased — and the report prints the
  // largest offset it actually found, so it is visible when the gate starts to
  // bind. On the Bach page the largest is 0.9 steps against a gate of 1.5.
  //
  // What the gate does NOT do is decide the answer. Where the lines are, how far
  // apart they are and which side of one the notehead sits are all read off the
  // ink; the model is asked only to break a tie between two readings a whole
  // space apart, and it is checked afterwards against 32 steps that come from
  // the music and not from the page.
  const GATE = tune.gate;
  let gateUsed = 0;
  const modelMid = (si, mx) => {
    const st = read.staves[si];
    const one = (n) => st.lines[n][Math.min(st.lines[n].length - 1, Math.max(0, Math.floor((mx / w) * st.lines[n].length)))] * h;
    return (one(0) + one(4)) / 2;
  };
  const marks = want.map((t, i) => {
    const mx = t.x * w; const my = t.y * h;
    const found = combsAt(mx, my);
    const si = whichStaff(my);
    const mid = modelMid(si, mx);
    const inside = found.combs.filter((cb) => Math.abs((cb.y0 + 2 * cb.pitch) - mid) <= space * GATE);
    if (inside.length < found.combs.length) gateUsed++;
    return { i, x: mx, y: my, combs: inside, why: inside.length ? null : (found.why ?? 'no comb near the model'), staff: si, mid };
  });
  const curves = [];
  for (const [si] of read.staves.entries()) {
    const mine = marks.filter((m) => m.staff === si);
    const { curve, chosen } = consensus(mine);
    curves[si] = curve;
    mine.forEach((m, k) => { m.pick = chosen[k]; if (!m.pick && !m.why) m.why = m.combs.length ? 'off the system' : 'no comb'; });
  }

  const rows = [];
  for (const m of marks) {
    const got = forMark[m.i] == null ? null : notes[forMark[m.i]];
    const row = { i: m.i, x: Math.round(m.x), y: Math.round(m.y), readStep: got ? got.step : null, paired: !!got, staff: m.staff };
    if (!m.pick) { row.why = m.why ?? 'no comb'; rows.push(row); continue; }
    const cb = m.pick;
    const raw = (cb.lines[4] - m.y) / (cb.pitch / 2);
    const frac = raw - Math.round(raw);
    row.pitchPx = +cb.pitch.toFixed(2);
    row.lineHits = cb.ok;
    row.exact = +raw.toFixed(2);
    row.frac = +frac.toFixed(2);
    row.rivals = m.combs.length;
    // HOW FAR THE READER'S MODEL IS FROM THE PRINT AT THIS EXACT NOTE, in steps.
    // This is what turns a count of wrong notes into an explanation: a note read
    // one step high with the model half a space low under it has been named
    // wrong BY THE MODEL, and one read wrong where the model is on the print has
    // been named wrong by something else.
    {
      const st = read.staves[m.staff];
      const one = (n) => st.lines[n][Math.min(st.lines[n].length - 1, Math.max(0, Math.floor((m.x / w) * st.lines[n].length)))] * h;
      let sum = 0;
      for (let n = 0; n < 5; n++) sum += one(n) - cb.lines[n];
      row.modelOff = +((sum / 5) / (cb.pitch / 2)).toFixed(2);
    }
    const hc = headCentre(m.x, m.y);
    if (hc != null) {
      const rawH = (cb.lines[4] - hc) / (cb.pitch / 2);
      row.inkExact = +rawH.toFixed(2);
      row.inkStep = Math.round(rawH);
      row.inkFrac = +(rawH - Math.round(rawH)).toFixed(2);
      row.inkDy = +(hc - m.y).toFixed(2);
    }
    // A mark sitting exactly between a line and the space beside it is a coin
    // toss and this says so rather than rounding one way and calling it truth.
    // Both readings of the head's position have to agree as well — the hand
    // click and the head's own ink centre — because when they do not, one of
    // them is a fifth of a space out and there is no saying which.
    // TWO READINGS OF WHERE THE HEAD IS, AND BOTH HAVE TO AGREE.
    //
    // The hand click and the head's own ink centre are independent estimates of
    // the same thing and they land a pixel apart on average (median 1.02px on
    // the Bach page, 0.65 on the Concerto). At a 10px staff space a pixel is a
    // fifth of a step, so requiring the CLICK alone to sit within a third of a
    // step of a line refused 120 of the Concerto's 328 marks — most of them
    // notes whose position the ink is perfectly clear about. So the rule is:
    // the two must round to the same step, and at least one of them must sit
    // squarely on it. Where they disagree the answer really is a coin toss and
    // this refuses, which happens 21 times on that page.
    if (row.inkStep != null && row.inkStep !== Math.round(raw)) { row.why = 'mark and ink differ'; rows.push(row); continue; }
    if (Math.abs(frac) > FRAC && !(row.inkFrac != null && Math.abs(row.inkFrac) <= FRAC)) { row.why = 'ambiguous'; rows.push(row); continue; }
    row.trueStep = Math.round(raw);
    rows.push(row);
  }

  // ---- the model against the printed lines, which is the bug itself ----------
  //
  // Not the dead residual test. That one measured HEADS against the MODEL's own
  // lines and cannot see a model that is uniformly out. This measures the
  // MODEL'S LINES against the lines found here from the ink, at points across
  // each system, and a number here is the number of steps every note at that x
  // is named wrong by.
  const drift = read.staves.map((st, si) => {
    const modelLine = (n, mx) => {
      const arr = st.lines[n];
      return arr[Math.min(arr.length - 1, Math.max(0, Math.floor((mx / w) * arr.length)))] * h;
    };
    // sampled at the marks themselves, because that is where the page has notes
    // and therefore where a wrong line costs a wrong pitch
    const at = [];
    for (const m of marks) {
      if (m.staff !== si || !m.pick) continue;
      let sum = 0;
      for (let n = 0; n < 5; n++) sum += (modelLine(n, m.x) - m.pick.lines[n]);
      at.push({ x: Math.round(m.x), steps: (sum / 5) / (m.pick.pitch / 2), pitchPx: m.pick.pitch });
    }
    at.sort((p, q) => p.x - q.x);
    // one number per tenth of the page width, so the row reads left to right
    const cells = [];
    for (let k = 0; k < 10; k++) {
      const lo = w * (k / 10); const hi = w * ((k + 1) / 10);
      // A CELL NEEDS THREE MARKS TO BE PRINTED. One mark is one comb, and a
      // single comb that has slid a line prints as a whole extra step of drift —
      // Bach's staff 8, which carries six marks in the ledger passage, printed
      // +1.17 next to -0.75 in the neighbouring tenth of the page. No sagging
      // sheet of paper does that; a slid comb does.
      const here = at.filter((p) => p.x >= lo && p.x < hi).map((p) => p.steps).sort((p, q) => p - q);
      cells.push(here.length >= 3 ? here[here.length >> 1] : null);
    }
    const seen = cells.filter((c) => c != null);
    return {
      staff: si, cells: cells.map((c) => (c == null ? null : +c.toFixed(2))), n: at.length,
      swing: seen.length ? +(Math.max(...seen) - Math.min(...seen)).toFixed(2) : 0,
      modelPitch: +(st.space * h).toFixed(2),
      printPitch: at.length ? +(at.map((p) => p.pitchPx).sort((p, q) => p - q)[at.length >> 1]).toFixed(2) : null,
    };
  });

  // ---- pictures, so this can be checked by eye ------------------------------
  const pics = [];
  for (const ti of draw) {
    const t = want[ti]; if (!t) continue;
    const mx = t.x * w; const my = t.y * h;
    const found = { comb: marks[ti]?.pick ?? null };
    const P = Math.round(space * 4.5); const Z = 10;
    const cc = document.createElement('canvas');
    cc.width = P * 2 * Z; cc.height = P * 2 * Z;
    const g = cc.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#fff'; g.fillRect(0, 0, cc.width, cc.height);
    g.drawImage(c, mx - P, my - P, P * 2, P * 2, 0, 0, cc.width, cc.height);
    if (found.comb) {
      g.strokeStyle = 'rgba(18,184,134,0.9)'; g.lineWidth = 2;
      for (const ly of found.comb.lines) {
        g.beginPath(); g.moveTo(0, (ly - (my - P)) * Z); g.lineTo(cc.width, (ly - (my - P)) * Z); g.stroke();
      }
    }
    // the reader's model, for the same place
    let st = null; let bd = Infinity;
    for (const s of read.staves) {
      const mid = (s.lines[0][0] + s.lines[4][0]) / 2 * h;
      if (Math.abs(mid - my) < bd) { bd = Math.abs(mid - my); st = s; }
    }
    if (st) {
      g.strokeStyle = 'rgba(224,36,94,0.9)'; g.lineWidth = 2;
      for (const arr of st.lines) {
        const ly = arr[Math.min(arr.length - 1, Math.max(0, Math.floor((mx / w) * arr.length)))] * h;
        g.beginPath(); g.moveTo(0, (ly - (my - P)) * Z); g.lineTo(cc.width, (ly - (my - P)) * Z); g.stroke();
      }
    }
    g.fillStyle = '#1c7ed6';
    g.beginPath(); g.arc(P * Z, P * Z, 1.4 * Z, 0, Math.PI * 2); g.fill();
    pics.push({ i: ti, x: Math.round(mx), y: Math.round(my), png: cc.toDataURL('image/png').split(',')[1] });
  }

  // The raw ink profile at a mark, so the peak finder can be calibrated against
  // what the page actually gives rather than against what a threshold assumes.
  const dumps = [];
  for (const ti of dump) {
    const t = want[ti]; if (!t) continue;
    const mx = t.x * w; const my = t.y * h;
    const top = Math.max(0, Math.round(my - space * 7));
    const bottom = Math.min(h - 1, Math.round(my + space * 7));
    const prof = shareProfile(mx, top, bottom);
    dumps.push({ i: ti, x: Math.round(mx), y: Math.round(my), top, prof: [...prof].map((v) => +v.toFixed(2)),
      peaks: peaksIn(prof, top).map((q) => ({ y: +q.y.toFixed(2), rows: q.rows, strength: q.strength })),
      combs: fitCombs(peaksIn(prof, top)).map((cb) => ({ y0: +cb.y0.toFixed(2), pitch: +cb.pitch.toFixed(2), ok: cb.ok, err: +cb.err.toFixed(2) })) });
  }
  return { rows, drift, pics, dumps, gateUsed, gate: GATE, space: +space.toFixed(1), notes: notes.length, w, h };
}, { b64, want: truth.notes, pdf: /\.pdf$/i.test(file), draw, dump, tune: { near: Number(process.env.STEP_NEAR ?? 1.1), far: Number(process.env.STEP_FAR ?? 3.4), hits: Number(process.env.STEP_HITS ?? 4), gate: Number(process.env.STEP_GATE ?? 0.9) } });

await browser.close();

const R = out.rows;
const said = R.filter((r) => r.trueStep != null);
const paired = said.filter((r) => r.paired);
const wrong = paired.filter((r) => r.readStep !== r.trueStep);
const by = {};
for (const r of wrong) { const d = r.readStep - r.trueStep; by[d] = (by[d] ?? 0) + 1; }
const why = {};
for (const r of R) if (r.trueStep == null) why[r.why] = (why[r.why] ?? 0) + 1;

console.log(`\n${basename(file)} — the STEP, against the PRINTED lines around each mark`);
console.log(`  ${out.w}x${out.h} · staff space ${out.space}px · ${R.length} marks · reader found ${out.notes} notes\n`);
console.log(`  COVERAGE`);
console.log(`    printed step read      ${said.length}/${R.length}  ${(100 * said.length / R.length).toFixed(1)}%`);
console.log(`    …and paired with a reading ${paired.length}`);
console.log(`    refused                ${R.length - said.length}  ${JSON.stringify(why)}`);
console.log(`\n  THE READER, on the marks where the page will say — A WRONG STEP IS A WRONG NOTE,`);
console.log(`  a second out, whatever the clef and the key have done with it`);
console.log(`    step RIGHT   ${paired.length - wrong.length}  ${(100 * (paired.length - wrong.length) / Math.max(1, paired.length)).toFixed(1)}%`);
console.log(`    step WRONG   ${wrong.length}   by: ${JSON.stringify(by)}`);

// How squarely the marks sit on their lines. If this file is measuring real
// geometry the fractional part piles up near zero; if it is measuring noise it
// is flat. It is the difference between a harness and a random number.
const hist = {};
for (const r of R) if (r.frac != null) { const k = (Math.floor(Math.abs(r.frac) * 10) / 10).toFixed(1); hist[k] = (hist[k] ?? 0) + 1; }
console.log(`\n  |fraction of a step off a line or a space| — near 0 means this is geometry`);
console.log(`    ${Object.entries(hist).sort().map(([k, v]) => `${k}:${v}`).join('  ')}`);
const agree = R.filter((r) => r.trueStep != null && r.inkStep != null);
console.log(`  the hand mark vs the notehead's own ink centre: agree on ${agree.filter((r) => r.inkStep === r.trueStep).length}/${agree.length}`
  + `  (median |dy| ${(agree.length ? agree.map((r) => Math.abs(r.inkDy)).sort((a, b) => a - b)[agree.length >> 1] : 0).toFixed(2)}px)`);

if (known) {
  // THE ONLY CHECK THAT SAYS WHETHER THIS FILE CAN BE BELIEVED. These steps come
  // from the music, not from the page — if the harness cannot reproduce steps
  // whose answer is already known, no number it prints about the other marks
  // means anything.
  const n = known.length;
  const mine = R.slice(0, n);
  const hit = mine.filter((r, i) => r.trueStep === known[i]).length;
  const reallyRead = mine.filter((r) => r.trueStep != null).length;
  console.log(`\n  AGAINST STEPS KNOWN FROM THE MUSIC — the first ${n} marks`);
  console.log(`    this harness   ${hit}/${n} right, ${reallyRead} of them read at all`);
  const rHit = mine.filter((r, i) => r.readStep === known[i]).length;
  console.log(`    the reader     ${rHit}/${n} right`);
  console.log(`    known   ${known.join(' ')}`);
  console.log(`    page    ${mine.map((r) => (r.trueStep ?? '·')).join(' ')}`);
  console.log(`    reader  ${mine.map((r) => (r.readStep ?? '·')).join(' ')}`);
  const bad = mine.map((r, i) => ({ r, i })).filter(({ r, i }) => r.trueStep !== known[i]);
  for (const { r, i } of bad.slice(0, 12)) {
    console.log(`      mark ${i} at ${r.x},${r.y}: known ${known[i]}, page says ${r.trueStep ?? r.why} (${r.exact ?? '-'}`
      + `, ink ${r.inkExact ?? '-'}, pitch ${r.pitchPx ?? '-'}px, lines ${r.lineHits ?? '-'}/5)`);
  }
}

const worst = Math.max(0, ...out.drift.flatMap((st) => st.cells.filter((c) => c != null).map(Math.abs)));
const blocked = R.filter((r) => r.why === 'no comb near the model').length;
console.log(`\n  the tie-break gate: it refused ${blocked} marks outright, having nothing within +-${(out.gate * 2).toFixed(1)} steps of the model`);
console.log(`  the largest offset it did accept is ${worst.toFixed(2)} steps, against a gate of ${(out.gate * 2).toFixed(1)}`
  + `${worst > out.gate * 2 * 0.75 ? '  <-- CLOSE TO THE GATE: this page may hold offsets this file cannot see' : ''}`);
console.log(`\n  THE MODEL'S FIVE LINES vs THE PRINTED ONES, in steps, at the marks`);
console.log(`  (+ means the model sits BELOW the print, so every note there reads HIGH)`);
console.log(`    system   ${[0,1,2,3,4,5,6,7,8,9].map((k) => `.${k}`.padStart(6)).join('')}    swing   space model/print`);
for (const st of out.drift) {
  const cells = st.cells.map((c) => (c == null ? '     ·' : ((c >= 0 ? ' ' : '') + c.toFixed(2)).padStart(6)));
  console.log(`    staff ${String(st.staff).padStart(2)} ${cells.join('')}   ${st.swing.toFixed(2)}    ${st.modelPitch} / ${st.printPitch ?? '·'}  (${st.n} marks)`);
}

// WHAT IS TO BLAME. A note the reader reads one step high, at a place where its
// model sits half a space below the print, is a note the MODEL got wrong: the
// ring is on the head and the lines under it are not where the page prints them.
// A note read wrong where the model is square on the print is something else —
// the head's own y, or a head that genuinely sits between a line and a space.
const blame = { model: 0, other: 0 };
for (const r of wrong) {
  if (r.modelOff != null && Math.sign(r.modelOff) === Math.sign(r.readStep - r.trueStep) && Math.abs(r.modelOff) >= 0.3) blame.model++;
  else blame.other++;
}
// IS THE PART OF THE PAGE THIS FILE CANNOT READ THE SAME AS THE REST?
//
// It is not, and the answer runs the wrong way, so it is printed rather than
// left to be assumed. A refusal is not a coin toss: 'no lines' and 'no comb'
// happen where the ink is hardest to read, and on a photographed page that is
// the same place the stave model is worst. So the marks this file answers are
// drawn from the EASIER part of the page and the figure above is an OPTIMISTIC
// bound on the reader, not an unbiased estimate of it.
const cellAt = (r) => {
  const st = out.drift[r.staff];
  if (!st) return null;
  const k = Math.min(9, Math.max(0, Math.floor((r.x / out.w) * 10)));
  for (let d = 0; d < 10; d++) {
    for (const j of [k - d, k + d]) if (j >= 0 && j < 10 && st.cells[j] != null) return st.cells[j];
  }
  return null;
};
const bands = [[0, 0.3], [0.3, 0.5], [0.5, 99]];
console.log(`\n  WHERE THE REFUSALS FALL — a refusal is not a coin toss, and this says which way it leans`);
console.log(`    |model off|      marks   answered   refused   reader wrong (of answered)`);
for (const [lo, hi] of bands) {
  const here = R.filter((r) => { const c = cellAt(r); return c != null && Math.abs(c) >= lo && Math.abs(c) < hi; });
  const ans = here.filter((r) => r.trueStep != null);
  const bad = ans.filter((r) => r.paired && r.readStep !== r.trueStep);
  console.log(`    ${lo.toFixed(1)} to ${hi > 90 ? 'up ' : hi.toFixed(1)}      ${String(here.length).padStart(5)}`
    + `      ${String(ans.length).padStart(5)}     ${String(here.length - ans.length).padStart(5)}`
    + `        ${ans.length ? (100 * bad.length / ans.length).toFixed(1) + '%' : '·'}`);
}

// …and what the page-wide figure looks like once that lean is taken out. Each
// band's answered marks stand in for its refused ones, which assumes only that a
// refusal is like its neighbours — a far weaker assumption than the one the bare
// percentage makes, which is that a refusal is like the page's average.
let est = 0; let seen = 0;
for (const [lo, hi] of bands) {
  const here = R.filter((r) => { const c = cellAt(r); return c != null && Math.abs(c) >= lo && Math.abs(c) < hi; });
  const ans = here.filter((r) => r.trueStep != null);
  const bad = ans.filter((r) => r.paired && r.readStep !== r.trueStep);
  if (!ans.length) continue;
  est += here.length * (bad.length / ans.length); seen += here.length;
}
console.log(`    reweighted over the whole page: about ${(100 * (1 - est / Math.max(1, seen))).toFixed(1)}% of ${seen} marks read on the right step`);

console.log(`\n  WHAT IS TO BLAME for the ${wrong.length} wrong steps`);
console.log(`    the stave model, out from the print in the same direction   ${blame.model}`);
console.log(`    something else — model square on the print                  ${blame.other}`);

const bad = paired.filter((r) => r.readStep !== r.trueStep).slice(0, 14);
if (bad.length) {
  console.log(`\n  where the reader is out`);
  for (const r of bad) {
    console.log(`    ${String(r.x).padStart(4)},${String(r.y).padStart(4)}  printed ${String(r.trueStep).padStart(3)} (${r.exact})`
      + `  reader ${String(r.readStep).padStart(3)}   model off ${String(r.modelOff ?? '·').padStart(5)} steps  lines ${r.lineHits}/5`);
  }
}

for (const d of out.dumps ?? []) {
  console.log(`\n  ink profile at mark ${d.i} (${d.x},${d.y}), rows from y=${d.top}`);
  console.log(`    peaks ${JSON.stringify(d.peaks)}`);
  console.log(`    combs ${JSON.stringify(d.combs)}`);
  for (let k = 0; k < d.prof.length; k++) {
    const v = d.prof[k];
    console.log(`    ${String(d.top + k).padStart(5)} ${v.toFixed(2)} ${'#'.repeat(Math.round(v * 40))}`);
  }
}

for (const p of out.pics) {
  const path = `${process.env.STEP_OUT ?? '/tmp'}/step-${p.i}-${p.x}-${p.y}.png`;
  await writeFile(path, Buffer.from(p.png, 'base64'));
  console.log(`  drew ${path}`);
}
