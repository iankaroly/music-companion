// The review and the full-screen reader, on ONE take, compared notehead for
// notehead.
//
// The reader is one tap from the review — score-tab.js wires a click on the
// whole of #score-stage to open it — so a player who taps the photograph
// between two rings is handed the music stand, and until this check existed
// nothing anywhere compared what the two views were saying about the same
// take. They disagreed. MEASURED at baseline on the two engraved pages built
// below: the review rings heads 36-88 and the reader rings heads 0-38, and NOT
// ONE played note is on the same notehead in both. The reader was pairing
// positionally (reader.js markedHeads: `heads.slice(0, count)`), which is the
// bug src/analysis/scan-align.js was written to kill, still alive behind a tap.
//
// WHAT THE FIXTURE IS FOR, precisely. A take that starts at the top of page one
// and plays straight through cannot see this bug at all: positional and aligned
// give the same indices, and the check would pass against the broken code. So
// the take here does four things at once —
//   - starts at notehead 36, a third of the way in, so a count from zero is
//     wrong from the first ring;
//   - crosses the page break, so the pairing has to carry a page as well;
//   - SKIPS three written notes, so the aligner has to spend deletes and the
//     two paths drift apart rather than staying a constant offset;
//   - carries one note the segmenter could not price (midi null), because the
//     review filters those out (score.js:610 analyseScanTake) and the reader is
//     handed the UNFILTERED array (score.js:358), which is a second, quieter
//     way for the two views to disagree about the same take.
//
// AND IT IS DRIVEN THROUGH THE REAL DOORS. The two views are NOT handed one
// notes array by this file: the review goes in through annotateTake +
// renderScoreTab and the reader through readCurrentScore, exactly as a tap
// does, so what is compared is what the app does and not what two functions do
// when a check is careful with them.
//
// NO MICROPHONE AND NO CAMERA. The audio is synthesised into a real Recorder by
// src/fixtures/take-fixture.js; nothing here calls getUserMedia.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run score:agree
//
import puppeteer from 'puppeteer-core';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
// Outside the tree: a PNG written into the project while this is driving the
// app makes vite full-reload the page underneath it.
const OUT = process.env.OUT ?? join(tmpdir(), 'music-companion-agree');

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
// EVERY MODULE THIS CHECK WILL IMPORT, IMPORTED FIRST — and then the page is
// thrown away and loaded again.
//
// Not superstition. MEASURED four times on this machine, and it is the same
// failure each time wearing a different line number: the first run against a
// freshly started `npm run dev` dies with "Execution context was destroyed" —
// once in the review step, once while the reader was opening, once during
// playback. Vite pre-bundles a dependency the moment something first imports
// the module that needs it, and then FULL-RELOADS the tab; a check that
// discovers its modules one step at a time is therefore reloading itself at a
// random point. Importing them all up front moves every discovery into one
// place, and the reload afterwards throws away the tab that was damaged by it.
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(async () => {
  const wanted = [
    '/src/ui/score.js', '/src/ui/report.js', '/src/ui/reader.js', '/src/ui/score-tab.js',
    '/src/ui/scan-view.js', '/src/fixtures/take-fixture.js', '/src/store/db.js',
    '/src/analysis/scan-notes.js', '/src/analysis/scan-key.js', '/src/analysis/scan-sync.js',
  ];
  for (const one of wanted) {
    try { await import(/* @vite-ignore */ one); } catch { /* discovered anyway */ }
  }
});
await new Promise((r) => setTimeout(r, 1500));
await page.reload({ waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// --- two engraved pages, and a take played from what is written on them ------
//
// The same page builder as tools/scan-follow-check.mjs, for the same measured
// reason recorded there: a scribbled page of ellipses has no clef, so the
// reader prices no head, pairNotes takes the contour route and refuses — and
// the pitch route, which is the route a real part takes, could never be
// watched. A page with Bravura, a bass clef and one printed sharp is the only
// page on which these two views can be compared on the route that matters.
const SKIP = [12, 13, 24];
const built = await page.evaluate(async ({ b64, skip }) => {
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);
  const G = { black: '\u{E0A4}', fClef: '\u{E062}', sharp: '\u{E262}' };

  const { pitchOf } = await import('/src/analysis/scan-notes.js');
  const { keyFromCount } = await import('/src/analysis/scan-key.js');
  const KEY = keyFromCount(1, 'sharp');

  const space = 14;
  const perSystem = 12;
  const systems = 4;
  const W = Math.round(space * 62);
  const H = Math.round(space * (10 + systems * 13 + 6));

  const stepsOf = (seedStart) => {
    let seed = seedStart;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const out = [];
    let at = 2;
    for (let i = 0; i < perSystem * systems; i++) {
      const r = rnd();
      at += (rnd() < 0.5 ? -1 : 1) * (r < 0.5 ? 1 : (r < 0.85 ? 2 : 3));
      at = Math.max(-2, Math.min(9, at));
      out.push(at);
    }
    return out;
  };

  const drawPage = (steps) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#111';
    const em = space * 4;
    const put = (ch, x, y) => {
      g.font = `${em}px Bravura`; g.textBaseline = 'alphabetic'; g.fillText(ch, x, y);
      return g.measureText(ch).width;
    };
    const wid = (ch) => { g.font = `${em}px Bravura`; return g.measureText(ch).width; };
    const thick = Math.max(1, space * 0.1);
    const places = [];
    for (let sys = 0; sys < systems; sys++) {
      const base = space * 8 + sys * space * 13;
      const lineY = (l) => base + l * space;
      const stepY = (st) => lineY(4) - st * (space / 2);
      for (let l = 0; l < 5; l++) g.fillRect(space * 2, lineY(l), W - space * 4, thick);
      let x = space * 3;
      x += put(G.fClef, x, lineY(1)) + space * 0.5;
      x += put(G.sharp, x, stepY(6)) + space * 0.6;
      const startX = x + space;
      const usable = (W - space * 3) - startX;
      const gap = usable / (perSystem + 0.6);
      for (let i = 0; i < perSystem; i++) {
        const st = steps[sys * perSystem + i];
        const cx = startX + gap * (i + 0.6);
        const y = stepY(st);
        const gw = wid(G.black);
        for (let s2 = 10; s2 <= st; s2 += 2) g.fillRect(cx - gw * 0.75, stepY(s2), gw * 1.5, thick);
        for (let s2 = -2; s2 >= st; s2 -= 2) g.fillRect(cx - gw * 0.75, stepY(s2), gw * 1.5, thick);
        put(G.black, cx - gw / 2, y);
        const up = st < 4;
        const sx = up ? cx + gw / 2 - thick : cx - gw / 2;
        g.fillRect(sx, up ? y - space * 3.2 : y, Math.max(1, thick), space * 3.2);
        if (i % 4 === 3 && i !== perSystem - 1) {
          g.fillRect(cx + gap * 0.5, lineY(0), Math.max(1, thick * 1.2), lineY(4) - lineY(0));
        }
        places.push({ x: cx / W, y: y / H, step: st });
      }
      g.fillRect(W - space * 2.4, lineY(0), Math.max(1, thick * 1.6), lineY(4) - lineY(0));
    }
    return { canvas: c, places };
  };

  const one = drawPage(stepsOf(20260818));
  const two = drawPage(stepsOf(99001122));
  const blobs = await Promise.all([one, two].map((p) => new Promise((done) => p.canvas.toBlob(done, 'image/png'))));

  const { savePagesScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Engraved part', source: 'images', pageCount: 2, pages: blobs,
  });

  const written = [...one.places, ...two.places]
    .map((p) => ({ ...p, midi: pitchOf(p.step, 'bass', KEY)?.midi ?? null }));

  const FROM = 36;
  const COUNT = 40;
  const SPACING = 0.45;
  const SOUNDING = 0.36;
  const LEAD = 0.6;
  const notes = [];
  let k = 0;
  for (let i = 0; i < COUNT; i++) {
    if (skip.includes(i)) continue;
    const midi = written[FROM + i]?.midi;
    if (!Number.isFinite(midi)) continue;
    const start = LEAD + k * SPACING;
    notes.push({
      midi, name: null, cents: ((k * 37) % 41) - 20, start, end: start + SOUNDING,
    });
    k += 1;
  }
  // A squeak the segmenter could not price. It is a real thing a take carries —
  // it is why score.js:610 filters at all — and it is here so that the two
  // views' notes arrays are not accidentally identical.
  const squeak = {
    midi: null, name: null, cents: 0,
    start: LEAD + k * SPACING, end: LEAD + k * SPACING + SOUNDING,
  };
  notes.splice(6, 0, squeak);

  window.__built = { scoreId, notes, written, from: FROM, count: COUNT };
  return {
    scoreId, wrote: written.length, played: notes.length,
    priced: notes.filter((n) => Number.isFinite(n.midi)).length,
  };
}, { b64: font, skip: SKIP });

