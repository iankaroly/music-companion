// PRESS A NOTEHEAD, HEAR THAT NOTE — counted in AUDIO SOURCES THAT STARTED.
//
// WHY THIS FILE EXISTS AT ALL, which is the whole point of it.
//
// The app's own sentence for this screen is "if you click on a note on the
// score you hear that note in the audio". Thirty-five browser checks passed
// over it while it measured ZERO: `tools/scan-follow-check.mjs` asserts that
// pressing a ring OPENS THE CLOSE-UP — the panel, the label, the ring that
// looks pressed — and a panel opening is not a sound. MEASURED on this tree
// before the fix, by patching the two prototypes below and pressing a ring on
// the Bach photograph: `{ buffersStartedAfterPress: 0, oscillatorsAfterPress:
// 0, zoomPlayButton: "play" }`. Every link of the chain worked and the last one
// did not exist.
//
// So this check counts the thing itself. `AudioBufferSourceNode.prototype
// .start` and `OscillatorNode.prototype.start` are patched IN THE PAGE and the
// calls are counted as deltas around each press — deltas because drones, the
// click track and the written-pitch tone all start nodes of their own, and a
// running total would let one press take credit for another's sound.
//
// THE TWO NUMBERS, AND WHY THEY ARE A PAIR.
//   - a notehead you PLAYED  → buffer sources >= 1. A buffer source is the
//     recording; there is no other way to hear one in this app.
//   - a notehead NOBODY played → buffer sources == 0 and oscillators >= 1.
//     That is CLAUDE.md rule 5 as a number: the unplayed head sounds the
//     WRITTEN pitch, synthesised (src/audio/written-pitch.js builds an
//     OscillatorNode), and can never be handed some other note's audio. The
//     structural argument for it is real — pickSilent takes a HEAD and its
//     module can reach nothing but the audio context — but a structural
//     argument is not a measurement, and this is the measurement.
//
// AND A SOURCE THAT STARTED IS STILL NOT A SOUND, so two more things are asked:
// that the AudioContext is actually RUNNING (a suspended context starts sources
// that nobody hears), and that the moving light lands on THE VERY NOTEHEAD that
// was pressed — the clip opens on a third of a second of the previous music,
// ducked, so "audio began" and "you heard that head" are genuinely different
// claims and only the second one is the capability.
//
// THE FIRST PRESS IS A REAL MOUSE CLICK, at the ring's own coordinates, and the
// browser is launched WITHOUT `--autoplay-policy=no-user-gesture-required` —
// unlike scan-follow-check.mjs, which needs it to drive the transport. A
// counted `start()` on a context that the autoplay policy would have refused in
// a real user's browser is exactly the kind of green light this file exists to
// stop. Later presses use element.click(), which is honest: the page has
// sticky user activation from that first real click, as it does under a finger.
//
// NO MICROPHONE AND NO CAMERA. The take is synthesised into a real Recorder by
// src/fixtures/take-fixture.js, and the page is a PDF read off disk.
//
// ONE DEV SERVER, AND MAKE SURE IT IS THE ONE YOU THINK. MEASURED, painfully,
// while writing this: a vite left running on the port from an earlier command
// served a module graph from before the edit, and the symptom was not an error
// but this file's own light assertion failing — "head 116 never lit" — against
// code that was working. Clear the port before a run
// (`lsof -ti tcp:$PORT | xargs kill -9`) if a pass turns into a fail the moment
// you touch a file. CLAUDE.md's note on vite's versioned module URLs is the
// same trap from the other end.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run score:hear
//   PHOTO=1 npm run score:hear     (0 Bach, 1 the Concerto, 2 the Scanned score)
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
// Outside the project, for the reason scan-follow-check.mjs found the hard way:
// writing a PNG into the tree while vite is serving it full-reloads the page
// out from under the check.
const OUT = process.env.OUT ?? join(tmpdir(), 'music-companion-hear');
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox'],
  protocolTimeout: 240000,
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await wait(1800);
await page.evaluate(() => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
});

