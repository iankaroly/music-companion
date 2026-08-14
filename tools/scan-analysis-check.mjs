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
import puppeteer from 'puppeteer-core';

// The headless SHELL rather than the Chrome app: launching the app puts a
// bouncing icon in the Dock every time this runs.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

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
const built = await page.evaluate(async () => {
  // A page of music, drawn: three systems of five lines with filled heads on
  // them, black on white, at roughly the proportions of a photographed part.
  const draw = () => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111';
    const space = 14;
    for (let sys = 0; sys < 3; sys++) {
      const top = 240 + sys * 420;
      for (let line = 0; line < 5; line++) {
        g.fillRect(120, top + line * space, 960, 2);
      }
      // Bar lines, so the reader has bars to put the heads into.
      for (const x of [120, 440, 760, 1080]) g.fillRect(x, top, 2, space * 4);
      // Filled noteheads, slightly elliptical, sitting on and between lines.
      for (let n = 0; n < 8; n++) {
        const x = 180 + n * 110;
        const y = top + (n % 5) * (space / 2) + space;
        g.beginPath();
        g.ellipse(x, y, space * 0.62, space * 0.46, -0.3, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x + space * 0.55, y - space * 3, 2, space * 3);   // a stem
      }
    }
    return c.toDataURL('image/png');
  };

  const { savePagesScore, saveRecording, setRecordingScore, listScores } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'Scanned part', source: 'images', pageCount: 1, pages: [draw()],
  });

  // A take: eight notes with pitch and timing, the shape the app stores.
  const notes = [];
  for (let i = 0; i < 8; i++) {
    notes.push({
      midi: 48 + i, cents: (i % 3) * 7 - 7,
      start: i * 0.5, end: i * 0.5 + 0.45, frequency: 130 * (2 ** (i / 12)),
    });
  }
  const readings = notes.flatMap((n, i) => Array.from({ length: 12 }, (_, k) => ({
    time: n.start + k * 0.03, frequency: n.frequency, confidence: 0.95, rms: 0.05,
    midi: n.midi, cents: n.cents,
  })));
  const recId = await saveRecording({
    date: Date.now(), duration: 4, sampleRate: 44100,
    audio: new Float32Array(44100 * 4), notes, readings, a4: 440,
  });
  await setRecordingScore(recId, scoreId);
  const rows = await listScores();
  return { scoreId, recId, kind: rows.find((r) => r.id === scoreId)?.kind };
});

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
    stage: document.querySelector('#score-stage button')?.textContent?.trim() ?? null,
    gap: document.querySelector('.score-scan-gap')?.textContent ?? null,
    waiting: reviewIsWaiting(),
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
check('the way through to the page is offered', !!reopened.stage, `stage: "${reopened.stage}"`);

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
