// Recording against a scan, and then opening that take again.
//
// A piece that came in as photographs or a PDF is the ordinary case for a
// player: most music you own is paper, and MusicXML for it usually does not
// exist. So the take you record against a scan has to lead somewhere the next
// day — the same way a take against notation does — or the whole scanned half
// of the library is a place recordings go to be forgotten.
//
// The page here is drawn rather than photographed: five staff lines and a row
// of filled noteheads, at a size the page reader is built for. That is enough
// for the real pipeline to run on — findHeads has actual heads to find — and it
// means this check needs no fixture file and no camera.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-analysis-check.mjs
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

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
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

// --- a scanned part, and a take played against it ----------------------------
// A page of REAL MUSIC and a take played from it.
//
// It used to be drawn ellipses on five lines with no clef, and a page with no
// clef prices no notehead — so the review refuses to place a take on it, which
// is right and which left this check asserting the opposite. Engraved now, in
// Bravura, with a clef and a signature: see src/fixtures/engraved-page.js.
const built = await page.evaluate(async ({ b64 }) => {
  const { engravePart, takeFromWritten } = await import('/src/fixtures/engraved-page.js');
  const { scoreId, written } = await engravePart({
    base64: b64, name: 'Scanned part', pages: 1, systems: 3, perSystem: 8, space: 14,
  });
  const notes = takeFromWritten(written, { from: 2, count: 8, spacing: 0.5, sounding: 0.45, lead: 0 });
  const readings = notes.flatMap((n) => Array.from({ length: 12 }, (_, k) => ({
    time: n.start + k * 0.03, frequency: n.frequency, confidence: 0.95, rms: 0.05,
    midi: n.midi, cents: n.cents,
  })));
  const { saveRecording, setRecordingScore, listScores } = await import('/src/store/db.js');
  const recId = await saveRecording({
    date: Date.now(), duration: 4, sampleRate: 44100,
    audio: new Float32Array(44100 * 4), notes, readings, a4: 440,
  });
  await setRecordingScore(recId, scoreId);
  const rows = await listScores();
  return { scoreId, recId, kind: rows.find((r) => r.id === scoreId)?.kind, notes: notes.length };
}, { b64: font });

check('a scanned part can be stored with a take attached to it',
  !!built?.scoreId && !!built?.recId && built.kind === 'pages',
  `score ${built?.scoreId} (${built?.kind}), take ${built?.recId}`);

// --- choosing it: what does the Score tab offer? -----------------------------
const chosen = await page.evaluate(async (scoreId) => {
  const { selectScore, reviewIsWaiting } = await import('/src/ui/score.js');
  await selectScore(scoreId);
  await new Promise((r) => setTimeout(r, 600));
  return {
    waiting: reviewIsWaiting(),
    status: document.querySelector('#score-hint')?.textContent?.slice(0, 140) ?? null,
  };
}, built.scoreId);
check('choosing the scan says what it can and cannot do',
  typeof chosen.status === 'string' && chosen.status.length > 0, chosen.status);

// --- reopening the saved take, which is the thing being asked for ------------
const reopened = await page.evaluate(async (recId) => {
  const { annotateTake, reviewIsWaiting } = await import('/src/ui/score.js');
  const { loadRecording } = await import('/src/store/db.js');
  const data = await loadRecording(recId);
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  await new Promise((r) => setTimeout(r, 700));
  const review = document.querySelector('#score-review');
  return {
    reviewShown: review ? !review.hidden : null,
    summary: document.querySelector('#score-tab-summary')?.textContent ?? null,
    gap: document.querySelector('.score-scan-gap')?.textContent ?? null,
    waiting: reviewIsWaiting(),
    // PRESENT is not the same as reachable, and the difference was the whole
    // bug: the button existed in the document the entire time, on a tab the
    // player was not looking at. offsetParent is null for anything inside a
    // hidden ancestor, which is what "there is no option to open it" means
    // from the outside.
    ways: [...document.querySelectorAll('button')]
      .filter((b) => /see it on the score|full screen/i.test(b.textContent ?? ''))
      .map((b) => ({
        shown: b.offsetParent !== null && b.getBoundingClientRect().height > 0,
        // Which card it is in — the Record tab's score card, or the Score
        // tab's review card.
        where: b.closest('#score-sheet') ? 'record-card'
          : (b.closest('#score-stage') ? 'score-tab' : 'somewhere else'),
      })),
    // The instruction itself, and where it is.
    hintShown: (() => {
      const h = document.querySelector('#score-hint');
      return !!h && h.offsetParent !== null && h.textContent.trim().length > 0;
    })(),
  };
}, built.recId);

