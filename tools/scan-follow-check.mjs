// Following a take across a photographed page, and pressing a notehead to hear
// it — including the noteheads nobody played.
//
// This is the user-facing half of the scanned review, and it has one specific
// way of lying that no unit test can see: a page carries hundreds of noteheads,
// a take covers a few dozen, and every other notehead on that page is a control
// with NO AUDIO BEHIND IT. Playing the nearest recorded note when one is
// pressed would look and sound perfect and would be a specific false claim
// about a specific note (CLAUDE.md rule 5). So the two things checked hardest
// here are that an unplayed notehead sounds the WRITTEN pitch and says so, and
// that the moving light goes OUT in silence rather than sliding on to the next
// ring.
//
// WHY THE PAGE IS ENGRAVED RATHER THAN SCRIBBLED. The other scanned checks draw
// ellipses on five lines with no clef. Measured on this tree: the reader finds
// 73 noteheads where 40 were drawn on such a page and prices none of them (no
// clef to price with), so pairNotes takes the contour route and REFUSES — which
// is why `npm run score:review` is red before this change and has nothing to do
// with it. A page with real Bravura on it, a clef and a barline is a page the
// reader handles, and it is the only kind on which the pitch route — the route
// a real part takes — can be watched at all.
//
// WHY THERE IS NO MICROPHONE ANYWHERE IN IT. The audio is synthesised by
// src/fixtures/take-fixture.js into a real Recorder. Nothing here calls
// getUserMedia, and nothing may.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-follow-check.mjs
//   node tools/scan-follow-check.mjs --shots     (writes the crops it looked at)
//
import puppeteer from 'puppeteer-core';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
// The crops go OUTSIDE the project by default, and that is not tidiness.
// MEASURED, this run: writing a PNG into tools/out while the check is driving
// the app makes the vite dev server full-reload the page — the execution
// context is destroyed, window.__view goes with it, and every step after the
// first screenshot fails with "Execution context was destroyed". A check that
// writes into the tree it is measuring is a check that reloads its own subject.
const OUT = process.env.OUT ?? join(tmpdir(), 'practice-partner-follow');

const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  // The playhead is the subject and it rides on the audio clock, so playback
  // has to be allowed to start without a gesture the harness cannot make.
  // MEASURED in this shell: requestAnimationFrame runs at ~37fps and
  // AudioContext.currentTime advances 0.965s per wall second, so real playback
  // is a usable driver here — the pessimistic note in scan-playback-check.mjs
  // is about the reader's own ink canvas, not about this.
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
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// --- two engraved pages, and a take played from what is written on them ------
//
// The take deliberately does three things at once: it starts in the middle of
// page one (so the marks are not a lucky count from zero), it runs off the end
// of that page onto the next (so the light has to cross a page), and it SKIPS
// three written notes in the middle (so there are noteheads inside the passage
// that nobody played — the case this whole task is about).
const SKIP = [12, 13, 24];
const built = await page.evaluate(async ({ b64, skip }) => {
  const face = new FontFace('Bravura', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);
  const G = { black: '\u{E0A4}', fClef: '\u{E062}', sharp: '\u{E262}' };

  const { pitchOf } = await import('/src/analysis/scan-notes.js');
  const { keyFromCount } = await import('/src/analysis/scan-key.js');
  // ONE SHARP, printed on every system.
  //
  // Measured first without it: a page with a clef and no signature prices NO
  // head at all — `readPitch` came back false, every head's midi was null, and
  // the take went on by contour. A key nobody printed is a key agreeKey cannot
  // agree on any number of systems, and CLAUDE.md rule 5 says an unknown key is
  // null rather than C major. So the page prints a signature, the way a real
  // part does, and the check gets to watch the PITCH route — which is the route
  // a real photographed part takes.
  const KEY = keyFromCount(1, 'sharp');

  const space = 14;
  const perSystem = 12;
  const systems = 4;
  const W = Math.round(space * 62);
  const H = Math.round(space * (10 + systems * 13 + 6));

  // A line with a shape: a walk that moves by a step or a third and turns
  // around at the edges, so the contour is not a scale and not a random
  // scatter. Written down as STEPS on the stave, which is what the reader
  // measures, and priced through the app's own pitchOf so the take and the page
  // cannot disagree by construction.
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
      // A bass clef, because a cello part is one and because a page with no
      // clef on it is a page the reader must refuse to price.
      x += put(G.fClef, x, lineY(1)) + space * 0.5;
      // The one sharp sits where a bass-clef F sharp sits: step 6.
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
        // A barline every four notes, so the page has bars to be timed against.
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

  // What is WRITTEN, page after page, in reading order — the sequence the
  // reader will (mostly) recover.
  const written = [...one.places, ...two.places]
    .map((p) => ({ ...p, midi: pitchOf(p.step, 'bass', KEY)?.midi ?? null }));

  // The take: from note 36 of page one, over the page break, 40 notes long,
  // minus the three skipped.
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
  window.__built = { scoreId, notes, written, from: FROM, count: COUNT, spacing: SPACING, sounding: SOUNDING, lead: LEAD };
  return {
    scoreId, wrote: written.length, played: notes.length,
    unpriced: written.filter((w) => !Number.isFinite(w.midi)).length,
    span: [notes[0].start, notes.at(-1).end],
  };
}, { b64: font, skip: SKIP });

check('two engraved pages, and a take played from what is written on them',
  built.wrote === 96 && built.played === 37 && built.unpriced === 0,
  `${built.wrote} noteheads written, ${built.played} notes played, take runs ${built.span[0]}s–${built.span[1].toFixed(2)}s`);

