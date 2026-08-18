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
  function drawSystem(g, { space, x0, W, top, kind, warp, tilt, sharps = 0 }) {
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
    // The KEY SIGNATURE, and it is the whole reason this benchmark was wrong.
    //
    // Without it every page here carried a clef standing alone in clean paper,
    // which is not what an engraver sets and not what the reader meets: on a
    // real page of the Bach the sampling band lands on the G-major sharp on
    // nine systems in ten. A suite that draws no signature cannot see that, so
    // its 12/12 was reporting on a page that does not exist.
    //
    // Sharps sit immediately right of the clef, in order, on fixed lines.
    for (let i = 0; i < sharps; i++) {
      const x = x0 + space * (3.0 + i * 0.9);
      // F then C, which is where a two-sharp signature puts them relative to
      // whichever clef is in force — close enough for the thing being tested,
      // which is that there is tall ink right beside the clef.
      const line = kind.name === 'treble' ? [0.5, 2][i] ?? 1 : [1, 2.5][i] ?? 1;
      g.fillText(glyph.sharp, x, lineY(line, x));
    }
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

  // The clef zone off the SPOILED page, using the READER'S OWN window rather
  // than a number repeated here. The window is asymmetric — short above the
  // stave, long below — and a harness that restates it as a symmetric 3
  // measures every extent adrift and then reports the reader as broken.
  const clefMod = await import('/src/analysis/scan-clef.js');
  const MARGIN = clefMod.MARGIN;
  const BELOW = clefMod.MARGIN_BELOW;
  function columnAt(canvas, { x, width, top, space }) {
    const w = Math.max(2, Math.round(width));
    const rows = Math.round(space * (4 + MARGIN + BELOW));
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
      drawSystem(g, { space, x0, W, top, kind, warp: 0.7, tilt: 0.004, sharps: 2 });
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
  const { readPage } = await import('/src/analysis/scan-read.js');
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
      drawSystem(g, { space, x0, W, top, kind, warp: 0.7, tilt: 0.004, sharps: 2 });
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

  // --- and the third block: A CLEF PRINTED PART WAY ALONG A SYSTEM ------
  //
  // WHY IT LIVES HERE. This file is the clef instrument: it already carries
  // real Bravura, already spoils a page the way a camera does, and already
  // reads one back through readPage end to end. A mid-system clef is a clef
  // question and it belongs beside the other two rather than in a script of its
  // own that nobody runs.
  //
  // WHAT IT MEASURES, and it is three things, not one:
  //
  //   READ      — a clef change is found and every note after it is NAMED in
  //               the new clef. Scored note for note against MIDI this file
  //               works out itself, so the truth is not borrowed from the
  //               arithmetic being tested.
  //   CONTROL   — the same music with no change, so a number is a delta.
  //   NEVER     — twenty-two pieces of furniture printed where the clef would
  //               be. THIS IS THE ONE THAT MATTERS. Every page in every other
  //               corpus in this project is in one clef per system, so a
  //               detector that fires on any of them renames notes on a page it
  //               has no business touching. The count must be zero and a
  //               non-zero count fails the build.
  const { notesInOrder } = await import('/src/analysis/scan-read.js');
  const midSystem = [];
  {
    // The truth, worked out here rather than imported. A clef names one line;
    // everything else is the diatonic pattern and an octave count.
    const DEG = [0, 2, 4, 5, 7, 9, 11];
    const BOTTOM = { bass: 43, tenor: 50, alto: 53, treble: 64 };
    const BOTTOM_DEGREE = { bass: 4, tenor: 1, alto: 3, treble: 2 };
    const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
    const midiOf = (step, clef, sharps) => {
      const alter = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < sharps; i++) alter[SHARP_ORDER[i]] = 1;
      const abs = BOTTOM_DEGREE[clef] + step;
      const d = ((abs % 7) + 7) % 7;
      const oct = Math.floor(abs / 7) - Math.floor(BOTTOM_DEGREE[clef] / 7);
      return BOTTOM[clef] + DEG[d] - DEG[BOTTOM_DEGREE[clef]] + oct * 12 + alter[d];
    };
    // Checked against the one note each clef names, because this table has been
    // written wrong twice in this project — once in scan-notes.js and once in
    // tools/study-check.mjs, both times for tenor, both times silently.
    const selfCheck = [
      // treble names G4 on the second line up (step 2); bass names F3 on the
      // fourth (step 6), which puts middle C a ledger line above at step 10;
      // tenor and alto name middle C itself, on the fourth and third lines.
      ['treble', 2, 67], ['bass', 6, 53], ['bass', 10, 60], ['tenor', 6, 60], ['alto', 4, 60],
    ].filter(([cl, st, want]) => midiOf(st, cl, 0) !== want);

    const CLEF_GLYPH = { treble: glyph.trebleClef, bass: glyph.bassClef, tenor: glyph.cClef, alto: glyph.cClef };
    const CLEF_AT = { treble: 3, bass: 1, tenor: 1, alto: 2 };
    const SHARP_STEPS = {
      treble: [8, 5, 9, 6, 3, 7, 4],
      bass: [6, 3, 7, 4, 1, 5, 2],
      // DERIVED: a tenor clef's bottom line is D3, degree 1, so the step
      // carrying F is (1 + s) % 7 === 3 — that is 2, and F C G D A E B up the
      // stave is 2 6 3 7 4 8 5.
      tenor: [2, 6, 3, 7, 4, 8, 5],
      alto: [7, 4, 8, 5, 2, 6, 3],
    };

    // One page: three systems, a head clef, eight notes, the thing under test
    // halfway along, eight more notes. `mid` is the clef change, `furniture` is
    // whatever else is being printed in its place.
    function drawMid({ space, head, mid, em, furniture, sharps }) {
      const W = Math.round(space * 55);
      const systems = 3;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Math.round(space * (10 + systems * 13 + 8));
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, c.height);
      g.fillStyle = '#111';
      const EM = space * 4;
      const lt = Math.max(1, space * 0.1);
      // BravuraTest, not Bravura: this file registers the face under its own
      // name, and a mid-system clef drawn in a font the page has never heard of
      // is a page with no clef on it at all — which is what the first run of
      // this block measured, and reported as the detector finding nothing.
      const put = (ch, x, y, size = EM) => {
        g.font = `${size}px BravuraTest`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y);
        return g.measureText(ch).width;
      };
      const wid = (ch, s = EM) => { g.font = `${s}px BravuraTest`; return g.measureText(ch).width; };
      const stepY = (base, st) => base + 4 * space - st * (space / 2);
      const truth = [];
      // Steps chosen to sit on and around the stave in both halves, so a wrong
      // clef shows up as a wrong pitch and never as a missing notehead.
      const TUNE = [0, 2, 4, 5, 7, 5, 4, 2];
      for (let s = 0; s < systems; s++) {
        const base = space * 8 + s * space * 13;
        for (let l = 0; l < 5; l++) g.fillRect(space * 2, base + l * space, W - space * 4, lt);
        g.fillRect(space * 2, base, lt * 1.2, space * 4);
        g.fillRect(W - space * 2.4, base, lt * 1.2, space * 4);
        let x = space * 3;
        x += put(CLEF_GLYPH[head], x, base + CLEF_AT[head] * space) + space * 0.5;
        for (let k = 0; k < sharps; k++) {
          x += put(glyph.sharp, x, stepY(base, SHARP_STEPS[head][k])) + space * 0.06;
        }
        x += space * 0.6;
        const startX = x + space;
        const usable = (W - space * 3.5) - startX;
        const half = usable / 2;
        const note = (cx, st, clef) => {
          const gw = wid(glyph.noteheadBlack);
          const y = stepY(base, st);
          put(glyph.noteheadBlack, cx - gw / 2, y);
          const up = st < 4;
          g.fillRect(up ? cx + gw / 2 - lt : cx - gw / 2, up ? y - space * 3.2 : y,
            Math.max(1, lt), space * 3.2);
          truth.push({ x: cx / W, y: y / c.height, midi: midiOf(st, clef, sharps), step: st });
        };
        const gap = half / (TUNE.length + 0.6);
        for (let i = 0; i < TUNE.length; i++) note(startX + gap * (i + 0.6), TUNE[i], head);
        let cx = startX + half;
        let used = 0;
        if (mid) used = put(CLEF_GLYPH[mid], cx, base + CLEF_AT[mid] * space, EM * em) + space * 0.4;
        else if (furniture) used = furniture(g, cx, base, space, put, wid, note);
        cx += used + space * 0.6;
        const gap2 = (usable - half - used - space) / (TUNE.length + 0.6);
        for (let i = 0; i < TUNE.length; i++) note(cx + gap2 * (i + 0.6), TUNE[i], mid ?? head);
      }
      return { canvas: c, truth };
    }

    // The furniture. Every one is tall, or symmetric about a staff line, or
    // both — and none of them is a clef. Drawn ON THE LINES as well as in the
    // spaces, because an accidental inflecting a note on a line has its waist
    // exactly where a C-clef's would.
    const acc = (ch, step) => (g, cx, base, space, put, wid, note) => {
      const stepY = base + 4 * space - step * (space / 2);
      const used = put(ch, cx, stepY);
      note(cx + used + space * 0.7, step, null);
      return used + space * 2.2;
    };
    const FURNITURE = [
      ...[0, 1, 2, 3, 4].map((l) => [`sharp on line ${l}`, acc(glyph.sharp, 8 - 2 * l)]),
      ...[0, 1, 2, 3, 4].map((l) => [`flat on line ${l}`, acc(glyph.flat, 8 - 2 * l)]),
      ...[1, 2, 3].map((l) => [`natural on line ${l}`, acc(glyph.natural, 8 - 2 * l)]),
      ['sharp in a space', acc(glyph.sharp, 5)],
      ['repeat barline, thick+thin+dots', (g, cx, base, space, put) => {
        g.fillRect(cx, base, space * 0.45, space * 4);
        g.fillRect(cx + space * 0.8, base, Math.max(1, space * 0.14), space * 4);
        put(glyph.repeatDots, cx + space * 1.2, base + space * 2);
        return space * 2.4;
      }],
      ['double barline', (g, cx, base, space) => {
        g.fillRect(cx, base, Math.max(1, space * 0.14), space * 4);
        g.fillRect(cx + space * 0.5, base, Math.max(1, space * 0.14), space * 4);
        return space;
      }],
      ['plain barline', (g, cx, base, space) => {
        g.fillRect(cx, base, Math.max(1, space * 0.14), space * 4);
        return space * 0.5;
      }],
      ['fermata over the stave', (g, cx, base, space, put) => put(glyph.fermata, cx, base - space * 1.2) + space * 0.4],
      ['forte below the stave', (g, cx, base, space, put) => put(glyph.dynamicForte, cx, base + space * 6.2) + space * 0.4],
      ['common-time C', (g, cx, base, space, put) => put(glyph.commonTime, cx, base + space * 2) + space * 0.4],
      ['quarter rest', (g, cx, base, space, put) => put(glyph.restQuarter, cx, base + space * 2) + space * 0.4],
      ['multi-bar rest and its number', (g, cx, base, space) => {
        g.fillRect(cx, base + space * 1.6, space * 3.5, space * 0.8);
        g.font = `${space * 2}px serif`;
        g.fillText('16', cx + space, base - space * 0.4);
        return space * 4;
      }],
      ['a chord of thirds, a double stop', (g, cx, base, space, put, wid) => {
        const gw = wid(glyph.noteheadBlack);
        for (const st of [3, 5, 7]) put(glyph.noteheadBlack, cx - gw / 2, base + 4 * space - st * (space / 2));
        g.fillRect(cx + gw / 2 - Math.max(1, space * 0.1), base + 4 * space - 7 * (space / 2) - space * 3.2,
          Math.max(1, space * 0.1), space * 5.2);
        return space * 1.6;
      }],
      ['nothing at all', null],
    ];

    // THE CLEF CHANGES THEMSELVES. Bass to tenor first, because that is what a
    // cello part does; then treble to tenor, which is how the failure was
    // isolated; then treble to alto, which is the other C-clef and the one that
    // proves the waist is being read rather than a threshold on the top.
    const CHANGES = [
      ['bass -> tenor, em 0.75', { head: 'bass', mid: 'tenor', em: 0.75 }],
      ['bass -> tenor, em 0.9', { head: 'bass', mid: 'tenor', em: 0.9 }],
      ['bass -> tenor, em 1.0', { head: 'bass', mid: 'tenor', em: 1.0 }],
      ['bass -> tenor, em 0.6', { head: 'bass', mid: 'tenor', em: 0.6 }],
      ['treble -> tenor, em 0.75', { head: 'treble', mid: 'tenor', em: 0.75 }],
      ['treble -> alto, em 0.75', { head: 'treble', mid: 'alto', em: 0.75 }],
      ['no change (control)', { head: 'bass', mid: null, em: 1 }],
    ];

    const SPOIL = {
      clean: null,
      photographed: { blur: 1.0, contrast: 0.6, tint: [212, 194, 158], jpeg: 0.6, scale: 0.62 },
    };

    for (const [spoilName, spoilOpt] of Object.entries(SPOIL)) {
      for (const [name, opt] of CHANGES) {
        const { canvas, truth } = drawMid({ space: 18, sharps: 2, furniture: null, ...opt });
        const shot = spoilOpt ? await spoil(canvas, spoilOpt) : canvas;
        let page = null;
        try { page = readPage(shot, shot.width, shot.height); } catch { page = null; }
        const notes = page ? notesInOrder(page) : [];
        const changes = (page?.staves ?? []).reduce((a, s) => a + (s.clefChanges?.length ?? 0), 0);
        const named = [...new Set((page?.staves ?? []).flatMap((s) => (s.clefChanges ?? []).map((c) => c.clef)))];
        // Match by position, the way every other corpus in this project scores.
        let right = 0; let wrong = 0; let missing = 0;
        const near = 0.5 * (18 / canvas.height) * 4;   // half a staff space, normalised
        for (const t of truth) {
          let best = null; let bestD = Infinity;
          for (const n of notes) {
            const d = Math.hypot((n.x - t.x) * canvas.width, (n.y - t.y) * canvas.height);
            if (d < bestD) { bestD = d; best = n; }
          }
          if (!best || bestD > 18 * 0.6) { missing++; continue; }
          if (best.midi == null) missing++;
          else if (best.midi === t.midi) right++;
          else wrong++;
        }
        midSystem.push({
          block: 'change', spoil: spoilName, name,
          engraved: truth.length, right, wrong, missing,
          staves: page?.staves?.length ?? 0, notes: notes.length,
          withPitch: notes.filter((n) => n.midi != null).length,
          key: page?.key ? `${page.key.count}${page.key.kind}` : 'none',
          changes, named: named.join(','),
          want: opt.mid,
        });
        void near;
      }
      for (const [name, furniture] of FURNITURE) {
        const { canvas, truth } = drawMid({
          space: 18, sharps: 2, head: 'bass', mid: null, em: 1, furniture,
        });
        const shot = spoilOpt ? await spoil(canvas, spoilOpt) : canvas;
        let page = null;
        try { page = readPage(shot, shot.width, shot.height); } catch { page = null; }
        const changes = (page?.staves ?? []).reduce((a, s) => a + (s.clefChanges?.length ?? 0), 0);
        midSystem.push({
          block: 'never', spoil: spoilName, name, changes,
          named: [...new Set((page?.staves ?? []).flatMap((s) => (s.clefChanges ?? []).map((c) => c.clef)))].join(','),
          engraved: truth.length,
        });
      }
    }
    if (selfCheck.length) midSystem.push({ block: 'broken', selfCheck });
  }

  return { results, endToEnd, midSystem };
}, { glyph: GLYPH, anchor: CLEF_ANCHOR, fontBase64 });

