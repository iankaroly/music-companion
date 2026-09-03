// DOES THE STRIP REPAINT PUT THE SAME PIXELS ON THE GLASS AS A FULL ONE?
//
// While a mark is being made, `paintInk` repaints only the strip the mark has
// grown by (see "the stroke under way" in reader.js). The claim is that what
// lands inside that strip is exactly what a full repaint would have put there.
// This checks the claim rather than trusting it: one stroke per nib, over a
// page that already carries forty marks, the ink canvas read on the last frame
// BEFORE the pen lifts (every frame of which was a strip) and again after the
// lift (a full repaint, the mark now on the dry layer). The two should be the
// same picture. A handful of edge pixels a few levels apart is the rounding of
// compositing in a different order; a run of them along the mark is a seam,
// and a patch is a ghost the strip left behind.
//
//   npm run dev
//   OUT=/tmp npm run pen:strip          (OUT: where to write crops of any diff)
//
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000 });
const page = await browser.newPage();
const size = { width: 820, height: 1180 };
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const xml = () => {
  const ms = [];
  for (let m = 1; m <= 40; m++) {
    let n = '';
    for (let i = 0; i < 4; i++) n += '<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><type>quarter</type></note>';
    ms.push(`<measure number="${m}">` + (m === 1 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>' : '') + n + '</measure>');
  }
  return '<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Cello</part-name></score-part></part-list><part id="P1">' + ms.join('') + '</part></score-partwise>';
};
const seed = [];
for (let i = 0; i < 40; i++) {
  const points = [];
  for (let k = 0; k < 24; k++) points.push({ m: 1 + (i % 36), u: 0.1 + k * 0.03, v: 0.3 + 0.25 * Math.sin(k / 3 + i) });
  seed.push({ tool: 'pen', layer: 0, colour: '#1c1b22', width: 0.28, overlay: false, nib: 'ballpoint', points });
}
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.querySelector('#welcome-card')?.remove(); localStorage.setItem('readerNight', 'off'); });
await page.evaluate(async ({ x, seed }) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('identity', seed);
  await openReader({ id: 'identity', name: 'Identity', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, { x: xml(), seed });
await page.evaluate(() => {
  if (!document.querySelector('#reader')?.classList.contains('drawing')) document.querySelector('#reader-annotate')?.click();
  document.querySelector('#reader-finger:not(.on)')?.click();
});
await wait(300);
async function run(tool, nib, type, row) {
  await page.evaluate(({ tool, nib }) => {
    // A pencil seen on the page turns the finger off; the finger row says so.
    const finger = document.querySelector('#reader-finger');
    if (finger && finger.getAttribute('aria-pressed') !== 'true') finger.click();
    document.querySelector(`#reader-ink-bar [data-tool="${tool}"]`)?.click();
    document.querySelector(`#reader-ink-row .ink-nib[data-nib="${nib}"]`)?.click();
    document.querySelector('#reader-brush')?.classList.remove('open');
  }, { tool, nib });
  await wait(300);
  return page.evaluate(async ({ w, h, type, row }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const at = (x, y, kind) => {
      const target = document.elementFromPoint(x, y) ?? document.querySelector('#reader');
      target?.dispatchEvent(new PointerEvent(kind, { pointerId: 991, pointerType: type, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, pressure: kind === 'pointerup' ? 0 : 0.3 + 0.5 * Math.abs(Math.sin(x / 40)), buttons: kind === 'pointerup' ? 0 : 1 }));
    };
    const y0 = h * (0.25 + 0.12 * row);
    at(w * 0.1, y0, 'pointerdown');
    for (let i = 0; i < 300; i++) {
      const f = i / 300;
      at(w * (0.1 + 0.8 * f), y0 + h * 0.06 * Math.sin(f * 25), 'pointermove');
      if (i % 5 === 0) await sleep(4);
    }
    await frame();
    const ink = document.querySelector('#reader-ink');
    const ctx = ink.getContext('2d');
    const before = ctx.getImageData(0, 0, ink.width, ink.height).data;
    at(w * 0.9, y0, 'pointerup');
    await frame();
    await sleep(50);
    await frame();
    const after = ctx.getImageData(0, 0, ink.width, ink.height).data;
    let differing = 0; let worst = 0; let inked = 0;
    let bx0 = Infinity, by0 = Infinity, bx1 = -1, by1 = -1;
    const W = ink.width;
    for (let i = 0; i < before.length; i += 4) {
      if (after[i + 3] > 0 || before[i + 3] > 0) inked++;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(before[i + c] - after[i + c]));
      if (d > 2) {
        differing++;
        const px = (i / 4) % W; const py = Math.floor(i / 4 / W);
        bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py);
      }
      if (d > worst) worst = d;
    }
    let crops = null;
    if (differing) {
      const cw = Math.min(W, bx1 - bx0 + 40), ch = Math.min(ink.height, by1 - by0 + 40);
      const cx = Math.max(0, bx0 - 20), cy = Math.max(0, by0 - 20);
      const mk = (data) => {
        const c = document.createElement('canvas'); c.width = cw; c.height = ch;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
        const img = new ImageData(cw, ch);
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const si = ((cy + y) * W + (cx + x)) * 4; const di = (y * cw + x) * 4;
          for (let k = 0; k < 4; k++) img.data[di + k] = data[si + k];
        }
        const t = document.createElement('canvas'); t.width = cw; t.height = ch; t.getContext('2d').putImageData(img, 0, 0);
        g.drawImage(t, 0, 0);
        return c.toDataURL();
      };
      crops = { before: mk(before), after: mk(after), box: [bx0, by0, bx1, by1] };
    }
    await sleep(700);
    const { loadAnnotations } = await import('/src/store/db.js');
    const all = await loadAnnotations('identity').catch(() => []);
    return { differing, worst, inked, drew: all.at(-1)?.points?.length ?? 0, count: all.length, crops };
  }, { w: size.width, h: size.height, type, row });
}
console.log('  nib           pointer   inked px    differing px   worst channel diff');
let row = 0;
for (const [tool, nib, type] of [['pen', 'ballpoint', 'pen'], ['pen', 'pencil', 'pen'], ['pen', 'fountain', 'pen'], ['highlighter', 'marker', 'pen'], ['pen', 'pencil', 'touch']]) {
  const r = await run(tool, nib, type, row++);
  console.log(`  ${nib.padEnd(14)}${type.padEnd(10)}${String(r.inked).padEnd(12)}${String(r.differing).padEnd(15)}${r.worst}   drew ${r.drew} pts (${r.count} marks)  diff box ${r.crops?.box ?? '-'}`);
  if (r.crops) {
    const fs = await import('node:fs');
    for (const k of ['before', 'after']) if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}/diff-${nib}-${type}-${k}.png`, Buffer.from(r.crops[k].split(',')[1], 'base64'));
  }
}
console.log(`  page errors: ${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
await browser.close();
