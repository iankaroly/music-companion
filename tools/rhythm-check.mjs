// WHICH BRANCH THE RHYTHM JOIN TAKES ON THE THREE REAL PAGES.
//
//   node tools/rhythm-check.mjs          as the reader bars the page
//   PER=16 node tools/rhythm-check.mjs   with the bars regrouped to 16 heads
//
//   npm run scan:rhythm                (the same thing, now that it is wired)
//
// Needs npm run dev on 5199 (PORT= to point it elsewhere).
//
// Not a measurement of anybody's timing: there is no recording here and no
// microphone was touched. A take is SYNTHESISED from the page's own noteheads —
// one note per head, in reading order, evenly spaced — so that barsOf has a
// `note.start` to group on. What that measures is the BRANCH the join takes on
// real page data: how many bars scan-values believes, how many it refuses, and
// therefore how many notes could get a written-duration verdict at all. The
// deviations are meaningless by construction (the take is perfect and even) and
// are not printed.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const index = JSON.parse(await readFile(new URL('/Users/iankaroly/music-companion/pages/index.json', import.meta.url), 'utf8'));

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const tab = await browser.newPage();
await tab.setViewport({ width: 1400, height: 1800 });
await tab.goto(`http://localhost:${process.env.PORT ?? 5199}/?per=${process.env.PER ?? 0}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

for (const page of index) {
  const b64 = (await readFile(page.file)).toString('base64');
  const out = await tab.evaluate(async ({ b64 }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const { scanRhythm } = await import('/src/analysis/scan-rhythm.js');
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const src = document.createElement('canvas');
    src.width = viewport.width; src.height = viewport.height;
    await first.render({ canvasContext: src.getContext('2d'), viewport }).promise;
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
    const read = readPage(work, work.width, work.height);
    if (!read) return { failed: true };
    const heads = notesInOrder(read);
    // The regrouping probe. Only valid on a page whose printed bar really does
    // hold that many noteheads — the Bach photograph is twenty bars of sixteen
    // semiquavers and nothing else here is uniform, so a number for Mozart or
    // Scanned under PER is not evidence about those pages.
    const REGROUP = Number(new URLSearchParams(location.search).get('per')) || 0;
    const marks = heads.map((head, i) => ({
      ...head, page: 0,
      ...(REGROUP ? { staff: 0, bar: Math.floor(i / REGROUP) } : {}),
      note: { midi: head.midi ?? 60, cents: 0, start: i * 0.4, end: i * 0.4 + 0.35 },
      index: i, verdict: 'match',
    }));
    const r = scanRhythm(marks);
    return {
      heads: heads.length,
      placed: r.placed,
      bars: r.bars.length,
      believed: r.barsBelieved,
      refused: r.barsRefused,
      beatsPerBar: r.beatsPerBar,
      coverage: r.coverage,
      why: r.valuesWhy,
      written: r.notesFromWritten,
      judged: r.notesJudged,
      even: r.notesFromEven,
      evenNotes: r.timing?.evenNotes,
      runs: r.runs.length,
      notes: r.perNote.length,
    };
  }, { b64 });
  console.log(page.name.padEnd(10), JSON.stringify(out));
}
await browser.close();
