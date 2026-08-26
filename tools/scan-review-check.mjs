// The scanned page IN the review, not on a music stand.
//
// What was asked for: recording against a photograph should end the same way
// recording against MusicXML does — the score in the review card, under the
// transport, beside the zoomed graph, with the note being heard lit and every
// note clickable for a drone and a close-up. NOT thrown into the full-screen
// reader, which is for playing from rather than thinking about.
//
// So this checks the review, and it checks it as a player meets it: press Stop
// with a scan chosen, then look at the Score tab.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-review-check.mjs
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const font = (await readFile(new URL('./fonts/Bravura.otf', import.meta.url))).toString('base64');

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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

// Two pages of real engraving, stored the way the app stores them — as Blobs.
// A data URL falls through readableImage to the missing-page placeholder and
// every page then reads as blank grey, which is a harness testing a fiction.
// Two pages of REAL MUSIC, and a take played from what is written on them.
//
// The pages were drawn ellipses on five lines until this round, and a page with
// no clef prices no notehead — so the review refuses to place a take on it,
// which is right, and which had left fourteen assertions here red: the rings,
// their colours, the press that opens a close-up, the sentence about the bars.
// Engraved in Bravura now, with a bass clef and a signature, and the take is
// built from the page's own written pitches. See src/fixtures/engraved-page.js.
const built = await page.evaluate(async ({ b64 }) => {
  const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const { scoreId, written } = await engravePart({
    base64: b64, name: 'Scanned part', pages: 2, systems: 5, perSystem: 8, space: 13,
  });
  const notes = takeFromWritten(written, { from: 0, count: 50, spacing: 0.2, sounding: 0.18, lead: 0 });
  const readings = notes.map((n) => ({
    time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
    midi: n.midi, cents: n.cents,
  }));
  const { saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const seconds = Math.ceil(notes.at(-1).end) + 1;
  const recId = await saveRecording({
    date: Date.now(), duration: seconds, sampleRate: 44100,
    audio: new Float32Array(44100 * seconds), notes, readings, a4: 440,
  });
  await setRecordingScore(recId, scoreId);
  window.__written = written;
  return { scoreId, recId, notes: notes.length };
}, { b64: font });

// NOTHING is read yet, which is the state a fresh import is in: the reading
// pass stands aside whenever the player is doing anything, so importing a part
// and recording straight away leaves it with nothing read. The review has to
// be the thing that fixes that.
const before = await page.evaluate(async (scoreId) => {
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  return (row?.layout ?? []).filter(Boolean).length;
}, built.scoreId);
check('the part starts out unread, as a fresh import is', before === 0,
  `${before} pages read before the review`);

// Now stand where a player stands: the take just finished, on the Score tab.
const review = await page.evaluate(async ({ scoreId, recId }) => {
  const { selectScore, annotateTake, renderScoreTab } = await import('/src/ui/score.js');
  const { renderFreeReview } = await import('/src/ui/report.js');
  const { Recorder } = await import('/src/audio/recording.js');
  const { loadRecording } = await import('/src/store/db.js');
  await selectScore(scoreId);
  const data = await loadRecording(recId);
  // Kept, so the click check can ask about the very objects the review and the
  // page were both built from. Reloading it from the store would hand back
  // copies, and identity against a copy proves nothing either way.
  window.__takeNotes = data.notes;
  window.__takeReadings = data.readings;
  // The transport belongs to the review, and the review has to have the take.
  const rec = new Recorder(data.sampleRate ?? 44100);
  rec.push(data.samples ?? new Float32Array(data.audio ?? 0));
  renderFreeReview(document, data.notes, rec, {
    readings: data.readings, a4: data.a4, recordingId: recId,
  });
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  // The real flow: TAP the tab and let the app render it, exactly as a player
  // does. Calling renderScoreTab by hand here would hide whether the app's own
  // wiring reaches it — and the pages are read at this moment, which takes a
  // second or two a page, so it is waited for rather than assumed.
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  // Rendered through THIS module instance, deliberately.
  //
  // A dynamic import of '/src/ui/score.js' from a check is not the same module
  // record as main.js's own './ui/score.js' — the dev server serves them
  // separately, so the app's copy and the check's copy each have their own
  // `current`, `ready` and `onPick`. Everything above was set on this copy, so
  // this copy is the one that has to draw, and the picker has to be wired on it
  // as main.js wires its own. (In a build there is one bundle and one copy;
  // this is a property of driving the app from outside, not of the app.)
  const { selectPlayedNote } = await import('/src/ui/report.js');
  const { initScoreCard } = await import('/src/ui/score.js');
  initScoreCard({ onPickNote: (note) => selectPlayedNote(note) });
  const { onScoreTabShown } = await import('/src/ui/score-tab.js');
  onScoreTabShown();
  await renderScoreTab();

  // A reader that has never been built is not an OPEN reader — and `?.hidden`
  // on a missing element is undefined, which negates to "open" and would have
  // passed this check for the wrong reason in both directions.
  const readerEl = document.querySelector('#reader');
  const readerOpen = !!readerEl && !readerEl.hidden;
  const notes = [...document.querySelectorAll('#score-stage .scan-note')];
  const onShownPage = notes.filter((n) => !n.closest('.scan-page')?.hidden);
  const dock = document.querySelector('#score-dock');
  return {
    readerOpen,
    pagesShown: document.querySelectorAll('#score-stage .scan-page').length,
    canvasWide: document.querySelector('#score-stage .scan-page canvas')?.width ?? 0,
    notes: notes.length,
    // A note has to be big enough to press with a finger.
    // …on the page being SHOWN. The review turns pages now rather than
    // stacking them (scan-view.js), and a mark on a page nobody is looking at
    // has no box at all — measuring it says 0 and means nothing.
    smallest: onShownPage.length
      ? Math.round(Math.min(...onShownPage.map((n) => n.getBoundingClientRect().width))) : 0,
    tones: [...new Set(notes.map((n) => n.dataset.tone))].sort(),
    dockHas: dock ? [...dock.children].map((c) => c.id) : [],
    summary: document.querySelector('#score-tab-summary')?.textContent ?? '',

  };
}, built);

// The pages are read for real — noteheads found in the pixels.
const read = await page.evaluate(async (scoreId) => {
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  return {
    pages: (row?.layout ?? []).filter(Boolean).length,
    heads: (row?.layout ?? []).filter(Boolean)
      .reduce((sum, p) => sum + p.staves.reduce((s, st) => s + st.heads.length, 0), 0),
  };
}, built.scoreId);
// Every notehead that was printed, and not many more. An exact count was the
// old assertion and it is the wrong shape for a reader: what matters is that
// none of the eighty is missing, and that the page has not sprouted a dozen
// things that are not notes.
check('and the review finishes the reading, so every notehead is found',
  read.pages === 2 && read.heads >= 80 && read.heads <= 88,
  `${read.pages} pages, ${read.heads} noteheads (80 drawn)`);

check('recording against a scan does NOT throw you into the full-screen reader',
  review.readerOpen === false, `reader open=${review.readerOpen}`);
check('the photograph is in the review, drawn from the real pages',
  review.pagesShown >= 1 && review.canvasWide > 300,
  `${review.pagesShown} pages shown, canvas ${review.canvasWide}px`);
check('every note played is a live control on the page',
  review.notes === 50, `${review.notes} clickable notes for 50 played`);
check('and each is big enough for a finger', review.smallest >= 22,
  `smallest ${review.smallest}px`);
check('they are coloured by how the note landed',
  review.tones.length > 1, `tones: ${review.tones.join(', ')}`);
check('the transport and the zoomed graph are under it',
  review.dockHas.includes('playback-controls') && review.dockHas.includes('note-zoom'),
  `dock: ${review.dockHas.join(', ')}`);


// --- the timing, against the bars the page actually has ----------------------
//
// WHAT THIS ASSERTED AND WHY IT CHANGED. It wanted the words "against the bars
// on the page", which the review said when it would time a take against any
// bars it found. It will not any more: scan-values.js refuses the written route
// unless the values inside the bars ADD UP to equal bars, and on a page like
// this one they do not (`npm run scan:bars-believed` is the measurement of
// why). So the sentence takes the other route and says what it CAN prove —
// where the barlines cut the take, and that an uneven stretch is therefore not
// a fact about anybody's pulse. That is the contract now, and it is the one
// worth holding: a review that claims a verdict it cannot support is the
// failure this whole section exists to prevent.
const timing = await page.evaluate(() => {
  const line = document.querySelector('#score-tab-summary')?.textContent ?? '';
  return {
    line,
    hasBars: /barlines found on this page|against the bars on the page/i.test(line),
    // …and it must not claim steadiness off bars it does not believe.
    overclaims: /bars are steady|steady bars/i.test(line),
  };
});
check('the review reports timing against the page\'s own bars',
  timing.hasBars === true && timing.overclaims === false, timing.line.slice(-140));

// --- pressing the page goes to the BAR, and the rings are not controls -------
//
// THIS BLOCK USED TO ASSERT THE OPPOSITE, and it was right to fail. It checked
// that pressing a ring opened that note's close-up graph and did not throw the
// full-screen score over the top of it — a real bug, fixed at the time. Then
// the contract changed, on purpose and on his instruction:
//
//   "I don't want to be able to press the note head. If you press the note
//    head, I just want to start at the beginning of that bar… No going to
//    individual notes, because I know that's not possible."
//
// A photograph gives the reader roughly one notehead where the paper has one,
// but not reliably THE one, so a note-level control on a scan is a control
// whose subject is the wrong note some of the time. A bar is a rectangle and
// is not wrong. The rings became `<span>`s with `pointer-events: none` and the
// bar layer went over them — so `readerOpen=true` here was the click falling
// through a ring to the stage, which is exactly what is meant to happen when
// you press somewhere that is not a bar.
//
// So the assertions are rewritten against the contract that exists, and the
// old ones are named above rather than deleted quietly. What is checked now:
// a bar press opens the close-up and does NOT open the reader, and a ring is
// not something a finger can press at all.
const picked = await page.evaluate(async () => {
  const { renderFreeReview } = await import('/src/ui/report.js');
  const { Recorder } = await import('/src/audio/recording.js');
  const notes = window.__takeNotes ?? [];
  // The report has to hold THESE notes: everything downstream keys off the
  // object's identity, and a copy reloaded from the store is a different note
  // as far as a Map is concerned.
  const rec = new Recorder(44100);
  rec.push(new Float32Array(44100 * 12));
  renderFreeReview(document, notes, rec, { readings: window.__takeReadings ?? [], a4: 440 });
  await new Promise((r) => setTimeout(r, 400));

  const ring = document.querySelector('#score-stage .scan-note');
  const ringIsAControl = !ring ? 'no rings'
    : `${ring.tagName}, pointer-events: ${getComputedStyle(ring).pointerEvents}`;

  const bars = [...document.querySelectorAll('#score-stage .scan-bar')];
  bars[3]?.click();
  await new Promise((r) => setTimeout(r, 800));

  const zoom = document.querySelector('#note-zoom');
  const reader = document.querySelector('#reader');
  return {
    bars: bars.length,
    ringIsAControl,
    zoomOpen: !!zoom && zoom.hidden === false,
    zoomLabel: document.querySelector('#zoom-label')?.textContent ?? '',
    readerOpen: !!reader && !reader.hidden,
    fullScreen: document.documentElement.hasAttribute('data-score-full'),
  };
});

check('a ring on a scanned page is a mark, not a control',
  /^SPAN, pointer-events: none$/.test(picked.ringIsAControl), picked.ringIsAControl);
check('pressing a bar opens the close-up under the graph',
  picked.zoomOpen === true,
  `${picked.bars} bars; #note-zoom open=${picked.zoomOpen}, label "${picked.zoomLabel}"`);
check('and does NOT throw the full-screen score over the top of it',
  picked.readerOpen === false && picked.fullScreen === false,
  `reader=${picked.readerOpen} full-screen=${picked.fullScreen}`);


// --- every ring carries ITS OWN note's reading -------------------------------
//
// The part a positional pairing gets wrong quietly: the marks are all there,
// they are all the right colour, and they are one notehead out. This used to be
// checked by pressing a ring and reading the box that opened; there is no such
// press any more (see above), so it is checked where the reading now lives —
// on the ring itself, which is what a pointer hovers and what a screen reader
// announces.
//
// Four notes out of the middle of the take, deterministic so a failure can be
// reproduced rather than hunted, each compared against what that note actually
// was rather than against a number typed into this file.
const random = await page.evaluate(async () => {
  const notes = window.__takeNotes ?? [];
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  // The app's own rule, imported rather than copied: `intonationHue` reads the
  // tolerance the player set, so a threshold typed in here would be a second
  // idea of "in tune" that drifts the moment somebody changes it.
  const { intonationHue } = await import('/src/ui/chart-utils.js');
  const rows = [];
  for (const i of [3, 11, 23, 40]) {
    const ring = rings[i];
    const want = Math.round(notes[i]?.cents ?? 0);
    rows.push({
      i,
      title: ring?.title ?? '',
      label: ring?.getAttribute('aria-label') ?? '',
      tone: ring?.dataset.tone ?? '',
      wantCents: `${want > 0 ? '+' : ''}${want}¢`,
      wantTone: intonationHue(want),
    });
  }
  return { rings: rings.length, rows };
});
const readsRight = random.rows.filter((r) => r.title === r.wantCents);
const colouredRight = random.rows.filter((r) => r.tone === r.wantTone);
check('a note picked out of the middle of the take shows its own reading',
  readsRight.length === random.rows.length,
  random.rows.map((r) => `${r.i}→"${r.title}" (want ${r.wantCents})`).join(' | '));
check('sharp or flat is said in colour too, not only in numbers',
  colouredRight.length === random.rows.length,
  random.rows.map((r) => `${r.i}→${r.tone || '""'} (want ${r.wantTone})`).join(' | '));
check('and the ring says it out loud for a screen reader',
  random.rows.every((r) => /cents/.test(r.label)),
  random.rows.map((r) => `"${r.label}"`).join(' | '));

// --- a take across the page break, and one longer than the part -------------
//
// Two shapes that are easy to get wrong and easy not to notice.
//
// WHAT THIS BLOCK USED TO ASSERT, and why it changed. It played 200 notes at a
// part with 81 noteheads and required exactly 81 rings — a take longer than the
// part CAPPED at the heads that exist, with the surplus named. `pairNotes` has
// a confidence floor now (see `npm run scan:floor`), and 200 notes of a part
// played two and a half times through does not clear it: two thirds of the take
// cannot be where the marks say it is, so the pairing declines to place any of
// it. Holding the marks back is the better answer — "the marks are held back
// rather than put somewhere they might not belong" — and a check that demanded
// the cap was demanding the app guess.
//
// So the surplus take now has to be REFUSED, and the refusal has to be said out
// loud on the page. And the page-break case gets a take that can actually pair:
// the whole part, both pages of it, played in order.
const across = await page.evaluate(async () => {
  const { annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  const { takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  clearSheet();
  const written = window.__written ?? [];
  const notes = takeFromWritten(written, {
    from: 0, count: written.length, spacing: 0.3, sounding: 0.28, lead: 0,
  });
  await annotateTake(notes, {
    readings: notes.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
      midi: n.midi, cents: n.cents,
    })),
    a4: 440,
  });
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 900));
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  return {
    played: notes.length,
    rings: rings.length,
    pages: [...new Set(rings.map((r) => r.closest('.scan-page')?.dataset.page))].sort(),
  };
});
check('a take of the whole part is marked on both its pages',
  across.pages.length === 2 && across.rings > 0,
  `${across.rings} rings for ${across.played} notes, on pages ${across.pages.join(', ')}`);

