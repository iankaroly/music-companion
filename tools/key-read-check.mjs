// Can the reader say WHICH key a page is in?
//
// WHY A DRAWN PAGE IS REAL TRUTH HERE, AND WHY THAT IS UNUSUAL
//
// Everywhere else in this reader a synthetic page is a stand-in and the marked
// photographs are the measurement, because a notehead I draw is an ellipse I
// chose and a notehead on a page is whatever the engraver's font and the
// camera between them made of it. A KEY SIGNATURE IS NOT LIKE THAT. It is the
// same glyph from the same font at the same place on the stave on every printed
// page there is, and the three marked pages between them contain exactly one of
// the fifteen possible answers — one sharp — printed in two clefs. Testing the
// key reader on them alone would measure one fifteenth of it.
//
// So this draws all fifteen, in both clefs the marked pages use, at four sizes,
// clean and photographed, from the real Bravura the engraver used, at the
// positions an engraver puts them — and every one of those is truth in the same
// sense a hand mark is. What it cannot test is the ink: a photocopy, a bent
// page, a signature with a pencilled fingering through it. That is what the
// three real pages are still for, and `npm run scan:key-why` reads them.
//
//   npm run scan:key-read
//
// Prints a pass table by size and camera, then every cell that failed and what
// it read instead. KEY_DEBUG=1 adds a line per failing case — every run the
// scan found, what it was taken for and what step it was put on, against where
// the test drew it. KEY_DEBUG=all prints every case.
//
// A CANCELLATION is drawn too: n naturals standing where the old key's sharps
// stood, which is what an engraver prints at a change back to C major. The right
// answer to one is NOTHING, and it has to be got from the SHAPE — a cancellation
// stands at exactly the degrees it cancels, so the order check cannot see it.

import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const SHELL = process.env.CHROME_SHELL
  ?? `${process.env.HOME}/.cache/puppeteer/chrome-headless-shell/`
    + 'mac_arm-150.0.7871.115/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const PORT = process.env.PORT ?? '5199';

const font = await readFile(new URL('./fonts/Bravura.otf', import.meta.url));
const fontBase64 = font.toString('base64');

const browser = await puppeteer.launch({ executablePath: SHELL, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });

