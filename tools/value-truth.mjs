// IS A CROTCHET READ AS A CROTCHET?
//
// WHY THIS EXISTS
//
// `scan-stems.js` reads a note's value off the page — filled or hollow, stem or
// none, how many beams cross the stem — and `scan-values.js` decides whether to
// believe it. NOBODY HAD EVER MEASURED HOW OFTEN THE VALUE IS RIGHT ON A REAL
// PAGE. `npm run scan:stems` sounds like it does and does not: it is a stem-
// height sweep. So the same hole that hid the pitch bug for a day was open on
// rhythm — a number nobody had, and therefore a failure nobody could see.
//
// This is the duration twin of `npm run scan:steps`, and it is built the same
// way: ground truth made BY LOOKING AT THE PAGE (pages/truth/*.values.json,
// every mark cropped at 11x to 40x), scored note for note against what the
// reader returns for the same notehead.
//
// TWO NUMBERS, AND THEY ARE NOT THE SAME NUMBER
//
// A reader that is 90% right and refuses 80% of the bars is useless for rhythm.
// So is one that believes everything and is 60% right. So this prints both,
// with different denominators and different names, and refuses to average them:
//
//   ACCURACY   note for note against the encoded truth, over the noteheads the
//              reader actually circled inside the covered span. A note the
//              reader missed is a RECALL failure and belongs to `npm run
//              bench`; it is counted and reported here, and it is not in this
//              denominator.
//   THE DECISION  what scan-values.js said about the WHOLE page: how many bars
//              it believed, how many it refused, what bar length it agreed on
//              and whether that length is a bar at all. `beatsPerBar` is
//              printed and not just the coverage, because scan-values.js's own
//              header names the failure coverage cannot see — read every
//              semiquaver as a quaver and every bar agrees perfectly at twice
//              the length.
//
// WHERE THERE IS NO ENCODED TRUTH, only the decision is printed, and it is
// labelled PROXY. A bar summing to the page's modal bar is evidence and it is
// not proof: the systematic error above passes it by construction.
//
//   npm run scan:values                       every page in pages/index.json
//   npm run scan:values -- "<page.pdf>"       one page
//   npm run scan:values -- --json
//
// A page gets the truth-backed column when a `<truth>`-shaped values file
// exists beside its marks: pages/truth/scanned.truth.json is paired with
// pages/truth/scanned.values.json. `--values <path>` overrides that.
//
// WHAT THIS TOOL DOES NOT MEASURE, said plainly so no number here is read as
// more than it is: it says nothing about rests (they have no notehead to hang a
// value on), nothing about ties, and nothing about whether the BARLINES are in
// the right place — `bench` counts barlines and does not score them, and every
// per-bar figure below inherits that.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const vAt = args.indexOf('--values');
const valuesOverride = vAt >= 0 ? args[vAt + 1] : null;
const only = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--values');

const index = JSON.parse(await readFile(new URL('../pages/index.json', import.meta.url), 'utf8'));
const repo = (p) => (p.startsWith('/') ? p : new URL(`../${p}`, import.meta.url).pathname);
const pages = (only ? index.filter((p) => p.file === only || basename(p.file) === basename(only)) : index);
if (only && !pages.length) pages.push({ name: basename(only), file: only, truth: null });

// Beats are eighths and sixteenths; comparing them raw is comparing floats.
// The same tick scan-values.js uses, for the same reason.
const tick = (b) => Math.round(b * 16);
// What a number of beats is CALLED, so a failure can be named rather than
// printed as a pair of decimals. A value the reader can produce and music does
// not use — 0.125, 0.0625 — keeps its number.
const NAMES = new Map([[4, 'semibreve'], [3, 'dotted-minim'], [2, 'minim'], [1.5, 'dotted-crotchet'],
  [1, 'crotchet'], [0.75, 'dotted-quaver'], [0.5, 'quaver'], [0.25, 'semiquaver'],
  [0.125, 'demisemiquaver'], [0.0625, 'hemidemisemiquaver']]);
