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

  // Is this point standing on the furniture at the head of a system?
  //
  // "In the clef band" and "on the key signature" are two different populations
  // with two different fixes, and both of them look like "a false circle near
  // the left edge" in a list of coordinates. The reader now reports both bands,
  // so the question is asked of what it actually found rather than of a guess
  // at where the furniture usually is.
  //
  // Asked of the point's OWN system, not of any system that happens to print
  // its key signature at that x. Every system on a page starts at the same
  // margin, so "some stave has a band here" is true of all of them and says
  // nothing — and the interesting case is precisely the system whose band was
  // NOT found while its neighbours' were.
  const furniture = (sys, x) => {
    const s = read.staves[sys];
    if (!s) return null;
    if (s.keyBand && x >= s.keyBand.x - s.space * 0.6 && x <= s.keyBand.x + s.keyBand.w + s.space * 0.6) return 'key';
    if (s.clefZone && x >= (s.edge ?? s.clefZone.x) && x <= s.clefZone.x + s.clefZone.w) return 'clef';
    // The x where the OTHER systems print their signature, on a system that
    // found none of its own. This is the population that says the suppression
    // did not run rather than that it ran and let something through.
    //
    // Measured from each stave's OWN left end, not in absolute x. An engraver
    // indents the first system of a piece, so on the Scanned score system 2
    // begins at x = 193 and prints its signature at 241 while systems 3 to 11
    // begin at 57 and print theirs at 101 to 120. Unioned in absolute x that is
    // a band from 101 to 277 — a fifth of the page width — and an invented head
    // at x = 281, nowhere near where any system prints a signature, came back
    // labelled `key-unfound`. Which was the one piece of evidence pointing at a
    // furniture escape in a population that turned out to be the stem pass.
    // This is the same correction dropFurniture's own comment describes.
    const relative = read.staves
      .filter((k) => k.keyBand && k.edge != null)
      .map((k) => [k.keyBand.x - k.edge, k.keyBand.x + k.keyBand.w - k.edge]);
    if (relative.length && s.edge != null) {
      const x0 = Math.min(...relative.map((b) => b[0])) + s.edge;
      const x1 = Math.max(...relative.map((b) => b[1])) + s.edge;
      if (x >= x0 - s.space * 0.6 && x <= x1 + s.space * 0.6) return 'key-unfound';
    }
    return null;
  };

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
  //
  // …AND LABELS THAT SIT ON THE KEY SIGNATURE, which is the same mistake made
  // by the same hand for a better reason.
  //
  // A sharp is two thin uprights crossed by two thick slanted bars, and at a
  // ten-pixel staff space each of those bars is exactly the size, shape and
  // darkness of a notehead. The reader used to circle both of them on every
  // system; a person clicking through four hundred rings accepted the circles
  // because they looked like circles on notes. LOOKED AT, on the Scanned score
  // — crop at 114,497 and 114,1199 — the two marks stand on the two crossbars
  // of the printed sharp, with the first real note of the bar correctly ringed
  // a centimetre to the right.
  //
  // This matters more than a point of recall. A truth file that calls the key
  // signature a note REWARDS the reader for circling it, which is the exact bug
  // this round exists to fix: every improvement to the key-signature
  // suppression shows up as a recall regression, and the measurement argues
  // against the fix.
  //
  // The window is the page's OWN answer, not a guess at where a signature goes:
  // the systems that found a key band agree on where it is, so their union —
  // measured from each stave's own left end, because an engraver indents the
  // first system — is where the signature is printed on this page. A page whose
  // systems found no band at all contributes no window and nothing is removed.
  const keyWindow = (() => {
    const offsets = read.staves
      .filter((s) => s.keyBand && s.edge != null)
      .map((s) => [(s.keyBand.x - s.edge) / s.space, (s.keyBand.x + s.keyBand.w - s.edge) / s.space]);
    if (offsets.length < 3) return null;
    // THE MEDIAN of the systems' answers, not their union.
    //
    // The union is one bad band away from reaching into the music, and it does:
    // on the Bärenreiter Bach one system reads its signature 1.56 spaces wide
    // against 0.57 to 1.16 for the rest, which stretches the union to 6.5
    // spaces past the stave's left end — and a beamed pair of quavers in the
    // first bar of the indented system sits at 6.67. Cropped at 216,354, both
    // are plainly notes, correctly ringed, and the union would have deleted one
    // of them from the ground truth. A truth file edited by a rule that eats
    // notes is worse than no cleaning at all.
    //
    // The median cannot be moved by one over-wide band, and every system on a
    // printed page carries the same signature in the same place, so the median
    // IS the answer rather than a robust approximation to it.
    const mid = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];
    // Padded by three fifths of a space each way: a mark is a click, not a
    // measurement, and it lands where the person's finger went.
    return [mid(offsets.map((o) => o[0])) - 0.6, mid(offsets.map((o) => o[1])) + 0.6];
  })();

  // How far LEFT of a stave's measured edge a clef is really drawn on this page.
  //
  // The median across systems, in staff spaces, and never positive: this exists
  // to widen the clef window on a system whose edge came back too far right, not
  // to narrow it on one that is correct.
  const clefWindow = (() => {
    const offs = read.staves
      .filter((s) => s.clefZone && s.edge != null)
      .map((s) => (s.clefZone.x - s.edge) / s.space);
    if (offs.length < 3) return null;
    const m = offs.slice().sort((a, b) => a - b)[Math.floor((offs.length - 1) / 2)];
    return Math.min(0, m - 0.6);
  })();

  const suspect = [];
  for (const [ti, t] of want.entries()) {
    let onKey = false;
    for (const s of read.staves) {
      if (!keyWindow || s.edge == null) continue;
      const top = s.lines[0][0] - s.space * 4;
      const bottom = s.lines[4][0] + s.space * 4;
      if (t.y < top || t.y > bottom) continue;
      const off = (t.x - s.edge) / s.space;
      if (off >= keyWindow[0] && off <= keyWindow[1]) { onKey = true; break; }
    }
    if (onKey) {
      suspect.push({
        i: ti, on: 'key',
        x: Math.round(t.x * work.width), y: Math.round(t.y * work.height), ...where(t.x, t.y),
      });
      continue;
    }
    for (const s of read.staves) {
      if (!s.clefZone) continue;
      // From the stave's own left end, and ALSO from the page's answer, because
      // the stave's own left end is exactly what is wrong on the system where
      // this matters most.
      //
      // The original rule ran from `s.edge` rightwards. On the Bärenreiter Bach
      // the first system is indented under the title and its edge measures 136
      // where the clef is drawn near 100 — so a hand mark ON THE ROUND HEAD OF
      // THE BASS CLEF (crop at 100,310: it is unmistakable) fell to the LEFT of
      // the zone and was never looked at. The detector was blind in precisely
      // the region it exists to police, and on precisely the system the reader
      // is documented as measuring wrong. "No suspect labels printed" then reads
      // as "this page is clean", which is how the Bach came to be the control
      // page for everybody else's contamination while carrying three of its own.
      //
      // So the window opens at whichever is further left: the stave's own edge,
      // or the page's median clef offset carried back to this stave. A page
      // whose systems disagree about where they start cannot hide a clef behind
      // the disagreement.
      // …which means: NO LEFT BOUND AT ALL, up to where the clef band ends.
      //
      // Nothing is printed to the left of a clef. Not on any system, of any
      // page, in any edition — the clef is the first thing on the stave, and
      // what is further left is the margin, the brace, or blank paper. So the
      // honest test is one-sided, and a one-sided test cannot be defeated by a
      // system whose left edge was measured in the wrong place.
      //
      // The rule this replaces ran from the stave's own edge rightwards, which
      // is a bound built out of the number most likely to be wrong. On the
      // Bärenreiter Bach the indented first system reports edge = 136 where the
      // clef is drawn near 95, so a mark on the bass clef's round head at x=100
      // fell into the gap between the two and was never tested. The detector was
      // blind exactly where the reader is documented as measuring badly, and the
      // page it was blind on was the one the other pages' contamination was
      // being compared against.
      //
      // A pencil mark far out in the margin is caught by this too. That is the
      // right answer: it is not a notehead either.
      const x1 = s.clefZone.x + s.clefZone.w;
      const top = s.lines[0][0] - s.space * 4;
      const bottom = s.lines[4][0] + s.space * 4;
      if (t.x <= x1 && t.y >= top && t.y <= bottom) {
        suspect.push({
          i: ti, on: 'clef',
          x: Math.round(t.x * work.width), y: Math.round(t.y * work.height), ...where(t.x, t.y),
        });
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
        step: where(f.x, f.y).step, beats: f.beats, via: f.via ?? 'shape',
      })),
    falsePositives: found
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => !tookF.has(i))
      .map(({ f }) => ({
        x: Math.round(f.x * work.width), y: Math.round(f.y * work.height),
        beats: f.beats, via: f.via ?? 'shape',
        on: furniture(where(f.x, f.y).system - 1, f.x), ...where(f.x, f.y),
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
        + (r.via ? `  ${r.via.padEnd(5)}` : '')
        + (r.on ? `  on the ${r.on}` : '')
        + (r.beats != null ? `  ${r.beats} beats` : ''));
    }
    if (!showAll && rs.length > show.length) console.log(`        …and ${rs.length - show.length} more (--all)`);
  }
  console.log('');
}

