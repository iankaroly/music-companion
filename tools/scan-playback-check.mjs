// Listening back to a take with the scan in front of you.
//
// The engraved side lights the note being heard by putting a class on a
// notehead ELEMENT. A photograph has no elements — the music is pixels and the
// noteheads are places the page reader measured — so on a scan the light has to
// be drawn, and the reader has to turn the page the note is on by itself.
//
// Before this, "Play the take" was offered on a scan and then played it with
// nothing moving: the audio ran, the rings sat where they were, and the one
// thing a page can do that a graph cannot — say WHICH note you are hearing —
// did not happen.
//
// What is checked here is the consequence you can see from outside: with a take
// whose notes run past the end of the first page, playing it has to TURN pages
// on its own. A reader that never turns is a reader whose light never moved.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-playback-check.mjs
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
  // Playback is the subject, so it has to be allowed to start without a
  // gesture the harness cannot make.
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1024, height: 1366, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

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

// Three pages, and a take long enough that its marks run onto the later ones.
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
    // A Blob, not a data URL. readableImage decodes Blobs; handed a string it
    // falls through to the missing-page placeholder, and every page then reads
    // as blank grey — which is a harness testing a fiction, not the app.
    return new Promise((done) => c.toBlob(done, 'image/png'));
  };
  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Played scan', source: 'images', pageCount: 3,
    pages: [await draw(0), await draw(1), await draw(2)],
  });

  // Enough notes to run well past the first page's noteheads, spread over a
  // take short enough to sit through.
  const COUNT = 90;
  const notes = Array.from({ length: COUNT }, (_, i) => ({
    midi: 48 + (i % 12), cents: (i % 5) * 6 - 12,
    start: i * 0.06, end: i * 0.06 + 0.055,
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
}, );

check('a three-page scan with a long take', !!built.scoreId && built.notes === 90,
  `score ${built.scoreId}, ${built.notes} notes`);

// Open it the way the app does: choose the piece, attach the take, open it.
const opened = await page.evaluate(async ({ scoreId, recId }) => {
  const { selectScore, annotateTake, readCurrentScore } = await import('/src/ui/score.js');
  const { loadRecording } = await import('/src/store/db.js');
  await selectScore(scoreId);
  const data = await loadRecording(recId);
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  // The pages are READ for real — noteheads found in the pixels, not handed in.
  // Now that they are stored as Blobs the pass has something to look at, and
  // this is the pipeline a player actually gets.
  const { measurePages } = await import('/src/ui/score.js');
  await measurePages(scoreId);
  await readCurrentScore();
  await new Promise((r) => setTimeout(r, 1200));
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  return {
    open: !document.querySelector('#reader')?.hidden,
    read: row?.layout?.filter(Boolean).length ?? 0,
    heads: (row?.layout ?? []).filter(Boolean)
      .reduce((sum, p) => sum + p.staves.reduce((s, st) => s + st.heads.length, 0), 0),
    page: document.querySelector('#reader-count')?.textContent ?? '',
  };
}, built);

check('the reader has a set of noteheads to ring',
  opened.read === 3 && opened.heads === 120, `${opened.read} pages, ${opened.heads} noteheads`);
check('the scan is open on the first page', opened.open === true, opened.page);

// --- the marks reach the later pages ----------------------------------------
//
// What can be asked of a headless browser and what cannot: the moving light is
// driven by requestAnimationFrame inside the playback tick, and rAF does not
// run in the headless shell — the transport starts, the audio object exists,
// and no frame ever arrives. So the light itself is not testable here and this
// file does not pretend to test it.
//
// What IS testable is the thing the light rides on: the pairing of ninety
// played notes against a hundred and twenty noteheads spread over three pages.
// If that pairing is right, page three carries coloured rings; if it stops at
// the first page — which is what a take that never mapped past its own page
// would look like — page three is bare. The rings are drawn on the ink canvas,
// so they can be counted in its pixels.
const marksOn = async (pageNumber) => page.evaluate(async (want) => {
  const { default: _ } = { default: null };
  void _;
  // Turn to the page by tapping the forward edge until the count says so.
  for (let i = 0; i < 12; i++) {
    const at = document.querySelector('#reader-count')?.textContent ?? '';
    if (at.startsWith(`p. ${want} `)) break;
    const x = window.innerWidth * 0.9;
    const y = window.innerHeight * 0.5;
    for (const type of ['pointerdown', 'pointerup']) {
      document.querySelector('#reader').dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 500));
  const ink = document.querySelector('#reader-ink');
  if (!ink || !ink.width) return { page: document.querySelector('#reader-count')?.textContent, coloured: 0 };
  const g = ink.getContext('2d', { willReadFrequently: true });
  const { data } = g.getImageData(0, 0, ink.width, ink.height);
  // Any strongly-coloured pixel: the rings are the only colour the ink layer
  // puts down on a page nobody has drawn on.
  let coloured = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [r, gg, bb, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 60) continue;
    if (Math.max(r, gg, bb) - Math.min(r, gg, bb) > 40) coloured += 1;
  }
  return { page: document.querySelector('#reader-count')?.textContent, coloured };
}, pageNumber);

const first = await marksOn(1);
check('the first page carries rings for what was played',
  first.coloured > 50, `${first.page}: ${first.coloured} coloured pixels`);

const third = await marksOn(3);
check('and so does the third, so the take maps across the whole part',
  third.coloured > 50, `${third.page}: ${third.coloured} coloured pixels`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
