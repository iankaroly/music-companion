// Which system got a key signature band, and which did not.
//
// WHY THIS EXISTS
//
// The largest single population of false noteheads on a printed page is the key
// signature: a sharp's two thick crossbars straddle a line and read as a pair of
// heads, once per system, on every system of the page. scan-key.js finds the
// band the accidentals occupy so those circles can be dropped — and a count of
// false circles cannot say whether the band was found and let something
// through, or was never found at all. Those are different bugs with different
// fixes, and when this was written they were almost entirely the second one:
// twenty-nine of the hundred and seven invented heads stood at the key
// signature on a system whose own band came back null.
//
// THAT POPULATION IS NOW ALMOST GONE, and this tool is what found the cause.
// Re-measured with truth-check's `by furniture` line: 4 of the 83 invented
// heads across the three pages are labelled `key-unfound` — Bach 2, Concerto 1,
// Scanned 1 — because the page now agrees how far its signature reaches and
// lends that distance to systems whose own scan stopped short. What is left is
// named individually in the handover and two of the four are not key signatures
// at all, but inflection accidentals in the first bar.
//
//   npm run scan:key-why -- <file.pdf|png>
//
// Prints, per system: where the stave starts, what clef was read and how sure,
// whether a key band was found and how wide, and how many of the reader's own
// noteheads are standing inside the first few spaces of the stave.
//
// THE `furniture` COLUMN IS A HEAD COUNT INSIDE A FIXED ZONE, NOT A COUNT OF
// FALSE CIRCLES, and it used to be printed as though it were. The zone is the
// stave's left end plus 3.6 spaces of clef plus 9 spaces of signature reach —
// 12.6 spaces, which on the Bach at 12.1 pixels a space ends at x = 186. The
// claim above it, "no music is ever printed there", is simply not true of these
// pages: measured against the truth files, that zone holds 18 hand-marked real
// notes on the Bach, 9 on the Concerto and 13 on the Scanned score. So the
// totals this tool prints run about five to ten times the real number — the
// Bach reports 22 where its false circles on furniture are 2.
//
// It is still worth printing, because what it is FOR is comparing systems on
// one page: a system whose band came back null carries a visibly bigger count
// than its neighbours, which is the signal this tool was written to show. It is
// a symptom count, not a score.
//
// THE NUMBER THAT IS RIGHT is the `by furniture` breakdown in
//   node tools/truth-check.mjs "<pdf>" --truth pages/truth/<page>.truth.json --all
// which labels each INVENTED head with the furniture it stands on (clef, key
// band, or out in the music) and therefore cannot count a real note.
//
// The zone was left as it is deliberately: narrowing it would change a number
// other measurements are quoted against, for a tool whose job is comparison.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.log('usage: npm run scan:key-why -- <file.pdf|png>');
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

const report = await page.evaluate(async ({ b64, pdf }) => {
  const { readPage } = await import('/src/analysis/scan-read.js');

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
  const w = work.width;
  const h = work.height;

  return {
    size: `${w}x${h}`,
    // What the page as a whole decided, and how much of it stood behind that.
    page: read.key
      ? { name: read.key.kind === 'sharp' ? `${read.key.sharps} sharp` : `${read.key.flats} flat`, ...read.keyAgreement }
      : { name: null, ...read.keyAgreement },
    // How far past its own left end this PAGE agreed its signature reaches, in
    // staff spaces — the one bound in the suppression that is not measured off
    // the ink of the system it is applied to. Null where the page agreed no key
    // and the widening therefore never fired. See agreeKeyReach in scan-key.js.
    reach: read.keyReach ?? null,
    systems: read.staves.map((s, i) => {
      const space = s.space * h;
      const edge = s.edge == null ? null : s.edge * w;
      // Heads standing in the furniture zone: from the stave's left end to a
      // clef's width plus a signature's reach past it. No music is printed
      // there, so every one of these is furniture read as a note.
      const zone = edge === null ? null : [edge, edge + space * 3.6 + space * 9];
      const inZone = zone ? s.heads.filter((k) => k.x * w >= zone[0] && k.x * w <= zone[1]).length : 0;
      return {
        i: i + 1,
        space: +space.toFixed(1),
        edge: edge === null ? null : Math.round(edge),
        clef: s.clef,
        confidence: +(s.clefConfidence ?? 0).toFixed(2),
        key: s.keyBand
          ? {
            x: Math.round(s.keyBand.x * w),
            w: +(s.keyBand.w * w / space).toFixed(2),
            count: s.keyBand.count,
            why: s.keyBand.why ?? '-',
            cut: !!s.keyBand.cut,
            // HOW FAR THE LAST RUN THE SCAN LOOKED AT STOOD FROM THE LAST ONE
            // IT TOOK, in staff spaces — the exact quantity the speck test
            // bounds, so this column and the rule cannot drift apart. Under
            // SAME_GLYPH (0.6) it is the accidental's own debris; around a
            // glyph's pitch it is a real next accidental.
            past: s.keyBand.inkGap == null || s.keyBand.inkGap < 0 ? null
              : +((s.keyBand.inkGap * w) / space).toFixed(2),
          }
          : null,
        heads: s.heads.length,
        inZone,
        read: s.key ? `${s.key.count} ${s.key.kind}${s.key.count > 1 ? 's' : ''}` : null,
        keyConfidence: +(s.keyConfidence ?? 0).toFixed(2),
      };
    }),
  };
}, { b64: base64, pdf: isPdf });

