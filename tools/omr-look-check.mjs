// ENGRAVE WHAT THE RECOGNISER READ, AND PUT IT NEXT TO THE PAGE IT READ.
//
// Every other instrument here reduces a reading to a number, and a number can
// be right about the wrong thing: 34 bars and 317 notes is what this pipeline
// says about a page that has 36 bars on it, and it says the same about a page
// of somebody else's music. `omr:truth` closes that on a page whose notes are
// known by construction — but no real page's notes are known by construction,
// and a real page is what a player scans.
//
// So: the reading is engraved back to paper with LilyPond and left beside the
// photograph, at a size somebody can read. It is the same method the rest of
// this repo uses on the reader — LOOK AT THE PAGE — pointed at the XML.
//
//   npm run dev                   (on 5199 — the crop runs in the app)
//   npm run omr:look -- <photo.jpg|page.pdf> [--out <dir>]
//
// It sends the photograph the way the app sends it (`pageForReading`, so the
// crop and the size are the app's, not this file's), converts with the LOCAL
// pipeline, and writes three things:
//
//   sent.jpg      what actually went to the recogniser
//   read.png      that reading, engraved
//   read.musicxml the XML itself
//
// A page is right when the two pictures are the same music. Nothing here can
// score that; a person has to look, which is the point.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const SOURCE = args.find((a) => !a.startsWith('--') && /\.(jpe?g|png|pdf)$/i.test(a));
if (!SOURCE) {
  console.error('usage: npm run omr:look -- <photo.jpg|page.pdf> [--out <dir>]');
  process.exit(2);
}
const OUT = path.resolve(flag('out', path.join(tmpdir(), 'practice-partner-omr-look')));
const APP = flag('app', 'http://localhost:5199');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
mkdirSync(OUT, { recursive: true });

// --- what the app would send ---------------------------------------------------

const sentPath = path.join(OUT, 'sent.jpg');
if (/\.pdf$/i.test(SOURCE)) {
  // A PDF goes to the pipeline as it is; there is nothing for the app to crop.
  writeFileSync(sentPath, readFileSync(SOURCE));
} else {
  const browser = await puppeteer.launch({
    executablePath: SHELL,
    headless: true,
    args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  const out = await page.evaluate(async (data) => {
    const { pageForReading, readableImage, sizeOfImage } = await import('/src/ui/straighten.js');
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'shot.jpg', { type: 'image/jpeg' });
    const sending = await pageForReading(file);
    if (!sending) return null;
    const shown = await readableImage(sending);
    const buf = new Uint8Array(await sending.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
    return { data: btoa(s), ...sizeOfImage(shown) };
  }, readFileSync(SOURCE).toString('base64'));
  await browser.close();
  if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
  if (!out) {
    console.error('the app could not make a page to send out of that photograph');
    process.exit(1);
  }
  writeFileSync(sentPath, Buffer.from(out.data, 'base64'));
  console.log(`sent to the recogniser   ${out.w}x${out.h}  ${sentPath}`);
}

// --- what it read --------------------------------------------------------------

const { convert } = await import('../server/src/pipeline.js');
const result = await convert({
  scoreId: 'look',
  filePath: sentPath,
  filename: path.basename(sentPath),
  kind: /\.pdf$/i.test(sentPath) ? 'pdf' : 'image',
  title: 'look',
  report: { log: () => {}, stage: () => {} },
  workDir: path.join(OUT, 'run'),
});
const xml = result.musicXml ?? result.xml ?? readFileSync(result.xmlPath ?? '', 'utf8');
const xmlPath = path.join(OUT, 'read.musicxml');
writeFileSync(xmlPath, xml);
console.log(`read                     ${result.score?.measureCount ?? '?'} bars, `
  + `${result.quality?.notes ?? '?'} notes, rhythm ${result.quality?.rhythmScore ?? '?'}`);

// --- engraved back to paper ------------------------------------------------------

try {
  execFileSync('musicxml2ly', [xmlPath, '-o', path.join(OUT, 'read.ly')], { stdio: 'pipe' });
  execFileSync('lilypond', ['-dresolution=150', '--png', '-o', path.join(OUT, 'read'),
    path.join(OUT, 'read.ly')], { stdio: 'pipe' });
} catch (err) {
  console.error(`could not engrave the reading (${err.message.split('\n')[0]})`);
  console.error('the XML is still at', xmlPath);
  process.exit(1);
}
const pages = ['read.png', 'read-page1.png'].filter((f) => existsSync(path.join(OUT, f)));
console.log(`engraved                 ${pages.map((f) => path.join(OUT, f)).join(', ')}`);
console.log('\nlook at the two together. A number cannot tell you they are the same music.');
