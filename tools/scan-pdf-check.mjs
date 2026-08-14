// The same promise, for a PDF.
//
// Half the music people bring to this app is a PDF rather than photographs,
// and the two travel different roads all the way down: a photograph is decoded
// to an ImageBitmap and put on a canvas with drawImage, a PDF is rendered by
// pdf.js straight into the canvas with its own background fill. Everything
// after that — the ink threshold, the staff finder, the head finder — is
// looking at pixels somebody else produced, and "the API is the same shape" is
// not the same statement as "it works".
//
// So this builds a real PDF of real music, feeds it back in through the same
// door a player's file goes through, and asks the same questions: are the
// notes found, and do they end up live on the review.
//
//   npm run dev            (in another terminal, on port 5199)
//   node tools/scan-pdf-check.mjs
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

const built = await page.evaluate(async () => {
  // Two pages of music, as JPEG bytes, wrapped in a PDF by the app's own
  // writer — so the file under test is one this app would itself produce.
  const sheet = (n) => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;          // A4 at 150dpi
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const s = 15;
    let heads = 0;
    for (let sys = 0; sys < 5; sys++) {
      const top = 240 + sys * 300;
      g.fillStyle = '#111';
      for (let l = 0; l < 5; l++) g.fillRect(110, top + l * s, 1020, 2.2);
      for (const x of [110, 450, 790, 1130]) g.fillRect(x, top, 2.2, s * 4);
      for (let i = 0; i < 8; i++) {
        const x = 170 + i * 120;
        const y = top + ((i + n) % 5) * (s / 2) + s;
        g.save(); g.translate(x, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, s * 0.62, s * 0.46, 0, 0, Math.PI * 2);
        g.fillStyle = '#111'; g.fill();
        g.restore();
        g.fillRect(x + s * 0.55, y - s * 3, 2.2, s * 3);
        heads += 1;
      }
    }
    return { canvas: c, heads };
  };

  const { pdfFromPages } = await import('/src/ui/export.js');
  const pages = [];
  let drawn = 0;
  for (const n of [0, 1]) {
    const { canvas, heads } = sheet(n);
    drawn += heads;
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
    pages.push({
      width: canvas.width, height: canvas.height,
      bytes: new Uint8Array(await blob.arrayBuffer()),
    });
  }
  const pdf = pdfFromPages(pages);
  const data = pdf instanceof Blob ? await pdf.arrayBuffer() : pdf;

  const { savePagesScore, saveRecording, setRecordingScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({
    name: 'A PDF part', source: 'pdf', pageCount: 2, data,
  });
  const notes = Array.from({ length: 40 }, (_, i) => ({
    midi: 48 + (i % 12), cents: (i % 5) * 8 - 16,
    start: i * 0.25, end: i * 0.25 + 0.2, frequency: 130,
  }));
  const recId = await saveRecording({
    date: Date.now(), duration: 12, sampleRate: 44100,
    audio: new Float32Array(44100 * 12), notes,
    readings: notes.map((n) => ({
      time: n.start, frequency: n.frequency, confidence: 0.95, rms: 0.05,
      midi: n.midi, cents: n.cents,
    })),
    a4: 440,
  });
  await setRecordingScore(recId, scoreId);
  return { scoreId, recId, drawn, bytes: data.byteLength ?? data.length ?? 0 };
});

check('a real PDF of music was written and stored as a part',
  built.bytes > 5000 && built.drawn === 80,
  `${built.bytes} bytes, ${built.drawn} noteheads drawn`);

// The pages are read through pdf.js, not through drawImage.
const read = await page.evaluate(async (scoreId) => {
  const { measurePages } = await import('/src/ui/score.js');
  await measurePages(scoreId);
  const { loadScorePages } = await import('/src/store/db.js');
  const row = await loadScorePages(scoreId);
  return {
    pages: (row?.layout ?? []).filter(Boolean).length,
    staves: (row?.layout ?? []).filter(Boolean).reduce((n, p) => n + p.staves.length, 0),
    heads: (row?.layout ?? []).filter(Boolean)
      .reduce((n, p) => n + p.staves.reduce((m, st) => m + st.heads.length, 0), 0),
  };
}, built.scoreId);

check('both PDF pages were read', read.pages === 2, `${read.pages} of 2`);
check('every staff on them was found', read.staves === 10, `${read.staves} of 10`);
// Not demanded to the note: a PDF goes through a JPEG and pdf.js's own
// rasteriser, and a head or two lost to that is a different thing from the
// finder being blind. Most of them is the bar.
check('and most of the noteheads with them', read.heads >= 70,
  `${read.heads} of ${built.drawn}`);

// …and they end up live on the review, which is the point of finding them.
const review = await page.evaluate(async ({ scoreId, recId }) => {
  const { selectScore, annotateTake, renderScoreTab } = await import('/src/ui/score.js');
  const { loadRecording } = await import('/src/store/db.js');
  await selectScore(scoreId);
  const data = await loadRecording(recId);
  await annotateTake(data.notes, { readings: data.readings, a4: data.a4, recordingId: recId });
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const { onScoreTabShown } = await import('/src/ui/score-tab.js');
  onScoreTabShown();
  await renderScoreTab();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    pagesShown: document.querySelectorAll('#score-stage .scan-page').length,
    canvasWide: document.querySelector('#score-stage .scan-page canvas')?.width ?? 0,
  };
}, built);

check('the PDF page is drawn in the review', review.pagesShown >= 1 && review.canvasWide > 300,
  `${review.pagesShown} pages, canvas ${review.canvasWide}px`);
check('with every note played live on it', review.rings === 40,
  `${review.rings} rings for 40 notes`);

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
