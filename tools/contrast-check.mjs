// How easy is it to see a note after the page has been brightened?
//
// The brightening exists to make a photograph of a page look like a scan: the
// lighting divided out, the paper taken to white. It is only worth having if
// the NOTES are easier to see afterwards, and it used to do the opposite —
// every pixel scaled by the same ratio takes the ink up with the paper, and on
// a dense page a black notehead came back mid-grey.
//
// So this measures the thing that matters: where the paper sits, where the ink
// sits, and the gap between them, before and after.
//
//   npm run dev        (in another terminal, on port 5199)
//   npm run scan:contrast [image.jpg ...]
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';
const files = process.argv.slice(2);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 800));

const rows = [];
for (const file of files) {
  const row = await page.evaluate(async (data, name) => {
    const { unshadow } = await import('/src/analysis/unshadow.js');
    const { readableImage, sizeOfImage } = await import('/src/ui/straighten.js');
    const img = await readableImage(new File([new Uint8Array(data)], name, { type: 'image/jpeg' }));
    const { w: W, h: H } = sizeOfImage(img);
    // At the size a page is looked at, not the size it was taken at.
    const w = 1000;
    const h = Math.round(H * (w / W));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const image = cx.getImageData(0, 0, w, h);

    // Paper and ink, as percentiles of the page: the ink is the darkest few
    // per cent of it, the paper the brightest half.
    const levels = (d) => {
      const all = [];
      for (let i = 0; i < d.length; i += 4) all.push(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      all.sort((a, b) => a - b);
      const at = (q) => Math.round(all[Math.floor(all.length * q)]);
      return { ink: at(0.02), mid: at(0.2), paper: at(0.9) };
    };

    const before = levels(image.data);
    unshadow(image.data, w, h, { lift: true });
    const after = levels(image.data);
    return { name, before, after };
  }, [...readFileSync(file)], file.split('/').pop());
  rows.push(row);
}
await browser.close();

console.log('\nWHAT A BRIGHTENED PAGE LOOKS LIKE — ink, paper, and the gap that makes a note visible\n');
console.log('  page                    ink   paper   gap        ink   paper   gap');
console.log('                        ——— before ———          ——— after ———');
for (const r of rows) {
  const b = r.before;
  const a = r.after;
  console.log(`  ${r.name.padEnd(20)} ${String(b.ink).padStart(4)} ${String(b.paper).padStart(6)} ${String(b.paper - b.ink).padStart(6)}`
    + `     ${String(a.ink).padStart(6)} ${String(a.paper).padStart(6)} ${String(a.paper - a.ink).padStart(6)}`);
}
const worse = rows.filter((r) => (r.after.paper - r.after.ink) < (r.before.paper - r.before.ink));
console.log(`\n  the paper is taken to white; the ink must not come with it.`);
if (worse.length) {
  console.error(`\nFAILED: ${worse.map((r) => r.name).join(', ')} — the notes are harder to see after brightening`);
  process.exit(1);
}
console.log('  every page: the notes stand out more than they did.\n');