// --- read them, pair the take, and show the review ---------------------------
const shown = await page.evaluate(async () => {
  const { scoreId, notes } = window.__built;
  const { selectScore, annotateTake, renderScoreTab, initScoreCard } = await import('/src/ui/score.js');
  const { renderFreeReview, selectPlayedNote } = await import('/src/ui/report.js');
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  await selectScore(scoreId);
  // A REAL Recorder full of synthesised sine — no microphone, and real samples
  // so the transport has something to play and the audio clock something to
  // move against.
  const rec = synthRecording(notes);
  window.__rec = rec;
  const readings = notes.map((n) => ({
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
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  const quiet = [...document.querySelectorAll('#score-stage .scan-quiet')];
  const pageOf = (n) => n.closest('.scan-page')?.dataset.page;
  return {
    placed: !!view?.pairing?.placed,
    readPitch: !!view?.pairing?.readPitch,
    heads: view?.pairing?.heads ?? 0,
    marks: view?.pairing?.marks?.length ?? 0,
    rings: rings.length,
    ringPages: [...new Set(rings.map(pageOf))].sort(),
    quiet: quiet.length,
    quietPages: [...new Set(quiet.map(pageOf))].sort(),
    spans: view?.bridge?.spans?.length ?? 0,
    silent: view?.bridge?.silent?.length ?? 0,
    unheard: view?.bridge?.unheard?.length ?? 0,
    summary: document.querySelector('#score-tab-summary')?.textContent ?? '',
    smallestQuiet: quiet.length
      ? Math.round(Math.min(...quiet.map((n) => n.getBoundingClientRect().width))) : 0,
  };
});

check('the reader reads its own engraving and the take goes on by PITCH',
  shown.placed && shown.readPitch && shown.marks > 30,
  `${shown.heads} noteheads read, ${shown.marks} marks, pitch route=${shown.readPitch}`);
check('the rings cross the page break',
  shown.ringPages.length === 2, `rings on pages ${shown.ringPages.join(', ')}`);
// EVERY unplayed notehead on the pages shown, not only the ones beside the
// take. This asserted the opposite — "and only around the take" — because the
// markers used to stop eight heads either side of it, which on a real page of
// two hundred notes left a dozen controls. A user asked for the rest of them:
// "making more of the notes scanned and clickable". What each marker claims is
// unchanged (this take did not play this note) and so is what it sounds.
check('every notehead this take did not play is drawn too',
  shown.quiet > 0 && shown.quiet === shown.silent,
  `${shown.quiet} silent markers of ${shown.silent} unplayed heads, on pages ${shown.quietPages.join(', ')}`);
check('and each is still big enough for a finger',
  shown.smallestQuiet >= 22, `smallest ${shown.smallestQuiet}px`);
check('the review SAYS the dashed ones were not played in this take',
  /not played in this take/.test(shown.summary) && /synthesised/.test(shown.summary),
  shown.summary.slice(-140).trim());

// The whole review, before anything is pressed or played. This is the picture
// the rest of the checks are about, and it is written every run rather than
// under --shots: a check whose evidence only exists when somebody remembers a
// flag is a check nobody looks at.
await page.screenshot({ path: join(OUT, 'walk-1-marked.png'), fullPage: false });
console.log(`      shot: the take, marked on the page \u2192 ${join(OUT, 'walk-1-marked.png')}`);

// --- THE RHYTHM VERDICT, on the page and in the join -------------------------
//
// src/ui/score.js calls scanRhythm (not scanTiming) and prints ONE of two
// sentences: the written route where the page's own note values could be
// believed bar by bar, and a refusal where they could not. Both are checked
// here because the branch that fires depends on the page — every photograph in
// this repo refuses (npm run scan:values: 0 bars believed on all three), so an
// engraved page is the only place the written sentence can be watched at all.
const rhythm = await page.evaluate(async () => {
  const { scanRhythm } = await import('/src/analysis/scan-rhythm.js');
  const report = scanRhythm(window.__view.pairing.marks);
  const said = document.querySelector('#score-tab-summary .scan-rhythm');
  const words = (n) => report.perNote.filter((x) => x.verdict === n).length;
  return {
    placed: report.placed,
    bars: report.bars.length,
    believed: report.barsBelieved,
    beatsPerBar: report.beatsPerBar,
    coverage: report.coverage,
    why: report.valuesWhy,
    judged: report.notesJudged,
    anchored: report.notesAnchored,
    even: report.notesFromEven,
    on: words('on'), late: words('late'), early: words('early'),
    meanWritten: report.meanAbsMsWritten,
    meanEven: report.meanOffMsEven,
    route: said?.dataset.route ?? null,
    text: (said?.textContent ?? '').trim(),
    // The two routes must not both be measuring the same note, and no entry may
    // carry a number from the route it is not on.
    mixed: report.perNote.filter((n) => (n.from === 'written' && n.offFromEqualMs !== null)
      || (n.from === 'even' && n.deviationMs !== null)).length,
    // WHY the page was refused, bar by bar, for the run that wants to know
    // rather than for every run. This is the table that says whether the
    // refusal is the note VALUES or the bar GROUPING — on this fixture every
    // head is an unbeamed filled notehead, so the values are crotchets and the
    // sums are a direct read-out of how many heads the reader put in a bar.
    table: report.bars.map((b) => `${b.notes}n=${b.beats}`).join(' '),
  };
});
if (process.env.RHYTHM_DUMP) console.log(`      bars: ${rhythm.table}`);
console.log(`      the review says: ${shown.summary.replace(/\s+/g, ' ').trim()}`);
console.log(`      rhythm: ${rhythm.believed}/${rhythm.bars} bars believed,`
  + ` beatsPerBar=${rhythm.beatsPerBar}, coverage=${rhythm.coverage},`
  + ` ${rhythm.judged} notes judged, ${rhythm.even} on the even route`);
check('the review SHOWS a rhythm verdict, and says which route it came from',
  rhythm.route !== null && rhythm.text.length > 20, `[${rhythm.route}] ${rhythm.text}`);
check('the route the sentence claims is the route the join actually took',
  (rhythm.judged > 0) === (rhythm.route === 'written'),
  `${rhythm.judged} notes judged against printed values, route="${rhythm.route}"`);
check('no note carries a number from the route it is not on',
  rhythm.mixed === 0, `${rhythm.mixed} entries with both`);
check('a refusal names its reason instead of a verdict it cannot have',
  rhythm.route === 'written' || (/could not be/.test(rhythm.text) && !!rhythm.why),
  rhythm.route === 'written' ? 'written route — not applicable' : `why="${rhythm.why}"`);

// --- the bridge, asked directly: silence lights nothing ----------------------
//
// The DOM check below watches the light move. This one asks the same question
// at the exact moments a screenshot cannot be taken at: inside a note, in the
// tenth of a second between two notes, before the first and after the last.
const moments = await page.evaluate(() => {
  const { notes } = window.__built;
  const view = window.__view;
  const at = (t) => {
    const el = view.noteheadFor(null, t);
    return el ? Number(el.dataset.head) : null;
  };
  const mid = notes[10];
  const next = notes[11];
  return {
    inside: at(mid.start + 0.1),
    gap: at((mid.end + next.start) / 2),
    before: at(0.2),
    after: at(notes.at(-1).end + 0.3),
    atEnd: at(mid.end),
    nan: at(NaN),
    // The same instant asked the other way round: which head, and is it the
    // one whose ring is drawn for that note?
    headOfNote: view.bridge.timesOf(view.bridge.spans[10].headIndex).length,
  };
});
check('a moment inside a note lights that note\'s notehead',
  Number.isInteger(moments.inside), `head ${moments.inside}`);
check('the gap between two notes lights NOTHING',
  moments.gap === null, `gap → ${moments.gap}`);
check('and so does the instant a note ends, and before and after the take',
  moments.atEnd === null && moments.before === null && moments.after === null,
  `end=${moments.atEnd} before=${moments.before} after=${moments.after}`);
check('a time that is not a time is refused rather than guessed',
  moments.nan === null, `NaN → ${moments.nan}`);

// --- the light, moving, watched while the take plays -------------------------
const WATCH_MS = Number(process.env.WATCH_MS ?? 16000);
await page.evaluate(async () => {
  window.__trail = [];
  window.__sync = [];
  const seen = new Set();
  // WHAT THE PLAYBACK SAYS THE TIME IS, taken from the same subscription the
  // score page follows. "The light moved 34 times, strictly forward" passes
  // under a constant offset and under a speed-scaling error alike, which are
  // exactly the two ways a player sees this go wrong — so the moment is
  // recorded beside the wall clock and beside the notehead that is lit, and the
  // three are held to each other below.
  const { followPlayback } = await import('/src/ui/report.js');
  window.__stopFollow = followPlayback((note, time) => {
    window.__heard = { time, at: performance.now() };
  });
  const tick = () => {
    const lit = document.querySelector('#score-stage .scan-note.sounding');
    const key = lit ? lit.dataset.head : 'none';
    if (!seen.size || window.__trail.at(-1)?.head !== key) {
      window.__trail.push({
        head: key, page: lit?.closest('.scan-page')?.dataset.page ?? null, at: performance.now(),
      });
    }
    // Sampled about ten times a second, whatever the light is doing.
    const heard = window.__heard;
    if (heard && (!window.__sync.length || performance.now() - window.__sync.at(-1).at > 100)) {
      window.__sync.push({
        at: performance.now(),
        time: heard.time,
        head: key === 'none' ? null : Number(key),
        // …and where the take itself says that moment is, asked of the bridge
        // rather than of the picture.
        want: window.__view?.bridge?.headAt?.(heard.time)?.headIndex ?? null,
      });
    }
    seen.add(key);
    window.__watch = requestAnimationFrame(tick);
  };
  window.__playedAt = performance.now();
  document.querySelector('#clip-play')?.click();
  tick();
});

// Three moments, spread across the take, screenshotted where the light is.
//
// TWO things had to be got right before these pictures showed anything, and
// both were found by looking at the first ones rather than by reasoning:
//
//  1. the light is correctly OUT for a tenth of a second between every note, so
//     a shot taken on the clock alone catches a blank page one time in five;
//  2. keepInView scrolls the page SMOOTHLY to the note it has just lit, so the
//     box measured a frame earlier is three hundred pixels from where the ring
//     now is — the first run's crops were of empty staves either side of it.
//
// So the shot waits for a lit ring AND for the scroll to stop moving, then
// re-measures, and afterwards checks the same notehead is still the one lit.
const shots = [];
for (const [i, waitMs] of [3500, 6000, 5000].entries()) {
  await new Promise((r) => setTimeout(r, waitMs));
  let taken = null;
  for (let attempt = 0; attempt < 4 && !taken; attempt++) {
    const where = await page.evaluate(async () => {
      const find = () => document.querySelector('#score-stage .scan-note.sounding');
      let y = -1;
      let lit = null;
      for (let n = 0; n < 60; n++) {
        const now = find();
        if (now && window.scrollY === y) { lit = now; break; }
        y = window.scrollY;
        await new Promise((r) => setTimeout(r, 40));
      }
      if (!lit) return null;
      const b = lit.getBoundingClientRect();
      return {
        head: Number(lit.dataset.head),
        page: lit.closest('.scan-page')?.dataset.page ?? null,
        box: { x: b.x, y: b.y, width: b.width, height: b.height },
        scroll: { x: window.scrollX, y: window.scrollY },
      };
    });
    if (!where) continue;
    // A CROP round the light, not the whole viewport: the mark is a three-pixel
    // border and a glow, and at page scale a lit ring and an unlit one are the
    // same grey speck. Magnification is the method (CLAUDE.md).
    const pad = 110;
    const path = join(OUT, `follow-${i + 1}.png`);
    // DOCUMENT coordinates, not viewport ones — getBoundingClientRect gives the
    // second and page.screenshot's clip wants the first. Measured: with the
    // viewport at the top of the page the two agree and the crop is centred on
    // the light; once the follow-along has scrolled the review down, the same
    // arithmetic put the ring in the corner of the picture and the middle of the
    // crop on an empty stave. That is exactly the sort of picture that makes a
    // working cursor look broken and a broken one look fine.
    await page.screenshot({
      path,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, where.box.x + where.scroll.x - pad),
        y: Math.max(0, where.box.y + where.scroll.y - pad),
        width: pad * 2 + where.box.width,
        height: pad * 2 + where.box.height,
      },
    });
    // Still the same notehead lit, and still in the same PLACE. The head alone
    // is not enough: a smooth scroll that begins between the measurement and
    // the capture leaves the right note lit and the crop a hundred pixels off
    // it, which is what the third picture of the previous run was — an empty
    // stave with the ring in the corner.
    const still = await page.evaluate((want) => {
      const lit = document.querySelector('#score-stage .scan-note.sounding');
      if (!lit || lit.dataset.head !== String(want.head)) return false;
      const b = lit.getBoundingClientRect();
      return Math.abs(b.x - want.box.x) < 4 && Math.abs(b.y - want.box.y) < 4;
    }, where);
    if (still) taken = { ...where, path };
  }
  shots.push(taken ?? { lit: null });
  if (taken) console.log(`      shot ${i + 1}: head ${taken.head} on page ${taken.page} \u2192 ${taken.path}`);
}

const trail = await page.evaluate(() => {
  cancelAnimationFrame(window.__watch);
  return window.__trail;
});
const litHeads = trail.filter((t) => t.head !== 'none').map((t) => Number(t.head));
const litPages = [...new Set(trail.filter((t) => t.head !== 'none').map((t) => t.page))].sort();
const rising = litHeads.every((h, i) => i === 0 || h > litHeads[i - 1]);
const dark = trail.filter((t) => t.head === 'none').length;

// What the pairing put where, for the record: the light can only be as right
// as the marks under it, and the first few are worth printing because the take
// starts a long way down page one.
const firstSpans = await page.evaluate(() => window.__view.bridge.spans
  .slice(0, 4).map((s) => ({ head: s.headIndex, at: Number(s.start.toFixed(2)) })));
console.log(`      first marks: ${firstSpans.map((s) => `head ${s.head} at ${s.at}s`).join(', ')}`);
console.log(`      first noteheads lit: ${litHeads.slice(0, 4).join(', ')}`);

check('the light moves, notehead by notehead, while the take plays',
  litHeads.length >= 10, `${litHeads.length} different noteheads lit over ${(WATCH_MS / 1000).toFixed(0)}s`);
check('and it moves FORWARD, never back to a note already heard',
  rising, `first lit ${litHeads[0]}, last ${litHeads.at(-1)}`);
check('it goes out between notes rather than holding the last one lit',
  dark >= litHeads.length - 1, `${dark} moments with nothing lit`);
check('and it crosses onto the second page on its own',
  litPages.length === 2, `lit on pages ${litPages.join(', ')}`);

// THE LIGHT AGAINST THE SOUND, which is the check the user's complaint needed:
// "I need the playing to sync perfectly with the score … if you are playing
// fast, the notes being highlighted in the playback [must be] synced exactly
// with that part of the audio."
//
// Two questions, and each catches a failure the trail above cannot see. Is the
// notehead that is LIT the one the take says is sounding at that moment (a
// picture that lags its own data)? And does the moment the playback reports
// keep step with the CLOCK (a constant offset, or a speed that drifts)?
const sync = await page.evaluate(() => ({
  rows: window.__sync ?? [], from: window.__playedAt ?? 0,
}));
const placed = sync.rows.filter((r) => r.head !== null && r.want !== null);
const onTheRightHead = placed.filter((r) => r.head === r.want).length;
// The offset between the take's own clock and the wall clock, sample by sample.
// The CONSTANT part of it is not the app: `sync.from` is stamped just before
// the play button is pressed, and building the buffer for a sixteen-second take
// happens inside that click. What the app is answerable for is the SPREAD — an
// offset that grows is a rate error, and a rate error is what a player sees as
// the light drifting further out the longer they listen.
//
// The constant part cannot be measured from here at all: a headless browser
// reports no output latency, so the correction for it in report.js (the delay
// between the audio graph's clock and the sound leaving the speaker) is a
// no-op in this check by construction. It is measured on a device or not at
// all, and it is written up rather than asserted.
const offsets = sync.rows
  .filter((r) => Number.isFinite(r.time))
  .map((r) => r.time - (r.at - sync.from) / 1000);
// The first sample is the press itself and is thrown away: building the buffer
// for a sixteen-second take happens inside the click, so that one reads about
// 0.13s where every one after it reads 0.04. Measured, printed by OFFSETS=1.
const steady = offsets.slice(1);
const spread = steady.length ? Math.max(...steady) - Math.min(...steady) : Infinity;
const worstDrift = spread;
if (process.env.OFFSETS) {
  console.log(`      offsets: ${offsets.map((o) => o.toFixed(3)).join(' ')}`);
}
console.log(`      sync: ${onTheRightHead} of ${placed.length} samples lit the head the take`
  + ` says was sounding; offset ${offsets.length ? offsets[0].toFixed(3) : '—'}s at the start,`
  + ` spread ${spread.toFixed(3)}s over ${(WATCH_MS / 1000).toFixed(0)}s`);
check('the notehead lit is the one sounding at that moment, every time it is asked',
  placed.length >= 8 && onTheRightHead === placed.length,
  `${onTheRightHead} of ${placed.length}`);
check('and the moment it reports keeps step with the clock, start to end',
  worstDrift < 0.03,
  `the offset holds within ${worstDrift.toFixed(3)}s across ${steady.length} samples`);
check('the three screenshots caught the light on three different noteheads',
  new Set(shots.filter((s) => s.lit !== null).map((s) => s.head)).size === 3,
  shots.map((s) => (s.lit === null ? 'nothing lit' : `head ${s.head} (p${s.page})`)).join(' → '));

await page.evaluate(() => { document.querySelector('#clip-play')?.click(); });
await new Promise((r) => setTimeout(r, 400));

// --- pressing a notehead NOBODY PLAYED ---------------------------------------
//
// The whole task in one check. It must not play the nearest recorded note, and
// "it did not throw" is not the same claim — so what is asserted is that the
// pitch that sounded is the pitch the PAGE reads at that notehead, that the
// screen says so, and that no played note was selected on the way.
const silent = await page.evaluate(async () => {
  const view = window.__view;
  const dot = document.querySelector('#score-stage .scan-quiet');
  dot.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 250));
  const headIndex = Number(dot.dataset.head);
  const at = dot.getBoundingClientRect();
  // WHAT A FINGER ACTUALLY LANDS ON. `dot.click()` fires the element's own
  // handler whether or not a finger could ever reach it, which is how this
  // check would go on passing over a mark that has stopped taking presses.
  const under = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
  let buffers = 0;
  let oscs = 0;
  const startedBuffer = AudioBufferSourceNode.prototype.start;
  const startedOsc = OscillatorNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    buffers += 1; return startedBuffer.apply(this, args);
  };
  OscillatorNode.prototype.start = function (...args) {
    oscs += 1; return startedOsc.apply(this, args);
  };
  under?.click();
  // SAMPLED WHILE IT IS STILL IN THAT BAR. The light follows the playhead, and
  // a bar of a real page can be under a second long — waiting a second and then
  // asking which bar is lit is asking where the take has got to, not where it
  // started.
  let litSoon = false;
  let litLabel = null;
  for (let i = 0; i < 16 && !litSoon; i += 1) {
    await new Promise((r) => setTimeout(r, 60));
    litSoon = under?.classList?.contains('sounding') ?? false;
    litLabel = document.querySelector('#score-stage .scan-bar.sounding')?.getAttribute('aria-label') ?? litLabel;
  }
  await new Promise((r) => setTimeout(r, 400));
  AudioBufferSourceNode.prototype.start = startedBuffer;
  OscillatorNode.prototype.start = startedOsc;
  return {
    headIndex,
    hit: under?.className ?? null,
    buffers,
    oscs,
    pressedLabel: under?.getAttribute?.('aria-label') ?? null,
    litLabel,
    // The bar that was pressed, and whether the playhead was in it.
    litIsTheOnePressed: litSoon,
    picked: document.querySelectorAll('#score-stage .picked').length,
    readouts: document.querySelectorAll('.scan-reading').length,
    silentTimes: view.bridge.timesOf(headIndex).length,
  };
});
check('an unplayed notehead has no time in the recording at all',
  silent.silentTimes === 0, `timesOf(head ${silent.headIndex}) → ${silent.silentTimes} spans`);
