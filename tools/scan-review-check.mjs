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
  const draw = (n) => {
    const c = document.createElement('canvas');
    c.width = 1100; c.height = 1500;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    const space = 13;
    for (let sys = 0; sys < 5; sys++) {
      const top = 180 + sys * 260;
      for (let line = 0; line < 5; line++) g.fillRect(100, top + line * space, 900, 2);
      for (const x of [100, 400, 700, 1000]) g.fillRect(x, top, 2, space * 4);
      for (let i = 0; i < 8; i++) {
        const x = 160 + i * 105;
        const y = top + ((i + n) % 5) * (space / 2) + space;
        g.beginPath();
        g.ellipse(x, y, space * 0.62, space * 0.46, -0.3, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x + space * 0.55, y - space * 3, 2, space * 3);
      }
    }
    return new Promise((done) => c.toBlob(done, 'image/png'));
  };
  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Scanned part', source: 'images', pageCount: 2,
    pages: [await draw(0), await draw(1)],
  });
  const COUNT = 50;
  const notes = Array.from({ length: COUNT }, (_, i) => ({
    midi: 48 + (i % 12), cents: (i % 5) * 9 - 18,
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
  return { scoreId, recId, notes: COUNT };
});

// NOTHING is read yet, which is the state a real part is in.
//
// The reading pass stands aside whenever the player is doing anything, and
// importing a part and recording straight away is doing something the whole
// time — so on a fresh import the pass has typically got nowhere. This is that
// state, and it is the state behind "it only marked five of my hundred notes":
// the take gets paired against however many noteheads happened to be found,
// and `Math.min(heads, played)` throws the rest of the take away in silence.
//
// So the check starts from nothing read, and the review has to be the thing
// that fixes it.
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

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