const spread = await page.evaluate(async ({ scoreId }) => {
  const { annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  clearSheet();
  // The part read from the top and then kept going: 80 noteheads exist and 200
  // notes were played, so 120 of them cannot be on these pages.
  const written = window.__written ?? [];
  const many = Array.from({ length: 200 }, (_, i) => {
    const w = written[i % written.length];
    return {
      midi: w?.midi ?? 48,
      cents: (i % 7) * 5 - 15,
      start: i * 0.3,
      end: i * 0.3 + 0.28,
      frequency: 440 * 2 ** (((w?.midi ?? 48) - 69) / 12),
    };
  });
  await annotateTake(many, {
    readings: many.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
      midi: n.midi, cents: n.cents,
    })),
    a4: 440,
  });
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 900));
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  const heads = (row?.layout ?? []).filter(Boolean)
    .reduce((sum, p) => sum + p.staves.reduce((n, st) => n + st.heads.length, 0), 0);
  return {
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    heads,
    // The page STAYS under the refusal — a take that could not be placed is not
    // a reason to take away the music somebody just photographed.
    stillDrawn: !!document.querySelector('#score-stage .scan-page canvas'),
    said: (document.querySelector('#score-stage .score-scan-gap')?.textContent ?? '').trim(),
  };
}, built);

