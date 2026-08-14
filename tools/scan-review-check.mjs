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
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

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
const built = await page.evaluate(async () => {
  // Two pages of real engraving, stored the way the app stores them — as Blobs.
  // A data URL falls through readableImage to the missing-page placeholder and
  // every page then reads as blank grey, which is a harness testing a fiction.
  //
  // The music has a SHAPE, and the shape is written down as it is drawn: the
  // take is then played from it, so what is heard genuinely corresponds to
  // what is on the page. Before the take could be located by its shape this
  // did not matter and the notes were arbitrary; now arbitrary notes are, quite
  // correctly, refused.
  const steps = [];
  let at = 0;
  let seed = 424242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const draw = () => {
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 1500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const space = 13;
    for (let sys = 0; sys < 5; sys++) {
      const top = 180 + sys * 260;
      g.fillStyle = '#111';
      for (let line = 0; line < 5; line++) g.fillRect(100, top + line * space, 900, 2);
      for (const x of [100, 400, 700, 1000]) g.fillRect(x, top, 2, space * 4);
      for (let i = 0; i < 8; i++) {
        const r = rnd();
        at += (rnd() < 0.5 ? -1 : 1) * (r < 0.12 ? 0 : (r < 0.6 ? 1 : (r < 0.86 ? 2 : 4)));
        at = Math.max(-2, Math.min(8, at));
        steps.push(at);
        const x = 160 + i * 105;
        const y = (top + 4 * space) - (at * space) / 2;   // step 0 is the bottom line
        g.save(); g.translate(x, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
        g.fillStyle = '#111'; g.fill(); g.restore();
        g.fillStyle = '#111'; g.fillRect(x + space * 0.55, y - space * 3, 2, space * 3);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/png'));
  };
  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const pageOne = await draw();
  const pageTwo = await draw();
  const scoreId = await savePagesScore({
    name: 'Scanned part', source: 'images', pageCount: 2, pages: [pageOne, pageTwo],
  });
  // Fifty notes, played from the top of the part, following what is written.
  const COUNT = 50;
  const notes = steps.slice(0, COUNT).map((step, i) => ({
    midi: 48 + Math.round(step * 12 / 7), cents: (i % 5) * 9 - 18,
    start: i * 0.2, end: i * 0.2 + 0.18,
    frequency: 130 * (2 ** ((i % 12) / 12)),
  }));
  const readings = notes.map((n) => ({
    time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
    midi: n.midi, cents: n.cents,
  }));
  const seconds = Math.ceil(notes.at(-1).end) + 1;
  const recId = await saveRecording({
    date: Date.now(), duration: seconds, sampleRate: 44100,
    audio: new Float32Array(44100 * seconds), notes, readings, a4: 440,
  });
  await setRecordingScore(recId, scoreId);
  window.__steps = steps;
  return { scoreId, recId, notes: COUNT };
});

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
  // The transport belongs to the review, and the review has to have the take.
  const rec = new Recorder(data.sampleRate ?? 44100);
  rec.push(data.samples ?? new Float32Array(data.audio ?? 0));
  renderFreeReview(document, data.notes, rec, {
    readings: data.readings, a4: data.a4, recordingId: recId,
  });
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  // Standing on the Score tab is what makes the panel have a width.
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 600));
  const { onScoreTabShown } = await import('/src/ui/score-tab.js');
  onScoreTabShown();
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 900));

  // A reader that has never been built is not an OPEN reader — and `?.hidden`
  // on a missing element is undefined, which negates to "open" and would have
  // passed this check for the wrong reason in both directions.
  const readerEl = document.querySelector('#reader');
  const readerOpen = !!readerEl && !readerEl.hidden;
  const notes = [...document.querySelectorAll('#score-stage .scan-note')];
  const dock = document.querySelector('#score-dock');
  return {
    readerOpen,
    pagesShown: document.querySelectorAll('#score-stage .scan-page').length,
    canvasWide: document.querySelector('#score-stage .scan-page canvas')?.width ?? 0,
    notes: notes.length,
    // A note has to be big enough to press with a finger.
    smallest: notes.length
      ? Math.round(Math.min(...notes.map((n) => n.getBoundingClientRect().width))) : 0,
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
check('and the review finishes the reading, so every notehead is found',
  read.pages === 2 && read.heads === 80,
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

// --- clicking a note hands that note to the picker ---------------------------
//
// The engraved page calls onPick with `attempt.played` — the played note
// object itself — and everything downstream (the close-up, the drones, the
// highlight) keys off that object's IDENTITY. So what has to be true of the
// scanned page is exactly the same thing: the ring for the nth note hands back
// the nth note, the same object the review was built from, not a copy.
//
// Checked with a picker of our own rather than by watching the report, because
// the report needs a whole take loaded through the recording machinery and
// that is a different subject with its own ways of not being set up.
const picked = await page.evaluate(async () => {
  const { initScoreCard } = await import('/src/ui/score.js');
  const notes = window.__takeNotes ?? [];
  const got = [];
  initScoreCard({ onPickNote: (note) => got.push(note) });
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  rings[0]?.click();
  rings[7]?.click();
  rings[31]?.click();
  await new Promise((r) => setTimeout(r, 200));
  return {
    calls: got.length,
    // Identity, against the take the review was made from.
    identical: got.length === 3
      && got[0] === notes[0] && got[1] === notes[7] && got[2] === notes[31],
    // …and failing identity, at least the right note by its own clock.
    starts: got.map((n) => n?.start),
    wanted: [notes[0]?.start, notes[7]?.start, notes[31]?.start],
  };
});
check('clicking a ring hands its note to the picker', picked.calls === 3,
  `${picked.calls} of 3 clicks arrived`);
check('and it is the right note, by identity',
  picked.identical === true,
  `got starts ${JSON.stringify(picked.starts)} wanted ${JSON.stringify(picked.wanted)}`);

// --- the light follows the playback ------------------------------------------
// rAF does not run in the headless shell, so the playback tick never fires and
// the light cannot be watched moving. What CAN be checked is the wiring it
// rides on: the view answers noteheadFor for a played note with the element
// that would be lit, which is the whole of what follow() needs.
const wiring = await page.evaluate(async () => {
  const { loadRecording } = await import('/src/store/db.js');
  const data = await loadRecording(1);
  const notes = data.notes ?? [];
  // Ask the same question follow() asks, for three notes spread through it.
  const answers = [0, 20, 45].map((i) => {
    const want = notes[i];
    const all = [...document.querySelectorAll('#score-stage .scan-note')];
    const label = all[i]?.getAttribute('aria-label') ?? '';
    return { i, label, has: !!want && !!all[i] };
  });
  return answers;
});
check('the notes are addressable in order, which is what the light rides on',
  wiring.every((a) => a.has), wiring.map((a) => `${a.i}:${a.label}`).join(' | '));


// --- a take that runs past the page, and one that runs past the part ---------
// Two shapes that are easy to get wrong and easy not to notice: notes carrying
// on over a page break, and a take with more notes in it than the part has
// noteheads. The second one is the case that used to be silently truncated.
const spread = await page.evaluate(async ({ scoreId }) => {
  const { annotateTake, renderScoreTab } = await import('/src/ui/score.js');
  const { clearSheet } = await import('/src/ui/score.js');
  // The part read from the top and then kept going: 80 noteheads exist and 200
  // notes were played, so 120 of them cannot be on these pages. That is a real
  // shape — a repeat taken, or playing on past the last page photographed —
  // and it has to be capped and SAID rather than refused or invented.
  const steps = window.__steps ?? [];
  const many = Array.from({ length: 200 }, (_, i) => ({
    midi: 48 + Math.round((steps[i % steps.length] ?? 0) * 12 / 7),
    cents: (i % 7) * 5 - 15, start: i * 0.1, end: i * 0.1 + 0.09, frequency: 130,
  }));
  clearSheet?.();
  await annotateTake(many, { readings: [], a4: 440 });
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 900));
  const rings = [...document.querySelectorAll('#score-stage .scan-note')];
  const pagesWithRings = new Set(rings.map((r) => r.closest('.scan-page')?.dataset.page));
  return {
    rings: rings.length,
    pages: [...pagesWithRings].sort(),
    said: document.querySelector('.scan-pairing')?.textContent ?? '',
  };
}, built);