check('two engraved pages, and a take that starts a third of the way in',
  built.wrote === 96 && built.priced === 37 && built.played === 38,
  `${built.wrote} noteheads written, ${built.played} notes played (${built.played - built.priced} unpriced)`);

// --- the review, through its own door ----------------------------------------
const review = await page.evaluate(async () => {
  const { scoreId, notes } = window.__built;
  const { selectScore, annotateTake, renderScoreTab, initScoreCard } = await import('/src/ui/score.js');
  const { renderFreeReview, selectPlayedNote } = await import('/src/ui/report.js');
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  await selectScore(scoreId);
  const priced = notes.filter((n) => Number.isFinite(n.midi));
  const rec = synthRecording(priced);
  const readings = priced.map((n) => ({
    time: n.start, frequency: 440 * 2 ** ((n.midi - 69) / 12), confidence: 0.95, rms: 0.05,
    midi: n.midi, cents: n.cents,
  }));
  renderFreeReview(document, notes, rec, { readings, a4: 440 });
  await annotateTake(notes, { readings, a4: 440 });
  initScoreCard({ onPickNote: (note) => selectPlayedNote(note) });
  const { onScoreTabShown } = await import('/src/ui/score-tab.js');
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  onScoreTabShown();
  const view = await renderScoreTab();
  window.__view = view;
  await new Promise((r) => setTimeout(r, 400));
  const marks = view?.pairing?.marks ?? [];
  return {
    heads: view?.pairing?.heads ?? 0,
    played: view?.pairing?.played ?? 0,
    placed: !!view?.pairing?.placed,
    readPitch: !!view?.pairing?.readPitch,
    byStart: marks.map((m) => [m.note?.start ?? null, m.headIndex ?? -1]),
  };
});
check('the review reads the pages and places the take by PITCH',
  review.placed && review.readPitch && review.byStart.length > 30,
  `${review.heads} noteheads, ${review.byStart.length} marks, ${review.played} notes paired`);