// THE PROMISE CHANGED HERE, and these four assertions changed with it. A
// notehead nobody played used to be a button that sounded the pitch printed
// there. "I don't want to be able to press the note head. If you press the
// note head, I just want to start at the beginning of that bar… No going to
// individual notes, because I know that's not possible." He is right about the
// possible: on a photograph the reader finds roughly one head where the paper
// has one but not reliably THE one, and this file's own sister check had been
// reporting the consequence for two rounds (pressing head 116 lit 121-123).
check('a finger over an unplayed notehead lands on its BAR',
  String(silent.hit ?? '').includes('scan-bar'), `what is under it: "${silent.hit}"`);
check('and that press plays the take from there',
  silent.buffers >= 1 && silent.litIsTheOnePressed,
  `buffer sources ${silent.buffers}; pressed ${silent.pressedLabel},`
  + ` lit ${silent.litLabel} — the pressed bar is the lit one: ${silent.litIsTheOnePressed}`);
check('and NOTHING sounds a single written note on a scan',
  silent.oscs === 0, `oscillators started: ${silent.oscs}`);
check('and no note close-up is opened or picked',
  silent.picked === 0 && silent.readouts === 0,
  `${silent.picked} picked, ${silent.readouts} note readouts on the page`);

if (process.argv.includes('--shots')) {
  // The one that was pressed, at the same magnification as the cursor shots —
  // and the same document-coordinate clip, for the same reason.
  const where = await page.evaluate(() => {
    const dot = document.querySelector('#score-stage .scan-quiet.picked');
    if (!dot) return null;
    const b = dot.getBoundingClientRect();
    return { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height };
  });
  if (where) {
    const pad = 150;
    await page.screenshot({
      path: join(OUT, 'follow-silent.png'),
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, where.x - pad), y: Math.max(0, where.y - pad),
        width: pad * 2 + where.w, height: pad * 2 + where.h,
      },
    });
    console.log(`      shot: the notehead nobody played, pressed \u2192 ${join(OUT, 'follow-silent.png')}`);
  }
  await page.screenshot({ path: join(OUT, 'follow-page.png'), fullPage: false });
  console.log(`      shot: the whole review \u2192 ${join(OUT, 'follow-page.png')}`);
}