// --- the counters, installed before anything can make a noise ----------------
await page.evaluate(() => {
  window.__audio = { buffers: [], oscs: [] };
  const startedBuffer = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    window.__audio.buffers.push({
      at: performance.now(),
      seconds: this.buffer ? this.buffer.duration : null,
    });
    return startedBuffer.apply(this, args);
  };
  const startedOsc = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    window.__audio.oscs.push({ at: performance.now(), hz: this.frequency.value });
    return startedOsc.apply(this, args);
  };
  // A snapshot to take deltas against.
  window.__mark = () => ({
    buffers: window.__audio.buffers.length,
    oscs: window.__audio.oscs.length,
  });
});

// --- a real photographed part, a take on it, and the review ------------------
//
// The page is one of pages/index.json, stored as a PDF-backed part exactly as
// an imported part is. The take is synthesised FROM THE READER'S OWN midi for a
// run of consecutive noteheads, which says nothing about whether the alignment
// is right (it is a tautology by construction, and `npm run scan:align` is the
// instrument for that) and everything about whether a press on a ring reaches
// the recording, which is what this file measures.
const list = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const chosen = list[Number(process.env.PHOTO ?? 0)];
const bytes = (await readFile(chosen.file)).toString('base64');
const shown = await page.evaluate(async ({ b64, name }) => {
  const { savePagesScore, loadScorePages } = await import('/src/store/db.js');
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const scoreId = await savePagesScore({ name, source: 'pdf', pageCount: 1, data });
  const {
    selectScore, measurePages, annotateTake, renderScoreTab, initScoreCard, clearSheet,
  } = await import('/src/ui/score.js');
  const { headsOf } = await import('/src/ui/scan-view.js');
  clearSheet?.();
  await selectScore(scoreId);
  await measurePages(scoreId);
  const payload = await loadScorePages(scoreId);
  const heads = headsOf(payload.layout);
  const from = Math.floor(heads.length / 3);
  const run = heads.slice(from, from + 28).filter((h) => Number.isFinite(h.midi));
  const notes = run.map((h, i) => ({
    midi: h.midi, name: null, cents: ((i * 29) % 41) - 20,
    start: 0.6 + i * 0.5, end: 0.6 + i * 0.5 + 0.38,
  }));
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  const rec = synthRecording(notes);
  const readings = notes.map((n) => ({
    time: n.start, frequency: 440 * 2 ** ((n.midi - 69) / 12),
    confidence: 0.95, rms: 0.05, midi: n.midi, cents: n.cents,
  }));
  const { renderFreeReview, selectPlayedNote } = await import('/src/ui/report.js');
  renderFreeReview(document, notes, rec, { readings, a4: 440 });
  await annotateTake(notes, { readings, a4: 440 });
  // EXACTLY main.js:2189. The chain under test is scan-view's ring →
  // score.js's onPick → this → report.js's selectFromOutside, and a check that
  // wires it any other way is measuring its own wiring.
  initScoreCard({ onPickNote: (note) => selectPlayedNote(note) });
  const { onScoreTabShown } = await import('/src/ui/score-tab.js');
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  onScoreTabShown();
  const view = await renderScoreTab();
  window.__view = view;
  window.__rec = rec;
  await new Promise((r) => setTimeout(r, 600));
  return {
    heads: heads.length,
    played: notes.length,
    placed: view?.pairing?.placed ?? null,
    readPitch: view?.pairing?.readPitch ?? null,
    marks: view?.pairing?.marks?.length ?? 0,
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
    duration: rec.duration,
  };
}, { b64: bytes, name: `${chosen.name} photograph` });

check('a real photographed part is read, taken onto by pitch, and marked',
  shown.placed === true && shown.rings > 5 && shown.quiet > 0,
  `${chosen.name}: ${shown.heads} heads, ${shown.marks} marks, ${shown.rings} rings,`
  + ` ${shown.quiet} silent markers, take ${shown.played} notes over ${shown.duration.toFixed(1)}s`);

