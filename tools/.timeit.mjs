// throwaway: readPage wall time, old gate vs new gate, on the real page.
import puppeteer from 'puppeteer-core';
import { readFile } from 'node:fs/promises';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const IMG = process.argv[2];
const bytes = await readFile(IMG);
const b64 = bytes.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800 });
await page.goto('http://localhost:5199/', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1000));

const out = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const mods = {
    old: await import('/src/analysis/scan-read.js'),
    scanAll: await import('/tools/.scan-read-fix.js'),
    scanFrom: await import('/tools/.scan-read-fixB.js'),
  };
  const res = {};
  for (const [name, m] of Object.entries(mods)) {
    const times = [];
    let heads = 0;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = m.readPage(img, img.naturalWidth, img.naturalHeight);
      times.push(performance.now() - t0);
      heads = (r?.staves ?? []).reduce((a, s) => a + s.heads.length, 0);
    }
    times.sort((a, b) => a - b);
    res[name] = { median: +times[2].toFixed(1), min: +times[0].toFixed(1), heads };
  }
  return { size: `${img.naturalWidth}x${img.naturalHeight}`, ...res };
}, b64);
console.log(JSON.stringify(out, null, 1));
await browser.close();