// --- pressing a notehead that WAS played, which must still work --------------
const heard = await page.evaluate(async () => {
  const ring = [...document.querySelectorAll('#score-stage .scan-note')][8];
  const head = Number(ring.dataset.head);
  const times = window.__view.bridge.timesOf(head);
  ring.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 250));
  const at = ring.getBoundingClientRect();
  const under = document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2);
  // WHAT STARTED, not what opened. Everything here once counted the PANEL — the
  // close-up, its label, the ring that looks pressed — and a panel is not a
  // sound: MEASURED, a press on this very ring once started 0 audio sources
  // while all of those assertions passed. The panel is gone now and the sound
  // is the whole of what is left to measure, which is the right way round.
  let buffers = 0;
  let oscs = 0;
  const startedBuffer = AudioBufferSourceNode.prototype.start;
  const startedOsc = OscillatorNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    buffers += 1; return startedBuffer.apply(this, args);
  };
  OscillatorNode.prototype.start = function (...args) {
    oscs += 1; return startedOsc.apply(this, args);
  };
  under?.click();
  await new Promise((r) => setTimeout(r, 900));
  AudioBufferSourceNode.prototype.start = startedBuffer;
  OscillatorNode.prototype.start = startedOsc;
  return {
    head,
    buffers,
    oscs,
    hit: under?.className ?? null,
    litIsTheOnePressed: under?.classList?.contains('sounding') ?? false,
    times: times.length,
    start: times[0]?.start ?? null,
  };
});
check('a finger over a ring lands on its BAR too',
  String(heard.hit ?? '').includes('scan-bar'), `what is under it: "${heard.hit}"`);
