// The whole promise, end to end: upload a scan, record against it, open the
// score and find your playing on the page.
//
// Audio cannot be recorded in a headless browser, so the take is synthesised —
// but everything either side of it is the real thing: the real import, the real
// page reader, the real score picker, the real annotate-and-open path.
//
//   npm run dev -- --port 5177         (in another terminal)
//   node tools/score-flow-check.mjs ~/Downloads/part.pdf
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
if (!PDF) {
  console.error('usage: node tools/score-flow-check.mjs <part.pdf>');
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1180, height: 1400, deviceScaleFactor: 2 });
const problems = [];
page.on('pageerror', (e) => problems.push(`threw: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle2' });
await page.evaluate(() => document.querySelector('#welcome')?.setAttribute('hidden', ''));

// --- 1. upload the scan, through the app's own file input --------------------
// A PDF goes in through #score-pdf (addPaper). #score-file is the MusicXML
// door, and it will not take a scan.
const input = await page.$('#score-pdf');
await input.uploadFile(PDF);

// The import asks for a name in a <dialog>; answer it the way a finger would.
await page.waitForSelector('#score-name-dialog[open]', { timeout: 15000 }).catch(() => {});
if (await page.$('#score-name-dialog[open]')) {
  await page.type('#score-name-input', 'Flow check');
  await page.click('#score-name-dialog button[value="save"]');
}

// Reading a page is seconds of arithmetic and deliberately stands aside for the
// reader, so wait for the layout to be written rather than for a fixed time.
await new Promise((r) => setTimeout(r, 1500));
console.log('status after import:', await page.evaluate(
  () => document.querySelector('#score-status')?.textContent ?? '(none)'));
console.log('scores in the database:', await page.evaluate(async () => {
  const { listScores } = await import("/src/store/db.js");
  return (await listScores()).map((s) => `${s.id}:${s.name}:${s.source ?? '?'}`);
}));

const read = await page.waitForFunction(async () => {
  const { listScores } = await import("/src/store/db.js");
  const scores = await listScores();
  const one = scores.at(-1);
  if (!one) return false;
  const { loadScorePages } = await import('/src/store/db.js');
  const payload = await loadScorePages(one.id);
  const layout = payload?.layout?.filter(Boolean) ?? [];
  if (!layout.length) return false;
  const heads = layout.reduce((n, p) => n
    + p.staves.reduce((m, s) => m + s.heads.length, 0), 0);
  return { id: one.id, name: one.name, pages: payload.layout.length, staves: layout[0].staves.length, heads };
}, { timeout: 120000, polling: 1000 }).then((h) => h.jsonValue());

console.log('imported:', JSON.stringify(read));

// --- 2. it is on the shelf, which is where a piece is chosen ------------------
//
// This read `#score-pick`, the Record tab's "playing from" row. That row is
// gone — a piece is opened from the Score tab's shelf now, and recording
// happens on the music itself — so what is asked is whether the part arrived
// somewhere a player can reach it.
const shelf = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#score-list .lib-name')].map((n) => n.textContent),
  picker: !!document.querySelector('#score-pick'),
}));
console.log('score shelf:', JSON.stringify(shelf));

// --- 3. select it, and play something at it ----------------------------------
const marked = await page.evaluate(async (scoreId) => {
  const { selectScore, annotateTake, currentScoreId } = await import('/src/ui/score.js');
  await selectScore(scoreId);
  if (String(currentScoreId()) !== String(scoreId)) return { failed: 'the score did not stay selected' };

  // A synthetic take: forty notes, in tune and out, at a steady clip.
  const a4 = 440;
  const notes = [];
  const readings = [];
  for (let i = 0; i < 40; i++) {
    const midi = 43 + (i % 12);
    const cents = [0, 14, -20, 3, -35][i % 5];
    const start = i * 0.35;
    const end = start + 0.3;
    const frequency = a4 * 2 ** ((midi - 69) / 12) * 2 ** (cents / 1200);
    notes.push({ midi, name: '', start, end, cents, frequency });
    for (let t = start; t < end; t += 0.0116) {
      readings.push({ time: t, frequency, confidence: 0.95, rms: 0.1 });
    }
  }
  const out = await annotateTake(notes, { readings, a4, recordingId: null });
  return {
    annotated: out,
    status: document.querySelector('#score-status')?.textContent ?? null,
    scanReview: !document.querySelector('#score-scan-review')?.hidden,
    notes: notes.length,
  };
}, read.id);
console.log('after playing:', JSON.stringify(marked));

// --- 4. open the score and look for the marks --------------------------------
await page.evaluate(() => document.querySelector('[data-tab="score"]')?.click());
await new Promise((r) => setTimeout(r, 1500));

const opened = await page.evaluate(async () => {
  const openers = [...document.querySelectorAll('button, .score-row, [role="button"]')]
    .filter((b) => /open|read|flow check/i.test(b.textContent ?? ''));
  openers[0]?.click();
  return openers.map((b) => b.textContent.trim()).slice(0, 6);
});
console.log('openers offered:', JSON.stringify(opened));
await new Promise((r) => setTimeout(r, 4000));

const onPage = await page.evaluate(() => {
  const reader = document.querySelector('#reader');
  const canvases = [...document.querySelectorAll('#reader canvas, .osmd-page canvas')];
  return {
    readerOpen: !!reader && !reader.hidden,
    canvases: canvases.length,
    painted: canvases.map((c) => `${c.width}×${c.height}`),
  };
});
console.log('reader:', JSON.stringify(onPage));

await page.screenshot({ path: join(OUT, 'score-flow.png'), fullPage: false });
console.log(`drawn: ${join(OUT, 'score-flow.png')}`);
if (problems.length) console.log('PROBLEMS:\n  ' + problems.slice(0, 10).join('\n  '));
await browser.close();