// --- the reader, through the tap ---------------------------------------------
//
// readCurrentScore() is what score-tab.js's click handler calls. Nothing here
// reaches into the reader to give it a take: it takes the one the review is
// already showing, the way a tap does.
const reader = await page.evaluate(async () => {
  const { readCurrentScore } = await import('/src/ui/score.js');
  await readCurrentScore();
  await new Promise((r) => setTimeout(r, 700));
  const { paperPairing } = await import('/src/ui/reader.js');
  const answer = paperPairing();
  return {
    open: !document.querySelector('#reader')?.hidden,
    answer,
    said: (document.querySelector('#reader-say')?.textContent ?? '').trim(),
    saidHidden: !!document.querySelector('#reader-say')?.hidden,
  };
});
// The versioned-module trap in CLAUDE.md, caught rather than reasoned about: if
// this check's `import('/src/ui/reader.js')` got a SECOND instance of the
// module, `paperPairing()` would answer about a reader that never opened.
//
// AND IT STOPS HERE WHEN IT DOES, which is the point of this block. Every
// assertion below reads `reader.answer`, so one stale module produced ELEVEN
// failures describing things that were never wrong — "0 noteheads lit", "the
// two views mark a different number of notes", "the reader is counting from the
// top of page one" — and a suite that has been red for a week is a suite nobody
// reads. This round lost an hour to exactly that: score:agree was reported as
// eleven pre-existing failures, was baselined as such, and turned out to be
// sixteen passes the moment the dev server was restarted.
if (reader.open && !reader.answer) {
  console.log('\n  ────────────────────────────────────────────────────────────');
  console.log('  THE DEV SERVER HAS SERVED AN EDITED MODULE, and this check is');
  console.log('  reading a different copy of reader.js from the one the app is');
  console.log('  using. Nothing below would mean anything, so it is not run.');
  console.log('');
  console.log('    restart `npm run dev`, then run this again');
  console.log('  ────────────────────────────────────────────────────────────\n');
  await browser.close();
  process.exit(2);
}
check('the reader opened on the same score, and it is the same module instance',
  reader.open && !!reader.answer,
  reader.answer ? `${reader.answer.heads} noteheads, route=${reader.answer.route}`
    : 'paperPairing() answered null while the reader was open');

