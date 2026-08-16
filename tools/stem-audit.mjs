// Does every notehead have a stem, and does that tell it from a rest?
//
// The reader judges every candidate on its own — is this patch of ink shaped
// like a notehead — and a page of music is not a bag of independent patches. A
// note in a beamed group has a stem, and a stem has exactly one notehead on the
// end of it. If that holds on real pages then a candidate with no stem is a
// rest, a dynamic or a letter, and a stem with no candidate is a note that was
// missed — which is BOTH remaining error populations, answered by the same fact.
//
// It might not hold. A semibreve has no stem, an editor's ornament has one, and
// on a photograph a stem is two grey pixels that the threshold may not keep. So
// this measures it before anything is built on it.
//
//   npm run scan:stems
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto(`http://localhost:${process.env.PORT ?? '5199'}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

console.log('\nDOES A NOTEHEAD HAVE A STEM?\n');
for (const p of index) {
  const bytes = await readFile(p.file);
  const truth = JSON.parse(await readFile(p.truth, 'utf8')).notes;
  const out = await page.evaluate(async ({ b64, pdf, want }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    let src;
    if (pdf) {
      const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
      const doc = await pdfjs.getDocument({ data: binary }).promise;
      const first = await doc.getPage(1);
      const viewport = first.getViewport({ scale: 1800 / first.getViewport({ scale: 1 }).width });
      src = document.createElement('canvas');
      src.width = viewport.width; src.height = viewport.height;
      await first.render({ canvasContext: src.getContext('2d'), viewport }).promise;
    } else {
      const bmp = await createImageBitmap(new Blob([binary]));
      src = document.createElement('canvas');
      src.width = bmp.width; src.height = bmp.height;
      src.getContext('2d').drawImage(bmp, 0, 0);
    }
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);
    const w = work.width; const h = work.height;
    const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    const rad = Math.max(4, Math.round(w / 36)); const sp = rad * 2 + 1;
    const t1 = new Float32Array(w * h); const bg = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = -rad; x <= rad; x++) s += gray[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { t1[y * w + x] = s / sp; s += gray[y * w + Math.min(w - 1, x + rad + 1)] - gray[y * w + Math.max(0, x - rad)]; }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -rad; y <= rad; y++) s += t1[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { bg[y * w + x] = s / sp; s += t1[Math.min(h - 1, y + rad + 1) * w + x] - t1[Math.max(0, y - rad) * w + x]; }
    }
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = gray[i] < bg[i] - 16 ? 1 : 0;

    const read = readPage(work, w, h, { judge: false });
    const notes = notesInOrder(read);
    const spaces = read.staves.map((s) => s.space * h).sort((a, b) => a - b);
    const space = spaces[Math.floor(spaces.length / 2)];

    // The tallest unbroken vertical run of ink standing at either side of the
    // head, where an engraver puts a stem: up on the right, down on the left.
    const stem = (cx, cy) => {
      let best = 0;
      for (const side of [1, -1]) {
        for (let d = Math.round(space * 0.4); d <= Math.round(space * 0.85); d++) {
          const x = Math.round(cx + side * d);
          if (x < 0 || x >= w) continue;
          for (const dir of [-1, 1]) {
            let run = 0;
            let y = Math.round(cy + dir * space * 0.3);
            while (y > 0 && y < h - 1 && run < space * 5) {
              if (!ink[y * w + x] && !ink[y * w + Math.min(w - 1, x + 1)]) break;
              run++; y += dir;
            }
            best = Math.max(best, run);
          }
        }
      }
      return best / space;
    };

    return notes.map((n) => {
      const cx = n.x * w; const cy = n.y * h;
      let real = 0;
      for (const t of want) {
        if (Math.hypot(t.x * w - cx, t.y * h - cy) < space * 0.5) { real = 1; break; }
      }
      return { real, stem: +stem(cx, cy).toFixed(2) };
    });
  }, { b64: bytes.toString('base64'), pdf: /\.pdf$/i.test(p.file), want: truth });

  const real = out.filter((r) => r.real);
  const fake = out.filter((r) => !r.real);
  const med = (rs) => (rs.length ? rs.map((r) => r.stem).sort((a, b) => a - b)[Math.floor(rs.length / 2)] : null);
  console.log(`  ${p.name}: ${real.length} notes, ${fake.length} not`);
  console.log(`    median stem height — notes ${med(real)} spaces   not-notes ${med(fake)} spaces`);
  console.log('    stem at least   keeps notes   rejects not-notes   net removed');
  for (const cut of [0.5, 1, 1.5, 2, 2.5, 3]) {
    const keep = real.filter((r) => r.stem >= cut).length;
    const cutf = fake.filter((r) => r.stem < cut).length;
    console.log(`    ${cut.toFixed(1)}   ${`${keep}/${real.length}`.padStart(13)}`
      + `   ${`${cutf}/${fake.length}`.padStart(17)}   ${String(cutf - (real.length - keep)).padStart(11)}`);
  }
  console.log('');
}
await browser.close();
