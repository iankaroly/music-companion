// How many of the notes on a page the reader actually finds.
//
// This exists because of a specific complaint — "it only showed the pitch for
// five notes out of the hundred I played" — and because the answer turned out
// to be worth measuring rather than guessing at. The page reader looked for
// noteheads by asking whether an ellipse-shaped patch was 86% inked, which is
// true of a crotchet and is never true of a minim: a white notehead is ink
// around a hole. So every hollow head on the page scored zero, and a slow
// movement — which is mostly minims and semibreves — read as a page with no
// notes on it at all.
//
// Truth is known here rather than eyeballed: every head's centre is written
// down as it is drawn, so what is found can be MATCHED against what is there.
// That is the difference between "45 heads found" and "40 of them are real and
// 5 are the dynamic marking" — and without it, a change that finds more things
// looks like a change that finds more notes.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-heads-check.mjs
//
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const scores = await page.evaluate(async () => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  // A page of music with the truth recorded alongside it. `clutter` adds the
  // things that are NOT notes and have fooled head-finders before: a slur, a
  // block of ink the size of a rest, and a dynamic marking.
  const drawPage = (mode, clutter = false) => {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 1900;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const s = 16;
    const truth = [];
    for (let sys = 0; sys < 5; sys++) {
      const top = 220 + sys * 330;
      g.fillStyle = '#111';
      for (let l = 0; l < 5; l++) g.fillRect(120, top + l * s, 1160, 2.4);
      for (let i = 0; i < 10; i++) {
        const x = 200 + i * 115;
        const y = top + (i % 5) * (s / 2) + s;
        const hollow = mode === 'hollow' || (mode === 'mixed' && i % 2 === 1);
        g.save(); g.translate(x, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, s * 0.62, s * 0.46, 0, 0, Math.PI * 2);
        if (hollow) { g.strokeStyle = '#111'; g.lineWidth = s * 0.2; g.stroke(); }
        else { g.fillStyle = '#111'; g.fill(); }
        g.restore();
        g.fillStyle = '#111'; g.fillRect(x + s * 0.55, y - s * 3, 2.4, s * 3);
        truth.push({ x, y });
      }
      if (clutter) {
        g.strokeStyle = '#111'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(300, top - 40);
        g.quadraticCurveTo(500, top - 70, 700, top - 40); g.stroke();
        g.fillRect(760, top + s * 1.2, 60, s * 0.9);
        g.font = `${s * 1.4}px serif`; g.fillText('mp', 900, top - 20);
      }
    }
    return { canvas: c, truth };
  };

  const out = {};
  for (const [label, mode, clutter] of [
    ['filled', 'filled', false], ['hollow', 'hollow', false],
    ['mixed', 'mixed', false], ['clutter', 'mixed', true],
  ]) {
    const { canvas, truth } = drawPage(mode, clutter);
    const read = readPage(canvas, canvas.width, canvas.height);
    const found = [];
    if (read) {
      for (const staff of read.staves) {
        for (const head of staff.heads) {
          found.push({ x: head.x * canvas.width, y: head.y * canvas.height });
        }
      }
    }
    // Matched to the real thing rather than counted: a head found where no
    // head is does not make up for one that was missed.
    const taken = new Set();
    let real = 0;
    for (const f of found) {
      const i = truth.findIndex((t, k) => !taken.has(k)
        && Math.abs(t.x - f.x) < 14 && Math.abs(t.y - f.y) < 12);
      if (i >= 0) { taken.add(i); real += 1; }
    }
    out[label] = {
      drawn: truth.length, found: found.length, real, wrong: found.length - real,
      staves: read?.staves.length ?? 0,
    };
  }
  return out;
});

const { filled, hollow, mixed, clutter } = scores;

check('a page of crotchets is read completely, as it always was',
  filled.real === filled.drawn && filled.wrong === 0,
  `${filled.real}/${filled.drawn} real, ${filled.wrong} wrong`);

// The one this file was written for. Before hollow heads were understood this
// was zero — not "some", zero — so a slow movement had no notes on it.
check('and a page of MINIMS is no longer read as a page with no notes on it',
  hollow.real >= 25, `${hollow.real}/${hollow.drawn} real, ${hollow.wrong} wrong (was 0)`);

check('a page of both finds more than the filled ones alone',
  mixed.real > 25, `${mixed.real}/${mixed.drawn} real (filled-only would be 25)`);

// Recall is worth nothing if it is bought with things that are not notes: a
// ring round a dynamic marking becomes a clickable note with a drone behind it.
check('and the things that are not notes are mostly still refused',
  clutter.wrong <= 6, `${clutter.real} real, ${clutter.wrong} wrong on a cluttered page`);

check('every staff is still found on every page',
  [filled, hollow, mixed, clutter].every((r) => r.staves === 5),
  [filled, hollow, mixed, clutter].map((r) => r.staves).join('/'));


