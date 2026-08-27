// THE MAP AGAINST SOMEBODY'S EAR, ON A TAKE THEY ACTUALLY PLAYED.
//
// WHY THIS EXISTS. Every number the bar map has been judged by comes from
// `npm run scan:guess`, and that tool says so in its own header: "THE TAKE IS
// SYNTHESISED, because the truth has to be known." It builds the take out of
// the noteheads the reader found on the page, plays them at a tempo that moves,
// drops a tenth of them and spoils a twentieth. That is a real test of the
// arithmetic and it is the page played back at itself. Nothing in it has a
// cello's bottom string, a double stop, an ornament, a bow change, or a note
// the reader MISSED — which the synthesiser could not drop because it never
// knew the note was there.
//
// So the app has never been measured on real playing, and it cannot be by any
// tool, because the truth about a real take lives in the player's ear and
// nowhere else.
//
// EXCEPT THAT IT IS ALREADY WRITTEN DOWN. "Mark where you are" is a person
// saying THIS BAR WAS SOUNDING AT THIS SECOND while listening back, which is
// ground truth from the only instrument that cannot be wrong about it, and the
// app has been storing those marks per take all along and throwing the
// comparison away — a mark simply overrode the guess. This scores the guess
// against the mark.
//
// HOW TO MAKE ONE. In the app: record against a scanned page, listen back, and
// mark half a dozen bars by ear across the page. Then Library → the take's ⋯ →
// "Save as test fixture", which writes the page as the reader read it, the
// notes as the segmenter heard them, and the marks. No audio: the map is
// computed from notes, and `Download WAV` is beside it for when the pitch
// engine itself is what is being measured.
//
//   npm run dev            (on 5199)
//   npm run scan:real -- <fixture.json>
//
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const SOURCE = args.find((one) => !one.startsWith('--'));
if (!SOURCE) {
  console.error('usage: npm run scan:real -- <fixture.json>');
  console.error('  make one in the app: Library → a take → ⋯ → Save as test fixture');
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(SOURCE, 'utf8'));
const marks = (fixture.marks ?? []).filter((one) => Number.isFinite(one?.at) && Number.isFinite(one?.time));
if (!fixture.score?.layout) {
  console.error('that fixture has no page in it — the take was not saved against a scan');
  process.exit(1);
}
if (marks.length < 2) {
  console.error(`that fixture has ${marks.length} mark(s) by ear, and nothing can be scored from it.`);
  console.error('  Open the take, listen back, and mark half a dozen bars — then save it again.');
  process.exit(1);
}

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1400));

const out = await page.evaluate(async ({ layout, notes, marks: heard }) => {
  const { barsInReadingOrder, timeOfBar, guessedAnchors, systemsOf, evenAnchors,
    headsInReadingOrder, mergeAnchors } = await import('/src/analysis/bar-map.js');
  const { placeSystems } = await import('/src/analysis/scan-align.js');
  const { alignTake, anchorsFromPath } = await import('/src/analysis/take-align.js');

  const bars = barsInReadingOrder(layout);
  const systems = systemsOf(layout);
  const heads = headsInReadingOrder(layout);

  // THE THREE MAPS THE APP CAN MAKE, scored on the same marks so they are
  // comparable to the tenth of a second — which is the only way "the path is
  // better" is a sentence with a number under it.
  const placements = placeSystems(systems, notes);
  const bySystem = guessedAnchors(placements);
  const began = performance.now();
  const path = alignTake(heads, notes);
  const ms = Math.round(performance.now() - began);
  const byPath = path.placed ? anchorsFromPath(path.pairs, bars, heads) : [];
  const spread = evenAnchors(bars, notes);

  const score = (anchors) => {
    if ((anchors?.length ?? 0) < 2) return null;
    const offs = [];
    for (const mark of heard) {
      const said = timeOfBar(anchors, { at: mark.at });
      if (said === null) continue;
      offs.push({ at: mark.at, said, heard: mark.time, off: Math.abs(said - mark.time) });
    }
    if (!offs.length) return null;
    const sorted = [...offs].map((one) => one.off).sort((a, b) => a - b);
    return {
      anchors: anchors.length,
      scored: offs.length,
      median: sorted[Math.floor(sorted.length / 2)],
      worst: sorted[sorted.length - 1],
      each: offs.sort((a, b) => a.at - b.at),
    };
  };

  return {
    systems: systems.length,
    heads: heads.length,
    bars: bars.length,
    notes: notes.length,
    path: { placed: path.placed, why: path.why, matched: path.matched ?? 0, share: path.share ?? 0, ms },
    maps: {
      'note by note': score(byPath),
      'one anchor a system': score(bySystem),
      'the even spread': score(mergeAnchors([], spread)),
    },
  };
}, { layout: fixture.score.layout, notes: fixture.take.notes ?? [], marks });

await browser.close();

const secs = (n) => (n === null || n === undefined ? '   —  ' : `${n.toFixed(2)}s`);
console.log(`${SOURCE}`);
console.log(`  ${out.systems} systems · ${out.heads} noteheads read · ${out.bars} bars`);
console.log(`  the take: ${out.notes} notes${fixture.take?.seconds ? ` over ${Math.round(fixture.take.seconds)}s` : ''}`
  + `, and ${marks.length} bars marked BY EAR`);
console.log(`  the path: ${out.path.placed
  ? `placed, ${out.path.matched} notes matched (${Math.round(out.path.share * 100)}% of the take) in ${out.path.ms}ms`
  : `refused — ${out.path.why}`}`);
console.log('');
console.log('HOW FAR OUT WAS THE MAP, where somebody said they heard a bar');
console.log('  map                    anchors   marks   median    worst');
for (const [name, got] of Object.entries(out.maps)) {
  if (!got) { console.log(`  ${name.padEnd(22)}      —       —       —        —`); continue; }
  console.log(`  ${name.padEnd(22)} ${String(got.anchors).padStart(5)}  ${String(got.scored).padStart(6)}`
    + `  ${secs(got.median).padStart(7)}  ${secs(got.worst).padStart(7)}`);
}

const best = out.maps['note by note'] ?? out.maps['one anchor a system'];
if (best) {
  console.log('');
  console.log('EVERY MARK, against the map the app would actually use');
  for (const one of best.each) {
    console.log(`  system ${one.at.toFixed(2).padStart(6)}   the map said ${one.said.toFixed(1)}s`
      + `   you heard ${one.heard.toFixed(1)}s   out by ${one.off.toFixed(2)}s`);
  }
}

// NO PASS OR FAIL. There is no number here that is right — a third of a second
// matters in one piece and not in another, and the player is the one who knows
// which. This prints what happened; `scan:guess` is where a bar is asserted,
// on a take whose truth a machine can know.
console.log('');
console.log(`(scan:guess reads a median of about 0.3s on a SYNTHESISED take of a real page —`);
console.log(` this is the same question asked of playing that actually happened.)`);