check('and pressing it STARTS AUDIO from the recording, which is the whole point',
  heard.buffers >= 1 && heard.oscs === 0 && heard.litIsTheOnePressed,
  `head ${heard.head} sounded at ${heard.start}s; buffer sources ${heard.buffers}`
  + ` (oscillators ${heard.oscs}), the pressed bar is the lit one:`
  + ` ${heard.litIsTheOnePressed} — see npm run score:hear`);

// The picture for that one, because "the close-up opened" is a claim about two
// things in two different places — the ring that looks pressed, and the panel
// that opened under it — and a crop of either alone shows half of it. The ring
// is scrolled to first so both are in one viewport.
{
  const where = await page.evaluate(async () => {
    const ring = document.querySelector('#score-stage .scan-bar.sounding')
      ?? document.querySelector('#score-stage .scan-note');
    ring?.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 400));
    const b = ring?.getBoundingClientRect();
    return b ? { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height } : null;
  });
  if (where) {
    const pad = 170;
    await page.screenshot({
      path: join(OUT, 'walk-3-pressed.png'),
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, where.x - pad), y: Math.max(0, where.y - pad),
        width: pad * 2 + where.w, height: pad * 2 + where.h,
      },
    });
    // …and the graph under it, which is the other half of where a press goes.
    await page.evaluate(async () => {
      document.querySelector('#chart-scroll')?.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 400));
    });
    await page.screenshot({ path: join(OUT, 'walk-3-graph.png'), fullPage: false });
    console.log(`      shot: the bar a press went to \u2192 ${join(OUT, 'walk-3-pressed.png')}`);
    console.log(`      shot: and the graph under it \u2192 ${join(OUT, 'walk-3-graph.png')}`);
  }
}