const rows = await page.evaluate(async ({ b64 }) => {
  const { findKeyBand, readKeySignature, classifyKeyGlyph, keyGlyphStep, SHARP_ORDER, FLAT_ORDER } = await import('/src/analysis/scan-key.js');
  const { CLEF_WIDE } = await import('/src/analysis/scan-read.js');

  const face = new FontFace('BravuraKey', `url(data:font/otf;base64,${b64})`);
  await face.load();
  document.fonts.add(face);

  const GLYPH = { sharp: '\u{E262}', flat: '\u{E260}', natural: '\u{E261}' };
  const CLEF = { treble: '\u{E050}', bass: '\u{E062}' };
  // Where a clef's own baseline sits: a treble clef is drawn from the G line,
  // second from the bottom; a bass clef from the F line, second from the top.
  const CLEF_LINE = { treble: 3, bass: 1 };

  // WHERE AN ENGRAVER PUTS THEM, in half-spaces above the bottom line.
  //
  // These are the positions on a printed page and they are not a transposition
  // anybody can derive — the octave each accidental is written in is a
  // convention, chosen so the signature stays in or near the stave. The reader
  // deliberately does NOT know them: it reads the degree (mod 7) and checks that
  // against SHARP_ORDER, so an edition that drops the last sharp an octave still
  // reads. They are here because the TEST has to draw a real page.
  const PLACE = {
    treble: { sharp: [8, 5, 9, 6, 3, 7, 4], flat: [4, 7, 3, 6, 2, 5, 1] },
    bass: { sharp: [6, 3, 7, 4, 1, 5, 2], flat: [2, 5, 1, 4, 0, 3, -1] },
  };
  // A CANCELLATION — naturals standing where the old key's sharps stood, which
  // is what an engraver prints at a change back to C major. It is drawn at the
  // sharp positions because that is where it goes, and the right answer to it is
  // NOTHING: a natural signature is a key change, this reader has no notion of
  // one, and reading the naturals as the sharps they cancel would report the one
  // key the page is certainly not in.
  PLACE.treble.natural = PLACE.treble.sharp;
  PLACE.bass.natural = PLACE.bass.sharp;

  async function run(clef, kind, count, space, spoil) {
    const W = Math.round(space * 40);
    const H = Math.round(space * 15);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const top = Math.round(space * 5);
    const lineY = (k) => top + k * space;
    const edge = Math.round(space * 2);
    g.fillStyle = '#111';
    for (let k = 0; k < 5; k++) g.fillRect(edge, lineY(k), W - edge, Math.max(1, space * 0.09));
    // Bravura is designed so one em is one stave — four spaces.
    g.font = `${space * 4}px BravuraKey`;
    g.textBaseline = 'alphabetic';
    g.fillText(CLEF[clef], edge + space * 0.3, lineY(CLEF_LINE[clef]));

    // The signature, hard against the clef, each accidental at its own advance.
    let at = edge + space * 3.9;
    const places = PLACE[clef][kind];
    for (let i = 0; i < count; i++) {
      const y = lineY(4) - places[i] * (space / 2);
      g.fillText(GLYPH[kind], at, y);
      at += g.measureText(GLYPH[kind]).width + space * 0.15;
    }
    // …and the first note of the bar, so the scan has something real to stop at.
    const noteX = at + space * 2;
    g.save(); g.translate(noteX, lineY(2)); g.rotate(-0.28);
    g.beginPath(); g.ellipse(0, 0, space * 0.62, space * 0.46, 0, 0, Math.PI * 2);
    g.fill(); g.restore();
    g.fillRect(noteX + space * 0.55, lineY(2) - space * 3.2, Math.max(1.3, space * 0.11), space * 3.2);

    let shot = c;
    let scale = 1;
    if (spoil) {
      scale = 0.72;
      const s = document.createElement('canvas');
      s.width = Math.round(W * scale); s.height = Math.round(H * scale);
      const sg = s.getContext('2d', { willReadFrequently: true });
      sg.filter = 'blur(1px) contrast(0.62)';
      sg.drawImage(c, 0, 0, s.width, s.height);
      sg.filter = 'none';
      const blob = await new Promise((d) => s.toBlob(d, 'image/jpeg', 0.6));
      const bmp = await createImageBitmap(blob);
      const out = document.createElement('canvas');
      out.width = s.width; out.height = s.height;
      out.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
      bmp.close?.();
      shot = out;
    }
    const sw = shot.width; const sh = shot.height;
    const sp = space * scale;
    const px = shot.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, sw, sh).data;
    const gray = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) {
      gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
    }
    // readPage's own local threshold. Its blur box is a share of the page WIDTH
    // — max(4, w/36) — which on the three marked pages works out at 3.2 to 4.0
    // staff spaces, so that is what it is written as here rather than a share of
    // this test's much narrower canvas.
    const rad = Math.max(4, Math.round(sp * 3.6));
    const ink = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let sum = 0; let n = 0;
        for (let dy = -rad; dy <= rad; dy += 3) {
          for (let dx = -rad; dx <= rad; dx += 3) {
            const yy = Math.min(sh - 1, Math.max(0, y + dy));
            const xx = Math.min(sw - 1, Math.max(0, x + dx));
            sum += gray[yy * sw + xx]; n++;
          }
        }
        ink[y * sw + x] = gray[y * sw + x] < sum / n - 16 ? 1 : 0;
      }
    }

    const at2 = (k) => lineY(k) * scale;
    const from = edge * scale + Math.max(3, sp * CLEF_WIDE);
    const band = findKeyBand(ink, sw, sh, at2, sp, from);
    const key = readKeySignature(band, at2, sp, clef);
    // …and what it WOULD have said had the scan not reported itself cut short.
    // Kept so the truncation rule's cost is attributable rather than merely
    // visible in the total: a refusal that was going to be right anyway is a
    // real price, and a refusal that was going to be a WRONG key is the whole
    // point of the rule.
    const uncut = band ? readKeySignature({ ...band, cut: false }, at2, sp, clef) : null;
    const want = (count === 0 || kind === 'natural') ? null : { kind, count };
    const got = key ? { kind: key.kind, count: key.count } : null;
    const order = kind === 'flat' ? FLAT_ORDER : SHARP_ORDER;
    const degreesOk = !key || key.degrees.every((d, i) => d === order[i]);
    // What each run was taken for, kept so a refusal can be explained rather
    // than merely counted — a null with no reason is a null nobody can fix.
    const detail = (band?.glyphs ?? []).map((glyph) => {
      const k = classifyKeyGlyph(glyph);
      const step = keyGlyphStep(glyph, k, at2(4), sp);
      // `k` can be null for a run with no shape measured, which is a thing a
      // caller can hold and therefore a thing this must print rather than throw
      // on. Two letters, because 'natural' and 'notehead' share a first one.
      return { k: k ?? 'none', step: +step.toFixed(2), rt3: +glyph.rt3.toFixed(2), lb3: +glyph.lb3.toFixed(2), x0: glyph.x0, x1: glyph.x1 };
    });
    return {
      clef, kind, count, space, spoil,
      read: got,
      want: count === 0 ? [] : places.slice(0, count),
      detail,
      bandCount: band?.count ?? 0,
      why: band?.why ?? '-',
      cut: !!band?.cut,
      uncut: uncut ? { kind: uncut.kind, count: uncut.count } : null,
      confidence: key ? +key.confidence.toFixed(2) : null,
      ok: (want === null ? got === null : (got !== null && got.kind === want.kind && got.count === want.count)) && degreesOk,
    };
  }

  const out = [];
  for (const clef of ['treble', 'bass']) {
    for (const space of [9, 12, 16, 22]) {
      for (const spoil of [false, true]) {
        // C major once per cell — nothing printed, and nothing must be read.
        out.push(await run(clef, 'sharp', 0, space, spoil));
        for (const kind of ['sharp', 'flat', 'natural']) {
          for (let count = 1; count <= 7; count++) out.push(await run(clef, kind, count, space, spoil));
        }
      }
    }
  }
  return out;
}, { b64: fontBase64 });

