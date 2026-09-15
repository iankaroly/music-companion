// A PDF part in the reader: how long to open, how long a turn takes, and
// whether the page shown right after a turn is the sharp one or a stand-in.
import puppeteer from 'puppeteer-core';
const SHELL = `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const size = process.argv[2] === 'ipad' ? { width: 1024, height: 1366 } : { width: 393, height: 852 };
const PAGES = Number(process.argv[3] ?? 8);
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
const out = await page.evaluate(async (PAGES) => {
  document.querySelector('#welcome')?.remove();
  document.querySelector('#welcome-card')?.remove();
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sheet = (n) => {
    const c = document.createElement('canvas');
    c.width = 1240; c.height = 1754;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const s = 15;
    g.fillStyle = '#111';
    g.font = '48px serif'; g.fillText(`Page ${n + 1}`, 110, 150);
    for (let sys = 0; sys < 5; sys++) {
      const top = 240 + sys * 300;
      for (let l = 0; l < 5; l++) g.fillRect(110, top + l * s, 1020, 2.2);
      for (const x of [110, 450, 790, 1130]) g.fillRect(x, top, 2.2, s * 4);
      for (let i = 0; i < 8; i++) {
        const at = Math.round(rnd() * 8) - 2;
        const x = 170 + i * 120;
        const y = (top + 4 * s) - (at * s) / 2;
        g.save(); g.translate(x, y); g.rotate(-0.3);
        g.beginPath(); g.ellipse(0, 0, s * 0.62, s * 0.46, 0, 0, Math.PI * 2); g.fill(); g.restore();
        g.fillRect(x + s * 0.55, y - s * 3, 2.2, s * 3);
      }
    }
    return c;
  };
  const { pdfFromPages } = await import('/src/ui/export.js');
  const pages = [];
  for (let n = 0; n < PAGES; n++) {
    const canvas = sheet(n);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
    pages.push({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await blob.arrayBuffer()) });
  }
  const pdf = pdfFromPages(pages);
  const data = pdf instanceof Blob ? await pdf.arrayBuffer() : pdf;
  const { savePagesScore, loadScore } = await import('/src/store/db.js');
  const scoreId = await savePagesScore({ name: 'Turns PDF', source: 'pdf', pageCount: PAGES, data });
  const row = await loadScore(scoreId);
  const reader = await import('/src/ui/reader.js');
  const t0 = performance.now();
  await reader.openReader(row);
  const drawnAt = async () => {
    for (let i = 0; i < 400; i++) {
      const node = document.querySelector('#reader-sheet .reader-paper:not([hidden]) canvas');
      if (node && node.width > 1) return performance.now();
      await new Promise((r) => setTimeout(r, 10));
    }
    return null;
  };
  const first = await drawnAt();
  const open = { toReturn: Math.round(performance.now() - t0), toFirstPixels: first ? Math.round(first - t0) : null };
  await new Promise((r) => setTimeout(r, 1500));
  const shown = () => {
    const node = document.querySelector('#reader-sheet .reader-paper:not([hidden]) canvas');
    return node ? { w: node.width, css: node.style.width, cssH: node.style.height } : null;
  };
  const turns = [];
  for (let i = 1; i < PAGES; i++) {
    const s0 = reader.readerState();
    const before = performance.now();
    await reader.showPage(i);
    const after = performance.now();
    const state = reader.readerState();
    const sizeNow = shown();
    await new Promise((r) => setTimeout(r, 600));
    const later = shown();
    const state2 = reader.readerState();
    turns.push({
      to: i + 1, ms: Math.round(after - before), roughAfter: state.roughNow, roughLater: state2.roughNow,
      sizeNow: `${sizeNow?.css}x${sizeNow?.cssH} @${sizeNow?.w}`, sizeLater: `${later?.css}x${later?.cssH} @${later?.w}`,
      thumbs: state.thumbsReady,
    });
    if (i === 3) await new Promise((r) => setTimeout(r, 2500));
  }
  // and back fast, ten taps
  const b0 = performance.now();
  for (let i = PAGES - 2; i >= 0; i--) await reader.showPage(i);
  const backMs = Math.round(performance.now() - b0);
  return { open, turns, backMs };
}, PAGES);
console.log(JSON.stringify(out, null, 1));
await browser.close();
