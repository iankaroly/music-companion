// Does the DEPLOYED app get its notes from the HOSTED recogniser?
//
// omr-app-check.mjs asks the same question of the dev server, and cannot be
// pointed at production: it reaches into /src/store/db.js, which exists while
// vite is serving files and not in a built bundle. So this one touches nothing
// private — it drives the app's own file input, watches the network, and reads
// IndexedDB the way any page could.
//
//   node tools/omr-hosted-check.mjs [--app https://…] [--pdf …]
//
// It never opens the camera. A scan and a chosen PDF arrive at the same
// function; only one of them turns on a webcam to do it.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const APP = arg('app', 'https://practicepartner.vercel.app');
const SERVICE = arg('service', 'https://score-pipeline.fly.dev');
const PDF = arg('pdf', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/cp1.pdf`);
const WAIT_MS = Number(arg('wait', 240)) * 1000;
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

readFileSync(PDF);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });

// What the app asks of the service, and what it is told. A page that is refused
// by CORS never gets a response here — it gets a failure, which is the shape of
// the bug this check exists for.
const calls = [];
page.on('request', (r) => { if (r.url().startsWith(SERVICE)) calls.push({ url: r.url(), method: r.method() }); });
page.on('response', (r) => {
  if (!r.url().startsWith(SERVICE)) return;
  const call = calls.find((c) => c.url === r.url() && c.status === undefined);
  if (call) call.status = r.status();
});
page.on('requestfailed', (r) => {
  if (!r.url().startsWith(SERVICE)) return;
  const call = calls.find((c) => c.url === r.url() && c.status === undefined);
  if (call) call.status = `FAILED ${r.failure()?.errorText ?? ''}`;
});
const problems = [];
page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));

await page.goto(APP, { waitUntil: 'networkidle0' });

await page.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => document.querySelector('[data-tab="score"]')?.click());
await new Promise((r) => setTimeout(r, 400));

const input = await page.$('#score-pdf');
if (!input) throw new Error('the app has no #score-pdf input');
await input.uploadFile(path.resolve(PDF));

// Raw IndexedDB, no app modules: a scan row (kind 'pages') that has grown a
// notationId, and the notation row it points at.
const readDb = () => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('music-companion');
  req.onerror = () => resolve({ error: 'could not open the database' });
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('scores')) return resolve({ error: 'no scores store' });
    const all = db.transaction('scores', 'readonly').objectStore('scores').getAll();
    all.onsuccess = () => {
      const rows = all.result ?? [];
      const scan = rows.find((r) => r.kind === 'pages');
      if (!scan) return resolve({ found: false, rows: rows.length });
      const notation = scan.notationId != null ? rows.find((r) => r.id === scan.notationId) : null;
      resolve({
        found: true,
        name: scan.name,
        pages: scan.pageCount ?? null,
        notationId: scan.notationId ?? null,
        xmlChars: notation?.xml ? notation.xml.length : 0,
        // Counting bars in the XML is enough to say notes came back; the app's
        // own parser turns it into notes when a score is opened.
        bars: notation?.xml ? (notation.xml.match(/<measure[ >]/g) ?? []).length : 0,
      });
    };
    all.onerror = () => resolve({ error: 'could not read scores' });
  };
}));

const started = Date.now();
let state = {};
while (Date.now() - started < WAIT_MS) {
  state = await readDb();
  if (state.bars > 0) break;
  await new Promise((r) => setTimeout(r, 3000));
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`app      ${APP}`);
console.log(`service  ${SERVICE}`);
console.log(`scan     ${state.found ? `${state.name} (${state.pages} page(s))` : 'NOT IMPORTED'}`);
console.log(`notation ${state.notationId ?? 'none'} — ${state.bars} bars, ${state.xmlChars} chars of MusicXML`);
console.log(`took     ${seconds}s`);
console.log('calls to the service:');
for (const c of calls.slice(0, 12)) console.log(`  ${c.status ?? 'pending'}  ${c.method} ${c.url.replace(SERVICE, '')}`);
if (calls.length > 12) console.log(`  …and ${calls.length - 12} more`);
for (const p of problems.slice(0, 5)) console.log(`  ! ${p}`);

await browser.close();
const ok = state.bars > 0 && calls.some((c) => c.status === 201 || c.status === 200);
console.log(ok ? '\nPASS — the deployed app read a page through the hosted recogniser'
               : '\nFAIL — no notation came back');
process.exit(ok ? 0 : 1);
