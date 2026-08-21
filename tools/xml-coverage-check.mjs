// How much of the page reached the XML.
//
// "if there are 100 notes on a page, the xml should have 100 notes" — which is
// a fair thing to want and, until now, nothing measured it. There was no count
// of what is ON the page to compare against.
//
// There is one on the device: the app's own page reader finds noteheads in a
// photograph without recognising them (src/analysis/scan-read.js), which is
// exactly the second opinion needed. It is not perfect either — it misses some
// and invents some on printed text — so this is a ratio to watch rather than a
// truth, and it says so.
//
//   npm run dev              (on 5199)
//   npm run score:coverage -- --image <page.jpg> --xml <read.musicxml>
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const APP = arg('app', 'http://localhost:5199');
const IMAGE = arg('image', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/shot-1.jpg`);
const XML = arg('xml', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/fin-p3200.jpg.musicxml`);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const image = readFileSync(IMAGE).toString('base64');
const xml = readFileSync(XML, 'utf8');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const out = await page.evaluate(async ({ data, text }) => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  const { parseScore } = await import('/src/analysis/musicxml.js');
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `data:image/jpeg;base64,${data}`; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const read = readPage(canvas, canvas.width, canvas.height);
  // The reader keeps its noteheads per staff — see readPage's own `heads`.
  const onThePage = (read?.staves ?? []).reduce((n, st) => n + (st.heads?.length ?? 0), 0) || null;
  const staves = read?.staves?.length ?? null;

  const parsed = parseScore(text, { partIndex: 0 });
  // Every PITCHED note in the file, chord members and second voices included:
  // the app's own reading of a score drops those on purpose, and they are
  // noteheads on the page all the same.
  const inTheXml = (text.match(/<note\b[^>]*>(?:(?!<\/note>)[\s\S])*?<pitch>/g) ?? []).length;
  // Systems: what the file says the page is laid out as, against what the page
  // reader actually finds on it. "13 lines when the real one is 11" is this
  // number disagreeing, and nothing measured it before.
  const parts = parsed.parts?.length ?? 1;
  const breaks = (text.match(/new-system="yes"/g) ?? []).length;
  const systems = Math.round(breaks / Math.max(1, parts)) + 1;
  return { onThePage, staves, inTheXml, parts, systems, played: parsed.notes.length };
}, { data: image, text: xml });

await browser.close();
console.log(`the page reader finds   ${out.onThePage} noteheads across ${out.staves} staves`);
console.log(`the XML is laid out as  ${out.systems} system(s)`);
if (out.staves && out.systems !== out.staves) {
  console.log(`   MISMATCH — the page has ${out.staves} lines of music and the file says ${out.systems}`);
}
console.log(`the XML holds           ${out.inTheXml} noteheads across ${out.parts} part(s)`);
if (out.onThePage) {
  console.log(`covered                 ${Math.round((out.inTheXml / out.onThePage) * 100)}%`);
}