// --- do they agree? ----------------------------------------------------------
const agree = (() => {
  const a = new Map(review.byStart.filter(([s]) => s !== null));
  const b = new Map((reader.answer?.byStart ?? []).filter(([s]) => s !== null));
  let same = 0;
  let differ = 0;
  const both = [];
  for (const [start, head] of a) {
    if (!b.has(start)) continue;
    both.push(start);
    if (b.get(start) === head) same += 1; else differ += 1;
  }
  const range = (xs) => (xs.length ? `${Math.min(...xs)}-${Math.max(...xs)}` : 'none');
  return {
    same,
    differ,
    onlyReview: [...a.keys()].filter((s) => !b.has(s)).length,
    onlyReader: [...b.keys()].filter((s) => !a.has(s)).length,
    reviewRange: range([...a.values()]),
    readerRange: range([...b.values()]),
    compared: both.length,
  };
})();
console.log(`      review rings heads ${agree.reviewRange}; reader rings heads ${agree.readerRange}`);
console.log(`      ${agree.same} of ${agree.compared} played notes on the SAME notehead in both,`
  + ` ${agree.differ} on different ones,`
  + ` ${agree.onlyReview} marked only in the review, ${agree.onlyReader} only in the reader`);

check('the two views mark the same NUMBER of played notes',
  agree.onlyReview === 0 && agree.onlyReader === 0,
  `${agree.onlyReview} review-only, ${agree.onlyReader} reader-only`);
check('every played note is on the SAME notehead in the review and in the reader',
  agree.compared > 30 && agree.differ === 0,
  `${agree.same}/${agree.compared} agree, ${agree.differ} disagree`);
check('and the reader is not counting from the top of page one',
  agree.readerRange === agree.reviewRange,
  `review ${agree.reviewRange} vs reader ${agree.readerRange}`);

await page.screenshot({ path: join(OUT, 'agree-1-reader.png'), fullPage: false });
console.log(`      shot: the reader, with the take on it → ${join(OUT, 'agree-1-reader.png')}`);

// --- the light on the page is driven by the TIME BRIDGE ----------------------
//
// Not by marks[played.indexOf(note)]. The difference is visible exactly here:
// the reader's own transport presses the review's #clip-play, so the take runs
// on the audio clock and the lit head is sampled off the reader's own state.
// Every head lit must be one the pairing actually placed — under the positional
// pairing the lit heads are 0-38, which is music nobody played.
const trail = await page.evaluate(async () => {
  const { paperPairing } = await import('/src/ui/reader.js');
  // The nulls are RECORDED, not filtered out. `headAt` is a half-open interval
  // and the whole reason to drive the light from it is that it answers null in
  // the gap between two notes — a follower that only ever samples the lit
  // moments cannot tell "driven by the bridge" from "driven by something that
  // happens to agree with the bridge while a note is sounding".
  const seen = [];
  let stop = false;
  const tick = () => {
    if (stop) return;
    const lit = paperPairing()?.lit ?? null;
    if (seen.at(-1) !== lit) seen.push(lit);
    requestAnimationFrame(tick);
  };
  tick();
  document.querySelector('#clip-play')?.click();
  await new Promise((r) => setTimeout(r, 9000));
  stop = true;
  document.querySelector('#clip-play')?.click();
  return seen;
});
// Checked against the REVIEW's head indices and not against the reader's own,
// which would be a tautology: under the positional pairing every head the light
// visited was one the positional pairing had placed, so the same assertion
// passed on the broken code. It has to be answerable by the other view.
const placedHeads = new Set(review.byStart.map(([, h]) => h).filter((n) => n >= 0));
const heads = trail.filter((h) => h !== null);
const strays = heads.filter((h) => !placedHeads.has(h));
// A null BETWEEN two different heads: the light went out in the gap rather than
// being held on the last note until the next one began.
const wentOut = trail.some((h, i) => h === null && i > 0 && i < trail.length - 1
  && trail[i - 1] !== null && trail[i + 1] !== null && trail[i - 1] !== trail[i + 1]);