// --- ONE VOICE ON A SCAN, because there is no longer a second one ------------
//
// This used to check the two voices against each other: the take's own playback
// and the synthesised tone a notehead nobody played would sound, which must
// never be heard together. The tone has no way to start from a scanned page any
// more — the marks are marks and the bar is the control — so what is checked is
// that it really has none, from either direction, and that a press while the
// take is running re-seeks it rather than leaving two clips running.
const voices = await page.evaluate(async () => {
  const { writtenPitchSounding, stopWrittenPitch } = await import('/src/audio/written-pitch.js');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const dots = [...document.querySelectorAll('#score-stage .scan-quiet')];
  const play = document.querySelector('#clip-play');
  stopWrittenPitch();
  const hitAt = (node) => {
    const b = node.getBoundingClientRect();
    return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  };
  dots[0].scrollIntoView({ block: 'center' });
  await wait(250);
  hitAt(dots[0])?.click();
  await wait(300);
  const afterFirst = { tone: writtenPitchSounding(), transport: play.textContent };
  // Press another bar while that one is running: one take, one clip.
  let starts = 0;
  const started = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    starts += 1; return started.apply(this, args);
  };
  dots[1].scrollIntoView({ block: 'center' });
  await wait(250);
  hitAt(dots[1])?.click();
  await wait(500);
  AudioBufferSourceNode.prototype.start = started;
  const out = {
    ...afterFirst,
    toneAfterSecond: writtenPitchSounding(),
    startsOnSecondPress: starts,
    transportAfter: play.textContent,
  };
  play.click();
  await wait(200);
  return out;
});
check('a press on a scanned page never sounds a synthesised tone',
  voices.tone === false && voices.toneAfterSecond === false,
  `written-pitch sounding after the first press: ${voices.tone},`
  + ` after the second: ${voices.toneAfterSecond}`);
check('and pressing a second bar re-seeks the take rather than stacking on it',
  voices.startsOnSecondPress === 1 && voices.transportAfter === '\u275a\u275a',
  `sources started on the second press: ${voices.startsOnSecondPress},`
  + ` transport "${voices.transportAfter}"`);