// --- how long each note is, read off the page --------------------------------
//
// The duration of a note is in its head (filled or hollow), its stem and the
// beams crossing that stem. Counted note by note this comes out right about
// four times in five, which sounds respectable and is useless: a bar of sixteen
// semiquavers needs all sixteen right before the bar adds up, and four fifths
// sixteen times over is two per cent of bars. So the notes under one beam vote
// — they are under ONE beam, so they agree by construction — and the numbers
// below are what that is worth.
const values = await page.evaluate(async () => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
  const beamed = (beams, space = 16) => {
    const W = Math.round(space * 90);
    const H = Math.round(space * 70);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    let drawn = 0;
    for (let sys = 0; sys < 4; sys++) {
      const top = space * 8 + sys * space * 16;
      for (let l = 0; l < 5; l++) g.fillRect(space * 4, top + l * space, W - space * 8, Math.max(1, space * 0.12));
      for (let grp = 0; grp < 6; grp++) {
        const x0 = space * 7 + grp * space * 13;
        const ys = [];
        for (let i = 0; i < 4; i++) {
          const st = (grp + i) % 6;
          const y = top + 4 * space - st * space / 2;
          ys.push(y);
          g.save(); g.translate(x0 + i * space * 2.8, y); g.rotate(-0.3);
          g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2); g.fill();
          g.restore();
          drawn += 1;
        }
        const stemTop = Math.min(...ys) - space * 3;
        for (let i = 0; i < 4; i++) {
          g.fillRect(x0 + i * space * 2.8 + space * 0.55, stemTop, Math.max(1.5, space * 0.13), ys[i] - stemTop);
        }
        for (let bm = 0; bm < beams; bm++) {
          g.fillRect(x0 + space * 0.55, stemTop + bm * space * 0.5, space * 8.5, Math.max(2, space * 0.28));
        }
      }
    }
    return { canvas: c, drawn };
  };
  const out = {};
  for (const beams of [1, 2, 3]) {
    const { canvas, drawn } = beamed(beams);
    const read = readPage(canvas, canvas.width, canvas.height);
    const heads = read ? notesInOrder(read) : [];
    out[beams] = { drawn, found: heads.length, right: heads.filter((h) => h.beams === beams).length };
  }
  return out;
});

for (const beams of [1, 2, 3]) {
  const r = values[beams];
  const name = { 1: 'quavers', 2: 'semiquavers', 3: 'demisemiquavers' }[beams];
  check(`a page of beamed ${name} is read as ${beams} beam${beams > 1 ? 's' : ''} a note`,
    r.right / r.found >= 0.9, `${r.right} of ${r.found} (${Math.round(100 * r.right / r.found)}%)`);
}


// --- barlines, on a page that is mostly stems --------------------------------
//
// A barline is a column of ink spanning the stave, and so is a stem with a
// notehead at one end and a beam at the other. On a photograph of anything
// faster than crotchets the second kind vastly outnumbers the first: a page of
// twenty bars came back with a hundred and fifty-three barlines, almost all of
// them stems, and everything bar-shaped downstream was built on that.
//
// Two things tell them apart, and both are about what a barline is NOT touching.
// Nothing wide hangs off it — a stem meets a notehead or a beam and those are
// wide — and it stops at the stave, where a stem carries on past to reach what
// it is joined to.
const lines = await page.evaluate(async () => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  // Four bars a system, and between the barlines a thicket of beamed
  // semiquavers whose stems span the stave exactly as a barline does.
  const space = 15;
  const W = Math.round(space * 90);
  const H = Math.round(space * 60);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#111';
  let drawn = 0;
  for (let sys = 0; sys < 3; sys++) {
    const top = space * 10 + sys * space * 16;
    for (let l = 0; l < 5; l++) g.fillRect(space * 4, top + l * space, W - space * 8, Math.max(1, space * 0.12));
    // The barlines: exactly the height of the stave, nothing attached.
    for (const at of [4, 26, 48, 70, 82]) {
      g.fillRect(space * at, top, Math.max(1.5, space * 0.14), space * 4);
      drawn += 1;
    }
    // …and the stems, which are the impostors.
    for (let grp = 0; grp < 8; grp++) {
      const x0 = space * 7 + grp * space * 9.5;
      const ys = [];
      for (let i = 0; i < 4; i++) {
        const st = (grp + i) % 5;
        const y = top + 4 * space - st * space / 2;
        ys.push(y);
        g.save(); g.translate(x0 + i * space * 2, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
      const stemTop = Math.min(...ys) - space * 3.5;
      for (let i = 0; i < 4; i++) {
        g.fillRect(x0 + i * space * 2 + space * 0.55, stemTop, Math.max(1.5, space * 0.13), ys[i] - stemTop);
      }
      for (let bm = 0; bm < 2; bm++) {
        g.fillRect(x0 + space * 0.55, stemTop + bm * space * 0.5, space * 6.5, Math.max(2, space * 0.26));
      }
    }
  }
  const read = readPage(c, c.width, c.height);
  return {
    drawn: drawn,
    found: read ? read.staves.reduce((n, st) => n + st.bars.length, 0) : 0,
    staves: read?.staves.length ?? 0,
  };
});

check('barlines are found on a page thick with stems',
  lines.found >= lines.drawn * 0.7,
  `${lines.found} found, ${lines.drawn} drawn across ${lines.staves} staves`);
check('and the stems are not counted as barlines',
  lines.found <= lines.drawn * 1.6,
  `${lines.found} found for ${lines.drawn} real (96 stems on the page)`);

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
