// A TAKE THAT PRACTISES, rather than one that performs.
//
// `scan:guess` measures a run-through: one pass down the page, forwards, once.
// That is not what the microphone hears. A practice recording is a dozen
// partial passes — the awkward system four times, then the two before it to run
// in, then the whole page, then the awkward one again — and against that a
// single climbing map is not slightly wrong, it is the wrong shape entirely.
//
// So this builds a take the way somebody practises, from the noteheads of a
// REAL photographed page, and asks the two questions that matter:
//
//   HOW MANY GOES WERE THERE, and did the app find them? A go it misses is a
//   stretch of the recording that cannot be reached from the page at all.
//
//   PRESS A BAR YOU PLAYED SIX TIMES — does it land in a go that really
//   contains that bar, and how far into it? Landing in the WRONG go is the
//   failure this whole model exists to prevent, and it is counted separately
//   from being a second or two out inside the right one.
//
//   npm run dev            (on 5199)
//   npm run scan:practice -- <page.jpg> [--seed 7]

import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const SOURCE = args.find((a) => !a.startsWith('--') && /\.(jpe?g|png)$/i.test(a));
if (!SOURCE) {
  console.error('usage: npm run scan:practice -- <page.jpg> [--seed 7]');
  process.exit(2);
}
const SEED = flag('seed', 7);
const APP = process.env.APP ?? 'http://localhost:5199';
const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';

