// Does the app get its notes from the pipeline, without anybody uploading
// anything twice?
//
// The whole point of the integration is that a player imports a scan IN THE APP
// and the notation appears there. That is a claim about two processes and a
// browser, so it is checked in a browser, against both of them:
//
//   npm run dev            (the app, on 5199)
//   cd server && npm start (the pipeline, on 4000)
//   npm run score:omr
//
// It imports a real PDF through the app's own file input — nothing is stubbed —
// waits for the reading, and then asks the app's database whether the scan
// ended up with notation paired to it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const APP = arg('app', `http://localhost:${process.env.PORT ?? 5199}`);
const SERVICE = arg('service', 'http://127.0.0.1:4000');
// Concerto page 1: Audiveris reads it whole in under twenty seconds, which is
// what makes this a check somebody will actually run rather than a five-minute
// wait. Override with --pdf for a harder page.
const PDF = arg('pdf', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/cp1.pdf`);
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const engines = await fetch(`${SERVICE}/v1/engines`).then((r) => r.json()).catch(() => null);
const ready = engines?.engines?.filter((e) => e.ok).map((e) => e.id) ?? [];
if (!ready.some((id) => id === 'audiveris' || id === 'oemer')) {
  console.error(`no OMR engine at ${SERVICE} — start it with "npm start" in server/`);
  process.exit(1);
}
readFileSync(PDF);   // fail here, with a path, rather than inside the browser

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });

const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });

await page.goto(APP, { waitUntil: 'networkidle0' });

// Past the welcome, the way a player gets past it. Without this the app is
// behind a modal for the whole run — the hidden file input still works, so the
// check passed while the screenshot showed the front door.
await page.evaluate(() => {
  const start = [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''));
  start?.click();
});
await new Promise((r) => setTimeout(r, 500));

// Into the Score tab.
await page.evaluate(() => document.querySelector('[data-tab="score"]')?.click());
await new Promise((r) => setTimeout(r, 400));

// The import a player does: choose a PDF. The input is hidden — it is opened by
// a button — but choosing a file is the same event either way.
const input = await page.$('#score-pdf');
if (!input) throw new Error('the app has no #score-pdf input');
await input.uploadFile(path.resolve(PDF));

// Then wait for the NOTATION to arrive — asked of the database, not of the
// sentence on screen. Two background jobs narrate into that one line (the
// on-device page reader is measuring the same pages at the same time), so the
// last thing written there is a race, and a check that waits on it is testing
// which one finished second.
const started = Date.now();
let said = '';
let paired = { found: false };
for (;;) {
  paired = await page.evaluate(async () => {
    const { listScores, loadScore } = await import('/src/store/db.js');
    const rows = await listScores();
    const scan = rows.find((r) => r.kind === 'pages');
    if (!scan) return { found: false };
    const notation = scan.notationId != null ? await loadScore(scan.notationId) : null;
    // A stored notation row holds the XML, not the notes — those are parsed
    // when a score is opened. So parse it here, with the app's own parser, and
    // count what a player would actually get: the thing this whole feature is
    // for is that the notes are THERE.
    let notes = 0;
    let parts = 0;
    if (notation?.xml) {
      try {
        const { parseScore } = await import('/src/analysis/musicxml.js');
        const parsed = parseScore(notation.xml, { partIndex: notation.partIndex ?? 0 });
        notes = parsed.notes.length;
        parts = parsed.parts.length;
      } catch (err) {
        return { found: true, name: scan.name, pages: scan.pageCount, hasXml: true, notes: 0, broke: err.message };
      }
    }
    return {
      found: true,
      name: scan.name,
      pages: scan.pageCount,
      notationId: scan.notationId ?? null,
      notes,
      parts,
      hasXml: Boolean(notation?.xml),
    };
  });
  said = await page.$eval('#score-tab-hint', (el) => el.textContent).catch(() => '');
  if (paired.hasXml) break;
  if (/no score pipeline|has no OMR|pipeline could not/i.test(said)) throw new Error(said);
  if (Date.now() - started > 15 * 60 * 1000) throw new Error(`timed out; the app last said: ${said}`);
  await new Promise((r) => setTimeout(r, 2000));
}

// A moment for the notation to be drawn before the picture is taken.
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: arg('shot', 'docs/omr-in-app.png'), fullPage: true });
await browser.close();

console.log(`app said:  ${said}`);
console.log(`scan:      ${paired.name} (${paired.pages} page${paired.pages === 1 ? '' : 's'})`);
console.log(`notation:  ${paired.hasXml ? `paired, ${paired.notes} notes across ${paired.parts} part(s)` : 'NONE'}`);
console.log(`took:      ${Math.round((Date.now() - started) / 1000)}s`);

if (!paired.found) problems.push('the scan was not saved at all');
if (!paired.hasXml) problems.push('the scan has no notation paired to it');
if (paired.broke) problems.push(`the app could not parse what the pipeline returned: ${paired.broke}`);
if (paired.notes === 0) problems.push('the paired notation has no notes the app can play from');
if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nthe app read its own scan.');
