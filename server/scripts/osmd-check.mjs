// Does a REAL MusicXML reader open the file we wrote?
//
// Everything else in this repo verifies our serialiser with our own parser,
// which proves only that the two agree with each other. The deliverable of
// "turn my scan into the XML" is a file someone opens in a notation program, so
// this loads it in OpenSheetMusicDisplay — an independent implementation, in a
// real browser — and renders it. If OSMD throws, the file is not a score.
//
//   node scripts/osmd-check.mjs <file.musicxml> [--shot out.png]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/osmd-check.mjs <file.musicxml> [--shot out.png]'); process.exit(1); }
const shotAt = process.argv.indexOf('--shot');
const shot = shotAt === -1 ? null : process.argv[shotAt + 1];

const OSMD = process.env.OSMD_BUILD
  ?? path.resolve(process.env.HOME, 'music-companion/node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const xml = readFileSync(file, 'utf8');
const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1400 });

const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));

await page.setContent('<div id="osmd"></div>');
await page.addScriptTag({ path: OSMD });

const result = await page.evaluate(async (source) => {
  const display = new window.opensheetmusicdisplay.OpenSheetMusicDisplay('osmd', {
    autoResize: false,
    drawingParameters: 'compacttight',
  });
  try {
    await display.load(source);
    display.render();
    const sheet = display.Sheet;
    return {
      ok: true,
      title: sheet.TitleString,
      parts: sheet.Instruments.length,
      measures: sheet.SourceMeasures.length,
      // What OSMD thinks the piece lasts, in whole notes: an independent read
      // of the same arithmetic our timeline does.
      wholeNotes: sheet.SourceMeasures.reduce((n, m) => n + m.Duration.RealValue, 0),
      staves: sheet.Instruments.map((i) => i.Staves.length),
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}, xml);

if (shot && result.ok) await page.screenshot({ path: shot, fullPage: true });
await browser.close();

console.log(`file      ${path.basename(file)} (${(xml.length / 1024).toFixed(0)}KB)`);
if (!result.ok) {
  console.error(`\nOSMD REFUSED THE FILE: ${result.error}`);
  process.exit(1);
}
console.log(`title     ${result.title}`);
console.log(`parts     ${result.parts} (staves: ${result.staves.join(', ')})`);
console.log(`measures  ${result.measures}`);
console.log(`length    ${(result.wholeNotes * 4).toFixed(2)} quarter notes`);
if (shot) console.log(`shot      ${shot}`);
if (problems.length) {
  console.error(`\nrendered, but the page complained:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nOSMD opened and rendered it.');