await browser.close();

if (report.failed) {
  console.log(`\n${report.failed}\n`);
  process.exit(1);
}

console.log(`\n${basename(file)} — the furniture at the head of each system`);
console.log(`  ${report.size}\n`);
console.log('  sys  space  edge   clef  conf   key band            ended  past   read       sure  heads  furniture');
for (const s of report.systems) {
  const key = s.key
    ? `x=${String(s.key.x).padStart(4)} ${String(s.key.w).padStart(5)} spaces ×${s.key.count}`
    : '— none found —          ';
  const ended = s.key ? s.key.why : '—';
  const past = s.key && s.key.past !== null ? String(s.key.past) : '—';
  console.log(`  ${String(s.i).padStart(3)}  ${String(s.space).padStart(5)}`
    + `  ${String(s.edge ?? '—').padStart(4)}  ${String(s.clef ?? '—').padStart(5)}`
    + `  ${String(s.confidence).padStart(4)}   ${key}  ${ended.padStart(5)}  ${past.padStart(5)}`
    + `  ${(s.read ?? '—').padStart(9)}`
    + `  ${String(s.keyConfidence).padStart(5)}  ${String(s.heads).padStart(4)}`
    + `   ${String(s.inZone).padStart(3)}`);
}
// A system whose band the scan says it CUT reads no key at all, so the two
// columns above are the answer to "why is this system blank" — and `past` says
// whether the cut was a real truncation or the accidental's own debris.
const cutSystems = report.systems.filter((s) => s.key?.cut);
if (cutSystems.length) {
  // A band is a PREFIX either because the scan was cut short or because the
  // page's agreed count trimmed it. Both are reported; only the first is a
  // reason this system read no key, since the key is read off the UNTRIMMED
  // band (see dropFurniture).
  console.log(`\n  ${cutSystems.length} systems hold a band that is a PREFIX (scan cut short, or trimmed):`);
  for (const s of cutSystems) {
    console.log(`    system ${String(s.i).padStart(2)}  ended on ${s.key.why.padEnd(6)}`
      + ` last run looked at stood ${String(s.key.past).padStart(6)} spaces from the last one taken`);
  }
}
const found = report.systems.filter((s) => s.key).length;
const stray = report.systems.reduce((a, s) => a + s.inZone, 0);
console.log(`\n  ${found} of ${report.systems.length} systems found a key band`);
console.log(`  ${stray} noteheads stand in the first 12.6 spaces of a stave — clef plus signature reach.`);
console.log(`    NOT a count of false circles: that zone also holds real notes (18 of the Bach's`);
console.log(`    322 hand-marked ones, 9 of the Concerto's, 13 of the Scanned score's). Compare`);
console.log(`    systems on one page with it; for the real number use truth-check's 'by furniture'.`);
console.log(`  the page agrees its signature reaches `
  + (report.reach == null
    ? 'NOWHERE — no agreed key, so no band was widened'
    : `${report.reach.toFixed(2)} staff spaces past each system's left end`));
console.log(`\n  THE PAGE'S KEY: ${report.page.name ?? 'not read'}`
  + `  — ${report.page.agreed} of ${report.page.read} systems that read one agree,`
  + ` out of ${report.page.systems} systems on the page\n`);
if (errors.length) console.log('page errors:', errors.slice(0, 3));
