// CAN THE APP FIND THE BARS IN THE TAKE BY ITSELF?
//
// Stage 1 was two taps and a straight line between them. This measures the
// thing that replaces the taps: every system of the page slid along the take by
// SHAPE alone — the direction of each interval and whether it is a step or a
// leap — with no clef, no key and no note ever named. A clef moves every note
// by the same amount and changes no direction, which is why this survives the
// misreading that put a whole system a thirteenth out.
//
// WHAT IS MEASURED, and it is the number a player would feel: click a bar, and
// how many seconds out is the audio? Not "was the system placed" — a placement
// that is right to the note and a placement that is right to the bar are the
// same thing to somebody pressing a bar and listening.
//
// THE TAKE IS SYNTHESISED, because the truth has to be known. It is built from
// the noteheads the reader found on a REAL photographed page, played at a tempo
// that MOVES — nobody practises at a metronome — and then spoiled the way
// playing is spoiled: notes left out, notes played wrong, notes added. The
// steps are turned into semitones through a major scale so that a written third
// is four semitones and the two vocabularies line up the way they do in real
// playing; nothing in the code under test ever sees the mapping.
//
//   npm run dev            (on 5199)
//   npm run scan:guess -- <page.jpg> [--drop 0.1] [--wrong 0.05] [--seed 7]

import { readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
// `flag` reads a NUMBER — the ones above it are all numbers. A path is not.
const words = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const SOURCE = args.find((a) => !a.startsWith('--') && /\.(jpe?g|png)$/i.test(a));
if (!SOURCE) {
  console.error('usage: npm run scan:guess -- <page.jpg> [--drop 0.1] [--wrong 0.05]');
  process.exit(2);
}
const DROP = flag('drop', 0.1);
const WRONG = flag('wrong', 0.05);
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

const report = await page.evaluate(async (data, drop, wrong, seed) => {
  const { readPage } = await import('/src/analysis/scan-read.js');
  const { systemsOf, barsInReadingOrder, guessedAnchors, timeOfBar,
    headsInReadingOrder } = await import('/src/analysis/bar-map.js');
  const { placeSystems } = await import('/src/analysis/scan-align.js');
  const { alignTake, anchorsFromPath } = await import('/src/analysis/take-align.js');
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

  // --- the take, built from the page and then spoiled ------------------------
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  // A written step through a major scale, so a third on the page is four
  // semitones in the take — the boundary both vocabularies bucket at.
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const toMidi = (step) => {
    const s = Math.round(step);
    return 48 + Math.floor(s / 7) * 12 + SCALE[((s % 7) + 7) % 7];
  };

  const played = [];
  const trueTimeOfSystem = [];
  let t = 3.2;                       // a few seconds of shuffling before the first note
  systems.forEach((heads, s) => {
    trueTimeOfSystem[s] = null;
    heads.forEach((head) => {
      if (!Number.isFinite(head?.step)) return;
      // A tempo that MOVES: slower at the start of each system, and a broad
      // drift across the page, which is what makes a straight line between two
      // anchors wrong in the middle.
      const through = s / Math.max(1, systems.length - 1);
      const beat = 0.30 * (1 + 0.35 * Math.sin(through * Math.PI)) * (1 + (next() - 0.5) * 0.12);
      if (next() < drop) { t += beat; return; }     // a note left out: time still passes
      const midi = next() < wrong
        ? toMidi(head.step) + (next() < 0.5 ? -2 : 3)   // a wrong note
        : toMidi(head.step);
      if (trueTimeOfSystem[s] === null) trueTimeOfSystem[s] = t;
      played.push({ midi, start: t, end: t + beat * 0.9 });
      t += beat;
    });
  });

  // Where each system TRULY begins in the take, as an index — the truth the
  // placement's own index should match.
  const trueIndexOfSystem = [];
  systems.forEach((heads, s) => {
    const want = trueTimeOfSystem[s];
    trueIndexOfSystem[s] = want === null ? null : played.findIndex((n) => n.start >= want - 1e-9);
  });
  let headsBefore = [];
  let run = 0;
  systems.forEach((heads, i) => { headsBefore[i] = run; run += heads.length; });

  // --- what the app makes of it ---------------------------------------------
  const placements = placeSystems(systems, played);
  const bySystem = guessedAnchors(placements);

  // …AND THE SAME QUESTION OF THE NOTE-BY-NOTE PATH, which is the other way of
  // getting anchors: one a BAR instead of one a system at best. Both maps are
  // scored on the same presses so the two are comparable to the tenth of a
  // second, which is the only way to know whether it is worth having.
  const pageHeads = headsInReadingOrder(layout);
  const began = performance.now();
  const path = alignTake(pageHeads, played);
  const tookMs = Math.round(performance.now() - began);
  const byPath = path.placed ? anchorsFromPath(path.pairs, bars, pageHeads) : [];
  const anchors = byPath.length >= 2 ? byPath : bySystem;

  // THE NUMBER THAT MATTERS: press a bar, and how far out is the audio? Asked
  // of the START of every system, where the truth is known.
  const errorsBySystem = [];
  for (const bar of bars.filter((one) => one.inSystem === 0)) {
    const s = Math.floor(bar.at + 1e-9);
    const want = trueTimeOfSystem[s];
    if (want === null || want === undefined) continue;
    const got = timeOfBar(anchors, bar);
    errorsBySystem.push({ system: s, want, got, off: got === null ? null : Math.abs(got - want) });
  }
  // The same presses against the map the system-matcher alone would have made,
  // so the two routes are comparable on identical questions.
  const oldWay = [];
  for (const bar of bars.filter((one) => one.inSystem === 0)) {
    const sy = Math.floor(bar.at + 1e-9);
    const want = trueTimeOfSystem[sy];
    if (want === null || want === undefined) continue;
    const got = timeOfBar(bySystem, bar);
    if (got !== null) oldWay.push(Math.abs(got - want));
  }
  oldWay.sort((a, b) => a - b);

  const answered = errorsBySystem.filter((one) => one.off !== null);
  const offs = answered.map((one) => one.off).sort((a, b) => a - b);
  const median = offs.length ? offs[Math.floor(offs.length / 2)] : null;

  // TWO DIFFERENT FAILURES, kept apart, because they need different answers.
  //
  // A system BETWEEN two anchors is interpolated: the map is doing the job it
  // was built for, and how close it lands is what this feature is worth. A
  // system beyond the outermost anchor is EXTRAPOLATED — the end pair's pace
  // carried on into music nothing has been said about — and how far that drifts
  // is not a wrong placement but a missing one. Averaging the two hides which
  // is which, and they are fixed by opposite things: the first by a better
  // match, the second by one more tap.
  const span = anchors.length
    ? { from: Math.min(...anchors.map((a) => a.at)), to: Math.max(...anchors.map((a) => a.at)) }
    : null;
  const inside = span
    ? answered.filter((one) => one.system >= span.from && one.system <= span.to) : [];
  const outside = span
    ? answered.filter((one) => one.system < span.from || one.system > span.to) : answered;
  const sorted = (list) => list.map((one) => one.off).sort((a, b) => a - b);
  const mid = (list) => (list.length ? sorted(list)[Math.floor(list.length / 2)] : null);

  // …and whether a placement was RIGHT, which is the thing that must never go
  // wrong: an anchor in the wrong place drags the stretches either side of it.
  //
  // MEASURED IN NOTES AS WELL AS IN SECONDS, because seconds are the wrong unit
  // for the question. "Is this anchor in the wrong place" means "is it on the
  // wrong music", and four notes early on a slow passage is nearly three
  // seconds while being nowhere near another system. The invariant is that no
  // anchor lands on music it did not come from — half a system's worth is the
  // bar — and the seconds are reported beside it because that is what a player
  // hears.
  const placedWrong = placements
    .filter((one) => one.sure && Number.isFinite(one.time))
    .map((one) => {
      const want = trueTimeOfSystem[one.system];
      return want === null || want === undefined ? null : Math.abs(one.time - want);
    })
    .filter((n) => n !== null);
  const notesOut = placements
    .filter((one) => one.sure && one.at >= 0)
    .map((one) => {
      const want = trueIndexOfSystem[one.system];
      return want === null || want === undefined ? null : Math.abs(one.at - want);
    })
    .filter((n) => n !== null);
  const perSystem = systems.length
    ? systems.reduce((n, one) => n + one.length, 0) / systems.length : 20;

  // …and the same question with only the two taps stage 1 asks for: the first
  // system and the last, which is the map this replaces.
  const twoTaps = [
    { at: 0, time: trueTimeOfSystem[0] ?? 0 },
    {
      at: systems.length - 1,
      time: trueTimeOfSystem[systems.length - 1] ?? t,
    },
  ];
  const tapOffs = errorsBySystem
    .map((one) => {
      const got = timeOfBar(twoTaps, { at: one.system });
      return got === null ? null : Math.abs(got - one.want);
    })
    .filter((n) => n !== null)
    .sort((a, b) => a - b);

  return {
    read: true,
    path: {
      placed: path.placed, why: path.why, matched: path.matched ?? 0,
      share: path.share ?? 0, anchors: byPath.length, using: byPath.length >= 2 ? 'path' : 'systems',
      ms: tookMs, heads: pageHeads.length, notes: played.length,
    },
    oldWay: {
      median: oldWay.length ? oldWay[Math.floor(oldWay.length / 2)] : null,
      worst: oldWay.length ? oldWay[oldWay.length - 1] : null,
      answered: oldWay.length,
    },
    // …AND THE SAME THING IN THE SHAPE THE APP EXPORTS, so `scan:real` can be
    // exercised without a phone. The marks here are the TRUTH rather than
    // somebody's ear, which makes this a test of the plumbing and not of the
    // map — a real fixture comes off a real take and its marks are the
    // measurement. See the header of tools/real-take-check.mjs.
    fixture: {
      what: 'practice-partner bar-map fixture',
      made: new Date(0).toISOString(),
      take: { name: 'synthesised', seconds: t, notes: played },
      score: { name: 'synthesised', layout },
      marks: systems.map((_, sy) => (trueTimeOfSystem[sy] === null
        || trueTimeOfSystem[sy] === undefined
        ? null : { at: sy, time: trueTimeOfSystem[sy] })).filter(Boolean),
    },
    systems: systems.length,
    heads: systems.reduce((n, one) => n + one.length, 0),
    notes: played.length,
    length: t,
    placed: placements.filter((one) => one.sure).length,
    refused: placements.filter((one) => !one.sure).map((one) => `${one.system}: ${one.why}`),
    detail: placements.map((one) => {
      const seen = errorsBySystem.find((e) => e.system === one.system);
      return {
        system: one.system, score: one.score, margin: one.margin, sure: one.sure,
        want: seen?.want ?? null, got: seen?.got ?? null, off: seen?.off ?? null,
        placedAt: one.time, index: one.at, trueIndex: trueIndexOfSystem[one.system],
        before: headsBefore[one.system],
        // WHAT A REFUSAL THREW AWAY. A system that fails the gate still has a
        // best guess (see bestAt in scan-align.js), and whether that guess was
        // any good is the only thing that says whether the gate is set right.
        bestAt: one.bestAt ?? null,
        bestOff: (one.bestTime === null || one.bestTime === undefined
          || seen?.want === null || seen?.want === undefined)
          ? null : Math.abs(one.bestTime - seen.want),
      };
    }),
    answered: answered.length,
    of: errorsBySystem.length,
    median,
    worst: offs.length ? offs.at(-1) : null,
    inside: { of: inside.length, median: mid(inside), worst: inside.length ? sorted(inside).at(-1) : null },
    outside: { of: outside.length, median: mid(outside), worst: outside.length ? sorted(outside).at(-1) : null },
    anchorWorst: placedWrong.length ? Math.max(...placedWrong) : null,
    anchorNotes: notesOut.length ? Math.max(...notesOut) : null,
    perSystem,
    tapMedian: tapOffs.length ? tapOffs[Math.floor(tapOffs.length / 2)] : null,
    tapWorst: tapOffs.length ? tapOffs.at(-1) : null,
  };
}, readFileSync(SOURCE).toString('base64'), DROP, WRONG, SEED);

await browser.close();

if (!report.read) {
  console.log('the reader found no staves on that page');
  process.exit(1);
}
const s = (n) => (n === null ? '—' : `${n.toFixed(2)}s`);
console.log(`the page          ${report.systems} systems, ${report.heads} noteheads read`);
console.log(`the take          ${report.notes} notes over ${report.length.toFixed(0)}s`
  + `, ${Math.round(DROP * 100)}% left out, ${Math.round(WRONG * 100)}% played wrong`);
console.log(`systems placed    ${report.placed} of ${report.systems}`);
for (const one of report.detail) {
  const off = one.off === null ? '  —  ' : `${one.off.toFixed(2)}s`;
  const said = one.placedAt === null ? '   —  ' : `${one.placedAt.toFixed(1)}s`;
  console.log(`  system ${String(one.system).padStart(2)}  score ${one.score.toFixed(2)}`
    + `  margin ${one.margin.toFixed(2)}  ${one.sure ? 'placed' : 'refused'}`
    + `  said ${said}  truly ${one.want === null ? '  —  ' : `${one.want.toFixed(1)}s`}`
    + `  out by ${off}`
    + `   | heads before ${String(one.before).padStart(3)}`
    + `  index said ${String(one.index).padStart(3)}  truly ${String(one.trueIndex).padStart(3)}`
    + (one.sure ? '' : `  | ITS GUESS was ${one.bestOff === null ? '—' : `${one.bestOff.toFixed(2)}s out`}`
      + ` (index ${one.bestAt})`));
}
const FIXTURE = words('fixture', null);
if (FIXTURE && report.fixture) {
  writeFileSync(FIXTURE, JSON.stringify(report.fixture));
  console.log(`fixture written: ${FIXTURE} (marks are the TRUTH, not an ear —`
    + ' it exercises scan:real, it does not measure the map)');
}
console.log('');
const pathSaid = report.path?.placed
  ? `placed, ${report.path.matched} notes matched (${Math.round(report.path.share * 100)}% of the take)`
    + `, ${report.path.anchors} anchors`
  : `refused — ${report.path?.why}`;
console.log(`the note-by-note path   ${pathSaid}   [the map in use: ${report.path?.using}]`);
console.log(`  ${report.path?.heads} noteheads x ${report.path?.notes} notes, found in ${report.path?.ms}ms`);
console.log(`  one anchor a system   median ${report.oldWay?.median === null ? '—' : `${report.oldWay.median.toFixed(2)}s`}`
  + `   worst ${report.oldWay?.worst === null ? '—' : `${report.oldWay.worst.toFixed(2)}s`}`);
console.log('');
console.log('PRESS A BAR — how far out is the audio?');
console.log(`  between the anchors   ${report.inside.of} systems`
  + `   median ${s(report.inside.median)}   worst ${s(report.inside.worst)}`);
console.log(`  past the last one     ${report.outside.of} systems`
  + `   median ${s(report.outside.median)}   worst ${s(report.outside.worst)}`);
console.log(`  every system          median ${s(report.median)}   worst ${s(report.worst)}`);
console.log(`  from two taps         median ${s(report.tapMedian)}   worst ${s(report.tapWorst)}`);
console.log(`\nthe worst ANCHOR itself   ${s(report.anchorWorst)}`
  + `  — ${report.anchorNotes ?? '—'} notes of a ${Math.round(report.perSystem)}-note system`
  + '  (a wrong one drags both sides)');
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);

// It has to place most of the page, and it has to beat the two taps it is
// replacing — a guess that is worse than the straight line is not worth having.
// What this has to be true of, and it is not "beats two taps everywhere".
//
//   no anchor may be WRONG — one in the wrong place is worse than none, because
//   the map is straight lines drawn through them;
//   between the anchors it must beat the straight line it replaces;
//   and it must cover enough of the page to be worth having.
//
// Past the last anchor it extrapolates and drifts, and the answer to that is
// one more tap, not a cleverer match — which is why the two are not averaged
// together here.
const ok = report.placed >= report.systems * 0.4
  && report.anchorNotes !== null && report.anchorNotes <= report.perSystem * 0.5
  && report.inside.median !== null && report.inside.median < 1.5
  && report.inside.median <= (report.tapMedian ?? Infinity);
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
