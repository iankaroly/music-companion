// What does the reader lose to its own working width?
//
// readPage works at a fixed 1400px across, whatever the page is. A PDF is
// rendered bigger than that and then thrown away down to it — so the staff
// space the reader actually sees is decided by how wide the paper happens to
// be, not by how much detail the reader needs. On one page that lands at 12.1
// pixels a space and on the next at 10, and everything downstream — noteheads,
// beams, barlines — is measured in fractions of it.
//
// This renders the same page at a range of widths and reports what changes.
//
//   npm run scan:res -- <file.pdf>
//
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const file = process.argv[2];
if (!file) { console.log('usage: npm run scan:res -- <file.pdf>'); process.exit(1); }
const bytes = await readFile(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const rows = await page.evaluate(async ({ b64, pdf }) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
  const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  let render;
  if (pdf) {
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    render = async (W) => {
      const viewport = first.getViewport({ scale: W / first.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas');
      c.width = viewport.width; c.height = viewport.height;
      await first.render({ canvasContext: c.getContext('2d'), viewport }).promise;
      return c;
    };
  } else {
    const bitmap = await createImageBitmap(new Blob([binary]));
    render = async (W) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = Math.round(bitmap.height * (W / bitmap.width));
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      return c;
    };
  }

  const out = [];
  for (const W of [1000, 1400, 1800, 2200, 2600, 3000, 3600]) {
    // Rendered AT the width, not rendered big and thrown away down to it.
    const c = await render(W);
    let read = null;
    try { read = readPage(c, c.width, c.height); } catch (e) { out.push({ W, error: String(e.message) }); continue; }
    if (!read) { out.push({ W, error: 'no stave' }); continue; }
    const notes = notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * c.height).sort((a, b) => a - b);
    out.push({
      W,
      size: `${c.width}x${c.height}`,
      staves: read.staves.length,
      space: +spaces[Math.floor(spaces.length / 2)].toFixed(1),
      heads: notes.length,
      bars: read.staves.reduce((a, s) => a + s.bars.length, 0),
      clefs: read.staves.filter((s) => s.clef).length,
    });
  }
  return out;
}, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(file) });

await browser.close();
console.log(`\n${basename(file)} — the same page at different working widths\n`);
console.log('  width   canvas         staves  space  clefs  bars  heads');
for (const r of rows) {
  if (r.error) { console.log(`  ${String(r.W).padStart(5)}   ${r.error}`); continue; }
  console.log(`  ${String(r.W).padStart(5)}   ${r.size.padEnd(13)}  ${String(r.staves).padStart(6)}`
    + `  ${String(r.space).padStart(5)}  ${String(r.clefs).padStart(5)}  ${String(r.bars).padStart(4)}  ${String(r.heads).padStart(5)}`);
}
console.log('');