// --- the failures it has to survive ------------------------------------------
//
// A take of a different piece over the same pages. This entry used to say that
// pairNotes does NOT refuse it — alignScore always returns a path — so all that
// could be checked was that nothing threw. pairNotes now carries a confidence
// floor and DOES refuse it, so the thing to check is the refusal and the
// sentence it puts on the page: 0 rings, 0 silent markers, and a reason with
// the count it was read off, because "what was played does not match the notes
// on these pages" is a strong thing to tell somebody about their own playing
// and an unarguable one without a number behind it.
const wrong = await page.evaluate(async () => {
  const { annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  const { wrongPiecePlayed, synthRecording } = await import('/src/fixtures/take-fixture.js');
  const { renderFreeReview } = await import('/src/ui/report.js');
  const played = wrongPiecePlayed();
  const rec = synthRecording(played);
  // clearSheet drops the take AND the chosen score, so the score has to be
  // chosen again — measured the hard way: without this the review had nothing
  // to draw and the check passed on an empty page.
  clearSheet?.();
  const { selectScore } = await import('/src/ui/score.js');
  await selectScore(window.__built.scoreId);
  renderFreeReview(document, played, rec, {
    readings: played.map((n) => ({ time: n.start, frequency: 220, confidence: 0.9, rms: 0.05, midi: n.midi, cents: n.cents })),
    a4: 440,
  });
  await annotateTake(played, { readings: [], a4: 440 });
  const view = await renderScoreTab();
  await new Promise((r) => setTimeout(r, 600));
  return {
    placed: view?.pairing?.placed ?? null,
    marks: view?.pairing?.marks?.length ?? 0,
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
    // SCOPED TO THE SCORE STAGE. A bare '.score-scan-gap' finds the free
    // review's own "add its MusicXML" note first, and the check then passed or
    // failed on a sentence from the other half of the page.
    gap: (document.querySelector('#score-stage .score-scan-gap')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
});
check('a take of a different piece is REFUSED rather than drawn',
  wrong.marks === 0 && wrong.rings === 0 && wrong.quiet === 0,
  `placed=${wrong.placed}, ${wrong.marks} marks, ${wrong.rings} rings, ${wrong.quiet} silent`);
check('and the page says so, with the count the refusal was read off',
  /does not match the notes on these pages/.test(wrong.gap)
    && /were the pitch printed there/.test(wrong.gap),
  wrong.gap.slice(0, 190));

// A page with no clef on it: nothing can be priced, the contour route refuses,
// and the review has to SAY so rather than draw anything.
const unread = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1100; c.height = 1400;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111';
  const s = 13;
  for (let sys = 0; sys < 4; sys++) {
    const top = 200 + sys * 240;
    for (let l = 0; l < 5; l++) g.fillRect(100, top + l * s, 900, 2);
    for (let i = 0; i < 8; i++) {
      const x = 160 + i * 105;
      const y = top + ((i * 3) % 5) * (s / 2) + s;
      g.beginPath(); g.ellipse(x, y, s * 0.62, s * 0.46, -0.3, 0, Math.PI * 2); g.fill();
    }
  }
  const blob = await new Promise((d) => c.toBlob(d, 'image/png'));
  const { savePagesScore } = await import('/src/store/db.js');
  const id = await savePagesScore({ name: 'No clef', source: 'images', pageCount: 1, pages: [blob] });
  const { selectScore, annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  const played = Array.from({ length: 20 }, (_, i) => ({
    midi: 50 + (i % 7), cents: 0, start: 0.5 + i * 0.4, end: 0.5 + i * 0.4 + 0.3,
  }));
  const { renderFreeReview } = await import('/src/ui/report.js');
  clearSheet?.();
  await selectScore(id);
  renderFreeReview(document, played, synthRecording(played), { readings: [], a4: 440 });
  await annotateTake(played, { readings: [], a4: 440 });
  const view = await renderScoreTab();
  await new Promise((r) => setTimeout(r, 800));
  return {
    view: view === null,
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
    // The gap ON THE STAGE, not the first one in the document: the review card
    // carries a `.score-scan-gap` of its own ("Read from the sound: …") and
    // asking for that one made this check pass on the wrong sentence.
    said: (document.querySelector('#score-stage .score-scan-gap')?.textContent ?? '').trim().slice(0, 220),
  };
});
check('a page whose clef could not be read marks NOTHING and says why',
  unread.rings === 0 && unread.quiet === 0 && /held back|have not been read|no noteheads/.test(unread.said),
  `${unread.rings} rings, ${unread.quiet} silent — "${unread.said.slice(0, 150)}"`);

// --- and with no take open at all --------------------------------------------
//
// The report can be closed under the page — every other scanned check has one
// open, so the state where the recording is simply not there has never been
// pressed. With no take, a press has no moment to go to and must do nothing at
// all rather than throw: the bars are still drawn, and they are still bars.
const noTake = await page.evaluate(async () => {
  const { scoreId, notes } = window.__built;
  const { selectScore, annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  const { hideReport } = await import('/src/ui/report.js');
  clearSheet?.();
  await selectScore(scoreId);
  await annotateTake(notes, { readings: [], a4: 440 });
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 500));
  hideReport(document);
  const before = document.querySelectorAll('#score-stage .scan-note').length;
  let threw = null;
  try {
    const box = document.querySelector('#score-stage .scan-bar');
    box?.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 250));
    box?.click();
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) { threw = String(err); }
  return {
    rings: before,
    bars: document.querySelectorAll('#score-stage .scan-bar').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
    threw,
  };
});
check('with the report closed under it, the page still answers and does not throw',
  noTake.rings > 0 && noTake.bars > 0 && noTake.threw === null,
  `${noTake.rings} rings, ${noTake.bars} bars, ${noTake.quiet} silent markers,`
  + ` threw: ${noTake.threw ?? 'nothing'}`);