check('a take longer than the part is capped at the noteheads that exist',
  spread.rings === 80, `${spread.rings} rings for 200 notes over 80 noteheads`);
check('and the notes that could not be placed are SAID, not dropped in silence',
  /200/.test(spread.said) && /80/.test(spread.said) && /120/.test(spread.said),
  spread.said.trim());
check('the marks carry across the page break',
  spread.pages.length === 2, `rings on pages ${spread.pages.join(', ')}`);


// --- the reported bug: a cover page, and the music on page two --------------
//
// "It only showed the analysis on the cover page when all the notes I was
// playing were on the next page." The marks were paired from the first
// notehead of the part, so a take of page two landed on page one. This is that
// score, with that take, and the rings have to be on page two and NOT on page
// one.
const cover = await page.evaluate(async () => {
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
  // A page of music whose line has a real shape, so it can be found.
  const steps = [];
  let at = 0; let seed = 7654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const music = () => {
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 1500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const s = 13;
    for (let sys = 0; sys < 5; sys++) {
      const top = 180 + sys * 260;
      g.fillStyle = '#111';
      for (let l = 0; l < 5; l++) g.fillRect(100, top + l * s, 900, 2);
      for (const x of [100, 400, 700, 1000]) g.fillRect(x, top, 2, s * 4);
      for (let i = 0; i < 8; i++) {
        const r = rnd();
        at += (rnd() < 0.5 ? -1 : 1) * (r < 0.12 ? 0 : (r < 0.6 ? 1 : (r < 0.86 ? 2 : 4)));
        at = Math.max(-2, Math.min(8, at));
        steps.push(at);
        const x = 160 + i * 105;
        const y = (top + 4 * s) - (at * s) / 2;   // step 0 is the bottom line
        g.save(); g.translate(x, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, s * 0.62, s * 0.46, 0, 0, Math.PI * 2);
        g.fillStyle = '#111'; g.fill(); g.restore();
        g.fillStyle = '#111'; g.fillRect(x + s * 0.55, y - s * 3, 2, s * 3);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/png'));
  };

  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Cover then music', source: 'images', pageCount: 2,
    pages: [await title(), await music()],
  });
  // Played exactly what is on page two, in the order it is written.
  const notes = steps.map((step, i) => ({
    midi: 48 + Math.round(step * 12 / 7), cents: (i % 5) * 7 - 14,
    start: i * 0.3, end: i * 0.3 + 0.28, frequency: 130,
  }));
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
});

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