const name = (b) => (b === null || b === undefined ? 'nothing' : (NAMES.get(b) ?? `${b} beats`));

const browser = await puppeteer.launch({
  executablePath: SHELL, headless: true, args: ['--no-sandbox'], protocolTimeout: 240000,
});
const tab = await browser.newPage();
await tab.setViewport({ width: 1400, height: 1800 });
await tab.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));

const rows = [];
for (const page of pages) {
  const b64 = (await readFile(page.file)).toString('base64');
  const marks = page.truth ? JSON.parse(await readFile(repo(page.truth), 'utf8')).notes : null;
  const valuesPath = valuesOverride
    ?? (page.truth ? repo(page.truth).replace(/\.truth\.json$/, '.values.json') : null);
  const values = valuesPath && existsSync(valuesPath)
    ? JSON.parse(await readFile(valuesPath, 'utf8')) : null;

  const out = await tab.evaluate(async ({ b64, marks }) => {
    const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');
    const { validateValues } = await import('/src/analysis/scan-values.js');
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({
      data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const src = document.createElement('canvas');
    src.width = viewport.width; src.height = viewport.height;
    await first.render({ canvasContext: src.getContext('2d'), viewport }).promise;
    // The app's own working width. Every coordinate below is in these pixels,
    // which is the frame the truth files are normalised against.
    const W = Math.min(1400, src.width);
    const work = document.createElement('canvas');
    work.width = W; work.height = Math.round(src.height * (W / src.width));
    work.getContext('2d').drawImage(src, 0, 0, work.width, work.height);

    const read = readPage(work, work.width, work.height);
    if (!read) return { failed: 'the reader found no stave on this page' };
    const heads = notesInOrder(read);

    // The bars, exactly as scan-timing.js would build them from a page: a new
    // bar wherever the (staff, bar) pair changes, in reading order. Built here
    // rather than through scanTiming because scanTiming needs a RECORDING —
    // barsOf drops every mark without a `note.start`, so on a page with no take
    // it returns null and says nothing about the values at all.
    const bars = [];
    let key = null;
    for (const head of heads) {
      const at = `${head.staff}|${head.bar}`;
      if (at !== key) { bars.push({ at, staff: head.staff, bar: head.bar, beats: [] }); key = at; }
      bars.at(-1).beats.push(head.beats ?? 0);
    }
    const decision = validateValues(bars.map((b) => b.beats));

    // The staves' own space, not the page-wide estimate — that comes out about
    // a sixth low. truth-check.mjs takes it identically and the two MUST agree,
    // because a mark paired at one tolerance and scored at another is two
    // different measurements wearing one name.
    const spaces = read.staves.map((s) => s.space * work.height).sort((a, b) => a - b);
    const space = spaces.length
      ? spaces[Math.floor((spaces.length - 1) / 2)]
      : (read.space ?? 0.012) * work.height;

    // Greedy nearest matching, closest pairs first, so one detection cannot
    // claim a truth mark that another detection is sitting on top of. Copied
    // from truth-check.mjs deliberately: the pairing that decides WHICH note
    // this is must be the same pairing bench scores, or the two tools disagree
    // about the same page for reasons that have nothing to do with either.
    let paired = [];
    if (marks) {
      const near = space * 0.5;
      const cand = [];
      for (const [fi, f] of heads.entries()) {
        for (const [ti, t] of marks.entries()) {
          const d = Math.hypot((f.x - t.x) * work.width, (f.y - t.y) * work.height);
          if (d < near) cand.push({ fi, ti, d });
        }
      }
      cand.sort((a, b) => a.d - b.d);
      const tookF = new Set(); const tookT = new Set();
      for (const p of cand) {
        if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
        tookF.add(p.fi); tookT.add(p.ti);
        paired.push(p);
      }
    }

    return {
      w: work.width,
      h: work.height,
      space: Math.round(space * 10) / 10,
      heads: heads.map((n) => ({
        staff: n.staff, bar: n.bar, x: Math.round(n.x * work.width), y: Math.round(n.y * work.height),
        beats: n.beats, beams: n.beams, via: n.via,
      })),
      bars: bars.map((b) => ({
        at: b.at, staff: b.staff, bar: b.bar, n: b.beats.length,
        sum: Math.round(b.beats.reduce((a, x) => a + x, 0) * 16) / 16,
      })),
      decision: {
        ok: decision.ok, beatsPerBar: decision.beatsPerBar,
        coverage: decision.coverage, why: decision.why,
        trusted: [...decision.trusted],
      },
      paired: paired.map((p) => ({ fi: p.fi, ti: p.ti, d: Math.round(p.d * 10) / 10 })),
    };
  }, { b64, marks });

  rows.push({ page, values, valuesPath, ...out });
}
await browser.close();

// ---------------------------------------------------------------------------

const report = [];
for (const r of rows) {
  if (r.failed) { report.push({ name: r.page.name, failed: r.failed }); continue; }

  // THE DECISION — the whole page, and the only figure available on a page
  // with no encoded truth.
  //
  // Bars are counted the way scan-values.js counts them: a bar whose notes sum
  // to nothing is not in its denominator at all, because it cannot agree or
  // disagree with anything. Those are reported on their own line, since they
  // are a STRUCTURAL refusal — a stave-edge group, a bar of rests with no
  // notehead in it — and have nothing to do with reading a beam.
  const real = r.bars.filter((b) => b.sum > 0);
  const empty = r.bars.length - real.length;
  // A "bar" of one note is almost always a barline that is not a bar, or the
  // tail of a system. Counted separately for the same reason: refusing it is
  // not a duration failure.
  const runts = real.filter((b) => b.n <= 1).length;
  const believed = r.decision.trusted.length;
  const row = {
    name: r.page.name,
    space: r.space,
    heads: r.heads.length,
    // A PLUMBING CHECK, not a result. This pairing is copied from
    // truth-check.mjs and must reproduce its `hit` exactly — Scanned 410 of
    // 412, Bach 318 of 319, Mozart 312 of 328 on the day this was written. If
    // it does not, the disagreement is in this file and not in the reader, and
    // nothing below means anything until it is fixed.
    matchedMarks: r.paired.length,
    bars: r.bars.length,
    barsWithNotes: real.length,
    emptyBars: empty,
    runtBars: runts,
    believed,
    refused: real.length - believed,
    ok: r.decision.ok,
    beatsPerBar: r.decision.beatsPerBar,
    coverage: r.decision.coverage,
    why: r.decision.why,
  };

  // WHAT THE BARS ACTUALLY SUM TO, and not just how many agreed.
  //
  // "Refused" has two completely different causes and the aggregate cannot tell
  // them apart. If the sums cluster on one number that is not a bar, the VALUES
  // are wrong together. If they are scattered, the BARLINES are wrong — the
  // reader numbers bars by counting the barlines it found, so one printed bar
  // split in two makes two groups of half a bar each and neither can ever
  // agree with anything. The histogram is the only thing that says which.
  row.sums = [...real.reduce((m, b) => m.set(b.sum, (m.get(b.sum) ?? 0) + 1), new Map())
    .entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  row.notesPerBar = real.length ? Math.round((real.reduce((a, b) => a + b.n, 0) / real.length) * 10) / 10 : 0;

  // What the reader thinks the page is made of, which is the cheapest sanity
  // check there is: a page of Bach semiquavers that comes back mostly
  // crotchets has been read wrong whatever any bar sums to.
  const spread = new Map();
  for (const h of r.heads) spread.set(h.beats, (spread.get(h.beats) ?? 0) + 1);
  row.spread = [...spread.entries()].sort((a, b) => b[1] - a[1])
    .map(([b, n]) => `${name(b)} ${n}`);
  // The same spread over only the heads that landed on a HAND MARK, which is
  // the honest denominator on a page whose truth file exists: an invented
  // circle standing on a beam has a value too, and it is not a reading of any
  // printed note. On a page where the music is uniform this is a truth-backed
  // figure and not a proxy — see the Bach line in the report.
  if (r.page.truth) {
    const matched = new Map();
    for (const p of r.paired) {
      const b = r.heads[p.fi].beats;
      matched.set(b, (matched.get(b) ?? 0) + 1);
    }
    row.spreadMatched = [...matched.entries()].sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${name(b)} ${n}`);
  }

  // TRUTH-BACKED — note for note, where a values file exists.
  if (r.values) {
    const byMark = new Map(r.values.marks.map((m) => [m.i, m]));
    const headOf = new Map(r.paired.map((p) => [p.ti, r.heads[p.fi]]));
    let right = 0; let wrong = 0; let missed = 0;
    const fails = new Map();
    const detail = [];
    // TWO different events, and conflating them makes the line unquotable: a
    // circle on a beam or a slur is ink that is not a note, and a circle on the
    // grace note is a real printed head whose VALUE is simply not part of the
    // bar. Counted apart.
    let onNothing = 0;
    let onGrace = 0;
    for (const m of r.values.marks) {
      const head = headOf.get(m.i);
      if (m.beats === null) {
        // An excluded mark: a beam, a slur, a 'tr', a grace note. A circle here
        // is not a duration failure and a blank here is not a duration success,
        // so it is counted on its own line and nowhere else.
        if (head) { if (m.kind === 'grace') onGrace += 1; else onNothing += 1; }
        continue;
      }
      if (!head) { missed += 1; continue; }
      if (tick(head.beats ?? 0) === tick(m.beats)) { right += 1; continue; }
      wrong += 1;
      const key = `${m.kind} read as ${name(head.beats)}`;
      fails.set(key, (fails.get(key) ?? 0) + 1);
      detail.push({ i: m.i, at: `${head.x},${head.y}`, was: m.kind, read: name(head.beats), beams: head.beams, via: head.via });
    }
    // THE BAR SUMS OVER THE COVERED SPAN, which is the only place in this repo
    // where "what did the reader make this bar come to" can be set beside
    // "what does the print make it come to" with both numbers known.
    //
    // Three columns and they are three different things. `printed` is the bar
    // the engraver wrote. `truthFlat` is the sum of the ENCODED values over the
    // covered noteheads — which is NOT the printed bar wherever the page prints
    // a chord, because scan-values.js adds up noteheads and two heads on one
    // stem are one onset counted twice. `readFlat` is what the reader's own
    // values come to over every head it put in that bar, invented ones
    // included, and that is exactly what validateValues sees.
    const spanBars = [];
    for (const b of r.values.bars ?? []) {
      if (!b.barVerified) continue;
      const truthFlat = r.values.marks
        .filter((m) => m.i >= b.marks[0] && m.i <= b.marks[1] && m.beats !== null)
        .reduce((a, m) => a + m.beats, 0);
      const group = r.bars.find((g) => g.staff === b.staff
        && r.heads.some((h) => h.staff === b.staff && h.bar === g.bar
          && (headOf.get(b.marks[0]) === h || headOf.get(b.marks[1]) === h)));
      spanBars.push({
        staff: b.staff, bar: b.bar, printed: b.beats,
        truthFlat: Math.round(truthFlat * 16) / 16,
        readFlat: group ? group.sum : null,
        readHeads: group ? group.n : null,
      });
    }

    row.truth = {
      file: r.valuesPath,
      spanBars,
      covered: r.values.marks.length,
      scoreable: r.values.marks.filter((m) => m.beats !== null).length,
      excluded: r.values.marks.filter((m) => m.beats === null).length,
      found: right + wrong,
      right,
      wrong,
      notFound: missed,
      circledOnNotNotehead: onNothing,
      circledOnGrace: onGrace,
      accuracy: right + wrong ? right / (right + wrong) : null,
      failures: [...fails.entries()].sort((a, b) => b[1] - a[1]),
      detail,
    };
  }
  report.push(row);
}

if (wantJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('\nNOTE VALUES ON A REAL PAGE\n');
  console.log('  TRUTH-BACKED — note for note against a values file built by looking at the print\n');
  let any = false;
  for (const r of report) {
    if (!r.truth) continue;
    any = true;
    const t = r.truth;
    console.log(`  ${r.name}   ${basename(t.file)}`);
    console.log(`    ${t.covered} marks covered · ${t.scoreable} are noteheads · ${t.excluded} are not and are excluded`);
    console.log(`    the reader circled ${t.found} of the ${t.scoreable} · ${t.notFound} it did not find (that is RECALL, and bench scores it)`);
    console.log(`    RIGHT ${t.right}   WRONG ${t.wrong}   —  ${(t.accuracy * 100).toFixed(1)}% of the notes it found`);
    if (t.circledOnNotNotehead) console.log(`    ${t.circledOnNotNotehead} circles landed on ink that is not a notehead at all (a beam, a slur, a tr, a letter) — not counted either way`);
    if (t.circledOnGrace) console.log(`    ${t.circledOnGrace} circle on the grace note, which IS a printed head but whose value is not part of the bar — also not counted either way`);
    if (t.spanBars?.length) {
      console.log('    the bars of the covered span, three sums that are three different claims:');
      console.log('      staff bar   printed   truth over the heads   what the reader made it   heads');
      for (const b of t.spanBars) {
        console.log(`      ${String(b.staff).padStart(5)} ${String(b.bar).padStart(3)}`
          + `   ${String(b.printed).padStart(7)}   ${String(b.truthFlat).padStart(20)}`
          + `   ${String(b.readFlat ?? '—').padStart(23)}   ${String(b.readHeads ?? '—').padStart(5)}`);
      }
    }
    if (t.failures.length) {
      console.log('    how it is wrong:');
      for (const [k, n] of t.failures) console.log(`      ${String(n).padStart(3)}  ${k}`);
    }
    console.log('');
  }
  if (!any) console.log('    (no values file for any page in this run)\n');

  console.log('  THE DECISION — what scan-values.js did with the whole page. PROXY where there is no truth file.\n');
  console.log('  page          space  heads   bars  with notes  believed  refused   beats/bar  coverage  verdict');
  for (const r of report) {
    if (r.failed) { console.log(`  ${r.name.padEnd(12)}  ${r.failed}`); continue; }
    console.log(`  ${r.name.padEnd(12)}  ${String(r.space).padStart(5)}  ${String(r.heads).padStart(5)}`
      + `  ${String(r.bars).padStart(5)}  ${String(r.barsWithNotes).padStart(10)}`
      + `  ${String(r.believed).padStart(8)}  ${String(r.refused).padStart(7)}`
      + `  ${String(r.beatsPerBar ?? '—').padStart(9)}  ${(r.coverage * 100).toFixed(0).padStart(7)}%`
      + `  ${r.ok ? 'believed' : `REFUSED: ${r.why}`}`);
  }
  console.log('');
  for (const r of report) {
    if (r.failed) continue;
    console.log(`  ${r.name}: ${r.emptyBars} bar-groups hold no value at all and ${r.runtBars} hold one note — `
      + 'those are stave edges and noteheadless bars, refused for reasons that are not about reading a beam.');
    console.log(`    read as: ${r.spread.join(' · ')}`);
    if (r.spreadMatched) console.log(`    …of which, on a hand mark: ${r.spreadMatched.join(' · ')}`);
    console.log(`    ${r.notesPerBar} notes per bar-group; the commonest sums are `
      + r.sums.map(([s, n]) => `${s} beats x${n}`).join(', '));
  }
  console.log('');
}
