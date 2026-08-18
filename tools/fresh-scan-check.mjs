// A page read while somebody is looking at it.
//
// A scan is opened the moment it is taken, which is before anything is known
// about it: the reading pass takes about a second a page and runs behind
// whatever is on screen. Both views that draw a scan say so — "these pages have
// not been read yet" — and nothing told them when it WAS read, so the sentence
// stayed until the score was closed and opened again.
//
// A user reported exactly that: "when I scan something, I'll look at the page
// for a moment and then it says page not read so I have to reopen the score."
//
// This check is about the SEQUENCE, which is why nothing else could catch it:
// every other tool in this repo measures the pages first and renders afterwards,
// so the state being tested here never occurs in them. Here the review is drawn
// FIRST, against a part with no layout at all, and then the reading pass is
// started underneath it — and the rings have to appear on their own.
//
//   npm run dev                (in another terminal, on port 5199)
//   npm run score:fresh
//
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const list = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const chosen = list[Number(process.env.PHOTO ?? 0)];
const bytes = (await readFile(chosen.file)).toString('base64');

const seen = await page.evaluate(async ({ b64, name }) => {
  const { savePagesScore, loadScorePages } = await import('/src/store/db.js');
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const scoreId = await savePagesScore({ name, source: 'pdf', pageCount: 1, data });
  const S = await import('/src/ui/score.js');
  const { headsOf } = await import('/src/ui/scan-view.js');
  S.clearSheet?.();
  await S.selectScore(scoreId);

  // A take, made without measuring the pages first — which is the whole point.
  // It is built from the notes the page WILL turn out to hold, read once here
  // and then thrown away, so that the review has something real to place when
  // the reading finally arrives.
  const before = await loadScorePages(scoreId);
  const unread = (before?.layout ?? []).filter(Boolean).length;

  // What the page holds, worked out on a copy so the score itself is left
  // unmeasured: the take has to be of THIS music or the pairing will refuse it
  // for the right reason and the check would prove nothing.
  const { readPages } = await import('/src/ui/paper.js');
  const peek = await readPages(before);
  const heads = headsOf(peek.layout);
  const from = Math.floor(heads.length / 3);
  const run = heads.slice(from, from + 24).filter((h) => Number.isFinite(h.midi));
  const notes = run.map((h, i) => ({
    midi: h.midi, name: null, cents: ((i * 31) % 41) - 20,
    start: 0.6 + i * 0.5, end: 0.6 + i * 0.5 + 0.38,
  }));
  const { synthRecording } = await import('/src/fixtures/take-fixture.js');
  const rec = synthRecording(notes);
  const { renderFreeReview } = await import('/src/ui/report.js');
  renderFreeReview(document, notes, rec, { readings: [], a4: 440 });
  await S.annotateTake(notes, { readings: [], a4: 440 });

  // On the Score tab, as a player is: the review redraws itself where somebody
  // is looking at it, and marks itself stale where nobody is.
  document.querySelector('.tab-btn[data-tab="score"]')?.click();
  await new Promise((r) => setTimeout(r, 200));

  // THE REVIEW, DRAWN BEFORE THE PAGES ARE READ. `READ_WAIT` inside
  // renderScoreTab races the pass for a moment; nothing is running, so it comes
  // back with whatever the part knows, which is nothing.
  await S.renderScoreTab();
  await new Promise((r) => setTimeout(r, 400));
  const first = {
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    text: (document.querySelector('#score-stage')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };

  // …and now the pass, underneath it. Nothing here re-renders anything: if the
  // rings appear, they appeared because the view was told.
  await S.measurePages(scoreId);
  await new Promise((r) => setTimeout(r, 1200));
  const after = {
    rings: document.querySelectorAll('#score-stage .scan-note').length,
    quiet: document.querySelectorAll('#score-stage .scan-quiet').length,
    text: (document.querySelector('#score-stage')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    read: ((await loadScorePages(scoreId))?.layout ?? []).filter(Boolean).length,
  };
  return { unread, played: notes.length, first, after };
}, { b64: bytes, name: `${chosen.name} fresh scan` });

console.log(`      before: ${seen.first.rings} rings — "${seen.first.text.slice(0, 90)}"`);
console.log(`      after:  ${seen.after.rings} rings, ${seen.after.quiet} silent markers,`
  + ` ${seen.after.read} page(s) read`);

check('a scan with no layout yet draws no rings and says why',
  seen.unread === 0 && seen.first.rings === 0 && /not been read/i.test(seen.first.text),
  `${seen.first.rings} rings, "${seen.first.text.slice(0, 70)}"`);
check('and the rings appear WITHOUT the score being closed and reopened',
  seen.after.rings > 0,
  `${seen.after.rings} rings for ${seen.played} notes played`);
check('…and the sentence about unread pages is gone with them',
  !/not been read/i.test(seen.after.text), seen.after.text.slice(0, 90));
check('no errors on the page', errors.length === 0, errors[0] ?? '');

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
