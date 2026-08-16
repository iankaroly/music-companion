// The reader scored against a page somebody actually looked at.
//
// WHY THIS EXISTS
//
// Every number about noteheads until now came from pages the benchmark drew
// itself. Those pages have no pencil bowings on them, no fingerings, no editor's
// heading, no bar numbers and no half-erased anything — which is to say they are
// missing precisely the marks that the reader is mistaking for notes. So a
// filter could be measured at 100% on the corpus and still be the filter that
// collapsed a real page from 477 heads to 190.
//
// The other half of the measurement is ground truth on a REAL page, and the only
// thing that can produce it is a person looking. tools/reader-look.html has a
// marking mode for exactly that: reject the rings that are not notes, add the
// ones that were missed, save. This scores a run of the shipped reader against
// what came out.
//
//   npm run scan:truth -- <file.pdf|png> --truth <file.truth.json>
//
// It prints precision and recall, and then — the part a count cannot give you —
// WHERE every false notehead is and WHERE every missed one is, in staff and bar
// terms, so the populations can be named and attacked one at a time.
//
// Matching is by position, at half a staff space. See the note in reader-look
// about why labels are positions: a label keyed to "note number 231" is a label
// about a build of the reader and is void the moment the detector changes, which
// is the one thing the labels exist to permit.

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--truth');
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};
const truthPath = flag('truth');
const wantJson = args.includes('--json');
const showAll = args.includes('--all');

if (!file || !truthPath) {
  console.log('usage: npm run scan:truth -- <file.pdf|png> --truth <file.truth.json>');
  console.log('       mark the page first in tools/reader-look.html and press "save truth"');
  process.exit(1);
}

const truth = JSON.parse(await readFile(truthPath, 'utf8'));
if (!Array.isArray(truth.notes) || !truth.notes.length) {
  console.log(`${truthPath} holds no marked notes.`);
  process.exit(1);
}

const bytes = await readFile(file);
const base64 = bytes.toString('base64');
const isPdf = /\.pdf$/i.test(file);

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1800, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1600));

