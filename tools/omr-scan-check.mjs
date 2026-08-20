// Does a SCANNED score — photographed pages, not a chosen PDF — get its notes
// from the recogniser?
//
// omr-app-check.mjs and omr-hosted-check.mjs both go in through #score-pdf,
// which is the file button. The camera is a different door: the scanner
// squares its own pages and calls
//
//   addPaper(pages, { name, raws, straightened: true })
//
// with several large JPEGs. Different payload, different size, different flag.
// The last time a fix was verified through the convenient door instead of the
// one the player uses, it cost four rounds — so this calls what the scanner
// calls, with real photographs of real pages.
//
// It never opens the camera: the photographs come in as Files, exactly as the
// scanner hands them over once the shutter has already happened.
//
//   npm run dev                      # the app on 5199
//   node tools/omr-scan-check.mjs    # against the hosted recogniser
//
import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

const APP = arg('app', 'http://localhost:5199');
const SERVICE = arg('service', 'https://score-pipeline.fly.dev');
const WAIT_MS = Number(arg('wait', 300)) * 1000;
const PHOTOS = (arg('photos', `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/shot-1.jpg,`
  + `${process.env.HOME}/.claude/jobs/6a5cd90a/tmp/shot-2.jpg`)).split(',');
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const pages = PHOTOS.map((p) => ({
  name: path.basename(p),
  base64: readFileSync(p).toString('base64'),
}));

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });

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

await page.goto(APP, { waitUntil: 'networkidle0' });
await page.evaluate((service) => localStorage.setItem('omr-service-url', service), SERVICE);
await page.reload({ waitUntil: 'networkidle0' });

await page.evaluate(() => {
  [...document.querySelectorAll('button')]
    .find((b) => /start playing/i.test(b.textContent ?? ''))?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => document.querySelector('[data-tab="score"]')?.click());
await new Promise((r) => setTimeout(r, 400));

// The scanner's own call, with the scanner's own arguments.
await page.evaluate(async (photos) => {
  const files = photos.map((p) => {
    const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
    return new File([bytes], p.name, { type: 'image/jpeg' });
  });
  const { addPaper } = await import('/src/ui/score.js');
  await addPaper(files, { name: 'Scanned score', straightened: true });
}, pages);

const readDb = () => page.evaluate(async () => {
  const { listScores, loadScore } = await import('/src/store/db.js');
  const rows = await listScores();
  const scan = rows.find((r) => r.kind === 'pages');
  if (!scan) return { found: false };
  const notation = scan.notationId != null ? await loadScore(scan.notationId) : null;
  let notes = 0;
  if (notation?.xml) {
    const { parseScore } = await import('/src/analysis/musicxml.js');
    try { notes = parseScore(notation.xml, { partIndex: notation.partIndex ?? 0 }).notes.length; } catch { notes = -1; }
  }
  return {
    found: true, name: scan.name, pages: scan.pageCount ?? null,
    notationId: scan.notationId ?? null, notes,
    bars: notation?.xml ? (notation.xml.match(/<measure[ >]/g) ?? []).length : 0,
  };
});

const started = Date.now();
let state = {};
while (Date.now() - started < WAIT_MS) {
  state = await readDb();
  if (state.notes > 0) break;
  await new Promise((r) => setTimeout(r, 3000));
}

console.log(`app      ${APP}`);
console.log(`service  ${SERVICE}`);
console.log(`photos   ${PHOTOS.map((p) => path.basename(p)).join(', ')}`);
console.log(`scan     ${state.found ? `${state.name} (${state.pages} page(s))` : 'NOT IMPORTED'}`);
console.log(`notation ${state.notationId ?? 'none'} — ${state.bars} bars, ${state.notes} notes`);
console.log(`took     ${Math.round((Date.now() - started) / 1000)}s`);
for (const c of calls.slice(0, 6)) console.log(`  ${c.status ?? 'pending'}  ${c.method} ${c.url.replace(SERVICE, '')}`);
console.log(`  (${calls.length} calls to the service in all)`);

await browser.close();
const ok = state.notes > 0;
console.log(ok ? '\nPASS — a photographed score came back with notes'
               : '\nFAIL — the scan path produced no notes');
process.exit(ok ? 0 : 1);