// WHICH PASS invented them, and WHAT they are standing on.
//
// A count of false circles says a page is wrong. This says which half of the
// reader is wrong on it — the shape scan or the stem hunt — and how many are
// the clef and the key signature rather than the music, which is the
// difference between a filter to write and a filter that already exists and is
// not firing.
{
  const fp = report.falsePositives;
  const by = (key) => {
    const m = new Map();
    for (const r of fp) {
      const k = r[key] ?? 'music';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  if (fp.length) {
    console.log('  WHERE THE INVENTED HEADS COME FROM');
    console.log(`    by pass       ${by('via').map(([k, n]) => `${k} ${n}`).join('   ')}`);
    console.log(`    by furniture  ${by('on').map(([k, n]) => `${k} ${n}`).join('   ')}`);
    const outside = fp.filter((r) => r.step < 0 || r.step > 8).length;
    console.log(`    outside the stave  ${outside} of ${fp.length}\n`);
  }
  const hit = report.matched ?? [];
  const stemHits = hit.filter((r) => r.via === 'stem').length;
  const stemFp = fp.filter((r) => r.via === 'stem').length;
  if (stemHits || stemFp) {
    console.log(`  THE STEM PASS ON ITS OWN   ${stemHits} real, ${stemFp} invented`
      + `  (${((stemHits / (stemHits + stemFp || 1)) * 100).toFixed(1)}% precision)\n`);
  }
}

group(report.falsePositives, 'INVENTED — ink the reader called a notehead');
group(report.missed, 'MISSED — notes on the page the reader never offered');

if (report.suspect?.length) {
  const onClef = report.suspect.filter((t) => t.on === 'clef').length;
  const onKey = report.suspect.filter((t) => t.on === 'key').length;
  console.log(`  SUSPECT LABELS — ${report.suspect.length} marked notes sit on the furniture at the`);
  console.log(`  head of a system: ${onClef} inside a clef band, ${onKey} on the key signature.`);
  console.log('  No music is printed there. They are rings drawn on the clef, or on the two');
  console.log('  crossbars of a sharp, and accepted by a hand clicking through four hundred.');
  for (const t of report.suspect.slice(0, 16)) {
    console.log(`      system ${String(t.system).padStart(2)}  x=${String(t.x).padStart(4)}`
      + ` y=${String(t.y).padStart(4)}  step ${String(t.step).padStart(3)}  on the ${t.on}`);
  }
  if (report.suspect.length > 16) console.log(`      …and ${report.suspect.length - 16} more`);
  const clean = flag('clean');
  if (clean) {
    const drop = new Set(report.suspect.map((t) => t.i));
    const out = { ...truth, notes: truth.notes.filter((_, i) => !drop.has(i)) };
    // The provenance survives in the file, because a truth file that quietly
    // disagrees with the marking tool is worse than one that is wrong out loud.
    out.cleaned = `${report.suspect.length} labels on the furniture removed`
      + ` (${onClef} clef, ${onKey} key signature)`;
    out.removed = report.suspect.map((t) => ({ x: t.x, y: t.y, system: t.system, on: t.on }));
    await writeFile(clean, JSON.stringify(out, null, 2));
    console.log(`\n  written to ${clean}: ${out.notes.length} notes, ${report.suspect.length} removed`);
  } else {
    console.log('\n  pass --clean <out.json> to write a copy without them.');
  }
  console.log('');
}
if (errors.length) console.log('page errors:', errors.slice(0, 3));