const browser = await puppeteer.launch({
  executablePath: SHELL,
  headless: true,
  args: ['--no-sandbox', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(APP, { waitUntil: 'domcontentloaded' });

const report = await page.evaluate(async (data, seed) => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  const { systemsOf, barsInReadingOrder } = await import('/src/analysis/bar-map.js');
  const { placeRuns, goesAt, runsIn, samePassage, compareGoes, sayComparison } = await import('/src/analysis/practice-runs.js');
  const { readableImage, sizeOfImage } = await import('/src/ui/straighten.js');

  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const image = await readableImage(new File([bytes], 'page.jpg', { type: 'image/jpeg' }));
  const { w, h } = sizeOfImage(image);
  const sheet = document.createElement('canvas');
  sheet.width = 1400;
  sheet.height = Math.round(h * (1400 / w));
  sheet.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, sheet.width, sheet.height);
  const read = readPage(sheet, sheet.width, sheet.height);
  if (!read) return { read: false };

  const layout = [read];
  const systems = systemsOf(layout);
  const bars = barsInReadingOrder(layout);

  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const toMidi = (step) => {
    const s = Math.round(step);
    return 48 + Math.floor(s / 7) * 12 + SCALE[((s % 7) + 7) % 7];
  };

  // --- a practice session ----------------------------------------------------
  //
  // The shape of one, rather than a run-through: warm up on the first systems,
  // hammer an awkward one, run in to it from two before, play the lot, and go
  // back to the awkward one once more.
  const hard = Math.min(4, systems.length - 1);
  const plan = [
    [0, 1],                                  // the opening, twice through
    [hard, hard],                            // the awkward system
    [hard, hard],                            // …again
    [hard, hard],                            // …and again
    [Math.max(0, hard - 2), hard],           // run in to it
    [0, systems.length - 1],                 // the whole page
    [hard, hard],                            // and once more at the end
  ];

  const played = [];
  const truth = [];                          // one entry a go: what it covered, when
  let t = 4.0;
  for (const [from, to] of plan) {
    const started = t;
    for (let s = from; s <= to; s += 1) {
      for (const head of systems[s]) {
        if (!Number.isFinite(head?.step)) continue;
        const beat = 0.30 * (1 + (next() - 0.5) * 0.18);
        if (next() < 0.08) { t += beat; continue; }          // a note left out
        const midi = next() < 0.04 ? toMidi(head.step) + 3 : toMidi(head.step);
        played.push({ midi, start: t, end: t + beat * 0.9 });
        t += beat;
      }
    }
    truth.push({ from, to, start: started, end: t });
    t += 2.6 + next() * 2.5;                 // stopping to think
  }

  // --- what the app makes of it ---------------------------------------------
  const cut = runsIn(played);
  const runs = placeRuns(systems, played);
  const placed = runs.filter((one) => one.sure);

  // Did each go land on the music it was actually playing?
  const goErrors = placed.map((run) => {
    // The go whose time overlaps this one the most is the one it is claiming.
    const mine = truth.reduce((best, one) => {
      const over = Math.min(run.to, one.end) - Math.max(run.from, one.start);
      return over > (best?.over ?? -Infinity) ? { ...one, over } : best;
    }, null);
    if (!mine) return null;
    return {
      wantFrom: mine.from, wantTo: mine.to, gotFrom: run.at, gotTo: run.until,
      off: Math.abs(run.at - mine.from),
    };
  }).filter(Boolean);

  // PRESS A BAR OF THE AWKWARD SYSTEM. It was played five times; the useful
  // answer is the last, and the answer that must never happen is a time inside
  // a go that never touched it.
  const hardBars = bars.filter((one) => Math.floor(one.at + 1e-9) === hard);
  const presses = hardBars.map((bar) => {
    const goes = goesAt(runs, bar);
    if (!goes.length) return { bar: bar.index, goes: 0, inside: null, off: null };
    const pick = goes.at(-1);                // the last go, which is what plays
    // Is that moment inside a go that really covered this system?
    const real = truth.find((one) => pick.time >= one.start - 0.5 && pick.time <= one.end + 0.5);
    const inside = !!real && hard >= real.from && hard <= real.to;
    // …and how far out it landed WITHIN that go — measured against this BAR's
    // own place in it, not the system's. A bar two thirds of the way along a
    // system should play two thirds of the way through the stretch of the go
    // that covered it; comparing it with where the system began would call a
    // correct answer wrong by most of a system.
    let off = null;
    if (real) {
      const span = real.to - real.from + 1;
      const through = (bar.at - real.from) / span;
      const when = real.start + Math.max(0, Math.min(1, through)) * (real.end - real.start);
      off = Math.abs(pick.time - when);
    }
    return { bar: bar.index, goes: goes.length, inside, off };
  });

  // THE GOES THAT ARE THE SAME PASSAGE, and how they compared.
  const groups = samePassage(runs.filter((one) => one.sure));
  const passages = groups.map((group) => {
    const comparison = compareGoes(group, played);
    // Which planned goes really covered this group's music, so the count can be
    // checked against what was actually played rather than against itself.
    const truly = truth.filter((one) => {
      const over = Math.min(one.to + 1, group.until) - Math.max(one.from, group.at);
      return over >= (group.until - group.at) * 0.6
        && over >= (one.to + 1 - one.from) * 0.6;
    });
    return {
      at: group.at,
      until: group.until,
      found: group.goes.length,
      truly: truly.length,
      say: sayComparison(comparison),
      evenness: (comparison?.goes ?? []).map((one) => one.stats.evenness),
      cents: (comparison?.goes ?? []).map((one) => one.stats.absMeanCents),
      steadiest: comparison?.steadiest?.number ?? null,
    };
  });

  return {
    read: true,
    passages,
    systems: systems.length,
    hard,
    notes: played.length,
    length: t,
    plannedGoes: plan.length,
    cut: cut.length,
    placed: placed.length,
    refused: runs.filter((one) => !one.sure).map((one) => one.why),
    goErrors,
    presses,
  };
}, readFileSync(SOURCE).toString('base64'), SEED);

await browser.close();

if (!report.read) {
  console.log('the reader found no staves on that page');
  process.exit(1);
}
const s = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}s`);
console.log(`the page            ${report.systems} systems; the awkward one is ${report.hard}`);
console.log(`the session         ${report.plannedGoes} goes, ${report.notes} notes over ${report.length.toFixed(0)}s`);
console.log(`silences found      ${report.cut} stretches of playing  (want ${report.plannedGoes})`);
console.log(`goes placed         ${report.placed} of ${report.cut}`);
for (const why of report.refused.slice(0, 3)) console.log(`  refused  ${why}`);
console.log('');
console.log('WHERE EACH GO SAYS IT WAS');
for (const one of report.goErrors) {
  console.log(`  played systems ${one.wantFrom}-${one.wantTo}`
    + `   said ${one.gotFrom.toFixed(1)}-${one.gotTo.toFixed(1)}`
    + `   start out by ${one.off.toFixed(2)} systems`);
}
console.log('');
console.log(`PRESSING A BAR OF SYSTEM ${report.hard}, which was played five times`);
const withGoes = report.presses.filter((one) => one.goes > 0);
const rightGo = withGoes.filter((one) => one.inside);
console.log(`  bars that offer a go        ${withGoes.length} of ${report.presses.length}`);
console.log(`  goes offered per bar        ${report.presses.map((one) => one.goes).join(', ')}`);
console.log(`  landed in a go that really`);
console.log(`    played that system        ${rightGo.length} of ${withGoes.length}`);
const offs = rightGo.map((one) => one.off).filter((n) => n !== null).sort((a, b) => a - b);
console.log(`  how far into it             median ${s(offs[Math.floor(offs.length / 2)])}`
  + `  worst ${s(offs.at(-1))}`);
console.log('');
console.log('THE SAME PASSAGE, PLAYED AGAIN');
for (const one of report.passages) {
  console.log(`  systems ${one.at.toFixed(1)}-${one.until.toFixed(1)}`
    + `   grouped ${one.found} goes  (really ${one.truly})`);
  console.log(`    ${one.say}`);
  console.log(`    evenness ${one.evenness.map((n) => (n === null ? '—' : n.toFixed(2))).join(' ')}`);
}
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

// …and the grouping has to find the passage that was practised, with the right
// number of goes at it: a group that misses goes makes a comparison about less
// than happened, and one that gathers too many compares things that are not
// the same music.
const grouped = report.passages.some((one) => one.found === one.truly && one.found > 1);
const overGrouped = report.passages.some((one) => one.found > one.truly);
const ok = report.cut === report.plannedGoes
  && report.placed >= report.plannedGoes * 0.6
  && withGoes.length === report.presses.length
  && rightGo.length === withGoes.length
  && grouped && !overGrouped;
console.log(ok ? '\nPASS — every press lands in a go that really played that bar' : '\nFAIL');
process.exit(ok ? 0 : 1);