// --- THE PRESS. A ring, with a real mouse, at its own coordinates ------------
const aim = await page.evaluate(async () => {
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  // Not the first: the first ring of a take is the one most likely to sit at
  // the very start of the recording, where the clip's lead-in is clamped.
  const ring = rings[Math.min(8, rings.length - 1)];
  ring.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 400));
  const head = Number(ring.dataset.head);
  const span = window.__view.bridge.timesOf(head)[0] ?? null;
  const box = ring.getBoundingClientRect();
  // Watch the light from before the press until well after it, and keep the
  // first moment the notehead that was PRESSED is the one lit.
  window.__watch = {
    t0: performance.now(), first: null, heads: new Set(), frames: 0, buttons: new Set(),
    anywhere: 0,
  };
  const tick = () => {
    // SAMPLED EVERY FRAME, not read at the end, and that is the difference
    // between a measurement and a miss: the clip is about a second long, so by
    // the time a check that waits for it to finish looks at the transport, the
    // transport is correctly back at ▶. The claim is that it said ❚❚ WHILE it
    // was playing.
    window.__watch.buttons.add(document.querySelector('#zoom-play')?.textContent ?? null);
    // Counted across the WHOLE document as well as inside the stage: when this
    // assertion fails the first question is whether nothing lit at all or
    // something lit somewhere else, and a selector that can only answer one of
    // those turns a five-minute answer into an hour.
    if (document.querySelectorAll('.sounding').length) window.__watch.anywhere += 1;
    const lit = document.querySelector('#score-stage .scan-note.sounding');
    if (lit) {
      const h = Number(lit.dataset.head);
      window.__watch.heads.add(h);
      if (h === head && window.__watch.first === null) {
        window.__watch.first = performance.now() - window.__watch.t0;
      }
    }
    window.__watch.frames += 1;
    window.__watch.raf = requestAnimationFrame(tick);
  };
  tick();
  return {
    head,
    start: span?.start ?? null,
    end: span?.end ?? null,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    before: window.__mark(),
    state: window.audioContextState ?? null,
  };
});

await page.mouse.click(aim.x, aim.y);
await wait(1200);

const heard = await page.evaluate(async () => {
  const { audioState } = await import('/src/audio/context.js');
  cancelAnimationFrame(window.__watch.raf);
  const ring = document.querySelector('#score-stage .scan-note.picked');
  return {
    after: window.__mark(),
    buffers: window.__audio.buffers.slice(-3),
    lastBufferAt: window.__audio.buffers.at(-1)?.at ?? null,
    watchT0: window.__watch.t0,
    firstLit: window.__watch.first,
    litHeads: [...window.__watch.heads],
    frames: window.__watch.frames,
    anywhere: window.__watch.anywhere,
    state: audioState().state,
    holds: audioState().holds,
    pickedHead: ring ? Number(ring.dataset.head) : null,
    buttons: [...window.__watch.buttons],
    zoomButton: document.querySelector('#zoom-play')?.textContent ?? null,
    zoomOpen: document.querySelector('#note-zoom')?.hidden === false,
    label: document.querySelector('#zoom-label')?.textContent ?? '',
    reading: (document.querySelector('.scan-reading')?.textContent ?? '').trim(),
  };
});

const startedPlayed = {
  buffers: heard.after.buffers - aim.before.buffers,
  oscs: heard.after.oscs - aim.before.oscs,
};
// THE NUMBER THIS FILE IS FOR.
check('pressing a notehead you PLAYED starts audio from the recording',
  startedPlayed.buffers >= 1,
  `buffer sources started after press: ${startedPlayed.buffers}`
  + ` (oscillators ${startedPlayed.oscs}), head ${aim.head} sounded at`
  + ` ${aim.start === null ? 'null' : `${aim.start.toFixed(2)}s`}`);
check('…on a context that is actually running, not a source nobody can hear',
  heard.state === 'running',
  `AudioContext.state="${heard.state}", holds=[${heard.holds}],`
  + ` clip ${heard.buffers.at(-1)?.seconds?.toFixed(2) ?? '—'}s long`);