await browser.close();

const name = (r) => (r.count === 0 ? 'C major' : `${r.count} ${r.kind}${r.count > 1 ? 's' : ''}`);
const said = (r) => (r.read === null ? 'nothing' : `${r.read.count} ${r.read.kind}${r.read.count > 1 ? 's' : ''}`);

console.log('\nKEY SIGNATURES — every one of them, real Bravura, clean and photographed\n');
console.log('  clef    space  camera   read   of   ');
let pass = 0;
for (const clef of ['treble', 'bass']) {
  for (const space of [9, 12, 16, 22]) {
    for (const spoil of [false, true]) {
      const cell = rows.filter((r) => r.clef === clef && r.space === space && r.spoil === spoil);
      const ok = cell.filter((r) => r.ok).length;
      pass += ok;
      console.log(`  ${clef.padEnd(7)}${String(space).padStart(5)}  ${(spoil ? 'photo' : 'clean').padEnd(6)}`
        + `  ${String(ok).padStart(4)} / ${String(cell.length).padStart(3)}   ${ok === cell.length ? '' : '<- '}`
        + cell.filter((r) => !r.ok).map((r) => `${name(r)} read as ${said(r)}`).join(', '));
    }
  }
}

const total = rows.length;
console.log(`\n  ${pass} of ${total} signatures read correctly  (${(pass / total * 100).toFixed(1)}%)`);