const report = await page.evaluate(async ({ b64, pdf, want }) => {
  const { readPage, notesInOrder } = await import('/src/analysis/scan-read.js');

  // The app's own path to pixels. sips and pdf.js do not agree and the reader
  // can tell; see tools/real-check.mjs, which learned that the hard way.
  async function toCanvas() {
    const binary = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (!pdf) {
      const bitmap = await createImageBitmap(new Blob([binary]));
      const c = document.createElement('canvas');
      c.width = bitmap.width; c.height = bitmap.height;
      c.getContext('2d').drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return c;
    }
    const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: binary }).promise;
    const first = await doc.getPage(1);
    const scale = 1800 / first.getViewport({ scale: 1 }).width;
    const viewport = first.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = viewport.width; c.height = viewport.height;
    await first.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return c;
  }

  const source = await toCanvas();
  const W = Math.min(1400, source.width);
  const work = document.createElement('canvas');
  work.width = W;
  work.height = Math.round(source.height * (W / source.width));
  work.getContext('2d').drawImage(source, 0, 0, work.width, work.height);

  const read = readPage(work, work.width, work.height);
  if (!read) return { failed: 'the reader found no stave on this page' };
  const found = notesInOrder(read);
  // The staves' own space, not the page-wide estimate the comb was built from —
  // that comes out about a sixth low, so half of it is 0.41 of a space, not
  // half. reader-look.html computes this identically and the two MUST agree:
  // a label made at one tolerance and scored at another means two things.
  const spaces = read.staves.map((s) => s.space * work.height).sort((a, b) => a - b);
  const space = spaces.length
    ? spaces[Math.floor((spaces.length - 1) / 2)]
    : (read.space ?? 0.012) * work.height;
  const near = space * 0.5;

  // Greedy nearest matching, closest pairs first, so a detection cannot claim a
  // truth note that another detection sits right on top of.
  const pairs = [];
  for (const [fi, f] of found.entries()) {
    for (const [ti, t] of want.entries()) {
      const d = Math.hypot((f.x - t.x) * work.width, (f.y - t.y) * work.height);
      if (d < near) pairs.push({ fi, ti, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const tookF = new Set(); const tookT = new Set();
  for (const p of pairs) {
    if (tookF.has(p.fi) || tookT.has(p.ti)) continue;
    tookF.add(p.fi); tookT.add(p.ti);
  }

  const where = (x, y) => {
    // Which system a stray mark belongs to, said by nearest stave rather than
    // by containment: half of what the reader invents is ABOVE or BELOW the
    // stave it came from, and those are the interesting ones.
    let sys = 0; let gap = Infinity;
    for (const [i, s] of read.staves.entries()) {
      const mid = (s.lines[2][Math.min(s.lines[2].length - 1,
        Math.round(x * (s.lines[2].length - 1)))]);
      const d = Math.abs(mid - y);
      if (d < gap) { gap = d; sys = i; }
    }
    const staff = read.staves[sys];
    let bar = 0;
    for (const bx of staff.bars ?? []) if (x > bx) bar++;
    const bottom = staff.lines[4][Math.min(staff.lines[4].length - 1,
      Math.round(x * (staff.lines[4].length - 1)))];
    return {
      system: sys + 1,
      bar: bar + 1,
      step: Math.round((bottom - y) * work.height / (staff.space * work.height / 2)),
    };
  };

  // Labels that sit where a clef is drawn.
  //
  // Marking a page by hand is not error-free, and one error is systematic: the
  // reader draws a ring on the bass clef of every system, and a ring on a clef
  // looks exactly like a ring on a note to somebody clicking through four
  // hundred of them. Nine such labels came back on the first marked page. They
  // are not a judgement call — there is no music between a stave's left end and
  // its key signature — so they are reported, and `--clean` writes a corrected
  // copy rather than anybody hand-editing four hundred coordinates.
  const suspect = [];
  for (const [ti, t] of want.entries()) {
    for (const s of read.staves) {
      if (!s.clefZone) continue;
      // From the stave's own left end, not from the band: the band starts a
      // quarter space in and labels turned up in that quarter space too. Taken
      // from the reader rather than reconstructed — subtracting the quarter
      // space back off landed three pixels out and missed four of them.
      const x0 = s.edge ?? s.clefZone.x;
      const x1 = s.clefZone.x + s.clefZone.w;
      const top = s.lines[0][0] - s.space * 4;
      const bottom = s.lines[4][0] + s.space * 4;
      if (t.x >= x0 && t.x <= x1 && t.y >= top && t.y <= bottom) {
        suspect.push({ i: ti, x: Math.round(t.x * work.width), y: Math.round(t.y * work.height), ...where(t.x, t.y) });
        break;
      }
    }
  }

  return {
    size: `${work.width}x${work.height}`,
    space: +space.toFixed(1),
    suspect,
    // Barlines have no ground truth here, but the COUNT belongs in the report
    // anyway. This tool measured noteheads and nothing else, and while it read
    // 90% on a page the reader was finding four barlines on it where there are
    // thirty-five — which is what somebody looking at the screen actually sees,
    // and it stayed invisible for a day because no number went near it.
    bars: read.staves.reduce((a, st) => a + (st.bars?.length ?? 0), 0),
    systems: read.staves.length,
    clefs: read.staves.filter((st) => st.clef).length,
    found: found.length,
    truth: want.length,
    hit: tookT.size,
    // The matched ones too, and their step — because a rule that throws away
    // what sits outside the stave is only worth having if the notes do not.
    // Ledger notes are notes, and this is the number that says how many.
    matched: found
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => tookF.has(i))
      .map(({ f }) => ({
        x: Math.round(f.x * work.width), y: Math.round(f.y * work.height),
        step: where(f.x, f.y).step, beats: f.beats,
      })),
    falsePositives: found
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => !tookF.has(i))
      .map(({ f }) => ({
        x: Math.round(f.x * work.width), y: Math.round(f.y * work.height),
        beats: f.beats, ...where(f.x, f.y),
      })),
    missed: want
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !tookT.has(i))
      .map(({ t }) => ({
        x: Math.round(t.x * work.width), y: Math.round(t.y * work.height),
        ...where(t.x, t.y),
      })),
  };
}, { b64: base64, pdf: isPdf, want: truth.notes });