check('…and the note that sounds is the one you pressed, not the one before it',
  heard.firstLit !== null && heard.pickedHead === aim.head,
  heard.firstLit === null
    ? `head ${aim.head} never lit; lit ${JSON.stringify(heard.litHeads)} over ${heard.frames}`
      + ` frames (${heard.anywhere} frames with something lit anywhere on the page)`
    : `head ${aim.head} lit ${(heard.firstLit - (heard.lastBufferAt - heard.watchT0)).toFixed(0)}ms`
      + ` after the source started (lead-in), pressed ring head ${heard.pickedHead}`);
check('…and the transport says so, which is what read "play" while nothing played',
  heard.buttons.includes('\u275a\u275a'),
  `zoom play button while the clip ran: ${JSON.stringify(heard.buttons)},`
  + ` back to "${heard.zoomButton}" after it, close-up "${heard.label}"`);

// The ring, magnified — LOOK AT IT rather than believe the class name.
//
// Clipped INSIDE the viewport and without `captureBeyondViewport`, unlike the
// other scanned checks: MEASURED on this machine at load average 5.6 (three
// agents at once), a beyond-viewport capture of a full photographed page timed
// out Page.captureScreenshot altogether and took the whole run down with it.
// The ring is already scrolled to the middle of the screen, so there is
// nothing beyond the viewport to capture.
{
  // IN DOCUMENT COORDINATES, not viewport ones, and that cost a round: a
  // screenshot `clip` is measured from the top of the PAGE while
  // getBoundingClientRect is measured from the top of the WINDOW, so the first
  // version of this crop came out 145 px — one scroll offset — above the ring
  // and showed a patch of blank paper between two systems. A crop that misses
  // is worse than no crop: it looks like evidence.
  const where = await page.evaluate(() => {
    const ring = document.querySelector('#score-stage .scan-note.picked');
    const b = ring?.getBoundingClientRect();
    return b
      ? { x: b.x + window.scrollX, y: b.y + window.scrollY, w: b.width, h: b.height }
      : null;
  });
  if (where) {
    const pad = 90;
    await page.screenshot({
      path: join(OUT, 'hear-1-pressed.png'),
      clip: {
        x: Math.max(0, where.x + where.w / 2 - pad),
        y: Math.max(0, where.y + where.h / 2 - pad),
        width: pad * 2, height: pad * 2,
      },
    });
    console.log(`      shot: the ring that was pressed → ${join(OUT, 'hear-1-pressed.png')}`);
  }
}

// --- AND THE HEAD NOBODY PLAYED, which must never reach the recording --------
//
// Pressed WHILE the take is still playing, deliberately: that is the moment the
// two voices could sound together, and it is also the arrangement in which a
// buffer source started for some other reason would be easiest to miscount.
const silent = await page.evaluate(async () => {
  const { writtenPitchSounding } = await import('/src/audio/written-pitch.js');
  const rings = [...document.querySelectorAll('#score-stage .scan-quiet')];
  const dot = rings[0];
  // The take is STARTED FIRST and the unplayed head pressed 200 ms into it, on
  // purpose: with the clip a second long, a check that scrolls and waits before
  // pressing measures the silence after it and calls that a pass. Nothing is
  // scrolled here for the same reason — .click() does not need the element on
  // screen, and the 250 ms it would cost is a quarter of the clip.
  document.querySelectorAll('#score-stage .scan-note')[Math.min(8, rings.length - 1)]?.click();
  await new Promise((r) => setTimeout(r, 200));
  const before = window.__mark();
  const playingBefore = document.querySelector('#zoom-play')?.textContent ?? null;
  dot.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    before,
    after: window.__mark(),
    playingBefore,
    playingAfter: document.querySelector('#zoom-play')?.textContent ?? null,
    tone: writtenPitchSounding(),
    text: (document.querySelector('.scan-reading')?.textContent ?? '').trim(),
    pickedRings: document.querySelectorAll('#score-stage .scan-note.picked').length,
    pickedQuiet: document.querySelectorAll('#score-stage .scan-quiet.picked').length,
    lastOsc: window.__audio.oscs.at(-1)?.hz ?? null,
  };
});
const startedSilent = {
  buffers: silent.after.buffers - silent.before.buffers,
  oscs: silent.after.oscs - silent.before.oscs,
};
check('pressing a notehead NOBODY played starts NO source from the recording',
  startedSilent.buffers === 0,
  `buffer sources started after press: ${startedSilent.buffers} — "${silent.text}"`);