// --- and with NO TAKE AT ALL --------------------------------------------------
//
// Not the same state as the one above, which closed a report that had already
// been built. This is the review being asked to draw a take of nothing:
// pairNotes gets an empty array, alignByPitch bails on `played.length < 2`, and
// findStart is handed a take with no shape to find. Nothing may throw and
// nothing may be drawn — an empty take on a page of a hundred noteheads is
// exactly the shape that would sprout a hundred dashed circles claiming you
// played none of them.
const empty = await page.evaluate(async () => {
  const { scoreId } = window.__built;
  const { selectScore, annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  clearSheet?.();
  await selectScore(scoreId);
  let threw = null;
  try {
    await annotateTake([], { readings: [], a4: 440 });
    await renderScoreTab();
  } catch (e) {
    threw = String(e);
  }
  await new Promise((r) => setTimeout(r, 400));
  return {
    threw,
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
  };
});
check('a take with no notes in it draws nothing and throws nothing',
  empty.threw === null && empty.rings === 0 && empty.quiet === 0,
  `${empty.rings} rings, ${empty.quiet} silent, threw=${empty.threw}`);

// --- AND ON A REAL PHOTOGRAPH, which is the only input the app ever gets ------
//
// Everything above happens on an engraving this file drew, because that is the
// only kind of page on which the PITCH route can be watched at all (a page with
// no clef prices no head and the pairing refuses — see the header). But an
// engraving is not what a user photographs, and until this block nothing in the
// repo had ever drawn the review over a real photographed page: `score:pdf`
// stores a PDF made of drawn ellipses with no clef, and its two red checks are
// that refusal and not a drawing failure — MEASURED, its own probe now prints
// "40 notes played, and 127 noteheads read off the pages — but what was played
// does not follow the shape of the notes on these pages".
//
// So one page of pages/index.json goes in as a PDF-backed part, exactly as an
// imported part does. WHAT THIS DOES AND DOES NOT MEASURE: the take is
// synthesised FROM THE READER'S OWN midi for a run of consecutive noteheads, so
// it says NOTHING about whether the alignment is right — that would be a
// tautology, and `npm run scan:align` is the instrument for it. What it does
// say is that a photographed part is read, drawn, marked, timed and spoken
// about without throwing: the whole review, on the real thing.
let real = null;
try {
  const list = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
  const chosen = list[Number(process.env.PHOTO ?? 0)];
  const bytes = (await readFile(chosen.file)).toString('base64');
  real = await page.evaluate(async ({ b64, name }) => {
    const { savePagesScore } = await import('/src/store/db.js');
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const scoreId = await savePagesScore({ name, source: 'pdf', pageCount: 1, data });
    const { selectScore, measurePages, annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
    const { loadScorePages } = await import('/src/store/db.js');
    const { headsOf } = await import('/src/ui/scan-view.js');
    clearSheet?.();
    await selectScore(scoreId);
    await measurePages(scoreId);
    const payload = await loadScorePages(scoreId);
    const heads = headsOf(payload.layout);
    // A run of consecutive noteheads from a third of the way in, so the take
    // does not start at the top of the page and the marks are not a lucky
    // count from zero.
    const from = Math.floor(heads.length / 3);
    const run = heads.slice(from, from + 28).filter((h) => Number.isFinite(h.midi));
    const notes = run.map((h, i) => ({
      midi: h.midi, name: null, cents: ((i * 29) % 41) - 20,
      start: 0.6 + i * 0.5, end: 0.6 + i * 0.5 + 0.38,
    }));
    // The noteheads the take was BUILT from, so that where each mark landed can
    // be counted afterwards. This is not a measurement of pitch — the take came
    // out of the reader — but WHERE a mark lands is a fact about the aligner
    // and this is the only place in the repo it is asked of real paper.
    window.__wanted = run.map((h) => heads.indexOf(h));
    const { synthRecording } = await import('/src/fixtures/take-fixture.js');
    const rec = synthRecording(notes);
    const { renderFreeReview } = await import('/src/ui/report.js');
    renderFreeReview(document, notes, rec, {
      readings: notes.map((n) => ({
        time: n.start, frequency: 440 * 2 ** ((n.midi - 69) / 12),
        confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
      })),
      a4: 440,
    });
    await annotateTake(notes, { readings: [], a4: 440 });
    const view = await renderScoreTab();
    await new Promise((r) => setTimeout(r, 800));
    return {
      pageHeads: heads.length,
      priced: heads.filter((h) => Number.isFinite(h.midi)).length,
      played: notes.length,
      placed: view?.pairing?.placed ?? null,
      readPitch: view?.pairing?.readPitch ?? null,
      marks: view?.pairing?.marks?.length ?? 0,
      rings: document.querySelectorAll('#score-stage .scan-note').length,
      quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
      pages: document.querySelectorAll('#score-stage .scan-page').length,
      canvasWide: document.querySelector('#score-stage .scan-page canvas')?.width ?? 0,
      summary: (document.querySelector('#score-tab-summary')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      rhythmRoute: document.querySelector('#score-tab-summary .scan-rhythm')?.dataset.route ?? null,
      barRoute: document.querySelector('#score-tab-summary .scan-bars')?.dataset.route ?? null,
      barText: (document.querySelector('#score-tab-summary .scan-bars')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      onTheirOwnHead: (view?.pairing?.marks ?? [])
        .filter((m, i) => m.headIndex === window.__wanted[i]).length,
      wanted: window.__wanted.length,
      // WHERE each mark went against where it came from, note by note. A
      // constant difference is an index-space mismatch; a growing one is
      // reading order; scatter is the matching itself. Nothing in this repo
      // printed this, and "11 of 28" cannot be acted on without it.
      landed: (view?.pairing?.marks ?? []).map((m, i) => ({
        note: m.index,
        from: window.__wanted[i] ?? null,
        onto: m.headIndex,
        verdict: m.verdict ?? null,
      })),
    };
  }, { b64: bytes, name: `${chosen.name} photograph` });
} catch (e) {
  real = { failed: String(e) };
}
if (real?.failed) {
  check('a real photographed part is read, drawn and marked', false, real.failed.slice(0, 160));
} else {
  console.log(`      photograph: ${real.pageHeads} heads (${real.priced} priced),`
    + ` ${real.marks} marks of ${real.played} notes, rhythm route=${real.rhythmRoute}`);
  console.log(`      the review says: ${real.summary}`);
  if (process.env.LANDED) {
    console.log(`      where each mark landed (note: from -> onto, verdict):`);
    console.log(`        ${(real.landed ?? []).map((l) => `${l.note}: ${l.from}->${l.onto}${l.from === l.onto ? '' : ' *'}`).join('  ')}`);
  }
  // Printed, not checked. There is no agreed target for this and inventing one
  // here would be a threshold nobody measured — `npm run scan:align` is where a
  // number for it lives. What it is worth saying out loud is that a take taken
  // VERBATIM off this page's own noteheads does not all come back on them, on
  // music that repeats a figure every bar.
  console.log(`      marks that landed on the very notehead they were built from:`
    + ` ${real.onTheirOwnHead} of ${real.wanted}`);
  check('a real photographed page is DRAWN in the review, from the PDF itself',
    real.pages >= 1 && real.canvasWide > 300,
    `${real.pages} page(s), canvas ${real.canvasWide}px`);
  check('the take goes onto it by PITCH, and the marks are drawn',
    real.placed === true && real.readPitch === true && real.rings > 10,
    `${real.marks} marks, ${real.rings} rings, ${real.quiet} silent markers`);
  check('and it gets a rhythm sentence like any other page',
    real.rhythmRoute !== null, `route=${real.rhythmRoute}`);
  // THE BAR SENTENCE, AND THE WORD IT MUST NOT CONTAIN.
  //
  // This line used to read "Against the bars on the page: 0% steady across 6
  // bars, dragging" about a take laid on a half-second grid whose own free
  // review says 100% even. `steadiness` is the spread of the lengths of the
  // stretches the reader's barlines cut the take into, and on this page four of
  // ten systems are barred right and the rest are cut into fragments by stems —
  // so it is a statement about the GROUPING and it was worded as one about the
  // player. It says nothing of the sort now, and this is the assertion that
  // stops it coming back: on a page whose bars are refused the sentence must
  // take the `groups` route and must not use the word "steady" at all.
  check('the bar sentence does not call a bar-group verdict a verdict on your pulse',
    real.barRoute === 'groups' && !/steady/i.test(real.barText),
    `[${real.barRoute}] ${real.barText.slice(0, 120)}`);
  await page.screenshot({ path: join(OUT, 'walk-2-photograph.png'), fullPage: false });
  console.log(`      shot: the review on a real photograph \u2192 ${join(OUT, 'walk-2-photograph.png')}`);
}

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
check('nothing threw on the page while all that happened', errors.length === 0,
  `${errors.length} page errors`);

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
