// WHAT THE READER GETS AFTER THE IMPORT PIPELINE, on a page shot with a phone.
//
// Everything else in this repo measures the reader against a page rendered
// straight out of a PDF: `bench` draws the page at 1400px and reads it. That is
// not what a scan is. A scan is a photograph — smaller, softer, unevenly lit —
// which is then straightened and de-shadowed on the way in, and the reader
// meets the RESULT of all that. Nothing measured the result.
//
// So: the three hand-marked pages, degraded the way `scan:studies --phone`
// degrades its studies (0.72 downscale, 1px blur, 0.62 contrast, a JPEG round
// trip), then pushed through the same call the app makes when a photograph
// arrives, then read, then scored against the same truth marks `bench` uses.
// The number that matters is RECALL: a notehead the reader never finds cannot
// be clicked, cannot be aligned to, and cannot be marked.
//
//   npm run dev            (in another terminal, on port 5199)
//   npm run scan:import
//   npm run scan:import -- --keep <dir>     write the imported pages out
//
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const argv = process.argv.slice(2);
const keepAt = argv.includes('--keep') ? argv[argv.indexOf('--keep') + 1] : null;

const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 2000 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const entry of index) {
  const bytes = (await readFile(entry.file)).toString('base64');
  const truthPath = entry.truth.startsWith('/')
    ? entry.truth : new URL(`../${entry.truth}`, import.meta.url).pathname;
  const truth = JSON.parse(await readFile(truthPath, 'utf8'));
  const out = await page.evaluate(async ({ b64, marks, wantKeep, across, shrink, master }) => {
    window.__READ_ACROSS = across;
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const doc = await pdfjs.getDocument({ data }).promise;
    const first = await doc.getPage(1);
    // THE MASTER THE PHOTOGRAPH IS TAKEN OF, and it is 1400 by default so every
    // number this tool has ever printed is unchanged.
    //
    // It has to be raiseable to answer one question: what does a BIGGER camera
    // buy? `shrink` shoots the master, so with a 1400 master the largest
    // photograph this can simulate is 1400 across — and asking for more would
    // upscale a 1400px render, which is not a bigger photograph but a blurrier
    // one, and would price the gain at less than nothing. Render the master at
    // 2800 and shoot it at 0.5 and at 1.0 and the two shots are a phone's
    // preview frame and a phone's still, of the same page, with real detail in
    // the second one.
    const wide = master;
    const scale = wide / first.getViewport({ scale: 1 }).width;
    const view = first.getViewport({ scale });
    const sheet = document.createElement('canvas');
    sheet.width = view.width;
    sheet.height = view.height;
    await first.render({ canvasContext: sheet.getContext('2d'), viewport: view }).promise;

    // A PHOTOGRAPH OF THAT PAGE. The same spoiling scan:studies calls --phone,
    // plus the one thing a rendered page never has and every photograph does:
    // a lamp on one side. The shadow is what the import pipeline exists for, so
    // leaving it out would measure the pipeline doing nothing.
    const shot = document.createElement('canvas');
    shot.width = Math.round(sheet.width * shrink);
    shot.height = Math.round(sheet.height * shrink);
    const g = shot.getContext('2d', { willReadFrequently: true });
    g.filter = 'blur(1px) contrast(0.62)';
    g.drawImage(sheet, 0, 0, shot.width, shot.height);
    g.filter = 'none';
    const lamp = g.createLinearGradient(0, 0, shot.width, shot.height);
    lamp.addColorStop(0, 'rgb(0 0 0 / 0)');
    lamp.addColorStop(1, 'rgb(20 16 8 / 0.42)');
    g.fillStyle = lamp;
    g.fillRect(0, 0, shot.width, shot.height);
    const jpeg = await new Promise((go) => shot.toBlob(go, 'image/jpeg', 0.6));
    const photo = await createImageBitmap(jpeg);

    // …and through the door the app puts a photograph through — with the page's
    // own four corners handed in rather than found.
    //
    // Finding them is `scan:pages`'s job and it is measured there. Here it would
    // wreck the measurement instead of taking part in it: the finder crops to
    // the paper, and every truth mark is a FRACTION of the whole picture, so a
    // crop moves every mark relative to the page and the recall it reports is a
    // coordinate mismatch. MEASURED, with the finder left in: 1.3% recall over
    // 1059 marks, which is not a reading failure at all. So the frame is pinned
    // and what is measured is the half this check is for — the LIGHT.
    const { straightenCanvas } = await import('/src/ui/straighten.js');
    const held = document.createElement('canvas');
    held.width = photo.width;
    held.height = photo.height;
    held.getContext('2d').drawImage(photo, 0, 0);
    const WHOLE = [[0, 0], [1, 0], [1, 1], [0, 1]];
    let imported = held;
    try {
      imported = straightenCanvas(held, held.width, held.height, WHOLE) ?? held;
    } catch { imported = held; }

    // AND READ AT THE SIZE THE APP READS AT, which is not the size the page was
    // stored at. `readPages` in paper.js draws every page onto a canvas 1400
    // device pixels across before handing it to the reader, so a photograph
    // stored smaller than that is upscaled first and a bigger one is reduced.
    // Reading the stored pixels directly measured a pipeline the app does not
    // have.
    const shown = document.createElement('canvas');
    shown.width = across;
    shown.height = Math.round((imported.height / imported.width) * across);
    shown.getContext('2d').drawImage(imported, 0, 0, shown.width, shown.height);
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const read = readPage(shown, shown.width, shown.height);
    const found = read ? notesInOrder(read) : [];
    // `read.space` is a fraction of the page's HEIGHT — see readPage.
    const space = (read?.space ?? 0) * shown.height;

    // Scored exactly as truth-check scores: nearest first, one detection to one
    // mark, inside half a staff space.
    const near = Math.max(4, space * 0.5);
    const pairs = [];
    for (const [fi, f] of found.entries()) {
      for (const [ti, t] of marks.entries()) {
        const d = Math.hypot((f.x - t.x) * shown.width, (f.y - t.y) * shown.height);
        if (d < near) pairs.push({ fi, ti, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    const tookF = new Set();
    const tookT = new Set();
    for (const p of pairs) {
      if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
      tookF.add(p.fi);
      tookT.add(p.ti);
    }
    return {
      wide: shown.width,
      stored: imported.width,
      space: +space.toFixed(1),
      staves: read?.staves?.length ?? 0,
      clefs: (read?.staves ?? []).filter((st) => st.clef).length,
      key: read?.key ? (read.key.sharps ? read.key.sharps : -read.key.flats) : null,
      found: found.length,
      truth: marks.length,
      matched: tookT.size,
      priced: found.filter((n) => Number.isFinite(n.midi)).length,
      png: wantKeep ? shown.toDataURL('image/png') : null,
    };
  }, {
    b64: bytes,
    marks: truth.notes ?? truth.marks ?? truth,
    wantKeep: !!keepAt,
    across: Number(process.env.READ_ACROSS ?? 1400),
    shrink: Number(process.env.SHRINK ?? 0.72),
    master: Number(process.env.MASTER ?? 1400),
  });
  rows.push({ name: entry.name, ...out });
  if (keepAt && out.png) {
    mkdirSync(keepAt, { recursive: true });
    writeFileSync(`${keepAt}/${entry.name.replace(/\W+/g, '-')}.png`,
      Buffer.from(out.png.split(',')[1], 'base64'));
  }
}

const pc = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
console.log('\nTHE READER AFTER THE IMPORT PIPELINE — the three marked pages,'
  + ' photographed and brought in the way the app brings a scan in');
const MASTER = Number(process.env.MASTER ?? 1400);
const SHRINK = Number(process.env.SHRINK ?? 0.72);
console.log(`  photographed at ${SHRINK} of a ${MASTER}px master`
  + ` (${Math.round(MASTER * SHRINK)}px across),`
  + ` read at ${Number(process.env.READ_ACROSS ?? 1400)}px across\n`);
console.log('  page          width  space  staves  clefs  key   found  marked  RECALL   priced');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(12)}${String(r.wide).padStart(6)}`
    + `${String(r.space).padStart(7)}${String(r.staves).padStart(8)}${String(r.clefs).padStart(7)}`
    + `${String(r.key ?? '—').padStart(5)}${String(r.found).padStart(8)}${String(r.truth).padStart(8)}`
    + `${pc(r.matched, r.truth).padStart(9)}${pc(r.priced, r.found).padStart(9)}`);
}
const marked = rows.reduce((n, r) => n + r.truth, 0);
const got = rows.reduce((n, r) => n + r.matched, 0);
console.log(`\n  RECALL over all three pages   ${pc(got, marked)}  (${got} of ${marked})`);
console.log('  `priced` is how many of the noteheads found came back with a pitch —'
  + ' a head with none can be seen but not aligned to.');
if (errors.length) console.log(`\npage errors: ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
