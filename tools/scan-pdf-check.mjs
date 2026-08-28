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
  // The music has a shape, written down as it is drawn, so the take can be
  // played FROM it — the take is located by its shape now, and notes with no
  // relation to the page are quite correctly refused.
  const steps = [];
  let at = 0;
  let seed = 99887766;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sheet = () => {
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
        const r = rnd();
        at += (rnd() < 0.5 ? -1 : 1) * (r < 0.12 ? 0 : (r < 0.6 ? 1 : (r < 0.86 ? 2 : 4)));
        at = Math.max(-2, Math.min(8, at));
        steps.push(at);
        const x = 170 + i * 120;
        const y = (top + 4 * s) - (at * s) / 2;
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
    const { canvas, heads } = sheet();
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
  const notes = steps.slice(0, 40).map((step, i) => ({
    midi: 48 + Math.round(step * 12 / 7), cents: (i % 5) * 8 - 16,
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
  const view = await renderScoreTab();
  await new Promise((r) => setTimeout(r, 1200));
  return {
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    pagesShown: document.querySelectorAll('#score-stage .scan-page').length,
    canvasWide: document.querySelector('#score-stage .scan-page canvas')?.width ?? 0,
    // WHICH HALF FAILED, when it fails. Without these three the two checks
    // below say "0 pages, 0 rings" and cannot tell "the take could not be
    // placed on this part" from "it was placed and the PDF would not draw" —
    // and those are a reader problem and a review problem respectively. The
    // second would mean the scanned review works only for image-backed parts,
    // which is the commonest way a part gets into this app.
    placed: view?.pairing?.placed ?? null,
    marks: view?.pairing?.marks?.length ?? 0,
    heads: view?.pairing?.heads ?? 0,
    readPitch: view?.pairing?.readPitch ?? null,
    why: view?.pairing?.why ?? null,
    // SCOPED TO THE STAGE. The Record card carries a `.score-scan-gap` of its
    // own ("Read from the sound…"), so an unscoped query answers with that one
    // and makes every scanned refusal look like a missing MusicXML.
    gap: (document.querySelector('#score-stage .score-scan-gap')?.textContent ?? '').trim().slice(0, 160),
    stage: (document.querySelector('#score-stage')?.textContent ?? '').trim().slice(0, 160),
    // The reason, from where score.js keeps it rather than from a paragraph
    // over the music — see lastScoreRefusal.
    refusal: (await import('/src/ui/score.js')).lastScoreRefusal(),
  };
}, built);
console.log(`      pairing: placed=${review.placed} readPitch=${review.readPitch}`
  + ` ${review.marks} marks over ${review.heads} heads`
  + `${review.why ? ` — "${review.why}"` : ''}`);
// renderScoreTab returns null for BOTH of its refusals, so the fields above go
// null together and cannot name which one it was. The sentence it puts on the
// page can, and it is the sentence a user reads.
console.log(`      the review says: ${review.gap || '(no refusal note)'}`);
console.log(`      the stage holds: ${review.stage || '(empty)'}`);

// THE PAGE IS SHOWN EVEN WHEN THE TAKE CANNOT BE PLACED ON IT, which is what
// this fixture is: drawn ellipses with no clef, so nothing on it can be priced.
check('the PDF page is drawn in the review', review.pagesShown >= 1 && review.canvasWide > 300,
  `${review.pagesShown} pages, canvas ${review.canvasWide}px`);
// …AND NOT ONE RING ON IT. This check asserted the opposite for a year — 40
// rings on a page whose pitches nobody could read — and that is the bug a user
// finally reported: pressing a ring played a moment from a different part of
// the music. MEASURED, `npm run scan:align -- --unpriced`: over 32 studies and
// 128 takes the contour route put 130 notes on the right notehead and 307 on
// the WRONG one, and its own confidence cannot tell those apart. So a page with
// no readable clef gets no rings, and says why.
check('and NOT ONE ring on it, because nothing here can be priced', review.rings === 0,
  `${review.rings} rings`);
// WHICH OF THE TWO WENT WRONG IS ASKED OF THE PAIRING, not of a paragraph.
//
// This read the sentence the app laid over the music, and that paragraph is
// gone — grey prose over a photograph, and about the NOTE-level pairing while
// claiming to be about where the take sits on the page, which take-align.js
// answers separately and often answers well. The refusal itself is unchanged
// and still carries its reason; it is read from `pairing.why` now, which is
// where it was always computed and is not a thing a player has to read.
check('and the refusal still names which of the two things went wrong',
  /could not be placed|have not been read/.test(review.refusal?.kind ?? ''),
  `${review.refusal?.kind ?? '(no reason kept)'}`
  + `${review.refusal?.why ? ` — ${review.refusal.why}` : ''}`);
check('…and nothing is laid over the music to say it', (review.gap ?? '') === '',
  review.gap ? review.gap.slice(0, 120) : 'nothing over the page');

if (errors.length) {
  console.log('\nerrors on the page:');
  for (const e of errors.slice(0, 6)) console.log(`  ${e}`);
}
const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS');
await browser.close();
process.exit(failed.length ? 1 : 0);
