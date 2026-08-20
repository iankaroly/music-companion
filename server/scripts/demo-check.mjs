// Drives the demo page in a headless browser: upload, convert, align, cursor.
//
// The demo client is the only code here that is not covered by `npm test` — it
// runs in a browser, not in node. This walks it once so a change that breaks it
// is caught, and leaves a screenshot behind to look at.
//
//   node scripts/demo-check.mjs [--port 4412] [--shot demo.png]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const port = Number(arg('port', 4412));
const shot = arg('shot', path.resolve(HERE, '../demo.png'));

// chrome-headless-shell, not the Chrome app: the app bounces in the Dock.
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1400, deviceScaleFactor: 2 });

const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });

// 1 · upload
await (await page.$('#file')).uploadFile(path.resolve(HERE, '../fixtures/two-bar-tune.musicxml'));
await page.click('#upload');
await page.waitForSelector('#scoreBox:not([hidden])', { timeout: 60000 });
const summary = await page.$eval('#scoreInfo', (el) => el.textContent.replace(/\s+/g, ' ').trim());

// 2 · align at a fixed tempo
await page.click('#constant');
await page.waitForSelector('#playBox:not([hidden])', { timeout: 20000 });
const bars = await page.$$eval('#bars tbody tr', (rows) => rows.length);

// 3 · move the cursor and check it lands somewhere real
await page.$eval('#scrub', (el) => { el.value = '6'; el.dispatchEvent(new Event('input')); });
await new Promise((r) => setTimeout(r, 600));
const where = await page.$eval('#where', (el) => el.textContent);

await page.screenshot({ path: shot, fullPage: true });
await browser.close();

console.log(`score:  ${summary}`);
console.log(`bars:   ${bars}`);
console.log(`cursor: ${where}`);
console.log(`shot:   ${shot}`);

if (bars === 0) problems.push('the measure table came back empty');
// At 90 quarter-bpm, six seconds in is quarter 9 — which in this fixture is
// the SECOND playing of bar 1. Asserting the pass is what catches a cursor
// that is merely plausible rather than right.
if (!/bar 1 .* pass 2/.test(where)) problems.push(`the cursor did not land on bar 1 pass 2: "${where}"`);
if (problems.length) {
  console.error(`\nFAILED:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\ndemo ok');
