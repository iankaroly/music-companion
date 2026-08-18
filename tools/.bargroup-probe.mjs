// SCRATCH: dump per-staff barline x positions and the head count in each group.
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const index = JSON.parse(await readFile('/Users/iankaroly/music-companion/pages/index.json', 'utf8'));
const only = process.env.ONLY;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000 });
const tab = await browser.newPage();
await tab.setViewport({ width: 1400, height: 1800 });
await tab.goto(`http://localhost:${process.env.PORT ?? 5199}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
for (const page of index) {
  if (only && page.name !== only) continue;
  const b64 = (await readFile(page.file)).toString('base64');
  const out = await tab.evaluate(async ({ b64 }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
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
    const heads = notesInOrder(read);
    const staves = read.staves.map((s, i) => {
      const mine = heads.filter((n) => n.staff === i);
      const groups = new Map();
      for (const n of mine) groups.set(n.bar, (groups.get(n.bar) ?? 0) + 1);
      return {
        i,
        space: +(s.space ?? 0).toFixed(1),
        bars: (s.bars ?? []).map((x) => Math.round(x * work.width)),
        heads: mine.length,
        counts: [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([b,c]) => `${b}:${c}`).join(' '),
        sums: (() => {
          const m = new Map();
          for (const n of mine) m.set(n.bar, (m.get(n.bar) ?? 0) + (n.beats ?? 0));
          return [...m.entries()].sort((a,b)=>a[0]-b[0]).map(([b,v]) => `${b}:${(+v.toFixed(3))}`).join(' ');
        })(),
        midY: Math.round(s.lines[2][Math.floor(s.lines[2].length/2)] * work.height),
        headX: mine.map((n) => Math.round(n.x * work.width)),
      };
    });
    return { w: work.width, h: work.height, staves };
  }, { b64 });
  console.log(`\n=== ${page.name}  canvas ${out.w}x${out.h}`);
  for (const s of out.staves) {
    console.log(` staff ${s.i} space ${s.space} heads ${s.heads}`);
    console.log(`   bars ${JSON.stringify(s.bars)}`);
    console.log(`   groups ${s.counts}`);
    console.log(`   sums   ${s.sums}   midY ${s.midY}`);
    if (process.env.HEADX) console.log(`   headX ${JSON.stringify(s.headX)}`);
  }
}
await browser.close();