console.log(`      the light visited ${heads.length} noteheads: `
  + `${trail.slice(0, 14).map((h) => (h === null ? '·' : h)).join(' ')}${trail.length > 14 ? ' …' : ''}`);
check('the light moves while the take plays',
  heads.length >= 5, `${heads.length} noteheads lit`);
check('and every notehead it lights is one the REVIEW placed a note on',
  heads.length > 0 && strays.length === 0,
  strays.length ? `${strays.length} lit heads no note landed on: ${strays.slice(0, 8).join(' ')}` : 'no strays');
check('and it goes OUT between two notes instead of being held on',
  wentOut, `${trail.filter((h) => h === null).length} moments with nothing lit`);
check('the light goes forwards through the take',
  heads.length > 1 && heads.every((h, i) => i === 0 || h > heads[i - 1]),
  `${heads.join(' ').slice(0, 80)}`);

// --- RULE 3: a pairing that refuses shows NO rings and says why --------------
//
// A page of ellipses drawn on five lines with no clef. MEASURED on this tree
// and written up in tools/scan-follow-check.mjs: the reader finds heads on such
// a page and prices NONE of them, so pairNotes drops to the contour route and
// findStart refuses. That is a refusal that happens on today's code, which is
// why it is the one used here — the wrong-piece take (which pairNotes still
// believes) is another agent's fix this round, and a check built on it would
// fail now and look like this one's bug.
await page.evaluate(async () => {
  const { closeReader } = await import('/src/ui/reader.js').then((m) => ({ closeReader: m.close }));
  closeReader();
});
const refusal = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 1000;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 1000);
  g.fillStyle = '#111';
  const space = 14;
  for (let sys = 0; sys < 4; sys++) {
    const base = 100 + sys * space * 13;
    for (let l = 0; l < 5; l++) g.fillRect(40, base + l * space, 720, 1.4);
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.ellipse(90 + i * 68, base + (i % 5) * space * 0.5, space * 0.62, space * 0.44, -0.3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const blob = await new Promise((done) => c.toBlob(done, 'image/png'));
  const { savePagesScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'No clef anywhere', source: 'images', pageCount: 1, pages: [blob],
  });
  const { selectScore, annotateTake, readCurrentScore } = await import('/src/ui/score.js');
  const { renderFreeReview } = await import('/src/ui/report.js');
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  await selectScore(scoreId);
  // A take with nothing to do with that page.
  const notes = [];
  for (let i = 0; i < 18; i++) {
    notes.push({ midi: 50 + ((i * 5) % 13), name: null, cents: 4, start: 0.5 + i * 0.4, end: 0.5 + i * 0.4 + 0.3 });
  }
  const rec = synthRecording(notes);
  renderFreeReview(document, notes, rec, { readings: [], a4: 440 });
  await annotateTake(notes, { readings: [], a4: 440 });
  await readCurrentScore();
  await new Promise((r) => setTimeout(r, 900));
  const { paperPairing } = await import('/src/ui/reader.js');
  const answer = paperPairing();
  // The sentence is DRAWN, on the ink layer where the rings would have been,
  // rather than put in the status line — that line is cleared by half a dozen
  // other things (say('') in finishLink), and the one sentence explaining an
  // empty page would go with it. So it is counted in PIXELS: the panel is
  // rgba(28, 26, 34, 0.86) over a transparent canvas, and nothing else this
  // reader draws is that dark and that opaque.
  const ink = document.querySelector('#reader-ink');
  let panel = 0;
  if (ink) {
    const g = ink.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, ink.width, ink.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 150 && d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 70) panel += 1;
    }
  }
  // WHAT THE MENU PROMISES, under a refusal.
  //
  // "colour the notes by how they landed" is a promise the app cannot keep on a
  // page it could not place the take on, and a row that opens onto a page with
  // nothing new on it reads as a bug rather than as a refusal. This is checked
  // because the sibling of this bug — report.js's tile still saying "play this
  // note" over a press that sounds nothing — survived 35 browser checks by
  // being the one thing none of them read.
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 200));
  const rows = [...document.querySelectorAll('.reader-menu-row')]
    .map((n) => ({
      label: (n.querySelector('b')?.textContent ?? '').trim(),
      detail: (n.querySelector('small')?.textContent ?? '').trim(),
    }));
  const row = rows.find((n) => /what you played|not on the page/.test(n.label));
  const promise = row ? `${row.label} — ${row.detail}` : '';
  const rowThere = !!row;
  document.querySelector('#reader-menu-btn')?.click();
  return { answer, panel, rowThere, promise, inkPixels: ink ? ink.width * ink.height : 0 };
});
console.log(`      the reader says: "${refusal.answer?.why ?? ''}"`);
check('a page whose pairing refuses draws NO rings at all',
  !!refusal.answer && refusal.answer.placed === false
    && (refusal.answer.headIndices?.length ?? 0) === 0,
  `placed=${refusal.answer?.placed}, ${refusal.answer?.headIndices?.length ?? '-'} rings,`
  + ` ${refusal.answer?.heads ?? 0} noteheads found`);
