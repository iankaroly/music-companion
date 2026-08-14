// Does the reader find the music on a real scanned page?
//
// A page is a photograph, and the only question that matters — does that ellipse
// sit on that notehead — is not one a unit test can answer. So the page is drawn
// back with everything the reader found laid over it, and the answer is
// something to look at.
//
//   npm run dev -- --port 5177          (in another terminal)
//   node tools/scan-probe.mjs ~/Downloads/part.pdf
//
// It runs the PRODUCTION path: paper.js renders each page exactly as an import
// does, at 1400px, and readPage() is the shipped one. What is measured here is
// what will happen on the device.
//
// Written into <scratch>/scan-probe-<n>.png: the page, with staff lines in
// violet, barlines in blue and every notehead it found ringed in green.
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5177';
const OUT = process.env.PROBE_OUT ?? tmpdir();
const PDF = process.argv[2];
const PAGES = Number(process.argv[3] ?? 2);   // how many to draw back

if (!PDF) {
  console.error('usage: node tools/scan-probe.mjs <part.pdf> [pagesToDraw]');
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGE THROW:', e.message));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async ({ pdf64, draws }) => {
  const { openPaper } = await import('/src/ui/paper.js');
  const { readPage } = await import('/src/analysis/scan-read.js');

  const data = Uint8Array.from(atob(pdf64), (c) => c.charCodeAt(0)).buffer;
  const pages = await openPaper({ source: 'pdf', data });

  const out = [];
  const overlays = [];
  for (let i = 0; i < pages.count; i++) {
    const sheet = document.createElement('canvas');
    sheet.width = 8;
    sheet.height = 8;
    await pages.draw(i, sheet, 1400, 6000);
    const w = sheet.width;
    const h = sheet.height;

    const began = performance.now();
    const found = readPage(sheet, w, h);
    const ms = Math.round(performance.now() - began);

    if (!found) {
      out.push({ page: i, size: [w, h], ms, staves: 0, heads: 0 });
      sheet.width = 0;
      sheet.height = 0;
      continue;
    }

    out.push({
      page: i,
      size: [w, h],
      ms,
      staves: found.staves.length,
      heads: found.staves.reduce((n, s) => n + s.heads.length, 0),
      perStaff: found.staves.map((s) => s.heads.length),
      staveTops: found.staves.map((s) => Math.round(s.lines[0][0] * h)),
      spacePx: found.staves.map((s) => +(s.space * h).toFixed(1)),
      barsPerStaff: found.staves.map((s) => s.bars.length),
    });

    if (overlays.length < draws) {
      const view = document.createElement('canvas');
      view.width = w;
      view.height = h;
      const ctx = view.getContext('2d');
      ctx.drawImage(sheet, 0, 0);
      for (const staff of found.staves) {
        ctx.strokeStyle = 'rgba(109,78,246,0.5)';
        ctx.lineWidth = 1;
        for (const line of staff.lines) {
          ctx.beginPath();
          line.forEach((y, s) => {
            const x = (s + 0.5) * (w / line.length);
            if (s === 0) ctx.moveTo(x, y * h); else ctx.lineTo(x, y * h);
          });
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(43,116,201,0.45)';
        for (const bx of staff.bars) {
          ctx.beginPath();
          ctx.moveTo(bx * w, staff.top * h);
          ctx.lineTo(bx * w, staff.bottom * h);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(23,181,120,0.95)';
        ctx.lineWidth = 1.4;
        for (const head of staff.heads) {
          ctx.beginPath();
          ctx.ellipse(head.x * w, head.y * h,
            staff.space * h * 0.7, staff.space * h * 0.52, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      overlays.push(view.toDataURL('image/png'));
    }
    sheet.width = 0;
    sheet.height = 0;
  }
  return { count: pages.count, out, overlays };
}, { pdf64: readFileSync(PDF).toString('base64'), draws: PAGES });

result.overlays.forEach((uri, i) => {
  const where = join(OUT, `scan-probe-${i}.png`);
  writeFileSync(where, Buffer.from(uri.split(',')[1], 'base64'));
  console.log(`drawn: ${where}`);
});

for (const p of result.out) {
  console.log(`page ${p.page + 1}/${result.count}  ${p.size[0]}×${p.size[1]}  ${p.ms}ms`
    + `  staves ${p.staves}  heads ${p.heads}`);
  if (p.staves) {
    console.log(`  tops    ${p.staveTops.join(' ')}`);
    console.log(`  spaces  ${p.spacePx.join(' ')}`);
    console.log(`  heads   ${p.perStaff.join(' ')}`);
    console.log(`  bars    ${p.barsPerStaff.join(' ')}`);
  }
}
await browser.close();