check('a take far longer than the part is refused, not half-marked',
  spread.rings === 0, `${spread.rings} rings for 200 notes over ${spread.heads} noteheads`);
check('and the refusal is SAID, over the page it still shows',
  /200/.test(spread.said) && new RegExp(`\\b${spread.heads}\\b`).test(spread.said)
    && spread.stillDrawn === true,
  spread.said.slice(0, 150) || 'nothing was said');

// --- the reported bug: a cover page, and the music on page two --------------
//
// "It only showed the analysis on the cover page when all the notes I was
// playing were on the next page." The marks were paired from the first
// notehead of the part, so a take of page two landed on page one. This is that
// score, with that take, and the rings have to be on page two and NOT on page
// one.
// A COVER PAGE, then the music — the shape of nearly every part anybody owns,
// and the case where a take must not be counted from the top of page one.
//
// The music page is engraved (clef, signature, Bravura heads) for the same
// reason as everything else here: a page nobody can price gets no marks at all
// now, and this check is about WHERE the marks land, not whether the refusal
// works.
const cover = await page.evaluate(async ({ b64 }) => {
  const { useBravura, engravePage, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const { pitchOf } = await import('/src/analysis/scan-notes.js');
  const { keyFromCount } = await import('/src/analysis/scan-key.js');
  await useBravura(b64);
  const title = () => {
    // A title page: words and a rule, no music. The kind of page that either
    // yields no noteheads at all or a few phantom ones — and either way must
    // not swallow the start of the take.
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 1500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    g.font = '64px serif';
    g.fillText('Suite No. 1', 300, 500);
    g.font = '34px serif';
    g.fillText('for violoncello solo', 340, 580);
    g.fillRect(300, 640, 500, 3);
    return new Promise((done) => c.toBlob(done, 'image/png'));
  };
  const page2 = engravePage({ space: 13, systems: 5, perSystem: 8, seed: 7654321 });
  const musicBlob = await new Promise((done) => page2.canvas.toBlob(done, 'image/png'));
  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Cover then music', source: 'images', pageCount: 2,
    pages: [await title(), musicBlob],
  });
  const KEY = keyFromCount(1, 'sharp');
  const written = page2.places.map((place) => ({
    ...place, page: 1, midi: pitchOf(place.step, 'bass', KEY)?.midi ?? null,
  }));
  // Played exactly what is on page two, in the order it is written.
  const notes = takeFromWritten(written, {
    from: 0, count: written.length, spacing: 0.3, sounding: 0.28, lead: 0,
  });
  const recId = await saveRecording({
    date: Date.now(), duration: Math.ceil(notes.at(-1).end) + 1, sampleRate: 44100,
    audio: new Float32Array(44100 * 20), notes,
    readings: notes.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
      midi: n.midi, cents: n.cents,
    })),
    a4: 440,
  });
  await setRecordingScore(recId, scoreId);

  const { selectScore, annotateTake, renderScoreTab, clearSheet } = await import('/src/ui/score.js');
  clearSheet?.();
  await selectScore(scoreId);
  const { loadRecording } = await import('/src/store/db.js');
  const data = await loadRecording(recId);
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 1500));

  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  const onPages = {};
  for (const ring of rings) {
    const pg = ring.closest('.scan-page')?.dataset.page;
    onPages[pg] = (onPages[pg] ?? 0) + 1;
  }
  return { played: notes.length, rings: rings.length, onPages,
    said: document.querySelector('.score-scan-gap')?.textContent ?? '' };
}, { b64: font });

check('the take is found on the page it was actually played from',
  (cover.onPages['1'] ?? 0) > 30, `rings by page: ${JSON.stringify(cover.onPages)}`);
check('and NOT dumped onto the cover page',
  (cover.onPages['0'] ?? 0) === 0,
  `${cover.onPages['0'] ?? 0} rings on the cover (was all of them)`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