await browser.close();

if (report.failed) {
  console.log(`\n${report.failed}\n`);
  process.exit(1);
}

const precision = report.hit / report.found;
const recall = report.hit / report.truth;
const f1 = (2 * precision * recall) / (precision + recall || 1);

if (wantJson) {
  console.log(JSON.stringify({ file, precision, recall, f1, ...report, errors }, null, 2));
  process.exit(0);
}

console.log(`\n${basename(file)} against ${basename(truthPath)}`);
console.log(`  ${report.size} · staff space ${report.space}px · marked ${truth.marked ?? 'undated'}\n`);
console.log(`  ${String(report.found).padStart(4)}  found`);
console.log(`  ${String(report.truth).padStart(4)}  really there`);
console.log(`  ${String(report.hit).padStart(4)}  matched\n`);
console.log(`  PRECISION  ${(precision * 100).toFixed(1)}%   `
  + `${report.falsePositives.length} invented`);
console.log(`  RECALL     ${(recall * 100).toFixed(1)}%   ${report.missed.length} missed`);
console.log(`  F1         ${(f1 * 100).toFixed(1)}%\n`);

// Grouped, because a list of ninety-seven coordinates is not a finding and
// "system 1 bar 1 has eleven of them" is.
function group(rows, title) {
  if (!rows.length) return;
  console.log(`  ${title}`);
  const bySystem = new Map();
  for (const r of rows) {
    const k = r.system;
    if (!bySystem.has(k)) bySystem.set(k, []);
    bySystem.get(k).push(r);
  }
  for (const [sys, rs] of [...bySystem.entries()].sort((a, b) => a[0] - b[0])) {
    const off = rs.filter((r) => r.step < 0 || r.step > 8).length;
    console.log(`    system ${String(sys).padStart(2)}  ${String(rs.length).padStart(3)}`
      + `  ${off ? `${off} outside the stave` : 'all within the stave'}`);
    const show = showAll ? rs : rs.slice(0, 6);
    for (const r of show) {
      console.log(`        x=${String(r.x).padStart(4)} y=${String(r.y).padStart(4)}`
        + `  bar ${String(r.bar).padStart(2)}  step ${String(r.step).padStart(3)}`
        + (r.beats != null ? `  ${r.beats} beats` : ''));
    }
    if (!showAll && rs.length > show.length) console.log(`        …and ${rs.length - show.length} more (--all)`);
  }
  console.log('');
}

group(report.falsePositives, 'INVENTED — ink the reader called a notehead');
group(report.missed, 'MISSED — notes on the page the reader never offered');

if (report.suspect?.length) {
  console.log(`  SUSPECT LABELS — ${report.suspect.length} marked notes sit inside a clef band,`);
  console.log('  where no music is ever printed. They are almost certainly rings drawn on');
  console.log('  the clef and accepted by mistake.');
  for (const t of report.suspect.slice(0, 12)) {
    console.log(`      system ${String(t.system).padStart(2)}  x=${String(t.x).padStart(4)}`
      + ` y=${String(t.y).padStart(4)}  step ${String(t.step).padStart(3)}`);
  }
  if (report.suspect.length > 12) console.log(`      …and ${report.suspect.length - 12} more`);
  const clean = flag('clean');
  if (clean) {
    const drop = new Set(report.suspect.map((t) => t.i));
    const out = { ...truth, notes: truth.notes.filter((_, i) => !drop.has(i)) };
    out.cleaned = `${report.suspect.length} labels inside a clef band removed`;
    await writeFile(clean, JSON.stringify(out, null, 2));
    console.log(`\n  written to ${clean}: ${out.notes.length} notes, ${report.suspect.length} removed`);
  } else {
    console.log('\n  pass --clean <out.json> to write a copy without them.');
  }
  console.log('');
}
if (errors.length) console.log('page errors:', errors.slice(0, 3));