check('and it SAYS why, in ink on the page, rather than leaving a blank one',
  !!refusal.answer?.why && refusal.answer.why.length > 20 && refusal.panel > 2000,
  `${refusal.panel} panel pixels of ${refusal.inkPixels} on the ink layer`);
check('and the menu row does not promise colours it cannot draw',
  refusal.rowThere && !/how they landed/.test(refusal.promise)
    && !/what you played/.test(refusal.promise) && /not on the page/.test(refusal.promise),
  refusal.rowThere ? `"${refusal.promise}"` : 'no "what you played" row in the menu at all');
check('the refusal does not fall back to counting from the top of the page',
  (refusal.answer?.headIndices?.length ?? 0) === 0,
  `${refusal.answer?.headIndices?.length ?? '-'} rings on a take that could not be placed`);

await page.screenshot({ path: join(OUT, 'agree-2-refused.png'), fullPage: false });
console.log(`      shot: the refusal, on the page → ${join(OUT, 'agree-2-refused.png')}`);

// --- the OTHER silence: pages that read fine, a take with no pitch in it -----
//
// Two silences, two sentences — the review draws the same distinction
// (score.js scanUnreadNote against scanUnplacedNote). "These pages could not be
// read" is a fact about the photograph and "nothing in that take could be given
// a pitch" is a fact about the take, and sending somebody to re-photograph a
// page when the take was the problem is the kind of confident wrong help this
// app is written to avoid. This exercises the second; the first (a layout with
// no heads at all) is written but NOT fired by anything here.
const quiet = await page.evaluate(async () => {
  const { close } = await import('/src/ui/reader.js');
  close();
  const { selectScore, annotateTake, readCurrentScore } = await import('/src/ui/score.js');
  await selectScore(window.__built.scoreId);
  // Eighteen notes the segmenter heard and could not price. Real: it is why
  // score.js:610 filters at all.
  const notes = [];
  for (let i = 0; i < 18; i++) {
    notes.push({ midi: null, name: null, cents: null, start: 0.5 + i * 0.4, end: 0.5 + i * 0.4 + 0.3 });
  }
  // NO renderFreeReview here: report.js's centsLabel throws on a take where
  // every note is unpriced, which is a real bug and another session's file this
  // round. annotateTake is the only door this case needs — it is what sets the
  // take the reader is handed.
  await annotateTake(notes, { readings: [], a4: 440 });
  await readCurrentScore();
  await new Promise((r) => setTimeout(r, 900));
  const { paperPairing } = await import('/src/ui/reader.js');
  return paperPairing();
});
console.log(`      the reader says: "${quiet?.why ?? ''}"`);
check('a take with no pitch in it is told apart from a page that could not be read',
  !!quiet && quiet.placed === false && quiet.heads > 0
    && /given a pitch/.test(quiet.why ?? '') && !/have not been read/.test(quiet.why ?? ''),
  `${quiet?.heads ?? 0} noteheads read, ${quiet?.played ?? 0} notes with a pitch, why="${quiet?.why ?? ''}"`);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} PASS, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
