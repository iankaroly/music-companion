// WHAT ONE FRAME OF A PEN STROKE COSTS, and whether it grows with the stroke.
//
// `npm run pen:lag` measures how long the main thread is BLOCKED, which is the
// right instrument for a stall and the wrong one for a line that is simply a
// frame behind the nib: a paint that costs 6ms every frame never blocks
// anything and still leaves the ink trailing. This wraps requestAnimationFrame
// inside the page and times every callback while a stroke is dispatched at the
// rate a pencil reports (one sample every 4ms), then buckets the frames by how
// many points the stroke had when they were painted. A cost that climbs down
// the table is a paint that redraws the whole mark; a flat one is a paint that
// touches only what moved.
//
//   npm run dev
//   npm run pen:frames                  (THROTTLE=6, NIB=ballpoint, TYPE=pen)
//   NIB=pencil TYPE=touch npm run pen:frames
//
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const THROTTLE = Number(process.env.THROTTLE ?? 6);
const MOVES = Number(process.env.MOVES ?? 1200);
const NIB = process.env.NIB ?? 'ballpoint';
const TYPE = process.env.TYPE ?? 'pen';
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000 });
const page = await browser.newPage();
const size = { width: 1024, height: 1366 };
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true });
const cdp = await page.createCDPSession();
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
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await wait(1500);
await page.evaluate(() => { document.querySelector('#welcome')?.remove(); document.querySelector('#welcome-card')?.remove(); localStorage.setItem('readerNight', 'off'); });
await page.evaluate(async (x) => {
  const { openReader } = await import('/src/ui/reader.js');
  const { saveAnnotations } = await import('/src/store/db.js');
  await saveAnnotations('frame-cost', []);
  await openReader({ id: 'frame-cost', name: 'Frame cost', xml: x, kind: 'notation' });
  await new Promise((r) => setTimeout(r, 900));
}, xml());
await page.evaluate((nib) => {
  if (!document.querySelector('#reader')?.classList.contains('drawing')) document.querySelector('#reader-annotate')?.click();
  const finger = document.querySelector('#reader-finger');
  if (finger && finger.getAttribute('aria-pressed') !== 'true') finger.click();
  document.querySelector(`#reader-ink-row .ink-nib[data-nib="${nib}"]`)?.click();
  // time every rAF callback
  const raf = window.requestAnimationFrame.bind(window);
  window.__frames = [];
  window.requestAnimationFrame = (cb) => raf((t) => { const a = performance.now(); cb(t); window.__frames.push([a, performance.now() - a]); });
}, NIB);
await wait(400);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
// warm-up stroke
const stroke = async (moves, gap) => page.evaluate(async ({ w, h, moves, gap, type }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = (x, y, kind) => {
    const target = document.elementFromPoint(x, y) ?? document.querySelector('#reader');
    target?.dispatchEvent(new PointerEvent(kind, { pointerId: 991, pointerType: type, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, pressure: kind === 'pointerup' ? 0 : 0.6, buttons: kind === 'pointerup' ? 0 : 1 }));
  };
  window.__frames = [];
  const t0 = performance.now();
  at(w * 0.1, h * 0.3, 'pointerdown');
  for (let i = 0; i < moves; i++) {
    const f = i / moves;
    at(w * (0.1 + 0.8 * ((f * 3) % 1)), h * (0.3 + 0.3 * f + 0.05 * Math.sin(f * 40)), 'pointermove');
    await sleep(gap);
  }
  at(w * 0.9, h * 0.6, 'pointerup');
  await sleep(300);
  return { t0, frames: window.__frames };
}, { w: size.width, h: size.height, moves, gap, type: TYPE });
await stroke(60, 8);
await wait(500);
const { t0, frames } = await stroke(MOVES, 4);
const ptsPerMs = 1 / 4;
const buckets = new Map();
for (const [at, ms] of frames) {
  const pts = Math.min(MOVES, Math.round((at - t0) * ptsPerMs));
  const b = Math.floor(pts / 200) * 200;
  if (!buckets.has(b)) buckets.set(b, []);
  buckets.get(b).push(ms);
}
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
console.log(`\n  ${TYPE} ${NIB}, ${MOVES} moves at 4ms, CPU x${THROTTLE}; frame callback cost by stroke length`);
console.log('  points in stroke   frames   median   p90     worst');
for (const [b, xs] of [...buckets].sort((a, b) => a[0] - b[0])) {
  const s = [...xs].sort((a, b) => a - b);
  console.log(`  ${String(b).padEnd(19)}${String(xs.length).padEnd(9)}${med(xs).toFixed(1).padEnd(9)}${(s[Math.floor(s.length * 0.9)] ?? 0).toFixed(1).padEnd(8)}${s.at(-1).toFixed(1)}`);
}
await wait(800);   // the save is debounced
const drew = await page.evaluate(async () => { const { loadAnnotations } = await import('/src/store/db.js'); const all = await loadAnnotations('frame-cost').catch(() => []); return all.at(-1)?.points?.length ?? 0; });
console.log(`  points kept in the mark: ${drew}; page errors: ${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
await browser.close();