// Broken out, because the three populations ask different questions and only one
// of them is "which key is this".
//
// The last row is the cell where the shapes are gone. A staff space of 9
// PHOTOGRAPHED is 6.5 pixels after the camera's own downscale, where an
// accidental is five pixels wide with strokes a pixel thick; the three marked
// pages work at 9.6 to 12.1 and the synthetic corpus goes down to 7, so nothing
// this reader is asked to read is that small. It is counted separately rather
// than dropped.
const small = (r) => r.space === 9 && r.spoil;
const group = (label, pick) => {
  const all = rows.filter(pick);
  const big = all.filter((r) => !small(r));
  const ok = (rs) => `${rs.filter((r) => r.ok).length} of ${rs.length}`;
  console.log(`  ${label.padEnd(34)} ${ok(all).padEnd(12)}   without the 6.5-pixel cell: ${ok(big)}`);
};
group('printed signatures, read right', (r) => r.count > 0 && r.kind !== 'natural');
group('cancellations, refused as they must be', (r) => r.kind === 'natural' && r.count > 0);
group('bare C major, nothing invented', (r) => r.count === 0);

// …and by HOW MANY accidentals, which is where the reader's edge actually is: a
// signature is harder to read the longer it gets, because every accidental is
// another chance for the scan to be cut and a cut signature is read as a shorter
// one.
console.log('\n  by how many accidentals are printed (the 6.5-pixel cell left out):');
console.log('    n      sharps        flats');
for (let n = 1; n <= 7; n++) {
  const cell = (kind) => {
    const rs = rows.filter((r) => r.count === n && r.kind === kind && !small(r));
    return `${rs.filter((r) => r.ok).length} of ${rs.length}`;
  };
  console.log(`    ${n}   ${cell('sharp').padEnd(13)} ${cell('flat')}`);
}

// WHAT ENDED EACH SCAN, and what the truncation rule cost and bought.
//
// A signature that ends on a blank gap wider than one glyph's spacing ended the
// way it is supposed to. Every other ending means the scan stopped with the
// band's own ink still under way, which is a signature that may be a PREFIX of
// the real one — and a prefix passes the order check. Those are refused, and
// this is the table that says what that is worth: of the reads it takes away,
// how many were right and how many were the WRONG key.
{
  console.log('\n  how each scan ENDED, and what refusing the cut ones costs');
  console.log('    ending        cases   a key would have been read:  RIGHT   WRONG');
  const want = (r) => (r.count === 0 || r.kind === 'natural') ? null : { kind: r.kind, count: r.count };
  // DERIVED FROM THE DATA, not listed here. A hardcoded list silently drops any
  // ending it does not name — 'wide' was missing from one, and it sums to 352
  // only because no DRAWN case ends there today while the three marked pages
  // produce it freely. A table that stops covering the thing it counts is the
  // failure the gate note below argues against.
  const order = ['gap', 'none', 'speck', 'tall', 'wide', 'reach', '-'];
  const ends = [...new Set(rows.map((r) => r.why))]
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const w of ends) {
    const rs = rows.filter((r) => r.why === w);
    if (!rs.length) continue;
    // Only the rows where a key WOULD have come back can be changed by the cut
    // rule at all; a cancellation is refused on its shape either way.
    const said = rs.filter((r) => r.uncut !== null);
    const wn = (r) => want(r);
    const right = said.filter((r) => wn(r) && r.uncut.kind === wn(r).kind && r.uncut.count === wn(r).count).length;
    const label = w === '-' ? 'no band' : w;
    // Which endings are refused is scan-key.js's decision, not this tool's —
    // read it off the band rather than restating it here and drifting.
    const fate = w === '-' ? 'n/a' : (rs.some((r) => r.cut) ? 'REFUSED' : 'kept');
    console.log(`    ${label.padEnd(12)}${String(rs.length).padStart(6)}`
      + `${String(said.length).padStart(29)}${String(right).padStart(9)}${String(said.length - right).padStart(8)}`
      + `   (${fate})`);
  }
  console.log('    `gap` and `tall` are the INTENDED terminators and are kept: refusing them');
  console.log('    costs seven correct reads and removes no wrong key. `speck` and `reach` are');
  console.log('    the scan giving up mid-signature, and refusing those is what takes the');
  console.log('    wrong-key count to zero. See the note on `cut` in scan-key.js.');
}