check('…it sounds the WRITTEN pitch instead, synthesised',
  startedSilent.oscs >= 1 && silent.tone === true,
  `oscillators started: ${startedSilent.oscs} at ${silent.lastOsc?.toFixed(1) ?? '—'}Hz,`
  + ` sounding=${silent.tone}`);
check('…and it stops the take, which was PLAYING when it was pressed',
  silent.playingBefore === '\u275a\u275a' && silent.playingAfter === '\u25b6'
  && silent.pickedRings === 0 && silent.pickedQuiet === 1,
  `transport "${silent.playingBefore}"→"${silent.playingAfter}",`
  + ` ${silent.pickedRings} rings picked, ${silent.pickedQuiet} silent markers picked`);

// --- THE LAST RING, where a take runs out of audio ---------------------------
//
// The segmenter's `end` is a frame time and a Recorder's `duration` is a sample
// count, so the final note of a take can end a hair PAST the end of the audio.
// A guard that refused that press would look like a fix everywhere except on
// the one note nobody presses in a check — so it is pressed here, and the
// number asked of it is the same number: sources started.
const last = await page.evaluate(async () => {
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  const ring = rings.at(-1);
  const head = Number(ring.dataset.head);
  const span = window.__view.bridge.timesOf(head)[0] ?? null;
  const before = window.__mark();
  ring.click();
  await new Promise((r) => setTimeout(r, 600));
  return {
    head,
    before,
    after: window.__mark(),
    end: span?.end ?? null,
    duration: window.__rec.duration,
    said: (document.querySelector('#status')?.textContent ?? '').trim(),
  };
});
check('and the LAST note of the take, which ends where the audio does, sounds too',
  last.after.buffers - last.before.buffers >= 1,
  `head ${last.head} ends at ${last.end?.toFixed(3)}s of ${last.duration.toFixed(3)}s;`
  + ` buffer sources started: ${last.after.buffers - last.before.buffers}`
  + `${last.said ? ` — said "${last.said}"` : ''}`);

// --- and the tile that has always said "play this note back" -----------------
const tile = await page.evaluate(async () => {
  document.querySelector('.tab-btn[data-tab="record"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  const btn = [...document.querySelectorAll('#report-grid .degree.clickable')][4];
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center' });
  await new Promise((r) => setTimeout(r, 250));
  const before = window.__mark();
  const title = btn.title;
  btn.click();
  await new Promise((r) => setTimeout(r, 700));
  return {
    before, after: window.__mark(), title,
    lit: document.querySelectorAll('#report-grid .degree.playing').length,
  };
});
check('and the review tile that says "play this note back" now does',
  tile !== null && tile.after.buffers - tile.before.buffers >= 1,
  tile === null ? 'no clickable tile in the review'
    : `title "${tile.title}", buffer sources started: ${tile.after.buffers - tile.before.buffers}`);

await page.screenshot({ path: join(OUT, 'hear-2-review.png'), fullPage: false });
console.log(`      shot: the review after the presses → ${join(OUT, 'hear-2-review.png')}`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
check('nothing threw on the page while all that happened', errors.length === 0,
  `${errors.length} page errors`);

console.log(`\n      sources started — played head: ${startedPlayed.buffers} buffer,`
  + ` ${startedPlayed.oscs} oscillator; unplayed head: ${startedSilent.buffers} buffer,`
  + ` ${startedSilent.oscs} oscillator`);

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