check('reopening the take offers a review at all',
  reopened.reviewShown === true, `#score-review hidden=${!reopened.reviewShown}`);
check('and it reports intonation, which is the audio and needs no notation',
  !!reopened.summary && /in tune/i.test(reopened.summary) && /¢/.test(reopened.summary),
  reopened.summary);
check('and it reports the pulse the player actually kept',
  !!reopened.summary && /pulse|even/i.test(reopened.summary), reopened.summary);
check('and it does NOT claim a written-pitch verdict it cannot have',
  !!reopened.summary && !/wrong note|written pitch|the printed/i.test(reopened.summary),
  reopened.summary);
check('the missing half is named rather than left as a hole',
  /notation/i.test(reopened.gap ?? '') && /musicxml/i.test(reopened.gap ?? ''),
  (reopened.gap ?? '(nothing said)').slice(0, 110));
check('the take is stamped, so it can be reopened like any other',
  reopened.waiting === true, `reviewIsWaiting=${reopened.waiting}`);
// Asked from where the player is actually standing.
//
// Pressing Stop leaves you on the Record tab, so that is the screen the
// question is about: with the take just finished and the hint saying to open
// the score, is there something on THIS screen to press? A headless page shows
// no tab until it is told to, and a visibility check run against no tab at all
// would answer a question nobody asked.
const onRecordTab = await page.evaluate(async () => {
  document.querySelector('.tab-btn[data-tab="analyze"]')?.click();
  await new Promise((r) => setTimeout(r, 700));
  const seen = [...document.querySelectorAll('button')]
    .filter((b) => /see it on the score|full screen/i.test(b.textContent ?? ''))
    .map((b) => ({
      shown: b.offsetParent !== null && b.getBoundingClientRect().height > 0,
      where: b.closest('#score-sheet') ? 'record-card'
        : (b.closest('#score-stage') ? 'score-tab' : 'somewhere else'),
    }));
  const hint = document.querySelector('#score-hint');
  return {
    ways: seen,
    hintShown: !!hint && hint.offsetParent !== null && hint.textContent.trim().length > 0,
  };
});
reopened.ways = onRecordTab.ways;
reopened.hintShown = onRecordTab.hintShown;

// The bug this file exists to keep out, stated as the requirement rather than
// as a selector: the sentence telling you to open the score, and a button that
// does it, have to be on the SAME screen.
const visibleWays = (reopened.ways ?? []).filter((w) => w.shown);
check('a way to open the score is actually on screen, not merely in the document',
  visibleWays.length > 0,
  `${reopened.ways.length} found, ${visibleWays.length} visible`
    + ` — ${reopened.ways.map((w) => `${w.where}:${w.shown ? 'shown' : 'hidden'}`).join(', ')}`);
check('and it is on the same card as the line that tells you to press it',
  reopened.hintShown === true && visibleWays.some((w) => w.where === 'record-card'),
  `hint on screen=${reopened.hintShown}`);

// --- and through to the page, which is where the take has to land ------------
const onPage = await page.evaluate(async () => {
  const { readCurrentScore } = await import('/src/ui/score.js');
  await readCurrentScore();
  // The page has to be READ before a take can be put on it — staves, bars and
  // noteheads — and that happens in the background the first time a scan is
  // opened. Give it a real chance rather than a token one.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (globalThis.__readerLayoutReady) break;
  }
  const reader = document.querySelector('#reader');
  return {
    readerOpen: reader ? !reader.hidden : false,
    say: document.querySelector('#reader-say')?.textContent ?? null,
  };
});
check('the scan opens in the reader with the take in hand', onPage.readerOpen === true,
  `reader open=${onPage.readerOpen}`);

// The question the whole feature turns on: is "show me what I played" offered?
const markable = await page.evaluate(async () => {
  document.querySelector('#reader-menu-btn')?.click();
  await new Promise((r) => setTimeout(r, 400));
  const rows = [...document.querySelectorAll('#reader-menu .reader-menu-row')]
    .map((r) => r.textContent.trim());
  return { rows, showsPlaying: rows.some((t) => /what you played/i.test(t)) };
});
check('the reader offers to show what you played on the scan',
  markable.showsPlaying === true, `menu: ${markable.rows.join(' | ').slice(0, 160)}`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 8)) console.log(`  ${e}`);
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