// A wrong key is the expensive failure and a refused one is the cheap one, so
// they are counted apart rather than added together.
const wrong = rows.filter((r) => !r.ok && r.read !== null);
const refused = rows.filter((r) => !r.ok && r.read === null);
console.log(`  ${wrong.length} read as the WRONG key, ${refused.length} refused`);
if (wrong.length) {
  console.log('\n  wrong, which is the one that costs a semitone on every note of a degree:');
  for (const r of wrong) console.log(`    ${r.clef} ${r.space} ${r.spoil ? 'photo' : 'clean'}: ${name(r)} read as ${said(r)}`);
}
if (refused.length) {
  console.log('\n  refused — no key reported, the caller falls back to C major:');
  for (const r of refused) console.log(`    ${r.clef} ${r.space} ${r.spoil ? 'photo' : 'clean'}: ${name(r)}, band held ${r.bandCount}`);
}
// Every run the scan found, what it was taken for and where it was put, against
// where the test drew it. This is the report that says WHICH test refused.
if (process.env.KEY_DEBUG) {
  console.log('\n  every case, run by run — read as / drawn at:');
  for (const r of rows) {
    if (process.env.KEY_DEBUG !== 'all' && r.ok) continue;
    console.log(`    ${r.clef} ${r.space} ${(r.spoil ? 'photo' : 'clean').padEnd(5)} ${name(r).padEnd(9)}`
      + ` want ${JSON.stringify(r.want).padEnd(26)}`
      + ` end=${r.why.padEnd(5)}`
      + ` got ${r.detail.map((d) => `${d.k.slice(0, 2)}@${d.step} [${d.rt3}/${d.lb3}] x${d.x0}-${d.x1}`).join('  ')}`);
  }
}
const conf = rows.filter((r) => r.ok && r.confidence !== null).map((r) => r.confidence);
if (conf.length) {
  conf.sort((a, b) => a - b);
  console.log(`\n  confidence on a correct read: ${conf[0].toFixed(2)} to ${conf.at(-1).toFixed(2)}, `
    + `median ${conf[Math.floor(conf.length / 2)].toFixed(2)}`);
}
// WHAT MAKES THIS EXIT NON-ZERO: ANY wrong key at all, and any cancellation read
// as the key it cancels.
//
// THE GATE USED TO EXEMPT PHOTOGRAPHS AND ITS REASON HAS EXPIRED. It read "a
// wrong key on a CLEAN page at a size this reader actually works at", and the
// argument for the exemption was that four of the 224 were read wrong on
// photographs, so gating on all of them would ship a check that is red on the
// day it is written — which is a check nobody reads.
//
// All four were long signatures the scan cut short, `findKeyBand` now reports
// when it was cut, `readKeySignature` refuses a cut band, and **the count is
// zero everywhere**. So the exemption now protects nothing and costs the one
// thing this file exists to prevent: those four failures could come back on a
// photograph with this check still green. A wrong key puts a semitone on every
// note of a degree for as long as the page is open, and there is no size or
// camera at which that is acceptable.
//
// The gate has caught a real regression already — tightening the run's jump
// bound to 0.9 read seven sharps as three on a clean page in both clefs — and it
// is now strictly harder to please.
const gateFailures = [
  ...wrong,
  ...rows.filter((r) => r.kind === 'natural' && r.count > 0 && r.read !== null),
];
if (gateFailures.length) {
  console.log('  FAILED — a wrong key on a clean page, or a cancellation read as a key:');
  for (const r of gateFailures) console.log(`    ${r.clef} ${r.space} ${r.spoil ? 'photo' : 'clean'}: ${name(r)} read as ${said(r)}`);
}
console.log('');
if (errors.length) console.log('page errors:', errors.slice(0, 3));
process.exit(gateFailures.length ? 1 : 0);