await browser.close();

const { results: graded, endToEnd, midSystem } = report;

if (wantJson) {
  console.log(JSON.stringify({ results: graded, endToEnd, midSystem, errors }, null, 2));
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

// --- the third block's own report and its gate --------------------------
const broken = midSystem.find((r) => r.block === 'broken');
let falseFires = 0;
if (!wantJson) {
  console.log('A CLEF PRINTED PART WAY ALONG A SYSTEM — read through readPage, scored per note\n');
  console.log('spoiling      what changes mid-system        notes  right  wrong  no pitch  found  read as');
  for (const r of midSystem.filter((r) => r.block === 'change')) {
    const flag = r.want && !r.changes ? '  <-- NOT FOUND, and the notes after it keep the old clef'
      : (r.wrong ? '  <-- WRONG PITCH' : '');
    console.log(
      `${r.spoil.padEnd(13)} ${r.name.padEnd(28)} ${String(r.engraved).padStart(5)} `
      + `${String(r.right).padStart(6)} ${String(r.wrong).padStart(6)} ${String(r.missing).padStart(9)} `
      + `${String(r.changes).padStart(6)}  ${(r.named || '—').padEnd(8)}`
      + `  key ${String(r.key).padEnd(7)}${flag}`,
    );
  }
  console.log('\nAND WHAT MUST NEVER BE READ AS ONE — the same page with furniture in its place\n');
  console.log('spoiling      what stands there                       clef changes found');
  for (const r of midSystem.filter((r) => r.block === 'never')) {
    if (r.changes) falseFires += r.changes;
    console.log(
      `${r.spoil.padEnd(13)} ${r.name.padEnd(40)} ${String(r.changes).padStart(6)}`
      + `${r.changes ? `  <-- FALSE FIRE, read as ${r.named}` : ''}`,
    );
  }
  const changes = midSystem.filter((r) => r.block === 'change');
  const printed = changes.filter((r) => r.want);
  const found = printed.filter((r) => r.changes);
  // THE TWO MUST-BE-ZERO LINES, and they are the whole point of this block.
  //
  // Split this way on purpose. A row where the change was NOT found is the
  // reader as it was before any of this existed — its notes are wrong, and they
  // were wrong yesterday too — so it is a DEBT and not a failure. What must
  // never happen is the reader firing on a page with no clef change on it, or
  // naming a note wrong on a page where it did find one. Those are the two ways
  // this feature could make the reader worse than not having it.
  const wrongWhenFound = found.reduce((a, r) => a + r.wrong, 0);
  const wrongWhenMissed = printed.filter((r) => !r.changes).reduce((a, r) => a + r.wrong, 0);
  console.log(`\n  false fires — a clef change read where none is printed     MUST BE ZERO   ${falseFires}`);
  console.log(`  a note named WRONG on a page whose change was found       MUST BE ZERO   ${wrongWhenFound}`);
  console.log(`\n  clef changes found, of ${String(printed.length).padStart(2)} printed`
    + `                                    ${found.length}`);
  console.log(`  DEBT: notes still a ninth out because a change was missed                ${wrongWhenMissed}`);
  console.log('        (that is the reader as it was; see findClefChanges for which sizes)');
  if (broken) console.log('\n  THE TRUTH TABLE IN THIS FILE IS WRONG:', JSON.stringify(broken.selfCheck));
  console.log('');
  if (wrongWhenFound) process.exitCode = 1;
}
if (broken) process.exitCode = 1;
if (falseFires) process.exitCode = 1;
